/**
 * The view zoom: Ctrl+wheel, Ctrl+Plus, Ctrl+Minus, Ctrl+0.
 *
 * A magnifying glass, not a setting. The font size in Settings is what the
 * text *is*; this is how close the user is holding it right now. So it never
 * touches `lib/settings.ts`, never reconfigures a document, and a restart
 * brings the text back at the size the settings say. It is kept for the rest
 * of the run, across tabs and panes, because a zoom that resets on every tab
 * switch is a zoom you have to keep redoing.
 *
 * It works through one CSS custom property on `<html>`, `--editor-zoom`, which
 * the typography layer in `editor/setup.ts` multiplies into its font size.
 * Changing a variable is free for the browser; CodeMirror, which caches line
 * heights, is then told to measure again — every mounted view, because a pane
 * in the background is still on screen.
 */

import { useSyncExternalStore } from 'react';
import { allViews } from './views';

/** Percent. 50 is still legible on a 4K screen, 400 is a presentation. */
export const ZOOM_MIN = 50;
export const ZOOM_MAX = 400;
export const ZOOM_DEFAULT = 100;

/**
 * The steps Ctrl+Plus and Ctrl+Minus walk. Denser around 100, where the fine
 * adjustments happen, the way every browser does it.
 */
const STEPS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400] as const;

let zoom = ZOOM_DEFAULT;
const listeners = new Set<() => void>();

export function getZoom(): number {
  return zoom;
}

export function subscribeZoom(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useZoom(): number {
  return useSyncExternalStore(subscribeZoom, getZoom);
}

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return ZOOM_DEFAULT;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value)));
}

export function setZoom(value: number): void {
  const next = clampZoom(value);
  if (next === zoom) return;
  zoom = next;
  document.documentElement.style.setProperty('--editor-zoom', String(zoom / 100));
  for (const view of allViews()) view.requestMeasure();
  for (const listener of listeners) listener();
}

/** The next step up or down from wherever the zoom is now, even off the grid. */
export function stepZoom(direction: 1 | -1): void {
  const next =
    direction > 0
      ? STEPS.find((step) => step > zoom)
      : [...STEPS].reverse().find((step) => step < zoom);
  if (next !== undefined) setZoom(next);
}

export function resetZoom(): void {
  setZoom(ZOOM_DEFAULT);
}

/**
 * Ctrl+wheel over the editor area.
 *
 * Smooth rather than stepped: a trackpad delivers dozens of tiny deltas per
 * gesture, and snapping each one to the next browser step would race from 100
 * to 400 in a flick. Ten percent per notch of an ordinary wheel (a `deltaY` of
 * about 100), proportionally less for a trackpad.
 *
 * On `window` and not passive, because the default of Ctrl+wheel in a webview
 * is to zoom the *whole page*, title bar and all, and only a non-passive
 * listener may say no to that.
 */
export function installWheelZoom(): () => void {
  const onWheel = (event: WheelEvent) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const target = event.target;
    if (!(target instanceof Element) || !target.closest('.editorpane-host')) return;
    // Lines and pages as well as pixels: Firefox-style `deltaMode`s are rare in
    // a webview, but a zoom that does nothing on one mouse is a support ticket.
    const pixels =
      event.deltaMode === 1
        ? event.deltaY * 33
        : event.deltaMode === 2
          ? event.deltaY * 400
          : event.deltaY;
    const delta = Math.max(-25, Math.min(25, -pixels / 10));
    setZoom(zoom + delta);
  };
  window.addEventListener('wheel', onWheel, { passive: false });
  return () => window.removeEventListener('wheel', onWheel);
}
