//! Guessing what a file is, turning it into a `String`, and turning it back
//! into exactly the bytes it came from.
//!
//! This is the module the rest of the app exists to serve. An editor that
//! silently rewrites a Windows-1252 file as UTF-8, or drops a BOM, or converts
//! CRLF to LF because it felt like it, has damaged the user's file. So the
//! encoding, the BOM flag and the line ending travel with the text from the
//! moment it is read until the moment it is written, and `encode(decode(x))`
//! gives back `x`.
//!
//! What this module deliberately does not do: convert between encodings on its
//! own initiative, or repair broken bytes. When a guess is wrong the user picks
//! a different encoding and the file is re-read; nothing is written until they
//! say so.

use chardetng::EncodingDetector;
use encoding_rs::{Encoding, UTF_16BE, UTF_16LE, UTF_8};
use serde::{Deserialize, Serialize};

/// How a file's lines end on disk. Inside the editor everything is `\n`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Eol {
    Lf,
    Crlf,
    Cr,
}

impl Default for Eol {
    /// A brand new buffer has no line endings to look at, so it inherits the
    /// platform's habit rather than imposing one.
    fn default() -> Self {
        if cfg!(windows) {
            Self::Crlf
        } else {
            Self::Lf
        }
    }
}

/// How the encoding was decided. The status bar shows this, and the user is
/// invited to disagree with `Guessed`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EncodingSource {
    Bom,
    Guessed,
    Forced,
}

#[derive(Debug, Clone, Copy)]
pub struct Detected {
    pub encoding: &'static Encoding,
    /// The file starts with a byte order mark, which `decode` skips and
    /// `encode` puts back.
    pub bom: bool,
    pub source: EncodingSource,
}

/// The encodings offered in the status bar menu, as (label, display name).
///
/// The labels are resolved through `Encoding::for_label`, which follows the
/// WHATWG encoding standard — so `ISO-8859-1` resolves to `windows-1252` and
/// `macintosh` to `x-mac-roman`. That is not a bug: those labels genuinely name
/// the same decoder in every browser on earth, and pretending otherwise would
/// decode fewer files correctly, not more.
///
/// The display names are code page names, not prose, which is why they are not
/// translated: "Shift_JIS" is "Shift_JIS" in every language the app speaks.
pub const ENCODINGS: &[(&str, &str)] = &[
    ("UTF-8", "UTF-8"),
    ("UTF-16LE", "UTF-16 LE"),
    ("UTF-16BE", "UTF-16 BE"),
    ("windows-1252", "Windows-1252"),
    ("ISO-8859-1", "ISO-8859-1"),
    ("ISO-8859-15", "ISO-8859-15"),
    ("windows-1251", "Windows-1251"),
    ("windows-1250", "Windows-1250"),
    ("KOI8-R", "KOI8-R"),
    ("Shift_JIS", "Shift_JIS"),
    ("GB18030", "GB18030"),
    ("Big5", "Big5"),
    ("EUC-KR", "EUC-KR"),
    ("macintosh", "Macintosh Roman"),
];

/// How much of a file chardetng gets to look at. It only needs a sample, and a
/// 64 MiB file should not cost 64 MiB of statistics.
const SNIFF_BYTES: usize = 64 * 1024;

/// The window the UTF-16 NUL heuristic counts over.
const UTF16_BLOCK: usize = 4096;

/// Below this many bytes the NUL counting says nothing useful.
const UTF16_MIN_BYTES: usize = 16;

/// Resolves an encoding label from the page. `for_label_no_replacement` rather
/// than `for_label` so the "replacement" pseudo-encoding — which decodes every
/// file to a single U+FFFD — can never be selected by accident.
pub fn by_label(label: &str) -> Option<&'static Encoding> {
    Encoding::for_label_no_replacement(label.as_bytes())
}

/// The encoding a leading byte order mark names, and how many bytes it takes.
pub fn bom_encoding(bytes: &[u8]) -> Option<(&'static Encoding, usize)> {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        Some((UTF_8, 3))
    } else if bytes.starts_with(&[0xFF, 0xFE]) {
        Some((UTF_16LE, 2))
    } else if bytes.starts_with(&[0xFE, 0xFF]) {
        Some((UTF_16BE, 2))
    } else {
        None
    }
}

