/**
 * Nyu's cameos: a short scene, two to five seconds, somewhere on the window's
 * edge — she peeks in from the side, a bat flaps past in October, a black cat
 * crosses the editor on Friday the 13th.
 *
 * Same idea as UwUMail's `cameo.ts`: one at a time, a newer one replaces an
 * older one of equal or lower priority, nothing queues, and every scene has a
 * cooldown of its own on top. Whether a cameo may play at all — motion,
 * gimmicks, zen mode, a dialog, the user typing — is decided by `lib/nyu.ts`
 * before it calls {@link playCameo}; this store only arbitrates between them.
 */

import { useSyncExternalStore } from 'react';
import type { HatId } from '../components/nyu/hats';
import { Cooldowns } from './nyu-life';

export type CameoName =
  /** She peeks in from the bottom or the right edge and looks around. */
  | 'peek'
  /** October: a small bat flaps across the top of the window. */
  | 'bat'
  /** Friday the 13th: a black cat walks along the bottom. Nyu is not impressed. */
  | 'blackcat'
  /** A dance with confetti: the Konami code, "Nyu tanzen lassen". */
  | 'party'
  /** New Year: fireworks. */
  | 'fireworks'
  /** The app's birthday: cake and a party hat. */
  | 'birthday'
  /** Advent: snow falls on her Santa hat. */
  | 'snow'
  /** Valentine's Day: hearts. */
  | 'hearts'
  /** Easter: she hops past with an egg. */
  | 'easter'
  /** After midnight: nightcap, moon, a yawn. */
  | 'night'
  /** A Nyu-Pomodoro round is done: she holds up a tomato. */
  | 'tomato';

export type CameoSpec = { duration: number; priority: number; cooldown: number };

const MINUTE = 60_000;

export const CAMEOS: Record<CameoName, CameoSpec> = {
  peek: { duration: 2_600, priority: 0, cooldown: 15 * MINUTE },
  bat: { duration: 4_200, priority: 0, cooldown: 15 * MINUTE },
  blackcat: { duration: 5_200, priority: 0, cooldown: 60 * MINUTE },
  night: { duration: 2_800, priority: 1, cooldown: 45 * MINUTE },
  snow: { duration: 3_400, priority: 1, cooldown: 15 * MINUTE },
  hearts: { duration: 2_800, priority: 1, cooldown: 15 * MINUTE },
  easter: { duration: 3_200, priority: 1, cooldown: 15 * MINUTE },
  tomato: { duration: 2_600, priority: 2, cooldown: 0 },
  fireworks: { duration: 3_600, priority: 2, cooldown: 30 * MINUTE },
  birthday: { duration: 3_400, priority: 2, cooldown: 30 * MINUTE },
  party: { duration: 3_000, priority: 3, cooldown: 4_000 },
};

/** Where a peek comes from. The others have a fixed place each. */
export type CameoEdge = 'bottom' | 'right';

export type Cameo = {
  id: number;
  name: CameoName;
  hat: HatId | null;
  edge: CameoEdge;
  /** 0–1: how far along the edge (left→right, top→bottom). */
  along: number;
  duration: number;
  until: number;
};

let current: Cameo | null = null;
const listeners = new Set<() => void>();
const cooldowns = new Cooldowns();
let counter = 0;
let timer = 0;

function announce(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCameo(): Cameo | null {
  return current;
}

export function useCameo(): Cameo | null {
  return useSyncExternalStore(subscribe, getCameo);
}

export type PlayOptions = {
  hat?: HatId | null;
  edge?: CameoEdge;
  along?: number;
  now?: number;
};

/** Plays a cameo unless it is cooling down or something more important is on. Returns whether it plays. */
export function playCameo(name: CameoName, options: PlayOptions = {}): boolean {
  const spec = CAMEOS[name];
  const now = options.now ?? Date.now();
  if (current && current.until > now && CAMEOS[current.name].priority > spec.priority) return false;
  if (!cooldowns.allow(name, spec.cooldown, now)) return false;
  counter += 1;
  current = {
    id: counter,
    name,
    hat: options.hat ?? null,
    edge: options.edge ?? 'bottom',
    along: Math.min(0.85, Math.max(0.15, options.along ?? 0.5)),
    duration: spec.duration,
    until: now + spec.duration,
  };
  window.clearTimeout(timer);
  const id = counter;
  timer = window.setTimeout(() => finishCameo(id), spec.duration);
  announce();
  return true;
}

/** Takes the cameo away — only the one with this id, not a newer one. */
export function finishCameo(id: number): void {
  if (current?.id !== id) return;
  current = null;
  announce();
}

/** Gone now, whatever it was: motion was switched off, zen mode began. */
export function clearCameo(): void {
  window.clearTimeout(timer);
  if (!current) return;
  current = null;
  announce();
}
