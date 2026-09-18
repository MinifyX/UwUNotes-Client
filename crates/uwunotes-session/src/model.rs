//! What gets written to `session.json`.
//!
//! These structs mirror `StoredSession` in `lib/api.ts` field for field. The
//! one that looks lazy is `layout`: it is a `serde_json::Value` because the
//! split tree belongs to `lib/layout.ts`, and Rust has no business having an
//! opinion about it. Carrying it verbatim means the page can change the shape
//! of a split without this crate being touched.
//!
//! Every optional field has a serde default, so a session written by an older
//! build loses at most the fields it never had — never the whole session.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use uwunotes_fs::{Eol, FileStamp};

/// Bumped when a change would make an older session actively wrong rather than
/// merely incomplete. The page decides what to do with a mismatch.
pub const SESSION_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDocument {
    pub doc_id: String,
    /// `None` for a buffer that was never saved anywhere.
    #[serde(default)]
    pub path: Option<String>,
    pub name: String,
    pub encoding: String,
    pub bom: bool,
    pub eol: Eol,
    /// A language the user picked by hand; `None` means "decide by file name".
    #[serde(default)]
    pub language: Option<String>,
    /// Caret offset, in UTF-16 code units.
    #[serde(default)]
    pub cursor: usize,
    #[serde(default)]
    pub scroll_top: f64,
    /// There were unsaved changes, so a draft was written next to the session.
    #[serde(default)]
    pub dirty: bool,
    #[serde(default)]
    pub stamp: Option<FileStamp>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPane {
    pub tabs: Vec<String>,
    #[serde(default)]
    pub active: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSession {
    pub version: u32,
    #[serde(default)]
    pub documents: Vec<SessionDocument>,
    /// The split tree, exactly as `lib/layout.ts` wrote it.
    #[serde(default)]
    pub layout: serde_json::Value,
    /// A `BTreeMap` rather than a `HashMap` so two saves of an unchanged
    /// session produce identical files, which makes the thing diffable and
    /// stops a backup tool from seeing churn that is not there.
    #[serde(default)]
    pub panes: BTreeMap<String, SessionPane>,
    pub active_pane: String,
    #[serde(default)]
    pub folder: Option<String>,
    #[serde(default)]
    pub recent_files: Vec<String>,
    #[serde(default)]
    pub recent_folders: Vec<String>,
}

impl Default for StoredSession {
    fn default() -> Self {
        Self {
            version: SESSION_VERSION,
            documents: Vec::new(),
            layout: serde_json::Value::Null,
            panes: BTreeMap::new(),
            active_pane: String::new(),
            folder: None,
            recent_files: Vec::new(),
            recent_folders: Vec::new(),
        }
    }
}
