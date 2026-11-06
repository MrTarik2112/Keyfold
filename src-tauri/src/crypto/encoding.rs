use base64::{engine::general_purpose::STANDARD, Engine};

use crate::error::{AppError, Result};
use crate::vault::model::Tier;

pub fn b64(bytes: &[u8]) -> String {
    STANDARD.encode(bytes)
}

pub fn b64_decode(value: &str) -> Result<Vec<u8>> {
    STANDARD.decode(value).map_err(|_| AppError::MalformedVault)
}

/// Associated data binds a ciphertext to one vault, one entry, one tier and
/// one format version, so ciphertexts cannot be swapped between entries.
pub fn entry_aad(vault_id: &str, entry_id: &str, tier: Tier, format_version: u16) -> Vec<u8> {
    let mut aad = Vec::with_capacity(vault_id.len() + entry_id.len() + 32);
    aad.extend_from_slice(b"keyfold/aad/v1");
    aad.push(0);
    aad.extend_from_slice(vault_id.as_bytes());
    aad.push(0);
    aad.extend_from_slice(entry_id.as_bytes());
    aad.push(0);
    aad.extend_from_slice(tier.as_str().as_bytes());
    aad.push(0);
    aad.extend_from_slice(&format_version.to_le_bytes());
    aad
}

pub fn wrap_aad(vault_id: &str, label: &str) -> Vec<u8> {
    format!("keyfold/wrap/v1\u{0}{vault_id}\u{0}{label}").into_bytes()
}

pub fn metadata_aad(vault_id: &str, tier: Tier, format_version: u16) -> Vec<u8> {
    format!(
        "keyfold/metadata/v1\u{0}{vault_id}\u{0}{}\u{0}{format_version}",
        tier.as_str()
    )
    .into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_round_trip() {
        let bytes = [0u8, 1, 2, 250, 255];
        assert_eq!(b64_decode(&b64(&bytes)).unwrap(), bytes);
        assert!(b64_decode("not base64!!").is_err());
    }

    #[test]
    fn aad_binds_every_field() {
        let base = entry_aad("vault", "entry", Tier::Standard, 1);
        assert_ne!(base, entry_aad("vault2", "entry", Tier::Standard, 1));
        assert_ne!(base, entry_aad("vault", "entry2", Tier::Standard, 1));
        assert_ne!(base, entry_aad("vault", "entry", Tier::Critical, 1));
        assert_ne!(base, entry_aad("vault", "entry", Tier::Standard, 2));
    }
}
