//! What the setup does when it is started, and the commands its page calls.
//!
//! Three ways in, and the command line decides which:
//!
//! - nothing — the window opens and the user installs, repairs or moves their
//!   UwUNotes;
//! - `--update` (or an NSIS switch, see [`parse_arguments`]) — an update the
//!   app itself started, which runs with no window at all;
//! - `--uninstall` — the entry in Windows' list of installed apps.
//!
//! What this module deliberately does not do: put a window in front of a silent
//! update. The editor is gone from the screen by then and the user is waiting
//! for it to come back, so a window with a button in it would be a program
//! nobody can find waiting for a click nobody knows to give. A silent run
//! therefore never starts Tauri: it installs, starts the editor again, and is
//! over. The only thing it can say is a message box, and it only says it when
//! the update did not happen.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager as _, State, WebviewUrl, WebviewWindowBuilder};

use crate::install::{
    self, Existing, Installed, Layout, Options, Package, Progress, SetupError, APP_EXE,
};
use crate::system;

const VERSION: &str = env!("CARGO_PKG_VERSION");
const TITLE: &str = "UwUNotes Setup";

/// How long a silent update waits for the editor to be gone. It closed itself
/// before starting this, so the wait is for Windows to let go of the file, not
/// for a person.
const HANDOVER_TIMEOUT: Duration = Duration::from_secs(15);

/// Why the setup was started.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Launch {
    /// A window, and a user in front of it.
    Interactive,
    /// An update, with nothing to show and nobody to ask.
    Update {
        /// The app's process, to wait for before replacing its file.
        wait_pid: Option<u32>,
        /// Start the editor again afterwards.
        relaunch: bool,
    },
    Uninstall {
        folder: Option<PathBuf>,
        /// Already running from the copy in the temp folder, which is the only
        /// place an uninstaller can delete itself from.
        from_temp: bool,
        /// Remove it without putting a window up: `/S` out of a script, or a
        /// management tool taking the program off a machine nobody is sitting
        /// at. Windows' own "Installed apps" list passes no switch and gets the
        /// window, which is what somebody clicking Uninstall should get.
        silent: bool,
    },
}

/// Reads the command line.
///
/// `--update --wait-pid <pid>` is how UwUNotes hands over to a downloaded
/// setup, and `--uninstall` comes from Windows' list of installed apps.
///
/// The NSIS switches are the load-bearing part. Everyone on 0.2.0 has
/// `tauri-plugin-updater`, which downloads the new setup and starts it the way
/// it starts the stock NSIS installer: with `/P`, `/R`, `/S` or `/NCRC`, and
/// never with `--update`. A setup that showed them a window would be a window
/// they cannot find, behind an editor that has already closed, and their update
/// would hang there forever. So any of those four means exactly what `--update`
/// means: install, say nothing, and be quick about it.
///
/// Anything else on the command line is ignored rather than refused, for the
/// same reason — a future updater that adds a switch must not be able to turn
/// an update into an error message.
fn parse_arguments(arguments: &[String]) -> Launch {
    let has = |wanted: &str| {
        arguments
            .iter()
            .any(|argument| argument.eq_ignore_ascii_case(wanted))
    };
    let value_after = |flag: &str| {
        arguments
            .iter()
            .position(|argument| argument.eq_ignore_ascii_case(flag))
            .and_then(|at| arguments.get(at + 1))
    };

    let nsis = ["/S", "/P", "/R", "/NCRC"].iter().any(|switch| has(switch));
    if has("--uninstall") {
        return Launch::Uninstall {
            folder: value_after("--dir").map(PathBuf::from),
            from_temp: has("--from-temp"),
            // `/R` is not in here: for an install it means "start it again
            // afterwards", and there is nothing to start again once the program
            // is gone.
            silent: has("--silent") || has("/S") || has("/P") || has("/NCRC"),
        };
    }
    if has("--update") || nsis {
        let wait_pid = value_after("--wait-pid").and_then(|pid| pid.parse().ok());
        return Launch::Update {
            wait_pid,
            // `/R` is the updater asking for the app to be started again, and
            // `--wait-pid` means it was running a moment ago. A plain `/S` from
            // somebody's own script gets an install and nothing else.
            relaunch: has("/R") || has("--relaunch") || wait_pid.is_some(),
        };
    }
    Launch::Interactive
}

