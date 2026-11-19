/**
 * Short messages in the corner: a file could not be read, a search found
 * nothing, a save went through.
 *
 * Toasts are for things the user does not have to answer. Anything that needs a
 * decision goes to `lib/prompt.ts` instead — a dialog that vanishes after four
 * seconds is a dialog that loses data.
 *
 * The store lives outside React so a background disk check can raise one, and
 * holds no markup: the rendering is the shell's business.
 */

import { useSyncExternalStore } from 'react';

export type Toast = {
  id: number;
  tone: 'info' | 'error' | 'success';
  text: string;
  action?: { label: string; run: () => void };
};

/** How long each tone stays before it fades itself out, in milliseconds. */
const LIFETIME: Record<Toast['tone'], number> = {
  info: 4_000,
  success: 3_000,
  // An error is the one the user actually needs to read, and often to copy.
  error: 9_000,
};

/** A toast with a button has to outlive the reflex to reach for the mouse. */
const LIFETIME_WITH_ACTION = 12_000;

/**
 * A toast whose button is a convenience rather than the way back — "show me"
 * on a notice that is just good news. It goes about as soon as a plain one.
 */
const LIFETIME_BRIEF = 5_000;

/** More than this on screen at once is a wall, not a notification. */
const MAX_VISIBLE = 4;

let toasts: readonly Toast[] = [];
const listeners = new Set<() => void>();
const timers = new Map<number, number>();
let counter = 0;

function announce() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getToasts(): readonly Toast[] {
  return toasts;
}

export function useToasts(): readonly Toast[] {
  return useSyncExternalStore(subscribe, getToasts);
}

/**
 * Whether an error is on screen. Nyu stays quiet while one is: she is never
 * next to bad news.
 */
export function errorShowing(): boolean {
  return toasts.some((entry) => entry.tone === 'error');
}

/** `brief`: gone after {@link LIFETIME_BRIEF} even with a button. */
export function toast(
  tone: Toast['tone'],
  text: string,
  action?: Toast['action'],
  options?: { brief?: boolean },
): number {
  counter += 1;
  const id = counter;
  const next = [...toasts, { id, tone, text, action }];
  // The oldest go first: the newest message is the one that explains what just
  // happened, and it is the one the user is looking for.
  for (const dropped of next.slice(0, Math.max(0, next.length - MAX_VISIBLE))) {
    clearTimer(dropped.id);
  }
  toasts = next.slice(-MAX_VISIBLE);
  const lifetime = options?.brief
    ? Math.max(LIFETIME[tone], LIFETIME_BRIEF)
    : action
      ? LIFETIME_WITH_ACTION
      : LIFETIME[tone];
  if (paused) remaining.set(id, lifetime);
  else startTimer(id, lifetime);
  announce();
  return id;
}

/* ── Holding still while someone reads ─────────────────── */

/**
 * While the pointer or the focus is on the stack, nothing in it times out —
 * the suite's rule since design 1.16 (`pause`/`resume` on its `ToastStore`). A
 * toast that vanishes from under the cursor that is about to click its button
 * is the one kind of toast that is worse than none.
 */
let paused = false;
/** Time left per toast while paused, or before its timer is started. */
const remaining = new Map<number, number>();
/** When each running timer fires, for working out what is left on a pause. */
const deadlines = new Map<number, number>();
/** A resumed toast keeps at least this long, so it does not vanish on mouse-out. */
const RESUME_MIN_MS = 1_500;

function startTimer(id: number, ms: number) {
  deadlines.set(id, Date.now() + ms);
  timers.set(
    id,
    window.setTimeout(() => dismissToast(id), ms),
  );
}

export function pauseToasts(): void {
  if (paused) return;
  paused = true;
  const now = Date.now();
  for (const [id, deadline] of deadlines) {
    remaining.set(id, Math.max(0, deadline - now));
    const timer = timers.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.delete(id);
  }
  deadlines.clear();
}

export function resumeToasts(): void {
  if (!paused) return;
  paused = false;
  for (const [id, ms] of remaining) startTimer(id, Math.max(ms, RESUME_MIN_MS));
  remaining.clear();
}

export function dismissToast(id: number): void {
  clearTimer(id);
  const next = toasts.filter((entry) => entry.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  // The stack unmounts with its last toast, and with it the pointer-leave that
  // would have resumed: an empty stack is never paused.
  if (toasts.length === 0) paused = false;
  announce();
}

/** For a reload of the whole workspace: nothing on screen still applies. */
export function clearToasts(): void {
  for (const entry of toasts) clearTimer(entry.id);
  paused = false;
  if (toasts.length === 0) return;
  toasts = [];
  announce();
}

function clearTimer(id: number) {
  const timer = timers.get(id);
  if (timer !== undefined) window.clearTimeout(timer);
  timers.delete(id);
  deadlines.delete(id);
  remaining.delete(id);
}
