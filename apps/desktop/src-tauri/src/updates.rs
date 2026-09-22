//! Looking for a newer UwUNotes, and installing one.
//!
//! Two commands and no schedule of its own: the page asks once shortly after
//! start-up, and again whenever the user presses "check now". Everything that
//! decides *what* an update is — which feed, which public key, whether the
//! signature belongs to the file that was downloaded — is
//! `tauri-plugin-updater`'s, configured in `tauri.conf.json` and never
//! overridden here. That is the whole point of the arrangement: an endpoint the
//! page could set, or a path that runs bytes [`Update::download`] has not
//! checked, would turn a text editor into a way of handing somebody a program.
//!
//! On Windows the plugin does not install. The artifact is UwUNotes' own
//! setup — the same file people download by hand, published as
//! `UwUNotes-windows-<x64|arm64>-setup.exe` and signed as
//! `UwUNotes-Setup-<version>.exe` (x64) or
//! `UwUNotes-Setup-<version>-windows-arm64.exe` — and installing it means
//! running it, with `--update --wait-pid <this process>`, and then quitting so
//! it can replace an exe nobody has open any more. The plugin stays for the
//! two steps that must not be hand-rolled: asking the feed, and checking what
//! came back against the public key compiled into this binary. Which of the two
//! setups a copy asks for follows from the processor it was built for: the
//! plugin looks up `windows-x86_64` or `windows-aarch64`, and
//! [`release_file_name`] expects the matching name.
//!
//! That signature is checked a second time here, on the bytes lying on disk,
//! immediately before the setup is started. Between the download and the start
//! the file sits in a folder anything running as this user can write to, and a
//! check of bytes other than the ones that run is not a check. It is read back
//! through a handle that refuses everyone else write and delete access, and
//! that handle is held until the setup process exists.
//!
//! The updater handle is built per call rather than kept in the app state.
//! Building one reads the config and does nothing else, and a stored handle
//! would only be a second place where the endpoint lives. What *is* kept is the
//! [`Update`] the last check found, because installing has to use exactly the
//! artifact whose signature was verified, not whatever the feed says a moment
//! later.
//!
//! What this module deliberately does not do: tell anyone that a check failed.
//! No network, a feed that 404s, a feed full of GitHub's HTML error page — all
//! of them are "no update today" and a `warn` line in the log. The distinction
//! between that and a failure worth showing is the page's, and it only shows
//! one when the user pressed a button first. It also does not decide what
//! installing means — where UwUNotes lives, what is replaced, whether the
//! packed version is newer than the installed one. That is the setup's, and it
//! is the setup that refuses to go backwards.
//!
//! **The Linux packages install through their package manager.** A copy that
//! was installed from UwUNotes' `.deb` or `.rpm` knows it (Tauri's bundler
//! marks the binary), and the plugin looks up `linux-<arch>-deb` or
//! `linux-<arch>-rpm` for it. Such a copy downloads the package, checks it
//! here like a setup, and hands it to `pkexec dpkg -i` or
//! `pkexec rpm -U --oldpackage`; then it restarts into the new version. Not
//! through the plugin's own `install`: that runs `rpm -U` without
//! `--oldpackage`, and rpm sorts `0.5.0-beta.2` after `0.5.0`, so an rpm copy
//! on a beta would refuse the finished version for good. That the offered
//! version is newer has been decided by the feed check already, and that it is
//! the one the release signed by [`verify`]. Only when the user pressed
//! "Install and restart", never by itself at start: the password prompt is not
//! something to spring on anybody. Without pkexec or a polkit agent the error
//! says the `sudo dpkg -i` / `sudo rpm -U --oldpackage` line to type instead.
//!
//! And only if the package manager really owns this executable: the AUR
//! package is the `.deb`'s contents repacked, so it carries the same mark, and
//! running dpkg on an Arch system would be wrong in every way. So [`this_copy`]
//! asks dpkg's own file list, or `rpm -qf`, before it believes the mark.
//!
//! The checked bytes go to a fresh folder only this user can open, and that is
//! the file root installs. Something running as this user that swapped it
//! could as well have started pkexec with a package of its own; the password
//! prompt is the same either way.
//!
//! **Everything else installs by hand**: macOS, the copies the per-user Linux
//! setup of 0.4.x installed, the portable folder, the AUR package. The feed
//! lists them all the same (`darwin-*`, `linux-x86_64`, `linux-aarch64`),
//! because the plugin answers "no such platform" to a copy whose platform the
//! feed does not name — and those copies should hear about a new version as
//! much as any other. But what they would download is a `.tar.gz` or a `.dmg`,
//! not a program to start with `--update`, so there:
//!
//! - [`check_for_update`] answers exactly as on Windows, with
//!   `installable: false` in the [`UpdateCheck::Available`] it sends — the
//!   page's cue to show the version and a link to the releases page instead of
//!   "Install and restart";
//! - [`install_update`] downloads nothing and returns an `FsError` of kind
//!   `other` whose message names [`RELEASES`], for a page that calls it anyway.
//!
//! Which of the three a copy is gets decided at run time, not by `cfg`, so
//! every path below compiles — and is linted and tested — on every system.

