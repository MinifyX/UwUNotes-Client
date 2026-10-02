//! The store against a real directory, with a clock the tests move by hand.
//!
//! Every test gets its own temporary directory and its own clock, so they run
//! in parallel and none of them waits for time to pass.

use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use uwunotes_history::{
    HistoryKey, HistoryStore, Limits, Reason, SnapshotOutcome, Version, DAY_MS, HOUR_MS,
};

/// 2026-10-02, give or take: any fixed moment will do.
const START: i64 = 1_790_000_000_000;

struct Fixture {
    _dir: tempfile::TempDir,
    root: std::path::PathBuf,
    clock: Arc<AtomicI64>,
    store: HistoryStore,
}

impl Fixture {
    fn new() -> Self {
        Self::with_limits(Limits::default())
    }

    fn with_limits(limits: Limits) -> Self {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let root = dir.path().join("history");
        let clock = Arc::new(AtomicI64::new(START));
        let ticking = Arc::clone(&clock);
        let store = HistoryStore::with_clock(&root, move || ticking.load(Ordering::SeqCst))
            .with_limits(limits);
        Self {
            _dir: dir,
            root,
            clock,
            store,
        }
    }

    fn advance(&self, ms: i64) {
        self.clock.fetch_add(ms, Ordering::SeqCst);
    }

    fn snap(&self, key: &HistoryKey, text: &str) -> SnapshotOutcome {
        self.store
            .snapshot(key, text, Reason::Auto, 30)
            .expect("a snapshot")
    }

    fn key_dir(&self, key: &HistoryKey) -> std::path::PathBuf {
        self.root.join(key.directory_name())
    }
}

fn created(outcome: SnapshotOutcome) -> Version {
    match outcome {
        SnapshotOutcome::Created { version } => version,
        other => panic!("expected a new version, got {other:?}"),
    }
}

fn file_key() -> HistoryKey {
    HistoryKey::path("/home/mini/notes.md")
}

#[test]
fn a_version_reads_back_exactly() {
    let fx = Fixture::new();
    let text = "Grüße\nmit Umlauten ✨\n";
    let version = created(
        fx.store
            .snapshot(&file_key(), text, Reason::Save, 30)
            .unwrap(),
    );

    assert_eq!(version.reason, Reason::Save);
    assert_eq!(version.size, text.len() as u64);
    assert_eq!(version.lines, 3);
    assert_eq!(version.time, START);
    assert_eq!(fx.store.read(&file_key(), &version.id).unwrap(), text);
    assert_eq!(fx.store.list(&file_key()).unwrap(), vec![version]);
}

#[test]
fn the_same_text_twice_is_one_version() {
    let fx = Fixture::new();
    created(fx.snap(&file_key(), "one"));
    fx.advance(60_000);
    assert!(matches!(
        fx.snap(&file_key(), "one"),
        SnapshotOutcome::Unchanged { .. }
    ));
    // Back to an earlier text is a change, though: only the newest counts.
    created(fx.snap(&file_key(), "two"));
    created(fx.snap(&file_key(), "one"));
    assert_eq!(fx.store.list(&file_key()).unwrap().len(), 3);
}

#[test]
fn the_list_is_newest_first_with_unique_ids() {
    let fx = Fixture::new();
    // Same moment, so the ids have to tell themselves apart some other way.
    for text in ["a", "b", "a", "b"] {
        created(fx.snap(&file_key(), text));
    }
    let list = fx.store.list(&file_key()).unwrap();
    assert_eq!(list.len(), 4);
    let mut ids: Vec<_> = list.iter().map(|version| version.id.clone()).collect();
    ids.dedup();
    assert_eq!(ids.len(), 4);
    assert_eq!(fx.store.read(&file_key(), &list[0].id).unwrap(), "b");
}

#[test]
fn a_text_over_the_limit_gets_no_version() {
    let fx = Fixture::with_limits(Limits {
        max_text_bytes: 10,
        ..Limits::default()
    });
    assert_eq!(
        fx.snap(&file_key(), "far more than ten bytes"),
        SnapshotOutcome::Skipped
    );
    assert!(fx.store.list(&file_key()).unwrap().is_empty());
}

#[test]
fn old_versions_thin_out_as_time_passes() {
    let fx = Fixture::new();
    // One version every ten minutes for three days.
    for step in 0..(3 * 24 * 6) {
        created(fx.snap(&file_key(), &format!("version {step}")));
        fx.advance(10 * 60_000);
    }
    let list = fx.store.list(&file_key()).unwrap();
    // The last hour in full (6), one per hour for the rest of the day (23),
    // and one per day before that (2 or 3, depending on where midnight fell).
    assert!(
        (30..=33).contains(&list.len()),
        "{} versions kept",
        list.len()
    );
    // And nothing on disk that the index does not name.
    let files = fs::read_dir(fx.key_dir(&file_key()))
        .unwrap()
        .filter(|entry| {
            entry
                .as_ref()
                .unwrap()
                .file_name()
                .to_string_lossy()
                .ends_with(".zst")
        })
        .count();
    assert_eq!(files, list.len());
}

