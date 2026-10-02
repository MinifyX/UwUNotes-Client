//! The versions on disk.
//!
//! One directory per history, named after the hash of its key, holding an
//! `index.json` and one zstd-compressed file per version:
//!
//! ```text
//! history/
//!   3f0a…/index.json
//!   3f0a…/0001759400000000-9c1d2e3f4a5b.zst
//! ```
//!
//! A version's file is written before the index that names it, and both
//! atomically, so a crash leaves at worst a file nobody names — never an index
//! pointing at half a file. Files nobody names are swept up the next time that
//! history is written, but only when its index read cleanly: an index that
//! would not parse may have been the only thing naming them, and the bytes are
//! worth more than the disk space.
//!
//! The index is the user's JSON on the user's disk and is read like it: a size
//! cap before parsing, every entry checked on its own, and an entry that fails
//! any check is skipped rather than failing the history around it.
//!
//! One lock for the whole store. Snapshots arrive a few per minute at most, so
//! the lock costs nothing, and without it two blocking threads writing one
//! index would each drop the other's version.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use uwunotes_fs::{hash_text, read_file, write_atomic, FsError, FsResult, HashAlgorithm};

use crate::key::{is_directory_name, HistoryKey};
use crate::retention::{self, Policy};

const INDEX_FILE: &str = "index.json";
const BLOB_EXTENSION: &str = "zst";
const INDEX_VERSION: u32 = 1;

/// A hundred entries are about twenty kilobytes. Past this the file is not an
/// index any more, and parsing it is not worth the time.
const MAX_INDEX_BYTES: u64 = 4 * 1024 * 1024;

/// zstd's default. Higher levels buy a few percent on text and cost real time
/// on the five-megabyte file somebody has open.
const COMPRESSION_LEVEL: i32 = 3;

/// The total size is checked on the first snapshot of a run and then every this
/// many: walking every index on every snapshot would be the slowest thing here.
const CAP_CHECK_EVERY: u32 = 32;

/// Ten years. A setting past that is a typo, and an overflow in waiting.
const MAX_RETENTION_DAYS: u32 = 3_650;

/// Why a version was taken. The wire names match `HistoryReason` in `lib/api.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Reason {
    Save,
    Auto,
    BeforeReload,
    BeforeReplace,
    Restore,
    ExternalChange,
}

/// One version, as the index records it and the page lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Version {
    pub id: String,
    /// Milliseconds since the epoch.
    pub time: i64,
    pub reason: Reason,
    /// The text's UTF-8 length.
    pub size: u64,
    /// Counted the way the editor counts: an empty text is one line.
    pub lines: u64,
    /// SHA-256 of the text, lower-case hex. What "unchanged" is decided by.
    pub hash: String,
    /// Bytes on disk, compressed.
    #[serde(default)]
    pub stored_size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SnapshotOutcome {
    /// A new version was written.
    Created { version: Version },
    /// The text is the newest version already; nothing was written.
    Unchanged { version: Version },
    /// Too large to keep, or not cleanly text.
    Skipped,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryStats {
    pub histories: u64,
    pub versions: u64,
    /// Compressed bytes on disk.
    pub bytes: u64,
}

#[derive(Debug, Clone, Copy)]
pub struct Limits {
    /// A text longer than this gets no versions at all. A log file of fifty
    /// megabytes saved every minute would fill the cap in an afternoon.
    pub max_text_bytes: usize,
    /// Per history, after thinning.
    pub max_versions: usize,
    /// For the whole store; the oldest versions go first.
    pub max_total_bytes: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_text_bytes: 5 * 1024 * 1024,
            max_versions: 100,
            max_total_bytes: 200 * 1024 * 1024,
        }
    }
}

type Clock = Box<dyn Fn() -> i64 + Send + Sync>;

