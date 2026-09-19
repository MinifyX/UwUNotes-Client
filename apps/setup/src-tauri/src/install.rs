//! Putting UwUNotes on a Windows machine, taking it off again, and clearing
//! away what the stock installer left behind.
//!
//! Everything is per user and needs no administrator: the editor goes to
//! `%LOCALAPPDATA%\Programs\UwUNotes`, the shortcuts into the Start menu (and
//! onto the desktop when asked), and the entry Windows lists under "Installed
//! apps" into `HKEY_CURRENT_USER`. The editor itself is packed into this
//! executable by `build.rs`; nothing is downloaded while installing.
//!
//! `UWUNOTES_SETUP_SANDBOX=<folder>` moves all of that — files, shortcuts and
//! registry — under one folder and one key of its own. That is what makes the
//! tests below possible: they install, update and uninstall for real, on the
//! machine running them, without a real installation anywhere near them.
//!
//! What this module deliberately does not do: end the running editor. An
//! installer that kills a text editor with unsaved text in it is a data-loss
//! bug with a progress bar, so a copy that is still open is reported as
//! [`Kind::InUse`] and the user decides. The one exception is an update the app
//! itself started — by then the app has already written its session and closed
//! itself, and [`wait_for_app_to_close`] only waits for the process to go.
//!
//! It also leaves `%APPDATA%\app.uwunotes.desktop` alone, every time but the
//! one uninstall that is explicitly told not to: the session, the drafts and
//! the settings live there, and none of them are this setup's to throw away.

use std::io::{self, Read as _, Write as _};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
use winreg::RegKey;

use crate::system;

pub const APP_EXE: &str = "UwUNotes.exe";
pub const UNINSTALL_EXE: &str = "uninstall.exe";
/// The app's bundle identifier, which is also the name of its data folder and
/// the id Windows groups its taskbar button under.
pub const APP_ID: &str = "app.uwunotes.desktop";
const SHORTCUT: &str = "UwUNotes.lnk";
const PRODUCT: &str = "UwUNotes";
const PUBLISHER: &str = "UwUNotes";
const HOMEPAGE: &str = "https://github.com/MinifyX/UwUNotes-Client";
const UNINSTALL_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\UwUNotes";
/// Everything this setup and the stock installer before it remember about the
/// installation. Removing this one key removes both.
const PRODUCT_KEY: &str = r"Software\UwUNotes";
const SETUP_KEY: &str = r"Software\UwUNotes\Setup";
/// What Tauri's stock NSIS installer called the editor in 0.1.0 and 0.2.0, and
/// where it kept the folder it had installed into. Both are still on the
/// machines of everyone who installed UwUNotes before this setup existed.
const LEGACY_EXE: &str = "uwunotes-desktop.exe";
const LEGACY_PRODUCT_KEY: &str = r"Software\UwUNotes\UwUNotes";
/// Half-written files carry these names until they are complete, so an install
/// that stops in the middle never leaves a broken `UwUNotes.exe` behind.
const INCOMING_APP: &str = "UwUNotes.exe.new";
const INCOMING_UNINSTALL: &str = "uninstall.exe.new";

