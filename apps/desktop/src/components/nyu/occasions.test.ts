/**
 * Which days are special. Every date is built in local time and handed in, so
 * none of this depends on when the tests run.
 */

import { describe, expect, it } from 'vitest';
import {
  easterSunday,
  firstAdvent,
  isLateNight,
  isNextDay,
  localDay,
  occasionHat,
  occasionsOn,
} from './occasions';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0);

describe('Easter and Advent', () => {
  it('finds Easter Sunday for years the algorithm is known to get right', () => {
    expect(localDay(easterSunday(2024))).toBe('2024-03-31');
    expect(localDay(easterSunday(2025))).toBe('2025-04-20');
    expect(localDay(easterSunday(2026))).toBe('2026-04-05');
    expect(localDay(easterSunday(2027))).toBe('2027-03-28');
    expect(localDay(easterSunday(2038))).toBe('2038-04-25');
  });

  it('starts Advent four Sundays before Christmas, also when Christmas is a Sunday', () => {
    expect(localDay(firstAdvent(2026))).toBe('2026-11-29');
    expect(localDay(firstAdvent(2022))).toBe('2022-11-27');
    expect(localDay(firstAdvent(2023))).toBe('2023-12-03');
  });
});

describe('occasions', () => {
  it('is Halloween all through October, and not on the first of November', () => {
    expect(occasionsOn(at(2026, 10, 1))).toContain('halloween');
    expect(occasionsOn(at(2026, 10, 31))).toContain('halloween');
    expect(occasionsOn(at(2026, 11, 1))).not.toContain('halloween');
    expect(occasionHat(at(2026, 10, 2))).toBe('witch');
  });

  it('runs Advent from its first Sunday until Boxing Day', () => {
    expect(occasionsOn(at(2026, 11, 28))).not.toContain('advent');
    expect(occasionsOn(at(2026, 11, 29))).toContain('advent');
    expect(occasionsOn(at(2026, 12, 26))).toContain('advent');
    expect(occasionsOn(at(2026, 12, 27))).not.toContain('advent');
    expect(occasionHat(at(2026, 12, 24))).toBe('santa');
  });

  it('puts the party hat on for New Year, ahead of everything else', () => {
    expect(occasionHat(at(2026, 12, 31))).toBe('party');
    expect(occasionHat(at(2027, 1, 1, 1))).toBe('party');
    expect(occasionsOn(at(2027, 1, 1, 1))).toEqual(['newyear', 'night']);
  });

  it('knows the long Easter weekend and Valentine’s Day', () => {
    expect(occasionsOn(at(2026, 4, 3))).toContain('easter');
    expect(occasionsOn(at(2026, 4, 6))).toContain('easter');
    expect(occasionsOn(at(2026, 4, 7))).not.toContain('easter');
    expect(occasionHat(at(2026, 4, 5))).toBe('bunny');
    expect(occasionsOn(at(2026, 2, 14))).toContain('valentine');
  });

  it('celebrates the app’s birthday on 19 September', () => {
    expect(occasionsOn(at(2027, 9, 19))).toContain('birthday');
    expect(occasionHat(at(2027, 9, 19))).toBe('party');
  });

  it('spots Friday the 13th, which has a joke but no hat', () => {
    // 13 November 2026 is a Friday.
    expect(occasionsOn(at(2026, 11, 13))).toEqual(['friday13']);
    expect(occasionHat(at(2026, 11, 13))).toBeNull();
    expect(occasionsOn(at(2026, 12, 13))).not.toContain('friday13');
  });

  it('is late night from midnight to five, and the nightcap only wins on an ordinary day', () => {
    expect(isLateNight(at(2026, 6, 10, 0))).toBe(true);
    expect(isLateNight(at(2026, 6, 10, 4))).toBe(true);
    expect(isLateNight(at(2026, 6, 10, 5))).toBe(false);
    expect(isLateNight(at(2026, 6, 10, 23))).toBe(false);
    expect(occasionHat(at(2026, 6, 10, 2))).toBe('nightcap');
    expect(occasionHat(at(2026, 10, 10, 2))).toBe('witch');
    expect(occasionHat(at(2026, 6, 10, 14))).toBeNull();
  });
});

describe('days', () => {
  it('counts the next calendar day across months, years and leap days', () => {
    expect(isNextDay('2026-10-01', '2026-10-02')).toBe(true);
    expect(isNextDay('2026-10-31', '2026-11-01')).toBe(true);
    expect(isNextDay('2026-12-31', '2027-01-01')).toBe(true);
    expect(isNextDay('2028-02-28', '2028-02-29')).toBe(true);
    expect(isNextDay('2026-10-01', '2026-10-03')).toBe(false);
    expect(isNextDay('nonsense', '2026-10-03')).toBe(false);
  });
});
