/**
 * Markdown to HTML, for the preview — and the half of this feature where a
 * mistake is a security hole rather than a rendering glitch.
 *
 * The preview shows a file from the user's disk inside the webview that can
 * call every Rust command the app has. A Markdown file is not trusted input: it
 * came from a repository, an email, a download. So the output is held to the
 * rule that nothing in it may run, load or navigate anything by itself:
 *
 * 1. **Raw HTML is off.** markdown-it is created with `html: false`, so a
 *    `<script>`, an `<iframe>` or an `<img onerror>` in the source comes out as
 *    the literal text it is. There is no list of good and bad tags to get wrong.
 * 2. **Links are filtered twice.** markdown-it's `validateLink` is replaced by
 *    a stricter one (http, https, mailto, relative, anchors — and raster
 *    `data:` images), and the click handler in the component sorts every link
 *    again through `classifyLink()` before anything happens. The webview never
 *    follows a link on its own.
 * 3. **DOMPurify runs last anyway**, with an allow-list of exactly the tags and
 *    attributes this renderer produces. If a future markdown-it, a plugin or a
 *    mistake in this file ever lets something through, it stops here.
 * 4. **No remote fetches.** Remote images are not loaded — the app's CSP would
 *    refuse them anyway (`img-src 'self' data:`) — and render as a link the
 *    user can open in the browser instead. Local images are not loaded either:
 *    the webview has no access to the disk, and widening the CSP or the asset
 *    protocol for a preview is not a trade worth making.
 *
 * Heading ids are prefixed with `md-` so that a heading called "Location" or
 * "App" can neither clobber a DOM property nor collide with an element the app
 * itself relies on. The component strips the prefix back off for `#anchors`.
 *
 * Every block element carries `data-line`, the zero-based source line it
 * starts on. That is what scroll sync and the clickable checkboxes stand on.
 */

import DOMPurify from 'dompurify';
import MarkdownIt, { type MarkdownIt as Markdown } from 'markdown-it';
import { isExternalUrl } from './links';
import { createSlugger } from './slug';

/** What the caller puts into the page — translated, because this module has no `t()` of its own. */
export type RenderLabels = {
  /** Shown for a remote image that was not loaded, before its alt text. */
  remoteImage: string;
  /** Shown for a local image that cannot be loaded. */
  localImage: string;
  /** The title on a heading's anchor link. */
  headingLink: string;
};

export type RenderOptions = {
  labels: RenderLabels;
  /**
   * Highlights a fenced block synchronously, returning HTML of escaped text in
   * spans, or `null` for plain text. Called with the block's info string.
   */
  highlight?: (code: string, info: string) => string | null;
};

/** Prefix for heading ids; see the module comment. */
export const HEADING_ID_PREFIX = 'md-';

/** Raster images only. An SVG is a document that can carry scripts and links of its own. */
const DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]*$/i;

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

/**
 * Whether markdown-it may turn this into a link or an image at all.
 *
 * Anything refused here stays as the literal Markdown text, which is the
 * honest rendering of a link we will not follow.
 */
function allowedUrl(url: string): boolean {
  const trimmed = url.trim();
  if (DATA_IMAGE.test(trimmed)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed.replace(/[\u0000- \u007f]/g, ''))) {
    return isExternalUrl(trimmed);
  }
  // Protocol-relative URLs fetch from another host; absolute paths name the
  // webview's own origin. Neither is a link inside a document.
  return !trimmed.startsWith('//') && !trimmed.startsWith('\\\\');
}

type Env = { slug: (text: string) => string };

