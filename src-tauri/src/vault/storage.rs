use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use crate::crypto::aead::{AeadBlob, TAG_LEN, XCHACHA_NONCE_LEN};
use crate::crypto::hierarchy::{Header, HKDF_SALT_LEN, SALT_LEN};
use crate::error::{AppError, Result};
use crate::vault::FORMAT_VERSION;

pub const MAGIC: &[u8; 4] = b"KFLD";
pub const HEADER_MAX_BYTES: u32 = 64 * 1024;
pub const BLOB_MAX_BYTES: u32 = 256 * 1024 * 1024;
/// Hard ceiling on the file we are willing to read into memory. `import_backup`
/// and `save` receive paths from the webview, so an unbounded read would be a
/// one-line memory-exhaustion primitive.
pub const VAULT_MAX_BYTES: u64 = 2 * BLOB_MAX_BYTES as u64 + HEADER_MAX_BYTES as u64;

#[derive(Debug, Clone)]
pub struct VaultFile {
    pub header: Header,
    pub standard_blob: AeadBlob,
    pub critical_blob: AeadBlob,
}

/// Best-effort restriction of a file this app just wrote so that only the
/// current user can read it. The vault is ciphertext, but the backup doubles
/// the copies an attacker may find and a saved recovery-key file is plaintext.
///
/// Returns whether the restriction was applied. A filesystem without ACL
/// support (FAT32, some network shares) simply reports `false` and the write
/// still stands, because losing the file would be worse than loose permissions.
pub fn harden_permissions(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).is_ok()
    }
    #[cfg(windows)]
    {
        windows_restrict_to_current_user(path)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = path;
        false
    }
}

/// Drop inherited ACEs and leave a single full-control entry for this user.
/// `icacls.exe` is invoked by absolute path so a poisoned `PATH` cannot
/// substitute another program.
#[cfg(windows)]
fn windows_restrict_to_current_user(path: &Path) -> bool {
    use std::process::{Command, Stdio};

    let Ok(user) = std::env::var("USERNAME") else {
        return false;
    };
    if user.is_empty() {
        return false;
    }
    let principal = match std::env::var("USERDOMAIN") {
        Ok(domain) if !domain.is_empty() => format!("{domain}\\{user}"),
        _ => user,
    };

    let program = std::env::var_os("SystemRoot")
        .map(|root| Path::new(&root).join("System32").join("icacls.exe"))
        .filter(|candidate| candidate.is_file())
        .map(PathBuf::into_os_string)
        .unwrap_or_else(|| "icacls".into());

    Command::new(program)
        .arg(path)
        .arg("/inheritance:r")
        .arg("/grant:r")
        .arg(format!("{principal}:(F)"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

pub fn backup_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(".bak");
    PathBuf::from(name)
}

impl VaultFile {
    pub fn encode(&self) -> Result<Vec<u8>> {
        let header_json = serde_json::to_vec(&self.header).map_err(|_| AppError::MalformedVault)?;
        if header_json.len() as u32 > HEADER_MAX_BYTES {
            return Err(AppError::MalformedVault);
        }
        let mut out = Vec::with_capacity(header_json.len() + 512);
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&FORMAT_VERSION.to_le_bytes());
        out.extend_from_slice(&(header_json.len() as u32).to_le_bytes());
        out.extend_from_slice(&header_json);
        write_blob(&mut out, &self.standard_blob)?;
        write_blob(&mut out, &self.critical_blob)?;
        Ok(out)
    }

    pub fn decode(bytes: &[u8]) -> Result<Self> {
        let mut cursor = Cursor::new(bytes);
        let magic = cursor.take(4)?;
        if magic != MAGIC {
            return Err(AppError::MalformedVault);
        }
        let version = u16::from_le_bytes(cursor.take(2)?.try_into().unwrap());
        if version != FORMAT_VERSION {
            return Err(AppError::UnsupportedVersion);
        }
        let header_len = u32::from_le_bytes(cursor.take(4)?.try_into().unwrap());
        if header_len == 0 || header_len > HEADER_MAX_BYTES {
            return Err(AppError::MalformedVault);
        }
        let header_bytes = cursor.take(header_len as usize)?;
        let header: Header =
            serde_json::from_slice(header_bytes).map_err(|_| AppError::MalformedVault)?;
        if header.format_version != FORMAT_VERSION {
            return Err(AppError::UnsupportedVersion);
        }
        validate_header(&header)?;
        let standard_blob = read_blob(&mut cursor)?;
        let critical_blob = read_blob(&mut cursor)?;
        if !cursor.is_empty() {
            return Err(AppError::MalformedVault);
        }
        Ok(Self {
            header,
            standard_blob,
            critical_blob,
        })
    }
}

fn write_blob(out: &mut Vec<u8>, blob: &AeadBlob) -> Result<()> {
    if blob.nonce.len() > 255 || blob.ciphertext.len() as u32 > BLOB_MAX_BYTES {
        return Err(AppError::MalformedVault);
    }
    out.push(blob.nonce.len() as u8);
    out.extend_from_slice(&blob.nonce);
    out.extend_from_slice(&(blob.ciphertext.len() as u32).to_le_bytes());
    out.extend_from_slice(&blob.ciphertext);
    Ok(())
}

fn read_blob(cursor: &mut Cursor<'_>) -> Result<AeadBlob> {
    let nonce_len = cursor.take(1)?[0] as usize;
    if nonce_len != XCHACHA_NONCE_LEN {
        return Err(AppError::MalformedVault);
    }
    let nonce = cursor.take(nonce_len)?.to_vec();
    let len = u32::from_le_bytes(cursor.take(4)?.try_into().unwrap());
    if len < TAG_LEN as u32 || len > BLOB_MAX_BYTES {
        return Err(AppError::MalformedVault);
    }
    let ciphertext = cursor.take(len as usize)?.to_vec();
    Ok(AeadBlob { nonce, ciphertext })
}

struct Cursor<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Cursor<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn take(&mut self, len: usize) -> Result<&'a [u8]> {
        let end = self
            .offset
            .checked_add(len)
            .ok_or(AppError::MalformedVault)?;
        if end > self.bytes.len() {
            return Err(AppError::MalformedVault);
        }
        let slice = &self.bytes[self.offset..end];
        self.offset = end;
        Ok(slice)
    }

    fn is_empty(&self) -> bool {
        self.offset == self.bytes.len()
    }
}

