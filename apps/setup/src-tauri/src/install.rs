//! Putting UwUNotes on a machine, taking it off again — the half of that which
//! is the same on every system.
//!
//! Everything is per user and needs no administrator, on every system: on
//! Windows the editor goes to `%LOCALAPPDATA%\Programs\UwUNotes`, on macOS to
//! `~/Applications/UwUNotes.app`, on Linux to `~/.local/share/uwunotes`. The
//! editor itself is packed into this executable by `build.rs`; nothing is
//! downloaded while installing.
//!
//! This file is what does not care which system it is on: the errors the page
//! branches on, the progress bar, the packed editor and how it comes back out,
//! and the rule that an update never goes backwards. Where things go and what a
//! system needs written to know about them is one module per system beside
//! this one — [`windows`] for the registry and the Start menu, `macos` for the
//! app bundle, `linux` for the XDG folders and the desktop entry — and each of
//! them offers the same handful of names: [`Layout`], [`install()`],
//! [`uninstall()`], [`wait_for_app_to_close`] and [`launch`]. `app.rs` only
//! ever talks to those, so the page and the command line behave the same
//! everywhere.
//!
//! `UWUNOTES_SETUP_SANDBOX=<folder>` moves all of it — files, shortcuts,
//! registry, desktop entries — under one folder of its own. That is what makes
//! the tests possible: they install, update and uninstall for real, on the
//! machine running them, without a real installation anywhere near them.
//!
//! What this module deliberately does not do: end the running editor. An
//! installer that kills a text editor with unsaved text in it is a data-loss
//! bug with a progress bar, so a copy that is still open is reported as
//! [`Kind::InUse`] and the user decides. The one exception is an update the app
//! itself started — by then the app has already written its session and closed
//! itself, and [`wait_for_app_to_close`] only waits for the process to go.
//!
//! It also leaves the editor's data folder alone, every time but the one
//! uninstall that is explicitly told not to: the session, the drafts and the
//! settings live there, and none of them are this setup's to throw away.

use std::io::{self, Read, Write as _};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(unix)]
mod unix;
#[cfg(windows)]
mod windows;

// `self::` because `windows` is also the name of a crate, and a bare `windows`
// here would be ambiguous between the two.
#[cfg(target_os = "linux")]
use self::linux as platform;
#[cfg(target_os = "macos")]
use self::macos as platform;
#[cfg(windows)]
use self::windows as platform;

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
compile_error!("UwUNotes Setup knows Windows, macOS and Linux, and nothing else yet.");

pub use self::platform::{install, launch, uninstall, wait_for_app_to_close, Layout};

static PAYLOAD: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/payload.zst"));
const PAYLOAD_SIZE: &str = env!("UWUNOTES_SETUP_PAYLOAD_SIZE");
/// `file` for one executable packed as it is, `tree` for a folder packed as a
/// tar archive — the macOS app bundle. See `build.rs`.
const PAYLOAD_KIND: &str = env!("UWUNOTES_SETUP_PAYLOAD_KIND");

/// Whether this build has an editor in it. A setup built without one — a
/// `cargo check`, a run of the tests, someone working on the page — can do
/// everything except the one thing that matters, and the page says so rather
/// than letting the user press a button that cannot work.
pub fn has_payload() -> bool {
    !PAYLOAD.is_empty()
}

/// What the page branches on. `message` is the detail line underneath; it is
/// English and factual, in the same spirit as `FsError` in the editor, because
/// the German belongs to the page, which has the kind to choose it by.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupError {
    pub kind: Kind,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    /// UwUNotes is still open, so its own file cannot be replaced.
    InUse,
    Permission,
    DiskFull,
    /// The packed editor is older than the installed one, or it cannot be told
    /// which one is installed. Only an update refuses for this.
    OlderVersion,
    /// Built without an editor inside.
    NoPayload,
    Other,
}

