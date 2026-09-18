//! The three Windows calls the standard library does not offer.
//!
//! This is the only module in the crate that contains `unsafe`, which is why it
//! is a module at all rather than three helpers scattered through `read.rs` and
//! `write.rs`. Each function wraps exactly one call, borrows a handle that
//! outlives it, and hands back an ordinary Rust answer.
//!
//! None of them returns a rich error. All three questions have a safe answer
//! when the call fails — "assume it is an ordinary file", "assume it has one
//! name", "the replace did not happen" — and a caller that cannot get an answer
//! should take the careful path, not stop.

// The crate denies unsafe everywhere else. Here it is the point.
#![allow(unsafe_code)]

use std::ffi::OsStr;
use std::fs::File;
use std::io;
use std::os::windows::ffi::OsStrExt as _;
use std::os::windows::io::AsRawHandle as _;
use std::path::Path;

use windows_sys::Win32::Storage::FileSystem::{
    GetFileInformationByHandle, GetFileType, ReplaceFileW, BY_HANDLE_FILE_INFORMATION,
    FILE_TYPE_DISK,
};

/// Whether an open handle is a file on a disk, as opposed to a pipe, a console
/// or a serial port.
///
/// `Metadata::is_file` cannot answer this: for `\\.\pipe\lsass` it says yes,
/// because the directory attribute is absent and that is all it looks at. The
/// difference matters because opening a named pipe returns instantly and then
/// the *read* blocks until the server on the other end feels like answering,
/// which for a path in a hand-edited `session.json` means an editor that never
/// finishes starting.
pub fn is_disk_file(file: &File) -> bool {
    // SAFETY: the handle belongs to `file`, which outlives the call, and
    // `GetFileType` only reads it.
    let kind = unsafe { GetFileType(file.as_raw_handle() as _) };
    kind == FILE_TYPE_DISK
}

/// How many directory entries name this file, or `None` when Windows would not
/// say.
///
/// A hard link is an ordinary entry: nothing about a path reveals that the data
/// behind it is shared, only this count on the file itself.
pub fn link_count(path: &Path) -> Option<u32> {
    let file = File::open(path).ok()?;
    // SAFETY: every field is an integer or a pair of them, so all zeroes is a
    // valid value; the call overwrites it before anything below reads it.
    let mut information: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    // SAFETY: the handle belongs to `file`, which outlives the call, and the
    // struct is a live local of exactly the type asked for.
    let ok = unsafe { GetFileInformationByHandle(file.as_raw_handle() as _, &mut information) };
    (ok != 0).then_some(information.nNumberOfLinks)
}

/// Puts `replacement` where `target` is, keeping what the target carried.
///
/// This is what `MoveFileEx` — which is what `fs::rename` is on Windows — does
/// not do. A rename unlinks the target and moves the temporary file into its
/// name, so the file that survives is the temporary one, with the access list
/// it inherited from the *folder*. Every explicit permission the user set on
/// their document is gone, along with its alternate data streams. `ReplaceFileW`
/// exists for exactly this and carries all of it across.
///
/// The target has to exist; over a missing one this fails with
/// `ERROR_FILE_NOT_FOUND`, so the caller keeps the plain rename for a new file.
pub fn replace_file(replacement: &Path, target: &Path) -> io::Result<()> {
    let replacement = wide(replacement.as_os_str());
    let target = wide(target.as_os_str());

    // SAFETY: both buffers are NUL-terminated and live for the whole call. The
    // three pointers Windows may take are passed as null, which it documents as
    // "no backup file", "no exclusions", "reserved".
    let ok = unsafe {
        ReplaceFileW(
            target.as_ptr(),
            replacement.as_ptr(),
            std::ptr::null(),
            0,
            std::ptr::null(),
            std::ptr::null(),
        )
    };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

/// A path as Windows wants it: UTF-16 with a NUL on the end.
fn wide(text: &OsStr) -> Vec<u16> {
    text.encode_wide().chain(std::iter::once(0)).collect()
}
