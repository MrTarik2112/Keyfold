use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::crypto::hierarchy::{
    self, keys_equal, unwrap_ck, unwrap_recovery_ck, unwrap_recovery_vk, unwrap_vk, wrap_ck,
    wrap_recovery_ck, wrap_recovery_vk, wrap_vk, Header,
};
use crate::crypto::kdf::{derive_key, tune, KdfParams};
use crate::crypto::layers::{
    decrypt_critical, decrypt_standard, encrypt_critical, encrypt_standard, open_critical_metadata,
    open_standard_metadata, seal_critical_metadata, seal_standard_metadata, CriticalKeys,
    StandardKeys,
};
use crate::crypto::recovery;
use crate::error::{AppError, Result};
use crate::vault::model::{
    now, ApiKey, EncryptedValue, Folder, KeyView, SearchHit, SessionStatus, Settings, Tier,
    TierData, TierView, WorkspaceView,
};
use crate::vault::session::{Session, UnlockedVault};
use crate::vault::storage::{self, VaultFile};
use crate::vault::FORMAT_VERSION;

pub const MIN_PASSWORD_LEN: usize = 12;

/// Upper bound for a single key value, so a hostile IPC call cannot stuff
/// the vault with gigabytes inside one secret.
const MAX_SECRET_LEN: usize = 4096;
/// Bounds on the free-form metadata a webview may attach to one entry, so a
/// hostile caller cannot inflate the vault or wedge the UI without limit.
const MAX_NOTE_LEN: usize = 2000;
const MAX_PROVIDER_LEN: usize = 64;
const MAX_DATE_LEN: usize = 40;
const MAX_TAGS: usize = 20;
const MAX_TAG_LEN: usize = 32;
/// Container ceilings, so one hostile caller cannot bloat the vault or force
/// unbounded work in every render and save.
const MAX_KEYS_PER_TIER: usize = 5000;
const MAX_FOLDERS_PER_TIER: usize = 500;
const MAX_SEARCH_LEN: usize = 256;

pub struct AppState {
    pub vault_path: PathBuf,
    pub session: Session,
    pub header: Mutex<Option<Header>>,
    /// Fingerprint of the last secret written to the clipboard, so a lock can
    /// clear only a clipboard that still belongs to Keyfold. The secret itself
    /// is never retained here.
    clipboard_guard: Mutex<Option<ClipboardGuard>>,
}

#[derive(Clone, Copy)]
struct ClipboardGuard {
    fingerprint: [u8; 32],
    tier: Tier,
}

impl AppState {
    pub fn new(vault_path: PathBuf) -> Self {
        Self {
            vault_path,
            session: Session::new(),
            header: Mutex::new(None),
            clipboard_guard: Mutex::new(None),
        }
    }

    fn remember_clipboard(&self, value: &str, tier: Tier) {
        *lock_or_recover(&self.clipboard_guard) = Some(ClipboardGuard {
            fingerprint: clipboard_fingerprint(value),
            tier,
        });
    }

    /// Clear the clipboard on lock only when it still holds a value Keyfold
    /// copied. `only` narrows the clear to a tier (used when Critical locks).
    pub(crate) fn clear_owned_clipboard<R: Runtime>(&self, app: &AppHandle<R>, only: Option<Tier>) {
        let guard = {
            let mut slot = lock_or_recover(&self.clipboard_guard);
            match *slot {
                Some(guard) if only.map_or(true, |tier| tier == guard.tier) => slot.take(),
                _ => None,
            }
        };
        let Some(guard) = guard else { return };
        if let Ok(current) = app.clipboard().read_text() {
            if same_fingerprint(&clipboard_fingerprint(&current), &guard.fingerprint) {
                let _ = app.clipboard().write_text(String::new());
            }
        }
    }
}

fn clipboard_fingerprint(value: &str) -> [u8; 32] {
    Sha256::digest(value.as_bytes()).into()
}

/// Fingerprints are not secret, but comparing them in constant time keeps the
/// guard check consistent with every other key comparison in the app.
fn same_fingerprint(a: &[u8; 32], b: &[u8; 32]) -> bool {
    bool::from(a[..].ct_eq(&b[..]))
}

/// Ask the OS to exclude the vault window from screen capture where supported.
/// Best effort: unsupported platforms simply ignore the request.
pub fn apply_content_protection<R: Runtime>(app: &AppHandle<R>, enabled: bool) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_content_protected(enabled);
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StandardPayload {
    #[serde(default)]
    created_at: String,
    settings: Settings,
    tier: TierData,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateVaultResponse {
    pub recovery_key: String,
    pub workspace: WorkspaceView,
}

/// Key material plus decrypted payload returned by the recovery unlock path.
type RecoveredMaterial = (
    Zeroizing<[u8; 32]>,
    Zeroizing<[u8; 32]>,
    StandardPayload,
    TierData,
);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyResponse {
    pub clears_in_seconds: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub format_version: u16,
    pub vault_path: String,
}

/* -------------------------------- helpers -------------------------------- */

fn lock_or_recover<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn current_header(state: &AppState) -> Result<Header> {
    if let Some(header) = lock_or_recover(&state.header).clone() {
        return Ok(header);
    }
    let file = storage::load(&state.vault_path)?;
    *lock_or_recover(&state.header) = Some(file.header.clone());
    Ok(file.header)
}

fn store_header(state: &AppState, header: Header) {
    *lock_or_recover(&state.header) = Some(header);
}

fn require_password(value: &str, label: &str) -> Result<()> {
    if value.chars().count() < MIN_PASSWORD_LEN {
        return Err(AppError::Invalid(format!(
            "{label} must be at least {MIN_PASSWORD_LEN} characters."
        )));
    }
    if value.chars().count() > 1024 {
        return Err(AppError::Invalid(format!("{label} is too long.")));
    }
    Ok(())
}

fn require_distinct(master: &str, critical: &str) -> Result<()> {
    if master == critical {
        return Err(AppError::Invalid(
            "The Standard and Critical passwords must be different.".into(),
        ));
    }
    Ok(())
}

fn require_text(value: &str, label: &str, max: usize) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::Invalid(format!("{label} cannot be empty.")));
    }
    if trimmed.chars().count() > max {
        return Err(AppError::Invalid(format!(
            "{label} must be {max} characters or fewer."
        )));
    }
    Ok(trimmed.to_string())
}

/// Identifiers Keyfold generates are UUIDs. Anything outside that charset is
/// either a bug or an attempt to smuggle one of the NUL separators the AAD
/// builders use, so it is refused at the IPC boundary.
fn require_id(value: &str) -> Result<()> {
    let valid = !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    if !valid {
        return Err(AppError::Invalid("That identifier is not valid.".into()));
    }
    Ok(())
}