use std::fs::File;
use std::io::Read as _;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

use base64::Engine as _;
use serde::Serialize;
use tauri::async_runtime::Mutex;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager as _, State};
use tauri_plugin_updater::{Update, UpdaterExt as _};
use uwunotes_fs::FsError;

use crate::CommandResult;

/// A check nobody is waiting for any more is a check that should stop. Long
/// enough for a slow tethered connection, short enough that "check now" answers
/// while the user is still looking at the button.
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);

/// How far a download moves before the page hears about it again, when the
/// server sent no `Content-Length` and there is no percentage to step by.
const PROGRESS_STEP: u64 = 512 * 1024;

/// Where a downloaded setup waits, under the app's own local data folder.
const UPDATES_FOLDER: &str = "updates";

/// Where an update comes from on a system where the editor cannot install it
/// itself.
pub(crate) const RELEASES: &str = "https://github.com/MinifyX/UwUNotes-Client/releases/latest";

/// What the `.deb` and the `.rpm` call the package, and what dpkg names its
/// file list after.
const PACKAGE: &str = "uwunotes";

/// dpkg's record of the files the `uwunotes` package installed.
const DPKG_LIST: &str = "/var/lib/dpkg/info/uwunotes.list";

/// How this copy of the editor gets a newer version of itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Install {
    /// Runs the downloaded setup with `--update`: every Windows copy.
    Setup,
    /// Hands the downloaded package to the package manager that owns this copy.
    Package(Package),
    /// Says there is an update and links [`RELEASES`].
    ByHand,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Package {
    Deb,
    Rpm,
}

/// How this copy updates, found out once: none of it changes while it runs.
fn this_copy() -> Install {
    static FOUND: OnceLock<Install> = OnceLock::new();
    *FOUND.get_or_init(|| {
        if cfg!(windows) {
            return Install::Setup;
        }
        if !cfg!(target_os = "linux") {
            return Install::ByHand;
        }
        let Ok(exe) = std::env::current_exe() else {
            return Install::ByHand;
        };
        use tauri::utils::config::BundleType;
        match tauri::utils::platform::bundle_type() {
            Some(BundleType::Deb) if dpkg_owns(&exe) => Install::Package(Package::Deb),
            Some(BundleType::Rpm) if rpm_owns(&exe) => Install::Package(Package::Rpm),
            _ => Install::ByHand,
        }
    })
}

/// Whether dpkg installed this executable as part of `uwunotes`. No list, no
/// package: an Arch system with the AUR package has no dpkg database at all.
fn dpkg_owns(exe: &Path) -> bool {
    std::fs::read_to_string(DPKG_LIST).is_ok_and(|list| lists(&list, exe))
}

/// dpkg's `.list` files are one absolute path per line.
fn lists(list: &str, exe: &Path) -> bool {
    list.lines().any(|line| Path::new(line.trim()) == exe)
}

/// Whether rpm's database says `uwunotes` owns this executable.
fn rpm_owns(exe: &Path) -> bool {
    std::process::Command::new("rpm")
        .args(["-qf", "--queryformat", "%{NAME}\\n"])
        .arg(exe)
        .output()
        .is_ok_and(|out| {
            out.status.success() && names_package(&String::from_utf8_lossy(&out.stdout))
        })
}

