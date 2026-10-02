/**
 * Nyu's levels, achievements and wardrobe, kept in the page's own storage.
 *
 * Everything here is local and stays local: no account, no server, no
 * "share your streak". It is a toy, and a toy that phones home is not one.
 *
 * The rules are pure functions over a {@link NyuProgress} value — {@link gainTyping},
 * {@link gainEvent}, {@link touchDay}, {@link unlockAchievements} — that take the
 * clock as an argument, so the anti-farming caps can be tested without holding
 * a key down for a minute. The store at the bottom applies them, persists at
 * most every few seconds (typing would otherwise write to storage on every
 * key) and announces only when something visible changed.
 *
 * Read back through {@link sanitizeProgress}, like the settings: the blob is
 * JSON anybody can edit, and a hand-edited `xp: "lots"` must not break the
 * status bar.
 */

import { useSyncExternalStore } from 'react';
import { HAT_IDS, type HatId } from '../components/nyu/hats';
import {
  localDay,
  isNextDay,
  occasionHat,
  occasionsOn,
  type Occasion,
} from '../components/nyu/occasions';
import { N_ } from './i18n';
import { getSettings, subscribeSettings } from './settings';

/* ── The shape ─────────────────────────────────────────── */

export type NyuStats = {
  /** Typed characters that counted (after the per-minute cap). */
  chars: number;
  /** Lines started with Enter. */
  lines: number;
  saves: number;
  macros: number;
  filesOpened: number;
  /** Distinct regular-expression searches that found something. */
  regex: number;
  pomodoros: number;
  pets: number;
  eggs: number;
  konami: number;
  /** The most tabs ever open at once. */
  maxTabs: number;
  /** Typing sessions between 01:00 and 04:59, and between 05:00 and 06:59. */
  night: number;
  early: number;
};

export type AchievementId =
  | 'first-line'
  | 'lines-1000'
  | 'chars-100k'
  | 'night-owl'
  | 'early-bird'
  | 'macro-master'
  | 'tab-juggler'
  | 'regex-wizard'
  | 'save-pro'
  | 'files-100'
  | 'streak-7'
  | 'streak-30'
  | 'pomodoro-hero'
  | 'konami'
  | 'egg'
  | 'petting'
  | 'spooky'
  | 'festive'
  | 'birthday'
  | 'newyear'
  | 'easter'
  | 'valentine'
  | 'friday13';

/** What Nyu wears: the occasion's hat, nothing, or one she has unlocked. */
export type HatChoice = 'auto' | 'none' | HatId;

export type NyuProgress = {
  version: 1;
  xp: number;
  /** Typed characters not yet turned into XP. */
  charsPending: number;
  stats: NyuStats;
  days: {
    /** "YYYY-MM-DD" of the last day the app was used, or null. */
    last: string | null;
    streak: number;
    best: number;
    total: number;
  };
  /** Unlocked achievements, with the time they were unlocked. */
  achievements: Partial<Record<AchievementId, number>>;
  /** Occasions she has been around for, so their achievement and hat stay. */
  seen: Occasion[];
  /** Occasion → the day it was last greeted with a cameo. */
  greeted: Partial<Record<Occasion, string>>;
  hat: HatChoice;
  /** The anti-farming bucket for typing: which minute, and how much of it is used. */
  minute: { at: number; chars: number };
};

const ZERO_STATS: NyuStats = {
  chars: 0,
  lines: 0,
  saves: 0,
  macros: 0,
  filesOpened: 0,
  regex: 0,
  pomodoros: 0,
  pets: 0,
  eggs: 0,
  konami: 0,
  maxTabs: 0,
  night: 0,
  early: 0,
};

export const FRESH_PROGRESS: NyuProgress = {
  version: 1,
  xp: 0,
  charsPending: 0,
  stats: ZERO_STATS,
  days: { last: null, streak: 0, best: 0, total: 0 },
  achievements: {},
  seen: [],
  greeted: {},
  hat: 'auto',
  minute: { at: 0, chars: 0 },
};

/* ── Levels ────────────────────────────────────────────── */

export const MAX_LEVEL = 99;

