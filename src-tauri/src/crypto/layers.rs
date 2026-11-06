use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::crypto::aead::{
    aes_decrypt, aes_encrypt, random_key, xchacha_decrypt, xchacha_encrypt, AeadBlob,
};
use crate::crypto::encoding::{entry_aad, metadata_aad};
use crate::crypto::hierarchy::hkdf_expand;
use crate::error::{AppError, Result};
use crate::vault::model::Tier;
use crate::vault::FORMAT_VERSION;

pub const ENVELOPE_VERSION: u8 = 1;

const INFO_STANDARD_ITEM_WRAP: &str = "keyfold/v1/standard/item-wrap";
const INFO_STANDARD_METADATA: &str = "keyfold/v1/standard/metadata";
const INFO_CRITICAL_LAYER2: &str = "keyfold/v1/critical/layer2";
const INFO_CRITICAL_LAYER3: &str = "keyfold/v1/critical/layer3";
const INFO_CRITICAL_ITEM_WRAP: &str = "keyfold/v1/critical/item-wrap";
const INFO_CRITICAL_METADATA: &str = "keyfold/v1/critical/metadata";

fn subkey(material: &[u8], hkdf_salt: &[u8], info: &str) -> Result<Zeroizing<[u8; 32]>> {
    let bytes = hkdf_expand(material, hkdf_salt, info, 32)?;
    let mut key = Zeroizing::new([0u8; 32]);
    key.copy_from_slice(&bytes);
    Ok(key)
}

/// Subkeys derived from the vault key (VK) for the Standard tier.
pub struct StandardKeys {
    pub item_wrap: Zeroizing<[u8; 32]>,
    pub metadata: Zeroizing<[u8; 32]>,
}

impl StandardKeys {
    pub fn derive(vk: &[u8], hkdf_salt: &[u8]) -> Result<Self> {
        Ok(Self {
            item_wrap: subkey(vk, hkdf_salt, INFO_STANDARD_ITEM_WRAP)?,
            metadata: subkey(vk, hkdf_salt, INFO_STANDARD_METADATA)?,
        })
    }
}

/// Subkeys derived from the critical key (CK) for the Critical tier.
pub struct CriticalKeys {
    pub layer2: Zeroizing<[u8; 32]>,
    pub layer3: Zeroizing<[u8; 32]>,
    pub item_wrap: Zeroizing<[u8; 32]>,
    pub metadata: Zeroizing<[u8; 32]>,
}

impl CriticalKeys {
    pub fn derive(ck: &[u8], hkdf_salt: &[u8]) -> Result<Self> {
        Ok(Self {
            layer2: subkey(ck, hkdf_salt, INFO_CRITICAL_LAYER2)?,
            layer3: subkey(ck, hkdf_salt, INFO_CRITICAL_LAYER3)?,
            item_wrap: subkey(ck, hkdf_salt, INFO_CRITICAL_ITEM_WRAP)?,
            metadata: subkey(ck, hkdf_salt, INFO_CRITICAL_METADATA)?,
        })
    }
}

/// Standard tier: fresh item key (XChaCha20-Poly1305), item key wrapped with
/// AES-256-GCM under a VK subkey.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StandardEnvelope {
    pub version: u8,
    pub key_nonce: Vec<u8>,
    pub wrapped_key: Vec<u8>,
    pub nonce: Vec<u8>,
    pub ciphertext: Vec<u8>,
}

/// Critical tier: three layers with independent CK subkeys, then the item key
/// wrapped with a fourth subkey.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CriticalEnvelope {
    pub version: u8,
    pub key_nonce: Vec<u8>,
    pub wrapped_key: Vec<u8>,
    /// Nonce for layer 1 (XChaCha20-Poly1305 over the plaintext secret).
    pub nonce: Vec<u8>,
    /// Ciphertext of layer 1, which is also the plaintext of layer 2.
    pub ciphertext: Vec<u8>,
    pub layer2_nonce: Vec<u8>,
    pub layer2: Vec<u8>,
    pub layer3_nonce: Vec<u8>,
    pub layer3: Vec<u8>,
}

pub fn encrypt_standard(
    keys: &StandardKeys,
    vault_id: &str,
    entry_id: &str,
    plaintext: &str,
) -> Result<StandardEnvelope> {
    let aad = entry_aad(vault_id, entry_id, Tier::Standard, FORMAT_VERSION);
    let item_key = random_key();
    let layer1 = xchacha_encrypt(&item_key[..], plaintext.as_bytes(), &aad)?;
    let wrapped = aes_encrypt(&keys.item_wrap[..], &item_key[..], &aad)?;
    Ok(StandardEnvelope {
        version: ENVELOPE_VERSION,
        key_nonce: wrapped.nonce,
        wrapped_key: wrapped.ciphertext,
        nonce: layer1.nonce,
        ciphertext: layer1.ciphertext,
    })
}

