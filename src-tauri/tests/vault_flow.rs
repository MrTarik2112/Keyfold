//! End-to-end test for the command surface: a vault is created through the
//! same IPC layer the UI uses, keys are stored in both tiers, moved across the
//! tier boundary, and read back after restarts and locks.

use std::path::PathBuf;

use keyfold_lib::commands::AppState;
use serde_json::{json, Value};
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tempfile::TempDir;

const MASTER: &str = "correct horse battery staple";
const CRITICAL: &str = "second password is critical";

struct Harness {
    app: tauri::App<tauri::test::MockRuntime>,
    _dir: Option<TempDir>,
    vault: PathBuf,
}

impl Harness {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("temp dir");
        let vault = dir.path().join("keyfold.vault");
        let app = mock_builder()
            .invoke_handler(tauri::generate_handler![
                keyfold_lib::commands::vault_exists,
                keyfold_lib::commands::app_info,
                keyfold_lib::commands::create_vault,
                keyfold_lib::commands::unlock,
                keyfold_lib::commands::unlock_critical,
                keyfold_lib::commands::unlock_recovery,
                keyfold_lib::commands::lock,
                keyfold_lib::commands::lock_critical,
                keyfold_lib::commands::session_status,
                keyfold_lib::commands::get_workspace,
                keyfold_lib::commands::get_secret,
                keyfold_lib::commands::create_folder,
                keyfold_lib::commands::create_key,
                keyfold_lib::commands::move_key,
                keyfold_lib::commands::delete_key,
                keyfold_lib::commands::search,
                keyfold_lib::commands::change_master,
            ])
            .build(mock_context(noop_assets()))
            .expect("mock app");
        app.manage(AppState::new(vault.clone()));
        WebviewWindowBuilder::new(&app, "main", WebviewUrl::default())
            .build()
            .expect("mock webview");
        Self {
            app,
            _dir: Some(dir),
            vault,
        }
    }

    fn invoke(&self, cmd: &str, args: Value) -> Result<Value, Value> {
        let webview = self.app.get_webview_window("main").expect("main window");
        let response = get_ipc_response(
            &webview,
            InvokeRequest {
                cmd: cmd.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "http://tauri.localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::Json(args),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )?;
        response
            .deserialize::<Value>()
            .map_err(|error| json!({ "message": error.to_string() }))
    }

    fn ok(&self, cmd: &str, args: Value) -> Value {
        self.invoke(cmd, args)
            .unwrap_or_else(|error| panic!("{cmd} failed: {error}"))
    }
}

/// A second process would only see the file on disk, so build a fresh app
/// around the same vault path to prove nothing depends on in-memory state.
fn reopen(vault: &std::path::Path) -> Harness {
    let app = mock_builder()
        .invoke_handler(tauri::generate_handler![
            keyfold_lib::commands::unlock,
            keyfold_lib::commands::unlock_critical,
            keyfold_lib::commands::unlock_recovery,
            keyfold_lib::commands::lock,
            keyfold_lib::commands::get_workspace,
            keyfold_lib::commands::get_secret,
            keyfold_lib::commands::change_master,
        ])
        .build(mock_context(noop_assets()))
        .expect("mock app");
    app.manage(AppState::new(vault.to_path_buf()));
    WebviewWindowBuilder::new(&app, "main", WebviewUrl::default())
        .build()
        .expect("mock webview");
    Harness {
        app,
        _dir: None,
        vault: vault.to_path_buf(),
    }
}

#[test]
fn vault_lifecycle_through_ipc() {
    let harness = Harness::new();
    assert_eq!(harness.ok("vault_exists", json!({})), json!(false));

    let created = harness.ok(
        "create_vault",
        json!({ "masterPassword": MASTER, "criticalPassword": CRITICAL }),
    );
    let recovery_key = created["recoveryKey"]
        .as_str()
        .expect("recovery key")
        .to_string();
    let groups: Vec<&str> = recovery_key.split('-').collect();
    assert_eq!(
        groups.len(),
        13,
        "unexpected recovery format: {recovery_key}"
    );
    assert!(groups.iter().all(|group| group.len() == 4));
    assert_eq!(created["workspace"]["criticalUnlocked"], json!(true));

    let folder = harness.ok(
        "create_folder",
        json!({
            "input": {
                "tier": "standard",
                "name": "Stripe",
                "icon": "stripe",
                "color": "accent",
                "note": null
            }
        }),
    );
    let folder_id = folder["folders"][0]["id"]
        .as_str()
        .expect("folder id")
        .to_string();

    let standard_key = harness.ok(
        "create_key",
        json!({
            "input": {
                "tier": "standard",
                "folderId": folder_id,
                "label": "Production secret",
                "value": "sk-live-abcdefghijklmnop1234",
                "note": "rotate monthly",
                "provider": "Stripe",
                "tags": ["prod"],
                "expiresAt": null
            }
        }),
    );
    let standard_id = standard_key["id"].as_str().expect("key id").to_string();
    assert_eq!(standard_key["folderId"], json!(folder_id));

    harness.ok("unlock_critical", json!({ "password": CRITICAL }));
    let critical_key = harness.ok(
        "create_key",
        json!({
            "input": {
                "tier": "critical",
                "folderId": null,
                "label": "Recovery root token",
                "value": "crit-value-that-must-stay-hidden",
                "note": null,
                "provider": null,
                "tags": [],
                "expiresAt": null
            }
        }),
    );
    let critical_id = critical_key["id"]
        .as_str()
        .expect("critical id")
        .to_string();

    // Moving a Standard key into Critical re-encrypts it with the 3-layer
    // scheme, so the Critical session must be able to read it afterwards.
    let moved = harness.ok(
        "move_key",
        json!({
            "input": { "id": standard_id, "targetTier": "critical", "targetFolderId": null }
        }),
    );
    assert_eq!(moved["standard"]["keyCount"], json!(0));
    assert_eq!(
        harness.ok("get_secret", json!({ "entryId": standard_id })),
        json!("sk-live-abcdefghijklmnop1234")
    );

    let hits = harness.ok("search", json!({ "query": "recovery" }));
    assert_eq!(hits.as_array().expect("array").len(), 1);
    assert_eq!(hits[0]["tier"], json!("critical"));

    harness.ok("lock", json!({}));
    assert!(harness.invoke("get_workspace", json!({})).is_err());

    assert!(harness
        .invoke("unlock", json!({ "password": "not the password" }))
        .is_err());

    let unlocked = harness.ok("unlock", json!({ "password": MASTER }));
    assert_eq!(unlocked["criticalUnlocked"], json!(false));
    assert_eq!(unlocked["critical"], Value::Null);
    assert!(harness
        .invoke("get_secret", json!({ "entryId": critical_id }))
        .is_err());
    assert!(harness
        .invoke("unlock_critical", json!({ "password": MASTER }))
        .is_err());
    let unlocked = harness.ok("unlock_critical", json!({ "password": CRITICAL }));
    assert_eq!(unlocked["criticalUnlocked"], json!(true));

    // Locking only the Critical tier keeps the Standard session alive.
    harness.ok("lock_critical", json!({}));
    assert!(harness
        .invoke("get_secret", json!({ "entryId": critical_id }))
        .is_err());

    let restarted = reopen(&harness.vault);
    let unlocked = restarted.ok("unlock", json!({ "password": MASTER }));
    assert_eq!(unlocked["standard"]["keyCount"], json!(0));
    assert_eq!(unlocked["critical"], Value::Null);

    let unlocked = restarted.ok("unlock_critical", json!({ "password": CRITICAL }));
    assert_eq!(unlocked["critical"]["keyCount"], json!(2));

    // A password change rewraps VK only; existing data must still decrypt.
    restarted.ok(
        "change_master",
        json!({ "currentPassword": MASTER, "newPassword": "a different master password" }),
    );
    restarted.ok("lock", json!({}));
    assert!(restarted
        .invoke("unlock", json!({ "password": MASTER }))
        .is_err());
    restarted.ok(
        "unlock",
        json!({ "password": "a different master password" }),
    );
    restarted.ok("unlock_critical", json!({ "password": CRITICAL }));
    assert_eq!(
        restarted.ok("get_secret", json!({ "entryId": critical_id })),
        json!("crit-value-that-must-stay-hidden")
    );

    let recovered = reopen(&restarted.vault);
    let unlocked = recovered.ok("unlock_recovery", json!({ "recoveryKey": recovery_key }));
    assert_eq!(unlocked["critical"]["keyCount"], json!(2));
    drop(restarted);
}