/**
 * XP needed to go from `level` to the next: 80 for the first step, 40 more for
 * every level after. Level 2 comes within the first sitting, level 10 after a
 * few evenings, level 30 after weeks — gentle enough that it never asks to be
 * played, steep enough that it means something.
 */
export function xpToNext(level: number): number {
  return 80 + 40 * (Math.max(1, level) - 1);
}

/** Total XP at which `level` begins (level 1 at 0). */
export function xpForLevel(level: number): number {
  const steps = Math.max(0, Math.min(MAX_LEVEL, level) - 1);
  return 80 * steps + 20 * steps * (steps - 1);
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level += 1;
  return level;
}

/** Where in the current level the XP stands, for the bar. */
export function levelProgress(xp: number): { level: number; into: number; needed: number } {
  const level = levelForXp(xp);
  if (level >= MAX_LEVEL) return { level, into: 1, needed: 1 };
  return { level, into: xp - xpForLevel(level), needed: xpToNext(level) };
}

/** What each hat is called, for the picker and the level-up toast. */
export const HAT_LABELS: Record<HatId, string> = {
  witch: N_('Hexenhut'),
  santa: N_('Weihnachtsmütze'),
  party: N_('Partyhut'),
  bunny: N_('Hasenohren'),
  nightcap: N_('Schlafmütze'),
  bow: N_('Schleife'),
  glasses: N_('Brille'),
  sunglasses: N_('Sonnenbrille'),
  flower: N_('Blume'),
  headphones: N_('Kopfhörer'),
  beret: N_('Baskenmütze'),
  crown: N_('Krone'),
};

/** Accessories that come with a level. */
export const LEVEL_HATS: readonly { level: number; hat: HatId }[] = [
  { level: 2, hat: 'bow' },
  { level: 3, hat: 'glasses' },
  { level: 5, hat: 'flower' },
  { level: 7, hat: 'headphones' },
  { level: 10, hat: 'beret' },
  { level: 15, hat: 'crown' },
];

/* ── XP rules ──────────────────────────────────────────── */

/** Typed characters per minute that count; anything above is not writing, it is a held key. */
export const CHARS_PER_MINUTE_CAP = 400;
/** Counted characters per XP point. */
export const CHARS_PER_XP = 25;

export const XP = {
  save: 2,
  macro: 3,
  fileOpened: 1,
  regex: 2,
  pomodoro: 20,
  achievement: 25,
  newDay: 10,
  /** Per streak day on top of the daily XP, up to {@link STREAK_BONUS_CAP} days. */
  streakDay: 2,
} as const;

export const STREAK_BONUS_CAP = 10;

/** Saves, macros and files closer together than this count once: Ctrl+S held down is not 500 saves. */
export const EVENT_SPACING_MS: Record<'save' | 'macro' | 'fileOpened' | 'regex', number> = {
  save: 3_000,
  macro: 2_000,
  fileOpened: 500,
  regex: 2_000,
};

export type Gain = {
  progress: NyuProgress;
  /** The level before and after, so the caller can celebrate a step. */
  levelBefore: number;
  levelAfter: number;
};

function withXp(progress: NyuProgress, xp: number): Gain {
  const levelBefore = levelForXp(progress.xp);
  const next = xp > 0 ? { ...progress, xp: progress.xp + xp } : progress;
  return { progress: next, levelBefore, levelAfter: levelForXp(next.xp) };
}

export type TypingInput = {
  /** Printable characters typed, auto-repeat already filtered out by the caller. */
  chars: number;
  /** Enter presses. */
  lines: number;
};

/**
 * Typing, capped per wall-clock minute. The cap applies to characters and to
 * lines alike — a held Enter key is still not a thousand lines written.
 */
