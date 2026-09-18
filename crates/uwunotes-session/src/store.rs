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

use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use uwunotes_fs::{write_atomic, FsError, FsResult, MAX_FILE_BYTES};

use crate::model::StoredSession;

const SESSION_FILE: &str = "session.json";
const DRAFTS_DIRECTORY: &str = "drafts";
const DRAFT_EXTENSION: &str = "txt";

/// How much of a sanitised document id survives into the file name. Long enough
/// to recognise in a file manager, short enough to stay under every filesystem's
/// name limit once the hash is appended.
const NAME_BUDGET: usize = 48;

/// Past this, the file is not a session any more. A real entry takes about half
/// a kilobyte once it has a long path and a stamp in it, so this is somewhere
/// around fifteen thousand tabs — far beyond anyone's window and far below what
/// it costs to parse.
const MAX_SESSION_BYTES: u64 = 8 * 1024 * 1024;

/// Clamped rather than refused, because a truncated session is still a session:
/// it accounts for its drafts, and refusing one throws them all away.
const MAX_SESSION_DOCUMENTS: usize = 1_000;
const MAX_SESSION_PANES: usize = 200;

/// Matches the page's own `stringList`, which slices the two recent lists to
/// this before it ever shows them.
const MAX_RECENT: usize = 50;

pub struct SessionStore {
    directory: PathBuf,
    /// Whether anything knows what the drafts on disk belong to.
    ///
    /// [`Self::prune_drafts`] deletes every draft that is not named by the
    /// session being saved, which is only safe when that session is the whole
    /// truth. After a session file that would not read or parse, the page falls
    /// back to one empty buffer — and the first autosave would then take that
    /// one document's name as the entire list of what to keep, and wipe every
    /// parked draft in the directory. So the sweep waits until a load has
    /// actually accounted for them.
    prune_allowed: AtomicBool,
}

impl SessionStore {
    /// `directory` is the app's config directory; nothing is created until
    /// something is actually saved.
    pub fn new(directory: impl Into<PathBuf>) -> Self {
        Self {
            directory: directory.into(),
            prune_allowed: AtomicBool::new(false),
        }
    }

    pub fn session_path(&self) -> PathBuf {
        self.directory.join(SESSION_FILE)
    }

    pub fn drafts_directory(&self) -> PathBuf {
        self.directory.join(DRAFTS_DIRECTORY)
    }