pub fn decrypt_standard(
    keys: &StandardKeys,
    vault_id: &str,
    entry_id: &str,
    envelope: &StandardEnvelope,
) -> Result<Zeroizing<String>> {
    if envelope.version != ENVELOPE_VERSION {
        return Err(AppError::UnsupportedVersion);
    }
    let aad = entry_aad(vault_id, entry_id, Tier::Standard, FORMAT_VERSION);
    let wrapped = AeadBlob {
        nonce: envelope.key_nonce.clone(),
        ciphertext: envelope.wrapped_key.clone(),
    };
    let item_key = aes_decrypt(&keys.item_wrap[..], &wrapped, &aad)?;
    let layer1 = AeadBlob {
        nonce: envelope.nonce.clone(),
        ciphertext: envelope.ciphertext.clone(),
    };
    let plaintext = xchacha_decrypt(&item_key[..], &layer1, &aad)?;
    String::from_utf8(plaintext.to_vec())
        .map(Zeroizing::new)
        .map_err(|_| AppError::Crypto)
}

pub fn encrypt_critical(
    keys: &CriticalKeys,
    vault_id: &str,
    entry_id: &str,
    plaintext: &str,
) -> Result<CriticalEnvelope> {
    let aad = entry_aad(vault_id, entry_id, Tier::Critical, FORMAT_VERSION);
    let item_key = random_key();
    let layer1 = xchacha_encrypt(&item_key[..], plaintext.as_bytes(), &aad)?;
    let layer2 = aes_encrypt(&keys.layer2[..], &layer1.ciphertext, &aad)?;
    let layer3 = xchacha_encrypt(&keys.layer3[..], &layer2.ciphertext, &aad)?;
    let wrapped = aes_encrypt(&keys.item_wrap[..], &item_key[..], &aad)?;
    Ok(CriticalEnvelope {
        version: ENVELOPE_VERSION,
        key_nonce: wrapped.nonce,
        wrapped_key: wrapped.ciphertext,
        nonce: layer1.nonce,
        ciphertext: layer1.ciphertext,
        layer2_nonce: layer2.nonce,
        layer2: layer2.ciphertext,
        layer3_nonce: layer3.nonce,
        layer3: layer3.ciphertext,
    })
}

pub fn decrypt_critical(
    keys: &CriticalKeys,
    vault_id: &str,
    entry_id: &str,
    envelope: &CriticalEnvelope,
) -> Result<Zeroizing<String>> {
    if envelope.version != ENVELOPE_VERSION {
        return Err(AppError::UnsupportedVersion);
    }
    let aad = entry_aad(vault_id, entry_id, Tier::Critical, FORMAT_VERSION);
    let wrapped = AeadBlob {
        nonce: envelope.key_nonce.clone(),
        ciphertext: envelope.wrapped_key.clone(),
    };
    let item_key = aes_decrypt(&keys.item_wrap[..], &wrapped, &aad)?;
    let layer3 = AeadBlob {
        nonce: envelope.layer3_nonce.clone(),
        ciphertext: envelope.layer3.clone(),
    };
    let layer2_plain = xchacha_decrypt(&keys.layer3[..], &layer3, &aad)?;
    let layer2 = AeadBlob {
        nonce: envelope.layer2_nonce.clone(),
        ciphertext: layer2_plain.to_vec(),
    };
    let layer1_plain = aes_decrypt(&keys.layer2[..], &layer2, &aad)?;
    let layer1 = AeadBlob {
        nonce: envelope.nonce.clone(),
        ciphertext: layer1_plain.to_vec(),
    };
    let plaintext = xchacha_decrypt(&item_key[..], &layer1, &aad)?;
    String::from_utf8(plaintext.to_vec())
        .map(Zeroizing::new)
        .map_err(|_| AppError::Crypto)
}

/* ------------------------------- metadata -------------------------------- */

pub fn seal_standard_metadata(
    keys: &StandardKeys,
    vault_id: &str,
    plaintext: &[u8],
) -> Result<AeadBlob> {
    let aad = metadata_aad(vault_id, Tier::Standard, FORMAT_VERSION);
    xchacha_encrypt(&keys.metadata[..], plaintext, &aad)
}

pub fn open_standard_metadata(
    keys: &StandardKeys,
    vault_id: &str,
    blob: &AeadBlob,
) -> Result<Zeroizing<Vec<u8>>> {
    let aad = metadata_aad(vault_id, Tier::Standard, FORMAT_VERSION);
    xchacha_decrypt(&keys.metadata[..], blob, &aad)
}

pub fn seal_critical_metadata(
    keys: &CriticalKeys,
    vault_id: &str,
    plaintext: &[u8],
) -> Result<AeadBlob> {
    let aad = metadata_aad(vault_id, Tier::Critical, FORMAT_VERSION);
    xchacha_encrypt(&keys.metadata[..], plaintext, &aad)
}

