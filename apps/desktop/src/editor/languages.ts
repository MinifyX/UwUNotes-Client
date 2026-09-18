/**
 * Which grammar a file gets, and when it is paid for.
 *
 * Two tiers on purpose. The ten languages people actually open all day are
 * imported statically: they sit in the main bundle, so a `.ts` file is
 * highlighted in the frame it appears in, with no loading flicker on the first
 * paint of a restored session. Everything else comes from
 * `@codemirror/language-data`, whose entries each carry their own dynamic
 * `import()` — Vite splits those into separate chunks, and a user who never
 * opens a Clojure file never downloads the Clojure parser.
 *
 * Matching order is exact file name, then extension, then the stem before the
 * first dot. That order is load-bearing: `Dockerfile` has no extension at all,
 * `README.txt` is text and not Markdown, and `Dockerfile.prod` is still a
 * Dockerfile.
 *
 * What this module does not do: apply anything. It answers "which language";
 * `editor/setup.ts` does the dispatching.
 */

import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { languages as bundledLanguages } from '@codemirror/language-data';
import type { Extension } from '@codemirror/state';
import type { DocMeta } from '../lib/documents';

export type LanguageEntry = {
  /** Stable across releases: it is stored in the session as `languageOverride`. */
  id: string;
  /** Shown in the status bar and the picker. Untranslated — these are proper nouns. */
  name: string;
  /** Lower case, without the dot. */
  extensions: string[];
  /** Exact file names, matched before extensions. */
  filenames?: string[];
  load: () => Promise<Extension>;
};

/**
 * Plain text is a real entry rather than `null`, so a user can pick "Text" to
 * switch highlighting off for a file the grammar is getting wrong — a minified
 * bundle, a log that happens to end in `.js`.
 */
export const PLAIN_TEXT: LanguageEntry = {
  id: 'text',
  name: 'Text',
  extensions: ['txt', 'text', 'log'],
  filenames: ['LICENSE', 'COPYING', 'NOTICE', 'AUTHORS'],
  load: () => Promise.resolve([]),
};

const FIRST_CLASS: LanguageEntry[] = [
  {
    id: 'javascript',
    name: 'JavaScript',
    extensions: ['js', 'mjs', 'cjs'],
    load: async () => javascript(),
  },
  {
    id: 'jsx',
    name: 'JavaScript (JSX)',
    extensions: ['jsx'],
    load: async () => javascript({ jsx: true }),
  },
  {
    id: 'typescript',
    name: 'TypeScript',
    extensions: ['ts', 'mts', 'cts'],
    load: async () => javascript({ typescript: true }),
  },
  {
    id: 'tsx',
    name: 'TypeScript (TSX)',
    extensions: ['tsx'],
    load: async () => javascript({ typescript: true, jsx: true }),
  },
  {
    id: 'json',
    name: 'JSON',
    // JSON with comments is still parsed as JSON: the parser marks the comment
    // as an error, which is honest — `tsconfig.json` is the one lying.
    extensions: ['json', 'jsonc', 'json5', 'webmanifest'],
    filenames: ['.prettierrc', '.babelrc', '.eslintrc'],
    load: async () => json(),
  },
  {
    id: 'markdown',
    name: 'Markdown',
    extensions: ['md', 'markdown', 'mdown', 'mkd'],
    filenames: ['README', 'CHANGELOG', 'CONTRIBUTING'],
    // Fenced code blocks get their own grammar, loaded the same lazy way as
    // everything else in the long tail. A Markdown file full of shell snippets
    // is the common case, not an exotic one.
    load: async () => markdown({ codeLanguages: bundledLanguages }),
  },
  {
    id: 'rust',
    name: 'Rust',
    extensions: ['rs'],
    load: async () => rust(),
  },
  {
    id: 'python',
    name: 'Python',
    extensions: ['py', 'pyw', 'pyi'],
    filenames: ['SConstruct', 'wscript'],
    load: async () => python(),
  },
  {
    id: 'html',
    name: 'HTML',
    // Vue and Svelte files are HTML with extra rules; the HTML grammar gets
    // the template and the embedded script right, which is most of the file.
    extensions: ['html', 'htm', 'xhtml', 'vue', 'svelte'],
    load: async () => html(),
  },
  {
    id: 'css',
    name: 'CSS',
    extensions: ['css', 'pcss', 'postcss'],
    load: async () => css(),
  },
];

