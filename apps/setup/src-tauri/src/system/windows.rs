//! The Windows underneath the setup: known folders, shortcuts, processes,
//! message boxes, WebView2 and the one link that may leave the window.
//!
//! Every call in here is the narrow, documented way to do one thing. There is
//! no general "run this" and no general "open that": a setup runs from the
//! Downloads folder, next to whatever else was downloaded, and it is the last
//! program on the machine that should be talked into starting something.
//!
//! What this module deliberately does not do: end a process. The sibling
//! installers kill the program they are replacing; this one is an editor's
//! setup, and closing a window with unsaved text in it is the user's decision.
//! [`processes_of`] therefore only ever counts.
//!
//! Every program it starts is started by its full path. Windows looks for a
//! bare name in the folder of the running executable first, and the running
//! executable is a download, or its copy in the temp folder — so a `cmd.exe`
//! somebody left next to it would be the one that ran.

use std::ffi::c_void;
use std::os::windows::process::CommandExt as _;
use std::path::{Path, PathBuf};
use std::time::Duration;

use windows::core::{Interface as _, GUID, HSTRING, PCWSTR, PWSTR};
use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
use windows::Win32::Storage::EnhancedStorage::PKEY_AppUserModel_ID;
use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
use windows::Win32::System::Com::Urlmon::URLDownloadToFileW;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemAlloc, CoTaskMemFree, IPersistFile,
    CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::LibraryLoader::{
    SetDefaultDllDirectories, LOAD_LIBRARY_SEARCH_SYSTEM32,
};
use windows::Win32::System::SystemInformation::GetSystemDirectoryW;
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, WaitForSingleObject, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
};
use windows::Win32::System::Variant::VT_LPWSTR;
use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
use windows::Win32::UI::Shell::{
    FOLDERID_Desktop, FOLDERID_LocalAppData, FOLDERID_Programs, FOLDERID_RoamingAppData,
    FOLDERID_UserProgramFiles, IShellLinkW, SHGetKnownFolderPath, ShellExecuteW, ShellLink,
    KF_FLAG_CREATE,
};
use windows::Win32::UI::WindowsAndMessaging::{
    MessageBoxW, IDYES, MB_ICONERROR, MB_ICONQUESTION, MB_OK, MB_YESNO, SW_SHOWNORMAL,
};
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
use winreg::RegKey;

use super::is_web_link;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const DETACHED_PROCESS: u32 = 0x0000_0008;

/// DLLs loaded by name come from System32 only — not from the folder the setup
/// was downloaded into, and not from the PATH. The static half of the same
/// rule is the `/DEPENDENTLOADFLAG` in `build.rs`. Must run before anything
/// else in the process loads a DLL.
pub fn restrict_dll_search() {
    // SAFETY: a process-wide flag, set once before any other thread exists.
    unsafe {
        let _ = SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32);
    }
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

fn known_folder(id: &GUID) -> Option<PathBuf> {
    // SAFETY: the call fills a string the caller owns; it is freed below,
    // after it has been copied into a PathBuf.
    unsafe {
        let raw = SHGetKnownFolderPath(id, KF_FLAG_CREATE, None).ok()?;
        let path = raw.to_string().ok().map(PathBuf::from);
        CoTaskMemFree(Some(raw.0 as *const c_void));
        path
    }
}

pub struct Folders {
    /// `%LOCALAPPDATA%\Programs`, where per-user programs belong.
    pub user_programs: PathBuf,
    /// Start menu › Programs.
    pub start_menu: PathBuf,
    pub desktop: PathBuf,
    /// `%APPDATA%`.
    pub roaming: PathBuf,
    /// `%LOCALAPPDATA%`.
    pub local: PathBuf,
}

/// Asks Windows where its folders are, and falls back to the environment when
/// it will not say — a profile on a redirected folder answers the first way and
/// not the second, and an unusual one sometimes the other way round.
pub fn folders() -> Folders {
    let variable = |name: &str| {
        std::env::var_os(name)
            .map(PathBuf::from)
            .unwrap_or_default()
    };
    let local = known_folder(&FOLDERID_LocalAppData).unwrap_or_else(|| variable("LOCALAPPDATA"));
    let roaming = known_folder(&FOLDERID_RoamingAppData).unwrap_or_else(|| variable("APPDATA"));
    Folders {
        user_programs: known_folder(&FOLDERID_UserProgramFiles)
            .unwrap_or_else(|| local.join("Programs")),
        start_menu: known_folder(&FOLDERID_Programs)
            .unwrap_or_else(|| roaming.join(r"Microsoft\Windows\Start Menu\Programs")),
        desktop: known_folder(&FOLDERID_Desktop)
            .unwrap_or_else(|| variable("USERPROFILE").join("Desktop")),
        roaming,
        local,
    }
}

