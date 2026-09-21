//! Files, as the page sees them: one document in, one document out, plus the
//! handful of operations the file tree's context menu needs.
//!
//! Every command here is `#[tauri::command(async)]` rather than a plain
//! synchronous one. A synchronous command runs on the main thread, and a
//! directory listing on a sleeping network drive would freeze the window for as
//! long as the drive takes to answer.
//!
//! What this module deliberately does not do: delete. [`trash_path`] hands the
//! file to the recycle bin and lets the desktop decide what that means; nothing
//! in UwUNotes removes a file for good.

use std::path::{Path, PathBuf};

use serde::Serialize;
use uwunotes_fs::{DirEntry, Eol, FileStamp, FsError, LoadedFile, PathInfo, Place};

use crate::CommandResult;

/// What a save gives back. A struct rather than a bare stamp because the page's
/// `SavedFile` will grow a field one day and a bare value has nowhere to put it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SavedFile {
    pub stamp: FileStamp,
}

/// Reads and decodes a file. `encoding` forces one instead of detecting it —
/// that is the status bar's encoding menu, which re-opens the same file.
#[tauri::command(async)]
pub(crate) fn read_text_file(path: String, encoding: Option<String>) -> CommandResult<LoadedFile> {
    uwunotes_fs::read_file(Path::new(&path), encoding.as_deref())
}

/// Encodes the text back and writes it atomically.
///
/// `expected_stamp` is what the editor believes is on disk; a mismatch comes
/// back as [`FsError::Changed`] and the page turns that into a question instead
/// of quietly winning the race.
///
/// `allow_unmappable` is the same shape of answer for a different question: the
/// text holds characters the chosen encoding cannot write, the user has been
/// shown that and has said to write it anyway.
#[tauri::command(async)]
pub(crate) fn write_text_file(
    path: String,
    text: String,
    encoding: String,
    bom: bool,
    eol: Eol,
    expected_stamp: Option<FileStamp>,
    allow_unmappable: bool,
) -> CommandResult<SavedFile> {
    let stamp = uwunotes_fs::write_file(
        Path::new(&path),
        &text,
        &encoding,
        bom,
        eol,
        expected_stamp,
        allow_unmappable,
    )?;
    Ok(SavedFile { stamp })
}

/// The file's stamp, or `null` when it is gone. The page polls this on window
/// focus, so a missing file is an answer, not a failure.
#[tauri::command(async)]
pub(crate) fn file_status(path: String) -> CommandResult<Option<FileStamp>> {
    uwunotes_fs::file_stamp(Path::new(&path))
}

#[tauri::command(async)]
pub(crate) fn list_dir(path: String) -> CommandResult<Vec<DirEntry>> {
    uwunotes_fs::list_dir(Path::new(&path))
}

#[tauri::command(async)]
pub(crate) fn list_places() -> Vec<Place> {
    uwunotes_fs::places()
}

#[tauri::command(async)]
pub(crate) fn create_dir(path: String) -> CommandResult<()> {
    uwunotes_fs::create_dir(Path::new(&path))
}

#[tauri::command(async)]
pub(crate) fn create_file(path: String) -> CommandResult<()> {
    uwunotes_fs::create_file(Path::new(&path))
}

#[tauri::command(async)]
pub(crate) fn rename_path(from: String, to: String) -> CommandResult<()> {
    uwunotes_fs::rename_path(Path::new(&from), Path::new(&to))
}

/// To the recycle bin, never a hard delete.
#[tauri::command(async)]
pub(crate) fn trash_path(path: String) -> CommandResult<()> {
    let target = PathBuf::from(path);
    // `trash` reports one error for everything, so the case the page can
    // actually say something about is checked before it gets there.
    if !target.exists() {
        return Err(FsError::NotFound { path: target });
    }
    trash::delete(&target).map_err(|error| FsError::other(Some(&target), error.to_string()))
}

/// Everything about a path, including one that does not exist yet — this is how
/// "Save As" checks a name before the file is written.
#[tauri::command(async)]
pub(crate) fn path_info(path: String) -> PathInfo {
    uwunotes_fs::path_info(Path::new(&path))
}

#[tauri::command(async)]
pub(crate) fn join_path(base: String, name: String) -> String {
    uwunotes_fs::join_path(Path::new(&base), &name)
}

/// Tools → Hash, for a piece of text: the selection, the whole document, or
/// whatever was typed into the dialog.
#[tauri::command(async)]
pub(crate) fn hash_text(text: String, algorithm: uwunotes_fs::HashAlgorithm) -> String {
    uwunotes_fs::hash_text(&text, algorithm)
}

/// Tools → Hash, for a file's bytes as they are on disk — the value a download
/// page publishes next to the file.
#[tauri::command(async)]
pub(crate) fn hash_file(
    path: String,
    algorithm: uwunotes_fs::HashAlgorithm,
) -> CommandResult<String> {
    uwunotes_fs::hash_file(Path::new(&path), algorithm)
}