/// `rpm -qf` prints the owning package's name, one line per owner.
fn names_package(output: &str) -> bool {
    output.lines().any(|line| line.trim() == PACKAGE)
}

/// The update the last check found, waiting for [`install_update`].
///
/// An async mutex rather than a `std` one, because both commands hold it across
/// an `await`: the check while it talks to GitHub, the install while it
/// downloads. Holding it is also what serialises them — a second press of
/// "install" waits for the first instead of fetching the setup twice.
#[derive(Default)]
pub(crate) struct Updates {
    found: Mutex<Option<Update>>,
}

/// What a check found.
///
/// Note the missing fourth possibility: this never comes back as an `Err`. A
/// feed that could not be read is a [`UpdateCheck::Failed`], which the start-up
/// check treats exactly like [`UpdateCheck::None`]. The variant exists so that
/// a check the user asked for can say it got no answer, rather than claiming
/// the editor is up to date when nothing was ever reached.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum UpdateCheck {
    None,
    Available {
        version: String,
        /// The release notes out of the feed. Text written elsewhere, so the
        /// page renders it as text and never as markup.
        notes: Option<String>,
        /// Whether "Install and restart" can work here: `true` on Windows and
        /// for the Linux packages, `false` everywhere else, where the update
        /// is a download from [`RELEASES`] instead.
        installable: bool,
    },
    Failed {
        message: String,
    },
}

/// How far the download has got, for the bar in the hint.
#[derive(Debug, Clone, Serialize)]
pub(crate) struct DownloadProgress {
    received: u64,
    /// `null` when the server sent no `Content-Length`. The page has to draw
    /// something honest for that case rather than invent a percentage.
    total: Option<u64>,
}

/// Asks the feed whether there is a newer version, and remembers the answer.
#[tauri::command]
pub(crate) async fn check_for_update(
    app: AppHandle,
    state: State<'_, Updates>,
) -> CommandResult<UpdateCheck> {
    let mut found = state.found.lock().await;
    // A fresh check drops the old answer first: offering to install something
    // the feed has since withdrawn is worse than having to check again.
    *found = None;

    let updater = match app.updater_builder().timeout(CHECK_TIMEOUT).build() {
        Ok(updater) => updater,
        Err(error) => return Ok(no_answer("the updater could not be set up", &error)),
    };

    match updater.check().await {
        Ok(Some(update)) => {
            let answer = UpdateCheck::Available {
                version: update.version.clone(),
                notes: update.body.clone(),
                installable: this_copy() != Install::ByHand,
            };
            *found = Some(update);
            Ok(answer)
        }
        Ok(None) => Ok(UpdateCheck::None),
        Err(error) => Ok(no_answer("the update feed could not be read", &error)),
    }
}