fn optional_text(value: Option<String>, label: &str, max: usize) -> Result<Option<String>> {
    let Some(text) = value else { return Ok(None) };
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.chars().count() > max {
        return Err(AppError::Invalid(format!(
            "{label} must be {max} characters or fewer."
        )));
    }
    Ok(Some(trimmed.to_string()))
}

fn clean_tags(tags: Vec<String>) -> Result<Vec<String>> {
    if tags.len() > MAX_TAGS {
        return Err(AppError::Invalid(format!(
            "A key can have at most {MAX_TAGS} tags."
        )));
    }
    let mut cleaned = Vec::with_capacity(tags.len());
    for tag in tags {
        let trimmed = tag.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.chars().count() > MAX_TAG_LEN {
            return Err(AppError::Invalid(format!(
                "A tag must be {MAX_TAG_LEN} characters or fewer."
            )));
        }
        cleaned.push(trimmed.to_string());
    }
    Ok(cleaned)
}

fn decrypt_entry(
    vault: &UnlockedVault,
    header: &Header,
    tier: Tier,
    key: &ApiKey,
) -> Result<Zeroizing<String>> {
    match (tier, &key.value) {
        (Tier::Standard, EncryptedValue::Standard(envelope)) => {
            let keys = StandardKeys::derive(&vault.vk[..], &header.hkdf_salt)?;
            decrypt_standard(&keys, &vault.vault_id, &key.id, envelope)
        }
        (Tier::Critical, EncryptedValue::Critical(envelope)) => {
            let ck = vault.ck.as_ref().ok_or(AppError::CriticalLocked)?;
            let keys = CriticalKeys::derive(&ck[..], &header.hkdf_salt)?;
            decrypt_critical(&keys, &vault.vault_id, &key.id, envelope)
        }
        _ => Err(AppError::MalformedVault),
    }
}

fn encrypt_entry(
    vault: &UnlockedVault,
    header: &Header,
    tier: Tier,
    entry_id: &str,
    plaintext: &str,
) -> Result<EncryptedValue> {
    match tier {
        Tier::Standard => {
            let keys = StandardKeys::derive(&vault.vk[..], &header.hkdf_salt)?;
            Ok(EncryptedValue::Standard(encrypt_standard(
                &keys,
                &vault.vault_id,
                entry_id,
                plaintext,
            )?))
        }
        Tier::Critical => {
            let ck = vault.ck.as_ref().ok_or(AppError::CriticalLocked)?;
            let keys = CriticalKeys::derive(&ck[..], &header.hkdf_salt)?;
            Ok(EncryptedValue::Critical(encrypt_critical(
                &keys,
                &vault.vault_id,
                entry_id,
                plaintext,
            )?))
        }
    }
}

/// Locate a key across both tiers. Critical is only searched while unlocked.
fn find_key<'a>(vault: &'a UnlockedVault, key_id: &str) -> Result<(Tier, &'a ApiKey)> {
    if let Some(key) = vault.standard.key(key_id) {
        return Ok((Tier::Standard, key));
    }
    if let Some(critical) = vault.critical.as_ref() {
        if let Some(key) = critical.key(key_id) {
            return Ok((Tier::Critical, key));
        }
    }
    Err(AppError::NotFound)
}

fn tier_data(vault: &UnlockedVault, tier: Tier) -> Result<&TierData> {
    match tier {
        Tier::Standard => Ok(&vault.standard),
        Tier::Critical => vault.critical.as_ref().ok_or(AppError::CriticalLocked),
    }
}

fn tier_data_mut(vault: &mut UnlockedVault, tier: Tier) -> Result<&mut TierData> {
    match tier {
        Tier::Standard => Ok(&mut vault.standard),
        Tier::Critical => vault.critical.as_mut().ok_or(AppError::CriticalLocked),
    }
}

fn workspace_of(vault: &UnlockedVault) -> WorkspaceView {
    WorkspaceView {
        vault_id: vault.vault_id.clone(),
        created_at: vault.created_at.clone(),
        settings: vault.settings.clone(),
        standard: TierView::new(&vault.standard),
        critical: vault.critical.as_ref().map(TierView::new),
        critical_unlocked: vault.critical.is_some(),
    }
}

/// Re-encrypt both tier blobs and write the vault atomically.
fn persist(state: &AppState) -> Result<()> {
    let header = current_header(state)?;
    let (standard_blob, critical_blob) = state.session.read(|vault| {
        let standard_keys = StandardKeys::derive(&vault.vk[..], &header.hkdf_salt)?;
        let payload = StandardPayload {
            created_at: vault.created_at.clone(),
            settings: vault.settings.clone(),
            tier: vault.standard.clone(),
        };
        let json = Zeroizing::new(
            serde_json::to_vec(&payload).map_err(|_| AppError::MalformedVault)?,
        );
        let standard_blob = seal_standard_metadata(&standard_keys, &vault.vault_id, &json)?;

        let critical_blob = match (&vault.ck, &vault.critical) {
            (Some(ck), Some(critical)) => {
                let keys = CriticalKeys::derive(&ck[..], &header.hkdf_salt)?;
                let json = Zeroizing::new(
                    serde_json::to_vec(critical).map_err(|_| AppError::MalformedVault)?,
                );
                seal_critical_metadata(&keys, &vault.vault_id, &json)?
            }
            _ => vault.critical_blob.clone(),
        };
        Ok((standard_blob, critical_blob))
    })?;

    storage::save(
        &state.vault_path,
        &VaultFile {
            header,
            standard_blob,
            critical_blob,
        },
    )
}

fn verify_master(header: &Header, password: &str) -> Result<Zeroizing<[u8; 32]>> {
    let k1 = derive_key(password, &header.salt1, &header.kdf)?;
    let _vk = unwrap_vk(
        &k1[..],
        &header.wrapped_vk,
        &header.hkdf_salt,
        &header.vault_id,
    )?;
    Ok(k1)
}

fn verify_critical(header: &Header, k1: &[u8], password: &str) -> Result<Zeroizing<[u8; 32]>> {
    let k2 = derive_key(password, &header.salt2, &header.kdf)?;
    let _ck = unwrap_ck(
        k1,
        &k2[..],
        &header.wrapped_ck,
        &header.hkdf_salt,
        &header.vault_id,
    )?;
    Ok(k2)
}

/// Password verification outside the unlock commands counts against the same
/// backoff, so no command path becomes a fast password oracle.
fn verify_master_limited(
    state: &AppState,
    header: &Header,
    password: &str,
) -> Result<Zeroizing<[u8; 32]>> {
    let attempt = state.session.begin_attempt();
    state.session.check_rate_limit()?;
    match verify_master(header, password) {
        Ok(k1) => Ok(k1),
        Err(AppError::InvalidPassword) => {
            let wait = attempt.fail();
            if wait > 0 {
                return Err(AppError::RateLimited(wait));
            }
            Err(AppError::InvalidPassword)
        }
        Err(error) => Err(error),
    }
}