function idFor(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * The long tail, adapted from `LanguageDescription` to our own shape.
 *
 * Each description keeps its own `load()`, so the dynamic import stays where
 * the package put it and the code splitting still works. Names a first-class
 * entry already covers are dropped: two "JSON" rows in the picker would be a
 * bug report.
 */
const firstClassNames = new Set(FIRST_CLASS.map((entry) => entry.name.toLowerCase()));

const LONG_TAIL: LanguageEntry[] = bundledLanguages
  .filter((description) => !firstClassNames.has(description.name.toLowerCase()))
  .map((description) => ({
    id: idFor(description.name),
    name: description.name,
    extensions: description.extensions.map((extension) => extension.toLowerCase()),
    load: () => description.load().then((support) => support.extension),
  }));

/** First class, then the long tail, then plain text as the last resort. */
export const LANGUAGES: LanguageEntry[] = [...FIRST_CLASS, ...LONG_TAIL, PLAIN_TEXT];

const byId = new Map(LANGUAGES.map((entry) => [entry.id, entry]));
const byFilename = new Map<string, LanguageEntry>();
const byExtension = new Map<string, LanguageEntry>();

for (const entry of LANGUAGES) {
  for (const filename of entry.filenames ?? []) {
    if (!byFilename.has(filename)) byFilename.set(filename, entry);
  }
  for (const extension of entry.extensions) {
    // First writer wins, which is the entire reason FIRST_CLASS comes first.
    if (!byExtension.has(extension)) byExtension.set(extension, entry);
  }
}

/**
 * Names without a usable extension, pointed at a language id or — when the
 * bundled list names a language something we would rather not hard-code, like
 * "Properties files" — at one of its extensions.
 *
 * `Makefile` resolves to plain text because no Makefile grammar ships in
 * `@codemirror/language-data`. Listing it anyway is still worth it: the status
 * bar then says "Text" deliberately instead of showing nothing at all.
 */
const EXTRA_FILENAMES: Record<string, string> = {
  Dockerfile: 'dockerfile',
  Containerfile: 'dockerfile',
  'CMakeLists.txt': 'cmake',
  Makefile: 'text',
  GNUmakefile: 'text',
  '.gitignore': 'text',
  '.gitattributes': 'text',
  '.dockerignore': 'text',
  '.npmrc': 'properties',
  '.editorconfig': 'properties',
  '.env': 'properties',
  '.bashrc': 'sh',
  '.zshrc': 'sh',
  '.profile': 'sh',
  Gemfile: 'ruby',
  Rakefile: 'ruby',
  Vagrantfile: 'ruby',
  'Cargo.lock': 'toml',
};

for (const [filename, key] of Object.entries(EXTRA_FILENAMES)) {
  const entry = byId.get(key) ?? byExtension.get(key);
  if (entry) byFilename.set(filename, entry);
}

export function languageById(id: string): LanguageEntry | null {
  return byId.get(id) ?? null;
}

/**
 * The language for a file name, or `null` when nothing matches — which the
 * caller shows as "Text" and treats as "no grammar", not as an error.
 */
export function languageForFileName(name: string): LanguageEntry | null {
  const base = name.split(/[\\/]/).pop() ?? name;
  if (!base) return null;

  const exact = byFilename.get(base);
  if (exact) return exact;

  const dot = base.lastIndexOf('.');
  if (dot > 0) {
    const extension = base.slice(dot + 1).toLowerCase();
    const known = extension ? byExtension.get(extension) : undefined;
    if (known) return known;
  }

  // `Dockerfile.prod`, `README.de.md` when the extension meant nothing: the
  // stem still says what the file is.
  const stem = base.split('.')[0];
  if (stem && stem !== base) {
    const byStem = byFilename.get(stem);
    if (byStem) return byStem;
  }

  // A dotfile with nothing but a name — `.bash_history` — is text, not unknown.
  if (dot === 0) return PLAIN_TEXT;
  return null;
}

/**
 * What a document should be highlighted as: the user's choice if they made
 * one, otherwise the file name. An override naming a language that no longer
 * exists falls through to the file name rather than being honoured as "none".
 */
export function resolveLanguage(meta: DocMeta): LanguageEntry | null {
  if (meta.languageOverride) {
    const chosen = languageById(meta.languageOverride);
    if (chosen) return chosen;
  }
  return languageForFileName(meta.path ?? meta.name);
}