/// Downloads the update the last check found and installs it: through its
/// setup on Windows, through the package manager for the Linux packages.
///
/// When it works this does not return: on Windows the setup starts and this
/// process ends, on Linux the package is installed and this process restarts
/// into it. Anything that has to reach the disk first has to be there before
/// the page calls this, because the window's own close guard never runs — see
/// `lib/updates.ts`, which writes the session and its drafts beforehand.
#[tauri::command]
pub(crate) async fn install_update(
    app: AppHandle,
    state: State<'_, Updates>,
    on_progress: Channel<DownloadProgress>,
) -> CommandResult<()> {
    let by_hand = || {
        FsError::other(
            None,
            format!(
                "Updates on this system are installed by hand: download the new version from {RELEASES}."
            ),
        )
    };
    let install = this_copy();
    if install == Install::ByHand {
        return Err(by_hand());
    }
    let found = state.found.lock().await;
    let Some(update) = found.as_ref() else {
        return Err(FsError::other(
            None,
            "Nothing has been found to install; check for an update first.",
        ));
    };
    // The name the release signed this download under, which the check below
    // requires the signature to carry.
    let Some(name) = release_file_name(&update.version, install, std::env::consts::ARCH) else {
        return Err(by_hand());
    };

    let mut received = 0u64;
    let mut reported = 0u64;
    // `download` is where the minisign signature is checked against the public
    // key in `tauri.conf.json`, and there is no other way to the bytes.
    let bytes = update
        .download(
            |chunk, total| {
                received += chunk as u64;
                // One message per chunk is several thousand for one setup, and
                // a bar cannot draw finer than a percent anyway.
                let step = total.map_or(PROGRESS_STEP, |total| (total / 100).max(1));
                let finished = Some(received) == total;
                if !finished && received - reported < step {
                    return;
                }
                reported = received;
                let _ = on_progress.send(DownloadProgress { received, total });
            },
            || {},
        )
        .await
        .map_err(|error| {
            FsError::other(None, format!("The update could not be downloaded: {error}"))
        })?;

    if let Install::Package(package) = install {
        // Checked by the plugin already; checked here again for the name in
        // the signature, which the plugin does not look at.
        if !verify(&app, &bytes, &update.signature, &name) {
            return Err(FsError::other(
                None,
                format!("The downloaded {name} is not what the release signed, so it was not installed."),
            ));
        }
        // What the release page calls the file, for the command in an error.
        let asset = update
            .download_url
            .path_segments()
            .and_then(|mut segments| segments.next_back())
            .unwrap_or(name.as_str())
            .to_owned();
        // pkexec waits for a password, so off the async runtime's threads.
        tauri::async_runtime::spawn_blocking(move || install_package(package, &bytes, &asset))
            .await
            .map_err(|error| {
                FsError::other(None, format!("The update could not be installed: {error}"))
            })?
            .map_err(|message| FsError::other(None, message))?;
        tracing::info!(%name, "installed by the package manager, restarting");
        app.restart();
    }

    let file = save_setup(&app, &name, &bytes)?;
    // Checked once by the plugin when it arrived, and again now, on what is
    // actually in that file — through the handle that then keeps anyone from
    // replacing it while the setup is being started.
    let locked = read_back_and_verify(&app, &file, &update.signature, &name)?;

    start_setup(&file)?;
    // Only now: until the setup process exists, nothing else may put other
    // bytes under that name.
    drop(locked);

    tracing::info!(version = %update.version, "handing over to the setup");
    app.exit(0);
    Ok(())
}

/// The name the release signs the update for this copy under — which the
/// signature has to carry, or the download is refused. `None` for a copy that
/// installs by hand.
///
/// The two Windows names and the ones before them are compiled into every copy
/// out there, so they never change: the release publishes the file under a
/// stable name of its own and signs it under this one (scripts/release-files.mjs).
fn release_file_name(version: &str, install: Install, arch: &str) -> Option<String> {
    match (install, arch) {
        (Install::Setup, "x86_64") => Some(format!("UwUNotes-Setup-{version}.exe")),
        (Install::Setup, "aarch64") => Some(format!("UwUNotes-Setup-{version}-windows-arm64.exe")),
        (Install::Package(Package::Deb), "x86_64" | "aarch64") => {
            Some(format!("UwUNotes-{version}-linux-{arch}.deb"))
        }
        (Install::Package(Package::Rpm), "x86_64" | "aarch64") => {
            Some(format!("UwUNotes-{version}-linux-{arch}.rpm"))
        }
        _ => None,
    }
}