pub struct HistoryStore {
    directory: PathBuf,
    /// Injected so the tests can move time without sleeping.
    clock: Clock,
    limits: Limits,
    /// Held across every read and write. Counts snapshots, for the cap check.
    lock: Mutex<u32>,
}

/// What `index.json` holds. Entries stay raw JSON until each is checked alone.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexFile {
    version: u32,
    #[serde(default)]
    key: Option<HistoryKey>,
    #[serde(default)]
    entries: Vec<serde_json::Value>,
}

/// An index as this module works with it: entries oldest first.
#[derive(Default)]
struct Index {
    key: Option<HistoryKey>,
    entries: Vec<Version>,
    /// Read without a problem, or not there at all. Only then may files the
    /// index does not name be deleted.
    clean: bool,
}

impl HistoryStore {
    /// `directory` is the history root; nothing is created until a version is.
    pub fn new(directory: impl Into<PathBuf>) -> Self {
        Self::with_clock(directory, system_now)
    }

    pub fn with_clock(
        directory: impl Into<PathBuf>,
        clock: impl Fn() -> i64 + Send + Sync + 'static,
    ) -> Self {
        Self {
            directory: directory.into(),
            clock: Box::new(clock),
            limits: Limits::default(),
            lock: Mutex::new(0),
        }
    }

    #[must_use]
    pub fn with_limits(mut self, limits: Limits) -> Self {
        self.limits = limits;
        self
    }

    pub fn directory(&self) -> &Path {
        &self.directory
    }

    /// Keeps `text` as the newest version of `key`, unless it already is.
    ///
    /// Thins the history out afterwards by `retention_days`, so the history
    /// that just grew is also the one that gets pruned.
    pub fn snapshot(
        &self,
        key: &HistoryKey,
        text: &str,
        reason: Reason,
        retention_days: u32,
    ) -> FsResult<SnapshotOutcome> {
        key.validate()?;
        if text.len() > self.limits.max_text_bytes {
            return Ok(SnapshotOutcome::Skipped);
        }

        let mut snapshots = self.lock.lock().unwrap_or_else(PoisonError::into_inner);
        let directory = self.key_directory(key);
        let mut index = load_index(&directory)?;
        let hash = hash_text(text, HashAlgorithm::Sha256);
        if let Some(newest) = index.entries.last() {
            if newest.hash == hash {
                return Ok(SnapshotOutcome::Unchanged {
                    version: newest.clone(),
                });
            }
        }

        // Never before the newest version: a clock that jumped back would
        // otherwise slot this one into the middle, and "the newest version" —
        // what dedup and the timeline both lean on — would quietly stop being
        // the last one written.
        let now = (self.clock)();
        let time = index
            .entries
            .last()
            .map_or(now, |newest| now.max(newest.time));

        let compressed = zstd::encode_all(text.as_bytes(), COMPRESSION_LEVEL)
            .map_err(|error| FsError::other(None, format!("Could not compress: {error}")))?;
        let id = unique_id(&index, time, &hash);
        fs::create_dir_all(&directory).map_err(|error| FsError::from_io(&error, &directory))?;
        write_atomic(&directory.join(blob_name(&id)), &compressed)?;

        let version = Version {
            id,
            time,
            reason,
            size: text.len() as u64,
            lines: text.bytes().filter(|&b| b == b'\n').count() as u64 + 1,
            hash,
            stored_size: compressed.len() as u64,
        };
        index.entries.push(version.clone());
        index.key = Some(key.clone());
        self.thin(&mut index, retention_days, now);
        commit(&directory, &index)?;

        *snapshots = snapshots.wrapping_add(1);
        if *snapshots % CAP_CHECK_EVERY == 1 {
            if let Err(error) = self.enforce_total_cap() {
                // A store slightly over its cap is a few megabytes. Failing the
                // snapshot that was just written safely would lose a version.
                tracing::warn!(%error, "history size cap could not be enforced");
            }
        }
        Ok(SnapshotOutcome::Created { version })
    }