/// Works out what a file is, in order of how much the evidence is worth.
///
/// 1. A BOM is a statement of fact, not a guess.
/// 2. Valid UTF-8 is UTF-8. chardetng is good, but it is still a guesser, and a
///    guesser must never be allowed to overrule bytes that decode cleanly.
/// 3. UTF-16 without a BOM, found by counting NUL bytes at even against odd
///    offsets: Latin text in UTF-16LE is `H\0a\0l\0l\0o\0`, which is one NUL per
///    odd offset and none anywhere else.
/// 4. chardetng, for the legacy code pages, where there is nothing better.
///
/// Step 3 runs before step 2 is trusted, because that UTF-16LE example is also
/// perfectly valid UTF-8 — NUL is a legal code point. No real UTF-8 document is
/// half NUL bytes, so a strong imbalance outranks bare validity.
pub fn detect(bytes: &[u8]) -> Detected {
    if let Some((encoding, _)) = bom_encoding(bytes) {
        return Detected {
            encoding,
            bom: true,
            source: EncodingSource::Bom,
        };
    }

    if let Some(encoding) = utf16_without_bom(bytes) {
        return Detected {
            encoding,
            bom: false,
            source: EncodingSource::Guessed,
        };
    }

    if std::str::from_utf8(bytes).is_ok() {
        return Detected {
            encoding: UTF_8,
            bom: false,
            source: EncodingSource::Guessed,
        };
    }

    let head = &bytes[..bytes.len().min(SNIFF_BYTES)];
    let mut detector = EncodingDetector::new();
    detector.feed(head, head.len() == bytes.len());
    // `allow_utf8: false` — UTF-8 was already ruled out above by actually
    // trying it, so letting chardetng offer it again could only be wrong.
    let encoding = detector.guess(None, false);
    Detected {
        encoding,
        bom: false,
        source: EncodingSource::Guessed,
    }
}

fn utf16_without_bom(bytes: &[u8]) -> Option<&'static Encoding> {
    let block = &bytes[..bytes.len().min(UTF16_BLOCK)];
    if block.len() < UTF16_MIN_BYTES {
        return None;
    }

    let mut even = 0usize;
    let mut odd = 0usize;
    for (offset, byte) in block.iter().enumerate() {
        if *byte == 0 {
            if offset % 2 == 0 {
                even += 1;
            } else {
                odd += 1;
            }
        }
    }

    // An eighth of the block being NUL on one side and almost nothing on the
    // other is the signature of 16-bit text; anything less is noise.
    let floor = block.len() / 8;
    if odd > floor && odd > even.saturating_mul(4) {
        return Some(UTF_16LE);
    }
    if even > floor && even > odd.saturating_mul(4) {
        return Some(UTF_16BE);
    }
    None
}

/// Decodes to a `String`, reporting whether replacement characters appeared.
///
/// `lossy` is the honest answer to "was this the right encoding?" — the page
/// shows a warning rather than pretending the U+FFFDs were always there.
pub fn decode(bytes: &[u8], encoding: &'static Encoding, bom: bool) -> (String, bool) {
    let body = match (bom, bom_encoding(bytes)) {
        (true, Some((_, length))) => &bytes[length..],
        _ => bytes,
    };
    // `decode_without_bom_handling` because the BOM is already accounted for
    // above; the plain `decode` would sniff again and could pick a different
    // encoding than the caller asked for, which is precisely what "forced"
    // exists to prevent.
    let (text, lossy) = encoding.decode_without_bom_handling(body);
    (text.into_owned(), lossy)
}

/// Encodes text back to bytes, writing the byte order mark when asked.
///
/// For anything that is about to reach a disk, prefer [`encode_checked`]: this
/// one throws away the answer to "did every character survive?".
pub fn encode(text: &str, encoding: &'static Encoding, bom: bool) -> Vec<u8> {
    encode_checked(text, encoding, bom).0
}