impl SetupError {
    fn new(kind: Kind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn other(message: impl Into<String>) -> Self {
        Self::new(Kind::Other, message)
    }

    /// An error from the operating system, with the kind it maps to.
    fn from_io(error: &io::Error, message: impl Into<String>) -> Self {
        Self::new(classify(error), format!("{}: {error}", message.into()))
    }
}

/// Which kind an operating-system error belongs to.
///
/// The numbers are Windows' own: 5 `ERROR_ACCESS_DENIED`, 32
/// `ERROR_SHARING_VIOLATION`, 33 `ERROR_LOCK_VIOLATION`, 39
/// `ERROR_HANDLE_DISK_FULL`, 112 `ERROR_DISK_FULL`.
#[cfg(windows)]
fn classify(error: &io::Error) -> Kind {
    match error.raw_os_error() {
        Some(32 | 33) => Kind::InUse,
        Some(39 | 112) => Kind::DiskFull,
        Some(5) => Kind::Permission,
        _ if error.kind() == io::ErrorKind::PermissionDenied => Kind::Permission,
        _ => Kind::Other,
    }
}

/// The same question on Linux and macOS, which agree on every number that
/// matters here: 1 `EPERM`, 13 `EACCES`, 26 `ETXTBSY` (a running program's
/// file opened for writing), 28 `ENOSPC`, 30 `EROFS` and 69 / 122 `EDQUOT`
/// (macOS and Linux spell the quota error with different numbers).
#[cfg(unix)]
fn classify(error: &io::Error) -> Kind {
    let quota = if cfg!(target_os = "macos") { 69 } else { 122 };
    match error.raw_os_error() {
        Some(26) => Kind::InUse,
        Some(28) => Kind::DiskFull,
        Some(code) if code == quota => Kind::DiskFull,
        Some(1 | 13 | 30) => Kind::Permission,
        _ if error.kind() == io::ErrorKind::PermissionDenied => Kind::Permission,
        _ => Kind::Other,
    }
}

/// What the page sends when the user presses the button.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    pub folder: String,
    pub desktop_shortcut: bool,
    /// Start the editor once everything is written. The finish page's own
    /// button is `launch_installed_app` instead; this is for the silent update,
    /// which has no page to press anything on.
    pub launch_when_done: bool,
}

/// Where the editor ended up, for the page's last screen.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub folder: String,
    pub exe: String,
}

/// One step of the work, and how far the whole job has got.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub step: Step,
    /// 0 to 100 over the whole install, not over the step.
    pub percent: f64,
}

/// The steps, by what they are on Windows. The names are the page's contract
/// and stay the same everywhere; what `shortcuts` and `registry` mean on the
/// other systems — a menu entry, an alias, the record of what was installed —
/// is the page's to word, and `texts.ts` does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Step {
    Preparing,
    Writing,
    Shortcuts,
    Registry,
    Done,
}

/// How much of the bar each step is worth. Unpacking the editor is the only
/// part that takes measurable time, and it is the only one that can report
/// anything finer than "started" and "finished".
const WEIGHTS: &[(Step, f64)] = &[
    (Step::Preparing, 8.0),
    (Step::Writing, 72.0),
    (Step::Shortcuts, 8.0),
    (Step::Registry, 12.0),
];

/// Turns "this far through that step" into one number that only ever grows.
struct Reporter<'a> {
    sink: &'a mut dyn FnMut(Progress),
    last: f64,
}

impl<'a> Reporter<'a> {
    fn new(sink: &'a mut dyn FnMut(Progress)) -> Self {
        Self { sink, last: -1.0 }
    }

    fn at(&mut self, step: Step, within: f64) {
        let mut percent = 0.0;
        for (candidate, weight) in WEIGHTS {
            if *candidate == step {
                percent += weight * within.clamp(0.0, 1.0);
                break;
            }
            percent += weight;
        }
        if step == Step::Done {
            percent = 100.0;
        }
        // A bar cannot draw finer than a percent, and unpacking would otherwise
        // send a few thousand messages for one editor.
        if percent - self.last < 1.0 && step != Step::Done {
            return;
        }
        self.last = percent;
        (self.sink)(Progress { step, percent });
    }
}

/// The editor this setup carries, and the file that becomes the uninstaller.
///
/// A parameter rather than a constant so the tests can install something small
/// and quick. [`Package::packed`] is what every real run uses.
pub struct Package<'a> {
    payload: &'a [u8],
    /// Unpacked size, which is the denominator of the progress bar. For a
    /// folder it is the size of the tar stream, not of the files in it: that is
    /// the number that can be counted while unpacking, and checked afterwards.
    size: u64,
    /// The running setup. It is copied next to the installation, where it is
    /// the uninstaller: same program, started with `--uninstall`.
    setup: PathBuf,
}

