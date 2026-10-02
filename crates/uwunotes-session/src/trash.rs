//! The note trash: unsaved text from tabs that were closed without saving.
//!
//! Closing a tab never asks "save or discard?" any more. A tab with unsaved
//! changes hands its text to this trash instead, and the user can bring it back
//! from the sidebar or with Ctrl+Shift+T — tomorrow as well as in a minute,
//! because the trash lives on disk next to the session, not in the page.
//!
//! One JSON file per entry in `trash/`, written atomically. The file name is
//! the entry's id, and the id is minted here, never taken from the page: what
//! the page sends back to read or delete an entry is checked against the exact
//! shape this module produces, so no id can name a file outside the directory.
//!
//! The trash empties itself, oldest first, past [`MAX_AGE_MS`], [`MAX_ENTRIES`]
//! or [`MAX_TOTAL_BYTES`]. The newest entry always survives that sweep, however
//! large it is: it is the text the user threw away a moment ago, and a trash
//! that silently refused the one thing it was just handed would be a trash that
//! loses notes.
//!
//! The size cap only ever takes large entries (from [`SMALL_ENTRY_BYTES`] up).
//! It exists for pasted logs, and one of those thrown away today must not push
//! last week's shopping list out of the trash — the notes the trash is for are
//! a few kilobytes each, and the entry count already bounds them.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use uwunotes_fs::{write_atomic, Eol, FsError, FsResult, MAX_FILE_BYTES};

use crate::store::SessionStore;

const TRASH_DIRECTORY: &str = "trash";
const TRASH_EXTENSION: &str = "json";

/// Thirty days. Long enough for "I had a note about that last week".
pub const MAX_AGE_MS: u64 = 30 * 24 * 60 * 60 * 1000;

/// A trash nobody can scroll through any more is not a trash, it is a heap.
pub const MAX_ENTRIES: usize = 200;

/// All entries together. Notes are small; a pasted log file is not, and a few
/// of those should not quietly grow the config directory by gigabytes.
pub const MAX_TOTAL_BYTES: u64 = 64 * 1024 * 1024;

/// Entries below this size on disk are spared by the size cap; only age and
/// [`MAX_ENTRIES`] remove them. [`MAX_ENTRIES`] of them together stay under
/// [`MAX_TOTAL_BYTES`], so sparing them cannot defeat the cap.
pub const SMALL_ENTRY_BYTES: u64 = 256 * 1024;

/// How much of an entry's text the listing carries: enough for the preview
/// line and for the sidebar's search to find a note by what it says, without
/// shipping every byte of the trash over IPC each time the view opens.
pub const EXCERPT_CHARS: usize = 4_000;

/// Makes two entries trashed in the same millisecond get different ids.
static SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// What the page hands over when a tab with unsaved changes is closed.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashNote {
    /// The tab's name: a file name, or the title an untitled note gave itself.
    pub name: String,
    /// `None` for a note that was never saved anywhere.
    #[serde(default)]
    pub path: Option<String>,
    pub text: String,
    pub encoding: String,
    #[serde(default)]
    pub bom: bool,
    pub eol: Eol,
    #[serde(default)]
    pub language: Option<String>,
    /// Everything else the page stored on the note, carried verbatim — the
    /// same arrangement as `SessionDocument::extra`.
    #[serde(flatten, default)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// One entry as it sits on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    pub id: String,
    /// Milliseconds since the epoch.
    pub trashed_at: u64,
    #[serde(flatten)]
    pub note: TrashNote,
}

/// One entry as the sidebar lists it: everything but the full text.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrashSummary {
    pub id: String,
    pub trashed_at: u64,
    pub name: String,
    pub path: Option<String>,
    pub language: Option<String>,
    /// The text's size in bytes, as UTF-8.
    pub bytes: u64,
    /// The first [`EXCERPT_CHARS`] characters of the text.
    pub excerpt: String,
}

impl TrashEntry {
    fn summary(&self) -> TrashSummary {
        TrashSummary {
            id: self.id.clone(),
            trashed_at: self.trashed_at,
            name: self.note.name.clone(),
            path: self.note.path.clone(),
            language: self.note.language.clone(),
            bytes: self.note.text.len() as u64,
            excerpt: self.note.text.chars().take(EXCERPT_CHARS).collect(),
        }
    }
}

