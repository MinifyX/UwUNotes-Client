//! Find in files, and replace in files.
//!
//! The walk honours `.gitignore` by default because a search that disappears
//! into `node_modules` for ninety seconds is not a search. Results stream out
//! one file at a time so the panel fills while the walk is still running, and
//! the whole thing stops the instant the caller sets its cancellation flag —
//! typing another character in the search box should not leave a thread
//! grinding through a monorepo.
//!
//! The offsets in a [`SearchMatch`] are UTF-16 code units, not bytes. That is
//! the unit JavaScript strings and CodeMirror positions are measured in, and
//! converting here — where the byte offsets are — is the only place it can be
//! done correctly.
//!
//! What this module deliberately does not do: re-walk the tree for a replace.
//! `replace_in_files` touches exactly the files it is handed, from a result list
//! the user has already looked at.

use std::cell::{Cell, RefCell};
use std::fs;
use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use grep_matcher::{Captures as _, Matcher};
use grep_regex::{RegexMatcher, RegexMatcherBuilder};
use grep_searcher::{BinaryDetection, Searcher, SearcherBuilder, Sink, SinkMatch};
use ignore::overrides::{Override, OverrideBuilder};
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};

use crate::encoding;
use crate::error::{FsError, FsResult};
use crate::listing::display_path;
use crate::read::MAX_FILE_BYTES;
use crate::write::write_atomic;

/// A preview row is one line of a list, not a document viewer.
const PREVIEW_CHARS: usize = 400;

/// How much of a long line to keep in front of the match, so the reader can see
/// what it is part of.
const PREVIEW_LEAD_CHARS: usize = 48;