fn verify_critical_limited(
    state: &AppState,
    header: &Header,
    k1: &[u8],
    password: &str,
) -> Result<Zeroizing<[u8; 32]>> {
    let attempt = state.session.begin_attempt();
    state.session.check_rate_limit()?;
    match verify_critical(header, k1, password) {
        Ok(k2) => Ok(k2),
        Err(AppError::InvalidCriticalPassword) => {
            let wait = attempt.fail();
            if wait > 0 {
                return Err(AppError::RateLimited(wait));
            }
            Err(AppError::InvalidCriticalPassword)
        }
        Err(error) => Err(error),
    }
}

/* ------------------------------- commands -------------------------------- */

#[tauri::command]
pub fn vault_exists(state: State<'_, AppState>) -> bool {
    state.vault_path.exists()
}

#[tauri::command]
pub fn app_info(state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        format_version: FORMAT_VERSION,
        vault_path: state.vault_path.to_string_lossy().to_string(),
    }
}

#[tauri::command]
pub fn create_vault<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    master_password: String,
    critical_password: String,
) -> Result<CreateVaultResponse> {
    if state.vault_path.exists() {
        return Err(AppError::AlreadyExists);
    }
    let master = SecretString::from(master_password);
    let critical = SecretString::from(critical_password);
    require_password(master.expose_secret(), "The Standard password")?;
    require_password(critical.expose_secret(), "The Critical password")?;
    require_distinct(master.expose_secret(), critical.expose_secret())?;

    let kdf = tune()?;
    let vault_id = Uuid::new_v4().to_string();
    let created_at = now();
    let created = hierarchy::create(
        master.expose_secret(),
        critical.expose_secret(),
        kdf,
        &vault_id,
    )?;

    let payload = StandardPayload {
        created_at: created_at.clone(),
        settings: Settings::default(),
        tier: TierData::default(),
    };
    let standard_keys = StandardKeys::derive(&created.vk[..], &created.header.hkdf_salt)?;
    let payload_json = Zeroizing::new(
        serde_json::to_vec(&payload).map_err(|_| AppError::MalformedVault)?,
    );
    let standard_blob = seal_standard_metadata(&standard_keys, &vault_id, &payload_json)?;
    let critical_keys = CriticalKeys::derive(&created.ck[..], &created.header.hkdf_salt)?;
    let critical_json = Zeroizing::new(
        serde_json::to_vec(&TierData::default()).map_err(|_| AppError::MalformedVault)?,
    );
    let critical_blob = seal_critical_metadata(&critical_keys, &vault_id, &critical_json)?;

    let file = VaultFile {
        header: created.header.clone(),
        standard_blob: standard_blob.clone(),
        critical_blob: critical_blob.clone(),
    };
    storage::save(&state.vault_path, &file)?;

    let mut unlocked = UnlockedVault::new(
        vault_id,
        created_at,
        Settings::default(),
        created.vk,
        created.k1,
        TierData::default(),
        critical_blob,
    );
    unlocked.unlock_critical(
        created.k2,
        created.ck,
        TierData::default(),
        file.critical_blob,
    );
    let workspace = workspace_of(&unlocked);
    let protected = unlocked.settings.screen_capture_protected;
    state.session.install(unlocked);
    store_header(&state, created.header);
    apply_content_protection(&app, protected);

    Ok(CreateVaultResponse {
        recovery_key: created.recovery_key.to_string(),
        workspace,
    })
}

#[tauri::command]
pub fn unlock<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    password: String,
) -> Result<WorkspaceView> {
    let attempt = state.session.begin_attempt();
    state.session.check_rate_limit()?;
    let file = storage::load(&state.vault_path)?;
    storage::validate_header(&file.header)?;

    let password = SecretString::from(password);
    let derived = derive_key(
        password.expose_secret(),
        &file.header.salt1,
        &file.header.kdf,
    );
    let unlocked = derived.and_then(|k1| {
        let vk = unwrap_vk(
            &k1[..],
            &file.header.wrapped_vk,
            &file.header.hkdf_salt,
            &file.header.vault_id,
        )?;
        let keys = StandardKeys::derive(&vk[..], &file.header.hkdf_salt)?;
        let plain = open_standard_metadata(&keys, &file.header.vault_id, &file.standard_blob)?;
        let payload: StandardPayload =
            serde_json::from_slice(&plain).map_err(|_| AppError::MalformedVault)?;
        Ok((k1, vk, payload))
    });

    match unlocked {
        Ok((k1, vk, payload)) => {
            let created_at = if payload.created_at.is_empty() {
                now()
            } else {
                payload.created_at
            };
            let vault = UnlockedVault::new(
                file.header.vault_id.clone(),
                created_at,
                payload.settings,
                vk,
                k1,
                payload.tier,
                file.critical_blob,
            );
            let view = workspace_of(&vault);
            let protected = vault.settings.screen_capture_protected;
            state.session.install(vault);
            store_header(&state, file.header);
            attempt.succeed();
            apply_content_protection(&app, protected);
            Ok(view)
        }
        Err(_) => {
            let wait = attempt.fail();
            if wait > 0 {
                Err(AppError::RateLimited(wait))
            } else {
                Err(AppError::InvalidPassword)
            }
        }
    }
}

#[tauri::command]
pub fn unlock_critical(state: State<'_, AppState>, password: String) -> Result<WorkspaceView> {
    let attempt = state.session.begin_attempt();
    state.session.check_rate_limit()?;
    let header = current_header(&state)?;
    let file = storage::load(&state.vault_path)?;
    let password = SecretString::from(password);

    let result = state.session.write(|vault| {
        let k2 = derive_key(password.expose_secret(), &header.salt2, &header.kdf)?;
        let ck = unwrap_ck(
            &vault.k1[..],
            &k2[..],
            &header.wrapped_ck,
            &header.hkdf_salt,
            &vault.vault_id,
        )?;
        let keys = CriticalKeys::derive(&ck[..], &header.hkdf_salt)?;
        let plain = open_critical_metadata(&keys, &vault.vault_id, &file.critical_blob)?;
        let data: TierData =
            serde_json::from_slice(&plain).map_err(|_| AppError::MalformedVault)?;
        vault.unlock_critical(k2, ck, data, file.critical_blob.clone());
        Ok(workspace_of(vault))
    });

    match result {
        Ok(view) => {
            attempt.succeed();
            Ok(view)
        }
        Err(AppError::Locked) => Err(AppError::Locked),
        Err(_) => {
            let wait = attempt.fail();
            if wait > 0 {
                Err(AppError::RateLimited(wait))
            } else {
                Err(AppError::InvalidCriticalPassword)
            }
        }
    }
}