export function gainTyping(progress: NyuProgress, input: TypingInput, now: number): Gain {
  const minute = Math.floor(now / 60_000);
  const bucket = progress.minute.at === minute ? progress.minute : { at: minute, chars: 0 };
  const room = Math.max(0, CHARS_PER_MINUTE_CAP - bucket.chars);
  const chars = Math.min(room, Math.max(0, Math.floor(input.chars)));
  const lines = Math.min(Math.max(0, room - chars), Math.max(0, Math.floor(input.lines)));
  const pending = progress.charsPending + chars + lines;
  const xp = Math.floor(pending / CHARS_PER_XP);

  const hour = new Date(now).getHours();
  const typed = chars + lines > 0;
  // A night or morning session counts once per minute bucket, which is plenty
  // for "did they ever write at 2 a.m." and cannot be farmed into anything.
  const freshMinute = progress.minute.at !== minute;
  const stats: NyuStats = {
    ...progress.stats,
    chars: progress.stats.chars + chars,
    lines: progress.stats.lines + lines,
    night: progress.stats.night + (typed && freshMinute && hour >= 1 && hour < 5 ? 1 : 0),
    early: progress.stats.early + (typed && freshMinute && hour >= 5 && hour < 7 ? 1 : 0),
  };
  return withXp(
    {
      ...progress,
      stats,
      charsPending: pending - xp * CHARS_PER_XP,
      minute: { at: minute, chars: bucket.chars + chars + lines },
    },
    xp,
  );
}

export type ProgressEvent =
  'save' | 'macro' | 'fileOpened' | 'regex' | 'pomodoro' | 'pet' | 'egg' | 'konami';

const STAT_FOR: Record<ProgressEvent, keyof NyuStats> = {
  save: 'saves',
  macro: 'macros',
  fileOpened: 'filesOpened',
  regex: 'regex',
  pomodoro: 'pomodoros',
  pet: 'pets',
  egg: 'eggs',
  konami: 'konami',
};

const XP_FOR: Record<ProgressEvent, number> = {
  save: XP.save,
  macro: XP.macro,
  fileOpened: XP.fileOpened,
  regex: XP.regex,
  pomodoro: XP.pomodoro,
  // Petting and the eggs are their own reward. XP for clicking a cat would be
  // the first thing anybody farms.
  pet: 0,
  egg: 0,
  konami: 0,
};

/**
 * One counted event. `lastAt` is when the same kind last counted (the caller
 * keeps it); closer than {@link EVENT_SPACING_MS} and it is ignored.
 */
export function gainEvent(
  progress: NyuProgress,
  event: ProgressEvent,
  now: number,
  lastAt: number | undefined,
): Gain {
  const spacing = (EVENT_SPACING_MS as Partial<Record<ProgressEvent, number>>)[event] ?? 0;
  if (lastAt !== undefined && now - lastAt < spacing) return withXp(progress, 0);
  const stat = STAT_FOR[event];
  const stats = { ...progress.stats, [stat]: progress.stats[stat] + 1 };
  return withXp({ ...progress, stats }, XP_FOR[event]);
}

/** The most tabs open at once; no XP, only the record. */
export function noteTabs(progress: NyuProgress, open: number): NyuProgress {
  if (open <= progress.stats.maxTabs) return progress;
  return { ...progress, stats: { ...progress.stats, maxTabs: Math.floor(open) } };
}

/**
 * The app was used on `now`'s day: count the day, carry or break the streak,
 * remember the occasions, hand out the daily XP. Idempotent within a day.
 */
export function touchDay(progress: NyuProgress, now: Date): Gain {
  const today = localDay(now);
  const occasions = occasionsOn(now).filter((occasion) => occasion !== 'night');
  const seen = [...progress.seen];
  for (const occasion of occasions) if (!seen.includes(occasion)) seen.push(occasion);
  const withSeen = seen.length === progress.seen.length ? progress : { ...progress, seen };

  if (progress.days.last === today) return withXp(withSeen, 0);
  const streak =
    progress.days.last && isNextDay(progress.days.last, today) ? progress.days.streak + 1 : 1;
  const days = {
    last: today,
    streak,
    best: Math.max(progress.days.best, streak),
    total: progress.days.total + 1,
  };
  const bonus = XP.newDay + XP.streakDay * Math.min(streak - 1, STREAK_BONUS_CAP);
  return withXp({ ...withSeen, days }, bonus);
}

/* ── Achievements ──────────────────────────────────────── */

