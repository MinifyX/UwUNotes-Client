//! Packs the built editor into the setup executable.
//!
//! `UWUNOTES_SETUP_PAYLOAD` points at `UwUNotes.exe`; `pnpm build:setup` sets
//! it after building the editor. Without it the setup still builds, with
//! nothing inside — which is what `cargo check`, `cargo clippy` and the tests
//! run against, and what anyone working on the setup's page uses.

use std::path::{Path, PathBuf};

/// zstd at its highest level. It runs once per release build, and buys a
/// smaller download for everybody who ever installs UwUNotes.
const LEVEL: i32 = 19;

fn main() {
    println!("cargo:rerun-if-env-changed=UWUNOTES_SETUP_PAYLOAD");
    let out = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR is set")).join("payload.zst");

    match std::env::var_os("UWUNOTES_SETUP_PAYLOAD").filter(|path| !path.is_empty()) {
        Some(path) => {
            let path = Path::new(&path);
            println!("cargo:rerun-if-changed={}", path.display());
            let editor = std::fs::read(path)
                .unwrap_or_else(|error| panic!("can't read {}: {error}", path.display()));
            let packed = zstd::encode_all(editor.as_slice(), LEVEL).expect("packing the editor");
            std::fs::write(&out, packed).expect("writing the payload");
            // The unpacked size is the progress bar's denominator, and the
            // check that what came out is all of it.
            println!(
                "cargo:rustc-env=UWUNOTES_SETUP_PAYLOAD_SIZE={}",
                editor.len()
            );
        }
        None => {
            std::fs::write(&out, []).expect("writing the empty payload");
            println!("cargo:rustc-env=UWUNOTES_SETUP_PAYLOAD_SIZE=0");
        }
    }

    // A setup runs from wherever it was downloaded to, next to whatever else
    // was downloaded there: linked DLLs come from System32 only, never from
    // that folder. The runtime half of the same rule is in `system.rs`.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        println!("cargo:rustc-link-arg-bins=/DEPENDENTLOADFLAG:0x800");
    }

    tauri_build::build()
}
