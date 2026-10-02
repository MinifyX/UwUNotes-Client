/**
 * Levels, XP and achievements. The interesting promises are the anti-farming
 * ones — a held key, a Ctrl+S drum roll and a cat clicked a thousand times are
 * not writing — and that whatever comes back from storage is usable.
 */

import { describe, expect, it } from 'vitest';
import {
  CHARS_PER_MINUTE_CAP,
  CHARS_PER_XP,
  FRESH_PROGRESS,
  gainEvent,
  gainTyping,
  levelForXp,
  levelProgress,
  noteTabs,
  pickHat,
  sanitizeProgress,
  touchDay,
  unlockAchievements,
  unlockedHats,
  xpForLevel,
  XP,
  type NyuProgress,
} from './nyu-progress';

const NOON = new Date(2026, 5, 10, 12, 0, 0).getTime();

describe('the level curve', () => {
  it('starts at level 1 and gets steeper', () => {
    expect(levelForXp(0)).toBe(1);
    expect(xpForLevel(2)).toBe(80);
    expect(xpForLevel(3)).toBe(200);
    expect(levelForXp(79)).toBe(1);
    expect(levelForXp(80)).toBe(2);
    expect(xpForLevel(11) - xpForLevel(10)).toBeGreaterThan(xpForLevel(3) - xpForLevel(2));
  });

  it('reports the way to the next level', () => {
    expect(levelProgress(100)).toEqual({ level: 2, into: 20, needed: 120 });
  });

  it('stops at the top instead of running off', () => {
    expect(levelForXp(Number.MAX_SAFE_INTEGER)).toBe(99);
  });
});

describe('typing', () => {
  it('turns counted characters into XP and keeps the remainder', () => {
    const gain = gainTyping(FRESH_PROGRESS, { chars: CHARS_PER_XP * 3 + 7, lines: 0 }, NOON);
    expect(gain.progress.xp).toBe(3);
    expect(gain.progress.charsPending).toBe(7);
    expect(gain.progress.stats.chars).toBe(CHARS_PER_XP * 3 + 7);
  });

  it('caps what one minute can earn, however fast the keys come', () => {
    let progress = FRESH_PROGRESS;
    for (let i = 0; i < 5_000; i += 1) {
      progress = gainTyping(progress, { chars: 1, lines: 0 }, NOON + i).progress;
    }
    expect(progress.stats.chars).toBe(CHARS_PER_MINUTE_CAP);
    expect(progress.xp).toBe(Math.floor(CHARS_PER_MINUTE_CAP / CHARS_PER_XP));
    // The next minute has room again.
    progress = gainTyping(progress, { chars: 10, lines: 0 }, NOON + 60_000).progress;
    expect(progress.stats.chars).toBe(CHARS_PER_MINUTE_CAP + 10);
  });

  it('caps lines from the same bucket, so a held Enter is no thousand lines', () => {
    let progress = FRESH_PROGRESS;
    for (let i = 0; i < 2_000; i += 1) {
      progress = gainTyping(progress, { chars: 0, lines: 1 }, NOON + i).progress;
    }
    expect(progress.stats.lines).toBe(CHARS_PER_MINUTE_CAP);
  });

  it('notes a night session and an early one, once per minute', () => {
    const night = new Date(2026, 5, 10, 2, 30).getTime();
    let progress = gainTyping(FRESH_PROGRESS, { chars: 5, lines: 0 }, night).progress;
    progress = gainTyping(progress, { chars: 5, lines: 0 }, night + 1_000).progress;
    expect(progress.stats.night).toBe(1);
    const early = new Date(2026, 5, 10, 6, 15).getTime();
    progress = gainTyping(progress, { chars: 5, lines: 0 }, early).progress;
    expect(progress.stats.early).toBe(1);
    expect(gainTyping(FRESH_PROGRESS, { chars: 5, lines: 0 }, NOON).progress.stats.night).toBe(0);
  });
});

describe('events', () => {
  it('counts a save with its XP, and ignores one right after another', () => {
    const first = gainEvent(FRESH_PROGRESS, 'save', NOON, undefined);
    expect(first.progress.stats.saves).toBe(1);
    expect(first.progress.xp).toBe(XP.save);
    const spam = gainEvent(first.progress, 'save', NOON + 500, NOON);
    expect(spam.progress).toBe(first.progress);
    const later = gainEvent(first.progress, 'save', NOON + 3_000, NOON);
    expect(later.progress.stats.saves).toBe(2);
  });

  it('counts petting without paying XP for it', () => {
    const gain = gainEvent(FRESH_PROGRESS, 'pet', NOON, NOON - 1);
    expect(gain.progress.stats.pets).toBe(1);
    expect(gain.progress.xp).toBe(0);
  });

  it('keeps the record of open tabs', () => {
    const more = noteTabs(FRESH_PROGRESS, 12);
    expect(more.stats.maxTabs).toBe(12);
    expect(noteTabs(more, 3)).toBe(more);
  });

  it('reports a level step', () => {
    const near = { ...FRESH_PROGRESS, xp: 79 };
    const gain = gainEvent(near, 'save', NOON, undefined);
    expect(gain.levelBefore).toBe(1);
    expect(gain.levelAfter).toBe(2);
  });
});

