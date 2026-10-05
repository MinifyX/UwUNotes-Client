//! Getting the files and folders of the last session back, inside the Mac App
//! Store's sandbox.
//!
//! A sandboxed app may open what the user handed it — through the open and
//! save panels, by dropping it on the window or on the Dock icon, by "Open
//! with" — and only for as long as it runs. The next start, every path in the
//! restored session is a path it is no longer allowed to read. What survives a
//! restart is a *security-scoped bookmark*: an opaque blob the system makes for
//! a file the app has access to right now, and which, resolved on a later run,
//! gives that access back.
//!
//! So every user file or folder the editor reaches gets a bookmark, in
//! `bookmarks.json` next to the session, and at start-up every bookmark is
//! resolved and its access switched on before the page asks for anything. A
//! file inside a folder that already has one needs none of its own.
//!
//! Everywhere else — Windows, Linux, the Mac build from GitHub, which is not
//! sandboxed — both functions do nothing at all.

use std::path::Path;

/// Resolves the stored bookmarks and switches their access on, for the rest of
/// the run. Called once from `setup`, before the window loads the page.
pub(crate) fn restore(config_directory: &Path) {
    #[cfg(all(target_os = "macos", feature = "mas"))]
    scoped::restore(config_directory);
    #[cfg(not(all(target_os = "macos", feature = "mas")))]
    let _ = config_directory;
}

/// Keeps access to `path` across restarts, if it does not have that already.
/// Cheap when it does: a lookup, no system call. Never fails — a path the app
/// cannot bookmark is a path it could not open in the first place.
pub(crate) fn remember(path: &Path) {
    #[cfg(all(target_os = "macos", feature = "mas"))]
    scoped::remember(path);
    #[cfg(not(all(target_os = "macos", feature = "mas")))]
    let _ = path;
}

/// The bookkeeping, apart from the system calls, so it can be tested anywhere.
#[cfg(any(test, all(target_os = "macos", feature = "mas")))]
mod store {
    use std::path::{Path, PathBuf};

    use serde::{Deserialize, Serialize};

    /// Enough for every file and folder anybody works on, and a ceiling on a
    /// file that is read at every start.
    pub(super) const LIMIT: usize = 256;

    #[derive(Debug, Default, Serialize, Deserialize)]
    pub(super) struct Bookmarks {
        /// Oldest first, so the ceiling drops what was opened longest ago.
        pub entries: Vec<Entry>,
    }

    #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
    pub(super) struct Entry {
        pub path: PathBuf,
        /// The bookmark, hex-encoded so the file stays plain JSON.
        pub bookmark: String,
    }

    impl Bookmarks {
        pub fn parse(text: &str) -> Self {
            serde_json::from_str(text).unwrap_or_default()
        }

        /// Whether `path` or a folder it is in already has a bookmark.
        pub fn covers(&self, path: &Path) -> bool {
            self.entries
                .iter()
                .any(|entry| path.starts_with(&entry.path))
        }

        /// Adds a bookmark for `path`, replacing one it had and every one
        /// inside it, which the new one makes redundant.
        pub fn add(&mut self, path: PathBuf, bookmark: &[u8]) {
            self.entries.retain(|entry| !entry.path.starts_with(&path));
            self.entries.push(Entry {
                path,
                bookmark: hex(bookmark),
            });
            let excess = self.entries.len().saturating_sub(LIMIT);
            self.entries.drain(..excess);
        }
    }

    pub(super) fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    pub(super) fn unhex(text: &str) -> Option<Vec<u8>> {
        if text.len() % 2 != 0 {
            return None;
        }
        (0..text.len())
            .step_by(2)
            .map(|at| u8::from_str_radix(text.get(at..at + 2)?, 16).ok())
            .collect()
    }
}

#[cfg(all(target_os = "macos", feature = "mas"))]
mod scoped {
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;

    use objc2::runtime::Bool;
    use objc2_foundation::{
        NSData, NSURLBookmarkCreationOptions, NSURLBookmarkResolutionOptions, NSURL,
    };

    use super::store::{unhex, Bookmarks};

    const FILE: &str = "bookmarks.json";

    /// The bookmarks and the file they live in. `None` until [`restore`] ran.
    static STATE: Mutex<Option<(PathBuf, Bookmarks)>> = Mutex::new(None);

    pub(super) fn restore(config_directory: &Path) {
        let file = config_directory.join(FILE);
        let stored = std::fs::read_to_string(&file)
            .map(|text| Bookmarks::parse(&text))
            .unwrap_or_default();

        let mut restored = Bookmarks::default();
        for entry in stored.entries {
            let Some(bytes) = unhex(&entry.bookmark) else {
                continue;
            };
            match resolve(&bytes) {
                // A stale bookmark still works this once; a fresh one is made
                // now, while the access it gave is switched on.
                Some((path, true)) => match create(&path) {
                    Some(fresh) => restored.add(path, &fresh),
                    None => restored.add(path, &bytes),
                },
                Some((path, false)) => restored.add(path, &bytes),
                // Deleted, on a volume that is not mounted, or no longer ours
                // to open: forgotten, like the tab that pointed at it will be.
                None => tracing::info!(path = %entry.path.display(), "bookmark no longer resolves"),
            }
        }
        tracing::info!(
            count = restored.entries.len(),
            "security-scoped bookmarks restored"
        );
        save(&file, &restored);
        *STATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some((file, restored));
    }

