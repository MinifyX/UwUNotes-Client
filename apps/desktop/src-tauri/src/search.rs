//! Find in files, streamed, and replace in files.
//!
//! The walk happens on a blocking thread and results go down a channel as they
//! are found, so the panel fills while the search is still running and the
//! window never stops painting. Cancellation is a flag the walk reads between
//! files: the page cancels by id, and starting a second search with the same id
//! cancels the first, which is what typing another character in the search box
//! amounts to.
//!
//! What this module deliberately does not do: interpret results. Every match,
//! offset and preview comes out of `uwunotes-fs` ready to render.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, MutexGuard, PoisonError};

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;
use uwunotes_fs::{FsError, ReplaceRequest, ReplaceSummary, SearchMatch, SearchRequest};

use crate::{AppState, CommandResult};

/// What the page receives while a search runs. One `file` per file with
/// matches, then exactly one `done` — the panel's spinner is cleared by `done`
/// and by nothing else.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum SearchEvent {
    File {
        path: String,
        matches: Vec<SearchMatch>,
    },
    Done {
        files: usize,
        matches: usize,
        truncated: bool,
        skipped: usize,
        error: Option<String>,
    },
}

/// Walks a folder and streams what it finds. Resolves when the walk is over,
/// whether it finished, was cancelled or never started.
#[tauri::command]
pub(crate) async fn search_files(
    state: State<'_, AppState>,
    request: SearchRequest,
    on_event: Channel<SearchEvent>,
) -> CommandResult<()> {
    let id = request.id.clone();
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut running = running(&state);
        // A second search under the same id replaces the first: the user typed
        // another character, and the old walk is now answering a question
        // nobody is asking any more.
        if let Some(previous) = running.insert(id.clone(), Arc::clone(&cancelled)) {
            previous.store(true, Ordering::Relaxed);
        }
    }

    let flag = Arc::clone(&cancelled);
    let stream = on_event.clone();
    let walk = tauri::async_runtime::spawn_blocking(move || {
        uwunotes_fs::search(
            &request,
            |path, matches| {
                // The cancellation flag is what stops a walk; a channel the
                // page has dropped is worth a log line and nothing more.
                if let Err(error) = stream.send(SearchEvent::File { path, matches }) {
                    tracing::debug!(%error, "search result could not be delivered");
                }
            },
            &flag,
        )
    })
    .await;

    {
        // Only ever remove our own flag: a newer search may already own the
        // slot, and taking its flag out would leave it uncancellable.
        let mut running = running(&state);
        if running
            .get(&id)
            .is_some_and(|current| Arc::ptr_eq(current, &cancelled))
        {
            running.remove(&id);
        }
    }

    let outcome = walk.unwrap_or_else(|error| {
        Err(FsError::other(
            None,
            format!("The search thread stopped: {error}"),
        ))
    });

    // `done` goes out even when the walk failed, because the panel has no other
    // way to learn that it is over. The command *also* returns the error, so a
    // caller that would rather branch on the kind than on a string still can.
    let done = match &outcome {
        Ok(summary) => SearchEvent::Done {
            files: summary.files,
            matches: summary.matches,
            truncated: summary.truncated,
            skipped: summary.skipped,
            error: None,
        },
        // Zeroes are honest here: the only failures are a pattern or a glob
        // that would not compile, and both are raised before the first file.
        Err(error) => SearchEvent::Done {
            files: 0,
            matches: 0,
            truncated: false,
            skipped: 0,
            error: Some(error.to_string()),
        },
    };
    if let Err(error) = on_event.send(done) {
        tracing::debug!(%error, "search summary could not be delivered");
    }

    outcome.map(|_summary| ())
}

/// Stops the search with this id, if it is still walking.
#[tauri::command]
pub(crate) fn cancel_search(state: State<'_, AppState>, id: String) {
    // The flag stays in the map until the walk comes back and its own command
    // takes it out. Removing it here would leave a second cancel — or the
    // replacement search's cancel — with nothing to flip.
    if let Some(flag) = running(&state).get(&id) {
        flag.store(true, Ordering::Relaxed);
    }
}

/// Replaces in exactly the files it is given, which are the ones the user has
/// already seen in the results list. The tree is never walked again.
#[tauri::command]
pub(crate) async fn replace_in_files(request: ReplaceRequest) -> CommandResult<ReplaceSummary> {
    tauri::async_runtime::spawn_blocking(move || uwunotes_fs::replace_in_files(&request))
        .await
        .unwrap_or_else(|error| {
            Err(FsError::other(
                None,
                format!("The replace thread stopped: {error}"),
            ))
        })
}

/// A panic in some other command can poison this lock. The map is a bag of
/// independent flags with no invariant that could be left half-applied, so a
/// poisoned one is taken as it is rather than costing the user their editor.
fn running(state: &AppState) -> MutexGuard<'_, HashMap<String, Arc<AtomicBool>>> {
    state
        .searches
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
}