impl Package<'static> {
    pub fn packed() -> Result<Self, SetupError> {
        if PAYLOAD.is_empty() {
            return Err(SetupError::new(
                Kind::NoPayload,
                "This setup was built without UwUNotes inside (a development build).",
            ));
        }
        // A build that packed the wrong shape — an exe into the macOS setup, an
        // app bundle into the Windows one — is a build-script mistake, and it
        // is better said here than as "damaged" halfway through unpacking.
        let expected = if cfg!(target_os = "macos") {
            "tree"
        } else {
            "file"
        };
        if PAYLOAD_KIND != expected {
            return Err(SetupError::other(format!(
                "This setup carries a {PAYLOAD_KIND} where this system needs a {expected}; it was built for another system."
            )));
        }
        Ok(Self {
            payload: PAYLOAD,
            size: PAYLOAD_SIZE.parse().unwrap_or(0),
            setup: std::env::current_exe()
                .map_err(|error| SetupError::from_io(&error, "Couldn't find the setup program"))?,
        })
    }
}

/// What is installed on this machine right now.
#[derive(Debug, Clone)]
pub struct Existing {
    pub folder: PathBuf,
    /// `None` when there is an installation whose version cannot be read. An
    /// update refuses that case rather than guessing — see [`check_not_older`].
    pub version: Option<String>,
    /// Put there by the stock NSIS installer rather than by this setup. Only
    /// ever `true` on Windows: no other system had a stock installer before.
    #[cfg_attr(not(windows), allow(dead_code))]
    pub legacy: bool,
}

/// An update must never replace a newer UwUNotes with an older one. The
/// signature on a setup says it came from this project; it says nothing about
/// which version it is, so a feed serving an old build would otherwise be a
/// downgrade nobody asked for.
///
/// It fails closed: when something is installed but its version cannot be read,
/// an update does not happen. Running the setup by hand still installs — that is
/// a person deciding, which is a different thing from a feed deciding.
///
/// Nothing installed is not that case. A silent run that finds no installation
/// is an install, and refusing it would turn every route that leaves no trace
/// this setup recognises — an MSI, which keeps its own product key; a folder
/// somebody moved; a plain `/S` out of a script — into a dialog saying the
/// version is unclear when the truth is that there is no version at all.
/// Installing is not a downgrade, so there is nothing here to fail closed about.
pub fn check_not_older(installed: Option<&str>, packed: &str) -> Result<(), SetupError> {
    let parse = |version: &str| semver::Version::parse(version.trim()).ok();
    let unclear = || {
        SetupError::new(
            Kind::OlderVersion,
            "It isn't clear which version of UwUNotes is installed, so the update was skipped. Run the setup by hand instead.",
        )
    };
    let Some(packed) = parse(packed) else {
        // Our own version, out of our own Cargo manifest. Unreachable short of
        // a build that shipped something semver cannot read.
        return Err(unclear());
    };
    let Some(installed) = installed else {
        return Ok(());
    };
    match parse(installed) {
        Some(installed) if packed < installed => Err(SetupError::new(
            Kind::OlderVersion,
            format!(
                "UwUNotes {installed} is already installed. This update is older ({packed}), so it was skipped."
            ),
        )),
        Some(_) => Ok(()),
        None => Err(unclear()),
    }
}

/// A half-written file's new name. On Unix a stale one is removed first and the
/// new one created exclusively, so a symlink somebody left under that name is
/// replaced rather than written through; the mode is the one the finished file
/// is meant to have, not whatever the umask makes of 0666.
fn create_incoming(path: &Path, #[allow(unused_variables)] mode: u32) -> io::Result<std::fs::File> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        match std::fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(mode)
            .open(path)
    }
    #[cfg(windows)]
    {
        std::fs::File::create(path)
    }
}

/// Counts what passes through, and tells the bar about it.
struct Counted<'r, 'a, R> {
    inner: R,
    read: u64,
    total: u64,
    report: &'r mut Reporter<'a>,
}

impl<R: Read> Read for Counted<'_, '_, R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let read = self.inner.read(buffer)?;
        self.read += read as u64;
        self.report
            .at(Step::Writing, self.read as f64 / self.total.max(1) as f64);
        Ok(read)
    }
}

fn damaged(error: impl std::fmt::Display) -> SetupError {
    SetupError::other(format!("The packed editor is damaged: {error}"))
}

fn incomplete() -> SetupError {
    SetupError::other("The packed editor is incomplete; the setup file is damaged.")
}