    pub(super) fn remember(path: &Path) {
        let mut state = STATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some((file, bookmarks)) = state.as_mut() else {
            return;
        };
        if bookmarks.covers(path) {
            return;
        }
        let Some(bookmark) = create(path) else {
            tracing::debug!(path = %path.display(), "no bookmark for this path");
            return;
        };
        bookmarks.add(path.to_path_buf(), &bookmark);
        save(file, bookmarks);
    }

    /// A security-scoped bookmark for a path this process can open right now.
    fn create(path: &Path) -> Option<Vec<u8>> {
        let url = if path.is_dir() {
            NSURL::from_directory_path(path)?
        } else {
            NSURL::from_file_path(path)?
        };
        url.bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
            NSURLBookmarkCreationOptions::WithSecurityScope,
            None,
            None,
        )
        .ok()
        .map(|data| data.to_vec())
    }

    /// Resolves a bookmark and switches its access on for the rest of the run.
    /// The path it points at now — a file moved in Finder keeps its bookmark —
    /// and whether the bookmark should be made again.
    fn resolve(bytes: &[u8]) -> Option<(PathBuf, bool)> {
        let data = NSData::with_bytes(bytes);
        let mut stale = Bool::NO;
        // Never a dialog and never a network volume mounted at start-up: a
        // share that is not there costs that one tab, not a hung launch.
        let options = NSURLBookmarkResolutionOptions::WithSecurityScope
            | NSURLBookmarkResolutionOptions::WithoutUI
            | NSURLBookmarkResolutionOptions::WithoutMounting;
        // SAFETY: `stale` is a valid, writable `Bool` for the whole call.
        let url = unsafe {
            NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
                &data, options, None, &mut stale,
            )
        }
        .ok()?;
        let path = url.to_file_path()?;
        // SAFETY: a plain message to a valid file URL. It is balanced by the
        // end of the process rather than by `stopAccessingSecurityScopedResource`:
        // the file stays open in a tab for as long as the app runs.
        if !unsafe { url.startAccessingSecurityScopedResource() } {
            return None;
        }
        // Kept alive on purpose, see above.
        std::mem::forget(url);
        Some((path, stale.as_bool()))
    }

    /// Written next to the session, through a temporary file so a crash
    /// mid-write never leaves half a JSON document behind.
    fn save(file: &Path, bookmarks: &Bookmarks) {
        let Ok(text) = serde_json::to_string(bookmarks) else {
            return;
        };
        let temporary = file.with_extension("json.tmp");
        if let Some(folder) = file.parent() {
            let _ = std::fs::create_dir_all(folder);
        }
        if let Err(error) =
            std::fs::write(&temporary, text).and_then(|()| std::fs::rename(&temporary, file))
        {
            tracing::warn!(%error, "bookmarks could not be saved");
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use super::store::{hex, unhex, Bookmarks, LIMIT};

    #[test]
    fn a_file_inside_a_bookmarked_folder_needs_no_bookmark_of_its_own() {
        let mut bookmarks = Bookmarks::default();
        bookmarks.add(PathBuf::from("/Users/nyu/project"), b"folder");
        assert!(bookmarks.covers(Path::new("/Users/nyu/project/src/main.rs")));
        assert!(bookmarks.covers(Path::new("/Users/nyu/project")));
        // A shared prefix of characters is not a shared folder.
        assert!(!bookmarks.covers(Path::new("/Users/nyu/project-old/notes.md")));
    }

    #[test]
    fn a_folder_replaces_the_bookmarks_inside_it() {
        let mut bookmarks = Bookmarks::default();
        bookmarks.add(PathBuf::from("/Users/nyu/project/a.txt"), b"a");
        bookmarks.add(PathBuf::from("/Users/nyu/elsewhere.txt"), b"b");
        bookmarks.add(PathBuf::from("/Users/nyu/project"), b"c");
        let paths: Vec<_> = bookmarks.entries.iter().map(|e| e.path.clone()).collect();
        assert_eq!(
            paths,
            [
                PathBuf::from("/Users/nyu/elsewhere.txt"),
                PathBuf::from("/Users/nyu/project")
            ]
        );
    }

    #[test]
    fn the_oldest_bookmarks_go_first_past_the_ceiling() {
        let mut bookmarks = Bookmarks::default();
        for i in 0..LIMIT + 3 {
            bookmarks.add(PathBuf::from(format!("/f/{i}")), &[1]);
        }
        assert_eq!(bookmarks.entries.len(), LIMIT);
        assert_eq!(bookmarks.entries[0].path, PathBuf::from("/f/3"));
    }

    #[test]
    fn bookmarks_survive_the_round_trip_through_their_file() {
        let mut bookmarks = Bookmarks::default();
        bookmarks.add(PathBuf::from("/Users/nyu/notes.md"), &[0, 1, 0xab, 0xff]);
        let text = serde_json::to_string(&bookmarks).unwrap();
        let back = Bookmarks::parse(&text);
        assert_eq!(back.entries, bookmarks.entries);
        assert_eq!(
            unhex(&back.entries[0].bookmark).unwrap(),
            [0, 1, 0xab, 0xff]
        );
        // A damaged file is an empty list, not a failed start.
        assert!(Bookmarks::parse("{ not json").entries.is_empty());
        assert_eq!(unhex("abc"), None);
        assert_eq!(unhex("zz"), None);
        assert_eq!(hex(&[]), "");
    }
}
