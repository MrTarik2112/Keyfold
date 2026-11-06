use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use zeroize::Zeroizing;

use crate::crypto::aead::AeadBlob;
use crate::error::{AppError, Result};
use crate::vault::model::{SessionStatus, Settings, TierData};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LockEvent {
    CriticalLocked,
    Locked,
}

/// Holds the single password-verification slot for as long as one guess runs.
///
/// Without it, a compromised webview could fire many `unlock` calls at once:
/// every call would pass `check_rate_limit()` before the first failure is
/// recorded, and the guesses would run in parallel at Argon2 speed.
pub struct AttemptGuard<'a> {
    session: &'a Session,
    _serial: MutexGuard<'a, ()>,
}

impl AttemptGuard<'_> {
    /// Record the failed guess before the next one is allowed to start.
    pub fn fail(&self) -> u64 {
        self.session.record_failure()
    }

    pub fn succeed(&self) {
        self.session.reset_failures();
    }
}

/// The decrypted vault while it is unlocked. Lives only in Rust memory and is
/// dropped (and zeroized) when the vault locks.
/// Absolute ceilings on a session, independent of activity. `touch` is an IPC
/// call the webview can make whenever it likes, so activity alone must never be
/// able to keep key material in memory indefinitely.
pub const MAX_STANDARD_SESSION: Duration = Duration::from_secs(12 * 60 * 60);
pub const MAX_CRITICAL_SESSION: Duration = Duration::from_secs(15 * 60);

pub struct UnlockedVault {
    pub vault_id: String,
    pub created_at: String,
    pub settings: Settings,
    pub vk: Zeroizing<[u8; 32]>,
    pub k1: Zeroizing<[u8; 32]>,
    pub k2: Option<Zeroizing<[u8; 32]>>,
    pub ck: Option<Zeroizing<[u8; 32]>>,
    pub standard: TierData,
    pub critical: Option<TierData>,
    /// Latest Critical ciphertext, kept while Critical is locked so saving the
    /// Standard tier never destroys data it cannot decrypt.
    pub critical_blob: AeadBlob,
    /// Unlocked with the recovery key, so K1/K2 are not in memory. Password
    /// changes and re-tuning require a normal unlock first.
    pub recovery_mode: bool,
    last_activity: Instant,
    critical_last_activity: Option<Instant>,
    /// When the Standard session and the Critical session opened. Used only for
    /// the absolute ceilings, never extended by activity.
    unlocked_at: Instant,
    critical_unlocked_at: Option<Instant>,
    standard_cap: Duration,
    critical_cap: Duration,
}

impl UnlockedVault {
    pub fn new(
        vault_id: String,
        created_at: String,
        settings: Settings,
        vk: Zeroizing<[u8; 32]>,
        k1: Zeroizing<[u8; 32]>,
        standard: TierData,
        critical_blob: AeadBlob,
    ) -> Self {
        Self {
            vault_id,
            created_at,
            settings,
            vk,
            k1,
            k2: None,
            ck: None,
            standard,
            critical: None,
            critical_blob,
            recovery_mode: false,
            last_activity: Instant::now(),
            critical_last_activity: None,
            unlocked_at: Instant::now(),
            critical_unlocked_at: None,
            standard_cap: MAX_STANDARD_SESSION,
            critical_cap: MAX_CRITICAL_SESSION,
        }
    }

    /// Test hook: shorten the absolute ceilings so they can be exercised
    /// without waiting hours.
    #[cfg(test)]
    pub fn shrink_caps(&mut self, standard: Duration, critical: Duration) {
        self.standard_cap = standard;
        self.critical_cap = critical;
    }

    pub fn unlock_critical(
        &mut self,
        k2: Zeroizing<[u8; 32]>,
        ck: Zeroizing<[u8; 32]>,
        critical: TierData,
        critical_blob: AeadBlob,
    ) {
        self.k2 = Some(k2);
        self.ck = Some(ck);
        self.critical = Some(critical);
        self.critical_blob = critical_blob;
        self.critical_last_activity = Some(Instant::now());
        self.critical_unlocked_at = Some(Instant::now());
    }

    pub fn lock_critical(&mut self) {
        self.k2 = None;
        self.ck = None;
        self.critical = None;
        self.critical_last_activity = None;
        self.critical_unlocked_at = None;
    }