describe('days and streaks', () => {
  const day = (d: number) => new Date(2026, 9, d, 10);

  it('counts a day once, carries a streak and breaks it after a gap', () => {
    let progress = touchDay(FRESH_PROGRESS, day(1)).progress;
    expect(progress.days).toEqual({ last: '2026-10-01', streak: 1, best: 1, total: 1 });
    const again = touchDay(progress, day(1));
    expect(again.progress.days).toEqual(progress.days);
    expect(again.progress.xp).toBe(progress.xp);
    progress = touchDay(progress, day(2)).progress;
    progress = touchDay(progress, day(3)).progress;
    expect(progress.days.streak).toBe(3);
    progress = touchDay(progress, day(5)).progress;
    expect(progress.days).toMatchObject({ streak: 1, best: 3, total: 4 });
  });

  it('remembers the occasions it was around for', () => {
    const progress = touchDay(FRESH_PROGRESS, day(2)).progress;
    expect(progress.seen).toContain('halloween');
    expect(progress.seen).not.toContain('night');
  });
});

describe('achievements and hats', () => {
  it('unlocks what is earned, once, with XP and the hat that comes with it', () => {
    const october = touchDay(FRESH_PROGRESS, new Date(2026, 9, 2, 10)).progress;
    const first = unlockAchievements(october, NOON);
    expect(first.unlocked).toEqual(['spooky']);
    expect(first.progress.xp).toBe(october.xp + XP.achievement);
    expect(unlockedHats(first.progress)).toContain('witch');
    expect(unlockAchievements(first.progress, NOON).unlocked).toEqual([]);
  });

  it('gives level hats by level', () => {
    expect(unlockedHats({ ...FRESH_PROGRESS, xp: xpForLevel(5) })).toEqual([
      'bow',
      'glasses',
      'flower',
    ]);
  });

  it('wears the chosen hat if it is unlocked, the occasion’s otherwise', () => {
    const october = new Date(2026, 9, 2, 12);
    const june = new Date(2026, 5, 2, 12);
    const levelled: NyuProgress = { ...FRESH_PROGRESS, xp: xpForLevel(3) };
    expect(pickHat({ ...levelled, hat: 'glasses' }, october, true)).toBe('glasses');
    expect(pickHat({ ...levelled, hat: 'crown' }, october, true)).toBe('witch');
    expect(pickHat({ ...levelled, hat: 'auto' }, october, true)).toBe('witch');
    expect(pickHat({ ...levelled, hat: 'auto' }, october, false)).toBeNull();
    expect(pickHat({ ...levelled, hat: 'auto' }, june, true)).toBeNull();
    expect(pickHat({ ...levelled, hat: 'none' }, october, true)).toBeNull();
  });
});

describe('reading it back', () => {
  it('takes anything that is not an object as a fresh start', () => {
    expect(sanitizeProgress(null)).toEqual(FRESH_PROGRESS);
    expect(sanitizeProgress('lots')).toEqual(FRESH_PROGRESS);
    expect(sanitizeProgress([1, 2])).toEqual(FRESH_PROGRESS);
  });

  it('drops wrong types, unknown ids and impossible numbers field by field', () => {
    const progress = sanitizeProgress({
      xp: 'lots',
      charsPending: 9_999,
      stats: { chars: -5, saves: 12.7, pets: Number.POSITIVE_INFINITY, bogus: 3 },
      days: { last: 'yesterday', streak: 4, best: 2, total: '7' },
      achievements: { spooky: 123, 'hack-the-planet': 1 },
      seen: ['halloween', 'mars-day', 7],
      greeted: { halloween: '2026-10-02', advent: 'soon', nope: '2026-01-01' },
      hat: 'tiara',
      minute: { at: 5, chars: 1e9 },
    });
    expect(progress.xp).toBe(0);
    expect(progress.charsPending).toBe(CHARS_PER_XP - 1);
    expect(progress.stats.chars).toBe(0);
    expect(progress.stats.saves).toBe(12);
    expect(progress.stats.pets).toBe(0);
    expect(progress).not.toHaveProperty('stats.bogus');
    expect(progress.days).toEqual({ last: null, streak: 4, best: 4, total: 0 });
    expect(progress.achievements).toEqual({ spooky: 123 });
    expect(progress.seen).toEqual(['halloween']);
    expect(progress.greeted).toEqual({ halloween: '2026-10-02' });
    expect(progress.hat).toBe('auto');
    expect(progress.minute).toEqual({ at: 5, chars: CHARS_PER_MINUTE_CAP });
  });

  it('round-trips a real progress unchanged', () => {
    let progress = touchDay(FRESH_PROGRESS, new Date(2026, 9, 2, 10)).progress;
    progress = gainTyping(progress, { chars: 120, lines: 4 }, NOON).progress;
    progress = unlockAchievements(progress, NOON).progress;
    progress = { ...progress, hat: 'witch' };
    expect(sanitizeProgress(JSON.parse(JSON.stringify(progress)))).toEqual(progress);
  });
});
