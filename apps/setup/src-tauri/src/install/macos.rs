//! Putting UwUNotes on a Mac, and taking it off again.
//!
//! Per user and without an administrator: the editor is an app bundle, and it
//! goes to `~/Applications/UwUNotes.app` — the Applications folder of the
//! user's own, which Finder, Spotlight and Launchpad all look in, and which
//! nobody needs a password to write to. `~/Applications` is made when it is not
//! there yet. On request an alias goes onto the desktop; it is a symbolic link
//! to the bundle, which Finder shows and opens as one.
//!
//! The bundle arrives packed as a tar archive inside this setup (`build.rs`),
//! and is unpacked into a hidden folder beside its destination first, then
//! renamed into place: an update swaps one whole bundle for another, and never
//! leaves half of each. Files this setup writes are not downloads, so macOS
//! puts no quarantine mark on them and Gatekeeper does not ask about the
//! editor again after it asked about the setup.
//!
//! What the setup remembers — the version, whether the alias was wanted — goes
//! to `~/Library/Application Support/app.uwunotes.setup`, together with a copy
//! of this setup as `uninstall`. That is the uninstaller: `uninstall
//! --uninstall` removes the bundle, the alias and that folder, and asks the same
//! one question as everywhere else. Dragging the bundle to the Bin works too,
//! as it does for every Mac app; it just leaves the editor's data behind.
//!
//! A bundle at that path that is not UwUNotes — its `Info.plist` names another
//! identifier — is neither overwritten nor removed.

use std::ffi::OsStr;
use std::fs;
use std::os::unix::fs::DirBuilderExt as _;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use super::unix::{self as files, Record, EXECUTABLE};
use super::{
    extract_tree, Existing, Installed, Kind, Options, Package, Progress, Reporter, SetupError, Step,
};
use crate::system;

/// The app's bundle identifier, which is also the name of its data folders.
const APP_ID: &str = "app.uwunotes.desktop";
const BUNDLE: &str = "UwUNotes.app";
/// The setup's own folder under Application Support, named by its own
/// identifier so it can never be mistaken for the editor's data.
const SETUP_ID: &str = "app.uwunotes.setup";
const UNINSTALLER: &str = "uninstall";
const RECORD: &str = "install.json";
const ALIAS: &str = "UwUNotes";
const LSREGISTER: &str = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

/// Where everything belongs on this machine, or inside the sandbox.
pub struct Layout {
    /// `~/Applications/UwUNotes.app`. The "folder" of an installation on a Mac
    /// is its bundle, which is a folder, and the thing a user would point at.
    pub default_folder: PathBuf,
    /// `~/Library/Application Support/app.uwunotes.setup`.
    support: PathBuf,
    desktop: PathBuf,
    /// The editor's folders under `~/Library`: its data (the session, the
    /// drafts), its caches, WebKit's storage (the settings), and the window
    /// state macOS keeps for it.
    data: [PathBuf; 4],
    pub sandbox: bool,
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
        Self::under(&system::home().unwrap_or_default(), false)
    }

    /// The same layout, moved into one folder that belongs to nobody. Nothing
    /// outside `root` is touched, and no system tool is started.
    pub fn sandbox(root: &Path) -> Self {
        Self::under(root, true)
    }

    fn under(home: &Path, sandbox: bool) -> Self {
        let library = home.join("Library");
        Self {
            default_folder: home.join("Applications").join(BUNDLE),
            support: library.join("Application Support").join(SETUP_ID),
            desktop: home.join("Desktop"),
            data: [
                library.join("Application Support").join(APP_ID),
                library.join("Caches").join(APP_ID),
                library.join("WebKit").join(APP_ID),
                library
                    .join("Saved Application State")
                    .join(format!("{APP_ID}.savedState")),
            ],
            sandbox,
        }
    }

    fn record(&self) -> Option<Record> {
        Record::read(&self.support.join(RECORD))
    }

    /// What is installed right now, if anything. The version is the bundle's
    /// own, out of its `Info.plist`: that is what the editor says about itself
    /// in its About box, and it stays true even when somebody copied a bundle
    /// over the one this setup installed. The record is the fallback.
    pub fn existing(&self) -> Option<Existing> {
        let plist = info_plist(&self.default_folder)?;
        if !names_identifier(&plist, APP_ID) {
            return None;
        }
        Some(Existing {
            folder: self.default_folder.clone(),
            version: plist_string(&plist, "CFBundleShortVersionString")
                .or_else(|| self.record().and_then(|record| record.version)),
            legacy: false,
        })
    }

    /// Where an install goes. Always the same bundle: Launch Services, the
    /// alias and the uninstaller all know it by that path.
    pub fn default_folder(&self) -> PathBuf {
        self.default_folder.clone()
    }

    /// Whether the last install put an alias on the desktop. A silent update
    /// has no page to ask, and must not quietly take away a shortcut the user
    /// asked for or add one they declined.
    pub fn wanted_desktop_shortcut(&self) -> bool {
        self.record().map_or_else(
            || files::is_link_to(&self.desktop.join(ALIAS), &self.default_folder),
            |record| record.desktop_shortcut,
        )
    }
}

