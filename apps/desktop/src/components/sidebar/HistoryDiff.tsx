/**
 * One version against the text in the editor, side by side.
 *
 * The compare feature in `lib/compare.ts` works on two panes and two open
 * documents, and a version is neither: it is a string that only exists for as
 * long as this dialog does. So this builds its own pair of read-only editors —
 * but with the same pieces: `@codemirror/merge`'s chunks, the decorations from
 * `editor/compare.ts`, and `mapLine` for the scroll sync. A difference looks
 * exactly as it does when two files are compared, red on the left for what the
 * version had, green on the right for what the text has now.
 *
 * The right side is the text as it was when the dialog opened. The dialog is
 * modal, so it cannot drift while it is open.
 */

import { Chunk } from '@codemirror/merge';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { HistoryVersion } from '../../lib/api';
import { mapLine } from '../../lib/compare';
import { getDoc } from '../../lib/documents';
import {
  closeHistoryDiff,
  copyVersion,
  deleteVersion,
  openHistoryDiff,
  openVersionAsTab,
  readVersion,
  REASON_LABELS,
  restoreVersion,
  type HistoryDiffTarget,
} from '../../lib/history';
import { locale, t, useLanguage } from '../../lib/i18n';
import { getSettings } from '../../lib/settings';
import { setDiffEffect, compareExtension, type CompareSide } from '../../editor/compare';
import { languageCompartment, settingsExtensions } from '../../editor/setup';
import { Modal } from '../Modal';

/** Same budget as the file comparison: a coarser diff beats a frozen window. */
const DIFF_BUDGET_MS = 400;

type Props = {
  target: HistoryDiffTarget;
  /** The timeline, newest first, for stepping to the next older or newer one. */
  versions: readonly HistoryVersion[];
};

