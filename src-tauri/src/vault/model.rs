use chrono::Utc;
use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

use crate::crypto::layers::{CriticalEnvelope, StandardEnvelope};
use crate::error::{AppError, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    Standard,
    Critical,
}

impl Tier {
    pub fn as_str(self) -> &'static str {
        match self {
            Tier::Standard => "standard",
            Tier::Critical => "critical",
        }
    }

    pub fn parse(value: &str) -> Result<Self> {
        match value {
            "standard" => Ok(Tier::Standard),
            "critical" => Ok(Tier::Critical),
            _ => Err(AppError::Invalid("Unknown tier.".into())),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "scheme", rename_all = "camelCase")]
pub enum EncryptedValue {
    Standard(StandardEnvelope),
    Critical(CriticalEnvelope),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKey {
    pub id: String,
    pub label: String,
    pub value: EncryptedValue,
    /// First three and last four characters of the secret, shown while the
    /// value is masked. Stored only inside the encrypted tier blob.
    #[serde(default)]
    pub hint: String,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub expires_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub last_copied_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub color: String,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub keys: Vec<ApiKey>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TierData {
    #[serde(default)]
    pub folders: Vec<Folder>,
    #[serde(default)]
    pub keys: Vec<ApiKey>,
}

impl TierData {
    pub fn key_count(&self) -> usize {
        self.keys.len()
            + self
                .folders
                .iter()
                .map(|folder| folder.keys.len())
                .sum::<usize>()
    }

    pub fn find_folder(&self, folder_id: &str) -> Option<&Folder> {
        self.folders.iter().find(|folder| folder.id == folder_id)
    }

    pub fn find_folder_mut(&mut self, folder_id: &str) -> Option<&mut Folder> {
        self.folders
            .iter_mut()
            .find(|folder| folder.id == folder_id)
    }

    /// Locate a key and the folder that holds it, if any.
    pub fn locate(&self, key_id: &str) -> Option<(Option<&Folder>, &ApiKey)> {
        if let Some(key) = self.keys.iter().find(|key| key.id == key_id) {
            return Some((None, key));
        }
        for folder in &self.folders {
            if let Some(key) = folder.keys.iter().find(|key| key.id == key_id) {
                return Some((Some(folder), key));
            }
        }
        None
    }

    pub fn key(&self, key_id: &str) -> Option<&ApiKey> {
        self.locate(key_id).map(|(_, key)| key)
    }

    pub fn key_mut(&mut self, key_id: &str) -> Option<&mut ApiKey> {
        if let Some(key) = self.keys.iter_mut().find(|key| key.id == key_id) {
            return Some(key);
        }
        for folder in &mut self.folders {
            if let Some(key) = folder.keys.iter_mut().find(|key| key.id == key_id) {
                return Some(key);
            }
        }
        None
    }

    pub fn remove_key(&mut self, key_id: &str) -> Option<ApiKey> {
        if let Some(index) = self.keys.iter().position(|key| key.id == key_id) {
            return Some(self.keys.remove(index));
        }
        for folder in &mut self.folders {
            if let Some(index) = folder.keys.iter().position(|key| key.id == key_id) {
                folder.updated_at = now();
                return Some(folder.keys.remove(index));
            }
        }
        None
    }

    pub fn insert_key(&mut self, key: ApiKey, folder_id: Option<&str>) -> Result<()> {
        match folder_id {
            Some(folder_id) => {
                let folder = self
                    .find_folder_mut(folder_id)
                    .ok_or_else(|| AppError::Invalid("That folder no longer exists.".into()))?;
                folder.keys.push(key);
                folder.updated_at = now();
            }
            None => self.keys.push(key),
        }
        Ok(())
    }

    pub fn remove_folder(&mut self, folder_id: &str) -> Option<Folder> {
        self.folders
            .iter()
            .position(|folder| folder.id == folder_id)
            .map(|index| self.folders.remove(index))
    }
}

impl ApiKey {
    /// Wipe the plaintext metadata in place. `value` holds ciphertext, so it is
    /// left alone; labels, notes, providers, tags and hints are the sensitive
    /// plaintext the tier carries.
    fn wipe_metadata(&mut self) {
        self.label.zeroize();
        self.hint.zeroize();
        self.note.zeroize();
        self.provider.zeroize();
        self.tags.zeroize();
        self.expires_at.zeroize();
    }
}

impl Folder {
    fn wipe_metadata(&mut self) {
        self.name.zeroize();
        self.icon.zeroize();
        self.color.zeroize();
        self.note.zeroize();
        for key in &mut self.keys {
            key.wipe_metadata();
        }
    }
}

/// A dropped tier is dropped because the vault locked or was replaced, so its
/// decrypted metadata is wiped rather than left in freed memory.
impl Drop for TierData {
    fn drop(&mut self) {
        for folder in &mut self.folders {
            folder.wipe_metadata();
        }
        for key in &mut self.keys {
            key.wipe_metadata();
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// Minutes of inactivity before the vault locks. 0 means never.
    pub auto_lock_minutes: u32,
    pub critical_auto_lock_seconds: u32,
    pub clipboard_clear_seconds: u32,
    pub lock_on_minimize: bool,
    pub reduce_motion: bool,
    pub compact_mode: bool,
    /// Ask the OS to exclude the window from screen capture where supported.
    #[serde(default = "default_screen_capture_protected")]
    pub screen_capture_protected: bool,
}

fn default_screen_capture_protected() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            auto_lock_minutes: 5,
            critical_auto_lock_seconds: 60,
            clipboard_clear_seconds: 20,
            lock_on_minimize: true,
            reduce_motion: false,
            compact_mode: false,
            screen_capture_protected: true,
        }
    }
}

impl Settings {
    /// Clamp every value into a safe, supported range. The frontend cannot
    /// disable auto-lock by sending a negative or absurd number.
    pub fn validate(mut self) -> Result<Self> {
        if !matches!(self.auto_lock_minutes, 0 | 1 | 5 | 15 | 30) {
            return Err(AppError::Invalid(
                "Auto-lock must be 1, 5, 15, 30 minutes or never.".into(),
            ));
        }
        if !matches!(self.critical_auto_lock_seconds, 30 | 60 | 120 | 300) {
            return Err(AppError::Invalid(
                "Critical auto-lock must be 30, 60, 120 or 300 seconds.".into(),
            ));
        }
        self.clipboard_clear_seconds = self.clipboard_clear_seconds.clamp(5, 300);
        Ok(self)
    }
}

/* ---------------------------------- views --------------------------------- */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyView {
    pub id: String,
    pub label: String,
    pub hint: String,
    pub provider: Option<String>,
    pub tags: Vec<String>,
    pub note: Option<String>,
    pub expires_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub last_copied_at: Option<String>,
    pub folder_id: Option<String>,
}

impl KeyView {
    pub fn new(key: &ApiKey, folder_id: Option<&str>) -> Self {
        Self {
            id: key.id.clone(),
            label: key.label.clone(),
            hint: key.hint.clone(),
            provider: key.provider.clone(),
            tags: key.tags.clone(),
            note: key.note.clone(),
            expires_at: key.expires_at.clone(),
            created_at: key.created_at.clone(),
            updated_at: key.updated_at.clone(),
            last_copied_at: key.last_copied_at.clone(),
            folder_id: folder_id.map(str::to_string),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderView {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub note: Option<String>,
    pub key_count: usize,
    pub created_at: String,
    pub updated_at: String,
    pub keys: Vec<KeyView>,
}

impl FolderView {
    pub fn new(folder: &Folder) -> Self {
        Self {
            id: folder.id.clone(),
            name: folder.name.clone(),
            icon: folder.icon.clone(),
            color: folder.color.clone(),
            note: folder.note.clone(),
            key_count: folder.keys.len(),
            created_at: folder.created_at.clone(),
            updated_at: folder.updated_at.clone(),
            keys: folder
                .keys
                .iter()
                .map(|key| KeyView::new(key, Some(&folder.id)))
                .collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TierView {
    pub folders: Vec<FolderView>,
    pub keys: Vec<KeyView>,
    pub key_count: usize,
}

impl TierView {
    pub fn new(data: &TierData) -> Self {
        Self {
            folders: data.folders.iter().map(FolderView::new).collect(),
            keys: data
                .keys
                .iter()
                .map(|key| KeyView::new(key, None))
                .collect(),
            key_count: data.key_count(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceView {
    pub vault_id: String,
    pub created_at: String,
    pub settings: Settings,
    pub standard: TierView,
    pub critical: Option<TierView>,
    pub critical_unlocked: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub id: String,
    pub tier: Tier,
    pub label: String,
    pub provider: Option<String>,
    pub folder_id: Option<String>,
    pub folder_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStatus {
    pub standard_unlocked: bool,
    pub critical_unlocked: bool,
    pub standard_lock_in_seconds: Option<u64>,
    pub critical_lock_in_seconds: Option<u64>,
}

pub fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// The masked preview shown in the UI: first three and last four characters,
/// or fully masked when the secret is too short for that to be useful.
pub fn mask_hint(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() < 12 {
        return "••••••••••••".to_string();
    }
    let prefix: String = chars[..3].iter().collect();
    let suffix: String = chars[chars.len() - 4..].iter().collect();
    format!("{prefix}••••••••{suffix}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_key(id: &str) -> ApiKey {
        ApiKey {
            id: id.into(),
            label: "Production".into(),
            hint: "sk-••••••••3f9a".into(),
            value: EncryptedValue::Standard(StandardEnvelope {
                version: 1,
                key_nonce: vec![],
                wrapped_key: vec![],
                nonce: vec![],
                ciphertext: vec![],
            }),
            note: None,
            provider: None,
            tags: vec![],
            expires_at: None,
            created_at: now(),
            updated_at: now(),
            last_copied_at: None,
        }
    }

    #[test]
    fn locate_and_remove_across_folder_and_root() {
        let mut data = TierData::default();
        data.keys.push(sample_key("root"));
        let folder = Folder {
            id: "folder".into(),
            name: "OpenAI".into(),
            icon: "letter".into(),
            color: "indigo".into(),
            note: None,
            keys: vec![sample_key("nested")],
            created_at: now(),
            updated_at: now(),
        };
        data.folders.push(folder);

        assert!(data.locate("root").is_some_and(|(f, _)| f.is_none()));
        assert!(data
            .locate("nested")
            .is_some_and(|(f, _)| f.is_some_and(|folder| folder.id == "folder")));
        assert_eq!(data.key_count(), 2);

        let removed = data.remove_key("nested").unwrap();
        assert_eq!(removed.id, "nested");
        assert_eq!(data.key_count(), 1);
        assert!(data.locate("nested").is_none());
    }

    #[test]
    fn metadata_is_wiped_in_place() {
        let mut key = sample_key("root");
        key.label = "Production Stripe key".into();
        key.hint = "sk-••••••••3f9a".into();
        key.note = Some("rotates every quarter".into());
        key.provider = Some("Stripe".into());
        key.tags = vec!["billing".into(), "prod".into()];
        key.expires_at = Some("2027-01-01".into());

        key.wipe_metadata();

        assert!(key.label.is_empty());
        assert!(key.hint.is_empty());
        assert!(key.note.as_deref().unwrap_or_default().is_empty());
        assert!(key.provider.as_deref().unwrap_or_default().is_empty());
        assert!(key.tags.is_empty());
        assert!(key.expires_at.as_deref().unwrap_or_default().is_empty());
    }

    #[test]
    fn masking_never_reveals_short_secrets() {
        assert_eq!(mask_hint("short"), "••••••••••••");
        assert_eq!(mask_hint("sk-abcdefghijklmnop3f9a"), "sk-••••••••3f9a");
    }

    #[test]
    fn settings_reject_weak_auto_lock_values() {
        let mut settings = Settings {
            auto_lock_minutes: 2,
            ..Default::default()
        };
        assert!(settings.clone().validate().is_err());
        settings.auto_lock_minutes = 0;
        assert!(settings.validate().is_ok());
    }

    #[test]
    fn older_vaults_default_to_screen_capture_protection() {
        let json = r#"{
            "autoLockMinutes": 5,
            "criticalAutoLockSeconds": 60,
            "clipboardClearSeconds": 20,
            "lockOnMinimize": true,
            "reduceMotion": false,
            "compactMode": false
        }"#;
        let settings: Settings = serde_json::from_str(json).expect("legacy settings");
        assert!(settings.screen_capture_protected);
    }
}
