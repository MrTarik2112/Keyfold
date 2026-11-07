#![forbid(unsafe_code)]
#![cfg_attr(
    not(debug_assertions),
    deny(clippy::print_stdout, clippy::print_stderr)
)]

pub mod commands;
pub mod crypto;
pub mod error;
pub mod vault;

use std::time::{Duration, SystemTime};

use tauri::Manager;

use crate::commands::AppState;

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            // The vault directory holds nothing but Keyfold's own files, so it is
            // restricted to this account as well: another local user cannot even
            // list it, let alone copy the vault for an offline attack.
            crate::vault::storage::harden_permissions(&data_dir);
            let state = AppState::new(data_dir.join("keyfold.vault"));
            app.manage(state);
            // Protect the window from screen capture from the first frame, even
            // before a vault has been unlocked and its setting is known.
            commands::apply_content_protection(app.handle(), true);
            commands::start_auto_lock_ticker(app.handle().clone());

            // Lock the vault when the window is minimized, if the user asked
            // for that. The setting is read from the unlocked session.
            let handle = app.handle().clone();
            if let Some(window) = app.get_webview_window("main") {
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Resized(_) = event {
                        let minimized = handle
                            .get_webview_window("main")
                            .and_then(|window| window.is_minimized().ok())
                            .unwrap_or(false);
                        if !minimized {
                            return;
                        }
                        let state = handle.state::<AppState>();
                        let should_lock = state
                            .session
                            .read(|vault| Ok(vault.settings.lock_on_minimize))
                            .unwrap_or(false);
                        if should_lock {
                            state.session.lock();
                            state.clear_owned_clipboard(&handle, None);
                            commands::emit_lock_event(
                                &handle,
                                crate::vault::session::LockEvent::Locked,
                            );
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::vault_exists,
            commands::app_info,
            commands::create_vault,
            commands::unlock,
            commands::unlock_critical,
            commands::unlock_recovery,
            commands::lock,
            commands::lock_critical,
            commands::session_status,
            commands::touch,
            commands::touch_critical,
            commands::get_workspace,
            commands::list_tree,
            commands::get_secret,
            commands::copy_secret,
            commands::create_folder,
            commands::update_folder,
            commands::delete_folder,
            commands::create_key,
            commands::update_key,
            commands::move_key,
            commands::delete_key,
            commands::reorder_folders,
            commands::search,
            commands::get_settings,
            commands::set_settings,
            commands::change_master,
            commands::change_critical,
            commands::regenerate_recovery,
            commands::argon2_info,
            commands::retune_argon2,
            commands::export_backup,
            commands::import_backup,
            commands::delete_vault,
            commands::reset_vault,
            commands::save_recovery_key,
            commands::copy_recovery_key,
            commands::open_vault_location,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Keyfold");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            if let Some(state) = app_handle.try_state::<AppState>() {
                state.clear_owned_clipboard(app_handle, None);
            }
        }
    });
}

/// Wall-clock gap that indicates the machine slept rather than idled.
const SLEEP_GAP: Duration = Duration::from_secs(5);

pub(crate) fn sleep_gap_exceeded(last: SystemTime) -> bool {
    SystemTime::now()
        .duration_since(last)
        .map(|gap| gap > SLEEP_GAP)
        .unwrap_or(false)
}