const ELLIPSIS: char = '…';

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    /// Cancels by id; the desktop crate keeps the flag, this crate only reads it.
    pub id: String,
    pub query: String,
    pub regex: bool,
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub root: String,
    /// Comma-separated globs. Empty means every file.
    pub include: String,
    pub exclude: String,
    pub respect_ignore_files: bool,
    pub include_hidden: bool,
    pub max_matches: usize,
    pub max_file_size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    /// 1-based, as shown to the user.
    pub line: u64,
    pub preview: String,
    /// UTF-16 code unit offsets into `preview`.
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSummary {
    /// Files that contained at least one match — the number the panel puts next
    /// to "matches in", not the number of files walked.
    pub files: usize,
    pub matches: usize,
    pub truncated: bool,
    pub skipped: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceRequest {
    pub query: String,
    pub regex: bool,
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub replacement: String,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceFailure {
    pub path: String,
    pub error: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceSummary {
    pub files: usize,
    pub replacements: usize,
    pub failed: Vec<ReplaceFailure>,
}

/// Walks `request.root` and calls `on_file` once per file that has matches.
///
/// Returns an error only for a pattern that cannot be compiled: a file that
/// cannot be read is counted in `skipped`, because one unreadable file in a
/// tree of ten thousand should not cost the user the other nine thousand nine
/// hundred and ninety-nine results.
pub fn search(
    request: &SearchRequest,
    mut on_file: impl FnMut(String, Vec<SearchMatch>),
    cancelled: &AtomicBool,
) -> FsResult<SearchSummary> {
    let mut summary = SearchSummary::default();
    if request.query.is_empty() {
        // An empty pattern matches between every pair of characters. Nobody
        // means that; they mean they have not typed anything yet.
        return Ok(summary);
    }

    let matcher = build_matcher(
        &request.query,
        request.regex,
        request.case_sensitive,
        request.whole_word,
    )?;

    let root = Path::new(&request.root);
    let mut walker = WalkBuilder::new(root);
    walker
        .hidden(!request.include_hidden)
        .ignore(request.respect_ignore_files)
        .git_ignore(request.respect_ignore_files)
        .git_global(request.respect_ignore_files)
        .git_exclude(request.respect_ignore_files)
        .parents(request.respect_ignore_files)
        // An editor's project folder is often not a git repository, and the user
        // who wrote a .gitignore meant it either way.
        .require_git(false)
        .follow_links(false);
    if let Some(overrides) = build_overrides(root, &request.include, &request.exclude)? {
        walker.overrides(overrides);
    }

    let mut searcher = SearcherBuilder::new()
        .line_number(true)
        // Stop at the first NUL: the rest of a binary is not going to be text
        // either, and a match inside one is noise the user cannot act on.
        .binary_detection(BinaryDetection::quit(0))
        .build();

    let found = RefCell::new(Vec::new());
    let budget = Cell::new(request.max_matches);
    let truncated = Cell::new(false);

    for entry in walker.build() {
        if cancelled.load(Ordering::Relaxed) {
            break;
        }
        // The walk still had entries to hand out when the budget ran out, so
        // say so: a list that silently stops at 5000 is a list that lies.
        if truncated.get() || budget.get() == 0 {
            truncated.set(true);
            break;
        }

        let Ok(entry) = entry else {
            summary.skipped += 1;
            continue;
        };
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }

        match entry.metadata() {
            Ok(metadata) if metadata.len() > request.max_file_size => {
                summary.skipped += 1;
                continue;
            }
            Ok(_) => {}
            Err(_) => {
                summary.skipped += 1;
                continue;
            }
        }

        found.borrow_mut().clear();
        let sink = FileSink {
            matcher: &matcher,
            found: &found,
            budget: &budget,
            truncated: &truncated,
            cancelled,
        };
        if searcher.search_path(&matcher, entry.path(), sink).is_err() {
            summary.skipped += 1;
            continue;
        }

        let matches = std::mem::take(&mut *found.borrow_mut());
        if matches.is_empty() {
            continue;
        }
        summary.files += 1;
        summary.matches += matches.len();
        on_file(display_path(entry.path()), matches);
    }

    summary.truncated = truncated.get();
    Ok(summary)
}

/// Collects one file's matches. The shared cells are what let the match budget
/// span files while the sink itself is handed to the searcher by value.
struct FileSink<'a> {
    matcher: &'a RegexMatcher,
    found: &'a RefCell<Vec<SearchMatch>>,
    budget: &'a Cell<usize>,
    truncated: &'a Cell<bool>,
    cancelled: &'a AtomicBool,
}

impl Sink for FileSink<'_> {
    type Error = io::Error;

    fn matched(&mut self, _searcher: &Searcher, sink_match: &SinkMatch<'_>) -> io::Result<bool> {
        if self.cancelled.load(Ordering::Relaxed) {
            return Ok(false);
        }

        let line_number = sink_match.line_number().unwrap_or(0);
        let line_bytes = line_without_terminator(sink_match.bytes());

        let mut spans = Vec::new();
        if self
            .matcher
            .find_iter(line_bytes, |span| {
                spans.push((span.start(), span.end()));
                true
            })
            .is_err()
        {
            // `RegexMatcher`'s error type has no inhabitants in practice. If one
            // ever appears, this line has nothing to say — the rest of the file
            // still might.
            return Ok(true);
        }

        // Lossy: a line that is not valid UTF-8 still deserves a preview, and
        // the offsets below are clamped to character boundaries either way.
        let line = String::from_utf8_lossy(line_bytes);

        let mut found = self.found.borrow_mut();
        for (start, end) in spans {
            if self.budget.get() == 0 {
                self.truncated.set(true);
                return Ok(false);
            }
            found.push(preview_match(&line, start, end, line_number));
            self.budget.set(self.budget.get() - 1);
        }

        Ok(true)
    }
}

/// Builds the row the results panel shows: one line, trimmed around the match.
fn preview_match(line: &str, start: usize, end: usize, line_number: u64) -> SearchMatch {
    let start = floor_boundary(line, start);
    let end = ceil_boundary(line, end.max(start));

    let (window_start, window_end) = if line.chars().count() <= PREVIEW_CHARS {
        (0, line.len())
    } else {
        let window_start = step_back(line, start, PREVIEW_LEAD_CHARS);
        (
            window_start,
            step_forward(line, window_start, PREVIEW_CHARS),
        )
    };

    let leads = window_start > 0;
    let trails = window_end < line.len();
    let mut preview = String::with_capacity(window_end - window_start + 8);
    if leads {
        preview.push(ELLIPSIS);
    }
    preview.push_str(&line[window_start..window_end]);
    if trails {
        preview.push(ELLIPSIS);
    }

    let shift = if leads { ELLIPSIS.len_utf8() } else { 0 };
    // A match longer than the window keeps its start visible and gives up its
    // end; the start is what the reader's eye needs.
    let visible_end = end.min(window_end).max(window_start);
    let start_byte = shift + (start.max(window_start) - window_start);
    let end_byte = shift + (visible_end - window_start);

    SearchMatch {
        line: line_number,
        start: utf16_length(&preview[..start_byte]),
        end: utf16_length(&preview[..end_byte]),
        preview,
    }
}

