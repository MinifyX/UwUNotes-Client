/**
 * Tools → Hash: which algorithm the dialog opens on, and the one-shot "hash
 * the selection straight into the clipboard".
 *
 * The dialog slot in `lib/commands.ts` holds a name and nothing else, so the
 * menu entry that opened it leaves its algorithm here for the dialog to pick
 * up — the same arrangement `lib/find.ts` has with the find bar.
 */

import { hashText, type HashAlgorithm } from './api';
import { t } from './i18n';
import { toast } from './toast';
import { activeView } from './views';

export const HASH_ALGORITHMS: readonly { id: HashAlgorithm; name: string; weak: boolean }[] = [
  { id: 'md5', name: 'MD5', weak: true },
  { id: 'sha1', name: 'SHA-1', weak: true },
  { id: 'sha224', name: 'SHA-224', weak: false },
  { id: 'sha256', name: 'SHA-256', weak: false },
  { id: 'sha384', name: 'SHA-384', weak: false },
  { id: 'sha512', name: 'SHA-512', weak: false },
];

export function algorithmName(id: HashAlgorithm): string {
  return HASH_ALGORITHMS.find((entry) => entry.id === id)?.name ?? id;
}

let requested: { algorithm: HashAlgorithm; source: 'text' | 'files' } = {
  algorithm: 'sha256',
  source: 'text',
};

export function requestHash(algorithm: HashAlgorithm, source: 'text' | 'files'): void {
  requested = { algorithm, source };
}

export function hashRequest(): { algorithm: HashAlgorithm; source: 'text' | 'files' } {
  return requested;
}

/** The selected text of the active editor, all ranges joined by line breaks. */
export function selectedText(): string {
  const view = activeView();
  if (!view) return '';
  const { state } = view;
  return state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => state.sliceDoc(range.from, range.to))
    .join(state.lineBreak);
}

/** Notepad++'s "generate from selection into clipboard", without a dialog. */
export async function hashSelectionToClipboard(algorithm: HashAlgorithm): Promise<void> {
  const text = selectedText();
  if (!text) {
    toast('info', t('Erst Text markieren, dann dessen Prüfsumme erzeugen.'));
    return;
  }
  const digest = await hashText(text, algorithm);
  try {
    await navigator.clipboard.writeText(digest);
    toast(
      'success',
      t('{algorithm} der Auswahl kopiert: {digest}', {
        algorithm: algorithmName(algorithm),
        digest,
      }),
    );
  } catch {
    toast(
      'error',
      t('Die Zwischenablage hat abgelehnt. {algorithm}: {digest}', {
        algorithm: algorithmName(algorithm),
        digest,
      }),
    );
  }
}
