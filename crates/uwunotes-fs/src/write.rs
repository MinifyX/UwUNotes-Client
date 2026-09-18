//! Saving a file without ever leaving it half-written.
//!
//! Two promises are kept here. The first is that a crash, a full disk or a
//! power cut during a save cannot truncate the user's file: the new contents go
//! to a temporary file in the same directory and are put in the target's place
//! only once they are complete and flushed. The second is that a file somebody
//! else changed since we read it is not overwritten silently — `expected` makes
//! the write fail with [`FsError::Changed`], and the interface turns that into a
//! question.
//!
//! The fallback to a plain `fs::write` is the subtle part, and the reason
//! [`AtomicFailure`] exists. `File::create` empties the target the instant it
//! opens it, before a single byte is written, so answering *every* failure with
//! a direct write breaks the first promise in exactly the case it was made for:
//! a full disk fails to stage the temporary, the fallback empties the file, and
//! the fallback fails too. Which failure happened therefore decides whether a
//! direct write is allowed to happen at all.
//!
//! What this module deliberately does not do: resolve conflicts. It notices
//! them and stops. Deciding what to do about one is a human's job.

use std::fs;
use std::io;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::encoding::{self, Eol};
use crate::error::{FsError, FsResult};
use crate::read::{file_stamp, stamp_from_metadata, FileStamp};

/// Makes two saves in one directory pick different temporary names even when
/// they start in the same nanosecond.
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// How many temporary names to try. Eight collisions of a 64-bit name is not
/// bad luck, it is somebody filling the directory on purpose.
const TEMP_ATTEMPTS: usize = 8;

