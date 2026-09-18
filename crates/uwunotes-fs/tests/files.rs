//! Reading, saving and replacing, against real files on a real disk.
//!
//! Everything in `encoding.rs` works on byte slices so a failure is never about
//! the filesystem. These are the opposite: the whole point of each one is what
//! the filesystem does — whether a link survives a save, whether a file that is
//! not a file blocks a read, whether the bytes nobody asked about came back
//! unchanged.
//!
//! Every test cleans up after itself, and every one that needs a privilege
//! Windows does not hand out by default (creating a symlink) says so and skips
//! rather than failing on a machine that has not turned Developer Mode on.

use std::collections::hash_map::RandomState;
use std::fs;
use std::hash::{BuildHasher as _, Hasher as _};
use std::path::{Path, PathBuf};

use uwunotes_fs::{
    read_file, replace_in_files, write_file, Eol, FsError, ReplaceRequest, SearchRequest,
};

/// A directory of its own, removed when the test drops it.
struct Scratch(PathBuf);

impl Scratch {
    fn new() -> Self {
        let mut hasher = RandomState::new().build_hasher();
        hasher.write_u32(std::process::id());
        hasher.write_u128(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |since| since.as_nanos()),
        );
        let directory =
            std::env::temp_dir().join(format!("uwunotes-test-{:016x}", hasher.finish()));
        fs::create_dir_all(&directory).expect("a scratch directory");
        Self(directory)
    }

    fn join(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn save(path: &Path, text: &str, encoding: &str, eol: Eol) -> Result<(), FsError> {
    write_file(path, text, encoding, false, eol, None, false).map(|_| ())
}

fn replace(
    files: &[&Path],
    query: &str,
    replacement: &str,
    regex: bool,
) -> uwunotes_fs::ReplaceSummary {
    replace_in_files(&ReplaceRequest {
        query: query.to_owned(),
        regex,
        case_sensitive: true,
        whole_word: false,
        replacement: replacement.to_owned(),
        files: files
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect(),
    })
    .expect("a compilable pattern")
}

/* ── Saving ────────────────────────────────────────────── */

#[test]
fn saving_through_a_hard_link_writes_the_file_both_names_share() {
    let scratch = Scratch::new();
    let real = scratch.join("real.txt");
    let link = scratch.join("link.txt");
    fs::write(&real, "original\n").unwrap();
    if fs::hard_link(&real, &link).is_err() {
        eprintln!("skipped: this filesystem will not make a hard link");
        return;
    }

    save(&link, "edited\n", "UTF-8", Eol::Lf).expect("the save");

    // A rename would have replaced the *name*: `link.txt` would hold the new
    // text as an independent file and `real.txt` would still say "original".
    assert_eq!(fs::read_to_string(&link).unwrap(), "edited\n");
    assert_eq!(
        fs::read_to_string(&real).unwrap(),
        "edited\n",
        "the other name for the same file kept the old text"
    );
}

#[test]
fn saving_through_a_symlink_writes_what_it_points_at() {
    let scratch = Scratch::new();
    let real = scratch.join("real.txt");
    let link = scratch.join("link.txt");
    fs::write(&real, "original\n").unwrap();

    #[cfg(windows)]
    let made = std::os::windows::fs::symlink_file(&real, &link).is_ok();
    #[cfg(unix)]
    let made = std::os::unix::fs::symlink(&real, &link).is_ok();
    #[cfg(not(any(windows, unix)))]
    let made = false;
    if !made {
        eprintln!("skipped: no privilege to create a symlink here");
        return;
    }

    save(&link, "edited\n", "UTF-8", Eol::Lf).expect("the save");

    assert_eq!(fs::read_to_string(&real).unwrap(), "edited\n");
    assert!(
        fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink(),
        "the link was replaced by an ordinary file"
    );
}

#[test]
fn a_save_leaves_no_temporary_file_behind() {
    let scratch = Scratch::new();
    let file = scratch.join("notes.txt");

    save(&file, "erste Zeile\n", "UTF-8", Eol::Crlf).expect("a first save");
    save(&file, "zweite Zeile\n", "UTF-8", Eol::Crlf).expect("a second save");

    let left: Vec<String> = fs::read_dir(&scratch.0)
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name != "notes.txt")
        .collect();
    assert!(left.is_empty(), "{left:?}");
    assert_eq!(fs::read(&file).unwrap(), b"zweite Zeile\r\n");
}

