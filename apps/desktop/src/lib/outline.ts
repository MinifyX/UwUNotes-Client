/**
 * The structure of a document, for the "Gliederung" sidebar view.
 *
 * Three sources, chosen by language:
 *
 * - **Markdown** is read line by line: ATX (`## Title`) and setext headings,
 *   skipping fenced code. A line scan rather than the syntax tree, because it
 *   is complete from the first frame — the tree of a long file is parsed
 *   lazily, and an outline that is missing its second half until you scroll
 *   there is not an outline.
 * - **Line-oriented formats** with no tree worth the name — INI and TOML
 *   sections, YAML's top-level keys — are a regular expression each. TOML and
 *   INI are legacy modes whose tree is flat; YAML's is real but its top-level
 *   keys are what anyone wants from it.
 * - **Code** walks the Lezer tree for nodes whose names say what they are:
 *   `FunctionDeclaration`, `ClassDefinition`, `FunctionItem`, `MethodDecl`.
 *   Grammars differ in the details and agree on that vocabulary, so one
 *   pattern covers JavaScript, TypeScript, Python, Rust, Java, C, C++ and Go
 *   without a table per language. JSON gets its top-level keys.
 *
 * All of it is capped. A document past {@link MAX_SCAN_CHARS} only gets what
 * the parser already has, the tree walk stops at {@link MAX_ITEMS}, and the
 * parser is given a few milliseconds at most — an outline is a convenience,
 * and a convenience that freezes the editor on a 50 MB log has stopped being
 * one.
 */

import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorState, Text } from '@codemirror/state';

// Lezer's node types, derived rather than imported: `@lezer/common` is only a
// transitive dependency here, and a type is not worth a new direct one.
type Tree = ReturnType<typeof syntaxTree>;
type SyntaxNode = Tree['topNode'];
type SyntaxNodeRef = Parameters<NonNullable<Parameters<Tree['iterate']>[0]['enter']>>[0];

export type OutlineKind = 'heading' | 'function' | 'class' | 'key' | 'section';

export type OutlineItem = {
  label: string;
  kind: OutlineKind;
  /** Nesting depth, 0 for the outermost entries. */
  depth: number;
  /** Where the entry starts — what a click jumps to. */
  from: number;
  /** Where its section ends, for finding the one the caret is in. */
  to: number;
  /** 1-based, for display. */
  line: number;
};

/** Entries past this are dropped: a sidebar of 5000 rows is a list nobody reads. */
export const MAX_ITEMS = 2_000;
/** Larger documents get no fresh parsing, only the tree the editor already built. */
export const MAX_SCAN_CHARS = 5_000_000;
/** The most the parser may spend catching up before the outline uses what it has. */
const PARSE_BUDGET_MS = 25;
/** A label longer than this is cut; the full line is one click away. */
const MAX_LABEL = 80;

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_LABEL ? `${flat.slice(0, MAX_LABEL - 1)}…` : flat;
}

