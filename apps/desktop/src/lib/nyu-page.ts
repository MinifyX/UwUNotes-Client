/**
 * The Nyu-Zentrale: which of its tabs is showing, and the lists it draws.
 *
 * The page itself is `components/nyu/companion/NyuDialog.tsx`; everything here
 * is plain data so it can be tested without a DOM. The tab lives outside the
 * component because the menu opens the page *on* a tab ("Erfolge" lands on the
 * achievements), and the dialog slot in `lib/commands.ts` only knows that the
 * page is open, not where. This module deliberately does not import that one:
 * `lib/commands.ts` imports it.
 */

import { useSyncExternalStore } from 'react';
import { OCCASION_HATS, type Occasion } from '../components/nyu/occasions';
import { N_ } from './i18n';
import {
  ACHIEVEMENTS,
  SECRETS,
  type Achievement,
  type AchievementId,
  type NyuProgress,
  type SecretId,
} from './nyu-progress';

/* ── The tab ───────────────────────────────────────────── */

export const NYU_TABS = [
  { id: 'overview', label: N_('Übersicht') },
  { id: 'achievements', label: N_('Erfolge') },
  { id: 'wardrobe', label: N_('Garderobe') },
  { id: 'pomodoro', label: N_('Pomodoro') },
  { id: 'secrets', label: N_('Geheimnisse') },
  { id: 'settings', label: N_('Einstellungen') },
] as const;

export type NyuTab = (typeof NYU_TABS)[number]['id'];

let tab: NyuTab = 'overview';
const listeners = new Set<() => void>();

export function getNyuTab(): NyuTab {
  return tab;
}

export function setNyuTab(next: NyuTab): void {
  if (next === tab) return;
  tab = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useNyuTab(): NyuTab {
  return useSyncExternalStore(subscribe, getNyuTab);
}

/** The tab one step along, wrapping — for the arrow keys on the tab strip. */
export function stepTab(from: NyuTab, delta: number): NyuTab {
  const at = NYU_TABS.findIndex((entry) => entry.id === from);
  const count = NYU_TABS.length;
  return NYU_TABS[(((at + delta) % count) + count) % count]!.id;
}

/* ── Achievements ──────────────────────────────────────── */

export type AchievementRow = {
  id: AchievementId;
  /** `done` with a date, `open` with a hint, `secret` with neither. */
  state: 'done' | 'open' | 'secret';
  /** German source text for `t()`, or `null` for a secret's "???". */
  title: string | null;
  hint: string | null;
  /** When it was unlocked, milliseconds since the epoch. */
  at: number | null;
};

/**
 * Every achievement as the page lists it: the unlocked ones first, newest on
 * top, then the open ones in their own order, then the secrets nobody has
 * found yet — the "???" rows are a teaser, and belong at the end.
 */
export function achievementRows(
  progress: NyuProgress,
  achievements: readonly Achievement[] = ACHIEVEMENTS,
): AchievementRow[] {
  const rows = achievements.map((achievement): AchievementRow => {
    const at = progress.achievements[achievement.id];
    if (at !== undefined) {
      return {
        id: achievement.id,
        state: 'done',
        title: achievement.title,
        hint: achievement.hint,
        at,
      };
    }
    if (achievement.secret) {
      return { id: achievement.id, state: 'secret', title: null, hint: null, at: null };
    }
    return {
      id: achievement.id,
      state: 'open',
      title: achievement.title,
      hint: achievement.hint,
      at: null,
    };
  });
  const rank = { done: 0, open: 1, secret: 2 } as const;
  return rows
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
        rank[a.row.state] - rank[b.row.state] ||
        (b.row.at ?? 0) - (a.row.at ?? 0) ||
        a.index - b.index,
    )
    .map(({ row }) => row);
}

/* ── Secrets and occasions ─────────────────────────────── */

export type SecretRow = { id: SecretId; found: boolean; text: string };

export function secretRows(progress: NyuProgress): SecretRow[] {
  return SECRETS.map((secret) => {
    const found = progress.found.includes(secret.id);
    return { id: secret.id, found, text: found ? secret.name : secret.teaser };
  });
}

/** In calendar order, from January on. `night` is not a day but a time, so it goes last. */
const OCCASION_ORDER: readonly Occasion[] = [
  'newyear',
  'valentine',
  'easter',
  'birthday',
  'halloween',
  'advent',
  'friday13',
  'night',
];

export const OCCASION_NAMES: Record<Occasion, string> = {
  newyear: N_('Silvester und Neujahr'),
  valentine: N_('Valentinstag'),
  easter: N_('Ostern'),
  birthday: N_('Geburtstag von UwUNotes'),
  halloween: N_('Halloween'),
  advent: N_('Adventszeit'),
  friday13: N_('Freitag, der 13.'),
  night: N_('Spät in der Nacht'),
};

export type OccasionRow = {
  id: Occasion;
  name: string;
  seen: boolean;
  hat: (typeof OCCASION_HATS)[Occasion];
};

export function occasionRows(progress: NyuProgress): OccasionRow[] {
  return OCCASION_ORDER.map((id) => ({
    id,
    name: OCCASION_NAMES[id],
    seen: progress.seen.includes(id),
    hat: OCCASION_HATS[id],
  }));
}

/* ── Pomodoro ──────────────────────────────────────────── */

/**
 * How many focus rounds until the long break: `every` right after one, 1 when
 * the next finished round earns it. `done` counts the focus rounds of this run.
 */
export function roundsUntilLongBreak(done: number, every: number): number {
  const cycle = Math.max(1, Math.floor(every));
  return cycle - (Math.max(0, Math.floor(done)) % cycle);
}