/// What the page is looking at. Computed from what is installed rather than
/// from the command line, so "update" means the same thing whether the app
/// started the setup or the user did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum Mode {
    Install,
    Update,
    Uninstall,
    /// The same version again.
    Reinstall,
    /// Older than what is installed. The page may still offer it; a silent
    /// update never does — see [`install::check_not_older`].
    Downgrade,
}

fn mode(existing: Option<&Existing>, packed: &str, uninstalling: bool) -> Mode {
    if uninstalling {
        return Mode::Uninstall;
    }
    let Some(existing) = existing else {
        return Mode::Install;
    };
    let parse = |version: &str| semver::Version::parse(version.trim()).ok();
    match (existing.version.as_deref().and_then(parse), parse(packed)) {
        (Some(installed), Some(packed)) if packed > installed => Mode::Update,
        (Some(installed), Some(packed)) if packed < installed => Mode::Downgrade,
        // Including an installation whose version cannot be read: something is
        // there, and writing over it is a reinstall whatever it says.
        _ => Mode::Reinstall,
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SetupState {
    setup_version: String,
    installed_version: Option<String>,
    mode: Mode,
    default_folder: String,
    has_payload: bool,
    /// Whether this run was started by an updater. A silent run has no window,
    /// so a page that reads this always reads `false`; it is here because the
    /// page must never assume the opposite of itself.
    silent: bool,
    /// Remembered from the last install, so an update does not take away a
    /// shortcut the user asked for. Not part of the agreed shape, and the page
    /// is free to ignore it.
    desktop_shortcut: bool,
}

struct Setup {
    layout: Layout,
    launch: Launch,
    /// Where the uninstaller removes UwUNotes from.
    uninstall_folder: Option<PathBuf>,
    /// Where the last install put it, for `launch_installed_app`.
    installed_folder: Mutex<Option<PathBuf>>,
    busy: Mutex<bool>,
}

impl Setup {
    fn state(&self) -> SetupState {
        let existing = self.layout.existing();
        SetupState {
            setup_version: VERSION.to_owned(),
            installed_version: existing
                .as_ref()
                .and_then(|existing| existing.version.clone()),
            mode: mode(
                existing.as_ref(),
                VERSION,
                matches!(self.launch, Launch::Uninstall { .. }),
            ),
            default_folder: match &self.launch {
                Launch::Uninstall { .. } => self
                    .uninstall_folder
                    .clone()
                    .unwrap_or_default()
                    .display()
                    .to_string(),
                _ => self.layout.default_folder().display().to_string(),
            },
            has_payload: install::has_payload(),
            silent: matches!(self.launch, Launch::Update { .. }),
            desktop_shortcut: self.layout.wanted_desktop_shortcut(),
        }
    }
}

/// Refuses a second install while one is running. Pressing the button twice is
/// the easiest way to have two threads writing the same file.
struct BusyGuard<'a>(&'a Mutex<bool>);

impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut busy) = self.0.lock() {
            *busy = false;
        }
    }
}

fn claim(setup: &Setup) -> Result<BusyGuard<'_>, SetupError> {
    let mut busy = setup
        .busy
        .lock()
        .map_err(|_| SetupError::other("The setup stopped unexpectedly."))?;
    if *busy {
        return Err(SetupError::other("The setup is already working."));
    }
    *busy = true;
    Ok(BusyGuard(&setup.busy))
}

#[tauri::command]
fn setup_state(setup: State<'_, Setup>) -> SetupState {
    setup.state()
}

#[tauri::command]
async fn install(
    app: AppHandle,
    options: Options,
    on_progress: Channel<Progress>,
) -> Result<Installed, SetupError> {
    tauri::async_runtime::spawn_blocking(move || {
        let setup = app.state::<Setup>();
        let _busy = claim(&setup)?;
        let package = Package::packed()?;
        let installed = install::install(
            &setup.layout,
            &package,
            &options,
            VERSION,
            &mut |progress| {
                // A page that has gone away is worth no more than dropping the
                // message: the install is what matters, and it finishes.
                let _ = on_progress.send(progress);
            },
        )?;
        if let Ok(mut folder) = setup.installed_folder.lock() {
            *folder = Some(PathBuf::from(&installed.folder));
        }
        Ok(installed)
    })
    .await
    .map_err(|error| SetupError::other(format!("The setup stopped unexpectedly: {error}")))?
}

