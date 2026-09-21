/**
 * Whether the sidebar is showing.
 *
 * It used to be `App.tsx` state, toggled by a title-bar button and Ctrl+B. Now
 * the View menu toggles it too, and a menu entry is a command — so the state
 * moved out of the component into a store any command can reach, the way the
 * documents and the layout already are.
 *
 * Remembered per machine in the page's own storage, not in the session file:
 * it is a preference about this screen, not about the files that were open.
 */

import { useSyncExternalStore } from 'react';

const SIDEBAR_KEY = 'uwunotes.sidebar';

function load(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) !== 'closed';
  } catch {
    // Storage can be unavailable in a locked-down webview; showing it is the
    // friendlier default for someone who has never seen the window before.
    return true;
  }
}

let open = load();
const listeners = new Set<() => void>();

export function sidebarOpen(): boolean {
  return open;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSidebarOpen(): boolean {
  return useSyncExternalStore(subscribe, sidebarOpen);
}

export function setSidebarOpen(next: boolean): void {
  if (next === open) return;
  open = next;
  try {
    window.localStorage.setItem(SIDEBAR_KEY, next ? 'open' : 'closed');
  } catch {
    // The preference is lost on restart; the window is still correct now.
  }
  for (const listener of listeners) listener();
}

export function toggleSidebar(): void {
  setSidebarOpen(!open);
}
