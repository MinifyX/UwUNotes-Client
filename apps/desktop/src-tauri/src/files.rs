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
//!
//! Reading, saving and listing a folder also tell [`sandbox_access`] about the
//! path, which in the Mac App Store build is how a file opened today is still
//! allowed to open after a restart. Everywhere else that call does nothing.
//!
//! [`sandbox_access`]: crate::sandbox_access

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::ipc::{Request, Response};
use uwunotes_fs::{DirEntry, Eol, FileStamp, FsError, PathInfo};

use crate::{raw_ipc, sandbox_access, CommandResult};

/// What a save gives back. A struct rather than a bare stamp because the page's
/// `SavedFile` will grow a field one day and a bare value has nowhere to put it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SavedFile {
    pub stamp: FileStamp,
}

/// Reads and decodes a file. `encoding` forces one instead of detecting it —
/// that is the status bar's encoding menu, which re-opens the same file.
///
/// The answer is a framed body rather than JSON: everything but the text in a
/// small header, the text as raw UTF-8 behind it. See [`raw_ipc`].
///
/// [`raw_ipc`]: crate::raw_ipc
#[tauri::command(async)]
pub(crate) fn read_text_file(path: String, encoding: Option<String>) -> CommandResult<Response> {
    let mut loaded = uwunotes_fs::read_file(Path::new(&path), encoding.as_deref())?;
    sandbox_access::remember(Path::new(&path));
    let text = std::mem::take(&mut loaded.text);
    raw_ipc::framed(&loaded, &text)
}

/// The fields of a save, sent next to the text rather than around it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WriteMeta {
    path: String,
    encoding: String,
    bom: bool,
    eol: Eol,
    expected_stamp: Option<FileStamp>,
    allow_unmappable: bool,
}

/// Encodes the text back and writes it atomically.
///
/// The text is the raw request body and the rest is a [`WriteMeta`] in a
/// header, so a large file is not escaped into JSON and parsed back on every
/// save.
///
/// `expected_stamp` is what the editor believes is on disk; a mismatch comes
/// back as [`FsError::Changed`] and the page turns that into a question instead
/// of quietly winning the race.
///
/// `allow_unmappable` is the same shape of answer for a different question: the
/// text holds characters the chosen encoding cannot write, the user has been
/// shown that and has said to write it anyway.
#[tauri::command(async)]
pub(crate) fn write_text_file(request: Request<'_>) -> CommandResult<SavedFile> {
    let meta: WriteMeta = raw_ipc::meta(&request)?;
    let text = raw_ipc::body_text(&request)?;
    let stamp = uwunotes_fs::write_file(
        Path::new(&meta.path),
        text,
        &meta.encoding,
        meta.bom,
        meta.eol,
        meta.expected_stamp,
        meta.allow_unmappable,
    )?;
    // A file saved under a new name exists only now, so only now can it be
    // bookmarked.
    sandbox_access::remember(Path::new(&meta.path));
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
    let entries = uwunotes_fs::list_dir(Path::new(&path))?;
    sandbox_access::remember(Path::new(&path));
    Ok(entries)
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
    trash_context()
        .delete(&target)
        .map_err(|error| FsError::other(Some(&target), error.to_string()))
}

/// How a file goes to the bin. On a Mac `trash` asks Finder by default, through
/// `osascript`, which is what puts "Put Back" in Finder's menu. A sandboxed app
/// may not script Finder, so the Mac App Store build moves the file itself,
/// through `NSFileManager` — same bin, without "Put Back".
fn trash_context() -> trash::TrashContext {
    #[allow(unused_mut)]
    let mut context = trash::TrashContext::default();
    #[cfg(all(target_os = "macos", feature = "mas"))]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos as _};
        context.set_delete_method(DeleteMethod::NsFileManager);
    }
    context
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
