/**
 * Zen mode: one document, a centred column, nothing else on screen.
 *
 * A store like `lib/chrome.ts`, outside React, because a command, F11 and
 * Escape all have to reach it. What it deliberately does *not* do is touch the
 * other chrome stores: the sidebar, the split layout and the menu are simply
 * not drawn while this is on (`App.tsx` and `styles/focus.css` decide that),
 * so leaving zen puts back exactly what was there without having to remember
 * any of it. The one piece of state that does need remembering is the window's,
 * because fullscreen is the operating system's and not ours.
 *
 * Not persisted. Starting the app in fullscreen with no menu because that is
 * how it was closed last night is a good way to make somebody think it broke.
 */

import { getCurrentWindow } from '@tauri-apps/api/window';
import { useSyncExternalStore } from 'react';
import { emitNyu } from './nyu-events';

let active = false;
const listeners = new Set<() => void>();

/**
 * Whether entering zen is what put the window into fullscreen. Only then does
 * leaving take it out again: somebody who was already fullscreen before
 * pressing F11 expects to still be fullscreen afterwards.
 */
let madeFullscreen = false;

/**
 * Window calls, one after another.
 *
 * `isFullscreen` and `setFullscreen` are round trips to Rust. Pressing F11
 * twice quickly would otherwise let the exit's `setFullscreen(false)` overtake
 * the enter's `setFullscreen(true)` and leave a fullscreen window with the
 * menu back — the one state that is neither of the two the user asked for.
 */
let windowQueue: Promise<void> = Promise.resolve();

function queueWindow(step: () => Promise<void>): Promise<void> {
  windowQueue = windowQueue.then(step).catch(() => {
    // No permission, a platform that has no fullscreen, a window already gone:
    // zen still works as a calmer layout inside the window it has.
  });
  return windowQueue;
}

function announce() {
  for (const listener of listeners) listener();
}

export function zenActive(): boolean {
  return active;
}

export function subscribeZen(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useZen(): boolean {
  return useSyncExternalStore(subscribeZen, zenActive);
}

/**
 * The layout changes first and the window follows, so the switch feels
 * immediate even when the window manager takes its time with fullscreen.
 */
export function enterZen(): Promise<void> {
  if (active) return windowQueue;
  active = true;
  announce();
  emitNyu('zen-entered');
  return queueWindow(async () => {
    const window = getCurrentWindow();
    if (!active || (await window.isFullscreen())) return;
    await window.setFullscreen(true);
    madeFullscreen = true;
  });
}

export function exitZen(): Promise<void> {
  if (!active) return windowQueue;
  active = false;
  announce();
  emitNyu('zen-left');
  return queueWindow(async () => {
    if (active || !madeFullscreen) return;
    madeFullscreen = false;
    await getCurrentWindow().setFullscreen(false);
  });
}

export function toggleZen(): Promise<void> {
  return active ? exitZen() : enterZen();
}