export type Achievement = {
  id: AchievementId;
  /** German, `N_()`: translated where shown. */
  title: string;
  /** How to get it, shown greyed out until then. */
  hint: string;
  test: (progress: NyuProgress) => boolean;
  /** An accessory that comes with it. */
  hat?: HatId;
};

const seenOn = (occasion: Occasion) => (progress: NyuProgress) => progress.seen.includes(occasion);

export const ACHIEVEMENTS: readonly Achievement[] = [
  {
    id: 'first-line',
    title: N_('Erste Zeile'),
    hint: N_('Schreib deine erste Zeile.'),
    test: (p) => p.stats.lines >= 1,
  },
  {
    id: 'lines-1000',
    title: N_('1000 Zeilen'),
    hint: N_('Schreib tausend Zeilen.'),
    test: (p) => p.stats.lines >= 1000,
  },
  {
    id: 'chars-100k',
    title: N_('Tintenfass'),
    hint: N_('Tipp hunderttausend Zeichen.'),
    test: (p) => p.stats.chars >= 100_000,
  },
  {
    id: 'night-owl',
    title: N_('Nachteule'),
    hint: N_('Schreib nach ein Uhr nachts.'),
    test: (p) => p.stats.night >= 1,
    hat: 'nightcap',
  },
  {
    id: 'early-bird',
    title: N_('Frühaufsteher'),
    hint: N_('Schreib vor sieben Uhr morgens.'),
    test: (p) => p.stats.early >= 1,
  },
  {
    id: 'macro-master',
    title: N_('Makro-Meisterin'),
    hint: N_('Spiel 100 Makros ab.'),
    test: (p) => p.stats.macros >= 100,
  },
  {
    id: 'tab-juggler',
    title: N_('Tab-Jongleurin'),
    hint: N_('Hab 30 Tabs gleichzeitig offen.'),
    test: (p) => p.stats.maxTabs >= 30,
  },
  {
    id: 'regex-wizard',
    title: N_('Regex-Magierin'),
    hint: N_('Finde 25-mal etwas mit einem regulären Ausdruck.'),
    test: (p) => p.stats.regex >= 25,
  },
  {
    id: 'save-pro',
    title: N_('Speicher-Profi'),
    hint: N_('Speichere 500-mal.'),
    test: (p) => p.stats.saves >= 500,
  },
  {
    id: 'files-100',
    title: N_('Bücherwurm'),
    hint: N_('Öffne 100 Dateien.'),
    test: (p) => p.stats.filesOpened >= 100,
  },
  {
    id: 'streak-7',
    title: N_('7-Tage-Streak'),
    hint: N_('Schau sieben Tage hintereinander vorbei.'),
    test: (p) => p.days.best >= 7,
  },
  {
    id: 'streak-30',
    title: N_('30-Tage-Streak'),
    hint: N_('Schau dreißig Tage hintereinander vorbei.'),
    test: (p) => p.days.best >= 30,
  },
  {
    id: 'pomodoro-hero',
    title: N_('Pomodoro-Held'),
    hint: N_('Schließ zehn Nyu-Pomodoros ab.'),
    test: (p) => p.stats.pomodoros >= 10,
  },
  {
    id: 'konami',
    title: N_('Geheimcode'),
    hint: N_('Ein sehr alter Code. Hoch, hoch, runter, runter …'),
    test: (p) => p.stats.konami >= 1,
    hat: 'sunglasses',
  },
  {
    id: 'egg',
    title: N_('Geheimwort'),
    hint: N_('Nyu hört auf bestimmte Wörter.'),
    test: (p) => p.stats.eggs >= 1,
  },
  {
    id: 'petting',
    title: N_('Streicheleinheiten'),
    hint: N_('Streichle Nyu 50-mal.'),
    test: (p) => p.stats.pets >= 50,
  },
  {
    id: 'spooky',
    title: N_('Gruselzeit'),
    hint: N_('Schau im Oktober vorbei.'),
    test: seenOn('halloween'),
    hat: 'witch',
  },
  {
    id: 'festive',
    title: N_('Plätzchenzeit'),
    hint: N_('Schau in der Adventszeit vorbei.'),
    test: seenOn('advent'),
    hat: 'santa',
  },
  {
    id: 'birthday',
    title: N_('Geburtstagsgast'),
    hint: N_('Feier den Geburtstag von UwUNotes mit (19. September).'),
    test: seenOn('birthday'),
    hat: 'party',
  },
  {
    id: 'newyear',
    title: N_('Guten Rutsch'),
    hint: N_('Schau an Silvester oder Neujahr vorbei.'),
    test: seenOn('newyear'),
    hat: 'party',
  },
  {
    id: 'easter',
    title: N_('Eiersuche'),
    hint: N_('Schau über Ostern vorbei.'),
    test: seenOn('easter'),
    hat: 'bunny',
  },
  {
    id: 'valentine',
    title: N_('Herzklopfen'),
    hint: N_('Schau am Valentinstag vorbei.'),
    test: seenOn('valentine'),
  },
  {
    id: 'friday13',
    title: N_('Glückskatze'),
    hint: N_('Schau an einem Freitag, dem 13., vorbei.'),
    test: seenOn('friday13'),
  },
];

