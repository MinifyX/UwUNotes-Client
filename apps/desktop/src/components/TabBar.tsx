/**
 * The row of tabs above one pane.
 *
 * One instance per pane, and every instance is a drop target for every other
 * one: a tab dragged out of this bar and let go over another pane moves there.
 *
 * ## Why not HTML5 drag and drop
 *
 * Because it does not arrive. The window has `dragDropEnabled` on so that files
 * dropped from Explorer open, and on Windows that handling swallows the
 * webview's own `dragstart`/`dragover`/`drop` events before any of them reach
 * JavaScript — the same wall UwUSSH hit, and the reason its `lib/dnd.ts` is
 * written the way it is. Pointer events always arrive, behave the same for
 * mouse, pen and touch, and let the drop indicator look like the rest of the
 * app.
 *
 * The indicator is set as a `data-` attribute straight onto the DOM rather than
 * held in React state, because the element that has to show it usually belongs
 * to a *different* pane's tab bar — a sibling component this one cannot reach
 * through props, and which has no business re-rendering because a pointer
 * passed over it.
 *
 * This bar asks nothing before closing a tab. `closeDocSafely` does that.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { asApiError, revealInFileManager } from '../lib/api';
import {
  documentsVersion,
  getMeta,
  subscribeDocuments,
  type DocId,
  type DocMeta,
} from '../lib/documents';
import { closeDocSafely, describeApiError, newFile } from '../lib/files';
import { useGitStatus } from '../lib/git';
import { t, useLanguage } from '../lib/i18n';
import { nextPane, paneCount, type PaneId } from '../lib/layout';
import { toast } from '../lib/toast';
import { focusActiveView } from '../lib/views';
import {
  activateDoc,
  focusPane,
  getWorkspace,
  moveTabToPane,
  reorderTab,
  useWorkspace,
} from '../lib/workspace';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { Icon } from './Icon';

/** A press shorter than this much movement is a click, not a drag. */
const DRAG_THRESHOLD = 5;

type DropTarget = { kind: 'reorder'; pane: PaneId; index: number } | { kind: 'pane'; pane: PaneId };

type DragState = {
  docId: DocId;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  target: DropTarget | null;
};

/** Elements currently carrying a drop marker, so they can all be cleared at once. */
const marked = new Set<HTMLElement>();

function clearMarkers() {
  for (const element of marked) {
    delete element.dataset.dropEdge;
    delete element.dataset.dropOver;
  }
  marked.clear();
}

function mark(element: HTMLElement, attribute: 'dropEdge' | 'dropOver', value: string) {
  element.dataset[attribute] = value;
  marked.add(element);
}

/** Where a pointer at these coordinates would put the tab, or nothing. */
function targetAt(clientX: number, clientY: number, dragged: DocId): DropTarget | null {
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    if (!(element instanceof HTMLElement)) continue;

    const strip = element.closest<HTMLElement>('[data-tabstrip]');
    const stripPane = strip?.dataset.tabstrip;
    if (strip && stripPane) {
      return { kind: 'reorder', pane: stripPane, index: insertionIndex(strip, clientX, dragged) };
    }

    const paneElement = element.closest<HTMLElement>('[data-pane]');
    const pane = paneElement?.dataset.pane;
    if (pane) return { kind: 'pane', pane };
  }
  return null;
}

/**
 * The index the tab would land at, counted over the *other* tabs — which is
 * exactly what `reorderTab` expects, since it takes the tab out of the list
 * before putting it back in.
 */
function insertionIndex(strip: HTMLElement, clientX: number, dragged: DocId): number {
  const others = [...strip.querySelectorAll<HTMLElement>('[data-tab-id]')].filter(
    (element) => element.dataset.tabId !== dragged,
  );
  for (let index = 0; index < others.length; index += 1) {
    const box = others[index]!.getBoundingClientRect();
    if (clientX < box.left + box.width / 2) return index;
  }
  return others.length;
}

/** Draws where the tab would go, in whichever pane the pointer is over. */
function showTarget(target: DropTarget | null, dragged: DocId) {
  clearMarkers();
  if (!target) return;
  if (target.kind === 'pane') {
    const paneElement = document.querySelector<HTMLElement>(`[data-pane="${target.pane}"]`);
    if (paneElement) mark(paneElement, 'dropOver', 'true');
    return;
  }
  const strip = document.querySelector<HTMLElement>(`[data-tabstrip="${target.pane}"]`);
  if (!strip) return;
  const others = [...strip.querySelectorAll<HTMLElement>('[data-tab-id]')].filter(
    (element) => element.dataset.tabId !== dragged,
  );
  const before = others[target.index];
  if (before) mark(before, 'dropEdge', 'before');
  else mark(strip, 'dropEdge', 'end');
}

