//! The one error type every command in this crate returns.
//!
//! It serialises as `{ kind, message, path }`, which is `ApiError` in
//! `lib/api.ts`. The `kind` is the part the interface branches on — `changed`
//! becomes "the file changed on disk, overwrite?", `tooLarge` becomes an
//! apology — and `message` is the fallback for everything the interface has no
//! opinion about.
//!
//! What this module deliberately does not do: translate. The page owns German;
//! these messages are English, short and factual, and only ever reach a human
//! when the kind alone was not enough to say something better.

use std::io;
use std::path::{Path, PathBuf};

use serde::ser::{Serialize, SerializeStruct, Serializer};

/// Shorthand for the many functions in this crate that can only fail this way.
pub type FsResult<T> = Result<T, FsError>;

#[derive(Debug, thiserror::Error)]
pub enum FsError {
    #[error("The file does not exist.")]
    NotFound { path: PathBuf },

    #[error("Access to the file was denied.")]
    Permission { path: PathBuf },

    /// Someone else wrote to the file after we read it. Raised *instead of*
    /// writing, never after — the point is that the other edit survives long
    /// enough for the user to be asked about it.
    #[error("The file changed on disk since it was opened.")]
    Changed { path: PathBuf },

    #[error("The file is {size} bytes; the limit is {limit} bytes.")]
    TooLarge {
        path: PathBuf,
        size: u64,
        limit: u64,
    },

    #[error("That path is a directory, not a file.")]
    IsDirectory { path: PathBuf },

    /// Not a directory and not an ordinary file either — a named pipe, a
    /// console, a serial port. Reading one would block until whatever is on the
    /// other end answered, which may be never.
    #[error("That path is not an ordinary file.")]
    NotAFile { path: PathBuf },

    /// The text holds characters the file's encoding cannot represent. Raised
    /// *instead of* writing, because the alternative is writing `&#8594;` where
    /// the user typed `→` and saying the save went fine.
    #[error("{encoding} cannot represent every character in this text.")]
    Unmappable { path: PathBuf, encoding: String },

    #[error("{message}")]
    Encoding {
        path: Option<PathBuf>,
        message: String,
    },

    #[error("{message}")]
    InvalidRegex { message: String },

    #[error("{message}")]
    Other {
        path: Option<PathBuf>,
        message: String,
    },
}

impl FsError {
    /// The discriminator the page switches on. Matches `ApiErrorKind` exactly.
    pub const fn kind(&self) -> &'static str {
        match self {
            Self::NotFound { .. } => "notFound",
            Self::Permission { .. } => "permission",
            Self::Changed { .. } => "changed",
            Self::TooLarge { .. } => "tooLarge",
            Self::IsDirectory { .. } => "isDirectory",
            Self::NotAFile { .. } => "notAFile",
            Self::Unmappable { .. } => "unmappable",
            Self::Encoding { .. } => "encoding",
            Self::InvalidRegex { .. } => "invalidRegex",
            Self::Other { .. } => "other",
        }
    }

    pub fn path(&self) -> Option<&Path> {
        match self {
            Self::NotFound { path }
            | Self::Permission { path }
            | Self::Changed { path }
            | Self::TooLarge { path, .. }
            | Self::IsDirectory { path }
            | Self::NotAFile { path }
            | Self::Unmappable { path, .. } => Some(path),
            Self::Encoding { path, .. } | Self::Other { path, .. } => path.as_deref(),
            Self::InvalidRegex { .. } => None,
        }
    }

    /// Only two `io::ErrorKind`s are worth their own reaction in the interface;
    /// everything else is prose the user can at least read out to somebody.
    pub fn from_io(source: &io::Error, path: &Path) -> Self {
        match source.kind() {
            io::ErrorKind::NotFound => Self::NotFound {
                path: path.to_path_buf(),
            },
            io::ErrorKind::PermissionDenied => Self::Permission {
                path: path.to_path_buf(),
            },
            _ => Self::Other {
                path: Some(path.to_path_buf()),
                message: source.to_string(),
            },
        }
    }

    pub fn other(path: Option<&Path>, message: impl Into<String>) -> Self {
        Self::Other {
            path: path.map(Path::to_path_buf),
            message: message.into(),
        }
    }

    pub fn encoding(path: Option<&Path>, message: impl Into<String>) -> Self {
        Self::Encoding {
            path: path.map(Path::to_path_buf),
            message: message.into(),
        }
    }

    pub fn invalid_regex(message: impl Into<String>) -> Self {
        Self::InvalidRegex {
            message: message.into(),
        }
    }
}

/// Hand-written rather than derived: the wire shape is flat — kind, message,
/// path — while the enum carries different fields per variant, and the page
/// should never have to know that.
impl Serialize for FsError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut wire = serializer.serialize_struct("ApiError", 3)?;
        wire.serialize_field("kind", self.kind())?;
        wire.serialize_field("message", &self.to_string())?;
        wire.serialize_field(
            "path",
            &self.path().map(|path| path.to_string_lossy().into_owned()),
        )?;
        wire.end()
    }
}