/// Reject malformed or hostile headers before any key derivation happens.
pub fn validate_header(header: &Header) -> Result<()> {
    if header.vault_id.len() < 8 || header.vault_id.len() > 64 {
        return Err(AppError::MalformedVault);
    }
    // The AAD builders join `vault_id` and `entry_id` with NUL bytes, so those
    // identifiers must never contain one (or any other separator). Restricting
    // them to the charset Keyfold itself generates keeps every AAD unique.
    if !header
        .vault_id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(AppError::MalformedVault);
    }
    header.kdf.validate_floor()?;
    if header.salt1.len() != SALT_LEN || header.salt2.len() != SALT_LEN {
        return Err(AppError::MalformedVault);
    }
    if header.hkdf_salt.len() != HKDF_SALT_LEN {
        return Err(AppError::MalformedVault);
    }
    for (label, blob) in [
        ("vk", &header.wrapped_vk),
        ("ck", &header.wrapped_ck),
        ("recovery-vk", &header.recovery_vk),
        ("recovery-ck", &header.recovery_ck),
    ] {
        if blob.nonce.len() != XCHACHA_NONCE_LEN || blob.ciphertext.len() != 32 + TAG_LEN {
            return Err(AppError::MalformedVault);
        }
        let _ = label;
    }
    Ok(())
}

pub fn load(path: &Path) -> Result<VaultFile> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(AppError::NotFound)
        }
        Err(_) => return Err(AppError::Io),
    };
    let metadata = file.metadata().map_err(|_| AppError::Io)?;
    if !metadata.is_file() {
        return Err(AppError::MalformedVault);
    }
    check_vault_len(metadata.len())?;
    // A vault written by an older build may still carry inherited permissions.
    // Tighten it the moment it is opened instead of waiting for the next save.
    harden_permissions(path);

    // Belt and braces: even if the file grows between `metadata` and the read,
    // the reader stops one byte past the ceiling.
    let mut bytes = Vec::new();
    file.take(VAULT_MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| AppError::Io)?;
    check_vault_len(bytes.len() as u64)?;
    VaultFile::decode(&bytes)
}

