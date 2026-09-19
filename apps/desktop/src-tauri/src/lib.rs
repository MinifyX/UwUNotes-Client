//! The Tauri host.
//!
//! Thin on purpose. Every command in here unpacks its IPC arguments, calls one
//! function in `uwunotes-fs` or `uwunotes-session`, and hands the answer back.
//! The decisions — which encoding a file is in, which bytes go to disk, which
//! files a search walks — all live in the crates, where they can be tested
//! without a window.
//!
//! - [`files`] — reading, writing, the file tree, the recycle bin
//! - [`dialogs`] — the native open and save pickers
//! - [`search`] — find in files, streamed, and replace in files
//! - [`session`] — what was open last time, and the drafts beside it
//! - [`git`] — the letters next to file names, when the folder is a repository
//! - [`system`] — version, links out of the app, and Windows DLL hygiene
//! - [`updates`] — whether there is a newer UwUNotes, and installing it
//!
//! What this layer deliberately does not do: anything worth a unit test. A
//! command that grows a second `if` has grown logic, and that logic belongs in
//! a crate.

mod dialogs;
mod files;
mod git;
mod search;
mod session;
mod system;
mod updates;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use tauri::Manager as _;
use uwunotes_fs::FsError;
use uwunotes_session::SessionStore;

/// Every command fails the same way, because the page has exactly one error
/// shape to read: `ApiError` in `lib/api.ts`.
pub(crate) type CommandResult<T> = Result<T, FsError>;

pub(crate) struct AppState {
    /// The session file and the drafts beside it. Behind an `Arc` because
    /// saving one happens on a blocking thread, which cannot borrow `State`.
    pub session: Arc<SessionStore>,
    /// Where that store lives. Only [`system::app_info`] reads it, so the user
    /// can find their own session file without being told to guess.
    pub config_directory: PathBuf,
    /// The cancellation flag of every search that is still walking, by the id
    /// the page gave it. An entry outlives its walk by a moment: the command
    /// that started it removes its own flag when the thread comes back.
    pub searches: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

pub fn run() {
    system::restrict_dll_search();

    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("UWUNOTES_LOG").unwrap_or_else(|_| "uwunotes=debug,warn".to_owned()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // The updater plugin registers commands of its own, and none of them
        // are in `capabilities/default.json` — so the page cannot reach them,
        // and the feed address stays where it is configured instead of becoming
        // something the window could be talked into changing.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // %APPDATA%\app.uwunotes.desktop on Windows. UWUNOTES_DIR points
            // somewhere else, so trying things out never touches the session
            // the user actually works in.
            let directory = match std::env::var_os("UWUNOTES_DIR") {
                Some(path) => PathBuf::from(path),
                None => app.path().app_data_dir()?,
            };
            tracing::info!(path = %directory.display(), "session directory");

            app.manage(AppState {
                session: Arc::new(SessionStore::new(&directory)),
                config_directory: directory,
                searches: Mutex::new(HashMap::new()),
            });
            // Its own state rather than a field on `AppState`: nothing else in
            // the app has anything to say about updates, and the type it holds
            // belongs to the updater plugin.
            app.manage(updates::Updates::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            files::read_text_file,
            files::write_text_file,
            files::file_status,
            files::list_dir,
            files::list_places,
            files::create_dir,
            files::create_file,
            files::rename_path,
            files::trash_path,
            files::path_info,
            files::join_path,
            dialogs::pick_files,
            dialogs::pick_save_path,
            dialogs::pick_folder,
            search::search_files,
            search::cancel_search,
            search::replace_in_files,
            session::load_session,
            session::save_session,
            session::write_draft,
            session::read_draft,
            session::drop_draft,
            git::git_statuses,
            git::git_file_diff,
            system::app_info,
            system::open_external,
            system::reveal_in_file_manager,
            updates::check_for_update,
            updates::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start UwUNotes");
}