#[test]
fn a_character_the_encoding_cannot_hold_refuses_the_save() {
    let scratch = Scratch::new();
    let file = scratch.join("legacy.txt");
    fs::write(&file, b"Gr\xfc\xdfe\n").unwrap();

    let refused = save(&file, "Grüße → 😀\n", "windows-1252", Eol::Lf)
        .expect_err("windows-1252 has no arrow and no emoji");
    assert_eq!(refused.kind(), "unmappable");
    assert_eq!(
        fs::read(&file).unwrap(),
        b"Gr\xfc\xdfe\n",
        "a refused save must leave the file alone"
    );

    // Having been asked, the user is allowed to say yes.
    write_file(
        &file,
        "Grüße →\n",
        "windows-1252",
        false,
        Eol::Lf,
        None,
        true,
    )
    .expect("the save the user authorised");
    assert_eq!(
        fs::read(&file).unwrap(),
        b"Gr\xfc\xdfe \x26\x23\x38\x35\x39\x34\x3b\n"
    );
}

#[test]
fn everything_utf8_can_say_still_saves() {
    let scratch = Scratch::new();
    let file = scratch.join("unicode.txt");
    save(&file, "Grüße → 😀\n", "UTF-8", Eol::Lf).expect("UTF-8 holds everything");
    assert_eq!(fs::read_to_string(&file).unwrap(), "Grüße → 😀\n");
}

/* ── Reading ───────────────────────────────────────────── */

#[test]
#[cfg(windows)]
fn a_named_pipe_is_refused_instead_of_read() {
    // `fs::metadata` says a pipe is a file with a length of zero, so every
    // check a size-based guard could make passes — and then the read blocks
    // until the server on the other end answers, which may be never. A path
    // like this reaches `read_file` from a hand-edited session file.
    let Ok(pipes) = fs::read_dir(r"\\.\pipe\") else {
        eprintln!("skipped: the pipe namespace would not list");
        return;
    };

    // Some pipes will not open at all — busy, or the server refuses us — and
    // those are safe for a duller reason. What has to be shown is that one we
    // *can* open is still turned away, which is the part `is_file` would have
    // got wrong.
    let mut named_as_such = 0;
    let mut tried = 0;
    for entry in pipes.filter_map(Result::ok).take(40) {
        let pipe = entry.path();
        tried += 1;
        let refused = read_file(&pipe, None).expect_err("a pipe is not a document");
        if refused.kind() == "notAFile" {
            named_as_such += 1;
        }
    }

    assert!(tried > 0, "no named pipes on this machine to try");
    assert!(
        named_as_such > 0,
        "{tried} pipes tried and none was recognised as not a file"
    );
}

#[test]
fn a_folder_is_named_as_a_folder() {
    // `File::open` on a directory fails with "access denied" on Windows, so
    // the kind has to be settled before the handle is asked for.
    let scratch = Scratch::new();
    let refused = read_file(&scratch.0, None).expect_err("a folder is not a document");
    assert_eq!(refused.kind(), "isDirectory");
}

#[test]
fn an_ordinary_file_still_reads() {
    let scratch = Scratch::new();
    let file = scratch.join("hello.txt");
    fs::write(&file, "Grüße\r\nWelt\r\n").unwrap();

    let loaded = read_file(&file, None).expect("a plain UTF-8 file");
    assert_eq!(loaded.text, "Grüße\nWelt\n");
    assert_eq!(loaded.eol, Eol::Crlf);
    assert!(!loaded.lossy);
}

/* ── Replacing in files ────────────────────────────────── */

#[test]
fn a_replace_changes_the_matched_span_and_nothing_else() {
    let scratch = Scratch::new();
    let file = scratch.join("mixed.txt");
    // CRLF in the majority, two LF lines, and a bare `\r` inside a line — the
    // sort of file a build log or an old Mac document really is.
    fs::write(
        &file,
        "alpha\r\nbeta\r\nfoo\r\ngamma\ndelta\nprogress\rdone\n",
    )
    .unwrap();

    let summary = replace(&[&file], "foo", "FOO", false);
    assert_eq!(summary.replacements, 1);
    assert!(summary.failed.is_empty(), "{:?}", summary.failed);

    assert_eq!(
        fs::read_to_string(&file).unwrap(),
        "alpha\r\nbeta\r\nFOO\r\ngamma\ndelta\nprogress\rdone\n",
        "one word was asked for; the line endings are not ours to change"
    );
}

