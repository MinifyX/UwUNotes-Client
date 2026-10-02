/**
 * The companion's inner life: whether she is idling, typing along, excited,
 * asleep or just waking up, and which short reaction is playing on top.
 *
 * Two halves. The top of the file is pure — {@link noteKey}, {@link poseAt} and
 * {@link nextChange} take the clock as an argument and are what the tests drive.
 * The bottom is the store `NyuCompanion` renders from, and it is built so that
 * an editor somebody types in for hours costs next to nothing:
 *
 * - A keystroke updates a few numbers and announces only when the *pose*
 *   changes, not per key. Typing a paragraph re-renders the companion twice:
 *   once when she starts typing along, once when she stops.
 * - There is never more than one timer, armed for the next moment the pose can
 *   change on its own (typing stops, she dozes off, she has finished
 *   stretching). When it fires early because the user kept typing, it re-arms
 *   for the remainder instead of polling.
 *
 * This module knows no settings and no DOM beyond `setTimeout`; whether a
 * reaction may play at all is `lib/nyu.ts`'s decision.
 */

import { useSyncExternalStore } from 'react';
import type { NyuMood } from '../components/nyu/Nyu';

export type Pose = 'idle' | 'typing' | 'excited' | 'sleeping' | 'waking';

/** Keys within this window that make "typing fast". */
export const TYPING_WINDOW_MS = 1_500;
export const TYPING_KEYS = 5;
/** No key for this long and she stops typing along. */
export const TYPING_PAUSE_MS = 900;
/** Typing without a pause longer than {@link STREAK_GAP_MS} for this long gets her excited. */
export const EXCITED_AFTER_MS = 45_000;
export const STREAK_GAP_MS = 2_500;
/** Nothing typed for this long and she falls asleep. */
export const SLEEP_AFTER_MS = 4 * 60_000;
/** How long the stretch after waking up lasts. */
export const WAKE_MS = 1_400;

export type Activity = {
  /** Timestamps of the last few keys, oldest first; never more than {@link TYPING_KEYS}. */
  recent: number[];
  lastKey: number;
  /** When the current unbroken run of typing began, or null. */
  streakSince: number | null;
  /** Set when a key woke her: the stretch runs until then. */
  wakingUntil: number;
  /** Whether she was asleep the last time anybody looked. */
  asleep: boolean;
};

export function freshActivity(now: number): Activity {
  return { recent: [], lastKey: now, streakSince: null, wakingUntil: 0, asleep: false };
}

/** One key. Returns the new activity; the old one is left alone. */
export function noteKey(activity: Activity, now: number): Activity {
  const wasAsleep = activity.asleep || now - activity.lastKey >= SLEEP_AFTER_MS;
  const recent = [...activity.recent, now].slice(-TYPING_KEYS);
  const continued =
    activity.streakSince !== null && now - activity.lastKey <= STREAK_GAP_MS
      ? activity.streakSince
      : now;
  return {
    recent,
    lastKey: now,
    streakSince: continued,
    wakingUntil: wasAsleep ? now + WAKE_MS : activity.wakingUntil,
    asleep: false,
  };
}

function typingFast(activity: Activity, now: number): boolean {
  if (now - activity.lastKey > TYPING_PAUSE_MS) return false;
  if (activity.recent.length < TYPING_KEYS) return false;
  const oldest = activity.recent[0] ?? 0;
  return activity.lastKey - oldest <= TYPING_WINDOW_MS;
}

/** What she is doing at `now`, given what was typed. */
export function poseAt(activity: Activity, now: number): Pose {
  if (now < activity.wakingUntil) return 'waking';
  if (activity.asleep || now - activity.lastKey >= SLEEP_AFTER_MS) return 'sleeping';
  if (!typingFast(activity, now)) return 'idle';
  const streak = activity.streakSince === null ? 0 : now - activity.streakSince;
  return streak >= EXCITED_AFTER_MS ? 'excited' : 'typing';
}

/**
 * Milliseconds until the pose may change without another key, or null when it
 * cannot (she is asleep and stays asleep until somebody types).
 */
export function nextChange(activity: Activity, now: number): number | null {
  const pose = poseAt(activity, now);
  if (pose === 'waking') return activity.wakingUntil - now;
  if (pose === 'sleeping') return null;
  if (pose === 'typing' || pose === 'excited') {
    const stops = activity.lastKey + TYPING_PAUSE_MS - now;
    if (pose === 'typing' && activity.streakSince !== null) {
      const excites = activity.streakSince + EXCITED_AFTER_MS - now;
      return Math.max(1, Math.min(stops, excites));
    }
    return Math.max(1, stops);
  }
  return Math.max(1, activity.lastKey + SLEEP_AFTER_MS - now);
}

/**
 * "May this happen yet?" for anything rate-limited: a reaction per kind, a
 * cameo, a tip. One map of last times, one question.
 */
export class Cooldowns {
  private last = new Map<string, number>();

  allow(key: string, ms: number, now: number): boolean {
    const previous = this.last.get(key);
    if (previous !== undefined && now - previous < ms) return false;
    this.last.set(key, now);
    return true;
  }

