//! Zeitreise: the versions every file and every unsaved note keeps.
//!
//! The store lives in `history/` next to the session file — `lib.rs` picks the
//! directory, `UWUNOTES_DIR` included — and is its own managed state rather
//! than a field on `AppState`, because nothing else in the app has anything to
//! say to it.
//!
//! Every command hands its work to a blocking thread: compressing a five
//! megabyte file or walking every index for the size cap is not something the
//! IPC thread should wait on.
//!
//! What this module deliberately does not do: decide when a version is taken
//! (the page does) or how long one is kept (`uwunotes-history` does).

use std::sync::Arc;

use tauri::State;
use uwunotes_fs::FsError;
use uwunotes_history::{HistoryKey, HistoryStats, HistoryStore, Reason, SnapshotOutcome, Version};

use crate::CommandResult;

pub(crate) type History = Arc<HistoryStore>;

/// Runs `work` on the blocking pool with the store, and folds a pool failure
/// into the one error shape the page reads.
async fn blocking<T: Send + 'static>(
    store: &State<'_, History>,
    work: impl FnOnce(&HistoryStore) -> CommandResult<T> + Send + 'static,
) -> CommandResult<T> {
    let store = Arc::clone(store);
    tauri::async_runtime::spawn_blocking(move || work(&store))
        .await
        .unwrap_or_else(|error| {
            Err(FsError::other(
                None,
                format!("The history thread stopped: {error}"),
            ))
        })
}

/// Keeps `text` as the newest version of `key`, unless it already is.
#[tauri::command]
pub(crate) async fn history_snapshot(
    store: State<'_, History>,
    key: HistoryKey,
    text: String,
    reason: Reason,
    retention_days: u32,
) -> CommandResult<SnapshotOutcome> {
    blocking(&store, move |store| {
        store.snapshot(&key, &text, reason, retention_days)
    })
    .await
}

/// Keeps what is on disk at each path, before "replace in files" rewrites it.
/// Returns how many new versions were written; a file that could not be read
/// is skipped and logged, never a reason to stop the replace.
#[tauri::command]
pub(crate) async fn history_snapshot_files(
    store: State<'_, History>,
    paths: Vec<String>,
    reason: Reason,
    retention_days: u32,
) -> CommandResult<usize> {
    blocking(&store, move |store| {
        Ok(store.snapshot_files(&paths, reason, retention_days))
    })
    .await
}

#[tauri::command]
pub(crate) async fn history_list(
    store: State<'_, History>,
    key: HistoryKey,
) -> CommandResult<Vec<Version>> {
    blocking(&store, move |store| store.list(&key)).await
}

#[tauri::command]
pub(crate) async fn history_read(
    store: State<'_, History>,
    key: HistoryKey,
    id: String,
) -> CommandResult<String> {
    blocking(&store, move |store| store.read(&key, &id)).await
}

#[tauri::command]
pub(crate) async fn history_delete(
    store: State<'_, History>,
    key: HistoryKey,
    id: String,
) -> CommandResult<()> {
    blocking(&store, move |store| store.delete(&key, &id)).await
}

#[tauri::command]
pub(crate) async fn history_clear(store: State<'_, History>, key: HistoryKey) -> CommandResult<()> {
    blocking(&store, move |store| store.clear(&key)).await
}

/// A note saved to a file for the first time, or a file renamed: the versions
/// go with it.
#[tauri::command]
pub(crate) async fn history_move(
    store: State<'_, History>,
    from: HistoryKey,
    to: HistoryKey,
    retention_days: u32,
) -> CommandResult<()> {
    blocking(&store, move |store| {
        store.move_history(&from, &to, retention_days)
    })
    .await
}

/// Thins every history and enforces the size cap. The page calls it once,
/// some time after start, with the retention from its settings.
#[tauri::command]
pub(crate) async fn history_maintain(
    store: State<'_, History>,
    retention_days: u32,
) -> CommandResult<HistoryStats> {
    blocking(&store, move |store| store.maintain(retention_days)).await
}

#[tauri::command]
pub(crate) async fn history_stats(store: State<'_, History>) -> CommandResult<HistoryStats> {
    blocking(&store, |store| Ok(store.stats())).await
}
