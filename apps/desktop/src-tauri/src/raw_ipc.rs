//! Document text over the IPC as bytes, not as JSON.
//!
//! A JSON string is fine for a config file and ruinous for a log with two
//! million lines: the page escapes every quote and backslash into one giant
//! string, the webview copies it, serde walks it a character at a time, and on
//! the way back the page parses all of it again. On Linux, where WebKitGTK's
//! custom protocol is the slow leg, a 60 MB file spent seconds in that round
//! trip — and the session's draft autosave made the trip once a second while
//! anyone was typing. That was the freeze.
//!
//! So the text travels as the raw UTF-8 body, and the handful of fields that
//! go with it travel separately:
//!
//! - **Page → Rust**: the body is the text; the fields are JSON, percent-encoded
//!   into the `x-uwu-meta` header (header values must be ASCII, and a path does
//!   not have to be).
//! - **Rust → page**: one body, framed as a little-endian `u32` length, that
//!   many bytes of JSON header, then the text.
//!
//! `lib/api.ts` holds the other half of both.

use serde::de::DeserializeOwned;
use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};
use uwunotes_fs::FsError;

const META_HEADER: &str = "x-uwu-meta";

/// The text a raw request carries, borrowed from the request.
pub(crate) fn body_text<'r>(request: &'r Request<'_>) -> Result<&'r str, FsError> {
    match request.body() {
        InvokeBody::Raw(bytes) => std::str::from_utf8(bytes)
            .map_err(|error| FsError::other(None, format!("Text is not valid UTF-8: {error}"))),
        InvokeBody::Json(_) => Err(FsError::other(None, "Expected the text as a raw body")),
    }
}

/// The fields that came with a raw request, from the `x-uwu-meta` header.
pub(crate) fn meta<T: DeserializeOwned>(request: &Request<'_>) -> Result<T, FsError> {
    let value = request
        .headers()
        .get(META_HEADER)
        .ok_or_else(|| FsError::other(None, "Missing x-uwu-meta header"))?;
    let decoded = percent_decode(value.as_bytes())
        .ok_or_else(|| FsError::other(None, "Malformed x-uwu-meta header"))?;
    serde_json::from_slice(&decoded)
        .map_err(|error| FsError::other(None, format!("Malformed x-uwu-meta header: {error}")))
}

/// A header and a text as one framed body. See the module comment.
pub(crate) fn framed<H: Serialize>(header: &H, text: &str) -> Result<Response, FsError> {
    let header = serde_json::to_vec(header)
        .map_err(|error| FsError::other(None, format!("Header not serialisable: {error}")))?;
    let length = u32::try_from(header.len())
        .map_err(|_| FsError::other(None, "Header larger than 4 GiB"))?;
    let mut body = Vec::with_capacity(4 + header.len() + text.len());
    body.extend_from_slice(&length.to_le_bytes());
    body.extend_from_slice(&header);
    body.extend_from_slice(text.as_bytes());
    Ok(Response::new(body))
}

/// `%XX` back to bytes. `encodeURIComponent` never produces `+` for a space,
/// so there is no form-encoding case to handle. `None` for a broken escape.
fn percent_decode(input: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(input.len());
    let mut index = 0;
    while index < input.len() {
        if input[index] == b'%' {
            let hex = input.get(index + 1..index + 3)?;
            let hex = std::str::from_utf8(hex).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            out.push(input[index]);
            index += 1;
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::percent_decode;

    #[test]
    fn decodes_what_encode_uri_component_produces() {
        // encodeURIComponent('{"path":"C:\\Ü ä/x"}')
        let encoded = b"%7B%22path%22%3A%22C%3A%5C%C3%9C%20%C3%A4%2Fx%22%7D";
        let decoded = percent_decode(encoded).unwrap();
        assert_eq!(
            String::from_utf8(decoded).unwrap(),
            "{\"path\":\"C:\\Ü ä/x\"}"
        );
    }

    #[test]
    fn rejects_a_cut_off_escape() {
        assert!(percent_decode(b"abc%2").is_none());
        assert!(percent_decode(b"abc%zz").is_none());
    }
}