/// Encodes `text` and writes it to `path`, returning the file's new stamp.
///
/// `encoding` is a label from `lib/api.ts` — the same string that came back
/// from reading the file, unless the user changed it in the status bar.
///
/// `allow_unmappable` is the user having been asked and having said yes; see
/// [`FsError::Unmappable`].
pub fn write_file(
    path: &Path,
    text: &str,
    encoding_label: &str,
    bom: bool,
    eol: Eol,
    expected: Option<FileStamp>,
    allow_unmappable: bool,
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
    let (bytes, unmappable) =
        encoding::encode_checked(&encoding::apply_eol(&normalised, eol), encoding, bom);
    if unmappable && !allow_unmappable {
        // Raised above the write, so a refused save leaves the file on disk
        // exactly as it was and the buffer still dirty.
        return Err(FsError::Unmappable {
            path: path.to_path_buf(),
            encoding: encoding.name().to_owned(),
        });
    }

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

/// Why the careful path did not finish — and, the part that matters, whether
/// answering with a plain truncating write would be safe.
enum AtomicFailure {
    /// The temporary file could never be created.
    Create { error: FsError, kind: io::ErrorKind },
    /// It was created, but the bytes did not reach the disk.
    Staging(FsError),
    /// The finished temporary file could not take the target's place.
    Rename(FsError),
}

impl AtomicFailure {
    /// The name was taken. Worth another go with a different one.
    const fn name_taken(&self) -> bool {
        matches!(
            self,
            Self::Create {
                kind: io::ErrorKind::AlreadyExists,
                ..
            }
        )
    }

    /// Whether a direct `fs::write` over the target is a safe answer.
    ///
    /// `File::create` empties the target at open, so this may only be true when
    /// there is no reason to think the write itself will fail:
    ///
    /// * A create that was refused, or whose name was taken, says something
    ///   about this *directory* and nothing about the target — which may well
    ///   still be writable, and often is on a folder the user may not add files
    ///   to. If the direct write is refused too, it is refused at open, and
    ///   nothing was truncated.
    /// * A write or a flush that failed says plenty: the disk is full, the
    ///   quota is spent, the drive is going. A direct write would empty the
    ///   user's file and then fail for the very same reason. This is the case
    ///   the module exists for.
    /// * A rename that failed leaves a complete, flushed temporary file behind
    ///   and says nothing about whether bytes can be written — network shares
    ///   and hidden files end up here, and they saved fine before.
    const fn may_write_directly(&self) -> bool {
        match self {
            Self::Create { kind, .. } => matches!(
                kind,
                io::ErrorKind::PermissionDenied | io::ErrorKind::AlreadyExists
            ),
            Self::Staging(_) => false,
            Self::Rename(_) => true,
        }
    }

    /// The temporary file is a complete copy of what the save was trying to
    /// write, so it must not be deleted before something else holds it.
    const fn holds_the_new_contents(&self) -> bool {
        matches!(self, Self::Rename(_))
    }

    /// There is a temporary file and it is ours. After a failed create there is
    /// either no file or somebody else's, and deleting that would be the same
    /// mistake the create refused to make.
    const fn created_the_temporary(&self) -> bool {
        !matches!(self, Self::Create { .. })
    }

    const fn error(&self) -> &FsError {
        match self {
            Self::Create { error, .. } | Self::Staging(error) | Self::Rename(error) => error,
        }
    }

    fn into_error(self) -> FsError {
        match self {
            Self::Create { error, .. } | Self::Staging(error) | Self::Rename(error) => error,
        }
    }
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

    let mut temporary = PathBuf::new();
    let mut failure = None;
    for _ in 0..TEMP_ATTEMPTS {
        temporary = parent.join(temporary_name());
        match write_then_rename(&temporary, path, bytes, existing) {
            Ok(()) => return Ok(()),
            Err(problem) => {
                let taken = problem.name_taken();
                failure = Some(problem);
                // Whatever sits at that name belongs to somebody else. Leave it
                // where it is and pick a different name.
                if !taken {
                    break;
                }
            }
        }
    }

    let Some(failure) = failure else {
        // `TEMP_ATTEMPTS` is not zero, so the loop either returned or set this.
        // Saying "saved" here would be the one lie this module must not tell.
        return Err(FsError::other(Some(path), "The save did not run."));
    };

    // Whether the file at `temporary` is ours to delete. After a create that
    // failed it is not: either nothing was made, or the name was already taken
    // by somebody else's file, which is why the create failed at all.
    let ours = failure.created_the_temporary();

    if !failure.may_write_directly() {
        if ours {
            let _ = fs::remove_file(&temporary);
        }
        return Err(failure.into_error());
    }

    // `warn`, not `debug`: a user whose saves have quietly stopped being atomic
    // deserves a way to find out.
    tracing::warn!(
        path = %path.display(),
        reason = %failure.error(),
        "atomic save failed, falling back to a direct write"
    );

    let recovery = failure.holds_the_new_contents();
    match fs::write(path, bytes) {
        Ok(()) => {
            if ours {
                let _ = fs::remove_file(&temporary);
            }
            Ok(())
        }
        Err(error) if recovery => {
            // The target has just been emptied by the failed direct write and
            // the temporary is now the only complete copy of the user's text.
            // Say where it is rather than deleting it on the way out.
            Err(FsError::other(
                Some(path),
                format!(
                    "{error} The new contents were left in {}.",
                    temporary.display()
                ),
            ))
        }
        Err(error) => {
            if ours {
                let _ = fs::remove_file(&temporary);
            }
            Err(FsError::from_io(&error, path))
        }
    }
}

fn write_then_rename(
    temporary: &Path,
    target: &Path,
    bytes: &[u8],
    existing: Option<&fs::Metadata>,
) -> Result<(), AtomicFailure> {
    {
        let mut options = fs::OpenOptions::new();
        // `create_new`, not `create`: a file already sitting at this name is not
        // ours, and opening it would empty it — or, if somebody put a link
        // there, empty whatever it points at.
        options.write(true).create_new(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt as _;
            // Open a planted reparse point as itself, so `create_new` can refuse
            // it instead of walking through it.
            const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
            options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
        }

        let mut file = options
            .open(temporary)
            .map_err(|error| AtomicFailure::Create {
                kind: error.kind(),
                error: FsError::from_io(&error, temporary),
            })?;
        file.write_all(bytes)
            .map_err(|error| AtomicFailure::Staging(FsError::from_io(&error, temporary)))?;
        // Without this the rename can land before the contents do, which is the
        // one failure mode the whole dance exists to prevent.
        file.sync_all()
            .map_err(|error| AtomicFailure::Staging(FsError::from_io(&error, temporary)))?;
    }

    if let Some(metadata) = existing {
        // Keep the mode the file already had, so saving a shell script does not
        // quietly take its executable bit away. Best effort: a filesystem that
        // will not say is not a reason to refuse the save.
        let _ = fs::set_permissions(temporary, metadata.permissions());
    }

    put_in_place(temporary, target, existing)
}

/// Moves the finished temporary file onto the target, three ways.
///
/// * **The target shares its contents** — it is a symlink, a junction, or one
///   of several names for the same file. A rename replaces the *name*, so the
///   other names would keep the old text and a symlink would be destroyed with
///   the file it pointed at never written. The bytes go through the target's
///   own name instead. That gives up the atomic swap, but they are already
///   complete and flushed on disk, which is the part that matters.
/// * **The target exists, on Windows** — `ReplaceFileW`, which carries the
///   replaced file's access list, attributes and alternate data streams over to
///   the replacement. A plain rename hands the document whatever the *folder*
///   gives out, silently widening a file the user had locked down.
/// * **Anything else** — a plain rename, which is the atomic one.
#[cfg_attr(not(windows), allow(unused_variables))]
fn put_in_place(
    temporary: &Path,
    target: &Path,
    existing: Option<&fs::Metadata>,
) -> Result<(), AtomicFailure> {
    let rename_failed = |error: io::Error| AtomicFailure::Rename(FsError::from_io(&error, target));

    if shares_its_contents(target) {
        fs::copy(temporary, target).map_err(rename_failed)?;
        let _ = fs::remove_file(temporary);
        return Ok(());
    }

    #[cfg(windows)]
    if existing.is_some() {
        return crate::windows_api::replace_file(temporary, target).map_err(rename_failed);
    }

    fs::rename(temporary, target).map_err(rename_failed)
}

/// Whether writing through `path`'s name would reach a file that has other
/// names, or lives somewhere else entirely.
fn shares_its_contents(path: &Path) -> bool {
    // `symlink_metadata`, not `metadata`: the plain one follows the link and
    // would answer about the file at the far end.
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    if metadata.file_type().is_symlink() {
        return true;
    }

    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt as _;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return true;
        }
        crate::windows_api::link_count(path).is_some_and(|count| count > 1)
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt as _;
        metadata.nlink() > 1
    }
    #[cfg(not(any(windows, unix)))]
    {
        false
    }
}

