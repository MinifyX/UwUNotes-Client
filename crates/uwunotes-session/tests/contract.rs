//! The session the page writes is the session Rust reads.
//!
//! `persistSession()` in `apps/desktop/src/lib/session.ts` builds this JSON and
//! hands it to `save_session`. Tauri deserialises it into [`StoredSession`]
//! before the command body ever runs, so a single renamed or retyped field
//! makes the whole save fail — and the page deliberately swallows that error,
//! because a failed session save must not interrupt someone's typing. The cost
//! of that choice is that nothing would ever tell us; this test is what tells
//! us instead.
//!
//! The payload below is copied from a real run, not written from the struct.
//! Deriving it from the Rust type would only prove the type agrees with itself.

use uwunotes_session::{SessionDocument, StoredSession};

/// Exactly what the page sends for two fresh, never-saved buffers in one pane.
const FROM_THE_PAGE: &str = r#"{
  "version": 1,
  "documents": [
    {
      "docId": "doc-1-0",
      "path": null,
      "name": "Neu 1",
      "encoding": "UTF-8",
      "bom": false,
      "eol": "crlf",
      "language": null,
      "cursor": 0,
      "scrollTop": 0,
      "dirty": false,
      "stamp": null
    },
    {
      "docId": "doc-2-1",
      "path": "C:\\Users\\Mini\\notes.md",
      "name": "notes.md",
      "encoding": "windows-1252",
      "bom": false,
      "eol": "lf",
      "language": "markdown",
      "cursor": 42,
      "scrollTop": 128.5,
      "dirty": true,
      "stamp": { "mtimeMs": 1758200000000, "size": 2048, "readOnly": false }
    }
  ],
  "layout": {
    "kind": "split",
    "direction": "horizontal",
    "ratio": 0.5,
    "first": { "kind": "pane", "id": "pane-1" },
    "second": { "kind": "pane", "id": "pane-2" }
  },
  "panes": {
    "pane-1": { "tabs": ["doc-1-0"], "active": "doc-1-0" },
    "pane-2": { "tabs": ["doc-2-1"], "active": "doc-2-1" }
  },
  "activePane": "pane-1",
  "folder": null,
  "recentFiles": ["C:\\Users\\Mini\\notes.md"],
  "recentFolders": []
}"#;

#[test]
fn the_pages_session_deserialises() {
    let session: StoredSession =
        serde_json::from_str(FROM_THE_PAGE).expect("the page's session must deserialise");

    assert_eq!(session.version, 1);
    assert_eq!(session.documents.len(), 2);
    assert_eq!(session.active_pane, "pane-1");
    assert_eq!(session.panes.len(), 2);
    assert_eq!(session.recent_files, vec!["C:\\Users\\Mini\\notes.md"]);

    let first = &session.documents[0];
    assert_eq!(first.doc_id, "doc-1-0");
    assert_eq!(first.path, None);
    assert!(!first.dirty);

    let second = &session.documents[1];
    assert_eq!(second.encoding, "windows-1252");
    assert_eq!(second.language.as_deref(), Some("markdown"));
    assert_eq!(second.cursor, 42);
    assert!(second.dirty);
    assert_eq!(second.stamp.expect("a saved file has a stamp").size, 2048);

    // The split tree is carried, not understood — but it has to survive intact.
    assert_eq!(session.layout["direction"], "horizontal");
    assert_eq!(session.layout["first"]["id"], "pane-1");
}

/// A field the page omits must not sink the whole save.
#[test]
fn a_session_from_an_older_build_still_loads() {
    let thin = r#"{ "version": 1, "activePane": "pane-1" }"#;
    let session: StoredSession = serde_json::from_str(thin).expect("defaults must cover the rest");
    assert!(session.documents.is_empty());
    assert_eq!(session.folder, None);
}

/// Every line ending the page can send, in the spelling it sends it.
#[test]
fn the_line_endings_the_page_spells() {
    for spelling in ["lf", "crlf", "cr"] {
        let json = format!(
            r#"{{ "docId": "d", "name": "n", "encoding": "UTF-8", "bom": false, "eol": "{spelling}" }}"#
        );
        serde_json::from_str::<SessionDocument>(&json)
            .unwrap_or_else(|error| panic!("eol {spelling} must deserialise: {error}"));
    }
}