    /// Keeps what is on disk at `path` right now, before something rewrites it.
    ///
    /// For files no editor has open — "replace in files" touches those too. A
    /// file that is gone, too large, binary or would not decode cleanly is
    /// skipped: a version of replacement characters would restore as exactly
    /// the damage it was supposed to undo.
    pub fn snapshot_file(
        &self,
        path: &str,
        reason: Reason,
        retention_days: u32,
    ) -> FsResult<SnapshotOutcome> {
        let key = HistoryKey::path(path);
        key.validate()?;
        let file = match read_file(Path::new(path), None) {
            Ok(file) => file,
            Err(FsError::NotFound { .. } | FsError::TooLarge { .. }) => {
                return Ok(SnapshotOutcome::Skipped)
            }
            Err(error) => return Err(error),
        };
        if file.binary || file.lossy {
            return Ok(SnapshotOutcome::Skipped);
        }
        self.snapshot(&key, &file.text, reason, retention_days)
    }

    /// [`Self::snapshot_file`] for each path, carrying on past failures, which
    /// are logged. Returns how many new versions were written.
    pub fn snapshot_files(&self, paths: &[String], reason: Reason, retention_days: u32) -> usize {
        let mut created = 0;
        for path in paths {
            match self.snapshot_file(path, reason, retention_days) {
                Ok(SnapshotOutcome::Created { .. }) => created += 1,
                Ok(_) => {}
                Err(error) => tracing::warn!(%error, "no version kept before rewriting a file"),
            }
        }
        created
    }

    /// Every version of `key`, newest first. An unknown key has none.
    pub fn list(&self, key: &HistoryKey) -> FsResult<Vec<Version>> {
        key.validate()?;
        let _guard = self.lock.lock().unwrap_or_else(PoisonError::into_inner);
        let mut entries = load_index(&self.key_directory(key))?.entries;
        entries.reverse();
        Ok(entries)
    }

    /// The text of one version.
    pub fn read(&self, key: &HistoryKey, id: &str) -> FsResult<String> {
        key.validate()?;
        let directory = self.key_directory(key);
        if !is_version_id(id) {
            return Err(FsError::other(None, "Not a version id."));
        }
        let _guard = self.lock.lock().unwrap_or_else(PoisonError::into_inner);
        let index = load_index(&directory)?;
        let path = directory.join(blob_name(id));
        let Some(version) = index.entries.iter().find(|version| version.id == id) else {
            return Err(FsError::NotFound { path });
        };
        let text = read_blob(&path, self.limits.max_text_bytes)?;
        // The index and the file have to agree. A file that was swapped or
        // damaged on disk must not be restored over somebody's text as if it
        // were the version they picked.
        if hash_text(&text, HashAlgorithm::Sha256) != version.hash {
            return Err(FsError::other(Some(&path), "This version is damaged."));
        }
        Ok(text)
    }

    /// Removes one version. One that is already gone counts as removed.
    pub fn delete(&self, key: &HistoryKey, id: &str) -> FsResult<()> {
        key.validate()?;
        let _guard = self.lock.lock().unwrap_or_else(PoisonError::into_inner);
        let directory = self.key_directory(key);
        let mut index = load_index(&directory)?;
        let before = index.entries.len();
        index.entries.retain(|version| version.id != id);
        if index.entries.len() == before {
            return Ok(());
        }
        commit(&directory, &index)
    }

    /// Removes every version of `key`.
    pub fn clear(&self, key: &HistoryKey) -> FsResult<()> {
        key.validate()?;
        let _guard = self.lock.lock().unwrap_or_else(PoisonError::into_inner);
        remove_history(&self.key_directory(key))
    }

