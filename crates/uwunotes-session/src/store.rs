//! Reading and writing the session file and the drafts beside it.
//!
//! Two rules shape this module. The first: a corrupt session must never stop
//! the app from starting. Anything unreadable, unparsable or from the future is
//! logged and treated as "no session" — the user loses their tab layout, which
//! is annoying, instead of their editor, which is not.
//!
//! The second: document ids come from the page, so they are treated as hostile
//! input on the way to a file name. A `docId` of `../../evil` must land in the
//! drafts directory like everything else.
//!
//! What this module deliberately does not do: interpret a session. It stores
//! and returns one.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use uwunotes_fs::{write_atomic, FsError, FsResult};

use crate::model::StoredSession;

const SESSION_FILE: &str = "session.json";
const DRAFTS_DIRECTORY: &str = "drafts";
const DRAFT_EXTENSION: &str = "txt";

/// How much of a sanitised document id survives into the file name. Long enough
/// to recognise in a file manager, short enough to stay under every filesystem's
/// name limit once the hash is appended.
const NAME_BUDGET: usize = 48;

pub struct SessionStore {
    directory: PathBuf,
}

impl SessionStore {
    /// `directory` is the app's config directory; nothing is created until
    /// something is actually saved.
    pub fn new(directory: impl Into<PathBuf>) -> Self {
        Self {
            directory: directory.into(),
        }
    }

    pub fn session_path(&self) -> PathBuf {
        self.directory.join(SESSION_FILE)
    }

    pub fn drafts_directory(&self) -> PathBuf {
        self.directory.join(DRAFTS_DIRECTORY)
    }

    /// The stored session, or `None` when there is nothing usable to restore.
    pub fn load(&self) -> Option<StoredSession> {
        let path = self.session_path();
        let text = match fs::read_to_string(&path) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
            Err(error) => {
                tracing::warn!(path = %path.display(), %error, "session file could not be read");
                return None;
            }
        };

        match serde_json::from_str::<StoredSession>(&text) {
            Ok(session) => Some(session),
            Err(error) => {
                tracing::warn!(path = %path.display(), %error, "session file could not be parsed");
                None
            }
        }
    }

    /// Written atomically, for the same reason documents are: the session file
    /// is rewritten every few seconds, and a half-written one read at the next
    /// start would throw away everything it describes.
    pub fn save(&self, session: &StoredSession) -> FsResult<()> {
        self.ensure_directory(&self.directory)?;
        let path = self.session_path();
        let json = serde_json::to_vec_pretty(session).map_err(|error| {
            FsError::other(
                Some(&path),
                format!("Session could not be encoded: {error}"),
            )
        })?;
        write_atomic(&path, &json)
    }

    /// Parks the unsaved text of one document. Always UTF-8: a draft is ours,
    /// not the user's file, and it is re-encoded properly when they save.
    pub fn write_draft(&self, doc_id: &str, text: &str) -> FsResult<()> {
        let drafts = self.drafts_directory();
        self.ensure_directory(&drafts)?;
        write_atomic(&drafts.join(draft_file_name(doc_id)), text.as_bytes())
    }

    pub fn read_draft(&self, doc_id: &str) -> Option<String> {
        let path = self.drafts_directory().join(draft_file_name(doc_id));
        match fs::read_to_string(&path) {
            Ok(text) => Some(text),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => {
                tracing::warn!(path = %path.display(), %error, "draft could not be read");
                None
            }
        }
    }

    /// Removes one draft. A draft that is already gone is a success: the caller
    /// wanted it not to exist, and it does not.
    pub fn drop_draft(&self, doc_id: &str) -> FsResult<()> {
        let path = self.drafts_directory().join(draft_file_name(doc_id));
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(FsError::from_io(&error, &path)),
        }
    }

    /// Deletes every draft that does not belong to one of `keep`.
    ///
    /// Run after restoring a session, because a draft whose document nobody
    /// reopened would otherwise sit in the config directory for years.
    pub fn prune_drafts(&self, keep: &HashSet<String>) -> FsResult<()> {
        let drafts = self.drafts_directory();
        let reader = match fs::read_dir(&drafts) {
            Ok(reader) => reader,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(FsError::from_io(&error, &drafts)),
        };

        let wanted: HashSet<String> = keep.iter().map(|doc_id| draft_file_name(doc_id)).collect();
        for entry in reader {
            let Ok(entry) = entry else { continue };
            let name = entry.file_name().to_string_lossy().into_owned();
            if wanted.contains(&name) {
                continue;
            }
            if let Err(error) = fs::remove_file(entry.path()) {
                // A draft we failed to delete costs a few kilobytes. Failing the
                // whole prune over it would cost the user a startup.
                tracing::warn!(name = %name, %error, "stale draft could not be removed");
            }
        }
        Ok(())
    }

    fn ensure_directory(&self, path: &Path) -> FsResult<()> {
        fs::create_dir_all(path).map_err(|error| FsError::from_io(&error, path))
    }
}

/// Turns a document id into a file name that cannot escape the drafts
/// directory, cannot collide with another id, and is still recognisable.
///
/// The readable part is a sanitised prefix — `..` and separators become
/// underscores — and the hash is what actually makes it unique, since two
/// different ids can easily sanitise to the same letters.
fn draft_file_name(doc_id: &str) -> String {
    let mut readable = String::with_capacity(NAME_BUDGET);
    for character in doc_id.chars().take(NAME_BUDGET) {
        if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
            readable.push(character);
        } else {
            readable.push('_');
        }
    }
    if readable.is_empty() {
        readable.push_str("draft");
    }

    format!("{readable}-{}.{DRAFT_EXTENSION}", fingerprint(doc_id))
}

/// FNV-1a, 64 bit. Not a security hash — it only has to make two document ids
/// that sanitise alike land in two different files.
fn fingerprint(text: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_traversing_document_id_cannot_leave_the_drafts_directory() {
        let name = draft_file_name("../../evil");
        assert!(!name.contains('/'), "{name}");
        assert!(!name.contains('\\'), "{name}");
        assert!(!name.contains(".."), "{name}");
        assert_eq!(Path::new(&name).components().count(), 1);
    }

    #[test]
    fn ids_that_sanitise_alike_still_get_their_own_file() {
        assert_ne!(draft_file_name("a/b"), draft_file_name("a:b"));
        assert_eq!(draft_file_name("doc-1"), draft_file_name("doc-1"));
    }
}