  /** Whether `key` fired within the last `ms`, without taking a turn. */
  recent(key: string, ms: number, now: number): boolean {
    const previous = this.last.get(key);
    return previous !== undefined && now - previous < ms;
  }
}

/** Petting: this many clicks within {@link DIZZY_WINDOW_MS} and she gets dizzy instead. */
export const DIZZY_CLICKS = 6;
export const DIZZY_WINDOW_MS = 3_000;

/** Whether a click at `now`, after `clicks` (timestamps), makes her dizzy. Returns the kept clicks too. */
export function petClick(
  clicks: readonly number[],
  now: number,
): { dizzy: boolean; clicks: number[] } {
  const kept = [...clicks.filter((at) => now - at < DIZZY_WINDOW_MS), now];
  if (kept.length >= DIZZY_CLICKS) return { dizzy: true, clicks: [] };
  return { dizzy: false, clicks: kept };
}

/* ── The store ─────────────────────────────────────────── */

/** Short movements the whole figure can make. CSS in `companion.css`. */
export type Motion = 'nod' | 'hop' | 'wiggle' | 'wobble' | 'dance' | 'wave' | 'peek';
/** Little things that fly off her. Never drawn when motion is reduced. */
export type Burst = 'stars' | 'confetti' | 'hearts' | 'dizzy' | 'notes';

export type Reaction = {
  id: number;
  mood: NyuMood;
  motion: Motion | null;
  burst: Burst | null;
  ms: number;
};

export type Bubble = { id: number; text: string };

export type LifeState = {
  pose: Pose;
  reaction: Reaction | null;
  bubble: Bubble | null;
};

let activity = freshActivity(Date.now());
let state: LifeState = { pose: 'idle', reaction: null, bubble: null };
const listeners = new Set<() => void>();
let poseTimer = 0;
let reactionTimer = 0;
let bubbleTimer = 0;
let counter = 0;
let clicks: number[] = [];

function commit(next: Partial<LifeState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLife(): LifeState {
  return state;
}

export function useLife(): LifeState {
  return useSyncExternalStore(subscribe, getLife);
}

/** Re-reads the pose and arms the one timer for its next change. */
function settle(now = Date.now()): void {
  const pose = poseAt(activity, now);
  if (pose === 'sleeping' && !activity.asleep) activity = { ...activity, asleep: true };
  if (pose !== state.pose) commit({ pose });
  window.clearTimeout(poseTimer);
  const wait = nextChange(activity, now);
  if (wait !== null) poseTimer = window.setTimeout(() => settle(), wait);
}

/** A key went into an editor. Cheap: announces only when the pose changes. */
export function lifeKey(now = Date.now()): void {
  const wasSleeping = state.pose === 'sleeping';
  activity = noteKey(activity, now);
  const pose = poseAt(activity, now);
  // Most keystrokes change nothing visible. The timer is only re-armed when it
  // would otherwise fire for the wrong moment (a new pose), never per key: the
  // armed one re-checks and re-arms for the remainder when it fires.
  if (pose !== state.pose || wasSleeping) settle(now);
}

/** Starts the clock that puts her to sleep. Called once by `startNyu()`. */
export function startLife(now = Date.now()): () => void {
  activity = freshActivity(now);
  settle(now);
  return () => window.clearTimeout(poseTimer);
}

/** Plays a reaction now, replacing whatever was playing. */
export function react(reaction: Omit<Reaction, 'id'>): void {
  counter += 1;
  window.clearTimeout(reactionTimer);
  commit({ reaction: { ...reaction, id: counter } });
  reactionTimer = window.setTimeout(() => commit({ reaction: null }), reaction.ms);
}

/** Shows a speech bubble for a while. Empty text shows nothing (the neutral tone). */
export function say(text: string, ms = 5_000): void {
  if (!text) return;
  counter += 1;
  window.clearTimeout(bubbleTimer);
  commit({ bubble: { id: counter, text } });
  bubbleTimer = window.setTimeout(() => commit({ bubble: null }), ms);
}

export function hush(): void {
  window.clearTimeout(bubbleTimer);
  if (state.bubble) commit({ bubble: null });
}

/** Someone clicked her. Returns whether that was one click too many. */
export function petNyu(now = Date.now()): 'pet' | 'dizzy' {
  const result = petClick(clicks, now);
  clicks = result.clicks;
  return result.dizzy ? 'dizzy' : 'pet';
}

/* ── Where she looks ───────────────────────────────────── */

type LookListener = (x: number, y: number) => void;
const lookListeners = new Set<LookListener>();

/**
 * Something on screen she might look at — the caret, the pointer. Goes straight
 * to the companion's DOM through a listener, not through React: her pupils
 * moving is not a reason to re-render anything.
 */
export function lookAt(x: number, y: number): void {
  for (const listener of lookListeners) listener(x, y);
}

export function onLook(listener: LookListener): () => void {
  lookListeners.add(listener);
  return () => lookListeners.delete(listener);
}

/** For tests: back to a fresh start. */
export function resetLife(now = Date.now()): void {
  window.clearTimeout(poseTimer);
  window.clearTimeout(reactionTimer);
  window.clearTimeout(bubbleTimer);
  activity = freshActivity(now);
  clicks = [];
  state = { pose: 'idle', reaction: null, bubble: null };
}