/* ── Markdown ──────────────────────────────────────────── */

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
/** Lines a setext underline cannot belong to: they start a block of their own. */
const NOT_PARAGRAPH = /^ {0,3}(?:[-*+>#]|\d{1,9}[.)]|`{3}|~{3}|\||$)|^ {4}/;

export function markdownOutline(doc: Text): OutlineItem[] {
  const headings: { level: number; label: string; from: number; line: number }[] = [];
  let fence: { char: string; length: number } | null = null;
  let previous: { text: string; from: number; number: number } | null = null;

  for (let number = 1; number <= doc.lines && headings.length < MAX_ITEMS; number += 1) {
    const line = doc.line(number);
    const text = line.text;

    const fenceMatch = FENCE.exec(text);
    if (fence) {
      if (
        fenceMatch?.[1] &&
        fenceMatch[1][0] === fence.char &&
        fenceMatch[1].length >= fence.length
      ) {
        fence = null;
      }
      previous = null;
      continue;
    }
    if (fenceMatch?.[1]) {
      fence = { char: fenceMatch[1][0] ?? '`', length: fenceMatch[1].length };
      previous = null;
      continue;
    }

    const atx = ATX.exec(text);
    if (atx?.[1]) {
      headings.push({
        level: atx[1].length,
        label: clip(atx[2] ?? ''),
        from: line.from,
        line: number,
      });
      previous = null;
      continue;
    }

    const setext = SETEXT.exec(text);
    if (setext?.[1] && previous && previous.text.trim() && !NOT_PARAGRAPH.test(previous.text)) {
      headings.push({
        level: setext[1].startsWith('=') ? 1 : 2,
        label: clip(previous.text),
        from: previous.from,
        line: previous.number,
      });
      previous = null;
      continue;
    }

    previous = { text, from: line.from, number };
  }

  // A section ends where the next heading of the same or a higher level
  // starts. Walking backwards with the nearest start per level keeps that
  // linear instead of searching ahead from every heading.
  const ends: number[] = new Array<number>(headings.length);
  const nextAt: number[] = [Infinity, Infinity, Infinity, Infinity, Infinity, Infinity, Infinity];
  for (let index = headings.length - 1; index >= 0; index -= 1) {
    const heading = headings[index];
    if (!heading) continue;
    const next = Math.min(...nextAt.slice(1, heading.level + 1));
    ends[index] = Number.isFinite(next) ? next - 1 : doc.length;
    nextAt[heading.level] = heading.from;
  }

  // Depth is the number of open headings above with a smaller level, so a
  // document that starts at `###` is not drawn indented by two for nothing.
  const open: number[] = [];
  return headings.map((heading, index) => {
    while (open.length > 0 && (open[open.length - 1] ?? 0) >= heading.level) open.pop();
    const depth = open.length;
    open.push(heading.level);
    return {
      label: heading.label,
      kind: 'heading' as const,
      depth,
      from: heading.from,
      to: ends[index] ?? doc.length,
      line: heading.line,
    };
  });
}

/* ── Line-oriented formats ─────────────────────────────── */

function lineOutline(doc: Text, pattern: RegExp, kind: OutlineKind): OutlineItem[] {
  const items: OutlineItem[] = [];
  for (let number = 1; number <= doc.lines && items.length < MAX_ITEMS; number += 1) {
    const line = doc.line(number);
    const match = pattern.exec(line.text);
    if (!match?.[1]) continue;
    const previous = items[items.length - 1];
    if (previous) previous.to = line.from - 1;
    items.push({
      label: clip(match[1]),
      kind,
      depth: 0,
      from: line.from,
      to: doc.length,
      line: number,
    });
  }
  return items;
}

/** `[section]` and TOML's `[[array.of.tables]]`. */
const SECTION = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:[#;].*)?$/;
/** A key at column 0 — not a list item, not a comment, not a document marker. */
const YAML_KEY = /^((?:"[^"]*"|'[^']*'|[^\s#'"\-:][^:#]*?|-[^\s:][^:#]*?))\s*:(?:\s|$)/;

/* ── Code ──────────────────────────────────────────────── */

const SYMBOL =
  /^(?:Function|Method|Class|Struct|Enum|Trait|Impl|Interface|Mod|Module|TypeAlias|Object|Record)(?:Declaration|Definition|Item|Decl|Specifier)$/;
const CLASS_LIKE = /^(?:Class|Struct|Enum|Trait|Impl|Interface|Mod|Module|TypeAlias|Object|Record)/;
const NAME =
  /^(?:VariableDefinition|PropertyDefinition|TypeDefinition|Definition|DefName|VariableName|BoundIdentifier|TypeIdentifier|Identifier|FieldIdentifier|PropertyName|Name|TypeName)$/;
/** Where a declaration's header ends: nothing inside these is its name. */
const BODY =
  /(?:Body|Block|ClassBody|DeclarationList|FieldDeclarationList|CompoundStatement|ParamList|ParameterList|ArgList)$/;

/** The declaration's name: the first name-like node in its header, at most two levels down. */
function nameOf(node: SyntaxNode, doc: Text): string | null {
  const search = (parent: SyntaxNode, depth: number): SyntaxNode | null => {
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (BODY.test(child.name)) return null;
      if (NAME.test(child.name)) return child;
      if (depth > 0) {
        const found = search(child, depth - 1);
        if (found) return found;
      }
    }
    return null;
  };
  const found = search(node, 2);
  return found ? doc.sliceString(found.from, found.to) : null;
}

/** For an `impl Foo for Bar {`: the header itself, up to the brace. */
function headerOf(node: SyntaxNodeRef, doc: Text): string {
  const line = doc.lineAt(node.from);
  const text = doc.sliceString(node.from, Math.min(node.to, line.to));
  return text.split('{')[0] ?? text;
}

/** `const handler = () => …` — an arrow or function expression bound to a name. */
function boundFunctionName(node: SyntaxNode, doc: Text): string | null {
  let name: SyntaxNode | null = null;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'VariableDefinition') name = child;
    else if (name && (child.name === 'ArrowFunction' || child.name === 'FunctionExpression')) {
      return doc.sliceString(name.from, name.to);
    }
  }
  return null;
}

function treeOutline(state: EditorState, json: boolean): OutlineItem[] {
  const { doc } = state;
  const tree =
    doc.length <= MAX_SCAN_CHARS
      ? (ensureSyntaxTree(state, doc.length, PARSE_BUDGET_MS) ?? syntaxTree(state))
      : syntaxTree(state);

  const items: OutlineItem[] = [];
  const open: OutlineItem[] = [];
  const push = (label: string, kind: OutlineKind, from: number, to: number) => {
    while (open.length > 0 && (open[open.length - 1]?.to ?? 0) <= from) open.pop();
    const item: OutlineItem = {
      label: clip(label),
      kind,
      depth: open.length,
      from,
      to,
      line: doc.lineAt(from).number,
    };
    items.push(item);
    open.push(item);
  };

  tree.iterate({
    enter: (ref) => {
      if (items.length >= MAX_ITEMS) return false;
      const name = ref.name;

      if (json) {
        // Only the keys of the outermost object: the outline of a 4000-line
        // lock file is its top-level sections, not every leaf.
        if (name === 'Property') {
          const key = ref.node.getChild('PropertyName');
          if (key)
            push(doc.sliceString(key.from, key.to).replace(/^"|"$/g, ''), 'key', ref.from, ref.to);
          return false;
        }
        return name === 'JsonText' || name === 'Object' ? undefined : false;
      }

      if (SYMBOL.test(name)) {
        const label = name.startsWith('Impl') ? headerOf(ref, doc) : nameOf(ref.node, doc);
        if (label) push(label, CLASS_LIKE.test(name) ? 'class' : 'function', ref.from, ref.to);
        return undefined;
      }
      if (name === 'VariableDeclaration') {
        const bound = boundFunctionName(ref.node, doc);
        if (bound) push(bound, 'function', ref.from, ref.to);
      }
      // Nothing worth listing lives inside a string or a comment, and long
      // ones are where a tree walk spends its time for nothing.
      if (/(?:String|Comment)$/.test(name)) return false;
      return undefined;
    },
  });
  return items;
}

/* ── The entry point ───────────────────────────────────── */

/** The outline for a state, given the id of its language (see `editor/languages.ts`). */
export function extractOutline(state: EditorState, languageId: string | null): OutlineItem[] {
  switch (languageId) {
    case 'markdown':
      return markdownOutline(state.doc);
    case 'toml':
    case 'properties-files':
      return lineOutline(state.doc, SECTION, 'section');
    case 'yaml':
      return lineOutline(state.doc, YAML_KEY, 'key');
    case 'json':
      return treeOutline(state, true);
    case null:
    case 'text':
      return [];
    default:
      return treeOutline(state, false);
  }
}

/**
 * The entry the caret is in: the innermost one whose range contains it, or
 * failing that the last one that starts before it. `-1` when the caret is
 * above everything.
 */
export function currentOutlineIndex(items: readonly OutlineItem[], position: number): number {
  let containing = -1;
  let before = -1;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item || item.from > position) break;
    before = index;
    if (position <= item.to) containing = index;
  }
  return containing >= 0 ? containing : before;
}

/** Entries whose label contains the query, ignoring case. An empty query keeps everything. */
export function filterOutline(items: readonly OutlineItem[], query: string): OutlineItem[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...items];
  return items.filter((item) => item.label.toLocaleLowerCase().includes(needle));
}
