use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use subtle::ConstantTimeEq;
use zeroize::Zeroizing;

use crate::crypto::aead::{random_bytes, random_key, xchacha_decrypt, xchacha_encrypt, AeadBlob};
use crate::crypto::encoding::wrap_aad;
use crate::crypto::kdf::{derive_key, KdfParams};
use crate::crypto::recovery;
use crate::error::{AppError, Result};
use crate::vault::FORMAT_VERSION as VAULT_FORMAT_VERSION;

pub const SALT_LEN: usize = 16;
pub const HKDF_SALT_LEN: usize = 32;

const INFO_MASTER_VK: &str = "keyfold/v1/master/vk-wrap";
const INFO_CRITICAL_WRAP: &str = "keyfold/v1/critical-wrap";
const INFO_RECOVERY_VK: &str = "keyfold/v1/recovery/vk-wrap";
const INFO_RECOVERY_CK: &str = "keyfold/v1/recovery/ck-wrap";

/// Everything that is stored unencrypted in the vault file. It contains no
/// entry data and no derived keys, only material needed to attempt an unlock.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Header {
    pub format_version: u16,
    pub vault_id: String,
    pub kdf: KdfParams,
    pub salt1: Vec<u8>,
    pub salt2: Vec<u8>,
    pub hkdf_salt: Vec<u8>,
    pub wrapped_vk: AeadBlob,
    pub wrapped_ck: AeadBlob,
    pub recovery_vk: AeadBlob,
    pub recovery_ck: AeadBlob,
}

pub struct CreatedVault {
    pub header: Header,
    pub vk: Zeroizing<[u8; 32]>,
    pub k1: Zeroizing<[u8; 32]>,
    pub ck: Zeroizing<[u8; 32]>,
    pub k2: Zeroizing<[u8; 32]>,
    pub recovery_key: Zeroizing<String>,
}

/// HKDF-SHA256 with an explicit salt and a distinct `info` label per purpose.
pub fn hkdf_expand(ikm: &[u8], salt: &[u8], info: &str, len: usize) -> Result<Zeroizing<Vec<u8>>> {
    let hk = Hkdf::<Sha256>::new(Some(salt), ikm);
    let mut out = Zeroizing::new(vec![0u8; len]);
    hk.expand(info.as_bytes(), out.as_mut())
        .map_err(|_| AppError::Crypto)?;
    Ok(out)
}

fn hkdf_key(ikm: &[u8], salt: &[u8], info: &str) -> Result<Zeroizing<[u8; 32]>> {
    let bytes = hkdf_expand(ikm, salt, info, 32)?;
    let mut key = Zeroizing::new([0u8; 32]);
    key.copy_from_slice(&bytes);
    Ok(key)
}

fn wrap_key(kek: &[u8], material: &[u8], vault_id: &str, label: &str) -> Result<AeadBlob> {
    xchacha_encrypt(kek, material, &wrap_aad(vault_id, label))
}

fn unwrap_key(
    kek: &[u8],
    blob: &AeadBlob,
    vault_id: &str,
    label: &str,
) -> Result<Zeroizing<[u8; 32]>> {
    let plain = xchacha_decrypt(kek, blob, &wrap_aad(vault_id, label))
        .map_err(|_| AppError::InvalidPassword)?;
    let mut key = Zeroizing::new([0u8; 32]);
    if plain.len() != 32 {
        return Err(AppError::MalformedVault);
    }
    key.copy_from_slice(&plain);
    Ok(key)
}

pub fn wrap_vk(k1: &[u8], vk: &[u8], hkdf_salt: &[u8], vault_id: &str) -> Result<AeadBlob> {
    let kek = hkdf_key(k1, hkdf_salt, INFO_MASTER_VK)?;
    wrap_key(&kek[..], vk, vault_id, "vk")
}

pub fn unwrap_vk(
    k1: &[u8],
    blob: &AeadBlob,
    hkdf_salt: &[u8],
    vault_id: &str,
) -> Result<Zeroizing<[u8; 32]>> {
    let kek = hkdf_key(k1, hkdf_salt, INFO_MASTER_VK)?;
    unwrap_key(&kek[..], blob, vault_id, "vk")
}