/// What installs a package over the one that is there. `--oldpackage`
/// because rpm sorts `0.5.0-beta.2` after `0.5.0`; whether the offered
/// version is newer was decided by the feed check, not by rpm.
fn package_command(package: Package) -> (&'static str, &'static [&'static str]) {
    match package {
        Package::Deb => ("deb", &["dpkg", "-i"]),
        Package::Rpm => ("rpm", &["rpm", "-U", "--oldpackage"]),
    }
}

/// The same, for a person to type when pkexec cannot ask for the password.
fn manual_command(package: Package, asset: &str) -> String {
    let (_, command) = package_command(package);
    format!("sudo {} {asset}", command.join(" "))
}

/// Installs a checked `.deb` or `.rpm` through its package manager, which asks
/// for the administrator password through pkexec. Blocks until it is done.
///
/// The bytes go to a fresh folder only this user can open, and root installs
/// that file: nothing else is lying around under a name that could be swapped
/// between the check and the install.
fn install_package(package: Package, bytes: &[u8], asset: &str) -> Result<(), String> {
    let by_hand = || {
        format!(
            "Download {asset} from {RELEASES} and install it with `{}`.",
            manual_command(package, asset)
        )
    };
    let failed = |error: std::io::Error| format!("The update could not be installed: {error}");
    let (extension, command) = package_command(package);
    let staging = tempfile::Builder::new()
        .prefix("uwunotes-update-")
        .tempdir()
        .map_err(failed)?;
    let file = staging.path().join(format!("{PACKAGE}.{extension}"));
    std::fs::write(&file, bytes).map_err(failed)?;

    let status = std::process::Command::new("pkexec")
        .args(command)
        .arg(&file)
        .stdin(std::process::Stdio::null())
        .status()
        .map_err(|error| {
            format!(
                "There is no pkexec to ask for the administrator password ({error}). {}",
                by_hand()
            )
        })?;
    match status.code() {
        Some(0) => Ok(()),
        // pkexec's own: the password dialog was closed, or there is no polkit
        // agent to show one.
        Some(126) => Err("The password was not given, so nothing was installed.".to_owned()),
        Some(127) => Err(format!(
            "The administrator password could not be asked for (polkit). {}",
            by_hand()
        )),
        _ => Err(format!(
            "The package manager did not install the update ({status}). {}",
            by_hand()
        )),
    }
}

/// How the setup is told this is an update and whose exit it has to wait for.
///
/// `--wait-pid` is the whole handover: the setup waits for this process to be
/// gone before it replaces the file this process is running from.
fn handover_args(pid: u32) -> [String; 3] {
    [
        "--update".to_owned(),
        "--wait-pid".to_owned(),
        pid.to_string(),
    ]
}

/// Writes the downloaded setup into a folder of the app's own, emptied first.
///
/// Emptied because a refused or interrupted update otherwise leaves a setup
/// behind, and the only file that should be in there is the one this download
/// just checked. It is a folder the user can write to — and so can anything
/// else running as the user, which is why [`read_back_and_verify`] exists.
fn save_setup(app: &AppHandle, name: &str, bytes: &[u8]) -> CommandResult<PathBuf> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| {
            FsError::other(None, format!("There is nowhere to put the update: {error}"))
        })?
        .join(UPDATES_FOLDER);
    let _ = std::fs::remove_dir_all(&dir);

    let failed = |error: std::io::Error| {
        FsError::other(None, format!("The update could not be saved: {error}"))
    };
    std::fs::create_dir_all(&dir).map_err(failed)?;
    let file = dir.join(name);
    std::fs::write(&file, bytes).map_err(failed)?;
    Ok(file)
}

/// Reads the saved setup back, checks its signature, and returns the handle it
/// was read through — which holds the file until the caller drops it.
///
/// A setup that does not verify is deleted rather than left lying around under
/// the name a release published. The delete waits until the handle is gone,
/// because the lock it holds is precisely a refusal to let anyone delete it.
fn read_back_and_verify(
    app: &AppHandle,
    file: &Path,
    signature: &str,
    name: &str,
) -> CommandResult<File> {
    let checked = locked_and_checked(app, file, signature, name);
    if checked.is_err() {
        let _ = std::fs::remove_file(file);
    }
    checked
}

fn locked_and_checked(
    app: &AppHandle,
    file: &Path,
    signature: &str,
    name: &str,
) -> CommandResult<File> {
    let unreadable =
        |error: std::io::Error| FsError::other(None, format!("The update was not saved: {error}"));

    let mut handle = open_locked(file).map_err(unreadable)?;
    let mut bytes = Vec::new();
    handle.read_to_end(&mut bytes).map_err(unreadable)?;

    if !verify(app, &bytes, signature, name) {
        return Err(FsError::other(
            None,
            format!("The downloaded {name} is not what the release signed, so it was not started."),
        ));
    }
    Ok(handle)
}

