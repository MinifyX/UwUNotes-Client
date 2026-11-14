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
import { useEffect, type ReactNode } from 'react';
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
  // The package's Dialog closes and returns focus as it unmounts (in a layout effect, so before
  // this). If the opener is gone (the palette that opened this), the keyboard goes into the file.
  useEffect(
    () => () => {
      const here = document.activeElement;
      if (!here || here === document.body) focusActiveView();
    },
    [],
  );

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
      <div className="modal-body">{children}</div>
    </Dialog>
  );
}

export type { ModalProps };