fn check_vault_len(len: u64) -> Result<()> {
    if len > VAULT_MAX_BYTES {
        return Err(AppError::MalformedVault);
    }
    Ok(())
}

/// Atomic save: write a temp file in the same directory, fsync it, keep one
/// rolling backup of the previous vault, then rename over the original.
pub fn save(path: &Path, vault: &VaultFile) -> Result<()> {
    validate_header(&vault.header)?;
    let bytes = vault.encode()?;
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Invalid("The vault path is invalid.".into()))?;
    fs::create_dir_all(parent).map_err(|_| AppError::Io)?;

    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|_| AppError::Io)?;
    // Restrict the temp file before it inherits its way into the vault path.
    harden_permissions(temp.path());
    temp.write_all(&bytes).map_err(|_| AppError::Io)?;
    temp.flush().map_err(|_| AppError::Io)?;
    temp.as_file().sync_all().map_err(|_| AppError::Io)?;

    if path.exists() {
        let backup = backup_path(path);
        // Neither path may be a symlink, hardlink target or directory: a local
        // attacker who pre-creates one could otherwise redirect this write onto
        // an unrelated file.
        let current = fs::symlink_metadata(path).map_err(|_| AppError::Io)?;
        if !current.file_type().is_file() {
            return Err(AppError::Invalid(
                "The vault path is not a regular file.".into(),
            ));
        }
        check_vault_len(current.len())?;
        if let Ok(existing) = fs::symlink_metadata(&backup) {
            if !existing.file_type().is_file() {
                return Err(AppError::Invalid(
                    "The backup path is not a regular file.".into(),
                ));
            }
        }

        let previous = fs::read(path).map_err(|_| AppError::Io)?;
        let mut snapshot = tempfile::NamedTempFile::new_in(parent).map_err(|_| AppError::Io)?;
        harden_permissions(snapshot.path());
        snapshot.write_all(&previous).map_err(|_| AppError::Io)?;
        snapshot.flush().map_err(|_| AppError::Io)?;
        snapshot.as_file().sync_all().map_err(|_| AppError::Io)?;
        snapshot.persist(&backup).map_err(|_| AppError::Io)?;
        harden_permissions(&backup);
    }

    temp.persist(path).map_err(|_| AppError::Io)?;
    harden_permissions(path);
    if let Ok(dir) = fs::File::open(parent) {
        let _ = dir.sync_all();
    }
    Ok(())
}