/// Opens a file for reading while refusing everyone else write and delete
/// access. Starting it as a program still works: that only needs reading.
fn open_locked(path: &Path) -> std::io::Result<File> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt as _;
        const FILE_SHARE_READ: u32 = 0x1;
        options.share_mode(FILE_SHARE_READ);
    }
    options.open(path)
}

/// Starts the setup, which waits for this process to end and then replaces it.
fn start_setup(file: &Path) -> CommandResult<()> {
    std::process::Command::new(file)
        .args(handover_args(std::process::id()))
        .spawn()
        .map(|_| ())
        .map_err(|error| FsError::other(None, format!("The update could not be started: {error}")))
}

/// The release key, as `tauri.conf.json` carries it into every installed copy.
fn pubkey(app: &AppHandle) -> Option<String> {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|updater| updater.get("pubkey"))
        .and_then(|key| key.as_str())
        .map(str::to_string)
}

/// Checks a setup against that key. No key, no update — never the other way round.
fn verify(app: &AppHandle, bytes: &[u8], signature: &str, file_name: &str) -> bool {
    pubkey(app).is_some_and(|key| verify_with(&key, bytes, signature, file_name))
}

/// Both the key and the signature come base64-wrapped, the way Tauri's signer
/// writes them. The feed itself is not signed, only the setup is; the
/// signature's trusted comment names the file that was signed, so checking it
/// ties the version the feed claims to the version somebody actually signed.
fn verify_with(pubkey: &str, bytes: &[u8], signature: &str, file_name: &str) -> bool {
    let decode = |text: &str| {
        base64::engine::general_purpose::STANDARD
            .decode(text.trim())
            .ok()
            .and_then(|raw| String::from_utf8(raw).ok())
    };
    let (Some(pubkey), Some(signature)) = (decode(pubkey), decode(signature)) else {
        return false;
    };
    let (Ok(key), Ok(signature)) = (
        minisign_verify::PublicKey::decode(&pubkey),
        minisign_verify::Signature::decode(&signature),
    ) else {
        return false;
    };
    key.verify(bytes, &signature, false).is_ok()
        && signs_file(signature.trusted_comment(), file_name)
}

/// Tauri's signer writes `timestamp:<secs>\tfile:<name>` as the trusted comment.
fn signs_file(trusted_comment: &str, file_name: &str) -> bool {
    trusted_comment
        .split('\t')
        .filter_map(|part| part.trim().strip_prefix("file:"))
        .any(|name| name == file_name)
}