pub struct Shortcut<'a> {
    pub target: &'a Path,
    pub description: &'a str,
    /// What Windows groups the taskbar button and the Start menu entry by. The
    /// same id the app sets on itself, or the pinned entry and the running
    /// window become two things.
    pub app_id: &'a str,
}

pub fn create_shortcut(path: &Path, shortcut: &Shortcut) -> Result<(), String> {
    let failed = |step: &str, error: windows::core::Error| {
        format!("Couldn't create the shortcut ({step}): {error}")
    };
    if let Some(folder) = path.parent() {
        std::fs::create_dir_all(folder)
            .map_err(|error| format!("Couldn't create {}: {error}", folder.display()))?;
    }
    // SAFETY: COM calls on one apartment-threaded thread. The PROPVARIANT owns
    // the string allocated for it and frees it when it is dropped.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
            .map_err(|error| failed("create", error))?;
        link.SetPath(&HSTRING::from(shortcut.target.as_os_str()))
            .map_err(|error| failed("target", error))?;
        if let Some(folder) = shortcut.target.parent() {
            link.SetWorkingDirectory(&HSTRING::from(folder.as_os_str()))
                .map_err(|error| failed("folder", error))?;
        }
        link.SetDescription(&HSTRING::from(shortcut.description))
            .map_err(|error| failed("description", error))?;
        link.SetIconLocation(&HSTRING::from(shortcut.target.as_os_str()), 0)
            .map_err(|error| failed("icon", error))?;

        let store: IPropertyStore = link.cast().map_err(|error| failed("properties", error))?;
        let id = wide(shortcut.app_id);
        let memory = CoTaskMemAlloc(id.len() * 2).cast::<u16>();
        if memory.is_null() {
            return Err("Couldn't create the shortcut (out of memory).".into());
        }
        std::ptr::copy_nonoverlapping(id.as_ptr(), memory, id.len());
        let mut value = PROPVARIANT::default();
        (*value.Anonymous.Anonymous).vt = VT_LPWSTR;
        (*value.Anonymous.Anonymous).Anonymous.pwszVal = PWSTR(memory);
        store
            .SetValue(&PKEY_AppUserModel_ID, &value)
            .map_err(|error| failed("app id", error))?;
        store.Commit().map_err(|error| failed("app id", error))?;

        let file: IPersistFile = link.cast().map_err(|error| failed("file", error))?;
        file.Save(&HSTRING::from(path.as_os_str()), true)
            .map_err(|error| failed("save", error))?;
    }
    Ok(())
}

fn process_path(pid: u32) -> Option<PathBuf> {
    // SAFETY: the handle is closed before the buffer is read back, and the
    // length the call writes is what bounds the slice.
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buffer = [0u16; 1024];
        let mut size = buffer.len() as u32;
        let result = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut size,
        );
        let _ = CloseHandle(process);
        result.ok()?;
        let name = buffer.get(..size as usize)?;
        Some(PathBuf::from(String::from_utf16_lossy(name)))
    }
}

/// The processes running this exact executable — this one compared by its whole
/// path, so a second UwUNotes somewhere else is not mistaken for the one being
/// replaced.
pub fn processes_of(exe: &Path) -> Vec<u32> {
    let wanted = exe.to_string_lossy().to_lowercase();
    let mut found = Vec::new();
    // SAFETY: the snapshot is walked with the entry size Windows asks for and
    // closed at the end; nothing escapes the loop.
    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return found;
        };
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        let mut walking = Process32FirstW(snapshot, &mut entry).is_ok();
        while walking {
            let end = entry.szExeFile.iter().position(|c| *c == 0).unwrap_or(0);
            let name = String::from_utf16_lossy(entry.szExeFile.get(..end).unwrap_or_default());
            // The name comes from the snapshot and is cheap; the full path
            // costs a handle per process, so it is only asked for when the name
            // already matches.
            let candidate = exe
                .file_name()
                .is_some_and(|file| file.to_string_lossy().eq_ignore_ascii_case(&name));
            if candidate
                && entry.th32ProcessID != std::process::id()
                && process_path(entry.th32ProcessID)
                    .is_some_and(|path| path.to_string_lossy().to_lowercase() == wanted)
            {
                found.push(entry.th32ProcessID);
            }
            walking = Process32NextW(snapshot, &mut entry).is_ok();
        }
        let _ = CloseHandle(snapshot);
    }
    found
}

