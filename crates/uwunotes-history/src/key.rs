//! What a history belongs to: a file on disk, or a note that has no path yet.
//!
//! Keys come from the page, so they are hostile input on their way to a
//! directory name — the same rule the drafts follow. A key never becomes a
//! path segment as it is: its canonical form is hashed, and the directory is
//! named after the hash. `../../evil` lands in a directory called
//! `3f0a…` like everything else.

use serde::{Deserialize, Serialize};
use uwunotes_fs::{hash_text, FsError, FsResult, HashAlgorithm};

/// Longer than any real path on any system this runs on. A "path" past this is
/// not one, and hashing a megabyte of it on every keystroke-timer is a waste.
const MAX_PATH_CHARS: usize = 4_096;

/// Document ids are short (`doc-3-17-lx2k9`); anything much longer did not come
/// from `newDocId()`.
const MAX_NOTE_ID_CHARS: usize = 128;

/// How much of the SHA-256 names a directory. 128 bits: no two keys anybody
/// will ever have collide, and the name still fits on one line of a listing.
const DIRECTORY_HEX_CHARS: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HistoryKey {
    /// A file, by its absolute path as the page knows it.
    Path { path: String },
    /// A buffer that was never saved anywhere, by its document id.
    Note { id: String },
}

impl HistoryKey {
    pub fn path(path: impl Into<String>) -> Self {
        Self::Path { path: path.into() }
    }

    pub fn note(id: impl Into<String>) -> Self {
        Self::Note { id: id.into() }
    }

    /// Refuses what cannot be a key. Everything public in the store calls this
    /// first, so a bad key is an error and never a strange directory.
    pub fn validate(&self) -> FsResult<()> {
        match self {
            Self::Path { path } => {
                if path.trim().is_empty()
                    || path.chars().count() > MAX_PATH_CHARS
                    || path.contains('\0')
                {
                    return Err(FsError::other(None, "Not a usable path for a history."));
                }
            }
            Self::Note { id } => {
                let fine = !id.is_empty()
                    && id.len() <= MAX_NOTE_ID_CHARS
                    && id
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
                if !fine {
                    return Err(FsError::other(None, "Not a usable note id for a history."));
                }
            }
        }
        Ok(())
    }

    /// The form two spellings of the same file share.
    ///
    /// Only what the platform itself treats as the same: on Windows case and
    /// slash direction carry no meaning, elsewhere they do. Nothing is resolved
    /// on disk — the file may be gone, which is exactly when its history is
    /// worth the most.
    pub fn canonical(&self) -> String {
        match self {
            Self::Path { path } => format!("path:{}", normalise_path(path)),
            Self::Note { id } => format!("note:{id}"),
        }
    }

    /// The directory this key's versions live in: hex, and nothing else.
    pub fn directory_name(&self) -> String {
        let mut digest = hash_text(&self.canonical(), HashAlgorithm::Sha256);
        digest.truncate(DIRECTORY_HEX_CHARS);
        digest
    }
}

/// Whether `name` could have come from [`HistoryKey::directory_name`]. Anything
/// else in the history directory is not ours and is left alone.
pub fn is_directory_name(name: &str) -> bool {
    name.len() == DIRECTORY_HEX_CHARS
        && name
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn normalise_path(path: &str) -> String {
    let mut clean = if cfg!(windows) {
        path.replace('\\', "/").to_lowercase()
    } else {
        path.to_owned()
    };
    // `C:/notes/` and `C:/notes` are one file; `/` alone is still `/`.
    while clean.len() > 1 && clean.ends_with('/') {
        clean.pop();
    }
    clean
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_traversing_note_id_is_refused() {
        assert!(HistoryKey::note("../../evil").validate().is_err());
        assert!(HistoryKey::note("a/b").validate().is_err());
        assert!(HistoryKey::note("").validate().is_err());
        assert!(HistoryKey::note("x".repeat(500)).validate().is_err());
        assert!(HistoryKey::note("doc-3-17-lx2k9").validate().is_ok());
    }

    #[test]
    fn a_path_never_reaches_the_directory_name() {
        let name = HistoryKey::path("../../../etc/passwd").directory_name();
        assert!(is_directory_name(&name), "{name}");
        assert!(!name.contains('.'));
    }

    #[test]
    fn a_note_and_a_file_of_the_same_spelling_are_two_histories() {
        assert_ne!(
            HistoryKey::note("doc-1").directory_name(),
            HistoryKey::path("doc-1").directory_name()
        );
    }

    #[test]
    fn a_trailing_slash_is_the_same_file() {
        assert_eq!(
            HistoryKey::path("/home/mini/notes.md/").directory_name(),
            HistoryKey::path("/home/mini/notes.md").directory_name()
        );
    }

    #[test]
    fn empty_and_nul_paths_are_refused() {
        assert!(HistoryKey::path("  ").validate().is_err());
        assert!(HistoryKey::path("a\0b").validate().is_err());
    }
}