impl SessionStore {
    pub fn trash_directory(&self) -> PathBuf {
        self.directory().join(TRASH_DIRECTORY)
    }

    /// Puts a note in the trash and returns how the listing will show it.
    ///
    /// Only an `Ok` here means the text is safe: the page keeps the tab open
    /// when this fails, because closing it would leave the text nowhere.
    pub fn trash_note(&self, note: TrashNote) -> FsResult<TrashSummary> {
        self.trash_note_at(note, now_ms())
    }

    /// [`Self::trash_note`] with the clock passed in, so the sweep is testable.
    pub fn trash_note_at(&self, note: TrashNote, now: u64) -> FsResult<TrashSummary> {
        let directory = self.trash_directory();
        fs::create_dir_all(&directory).map_err(|error| FsError::from_io(&error, &directory))?;

        let entry = TrashEntry {
            id: mint_id(now),
            trashed_at: now,
            note,
        };
        let path = directory.join(file_name(&entry.id));
        let json = serde_json::to_vec(&entry).map_err(|error| {
            FsError::other(
                Some(&path),
                format!("Trash entry could not be encoded: {error}"),
            )
        })?;
        write_atomic(&path, &json)?;

        // After the write, never before: the sweep must count the new entry so
        // it can keep it, and a sweep that fails costs disk space, not text.
        if let Err(error) = self.purge_trash_at(now) {
            tracing::warn!(%error, "trash could not be swept");
        }
        Ok(entry.summary())
    }

    /// Every entry, newest first. Entries that will not parse are skipped and
    /// left on disk — a hand-edited file is still somebody's text.
    pub fn list_trash(&self) -> FsResult<Vec<TrashSummary>> {
        Ok(self
            .read_all()?
            .into_iter()
            .map(|(entry, _)| entry.summary())
            .collect())
    }

    /// One entry with its full text, or `None` when it is gone.
    pub fn read_trash(&self, id: &str) -> FsResult<Option<TrashEntry>> {
        let path = self.entry_path(id)?;
        match fs::metadata(&path) {
            // The JSON wrapping costs a little over the text itself, and the
            // text was at most one file's worth when it went in.
            Ok(metadata) if metadata.len() > MAX_FILE_BYTES * 2 => {
                return Err(FsError::TooLarge {
                    path,
                    size: metadata.len(),
                    limit: MAX_FILE_BYTES * 2,
                })
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(FsError::from_io(&error, &path)),
        }
        let text = match fs::read_to_string(&path) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(FsError::from_io(&error, &path)),
        };
        serde_json::from_str::<TrashEntry>(&text)
            .map(Some)
            .map_err(|error| {
                FsError::other(
                    Some(&path),
                    format!("Trash entry could not be parsed: {error}"),
                )
            })
    }

