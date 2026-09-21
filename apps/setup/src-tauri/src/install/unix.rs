//! How the macOS and Linux installers put files down: whole or not at all, with
//! the permissions they are meant to have, and never through a link somebody
//! else put in the way.
//!
//! Three rules, each for a reason:
//!
//! - **Beside, then swapped in.** Every file is written under a name of its own
//!   in the same folder and renamed over its destination when it is complete.
//!   A rename within one folder is atomic, so an install that stops halfway
//!   leaves the old file or the new one, never half of either.
//! - **Modes spelled out.** 0755 for programs, 0644 for everything else, set
//!   explicitly after writing — the umask the setup was started with is the
//!   user's shell's business, not a reason for an editor nobody can start.
//! - **No writing through links.** A destination that is a symbolic link is
//!   refused rather than followed or replaced: this setup did not make it, so
//!   it points somewhere this setup has no business writing, and the user gets
//!   told instead of surprised. The one link the setup does make, the command
//!   in `~/.local/bin` or the alias on the desktop, is only ever replaced or
//!   removed when it is that link, pointing where the setup would point it.
//!
//! And one record: the version that is installed and whether the desktop
//! shortcut was wanted, as a small JSON file, because neither system has a
//! registry to keep them in.

use std::fs;
use std::io::{self, Write as _};
use std::os::unix::fs::{DirBuilderExt as _, PermissionsExt as _};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::{create_incoming, Options, SetupError};

pub const EXECUTABLE: u32 = 0o755;
pub const READABLE: u32 = 0o644;

/// The one folder UwUNotes goes to on this system. The page shows it without
/// letting it be edited, and a silent update sends it back; anything else
/// arriving here is a caller that means somewhere this setup does not install
/// to, and gets told so rather than quietly ignored.
pub fn the_folder(options: &Options, expected: &Path) -> Result<PathBuf, SetupError> {
    if !expected.is_absolute() {
        return Err(SetupError::other(
            "There is no home folder to install into: $HOME is not set to a full path.",
        ));
    }
    if Path::new(options.folder.trim()) != expected {
        return Err(SetupError::other(format!(
            "On this system UwUNotes always goes to {}.",
            expected.display()
        )));
    }
    Ok(expected.to_path_buf())
}

pub fn is_symlink(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|meta| meta.file_type().is_symlink())
}

/// Refuses a destination that is a symbolic link.
pub fn refuse_symlink(path: &Path) -> Result<(), SetupError> {
    if is_symlink(path) {
        return Err(SetupError::other(format!(
            "{} is a symbolic link the setup did not make, so it won't write through it. Move it away and try again.",
            path.display()
        )));
    }
    Ok(())
}

/// Creates a folder and whatever is missing above it, 0755. One that is already
/// there is left exactly as it is, including a link to a folder: a home folder
/// on another disk is somebody's choice, not something to refuse.
pub fn make_folder(path: &Path) -> Result<(), SetupError> {
    fs::DirBuilder::new()
        .recursive(true)
        .mode(EXECUTABLE)
        .create(path)
        .map_err(|error| SetupError::from_io(&error, format!("Couldn't create {}", path.display())))
}

/// The name a file is written under before it is complete: hidden, beside its
/// destination, and specific to this setup so it cannot be anyone else's.
pub fn incoming(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    path.with_file_name(format!(".{name}.uwunotes-setup"))
}

/// Gives a finished file its mode and renames it over its destination.
pub fn replace(incoming: &Path, path: &Path, mode: u32) -> Result<(), SetupError> {
    let swapped = refuse_symlink(path).and_then(|()| {
        fs::set_permissions(incoming, fs::Permissions::from_mode(mode))
            .and_then(|()| fs::rename(incoming, path))
            .map_err(|error| {
                SetupError::from_io(&error, format!("Couldn't replace {}", path.display()))
            })
    });
    if swapped.is_err() {
        let _ = fs::remove_file(incoming);
    }
    swapped
}

/// Writes a whole file, beside its destination first.
pub fn write_atomically(path: &Path, bytes: &[u8], mode: u32) -> Result<(), SetupError> {
    refuse_symlink(path)?;
    let incoming = incoming(path);
    let written = create_incoming(&incoming, mode).and_then(|mut file| {
        file.write_all(bytes)?;
        file.sync_all()
    });
    if let Err(error) = written {
        let _ = fs::remove_file(&incoming);
        return Err(SetupError::from_io(
            &error,
            format!("Couldn't write {}", path.display()),
        ));
    }
    replace(&incoming, path, mode)
}

