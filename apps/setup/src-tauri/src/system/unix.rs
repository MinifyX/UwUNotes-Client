//! macOS and Linux underneath the setup: starting programs, finding the ones
//! that are running, the one link that may leave the window, and the message a
//! silent run can still show.
//!
//! No `libc` and no Objective-C: everything here is either the standard library
//! or one of the system's own tools, started by its full path where the system
//! has a standard one (`/usr/bin/open`, `/bin/ps`, `/usr/bin/osascript`). The
//! Linux helpers that may or may not be installed — `xdg-open`, `zenity`,
//! `kdialog`, `update-desktop-database` — are looked up on the `PATH`, because
//! there is no one place a distribution puts them, and every one of them is
//! optional: a missing one costs a convenience, never an installation.
//!
//! What this module deliberately does not do: end a process. The same rule as
//! on Windows — [`running`] only ever counts, and closing a window with unsaved
//! text in it is the user's decision.

use std::ffi::OsStr;
use std::os::unix::process::CommandExt as _;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use super::is_web_link;

/// The user's home folder, from `$HOME`, and only when it is an absolute path.
/// A relative or empty one would put UwUNotes somewhere under whatever folder
/// the setup happened to be started from.
pub fn home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|home| home.is_absolute())
}

/// Starts a program without waiting for it, in a process group of its own, so
/// that closing the terminal a setup was started from does not take the editor
/// down with it.
pub fn spawn_detached(exe: &Path, arguments: &[&str]) -> Result<(), String> {
    Command::new(exe)
        .args(arguments)
        .current_dir(exe.parent().unwrap_or_else(|| Path::new("/")))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Couldn't start {}: {error}", exe.display()))
}

/// Runs one of the system's helpers and waits for it, saying nothing either
/// way. For the tools that make an installation show up sooner — the desktop
/// database, the icon cache, Launch Services — which are nice to have and
/// never a reason for an install to fail.
pub fn run_quietly(program: impl AsRef<OsStr>, arguments: &[&OsStr]) {
    let _ = Command::new(program)
        .args(arguments)
        .current_dir("/")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

/// Opens an app bundle the way Finder does. `open` rather than the executable
/// inside it, so macOS starts it as an app — with its Dock icon, its menu bar
/// and its place in Launch Services — and not as a bare process.
#[cfg(target_os = "macos")]
pub fn open_bundle(bundle: &Path) -> Result<(), String> {
    let status = Command::new("/usr/bin/open")
        .arg(bundle)
        .current_dir("/")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|error| format!("Couldn't start {}: {error}", bundle.display()))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("Couldn't start {} ({status}).", bundle.display()))
    }
}

/// Opens a link in the browser. `https` and nothing else, by the same rule as
/// on Windows; `open` and `xdg-open` both start programs just as happily as
/// they open pages, which is the reason for the rule.
pub fn open_link(url: &str) -> Result<(), String> {
    if !is_web_link(url) {
        return Err("Only https links open from the setup.".into());
    }
    let opener = if cfg!(target_os = "macos") {
        "/usr/bin/open"
    } else {
        "xdg-open"
    };
    Command::new(opener)
        .arg(url)
        .current_dir("/")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|_| "The link couldn't be opened.".to_owned())
}

/// The only way a silent update can say anything. It has no window, the editor
/// that started it has closed itself, and "nothing happened" is not an answer.
/// On Linux it is whichever dialog tool the desktop has, and the terminal when
/// it has none.
pub fn alert(title: &str, text: &str) {
    eprintln!("{title}: {text}");
    #[cfg(target_os = "macos")]
    {
        // The texts go in as arguments to the script, never into its source:
        // an error message with a quote in it must not become AppleScript.
        run_quietly(
            "/usr/bin/osascript",
            &[
                OsStr::new("-e"),
                OsStr::new("on run argv"),
                OsStr::new("-e"),
                OsStr::new("display alert (item 1 of argv) message (item 2 of argv) as critical"),
                OsStr::new("-e"),
                OsStr::new("end run"),
                OsStr::new(title),
                OsStr::new(text),
            ],
        );
    }
    #[cfg(target_os = "linux")]
    {
        // `--no-markup`, because zenity reads its text as Pango markup
        // otherwise, and a path with a `<` in it would be shown as something
        // else or not at all.
        let shown = Command::new("zenity")
            .args(["--error", "--no-markup"])
            .arg(format!("--title={title}"))
            .arg(format!("--text={text}"))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success() || status.code() == Some(1));
        if !shown {
            run_quietly(
                "kdialog",
                &[
                    OsStr::new("--title"),
                    OsStr::new(title),
                    OsStr::new("--error"),
                    OsStr::new(text),
                ],
            );
        }
    }
}

