//! Putting UwUNotes on a Linux machine, and taking it off again.
//!
//! Per user and without root, in the places the XDG base directory spec says
//! per-user programs go:
//!
//! - the editor as `$XDG_DATA_HOME/uwunotes/uwunotes` (`~/.local/share` when
//!   the variable is not set), and this setup beside it as `uninstall`;
//! - `~/.local/bin/uwunotes`, a link to it, so a terminal can start it by name
//!   — unless that name is already somebody else's, in which case it is left
//!   alone;
//! - the menu entry `$XDG_DATA_HOME/applications/app.uwunotes.desktop`, with
//!   the absolute path in `Exec`, and an "Uninstall UwUNotes" action inside it
//!   — the right-click menu of the launcher, in GNOME and KDE alike;
//! - the icon in every size the editor ships, under `icons/hicolor`;
//! - on request, a copy of the menu entry on the desktop.
//!
//! The uninstaller is the setup again, `uninstall --uninstall`: the menu
//! entry's action, or that line in a terminal. It takes away exactly the files
//! listed above, and each only when it is still what the setup put there — a
//! plain file, not a link somebody replaced it with; a menu entry carrying the
//! setup's own mark; a link in `~/.local/bin` pointing at this editor.
//!
//! What it does not bring along: WebKitGTK. The editor, and this setup, are
//! linked against `libwebkit2gtk-4.1`, which every desktop distribution has a
//! package for and which a program cannot sensibly carry around itself. When
//! it is missing, the setup does not start at all — docs/install.md says which
//! package to install.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use super::unix::{self as files, Record, EXECUTABLE, READABLE};
use super::{
    extract, Existing, Installed, Kind, Options, Package, Progress, Reporter, SetupError, Step,
};
use crate::system;

/// The app's bundle identifier, which is also the name of its data folders.
const APP_ID: &str = "app.uwunotes.desktop";
const FOLDER: &str = "uwunotes";
const APP_BIN: &str = "uwunotes";
const UNINSTALLER: &str = "uninstall";
const RECORD: &str = "setup.json";
/// Half-written files carry these names until they are complete, so an install
/// that stops in the middle never leaves a broken editor behind.
const INCOMING_APP: &str = "uwunotes.new";
/// What [`files::copy_atomically`] calls the uninstaller while it is copying
/// it; only named here so an uninstall can clear away an interrupted copy.
const INCOMING_UNINSTALL: &str = ".uninstall.uwunotes-setup";
const DESKTOP_ENTRY: &str = "app.uwunotes.desktop";
const ICON: &str = "app.uwunotes";
/// Written into every desktop entry the setup makes, and looked for before one
/// is removed: a file under that name without it is somebody else's.
const MARK: &str = "X-UwUNotes-Setup";

/// The editor's own icons, compiled in: the setup is one file, and the icons
/// are not in the editor's executable in any form a desktop could read.
const ICONS: &[(&str, &[u8])] = &[
    (
        "32x32",
        include_bytes!("../../../../desktop/src-tauri/icons/32x32.png"),
    ),
    (
        "64x64",
        include_bytes!("../../../../desktop/src-tauri/icons/64x64.png"),
    ),
    (
        "128x128",
        include_bytes!("../../../../desktop/src-tauri/icons/128x128.png"),
    ),
    (
        "256x256",
        include_bytes!("../../../../desktop/src-tauri/icons/128x128@2x.png"),
    ),
    (
        "512x512",
        include_bytes!("../../../../desktop/src-tauri/icons/icon.png"),
    ),
];

/// Where everything belongs on this machine, or inside the sandbox.
pub struct Layout {
    pub default_folder: PathBuf,
    /// `~/.local/bin`.
    bin: PathBuf,
    /// `$XDG_DATA_HOME/applications`.
    applications: PathBuf,
    /// `$XDG_DATA_HOME/icons/hicolor`.
    icons: PathBuf,
    /// `XDG_DESKTOP_DIR` out of `user-dirs.dirs`, or `~/Desktop`.
    desktop: PathBuf,
    /// The editor's folders: data (the session, the drafts), config, cache.
    data: [PathBuf; 3],
    pub sandbox: bool,
}

