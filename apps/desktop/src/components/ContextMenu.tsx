/**
 * A menu that opens where the pointer is.
 *
 * Used by the tab bar's right-click menu and by the status bar's little
 * pickers, which are the same thing wearing a different hat: a short list of
 * things to do, anchored to a point, gone the moment attention moves elsewhere.
 *
 * The menu itself is the suite's `Menu` (`@uwusuite/design`), opened in its
 * controlled mode from an invisible zero-size trigger parked at the pointer —
 * the adapter `docs/migration.md` in the design package describes. Keyboard
 * handling, focus, Escape, the outside click, the look and the pop all come
 * from there, the same as in every other app of the suite.
 *
 * What stays here: the placement against the window edges, and closing on a
 * scroll, a resize or the window losing focus. A menu that survives any of
 * those ends up floating over a window it no longer belongs to — most visibly
 * after alt-tabbing back into the app.
 *
 * It does NOT own its own open state. Whoever opens it renders it and passes
 * `onClose`; there is no singleton menu manager, because two menus are never
 * open at once anyway — opening one closes the other by outside-click.
 */

import { ICONS, Menu, type MenuEntry } from '@uwusuite/design';
import { useEffect } from 'react';
import { t } from '../lib/i18n';

export type ContextMenuItem = {
  id: string;
  label: string;
  /** Shown greyed and skipped by the arrow keys. */
  disabled?: boolean;
  /** A tick in front, for a menu that shows a current choice. */
  checked?: boolean;
  /** This one loses something. Styled apart. */
  danger?: boolean;
  run: () => void;
};

type ContextMenuProps = {
  /** Viewport coordinates of the corner the menu grows from. */
  x: number;
  y: number;
  items: ContextMenuItem[];
  /** Named for screen readers, on the trigger the menu belongs to. */
  label?: string;
  onClose: () => void;
  /**
   * `up` grows the menu above `y` instead of below it — what the status bar
   * wants, since it sits on the bottom edge and there is never room downwards.
   * Without it the menu opens upwards on its own in the lower half of the window.
   */
  grow?: 'down' | 'up';
};

/** The suite menu is at most 360 px wide; nearer the right edge it opens leftwards. */
const MENU_MAX_WIDTH = 360;

export function ContextMenu({ x, y, items, label, onClose, grow }: ContextMenuProps) {
  useEffect(() => {
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    // Capture, because the scroll that matters is usually a pane's, not the
    // window's, and a pane's scroll event does not bubble.
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  const side = (grow ?? (y > window.innerHeight / 2 ? 'up' : 'down')) === 'up' ? 'above' : 'below';
  const align = x > window.innerWidth - MENU_MAX_WIDTH ? 'end' : 'start';
  // Any tick in the menu gives every item the same gutter, so the labels line up.
  const anyChecked = items.some((item) => item.checked !== undefined);

  const entries: MenuEntry[] = items.map((item) => ({
    label: item.label,
    disabled: item.disabled,
    danger: item.danger,
    icon: item.checked ? ICONS.done : anyChecked ? BLANK_ICON : undefined,
    onSelect: item.run,
  }));

  return (
    <div className="contextmenu-anchor" style={{ left: `${x}px`, top: `${y}px` }}>
      <Menu
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        side={side}
        align={align}
        items={entries}
        trigger={(props) => (
          <button
            type="button"
            className="contextmenu-trigger"
            tabIndex={-1}
            aria-label={label ?? t('Menü')}
            {...props}
          />
        )}
      />
    </div>
  );
}

/** An empty icon of the same size, so unticked items keep the gutter a ticked one has. */
const BLANK_ICON = (({ size, className }: { size?: number; className?: string }) => (
  <svg width={size} height={size} className={className} aria-hidden focusable="false" />
)) as unknown as typeof ICONS.done;