/// Copies a file, beside its destination first. For the setup becoming its own
/// uninstaller.
pub fn copy_atomically(from: &Path, to: &Path, mode: u32) -> Result<(), SetupError> {
    refuse_symlink(to)?;
    let incoming = incoming(to);
    let copied = fs::File::open(from).and_then(|mut source| {
        let mut file = create_incoming(&incoming, mode)?;
        io::copy(&mut source, &mut file)?;
        file.sync_all()
    });
    if let Err(error) = copied {
        let _ = fs::remove_file(&incoming);
        return Err(SetupError::from_io(
            &error,
            format!("Couldn't write {}", to.display()),
        ));
    }
    replace(&incoming, to, mode)
}

/// Whether `link` is a symbolic link to exactly `target`.
pub fn is_link_to(link: &Path, target: &Path) -> bool {
    is_symlink(link) && fs::read_link(link).is_ok_and(|points_to| points_to == target)
}

/// Makes `link` point at `target`, when the name is free or already this very
/// link. `false` when something else has that name: somebody's own script in
/// `~/.local/bin`, a file on the desktop — which stays, and the link is skipped.
pub fn link_if_free(link: &Path, target: &Path) -> Result<bool, SetupError> {
    match fs::symlink_metadata(link) {
        Ok(_) if is_link_to(link, target) => return Ok(true),
        Ok(_) => return Ok(false),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(SetupError::from_io(
                &error,
                format!("Couldn't look at {}", link.display()),
            ))
        }
    }
    if let Some(folder) = link.parent() {
        make_folder(folder)?;
    }
    let incoming = incoming(link);
    let _ = fs::remove_file(&incoming);
    std::os::unix::fs::symlink(target, &incoming)
        .and_then(|()| fs::rename(&incoming, link))
        .map_err(|error| {
            let _ = fs::remove_file(&incoming);
            SetupError::from_io(&error, format!("Couldn't create {}", link.display()))
        })?;
    Ok(true)
}

/// Removes `link` if, and only if, it is the link the setup made.
pub fn remove_link_to(link: &Path, target: &Path) {
    if is_link_to(link, target) {
        let _ = fs::remove_file(link);
    }
}

/// Removes a plain file. A link under that name is not what the setup wrote,
/// and a folder even less, so both stay. `Ok(false)` when there was nothing
/// to remove.
pub fn remove_file(path: &Path) -> io::Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_file() => fs::remove_file(path).map(|()| true),
        Ok(_) => Ok(false),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

/// Deletes one of the editor's data folders, for the uninstall that was told to.
/// A link in that place is removed as a link: whatever it points at was never
/// the editor's.
pub fn remove_data(path: &Path) -> Result<(), SetupError> {
    let removed = match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_dir() => fs::remove_dir_all(path),
        Ok(_) => fs::remove_file(path),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    };
    removed
        .map_err(|error| SetupError::from_io(&error, format!("Couldn't delete {}", path.display())))
}

/// What the setup remembers about the installation it made.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Record {
    pub version: Option<String>,
    pub desktop_shortcut: bool,
}

impl Record {
    /// `None` when there is no record, and when there is one nobody can read —
    /// which the callers treat the same way, as "not known".
    pub fn read(path: &Path) -> Option<Self> {
        // A record is a few dozen bytes; anything much bigger is not one.
        let meta = fs::symlink_metadata(path).ok()?;
        if !meta.file_type().is_file() || meta.len() > 64 * 1024 {
            return None;
        }
        serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
    }