/// A temporary name another process cannot guess.
///
/// It used to be the process id and a counter starting at zero, which anything
/// in the task list could work out — and the open that followed would have
/// taken over whatever was already sitting there. `RandomState` is seeded by the
/// operating system once per process; hashing the counter, the pid and the clock
/// through it buys an unguessable name without pulling a random-number crate
/// into this crate for the sake of one string.
fn temporary_name() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    use std::time::{SystemTime, UNIX_EPOCH};

    let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let mut hasher = RandomState::new().build_hasher();
    hasher.write_u64(sequence);
    hasher.write_u32(std::process::id());
    if let Ok(since) = SystemTime::now().duration_since(UNIX_EPOCH) {
        hasher.write_u128(since.as_nanos());
    }
    // Leading dot so the leftovers of a crashed save stay out of the way on
    // anything Unix-shaped. Windows shows them, which is why they are cleaned
    // up on every path out of `write_bytes` but one — and that one says so.
    format!(".uwunotes-{:016x}.tmp", hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn failure(kind: io::ErrorKind) -> AtomicFailure {
        AtomicFailure::Create {
            error: FsError::other(None, "test"),
            kind,
        }
    }

    #[test]
    fn a_staging_failure_never_reaches_the_target() {
        // The whole point of the module: whatever stopped the bytes reaching the
        // temporary file would stop them reaching the target too, and the direct
        // write empties the target before it finds that out.
        assert!(!AtomicFailure::Staging(FsError::other(None, "disk full")).may_write_directly());
    }

    #[test]
    fn a_rename_failure_still_falls_back() {
        // Network shares and hidden files land here and saved fine before.
        let rename = AtomicFailure::Rename(FsError::other(None, "cannot rename"));
        assert!(rename.may_write_directly());
        assert!(rename.holds_the_new_contents());
    }

    #[test]
    fn only_a_refused_or_taken_name_may_be_answered_directly() {
        assert!(failure(io::ErrorKind::PermissionDenied).may_write_directly());
        assert!(failure(io::ErrorKind::AlreadyExists).may_write_directly());
        // Everything else — a full disk reported at create, a vanished
        // directory, a dying drive — is not worth emptying the target over.
        assert!(!failure(io::ErrorKind::NotFound).may_write_directly());
        assert!(!failure(io::ErrorKind::Other).may_write_directly());
        assert!(!failure(io::ErrorKind::PermissionDenied).holds_the_new_contents());
    }

    #[test]
    fn a_name_that_was_already_taken_is_not_ours_to_delete() {
        // The file sitting there is why the create failed. Removing it would be
        // exactly the mistake `create_new` is here to refuse.
        assert!(!failure(io::ErrorKind::AlreadyExists).created_the_temporary());
        assert!(!failure(io::ErrorKind::PermissionDenied).created_the_temporary());
        assert!(AtomicFailure::Staging(FsError::other(None, "x")).created_the_temporary());
        assert!(AtomicFailure::Rename(FsError::other(None, "x")).created_the_temporary());
    }

    #[test]
    fn only_a_taken_name_is_worth_another_try() {
        assert!(failure(io::ErrorKind::AlreadyExists).name_taken());
        assert!(!failure(io::ErrorKind::PermissionDenied).name_taken());
        assert!(!AtomicFailure::Staging(FsError::other(None, "x")).name_taken());
    }

    #[test]
    fn two_temporary_names_in_a_row_do_not_look_alike() {
        let first = temporary_name();
        let second = temporary_name();
        assert_ne!(first, second);
        assert!(first.starts_with(".uwunotes-"), "{first}");
        assert!(first.ends_with(".tmp"), "{first}");
        // Sixteen hex digits and nothing else. The old name spelled out the
        // process id and a counter starting at zero, which anything in the task
        // list could work out and then squat.
        let middle = first
            .trim_start_matches(".uwunotes-")
            .trim_end_matches(".tmp");
        assert_eq!(middle.len(), 16, "{first}");
        assert!(
            middle.chars().all(|digit| digit.is_ascii_hexdigit()),
            "{first}"
        );
    }
}
