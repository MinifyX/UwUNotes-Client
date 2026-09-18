//! The app itself: what version it is, where its files live, and the two ways
//! it is allowed to hand something to the rest of the desktop.
//!
//! Both of those ways are narrow on purpose. A text editor opens files the user
//! names, and a file can contain anything — a link in a Markdown preview, a URL
//! in a log, a path in a stack trace. If any of that could reach the shell, an
//! editor would become a way to run arbitrary programs by convincing somebody
//! to open a file. So [`open_external`] takes web and mail links and nothing
//! else, and [`reveal_in_file_manager`] shows a file in its folder rather than
//! opening it.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt as _;
use uwunotes_fs::FsError;

use crate::{AppState, CommandResult};

/// Longer than this is not a link anybody typed, and every browser has its own
/// limit somewhere below it anyway.
const MAX_LINK_BYTES: usize = 2048;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppInfo {
    version: String,
    platform: String,
    /// Where the session, the drafts and the settings live. Shown in the about
    /// dialog, because "it is somewhere in AppData" is not an answer.
    config_dir: String,
}

#[tauri::command]
pub(crate) fn app_info(app: AppHandle, state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS.to_owned(),
        config_dir: state.config_directory.to_string_lossy().into_owned(),
    }
}

/// Opens a link in the browser or the mail client. Nothing else leaves the app.
#[tauri::command(async)]
pub(crate) fn open_external(app: AppHandle, url: String) -> CommandResult<()> {
    if !is_openable_link(&url) {
        return Err(FsError::other(
            None,
            "Only http, https and mailto links open from the editor.",
        ));
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| FsError::other(None, format!("The link could not be opened: {error}")))
}

/// Shows a file in Explorer, Finder or whatever this desktop uses, with the
/// file selected. It is not opened — that is the shell's business, and the
/// shell would open a `.exe` as happily as a `.txt`.
#[tauri::command(async)]
pub(crate) fn reveal_in_file_manager(app: AppHandle, path: String) -> CommandResult<()> {
    let target = PathBuf::from(path);
    if !target.exists() {
        return Err(FsError::NotFound { path: target });
    }
    app.opener().reveal_item_in_dir(&target).map_err(|error| {
        FsError::other(
            Some(&target),
            format!("The folder could not be opened: {error}"),
        )
    })
}

/// `http`, `https` and `mailto`, with nothing in them that a shell or a browser
/// could read as more than one argument.
fn is_openable_link(url: &str) -> bool {
    if url.len() > MAX_LINK_BYTES
        || url.chars().any(|character| {
            character.is_control() || character.is_whitespace() || character == '"'
        })
    {
        return false;
    }

    let lower = url.to_ascii_lowercase();
    if let Some(address) = lower.strip_prefix("mailto:") {
        // A `mailto:` with no address is a link to nothing; one that starts
        // with a slash is somebody being clever.
        return !address.is_empty() && !address.starts_with('/') && address.contains('@');
    }

    lower
        .strip_prefix("https://")
        .or_else(|| lower.strip_prefix("http://"))
        // `https:///etc/passwd` has an empty host, which some openers read as a
        // local path rather than as a web address.
        .is_some_and(|rest| !rest.is_empty() && !rest.starts_with('/'))
}

/// On Windows, DLLs loaded by name at runtime resolve from System32 only, never
/// from the install folder or the PATH. This is the runtime half of the
/// `/DEPENDENTLOADFLAG` in `build.rs`, which only covers statically imported
/// DLLs. Must run before anything else in the process loads one.
pub(crate) fn restrict_dll_search() {
    #[cfg(windows)]
    // SAFETY: a process-wide flag, set once before any other thread exists.
    unsafe {
        use windows_sys::Win32::System::LibraryLoader::{
            SetDefaultDllDirectories, LOAD_LIBRARY_SEARCH_SYSTEM32,
        };
        SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32);
    }
}

#[cfg(test)]
mod tests {
    use super::is_openable_link;

    #[test]
    fn only_web_and_mail_links_leave_the_editor() {
        assert!(is_openable_link(
            "https://github.com/MinifyX/UwUNotes-Client"
        ));
        assert!(is_openable_link("HTTP://example.org/a?b=c"));
        assert!(is_openable_link("mailto:someone@example.org?subject=UwU"));

        for refused in [
            "file:///C:/Windows/System32/calc.exe",
            "ms-settings:privacy",
            "javascript:alert(1)",
            "vscode://file/etc/passwd",
            "https://",
            "https:///etc/passwd",
            "mailto:",
            "mailto:/nonsense",
            "https://example.org/\" & calc",
            "https://exa mple.org",
            r"\\attacker\share",
        ] {
            assert!(!is_openable_link(refused), "{refused}");
        }
    }
}