    /// Deletes one entry for good. An entry that is already gone is a success.
    pub fn delete_trash(&self, id: &str) -> FsResult<()> {
        let path = self.entry_path(id)?;
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(FsError::from_io(&error, &path)),
        }
    }

    /// Deletes every entry. The page asks before it calls this.
    pub fn empty_trash(&self) -> FsResult<()> {
        for (entry, _) in self.read_all()? {
            self.delete_trash(&entry.id)?;
        }
        Ok(())
    }

    /// Drops what is too old or past the entry count, then the oldest large
    /// entries while the whole is over the size cap — always keeping the
    /// newest entry, and never taking a small one for its size.
    pub fn purge_trash_at(&self, now: u64) -> FsResult<()> {
        self.purge_trash_with(now, MAX_TOTAL_BYTES)
    }

    /// [`Self::purge_trash_at`] with the size cap passed in, so a test can
    /// exercise it without writing 64 MB.
    fn purge_trash_with(&self, now: u64, max_total: u64) -> FsResult<()> {
        let entries = self.read_all()?;
        let doomed = sweep_plan(
            entries
                .iter()
                .map(|(entry, size)| (entry.trashed_at, *size)),
            now,
            max_total,
        );
        for index in doomed {
            let Some((entry, _)) = entries.get(index) else {
                continue;
            };
            if let Err(error) = self.delete_trash(&entry.id) {
                tracing::warn!(id = %entry.id, %error, "old trash entry could not be removed");
            }
        }
        Ok(())
    }

    /// Every parsable entry with its size on disk, newest first.
    fn read_all(&self) -> FsResult<Vec<(TrashEntry, u64)>> {
        let directory = self.trash_directory();
        let reader = match fs::read_dir(&directory) {
            Ok(reader) => reader,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(FsError::from_io(&error, &directory)),
        };

        let mut entries = Vec::new();
        for item in reader {
            let Ok(item) = item else { continue };
            let name = item.file_name().to_string_lossy().into_owned();
            // Our own entries only. The atomic write stages a temporary file in
            // this directory, and anything else in here is not ours to parse.
            let Some(id) = name.strip_suffix(&format!(".{TRASH_EXTENSION}")) else {
                continue;
            };
            if !valid_id(id) {
                continue;
            }
            let Ok(metadata) = item.metadata() else {
                continue;
            };
            if metadata.len() > MAX_FILE_BYTES * 2 {
                continue;
            }
            let Ok(text) = fs::read_to_string(item.path()) else {
                continue;
            };
            match serde_json::from_str::<TrashEntry>(&text) {
                // The id inside the file is not trusted either: the file name
                // is what delete and read go by, so that is what the page gets.
                Ok(mut entry) => {
                    id.clone_into(&mut entry.id);
                    entries.push((entry, metadata.len()));
                }
                Err(error) => {
                    tracing::warn!(name = %name, %error, "trash entry could not be parsed");
                }
            }
        }
        // Newest first; the id breaks ties so the order is stable.
        entries.sort_by(|(a, _), (b, _)| {
            b.trashed_at
                .cmp(&a.trashed_at)
                .then_with(|| b.id.cmp(&a.id))
        });
        Ok(entries)
    }

    fn entry_path(&self, id: &str) -> FsResult<PathBuf> {
        if !valid_id(id) {
            return Err(FsError::other(None, "Not a trash entry id"));
        }
        Ok(self.trash_directory().join(file_name(id)))
    }
}

/// Which entries the sweep removes, by index, given `(trashed_at, size)` for
/// each entry newest first.
///
/// Kept apart from the disk so the policy reads in one place: age and count
/// first, for every entry; then, while the survivors are over `max_total`, the
/// oldest entries of [`SMALL_ENTRY_BYTES`] or more. Index 0 is never in it.
fn sweep_plan(entries: impl Iterator<Item = (u64, u64)>, now: u64, max_total: u64) -> Vec<usize> {
    let mut doomed = Vec::new();
    let mut survivors = Vec::new();
    let mut total: u64 = 0;
    for (index, (trashed_at, size)) in entries.enumerate() {
        let expired = now.saturating_sub(trashed_at) > MAX_AGE_MS;
        if index > 0 && (expired || index >= MAX_ENTRIES) {
            doomed.push(index);
        } else {
            total = total.saturating_add(size);
            survivors.push((index, size));
        }
    }
    // Oldest first, the newest never: it is the text the user just handed over.
    for &(index, size) in survivors.iter().rev() {
        if total <= max_total {
            break;
        }
        if index == 0 || size < SMALL_ENTRY_BYTES {
            continue;
        }
        total = total.saturating_sub(size);
        doomed.push(index);
    }
    doomed
}

fn file_name(id: &str) -> String {
    format!("{id}.{TRASH_EXTENSION}")
}

/// `<millis>-<sequence>-<pid>`, all lower-case hex. Sorts by time as a string
/// too, which keeps a directory listing readable.
fn mint_id(now: u64) -> String {
    let sequence = SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("{now:012x}-{sequence:04x}-{:x}", std::process::id())
}