    pub fn touch(&mut self) {
        self.last_activity = Instant::now();
    }

    pub fn touch_critical(&mut self) {
        self.last_activity = Instant::now();
        if self.critical.is_some() {
            self.critical_last_activity = Some(Instant::now());
        }
    }

    fn standard_expired(&self) -> bool {
        if self.unlocked_at.elapsed() >= self.standard_cap {
            return true;
        }
        let minutes = self.settings.auto_lock_minutes;
        minutes > 0 && self.last_activity.elapsed() >= Duration::from_secs(u64::from(minutes) * 60)
    }

    fn critical_expired(&self) -> bool {
        let Some(opened) = self.critical_unlocked_at else {
            return false;
        };
        if opened.elapsed() >= self.critical_cap {
            return true;
        }
        self.critical_last_activity.is_some_and(|last| {
            last.elapsed() >= Duration::from_secs(u64::from(self.settings.critical_auto_lock_seconds))
        })
    }

    fn status(&self) -> SessionStatus {
        let cap_left = |cap: Duration, opened: Instant| -> u64 {
            cap.saturating_sub(opened.elapsed()).as_secs()
        };
        let standard_lock_in_seconds = if self.settings.auto_lock_minutes == 0 {
            None
        } else {
            let window = u64::from(self.settings.auto_lock_minutes) * 60;
            Some(
                window
                    .saturating_sub(self.last_activity.elapsed().as_secs())
                    .min(cap_left(self.standard_cap, self.unlocked_at)),
            )
        };
        let critical_lock_in_seconds = self.critical_last_activity.map(|last| {
            let idle = u64::from(self.settings.critical_auto_lock_seconds)
                .saturating_sub(last.elapsed().as_secs());
            match self.critical_unlocked_at {
                Some(opened) => idle.min(cap_left(self.critical_cap, opened)),
                None => idle,
            }
        });
        SessionStatus {
            standard_unlocked: true,
            critical_unlocked: self.critical.is_some(),
            standard_lock_in_seconds,
            critical_lock_in_seconds,
        }
    }
}

pub struct Session {
    inner: Mutex<Inner>,
    /// Serializes password verification. Always taken before `inner`.
    attempt: Mutex<()>,
}

struct Inner {
    unlocked: Option<UnlockedVault>,
    failed_attempts: u32,
    blocked_until: Option<Instant>,
}

impl Default for Session {
    fn default() -> Self {
        Self::new()
    }
}

