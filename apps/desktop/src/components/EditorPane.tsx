/**
 * One pane: a tab bar, and the single CodeMirror view underneath it.
 *
 * The rule this whole file exists to enforce is that a pane has **one**
 * `EditorView` for its entire life. Switching tabs calls `view.setState()` with
 * the other document's state; it does not build a second view and it does not
 * unmount the first. Recreating the view on every tab change would throw away
 * the scroll position, the measured line heights and the DOM CodeMirror just
 * built, and the switch would visibly flicker — on a large file, for most of a
 * second.
 *
 * The state itself lives in `lib/documents.ts`, not here. This component is a
 * window onto it: the view's `dispatch` writes the new state straight back to
 * the store, so a document carries its text, selection and undo history from
 * pane to pane and across a tab switch without React ever holding any of it.
 *
 * What it does not do: decide which document is shown (that is
 * `lib/workspace.ts`), configure the editor (that is `editor/setup.ts`), or ask
 * anything before closing (that is `lib/files.ts`).
 */

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { applyDocLanguage } from '../editor/setup';
import {
  documentsVersion,
  getDoc,
  setDocState,
  subscribeDocuments,
  type DocId,
} from '../lib/documents';
import type { PaneId } from '../lib/layout';
import { takeRestoredScroll } from '../lib/session';
import { registerView } from '../lib/views';
import { focusPane, useWorkspace } from '../lib/workspace';
import { EmptyPane } from './EmptyPane';
import { TabBar } from './TabBar';

export function EditorPane({ pane }: { pane: PaneId }) {
  const workspace = useWorkspace();
  // Metadata changes are what reload, rename and the dirty flag announce. The
  // resync effect below needs to hear them; text changes deliberately do not
  // reach React at all.
  const version = useSyncExternalStore(subscribeDocuments, documentsVersion);

  const docId = workspace.panes[pane]?.active ?? null;
  const isActivePane = workspace.activePane === pane;

  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  /** What the view is showing right now. Read by `dispatch`, which has no props. */
  const shownRef = useRef<DocId | null>(null);
  /** Where each document was scrolled to when we last looked away from it. */
  const scrollByDoc = useRef(new Map<DocId, number>());

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const view = new EditorView({
      parent: host,
      // Every transaction the editor produces ends up in the store, which is
      // what makes the store — and not this component — the owner of the text.
      // `shownRef` rather than `docId`, because this closure is built once and
      // the tab under it changes many times.
      dispatchTransactions: (transactions, target) => {
        target.update(transactions);
        const id = shownRef.current;
        if (id) setDocState(id, target.state);
      },
    });
    viewRef.current = view;
    const unregister = registerView(pane, view);

    return () => {
      unregister();
      view.destroy();
      viewRef.current = null;
      shownRef.current = null;
    };
  }, [pane]);

  // Swapping the document in. The one place `setState` is allowed.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const previous = shownRef.current;
    if (previous === docId) return;

    if (previous) scrollByDoc.current.set(previous, view.scrollDOM.scrollTop);
    shownRef.current = docId;

    if (!docId) {
      // A bare state, so the pane does not keep a closed document's text — and
      // its undo history — alive behind the empty-pane screen.
      view.setState(EditorState.create());
      return;
    }

    const doc = getDoc(docId);
    if (!doc) return;
    view.setState(doc.state);
    // The session's offset wins the first time a restored document is shown;
    // after that it is whatever this pane remembers.
    const scrollTop = takeRestoredScroll(docId) ?? scrollByDoc.current.get(docId) ?? 0;
    if (scrollTop > 0) {
      // Twice: once now, and once after CodeMirror has measured the document it
      // has only just been handed. Until it has, the scroll container is barely
      // taller than the viewport and the browser clamps the offset back to the
      // top — which is how a restored tab opens at line 1 instead of line 900.
      view.scrollDOM.scrollTop = scrollTop;
      view.requestMeasure({
        read: () => undefined,
        write: () => {
          view.scrollDOM.scrollTop = scrollTop;
        },
      });
    }
    void applyDocLanguage(docId);
  }, [docId]);

  /**
   * Catches a document whose state was replaced behind the view's back.
   *
   * Reloading from disk rebuilds the state in the store, and a view that is
   * showing that document would otherwise keep displaying the old text
   * forever. Comparing the state objects is exact and free: every ordinary
   * edit writes the view's own state back through `dispatch`, so they are the
   * same object except in precisely the case that needs fixing.
   */
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !docId || shownRef.current !== docId) return;
    const doc = getDoc(docId);
    if (!doc || doc.state === view.state) return;
    const scrollTop = view.scrollDOM.scrollTop;
    view.setState(doc.state);
    view.scrollDOM.scrollTop = scrollTop;
  }, [docId, version]);

  /**
   * Puts the keyboard in the editor when this pane becomes the active one.
   *
   * Splitting, F6 and closing a pane all move the active pane without moving
   * the DOM focus, and a caret that is not where the highlight says it is makes
   * the next keystroke go somewhere surprising.
   *
   * Focus already inside this pane is left alone: that is the user arrow-keying
   * along the tab bar, and yanking them into the text would end the trip after
   * one tab. A *click* on a tab does want the editor, and the tab bar says so
   * itself rather than being guessed at from here.
   */
  useEffect(() => {
    if (!isActivePane) return;
    if (rootRef.current?.contains(document.activeElement)) return;
    viewRef.current?.focus();
  }, [isActivePane, docId]);

  return (
    <div
      ref={rootRef}
      className="editorpane"
      data-pane={pane}
      data-active={isActivePane}
      data-empty={docId === null}
      // Capture, because the click that focuses a tab button or the editor
      // never reaches this element on the way up.
      onFocusCapture={() => focusPane(pane)}
    >
      <TabBar pane={pane} />
      <div className="editorpane-body">
        <div className="editorpane-host" ref={hostRef} hidden={docId === null} />
        {docId === null ? <EmptyPane pane={pane} /> : null}
      </div>
    </div>
  );
}