pub fn open_critical_metadata(
    keys: &CriticalKeys,
    vault_id: &str,
    blob: &AeadBlob,
) -> Result<Zeroizing<Vec<u8>>> {
    let aad = metadata_aad(vault_id, Tier::Critical, FORMAT_VERSION);
    xchacha_decrypt(&keys.metadata[..], blob, &aad)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::aead::random_key;

    const VAULT: &str = "11111111-1111-4111-8111-111111111111";
    const ENTRY: &str = "22222222-2222-4222-8222-222222222222";

    fn standard() -> StandardKeys {
        StandardKeys::derive(&random_key()[..], &[7u8; 32]).unwrap()
    }

    fn critical() -> CriticalKeys {
        CriticalKeys::derive(&random_key()[..], &[9u8; 32]).unwrap()
    }

    #[test]
    fn standard_round_trip() {
        let keys = standard();
        let envelope = encrypt_standard(&keys, VAULT, ENTRY, "sk-live-abc123").unwrap();
        let value = decrypt_standard(&keys, VAULT, ENTRY, &envelope).unwrap();
        assert_eq!(value.as_str(), "sk-live-abc123");
    }

    #[test]
    fn critical_round_trip() {
        let keys = critical();
        let envelope = encrypt_critical(&keys, VAULT, ENTRY, "sk-live-abc123").unwrap();
        let value = decrypt_critical(&keys, VAULT, ENTRY, &envelope).unwrap();
        assert_eq!(value.as_str(), "sk-live-abc123");
    }

    #[test]
    fn critical_envelope_has_three_layers() {
        let keys = critical();
        let envelope = encrypt_critical(&keys, VAULT, ENTRY, "secret").unwrap();
        assert_eq!(envelope.ciphertext.len(), "secret".len() + 16);
        assert_eq!(envelope.layer2.len(), envelope.ciphertext.len() + 16);
        assert_eq!(envelope.layer3.len(), envelope.layer2.len() + 16);
    }

    #[test]
    fn wrong_keys_fail() {
        let envelope = encrypt_standard(&standard(), VAULT, ENTRY, "secret").unwrap();
        assert!(decrypt_standard(&standard(), VAULT, ENTRY, &envelope).is_err());

        let envelope = encrypt_critical(&critical(), VAULT, ENTRY, "secret").unwrap();
        assert!(decrypt_critical(&critical(), VAULT, ENTRY, &envelope).is_err());
    }

    #[test]
    fn swapped_ciphertext_between_entries_fails() {
        let keys = standard();
        let a = encrypt_standard(&keys, VAULT, "entry-a", "alpha").unwrap();
        assert!(decrypt_standard(&keys, VAULT, "entry-b", &a).is_err());

        let keys = critical();
        let a = encrypt_critical(&keys, VAULT, "entry-a", "alpha").unwrap();
        assert!(decrypt_critical(&keys, VAULT, "entry-b", &a).is_err());
    }

    #[test]
    fn ciphertext_cannot_move_between_tiers() {
        let vk = random_key();
        let standard_keys = StandardKeys::derive(&vk[..], &[3u8; 32]).unwrap();
        let critical_keys = CriticalKeys::derive(&vk[..], &[3u8; 32]).unwrap();
        let envelope = encrypt_standard(&standard_keys, VAULT, ENTRY, "secret").unwrap();
        // Simulate a hostile edit that relabels a Standard envelope as Critical.
        let forged = CriticalEnvelope {
            version: 1,
            key_nonce: envelope.key_nonce,
            wrapped_key: envelope.wrapped_key,
            nonce: envelope.nonce,
            ciphertext: envelope.ciphertext,
            layer2_nonce: vec![0; 12],
            layer2: vec![0; 32],
            layer3_nonce: vec![0; 24],
            layer3: vec![0; 32],
        };
        assert!(decrypt_critical(&critical_keys, VAULT, ENTRY, &forged).is_err());
    }

    #[test]
    fn tampered_envelope_fails() {
        let keys = standard();
        let mut envelope = encrypt_standard(&keys, VAULT, ENTRY, "secret").unwrap();
        envelope.ciphertext[0] ^= 0xff;
        assert!(decrypt_standard(&keys, VAULT, ENTRY, &envelope).is_err());

        let keys = critical();
        let mut envelope = encrypt_critical(&keys, VAULT, ENTRY, "secret").unwrap();
        envelope.layer3[0] ^= 0xff;
        assert!(decrypt_critical(&keys, VAULT, ENTRY, &envelope).is_err());
    }

    #[test]
    fn metadata_round_trip_and_tier_binding() {
        let vault_key = random_key();
        let standard_keys = StandardKeys::derive(&vault_key[..], &[1u8; 32]).unwrap();
        let critical_keys = CriticalKeys::derive(&vault_key[..], &[1u8; 32]).unwrap();
        let blob = seal_standard_metadata(&standard_keys, VAULT, br#"{"folders":[]}"#).unwrap();
        assert_eq!(
            open_standard_metadata(&standard_keys, VAULT, &blob)
                .unwrap()
                .as_slice(),
            br#"{"folders":[]}"#
        );
        assert!(open_critical_metadata(&critical_keys, VAULT, &blob).is_err());
    }

    #[test]
    fn nonces_are_fresh_per_entry() {
        let keys = standard();
        let a = encrypt_standard(&keys, VAULT, ENTRY, "same").unwrap();
        let b = encrypt_standard(&keys, VAULT, ENTRY, "same").unwrap();
        assert_ne!(a.nonce, b.nonce);
        assert_ne!(a.key_nonce, b.key_nonce);
        assert_ne!(a.ciphertext, b.ciphertext);
    }
}
