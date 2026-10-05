//! The macOS menu bar.
//!
//! On macOS the menus are not drawn by the page but by the system, at the top
//! of the screen. What is in them is still decided by the page: it walks the
//! same data its in-app menu row is built from (`lib/menus.ts`), writes it out
//! as plain data (`lib/native-menu.ts`) and sends it to [`set_app_menu`], which
//! only turns that data into native items. A click is handed back as a
//! `native-menu` event with the item's id, and the page runs the entry —
//! one code path for the menu row, the menu bar, the palette and the keys.
//!
//! On Windows and Linux the window has its own menu row and no native menu,
//! so [`set_app_menu`] does nothing there. The building code is compiled on
//! every platform all the same, so a check on Linux covers it.

use serde::Deserialize;
use tauri::menu::{
    CheckMenuItem, Menu, MenuEvent, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu,
};
use tauri::{AppHandle, Emitter as _, Runtime};

/// The event a click on one of the page's own items arrives as.
const MENU_EVENT: &str = "native-menu";

/// Items macOS draws and runs itself.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Role {
    Services,
    Hide,
    HideOthers,
    ShowAll,
    Undo,
    Redo,
    Cut,
    Copy,
    Paste,
    SelectAll,
    Minimize,
    Zoom,
    Fullscreen,
    BringAllToFront,
}

/// What a whole submenu is for, where macOS adds something of its own.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SubmenuRole {
    /// The window list.
    Window,
    /// The search field.
    Help,
}

/// One entry, as `NativeEntry` in `lib/native-menu.ts` writes it.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum Entry {
    Item {
        id: String,
        label: String,
        accelerator: Option<String>,
        enabled: bool,
        /// `None` is a plain item, `Some` a check item.
        checked: Option<bool>,
    },
    Separator,
    Predefined {
        role: Role,
        label: Option<String>,
    },
    Submenu {
        label: String,
        enabled: bool,
        role: Option<SubmenuRole>,
        items: Vec<Entry>,
    },
}

/// Replaces the menu bar with `menus`, each a [`Entry::Submenu`]; the first is
/// the app menu, whatever its label says. Rebuilt whole every time: the page
/// only sends a menu that changed, and a few hundred items are built in well
/// under a frame.
#[tauri::command]
pub(crate) fn set_app_menu(app: AppHandle, menus: Vec<Entry>) {
    if !cfg!(target_os = "macos") {
        return;
    }
    if let Err(error) = install(&app, &menus) {
        tracing::warn!(%error, "the menu bar could not be built");
    }
}

/// Hands a click on the page's own items to the page. Predefined items are
/// answered by macOS itself and never get here with an id the page knows; the
/// page ignores the ones it does not.
pub(crate) fn forward<R: Runtime>(app: &AppHandle<R>, event: &MenuEvent) {
    if let Err(error) = app.emit(MENU_EVENT, event.id().0.as_str()) {
        tracing::warn!(%error, "a menu click could not be passed on");
    }
}

fn install<R: Runtime>(app: &AppHandle<R>, menus: &[Entry]) -> tauri::Result<()> {
    let menu = Menu::new(app)?;
    for entry in menus {
        menu.append(&build(app, entry)?)?;
    }
    menu.set_as_app_menu()?;
    Ok(())
}

fn build<R: Runtime>(app: &AppHandle<R>, entry: &Entry) -> tauri::Result<MenuItemKind<R>> {
    Ok(match entry {
        Entry::Item {
            id,
            label,
            accelerator,
            enabled,
            checked: None,
        } => MenuItemKind::MenuItem(MenuItem::with_id(
            app,
            id.as_str(),
            label,
            *enabled,
            accelerator.as_deref(),
        )?),
        Entry::Item {
            id,
            label,
            accelerator,
            enabled,
            checked: Some(checked),
        } => MenuItemKind::Check(CheckMenuItem::with_id(
            app,
            id.as_str(),
            label,
            *enabled,
            *checked,
            accelerator.as_deref(),
        )?),
        Entry::Separator => MenuItemKind::Predefined(PredefinedMenuItem::separator(app)?),
        Entry::Predefined { role, label } => {
            MenuItemKind::Predefined(predefined(app, *role, label.as_deref())?)
        }
        Entry::Submenu {
            label,
            enabled,
            role,
            items,
        } => {
            let submenu = Submenu::new(app, label, *enabled)?;
            for item in items {
                submenu.append(&build(app, item)?)?;
            }
            mark(&submenu, *role)?;
            MenuItemKind::Submenu(submenu)
        }
    })
}

