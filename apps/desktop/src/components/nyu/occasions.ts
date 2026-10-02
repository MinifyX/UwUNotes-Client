/**
 * Which days are special, and what Nyu wears on them.
 *
 * Pure date arithmetic: every function takes the date it should judge, so the
 * tests can ask about Easter 2027 without waiting for it. Like the rest of this
 * folder it knows no settings — whether occasions are switched on is the
 * caller's question (see `lib/nyu-progress.ts`, `currentHat()`).
 *
 * Local time throughout. "After midnight" means the user's midnight, and a
 * Halloween that started at 02:00 because UTC said so would be a strange
 * Halloween.
 */

import type { HatId } from './hats';

export type Occasion =
  'newyear' | 'birthday' | 'easter' | 'valentine' | 'friday13' | 'advent' | 'halloween' | 'night';

/**
 * The day UwUNotes 0.1.0 was tagged (v0.1.0, 2026-09-19). Month is 1-based
 * here, unlike `Date`, because that is how a birthday is written down.
 */
export const APP_BIRTHDAY = { month: 9, day: 19, year: 2026 } as const;

/**
 * Easter Sunday in the Gregorian calendar — the anonymous algorithm (Meeus /
 * Jones / Butcher). Integer arithmetic only, valid for every year anybody will
 * run this app in.
 */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/** The first Sunday of Advent: the fourth Sunday before Christmas Day. */
export function firstAdvent(year: number): Date {
  const christmas = new Date(year, 11, 25);
  // Sunday is 0. Christmas on a Sunday still counts back a whole week first,
  // because the fourth Advent is the Sunday *before* the 25th.
  const back = christmas.getDay() === 0 ? 7 : christmas.getDay();
  return new Date(year, 11, 25 - back - 21);
}

/** Midnight of the day, for comparing calendar days without the clock. */
function dayStart(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

const DAY = 86_400_000;

/** Late at night: from midnight until 04:59, local time. */
export function isLateNight(now: Date): boolean {
  return now.getHours() < 5;
}

/**
 * Every occasion that applies right now, most specific first.
 *
 * The order is the precedence for the hat: a birthday beats October, and any
 * real occasion beats the nightcap — a party hat at 01:00 on New Year's Day is
 * the right picture.
 */
export function occasionsOn(now: Date): Occasion[] {
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const today = dayStart(now);
  const found: Occasion[] = [];

  if ((month === 12 && day === 31) || (month === 1 && day === 1)) found.push('newyear');
  if (month === APP_BIRTHDAY.month && day === APP_BIRTHDAY.day) found.push('birthday');

  // Good Friday to Easter Monday: the long weekend is when people are home.
  const easter = dayStart(easterSunday(now.getFullYear()));
  if (today >= easter - 2 * DAY && today <= easter + DAY) found.push('easter');

  if (month === 2 && day === 14) found.push('valentine');
  if (day === 13 && now.getDay() === 5) found.push('friday13');

  const advent = dayStart(firstAdvent(now.getFullYear()));
  if (today >= advent && (month < 12 || day <= 26)) found.push('advent');

  // All of October: one evening would be over before anybody noticed the hat.
  if (month === 10) found.push('halloween');

  if (isLateNight(now)) found.push('night');
  return found;
}

/** What an occasion puts on Nyu's head, if anything. */
export const OCCASION_HATS: Record<Occasion, HatId | null> = {
  newyear: 'party',
  birthday: 'party',
  easter: 'bunny',
  valentine: 'bow',
  // The joke on Friday the 13th is a black cat crossing the editor, not a hat.
  friday13: null,
  advent: 'santa',
  halloween: 'witch',
  night: 'nightcap',
};

/** The hat for right now: the first occasion that has one. */
export function occasionHat(now: Date): HatId | null {
  for (const occasion of occasionsOn(now)) {
    const hat = OCCASION_HATS[occasion];
    if (hat) return hat;
  }
  return null;
}

/** "YYYY-MM-DD" of the local day: the key streaks and once-a-day greetings use. */
export function localDay(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Whether `later` is the calendar day right after `earlier` (both "YYYY-MM-DD"). */
export function isNextDay(earlier: string, later: string): boolean {
  const parse = (text: string) => {
    const [y, m, d] = text.split('-').map(Number);
    return y && m && d ? new Date(y, m - 1, d) : null;
  };
  const a = parse(earlier);
  const b = parse(later);
  if (!a || !b) return false;
  // One calendar day later, whatever daylight saving did to the hours.
  const next = new Date(a.getFullYear(), a.getMonth(), a.getDate() + 1);
  return localDay(next) === localDay(b);
}
