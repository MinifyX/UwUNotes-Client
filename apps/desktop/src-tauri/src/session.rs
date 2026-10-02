//! What was open last time, the unsaved text beside it, and the note trash.
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
use uwunotes_session::{StoredSession, TrashEntry, TrashNote, TrashSummary};

use crate::{AppState, CommandResult};

/// The stored session, or `null` when there is nothing usable to restore. A
/// session file that cannot be read or parsed is treated as nothing: the user
/// loses their tab layout, not their editor.
#[tauri::command]
pub(crate) async fn load_session(
    state: State<'_, AppState>,
) -> CommandResult<Option<StoredSession>> {
    let store = Arc::clone(&state.session);
    let session = tauri::async_runtime::spawn_blocking(move || store.load())
        .await
        .map_err(|error| thread_stopped(&error))?;
    // The page restores once per window. Seeing this twice in a run means the
    // restore ran twice, which shows up as a duplicated set of tabs.
    tracing::info!(
        documents = session.as_ref().map_or(0, |s| s.documents.len()),
        found = session.is_some(),
        "session load"
    );
    Ok(session)
}

/// Saves the session, and — only when `prune` says so — sweeps up the drafts
/// that no longer belong to anything.
///
/// `prune` is the page saying its restore really did rebuild from a stored
/// session, so the document list below is the whole truth. It is false for
/// every path that ends in a fresh empty buffer: the setting switched off, a
/// session from another version, a draft that would not read. The store keeps
/// its own half of the same question and both have to agree.
#[tauri::command]
pub(crate) async fn save_session(
    state: State<'_, AppState>,
    session: StoredSession,
    prune: bool,
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
        if let Err(error) = store.prune_drafts(&open_documents, prune) {
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
        .unwrap_or_else(|error| Err(thread_stopped(&error)))
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

/// Puts the unsaved text of a tab being closed into the note trash. The page
/// closes the tab only after this succeeded.
#[tauri::command]
pub(crate) async fn trash_note(
    state: State<'_, AppState>,
    note: TrashNote,
) -> CommandResult<TrashSummary> {
    let store = Arc::clone(&state.session);
    tauri::async_runtime::spawn_blocking(move || store.trash_note(note))
        .await
        .unwrap_or_else(|error| Err(thread_stopped(&error)))
}

/// The trash, newest first, without the full texts.
#[tauri::command]
pub(crate) async fn list_trash(state: State<'_, AppState>) -> CommandResult<Vec<TrashSummary>> {
    let store = Arc::clone(&state.session);
    tauri::async_runtime::spawn_blocking(move || store.list_trash())
        .await
        .unwrap_or_else(|error| Err(thread_stopped(&error)))
}

/// One trash entry with its text, or `null` when it is gone.
#[tauri::command]
pub(crate) async fn read_trash(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<Option<TrashEntry>> {
    let store = Arc::clone(&state.session);
    tauri::async_runtime::spawn_blocking(move || store.read_trash(&id))
        .await
        .unwrap_or_else(|error| Err(thread_stopped(&error)))
}

/// Deletes one trash entry for good — after a restore, or on request.
#[tauri::command]
pub(crate) async fn delete_trash(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    let store = Arc::clone(&state.session);
    tauri::async_runtime::spawn_blocking(move || store.delete_trash(&id))
        .await
        .unwrap_or_else(|error| Err(thread_stopped(&error)))
}

/// Deletes every trash entry. The page has asked before calling this.
#[tauri::command]
pub(crate) async fn empty_trash(state: State<'_, AppState>) -> CommandResult<()> {
    let store = Arc::clone(&state.session);
    tauri::async_runtime::spawn_blocking(move || store.empty_trash())
        .await
        .unwrap_or_else(|error| Err(thread_stopped(&error)))
}

/// The blocking pool gave up on a task. Nothing the user did caused this and
/// nothing they can do will fix it, so it is plain prose under `other`.
fn thread_stopped(error: &impl std::fmt::Display) -> FsError {
    FsError::other(None, format!("The session thread stopped: {error}"))
}