#[tauri::command]
pub fn unlock_recovery<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    recovery_key: String,
) -> Result<WorkspaceView> {
    let attempt = state.session.begin_attempt();
    state.session.check_rate_limit()?;
    let file = storage::load(&state.vault_path)?;
    storage::validate_header(&file.header)?;
    let recovery_key = SecretString::from(recovery_key);

    let result = (|| -> Result<RecoveredMaterial> {
        let rk = recovery::decode(recovery_key.expose_secret())?;
        let vk = unwrap_recovery_vk(
            &rk[..],
            &file.header.recovery_vk,
            &file.header.hkdf_salt,
            &file.header.vault_id,
        )?;
        let ck = unwrap_recovery_ck(
            &rk[..],
            &file.header.recovery_ck,
            &file.header.hkdf_salt,
            &file.header.vault_id,
        )?;
        let standard_keys = StandardKeys::derive(&vk[..], &file.header.hkdf_salt)?;
        let payload: StandardPayload = serde_json::from_slice(&open_standard_metadata(
            &standard_keys,
            &file.header.vault_id,
            &file.standard_blob,
        )?)
        .map_err(|_| AppError::MalformedVault)?;
        let critical_keys = CriticalKeys::derive(&ck[..], &file.header.hkdf_salt)?;
        let critical: TierData = serde_json::from_slice(&open_critical_metadata(
            &critical_keys,
            &file.header.vault_id,
            &file.critical_blob,
        )?)
        .map_err(|_| AppError::MalformedVault)?;
        Ok((vk, ck, payload, critical))
    })();

    match result {
        Ok((vk, ck, payload, critical)) => {
            let created_at = if payload.created_at.is_empty() {
                now()
            } else {
                payload.created_at
            };
            let mut vault = UnlockedVault::new(
                file.header.vault_id.clone(),
                created_at,
                payload.settings,
                vk,
                Zeroizing::new([0u8; 32]),
                payload.tier,
                file.critical_blob.clone(),
            );
            // The recovery key unwraps VK and CK; K1/K2 are not derivable from
            // it, so password changes require a fresh unlock. Mark Critical as
            // unlocked with empty password keys guarded by `recovery_mode`.
            vault.unlock_critical(
                Zeroizing::new([0u8; 32]),
                ck,
                critical,
                file.critical_blob.clone(),
            );
            vault.recovery_mode = true;
            let view = workspace_of(&vault);
            let protected = vault.settings.screen_capture_protected;
            state.session.install(vault);
            store_header(&state, file.header);
            attempt.succeed();
            apply_content_protection(&app, protected);
            Ok(view)
        }
        Err(error) => {
            let wait = attempt.fail();
            if wait > 0 {
                return Err(AppError::RateLimited(wait));
            }
            Err(error)
        }
    }
}

#[tauri::command]
pub fn lock<R: Runtime>(app: AppHandle<R>, state: State<'_, AppState>) {
    state.session.lock();
    state.clear_owned_clipboard(&app, None);
}

#[tauri::command]
pub fn lock_critical<R: Runtime>(app: AppHandle<R>, state: State<'_, AppState>) -> Result<()> {
    let result = state.session.lock_critical();
    if result.is_ok() {
        state.clear_owned_clipboard(&app, Some(Tier::Critical));
    }
    result
}

#[tauri::command]
pub fn session_status(state: State<'_, AppState>) -> SessionStatus {
    state.session.status()
}

#[tauri::command]
pub fn touch(state: State<'_, AppState>) -> Result<()> {
    state.session.touch()
}

#[tauri::command]
pub fn touch_critical(state: State<'_, AppState>) -> Result<()> {
    state.session.touch_critical()
}

#[tauri::command]
pub fn get_workspace(state: State<'_, AppState>) -> Result<WorkspaceView> {
    state.session.read(|vault| Ok(workspace_of(vault)))
}

#[tauri::command]
pub fn list_tree(state: State<'_, AppState>, tier: String) -> Result<TierView> {
    let tier = Tier::parse(&tier)?;
    state
        .session
        .read(|vault| Ok(TierView::new(tier_data(vault, tier)?)))
}

#[tauri::command]
pub fn get_secret(state: State<'_, AppState>, entry_id: String) -> Result<String> {
    require_id(&entry_id)?;
    let header = current_header(&state)?;
    state.session.write(|vault| {
        let (tier, key) = find_key(vault, &entry_id)?;
        let value = decrypt_entry(vault, &header, tier, key)?;
        if tier == Tier::Critical {
            vault.touch_critical();
        }
        Ok(value.to_string())
    })
}

#[tauri::command]
pub fn copy_secret<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    entry_id: String,
) -> Result<CopyResponse> {
    require_id(&entry_id)?;
    let header = current_header(&state)?;
    let (value, clears_in_seconds, tier) = state.session.write(|vault| {
        let (tier, key) = find_key(vault, &entry_id)?;
        let value = decrypt_entry(vault, &header, tier, key)?;
        let clears = vault.settings.clipboard_clear_seconds;
        let stamp = now();
        let data = tier_data_mut(vault, tier)?;
        if let Some(key) = data.key_mut(&entry_id) {
            key.last_copied_at = Some(stamp);
        }
        if tier == Tier::Critical {
            vault.touch_critical();
        }
        Ok((value, clears, tier))
    })?;

    app.clipboard()
        .write_text(value.to_string())
        .map_err(|_| AppError::Clipboard)?;
    state.remember_clipboard(value.as_str(), tier);

    // Only a fingerprint of the secret outlives this call: the timer thread
    // holds no plaintext, so nothing sensitive lingers for up to 300 seconds.
    let fingerprint = clipboard_fingerprint(value.as_str());
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(u64::from(clears_in_seconds)));
        if let Ok(current) = handle.clipboard().read_text() {
            if same_fingerprint(&clipboard_fingerprint(&current), &fingerprint) {
                let _ = handle.clipboard().write_text(String::new());
            }
        }
    });

    persist(&state)?;
    Ok(CopyResponse { clears_in_seconds })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderDraft {
    pub tier: String,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub note: Option<String>,
}