#[test]
fn the_ceiling_per_history_holds() {
    let fx = Fixture::with_limits(Limits {
        max_versions: 5,
        ..Limits::default()
    });
    for step in 0..12 {
        created(fx.snap(&file_key(), &format!("v{step}")));
    }
    let list = fx.store.list(&file_key()).unwrap();
    assert_eq!(list.len(), 5);
    assert_eq!(fx.store.read(&file_key(), &list[0].id).unwrap(), "v11");
}

#[test]
fn the_total_cap_takes_the_oldest_but_never_the_newest_of_a_file() {
    let fx = Fixture::with_limits(Limits {
        max_total_bytes: 1,
        ..Limits::default()
    });
    let other = HistoryKey::path("/home/mini/other.md");
    for step in 0..5 {
        created(fx.snap(&file_key(), &format!("file {step}")));
        created(fx.snap(&other, &format!("other {step}")));
        fx.advance(1_000);
    }
    let stats = fx.store.maintain(30).unwrap();

    assert_eq!(stats.histories, 2);
    assert_eq!(stats.versions, 2, "only each history's newest is left");
    let newest = &fx.store.list(&file_key()).unwrap()[0];
    assert_eq!(fx.store.read(&file_key(), &newest.id).unwrap(), "file 4");
}

#[test]
fn maintain_applies_a_shorter_retention_to_quiet_histories() {
    let fx = Fixture::new();
    for day in 0..10 {
        created(fx.snap(&file_key(), &format!("day {day}")));
        fx.advance(DAY_MS);
    }
    assert_eq!(fx.store.list(&file_key()).unwrap().len(), 10);
    fx.store.maintain(3).unwrap();
    // Ten days ago through one day ago; three days of daily versions survive.
    let left = fx.store.list(&file_key()).unwrap();
    assert!(left.len() <= 3, "{} left", left.len());
    assert!(!left.is_empty());
}

#[test]
fn a_garbled_index_is_an_empty_history_and_its_files_stay() {
    let fx = Fixture::new();
    let version = created(fx.snap(&file_key(), "precious"));
    let dir = fx.key_dir(&file_key());
    fs::write(dir.join("index.json"), b"{ \"version\": 1, \"entr").unwrap();

    assert!(fx.store.list(&file_key()).unwrap().is_empty());
    created(fx.snap(&file_key(), "new text"));
    // The old file is not named by anything any more, but the index that named
    // it was unreadable — so it is kept for whoever goes looking.
    assert!(dir.join(format!("{}.zst", version.id)).exists());
}

#[test]
fn bad_entries_are_skipped_one_by_one() {
    let fx = Fixture::new();
    let good = created(fx.snap(&file_key(), "good"));
    let dir = fx.key_dir(&file_key());
    let index = serde_json::json!({
        "version": 1,
        "entries": [
            serde_json::to_value(&good).unwrap(),
            { "id": "../../escape", "time": 1, "reason": "save", "size": 1, "lines": 1,
              "hash": good.hash },
            { "id": "0001-abc", "time": 1, "reason": "teleport", "size": 1, "lines": 1,
              "hash": good.hash },
            { "id": "0002-abc", "time": -5, "reason": "save", "size": 1, "lines": 1,
              "hash": good.hash },
            { "id": "0003-abc", "time": 5, "reason": "save", "size": 1, "lines": 1,
              "hash": "not-a-hash" },
            "just a string",
            serde_json::to_value(&good).unwrap(),
        ]
    });
    fs::write(dir.join("index.json"), index.to_string()).unwrap();

    assert_eq!(fx.store.list(&file_key()).unwrap(), vec![good]);
}

#[test]
fn an_index_from_a_newer_build_is_not_overwritten() {
    let fx = Fixture::new();
    created(fx.snap(&file_key(), "text"));
    let path = fx.key_dir(&file_key()).join("index.json");
    let future = r#"{ "version": 99, "entries": [] }"#;
    fs::write(&path, future).unwrap();

    assert!(fx.store.list(&file_key()).is_err());
    assert!(fx
        .store
        .snapshot(&file_key(), "more", Reason::Auto, 30)
        .is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), future);
}

#[test]
fn a_swapped_version_file_does_not_read_as_the_version() {
    let fx = Fixture::new();
    let version = created(fx.snap(&file_key(), "the real text"));
    let blob = fx.key_dir(&file_key()).join(format!("{}.zst", version.id));
    fs::write(&blob, zstd::encode_all(&b"something else"[..], 3).unwrap()).unwrap();
    assert!(fx.store.read(&file_key(), &version.id).is_err());

    fs::write(&blob, b"not zstd at all").unwrap();
    assert!(fx.store.read(&file_key(), &version.id).is_err());
}

