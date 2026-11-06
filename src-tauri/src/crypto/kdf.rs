use std::time::{Duration, Instant};

use argon2::{Algorithm, Argon2, Params, Version};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::error::{AppError, Result};

pub const DERIVED_KEY_LEN: usize = 32;
/// Argon2id floors. A tampered header can never weaken the vault below these.
pub const MIN_MEMORY_KIB: u32 = 64 * 1024;
pub const MIN_ITERATIONS: u32 = 3;
pub const MIN_PARALLELISM: u32 = 1;
/// Upper bounds keep a hostile header from hanging the app or exhausting RAM.
pub const MAX_MEMORY_KIB: u32 = 1024 * 1024;
pub const MAX_ITERATIONS: u32 = 32;
pub const MAX_PARALLELISM: u32 = 16;

const TARGET_MIN: Duration = Duration::from_millis(700);
const TARGET_MAX: Duration = Duration::from_millis(1500);
const BENCH_ITERATION_CAP: u32 = 12;

/// Argon2id parameters, stored in the plaintext vault header so they can be
/// reproduced on any machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KdfParams {
    pub memory_kib: u32,
    pub iterations: u32,
    pub parallelism: u32,
}

impl Default for KdfParams {
    fn default() -> Self {
        Self {
            memory_kib: 256 * 1024,
            iterations: 3,
            parallelism: 4,
        }
    }
}

impl KdfParams {
    /// Rejects parameter sets below the security floor.
    pub fn validate_floor(&self) -> Result<()> {
        if self.memory_kib < MIN_MEMORY_KIB
            || self.iterations < MIN_ITERATIONS
            || self.parallelism < MIN_PARALLELISM
        {
            return Err(AppError::MalformedVault);
        }
        self.validate_bounds()
    }

    /// Rejects absurd values even when they are above the floor.
    pub fn validate_bounds(&self) -> Result<()> {
        if self.memory_kib > MAX_MEMORY_KIB
            || self.iterations > MAX_ITERATIONS
            || self.parallelism > MAX_PARALLELISM
        {
            return Err(AppError::MalformedVault);
        }
        Ok(())
    }

    /// Fast parameters for unit tests only. Never written to a real vault.
    #[cfg(test)]
    pub fn for_tests() -> Self {
        Self {
            memory_kib: 8 * 1024,
            iterations: 1,
            parallelism: 1,
        }
    }
}

/// Derive a 32-byte key from a password with Argon2id.
pub fn derive_key(
    password: &str,
    salt: &[u8],
    params: &KdfParams,
) -> Result<Zeroizing<[u8; DERIVED_KEY_LEN]>> {
    params.validate_bounds()?;
    if salt.len() < 16 {
        return Err(AppError::MalformedVault);
    }
    let argon_params = Params::new(
        params.memory_kib,
        params.iterations,
        params.parallelism,
        Some(DERIVED_KEY_LEN),
    )
    .map_err(|_| AppError::Crypto)?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, argon_params);
    let mut out = Zeroizing::new([0u8; DERIVED_KEY_LEN]);
    argon
        .hash_password_into(password.as_bytes(), salt, out.as_mut())
        .map_err(|_| AppError::Crypto)?;
    Ok(out)
}

fn time_derivation(params: &KdfParams) -> Result<Duration> {
    let salt = [0x5au8; 16];
    let start = Instant::now();
    let _key = derive_key("keyfold-benchmark-password", &salt, params)?;
    Ok(start.elapsed())
}

/// Measure Argon2id on this machine and pick parameters whose cost lands in
/// the 0.7 s – 1.5 s band. Never returns parameters below the security floor.
pub fn tune() -> Result<KdfParams> {
    let mut params = KdfParams::default();
    let mut elapsed = time_derivation(&params)?;

    // Very slow machines: lower memory (never below the floor) rather than
    // dropping iterations, which are the cheapest part of the defence.
    while elapsed > TARGET_MAX && params.memory_kib > MIN_MEMORY_KIB {
        params.memory_kib = (params.memory_kib / 2).max(MIN_MEMORY_KIB);
        elapsed = time_derivation(&params)?;
    }

    // Fast machines: raise iterations until the target band is reached.
    while elapsed < TARGET_MIN && params.iterations < BENCH_ITERATION_CAP {
        let factor = TARGET_MIN.as_secs_f64() / elapsed.as_secs_f64().max(0.001);
        let next = ((params.iterations as f64 * factor).ceil() as u32)
            .clamp(params.iterations + 1, BENCH_ITERATION_CAP);
        params.iterations = next;
        elapsed = time_derivation(&params)?;
    }

    params.validate_floor()?;
    Ok(params)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derivation_is_deterministic() {
        let params = KdfParams::for_tests();
        let a = derive_key("correct horse battery staple", &[1u8; 16], &params).unwrap();
        let b = derive_key("correct horse battery staple", &[1u8; 16], &params).unwrap();
        assert_eq!(a.as_ref(), b.as_ref());
    }

    #[test]
    fn different_salt_or_password_changes_key() {
        let params = KdfParams::for_tests();
        let a = derive_key("password-one", &[1u8; 16], &params).unwrap();
        let b = derive_key("password-one", &[2u8; 16], &params).unwrap();
        let c = derive_key("password-two", &[1u8; 16], &params).unwrap();
        assert_ne!(a.as_ref(), b.as_ref());
        assert_ne!(a.as_ref(), c.as_ref());
    }

    #[test]
    fn short_salt_is_rejected() {
        assert!(derive_key("password", &[1u8; 8], &KdfParams::for_tests()).is_err());
    }

    #[test]
    fn floors_are_enforced() {
        let weak = KdfParams {
            memory_kib: 8 * 1024,
            iterations: 3,
            parallelism: 1,
        };
        assert!(weak.validate_floor().is_err());

        let weak = KdfParams {
            memory_kib: 64 * 1024,
            iterations: 1,
            parallelism: 1,
        };
        assert!(weak.validate_floor().is_err());

        let weak = KdfParams {
            memory_kib: 64 * 1024,
            iterations: 3,
            parallelism: 0,
        };
        assert!(weak.validate_floor().is_err());

        let ok = KdfParams {
            memory_kib: 64 * 1024,
            iterations: 3,
            parallelism: 1,
        };
        assert!(ok.validate_floor().is_ok());
    }

    #[test]
    fn absurd_parameters_are_rejected() {
        let huge = KdfParams {
            memory_kib: 64 * 1024 * 1024,
            iterations: 3,
            parallelism: 1,
        };
        assert!(huge.validate_bounds().is_err());
    }

    #[test]
    fn tuner_returns_parameters_at_or_above_floor() {
        let params = tune().unwrap();
        params.validate_floor().unwrap();
        assert!(params.iterations >= MIN_ITERATIONS);
    }
}
