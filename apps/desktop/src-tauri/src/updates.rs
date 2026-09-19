//! Looking for a newer UwUNotes, and installing one.
//!
//! Two commands and no schedule of its own: the page asks once shortly after
//! start-up, and again whenever the user presses "check now". Everything that
//! decides *what* an update is — which feed, which public key, whether the
//! signature belongs to the file that was downloaded — is
//! `tauri-plugin-updater`'s, configured in `tauri.conf.json` and never
//! overridden here. That is the whole point of the arrangement: an endpoint the
//! page could set, or a path that installs bytes [`Update::download`] has not
//! checked, would turn a text editor into a way of handing somebody a program.
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
//! one when the user pressed a button first.

use std::time::Duration;

use serde::Serialize;
use tauri::async_runtime::Mutex;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
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
            };
            *found = Some(update);
            Ok(answer)
        }
        Ok(None) => Ok(UpdateCheck::None),
        Err(error) => Ok(no_answer("the update feed could not be read", &error)),
    }
}

/// Downloads the update the last check found and hands it to the installer.
///
/// On Windows this does not return: the plugin starts the setup and ends this
/// process. Anything that has to reach the disk first has to be there before
/// the page calls this, because the window's own close guard never runs — see
/// `lib/updates.ts`, which writes the session and its drafts beforehand.
#[tauri::command]
pub(crate) async fn install_update(
    state: State<'_, Updates>,
    on_progress: Channel<DownloadProgress>,
) -> CommandResult<()> {
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
    // key in `tauri.conf.json`, and there is no other way into `install`.
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

    update.install(bytes).map_err(|error| {
        FsError::other(None, format!("The update could not be installed: {error}"))
    })
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

    /// Without this the release builds a setup and no `.sig` beside it, and the
    /// feed has nothing to point a signature at.
    #[test]
    fn the_bundle_is_told_to_sign_what_it_builds() {
        assert_eq!(config()["bundle"]["createUpdaterArtifacts"], true);
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
            }),
            r#"{"status":"available","version":"0.2.0","notes":null}"#
        );
        assert_eq!(
            json(&UpdateCheck::Failed {
                message: "no".into(),
            }),
            r#"{"status":"failed","message":"no"}"#
        );
    }
}