#[tauri::command]
async fn uninstall(app: AppHandle, keep_settings: bool) -> Result<(), SetupError> {
    tauri::async_runtime::spawn_blocking(move || {
        let setup = app.state::<Setup>();
        let _busy = claim(&setup)?;
        let folder = setup
            .uninstall_folder
            .clone()
            .or_else(|| setup.layout.existing().map(|existing| existing.folder))
            .ok_or_else(|| SetupError::other("There is no UwUNotes here to remove."))?;
        install::uninstall(&setup.layout, &folder, keep_settings, &mut |_| {})
    })
    .await
    .map_err(|error| SetupError::other(format!("The setup stopped unexpectedly: {error}")))?
}

#[tauri::command]
fn launch_installed_app(setup: State<'_, Setup>) -> Result<(), SetupError> {
    let folder = setup
        .installed_folder
        .lock()
        .ok()
        .and_then(|folder| folder.clone())
        .or_else(|| setup.layout.existing().map(|existing| existing.folder))
        .ok_or_else(|| SetupError::other("UwUNotes isn't installed."))?;
    if setup.layout.sandbox {
        return Ok(());
    }
    system::spawn_detached(&folder.join(APP_EXE), &[]).map_err(SetupError::other)
}

#[tauri::command(async)]
fn open_external(url: String) -> Result<(), SetupError> {
    system::open_link(&url).map_err(SetupError::other)
}

#[tauri::command]
fn close_setup(app: AppHandle) {
    let setup = app.state::<Setup>();
    if let Launch::Uninstall {
        from_temp: true, ..
    } = setup.launch
    {
        if let Ok(copy) = std::env::current_exe() {
            system::delete_after_exit(&copy);
        }
    }
    app.exit(0);
}

/// The commands the page may call, in one place: `generate_handler!` and the
/// list the test at the bottom checks the page against are built from the same
/// names. A command the page calls and the handler does not have typechecks
/// cleanly on both sides and fails at run time, in front of the user.
macro_rules! commands {
    ($($command:ident),+ $(,)?) => {
        #[cfg(test)]
        const COMMANDS: &[&str] = &[$(stringify!($command)),+];

        fn handler() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
            tauri::generate_handler![$($command),+]
        }
    };
}

commands![
    setup_state,
    install,
    uninstall,
    launch_installed_app,
    open_external,
    close_setup,
];

pub fn run() {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let launch = parse_arguments(&arguments);
    let layout = Layout::detect();

    if let Launch::Update { wait_pid, relaunch } = launch {
        update_silently(&layout, wait_pid, relaunch);
        return;
    }

    let uninstall_folder = match &launch {
        Launch::Uninstall { folder, .. } => folder
            .clone()
            .or_else(|| layout.existing().map(|existing| existing.folder))
            .or_else(|| {
                std::env::current_exe()
                    .ok()
                    .and_then(|me| me.parent().map(Path::to_path_buf))
            }),
        _ => None,
    };

    // Windows will not delete a running program, and the uninstaller is one. So
    // it starts again from a copy in the temp folder, which removes itself when
    // the window closes.
    if let (
        Launch::Uninstall {
            from_temp: false,
            silent,
            ..
        },
        Some(folder),
    ) = (&launch, &uninstall_folder)
    {
        if restart_from_temp(folder, *silent) {
            return;
        }
    }

    // A silent removal never reaches the window below: it does the work here and
    // ends, so whoever called it can wait for the process and believe the exit
    // code. Settings are kept, because a switch on a command line is a thin
    // thing to read "and throw away their notes" into.
    if let (
        Launch::Uninstall {
            from_temp: true,
            silent: true,
            ..
        },
        Some(folder),
    ) = (&launch, &uninstall_folder)
    {
        let failed = install::uninstall(&layout, folder, true, &mut |_| {}).is_err();
        // The same tidy-up `close_setup` does for the window: this copy is in
        // the temp folder and cannot delete itself while it is running.
        if let Ok(copy) = std::env::current_exe() {
            system::delete_after_exit(&copy);
        }
        std::process::exit(i32::from(failed));
    }

    if !offer_webview2() {
        return;
    }

    let setup = Setup {
        layout,
        launch,
        uninstall_folder,
        installed_folder: Mutex::new(None),
        busy: Mutex::new(false),
    };
    tauri::Builder::default()
        .manage(setup)
        .setup(|app| {
            // The window's own browser data goes to the temp folder. The
            // editor's belongs to the editor, and a setup that shares it would
            // leave something behind after an uninstall.
            let data = std::env::temp_dir().join("UwUNotes-Setup-WebView");
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title(TITLE)
                .inner_size(460.0, 640.0)
                .resizable(false)
                .maximizable(false)
                .decorations(false)
                .shadow(true)
                .center()
                .data_directory(data)
                .build()?;
            Ok(())
        })
        .invoke_handler(handler())
        .run(tauri::generate_context!())
        .expect("failed to start UwUNotes Setup");
}

