//! Files the system asks the editor to open: "Open with UwUNotes" in Finder,
//! a double-click on a text file UwUNotes is the default app for, a file
//! dropped on the Dock icon.
//!
//! macOS delivers those as an event, often before the page has loaded — on a
//! cold start the file is the reason the app is starting at all. So the paths
//! wait here, the page is told there are some, and it collects them with
//! [`take_opened_paths`] when it is ready: on its first render and on every
//! `open-paths` event after that. Collecting empties the list, so a path that
//! arrives while the page is just starting up is opened once, not twice.

#[cfg(any(test, target_os = "macos"))]
use std::path::PathBuf;
use std::sync::Mutex;

static WAITING: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// What the page listens for. No payload: the paths come from
/// [`take_opened_paths`], which is the one place they leave this module.
#[cfg(target_os = "macos")]
const EVENT: &str = "open-paths";

/// Takes the files the system asked to open, from `RunEvent::Opened`.
#[cfg(target_os = "macos")]
pub(crate) fn receive(app: &tauri::AppHandle, urls: &[tauri::Url]) {
    use tauri::Emitter as _;

    let paths: Vec<PathBuf> = urls
        .iter()
        .filter_map(|url| url.to_file_path().ok())
        .collect();
    if paths.is_empty() {
        return;
    }
    for path in &paths {
        // The sandbox lets the app in for this run because the user chose the
        // file; a bookmark keeps it in on the next.
        crate::sandbox_access::remember(path);
    }
    push(paths);
    if let Err(error) = app.emit(EVENT, ()) {
        tracing::warn!(%error, "the page could not be told about opened files");
    }
}

#[cfg(any(test, target_os = "macos"))]
fn push(paths: Vec<PathBuf>) {
    let mut waiting = WAITING
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    waiting.extend(
        paths
            .into_iter()
            .map(|path| path.to_string_lossy().into_owned()),
    );
}

/// The files waiting to be opened, oldest first. Empty almost always.
#[tauri::command]
pub(crate) fn take_opened_paths() -> Vec<String> {
    std::mem::take(
        &mut *WAITING
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()),
    )
}

#[cfg(test)]
mod tests {
    use super::{push, take_opened_paths};
    use std::path::PathBuf;

    #[test]
    fn waiting_paths_are_handed_out_once() {
        push(vec![
            PathBuf::from("/tmp/a.md"),
            PathBuf::from("/tmp/b.txt"),
        ]);
        assert_eq!(take_opened_paths(), ["/tmp/a.md", "/tmp/b.txt"]);
        assert!(take_opened_paths().is_empty());
    }
}