function createMarkdown(options: RenderOptions): Markdown {
  const md = new MarkdownIt({ html: false, linkify: true, typographer: false });
  md.validateLink = allowedUrl;
  // GitHub turns `www.example.com` into a link too, but a bare word followed
  // by a dot is not worth a second guess; only URLs with a scheme are linked.
  md.linkify.set({ fuzzyLink: false, fuzzyEmail: false });

  md.core.ruler.push('uwu_source_lines', (state) => {
    for (const token of state.tokens) {
      if (token.map && token.block && token.nesting !== -1 && token.type !== 'inline') {
        token.attrSet('data-line', String(token.map[0]));
      }
    }
  });

  md.core.ruler.push('uwu_task_lists', (state) => {
    const tokens = state.tokens;
    for (let index = 2; index < tokens.length; index += 1) {
      const inline = tokens[index];
      const paragraph = tokens[index - 1];
      const item = tokens[index - 2];
      if (
        inline?.type !== 'inline' ||
        paragraph?.type !== 'paragraph_open' ||
        item?.type !== 'list_item_open' ||
        !item.map
      ) {
        continue;
      }
      const first = inline.children?.[0];
      if (first?.type !== 'text') continue;
      const match = /^\[([ xX])\](?=[ \t]|$)[ \t]?/.exec(first.content);
      if (!match) continue;

      first.content = first.content.slice(match[0].length);
      const checked = match[1] !== ' ';
      const box = new state.Token('html_inline', '', 0);
      // Built here from two values this rule controls, never from the source:
      // `html_inline` is rendered verbatim, which is exactly why the parser is
      // not allowed to produce it.
      box.content = `<input type="checkbox" class="md-task" data-line="${item.map[0]}"${
        checked ? ' checked' : ''
      }>`;
      inline.children?.unshift(box);
      item.attrJoin('class', 'md-task-item');
    }
  });

  // Alignment arrives as an inline `style`. The sanitizer does not allow style
  // attributes at all, so it is turned into a class the stylesheet knows.
  md.core.ruler.push('uwu_table_alignment', (state) => {
    for (const token of state.tokens) {
      if (token.type !== 'th_open' && token.type !== 'td_open') continue;
      const style = token.attrGet('style');
      if (typeof style !== 'string') continue;
      const align = /text-align:\s*(left|center|right)/.exec(style)?.[1];
      token.attrs = (token.attrs ?? []).filter(([name]) => name !== 'style');
      if (align) token.attrJoin('class', `md-align-${align}`);
    }
  });

  const rules = md.renderer.rules;

  rules.heading_open = (tokens, index, _options, env) => {
    const token = tokens[index];
    const inline = tokens[index + 1];
    if (!token) return '';
    const text = (inline?.children ?? [])
      .filter((child) => child.type === 'text' || child.type === 'code_inline')
      .map((child) => child.content)
      .join('');
    const slug = (env as Env).slug(text);
    token.attrSet('id', `${HEADING_ID_PREFIX}${slug}`);
    const anchor = `<a class="md-heading-anchor" href="#${escapeHtml(slug)}" title="${escapeHtml(
      options.labels.headingLink,
    )}">#</a>`;
    return `<${token.tag}${md.renderer.renderAttrs(token)}>${anchor}`;
  };

  const renderCode = (content: string, info: string, line: number | undefined) => {
    const highlighted = info ? (options.highlight?.(content, info) ?? null) : null;
    const lineAttr = line === undefined ? '' : ` data-line="${line}"`;
    const langAttr = info ? ` data-lang="${escapeHtml(info)}"` : '';
    return `<pre class="md-code"${lineAttr}${langAttr}><code>${
      highlighted ?? escapeHtml(content)
    }</code></pre>\n`;
  };

  rules.fence = (tokens, index) => {
    const token = tokens[index];
    if (!token) return '';
    const info = token.info.trim().split(/\s+/)[0] ?? '';
    return renderCode(token.content, info, token.map?.[0]);
  };

  rules.code_block = (tokens, index) => {
    const token = tokens[index];
    if (!token) return '';
    return renderCode(token.content, '', token.map?.[0]);
  };

  rules.image = (tokens, index, renderOptions, env, renderer) => {
    const token = tokens[index];
    if (!token) return '';
    const src = String(token.attrGet('src') ?? '').trim();
    const alt = renderer.renderInlineAsText(token.children ?? [], renderOptions, env);
    if (DATA_IMAGE.test(src)) {
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`;
    }
    if (isExternalUrl(src)) {
      // A link rather than an image: the click goes through the same path as
      // every other external link, to the system browser.
      return `<a class="md-image-blocked" href="${escapeHtml(src)}" title="${escapeHtml(
        src,
      )}"><span class="md-image-label">${escapeHtml(options.labels.remoteImage)}</span> ${escapeHtml(
        alt || src,
      )}</a>`;
    }
    return `<span class="md-image-blocked" title="${escapeHtml(src)}"><span class="md-image-label">${escapeHtml(
      options.labels.localImage,
    )}</span> ${escapeHtml(alt || src)}</span>`;
  };

  return md;
}

/* ── The last line ─────────────────────────────────────── */

const ALLOWED_TAGS = [
  'a',
  'blockquote',
  'br',
  'code',
  'del',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'img',
  'input',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'span',
  'strong',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
];

const ALLOWED_ATTR = [
  'alt',
  'checked',
  'class',
  'data-lang',
  'data-line',
  'href',
  'id',
  'src',
  'start',
  'title',
  'type',
];

/** http, https, mailto, anchors and relative paths; DOMPurify's default minus the other schemes. */
const ALLOWED_URI = /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

let hooked = false;

/**
 * Element-level rules the allow-lists cannot say: an `<input>` is only ever a
 * checkbox, and an `<img>` only ever shows a raster `data:` URL.
 */
function installHooks(): void {
  if (hooked) return;
  hooked = true;
  // Attributes are rewritten rather than elements removed: DOMPurify is
  // walking the tree while hooks run, and taking nodes out from under it is
  // its job, not a hook's.
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof Element)) return;
    const tag = node.tagName.toLowerCase();
    if (tag === 'input') node.setAttribute('type', 'checkbox');
    if (tag === 'img' && !DATA_IMAGE.test(node.getAttribute('src') ?? '')) {
      node.removeAttribute('src');
    }
  });
}

export function sanitize(html: string): string {
  installHooks();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: ALLOWED_URI,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    RETURN_TRUSTED_TYPE: false,
  });
}

/**
 * A renderer for one preview. Options are fixed per renderer because the
 * markdown-it instance is built around them; building one is cheap, rendering
 * a large document is not, and the component keeps one around.
 */
export function createRenderer(options: RenderOptions): (source: string) => string {
  const md = createMarkdown(options);
  return (source) => {
    const env: Env = { slug: createSlugger() };
    return sanitize(md.render(source, env));
  };
}
