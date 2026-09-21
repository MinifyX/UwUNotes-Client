//! Packs the built editor into the setup executable.
//!
//! `UWUNOTES_SETUP_PAYLOAD` points at what the editor build left behind;
//! `pnpm build:setup` sets it after building the editor. Two shapes:
//!
//! - **a file** — `UwUNotes.exe` on Windows, the `uwunotes-desktop` binary on
//!   Linux — is packed as it is;
//! - **a folder** — `UwUNotes.app` on macOS, which is a folder with an
//!   executable in it — is packed as a tar archive first, under its own name,
//!   so the executable bit and the layout inside the bundle survive the trip.
//!
//! Both are then compressed with zstd. The setup is told which shape it
//! carries, and how many bytes come out of the decompressor: that number is the
//! progress bar's denominator, and the check that what came out is all of it.
//!
//! Without the variable the setup still builds, with nothing inside — which is
//! what `cargo check`, `cargo clippy` and the tests run against, and what
//! anyone working on the setup's page uses.

use std::path::{Path, PathBuf};

/// zstd at its highest level. It runs once per release build, and buys a
/// smaller download for everybody who ever installs UwUNotes.
const LEVEL: i32 = 19;

/// A folder as one tar stream, with the bundle's own name at the top.
///
/// Deterministic headers: no owner, no user name, one fixed timestamp, and a
/// mode of 0755 or 0644 by whether the file was executable. Nothing about the
/// build machine ends up in the download, two builds of the same bundle pack to
/// the same bytes, and the one permission that matters is kept. Links stay
/// links rather than becoming copies of what they point at — a framework inside
/// a bundle is made of them.
fn tar_folder(folder: &Path) -> Vec<u8> {
    let name = folder
        .file_name()
        .unwrap_or_else(|| panic!("{} has no name to pack it under", folder.display()));
    let mut builder = tar::Builder::new(Vec::new());
    builder.mode(tar::HeaderMode::Deterministic);
    builder.follow_symlinks(false);
    builder
        .append_dir_all(name, folder)
        .unwrap_or_else(|error| panic!("can't pack {}: {error}", folder.display()));
    builder.into_inner().expect("finishing the archive")
}

fn main() {
    println!("cargo:rerun-if-env-changed=UWUNOTES_SETUP_PAYLOAD");
    let out = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR is set")).join("payload.zst");

    match std::env::var_os("UWUNOTES_SETUP_PAYLOAD").filter(|path| !path.is_empty()) {
        Some(path) => {
            let path = Path::new(&path);
            // For a folder, Cargo watches everything inside it.
            println!("cargo:rerun-if-changed={}", path.display());
            let (editor, kind) = if path.is_dir() {
                (tar_folder(path), "tree")
            } else {
                let editor = std::fs::read(path)
                    .unwrap_or_else(|error| panic!("can't read {}: {error}", path.display()));
                (editor, "file")
            };
            let packed = zstd::encode_all(editor.as_slice(), LEVEL).expect("packing the editor");
            std::fs::write(&out, packed).expect("writing the payload");
            println!(
                "cargo:rustc-env=UWUNOTES_SETUP_PAYLOAD_SIZE={}",
                editor.len()
            );
            println!("cargo:rustc-env=UWUNOTES_SETUP_PAYLOAD_KIND={kind}");
        }
        None => {
            std::fs::write(&out, []).expect("writing the empty payload");
            println!("cargo:rustc-env=UWUNOTES_SETUP_PAYLOAD_SIZE=0");
            // What this system would carry, so an empty build is labelled the
            // way a real one for the same system would be.
            let kind = if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
                "tree"
            } else {
                "file"
            };
            println!("cargo:rustc-env=UWUNOTES_SETUP_PAYLOAD_KIND={kind}");
        }
    }

    // A setup runs from wherever it was downloaded to, next to whatever else
    // was downloaded there: linked DLLs come from System32 only, never from
    // that folder. The runtime half of the same rule is in `system/windows.rs`.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        println!("cargo:rustc-link-arg-bins=/DEPENDENTLOADFLAG:0x800");
    }

    tauri_build::build()
}