fn predefined<R: Runtime>(
    app: &AppHandle<R>,
    role: Role,
    label: Option<&str>,
) -> tauri::Result<PredefinedMenuItem<R>> {
    match role {
        Role::Services => PredefinedMenuItem::services(app, label),
        Role::Hide => PredefinedMenuItem::hide(app, label),
        Role::HideOthers => PredefinedMenuItem::hide_others(app, label),
        Role::ShowAll => PredefinedMenuItem::show_all(app, label),
        Role::Undo => PredefinedMenuItem::undo(app, label),
        Role::Redo => PredefinedMenuItem::redo(app, label),
        Role::Cut => PredefinedMenuItem::cut(app, label),
        Role::Copy => PredefinedMenuItem::copy(app, label),
        Role::Paste => PredefinedMenuItem::paste(app, label),
        Role::SelectAll => PredefinedMenuItem::select_all(app, label),
        Role::Minimize => PredefinedMenuItem::minimize(app, label),
        // macOS calls maximising a window "zooming" it.
        Role::Zoom => PredefinedMenuItem::maximize(app, label),
        Role::Fullscreen => PredefinedMenuItem::fullscreen(app, label),
        Role::BringAllToFront => PredefinedMenuItem::bring_all_to_front(app, label),
    }
}

/// Tells macOS which submenu is the window menu and which the help menu.
#[cfg(target_os = "macos")]
fn mark<R: Runtime>(submenu: &Submenu<R>, role: Option<SubmenuRole>) -> tauri::Result<()> {
    match role {
        Some(SubmenuRole::Window) => submenu.set_as_windows_menu_for_nsapp(),
        Some(SubmenuRole::Help) => submenu.set_as_help_menu_for_nsapp(),
        None => Ok(()),
    }
}

#[cfg(not(target_os = "macos"))]
fn mark<R: Runtime>(_submenu: &Submenu<R>, _role: Option<SubmenuRole>) -> tauri::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The page's JSON, as `lib/native-menu.ts` writes it, reads back.
    #[test]
    fn reads_what_the_page_sends() {
        let json = r#"[{"kind":"submenu","label":"Datei","enabled":true,"role":null,"items":[
            {"kind":"item","id":"file/file.save","label":"Speichern","accelerator":"CmdOrCtrl+S","enabled":true,"checked":null},
            {"kind":"separator"},
            {"kind":"item","id":"view/view.toggleWrap","label":"Umbruch","accelerator":null,"enabled":false,"checked":true},
            {"kind":"predefined","role":"selectAll","label":"Alles auswählen"},
            {"kind":"predefined","role":"bringAllToFront","label":null}
        ]},{"kind":"submenu","label":"Fenster","enabled":true,"role":"window","items":[]}]"#;
        let menus: Vec<Entry> = serde_json::from_str(json).expect("valid menu JSON");
        assert_eq!(menus.len(), 2);
        let Entry::Submenu { items, role, .. } = &menus[0] else {
            panic!("a top-level entry is a submenu");
        };
        assert!(role.is_none());
        assert_eq!(items.len(), 5);
        assert!(matches!(
            &items[0],
            Entry::Item { accelerator: Some(key), checked: None, .. } if key == "CmdOrCtrl+S"
        ));
        assert!(matches!(
            &items[2],
            Entry::Item {
                enabled: false,
                checked: Some(true),
                ..
            }
        ));
        assert!(matches!(
            &items[3],
            Entry::Predefined {
                role: Role::SelectAll,
                ..
            }
        ));
        assert!(matches!(
            &menus[1],
            Entry::Submenu {
                role: Some(SubmenuRole::Window),
                ..
            }
        ));
    }
}
