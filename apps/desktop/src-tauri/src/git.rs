//! The letters next to file names in the tree, when the folder happens to be a
//! git repository.
//!
//! This is a nicety and behaves like one: it shells out to whatever `git` is on
//! the PATH, and every way that can go wrong — no git installed, not a
//! repository, a git that answers in a format we do not recognise — comes back
//! as `None` rather than as an error. An editor that refuses to show a file
//! tree because git is missing would be a worse editor.
//!
//! What this module deliberately does not do: anything that writes. No staging,
//! no committing, no fetching. UwUNotes reads git's opinion and colours a few
//! rows with it.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;

/// Windows creates a console for a child process unless told not to, and a
/// status poll every few seconds would flash a black box over the editor.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum GitFileStatus {
    Added,
    Modified,
    Deleted,
    Untracked,
    Conflicted,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitStatuses {
    /// The repository root, which is not always the folder the user opened.
    root: String,
    /// `None` on a detached HEAD, where there is no branch name to show.
    branch: Option<String>,
    /// Absolute path to status, for the files git has something to say about.
    /// A `BTreeMap` so two polls of an unchanged tree produce the same object
    /// and the page's diffing has nothing to do.
    files: BTreeMap<String, GitFileStatus>,
}

/// Git's opinion of `root`, or `null` when there is none to be had.
#[tauri::command]
pub(crate) async fn git_statuses(root: String) -> Option<GitStatuses> {
    tauri::async_runtime::spawn_blocking(move || statuses(Path::new(&root)))
        .await
        .ok()
        .flatten()
}

fn statuses(folder: &Path) -> Option<GitStatuses> {
    let repository = PathBuf::from(text(&git(folder, &["rev-parse", "--show-toplevel"])?)?);
    if repository.as_os_str().is_empty() {
        return None;
    }

    let branch = git(folder, &["rev-parse", "--abbrev-ref", "HEAD"])
        .and_then(|output| text(&output))
        // A detached HEAD literally answers "HEAD", which is not a branch name
        // and would read as one in the status bar.
        .filter(|branch| !branch.is_empty() && branch.as_str() != "HEAD");

    // `-z` because it is the only format in which a file name containing a
    // quote, a newline or a non-UTF-8 byte survives intact.
    let porcelain = git(folder, &["status", "--porcelain", "-z"])?;

    Some(GitStatuses {
        root: display_path(&repository),
        branch,
        files: parse_porcelain(&repository, &porcelain),
    })
}

/// Runs one git command in `folder`. `None` for a git that is not installed, a
/// folder that is not a repository, or any other non-zero exit.
fn git(folder: &Path, arguments: &[&str]) -> Option<Vec<u8>> {
    let mut command = Command::new("git");
    command
        // `-C` rather than `current_dir`, so a folder that has been deleted
        // fails as a git error instead of as a spawn error.
        .arg("-C")
        .arg(folder)
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    hide_console(&mut command);

    let output = command.output().ok()?;
    output.status.success().then_some(output.stdout)
}

/// One line of git output as a trimmed `String`, or `None` when it was not text.
fn text(output: &[u8]) -> Option<String> {
    std::str::from_utf8(output)
        .ok()
        .map(|line| line.trim().to_owned())
}

/// Splits `git status --porcelain -z` into paths and statuses.
///
/// Every record is `XY <path>` terminated by a NUL, and a rename or copy adds a
/// second NUL-terminated field for where the file came from. Git's own
/// documentation is the authority on the order: with `-z` the current path
/// comes first and the original second, which is the reverse of the readable
/// format's `old -> new`.
fn parse_porcelain(repository: &Path, output: &[u8]) -> BTreeMap<String, GitFileStatus> {
    let mut files = BTreeMap::new();
    let mut records = output
        .split(|byte| *byte == 0)
        .filter(|field| !field.is_empty());

    while let Some(record) = records.next() {
        // Two status letters, a space, and at least one character of path.
        let [index, worktree, b' ', path @ ..] = record else {
            continue;
        };
        if path.is_empty() {
            continue;
        }

        if is_move(*index) || is_move(*worktree) {
            // Where the file came from. Git wants us to know; the tree does not.
            records.next();
        }

        // Porcelain paths are relative to the repository root and always use
        // forward slashes; the page compares them against paths from
        // `list_dir`, so they have to come out in the platform's own spelling.
        let relative = String::from_utf8_lossy(path).into_owned();
        files.insert(
            display_path(&repository.join(relative)),
            classify(*index, *worktree),
        );
    }

    files
}

const fn is_move(code: u8) -> bool {
    matches!(code, b'R' | b'C')
}

/// Two status letters into the one word the tree shows. The order of the arms
/// is the order of the user's interest: a conflict matters more than the fact
/// that the file is also modified.
const fn classify(index: u8, worktree: u8) -> GitFileStatus {
    match (index, worktree) {
        (b'?', _) | (_, b'?') => GitFileStatus::Untracked,
        (b'U', _) | (_, b'U') | (b'A', b'A') | (b'D', b'D') => GitFileStatus::Conflicted,
        (b'A', _) => GitFileStatus::Added,
        (b'D', _) | (_, b'D') => GitFileStatus::Deleted,
        _ => GitFileStatus::Modified,
    }
}

/// Absolute, and with the separators this platform uses. Deliberately not
/// `canonicalize`: that resolves symlinks and, on Windows, hands back the
/// `\\?\` form nobody wants to read.
fn display_path(path: &Path) -> String {
    std::path::absolute(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .into_owned()
}

#[cfg(windows)]
fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt as _;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console(_command: &mut Command) {}

#[cfg(test)]
mod tests {
    use super::{classify, parse_porcelain, GitFileStatus};
    use std::path::Path;

    #[test]
    fn a_rename_does_not_leave_its_old_path_in_the_tree() {
        let output = b"R  src/new.rs\0src/old.rs\0 M src/other.rs\0";
        let files = parse_porcelain(Path::new("/repo"), output);

        assert_eq!(files.len(), 2);
        let mentions_the_old_name = files.keys().any(|path| path.contains("old.rs"));
        assert!(!mentions_the_old_name, "{files:?}");
    }

    #[test]
    fn the_codes_that_matter_most_win() {
        assert_eq!(classify(b'?', b'?'), GitFileStatus::Untracked);
        assert_eq!(classify(b'D', b'D'), GitFileStatus::Conflicted);
        assert_eq!(classify(b'A', b'U'), GitFileStatus::Conflicted);
        assert_eq!(classify(b'A', b' '), GitFileStatus::Added);
        assert_eq!(classify(b' ', b'D'), GitFileStatus::Deleted);
        assert_eq!(classify(b'M', b' '), GitFileStatus::Modified);
    }
}