    /// Hands every version of `from` to `to`: a note was saved to a file for
    /// the first time, or a file was renamed.
    ///
    /// Copies, writes the new index, and only then deletes the old history, so
    /// a crash halfway leaves both rather than neither. Versions `to` already
    /// has — the same id and the same text — are not doubled.
    pub fn move_history(
        &self,
        from: &HistoryKey,
        to: &HistoryKey,
        retention_days: u32,
    ) -> FsResult<()> {
        from.validate()?;
        to.validate()?;
        let source = self.key_directory(from);
        let target = self.key_directory(to);
        if source == target {
            return Ok(());
        }

        let _guard = self.lock.lock().unwrap_or_else(PoisonError::into_inner);
        let moving = load_index(&source)?;
        if moving.entries.is_empty() {
            return Ok(());
        }
        let mut index = load_index(&target)?;
        fs::create_dir_all(&target).map_err(|error| FsError::from_io(&error, &target))?;

        for mut version in moving.entries {
            if index
                .entries
                .iter()
                .any(|known| known.id == version.id && known.hash == version.hash)
            {
                continue;
            }
            let old = source.join(blob_name(&version.id));
            version.id = unique_id(&index, version.time, &version.hash);
            if let Err(error) = fs::copy(&old, target.join(blob_name(&version.id))) {
                tracing::warn!(%error, "a version could not be carried over");
                continue;
            }
            index.entries.push(version);
        }
        // Stable, so versions of the same millisecond keep the order they
        // were written in.
        index.entries.sort_by_key(|version| version.time);
        index.key = Some(to.clone());
        self.thin(&mut index, retention_days, (self.clock)());
        commit(&target, &index)?;
        remove_history(&source)
    }

    /// Thins every history by `retention_days` and enforces the size cap.
    /// Run once in a while, so a history nobody writes to any more still ages.
    pub fn maintain(&self, retention_days: u32) -> FsResult<HistoryStats> {
        let _guard = self.lock.lock().unwrap_or_else(PoisonError::into_inner);
        let now = (self.clock)();
        for directory in self.key_directories() {
            let mut index = match load_index(&directory) {
                Ok(index) => index,
                Err(error) => {
                    tracing::warn!(%error, "history left alone");
                    continue;
                }
            };
            let before = index.entries.len();
            self.thin(&mut index, retention_days, now);
            if index.entries.len() != before {
                if let Err(error) = commit(&directory, &index) {
                    tracing::warn!(%error, "history could not be thinned");
                }
            }
        }
        self.enforce_total_cap()?;
        Ok(self.measure())
    }

    pub fn stats(&self) -> HistoryStats {
        let _guard = self.lock.lock().unwrap_or_else(PoisonError::into_inner);
        self.measure()
    }

    /* ── Inside the lock ───────────────────────────────── */

    fn key_directory(&self, key: &HistoryKey) -> PathBuf {
        self.directory.join(key.directory_name())
    }

    /// Our directories only: anything else in the history root is not ours.
    fn key_directories(&self) -> Vec<PathBuf> {
        let Ok(reader) = fs::read_dir(&self.directory) else {
            return Vec::new();
        };
        reader
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
            .filter(|entry| is_directory_name(&entry.file_name().to_string_lossy()))
            .map(|entry| entry.path())
            .collect()
    }

    fn thin(&self, index: &mut Index, retention_days: u32, now: i64) {
        let times: Vec<i64> = index.entries.iter().map(|version| version.time).collect();
        let verdicts = retention::keep(
            &times,
            Policy {
                now,
                retention_days: retention_days.clamp(1, MAX_RETENTION_DAYS),
                max_versions: self.limits.max_versions,
            },
        );
        let mut verdict = verdicts.into_iter();
        index.entries.retain(|_| verdict.next().unwrap_or(true));
    }

