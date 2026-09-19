// No console window behind the setup in release builds. It matters more here
// than in the editor: a black terminal next to an installer is what a program
// that is about to do something unwelcome looks like.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(windows)]
mod app;
#[cfg(windows)]
mod install;
#[cfg(windows)]
mod system;

fn main() {
    #[cfg(windows)]
    {
        // Before anything else in the process loads a DLL: the setup usually
        // runs from the Downloads folder, next to whatever else was downloaded.
        system::restrict_dll_search();
        app::run();
    }
    #[cfg(not(windows))]
    eprintln!("UwUNotes Setup is the Windows installer. Other systems get their own packages.");
}
