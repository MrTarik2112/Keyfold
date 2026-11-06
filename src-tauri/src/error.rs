use serde::{Serialize, Serializer};

/// Every error that can cross the Tauri command boundary.
///
/// Messages are user-facing, calm and intentionally free of internal detail.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("That password is incorrect.")]
    InvalidPassword,
    #[error("The Critical password is incorrect.")]
    InvalidCriticalPassword,
    #[error("Too many failed attempts. Try again in {0} seconds.")]
    RateLimited(u64),
    #[error("The vault is locked.")]
    Locked,
    #[error("The Critical tier is locked.")]
    CriticalLocked,
    #[error("This vault file is damaged or was not created by Keyfold.")]
    MalformedVault,
    #[error("This vault was written by a newer version of Keyfold.")]
    UnsupportedVersion,
    #[error("A vault already exists on this machine.")]
    AlreadyExists,
    #[error("The vault could not be found.")]
    NotFound,
    #[error("{0}")]
    Invalid(String),
    #[error("The operation could not be completed.")]
    Crypto,
    #[error("The vault could not be written to disk.")]
    Io,
    #[error("The backup could not be read.")]
    BackupInvalid,
    #[error("The clipboard is unavailable.")]
    Clipboard,
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        // The frontend only ever needs the human readable message plus a stable
        // machine readable code for a handful of cases.
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rate_limit_message_mentions_seconds() {
        assert_eq!(
            AppError::RateLimited(8).to_string(),
            "Too many failed attempts. Try again in 8 seconds."
        );
    }
}
