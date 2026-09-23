//! The file tree: what is in a directory, and the four small operations the
//! tree's context menu needs.
//!
//! Sorting is the interesting part. Directories come first and names compare
//! case-insensitively, because a tree sorted by byte value puts `Zebra` before
//! `apple` and every user reads that as a bug.
//!
//! What this module deliberately does not do: delete. Removing a file goes
//! through the recycle bin in the desktop crate, never through here.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{FsError, FsResult};
use crate::read::stamp_from_metadata;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DirEntryKind {
    File,
    Dir,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub kind: DirEntryKind,
    pub size: u64,
    pub mtime_ms: i64,
    pub hidden: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathInfo {
    pub path: String,
    pub name: String,
    pub parent: Option<String>,
    pub exists: bool,
    pub is_dir: bool,
}

/// One directory, sorted the way a human reads it.
pub fn list_dir(path: &Path) -> FsResult<Vec<DirEntry>> {
    let reader = fs::read_dir(path).map_err(|error| FsError::from_io(&error, path))?;

    let mut entries = Vec::new();
    for entry in reader {
        // A file that vanished between the listing and the stat is not a reason
        // to fail the whole directory; it is a reason to not list that file.
        let Ok(entry) = entry else { continue };
        let entry_path = entry.path();

        // `fs::metadata` follows symlinks, so a link to a directory sorts and
        // expands as a directory. Broken links fall back to the link itself.
        let metadata = match fs::metadata(&entry_path) {
            Ok(metadata) => metadata,
            Err(_) => match entry.metadata() {
                Ok(metadata) => metadata,
                Err(_) => continue,
            },
        };

        let name = entry.file_name().to_string_lossy().into_owned();
        let stamp = stamp_from_metadata(&metadata);
        entries.push(DirEntry {
            hidden: is_hidden(&name, &metadata),
            kind: if metadata.is_dir() {
                DirEntryKind::Dir
            } else {
                DirEntryKind::File
            },
            path: display_path(&entry_path),
            size: stamp.size,
            mtime_ms: stamp.mtime_ms,
            name,
        });
    }

    entries.sort_by(|left, right| {
        kind_rank(left.kind)
            .cmp(&kind_rank(right.kind))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            // Two names that differ only in case still need a stable order.
            .then_with(|| left.name.cmp(&right.name))
    });

    Ok(entries)
}

const fn kind_rank(kind: DirEntryKind) -> u8 {
    match kind {
        DirEntryKind::Dir => 0,
        DirEntryKind::File => 1,
    }
}

pub fn create_dir(path: &Path) -> FsResult<()> {
    fs::create_dir_all(path).map_err(|error| FsError::from_io(&error, path))
}

/// Creates an empty file, refusing to clobber one that is already there.
pub fn create_file(path: &Path) -> FsResult<()> {
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
    {
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Err(FsError::other(
            Some(path),
            "A file with that name already exists.",
        )),
        Err(error) => Err(FsError::from_io(&error, path)),
    }
}

/// Renames or moves. Refuses to land on an existing path, because `fs::rename`
/// would replace it without a word and a rename in a file tree is a typo away
/// from destroying the neighbour.
pub fn rename_path(from: &Path, to: &Path) -> FsResult<()> {
    if to.exists() {
        return Err(FsError::other(
            Some(to),
            "A file with that name already exists.",
        ));
    }
    fs::rename(from, to).map_err(|error| FsError::from_io(&error, from))
}

/// Everything the page wants to know about a path, including one that is not
/// there yet — this is how "Save As" checks a name before using it.
pub fn path_info(path: &Path) -> PathInfo {
    let absolute = absolute_path(path);
    let metadata = fs::metadata(&absolute).ok();

    PathInfo {
        name: absolute
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            // A drive root or `/` has no file name; its own path is its name.
            .unwrap_or_else(|| absolute.to_string_lossy().into_owned()),
        parent: absolute.parent().map(display_path),
        exists: metadata.is_some(),
        is_dir: metadata.is_some_and(|metadata| metadata.is_dir()),
        path: display_path(&absolute),
    }
}

/// Joins with the platform's separator so the page never has to guess a slash.
/// An absolute `name` replaces `base`, which is what `Path::join` does and what
/// a user typing a full path into a rename box means.
pub fn join_path(base: &Path, name: &str) -> String {
    display_path(&base.join(name))
}

/// The path as the page should see it: absolute, with `.` and `..` resolved
/// where the platform can do that lexically.
///
/// Deliberately not `fs::canonicalize`: that resolves symlinks, so opening
/// `~/notes/today.md` through a link would show a path the user does not
/// recognise, and on Windows it returns the `\\?\` verbatim form, which nobody
/// wants to read.
pub(crate) fn display_path(path: &Path) -> String {
    absolute_path(path).to_string_lossy().into_owned()
}

fn absolute_path(path: &Path) -> PathBuf {
    std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf())
}

fn is_hidden(name: &str, metadata: &fs::Metadata) -> bool {
    if name.starts_with('.') {
        return true;
    }
    hidden_attribute(metadata)
}

#[cfg(windows)]
fn hidden_attribute(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt as _;
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x0000_0002;
    metadata.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0
}

#[cfg(not(windows))]
fn hidden_attribute(_metadata: &fs::Metadata) -> bool {
    false
}