export function TabBar({ pane }: { pane: PaneId }) {
  useLanguage();
  const workspace = useWorkspace();
  useSyncExternalStore(subscribeDocuments, documentsVersion);

  const tabs = workspace.panes[pane]?.tabs ?? [];
  const activeDoc = workspace.panes[pane]?.active ?? null;

  const stripRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [draggingDoc, setDraggingDoc] = useState<DocId | null>(null);
  const [menu, setMenu] = useState<{ docId: DocId; x: number; y: number } | null>(null);

  /**
   * The wheel, turned sideways.
   *
   * A native listener rather than `onWheel`, because React registers wheel
   * handlers as passive and a passive handler cannot stop the page from
   * scrolling somewhere else at the same time.
   */
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const onWheel = (event: WheelEvent) => {
      if (strip.scrollWidth <= strip.clientWidth) return;
      event.preventDefault();
      strip.scrollLeft += event.deltaY !== 0 ? event.deltaY : event.deltaX;
    };
    strip.addEventListener('wheel', onWheel, { passive: false });
    return () => strip.removeEventListener('wheel', onWheel);
  }, []);

  const endDrag = useCallback(
    (commit: boolean) => {
      const drag = dragRef.current;
      dragRef.current = null;
      clearMarkers();
      setDraggingDoc(null);
      if (!drag?.moved || !commit || !drag.target) return;
      const target = drag.target;
      if (target.kind === 'pane' || target.pane !== pane) {
        moveTabToPane(drag.docId, target.pane);
        return;
      }
      reorderTab(drag.docId, target.index);
      // The click that would normally have selected it was swallowed by the
      // pointer capture, and a tab you just dragged somewhere is the one you
      // meant to be looking at.
      activateDoc(drag.docId);
    },
    [pane],
  );

  // Escape abandons a drag in progress, the way it does everywhere else.
  useEffect(() => {
    if (!draggingDoc) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      endDrag(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [draggingDoc, endDrag]);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>, docId: DocId) => {
    if (event.button === 1) {
      // Middle click closes, as in every browser. Prevented, or Windows starts
      // its autoscroll ring instead.
      event.preventDefault();
      void closeDocSafely(docId);
      return;
    }
    if (event.button !== 0) return;
    dragRef.current = {
      docId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      target: null,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD) {
        return;
      }
      drag.moved = true;
      // Captured here and not on pointerdown, on purpose. Capturing retargets
      // the following `click` to this element, which is what kills the stray
      // "and also select it" after a drag — but it would equally kill the
      // ordinary click on a tab that never moved.
      event.currentTarget.setPointerCapture(event.pointerId);
      setDraggingDoc(drag.docId);
    }
    drag.target = targetAt(event.clientX, event.clientY, drag.docId);
    showTarget(drag.target, drag.docId);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    endDrag(true);
  };

  const menuItems = (docId: DocId): ContextMenuItem[] => {
    const meta = getMeta(docId);
    const path = meta?.path ?? null;
    const others = tabs.filter((id) => id !== docId);
    const workspaceNow = getWorkspace();
    const otherPane = nextPane(workspaceNow.layout, pane);
    return [
      { id: 'close', label: t('Schließen'), run: () => void closeDocSafely(docId) },
      {
        id: 'closeOthers',
        label: t('Andere schließen'),
        disabled: others.length === 0,
        run: () => void closeEach(others),
      },
      {
        id: 'closeAll',
        label: t('Alle schließen'),
        run: () => void closeEach([...tabs]),
      },
      {
        id: 'copyPath',
        label: t('Pfad kopieren'),
        disabled: path === null,
        run: () => void copyPath(path),
      },
      {
        id: 'reveal',
        label: t('Im Datei-Manager zeigen'),
        disabled: path === null,
        run: () => void reveal(path),
      },
      {
        id: 'moveToPane',
        label: t('In den anderen Bereich verschieben'),
        disabled: paneCount(workspaceNow.layout) < 2 || otherPane === pane,
        run: () => moveTabToPane(docId, otherPane),
      },
    ];
  };

  return (
    <div className="tabbar">
      <div
        ref={stripRef}
        className="tabbar-strip"
        data-tabstrip={pane}
        role="tablist"
        aria-label={t('Offene Dateien')}
        aria-orientation="horizontal"
      >
        {tabs.map((docId, index) => (
          <Tab
            key={docId}
            docId={docId}
            index={index}
            tabs={tabs}
            active={docId === activeDoc}
            dragging={docId === draggingDoc}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => endDrag(false)}
            onContextMenu={(x, y) => setMenu({ docId, x, y })}
          />
        ))}
      </div>
      <button
        type="button"
        className="tabbar-new"
        onClick={() => {
          // The new buffer belongs in the bar that was clicked, and `newFile`
          // puts it in the active pane.
          focusPane(pane);
          newFile();
        }}
        aria-label={t('Neue Datei')}
        title={t('Neue Datei')}
      >
        <Icon name="plus" size={15} />
      </button>

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.docId)}
          label={t('Tab-Menü')}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}

