// No console window behind the setup in release builds. It matters more here
// than in the editor: a black terminal next to an installer is what a program
// that is about to do something unwelcome looks like.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod install;
mod system;

fn main() {
    // Before anything else in the process loads a DLL: the setup usually
    // runs from the Downloads folder, next to whatever else was downloaded.
    #[cfg(windows)]
    system::restrict_dll_search();
    app::run();
}