pub fn wrap_ck(
    k1: &[u8],
    k2: &[u8],
    ck: &[u8],
    hkdf_salt: &[u8],
    vault_id: &str,
) -> Result<AeadBlob> {
    let mut ikm = Zeroizing::new(Vec::with_capacity(64));
    ikm.extend_from_slice(k1);
    ikm.extend_from_slice(k2);
    let kek = hkdf_key(&ikm[..], hkdf_salt, INFO_CRITICAL_WRAP)?;
    wrap_key(&kek[..], ck, vault_id, "ck")
}

pub fn unwrap_ck(
    k1: &[u8],
    k2: &[u8],
    blob: &AeadBlob,
    hkdf_salt: &[u8],
    vault_id: &str,
) -> Result<Zeroizing<[u8; 32]>> {
    let mut ikm = Zeroizing::new(Vec::with_capacity(64));
    ikm.extend_from_slice(k1);
    ikm.extend_from_slice(k2);
    let kek = hkdf_key(&ikm[..], hkdf_salt, INFO_CRITICAL_WRAP)?;
    unwrap_key(&kek[..], blob, vault_id, "ck")
}

pub fn wrap_recovery_vk(
    rk: &[u8],
    vk: &[u8],
    hkdf_salt: &[u8],
    vault_id: &str,
) -> Result<AeadBlob> {
    let kek = hkdf_key(rk, hkdf_salt, INFO_RECOVERY_VK)?;
    wrap_key(&kek[..], vk, vault_id, "recovery-vk")
}

pub fn wrap_recovery_ck(
    rk: &[u8],
    ck: &[u8],
    hkdf_salt: &[u8],
    vault_id: &str,
) -> Result<AeadBlob> {
    let kek = hkdf_key(rk, hkdf_salt, INFO_RECOVERY_CK)?;
    wrap_key(&kek[..], ck, vault_id, "recovery-ck")
}

pub fn unwrap_recovery_vk(
    rk: &[u8],
    blob: &AeadBlob,
    hkdf_salt: &[u8],
    vault_id: &str,
) -> Result<Zeroizing<[u8; 32]>> {
    let kek = hkdf_key(rk, hkdf_salt, INFO_RECOVERY_VK)?;
    unwrap_key(&kek[..], blob, vault_id, "recovery-vk")
}

pub fn unwrap_recovery_ck(
    rk: &[u8],
    blob: &AeadBlob,
    hkdf_salt: &[u8],
    vault_id: &str,
) -> Result<Zeroizing<[u8; 32]>> {
    let kek = hkdf_key(rk, hkdf_salt, INFO_RECOVERY_CK)?;
    unwrap_key(&kek[..], blob, vault_id, "recovery-ck")
}

/// Create a brand new vault's key hierarchy: fresh salts, VK, CK and recovery
/// key, with `VK` wrapped by `K1` and `CK` wrapped by `HKDF(K1 || K2)`.
pub fn create(
    master: &str,
    critical: &str,
    kdf: KdfParams,
    vault_id: &str,
) -> Result<CreatedVault> {
    let salt1 = random_bytes(SALT_LEN);
    let salt2 = random_bytes(SALT_LEN);
    let hkdf_salt = random_bytes(HKDF_SALT_LEN);
    let k1 = derive_key(master, &salt1, &kdf)?;
    let k2 = derive_key(critical, &salt2, &kdf)?;
    let vk = random_key();
    let ck = random_key();
    let recovery_key = recovery::generate();
    let rk = recovery::decode(recovery_key.as_str())?;

    let header = Header {
        format_version: VAULT_FORMAT_VERSION,
        vault_id: vault_id.to_string(),
        kdf,
        salt1,
        salt2,
        hkdf_salt: hkdf_salt.clone(),
        wrapped_vk: wrap_vk(&k1[..], &vk[..], &hkdf_salt, vault_id)?,
        wrapped_ck: wrap_ck(&k1[..], &k2[..], &ck[..], &hkdf_salt, vault_id)?,
        recovery_vk: wrap_recovery_vk(&rk[..], &vk[..], &hkdf_salt, vault_id)?,
        recovery_ck: wrap_recovery_ck(&rk[..], &ck[..], &hkdf_salt, vault_id)?,
    };

    Ok(CreatedVault {
        header,
        vk,
        k1,
        ck,
        k2,
        recovery_key,
    })
}