/// [`encode`], plus whether the encoding had to substitute anything.
///
/// UTF-16 is done by hand because `encoding_rs` refuses to encode to it: the
/// WHATWG standard makes UTF-16 decode-only and quietly substitutes UTF-8 as
/// the output encoding, which would turn "save" into "silently convert".
///
/// The flag is the one `encoding_rs` computes and the plain `encode` used to
/// drop on the floor. A legacy code page turns a character it cannot hold into
/// an HTML numeric reference: `→` becomes the seven literal characters
/// `&#8594;`. That is what the standard says to do and it loses less than a
/// question mark would, but it is still a silent change to the user's text, so
/// callers about to write a file ask first and offer UTF-8.
///
/// Only the code-page branch can ever set it: UTF-16 holds every scalar value a
/// Rust `str` can, and UTF-8 is where the text already lives.
pub fn encode_checked(text: &str, encoding: &'static Encoding, bom: bool) -> (Vec<u8>, bool) {
    let mut out = Vec::with_capacity(text.len() + 4);
    if bom {
        out.extend_from_slice(bom_bytes(encoding));
    }

    if encoding == UTF_16LE {
        for unit in text.encode_utf16() {
            out.extend_from_slice(&unit.to_le_bytes());
        }
    } else if encoding == UTF_16BE {
        for unit in text.encode_utf16() {
            out.extend_from_slice(&unit.to_be_bytes());
        }
    } else {
        let (bytes, _, unmappable) = encoding.encode(text);
        out.extend_from_slice(&bytes);
        return (out, unmappable);
    }

    (out, false)
}

/// Empty for anything that is not Unicode: a "BOM" in a Windows-1252 file is
/// three stray characters, not a marker, so we refuse to write one.
fn bom_bytes(encoding: &'static Encoding) -> &'static [u8] {
    if encoding == UTF_8 {
        &[0xEF, 0xBB, 0xBF]
    } else if encoding == UTF_16LE {
        &[0xFF, 0xFE]
    } else if encoding == UTF_16BE {
        &[0xFE, 0xFF]
    } else {
        &[]
    }
}

/// Counts the three kinds of line ending and picks the majority.
///
/// The second half of the answer is the interesting one: a file that mixes CRLF
/// and LF will be normalised to whichever won, and the user is told, because
/// saving it is about to make that change permanent.
pub fn detect_eol(text: &str) -> (Eol, bool) {
    let bytes = text.as_bytes();
    let mut crlf = 0usize;
    let mut lf = 0usize;
    let mut cr = 0usize;

    let mut offset = 0usize;
    while offset < bytes.len() {
        match bytes[offset] {
            b'\r' => {
                if bytes.get(offset + 1) == Some(&b'\n') {
                    crlf += 1;
                    offset += 2;
                    continue;
                }
                cr += 1;
            }
            b'\n' => lf += 1,
            _ => {}
        }
        offset += 1;
    }

    let kinds = usize::from(crlf > 0) + usize::from(lf > 0) + usize::from(cr > 0);
    if kinds == 0 {
        return (Eol::default(), false);
    }

    let winner = if crlf >= lf && crlf >= cr {
        Eol::Crlf
    } else if lf >= cr {
        Eol::Lf
    } else {
        Eol::Cr
    };
    (winner, kinds > 1)
}

/// Collapses every line ending to `\n`, which is the only thing the editor and
/// CodeMirror's offsets ever see.
pub fn normalise(text: &str) -> String {
    if !text.contains('\r') {
        return text.to_owned();
    }

    let mut out = String::with_capacity(text.len());
    let mut characters = text.chars().peekable();
    while let Some(character) = characters.next() {
        if character == '\r' {
            if characters.peek() == Some(&'\n') {
                characters.next();
            }
            out.push('\n');
        } else {
            out.push(character);
        }
    }
    out
}

/// Puts the file's own line endings back. Expects `\n`-normalised input, which
/// is what everything downstream of [`normalise`] holds.
pub fn apply_eol(text: &str, eol: Eol) -> String {
    match eol {
        Eol::Lf => text.to_owned(),
        Eol::Crlf => text.replace('\n', "\r\n"),
        Eol::Cr => text.replace('\n', "\r"),
    }
}