/// The whole of an update the app started: wait for it to be gone, refuse to go
/// backwards, install, and start it again.
fn update_silently(layout: &Layout, wait_pid: Option<u32>, relaunch: bool) {
    let folder = layout.default_folder();
    if let Some(pid) = wait_pid {
        system::wait_for_exit(pid, HANDOVER_TIMEOUT);
    }
    install::wait_for_app_to_close(layout, &folder, HANDOVER_TIMEOUT);

    let existing = layout.existing();
    let result = install::check_not_older(
        existing
            .as_ref()
            .and_then(|existing| existing.version.as_deref()),
        VERSION,
    )
    .and_then(|()| Package::packed())
    .and_then(|package| {
        let options = Options {
            folder: folder.display().to_string(),
            // Never a decision of its own: whatever the user chose last time.
            desktop_shortcut: layout.wanted_desktop_shortcut(),
            launch_when_done: relaunch,
        };
        install::install(layout, &package, &options, VERSION, &mut |_| {})
    });

    if let Err(error) = result {
        // Nobody is looking at a window, the editor has closed itself, and
        // without this the update would simply be the moment UwUNotes vanished.
        let (title, headline) = if system::is_german() {
            (TITLE, "Das Update konnte nicht installiert werden.")
        } else {
            (TITLE, "The update could not be installed.")
        };
        system::alert(title, &format!("{headline}\n\n{}", error.message));
        // The editor that is still installed is the one the user had a moment
        // ago; give it back rather than leaving them with nothing.
        if relaunch {
            if let Some(existing) = existing {
                let _ = system::spawn_detached(&existing.folder.join(APP_EXE), &[]);
            }
        }
        // The updater that started this has already ended, but a `/S` out of
        // somebody's own script is owed a truthful answer.
        std::process::exit(1);
    }
}

/// Copies the uninstaller to the temp folder and starts it there. `true` when
/// that worked and this process should stop.
fn restart_from_temp(folder: &Path, silent: bool) -> bool {
    let Ok(me) = std::env::current_exe() else {
        return false;
    };
    let copy = std::env::temp_dir().join(format!("UwUNotes-Uninstall-{}.exe", std::process::id()));
    if std::fs::copy(&me, &copy).is_err() {
        return false;
    }
    let folder = folder.display().to_string();
    let mut arguments = vec!["--uninstall", "--from-temp", "--dir", folder.as_str()];
    // Without this the copy would forget it was asked to be quiet: the process
    // that was asked exits 0 straight away, and the one actually doing the work
    // puts a window up that nobody is waiting at. A script sees success and a
    // machine is left with the program still on it.
    if silent {
        arguments.push("--silent");
    }
    system::spawn_detached(&copy, &arguments).is_ok()
}

