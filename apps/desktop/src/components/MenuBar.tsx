/**
 * The menu row: Datei, Suchen, Ansicht, Codierung, Sprache, Einstellungen,
 * Werkzeuge — each a drop-down, some with submenus.
 *
 * The menus are data (`lib/menus.ts`) and every entry runs a command, so a menu
 * item, a toolbar icon, a shortcut and a palette entry are one code path. This
 * component is only the part that has to be a menu: opening, hovering across,
 * submenus that fly out to the side, and the keyboard.
 *
 * The keyboard is the Windows menu bar's. Down or Enter opens, Left and Right
 * walk across the bar — or into and out of a submenu when one is under the
 * highlight — Up and Down walk an open list, Escape closes one level, and Home
 * and End jump to the ends. A menu that closes hands the keyboard back to the
 * editor, never to the button it was opened from, because the next keystroke is
 * almost always meant for the text.
 *
 * Lists are built when they open, not before: the recent files, the ticked
 * encoding and the greyed-out entries are read at that moment, so a menu never
 * shows yesterday's state.
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { t, useLanguage } from '../lib/i18n';
import type { MenuEntry, TopMenu } from '../lib/menus';
import { focusActiveView } from '../lib/views';
import { Icon } from './Icon';

/** Keeps a list inside the window however close to an edge it opens. */
const MARGIN = 6;

type MenuBarProps = { menus: readonly TopMenu[] };

/** Where a list opens from, as plain numbers so an effect can depend on them. */
type Anchor = { left: number; right: number; top: number; bottom: number };

function anchorOf(element: Element | undefined): Anchor | undefined {
  if (!element) return undefined;
  const { left, right, top, bottom } = element.getBoundingClientRect();
  return { left, right, top, bottom };
}

export function MenuBar({ menus }: MenuBarProps) {
  useLanguage();
  const [open, setOpen] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  const close = useCallback((refocus = true) => {
    setOpen(null);
    if (refocus) focusActiveView();
  }, []);

  // Outside clicks, a lost window focus and a resize all close the menu, like
  // every native menu bar: a menu left hanging over a window it no longer
  // belongs to is worse than one that closed too eagerly.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-menu-surface]')) return;
      close(false);
    };
    const onBlur = () => close(false);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', onBlur);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onBlur);
    };
  }, [open, close]);

  const step = (from: string, delta: number) => {
    const at = menus.findIndex((menu) => menu.id === from);
    const next = menus[(at + delta + menus.length) % menus.length];
    if (next) setOpen(next.id);
  };

  const openMenu = menus.find((menu) => menu.id === open);
  const anchor = open ? anchorOf(buttons.current.get(open)) : undefined;

  return (
    <div className="menubar" ref={barRef} role="menubar" aria-label={t('Menü')} data-menu-surface>
      {menus.map((menu) => (
        <button
          key={menu.id}
          ref={(element) => {
            if (element) buttons.current.set(menu.id, element);
            else buttons.current.delete(menu.id);
          }}
          type="button"
          className="menubar-item"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={open === menu.id}
          data-open={open === menu.id ? true : undefined}
          onClick={() => setOpen(open === menu.id ? null : menu.id)}
          // Hovering across the bar switches menus only while one is open —
          // the Windows behaviour, and the reason a menu bar is quick to browse.
          onPointerEnter={() => {
            if (open && open !== menu.id) setOpen(menu.id);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setOpen(menu.id);
            } else if (event.key === 'ArrowRight') {
              event.preventDefault();
              buttons.current.get(menus[(menus.indexOf(menu) + 1) % menus.length]!.id)?.focus();
            } else if (event.key === 'ArrowLeft') {
              event.preventDefault();
              buttons.current
                .get(menus[(menus.indexOf(menu) - 1 + menus.length) % menus.length]!.id)
                ?.focus();
            }
          }}
        >
          {menu.label()}
        </button>
      ))}

      {openMenu && anchor ? (
        <MenuList
          key={openMenu.id}
          label={openMenu.label()}
          entries={openMenu.items()}
          anchor={anchor}
          placement="below"
          onClose={() => close()}
          onLeft={() => step(openMenu.id, -1)}
          onRight={() => step(openMenu.id, 1)}
        />
      ) : null}
    </div>
  );
}

type MenuListProps = {
  label: string;
  entries: MenuEntry[];
  /** The button (or the parent item) the list opens from. */
  anchor: Anchor;
  placement: 'below' | 'side';
  /** Closes the whole menu, after an item ran or on Escape at the top level. */
  onClose: () => void;
  /** Left with nothing to go back into: the menu to the left, or the parent. */
  onLeft: () => void;
  /** Right on an item that has no submenu: the next menu along the bar. */
  onRight?: () => void;
};

