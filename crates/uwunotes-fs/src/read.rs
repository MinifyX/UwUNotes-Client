//! Opening a file: bytes in, one `LoadedFile` out.
//!
//! Everything the page needs to put the file back exactly as it found it —
//! encoding, BOM, line ending — is decided here and travels with the text. The
//! two refusals are deliberate: a directory is not a document, and a 200 MiB
//! file would take the editor down with it, so both are errors with a kind the
//! interface can explain rather than a spinner that never ends.
//!
//! What this module deliberately does not do: refuse binary files. It flags
//! them and opens them anyway, because "this looks like a binary, are you sure?"
//! is a question, and the user is allowed to answer yes.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::encoding::{self, Detected, EncodingSource, Eol};
use crate::error::{FsError, FsResult};
use crate::listing::display_path;

/// 64 MiB. Past this the editor is not the right tool, and saying so quickly is
/// kinder than freezing for a minute first.
pub const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;

/// How much of the file is inspected for NUL bytes.
const BINARY_SNIFF_BYTES: usize = 8 * 1024;

/// What the file looked like on disk when we last touched it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStamp {
    /// Milliseconds since the epoch; 0 when the platform would not say.
    pub mtime_ms: i64,
    pub size: u64,
    pub read_only: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedFile {
    pub path: String,
    /// Line endings already collapsed to `\n`; `eol` says what to write back.
    pub text: String,
    pub encoding: String,
    pub bom: bool,
    pub eol: Eol,
    pub mixed_eol: bool,
    pub stamp: FileStamp,
    pub lossy: bool,
    pub binary: bool,
    pub encoding_source: EncodingSource,
}

pub fn stamp_from_metadata(metadata: &fs::Metadata) -> FileStamp {
    let mtime_ms = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |since_epoch| since_epoch.as_millis() as i64);

    FileStamp {
        mtime_ms,
        size: metadata.len(),
        read_only: metadata.permissions().readonly(),
    }
}

/// The file's current stamp, or `None` when it is gone.
///
/// A missing file is not an error here: the page polls this on window focus to
/// notice outside edits, and "somebody deleted it" is an answer, not a failure.
pub fn file_stamp(path: &Path) -> FsResult<Option<FileStamp>> {
    match fs::metadata(path) {
        Ok(metadata) => Ok(Some(stamp_from_metadata(&metadata))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(FsError::from_io(&error, path)),
    }
}

/// Reads and decodes a file. `forced` overrides detection with an encoding
/// label the user picked from the status bar.
pub fn read_file(path: &Path, forced: Option<&str>) -> FsResult<LoadedFile> {
    let metadata = fs::metadata(path).map_err(|error| FsError::from_io(&error, path))?;
    if metadata.is_dir() {
        return Err(FsError::IsDirectory {
            path: path.to_path_buf(),
        });
    }
    if metadata.len() > MAX_FILE_BYTES {
        return Err(FsError::TooLarge {
            path: path.to_path_buf(),
            size: metadata.len(),
            limit: MAX_FILE_BYTES,
        });
    }

    let bytes = fs::read(path).map_err(|error| FsError::from_io(&error, path))?;

    let detected = match forced {
        Some(label) => {
            let encoding = encoding::by_label(label).ok_or_else(|| {
                FsError::encoding(Some(path), format!("Unknown encoding label: {label}"))
            })?;
            // A forced encoding still has to agree with the bytes about the
            // BOM, or re-saving would either duplicate it or drop it.
            let bom = encoding::bom_encoding(&bytes).is_some_and(|(marked, _)| marked == encoding);
            Detected {
                encoding,
                bom,
                source: EncodingSource::Forced,
            }
        }
        None => encoding::detect(&bytes),
    };

    let (decoded, lossy) = encoding::decode(&bytes, detected.encoding, detected.bom);
    let (eol, mixed_eol) = encoding::detect_eol(&decoded);
    let text = encoding::normalise(&decoded);

    // UTF-16 text is half NUL bytes by construction, so the usual NUL test
    // would call every UTF-16 document a binary and warn about all of them.
    let looks_like_utf16 = detected.encoding.name().starts_with("UTF-16");
    let binary = !looks_like_utf16 && bytes.iter().take(BINARY_SNIFF_BYTES).any(|byte| *byte == 0);

    Ok(LoadedFile {
        path: display_path(path),
        text,
        encoding: detected.encoding.name().to_owned(),
        bom: detected.bom,
        eol,
        mixed_eol,
        stamp: stamp_from_metadata(&metadata),
        lossy,
        binary,
        encoding_source: detected.source,
    })
}