/// Unpacks the editor to `target`, reporting how far it has got. For the
/// payloads that are one executable: Windows and Linux.
#[cfg_attr(target_os = "macos", allow(dead_code))]
fn extract(package: &Package, target: &Path, report: &mut Reporter) -> Result<(), SetupError> {
    let decoder = zstd::Decoder::new(package.payload).map_err(damaged)?;
    let mut source = Counted {
        inner: decoder,
        read: 0,
        total: package.size,
        report,
    };
    let mut file = create_incoming(target, 0o755).map_err(|error| {
        SetupError::from_io(&error, format!("Couldn't write {}", target.display()))
    })?;
    let mut buffer = vec![0u8; 256 * 1024];
    loop {
        let read = source.read(&mut buffer).map_err(damaged)?;
        if read == 0 {
            break;
        }
        let chunk = buffer.get(..read).unwrap_or_default();
        file.write_all(chunk).map_err(|error| {
            SetupError::from_io(&error, format!("Couldn't write {}", target.display()))
        })?;
    }
    file.sync_all().map_err(|error| {
        SetupError::from_io(&error, format!("Couldn't write {}", target.display()))
    })?;
    if source.read != package.size {
        return Err(incomplete());
    }
    Ok(())
}

/// Unpacks a packed folder into `into`, which must exist and be empty. For the
/// macOS app bundle, which is a folder with an executable in it and has to
/// come out with the executable bit still on.
///
/// The archive is this setup's own, built by `build.rs` and carried inside the
/// signed executable, so this is not a general-purpose unpacker for strangers'
/// archives — but the `tar` crate refuses entries that would land outside
/// `into` all the same, and nothing here asks it not to.
#[cfg(unix)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn extract_tree(package: &Package, into: &Path, report: &mut Reporter) -> Result<(), SetupError> {
    let decoder = zstd::Decoder::new(package.payload).map_err(damaged)?;
    let source = Counted {
        inner: decoder,
        read: 0,
        total: package.size,
        report,
    };
    let mut archive = tar::Archive::new(source);
    archive.set_preserve_permissions(true);
    // `build.rs` packs with deterministic headers, whose timestamps are one
    // fixed date in 2006. A bundle that claims to be that old is one Launch
    // Services has no reason to look at again, so the files get today's.
    archive.set_preserve_mtime(false);
    archive.set_unpack_xattrs(false);
    archive.set_overwrite(false);
    archive.unpack(into).map_err(|error| {
        SetupError::from_io(
            &error,
            format!("Couldn't unpack UwUNotes into {}", into.display()),
        )
    })?;
    // The archive ends with padding the unpacker has no reason to read; it is
    // part of what `build.rs` counted, so it is read here to make the sizes
    // comparable.
    let mut rest = archive.into_inner();
    io::copy(&mut rest, &mut io::sink()).map_err(damaged)?;
    if rest.read != package.size {
        return Err(incomplete());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_update_to_an_older_version_is_refused() {
        let refused = check_not_older(Some("0.3.0"), "0.2.0").expect_err("a downgrade");
        assert_eq!(refused.kind, Kind::OlderVersion);
        assert!(refused.message.contains("0.3.0"));

        assert!(check_not_older(Some("0.3.0"), "0.3.0-rc.1").is_err());
        assert!(check_not_older(Some("0.2.0"), "0.3.0").is_ok());
        assert!(check_not_older(Some("0.3.0-rc.1"), "0.3.0").is_ok());
        assert!(
            check_not_older(Some("0.3.0"), "0.3.0").is_ok(),
            "installing the same version again is a repair, not a downgrade"
        );
    }

    #[test]
    fn an_update_is_refused_when_the_installed_version_cannot_be_read() {
        for installed in [Some(""), Some("unknown"), Some("0.2")] {
            let refused = check_not_older(installed, "0.3.0")
                .expect_err(&format!("{installed:?} is not a version"));
            assert_eq!(refused.kind, Kind::OlderVersion);
        }
    }

    /// Found by running a silent setup against an empty sandbox: it refused,
    /// saying the installed version was unclear, when there was no installation
    /// at all. The same path is what an MSI install, a moved folder or a `/S`
    /// out of somebody's script looks like from in here.
    #[test]
    fn a_silent_run_with_nothing_installed_is_an_install_not_a_refusal() {
        assert!(check_not_older(None, "0.3.0").is_ok());
        assert!(check_not_older(None, "0.2.0").is_ok());
    }

    #[test]
    fn the_bar_only_ever_moves_forward_and_ends_at_a_hundred() {
        let mut seen = Vec::new();
        let mut sink = |progress: Progress| seen.push(progress.percent);
        let mut report = Reporter::new(&mut sink);
        report.at(Step::Preparing, 0.0);
        report.at(Step::Writing, 0.5);
        report.at(Step::Writing, 0.2);
        report.at(Step::Registry, 1.0);
        report.at(Step::Done, 1.0);
        assert!(seen.windows(2).all(|pair| pair[1] >= pair[0]), "{seen:?}");
        assert_eq!(seen.last(), Some(&100.0));
    }

    #[cfg(windows)]
    #[test]
    fn errors_from_windows_become_the_kinds_the_page_branches_on() {
        let kind = |code| classify(&io::Error::from_raw_os_error(code));
        assert_eq!(kind(32), Kind::InUse, "ERROR_SHARING_VIOLATION");
        assert_eq!(kind(33), Kind::InUse, "ERROR_LOCK_VIOLATION");
        assert_eq!(kind(112), Kind::DiskFull, "ERROR_DISK_FULL");
        assert_eq!(kind(39), Kind::DiskFull, "ERROR_HANDLE_DISK_FULL");
        assert_eq!(kind(5), Kind::Permission, "ERROR_ACCESS_DENIED");
        assert_eq!(kind(2), Kind::Other, "ERROR_FILE_NOT_FOUND");
        assert_eq!(
            classify(&io::Error::new(io::ErrorKind::PermissionDenied, "no")),
            Kind::Permission
        );
    }

    #[cfg(unix)]
    #[test]
    fn errors_from_unix_become_the_kinds_the_page_branches_on() {
        let kind = |code| classify(&io::Error::from_raw_os_error(code));
        assert_eq!(kind(26), Kind::InUse, "ETXTBSY");
        assert_eq!(kind(28), Kind::DiskFull, "ENOSPC");
        assert_eq!(kind(13), Kind::Permission, "EACCES");
        assert_eq!(kind(1), Kind::Permission, "EPERM");
        assert_eq!(kind(30), Kind::Permission, "EROFS");
        assert_eq!(kind(2), Kind::Other, "ENOENT");
    }

    #[test]
    fn the_shapes_the_page_reads_keep_their_names() {
        // `to_string` rather than `to_value`, which sorts the keys: the order
        // here is the order the fields are written in, which is the order the
        // page's own types are read in.
        assert_eq!(
            serde_json::to_string(&Progress {
                step: Step::Writing,
                percent: 42.5,
            })
            .unwrap(),
            r#"{"step":"writing","percent":42.5}"#
        );
        assert_eq!(
            serde_json::to_string(&Installed {
                folder: r"C:\UwUNotes".into(),
                exe: r"C:\UwUNotes\UwUNotes.exe".into(),
            })
            .unwrap(),
            r#"{"folder":"C:\\UwUNotes","exe":"C:\\UwUNotes\\UwUNotes.exe"}"#
        );
        assert_eq!(
            serde_json::to_string(&SetupError::new(Kind::InUse, "open")).unwrap(),
            r#"{"kind":"inUse","message":"open"}"#
        );
        for (kind, name) in [
            (Kind::InUse, "inUse"),
            (Kind::Permission, "permission"),
            (Kind::DiskFull, "diskFull"),
            (Kind::OlderVersion, "olderVersion"),
            (Kind::NoPayload, "noPayload"),
            (Kind::Other, "other"),
        ] {
            assert_eq!(serde_json::to_value(kind).unwrap(), name);
        }
        for (step, name) in [
            (Step::Preparing, "preparing"),
            (Step::Writing, "writing"),
            (Step::Shortcuts, "shortcuts"),
            (Step::Registry, "registry"),
            (Step::Done, "done"),
        ] {
            assert_eq!(serde_json::to_value(step).unwrap(), name);
        }
    }

    #[test]
    fn the_payload_is_labelled_with_a_shape_the_setup_knows() {
        // Empty in every build the tests run in, and then the kind is still
        // written down; the check in `Package::packed` must not refuse a real
        // payload because of how an empty one is labelled.
        assert!(matches!(PAYLOAD_KIND, "file" | "tree"), "{PAYLOAD_KIND}");
    }
}
