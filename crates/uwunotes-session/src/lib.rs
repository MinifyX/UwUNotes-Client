//! What was open last time, and what had not been saved yet.
//!
//! Small and dull on purpose. The page decides what a session means — which
//! tabs, which splits, which caret positions — and this crate writes that
//! decision to disk and reads it back, atomically, without interpreting any of
//! it. The only judgement it makes is that a session it cannot understand is
//! worth less than a working application, so it throws one away rather than
//! failing a start.
//!
//! Drafts live beside the session file: one per document with unsaved changes,
//! so closing the window never costs the user anything. And a trash beside
//! both: the unsaved text of tabs that were closed without saving.

#![forbid(unsafe_code)]

pub mod model;
pub mod store;
pub mod trash;

pub use model::{SessionDocument, SessionPane, StoredSession, SESSION_VERSION};
pub use store::SessionStore;
pub use trash::{TrashEntry, TrashNote, TrashSummary};