static PAYLOAD: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/payload.zst"));
const PAYLOAD_SIZE: &str = env!("UWUNOTES_SETUP_PAYLOAD_SIZE");

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
fn classify(error: &io::Error) -> Kind {
    match error.raw_os_error() {
        Some(32 | 33) => Kind::InUse,
        Some(39 | 112) => Kind::DiskFull,
        Some(5) => Kind::Permission,
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

impl Reporter<'_> {
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

/// The editor this setup carries, and the file that becomes `uninstall.exe`.
///
/// A parameter rather than a constant so the tests can install something small
/// and quick. [`Package::packed`] is what every real run uses.
pub struct Package<'a> {
    payload: &'a [u8],
    /// Unpacked size, which is the denominator of the progress bar.
    size: u64,
    /// The running setup. It is copied into the install folder, where it is the
    /// uninstaller: same program, started with `--uninstall`.
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
    /// Put there by the stock NSIS installer rather than by this setup.
    pub legacy: bool,
}

/// Where everything belongs on this machine, or inside the sandbox.
pub struct Layout {
    pub default_folder: PathBuf,
    pub start_menu: PathBuf,
    pub desktop: PathBuf,
    /// `%APPDATA%\app.uwunotes.desktop` — the session, the drafts, the settings.
    pub app_data: PathBuf,
    /// `%LOCALAPPDATA%\app.uwunotes.desktop` — the editor's WebView cache.
    pub local_data: PathBuf,
    /// Where the stock installer put UwUNotes: `%LOCALAPPDATA%\UwUNotes`.
    pub legacy_folder: PathBuf,
    registry_prefix: String,
    pub sandbox: bool,
}

impl Layout {
    pub fn detect() -> Self {
        match std::env::var_os("UWUNOTES_SETUP_SANDBOX").filter(|folder| !folder.is_empty()) {
            Some(folder) => Self::sandbox(Path::new(&folder)),
            None => {
                let folders = system::folders();
                Self {
                    default_folder: folders.user_programs.join(PRODUCT),
                    start_menu: folders.start_menu,
                    desktop: folders.desktop,
                    app_data: folders.roaming.join(APP_ID),
                    local_data: folders.local.join(APP_ID),
                    legacy_folder: folders.local.join(PRODUCT),
                    registry_prefix: String::new(),
                    sandbox: false,
                }
            }
        }
    }

    /// The same layout, moved into one folder and one registry key that belong
    /// to nobody. Nothing outside `root` and that key is touched.
    pub fn sandbox(root: &Path) -> Self {
        Self {
            default_folder: root.join(r"Programs\UwUNotes"),
            start_menu: root.join("StartMenu"),
            desktop: root.join("Desktop"),
            app_data: root.join("Roaming").join(APP_ID),
            local_data: root.join("Local").join(APP_ID),
            legacy_folder: root.join(r"Local\UwUNotes"),
            registry_prefix: format!(
                r"Software\UwUNotes-Setup-Sandbox\{}\",
                root.file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_default()
            ),
            sandbox: true,
        }
    }

    fn key(&self, path: &str) -> String {
        format!("{}{path}", self.registry_prefix)
    }

    fn open(&self, path: &str) -> Option<RegKey> {
        RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags(self.key(path), KEY_READ)
            .ok()
    }

    fn create(&self, path: &str) -> Result<RegKey, String> {
        RegKey::predef(HKEY_CURRENT_USER)
            .create_subkey(self.key(path))
            .map(|(key, _)| key)
            .map_err(|error| format!("Couldn't write to the registry ({path}): {error}"))
    }

    fn remove_tree(&self, path: &str) {
        let _ = RegKey::predef(HKEY_CURRENT_USER).delete_subkey_all(self.key(path));
    }

    /// What is installed right now, if anything: this setup's own installation
    /// first, then the one the stock installer may have left.
    pub fn existing(&self) -> Option<Existing> {
        if let Some(key) = self.open(SETUP_KEY) {
            if let Ok(folder) = key.get_value::<String, _>("InstallDir") {
                if Path::new(&folder).join(APP_EXE).exists() {
                    return Some(Existing {
                        folder: PathBuf::from(folder),
                        version: key.get_value("Version").ok(),
                        legacy: false,
                    });
                }
            }
        }

        // The stock installer writes the same uninstall key this setup does, so
        // what makes an installation "legacy" is the executable name next to
        // it, not the key. `InstallLocation` is stored with quotes around it.
        let entry = self.open(UNINSTALL_KEY);
        let folder = entry
            .as_ref()
            .and_then(|key| key.get_value::<String, _>("InstallLocation").ok())
            .map(|folder| PathBuf::from(folder.trim_matches('"')))
            .filter(|folder| folder.join(LEGACY_EXE).exists())
            .or_else(|| {
                self.legacy_folder
                    .join(LEGACY_EXE)
                    .exists()
                    .then(|| self.legacy_folder.clone())
            })?;
        Some(Existing {
            folder,
            version: entry.and_then(|key| key.get_value("DisplayVersion").ok()),
            legacy: true,
        })
    }

    /// Where an install would go: over the existing one, or into the default
    /// folder. A legacy installation is not offered as a folder — it moves to
    /// `Programs`, where the rest of the UwU programs live.
    pub fn default_folder(&self) -> PathBuf {
        self.existing()
            .filter(|existing| !existing.legacy)
            .map_or_else(|| self.default_folder.clone(), |existing| existing.folder)
    }

    /// Whether the last install put a shortcut on the desktop. A silent update
    /// has no page to ask, and must not quietly take away a shortcut the user
    /// asked for or add one they declined.
    pub fn wanted_desktop_shortcut(&self) -> bool {
        self.open(SETUP_KEY)
            .and_then(|key| key.get_value::<u32, _>("DesktopShortcut").ok())
            .map_or_else(|| self.desktop.join(SHORTCUT).exists(), |value| value != 0)
    }
}

/// Every process running one of the executables an install would replace.
fn running_copies(layout: &Layout, folder: &Path) -> Vec<PathBuf> {
    // The sandbox describes a machine that does not exist; asking the real one
    // which programs are running would be answering a different question.
    if layout.sandbox {
        return Vec::new();
    }
    let mut candidates = vec![
        folder.join(APP_EXE),
        folder.join(LEGACY_EXE),
        layout.legacy_folder.join(LEGACY_EXE),
    ];
    if let Some(existing) = layout.existing() {
        candidates.push(existing.folder.join(APP_EXE));
        candidates.push(existing.folder.join(LEGACY_EXE));
    }
    candidates.sort();
    candidates.dedup();
    candidates
        .into_iter()
        .filter(|exe| !system::processes_of(exe).is_empty())
        .collect()
}

/// Whether a copy of UwUNotes that this install would overwrite is open.
pub fn app_running(layout: &Layout, folder: &Path) -> bool {
    !running_copies(layout, folder).is_empty()
}

/// Waits for the editor to be gone. Used by the update the app itself started:
/// the app has closed itself by then, but Windows keeps the file locked for a
/// moment afterwards. Returns whether it worked.
pub fn wait_for_app_to_close(layout: &Layout, folder: &Path, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if !app_running(layout, folder) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
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

/// Writes a file beside its destination first and swaps it in afterwards, so
/// the editor is never half a file. Windows keeps an executable locked for a
/// moment after the program ends, hence the retries.
fn replace_file(from: &Path, to: &Path) -> Result<(), SetupError> {
    let mut attempt = 0;
    loop {
        match std::fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(_) if attempt < 19 => std::thread::sleep(Duration::from_millis(250)),
            Err(error) => {
                let _ = std::fs::remove_file(from);
                // The only thing that keeps this setup from replacing a file it
                // has just written, in a folder it can write to, is another
                // program holding the target open. Access denied, sharing
                // violation and lock violation all mean the same thing here,
                // and all three are fixed by closing UwUNotes.
                let kind = match error.raw_os_error() {
                    Some(5 | 32 | 33) => Kind::InUse,
                    _ => classify(&error),
                };
                return Err(SetupError::new(
                    kind,
                    format!("Couldn't replace {}: {error}", to.display()),
                ));
            }
        }
        attempt += 1;
    }
}

/// Unpacks the editor to `target`, reporting how far it has got.
fn extract(package: &Package, target: &Path, report: &mut Reporter) -> Result<(), SetupError> {
    let total = package.size.max(1);
    let mut decoder = zstd::Decoder::new(package.payload)
        .map_err(|error| SetupError::other(format!("The packed editor is damaged: {error}")))?;
    let mut file = std::fs::File::create(target).map_err(|error| {
        SetupError::from_io(&error, format!("Couldn't write {}", target.display()))
    })?;
    let mut buffer = vec![0u8; 256 * 1024];
    let mut written = 0u64;
    loop {
        let read = decoder
            .read(&mut buffer)
            .map_err(|error| SetupError::other(format!("The packed editor is damaged: {error}")))?;
        if read == 0 {
            break;
        }
        let chunk = buffer.get(..read).unwrap_or_default();
        file.write_all(chunk).map_err(|error| {
            SetupError::from_io(&error, format!("Couldn't write {}", target.display()))
        })?;
        written += read as u64;
        report.at(Step::Writing, written as f64 / total as f64);
    }
    file.sync_all().map_err(|error| {
        SetupError::from_io(&error, format!("Couldn't write {}", target.display()))
    })?;
    if written != package.size {
        return Err(SetupError::other(
            "The packed editor is incomplete; the setup file is damaged.",
        ));
    }
    Ok(())
}

fn quoted(path: &Path) -> String {
    format!("\"{}\"", path.display())
}

/// What Windows shows as "Size" in the list of installed apps, in KB. Rounded
/// up, because an installation that is there takes up more than nothing.
fn folder_size_kb(folder: &Path) -> u32 {
    let bytes: u64 = std::fs::read_dir(folder)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| entry.metadata().ok())
        .filter(|meta| meta.is_file())
        .map(|meta| meta.len())
        .sum();
    bytes.div_ceil(1024).min(u64::from(u32::MAX)) as u32
}