/// The window needs WebView2, and so does the editor it installs. Windows 11
/// always has it and Windows 10 usually does; when it is missing the setup
/// offers to fetch it, because the alternative is a program that starts and
/// shows nothing. `false` means the setup should stop.
fn offer_webview2() -> bool {
    if system::webview2_installed() {
        return true;
    }
    let (question, failed) = if system::is_german() {
        (
            "UwUNotes braucht Microsoft Edge WebView2. Jetzt herunterladen und installieren?",
            "WebView2 konnte nicht installiert werden.",
        )
    } else {
        (
            "UwUNotes needs Microsoft Edge WebView2. Download and install it now?",
            "WebView2 could not be installed.",
        )
    };
    if !system::ask(TITLE, question) {
        return false;
    }
    match system::install_webview2() {
        Ok(()) => true,
        Err(error) => {
            system::alert(TITLE, &format!("{failed}\n\n{error}"));
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(arguments: &[&str]) -> Launch {
        let arguments: Vec<String> = arguments.iter().map(|a| (*a).to_owned()).collect();
        parse_arguments(&arguments)
    }

    #[test]
    fn nothing_on_the_command_line_means_a_window() {
        assert_eq!(parse(&[]), Launch::Interactive);
        assert_eq!(
            parse(&["--frobnicate", "/QUIET", "C:\\somewhere\\else"]),
            Launch::Interactive,
            "an argument nobody knows is ignored, not refused"
        );
    }

    /// Found by removing the published 0.3.0 from a sandbox: `--uninstall /S`
    /// exited 0 immediately and left a window nobody was waiting at, with the
    /// program still installed. The uninstaller restarts itself from the temp
    /// folder — Windows will not delete a running program — and the restart
    /// passed a fixed argument list that dropped the switch.
    #[test]
    fn a_silent_removal_stays_silent_when_the_uninstaller_restarts_itself() {
        for switch in ["--silent", "/S", "/s", "/P", "/NCRC"] {
            assert!(
                matches!(
                    parse(&["--uninstall", switch]),
                    Launch::Uninstall { silent: true, .. }
                ),
                "{switch} has to remove it without asking"
            );
        }
        // Windows' own list of installed apps passes no switch, and somebody
        // who clicked Uninstall should be asked.
        assert!(matches!(
            parse(&["--uninstall"]),
            Launch::Uninstall { silent: false, .. }
        ));
        // `/R` means "start it again afterwards", which is meaningless once the
        // program is gone, so it is not a reason to skip the window.
        assert!(matches!(
            parse(&["--uninstall", "/R"]),
            Launch::Uninstall { silent: false, .. }
        ));
    }

    /// The switches `tauri-plugin-updater` starts an NSIS installer with. A
    /// 0.2.0 that is offered 0.3.0 uses these and nothing else, so each of them
    /// has to mean a silent update.
    #[test]
    fn every_switch_the_updater_uses_means_a_silent_update() {
        for switch in ["/P", "/R", "/S", "/NCRC", "/s", "/ncrc"] {
            assert!(
                matches!(parse(&[switch]), Launch::Update { .. }),
                "{switch} has to install without asking"
            );
        }
        assert_eq!(
            parse(&["/P", "/R"]),
            Launch::Update {
                wait_pid: None,
                relaunch: true,
            },
            "what 0.2.0's updater actually sends"
        );
        assert_eq!(
            parse(&["/S"]),
            Launch::Update {
                wait_pid: None,
                relaunch: false,
            },
            "a silent install from somebody's script starts nothing afterwards"
        );
        assert_eq!(
            parse(&["/S", "/NCRC", "--nonsense"]),
            Launch::Update {
                wait_pid: None,
                relaunch: false,
            }
        );
    }

    #[test]
    fn the_app_hands_over_with_update_and_a_process_to_wait_for() {
        assert_eq!(
            parse(&["--update", "--wait-pid", "4242"]),
            Launch::Update {
                wait_pid: Some(4242),
                relaunch: true,
            },
            "the app was running a moment ago, so it is started again"
        );
        assert_eq!(
            parse(&["--update"]),
            Launch::Update {
                wait_pid: None,
                relaunch: false,
            }
        );
        assert_eq!(
            parse(&["--update", "--wait-pid", "not-a-number"]),
            Launch::Update {
                wait_pid: None,
                relaunch: false,
            },
            "a pid that is not one is no pid at all"
        );
        assert_eq!(
            parse(&["--update", "--wait-pid"]),
            Launch::Update {
                wait_pid: None,
                relaunch: false,
            },
            "and neither is a missing one"
        );
    }

    #[test]
    fn the_uninstaller_knows_where_it_is_working_and_whether_it_is_the_copy() {
        assert_eq!(
            parse(&["--uninstall"]),
            Launch::Uninstall {
                folder: None,
                from_temp: false,
                silent: false,
            }
        );
        assert_eq!(
            parse(&["--uninstall", "--from-temp", "--dir", r"C:\Apps\UwUNotes"]),
            Launch::Uninstall {
                folder: Some(PathBuf::from(r"C:\Apps\UwUNotes")),
                from_temp: true,
                silent: false,
            }
        );
        // What `restart_from_temp` now sends on for a silent removal.
        assert_eq!(
            parse(&[
                "--uninstall",
                "--from-temp",
                "--dir",
                r"C:\Apps\UwUNotes",
                "--silent"
            ]),
            Launch::Uninstall {
                folder: Some(PathBuf::from(r"C:\Apps\UwUNotes")),
                from_temp: true,
                silent: true,
            }
        );
        assert!(
            matches!(parse(&["--uninstall", "/S"]), Launch::Uninstall { .. }),
            "removing it wins over installing it"
        );
    }

    #[test]
    fn the_mode_follows_what_is_installed() {
        let installed = |version: Option<&str>| Existing {
            folder: PathBuf::from(r"C:\Programs\UwUNotes"),
            version: version.map(str::to_owned),
            legacy: false,
        };
        let at = |version: &str| mode(Some(&installed(Some(version))), "0.3.0", false);

        assert_eq!(mode(None, "0.3.0", false), Mode::Install);
        assert_eq!(at("0.2.0"), Mode::Update);
        assert_eq!(at("0.3.0"), Mode::Reinstall);
        assert_eq!(at("0.4.0"), Mode::Downgrade);
        assert_eq!(at("0.3.0-rc.1"), Mode::Update);
        assert_eq!(
            mode(Some(&installed(None)), "0.3.0", false),
            Mode::Reinstall,
            "something is there even when it will not say what"
        );
        assert_eq!(
            mode(Some(&installed(Some("0.2.0"))), "0.3.0", true),
            Mode::Uninstall,
            "the uninstaller is not interested in versions"
        );
    }

    #[test]
    fn the_state_serialises_the_way_the_page_reads_it() {
        let state = SetupState {
            setup_version: "0.3.0".into(),
            installed_version: None,
            mode: Mode::Install,
            default_folder: r"C:\Programs\UwUNotes".into(),
            has_payload: true,
            silent: false,
            desktop_shortcut: true,
        };
        assert_eq!(
            serde_json::to_string(&state).unwrap(),
            concat!(
                r#"{"setupVersion":"0.3.0","installedVersion":null,"mode":"install","#,
                r#""defaultFolder":"C:\\Programs\\UwUNotes","hasPayload":true,"#,
                r#""silent":false,"desktopShortcut":true}"#,
            )
        );
        for (mode, name) in [
            (Mode::Install, "install"),
            (Mode::Update, "update"),
            (Mode::Uninstall, "uninstall"),
            (Mode::Reinstall, "reinstall"),
            (Mode::Downgrade, "downgrade"),
        ] {
            assert_eq!(serde_json::to_value(mode).unwrap(), name);
        }
    }

    /// The page and the handler are one contract, and nothing in either half
    /// notices when they drift apart: an `invoke` of a command that does not
    /// exist compiles, ships, and fails when the user presses the button.
    ///
    /// The page is written next to this crate and may not be there yet, in
    /// which case there is nothing to check.
    #[test]
    fn the_page_calls_no_command_that_is_not_in_the_handler() {
        assert_eq!(COMMANDS.len(), 6, "the shape agreed with the page");

        let page = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src");
        let Ok(files) = typescript_files(&page) else {
            return;
        };
        for file in files {
            let source = std::fs::read_to_string(&file).unwrap_or_default();
            for command in invoked_commands(&source) {
                assert!(
                    COMMANDS.contains(&command.as_str()),
                    "{} calls `{command}`, which the setup does not have",
                    file.display()
                );
            }
        }
    }

    fn typescript_files(folder: &Path) -> std::io::Result<Vec<PathBuf>> {
        let mut found = Vec::new();
        for entry in std::fs::read_dir(folder)? {
            let path = entry?.path();
            if path.is_dir() {
                found.extend(typescript_files(&path)?);
            } else if path
                .extension()
                .is_some_and(|extension| extension == "ts" || extension == "tsx")
            {
                found.push(path);
            }
        }
        Ok(found)
    }

    /// The names in `invoke('…')` and `invoke<T>('…')`. A call whose name is a
    /// variable is not one this can check, and is skipped.
    fn invoked_commands(source: &str) -> Vec<String> {
        let mut found = Vec::new();
        let mut rest = source;
        while let Some(at) = rest.find("invoke") {
            rest = &rest[at + "invoke".len()..];
            let after = rest.trim_start();
            // `invoke<Something>('name')` as well as `invoke('name')`.
            let after = match after.strip_prefix('<') {
                Some(generic) => match generic.find('>') {
                    Some(end) => generic[end + 1..].trim_start(),
                    None => continue,
                },
                None => after,
            };
            let Some(arguments) = after.strip_prefix('(') else {
                continue;
            };
            let arguments = arguments.trim_start();
            let quote = match arguments.chars().next() {
                Some(quote @ ('\'' | '"' | '`')) => quote,
                _ => continue,
            };
            if let Some(end) = arguments[1..].find(quote) {
                found.push(arguments[1..=end].to_owned());
            }
        }
        found
    }
}
