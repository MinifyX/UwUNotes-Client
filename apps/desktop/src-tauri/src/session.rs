//! What was open last time, and the unsaved text beside it.
//!
//! The store lives in the app's data directory, or wherever `UWUNOTES_DIR`
//! points — `lib.rs` decides that once at startup, so trying things out never
//! overwrites the session the user actually works in.
//!
//! What this module deliberately does not do: understand a session. The page
//! decides what a session means; this passes it to the store and back.

use std::collections::HashSet;
use std::sync::Arc;

use tauri::State;
use uwunotes_fs::FsError;
use uwunotes_session::StoredSession;

use crate::{AppState, CommandResult};

/// The stored session, or `null` when there is nothing usable to restore. A
/// session file that cannot be read or parsed is treated as nothing: the user
/// loses their tab layout, not their editor.
#[tauri::command]
pub(crate) async fn load_session(
    state: State<'_, AppState>,
) -> CommandResult<Option<StoredSession>> {
    let store = Arc::clone(&state.session);
    tauri::async_runtime::spawn_blocking(move || store.load())
        .await
        .map_err(|error| thread_stopped(&error))
}

#[tauri::command]
pub(crate) async fn save_session(
    state: State<'_, AppState>,
    session: StoredSession,
) -> CommandResult<()> {
    let store = Arc::clone(&state.session);
    let open_documents: HashSet<String> = session
        .documents
        .iter()
        .map(|document| document.doc_id.clone())
        .collect();

    tauri::async_runtime::spawn_blocking(move || {
        store.save(&session)?;
        // A tab closed while the app was not running never got its
        // `drop_draft`, so drafts need sweeping up by somebody: saving the
        // session is the moment the full list of living documents exists.
        // Every document in it is kept, dirty or not, because a draft written
        // between this snapshot and this line must survive.
        if let Err(error) = store.prune_drafts(&open_documents) {
            tracing::warn!(%error, "stale drafts could not be swept up");
        }
        Ok(())
    })
    .await
    .unwrap_or_else(|error| Err(thread_stopped(&error)))
}

/// Parks one document's unsaved text next to the session file, so closing the
/// window never costs anything.
#[tauri::command]
pub(crate) async fn write_draft(
    state: State<'_, AppState>,
    doc_id: String,
    text: String,
) -> CommandResult<()> {
    let store = Arc::clone(&state.session);
    tauri::async_runtime::spawn_blocking(move || store.write_draft(&doc_id, &text))
        .await
        .unwrap_or_else(|error| Err(thread_stopped(&error)))
}

#[tauri::command]
pub(crate) async fn read_draft(
    state: State<'_, AppState>,
    doc_id: String,
) -> CommandResult<Option<String>> {
    let store = Arc::clone(&state.session);
    tauri::async_runtime::spawn_blocking(move || store.read_draft(&doc_id))
        .await
        .map_err(|error| thread_stopped(&error))
}

/// Drops a draft, because the document was saved or its tab was closed on
/// purpose. A draft that is already gone counts as dropped.
#[tauri::command]
pub(crate) async fn drop_draft(state: State<'_, AppState>, doc_id: String) -> CommandResult<()> {
    let store = Arc::clone(&state.session);
    tauri::async_runtime::spawn_blocking(move || store.drop_draft(&doc_id))
        .await
        .unwrap_or_else(|error| Err(thread_stopped(&error)))
}

/// The blocking pool gave up on a task. Nothing the user did caused this and
/// nothing they can do will fix it, so it is plain prose under `other`.
fn thread_stopped(error: &impl std::fmt::Display) -> FsError {
    FsError::other(None, format!("The session thread stopped: {error}"))
}