#[test]
fn an_anchored_pattern_means_the_same_thing_to_search_and_to_replace() {
    let scratch = Scratch::new();
    let file = scratch.join("anchored.txt");
    fs::write(&file, "foo one\nfoo two\nfoo three\n").unwrap();

    let found = search_count(&scratch.0, "^foo");
    let summary = replace(&[&file], "^foo", "BAR", true);

    assert_eq!(found, 3, "the panel counts per line");
    assert_eq!(
        summary.replacements, found,
        "the dialog quotes the search's number for an operation that cannot be undone"
    );
    assert_eq!(
        fs::read_to_string(&file).unwrap(),
        "BAR one\nBAR two\nBAR three\n"
    );
}

#[test]
fn an_end_anchor_replaces_rather_than_doing_nothing() {
    let scratch = Scratch::new();
    let file = scratch.join("ends.txt");
    fs::write(&file, "alpha;\r\nbeta;\r\ngamma;\r\n").unwrap();

    let summary = replace(&[&file], ";$", "!", true);

    assert_eq!(summary.replacements, 3);
    assert_eq!(
        fs::read_to_string(&file).unwrap(),
        "alpha!\r\nbeta!\r\ngamma!\r\n",
        "`$` must sit before the line's own ending, not eat it"
    );
}

#[test]
fn a_file_that_did_not_decode_cleanly_is_left_alone() {
    let scratch = Scratch::new();
    let file = scratch.join("broken.txt");
    // UTF-8 with a byte order mark and one stray Latin-1 byte in it: the
    // everyday residue of a bad conversion. Decoding turns the stray byte into
    // U+FFFD, and writing that back would make the damage permanent.
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(b"needle\n\xfc\ntail\n");
    fs::write(&file, &bytes).unwrap();

    let summary = replace(&[&file], "needle", "NEEDLE", false);

    assert_eq!(summary.replacements, 0);
    assert_eq!(
        summary.failed.len(),
        1,
        "the user has to be told which files were skipped"
    );
    assert_eq!(fs::read(&file).unwrap(), bytes);
}

#[test]
fn a_replacement_the_code_page_cannot_hold_is_refused_per_file() {
    let scratch = Scratch::new();
    let legacy = scratch.join("legacy.txt");
    let plain = scratch.join("plain.txt");
    fs::write(&legacy, b"Gr\xfc\xdfe -> Welt\n").unwrap();
    fs::write(&plain, "hier -> dort\n").unwrap();

    let summary = replace(&[&legacy, &plain], "->", "→", false);

    assert_eq!(
        fs::read(&legacy).unwrap(),
        b"Gr\xfc\xdfe -> Welt\n",
        "an arrow windows-1252 cannot write must not become `&#8594;`"
    );
    assert_eq!(summary.failed.len(), 1);
    // The file that could take it is still replaced: one bad file does not cost
    // the user the other thirty-nine.
    assert_eq!(fs::read_to_string(&plain).unwrap(), "hier → dort\n");
    assert_eq!(summary.replacements, 1);
}

/// How many matches a real search reports under `root`, which is the number the
/// confirmation dialog quotes.
fn search_count(root: &Path, query: &str) -> usize {
    let cancelled = std::sync::atomic::AtomicBool::new(false);
    uwunotes_fs::search(
        &SearchRequest {
            id: "test".to_owned(),
            query: query.to_owned(),
            regex: true,
            case_sensitive: true,
            whole_word: false,
            root: root.to_string_lossy().into_owned(),
            include: String::new(),
            exclude: String::new(),
            respect_ignore_files: false,
            include_hidden: true,
            max_matches: 5_000,
            max_file_size: 4_000_000,
        },
        |_, _| {},
        &cancelled,
    )
    .expect("a compilable pattern")
    .matches
}