/// Whether the system language is German, which is what the setup's own
/// messages pick their wording by. The page has its texts; these are the few
/// sentences that appear when there is no page.
pub fn is_german() -> bool {
    // POSIX order: the first of these that is set is the one that counts.
    let from_environment = ["LC_ALL", "LC_MESSAGES", "LANG"]
        .iter()
        .filter_map(|name| std::env::var(name).ok())
        .find(|value| !value.is_empty());
    if let Some(locale) = from_environment {
        return locale.to_ascii_lowercase().starts_with("de");
    }
    // An app started from Finder has no `LANG`; macOS keeps the language list
    // in its own defaults instead.
    #[cfg(target_os = "macos")]
    {
        let languages = Command::new("/usr/bin/defaults")
            .args(["read", "-g", "AppleLanguages"])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output();
        if let Ok(output) = languages {
            return first_apple_language(&String::from_utf8_lossy(&output.stdout))
                .is_some_and(|language| language.to_ascii_lowercase().starts_with("de"));
        }
    }
    false
}

/// The first entry of what `defaults read -g AppleLanguages` prints, which is
/// an old-style property list: `(\n    "de-DE",\n    "en-US"\n)`.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn first_apple_language(listing: &str) -> Option<String> {
    listing
        .trim()
        .strip_prefix('(')?
        .split(',')
        .next()
        .map(|first| first.trim().trim_end_matches(')').trim().trim_matches('"'))
        .filter(|first| !first.is_empty())
        .map(str::to_owned)
}

/// Whether a process with this id is still there.
fn process_exists(pid: u32) -> bool {
    #[cfg(target_os = "linux")]
    {
        Path::new("/proc").join(pid.to_string()).exists()
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("/bin/ps")
            .args(["-p", &pid.to_string(), "-o", "pid="])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
    }
}

/// Waits for one process to end; `true` when it did, and when it was already
/// gone before the wait started.
pub fn wait_for_exit(pid: u32, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if !process_exists(pid) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

/// The processes whose executable `wanted` says yes to — never this one, or a
/// reinstall would wait for itself.
///
/// On Linux that is `/proc/<pid>/exe`, which the kernel keeps and nobody else
/// can phrase differently. A program whose file has been replaced while it ran
/// reads as `<path> (deleted)` there, and is still the same program. On macOS
/// it is what `ps` says each process was started as, which for an app is the
/// full path of the executable inside its bundle.
pub fn running(wanted: impl Fn(&Path) -> bool) -> Vec<u32> {
    let me = std::process::id();
    let mut found = Vec::new();
    #[cfg(target_os = "linux")]
    {
        let Ok(entries) = std::fs::read_dir("/proc") else {
            return found;
        };
        for entry in entries.flatten() {
            let Some(pid) = entry
                .file_name()
                .to_str()
                .and_then(|name| name.parse::<u32>().ok())
            else {
                continue;
            };
            let Ok(exe) = std::fs::read_link(entry.path().join("exe")) else {
                continue;
            };
            let exe = exe
                .to_str()
                .and_then(|path| path.strip_suffix(" (deleted)"))
                .map_or(exe.clone(), PathBuf::from);
            if pid != me && wanted(&exe) {
                found.push(pid);
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        let Ok(output) = Command::new("/bin/ps")
            .args(["-axww", "-o", "pid=,comm="])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
        else {
            return found;
        };
        for (pid, exe) in String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(parse_ps_line)
        {
            if pid != me && wanted(Path::new(exe)) {
                found.push(pid);
            }
        }
    }
    found
}

/// One line of `ps -o pid=,comm=`: the id, padded on the left, and the rest of
/// the line — which may itself contain spaces — as the command.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_ps_line(line: &str) -> Option<(u32, &str)> {
    let (pid, command) = line.trim_start().split_once(' ')?;
    Some((pid.parse().ok()?, command.trim()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_first_language_macos_prefers_is_read_off_its_listing() {
        assert_eq!(
            first_apple_language("(\n    \"de-DE\",\n    \"en-US\"\n)\n").as_deref(),
            Some("de-DE")
        );
        assert_eq!(first_apple_language("(\n    en\n)").as_deref(), Some("en"));
        assert_eq!(first_apple_language("").as_deref(), None);
        assert_eq!(first_apple_language("()").as_deref(), None);
    }

    #[test]
    fn a_line_of_ps_keeps_the_spaces_inside_the_path() {
        assert_eq!(
            parse_ps_line("  812 /Users/nyu/My Apps/UwUNotes.app/Contents/MacOS/UwUNotes"),
            Some((
                812,
                "/Users/nyu/My Apps/UwUNotes.app/Contents/MacOS/UwUNotes"
            ))
        );
        assert_eq!(parse_ps_line("PID COMM"), None);
        assert_eq!(parse_ps_line(""), None);
    }

    /// The setup itself must never turn up in the list of programs it would
    /// wait for, or a reinstall would wait for itself.
    #[test]
    fn the_running_setup_is_not_one_of_the_processes_it_looks_for() {
        let me = std::env::current_exe().expect("the test binary");
        assert!(!running(|exe| exe == me).contains(&std::process::id()));
    }

    #[test]
    fn this_process_exists_and_waiting_for_it_times_out() {
        assert!(process_exists(std::process::id()));
        assert!(!wait_for_exit(
            std::process::id(),
            Duration::from_millis(10)
        ));
    }
}