/// The text of a bundle's `Info.plist`, when it is a bundle and has one.
fn info_plist(bundle: &Path) -> Option<String> {
    if files::is_symlink(bundle) {
        return None;
    }
    let plist = bundle.join("Contents/Info.plist");
    let meta = fs::symlink_metadata(&plist).ok()?;
    // An Info.plist is a few kilobytes. Anything much bigger is not one.
    if !meta.file_type().is_file() || meta.len() > 1024 * 1024 {
        return None;
    }
    fs::read_to_string(plist).ok()
}

/// The `<string>` right after `<key>name</key>` in an XML property list, which
/// is the shape Tauri writes `Info.plist` in. Not a plist parser, and it does
/// not need to be one: two keys, both plain strings, in a file this project
/// builds.
fn plist_string(plist: &str, key: &str) -> Option<String> {
    let after_key = plist.split_once(&format!("<key>{key}</key>"))?.1;
    let value = after_key.trim_start().strip_prefix("<string>")?;
    let value = value.split_once("</string>")?.0.trim();
    (!value.is_empty()).then(|| value.to_owned())
}

fn names_identifier(plist: &str, identifier: &str) -> bool {
    plist_string(plist, "CFBundleIdentifier").as_deref() == Some(identifier)
}

fn is_ours(bundle: &Path) -> bool {
    info_plist(bundle).is_some_and(|plist| names_identifier(&plist, APP_ID))
}