/// Removes the files and registry entries of the stock installer. The editor's
/// data folder is not touched: the session and the drafts survive the move.
fn remove_legacy(layout: &Layout, new_folder: &Path) -> Result<(), SetupError> {
    let Some(existing) = layout.existing().filter(|existing| existing.legacy) else {
        return Ok(());
    };
    if existing.folder != new_folder {
        for file in [LEGACY_EXE, UNINSTALL_EXE] {
            let _ = std::fs::remove_file(existing.folder.join(file));
        }
        // Only when it is empty: a folder somebody put their own files in is
        // not this setup's to delete.
        let _ = std::fs::remove_dir(&existing.folder);
    } else {
        let _ = std::fs::remove_file(existing.folder.join(LEGACY_EXE));
    }
    layout.remove_tree(LEGACY_PRODUCT_KEY);
    Ok(())
}

/// Installs, updates or repairs — the same work every time, because a setup
/// that does something different depending on what it found is a setup with
/// paths nobody ever runs.
pub fn install(
    layout: &Layout,
    package: &Package,
    options: &Options,
    version: &str,
    report: &mut dyn FnMut(Progress),
) -> Result<Installed, SetupError> {
    let mut report = Reporter {
        sink: report,
        last: -1.0,
    };
    let folder = PathBuf::from(options.folder.trim());
    if !folder.is_absolute() {
        return Err(SetupError::other(
            "Please give the full path of a folder, starting with a drive letter.",
        ));
    }
    if folder.parent().is_none() {
        return Err(SetupError::other(
            "UwUNotes needs a folder of its own, not the root of a drive.",
        ));
    }

    report.at(Step::Preparing, 0.0);
    // Checked before anything is written, and waited on briefly because a user
    // who just closed the editor should not have to press the button twice.
    if !wait_for_app_to_close(layout, &folder, Duration::from_secs(2)) {
        return Err(SetupError::new(
            Kind::InUse,
            "UwUNotes is still open. Close it and start the setup again.",
        ));
    }
    std::fs::create_dir_all(&folder).map_err(|error| {
        SetupError::from_io(&error, format!("Couldn't create {}", folder.display()))
    })?;
    remove_legacy(layout, &folder)?;
    report.at(Step::Preparing, 1.0);

    let app = folder.join(APP_EXE);
    let incoming = folder.join(INCOMING_APP);
    extract(package, &incoming, &mut report)?;
    replace_file(&incoming, &app)?;

    // The uninstaller is this very program, with a different name and
    // `--uninstall` on its command line. One executable, so the uninstaller can
    // never be a version behind what installed it.
    let uninstaller = folder.join(UNINSTALL_EXE);
    if package.setup != uninstaller {
        let incoming = folder.join(INCOMING_UNINSTALL);
        std::fs::copy(&package.setup, &incoming).map_err(|error| {
            SetupError::from_io(&error, format!("Couldn't write {}", incoming.display()))
        })?;
        replace_file(&incoming, &uninstaller)?;
    }

    report.at(Step::Shortcuts, 0.0);
    let shortcut = system::Shortcut {
        target: &app,
        description: "UwUNotes",
        app_id: APP_ID,
    };
    system::create_shortcut(&layout.start_menu.join(SHORTCUT), &shortcut)
        .map_err(SetupError::other)?;
    let on_desktop = layout.desktop.join(SHORTCUT);
    if options.desktop_shortcut {
        system::create_shortcut(&on_desktop, &shortcut).map_err(SetupError::other)?;
    } else {
        let _ = std::fs::remove_file(&on_desktop);
    }
    report.at(Step::Shortcuts, 1.0);

    report.at(Step::Registry, 0.0);
    register(layout, &folder, options, version).map_err(SetupError::other)?;
    report.at(Step::Registry, 1.0);
    report.at(Step::Done, 1.0);

    if options.launch_when_done && !layout.sandbox {
        system::spawn_detached(&app, &[]).map_err(SetupError::other)?;
    }
    Ok(Installed {
        folder: folder.display().to_string(),
        exe: app.display().to_string(),
    })
}