/// An XDG variable, when it holds an absolute path — the spec says a relative
/// one is to be ignored, and so it is.
fn xdg(name: &str, fallback: PathBuf) -> PathBuf {
    std::env::var_os(name)
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .unwrap_or(fallback)
}

/// `XDG_DESKTOP_DIR` out of `~/.config/user-dirs.dirs`, which is how a German
/// desktop ends up as `~/Schreibtisch`. The file is a shell fragment in one
/// fixed shape: `XDG_DESKTOP_DIR="$HOME/Desktop"`.
fn desktop_folder(home: &Path, config: &Path) -> PathBuf {
    std::fs::read_to_string(config.join("user-dirs.dirs"))
        .ok()
        .and_then(|text| desktop_from_user_dirs(&text, home))
        .unwrap_or_else(|| home.join("Desktop"))
}

fn desktop_from_user_dirs(text: &str, home: &Path) -> Option<PathBuf> {
    let value = text
        .lines()
        .map(str::trim)
        .find_map(|line| line.strip_prefix("XDG_DESKTOP_DIR="))?
        .trim()
        .strip_prefix('"')?
        .strip_suffix('"')?;
    let path = match value.strip_prefix("$HOME") {
        Some(rest) => home.join(rest.trim_start_matches('/')),
        None => PathBuf::from(value),
    };
    // `$HOME/` alone is how a desktop is switched off; that is no folder to
    // put a shortcut into.
    (path.is_absolute() && path != home).then_some(path)
}

impl Layout {
    pub fn detect() -> Self {
        if let Some(folder) =
            std::env::var_os("UWUNOTES_SETUP_SANDBOX").filter(|folder| !folder.is_empty())
        {
            return Self::sandbox(Path::new(&folder));
        }
        // Without a home folder every path below is relative, and `install`
        // refuses to begin: there is nowhere per-user to put anything.
        let home = system::home().unwrap_or_default();
        let data = xdg("XDG_DATA_HOME", home.join(".local/share"));
        let config = xdg("XDG_CONFIG_HOME", home.join(".config"));
        let cache = xdg("XDG_CACHE_HOME", home.join(".cache"));
        Self {
            default_folder: data.join(FOLDER),
            bin: home.join(".local/bin"),
            applications: data.join("applications"),
            icons: data.join("icons/hicolor"),
            desktop: desktop_folder(&home, &config),
            data: [data.join(APP_ID), config.join(APP_ID), cache.join(APP_ID)],
            sandbox: false,
        }
    }

    /// The same layout, moved into one folder that belongs to nobody. Nothing
    /// outside `root` is touched, and no system tool is started.
    pub fn sandbox(root: &Path) -> Self {
        let data = root.join("share");
        Self {
            default_folder: data.join(FOLDER),
            bin: root.join("bin"),
            applications: data.join("applications"),
            icons: data.join("icons/hicolor"),
            desktop: root.join("Desktop"),
            data: [
                data.join(APP_ID),
                root.join("config").join(APP_ID),
                root.join("cache").join(APP_ID),
            ],
            sandbox: true,
        }
    }

    fn record(&self) -> Option<Record> {
        Record::read(&self.default_folder.join(RECORD))
    }

    /// What is installed right now, if anything.
    pub fn existing(&self) -> Option<Existing> {
        let folder = &self.default_folder;
        std::fs::symlink_metadata(folder.join(APP_BIN))
            .is_ok_and(|meta| meta.file_type().is_file())
            .then(|| Existing {
                folder: folder.clone(),
                version: self.record().and_then(|record| record.version),
                legacy: false,
            })
    }

    /// Where an install goes. Always the same folder: the menu entry and the
    /// command in `~/.local/bin` name it, and a second installation somewhere
    /// else would be a second copy nothing points at.
    pub fn default_folder(&self) -> PathBuf {
        self.default_folder.clone()
    }

    /// Whether the last install put an entry on the desktop. A silent update
    /// has no page to ask, and must not quietly take away a shortcut the user
    /// asked for or add one they declined.
    pub fn wanted_desktop_shortcut(&self) -> bool {
        self.record().map_or_else(
            || is_ours(&self.desktop.join(DESKTOP_ENTRY)),
            |record| record.desktop_shortcut,
        )
    }

