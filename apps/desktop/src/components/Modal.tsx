/**
 * The dialog shell: the suite's `Dialog` with the app's body padding.
 *
 * Every overlay in the app that is genuinely modal — the prompt host, settings,
 * about, go-to-line — is this component with something inside it. The find bar
 * and the project search are deliberately *not*: a modal over the text you are
 * searching is a bug wearing a hat, and those two are bars and panels instead.
 *
 * The package's `<dialog>` brings the inert window behind it, the focus trap,
 * Escape (only the innermost of stacked dialogs answers it) and focus going
 * back where it came from.
 *
 * This module does not decide *whether* a dialog is open. It is mounted when it
 * should be shown and unmounted when it should not; `lib/commands.ts` owns the
 * one dialog slot.
 */

import { Dialog } from '@uwusuite/design';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { focusActiveView } from '../lib/views';

type ModalProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Buttons along the bottom edge. */
  footer?: ReactNode;
  /** Room for a section list beside the content. The settings page needs it. */
  wide?: boolean;
  /** A warning wants its own colour, so it never reads as routine. */
  tone?: 'default' | 'warning';
};

/**
 * A centred dialog with a backdrop.
 *
 * A click on the backdrop does nothing on purpose. Closing by a stray click
 * throws away whatever was typed, and every dialog here has a real way out:
 * Escape, the corner cross, or one of its own buttons.
 */
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide = false,
  tone = 'default',
}: ModalProps) {
  const body = useRef<HTMLDivElement>(null);

  // shortcut: the package's Dialog does not close() itself when it unmounts, and a removed
  // <dialog> gives focus back to nobody. Drop this once @uwusuite/design does it.
  useLayoutEffect(() => {
    const dialog = body.current?.closest('dialog');
    return () => {
      if (!dialog?.open) return;
      // The close event would reach the Dialog's onClose, which after StrictMode's test
      // remount closes the dialog for real.
      dialog.addEventListener('close', (event) => event.stopImmediatePropagation(), {
        capture: true,
        once: true,
      });
      dialog.close();
      // closeDialog() aims for the text, but it was inert then; and the invoker may be gone
      // (the palette that opened this). Either way the keyboard goes back into the file.
      const here = document.activeElement;
      if (!here || here === document.body || dialog.contains(here)) focusActiveView();
    };
  }, []);

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      width={wide ? 'lg' : 'md'}
      tone={tone}
      footer={footer}
      className={wide ? 'modal-wide' : undefined}
    >
      <div ref={body} className="modal-body">
        {children}
      </div>
    </Dialog>
  );
}

export type { ModalProps };