/** Unlocks whatever is newly earned, with its XP. Returns the ids that are new. */
export function unlockAchievements(
  progress: NyuProgress,
  now: number,
): Gain & { unlocked: AchievementId[] } {
  const unlocked: AchievementId[] = [];
  let next = progress;
  for (const achievement of ACHIEVEMENTS) {
    if (next.achievements[achievement.id] !== undefined) continue;
    if (!achievement.test(next)) continue;
    unlocked.push(achievement.id);
    next = { ...next, achievements: { ...next.achievements, [achievement.id]: now } };
  }
  return { ...withXp(next, unlocked.length * XP.achievement), unlocked };
}

/** Every accessory she may wear: from levels and from achievements. */
export function unlockedHats(progress: NyuProgress): HatId[] {
  const level = levelForXp(progress.xp);
  const hats = new Set<HatId>();
  for (const entry of LEVEL_HATS) if (level >= entry.level) hats.add(entry.hat);
  for (const achievement of ACHIEVEMENTS) {
    if (achievement.hat && progress.achievements[achievement.id] !== undefined) {
      hats.add(achievement.hat);
    }
  }
  return HAT_IDS.filter((hat) => hats.has(hat));
}

/** How a hat is unlocked, for the locked tiles in the picker. */
export function hatSource(hat: HatId): { level?: number; achievement?: Achievement } {
  const level = LEVEL_HATS.find((entry) => entry.hat === hat)?.level;
  const achievement = ACHIEVEMENTS.find((entry) => entry.hat === hat);
  return { ...(level ? { level } : {}), ...(achievement ? { achievement } : {}) };
}

/**
 * What she wears right now. An explicit choice wins — the user picked it — as
 * long as it is still unlocked; `auto` is the occasion's hat when occasions are
 * on, and nothing otherwise.
 */
export function pickHat(progress: NyuProgress, now: Date, occasionsEnabled: boolean): HatId | null {
  const choice = progress.hat;
  if (choice === 'none') return null;
  if (choice !== 'auto' && unlockedHats(progress).includes(choice)) return choice;
  return occasionsEnabled ? occasionHat(now) : null;
}

/* ── Reading it back ───────────────────────────────────── */

const ACHIEVEMENT_IDS = new Set<string>(ACHIEVEMENTS.map((entry) => entry.id));
const OCCASIONS: readonly Occasion[] = [
  'newyear',
  'birthday',
  'easter',
  'valentine',
  'friday13',
  'advent',
  'halloween',
  'night',
];
/** Above this a number is a hand-edit — not a lifetime of writing, and not a timestamp either. */
const COUNT_MAX = 1e15;