export function HistoryDiff({ target, versions }: Props) {
  useLanguage();
  const { docId, version } = target;
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const views = useRef<{ left: EditorView; right: EditorView; chunks: readonly Chunk[] } | null>(
    null,
  );
  const [text, setText] = useState<string | null>(null);
  const [differences, setDifferences] = useState<number | null>(null);
  const [coarse, setCoarse] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setText(null);
    void readVersion(docId, version).then((loaded) => {
      if (!live) return;
      // The reason is already on screen as a toast; an empty diff would only
      // pretend there was something to compare.
      if (loaded === null) closeHistoryDiff();
      else setText(loaded);
    });
    return () => {
      live = false;
    };
  }, [docId, version]);

  useEffect(() => {
    const doc = getDoc(docId);
    if (text === null || !doc || !leftRef.current || !rightRef.current) return;

    const extensions: Extension = [
      settingsExtensions(getSettings()),
      languageCompartment.get(doc.state) ?? [],
      compareExtension,
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
    ];
    const left = new EditorView({
      state: EditorState.create({ doc: text, extensions }),
      parent: leftRef.current,
    });
    const right = new EditorView({
      state: EditorState.create({ doc: doc.state.doc, extensions }),
      parent: rightRef.current,
    });
    const chunks = Chunk.build(left.state.doc, right.state.doc, {
      scanLimit: 2000,
      timeout: DIFF_BUDGET_MS,
    });
    left.dispatch({ effects: setDiffEffect.of({ side: 'a', chunks }) });
    right.dispatch({ effects: setDiffEffect.of({ side: 'b', chunks }) });
    views.current = { left, right, chunks };
    setDifferences(chunks.length);
    setCoarse(chunks.some((chunk) => !chunk.precise));

    const stopSync = syncScroll(left, right, chunks);
    const first = chunks[0];
    if (first) {
      left.dispatch({ effects: EditorView.scrollIntoView(first.fromA, { y: 'center' }) });
    }

    return () => {
      stopSync();
      views.current = null;
      left.destroy();
      right.destroy();
    };
  }, [docId, text]);

  const step = (back: boolean) => {
    const current = views.current;
    if (!current || current.chunks.length === 0) return;
    const { left, chunks } = current;
    const top = left.lineBlockAtHeight(left.scrollDOM.scrollTop + left.scrollDOM.clientHeight / 2);
    const middle = top.from;
    const starts = chunks.map((chunk) => Math.min(left.state.doc.length, chunk.fromA));
    let index = back
      ? starts
          .map((pos, i) => (pos < middle - 1 ? i : -1))
          .filter((i) => i >= 0)
          .pop()
      : starts.findIndex((pos) => pos > middle + 1);
    if (index === undefined || index < 0) index = back ? starts.length - 1 : 0;
    left.dispatch({ effects: EditorView.scrollIntoView(starts[index]!, { y: 'center' }) });
  };

  const at = versions.findIndex((entry) => entry.id === version.id);
  const older = at >= 0 ? versions[at + 1] : undefined;
  const newer = at > 0 ? versions[at - 1] : undefined;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const when = new Date(version.time).toLocaleString(locale(), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const status =
    differences === null
      ? '…'
      : differences === 0
        ? t('Keine Unterschiede')
        : differences === 1
          ? t('1 Unterschied')
          : t('{count} Unterschiede', { count: differences });

  return createPortal(
    <Modal
      title={t('Version von {time}', { time: when })}
      onClose={closeHistoryDiff}
      wide
      footer={
        <>
          <button
            type="button"
            className="history-diff-action"
            data-tone="danger"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (await deleteVersion(docId, version)) closeHistoryDiff();
              })
            }
          >
            {t('Version löschen')}
          </button>
          <span className="history-diff-spacer" />
          <button
            type="button"
            className="history-diff-action"
            disabled={busy || text === null}
            onClick={() => void run(() => copyVersion(docId, version))}
          >
            {t('Kopieren')}
          </button>
          <button
            type="button"
            className="history-diff-action"
            disabled={busy || text === null}
            onClick={() =>
              void run(async () => {
                closeHistoryDiff();
                await openVersionAsTab(docId, version);
              })
            }
          >
            {t('Als neuen Tab öffnen')}
          </button>
          <button
            type="button"
            className="history-diff-action"
            data-tone="primary"
            disabled={busy || text === null || differences === 0}
            onClick={() =>
              void run(async () => {
                if (await restoreVersion(docId, version)) closeHistoryDiff();
              })
            }
          >
            {t('Diese Version wiederherstellen')}
          </button>
        </>
      }
    >
      <div className="history-diff">
        <div className="history-diff-bar">
          <span className={`history-badge history-badge-${version.reason}`}>
            {t(REASON_LABELS[version.reason])}
          </span>
          <span className="history-diff-status" role="status">
            {status}
            {coarse ? ` · ${t('grob, die Dateien sind sehr verschieden')}` : ''}
          </span>
          <span className="history-diff-spacer" />
          <button
            type="button"
            className="history-diff-step"
            disabled={!differences}
            onClick={() => step(true)}
            aria-label={t('Vorheriger Unterschied')}
            title={t('Vorheriger Unterschied')}
          >
            <span aria-hidden>↑</span>
          </button>
          <button
            type="button"
            className="history-diff-step"
            disabled={!differences}
            onClick={() => step(false)}
            aria-label={t('Nächster Unterschied')}
            title={t('Nächster Unterschied')}
          >
            <span aria-hidden>↓</span>
          </button>
          <button
            type="button"
            className="history-diff-step"
            disabled={!older}
            onClick={() => older && openHistoryDiff(docId, older)}
            title={t('Ältere Version')}
          >
            {t('‹ Älter')}
          </button>
          <button
            type="button"
            className="history-diff-step"
            disabled={!newer}
            onClick={() => newer && openHistoryDiff(docId, newer)}
            title={t('Neuere Version')}
          >
            {t('Neuer ›')}
          </button>
        </div>
        <div className="history-diff-heads" aria-hidden>
          <span className="history-diff-head history-diff-head-a">{t('Diese Version')}</span>
          <span className="history-diff-head history-diff-head-b">{t('Aktueller Text')}</span>
        </div>
        <div className="history-diff-panes">
          <div
            ref={leftRef}
            className="history-diff-pane"
            aria-label={t('Diese Version')}
            role="region"
          />
          <div
            ref={rightRef}
            className="history-diff-pane"
            aria-label={t('Aktueller Text')}
            role="region"
          />
        </div>
      </div>
    </Modal>,
    document.body,
  );
}

/**
 * Scroll one side and the other follows, through the chunks rather than by
 * line number — the same mapping as the file comparison. The side that was
 * moved by the other is ignored until the next frame, or the two would bounce.
 */
function syncScroll(left: EditorView, right: EditorView, chunks: readonly Chunk[]): () => void {
  let following: HTMLElement | null = null;
  let released = 0;

  const follow = (source: EditorView, follower: EditorView, side: CompareSide) => () => {
    if (following === source.scrollDOM) return;
    const top = source.scrollDOM.scrollTop;
    const block = source.lineBlockAtHeight(top);
    const within = block.height > 0 ? (top - block.top) / block.height : 0;
    const line = source.state.doc.lineAt(block.from).number;
    const partner = mapLine(line, source.state.doc, follower.state.doc, chunks, side);
    const target = follower.lineBlockAt(follower.state.doc.line(partner).from);
    following = follower.scrollDOM;
    follower.scrollDOM.scrollTop = target.top + within * target.height;
    follower.scrollDOM.scrollLeft = source.scrollDOM.scrollLeft;
    cancelAnimationFrame(released);
    released = requestAnimationFrame(() => {
      following = null;
    });
  };

  const fromLeft = follow(left, right, 'a');
  const fromRight = follow(right, left, 'b');
  left.scrollDOM.addEventListener('scroll', fromLeft);
  right.scrollDOM.addEventListener('scroll', fromRight);
  return () => {
    left.scrollDOM.removeEventListener('scroll', fromLeft);
    right.scrollDOM.removeEventListener('scroll', fromRight);
    cancelAnimationFrame(released);
  };
}