    /// The icon files, one per size.
    fn icon_paths(&self) -> impl Iterator<Item = (PathBuf, &'static [u8])> + '_ {
        ICONS.iter().map(|(size, bytes)| {
            (
                self.icons
                    .join(size)
                    .join("apps")
                    .join(format!("{ICON}.png")),
                *bytes,
            )
        })
    }
}

/// Whether a desktop entry is one this setup wrote.
fn is_ours(entry: &Path) -> bool {
    std::fs::symlink_metadata(entry).is_ok_and(|meta| meta.file_type().is_file())
        && std::fs::read_to_string(entry)
            .is_ok_and(|text| text.lines().any(|line| line.starts_with(MARK)))
}

/// Whether a copy of UwUNotes that this install would overwrite is open.
pub fn app_running(layout: &Layout, folder: &Path) -> bool {
    // The sandbox describes a machine that does not exist; asking the real one
    // which programs are running would be answering a different question.
    if layout.sandbox {
        return false;
    }
    let app = folder.join(APP_BIN);
    !system::running(|exe| exe == app).is_empty()
}

/// Waits for the editor to be gone. Returns whether it is.
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

/// Starts the installed editor.
pub fn launch(layout: &Layout, folder: &Path) -> Result<(), SetupError> {
    if layout.sandbox {
        return Ok(());
    }
    system::spawn_detached(&folder.join(APP_BIN), &[]).map_err(SetupError::other)
}

/// A path as the value of a desktop-entry key. Those are UTF-8, one line each,
/// with `\` as their escape character; a path that is not UTF-8 or has a line
/// break in it cannot be written as one at all, and is refused rather than
/// mangled into a different path — or into a second key.
fn entry_string(path: &Path) -> Result<String, SetupError> {
    let text = path.to_str().ok_or_else(|| {
        SetupError::other(format!(
            "{} is not valid UTF-8, which a menu entry cannot name.",
            path.display()
        ))
    })?;
    if text.chars().any(char::is_control) {
        return Err(SetupError::other(format!(
            "{} has a control character in its name, which a menu entry cannot name.",
            path.display()
        )));
    }
    Ok(text.replace('\\', r"\\"))
}

/// A path as one argument in `Exec`, which has a quoting layer of its own on
/// top of the string escapes: inside double quotes, `"`, `` ` ``, `$` and `\`
/// take a backslash, and `%` is doubled because it introduces field codes.
fn exec_argument(path: &Path) -> Result<String, SetupError> {
    // Checked, and escaped at the string level, by `entry_string` — which is
    // applied last, because it is the outer of the two layers.
    entry_string(path)?;
    let text = path.to_string_lossy();
    let mut quoted = String::from("\"");
    for character in text.chars() {
        match character {
            '"' | '`' | '$' | '\\' => {
                quoted.push('\\');
                quoted.push(character);
            }
            '%' => quoted.push_str("%%"),
            _ => quoted.push(character),
        }
    }
    quoted.push('"');
    Ok(quoted.replace('\\', r"\\"))
}

/// The menu entry: the editor, what it opens, and the way to take it off again.
///
/// `%F` passes the files a user opens with UwUNotes from a file manager.
fn desktop_entry(folder: &Path, version: &str) -> Result<String, SetupError> {
    let app = folder.join(APP_BIN);
    let uninstaller = folder.join(UNINSTALLER);
    let exec = exec_argument(&app)?;
    let try_exec = entry_string(&app)?;
    let uninstall = exec_argument(&uninstaller)?;
    Ok(format!(
        "[Desktop Entry]
Type=Application
Version=1.5
Name=UwUNotes
GenericName=Text Editor
GenericName[de]=Texteditor
Comment=A text and code editor with cat ears
Comment[de]=Ein Text- und Code-Editor mit Katzenohren
Exec={exec} %F
TryExec={try_exec}
Icon={ICON}
Terminal=false
StartupNotify=true
Categories=Utility;TextEditor;
MimeType=text/plain;text/markdown;text/x-log;text/csv;text/css;text/html;text/xml;application/xml;application/json;application/x-yaml;application/toml;text/x-python;text/x-csrc;text/x-chdr;text/x-c++src;text/x-rust;text/x-shellscript;application/x-shellscript;text/javascript;application/javascript;
Keywords=text;editor;notes;code;
Actions=uninstall;
{MARK}={version}

[Desktop Action uninstall]
Name=Uninstall UwUNotes
Name[de]=UwUNotes entfernen
Exec={uninstall} --uninstall
"
    ))
}

/// Tells the desktop the menu entry and the icons changed. Both tools are
/// optional, and a desktop without them notices on its own a little later.
fn refresh_desktop(layout: &Layout) {
    if layout.sandbox {
        return;
    }
    system::run_quietly(
        "update-desktop-database",
        &[layout.applications.as_os_str()],
    );
    system::run_quietly(
        "gtk-update-icon-cache",
        &[OsStr::new("-f"), OsStr::new("-t"), layout.icons.as_os_str()],
    );
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
    let mut report = Reporter::new(report);
    let folder = files::the_folder(options, &layout.default_folder)?;
    let app = folder.join(APP_BIN);
    let uninstaller = folder.join(UNINSTALLER);
    let entry = desktop_entry(&folder, version)?;

    report.at(Step::Preparing, 0.0);
    if !wait_for_app_to_close(layout, &folder, Duration::from_secs(2)) {
        return Err(SetupError::new(
            Kind::InUse,
            "UwUNotes is still open. Close it and start the setup again.",
        ));
    }
    // Checked before anything is written: a folder or a file of ours that has
    // become a link is somebody pointing the setup somewhere else.
    files::refuse_symlink(&folder)?;
    files::make_folder(&folder)?;
    for target in [&app, &uninstaller, &folder.join(RECORD)] {
        files::refuse_symlink(target)?;
    }
    report.at(Step::Preparing, 1.0);

    let incoming = folder.join(INCOMING_APP);
    extract(package, &incoming, &mut report)?;
    files::replace(&incoming, &app, EXECUTABLE)?;

    // The uninstaller is this very program, under another name and with
    // `--uninstall` on its command line. One executable, so the uninstaller can
    // never be a version behind what installed it.
    if package.setup != uninstaller {
        files::copy_atomically(&package.setup, &uninstaller, EXECUTABLE)?;
    }

    report.at(Step::Shortcuts, 0.0);
    for (path, bytes) in layout.icon_paths() {
        if let Some(parent) = path.parent() {
            files::make_folder(parent)?;
        }
        files::write_atomically(&path, bytes, READABLE)?;
    }
    files::make_folder(&layout.applications)?;
    files::write_atomically(
        &layout.applications.join(DESKTOP_ENTRY),
        entry.as_bytes(),
        READABLE,
    )?;
    // A name somebody else already uses in `~/.local/bin` stays theirs; the
    // menu entry is how UwUNotes is started, and it does not need the link.
    files::link_if_free(&layout.bin.join(APP_BIN), &app)?;

    let on_desktop = layout.desktop.join(DESKTOP_ENTRY);
    if options.desktop_shortcut {
        // Only onto a desktop that exists. A desktop environment without one
        // has decided against icons on it, and a folder made for the purpose
        // would be clutter in the home folder.
        if layout.desktop.is_dir() {
            // Executable, because that is how GNOME and KDE tell a launcher
            // the user put there from one that was dropped there; the `gio`
            // mark is what GNOME's desktop additionally asks for.
            files::write_atomically(&on_desktop, entry.as_bytes(), EXECUTABLE)?;
            if !layout.sandbox {
                system::run_quietly(
                    "gio",
                    &[
                        OsStr::new("set"),
                        on_desktop.as_os_str(),
                        OsStr::new("metadata::trusted"),
                        OsStr::new("true"),
                    ],
                );
            }
        }
    } else if is_ours(&on_desktop) {
        let _ = files::remove_file(&on_desktop);
    }
    report.at(Step::Shortcuts, 1.0);

    report.at(Step::Registry, 0.0);
    Record {
        version: Some(version.to_owned()),
        desktop_shortcut: options.desktop_shortcut,
    }
    .write(&folder.join(RECORD))?;
    refresh_desktop(layout);
    report.at(Step::Registry, 1.0);
    report.at(Step::Done, 1.0);

    if options.launch_when_done {
        launch(layout, &folder)?;
    }
    Ok(Installed {
        folder: folder.display().to_string(),
        exe: app.display().to_string(),
    })
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
    let mut report = Reporter::new(report);
    report.at(Step::Preparing, 0.0);
    if !wait_for_app_to_close(layout, folder, Duration::from_secs(2)) {
        return Err(SetupError::new(
            Kind::InUse,
            "UwUNotes is still open. Close it and start the uninstaller again.",
        ));
    }
    report.at(Step::Preparing, 1.0);

    report.at(Step::Shortcuts, 0.0);
    let app = folder.join(APP_BIN);
    for entry in [
        layout.applications.join(DESKTOP_ENTRY),
        layout.desktop.join(DESKTOP_ENTRY),
    ] {
        if is_ours(&entry) {
            let _ = files::remove_file(&entry);
        }
    }
    for (path, _) in layout.icon_paths() {
        let _ = files::remove_file(&path);
    }
    files::remove_link_to(&layout.bin.join(APP_BIN), &app);
    report.at(Step::Shortcuts, 1.0);

    report.at(Step::Registry, 0.0);
    let _ = files::remove_file(&folder.join(RECORD));
    refresh_desktop(layout);
    report.at(Step::Registry, 1.0);

    report.at(Step::Writing, 0.0);
    // The editor first, and it is the one that counts: everything else staying
    // behind is a leftover, the editor staying behind is an uninstall that did
    // not happen. The uninstaller is among the files — Linux lets a running
    // program's file be deleted, and this process simply keeps its copy.
    files::remove_file(&app).map_err(|error| {
        SetupError::from_io(&error, format!("Couldn't remove {}", app.display()))
    })?;
    for file in [UNINSTALLER, INCOMING_APP, INCOMING_UNINSTALL] {
        let _ = files::remove_file(&folder.join(file));
    }
    // Only if it is empty. Anything the user put next to the editor stays, and
    // so does the folder holding it.
    let _ = std::fs::remove_dir(folder);
    report.at(Step::Writing, 1.0);

    if !keep_settings {
        for data in &layout.data {
            files::remove_data(data)?;
        }
    }
    report.at(Step::Done, 1.0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt as _;

    use super::super::check_not_older;
    use super::*;

    /// A whole home folder in a temporary folder, removed again when the test
    /// ends.
    struct Machine {
        _root: tempfile::TempDir,
        layout: Layout,
        setup: PathBuf,
        editor: Vec<u8>,
        packed: Vec<u8>,
    }

    impl Machine {
        fn new() -> Self {
            let root = tempfile::tempdir().expect("a temporary folder");
            let layout = Layout::sandbox(root.path());
            std::fs::create_dir_all(&layout.desktop).unwrap();
            let setup = root.path().join("UwUNotes-Setup");
            std::fs::write(&setup, b"the setup itself").expect("writing the setup stand-in");
            let editor = b"the editor, pretending to be twenty megabytes".to_vec();
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
    }

    fn mode(path: &Path) -> u32 {
        std::fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[test]
    fn a_clean_install_writes_the_editor_its_menu_entry_icons_and_command() {
        let machine = Machine::new();
        let layout = &machine.layout;
        let folder = layout.default_folder();
        assert!(layout.existing().is_none(), "nothing is installed yet");

        let steps = machine
            .install(&machine.options(true), "0.3.1")
            .expect("the install");

        let app = folder.join(APP_BIN);
        assert_eq!(std::fs::read(&app).unwrap(), machine.editor);
        assert_eq!(mode(&app), 0o755, "a program that can be started");
        assert_eq!(
            std::fs::read(folder.join(UNINSTALLER)).unwrap(),
            b"the setup itself"
        );
        assert_eq!(mode(&folder.join(UNINSTALLER)), 0o755);
        assert!(!folder.join(INCOMING_APP).exists(), "nothing half-written");

        let entry = std::fs::read_to_string(layout.applications.join(DESKTOP_ENTRY)).unwrap();
        assert!(entry.contains(&format!("Exec=\"{}\" %F", app.display())));
        assert!(entry.contains(&format!(
            "Exec=\"{}\" --uninstall",
            folder.join(UNINSTALLER).display()
        )));
        assert!(entry.contains("Categories=Utility;TextEditor;"));
        assert!(entry.contains("MimeType=text/plain;"));
        assert!(entry.contains("X-UwUNotes-Setup=0.3.1"));
        assert_eq!(mode(&layout.applications.join(DESKTOP_ENTRY)), 0o644);

        for (path, bytes) in layout.icon_paths() {
            assert_eq!(std::fs::read(&path).unwrap(), bytes, "{}", path.display());
            assert_eq!(mode(&path), 0o644);
        }
        assert!(files::is_link_to(&layout.bin.join(APP_BIN), &app));
        assert!(is_ours(&layout.desktop.join(DESKTOP_ENTRY)));

        let existing = layout.existing().expect("it is installed now");
        assert_eq!(existing.version.as_deref(), Some("0.3.1"));
        assert_eq!(existing.folder, folder);
        assert!(layout.wanted_desktop_shortcut());

        let percents: Vec<f64> = steps.iter().map(|step| step.percent).collect();
        assert!(
            percents.windows(2).all(|pair| pair[1] >= pair[0]),
            "the bar only ever moves forward: {percents:?}"
        );
        assert_eq!(steps.last().map(|step| step.percent), Some(100.0));
    }

    #[test]
    fn an_update_replaces_the_editor_and_keeps_the_choices_that_were_made() {
        let machine = Machine::new();
        let layout = &machine.layout;
        machine
            .install(&machine.options(false), "0.3.0")
            .expect("the first install");
        assert!(!layout.desktop.join(DESKTOP_ENTRY).exists());

        let options = Options {
            folder: layout.default_folder().display().to_string(),
            desktop_shortcut: layout.wanted_desktop_shortcut(),
            launch_when_done: false,
        };
        check_not_older(
            layout.existing().and_then(|e| e.version).as_deref(),
            "0.3.1",
        )
        .expect("0.3.1 is newer than 0.3.0");
        machine.install(&options, "0.3.1").expect("the update");

        assert_eq!(
            layout.existing().and_then(|e| e.version).as_deref(),
            Some("0.3.1")
        );
        assert!(
            !layout.desktop.join(DESKTOP_ENTRY).exists(),
            "an update does not add a shortcut the user declined"
        );
    }

    #[test]
    fn uninstalling_removes_what_the_setup_wrote_and_keeps_what_it_did_not() {
        let machine = Machine::new();
        let layout = &machine.layout;
        let folder = layout.default_folder();
        machine
            .install(&machine.options(true), "0.3.1")
            .expect("the install");

        std::fs::create_dir_all(&layout.data[0]).unwrap();
        std::fs::write(layout.data[0].join("session.json"), b"open tabs").unwrap();
        std::fs::write(folder.join("notes.txt"), b"mine").unwrap();
        // Somebody else's entry, under a name of its own, beside ours.
        std::fs::write(
            layout.applications.join("other.desktop"),
            b"[Desktop Entry]",
        )
        .unwrap();

        uninstall(layout, &folder, true, &mut |_| {}).expect("the uninstall");

        assert!(!folder.join(APP_BIN).exists());
        assert!(!folder.join(UNINSTALLER).exists());
        assert!(!layout.applications.join(DESKTOP_ENTRY).exists());
        assert!(!layout.desktop.join(DESKTOP_ENTRY).exists());
        assert!(!files::is_symlink(&layout.bin.join(APP_BIN)));
        for (path, _) in layout.icon_paths() {
            assert!(!path.exists(), "{}", path.display());
        }
        assert!(layout.existing().is_none());
        assert!(layout.applications.join("other.desktop").exists());
        assert!(folder.join("notes.txt").exists());
        assert!(layout.data[0].join("session.json").exists());

        uninstall(layout, &folder, false, &mut |_| {}).expect("the second uninstall");
        assert!(!layout.data[0].exists());
    }

    #[test]
    fn a_menu_entry_or_command_that_is_somebody_elses_is_left_alone() {
        let machine = Machine::new();
        let layout = &machine.layout;
        std::fs::create_dir_all(&layout.bin).unwrap();
        std::fs::write(layout.bin.join(APP_BIN), b"#!/bin/sh\necho mine\n").unwrap();

        machine
            .install(&machine.options(false), "0.3.1")
            .expect("installs without the command");
        assert_eq!(
            std::fs::read(layout.bin.join(APP_BIN)).unwrap(),
            b"#!/bin/sh\necho mine\n"
        );

        // An entry that has lost the setup's mark is no longer the setup's.
        std::fs::write(
            layout.applications.join(DESKTOP_ENTRY),
            b"[Desktop Entry]\nName=Mine\n",
        )
        .unwrap();
        uninstall(layout, &layout.default_folder(), true, &mut |_| {}).unwrap();
        assert!(layout.bin.join(APP_BIN).exists());
        assert!(layout.applications.join(DESKTOP_ENTRY).exists());
    }

    #[test]
    fn a_link_where_the_editor_goes_stops_the_install_before_anything_is_written() {
        let machine = Machine::new();
        let layout = &machine.layout;
        let elsewhere = machine._root.path().join("elsewhere");
        std::fs::create_dir_all(&elsewhere).unwrap();
        std::fs::create_dir_all(layout.default_folder.parent().unwrap()).unwrap();
        std::os::unix::fs::symlink(&elsewhere, &layout.default_folder).unwrap();

        assert!(machine.install(&machine.options(false), "0.3.1").is_err());
        assert_eq!(std::fs::read_dir(&elsewhere).unwrap().count(), 0);
    }

    #[test]
    fn a_path_is_quoted_for_exec_and_nothing_can_break_out_of_it() {
        assert_eq!(
            exec_argument(Path::new("/home/nyu/.local/share/uwunotes/uwunotes")).unwrap(),
            r#""/home/nyu/.local/share/uwunotes/uwunotes""#
        );
        // Every character Exec treats specially, once each. The string level
        // doubles each backslash the Exec level put in.
        assert_eq!(
            exec_argument(Path::new(r#"/home/a "b" `c` $d \e 100%/uwunotes"#)).unwrap(),
            r#""/home/a \\"b\\" \\`c\\` \\$d \\\\e 100%%/uwunotes""#
        );
        assert!(exec_argument(Path::new("/home/nyu\nExec=/bin/evil/uwunotes")).is_err());
        assert_eq!(
            entry_string(Path::new(r"/home/back\slash")).unwrap(),
            r"/home/back\\slash"
        );
    }

    #[test]
    fn an_interrupted_copy_of_the_uninstaller_is_the_file_uninstall_clears_away() {
        let incoming = files::incoming(&Path::new("/x").join(UNINSTALLER));
        assert_eq!(
            incoming.file_name().and_then(OsStr::to_str),
            Some(INCOMING_UNINSTALL)
        );
    }

    #[test]
    fn the_desktop_folder_comes_from_user_dirs() {
        let home = Path::new("/home/nyu");
        assert_eq!(
            desktop_from_user_dirs(
                "# written by xdg-user-dirs-update\nXDG_DESKTOP_DIR=\"$HOME/Schreibtisch\"\n",
                home
            ),
            Some(PathBuf::from("/home/nyu/Schreibtisch"))
        );
        assert_eq!(
            desktop_from_user_dirs("XDG_DESKTOP_DIR=\"/data/desk\"", home),
            Some(PathBuf::from("/data/desk"))
        );
        assert_eq!(
            desktop_from_user_dirs("XDG_DESKTOP_DIR=\"$HOME/\"", home),
            None
        );
        assert_eq!(
            desktop_from_user_dirs("XDG_MUSIC_DIR=\"$HOME/Music\"", home),
            None
        );
    }
}
