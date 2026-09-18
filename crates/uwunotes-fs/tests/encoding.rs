//! Detection and round tripping.
//!
//! These are the tests that stop UwUNotes from quietly rewriting somebody's
//! file. Everything here works on byte slices rather than real files, so a
//! failure is always about the encoding logic and never about a temporary
//! directory, a virus scanner or a full disk.

use encoding_rs::{UTF_16LE, UTF_8, WINDOWS_1252};
use uwunotes_fs::encoding::{
    apply_eol, by_label, decode, detect, detect_eol, encode, normalise, EncodingSource, Eol,
};

/// A long enough sample that chardetng has something to work with; short
/// strings are a coin toss for any statistical detector.
const GERMAN: &str = "Grüße aus München. Die Straße war naß und die Fußgänger \
überquerten die Kreuzung bei Rot. Später wurde es kälter, und die größeren \
Pfützen froren zu.";

#[test]
fn a_bom_is_believed_and_then_stripped() {
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice("Grüße\n".as_bytes());

    let detected = detect(&bytes);
    assert_eq!(detected.encoding, UTF_8);
    assert!(detected.bom);
    assert_eq!(detected.source, EncodingSource::Bom);

    let (text, lossy) = decode(&bytes, detected.encoding, detected.bom);
    assert_eq!(text, "Grüße\n");
    assert!(!lossy, "the marker itself must not survive as U+FEFF");
}

#[test]
fn valid_utf8_is_utf8_without_asking_the_guesser() {
    let bytes = GERMAN.as_bytes();

    let detected = detect(bytes);
    assert_eq!(detected.encoding, UTF_8);
    assert!(!detected.bom);
    assert_eq!(detected.source, EncodingSource::Guessed);

    let (text, lossy) = decode(bytes, detected.encoding, detected.bom);
    assert_eq!(text, GERMAN);
    assert!(!lossy);
}

#[test]
fn a_single_byte_code_page_is_not_mistaken_for_utf8() {
    let bytes = WINDOWS_1252.encode(GERMAN).0.into_owned();
    assert!(
        std::str::from_utf8(&bytes).is_err(),
        "the sample must not be valid UTF-8"
    );

    let detected = detect(&bytes);
    // Which legacy code page a detector picks for German text is a judgement
    // call — 1250 and 8859-15 decode these umlauts identically — so the claim
    // worth testing is that it stopped believing in UTF-8.
    assert_ne!(detected.encoding, UTF_8);

    let (text, lossy) = decode(&bytes, WINDOWS_1252, false);
    assert_eq!(text, GERMAN);
    assert!(!lossy);
}

#[test]
fn utf16_without_a_bom_is_found_by_its_nul_bytes() {
    let text = "Hallo Welt, diese Datei hat keine Byte Order Mark.";
    let bytes: Vec<u8> = text.encode_utf16().flat_map(u16::to_le_bytes).collect();

    // The trap this guards: those bytes are also perfectly valid UTF-8.
    assert!(std::str::from_utf8(&bytes).is_ok());

    let detected = detect(&bytes);
    assert_eq!(detected.encoding, UTF_16LE);
    assert!(!detected.bom);

    let (decoded, lossy) = decode(&bytes, detected.encoding, detected.bom);
    assert_eq!(decoded, text);
    assert!(!lossy);
}

#[test]
fn crlf_files_stay_crlf() {
    let text = "erste Zeile\r\nzweite Zeile\r\n";
    assert_eq!(detect_eol(text), (Eol::Crlf, false));
    assert_eq!(normalise(text), "erste Zeile\nzweite Zeile\n");
    assert_eq!(apply_eol(&normalise(text), Eol::Crlf), text);
}

#[test]
fn a_mixed_file_picks_the_majority_and_says_so() {
    let text = "erste\r\nzweite\ndritte\r\n";
    assert_eq!(detect_eol(text), (Eol::Crlf, true));
    assert_eq!(normalise(text), "erste\nzweite\ndritte\n");

    // A lone carriage return is still a line ending, and on its own it is not
    // a mixed file.
    assert_eq!(detect_eol("eins\rzwei\rdrei"), (Eol::Cr, false));
    assert_eq!(normalise("eins\rzwei\rdrei"), "eins\nzwei\ndrei");
}

#[test]
fn decoding_then_encoding_gives_back_the_original_bytes() {
    let mut utf8_bom = vec![0xEF, 0xBB, 0xBF];
    utf8_bom.extend_from_slice("Zeile eins\r\nZeile zwei\r\n".as_bytes());

    let mut utf16_bom = vec![0xFF, 0xFE];
    utf16_bom.extend("Käse\r\nBrot\r\n".encode_utf16().flat_map(u16::to_le_bytes));

    let latin = WINDOWS_1252.encode("Größe: 12 Fuß\n").0.into_owned();

    let cases: Vec<(Vec<u8>, &'static str, bool)> = vec![
        (utf8_bom, "UTF-8", true),
        (utf16_bom, "UTF-16LE", true),
        (latin, "windows-1252", false),
        (GERMAN.as_bytes().to_vec(), "UTF-8", false),
    ];

    for (bytes, label, bom) in cases {
        let encoding = by_label(label).unwrap();
        let (text, lossy) = decode(&bytes, encoding, bom);
        assert!(!lossy, "{label} decoded lossily");
        assert_eq!(
            encode(&text, encoding, bom),
            bytes,
            "{label} did not round trip"
        );
    }
}

#[test]
fn a_marker_is_only_written_for_encodings_that_have_one() {
    let utf8 = by_label("UTF-8").unwrap();
    assert_eq!(&encode("A", utf8, true)[..3], &[0xEF, 0xBB, 0xBF]);

    // Three stray characters at the top of a Windows-1252 file would be a bug,
    // not a marker, so the flag is ignored rather than obeyed.
    let latin = by_label("windows-1252").unwrap();
    assert_eq!(encode("A", latin, true), b"A".to_vec());
}

#[test]
fn unknown_labels_are_rejected_rather_than_guessed_at() {
    assert!(by_label("UTF-8").is_some());
    assert!(by_label("Shift_JIS").is_some());
    assert!(by_label("nonsense-8").is_none());
    // The replacement pseudo-encoding decodes every file to a single U+FFFD.
    assert!(by_label("iso-2022-cn").is_none());
}
