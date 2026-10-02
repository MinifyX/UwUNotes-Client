/**
 * The Nyu-Pomodoro: focus for a while, rest for a bit, a longer rest every few
 * rounds.
 *
 * The state machine is pure ({@link startPomodoro}, {@link pausePomodoro},
 * {@link advancePomodoro} …) and takes the clock as an argument, so a 25-minute
 * round is tested in a microsecond. The store below drives it with exactly one
 * timeout, armed for the moment the current phase ends — no interval ticking
 * away while the user writes. The status bar redraws its countdown on its own
 * once a second, and only while a round is running and the window is visible.
 *
 * A finished focus round starts its break by itself: getting up is the point,
 * and a break that waits for a click is a break nobody takes. A finished break
 * does not start the next round — that one is the user's to begin.
 *
 * Timers in a background window can be throttled, so a phase may end late.
 * `advancePomodoro` judges by the clock rather than by the timer having fired,
 * and the store re-checks when the window becomes visible again.
 */

import { useSyncExternalStore } from 'react';
import { emitNyu } from './nyu-events';
import { getSettings, type Settings } from './settings';

export type PomodoroPhase = 'focus' | 'break' | 'longBreak';

export type PomodoroState = {
  /** null when no round is on. */
  phase: PomodoroPhase | null;
  /** When the running phase ends (ms since the epoch); null while paused or idle. */
  endsAt: number | null;
  /** Milliseconds left, valid while paused. */
  left: number;
  /** Focus rounds finished since the last long break. */
  done: number;
};

export type PomodoroConfig = {
  focusMs: number;
  breakMs: number;
  longBreakMs: number;
  /** A long break after this many focus rounds. */
  longEvery: number;
};

export const IDLE: PomodoroState = { phase: null, endsAt: null, left: 0, done: 0 };

export function configFrom(settings: Settings): PomodoroConfig {
  return {
    focusMs: settings.pomodoroFocusMinutes * 60_000,
    breakMs: settings.pomodoroBreakMinutes * 60_000,
    longBreakMs: settings.pomodoroLongBreakMinutes * 60_000,
    longEvery: settings.pomodoroLongEvery,
  };
}

export function durationOf(phase: PomodoroPhase, config: PomodoroConfig): number {
  if (phase === 'focus') return config.focusMs;
  return phase === 'break' ? config.breakMs : config.longBreakMs;
}

/** A new focus round, keeping the count of rounds already done in this cycle. */
export function startPomodoro(
  state: PomodoroState,
  config: PomodoroConfig,
  now: number,
): PomodoroState {
  return { phase: 'focus', endsAt: now + config.focusMs, left: config.focusMs, done: state.done };
}

export function pausePomodoro(state: PomodoroState, now: number): PomodoroState {
  if (state.phase === null || state.endsAt === null) return state;
  return { ...state, endsAt: null, left: Math.max(0, state.endsAt - now) };
}

export function resumePomodoro(state: PomodoroState, now: number): PomodoroState {
  if (state.phase === null || state.endsAt !== null) return state;
  return { ...state, endsAt: now + state.left };
}

export function stopPomodoro(): PomodoroState {
  return IDLE;
}

export function isRunning(state: PomodoroState): boolean {
  return state.phase !== null && state.endsAt !== null;
}

export function remainingMs(state: PomodoroState, now: number): number {
  if (state.phase === null) return 0;
  return state.endsAt === null ? state.left : Math.max(0, state.endsAt - now);
}

/**
 * Moves on if the running phase is over. `finished` says which phase just
 * ended, so the caller can say something about it; it is null when nothing
 * happened. Only one step at a time: a laptop that slept through a focus round
 * *and* its break wakes into the break, already over, and the next call ends
 * that too.
 */
export function advancePomodoro(
  state: PomodoroState,
  config: PomodoroConfig,
  now: number,
): { state: PomodoroState; finished: PomodoroPhase | null } {
  if (state.phase === null || state.endsAt === null || now < state.endsAt) {
    return { state, finished: null };
  }
  if (state.phase === 'focus') {
    const done = state.done + 1;
    const phase: PomodoroPhase = done % Math.max(1, config.longEvery) === 0 ? 'longBreak' : 'break';
    const length = durationOf(phase, config);
    // The break starts from now, not from when the round should have ended: a
    // break that was half used up while the laptop slept is not a break.
    return {
      state: { phase, endsAt: now + length, left: length, done },
      finished: 'focus',
    };
  }
  return {
    state: { ...IDLE, done: state.phase === 'longBreak' ? 0 : state.done },
    finished: state.phase,
  };
}

/** `24:13`, or `1:02:00` for the patient. */
export function formatRemaining(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

/* ── The store ─────────────────────────────────────────── */

let state: PomodoroState = IDLE;
const listeners = new Set<() => void>();
let timer = 0;
/** Told when a phase ends; `lib/nyu.ts` turns that into a toast and a chime. */
let onFinish: ((phase: PomodoroPhase, next: PomodoroState) => void) | null = null;

function commit(next: PomodoroState): void {
  state = next;
  arm();
  for (const listener of listeners) listener();
}

function arm(): void {
  window.clearTimeout(timer);
  if (state.endsAt === null) return;
  // Capped, because a timeout longer than about 24.8 days overflows to "now";
  // nobody focuses that long, but a hand-edited setting could ask for it.
  const wait = Math.min(Math.max(0, state.endsAt - Date.now()), 2 ** 31 - 1);
  timer = window.setTimeout(check, wait + 50);
}

/** Ends the phase if it is over. Also called when the window becomes visible. */
export function checkPomodoro(now = Date.now()): void {
  const { state: next, finished } = advancePomodoro(state, configFrom(getSettings()), now);
  if (!finished) {
    if (next.endsAt !== null) arm();
    return;
  }
  commit(next);
  if (finished === 'focus') emitNyu('pomodoro-done');
  onFinish?.(finished, next);
}

function check(): void {
  checkPomodoro();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPomodoro(): PomodoroState {
  return state;
}

export function usePomodoro(): PomodoroState {
  return useSyncExternalStore(subscribe, getPomodoro);
}

export function setPomodoroFinishHandler(
  handler: ((phase: PomodoroPhase, next: PomodoroState) => void) | null,
): void {
  onFinish = handler;
}

export function startFocus(now = Date.now()): void {
  commit(startPomodoro(state, configFrom(getSettings()), now));
  emitNyu('pomodoro-started');
}

export function pauseFocus(now = Date.now()): void {
  commit(pausePomodoro(state, now));
}

export function resumeFocus(now = Date.now()): void {
  commit(resumePomodoro(state, now));
}

/** Start when idle, pause when running, resume when paused: the status bar's one click. */
export function togglePomodoro(now = Date.now()): void {
  if (state.phase === null) startFocus(now);
  else if (state.endsAt === null) resumeFocus(now);
  else pauseFocus(now);
}

export function stopFocus(): void {
  commit(stopPomodoro());
}

/** Ends the current phase right away, as if its time were up — paused or not. */
export function skipPhase(now = Date.now()): void {
  if (state.phase === null) return;
  state = { ...state, endsAt: now };
  checkPomodoro(now);
}

/** For tests: back to idle with no timer. */
export function resetPomodoro(): void {
  window.clearTimeout(timer);
  state = IDLE;
}
