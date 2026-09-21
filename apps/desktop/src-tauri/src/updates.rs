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
//! What the plugin no longer does is install. The artifact is
//! `UwUNotes-Setup-<version>.exe` — UwUNotes' own setup, the same file people
//! download by hand — and installing it means running it, with `--update
//! --wait-pid <this process>`, and then quitting so it can replace an exe
//! nobody has open any more. The plugin stays for the two steps that must not
//! be hand-rolled: asking the feed, and checking what came back against the
//! public key compiled into this binary.
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
//! **Installing is Windows' alone.** The feed also lists the Linux archive
//! (`linux-x86_64`) and the macOS disk images (`darwin-aarch64`,
//! `darwin-x86_64`), because the plugin answers "no such platform" to a copy
//! whose platform the feed does not name — and those copies should hear about
//! a new version as much as any other. But what they would download is a
//! `.tar.gz` or a `.dmg`, not a program to start with `--update`, so there:
//!
//! - [`check_for_update`] answers exactly as on Windows, with
//!   `installable: false` in the [`UpdateCheck::Available`] it sends — the
//!   page's cue to show the version and a link to the releases page instead of
//!   "Install and restart";
//! - [`install_update`] downloads nothing and returns an `FsError` of kind
//!   `other` whose message names [`RELEASES`], for a page that calls it anyway.
//!
//! The download-and-hand-over machinery below stays compiled on every system
//! (its tests run everywhere), which is what the `dead_code` allowance at the
//! top of this module is for.

// On macOS and Linux nothing calls the handover half of this file; see above.
#![cfg_attr(not(windows), allow(dead_code))]

use std::fs::File;
use std::io::Read as _;
use std::path::{Path, PathBuf};
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

/// Whether [`install_update`] can do anything on this system.
const INSTALLABLE: bool = cfg!(windows);

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
        /// Whether "Install and restart" can work here: `true` on Windows,
        /// `false` on macOS and Linux, where the update is a download from
        /// [`RELEASES`] instead.
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
                installable: INSTALLABLE,
            };
            *found = Some(update);
            Ok(answer)
        }
        Ok(None) => Ok(UpdateCheck::None),
        Err(error) => Ok(no_answer("the update feed could not be read", &error)),
    }
}

/// Downloads the update the last check found and hands over to its setup.
///
/// On Windows this does not return: the setup starts and this process ends.
/// Anything that has to reach the disk first has to be there before the page
/// calls this, because the window's own close guard never runs — see
/// `lib/updates.ts`, which writes the session and its drafts beforehand.
#[tauri::command]
pub(crate) async fn install_update(
    app: AppHandle,
    state: State<'_, Updates>,
    on_progress: Channel<DownloadProgress>,
) -> CommandResult<()> {
    if !INSTALLABLE {
        return Err(FsError::other(
            None,
            format!(
                "Updates on this system are installed by hand: download the new version from {RELEASES}."
            ),
        ));
    }
    let found = state.found.lock().await;
    let Some(update) = found.as_ref() else {
        return Err(FsError::other(
            None,
            "Nothing has been found to install; check for an update first.",
        ));
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

    let name = setup_name(&update.version);
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

/// What the release publishes for a version, and what the feed points at.
fn setup_name(version: &str) -> String {
    format!("UwUNotes-Setup-{version}.exe")
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

    /// One name, in three places that never see each other: the release
    /// workflow attaches it, `scripts/update-feed.mjs` points the feed at it,
    /// and this is what the signature is required to name.
    #[test]
    fn the_setup_is_named_the_way_the_release_publishes_it() {
        assert_eq!(setup_name("0.3.0"), "UwUNotes-Setup-0.3.0.exe");
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

    /// Only Windows runs the downloaded setup; everywhere else the page is told
    /// to send people to the releases page.
    #[test]
    fn only_windows_installs_updates_itself() {
        assert_eq!(INSTALLABLE, cfg!(windows));
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
            &setup_name("9.9.9")
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
            &setup_name("9.9.9")
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