    /// Deletes the oldest versions across all histories until the store fits.
    ///
    /// Each history's newest version is exempt: it is the last known state of
    /// a file, and the whole point of the feature. If the newest versions
    /// alone are over the cap the store stays over it — bounded by the number
    /// of files times the size limit, and better than deleting what is left.
    fn enforce_total_cap(&self) -> FsResult<()> {
        let mut indices: HashMap<PathBuf, Index> = HashMap::new();
        let mut candidates: Vec<(i64, PathBuf, String, u64)> = Vec::new();
        let mut total = 0u64;

        for directory in self.key_directories() {
            let Ok(index) = load_index(&directory) else {
                continue;
            };
            let newest = index.entries.len().saturating_sub(1);
            for (position, version) in index.entries.iter().enumerate() {
                // What is on disk, not what the index claims: the index is the
                // user's JSON, and the cap is about the user's disk.
                let size = fs::metadata(directory.join(blob_name(&version.id)))
                    .map_or(0, |metadata| metadata.len());
                total += size;
                if position != newest {
                    candidates.push((version.time, directory.clone(), version.id.clone(), size));
                }
            }
            indices.insert(directory, index);
        }
        if total <= self.limits.max_total_bytes {
            return Ok(());
        }

        candidates.sort_by_key(|candidate| candidate.0);
        let mut doomed: HashMap<PathBuf, HashSet<String>> = HashMap::new();
        for (_, directory, id, size) in candidates {
            if total <= self.limits.max_total_bytes {
                break;
            }
            total -= size;
            doomed.entry(directory).or_default().insert(id);
        }
        for (directory, ids) in doomed {
            if let Some(index) = indices.get_mut(&directory) {
                index.entries.retain(|version| !ids.contains(&version.id));
                commit(&directory, index)?;
            }
        }
        Ok(())
    }

    fn measure(&self) -> HistoryStats {
        let mut stats = HistoryStats::default();
        for directory in self.key_directories() {
            let Ok(index) = load_index(&directory) else {
                continue;
            };
            if index.entries.is_empty() {
                continue;
            }
            stats.histories += 1;
            for version in &index.entries {
                stats.versions += 1;
                stats.bytes += fs::metadata(directory.join(blob_name(&version.id)))
                    .map_or(0, |metadata| metadata.len());
            }
        }
        stats
    }
}

/* ── Files ─────────────────────────────────────────────── */

fn system_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
        })
}

fn blob_name(id: &str) -> String {
    format!("{id}.{BLOB_EXTENSION}")
}

/// `0001759400000000-9c1d2e3f4a5b`, with `-2` and so on when a moment and a
/// hash happen twice. Sorts by time in a file manager, which is a kindness to
/// anyone digging through the folder by hand.
fn unique_id(index: &Index, time: i64, hash: &str) -> String {
    let base = format!("{:016}-{}", time.max(0), hash.get(..12).unwrap_or(hash));
    let taken = |id: &str| index.entries.iter().any(|version| version.id == id);
    if !taken(&base) {
        return base;
    }
    (2..)
        .map(|n| format!("{base}-{n}"))
        .find(|id| !taken(id))
        .unwrap_or(base)
}

/// Digits, lower-case hex and dashes, nothing else — so an id read from the
/// index can never name a file outside its history's directory.
fn is_version_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 48
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b) || b == b'-')
}