impl Session {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner {
                unlocked: None,
                failed_attempts: 0,
                blocked_until: None,
            }),
            attempt: Mutex::new(()),
        }
    }

    fn guard(&self) -> MutexGuard<'_, Inner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn is_unlocked(&self) -> bool {
        self.guard().unlocked.is_some()
    }

    pub fn is_critical_unlocked(&self) -> bool {
        self.guard()
            .unlocked
            .as_ref()
            .is_some_and(|vault| vault.critical.is_some())
    }

    pub fn status(&self) -> SessionStatus {
        self.expire();
        match self.guard().unlocked.as_ref() {
            Some(vault) => vault.status(),
            None => SessionStatus {
                standard_unlocked: false,
                critical_unlocked: false,
                standard_lock_in_seconds: None,
                critical_lock_in_seconds: None,
            },
        }
    }

    /// Drop any sessions whose inactivity timer has elapsed. Called by the
    /// background ticker and before every command.
    pub fn expire(&self) -> Option<LockEvent> {
        let mut inner = self.guard();
        let event = {
            let vault = inner.unlocked.as_mut()?;
            if vault.standard_expired() {
                Some(LockEvent::Locked)
            } else if vault.critical.is_some() && vault.critical_expired() {
                vault.lock_critical();
                Some(LockEvent::CriticalLocked)
            } else {
                None
            }
        };
        if let Some(LockEvent::Locked) = event {
            inner.unlocked = None;
        }
        event
    }

    pub fn install(&self, vault: UnlockedVault) {
        let mut inner = self.guard();
        inner.unlocked = Some(vault);
        inner.failed_attempts = 0;
        inner.blocked_until = None;
    }

    pub fn lock(&self) {
        let mut inner = self.guard();
        inner.unlocked = None;
    }

    pub fn lock_critical(&self) -> Result<()> {
        let mut inner = self.guard();
        match inner.unlocked.as_mut() {
            Some(vault) => {
                vault.lock_critical();
                Ok(())
            }
            None => Err(AppError::Locked),
        }
    }

    /// Read access to the unlocked vault. Returns `Locked` when there is none.
    pub fn read<R>(&self, f: impl FnOnce(&UnlockedVault) -> Result<R>) -> Result<R> {
        self.expire();
        let inner = self.guard();
        let vault = inner.unlocked.as_ref().ok_or(AppError::Locked)?;
        f(vault)
    }

    /// Mutable access. Marks user activity on success.
    pub fn write<R>(&self, f: impl FnOnce(&mut UnlockedVault) -> Result<R>) -> Result<R> {
        self.expire();
        let mut inner = self.guard();
        let vault = inner.unlocked.as_mut().ok_or(AppError::Locked)?;
        let result = f(vault)?;
        vault.touch();
        Ok(result)
    }

    pub fn touch(&self) -> Result<()> {
        self.write(|vault| {
            vault.touch();
            Ok(())
        })
    }

    pub fn touch_critical(&self) -> Result<()> {
        self.write(|vault| {
            if vault.critical.is_none() {
                return Err(AppError::CriticalLocked);
            }
            vault.touch_critical();
            Ok(())
        })
    }

    pub fn critical_data<R>(&self, f: impl FnOnce(&TierData) -> Result<R>) -> Result<R> {
        self.write(|vault| {
            let critical = vault.critical.as_ref().ok_or(AppError::CriticalLocked)?;
            f(critical)
        })
    }

    /* ------------------------------ rate limit ------------------------------ */

    /// Take the single verification slot. Every password check must run under
    /// this guard so a burst of parallel commands is answered one guess at a
    /// time and each failure is counted before the next attempt begins.
    pub fn begin_attempt(&self) -> AttemptGuard<'_> {
        let serial = self
            .attempt
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        AttemptGuard {
            session: self,
            _serial: serial,
        }
    }

    pub fn check_rate_limit(&self) -> Result<()> {
        let inner = self.guard();
        if let Some(until) = inner.blocked_until {
            let now = Instant::now();
            if until > now {
                return Err(AppError::RateLimited(
                    until.duration_since(now).as_secs() + 1,
                ));
            }
        }
        Ok(())
    }

    /// Record a failed unlock attempt and return the enforced delay in seconds.
    pub fn record_failure(&self) -> u64 {
        let mut inner = self.guard();
        inner.failed_attempts = inner.failed_attempts.saturating_add(1);
        if inner.failed_attempts < 5 {
            return 0;
        }
        let step = (inner.failed_attempts - 5).min(5);
        let seconds = (2u64 << step).min(60);
        inner.blocked_until = Some(Instant::now() + Duration::from_secs(seconds));
        seconds
    }

    pub fn reset_failures(&self) {
        let mut inner = self.guard();
        inner.failed_attempts = 0;
        inner.blocked_until = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::aead::random_key;

    fn installed(minutes: u32, critical_seconds: u32) -> Session {
        let session = Session::new();
        let settings = Settings {
            auto_lock_minutes: minutes,
            critical_auto_lock_seconds: critical_seconds,
            ..Settings::default()
        };
        let vault = UnlockedVault::new(
            "vault".into(),
            "now".into(),
            settings,
            random_key(),
            random_key(),
            TierData::default(),
            AeadBlob {
                nonce: vec![0; 24],
                ciphertext: vec![0; 32],
            },
        );
        session.install(vault);
        session
    }

    #[test]
    fn lock_wipes_the_session() {
        let session = installed(5, 60);
        assert!(session.is_unlocked());
        session.lock();
        assert!(!session.is_unlocked());
        assert!(matches!(session.read(|_| Ok(())), Err(AppError::Locked)));
    }

    #[test]
    fn critical_requires_standard() {
        let session = installed(5, 60);
        session
            .write(|vault| {
                vault.unlock_critical(
                    random_key(),
                    random_key(),
                    TierData::default(),
                    AeadBlob {
                        nonce: vec![0; 24],
                        ciphertext: vec![0; 32],
                    },
                );
                Ok(())
            })
            .unwrap();
        assert!(session.is_critical_unlocked());
        session.lock_critical().unwrap();
        assert!(!session.is_critical_unlocked());
        assert!(session.is_unlocked());
        assert!(matches!(
            session.touch_critical(),
            Err(AppError::CriticalLocked)
        ));
    }

    #[test]
    fn rate_limit_backs_off_after_five_failures() {
        let session = Session::new();
        for _ in 0..4 {
            assert_eq!(session.record_failure(), 0);
        }
        assert_eq!(session.record_failure(), 2);
        assert!(session.check_rate_limit().is_err());
        assert_eq!(session.record_failure(), 4);
        assert_eq!(session.record_failure(), 8);
        session.reset_failures();
        assert!(session.check_rate_limit().is_ok());
    }

    #[test]
    fn verification_slots_are_serialized() {
        use std::sync::Arc;
        let session = Arc::new(Session::new());
        let holder = Arc::clone(&session);
        let worker = std::thread::spawn(move || {
            let _slot = holder.begin_attempt();
            std::thread::sleep(Duration::from_millis(200));
        });
        std::thread::sleep(Duration::from_millis(20));
        let started = Instant::now();
        let slot = session.begin_attempt();
        assert!(
            started.elapsed() >= Duration::from_millis(120),
            "a second attempt did not wait for the first"
        );
        slot.succeed();
        worker.join().unwrap();
    }

    #[test]
    fn failures_counted_while_holding_the_slot_enable_the_backoff() {
        let session = Session::new();
        {
            let slot = session.begin_attempt();
            for _ in 0..4 {
                assert_eq!(slot.fail(), 0);
            }
            assert_eq!(slot.fail(), 2);
        }
        assert!(session.check_rate_limit().is_err());
        session.reset_failures();
        assert!(session.check_rate_limit().is_ok());
    }

    #[test]
    fn absolute_standard_cap_locks_even_when_idle_lock_is_off() {
        let session = installed(0, 300);
        session
            .write(|vault| {
                vault.shrink_caps(Duration::from_millis(40), Duration::from_secs(60));
                Ok(())
            })
            .unwrap();
        assert!(session.is_unlocked());
        std::thread::sleep(Duration::from_millis(70));
        // Touching the session must not defeat the absolute ceiling: the touch
        // itself expires the session and is refused.
        assert!(matches!(session.touch(), Err(AppError::Locked)));
        assert!(!session.is_unlocked());
        assert!(session.expire().is_none());
    }

    #[test]
    fn absolute_critical_cap_locks_the_critical_tier() {
        let session = installed(5, 300);
        session
            .write(|vault| {
                vault.shrink_caps(Duration::from_secs(3600), Duration::from_millis(30));
                vault.unlock_critical(
                    random_key(),
                    random_key(),
                    TierData::default(),
                    AeadBlob {
                        nonce: vec![0; 24],
                        ciphertext: vec![0; 32],
                    },
                );
                Ok(())
            })
            .unwrap();
        assert!(session.is_critical_unlocked());
        std::thread::sleep(Duration::from_millis(60));
        assert!(matches!(
            session.expire(),
            Some(LockEvent::CriticalLocked)
        ));
        assert!(!session.is_critical_unlocked());
        assert!(session.is_unlocked());
    }

    #[test]
    fn standard_activity_does_not_extend_the_critical_timer() {
        let session = installed(5, 60);
        session
            .write(|vault| {
                vault.unlock_critical(
                    random_key(),
                    random_key(),
                    TierData::default(),
                    AeadBlob {
                        nonce: vec![0; 24],
                        ciphertext: vec![0; 32],
                    },
                );
                Ok(())
            })
            .unwrap();
        let before = session
            .read(|vault| Ok(vault.critical_last_activity))
            .unwrap();
        std::thread::sleep(Duration::from_millis(5));
        session.touch().unwrap();
        let after = session
            .read(|vault| Ok(vault.critical_last_activity))
            .unwrap();
        assert_eq!(before, after);
    }

    #[test]
    fn status_reports_countdowns() {
        let session = installed(5, 60);
        let status = session.status();
        assert!(status.standard_unlocked);
        assert!(!status.critical_unlocked);
        assert!(status.standard_lock_in_seconds.unwrap() > 250);
    }
}