/// Whether a copy of UwUNotes that this install would overwrite is open: any
/// process started from inside the bundle, whatever its executable is called.
pub fn app_running(layout: &Layout, folder: &Path) -> bool {
    // The sandbox describes a machine that does not exist; asking the real one
    // which programs are running would be answering a different question.
    if layout.sandbox {
        return false;
    }
    let inside = folder.join("Contents/MacOS");
    !system::running(|exe| exe.starts_with(&inside)).is_empty()
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

/// Starts the installed editor, the way Finder would.
pub fn launch(layout: &Layout, folder: &Path) -> Result<(), SetupError> {
    if layout.sandbox {
        return Ok(());
    }
    system::open_bundle(folder).map_err(SetupError::other)
}

/// A hidden folder of this run's own, beside the bundle, to unpack into. On the
/// same volume, which is what makes the rename out of it atomic.
fn staging(bundle: &Path) -> PathBuf {
    bundle.with_file_name(format!(".UwUNotes-Setup-{}", std::process::id()))
}

/// Puts the unpacked bundle where the old one was. The old one is moved aside
/// first and only deleted once the new one is in place, so a failure in
/// between puts it back rather than leaving no UwUNotes at all.
fn swap_in(unpacked: &Path, bundle: &Path, staging: &Path) -> Result<(), SetupError> {
    let old = staging.join("previous.app");
    let had_one = bundle.exists();
    if had_one {
        fs::rename(bundle, &old).map_err(|error| {
            SetupError::from_io(&error, format!("Couldn't replace {}", bundle.display()))
        })?;
    }
    if let Err(error) = fs::rename(unpacked, bundle) {
        if had_one {
            let _ = fs::rename(&old, bundle);
        }
        return Err(SetupError::from_io(
            &error,
            format!("Couldn't replace {}", bundle.display()),
        ));
    }
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
    let mut report = Reporter::new(report);
    let bundle = files::the_folder(options, &layout.default_folder)?;
    let applications = bundle
        .parent()
        .ok_or_else(|| SetupError::other("UwUNotes needs a folder to go into."))?
        .to_path_buf();

    report.at(Step::Preparing, 0.0);
    if !wait_for_app_to_close(layout, &bundle, Duration::from_secs(2)) {
        return Err(SetupError::new(
            Kind::InUse,
            "UwUNotes is still open. Quit it and start the setup again.",
        ));
    }
    files::refuse_symlink(&bundle)?;
    if bundle.exists() && !is_ours(&bundle) {
        return Err(SetupError::other(format!(
            "{} is there already and isn't UwUNotes, so it was left alone. Move it away and try again.",
            bundle.display()
        )));
    }
    files::make_folder(&applications)?;
    let staging = staging(&bundle);
    let _ = fs::remove_dir_all(&staging);
    fs::DirBuilder::new()
        .mode(0o700)
        .create(&staging)
        .map_err(|error| {
            SetupError::from_io(&error, format!("Couldn't create {}", staging.display()))
        })?;
    report.at(Step::Preparing, 1.0);

    // Whatever happens next, the staging folder goes: it holds either a
    // half-unpacked bundle or the one that was replaced.
    let placed = extract_tree(package, &staging, &mut report).and_then(|()| {
        let unpacked = staging.join(BUNDLE);
        if !is_ours(&unpacked) {
            return Err(SetupError::other(
                "The packed editor is not UwUNotes.app; the setup file is damaged.",
            ));
        }
        swap_in(&unpacked, &bundle, &staging)
    });
    let _ = fs::remove_dir_all(&staging);
    placed?;

    // The uninstaller is this very program, under another name and with
    // `--uninstall` on its command line. One executable, so the uninstaller can
    // never be a version behind what installed it.
    files::make_folder(&layout.support)?;
    let uninstaller = layout.support.join(UNINSTALLER);
    if package.setup != uninstaller {
        files::copy_atomically(&package.setup, &uninstaller, EXECUTABLE)?;
    }

    report.at(Step::Shortcuts, 0.0);
    let alias = layout.desktop.join(ALIAS);
    if options.desktop_shortcut {
        // A name on the desktop that is somebody else's file stays theirs.
        files::link_if_free(&alias, &bundle)?;
    } else {
        files::remove_link_to(&alias, &bundle);
    }
    report.at(Step::Shortcuts, 1.0);

    report.at(Step::Registry, 0.0);
    Record {
        version: Some(version.to_owned()),
        desktop_shortcut: options.desktop_shortcut,
    }
    .write(&layout.support.join(RECORD))?;
    // Spotlight and Launchpad find a new bundle in ~/Applications by
    // themselves, eventually; this makes it now. Optional in every sense.
    if !layout.sandbox {
        system::run_quietly(LSREGISTER, &[OsStr::new("-f"), bundle.as_os_str()]);
    }
    report.at(Step::Registry, 1.0);
    report.at(Step::Done, 1.0);

    if options.launch_when_done {
        launch(layout, &bundle)?;
    }
    Ok(Installed {
        folder: bundle.display().to_string(),
        exe: bundle.display().to_string(),
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
            "UwUNotes is still open. Quit it and start the uninstaller again.",
        ));
    }
    // Checked before anything is removed: a bundle that is not UwUNotes under
    // that name is somebody else's program.
    let bundle_is_ours = is_ours(folder);
    if folder.exists() && !bundle_is_ours {
        return Err(SetupError::other(format!(
            "{} isn't UwUNotes, so it was left alone.",
            folder.display()
        )));
    }
    report.at(Step::Preparing, 1.0);

    report.at(Step::Shortcuts, 0.0);
    files::remove_link_to(&layout.desktop.join(ALIAS), folder);
    report.at(Step::Shortcuts, 1.0);

    report.at(Step::Registry, 0.0);
    if bundle_is_ours && !layout.sandbox {
        system::run_quietly(LSREGISTER, &[OsStr::new("-u"), folder.as_os_str()]);
    }
    let _ = files::remove_file(&layout.support.join(RECORD));
    report.at(Step::Registry, 1.0);

    report.at(Step::Writing, 0.0);
    if bundle_is_ours {
        // `remove_dir_all` does not follow links inside the bundle, so nothing
        // outside it can go with it.
        fs::remove_dir_all(folder).map_err(|error| {
            SetupError::from_io(&error, format!("Couldn't remove {}", folder.display()))
        })?;
    }
    // The uninstaller is among these — macOS lets a running program's file be
    // deleted, and this process simply keeps its copy.
    let uninstaller = layout.support.join(UNINSTALLER);
    for file in [files::incoming(&uninstaller), uninstaller] {
        let _ = files::remove_file(&file);
    }
    let _ = fs::remove_dir(&layout.support);
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

    const PLIST: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleExecutable</key>
	<string>uwunotes-desktop</string>
	<key>CFBundleIdentifier</key>
	<string>app.uwunotes.desktop</string>
	<key>CFBundleShortVersionString</key>
	<string>{version}</string>
</dict>
</plist>
"#;

    /// A whole home folder in a temporary folder, removed again when the test
    /// ends, and a real bundle packed the way `build.rs` packs one.
    struct Machine {
        _root: tempfile::TempDir,
        layout: Layout,
        setup: PathBuf,
    }

    impl Machine {
        fn new() -> Self {
            let root = tempfile::tempdir().expect("a temporary folder");
            let layout = Layout::sandbox(root.path());
            let setup = root.path().join("UwUNotes Setup");
            fs::write(&setup, b"the setup itself").expect("writing the setup stand-in");
            Self {
                _root: root,
                layout,
                setup,
            }
        }

        /// A bundle with an executable in it, tarred and packed.
        fn packed(&self, version: &str, identifier: &str) -> (Vec<u8>, u64) {
            let source = self._root.path().join(format!("build-{version}"));
            let bundle = source.join(BUNDLE);
            fs::create_dir_all(bundle.join("Contents/MacOS")).unwrap();
            fs::write(
                bundle.join("Contents/Info.plist"),
                PLIST
                    .replace("{version}", version)
                    .replace("app.uwunotes.desktop", identifier),
            )
            .unwrap();
            let exe = bundle.join("Contents/MacOS/uwunotes-desktop");
            fs::write(&exe, format!("the editor {version}")).unwrap();
            fs::set_permissions(&exe, fs::Permissions::from_mode(0o755)).unwrap();

            let mut builder = tar::Builder::new(Vec::new());
            builder.mode(tar::HeaderMode::Deterministic);
            builder.follow_symlinks(false);
            builder.append_dir_all(BUNDLE, &bundle).unwrap();
            let tar = builder.into_inner().unwrap();
            let size = tar.len() as u64;
            (zstd::encode_all(tar.as_slice(), 3).unwrap(), size)
        }

        fn install(&self, version: &str, desktop_shortcut: bool) -> Result<Installed, SetupError> {
            let (payload, size) = self.packed(version, APP_ID);
            self.install_packed(&payload, size, version, desktop_shortcut)
        }

        fn install_packed(
            &self,
            payload: &[u8],
            size: u64,
            version: &str,
            desktop_shortcut: bool,
        ) -> Result<Installed, SetupError> {
            let package = Package {
                payload,
                size,
                setup: self.setup.clone(),
            };
            let options = Options {
                folder: self.layout.default_folder().display().to_string(),
                desktop_shortcut,
                launch_when_done: false,
            };
            install(&self.layout, &package, &options, version, &mut |_| {})
        }
    }

    #[test]
    fn a_clean_install_puts_the_bundle_in_the_users_applications() {
        let machine = Machine::new();
        let layout = &machine.layout;
        assert!(layout.existing().is_none());
        fs::create_dir_all(&layout.desktop).unwrap();

        machine.install("0.3.1", true).expect("the install");

        let bundle = layout.default_folder();
        let exe = bundle.join("Contents/MacOS/uwunotes-desktop");
        assert_eq!(fs::read_to_string(&exe).unwrap(), "the editor 0.3.1");
        assert_eq!(
            fs::metadata(&exe).unwrap().permissions().mode() & 0o111,
            0o111,
            "the executable bit survives the trip through the archive"
        );
        assert!(files::is_link_to(&layout.desktop.join(ALIAS), &bundle));
        assert_eq!(
            fs::read(layout.support.join(UNINSTALLER)).unwrap(),
            b"the setup itself"
        );
        let existing = layout.existing().expect("it is installed now");
        assert_eq!(existing.version.as_deref(), Some("0.3.1"));
        assert!(layout.wanted_desktop_shortcut());
        let leftovers: Vec<_> = fs::read_dir(bundle.parent().unwrap())
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name())
            .collect();
        assert_eq!(leftovers, [BUNDLE], "no staging folder is left behind");
    }

    #[test]
    fn an_update_swaps_the_whole_bundle_and_keeps_the_choices_that_were_made() {
        let machine = Machine::new();
        let layout = &machine.layout;
        machine.install("0.3.0", false).expect("the first install");
        let stale = layout.default_folder().join("Contents/Resources/gone.txt");
        fs::create_dir_all(stale.parent().unwrap()).unwrap();
        fs::write(&stale, b"from 0.3.0").unwrap();

        check_not_older(
            layout.existing().and_then(|e| e.version).as_deref(),
            "0.3.1",
        )
        .expect("0.3.1 is newer than 0.3.0");
        machine
            .install("0.3.1", layout.wanted_desktop_shortcut())
            .expect("the update");

        assert_eq!(
            layout.existing().and_then(|e| e.version).as_deref(),
            Some("0.3.1")
        );
        assert!(
            !stale.exists(),
            "a file the new bundle does not have is gone"
        );
        assert!(!files::is_symlink(&layout.desktop.join(ALIAS)));
    }

    #[test]
    fn a_bundle_that_is_not_uwunotes_is_neither_replaced_nor_removed() {
        let machine = Machine::new();
        let layout = &machine.layout;
        let bundle = layout.default_folder();
        fs::create_dir_all(bundle.join("Contents")).unwrap();
        fs::write(
            bundle.join("Contents/Info.plist"),
            PLIST.replace("app.uwunotes.desktop", "com.example.other"),
        )
        .unwrap();

        assert!(machine.install("0.3.1", false).is_err());
        assert!(uninstall(layout, &bundle, true, &mut |_| {}).is_err());
        assert!(bundle.join("Contents/Info.plist").exists());
        assert!(layout.existing().is_none());

        // And a payload that is somebody else's bundle is not put in place.
        fs::remove_dir_all(&bundle).unwrap();
        let (payload, size) = machine.packed("0.3.1", "com.example.other");
        assert!(machine
            .install_packed(&payload, size, "0.3.1", false)
            .is_err());
        assert!(!bundle.exists());
    }

    #[test]
    fn uninstalling_removes_what_the_setup_wrote_and_keeps_what_it_did_not() {
        let machine = Machine::new();
        let layout = &machine.layout;
        fs::create_dir_all(&layout.desktop).unwrap();
        machine.install("0.3.1", true).expect("the install");
        fs::create_dir_all(&layout.data[0]).unwrap();
        fs::write(layout.data[0].join("session.json"), b"open tabs").unwrap();

        let bundle = layout.default_folder();
        uninstall(layout, &bundle, true, &mut |_| {}).expect("the uninstall");
        assert!(!bundle.exists());
        assert!(!files::is_symlink(&layout.desktop.join(ALIAS)));
        assert!(!layout.support.exists());
        assert!(layout.existing().is_none());
        assert!(layout.data[0].join("session.json").exists());

        uninstall(layout, &bundle, false, &mut |_| {}).expect("the second uninstall");
        assert!(!layout.data[0].exists());
    }

    #[test]
    fn a_damaged_payload_leaves_the_installed_bundle_as_it_was() {
        let machine = Machine::new();
        let layout = &machine.layout;
        machine.install("0.3.0", false).expect("the first install");
        let (payload, size) = machine.packed("0.3.1", APP_ID);
        let cut = &payload[..payload.len() / 2];
        assert!(machine.install_packed(cut, size, "0.3.1", false).is_err());
        assert_eq!(
            layout.existing().and_then(|e| e.version).as_deref(),
            Some("0.3.0")
        );
    }

    #[test]
    fn the_plist_says_what_it_is_and_which_version() {
        let plist = PLIST.replace("{version}", "0.3.1");
        assert_eq!(
            plist_string(&plist, "CFBundleShortVersionString").as_deref(),
            Some("0.3.1")
        );
        assert!(names_identifier(&plist, APP_ID));
        assert!(!names_identifier(&plist, "app.uwunotes"));
        assert_eq!(plist_string(&plist, "CFBundleName"), None);
        assert_eq!(plist_string("<key>A</key><integer>1</integer>", "A"), None);
    }
}
