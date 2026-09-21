//! Checksums, for Tools → Hash: MD5, SHA-1 and the SHA-2 family, over a piece of
//! text or over a file's bytes.
//!
//! Text is hashed as UTF-8, which is what every other tool that prints a
//! checksum of "a string" does — so the value here matches `printf '%s' … |
//! sha256sum`. A file is hashed exactly as it is on disk, BOM, line endings and
//! all, which is the only answer that can be compared with the checksum a
//! download page publishes.
//!
//! MD5 and SHA-1 are here because people still need to *compare* against them,
//! not because they protect anything. The page says so next to them.

use std::fs;
use std::io::Read;
use std::path::Path;

use digest::DynDigest;
use serde::Deserialize;

use crate::error::{FsError, FsResult};

/// The algorithms the page offers. The wire names match `HashAlgorithm` in
/// `lib/api.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum HashAlgorithm {
    #[serde(rename = "md5")]
    Md5,
    #[serde(rename = "sha1")]
    Sha1,
    #[serde(rename = "sha224")]
    Sha224,
    #[serde(rename = "sha256")]
    Sha256,
    #[serde(rename = "sha384")]
    Sha384,
    #[serde(rename = "sha512")]
    Sha512,
}

impl HashAlgorithm {
    fn hasher(self) -> Box<dyn DynDigest> {
        match self {
            Self::Md5 => Box::new(md5::Md5::default()),
            Self::Sha1 => Box::new(sha1::Sha1::default()),
            Self::Sha224 => Box::new(sha2::Sha224::default()),
            Self::Sha256 => Box::new(sha2::Sha256::default()),
            Self::Sha384 => Box::new(sha2::Sha384::default()),
            Self::Sha512 => Box::new(sha2::Sha512::default()),
        }
    }
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes
        .iter()
        .fold(String::with_capacity(bytes.len() * 2), |mut out, byte| {
            let _ = write!(out, "{byte:02x}");
            out
        })
}

/// The checksum of `text`, as lower-case hex.
pub fn hash_text(text: &str, algorithm: HashAlgorithm) -> String {
    let mut hasher = algorithm.hasher();
    hasher.update(text.as_bytes());
    hex(&hasher.finalize())
}

/// The checksum of a file's bytes, streamed, so a four gigabyte ISO costs a
/// 64 KiB buffer and not four gigabytes.
///
/// Only an ordinary file: a named pipe or a device would block the read until
/// something on the other end answered, the same reason `read_file` refuses
/// them.
pub fn hash_file(path: &Path, algorithm: HashAlgorithm) -> FsResult<String> {
    if fs::metadata(path).is_ok_and(|metadata| metadata.is_dir()) {
        return Err(FsError::IsDirectory {
            path: path.to_path_buf(),
        });
    }
    let mut file = fs::File::open(path).map_err(|error| FsError::from_io(&error, path))?;
    if !crate::read::is_regular_file(&file) {
        return Err(FsError::NotAFile {
            path: path.to_path_buf(),
        });
    }
    let mut hasher = algorithm.hasher();
    let mut buffer = vec![0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| FsError::from_io(&error, path))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex(&hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_answers_for_abc() {
        let cases = [
            (HashAlgorithm::Md5, "900150983cd24fb0d6963f7d28e17f72"),
            (
                HashAlgorithm::Sha1,
                "a9993e364706816aba3e25717850c26c9cd0d89d",
            ),
            (
                HashAlgorithm::Sha256,
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            ),
        ];
        for (algorithm, expected) in cases {
            assert_eq!(hash_text("abc", algorithm), expected, "{algorithm:?}");
        }
        assert_eq!(hash_text("abc", HashAlgorithm::Sha512).len(), 128);
        assert_eq!(hash_text("abc", HashAlgorithm::Sha384).len(), 96);
        assert_eq!(hash_text("abc", HashAlgorithm::Sha224).len(), 56);
    }

    #[test]
    fn a_file_hashes_to_the_same_value_as_its_bytes() {
        let dir = std::env::temp_dir().join(format!("uwunotes-hash-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("abc.txt");
        fs::write(&path, b"abc").unwrap();
        assert_eq!(
            hash_file(&path, HashAlgorithm::Md5).unwrap(),
            "900150983cd24fb0d6963f7d28e17f72"
        );
        assert!(matches!(
            hash_file(&dir, HashAlgorithm::Md5),
            Err(FsError::IsDirectory { .. })
        ));
        fs::remove_dir_all(&dir).unwrap();
    }
}