/// Replaces in exactly the files it is given, keeping each file's own encoding,
/// byte order mark and line endings.
///
/// One file failing does not stop the rest: the summary carries the failures so
/// the user can be told which three of their forty files are read-only.
pub fn replace_in_files(request: &ReplaceRequest) -> FsResult<ReplaceSummary> {
    let mut summary = ReplaceSummary::default();
    if request.query.is_empty() {
        return Ok(summary);
    }

    let matcher = build_matcher(
        &request.query,
        request.regex,
        request.case_sensitive,
        request.whole_word,
    )?;

    for path in &request.files {
        match replace_in_file(
            &matcher,
            Path::new(path),
            &request.replacement,
            request.regex,
        ) {
            Ok(0) => {}
            Ok(count) => {
                summary.files += 1;
                summary.replacements += count;
            }
            Err(error) => summary.failed.push(ReplaceFailure {
                path: path.clone(),
                error: error.to_string(),
            }),
        }
    }

    Ok(summary)
}

fn replace_in_file(
    matcher: &RegexMatcher,
    path: &Path,
    replacement: &str,
    expand_captures: bool,
) -> FsResult<usize> {
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
    if metadata.permissions().readonly() {
        return Err(FsError::Permission {
            path: path.to_path_buf(),
        });
    }

    let bytes = fs::read(path).map_err(|error| FsError::from_io(&error, path))?;
    let detected = encoding::detect(&bytes);
    let (decoded, _lossy) = encoding::decode(&bytes, detected.encoding, detected.bom);
    let (eol, _mixed) = encoding::detect_eol(&decoded);
    let text = encoding::normalise(&decoded);

    let (replaced, count) = replace_text(matcher, &text, replacement, expand_captures).map_err(
        |error| match error {
            FsError::Other { message, .. } => FsError::other(Some(path), message),
            other => other,
        },
    )?;
    if count == 0 {
        return Ok(0);
    }

    let out = encoding::encode(
        &encoding::apply_eol(&replaced, eol),
        detected.encoding,
        detected.bom,
    );
    write_atomic(path, &out)?;
    Ok(count)
}

fn replace_text(
    matcher: &RegexMatcher,
    text: &str,
    replacement: &str,
    expand_captures: bool,
) -> FsResult<(String, usize)> {
    let haystack = text.as_bytes();
    let mut captures = matcher
        .new_captures()
        .map_err(|_| FsError::other(None, "The regular expression engine failed."))?;

    let mut out: Vec<u8> = Vec::with_capacity(haystack.len());
    let mut consumed = 0usize;
    let mut count = 0usize;

    matcher
        .captures_iter(haystack, &mut captures, |found| {
            let Some(whole) = found.get(0) else {
                return true;
            };
            out.extend_from_slice(&haystack[consumed..whole.start()]);
            if expand_captures {
                expand_replacement(replacement, matcher, found, haystack, &mut out);
            } else {
                out.extend_from_slice(replacement.as_bytes());
            }
            consumed = whole.end();
            count += 1;
            true
        })
        .map_err(|_| FsError::other(None, "The regular expression engine failed."))?;

    if count == 0 {
        return Ok((String::new(), 0));
    }

    out.extend_from_slice(&haystack[consumed..]);
    let replaced = String::from_utf8(out)
        .map_err(|_| FsError::encoding(None, "The replacement produced invalid text."))?;
    Ok((replaced, count))
}

/// Expands `$1`, `${1}`, `${name}` and `$$` in a replacement, the way every
/// other regex tool does. An unknown group expands to nothing rather than to
/// its own name, which is what the `regex` crate does and what a user who typed
/// `$2` into a pattern with one group expects to see.
fn expand_replacement<M: Matcher>(
    template: &str,
    matcher: &M,
    captures: &M::Captures,
    haystack: &[u8],
    out: &mut Vec<u8>,
) {
    let bytes = template.as_bytes();
    let mut index = 0usize;

    while index < bytes.len() {
        let byte = bytes[index];
        if byte != b'$' {
            out.push(byte);
            index += 1;
            continue;
        }

        let Some(next) = bytes.get(index + 1) else {
            out.push(b'$');
            index += 1;
            continue;
        };

        if *next == b'$' {
            out.push(b'$');
            index += 2;
            continue;
        }

        let (name, after) = if *next == b'{' {
            let open = index + 2;
            match bytes[open..].iter().position(|byte| *byte == b'}') {
                // Both ends are ASCII, so these are character boundaries.
                Some(offset) => (&template[open..open + offset], open + offset + 1),
                None => {
                    out.push(b'$');
                    index += 1;
                    continue;
                }
            }
        } else {
            let start = index + 1;
            let mut end = start;
            while bytes.get(end).is_some_and(u8::is_ascii_digit) {
                end += 1;
            }
            if end == start {
                // `$` followed by something that is not a group: a literal.
                out.push(b'$');
                index += 1;
                continue;
            }
            (&template[start..end], end)
        };

        let group = match name.parse::<usize>() {
            Ok(number) => Some(number),
            Err(_) => matcher.capture_index(name),
        };
        if let Some(span) = group.and_then(|number| captures.get(number)) {
            out.extend_from_slice(&haystack[span.start()..span.end()]);
        }
        index = after;
    }
}