pub fn delete(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(AppError::Io),
    }
    let backup = backup_path(path);
    if backup.exists() {
        fs::remove_file(backup).map_err(|_| AppError::Io)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::hierarchy::create;
    use crate::crypto::kdf::KdfParams;

    fn sample_vault() -> VaultFile {
        let created = create(
            "master-password-1",
            "critical-password-2",
            KdfParams::for_tests(),
            "11111111-1111-4111-8111-111111111111",
        )
        .unwrap();
        // The header must carry production-strength parameters to pass the
        // floors; these tests never derive keys from them.
        let mut header = created.header;
        header.kdf = KdfParams::default();
        VaultFile {
            header,
            standard_blob: AeadBlob {
                nonce: vec![1u8; XCHACHA_NONCE_LEN],
                ciphertext: vec![2u8; 32],
            },
            critical_blob: AeadBlob {
                nonce: vec![3u8; XCHACHA_NONCE_LEN],
                ciphertext: vec![4u8; 32],
            },
        }
    }

    #[test]
    fn encode_decode_round_trip() {
        let vault = sample_vault();
        let bytes = vault.encode().unwrap();
        let decoded = VaultFile::decode(&bytes).unwrap();
        assert_eq!(decoded.header.vault_id, vault.header.vault_id);
        assert_eq!(decoded.standard_blob, vault.standard_blob);
        assert_eq!(decoded.critical_blob, vault.critical_blob);
    }

    #[test]
    fn wrong_magic_is_rejected() {
        let mut bytes = sample_vault().encode().unwrap();
        bytes[0] = b'X';
        assert!(matches!(
            VaultFile::decode(&bytes),
            Err(AppError::MalformedVault)
        ));
    }

    #[test]
    fn newer_version_is_rejected() {
        let mut bytes = sample_vault().encode().unwrap();
        bytes[4] = 9;
        assert!(matches!(
            VaultFile::decode(&bytes),
            Err(AppError::UnsupportedVersion)
        ));
    }

    #[test]
    fn truncated_and_padded_files_are_rejected() {
        let bytes = sample_vault().encode().unwrap();
        assert!(VaultFile::decode(&bytes[..bytes.len() - 1]).is_err());
        let mut padded = bytes.clone();
        padded.push(0);
        assert!(VaultFile::decode(&padded).is_err());
    }

    #[test]
    fn weak_kdf_parameters_in_header_are_rejected() {
        let mut vault = sample_vault();
        vault.header.kdf.memory_kib = 8 * 1024;
        assert!(VaultFile::decode(&vault.encode().unwrap()).is_err());
    }

    #[test]
    fn atomic_save_keeps_backup_and_leaves_no_temp_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("keyfold.vault");
        let first = sample_vault();
        save(&path, &first).unwrap();
        assert!(path.exists());
        assert!(!backup_path(&path).exists());

        let mut second = sample_vault();
        second.standard_blob.ciphertext = vec![9u8; 48];
        save(&path, &second).unwrap();
        assert!(backup_path(&path).exists());
        assert_eq!(load(&path).unwrap().standard_blob.ciphertext, vec![9u8; 48]);
        assert_eq!(
            load(&backup_path(&path)).unwrap().standard_blob.ciphertext,
            first.standard_blob.ciphertext
        );

        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().starts_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    fn oversized_files_are_refused_before_reading() {
        assert!(check_vault_len(0).is_ok());
        assert!(check_vault_len(VAULT_MAX_BYTES).is_ok());
        assert!(check_vault_len(VAULT_MAX_BYTES + 1).is_err());
    }

    #[test]
    fn vault_ids_with_aad_separators_are_rejected() {
        let vault = sample_vault();
        for hostile in ["1111\u{0}2222", "vault\u{0}entry", "vault id here", "vault\nid"] {
            let mut header = vault.header.clone();
            header.vault_id = hostile.to_string();
            assert!(
                validate_header(&header).is_err(),
                "hostile vault id {hostile:?} passed validation"
            );
        }
        assert!(validate_header(&vault.header).is_ok());
    }

    #[test]
    fn written_vault_files_are_restricted_to_the_current_user() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("keyfold.vault");
        save(&path, &sample_vault()).unwrap();
        assert!(
            harden_permissions(&path),
            "a normal local filesystem must accept the restriction"
        );
        save(&path, &sample_vault()).unwrap();
        assert!(
            harden_permissions(&backup_path(&path)),
            "the backup must be restricted too"
        );
    }

    #[test]
    fn a_non_regular_backup_path_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("keyfold.vault");
        save(&path, &sample_vault()).unwrap();

        // An attacker who can create the backup location can make it a directory
        // (or, with more setup, a link). Saving must refuse rather than write.
        fs::create_dir(backup_path(&path)).unwrap();
        assert!(save(&path, &sample_vault()).is_err());
        assert!(load(&path).is_ok(), "the real vault must stay readable");
    }

    #[test]
    fn missing_file_reports_not_found() {
        let dir = tempfile::tempdir().unwrap();
        assert!(matches!(
            load(&dir.path().join("nope.vault")),
            Err(AppError::NotFound)
        ));
    }

    #[test]
    fn delete_removes_vault_and_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("keyfold.vault");
        save(&path, &sample_vault()).unwrap();
        save(&path, &sample_vault()).unwrap();
        assert!(backup_path(&path).exists());
        delete(&path).unwrap();
        assert!(!path.exists());
        assert!(!backup_path(&path).exists());
    }
}