fn is_hash(hash: &str) -> bool {
    hash.len() == 64
        && hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// The index of one history. Missing is empty; unreadable or unparsable is
/// empty too, but not clean; written by a newer build is an error, because
/// writing over it would drop every entry this build does not understand.
fn load_index(directory: &Path) -> FsResult<Index> {
    let path = directory.join(INDEX_FILE);
    match fs::metadata(&path) {
        Ok(metadata) if metadata.len() > MAX_INDEX_BYTES => {
            tracing::warn!(path = %path.display(), "history index is far too large");
            return Ok(Index::default());
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Index {
                clean: true,
                ..Index::default()
            })
        }
        Err(error) => {
            tracing::warn!(path = %path.display(), %error, "history index could not be read");
            return Ok(Index::default());
        }
    }

    let parsed = fs::read(&path)
        .map_err(|error| error.to_string())
        .and_then(|bytes| {
            serde_json::from_slice::<IndexFile>(&bytes).map_err(|error| error.to_string())
        });
    let file = match parsed {
        Ok(file) => file,
        Err(error) => {
            tracing::warn!(path = %path.display(), %error, "history index could not be parsed");
            return Ok(Index::default());
        }
    };
    if file.version > INDEX_VERSION {
        return Err(FsError::other(
            Some(&path),
            "This history was written by a newer UwUNotes.",
        ));
    }

    let mut seen = HashSet::new();
    let mut entries: Vec<Version> = file
        .entries
        .into_iter()
        .filter_map(|raw| serde_json::from_value::<Version>(raw).ok())
        .filter(|version| {
            is_version_id(&version.id)
                && is_hash(&version.hash)
                && version.time >= 0
                && seen.insert(version.id.clone())
        })
        .collect();
    // Stable: the file is written oldest first, and two versions of the same
    // millisecond must keep that order, or "the newest" stops meaning the one
    // written last.
    entries.sort_by_key(|version| version.time);
    Ok(Index {
        key: file.key.filter(|key| key.validate().is_ok()),
        entries,
        clean: true,
    })
}

/// Writes the index, then sweeps up version files it no longer names. An index
/// with nothing left in it takes its directory with it.
fn commit(directory: &Path, index: &Index) -> FsResult<()> {
    if index.entries.is_empty() {
        return remove_history(directory);
    }
    let file = IndexFile {
        version: INDEX_VERSION,
        key: index.key.clone(),
        entries: index
            .entries
            .iter()
            .filter_map(|version| serde_json::to_value(version).ok())
            .collect(),
    };
    let path = directory.join(INDEX_FILE);
    let json = serde_json::to_vec_pretty(&file).map_err(|error| {
        FsError::other(Some(&path), format!("Index could not be encoded: {error}"))
    })?;
    write_atomic(&path, &json)?;

    if index.clean {
        sweep(directory, index);
    }
    Ok(())
}

/// Version files the index does not name. Only ours: a name that is not
/// `<id>.zst` — the atomic write's temporary file among them — is left alone.
fn sweep(directory: &Path, index: &Index) {
    let Ok(reader) = fs::read_dir(directory) else {
        return;
    };
    let named: HashSet<String> = index
        .entries
        .iter()
        .map(|version| blob_name(&version.id))
        .collect();
    for entry in reader.filter_map(Result::ok) {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(stem) = name.strip_suffix(&format!(".{BLOB_EXTENSION}")) else {
            continue;
        };
        if !is_version_id(stem) || named.contains(&name) {
            continue;
        }
        if let Err(error) = fs::remove_file(entry.path()) {
            tracing::warn!(%name, %error, "old version could not be removed");
        }
    }
}

fn remove_history(directory: &Path) -> FsResult<()> {
    match fs::remove_dir_all(directory) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(FsError::from_io(&error, directory)),
    }
}

/// Decompresses at most `limit` bytes. A file that unpacks to more was not
/// written by us — a few kilobytes of zstd can claim gigabytes — and reading it
/// all would be the denial of service it looks like.
fn read_blob(path: &Path, limit: usize) -> FsResult<String> {
    let file = fs::File::open(path).map_err(|error| FsError::from_io(&error, path))?;
    let damaged =
        |detail: String| FsError::other(Some(path), format!("This version is damaged: {detail}"));
    let decoder = zstd::stream::read::Decoder::new(file).map_err(|e| damaged(e.to_string()))?;
    let mut bytes = Vec::new();
    decoder
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| damaged(e.to_string()))?;
    if bytes.len() > limit {
        return Err(damaged("too large".to_owned()));
    }
    String::from_utf8(bytes)
        .map_err(|_| FsError::encoding(Some(path), "This version is not UTF-8."))
}
