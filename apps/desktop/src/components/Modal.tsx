/**
 * The dialog shell, and the focus trap underneath it.
 *
 * Every overlay in the app that is genuinely modal — the prompt host, settings,
 * about, go-to-line — is this component with something inside it. The find bar
 * and the project search are deliberately *not*: a modal over the text you are
 * searching is a bug wearing a hat, and those two are bars and panels instead.
 *
 * {@link useFocusTrap} is exported separately for the overlays that need the
 * keyboard behaviour but not the chrome — a floating palette that is its own
 * shape, say. The two are the same code, so a dialog and a palette can never
 * drift apart on what Escape does.
 *
 * This module does not decide *whether* a dialog is open. It is mounted when it
 * should be shown and unmounted when it should not; `lib/commands.ts` owns the
 * one dialog slot.
 */

import { useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { t } from '../lib/i18n';
import { Icon } from './Icon';

const FOCUSABLE =
  'input:not([disabled]), button:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * Open overlays, innermost last.
 *
 * A dialog can open another one — settings opens the about box — and only the
 * one on top may answer Escape or hold Tab. Without the stack, one Escape
 * closes both, and the user never sees the answer they came back for.
 */
const stack: HTMLElement[] = [];

function focusableIn(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * Keeps the keyboard inside `container` while it is mounted, closes it on
 * Escape, and puts focus back where it was on the way out.
 *
 * Focus always lands somewhere inside, even when nothing sensible wants it: the
 * container itself takes it as a last resort. Leaving focus behind in the page
 * means the next Enter presses whatever button happened to be under it, which
 * in a window full of tabs and toolbars is never the harmless one.
 *
 * `[data-autofocus]` wins when it is there — the prompt host points it at the
 * safe answer, so Enter can never discard a file by accident.
 */
export function useFocusTrap(container: RefObject<HTMLElement>, onEscape: () => void): void {
  // Escape must call the *current* handler, not the one from the render that
  // mounted the dialog: a form that asks before closing only learns that once
  // something has been typed into it.
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const first =
      element.querySelector<HTMLElement>('[data-autofocus]') ?? focusableIn(element)[0] ?? element;
    first.focus();
    stack.push(element);

    const onKeyDown = (event: KeyboardEvent) => {
      if (stack[stack.length - 1] !== element) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        escapeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const reachable = focusableIn(element);
      if (reachable.length === 0) {
        event.preventDefault();
        element.focus();
        return;
      }
      const head = reachable[0]!;
      const tail = reachable[reachable.length - 1]!;
      const here = document.activeElement;
      if (event.shiftKey && (here === head || here === element)) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && here === tail) {
        event.preventDefault();
        head.focus();
      }
    };

    // Capture, so the trap sees Escape before the window-wide shortcut
    // listener and before CodeMirror, whichever of them is underneath.
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      const at = stack.indexOf(element);
      if (at >= 0) stack.splice(at, 1);
      previous?.focus();
    };
  }, [container]);
}

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
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(dialogRef, onClose);

  return (
    <div className="modal-backdrop">
      <div
        ref={dialogRef}
        className="modal"
        data-size={wide ? 'wide' : 'default'}
        data-tone={tone}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="modal-head">
          <h2 id={titleId} className="modal-title">
            {title}
          </h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label={t('Schließen')}
            // Not the first thing Enter reaches: the cross is the way out, not
            // the answer, and dialogs put their real answer in the footer.
            data-secondary
          >
            <Icon name="close" size={14} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </div>
    </div>
  );
}

/**
 * Whether `element` is the overlay currently on top.
 *
 * For the bars that are not modal but still listen for Escape: the find bar
 * must not close itself when the Escape was meant for a dialog above it.
 */
export function isTopmostOverlay(element: HTMLElement | null): boolean {
  return element !== null && stack[stack.length - 1] === element;
}

export type { ModalProps };
