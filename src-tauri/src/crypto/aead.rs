use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::error::{AppError, Result};

pub const XCHACHA_NONCE_LEN: usize = 24;
pub const AES_GCM_NONCE_LEN: usize = 12;
pub const TAG_LEN: usize = 16;

const AES_GCM_MAX_PLAINTEXT: u64 = 64 * 1024 * 1024;

/// A nonce plus AEAD ciphertext (including the authentication tag).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AeadBlob {
    pub nonce: Vec<u8>,
    pub ciphertext: Vec<u8>,
}

/// Fill a buffer with bytes from the operating system CSPRNG.
pub fn random_bytes(len: usize) -> Vec<u8> {
    let mut bytes = vec![0u8; len];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes
}

pub fn random_key() -> Zeroizing<[u8; 32]> {
    let mut key = Zeroizing::new([0u8; 32]);
    rand::rngs::OsRng.fill_bytes(key.as_mut());
    key
}

fn check_key(key: &[u8]) -> Result<&[u8; 32]> {
    key.try_into().map_err(|_| AppError::Crypto)
}

/// XChaCha20-Poly1305 with a fresh 192-bit random nonce.
pub fn xchacha_encrypt(key: &[u8], plaintext: &[u8], aad: &[u8]) -> Result<AeadBlob> {
    let key = check_key(key)?;
    let cipher = XChaCha20Poly1305::new(key.into());
    let nonce = random_bytes(XCHACHA_NONCE_LEN);
    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| AppError::Crypto)?;
    Ok(AeadBlob { nonce, ciphertext })
}

pub fn xchacha_decrypt(key: &[u8], blob: &AeadBlob, aad: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
    let key = check_key(key)?;
    if blob.nonce.len() != XCHACHA_NONCE_LEN || blob.ciphertext.len() < TAG_LEN {
        return Err(AppError::MalformedVault);
    }
    let cipher = XChaCha20Poly1305::new(key.into());
    let plaintext = cipher
        .decrypt(
            XNonce::from_slice(&blob.nonce),
            Payload {
                msg: &blob.ciphertext,
                aad,
            },
        )
        .map_err(|_| AppError::Crypto)?;
    Ok(Zeroizing::new(plaintext))
}

/// AES-256-GCM with a fresh 96-bit random nonce.
pub fn aes_encrypt(key: &[u8], plaintext: &[u8], aad: &[u8]) -> Result<AeadBlob> {
    let key = check_key(key)?;
    if plaintext.len() as u64 > AES_GCM_MAX_PLAINTEXT {
        return Err(AppError::Crypto);
    }
    let cipher = Aes256Gcm::new(key.into());
    let nonce = random_bytes(AES_GCM_NONCE_LEN);
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| AppError::Crypto)?;
    Ok(AeadBlob { nonce, ciphertext })
}

pub fn aes_decrypt(key: &[u8], blob: &AeadBlob, aad: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
    let key = check_key(key)?;
    if blob.nonce.len() != AES_GCM_NONCE_LEN || blob.ciphertext.len() < TAG_LEN {
        return Err(AppError::MalformedVault);
    }
    let cipher = Aes256Gcm::new(key.into());
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(&blob.nonce),
            Payload {
                msg: &blob.ciphertext,
                aad,
            },
        )
        .map_err(|_| AppError::Crypto)?;
    Ok(Zeroizing::new(plaintext))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn key(byte: u8) -> [u8; 32] {
        [byte; 32]
    }

    #[test]
    fn xchacha_round_trip() {
        let blob = xchacha_encrypt(&key(1), b"sk-live-secret", b"aad").unwrap();
        let plain = xchacha_decrypt(&key(1), &blob, b"aad").unwrap();
        assert_eq!(plain.as_slice(), b"sk-live-secret");
        assert_eq!(blob.nonce.len(), XCHACHA_NONCE_LEN);
    }

    #[test]
    fn aes_gcm_round_trip() {
        let blob = aes_encrypt(&key(2), b"sk-live-secret", b"aad").unwrap();
        let plain = aes_decrypt(&key(2), &blob, b"aad").unwrap();
        assert_eq!(plain.as_slice(), b"sk-live-secret");
        assert_eq!(blob.nonce.len(), AES_GCM_NONCE_LEN);
    }

    #[test]
    fn wrong_key_fails() {
        let blob = xchacha_encrypt(&key(1), b"secret", b"").unwrap();
        assert!(xchacha_decrypt(&key(9), &blob, b"").is_err());
        let blob = aes_encrypt(&key(1), b"secret", b"").unwrap();
        assert!(aes_decrypt(&key(9), &blob, b"").is_err());
    }

    #[test]
    fn tampered_ciphertext_fails() {
        let mut blob = xchacha_encrypt(&key(3), b"secret", b"aad").unwrap();
        let last = blob.ciphertext.len() - 1;
        blob.ciphertext[last] ^= 0x01;
        assert!(xchacha_decrypt(&key(3), &blob, b"aad").is_err());

        let mut blob = aes_encrypt(&key(3), b"secret", b"aad").unwrap();
        blob.ciphertext[0] ^= 0x01;
        assert!(aes_decrypt(&key(3), &blob, b"aad").is_err());
    }

    #[test]
    fn aad_mismatch_fails() {
        let blob = xchacha_encrypt(&key(4), b"secret", b"entry-a").unwrap();
        assert!(xchacha_decrypt(&key(4), &blob, b"entry-b").is_err());
        let blob = aes_encrypt(&key(4), b"secret", b"entry-a").unwrap();
        assert!(aes_decrypt(&key(4), &blob, b"entry-b").is_err());
    }

    #[test]
    fn nonces_are_unique_across_many_encryptions() {
        let mut seen = HashSet::new();
        for _ in 0..256 {
            let blob = xchacha_encrypt(&key(5), b"same plaintext", b"").unwrap();
            assert!(seen.insert(blob.nonce), "xchacha nonce repeated");
            let blob = aes_encrypt(&key(5), b"same plaintext", b"").unwrap();
            assert!(seen.insert(blob.nonce), "aes-gcm nonce repeated");
        }
    }

    #[test]
    fn malformed_nonce_is_rejected() {
        let blob = AeadBlob {
            nonce: vec![0; 3],
            ciphertext: vec![0; 32],
        };
        assert!(xchacha_decrypt(&key(6), &blob, b"").is_err());
        assert!(aes_decrypt(&key(6), &blob, b"").is_err());
    }

    #[test]
    fn short_key_is_rejected() {
        assert!(xchacha_encrypt(&[1u8; 16], b"x", b"").is_err());
        assert!(aes_encrypt(&[1u8; 16], b"x", b"").is_err());
    }

    /// Known-answer test for AES-256-GCM: all-zero key, all-zero 96-bit nonce,
    /// empty plaintext and empty AAD produce the published tag.
    #[test]
    fn aes_256_gcm_known_answer() {
        let key = [0u8; 32];
        let nonce = [0u8; 12];
        let cipher = Aes256Gcm::new((&key).into());
        let out = cipher
            .encrypt(Nonce::from_slice(&nonce), Payload { msg: b"", aad: b"" })
            .unwrap();
        assert_eq!(
            out,
            hex_literal::hex!("530f8afbc74536b9a963b4f1c4cb738b").to_vec()
        );
    }
}