#[tauri::command]
pub fn create_folder(state: State<'_, AppState>, input: FolderDraft) -> Result<TierView> {
    let tier = Tier::parse(&input.tier)?;
    let name = require_text(&input.name, "Folder name", 80)?;
    let icon = require_text(&input.icon, "Icon", 32)?;
    let color = require_text(&input.color, "Color", 32)?;
    let note = optional_text(input.note, "Note", MAX_NOTE_LEN)?;
    let stamp = now();
    let folder = Folder {
        id: Uuid::new_v4().to_string(),
        name,
        icon,
        color,
        note,
        keys: Vec::new(),
        created_at: stamp.clone(),
        updated_at: stamp,
    };

    let view = state.session.write(|vault| {
        if tier == Tier::Critical {
            vault.touch_critical();
        }
        let data = tier_data_mut(vault, tier)?;
        if data.folders.len() >= MAX_FOLDERS_PER_TIER {
            return Err(AppError::Invalid(
                "This tier already has the maximum number of folders.".into(),
            ));
        }
        data.folders.push(folder);
        Ok(TierView::new(tier_data(vault, tier)?))
    })?;
    persist(&state)?;
    Ok(view)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderPatch {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub note: Option<String>,
}

#[tauri::command]
pub fn update_folder(state: State<'_, AppState>, input: FolderPatch) -> Result<TierView> {
    require_id(&input.id)?;
    let name = require_text(&input.name, "Folder name", 80)?;
    let icon = require_text(&input.icon, "Icon", 32)?;
    let color = require_text(&input.color, "Color", 32)?;
    let note = optional_text(input.note.clone(), "Note", MAX_NOTE_LEN)?;
    let view = state.session.write(|vault| {
        let mut found = None;
        for tier in [Tier::Standard, Tier::Critical] {
            if tier == Tier::Critical && vault.critical.is_none() {
                continue;
            }
            let data = tier_data_mut(vault, tier)?;
            if data.find_folder(&input.id).is_some() {
                found = Some(tier);
                if let Some(folder) = data.find_folder_mut(&input.id) {
                    folder.name = name.clone();
                    folder.icon = icon.clone();
                    folder.color = color.clone();
                    folder.note = note.clone();
                    folder.updated_at = now();
                }
                break;
            }
        }
        let tier = found.ok_or(AppError::NotFound)?;
        if tier == Tier::Critical {
            vault.touch_critical();
        }
        Ok(TierView::new(tier_data(vault, tier)?))
    })?;
    persist(&state)?;
    Ok(view)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteFolderInput {
    pub id: String,
    pub confirm_name: String,
}

#[tauri::command]
pub fn delete_folder(state: State<'_, AppState>, input: DeleteFolderInput) -> Result<TierView> {
    require_id(&input.id)?;
    let view = state.session.write(|vault| {
        let mut located = None;
        for tier in [Tier::Standard, Tier::Critical] {
            if tier == Tier::Critical && vault.critical.is_none() {
                continue;
            }
            let data = tier_data(vault, tier)?;
            if let Some(folder) = data.find_folder(&input.id) {
                located = Some((tier, folder.name.clone(), folder.keys.len()));
                break;
            }
        }
        let (tier, name, key_count) = located.ok_or(AppError::NotFound)?;
        if key_count > 0 && input.confirm_name.trim() != name {
            return Err(AppError::Invalid(
                "Type the folder name exactly to delete a folder that contains keys.".into(),
            ));
        }
        tier_data_mut(vault, tier)?.remove_folder(&input.id);
        if tier == Tier::Critical {
            vault.touch_critical();
        }
        Ok(TierView::new(tier_data(vault, tier)?))
    })?;
    persist(&state)?;
    Ok(view)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyDraft {
    pub tier: String,
    pub folder_id: Option<String>,
    pub label: String,
    pub value: String,
    pub note: Option<String>,
    pub provider: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub expires_at: Option<String>,
}

#[tauri::command]
pub fn create_key(state: State<'_, AppState>, input: KeyDraft) -> Result<KeyView> {
    let tier = Tier::parse(&input.tier)?;
    let label = require_text(&input.label, "Label", 120)?;
    let note = optional_text(input.note.clone(), "Note", MAX_NOTE_LEN)?;
    let provider = optional_text(input.provider.clone(), "Provider", MAX_PROVIDER_LEN)?;
    let tags = clean_tags(input.tags.clone())?;
    let expires_at = optional_text(input.expires_at.clone(), "Expiry date", MAX_DATE_LEN)?;
    if input.value.is_empty() {
        return Err(AppError::Invalid("The key value cannot be empty.".into()));
    }
    if input.value.chars().count() > MAX_SECRET_LEN {
        return Err(AppError::Invalid(
            "The key value must be 4096 characters or fewer."
                .to_string(),
        ));
    }
    let header = current_header(&state)?;
    let stamp = now();
    let id = Uuid::new_v4().to_string();

    let view = state.session.write(|vault| {
        let data = tier_data(vault, tier)?;
        if let Some(folder_id) = input.folder_id.as_deref() {
            if data.find_folder(folder_id).is_none() {
                return Err(AppError::Invalid("That folder no longer exists.".into()));
            }
        }
        let value = encrypt_entry(vault, &header, tier, &id, &input.value)?;
        let key = ApiKey {
            id: id.clone(),
            label,
            value,
            hint: crate::vault::model::mask_hint(&input.value),
            note,
            provider,
            tags,
            expires_at,
            created_at: stamp.clone(),
            updated_at: stamp,
            last_copied_at: None,
        };
        let data = tier_data_mut(vault, tier)?;
        if data.key_count() >= MAX_KEYS_PER_TIER {
            return Err(AppError::Invalid(
                "This tier already holds the maximum number of keys.".into(),
            ));
        }
        data.insert_key(key, input.folder_id.as_deref())?;
        if tier == Tier::Critical {
            vault.touch_critical();
        }
        let folder = input
            .folder_id
            .as_deref()
            .and_then(|folder_id| tier_data(vault, tier).ok()?.find_folder(folder_id));
        let key = folder
            .and_then(|folder| folder.keys.iter().find(|key| key.id == id))
            .or_else(|| {
                tier_data(vault, tier)
                    .ok()?
                    .keys
                    .iter()
                    .find(|key| key.id == id)
            })
            .ok_or(AppError::Crypto)?;
        Ok(KeyView::new(key, input.folder_id.as_deref()))
    })?;
    persist(&state)?;
    Ok(view)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyPatch {
    pub id: String,
    pub label: String,
    /// When present and non-empty the secret is re-encrypted with fresh
    /// key material; when absent the previous ciphertext is kept.
    pub value: Option<String>,
    pub note: Option<String>,
    pub provider: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub expires_at: Option<String>,
}

#[tauri::command]
pub fn update_key(state: State<'_, AppState>, input: KeyPatch) -> Result<KeyView> {
    require_id(&input.id)?;
    let label = require_text(&input.label, "Label", 120)?;
    let note = optional_text(input.note.clone(), "Note", MAX_NOTE_LEN)?;
    let provider = optional_text(input.provider.clone(), "Provider", MAX_PROVIDER_LEN)?;
    let tags = clean_tags(input.tags.clone())?;
    let expires_at = optional_text(input.expires_at.clone(), "Expiry date", MAX_DATE_LEN)?;
    let header = current_header(&state)?;
    let view = state.session.write(|vault| {
        let (tier, _) = find_key(vault, &input.id)?;
        let replacement = match input.value.as_deref() {
            Some(value) if !value.is_empty() => {
                if value.chars().count() > MAX_SECRET_LEN {
                    return Err(AppError::Invalid(
                        "The key value must be 4096 characters or fewer."
                            .to_string(),
                    ));
                }
                Some(encrypt_entry(vault, &header, tier, &input.id, value)?)
            }
            _ => None,
        };
        let folder_id = {
            let (folder, _) = tier_data(vault, tier)?
                .locate(&input.id)
                .ok_or(AppError::NotFound)?;
            folder.map(|folder| folder.id.clone())
        };
        let data = tier_data_mut(vault, tier)?;
        let key = data.key_mut(&input.id).ok_or(AppError::NotFound)?;
        key.label = label;
        if let Some(value) = replacement {
            key.value = value;
            if let Some(plain) = input.value.as_deref() {
                key.hint = crate::vault::model::mask_hint(plain);
            }
        }
        key.note = note;
        key.provider = provider;
        key.tags = tags;
        key.expires_at = expires_at;
        key.updated_at = now();
        let view = KeyView::new(key, folder_id.as_deref());
        if tier == Tier::Critical {
            vault.touch_critical();
        }
        Ok(view)
    })?;
    persist(&state)?;
    Ok(view)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveKeyInput {
    pub id: String,
    pub target_tier: String,
    pub target_folder_id: Option<String>,
}

#[tauri::command]
pub fn move_key(state: State<'_, AppState>, input: MoveKeyInput) -> Result<WorkspaceView> {
    require_id(&input.id)?;
    let target = Tier::parse(&input.target_tier)?;
    let header = current_header(&state)?;
    let view = state.session.write(|vault| {
        let (source, _) = find_key(vault, &input.id)?;
        let plaintext = {
            let (_, key) = find_key(vault, &input.id)?;
            decrypt_entry(vault, &header, source, key)?
        };
        {
            let target_data = tier_data(vault, target)?;
            if target_data.key_count() >= MAX_KEYS_PER_TIER {
                return Err(AppError::Invalid(
                    "The target tier already holds the maximum number of keys.".into(),
                ));
            }
            if let Some(folder_id) = input.target_folder_id.as_deref() {
                if target_data.find_folder(folder_id).is_none() {
                    return Err(AppError::Invalid("That folder no longer exists.".into()));
                }
            }
        }
        let mut key = tier_data_mut(vault, source)?
            .remove_key(&input.id)
            .ok_or(AppError::NotFound)?;
        key.value = encrypt_entry(vault, &header, target, &input.id, &plaintext)?;
        key.hint = crate::vault::model::mask_hint(&plaintext);
        key.updated_at = now();
        if target == Tier::Critical {
            vault.touch_critical();
        }
        tier_data_mut(vault, target)?.insert_key(key, input.target_folder_id.as_deref())?;
        Ok(workspace_of(vault))
    })?;
    persist(&state)?;
    Ok(view)
}

#[tauri::command]
pub fn delete_key(state: State<'_, AppState>, entry_id: String) -> Result<WorkspaceView> {
    require_id(&entry_id)?;
    let view = state.session.write(|vault| {
        let (tier, _) = find_key(vault, &entry_id)?;
        tier_data_mut(vault, tier)?
            .remove_key(&entry_id)
            .ok_or(AppError::NotFound)?;
        if tier == Tier::Critical {
            vault.touch_critical();
        }
        Ok(workspace_of(vault))
    })?;
    persist(&state)?;
    Ok(view)
}

#[tauri::command]
pub fn reorder_folders(
    state: State<'_, AppState>,
    tier: String,
    folder_ids: Vec<String>,
) -> Result<TierView> {
    let tier = Tier::parse(&tier)?;
    let view = state.session.write(|vault| {
        let data = tier_data_mut(vault, tier)?;
        if folder_ids.len() != data.folders.len() {
            return Err(AppError::Invalid("Folder order is incomplete.".into()));
        }
        let mut reordered = Vec::with_capacity(data.folders.len());
        for id in &folder_ids {
            let index = data
                .folders
                .iter()
                .position(|folder| &folder.id == id)
                .ok_or_else(|| AppError::Invalid("Folder order is invalid.".into()))?;
            reordered.push(data.folders.remove(index));
        }
        data.folders = reordered;
        Ok(TierView::new(data))
    })?;
    persist(&state)?;
    Ok(view)
}

#[tauri::command]
pub fn search(state: State<'_, AppState>, query: String) -> Result<Vec<SearchHit>> {
    if query.chars().count() > MAX_SEARCH_LEN {
        return Err(AppError::Invalid("That search text is too long.".into()));
    }
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    state.session.read(|vault| {
        let mut hits = Vec::new();
        let tiers = [
            (Tier::Standard, Some(&vault.standard)),
            (Tier::Critical, vault.critical.as_ref()),
        ];
        for (tier, data) in tiers {
            let Some(data) = data else { continue };
            let mut push = |key: &ApiKey, folder: Option<&Folder>| {
                let haystacks = [
                    key.label.to_lowercase(),
                    key.provider.as_deref().unwrap_or_default().to_lowercase(),
                    key.tags.join(" ").to_lowercase(),
                    folder
                        .map(|folder| folder.name.to_lowercase())
                        .unwrap_or_default(),
                ];
                if haystacks.iter().any(|value| value.contains(&needle)) {
                    hits.push(SearchHit {
                        id: key.id.clone(),
                        tier,
                        label: key.label.clone(),
                        provider: key.provider.clone(),
                        folder_id: folder.map(|folder| folder.id.clone()),
                        folder_name: folder.map(|folder| folder.name.clone()),
                    });
                }
            };
            for key in &data.keys {
                push(key, None);
            }
            for folder in &data.folders {
                for key in &folder.keys {
                    push(key, Some(folder));
                }
            }
        }
        hits.truncate(50);
        Ok(hits)
    })
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<Settings> {
    state.session.read(|vault| Ok(vault.settings.clone()))
}

#[tauri::command]
pub fn set_settings<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    settings: Settings,
) -> Result<Settings> {
    let settings = settings.validate()?;
    let saved = state.session.write(|vault| {
        vault.settings = settings;
        Ok(vault.settings.clone())
    })?;
    persist(&state)?;
    apply_content_protection(&app, saved.screen_capture_protected);
    Ok(saved)
}

#[tauri::command]
pub fn change_master(
    state: State<'_, AppState>,
    current_password: String,
    new_password: String,
) -> Result<()> {
    require_password(&new_password, "The new Standard password")?;
    let header = current_header(&state)?;
    let k1_old = verify_master_limited(&state, &header, &current_password)?;

    state.session.write(|vault| {
        if vault.recovery_mode {
            return Err(AppError::Invalid(
                "Unlock with your passwords before changing them.".into(),
            ));
        }
        if !keys_equal(&k1_old[..], &vault.k1[..]) {
            return Err(AppError::InvalidPassword);
        }
        let ck = vault.ck.as_ref().ok_or_else(|| {
            AppError::Invalid("Unlock the Critical tier to change the Standard password.".into())
        })?;
        let k2 = vault.k2.as_ref().ok_or(AppError::CriticalLocked)?;

        // The two passwords must differ: deriving the new password with the
        // Critical salt proves whether it equals the Critical password.
        let candidate = derive_key(&new_password, &header.salt2, &header.kdf)?;
        if keys_equal(&candidate[..], &k2[..]) {
            return Err(AppError::Invalid(
                "The Standard and Critical passwords must be different.".into(),
            ));
        }

        let salt1 = crate::crypto::aead::random_bytes(hierarchy::SALT_LEN);
        let k1_new = derive_key(&new_password, &salt1, &header.kdf)?;
        let wrapped_vk = wrap_vk(
            &k1_new[..],
            &vault.vk[..],
            &header.hkdf_salt,
            &vault.vault_id,
        )?;
        let wrapped_ck = wrap_ck(
            &k1_new[..],
            &k2[..],
            &ck[..],
            &header.hkdf_salt,
            &vault.vault_id,
        )?;

        let mut next = header.clone();
        next.salt1 = salt1;
        next.wrapped_vk = wrapped_vk;
        next.wrapped_ck = wrapped_ck;
        store_header(&state, next);
        vault.k1 = k1_new;
        Ok(())
    })?;
    persist(&state)
}

#[tauri::command]
pub fn change_critical(
    state: State<'_, AppState>,
    current_password: String,
    new_password: String,
) -> Result<()> {
    require_password(&new_password, "The new Critical password")?;
    let header = current_header(&state)?;
    let attempt = state.session.begin_attempt();
    state.session.check_rate_limit()?;

    let result = state.session.write(|vault| {
        if vault.recovery_mode {
            return Err(AppError::Invalid(
                "Unlock with your passwords before changing them.".into(),
            ));
        }
        let ck = vault.ck.as_ref().ok_or(AppError::CriticalLocked)?;
        let k2_old = verify_critical(&header, &vault.k1[..], &current_password)?;
        let k2 = vault.k2.as_ref().ok_or(AppError::CriticalLocked)?;
        if !keys_equal(&k2_old[..], &k2[..]) {
            return Err(AppError::InvalidCriticalPassword);
        }
        let candidate = derive_key(&new_password, &header.salt1, &header.kdf)?;
        if keys_equal(&candidate[..], &vault.k1[..]) {
            return Err(AppError::Invalid(
                "The Standard and Critical passwords must be different.".into(),
            ));
        }

        let salt2 = crate::crypto::aead::random_bytes(hierarchy::SALT_LEN);
        let k2_new = derive_key(&new_password, &salt2, &header.kdf)?;
        let wrapped_ck = wrap_ck(
            &vault.k1[..],
            &k2_new[..],
            &ck[..],
            &header.hkdf_salt,
            &vault.vault_id,
        )?;
        let mut next = header.clone();
        next.salt2 = salt2;
        next.wrapped_ck = wrapped_ck;
        store_header(&state, next);
        vault.k2 = Some(k2_new);
        Ok(())
    });

    if let Err(error) = &result {
        if matches!(error, AppError::InvalidCriticalPassword) {
            let wait = attempt.fail();
            if wait > 0 {
                return Err(AppError::RateLimited(wait));
            }
        }
    }
    result?;
    persist(&state)
}

#[tauri::command]
pub fn regenerate_recovery(
    state: State<'_, AppState>,
    master_password: String,
    critical_password: String,
) -> Result<String> {
    let header = current_header(&state)?;
    let k1 = verify_master_limited(&state, &header, &master_password)?;
    verify_critical_limited(&state, &header, &k1[..], &critical_password)?;
    let (vk, ck) = state.session.read(|vault| {
        if vault.recovery_mode {
            return Err(AppError::Invalid(
                "Unlock with your passwords before regenerating the recovery key.".into(),
            ));
        }
        Ok((
            Zeroizing::new(*vault.vk),
            Zeroizing::new(**vault.ck.as_ref().ok_or(AppError::CriticalLocked)?),
        ))
    })?;

    let recovery_key = recovery::generate();
    let rk = recovery::decode(recovery_key.as_str())?;
    let mut next = header;
    next.recovery_vk = wrap_recovery_vk(&rk[..], &vk[..], &next.hkdf_salt, &next.vault_id)?;
    next.recovery_ck = wrap_recovery_ck(&rk[..], &ck[..], &next.hkdf_salt, &next.vault_id)?;
    store_header(&state, next);
    persist(&state)?;
    Ok(recovery_key.to_string())
}

#[tauri::command]
pub fn argon2_info(state: State<'_, AppState>) -> Result<KdfParams> {
    Ok(current_header(&state)?.kdf)
}

#[tauri::command]
pub fn retune_argon2(
    state: State<'_, AppState>,
    master_password: String,
    critical_password: String,
) -> Result<KdfParams> {
    let header = current_header(&state)?;
    let k1 = verify_master_limited(&state, &header, &master_password)?;
    verify_critical_limited(&state, &header, &k1[..], &critical_password)?;
    let params = tune()?;

    // Changing Argon2 parameters changes K1 and K2, so the wrapped keys must
    // be rebuilt with keys derived under the new parameters.
    let k1_new = derive_key(&master_password, &header.salt1, &params)?;
    let k2_new = derive_key(&critical_password, &header.salt2, &params)?;

    state.session.write(|vault| {
        if vault.recovery_mode {
            return Err(AppError::Invalid(
                "Unlock with your passwords before re-tuning Argon2id.".into(),
            ));
        }
        let ck = vault.ck.as_ref().ok_or(AppError::CriticalLocked)?;
        let mut next = header.clone();
        next.kdf = params;
        next.wrapped_vk = wrap_vk(&k1_new[..], &vault.vk[..], &next.hkdf_salt, &next.vault_id)?;
        next.wrapped_ck = wrap_ck(
            &k1_new[..],
            &k2_new[..],
            &ck[..],
            &next.hkdf_salt,
            &next.vault_id,
        )?;
        store_header(&state, next);
        vault.k1 = k1_new;
        vault.k2 = Some(k2_new);
        Ok(())
    })?;
    persist(&state)?;
    Ok(params)
}

#[tauri::command]
pub fn export_backup(state: State<'_, AppState>, path: String) -> Result<()> {
    let target = PathBuf::from(path);
    if target == state.vault_path {
        return Err(AppError::Invalid(
            "Choose a different location for the backup.".into(),
        ));
    }
    if !state.vault_path.exists() {
        return Err(AppError::NotFound);
    }
    if target.exists() {
        return Err(AppError::Invalid(
            "A file already exists at that location.".into(),
        ));
    }
    std::fs::copy(&state.vault_path, &target).map_err(|_| AppError::Io)?;
    Ok(())
}

#[tauri::command]
pub fn import_backup(state: State<'_, AppState>, path: String) -> Result<()> {
    let file = storage::load(&PathBuf::from(path))?;
    storage::validate_header(&file.header)?;
    storage::save(&state.vault_path, &file)?;
    state.session.lock();
    store_header(&state, file.header);
    Ok(())
}

#[tauri::command]
pub fn delete_vault<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    master_password: String,
    critical_password: String,
) -> Result<()> {
    let header = current_header(&state)?;
    let k1 = verify_master_limited(&state, &header, &master_password)?;
    let _k2 = verify_critical_limited(&state, &header, &k1[..], &critical_password)?;
    state.session.lock();
    state.clear_owned_clipboard(&app, None);
    storage::delete(&state.vault_path)?;
    *lock_or_recover(&state.header) = None;
    Ok(())
}

/// Factory-reset used when the user forgot both passwords. No authentication is
/// required: the vault is already locked and its contents are unrecoverable
/// without the passwords anyway. Deletes the vault file and its backup.
#[tauri::command]
pub fn reset_vault(state: State<'_, AppState>) -> Result<()> {
    storage::delete(&state.vault_path)?;
    *lock_or_recover(&state.header) = None;
    Ok(())
}

#[tauri::command]
pub fn save_recovery_key(path: String, key: String) -> Result<()> {
    let key = SecretString::from(key);
    let target = PathBuf::from(path);
    if target.as_os_str().is_empty() {
        return Err(AppError::Invalid(
            "Choose a file to save the recovery key to.".into(),
        ));
    }
    if target.is_dir() {
        return Err(AppError::Invalid(
            "Choose a file, not a folder.".into(),
        ));
    }
    if target.exists() {
        return Err(AppError::Invalid(
            "A file already exists at that location.".into(),
        ));
    }
    // Only a genuine recovery key may be written here, so this command cannot
    // be turned into a general-purpose file writer by a compromised webview.
    recovery::decode(key.expose_secret())?;
    let contents = Zeroizing::new(format!(
        "Keyfold recovery key\n\n{}\n\nKeep this file somewhere safe and offline.\nIf you lose your both master passwords and this recovery key, your data cannot be recovered.\n",
        key.expose_secret()
    ));
    std::fs::write(&target, contents.as_bytes()).map_err(|_| AppError::Io)?;
    // This file is plaintext, so it gets the same user-only restriction as the
    // vault.
    storage::harden_permissions(&target);
    Ok(())
}

/// Copy a recovery key through the backend so the same fingerprint guard,
/// auto-clear timer and lock/minimize/exit clearing apply to it. Only
/// recovery-key shaped text is accepted, so this is not a general
/// clipboard-writer primitive.
#[tauri::command]
pub fn copy_recovery_key<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    key: String,
) -> Result<CopyResponse> {
    let key = SecretString::from(key);
    recovery::decode(key.expose_secret())?;
    let clears = state
        .session
        .read(|vault| Ok(vault.settings.clipboard_clear_seconds))
        .unwrap_or(20);
    app.clipboard()
        .write_text(key.expose_secret().to_string())
        .map_err(|_| AppError::Clipboard)?;
    state.remember_clipboard(key.expose_secret(), Tier::Standard);

    let fingerprint = clipboard_fingerprint(key.expose_secret());
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(u64::from(clears)));
        if let Ok(current) = handle.clipboard().read_text() {
            if same_fingerprint(&clipboard_fingerprint(&current), &fingerprint) {
                let _ = handle.clipboard().write_text(String::new());
            }
        }
    });
    Ok(CopyResponse {
        clears_in_seconds: clears,
    })
}