function MenuList({ label, entries, anchor, placement, onClose, onLeft, onRight }: MenuListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const prefix = useId();
  const usable = entries.filter(
    (entry): entry is Exclude<MenuEntry, { kind: 'separator' }> =>
      entry.kind !== 'separator' && !entry.disabled,
  );
  const [active, setActive] = useState<string>(usable[0]?.id ?? '');
  const [sub, setSub] = useState<string | null>(null);
  const [position, setPosition] = useState({
    left: placement === 'below' ? anchor.left : anchor.right - 2,
    top: placement === 'below' ? anchor.bottom : anchor.top - 5,
  });
  const itemRefs = useRef(new Map<string, HTMLDivElement>());

  // Measured after the first paint: how wide the list is depends on its
  // translated labels, and only then can it be kept on screen — a submenu that
  // would leave the window on the right opens to the left instead.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const box = list.getBoundingClientRect();
    let left = placement === 'below' ? anchor.left : anchor.right - 2;
    if (left + box.width > window.innerWidth - MARGIN) {
      left =
        placement === 'below'
          ? window.innerWidth - box.width - MARGIN
          : anchor.left - box.width + 2;
    }
    let top = placement === 'below' ? anchor.bottom : anchor.top - 5;
    if (top + box.height > window.innerHeight - MARGIN) {
      top = Math.max(MARGIN, window.innerHeight - box.height - MARGIN);
    }
    setPosition({ left: Math.max(MARGIN, left), top });
    list.focus({ preventScroll: true });
    // The four numbers, not the object: a fresh object every render would
    // measure, set, render and measure again for ever.
  }, [anchor.left, anchor.right, anchor.top, anchor.bottom, placement]);

  useEffect(() => {
    itemRefs.current.get(active)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const move = (delta: number) => {
    if (usable.length === 0) return;
    const at = usable.findIndex((entry) => entry.id === active);
    const next = usable[(at + delta + usable.length) % usable.length];
    if (next) setActive(next.id);
  };

  const choose = (entry: MenuEntry) => {
    if (entry.kind === 'separator' || entry.disabled) return;
    if (entry.kind === 'submenu') {
      setSub(entry.id);
      return;
    }
    // Closed first: several entries open a dialog of their own, and a menu
    // still on screen behind a dialog eats the dialog's first click.
    onClose();
    entry.run();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // A submenu that is open has the keyboard; its own list handles the keys.
    if (sub && event.target !== listRef.current) return;
    const current = usable.find((entry) => entry.id === active);
    let handled = true;
    if (event.key === 'ArrowDown') move(1);
    else if (event.key === 'ArrowUp') move(-1);
    else if (event.key === 'Home') setActive(usable[0]?.id ?? '');
    else if (event.key === 'End') setActive(usable[usable.length - 1]?.id ?? '');
    else if (event.key === 'Enter' || event.key === ' ') {
      if (current) choose(current);
    } else if (event.key === 'ArrowRight') {
      if (current?.kind === 'submenu') setSub(current.id);
      else onRight?.();
    } else if (event.key === 'ArrowLeft') onLeft();
    else if (event.key === 'Escape') {
      if (placement === 'side') onLeft();
      else onClose();
    } else if (event.key === 'Tab') onClose();
    else handled = false;
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const subEntry = entries.find(
    (entry): entry is Extract<MenuEntry, { kind: 'submenu' }> =>
      entry.kind === 'submenu' && entry.id === sub,
  );
  const subAnchor = sub ? anchorOf(itemRefs.current.get(sub)) : undefined;

  return (
    <>
      <div
        ref={listRef}
        className="menulist"
        role="menu"
        aria-label={label}
        aria-activedescendant={active ? `${prefix}${active}` : undefined}
        tabIndex={-1}
        data-menu-surface
        style={{ left: `${position.left}px`, top: `${position.top}px` }}
        onKeyDown={onKeyDown}
      >
        {entries.length === 0 ? <div className="menulist-empty">{t('Nichts hier.')}</div> : null}
        {entries.map((entry) => {
          if (entry.kind === 'separator') {
            return <div key={entry.id} className="menulist-separator" role="separator" />;
          }
          const isSub = entry.kind === 'submenu';
          return (
            <div
              key={entry.id}
              ref={(element) => {
                if (element) itemRefs.current.set(entry.id, element);
                else itemRefs.current.delete(entry.id);
              }}
              id={`${prefix}${entry.id}`}
              role={
                entry.kind === 'item' && entry.checked !== undefined
                  ? 'menuitemcheckbox'
                  : 'menuitem'
              }
              aria-checked={entry.kind === 'item' ? entry.checked : undefined}
              aria-haspopup={isSub ? 'menu' : undefined}
              aria-expanded={isSub ? sub === entry.id : undefined}
              aria-disabled={entry.disabled}
              className="menulist-item"
              data-active={entry.id === active ? true : undefined}
              title={entry.kind === 'item' ? entry.hint : undefined}
              onPointerEnter={() => {
                if (entry.disabled) return;
                setActive(entry.id);
                if (sub && !isSub) listRef.current?.focus({ preventScroll: true });
                setSub(isSub ? entry.id : null);
              }}
              onClick={() => choose(entry)}
            >
              <span className="menulist-tick" aria-hidden>
                {entry.kind === 'item' && entry.checked ? <Icon name="check" size={13} /> : null}
              </span>
              <span className="menulist-label">{entry.label}</span>
              {entry.kind === 'item' && entry.shortcut ? (
                <kbd className="menulist-shortcut">{entry.shortcut}</kbd>
              ) : null}
              {isSub ? <Icon name="chevronRight" size={12} className="menulist-more" /> : null}
            </div>
          );
        })}
      </div>
      {subEntry && subAnchor ? (
        <MenuList
          key={subEntry.id}
          label={subEntry.label}
          entries={subEntry.items()}
          anchor={subAnchor}
          placement="side"
          onClose={onClose}
          onLeft={() => {
            setSub(null);
            listRef.current?.focus({ preventScroll: true });
          }}
          onRight={onRight}
        />
      ) : null}
    </>
  );
}
