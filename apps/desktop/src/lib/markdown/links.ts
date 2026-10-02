/**
 * What a link in the preview is allowed to do.
 *
 * The preview is a Markdown file rendered inside the same webview that can
 * call into Rust, so a link is never followed by the browser — every click is
 * intercepted and sorted into exactly one of these:
 *
 * - `external`: `http`, `https` or `mailto`. Handed to the system browser
 *   through `openExternal()`, which checks the scheme a second time in Rust.
 * - `anchor`: `#heading`, scrolled to inside the preview.
 * - `local`: a relative path to another Markdown or text file, opened as a tab.
 * - `blocked`: everything else — `javascript:`, `data:`, `file:`, the app's
 *   own `ipc:` and `tauri:` schemes, protocol-relative `//host`, absolute
 *   paths. Nothing happens.
 *
 * The list of what is allowed is short on purpose. A scheme nobody thought
 * about is blocked, rather than a scheme somebody thought about being allowed.
 */

export type LinkTarget =
  | { kind: 'external'; url: string }
  | { kind: 'anchor'; id: string }
  | { kind: 'local'; path: string }
  | { kind: 'blocked' };

const EXTERNAL_SCHEMES = new Set(['http', 'https', 'mailto']);

/** Files a relative link may open as a tab. Text the editor reads well, nothing else. */
const LOCAL_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkd', 'txt']);

/**
 * The scheme as a browser would see it.
 *
 * Browsers drop ASCII whitespace and control characters before they look for a
 * scheme, which is how `java\tscript:` gets past a naive prefix check. They are
 * dropped here as well, and the scheme is compared in lower case.
 */
function schemeOf(href: string): string | null {
  const compact = href.replace(/[\u0000- \u007f]/g, '');
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(compact);
  return match?.[1] ? match[1].toLowerCase() : null;
}

/** Whether a URL is one the preview may hand to the system browser. */
export function isExternalUrl(href: string): boolean {
  const scheme = schemeOf(href);
  if (!scheme || !EXTERNAL_SCHEMES.has(scheme)) return false;
  // The same refusal as the Rust side: a URL with whitespace or control
  // characters in it is either broken or trying something.
  return !/[\u0000- \u007f]/.test(href);
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Sorts a link into what may happen when it is clicked.
 *
 * `docPath` is the file the preview belongs to; without one (an unsaved
 * buffer) there is no folder for a relative link to be relative to.
 */
export function classifyLink(href: string, docPath: string | null): LinkTarget {
  const trimmed = href.trim();
  if (!trimmed) return { kind: 'blocked' };
  if (trimmed.startsWith('#')) return { kind: 'anchor', id: decode(trimmed.slice(1)) };

  if (schemeOf(trimmed) !== null) {
    return isExternalUrl(trimmed) ? { kind: 'external', url: trimmed } : { kind: 'blocked' };
  }

  // Protocol-relative and absolute paths: neither is "next to this file".
  if (/^[\\/]/.test(trimmed)) return { kind: 'blocked' };

  const path = resolveRelative(docPath, trimmed);
  return path ? { kind: 'local', path } : { kind: 'blocked' };
}

/**
 * A relative link, resolved against the folder of `docPath`.
 *
 * Query and fragment are dropped, percent escapes decoded, `.` and `..`
 * collapsed. Returns `null` when the link climbs above the root, has no file
 * name, or is not a file type the editor should open from a link.
 */
export function resolveRelative(docPath: string | null, href: string): string | null {
  if (!docPath) return null;
  const withoutSuffix = href.replace(/[?#].*$/, '');
  if (!withoutSuffix) return null;
  const relative = decode(withoutSuffix);
  // A decoded NUL or newline is not a file name anyone wrote on purpose.
  if (/[\u0000-\u001f]/.test(relative)) return null;

  const extension = /\.([^./\\]+)$/.exec(relative)?.[1]?.toLowerCase();
  if (!extension || !LOCAL_EXTENSIONS.has(extension)) return null;

  const separator = docPath.includes('\\') && !docPath.includes('/') ? '\\' : '/';
  const segments = docPath.split(/[\\/]/);
  segments.pop();
  for (const part of relative.split(/[\\/]/)) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      // Never above the first segment: that is the drive or the root.
      if (segments.length <= 1) return null;
      segments.pop();
    } else {
      segments.push(part);
    }
  }
  return segments.join(separator);
}