#[tauri::command]
pub fn open_vault_location<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<()> {
    app.opener()
        .reveal_item_in_dir(&state.vault_path)
        .map_err(|_| AppError::Io)
}

/// Emit a lock event to the frontend. Called from the background ticker.
pub fn emit_lock_event<R: Runtime>(app: &AppHandle<R>, event: crate::vault::session::LockEvent) {
    match event {
        crate::vault::session::LockEvent::Locked => {
            let _ = app.emit("keyfold:locked", ());
        }
        crate::vault::session::LockEvent::CriticalLocked => {
            let _ = app.emit("keyfold:critical-locked", ());
        }
    }
}

/// The ticker expands the idle timers once a second and detects a machine
/// that just woke from sleep, which must lock the vault immediately.
pub fn start_auto_lock_ticker(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last_tick = std::time::SystemTime::now();
        loop {
            std::thread::sleep(Duration::from_secs(1));
            let slept = crate::sleep_gap_exceeded(last_tick);
            last_tick = std::time::SystemTime::now();
            let Some(state) = app.try_state::<AppState>() else {
                continue;
            };
            if slept {
                if state.session.is_unlocked() {
                    state.session.lock();
                    state.clear_owned_clipboard(&app, None);
                    emit_lock_event(&app, crate::vault::session::LockEvent::Locked);
                }
                continue;
            }
            if let Some(event) = state.session.expire() {
                match event {
                    crate::vault::session::LockEvent::Locked => {
                        state.clear_owned_clipboard(&app, None)
                    }
                    crate::vault::session::LockEvent::CriticalLocked => {
                        state.clear_owned_clipboard(&app, Some(Tier::Critical))
                    }
                }
                emit_lock_event(&app, event);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifiers_outside_the_canonical_charset_are_refused() {
        assert!(require_id("11111111-1111-4111-8111-111111111111").is_ok());
        assert!(require_id("entry_2").is_ok());
        assert!(require_id("").is_err());
        assert!(require_id("entry\u{0}standard").is_err());
        assert!(require_id("entry id").is_err());
        assert!(require_id("entry\\standard").is_err());
        assert!(require_id(&"a".repeat(65)).is_err());
    }

    #[test]
    fn metadata_is_bounded_and_trimmed() {
        assert!(optional_text(Some("   ".into()), "Note", 10)
            .unwrap()
            .is_none());
        assert!(optional_text(None, "Note", 10).unwrap().is_none());
        assert_eq!(
            optional_text(Some(" hello ".into()), "Note", 10)
                .unwrap()
                .as_deref(),
            Some("hello")
        );
        assert!(optional_text(Some("x".repeat(11)), "Note", 10).is_err());

        assert_eq!(
            clean_tags(vec![" api ".into(), "".into(), "prod".into()]).unwrap(),
            vec!["api".to_string(), "prod".to_string()]
        );
        assert!(clean_tags(vec!["api".into(); MAX_TAGS + 1]).is_err());
        assert!(clean_tags(vec!["x".repeat(MAX_TAG_LEN + 1)]).is_err());
    }

    #[test]
    fn recovery_key_file_cannot_become_a_general_purpose_write() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("recovery.txt");
        let path = target.to_string_lossy().to_string();

        assert!(save_recovery_key(path.clone(), "not a recovery key".into()).is_err());
        assert!(!target.exists());

        let key = recovery::generate();
        save_recovery_key(path.clone(), key.as_str().to_string()).unwrap();
        let written = std::fs::read_to_string(&target).unwrap();
        assert!(written.contains(key.as_str()));

        // An existing file is never overwritten.
        assert!(save_recovery_key(path, key.as_str().to_string()).is_err());
    }
}