fn build_matcher(
    query: &str,
    regex: bool,
    case_sensitive: bool,
    whole_word: bool,
) -> FsResult<RegexMatcher> {
    let pattern = if regex {
        query.to_owned()
    } else {
        escape_pattern(query)
    };
    RegexMatcherBuilder::new()
        .case_insensitive(!case_sensitive)
        .word(whole_word)
        // Telling the matcher what a line is keeps it from producing matches the
        // line-oriented searcher could never report.
        .line_terminator(Some(b'\n'))
        .build(&pattern)
        .map_err(|error| FsError::invalid_regex(error.to_string()))
}

/// The regex metacharacter set, escaped by hand so this crate does not need the
/// `regex` crate just for `regex::escape`.
fn escape_pattern(query: &str) -> String {
    const META: &[char] = &[
        '\\', '.', '+', '*', '?', '(', ')', '|', '[', ']', '{', '}', '^', '$', '#', '&', '-', '~',
    ];

    let mut escaped = String::with_capacity(query.len() + 8);
    for character in query.chars() {
        if META.contains(&character) {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    escaped
}

/// Include and exclude globs, as one override set.
///
/// `ignore` gives include globs whitelist semantics: once there is one, a file
/// has to match something to be searched. That is exactly what a user typing
/// `*.rs` into the include box means.
fn build_overrides(root: &Path, include: &str, exclude: &str) -> FsResult<Option<Override>> {
    let mut builder = OverrideBuilder::new(root);
    let mut any = false;

    for glob in split_globs(include) {
        builder
            .add(glob)
            .map_err(|error| FsError::invalid_regex(format!("{glob}: {error}")))?;
        any = true;
    }
    for glob in split_globs(exclude) {
        builder
            .add(&format!("!{glob}"))
            .map_err(|error| FsError::invalid_regex(format!("{glob}: {error}")))?;
        any = true;
    }

    if !any {
        return Ok(None);
    }
    let overrides = builder
        .build()
        .map_err(|error| FsError::invalid_regex(error.to_string()))?;
    Ok(Some(overrides))
}

fn split_globs(patterns: &str) -> impl Iterator<Item = &str> {
    patterns
        .split(',')
        .map(str::trim)
        .filter(|glob| !glob.is_empty())
}

fn line_without_terminator(bytes: &[u8]) -> &[u8] {
    let mut end = bytes.len();
    if end > 0 && bytes[end - 1] == b'\n' {
        end -= 1;
    }
    if end > 0 && bytes[end - 1] == b'\r' {
        end -= 1;
    }
    &bytes[..end]
}

fn utf16_length(text: &str) -> usize {
    text.encode_utf16().count()
}

fn floor_boundary(text: &str, offset: usize) -> usize {
    let mut offset = offset.min(text.len());
    while offset > 0 && !text.is_char_boundary(offset) {
        offset -= 1;
    }
    offset
}

fn ceil_boundary(text: &str, offset: usize) -> usize {
    let mut offset = offset.min(text.len());
    while offset < text.len() && !text.is_char_boundary(offset) {
        offset += 1;
    }
    offset
}

/// Byte offset roughly `characters` characters before `offset`.
fn step_back(text: &str, offset: usize, characters: usize) -> usize {
    text[..offset]
        .char_indices()
        .rev()
        .nth(characters)
        .map_or(0, |(index, _)| index)
}

/// Byte offset roughly `characters` characters after `offset`.
fn step_forward(text: &str, offset: usize, characters: usize) -> usize {
    text[offset..]
        .char_indices()
        .nth(characters)
        .map_or(text.len(), |(index, _)| offset + index)
}