/// Exactly the shape [`mint_id`] produces, and nothing else: hex digits and
/// dashes, bounded length. No dot, no slash, no backslash — so no `..`, no
/// absolute path, no drive letter, whatever the page sends.
fn valid_id(id: &str) -> bool {
    (1..=64).contains(&id.len())
        && id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte) || byte == b'-')
        && id.bytes().any(|byte| byte != b'-')
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A config directory of its own, removed when the test drops it.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new(label: &str) -> Self {
            let directory =
                std::env::temp_dir().join(format!("uwunotes-trash-{}-{label}", std::process::id()));
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

    fn note(name: &str, text: &str) -> TrashNote {
        TrashNote {
            name: name.to_owned(),
            path: None,
            text: text.to_owned(),
            encoding: "UTF-8".to_owned(),
            bom: false,
            eol: Eol::Lf,
            language: None,
            extra: serde_json::Map::new(),
        }
    }

    const DAY: u64 = 24 * 60 * 60 * 1000;
    const NOW: u64 = 1_790_000_000_000;

    #[test]
    fn a_trashed_note_comes_back_whole() {
        let scratch = Scratch::new("roundtrip");
        let store = scratch.store();
        let mut sent = note("Einkaufsliste", "Milch\nKatzenfutter\n");
        sent.path = Some("/home/nyu/notes/liste.txt".to_owned());
        sent.extra
            .insert("untitled".to_owned(), serde_json::Value::from(3));
        // The page's document id, so a restored note finds its Zeitreise again.
        sent.extra
            .insert("docId".to_owned(), serde_json::Value::from("doc-7-0-abc"));

        let summary = store.trash_note_at(sent, NOW).unwrap();
        assert_eq!(summary.name, "Einkaufsliste");
        assert_eq!(summary.excerpt, "Milch\nKatzenfutter\n");
        assert_eq!(summary.trashed_at, NOW);

        let entry = store.read_trash(&summary.id).unwrap().expect("the entry");
        assert_eq!(entry.note.text, "Milch\nKatzenfutter\n");
        assert_eq!(
            entry.note.path.as_deref(),
            Some("/home/nyu/notes/liste.txt")
        );
        assert_eq!(
            entry.note.extra.get("untitled"),
            Some(&serde_json::Value::from(3))
        );
        assert_eq!(
            entry.note.extra.get("docId"),
            Some(&serde_json::Value::from("doc-7-0-abc"))
        );

        store.delete_trash(&summary.id).unwrap();
        assert!(store.read_trash(&summary.id).unwrap().is_none());
        // Deleting twice is still a success.
        store.delete_trash(&summary.id).unwrap();
    }

    #[test]
    fn the_listing_is_newest_first_and_carries_no_full_text() {
        let scratch = Scratch::new("order");
        let store = scratch.store();
        store
            .trash_note_at(note("alt", "a"), NOW - 2 * DAY)
            .unwrap();
        store
            .trash_note_at(note("neu", &"x".repeat(EXCERPT_CHARS + 50)), NOW)
            .unwrap();
        store.trash_note_at(note("mitte", "m"), NOW - DAY).unwrap();

        let listed = store.list_trash().unwrap();
        let names: Vec<_> = listed.iter().map(|entry| entry.name.as_str()).collect();
        assert_eq!(names, ["neu", "mitte", "alt"]);
        assert_eq!(listed[0].excerpt.chars().count(), EXCERPT_CHARS);
        assert_eq!(listed[0].bytes, (EXCERPT_CHARS + 50) as u64);
    }

    #[test]
    fn old_entries_and_the_surplus_are_swept_but_never_the_newest() {
        let scratch = Scratch::new("purge");
        let store = scratch.store();
        store
            .trash_note_at(note("uralt", "weg damit"), NOW - 31 * DAY)
            .unwrap();
        store
            .trash_note_at(note("frisch", "bleibt"), NOW - DAY)
            .unwrap();
        store.purge_trash_at(NOW).unwrap();
        let names: Vec<_> = store
            .list_trash()
            .unwrap()
            .into_iter()
            .map(|entry| entry.name)
            .collect();
        assert_eq!(names, ["frisch"]);

        // Even an entry older than the limit survives while it is the only one:
        // it is the most recent thing the user threw away.
        store.purge_trash_at(NOW + 365 * DAY).unwrap();
        assert_eq!(store.list_trash().unwrap().len(), 1);
    }

    #[test]
    fn the_trash_holds_at_most_max_entries() {
        let scratch = Scratch::new("count");
        let store = scratch.store();
        for index in 0..(MAX_ENTRIES as u64 + 3) {
            store
                .trash_note_at(note(&format!("n{index}"), "t"), NOW + index)
                .unwrap();
        }
        let listed = store.list_trash().unwrap();
        assert_eq!(listed.len(), MAX_ENTRIES);
        assert_eq!(listed[0].name, format!("n{}", MAX_ENTRIES + 2));
    }

    #[test]
    fn the_size_cap_takes_large_entries_and_spares_small_notes() {
        let scratch = Scratch::new("size");
        let store = scratch.store();
        let big = "x".repeat(300 * 1024);
        store
            .trash_note_at(note("notiz-alt", "Milch"), NOW - 3 * DAY)
            .unwrap();
        store
            .trash_note_at(note("log-alt", &big), NOW - 2 * DAY)
            .unwrap();
        store
            .trash_note_at(note("notiz", "Katzenfutter"), NOW - DAY)
            .unwrap();
        store.trash_note_at(note("log-neu", &big), NOW).unwrap();

        // A cap the two logs together are over: the older log goes, both notes
        // stay — they are older than it, and small.
        store.purge_trash_with(NOW, 400 * 1024).unwrap();
        let names: Vec<_> = store
            .list_trash()
            .unwrap()
            .into_iter()
            .map(|entry| entry.name)
            .collect();
        assert_eq!(names, ["log-neu", "notiz", "notiz-alt"]);

        // Even a cap the newest log alone is over keeps it, and the notes.
        store.purge_trash_with(NOW, 1024).unwrap();
        assert_eq!(store.list_trash().unwrap().len(), 3);
    }

    #[test]
    fn the_sweep_plan_evicts_large_entries_oldest_first() {
        const KIB: u64 = 1024;
        // Newest first: (trashed_at, size).
        let entries = [
            (NOW, 400 * KIB),
            (NOW - 1, 300 * KIB),
            (NOW - 2, 2 * KIB),
            (NOW - 3, 300 * KIB),
            (NOW - 4, KIB),
        ];
        let doomed = sweep_plan(entries.into_iter(), NOW, 800 * KIB);
        assert_eq!(doomed, [3]);
        let doomed = sweep_plan(entries.into_iter(), NOW, 100 * KIB);
        assert_eq!(doomed, [3, 1]);
        // Age still takes a small note.
        let aged = [(NOW, KIB), (NOW - 31 * DAY, KIB)];
        assert_eq!(sweep_plan(aged.into_iter(), NOW, u64::MAX), [1]);
    }

    #[test]
    fn emptying_removes_every_entry() {
        let scratch = Scratch::new("empty");
        let store = scratch.store();
        store.trash_note_at(note("a", "1"), NOW).unwrap();
        store.trash_note_at(note("b", "2"), NOW).unwrap();
        // Not ours: the sweep and the emptying leave it alone.
        fs::write(store.trash_directory().join("notes.txt"), "mine").unwrap();

        store.empty_trash().unwrap();
        assert!(store.list_trash().unwrap().is_empty());
        assert!(store.trash_directory().join("notes.txt").exists());
    }

    #[test]
    fn an_id_from_the_page_cannot_leave_the_trash_directory() {
        let scratch = Scratch::new("traversal");
        let store = scratch.store();
        fs::write(scratch.0.join("session.json"), "{}").unwrap();
        for hostile in [
            "../session",
            "..\\session",
            "/etc/passwd",
            "C:\\Windows\\win",
            "a.b",
            "",
            "---",
            "ABC",
            &"a".repeat(65),
        ] {
            assert!(store.read_trash(hostile).is_err(), "{hostile:?} was read");
            assert!(
                store.delete_trash(hostile).is_err(),
                "{hostile:?} was deleted"
            );
        }
        assert!(scratch.0.join("session.json").exists());
    }

    #[test]
    fn minted_ids_are_valid_and_distinct() {
        let first = mint_id(NOW);
        let second = mint_id(NOW);
        assert!(valid_id(&first), "{first}");
        assert_ne!(first, second);
    }

    #[test]
    fn a_broken_entry_is_skipped_not_fatal() {
        let scratch = Scratch::new("broken");
        let store = scratch.store();
        store.trash_note_at(note("heil", "ok"), NOW).unwrap();
        fs::write(store.trash_directory().join("0abc-0001-1.json"), "{ nope").unwrap();

        let listed = store.list_trash().unwrap();
        assert_eq!(listed.len(), 1);
        assert!(store.read_trash("0abc-0001-1").is_err());
        assert!(store.trash_directory().join("0abc-0001-1.json").exists());
    }
}
