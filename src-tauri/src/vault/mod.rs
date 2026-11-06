pub mod model;
pub mod session;
pub mod storage;

/// On-disk format version. Bumping this is a breaking change, and old files
/// must either be migrated explicitly or refused with a clear message.
pub const FORMAT_VERSION: u16 = 1;