/// Waits for one process to end; `true` when it did, and when it was already
/// gone before the wait started.
pub fn wait_for_exit(pid: u32, timeout: Duration) -> bool {
    // SAFETY: the handle is closed on both paths out of the wait.
    unsafe {
        let Ok(process) = OpenProcess(PROCESS_SYNCHRONIZE, false, pid) else {
            return true;
        };
        let waited = WaitForSingleObject(
            process,
            timeout.as_millis().min(u128::from(u32::MAX)) as u32,
        );
        let _ = CloseHandle(process);
        waited == WAIT_OBJECT_0
    }
}

/// Starts a program without waiting for it and without a console window.
pub fn spawn_detached(exe: &Path, arguments: &[&str]) -> Result<(), String> {
    std::process::Command::new(exe)
        .args(arguments)
        .current_dir(exe.parent().unwrap_or_else(|| Path::new(".")))
        .creation_flags(DETACHED_PROCESS)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Couldn't start {}: {error}", exe.display()))
}

/// Deletes a file a few seconds after this process has ended. Windows will not
/// delete a running program, and the uninstaller is one — so it runs from a
/// copy in the temp folder that takes itself away afterwards.
pub fn delete_after_exit(file: &Path) {
    // This copy runs from the temp folder, which is exactly where a planted
    // `cmd.exe` or `ping.exe` would be waiting: Windows looks next to the
    // running program first, and cmd looks in its working folder first. So both
    // are named by their full path in System32, and cmd works from there.
    let Some(system) = system_directory() else {
        return;
    };
    // The paths go in through environment variables rather than into the
    // command line: cmd expands %…% inside quotes too, so a profile folder with
    // a percent sign in its name must never become part of the command itself.
    let _ = std::process::Command::new(system.join("cmd.exe"))
        .raw_arg(
            r#"/c ""%UWUNOTES_PING%" 127.0.0.1 -n 4 > nul & del /f /q "%UWUNOTES_SETUP_COPY%"""#,
        )
        .env("UWUNOTES_PING", system.join("PING.EXE"))
        .env("UWUNOTES_SETUP_COPY", file)
        .current_dir(&system)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
}

/// `C:\Windows\System32`, from Windows itself rather than from `SystemRoot`,
/// which is an environment variable and so whatever the parent process said.
fn system_directory() -> Option<PathBuf> {
    let mut buffer = [0u16; 512];
    // SAFETY: the call writes at most `buffer.len()` characters and returns
    // how many it wrote, or the size it would need when the buffer is short.
    let length = unsafe { GetSystemDirectoryW(Some(&mut buffer)) } as usize;
    let name = buffer.get(..length).filter(|name| !name.is_empty())?;
    Some(PathBuf::from(String::from_utf16_lossy(name)))
}

/// Opens a link in the browser. `https` and nothing else: a setup has no
/// business starting a program, and every other scheme on Windows is a way to
/// do exactly that.
pub fn open_link(url: &str) -> Result<(), String> {
    if !is_web_link(url) {
        return Err("Only https links open from the setup.".into());
    }
    // SAFETY: the URL is checked above and the strings outlive the call.
    let result = unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let url = wide(url);
        let open = wide("open");
        ShellExecuteW(
            None,
            PCWSTR(open.as_ptr()),
            PCWSTR(url.as_ptr()),
            None,
            None,
            SW_SHOWNORMAL,
        )
    };
    // ShellExecuteW returns something above 32 when it started something, and
    // an error code below it when it did not.
    if result.0 as isize > 32 {
        Ok(())
    } else {
        Err("The link couldn't be opened.".into())
    }
}

pub fn ask(title: &str, text: &str) -> bool {
    // SAFETY: both strings outlive the call.
    unsafe {
        MessageBoxW(
            None,
            &HSTRING::from(text),
            &HSTRING::from(title),
            MB_YESNO | MB_ICONQUESTION,
        ) == IDYES
    }
}