/// Every way a check can come back empty-handed ends here: one log line, and a
/// result the page is free to ignore.
fn no_answer(what: &str, error: &tauri_plugin_updater::Error) -> UpdateCheck {
    tracing::warn!(%error, "{what}");
    UpdateCheck::Failed {
        message: error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The key that signs the releases, by its minisign id `665FE923BCD2E6A4`.
    /// Spelled out here because the sibling projects have keys of their own in
    /// neighbouring folders, and the wrong one builds, ships, installs and then
    /// refuses every update it is ever offered.
    const RELEASE_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDY2NUZFOTIzQkNEMkU2QTQKUldTazV0SzhJK2xmWmphYVBuN3cwNW1xTDRCbHhNb20yOGtBeW10eHlTbUhCTFRaSWdPL21tdnMK";

    fn config() -> serde_json::Value {
        serde_json::from_str(include_str!("../tauri.conf.json")).unwrap()
    }

    /// The feed address and the key are the entire updater. Nothing at build
    /// time notices that either of them is wrong, and nothing at run time does
    /// either — the app simply never updates.
    #[test]
    fn the_config_names_the_feed_and_carries_the_release_key() {
        let config = config();
        let updater = &config["plugins"]["updater"];

        assert_eq!(updater["pubkey"], RELEASE_KEY);
        assert_eq!(
            updater["endpoints"],
            serde_json::json!([
                "https://raw.githubusercontent.com/MinifyX/UwUNotes-Client/updates/latest.json"
            ])
        );
    }

    /// One name per platform, in three places that never see each other:
    /// `scripts/release-files.mjs` signs under it, `scripts/update-feed.mjs`
    /// checks the signature for it, and this is what the signature is required
    /// to name. The x64 one is what every copy since 0.2.0 expects.
    #[test]
    fn each_copy_expects_the_name_the_release_signs_for_it() {
        let name = |install, arch| release_file_name("0.3.0", install, arch);
        assert_eq!(
            name(Install::Setup, "x86_64").as_deref(),
            Some("UwUNotes-Setup-0.3.0.exe")
        );
        assert_eq!(
            name(Install::Setup, "aarch64").as_deref(),
            Some("UwUNotes-Setup-0.3.0-windows-arm64.exe")
        );
        assert_eq!(
            name(Install::Package(Package::Deb), "x86_64").as_deref(),
            Some("UwUNotes-0.3.0-linux-x86_64.deb")
        );
        assert_eq!(
            name(Install::Package(Package::Deb), "aarch64").as_deref(),
            Some("UwUNotes-0.3.0-linux-aarch64.deb")
        );
        assert_eq!(
            name(Install::Package(Package::Rpm), "x86_64").as_deref(),
            Some("UwUNotes-0.3.0-linux-x86_64.rpm")
        );
        assert_eq!(
            name(Install::Package(Package::Rpm), "aarch64").as_deref(),
            Some("UwUNotes-0.3.0-linux-aarch64.rpm")
        );
        assert_eq!(name(Install::ByHand, "x86_64"), None);
        assert_eq!(name(Install::Setup, "x86"), None);
    }

    /// Only a file list that names this very executable counts as dpkg owning
    /// it — not the list of some other package, not a similar path.
    #[test]
    fn dpkg_owns_only_what_its_list_names() {
        let list =
            "/.\n/usr\n/usr/bin\n/usr/bin/uwunotes\n/usr/share/applications/uwunotes.desktop\n";
        assert!(lists(list, Path::new("/usr/bin/uwunotes")));
        assert!(!lists(list, Path::new("/usr/bin/uwunotes-desktop")));
        assert!(!lists(list, Path::new("/opt/UwUNotes/usr/bin/uwunotes")));
        assert!(!lists("", Path::new("/usr/bin/uwunotes")));
    }

    /// `--oldpackage`, or an rpm copy on a beta never takes the finished
    /// version: rpm sorts `0.5.0-beta.2` after `0.5.0`.
    #[test]
    fn packages_are_installed_over_whatever_version_is_there() {
        assert_eq!(package_command(Package::Deb), ("deb", &["dpkg", "-i"][..]));
        assert_eq!(
            package_command(Package::Rpm),
            ("rpm", &["rpm", "-U", "--oldpackage"][..])
        );
        assert_eq!(
            manual_command(Package::Rpm, "UwUNotes-linux-x64.rpm"),
            "sudo rpm -U --oldpackage UwUNotes-linux-x64.rpm"
        );
        assert_eq!(
            manual_command(Package::Deb, "UwUNotes-linux-arm64.deb"),
            "sudo dpkg -i UwUNotes-linux-arm64.deb"
        );
    }

    #[test]
    fn rpm_owns_only_for_our_package() {
        assert!(names_package("uwunotes\n"));
        assert!(!names_package("uwunotes-bin\n"));
        assert!(!names_package(
            "file /usr/bin/uwunotes is not owned by any package\n"
        ));
    }

    /// The handover, as the setup parses it. Without the pid the setup would
    /// start replacing files under a running editor.
    #[test]
    fn the_setup_is_told_which_process_to_wait_for() {
        assert_eq!(handover_args(4321), ["--update", "--wait-pid", "4321"]);
    }

    /// The page switches on `status`. It and this enum are one contract.
    #[test]
    fn a_check_serialises_the_way_the_page_reads_it() {
        let json = |value: &UpdateCheck| serde_json::to_string(value).unwrap();

        assert_eq!(json(&UpdateCheck::None), r#"{"status":"none"}"#);
        assert_eq!(
            json(&UpdateCheck::Available {
                version: "0.2.0".into(),
                notes: None,
                installable: true,
            }),
            r#"{"status":"available","version":"0.2.0","notes":null,"installable":true}"#
        );
        assert_eq!(
            json(&UpdateCheck::Failed {
                message: "no".into(),
            }),
            r#"{"status":"failed","message":"no"}"#
        );
    }

    /// Windows runs the downloaded setup; a Mac never installs anything itself
    /// and is sent to the releases page. On Linux it depends on the package the
    /// binary came in, and a test binary came in none, so it installs by hand.
    #[test]
    fn windows_installs_through_the_setup_and_an_unpackaged_copy_by_hand() {
        if cfg!(windows) {
            assert_eq!(this_copy(), Install::Setup);
        } else {
            assert_eq!(this_copy(), Install::ByHand);
        }
        assert!(RELEASES.starts_with("https://github.com/MinifyX/UwUNotes-Client/"));
    }

    /// A real `tauri signer sign` signature, over these eighteen bytes, from a
    /// throwaway key made for this test — never the release key, which signs
    /// nothing that is not a release. Without a positive case the checks below
    /// would still pass if `verify_with` refused everything.
    const TEST_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEMyNjk3OUZBRjQ5QUYyQjMKUldTejhwcjArbmxwd3J2S3ZYQmdYeXZpZ1BEZzFpMWRRL3p3RVVySmRJZVhXbTZDWko3bWNhb1AK";
    const TEST_SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTejhwcjArbmxwd2pGemRla2ZSemQ5WnlxdG9PMXJ6aU53QjF0aTFOT0NXT0crNzNHRVlaMW5Za2w4VjBsS0UrZU9OMjN5bTBqZVVrWllPS0cwbytxVjBuN20zTENkcmdrPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg5ODEyOTU2CWZpbGU6VXdVTm90ZXMtU2V0dXAtOS45LjkuZXhlClhZR1I0QzJtdXYzTk9OTTlKL3AwbWZoWjQ2Q1RHdklIcHRZRkZzamhuU0htZHR2WkkxQUEwcTlFTzM2SVQ2bXdHYmxzMG0yMGNFVEtRZS9xc2pidkFRPT0K";
    const TEST_SETUP: &[u8] = b"not really a setup";

    /// What the check has to say yes to: the bytes that were signed, under the
    /// name the signature carries.
    #[test]
    fn a_setup_signed_for_that_name_verifies() {
        assert!(verify_with(
            TEST_KEY,
            TEST_SETUP,
            TEST_SIGNATURE,
            &release_file_name("9.9.9", Install::Setup, "x86_64").unwrap()
        ));
    }

    /// And the case the second check is there for: a file that was swapped
    /// between the download and the start, under a signature that is otherwise
    /// entirely valid.
    #[test]
    fn other_bytes_under_the_same_signature_are_refused() {
        assert!(!verify_with(
            TEST_KEY,
            b"not really a setup either",
            TEST_SIGNATURE,
            &release_file_name("9.9.9", Install::Setup, "x86_64").unwrap()
        ));
    }

    #[test]
    fn garbage_never_verifies() {
        assert!(!verify_with("", b"setup", "", "UwUNotes-Setup-1.0.0.exe"));
        assert!(!verify_with(
            "bm90IGEga2V5",
            b"setup",
            "bm90IGEgc2lnbmF0dXJl",
            "UwUNotes-Setup-1.0.0.exe"
        ));
    }

    /// The second check exists for the file on disk, so it has to fail on bytes
    /// the release key never signed — whatever the feed said about them.
    #[test]
    fn a_setup_the_release_key_did_not_sign_is_refused() {
        assert!(!verify_with(
            RELEASE_KEY,
            b"a setup nobody signed",
            "AAAA",
            "UwUNotes-Setup-1.0.0.exe"
        ));
    }

    /// Nothing signs the feed, so an old but properly signed setup could be
    /// offered under a new version number. The name inside the signature is
    /// what makes that noticeable.
    #[test]
    fn the_signature_must_name_the_setup_the_feed_promised() {
        let comment = "timestamp:1789000000\tfile:UwUNotes-Setup-0.2.0.exe";
        assert!(signs_file(comment, "UwUNotes-Setup-0.2.0.exe"));
        assert!(!signs_file(comment, "UwUNotes-Setup-0.3.0.exe"));
        assert!(!signs_file(
            "timestamp:1789000000",
            "UwUNotes-Setup-0.3.0.exe"
        ));
    }
}
