//! The operating system underneath the setup: starting the editor, the one
//! link that may leave the window, the message a silent run can still show,
//! and whether a process is still there.
//!
//! One module per family, both offering the same names to `app.rs` and to the
//! installers in `install/`: [`windows`] with the Win32 calls, the shortcuts,
//! the known folders and WebView2; `unix` with the few things macOS and Linux
//! need, done through their own standard tools. What is the same everywhere —
//! which links may be opened at all — is here.
//!
//! Every call in there is the narrow, documented way to do one thing. There is
//! no general "run this" and no general "open that": a setup runs from the
//! Downloads folder, next to whatever else was downloaded, and it is the last
//! program on the machine that should be talked into starting something.

#[cfg(unix)]
mod unix;
#[cfg(windows)]
mod windows;

#[cfg(unix)]
pub use self::unix::*;
#[cfg(windows)]
pub use self::windows::*;

/// Longer than this is not a link anybody put in a setup.
const MAX_LINK_BYTES: usize = 2048;

/// `https`, with nothing in it a shell or a browser could read as a second
/// argument. The editor's own rule, minus `http` and `mailto`: the setup shows
/// two links, both of them to the project's own pages.
fn is_web_link(url: &str) -> bool {
    if url.len() > MAX_LINK_BYTES
        || url.chars().any(|character| {
            character.is_control() || character.is_whitespace() || character == '"'
        })
    {
        return false;
    }
    url.to_ascii_lowercase()
        .strip_prefix("https://")
        // `https:///etc/passwd` has an empty host, which some openers read as a
        // local path rather than as a web address.
        .is_some_and(|rest| !rest.is_empty() && !rest.starts_with('/'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_https_links_leave_the_setup() {
        assert!(is_web_link("https://github.com/MinifyX/UwUNotes-Client"));
        assert!(is_web_link("HTTPS://uwunotes.example/hilfe?a=b#c"));

        for refused in [
            "http://example.org",
            "mailto:someone@example.org",
            "file:///C:/Windows/System32/calc.exe",
            "ms-settings:privacy",
            "javascript:alert(1)",
            "https://",
            "https:///etc/passwd",
            "https://example.org/\" & calc",
            "https://exa mple.org",
            r"\\attacker\share",
            // What `open` and `xdg-open` would read as an option rather than
            // as the thing to open.
            "-a Terminal",
            "--help",
            "",
        ] {
            assert!(!is_web_link(refused), "{refused}");
        }
        assert!(!is_web_link(&format!(
            "https://x/{}",
            "a".repeat(MAX_LINK_BYTES)
        )));
    }
}
