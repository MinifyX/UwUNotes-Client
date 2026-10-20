//! Files the system asks the editor to open: "Open with UwUNotes" in Finder,
//! Explorer or the Linux file manager, a double-click on a text file UwUNotes
//! is the default app for, a file dropped on the Dock icon.
//!
//! macOS delivers those as an event, Windows and Linux on the command line —
//! of this start ([`receive_args`] from `setup`), or of a second start that the
//! single-instance plugin hands to the window already open. Either way they
//! often arrive before the page has loaded: on a cold start the file is the
//! reason the app is starting at all. So the paths wait here, the page is told there are some, and it collects them with
//! [`take_opened_paths`] when it is ready: on its first render and on every
//! `open-paths` event after that. Collecting empties the list, so a path that
//! arrives while the page is just starting up is opened once, not twice.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

static WAITING: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// What the page listens for. No payload: the paths come from
/// [`take_opened_paths`], which is the one place they leave this module.
const EVENT: &str = "open-paths";

/// Takes the files the system asked to open, from `RunEvent::Opened`.
#[cfg(target_os = "macos")]
pub(crate) fn receive(app: &tauri::AppHandle, urls: &[tauri::Url]) {
    let paths: Vec<PathBuf> = urls
        .iter()
        .filter_map(|url| url.to_file_path().ok())
        .collect();
    for path in &paths {
        // The sandbox lets the app in for this run because the user chose the
        // file; a bookmark keeps it in on the next.
        crate::sandbox_access::remember(path);
    }
    hand_over(app, paths);
}

/// Takes the files from a command line: `uwunotes.exe "C:\notes\a.txt"` from
/// Explorer, `Exec=uwunotes %F` from a desktop entry. `args` includes the
/// program itself, as `std::env::args_os` and the single-instance plugin both
/// give it; `cwd` is the folder that start was made in, for relative paths.
pub(crate) fn receive_args<I, S>(app: &tauri::AppHandle, args: I, cwd: &Path)
where
    I: IntoIterator<Item = S>,
    S: Into<OsString>,
{
    hand_over(app, paths_from_args(args, cwd));
}

fn hand_over(app: &tauri::AppHandle, paths: Vec<PathBuf>) {
    use tauri::Emitter as _;

    if paths.is_empty() {
        return;
    }
    push(paths);
    if let Err(error) = app.emit(EVENT, ()) {
        tracing::warn!(%error, "the page could not be told about opened files");
    }
}

/// The files on a command line. Options are skipped — none of them names a
/// file, and a launcher or a debugger may add its own — unless they come after
/// `--`. A `file://` URL, which some file managers pass despite `%F`, becomes
/// its path; anything else that is not absolute is taken from `cwd`.
fn paths_from_args<I, S>(args: I, cwd: &Path) -> Vec<PathBuf>
where
    I: IntoIterator<Item = S>,
    S: Into<OsString>,
{
    let mut options = true;
    let mut paths = Vec::new();
    for arg in args.into_iter().skip(1).map(Into::into) {
        if arg.is_empty() {
            continue;
        }
        if options {
            if arg == "--" {
                options = false;
                continue;
            }
            if arg.to_string_lossy().starts_with('-') {
                continue;
            }
        }
        let text = arg.to_string_lossy();
        let path = if text.starts_with("file://") {
            match tauri::Url::parse(&text)
                .ok()
                .and_then(|url| url.to_file_path().ok())
            {
                Some(path) => path,
                None => continue,
            }
        } else {
            PathBuf::from(arg)
        };
        paths.push(if path.is_absolute() {
            path
        } else {
            cwd.join(path)
        });
    }
    paths
}

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

    #[cfg(unix)]
    #[test]
    fn command_line_paths_skip_the_program_and_options() {
        use super::paths_from_args;
        use std::path::Path;

        let cwd = Path::new("/home/nyu/notes");
        let paths = paths_from_args(
            [
                "/usr/bin/uwunotes",
                "--some-flag",
                "",
                "/tmp/a.md",
                "todo.txt",
                "file:///tmp/with%20space.txt",
                "--",
                "-dash.txt",
            ],
            cwd,
        );
        assert_eq!(
            paths,
            [
                PathBuf::from("/tmp/a.md"),
                PathBuf::from("/home/nyu/notes/todo.txt"),
                PathBuf::from("/tmp/with space.txt"),
                PathBuf::from("/home/nyu/notes/-dash.txt"),
            ]
        );
        assert!(paths_from_args(["/usr/bin/uwunotes"], cwd).is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn command_line_paths_on_windows() {
        use super::paths_from_args;
        use std::path::Path;

        let paths = paths_from_args(
            [
                r"C:\Program Files\UwUNotes\uwunotes.exe",
                r"C:\notes\a.txt",
                "b.md",
            ],
            Path::new(r"D:\work"),
        );
        assert_eq!(
            paths,
            [
                PathBuf::from(r"C:\notes\a.txt"),
                PathBuf::from(r"D:\work\b.md")
            ]
        );
    }
}