export function sanitizeProgress(raw: unknown): NyuProgress {
  const input = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const count = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(COUNT_MAX, Math.max(0, Math.floor(value)))
      : 0;
  const record = (value: unknown) =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const day = (value: unknown) =>
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;

  const statsIn = record(input.stats);
  const stats = { ...ZERO_STATS };
  for (const key of Object.keys(ZERO_STATS) as (keyof NyuStats)[]) stats[key] = count(statsIn[key]);

  const daysIn = record(input.days);
  const streak = count(daysIn.streak);

  const achievements: Partial<Record<AchievementId, number>> = {};
  for (const [id, at] of Object.entries(record(input.achievements))) {
    if (ACHIEVEMENT_IDS.has(id)) achievements[id as AchievementId] = count(at);
  }

  const seen = Array.isArray(input.seen)
    ? OCCASIONS.filter((occasion) => (input.seen as unknown[]).includes(occasion))
    : [];

  const greeted: Partial<Record<Occasion, string>> = {};
  for (const [occasion, value] of Object.entries(record(input.greeted))) {
    const when = day(value);
    if (when && (OCCASIONS as readonly string[]).includes(occasion)) {
      greeted[occasion as Occasion] = when;
    }
  }

  const hat =
    input.hat === 'auto' || input.hat === 'none' || HAT_IDS.includes(input.hat as HatId)
      ? (input.hat as HatChoice)
      : 'auto';

  const minuteIn = record(input.minute);
  return {
    version: 1,
    xp: count(input.xp),
    charsPending: Math.min(CHARS_PER_XP - 1, count(input.charsPending)),
    stats,
    days: {
      last: day(daysIn.last),
      streak,
      best: Math.max(streak, count(daysIn.best)),
      total: count(daysIn.total),
    },
    achievements,
    seen,
    greeted,
    hat,
    minute: {
      at: count(minuteIn.at),
      chars: Math.min(CHARS_PER_MINUTE_CAP, count(minuteIn.chars)),
    },
  };
}

/* ── The store ─────────────────────────────────────────── */

/** Versioned, so a future shape can migrate instead of guessing. */
export const PROGRESS_KEY = 'uwunotes.nyu.v1';
/** Typing changes the progress every few keys; storage hears about it at most this often. */
const PERSIST_DELAY_MS = 5_000;

function load(): NyuProgress {
  try {
    const raw = window.localStorage.getItem(PROGRESS_KEY);
    return sanitizeProgress(raw ? JSON.parse(raw) : {});
  } catch {
    return FRESH_PROGRESS;
  }
}

let current = load();
const listeners = new Set<() => void>();
let persistTimer = 0;

export function getProgress(): NyuProgress {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useProgress(): NyuProgress {
  return useSyncExternalStore(subscribe, getProgress);
}

/** Writes now. Called by the delayed persist, and when the window goes away. */
export function flushProgress(): void {
  window.clearTimeout(persistTimer);
  persistTimer = 0;
  try {
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(current));
  } catch {
    // Private storage can be unavailable; the progress still holds for this run.
  }
}

/**
 * Replaces the progress. `announce: false` is for the typing path: the numbers
 * change, nothing on screen depends on them until a whole XP point lands.
 */
export function setProgress(next: NyuProgress, announce = true): void {
  if (next === current) return;
  current = next;
  if (!persistTimer) persistTimer = window.setTimeout(flushProgress, PERSIST_DELAY_MS);
  if (announce) for (const listener of listeners) listener();
}

export function chooseHat(hat: HatChoice): void {
  setProgress({ ...current, hat });
  flushProgress();
}

/** Back to level 1, nothing unlocked. The hat choice goes too: it may not be unlocked any more. */
export function resetProgress(): void {
  current = FRESH_PROGRESS;
  flushProgress();
  for (const listener of listeners) listener();
}

/** The hat for right now, by settings, progress and date. */
export function currentHat(now = new Date()): HatId | null {
  return pickHat(current, now, getSettings().nyuOccasions);
}

function subscribeHat(listener: () => void): () => void {
  const stopProgress = subscribe(listener);
  const stopSettings = subscribeSettings(listener);
  return () => {
    stopProgress();
    stopSettings();
  };
}

/**
 * The hat, in a component. The snapshot is the hat itself — a string — so a
 * component re-renders when the hat changes and not on every XP point typed.
 * The date is read with it, which is often enough for a hat that changes at
 * midnight.
 */
export function useNyuHat(): HatId | null {
  return useSyncExternalStore(subscribeHat, () => currentHat());
}
