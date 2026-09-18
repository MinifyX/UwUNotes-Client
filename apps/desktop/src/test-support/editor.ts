/**
 * An editor a test can drive, wired up the way the running app wires one.
 *
 * Playback in `lib/macros.ts` finds its editor through `lib/views.ts`, which
 * asks `lib/workspace.ts` which pane is active. A view that is merely
 * constructed is invisible to all of that, so this registers it — which is also
 * the only honest way to test playback: if the registration is wrong, nothing
 * plays, exactly as in the app.
 */

import { history } from '@codemirror/commands';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { editorKeymap } from '../editor/keymap';
import { recordingExtension } from '../editor/recording';
import { registerView } from '../lib/views';
import { getWorkspace } from '../lib/workspace';
import { installFakeLayout } from './fake-layout';

export type MountedEditor = {
  view: EditorView;
  /** Takes the view back out of `lib/views.ts` and off the page. */
  dispose: () => void;
};

/**
 * The app's own keymap, history and recording extension — the three that have
 * to be in the same editor for any of this to mean anything. The recorder
 * shadows the keymap at `Prec.highest` and hands every key on to it, so a test
 * that pressed a key without the keymap underneath would record a step for a
 * caret that never moved.
 */
export function mountEditor(doc: string, extra: Extension = []): MountedEditor {
  installFakeLayout();
  const parent = document.createElement('div');
  document.body.appendChild(parent);

  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [history(), editorKeymap, recordingExtension(), extra],
    }),
    parent,
  });
  // The fake layout puts line 0 at y=0; the real stylesheet's 4px of content
  // padding would put everything 4px out of step with it, and jsdom applies
  // that rule or not depending on its mood about `<style>` elements.
  view.contentDOM.style.padding = '0';

  const unregister = registerView(getWorkspace().activePane, view);
  return {
    view,
    dispose: () => {
      unregister();
      view.destroy();
      parent.remove();
    },
  };
}

/**
 * Types, the way a keyboard does rather than the way a program does.
 *
 * `view.dispatch()` would put the text in without anything noticing it was
 * typed, and the recorder only reports characters it sees arrive as *input* —
 * so this does what a browser does: it changes the text in the line's DOM and
 * lets CodeMirror's mutation observer find out. The `await` is that finding
 * out; it happens in a microtask, exactly as it does in the app.
 *
 * Only for a line that already has text in it. An empty line is a `<br>` with
 * nowhere to put a character, and faking that is faking the browser's job.
 */
export async function typeInto(view: EditorView, text: string): Promise<void> {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  const node = view.contentDOM.children[line.number - 1]?.firstChild;
  if (!node || node.nodeType !== Node.TEXT_NODE) {
    throw new Error(`line ${line.number} has no text to type into`);
  }
  const existing = node.nodeValue ?? '';
  const column = head - line.from;
  node.nodeValue = existing.slice(0, column) + text + existing.slice(column);
  await Promise.resolve();
}
