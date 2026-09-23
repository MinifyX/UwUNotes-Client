//! Everything UwUNotes does with a disk.
//!
//! The split with the page is strict: this crate owns bytes — detecting an
//! encoding, decoding, encoding, atomic writes, walking a tree, matching
//! patterns — and the page owns text. By the time anything crosses the IPC
//! boundary it is a `String` with `\n` line endings, and how it got that way
//! travels alongside it so saving can put it all back exactly as it was.
//!
//! Every fallible function returns [`FsError`], which serialises to the shape
//! `lib/api.ts` calls `ApiError`.
//!
//! What this crate deliberately does not do: delete anything, talk to Tauri, or
//! know what a tab is.

// `deny` rather than `forbid`: `windows_api` needs three Windows calls the
// standard library does not wrap — telling a file from a named pipe, counting a
// file's names, and replacing a file without handing it the folder's access
// list. That module turns the lint off for itself and nothing else does.
#![deny(unsafe_code)]

pub mod encoding;
pub mod error;
pub mod hash;
pub mod listing;
pub mod read;
pub mod search;
#[cfg(windows)]
mod windows_api;
pub mod write;

pub use encoding::{
    apply_eol, by_label, decode, detect, detect_eol, encode, encode_checked, normalise, Detected,
    EncodingSource, Eol, ENCODINGS,
};
pub use error::{FsError, FsResult};
pub use hash::{hash_file, hash_text, HashAlgorithm};
pub use listing::{
    create_dir, create_file, join_path, list_dir, path_info, rename_path, DirEntry, DirEntryKind,
    PathInfo,
};
pub use read::{file_stamp, read_file, FileStamp, LoadedFile, MAX_FILE_BYTES};
pub use search::{
    replace_in_files, search, ReplaceFailure, ReplaceRequest, ReplaceSummary, SearchMatch,
    SearchRequest, SearchSummary,
};
pub use write::{write_atomic, write_file};