/// The only way a silent update can say anything. It has no window, the editor
/// that started it has closed itself, and "nothing happened" is not an answer.
pub fn alert(title: &str, text: &str) {
    // SAFETY: both strings outlive the call.
    unsafe {
        MessageBoxW(
            None,
            &HSTRING::from(text),
            &HSTRING::from(title),
            MB_OK | MB_ICONERROR,
        );
    }
}

/// Whether the system language is German, which is what the setup's own message
/// boxes pick their wording by. The page has its texts; these four sentences
/// are the ones that appear when there is no page.
pub fn is_german() -> bool {
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Control Panel\International")
        .and_then(|key| key.get_value::<String, _>("LocaleName"))
        .is_ok_and(|locale| locale.to_ascii_lowercase().starts_with("de"))
}

/// The Evergreen runtime's entry, by the GUID Microsoft gives it.
const WEBVIEW2_CLIENT: &str =
    r"Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

pub fn webview2_installed() -> bool {
    let version = |root, path: String| {
        RegKey::predef(root)
            .open_subkey(path)
            .and_then(|key| key.get_value::<String, _>("pv"))
            .is_ok_and(|version| !version.is_empty() && version != "0.0.0.0")
    };
    version(
        HKEY_LOCAL_MACHINE,
        format!(r"SOFTWARE\WOW6432Node\{WEBVIEW2_CLIENT}"),
    ) || version(HKEY_LOCAL_MACHINE, format!(r"SOFTWARE\{WEBVIEW2_CLIENT}"))
        || version(HKEY_CURRENT_USER, format!(r"Software\{WEBVIEW2_CLIENT}"))
}

/// Downloads Microsoft's WebView2 bootstrapper and runs it. Windows 11 always
/// has the runtime and Windows 10 usually does; without it the setup has no
/// window to show and the editor has nothing to draw in.
pub fn install_webview2() -> Result<(), String> {
    // A folder of this process's own, so a file already lying in the temp
    // folder under that name is never the one that gets run.
    let folder = std::env::temp_dir().join(format!("UwUNotes-WebView2-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&folder);
    std::fs::create_dir_all(&folder)
        .map_err(|error| format!("Couldn't download WebView2: {error}"))?;
    let target = folder.join("MicrosoftEdgeWebview2Setup.exe");
    // SAFETY: both strings outlive the call, which writes to `target`.
    unsafe {
        URLDownloadToFileW(
            None,
            &HSTRING::from("https://go.microsoft.com/fwlink/p/?LinkId=2124703"),
            &HSTRING::from(target.as_os_str()),
            0,
            None,
        )
        .map_err(|error| format!("Couldn't download WebView2: {error}"))?;
    }
    let status = std::process::Command::new(&target)
        .args(["/silent", "/install"])
        .status()
        .map_err(|error| format!("Couldn't start the WebView2 setup: {error}"));
    let _ = std::fs::remove_dir_all(&folder);
    if status?.success() && webview2_installed() {
        Ok(())
    } else {
        Err("WebView2 couldn't be installed.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The folder the helpers are started from, by name — never whatever a
    /// bare `cmd` would have found next to the uninstaller in the temp folder.
    #[test]
    fn the_programs_the_setup_starts_come_from_system32() {
        let system = system_directory().expect("Windows knows where System32 is");
        assert!(system.is_absolute());
        assert!(system.join("cmd.exe").is_file());
        assert!(system.join("PING.EXE").is_file());
    }

    #[test]
    fn a_shortcut_is_written_where_it_is_asked_for() {
        let folder = tempfile::tempdir().expect("a temporary folder");
        let target = folder.path().join("UwUNotes.exe");
        std::fs::write(&target, b"MZ").unwrap();
        let path = folder.path().join(r"StartMenu\UwUNotes.lnk");

        create_shortcut(
            &path,
            &Shortcut {
                target: &target,
                description: "UwUNotes",
                app_id: "app.uwunotes.desktop",
            },
        )
        .expect("the shortcut");

        assert!(path.exists(), "including the folder it goes in");
        assert!(
            std::fs::metadata(&path).unwrap().len() > 0,
            "a shortcut with nothing in it would start nothing"
        );
    }

    /// The setup itself must never turn up in the list of programs it would
    /// wait for, or a reinstall would wait for itself.
    #[test]
    fn the_running_setup_is_not_one_of_the_processes_it_looks_for() {
        let me = std::env::current_exe().expect("the test binary");
        assert!(!processes_of(&me).contains(&std::process::id()));
    }
}