    /// The stored session, or `None` when there is nothing usable to restore.
    ///
    /// Every `None` here costs the user their tab layout, which is annoying.
    /// Only one of them — the file genuinely not being there — also means the
    /// drafts are unaccounted for, and that one is the only one that lets the
    /// next save sweep them up. See [`Self::prune_drafts`].
    pub fn load(&self) -> Option<StoredSession> {
        let path = self.session_path();

        match fs::metadata(&path) {
            Ok(metadata) if metadata.len() > MAX_SESSION_BYTES => {
                tracing::warn!(
                    path = %path.display(),
                    size = metadata.len(),
                    "session file is far too large to be a session"
                );
                return None;
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                // A first run: there is nothing to restore, and nothing for a
                // draft to belong to either, so sweeping up is safe.
                self.prune_allowed.store(true, Ordering::Relaxed);
                return None;
            }
            Err(error) => {
                tracing::warn!(path = %path.display(), %error, "session file could not be read");
                return None;
            }
        }

        let text = match fs::read_to_string(&path) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                self.prune_allowed.store(true, Ordering::Relaxed);
                return None;
            }
            Err(error) => {
                tracing::warn!(path = %path.display(), %error, "session file could not be read");
                return None;
            }
        };

        match serde_json::from_str::<StoredSession>(&text) {
            Ok(mut session) => {
                clamp(&mut session);
                self.prune_allowed.store(true, Ordering::Relaxed);
                Some(session)
            }
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

    /// One document's parked text, or `None` when there is no draft for it.
    ///
    /// A draft that exists but will not read is an error, not a `None`. The
    /// difference matters: the page drops a document whose draft came back
    /// empty, and dropping it is what lets the next save collect the draft it
    /// merely failed to read once.
    pub fn read_draft(&self, doc_id: &str) -> FsResult<Option<String>> {
        let path = self.drafts_directory().join(draft_file_name(doc_id));
        match fs::metadata(&path) {
            Ok(metadata) if metadata.len() > MAX_FILE_BYTES => {
                return Err(FsError::TooLarge {
                    path,
                    size: metadata.len(),
                    limit: MAX_FILE_BYTES,
                })
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(FsError::from_io(&error, &path)),
        }

        match fs::read_to_string(&path) {
            Ok(text) => Ok(Some(text)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(FsError::from_io(&error, &path)),
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
    ///
    /// A draft is the only copy of text that was never saved anywhere, so this
    /// runs only when two separate things agree that `keep` is the whole list:
    /// [`Self::load`] managed to account for the drafts, and the page says its
    /// restore actually rebuilt from a stored session. Either one saying no —
    /// a session file that would not parse, the "restore my tabs" setting being
    /// off, a draft that failed to read this once — leaves every draft where it
    /// is. A directory of stale drafts is a few kilobytes; the other mistake is
    /// somebody's unsaved notes.
    pub fn prune_drafts(&self, keep: &HashSet<String>, allowed: bool) -> FsResult<()> {
        if !allowed || !self.prune_allowed.load(Ordering::Relaxed) {
            tracing::warn!(
                from_page = allowed,
                from_load = self.prune_allowed.load(Ordering::Relaxed),
                "drafts left alone: nothing can say what they belong to"
            );
            return Ok(());
        }

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
            // Drafts only. The atomic write puts a temporary file in this same
            // directory while it works, and pulling that out from under a draft
            // being written on another thread would lose exactly the text this
            // is here to protect.
            if !name.ends_with(&format!(".{DRAFT_EXTENSION}")) {
                continue;
            }
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

/// Cuts a session down to a size a window could plausibly have had.
///
/// Truncating rather than refusing is deliberate: the documents that survive
/// still account for their drafts, so the next sweep keeps those. Refusing the
/// whole file would leave nothing accounted for at all.
fn clamp(session: &mut StoredSession) {
    if session.documents.len() > MAX_SESSION_DOCUMENTS {
        tracing::warn!(
            documents = session.documents.len(),
            "session lists more documents than a window can hold; keeping the first {MAX_SESSION_DOCUMENTS}"
        );
        session.documents.truncate(MAX_SESSION_DOCUMENTS);
    }
    if session.panes.len() > MAX_SESSION_PANES {
        let kept: BTreeMap<_, _> = std::mem::take(&mut session.panes)
            .into_iter()
            .take(MAX_SESSION_PANES)
            .collect();
        session.panes = kept;
    }
    session.recent_files.truncate(MAX_RECENT);
    session.recent_folders.truncate(MAX_RECENT);
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

    /// A config directory of its own, removed when the test drops it.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new(label: &str) -> Self {
            let directory = std::env::temp_dir()
                .join(format!("uwunotes-session-{}-{label}", std::process::id()));
            let _ = fs::remove_dir_all(&directory);
            fs::create_dir_all(&directory).expect("a scratch directory");
            Self(directory)
        }

        fn store(&self) -> SessionStore {
            SessionStore::new(&self.0)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn drafts_on_disk(store: &SessionStore) -> usize {
        fs::read_dir(store.drafts_directory())
            .map(|reader| reader.filter_map(Result::ok).count())
            .unwrap_or(0)
    }

    fn one_id(doc_id: &str) -> HashSet<String> {
        std::iter::once(doc_id.to_owned()).collect()
    }

    #[test]
    fn a_session_that_would_not_parse_leaves_every_draft_alone() {
        let scratch = Scratch::new("unparsable");
        let store = scratch.store();
        store.write_draft("doc-1-0", "unsaved notes").unwrap();
        store.write_draft("doc-2-1", "more unsaved notes").unwrap();
        // What a crash during a non-atomic save leaves behind, and what a hand
        // edit looks like.
        fs::write(store.session_path(), r#"{ "version": 1, "documen"#).unwrap();

        assert!(store.load().is_none(), "a truncated session is no session");

        // The page fell back to one empty buffer, and this is its first save.
        store.prune_drafts(&one_id("doc-9-9"), true).unwrap();

        assert_eq!(
            drafts_on_disk(&store),
            2,
            "the only copy of somebody's unsaved text was deleted"
        );
    }

    #[test]
    fn a_page_that_did_not_restore_does_not_sweep_either() {
        let scratch = Scratch::new("no-restore");
        let store = scratch.store();
        store.write_draft("doc-1-0", "unsaved notes").unwrap();
        // The session file is fine; the user has "restore my tabs" switched off,
        // so the page never looked at it.
        assert!(store.load().is_none());

        store.prune_drafts(&one_id("doc-9-9"), false).unwrap();

        assert_eq!(drafts_on_disk(&store), 1);
    }

    #[test]
    fn a_first_run_still_sweeps_up() {
        let scratch = Scratch::new("first-run");
        let store = scratch.store();
        store
            .write_draft("doc-1-0", "left over from a previous install")
            .unwrap();

        // No session file at all: nothing to restore, and nothing these drafts
        // could belong to.
        assert!(store.load().is_none());
        store.prune_drafts(&HashSet::new(), true).unwrap();

        assert_eq!(drafts_on_disk(&store), 0);
    }

    #[test]
    fn a_draft_that_will_not_read_is_an_error_and_not_an_absence() {
        let scratch = Scratch::new("unreadable");
        let store = scratch.store();
        assert_eq!(store.read_draft("doc-1-0").unwrap(), None);

        store.write_draft("doc-1-0", "text").unwrap();
        assert_eq!(
            store.read_draft("doc-1-0").unwrap().as_deref(),
            Some("text")
        );
    }

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
