// Keep the console window away on Windows release builds — an editor that
// opens a stray black terminal on launch looks broken, and it is the first
// thing the user sees.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    uwunotes_desktop_lib::run()
}