/// The entry under "Installed apps", and what this setup needs to remember for
/// the next time it runs.
fn register(
    layout: &Layout,
    folder: &Path,
    options: &Options,
    version: &str,
) -> Result<(), String> {
    let app = folder.join(APP_EXE);
    let uninstaller = folder.join(UNINSTALL_EXE);
    let write = |key: &RegKey, name: &str, value: &str| {
        key.set_value(name, &value)
            .map_err(|error| format!("Couldn't write to the registry ({name}): {error}"))
    };
    let write_number = |key: &RegKey, name: &str, value: u32| {
        key.set_value(name, &value)
            .map_err(|error| format!("Couldn't write to the registry ({name}): {error}"))
    };

    // The stock installer wrote values this setup does not (`MainBinaryName`,
    // among others), and a leftover one would outlive the program it describes.
    layout.remove_tree(UNINSTALL_KEY);
    let entry = layout.create(UNINSTALL_KEY)?;
    write(&entry, "DisplayName", PRODUCT)?;
    write(&entry, "DisplayVersion", version)?;
    write(&entry, "Publisher", PUBLISHER)?;
    write(&entry, "DisplayIcon", &format!("{},0", app.display()))?;
    write(&entry, "InstallLocation", &folder.display().to_string())?;
    write(
        &entry,
        "UninstallString",
        &format!("{} --uninstall", quoted(&uninstaller)),
    )?;
    write(&entry, "URLInfoAbout", HOMEPAGE)?;
    write(&entry, "HelpLink", HOMEPAGE)?;
    write_number(&entry, "EstimatedSize", folder_size_kb(folder))?;
    // There is nothing to modify and nothing to repair but running the setup
    // again, so Windows should not offer either button.
    write_number(&entry, "NoModify", 1)?;
    write_number(&entry, "NoRepair", 1)?;

    let setup = layout.create(SETUP_KEY)?;
    write(&setup, "InstallDir", &folder.display().to_string())?;
    write(&setup, "Version", version)?;
    write_number(&setup, "DesktopShortcut", options.desktop_shortcut.into())?;
    Ok(())
}

