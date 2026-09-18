//! The native open and save pickers.
//!
//! The pickers are blocking calls into the desktop's own dialog code, and a
//! blocking call on the main thread is a hung window: each one goes to a
//! blocking task and the command awaits it. A cancelled dialog is not an error
//! — the user changed their mind, which is allowed — so everything here comes
//! back as `null` or an empty list rather than as a failure.
//!
//! The filter labels are German literals. They are handed to the operating
//! system, which is the one place in this app a user-visible string cannot go
//! through `t()`: the catalogue lives in the page and this code runs before the
//! page is asked anything.

use std::path::Path;

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt as _;

const ALL_FILES: &str = "Alle Dateien";
const TEXT_FILES: &str = "Textdateien";

/// What "a text file" means in an open dialog. Not a claim about what the
/// editor can open — it opens anything — just the shortcut for the common case.
const TEXT_EXTENSIONS: &[&str] = &[
    "txt", "md", "markdown", "log", "json", "jsonc", "yaml", "yml", "toml", "ini", "cfg", "conf",
    "csv", "tsv", "xml", "html", "css", "scss", "js", "jsx", "ts", "tsx", "rs", "py", "go", "java",
    "c", "h", "cpp", "hpp", "cs", "sh", "ps1", "sql",
];

/// Files to open. Empty when the dialog was cancelled.
#[tauri::command]
pub(crate) async fn pick_files(app: AppHandle) -> Vec<String> {
    // "All files" leads: an editor is asked to open odd things far more often
    // than it is asked to open a .txt, and a filter the user has to widen every
    // single time is a filter that is wrong.
    let dialog = app
        .dialog()
        .file()
        .add_filter(ALL_FILES, &["*"])
        .add_filter(TEXT_FILES, TEXT_EXTENSIONS);

    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_files()).await;
    picked
        .ok()
        .flatten()
        .map(|paths| {
            paths
                .into_iter()
                .filter_map(|path| path.into_path().ok())
                .map(|path| path.to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default()
}

/// Where to save. `start_in` is the folder to open in — the document's own
/// folder, usually — and `suggested_name` the name already in the box.
#[tauri::command]
pub(crate) async fn pick_save_path(
    app: AppHandle,
    suggested_name: String,
    start_in: Option<String>,
) -> Option<String> {
    let mut dialog = app.dialog().file().set_file_name(suggested_name.as_str());

    if let Some(folder) = start_in.as_deref().map(Path::new) {
        // A folder that has been deleted since the file was opened would leave
        // the dialog somewhere arbitrary; better the platform's own default.
        if folder.is_dir() {
            dialog = dialog.set_directory(folder);
        }
    }

    // The document's own extension leads, because Windows appends the first
    // filter's extension to a name that has none — and appending `.txt` to
    // `build.gradle` is exactly the surprise a save dialog must not spring.
    if let Some(extension) = extension_of(&suggested_name) {
        dialog = dialog.add_filter(format!("{extension}-Datei"), &[extension.as_str()]);
    }
    dialog = dialog
        .add_filter(TEXT_FILES, TEXT_EXTENSIONS)
        .add_filter(ALL_FILES, &["*"]);

    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file()).await;
    picked
        .ok()
        .flatten()
        .and_then(|path| path.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}

/// A folder to open as the project root.
#[tauri::command]
pub(crate) async fn pick_folder(app: AppHandle) -> Option<String> {
    let dialog = app.dialog().file();
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_folder()).await;
    picked
        .ok()
        .flatten()
        .and_then(|path| path.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}

/// The extension of a file name, lowercased, or `None` for a name that has
/// none — a dotfile like `.gitignore` counts as having none.
fn extension_of(name: &str) -> Option<String> {
    Path::new(name)
        .extension()
        .map(|extension| extension.to_string_lossy().to_lowercase())
        .filter(|extension| !extension.is_empty())
}