    pub fn write(&self, path: &Path) -> Result<(), SetupError> {
        let text = serde_json::to_string_pretty(self).map_err(|error| {
            SetupError::other(format!("Couldn't write {}: {error}", path.display()))
        })?;
        write_atomically(path, format!("{text}\n").as_bytes(), READABLE)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mode(path: &Path) -> u32 {
        fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[test]
    fn a_file_is_written_whole_with_the_mode_it_is_meant_to_have() {
        let folder = tempfile::tempdir().unwrap();
        let program = folder.path().join("uwunotes");
        write_atomically(&program, b"#!/bin/sh\n", EXECUTABLE).unwrap();
        assert_eq!(fs::read(&program).unwrap(), b"#!/bin/sh\n");
        assert_eq!(mode(&program), 0o755);
        assert!(!incoming(&program).exists(), "nothing half-written is left");

        let text = folder.path().join("setup.json");
        write_atomically(&text, b"{}", READABLE).unwrap();
        assert_eq!(mode(&text), 0o644);

        // Over an existing file, which is what every update is.
        write_atomically(&program, b"#!/bin/sh\necho 2\n", EXECUTABLE).unwrap();
        assert_eq!(fs::read(&program).unwrap(), b"#!/bin/sh\necho 2\n");
    }

    #[test]
    fn a_link_in_the_way_is_refused_and_what_it_points_at_is_untouched() {
        let folder = tempfile::tempdir().unwrap();
        let elsewhere = folder.path().join("somebody-elses-file");
        fs::write(&elsewhere, b"theirs").unwrap();
        let destination = folder.path().join("uwunotes");
        std::os::unix::fs::symlink(&elsewhere, &destination).unwrap();

        assert!(write_atomically(&destination, b"ours", EXECUTABLE).is_err());
        assert!(copy_atomically(&elsewhere, &destination, EXECUTABLE).is_err());
        assert_eq!(fs::read(&elsewhere).unwrap(), b"theirs");
        assert!(is_symlink(&destination), "and the link itself stays too");
    }

    #[test]
    fn the_setups_own_link_is_made_kept_and_removed_but_nobody_elses() {
        let folder = tempfile::tempdir().unwrap();
        let target = folder.path().join("share/uwunotes/uwunotes");
        let link = folder.path().join("bin/uwunotes");

        assert!(
            link_if_free(&link, &target).unwrap(),
            "made, folder and all"
        );
        assert!(is_link_to(&link, &target));
        assert!(link_if_free(&link, &target).unwrap(), "and kept on a rerun");

        let other = folder.path().join("bin/other");
        fs::write(&other, b"#!/bin/sh\n").unwrap();
        assert!(
            !link_if_free(&other, &target).unwrap(),
            "a name that is taken"
        );
        assert_eq!(fs::read(&other).unwrap(), b"#!/bin/sh\n");

        remove_link_to(&other, &target);
        assert!(other.exists(), "not the setup's link, so not removed");
        remove_link_to(&link, &target);
        assert!(!is_symlink(&link));
    }

    #[test]
    fn removing_a_file_leaves_links_and_folders_alone() {
        let folder = tempfile::tempdir().unwrap();
        let file = folder.path().join("file");
        fs::write(&file, b"x").unwrap();
        let link = folder.path().join("link");
        std::os::unix::fs::symlink(&file, &link).unwrap();

        assert!(!remove_file(&link).unwrap());
        assert!(!remove_file(folder.path()).unwrap());
        assert!(!remove_file(&folder.path().join("missing")).unwrap());
        assert!(remove_file(&file).unwrap());
        assert!(!file.exists());
    }

    #[test]
    fn deleting_data_removes_a_link_but_not_what_it_points_at() {
        let folder = tempfile::tempdir().unwrap();
        let real = folder.path().join("real");
        fs::create_dir_all(real.join("drafts")).unwrap();
        let data = folder.path().join("app.uwunotes.desktop");
        std::os::unix::fs::symlink(&real, &data).unwrap();

        remove_data(&data).unwrap();
        assert!(!is_symlink(&data));
        assert!(real.join("drafts").exists());

        remove_data(&real).unwrap();
        assert!(!real.exists());
        remove_data(&real).expect("and nothing there is not an error");
    }

    #[test]
    fn the_record_reads_back_what_was_written_and_nothing_else() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("setup.json");
        assert_eq!(Record::read(&path), None);

        let record = Record {
            version: Some("0.3.1".into()),
            desktop_shortcut: true,
        };
        record.write(&path).unwrap();
        assert_eq!(Record::read(&path), Some(record));

        fs::write(&path, b"not json").unwrap();
        assert_eq!(Record::read(&path), None);
        fs::write(&path, br#"{"version":"0.3.0"}"#).unwrap();
        assert_eq!(
            Record::read(&path).map(|record| record.desktop_shortcut),
            Some(false),
            "an older record without the field reads as no shortcut"
        );
    }

    #[test]
    fn only_the_folder_this_system_installs_to_is_accepted() {
        let expected = Path::new("/home/nyu/.local/share/uwunotes");
        let options = |folder: &str| Options {
            folder: folder.to_owned(),
            desktop_shortcut: false,
            launch_when_done: false,
        };
        assert_eq!(
            the_folder(&options("/home/nyu/.local/share/uwunotes/"), expected).unwrap(),
            expected
        );
        for other in ["", "/tmp/uwunotes", "uwunotes", "/"] {
            assert!(the_folder(&options(other), expected).is_err(), "{other}");
        }
        assert!(
            the_folder(&options(""), Path::new("")).is_err(),
            "no home folder, no install"
        );
    }
}
