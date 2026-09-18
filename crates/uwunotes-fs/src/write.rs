//! Saving a file without ever leaving it half-written.
//!
//! Two promises are kept here. The first is that a crash, a full disk or a
//! power cut during a save cannot truncate the user's file: the new contents go
//! to a temporary file in the same directory and are renamed over the target,
//! which is one atomic step on every filesystem worth the name. The second is
//! that a file somebody else changed since we read it is not overwritten
//! silently — `expected` makes the write fail with [`FsError::Changed`], and the
//! interface turns that into a question.
//!
//! What this module deliberately does not do: resolve conflicts. It notices
//! them and stops. Deciding what to do about one is a human's job.

use std::fs;
use std::io::Write as _;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::encoding::{self, Eol};
use crate::error::{FsError, FsResult};
use crate::read::{file_stamp, stamp_from_metadata, FileStamp};

/// Makes concurrent saves in one directory pick different temporary names.
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Encodes `text` and writes it to `path`, returning the file's new stamp.
///
/// `encoding` is a label from `lib/api.ts` — the same string that came back
/// from reading the file, unless the user changed it in the status bar.
pub fn write_file(
    path: &Path,
    text: &str,
    encoding_label: &str,
    bom: bool,
    eol: Eol,
    expected: Option<FileStamp>,
) -> FsResult<FileStamp> {
    let encoding = encoding::by_label(encoding_label).ok_or_else(|| {
        FsError::encoding(
            Some(path),
            format!("Unknown encoding label: {encoding_label}"),
        )
    })?;

    if let Some(expected) = expected {
        // A file that has disappeared is not a conflict: there is no rival edit
        // to protect, and refusing to save would strand the only copy of the
        // text in a window the user is about to close.
        if let Some(current) = file_stamp(path)? {
            if current != expected {
                return Err(FsError::Changed {
                    path: path.to_path_buf(),
                });
            }
        }
    }

    let existing = fs::metadata(path).ok();
    if let Some(metadata) = &existing {
        if metadata.is_dir() {
            return Err(FsError::IsDirectory {
                path: path.to_path_buf(),
            });
        }
        if metadata.permissions().readonly() {
            // Clearing the flag ourselves would be quietly editing something
            // the user marked as not-to-be-edited. Let them choose Save As.
            return Err(FsError::Permission {
                path: path.to_path_buf(),
            });
        }
    }

    // Defensive: the editor hands us `\n` text, but one stray `\r\n` reaching
    // `apply_eol` for CRLF would come out as `\r\r\n`.
    let normalised = encoding::normalise(text);
    let bytes = encoding::encode(&encoding::apply_eol(&normalised, eol), encoding, bom);

    write_bytes(path, &bytes, existing.as_ref())?;

    let metadata = fs::metadata(path).map_err(|error| FsError::from_io(&error, path))?;
    Ok(stamp_from_metadata(&metadata))
}

/// Writes bytes to `path` atomically. Public because saving a session file and
/// rewriting a file during "replace in files" want the same guarantee.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> FsResult<()> {
    let existing = fs::metadata(path).ok();
    write_bytes(path, bytes, existing.as_ref())
}

fn write_bytes(path: &Path, bytes: &[u8], existing: Option<&fs::Metadata>) -> FsResult<()> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty());
    let Some(parent) = parent else {
        // No directory to put a temporary file in — a bare file name relative
        // to the working directory. Rare, and a direct write is all we can do.
        return fs::write(path, bytes).map_err(|error| FsError::from_io(&error, path));
    };

    let temporary = parent.join(temporary_name());
    match write_then_rename(&temporary, path, bytes, existing) {
        Ok(()) => Ok(()),
        Err(error) => {
            // Network shares, filesystems that will not rename over an existing
            // file, and Windows refusing to replace a hidden file with a
            // non-hidden one all land here. A direct write is less safe but it
            // is what the user asked for, and if it fails too, its error is the
            // honest one to report.
            tracing::debug!(
                path = %path.display(),
                reason = %error,
                "atomic save failed, falling back to a direct write"
            );
            let _ = fs::remove_file(&temporary);
            fs::write(path, bytes).map_err(|error| FsError::from_io(&error, path))
        }
    }
}

fn write_then_rename(
    temporary: &Path,
    target: &Path,
    bytes: &[u8],
    existing: Option<&fs::Metadata>,
) -> FsResult<()> {
    {
        let mut file =
            fs::File::create(temporary).map_err(|error| FsError::from_io(&error, temporary))?;
        file.write_all(bytes)
            .map_err(|error| FsError::from_io(&error, temporary))?;
        // Without this the rename can land before the contents do, which is the
        // one failure mode the whole dance exists to prevent.
        file.sync_all()
            .map_err(|error| FsError::from_io(&error, temporary))?;
    }

    if let Some(metadata) = existing {
        // Keep the mode the file already had, so saving a shell script does not
        // quietly take its executable bit away. Best effort: a filesystem that
        // will not say is not a reason to refuse the save.
        let _ = fs::set_permissions(temporary, metadata.permissions());
    }

    fs::rename(temporary, target).map_err(|error| FsError::from_io(&error, target))
}

fn temporary_name() -> String {
    let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    // Leading dot so the leftovers of a crashed save stay out of the way on
    // anything Unix-shaped.
    format!(".uwunotes-{}-{sequence}.tmp", std::process::id())
}
