//! The font families installed on this computer, for the editor's font picker.
//!
//! A webview can draw any installed font by its family name but cannot list
//! them, so Rust does: `fontdb` reads the system's font folders (and, on
//! Linux, fontconfig's configuration) without any native library. It is
//! pure Rust and reads only the name and `post` tables of each file, which is
//! also where the monospace flag comes from — so the picker can put the
//! fixed-width families first without measuring a single glyph.
//!
//! Scanned once per run, on a blocking thread, the first time the picker asks;
//! every later ask is the cached list. A font installed while the app runs
//! shows up after a restart, which is how most editors behave.
//!
//! In the Mac App Store sandbox the system font folders are readable; fonts in
//! the user's own `~/Library/Fonts` may be missing there, because the sandbox
//! gives the app a home of its own. The name typed by hand still works.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use serde::Serialize;

/// Longer than this is not a family name, and the settings would cut it anyway.
const MAX_FAMILY_CHARS: usize = 80;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SystemFont {
    family: String,
    /// At least one face of the family says it is fixed-width.
    monospace: bool,
}

static FONTS: OnceLock<Vec<SystemFont>> = OnceLock::new();

#[tauri::command]
pub(crate) async fn system_fonts() -> Vec<SystemFont> {
    if let Some(fonts) = FONTS.get() {
        return fonts.clone();
    }
    let scanned = tauri::async_runtime::spawn_blocking(scan)
        .await
        .unwrap_or_default();
    FONTS.get_or_init(|| scanned).clone()
}

fn scan() -> Vec<SystemFont> {
    let started = std::time::Instant::now();
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    let fonts = families(db.faces().filter_map(|face| {
        // The first name is the English one where the font has it.
        let (name, _) = face.families.first()?;
        Some((name.as_str(), face.monospaced))
    }));
    tracing::debug!(
        faces = db.len(),
        families = fonts.len(),
        elapsed_ms = started.elapsed().as_millis() as u64,
        "system fonts scanned"
    );
    fonts
}

/// One entry per family, monospace families first, each half sorted by name
/// regardless of case. Names that could not be used as a CSS family — hidden
/// system faces (`.SF NS`), control characters, quotes — are left out.
fn families<'a>(faces: impl Iterator<Item = (&'a str, bool)>) -> Vec<SystemFont> {
    let mut by_key: BTreeMap<String, SystemFont> = BTreeMap::new();
    for (name, monospace) in faces {
        let name = name.trim();
        if !usable(name) {
            continue;
        }
        by_key
            .entry(name.to_lowercase())
            .and_modify(|known| known.monospace |= monospace)
            .or_insert_with(|| SystemFont {
                family: name.to_owned(),
                monospace,
            });
    }
    let mut fonts: Vec<SystemFont> = by_key.into_values().collect();
    // Stable, so the case-insensitive order from the map holds within each half.
    fonts.sort_by_key(|font| !font.monospace);
    fonts
}

fn usable(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('.')
        && name.chars().count() <= MAX_FAMILY_CHARS
        && !name
            .chars()
            .any(|c| c.is_control() || matches!(c, '"' | '\'' | '\\' | ';' | '{' | '}'))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn font(family: &str, monospace: bool) -> SystemFont {
        SystemFont {
            family: family.to_owned(),
            monospace,
        }
    }

    /// Reads the real font folders of the machine running the tests, so its
    /// answer depends on that machine. Run by hand: `cargo test -- --ignored`.
    #[test]
    #[ignore = "reads the font folders of the machine it runs on"]
    fn scans_this_machines_fonts() {
        let fonts = scan();
        eprintln!(
            "{} families, {} monospace, e.g. {:?}",
            fonts.len(),
            fonts.iter().filter(|font| font.monospace).count(),
            fonts.iter().take(5).collect::<Vec<_>>()
        );
        assert!(!fonts.is_empty());
    }

    #[test]
    fn one_entry_per_family_monospace_first() {
        let faces = [
            ("Noto Sans", false),
            ("Cascadia Code", true),
            ("noto sans", false),
            ("Arial", false),
            ("Cascadia Code", true),
            ("Consolas", true),
        ];
        assert_eq!(
            families(faces.into_iter()),
            vec![
                font("Cascadia Code", true),
                font("Consolas", true),
                font("Arial", false),
                font("Noto Sans", false),
            ]
        );
    }

    #[test]
    fn a_family_with_one_fixed_width_face_counts_as_monospace() {
        let faces = [("Iosevka", false), ("Iosevka", true)];
        assert_eq!(families(faces.into_iter()), vec![font("Iosevka", true)]);
    }

    #[test]
    fn leaves_out_names_css_could_not_take() {
        let long = "x".repeat(MAX_FAMILY_CHARS + 1);
        let faces = [
            (".SF NS", false),
            ("", false),
            ("  ", false),
            ("Bad\"Name", false),
            ("Line\nBreak", false),
            (long.as_str(), false),
            ("MS ゴシック", true),
        ];
        assert_eq!(families(faces.into_iter()), vec![font("MS ゴシック", true)]);
    }
}
