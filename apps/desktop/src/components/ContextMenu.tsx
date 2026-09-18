/**
 * A menu that opens where the pointer is.
 *
 * Used by the tab bar's right-click menu and by the status bar's little
 * pickers, which are the same thing wearing a different hat: a short list of
 * things to do, anchored to a point, gone the moment attention moves elsewhere.
 *
 * It closes on Escape, on a click anywhere else, on a scroll or a resize
 * underneath it, and when the window loses focus. All five, because a menu that
 * survives any one of them ends up floating over a window it no longer belongs
 * to — most visibly after alt-tabbing back into the app.
 *
 * It does NOT own its own open state. Whoever opens it renders it and passes
 * `onClose`; there is no singleton menu manager, because two menus are never
 * open at once anyway — opening one closes the other by outside-click.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../lib/i18n';
import { Icon } from './Icon';

export type ContextMenuItem = {
  id: string;
  label: string;
  /** Shown greyed and skipped by the arrow keys. */
  disabled?: boolean;
  /** A tick in the gutter, for a menu that shows a current choice. */
  checked?: boolean;
  /** This one loses something. Styled apart, never the initially focused item. */
  danger?: boolean;
  run: () => void;
};

type ContextMenuProps = {
  /** Viewport coordinates of the corner the menu grows from. */
  x: number;
  y: number;
  items: ContextMenuItem[];
  /**
   * Named for screen readers, which announce the menu before its first item.
   * Optional, because a menu whose items speak for themselves would otherwise
   * be forced to invent a title nobody needs.
   */
  label?: string;
  onClose: () => void;
  /**
   * `up` grows the menu above `y` instead of below it — what the status bar
   * wants, since it sits on the bottom edge and there is never room downwards.
   */
  grow?: 'down' | 'up';
};

/** Keeps the menu inside the window, however close to an edge it was opened. */
const MARGIN = 8;

export function ContextMenu({ x, y, items, label, onClose, grow = 'down' }: ContextMenuProps) {
  const menuLabel = label ?? t('Menü');
  const menuRef = useRef<HTMLDivElement>(null);
  // Two menus can be mounted at once mid-transition, so the item ids that
  // `aria-activedescendant` points at have to be unique per menu, not per label.
  const prefix = useId();
  const [position, setPosition] = useState({ left: x, top: y });
  const enabled = items.filter((item) => !item.disabled);
  const [activeId, setActiveId] = useState(() => enabled.find((item) => !item.danger)?.id ?? '');

  // Measured after the first paint, because where the menu fits depends on how
  // tall it turned out — which depends on the translated labels inside it.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const box = menu.getBoundingClientRect();
    const maxLeft = window.innerWidth - box.width - MARGIN;
    const maxTop = window.innerHeight - box.height - MARGIN;
    const wantedTop = grow === 'up' ? y - box.height : y;
    setPosition({
      left: Math.max(MARGIN, Math.min(x, maxLeft)),
      top: Math.max(MARGIN, Math.min(wantedTop, maxTop)),
    });
    menu.focus();
  }, [x, y, grow]);

  useEffect(() => {
    // Pointerdown rather than click: the menu has to be gone before whatever
    // was clicked reacts, or the click lands on a control under a stale menu.
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      onClose();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    // Capture, because the scroll that matters is usually a pane's, not the
    // window's, and a pane's scroll event does not bubble.
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  const step = (delta: number) => {
    if (enabled.length === 0) return;
    const at = enabled.findIndex((item) => item.id === activeId);
    const next = enabled[(at + delta + enabled.length) % enabled.length];
    if (next) setActiveId(next.id);
  };

  const choose = (item: ContextMenuItem) => {
    if (item.disabled) return;
    // Closed first: several items open something of their own, and a menu still
    // on screen behind a dialog is a menu that eats the dialog's first click.
    onClose();
    item.run();
  };

  return (
    <div
      ref={menuRef}
      className="contextmenu"
      role="menu"
      aria-label={menuLabel}
      aria-activedescendant={activeId ? `${prefix}${activeId}` : undefined}
      tabIndex={-1}
      style={{ left: `${position.left}px`, top: `${position.top}px` }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          step(1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          step(-1);
        } else if (event.key === 'Home') {
          event.preventDefault();
          if (enabled[0]) setActiveId(enabled[0].id);
        } else if (event.key === 'End') {
          event.preventDefault();
          const last = enabled[enabled.length - 1];
          if (last) setActiveId(last.id);
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          const item = enabled.find((entry) => entry.id === activeId);
          if (item) choose(item);
        } else if (event.key === 'Tab') {
          // Nothing behind the menu is reachable while it is open, and Tab out
          // of it would leave it hanging over a control it does not belong to.
          event.preventDefault();
          onClose();
        }
      }}
    >
      {items.map((item) => (
        <div
          key={item.id}
          id={`${prefix}${item.id}`}
          role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
          aria-checked={item.checked}
          className="contextmenu-item"
          data-active={item.id === activeId}
          data-danger={item.danger ? true : undefined}
          aria-disabled={item.disabled}
          onPointerEnter={() => !item.disabled && setActiveId(item.id)}
          onClick={() => choose(item)}
        >
          <span className="contextmenu-tick" aria-hidden>
            {item.checked ? <Icon name="check" size={13} /> : null}
          </span>
          <span className="contextmenu-label">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