#[test]
fn reading_by_a_traversing_id_is_refused() {
    let fx = Fixture::new();
    created(fx.snap(&file_key(), "text"));
    assert!(fx.store.read(&file_key(), "../index").is_err());
    assert!(fx.store.read(&file_key(), "0000-ffff").is_err());
}

#[test]
fn a_traversing_note_id_never_reaches_the_disk() {
    let fx = Fixture::new();
    let evil = HistoryKey::note("../../evil");
    assert!(fx.store.snapshot(&evil, "x", Reason::Auto, 30).is_err());
    assert!(!fx.root.exists());
}

#[test]
fn a_note_saved_to_a_file_takes_its_history_along() {
    let fx = Fixture::new();
    let note = HistoryKey::note("doc-1-0-abc");
    created(fx.snap(&note, "draft one"));
    fx.advance(HOUR_MS);
    created(fx.snap(&note, "draft two"));
    // The file already had a version of its own, from before.
    created(fx.snap(&file_key(), "file text"));

    fx.store.move_history(&note, &file_key(), 30).unwrap();

    assert!(fx.store.list(&note).unwrap().is_empty());
    assert!(!fx.key_dir(&note).exists());
    let list = fx.store.list(&file_key()).unwrap();
    assert_eq!(list.len(), 3);
    for version in &list {
        fx.store.read(&file_key(), &version.id).unwrap();
    }
}

#[test]
fn delete_and_clear() {
    let fx = Fixture::new();
    let first = created(fx.snap(&file_key(), "one"));
    created(fx.snap(&file_key(), "two"));

    fx.store.delete(&file_key(), &first.id).unwrap();
    fx.store.delete(&file_key(), &first.id).unwrap();
    assert_eq!(fx.store.list(&file_key()).unwrap().len(), 1);
    assert!(!fx
        .key_dir(&file_key())
        .join(format!("{}.zst", first.id))
        .exists());

    fx.store.clear(&file_key()).unwrap();
    fx.store.clear(&file_key()).unwrap();
    assert!(fx.store.list(&file_key()).unwrap().is_empty());
    assert!(!fx.key_dir(&file_key()).exists());
}

#[test]
fn a_closed_file_is_read_from_disk_before_it_is_rewritten() {
    let fx = Fixture::new();
    let dir = tempfile::tempdir().unwrap();
    let text_file = dir.path().join("a.txt");
    fs::write(&text_file, "line one\r\nline two\r\n").unwrap();
    let binary = dir.path().join("b.bin");
    fs::write(&binary, [0u8, 1, 2, 0, 0, 0, 3]).unwrap();
    let missing = dir.path().join("gone.txt");

    let paths: Vec<String> = [&text_file, &binary, &missing]
        .iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        fx.store.snapshot_files(&paths, Reason::BeforeReplace, 30),
        1
    );

    let key = HistoryKey::path(paths[0].clone());
    let list = fx.store.list(&key).unwrap();
    assert_eq!(list[0].reason, Reason::BeforeReplace);
    // The editor's text, line endings and all: `\n`, as it would be in a tab.
    assert_eq!(
        fx.store.read(&key, &list[0].id).unwrap(),
        "line one\nline two\n"
    );
    assert!(fx
        .store
        .list(&HistoryKey::path(paths[1].clone()))
        .unwrap()
        .is_empty());
}

#[test]
fn parallel_snapshots_of_one_file_all_land() {
    let fx = Arc::new(Fixture::new());
    let threads: Vec<_> = (0..8)
        .map(|n| {
            let fx = Arc::clone(&fx);
            std::thread::spawn(move || {
                created(fx.snap(&file_key(), &format!("thread {n}")));
            })
        })
        .collect();
    for thread in threads {
        thread.join().unwrap();
    }
    assert_eq!(fx.store.list(&file_key()).unwrap().len(), 8);
}

#[test]
fn foreign_things_in_the_history_folder_are_left_alone() {
    let fx = Fixture::new();
    created(fx.snap(&file_key(), "text"));
    let stray = fx.root.join("not-ours");
    fs::create_dir_all(&stray).unwrap();
    fs::write(stray.join("keep.txt"), "mine").unwrap();
    let stray_in_history = fx.key_dir(&file_key()).join("notes.zst");
    fs::write(&stray_in_history, "also mine").unwrap();

    fx.store.maintain(30).unwrap();
    created(fx.snap(&file_key(), "more"));

    assert!(Path::new(&stray.join("keep.txt")).exists());
    assert!(stray_in_history.exists());
}
