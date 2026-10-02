//! Zeitreise: every file and every unsaved note keeps automatic versions.
//!
//! A version is the whole text at one moment, compressed, with the moment, the
//! reason it was taken and a hash. The page decides *when* — on every save,
//! before a reload or a replace throws a buffer away, every few minutes while
//! somebody types — and this crate decides how long each one is worth keeping
//! and makes sure the store never grows without bound.
//!
//! A crate of its own rather than a corner of `uwunotes-session`: the session
//! store is small and dull on purpose and holds exactly one copy of anything,
//! while this one compresses, deduplicates, thins out and enforces a size cap.
//! Neither needs to know the other exists.
//!
//! Same posture as the session: everything on disk here is JSON or bytes in
//! the user's own data directory, which a hand-edit or a crash can leave in any
//! shape. A bad index entry is skipped, a damaged version is an error for that
//! one version, and nothing in here is allowed to stop the editor.
//!
//! What this crate deliberately does not do: know what a tab is, or decide on
//! its own to take a snapshot.

#![forbid(unsafe_code)]

pub mod key;
pub mod retention;
pub mod store;

pub use key::HistoryKey;
pub use retention::{Policy, DAY_MS, HOUR_MS};
pub use store::{HistoryStats, HistoryStore, Limits, Reason, SnapshotOutcome, Version};