type TabProps = {
  docId: DocId;
  index: number;
  tabs: DocId[];
  active: boolean;
  dragging: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>, docId: DocId) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
  onContextMenu: (x: number, y: number) => void;
};

function Tab({
  docId,
  index,
  tabs,
  active,
  dragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onContextMenu,
}: TabProps) {
  const meta = getMeta(docId);
  // A hook cannot be skipped, and an untitled buffer has no path to ask about;
  // the empty string simply never matches anything git knows.
  const gitStatus = useGitStatus(meta?.path ?? '');
  if (!meta) return null;

  const label = tabLabel(meta);

  return (
    // `presentation`, so the tablist's children are the tab buttons themselves
    // and not the wrappers that carry the close button beside them.
    <div
      className="tabbar-tab"
      role="presentation"
      data-tab-id={docId}
      data-active={active}
      data-dirty={meta.dirty}
      data-stale={meta.staleOnDisk ? true : undefined}
      data-git={gitStatus ?? undefined}
      data-dragging={dragging ? true : undefined}
      onPointerDown={(event) => onPointerDown(event, docId)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu(event.clientX, event.clientY);
      }}
    >
      <button
        type="button"
        role="tab"
        className="tabbar-tab-select"
        aria-selected={active}
        // Roving tabindex: one stop for the whole bar, then arrows inside it.
        tabIndex={active ? 0 : -1}
        title={meta.path ?? meta.name}
        onClick={() => {
          activateDoc(docId);
          // A click on a tab means "take me to this file", so the caret goes
          // with it. Arrow keys deliberately do not do this; see EditorPane.
          focusActiveView();
        }}
        onKeyDown={(event) => {
          const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
          let next: DocId | undefined;
          if (step !== 0) next = tabs[(index + step + tabs.length) % tabs.length];
          else if (event.key === 'Home') next = tabs[0];
          else if (event.key === 'End') next = tabs[tabs.length - 1];
          if (!next) return;
          const going = next;
          event.preventDefault();
          activateDoc(going);
          // The newly selected tab is the only one with tabindex 0, and it has
          // just been rendered, so focus follows on the next frame.
          requestAnimationFrame(() => {
            document
              .querySelector<HTMLElement>(`[data-tab-id="${going}"] .tabbar-tab-select`)
              ?.focus();
          });
        }}
      >
        <span className="tabbar-tab-name">{meta.name}</span>
      </button>
      <button
        type="button"
        className="tabbar-tab-close"
        data-dirty={meta.dirty}
        aria-label={t('{name} schließen', { name: label })}
        title={t('{name} schließen', { name: label })}
        onClick={() => void closeDocSafely(docId)}
      >
        {/* Both are always here; which one shows is the stylesheet's business —
            a modified file shows the dot until the pointer is over the tab. */}
        <span className="tabbar-tab-dot" aria-hidden />
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}

/** What the close button calls this tab out loud. */
function tabLabel(meta: DocMeta): string {
  return meta.dirty ? t('{name} (ungespeichert)', { name: meta.name }) : meta.name;
}

/** Closes a list of tabs one at a time, stopping at the first Cancel. */
async function closeEach(ids: DocId[]): Promise<void> {
  for (const id of ids) {
    if (!(await closeDocSafely(id))) return;
  }
}

async function copyPath(path: string | null): Promise<void> {
  if (!path) return;
  try {
    await navigator.clipboard.writeText(path);
    toast('success', t('Pfad kopiert.'));
  } catch {
    // The webview can refuse the clipboard outright; saying so beats a button
    // that appears to have done nothing.
    toast('error', t('Der Pfad ließ sich nicht kopieren.'));
  }
}

async function reveal(path: string | null): Promise<void> {
  if (!path) return;
  try {
    await revealInFileManager(path);
  } catch (error) {
    toast('error', describeApiError(asApiError(error), path));
  }
}