/// Constant-time equality for derived key material.
pub fn keys_equal(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.ct_eq(b).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    const VAULT: &str = "11111111-1111-4111-8111-111111111111";

    fn kdf() -> KdfParams {
        KdfParams::for_tests()
    }

    #[test]
    fn rfc5869_test_case_1() {
        let ikm = vec![0x0bu8; 22];
        let salt = hex_literal::hex!("000102030405060708090a0b0c");
        let info = hex_literal::hex!("f0f1f2f3f4f5f6f7f8f9");
        let hk = Hkdf::<Sha256>::new(Some(&salt), &ikm);
        let mut okm = [0u8; 42];
        hk.expand(&info, &mut okm).unwrap();
        assert_eq!(
            okm.to_vec(),
            hex_literal::hex!(
                "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf\
                 34007208d5b887185865"
            )
            .to_vec()
        );
    }

    #[test]
    fn hierarchy_round_trip() {
        let created = create("master-password-1", "critical-password-2", kdf(), VAULT).unwrap();
        let vk = unwrap_vk(
            &created.k1[..],
            &created.header.wrapped_vk,
            &created.header.hkdf_salt,
            VAULT,
        )
        .unwrap();
        assert!(keys_equal(&vk[..], &created.vk[..]));

        let ck = unwrap_ck(
            &created.k1[..],
            &created.k2[..],
            &created.header.wrapped_ck,
            &created.header.hkdf_salt,
            VAULT,
        )
        .unwrap();
        assert!(keys_equal(&ck[..], &created.ck[..]));
    }

    #[test]
    fn critical_wrap_needs_both_keys() {
        let created = create("master-password-1", "critical-password-2", kdf(), VAULT).unwrap();
        let wrong = derive_key("not-the-critical-password", &created.header.salt2, &kdf()).unwrap();
        assert!(unwrap_ck(
            &created.k1[..],
            &wrong[..],
            &created.header.wrapped_ck,
            &created.header.hkdf_salt,
            VAULT,
        )
        .is_err());

        // K2 alone is not enough either.
        let wrong_master =
            derive_key("not-the-master-password", &created.header.salt1, &kdf()).unwrap();
        assert!(unwrap_ck(
            &wrong_master[..],
            &created.k2[..],
            &created.header.wrapped_ck,
            &created.header.hkdf_salt,
            VAULT,
        )
        .is_err());
    }

    #[test]
    fn recovery_key_unwraps_both_keys() {
        let created = create("master-password-1", "critical-password-2", kdf(), VAULT).unwrap();
        let rk = recovery::decode(created.recovery_key.as_str()).unwrap();
        let vk = unwrap_recovery_vk(
            &rk[..],
            &created.header.recovery_vk,
            &created.header.hkdf_salt,
            VAULT,
        )
        .unwrap();
        let ck = unwrap_recovery_ck(
            &rk[..],
            &created.header.recovery_ck,
            &created.header.hkdf_salt,
            VAULT,
        )
        .unwrap();
        assert!(keys_equal(&vk[..], &created.vk[..]));
        assert!(keys_equal(&ck[..], &created.ck[..]));
    }

    #[test]
    fn wrong_recovery_key_is_rejected() {
        let created = create("master-password-1", "critical-password-2", kdf(), VAULT).unwrap();
        let other = random_key();
        assert!(unwrap_recovery_vk(
            &other[..],
            &created.header.recovery_vk,
            &created.header.hkdf_salt,
            VAULT
        )
        .is_err());
    }

    #[test]
    fn wrapped_keys_are_bound_to_the_vault_id() {
        let created = create("master-password-1", "critical-password-2", kdf(), VAULT).unwrap();
        assert!(unwrap_vk(
            &created.k1[..],
            &created.header.wrapped_vk,
            &created.header.hkdf_salt,
            "another-vault",
        )
        .is_err());
    }
}