/// Removes what the setup wrote, and nothing else.
///
/// `keep_settings` is the one thing the user is asked: the editor's data folder
/// holds the session and the unsaved drafts, and deleting those by default
/// would make "uninstall to reinstall" a way to lose text.
pub fn uninstall(
    layout: &Layout,
    folder: &Path,
    keep_settings: bool,
    report: &mut dyn FnMut(Progress),
) -> Result<(), SetupError> {
    let mut report = Reporter {
        sink: report,
        last: -1.0,
    };
    report.at(Step::Preparing, 0.0);
    if !wait_for_app_to_close(layout, folder, Duration::from_secs(2)) {
        return Err(SetupError::new(
            Kind::InUse,
            "UwUNotes is still open. Close it and start the uninstaller again.",
        ));
    }
    report.at(Step::Preparing, 1.0);

    report.at(Step::Shortcuts, 0.0);
    let _ = std::fs::remove_file(layout.start_menu.join(SHORTCUT));
    let _ = std::fs::remove_file(layout.desktop.join(SHORTCUT));
    report.at(Step::Shortcuts, 1.0);

    report.at(Step::Registry, 0.0);
    layout.remove_tree(UNINSTALL_KEY);
    layout.remove_tree(PRODUCT_KEY);
    report.at(Step::Registry, 1.0);

    report.at(Step::Writing, 0.0);
    for file in [
        APP_EXE,
        LEGACY_EXE,
        UNINSTALL_EXE,
        INCOMING_APP,
        INCOMING_UNINSTALL,
    ] {
        let path = folder.join(file);
        if !path.exists() {
            continue;
        }
        if let Err(error) = std::fs::remove_file(&path) {
            // Everything else is a leftover worth ignoring; the editor itself
            // staying behind means the uninstall did not happen.
            if file == APP_EXE {
                return Err(SetupError::from_io(
                    &error,
                    format!("Couldn't remove {}", path.display()),
                ));
            }
        }
    }
    // Only if it is empty. Anything the user put next to the editor stays, and
    // so does the folder holding it.
    let _ = std::fs::remove_dir(folder);
    report.at(Step::Writing, 1.0);

    if !keep_settings {
        for data in [&layout.app_data, &layout.local_data] {
            if data.exists() {
                std::fs::remove_dir_all(data).map_err(|error| {
                    SetupError::from_io(&error, format!("Couldn't delete {}", data.display()))
                })?;
            }
        }
    }
    report.at(Step::Done, 1.0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A whole machine in a temporary folder: install paths, shortcut folders
    /// and a registry key of its own, all removed again when the test ends.
    struct Machine {
        _root: tempfile::TempDir,
        layout: Layout,
        /// Stands in for the running setup, so a test does not copy the test
        /// binary around to check that the uninstaller is written.
        setup: PathBuf,
        editor: Vec<u8>,
        packed: Vec<u8>,
    }

    impl Machine {
        fn new() -> Self {
            let root = tempfile::tempdir().expect("a temporary folder");
            let layout = Layout::sandbox(root.path());
            let setup = root.path().join("UwUNotes-Setup.exe");
            std::fs::write(&setup, b"the setup itself").expect("writing the setup stand-in");
            // Deliberately not starting with "MZ". Windows reads the target of
            // a shortcut while it saves one, and refuses with a bare E_FAIL
            // when the file claims to be an executable and then is not — which
            // costs an afternoon to find in a test that has nothing to do with
            // executables.
            let editor = b"the editor, pretending to be eight megabytes".to_vec();
            let packed = zstd::encode_all(editor.as_slice(), 3).expect("packing the editor");
            Self {
                _root: root,
                layout,
                setup,
                editor,
                packed,
            }
        }

        fn package(&self) -> Package<'_> {
            Package {
                payload: &self.packed,
                size: self.editor.len() as u64,
                setup: self.setup.clone(),
            }
        }

        fn options(&self, desktop_shortcut: bool) -> Options {
            Options {
                folder: self.layout.default_folder().display().to_string(),
                desktop_shortcut,
                launch_when_done: false,
            }
        }

        /// Installs, and hands back every progress message it sent.
        fn install(&self, options: &Options, version: &str) -> Result<Vec<Progress>, SetupError> {
            let mut steps = Vec::new();
            install(
                &self.layout,
                &self.package(),
                options,
                version,
                &mut |progress| steps.push(progress),
            )?;
            Ok(steps)
        }

        fn uninstall(&self, folder: &Path, keep_settings: bool) -> Result<(), SetupError> {
            uninstall(&self.layout, folder, keep_settings, &mut |_| {})
        }
    }

    impl Drop for Machine {
        fn drop(&mut self) {
            let key = self.layout.registry_prefix.trim_end_matches('\\');
            let _ = RegKey::predef(HKEY_CURRENT_USER).delete_subkey_all(key);
        }
    }

    #[test]
    fn a_clean_install_writes_the_editor_its_shortcuts_and_the_uninstall_entry() {
        let machine = Machine::new();
        let layout = &machine.layout;
        let folder = layout.default_folder();
        assert!(layout.existing().is_none(), "nothing is installed yet");

        let steps = machine
            .install(&machine.options(true), "0.3.0")
            .expect("the install");

        assert_eq!(
            std::fs::read(folder.join(APP_EXE)).unwrap(),
            machine.editor,
            "the editor is unpacked byte for byte"
        );
        assert_eq!(
            std::fs::read(folder.join(UNINSTALL_EXE)).unwrap(),
            b"the setup itself",
            "the setup becomes the uninstaller"
        );
        assert!(!folder.join(INCOMING_APP).exists(), "nothing half-written");
        assert!(layout.start_menu.join(SHORTCUT).exists());
        assert!(layout.desktop.join(SHORTCUT).exists());

        let entry = layout.open(UNINSTALL_KEY).expect("the uninstall entry");
        assert_eq!(
            entry.get_value::<String, _>("DisplayName").unwrap(),
            PRODUCT
        );
        assert_eq!(
            entry.get_value::<String, _>("DisplayVersion").unwrap(),
            "0.3.0"
        );
        assert_eq!(
            entry.get_value::<String, _>("Publisher").unwrap(),
            PUBLISHER
        );
        assert_eq!(
            entry.get_value::<String, _>("InstallLocation").unwrap(),
            folder.display().to_string()
        );
        assert!(entry
            .get_value::<String, _>("UninstallString")
            .unwrap()
            .ends_with(r#"\uninstall.exe" --uninstall"#));
        assert!(entry
            .get_value::<String, _>("DisplayIcon")
            .unwrap()
            .ends_with(r"\UwUNotes.exe,0"));
        assert!(
            entry.get_value::<u32, _>("EstimatedSize").unwrap() > 0,
            "Windows shows a size in the list of installed apps"
        );

        let existing = layout.existing().expect("it is installed now");
        assert_eq!(existing.version.as_deref(), Some("0.3.0"));
        assert!(!existing.legacy);
        assert_eq!(existing.folder, folder);
        assert!(layout.wanted_desktop_shortcut());

        let percents: Vec<f64> = steps.iter().map(|step| step.percent).collect();
        assert!(
            percents.windows(2).all(|pair| pair[1] >= pair[0]),
            "the bar only ever moves forward: {percents:?}"
        );
        assert_eq!(steps.last().map(|step| step.step), Some(Step::Done));
        assert_eq!(steps.last().map(|step| step.percent), Some(100.0));
    }

    #[test]
    fn an_update_replaces_the_editor_and_keeps_the_choices_that_were_made() {
        let machine = Machine::new();
        let layout = &machine.layout;
        let folder = layout.default_folder();
        machine
            .install(&machine.options(false), "0.2.0")
            .expect("the first install");
        assert!(
            !layout.desktop.join(SHORTCUT).exists(),
            "no desktop shortcut was asked for"
        );

        // What a silent update does: same folder, same answers as last time.
        let options = Options {
            folder: layout.default_folder().display().to_string(),
            desktop_shortcut: layout.wanted_desktop_shortcut(),
            launch_when_done: false,
        };
        check_not_older(
            layout.existing().and_then(|e| e.version).as_deref(),
            "0.3.0",
        )
        .expect("0.3.0 is newer than 0.2.0");
        machine.install(&options, "0.3.0").expect("the update");

        assert_eq!(layout.default_folder(), folder, "it stays where it was");
        assert_eq!(std::fs::read(folder.join(APP_EXE)).unwrap(), machine.editor);
        assert_eq!(
            layout.existing().and_then(|e| e.version).as_deref(),
            Some("0.3.0")
        );
        assert!(
            !layout.desktop.join(SHORTCUT).exists(),
            "an update does not add a shortcut the user declined"
        );
        assert!(layout.start_menu.join(SHORTCUT).exists());
    }

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
    fn uninstalling_removes_what_the_setup_wrote_and_keeps_what_it_did_not() {
        let machine = Machine::new();
        let layout = &machine.layout;
        let folder = layout.default_folder();
        machine
            .install(&machine.options(true), "0.3.0")
            .expect("the install");

        // The user's own things: their session, and a file they put next to the
        // editor themselves.
        std::fs::create_dir_all(&layout.app_data).unwrap();
        std::fs::write(layout.app_data.join("session.json"), b"open tabs").unwrap();
        std::fs::write(folder.join("notes.txt"), b"mine").unwrap();

        machine.uninstall(&folder, true).expect("the uninstall");

        assert!(!folder.join(APP_EXE).exists());
        assert!(!folder.join(UNINSTALL_EXE).exists());
        assert!(!layout.start_menu.join(SHORTCUT).exists());
        assert!(!layout.desktop.join(SHORTCUT).exists());
        assert!(layout.open(UNINSTALL_KEY).is_none());
        assert!(layout.open(SETUP_KEY).is_none());
        assert!(layout.existing().is_none());
        assert!(
            folder.join("notes.txt").exists(),
            "a file the setup did not write stays, and so does its folder"
        );
        assert!(
            layout.app_data.join("session.json").exists(),
            "the session and the drafts are kept unless the user says otherwise"
        );

        machine
            .uninstall(&folder, false)
            .expect("the second uninstall");
        assert!(
            !layout.app_data.exists(),
            "and are deleted when the user does say otherwise"
        );
    }

    #[test]
    fn the_installation_of_the_stock_installer_is_found_and_taken_away() {
        let machine = Machine::new();
        let layout = &machine.layout;
        std::fs::create_dir_all(&layout.legacy_folder).unwrap();
        std::fs::write(layout.legacy_folder.join(LEGACY_EXE), b"0.2.0").unwrap();
        std::fs::write(layout.legacy_folder.join(UNINSTALL_EXE), b"nsis").unwrap();
        let entry = layout.create(UNINSTALL_KEY).unwrap();
        entry
            .set_value("InstallLocation", &quoted(&layout.legacy_folder))
            .unwrap();
        entry.set_value("DisplayVersion", &"0.2.0").unwrap();
        entry
            .set_value("MainBinaryName", &LEGACY_EXE.to_owned())
            .unwrap();
        layout
            .create(LEGACY_PRODUCT_KEY)
            .unwrap()
            .set_value("", &layout.legacy_folder.display().to_string())
            .unwrap();

        let existing = layout.existing().expect("the stock installation");
        assert!(existing.legacy);
        assert_eq!(existing.folder, layout.legacy_folder);
        assert_eq!(existing.version.as_deref(), Some("0.2.0"));
        assert_eq!(
            layout.default_folder(),
            layout.default_folder,
            "it moves to Programs rather than staying where NSIS put it"
        );

        machine
            .install(&machine.options(false), "0.3.0")
            .expect("the update over the stock installation");

        assert!(!layout.legacy_folder.exists(), "the old folder is gone");
        assert!(layout.open(LEGACY_PRODUCT_KEY).is_none());
        let existing = layout.existing().expect("the new installation");
        assert!(!existing.legacy);
        assert_eq!(existing.folder, layout.default_folder);
        assert!(
            layout
                .open(UNINSTALL_KEY)
                .unwrap()
                .get_value::<String, _>("MainBinaryName")
                .is_err(),
            "the values the stock installer wrote are gone with it"
        );
    }

    #[test]
    fn a_setup_without_an_editor_inside_says_so_instead_of_installing_nothing() {
        let machine = Machine::new();
        let empty = Package {
            payload: &[],
            size: 0,
            setup: machine.setup.clone(),
        };
        let error = install(
            &machine.layout,
            &empty,
            &machine.options(false),
            "0.3.0",
            &mut |_| {},
        )
        .expect_err("nothing to install");
        assert_eq!(error.kind, Kind::Other);
        assert!(
            !machine.layout.default_folder().join(APP_EXE).exists(),
            "and leaves no half an editor behind"
        );
        assert_eq!(has_payload(), !PAYLOAD.is_empty());
    }

    #[test]
    fn a_folder_that_is_not_one_is_refused_before_anything_is_written() {
        let machine = Machine::new();
        for folder in ["", "   ", "UwUNotes", r"..\UwUNotes", r"C:\"] {
            let options = Options {
                folder: folder.to_owned(),
                desktop_shortcut: false,
                launch_when_done: false,
            };
            let error = machine
                .install(&options, "0.3.0")
                .expect_err(&format!("{folder:?} is not a full path"));
            assert_eq!(error.kind, Kind::Other);
        }
    }

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
}
