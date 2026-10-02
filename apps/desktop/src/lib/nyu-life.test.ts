/**
 * The companion's poses. The pure half is driven with explicit timestamps; the
 * store half with fake timers, to check it re-renders on pose changes only and
 * keeps at most one timer around.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Cooldowns,
  DIZZY_CLICKS,
  EXCITED_AFTER_MS,
  freshActivity,
  getLife,
  lifeKey,
  nextChange,
  noteKey,
  petClick,
  poseAt,
  react,
  resetLife,
  say,
  SLEEP_AFTER_MS,
  startLife,
  TYPING_PAUSE_MS,
  WAKE_MS,
  type Activity,
} from './nyu-life';

/** Keys every `gap` ms from `from` to `to`. */
function typeFor(activity: Activity, from: number, to: number, gap = 150): Activity {
  let next = activity;
  for (let now = from; now <= to; now += gap) next = noteKey(next, now);
  return next;
}

describe('poses', () => {
  it('idles until the keys come fast, then types along, then stops on a pause', () => {
    let activity = freshActivity(0);
    expect(poseAt(activity, 0)).toBe('idle');
    activity = noteKey(activity, 1_000);
    expect(poseAt(activity, 1_000)).toBe('idle');
    activity = typeFor(activity, 1_150, 1_750);
    expect(poseAt(activity, 1_750)).toBe('typing');
    expect(poseAt(activity, 1_750 + TYPING_PAUSE_MS + 1)).toBe('idle');
  });

  it('gets excited after a long unbroken run, and not after slow pecking', () => {
    const fast = typeFor(freshActivity(0), 1_000, 1_000 + EXCITED_AFTER_MS);
    expect(poseAt(fast, 1_000 + EXCITED_AFTER_MS)).toBe('excited');

    // One key every three seconds is a run broken every time.
    const slow = typeFor(freshActivity(0), 1_000, 1_000 + EXCITED_AFTER_MS, 3_000);
    expect(poseAt(slow, slow.lastKey)).toBe('idle');
  });

  it('falls asleep after a few quiet minutes and stretches when woken', () => {
    let activity = noteKey(freshActivity(0), 0);
    expect(poseAt(activity, SLEEP_AFTER_MS - 1)).toBe('idle');
    expect(poseAt(activity, SLEEP_AFTER_MS)).toBe('sleeping');
    const woke = SLEEP_AFTER_MS + 5_000;
    activity = noteKey(activity, woke);
    expect(poseAt(activity, woke)).toBe('waking');
    expect(poseAt(activity, woke + WAKE_MS)).toBe('idle');
  });

  it('knows when the pose will next change by itself, and that sleep lasts', () => {
    const activity = noteKey(freshActivity(0), 0);
    expect(nextChange(activity, 0)).toBe(SLEEP_AFTER_MS);
    expect(nextChange(activity, SLEEP_AFTER_MS)).toBeNull();
    const typing = typeFor(freshActivity(0), 0, 600);
    expect(nextChange(typing, 600)).toBe(TYPING_PAUSE_MS);
  });
});

describe('petting and cooldowns', () => {
  it('gets dizzy on one click too many within the window', () => {
    let clicks: number[] = [];
    for (let i = 0; i < DIZZY_CLICKS - 1; i += 1) {
      const result = petClick(clicks, i * 100);
      expect(result.dizzy).toBe(false);
      clicks = result.clicks;
    }
    expect(petClick(clicks, 600).dizzy).toBe(true);
    // Slow, patient petting never does.
    let slow: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const result = petClick(slow, i * 1_000);
      expect(result.dizzy).toBe(false);
      slow = result.clicks;
    }
  });

  it('lets a key through once per cooldown', () => {
    const cooldowns = new Cooldowns();
    expect(cooldowns.allow('saved', 4_000, 0)).toBe(true);
    expect(cooldowns.allow('saved', 4_000, 3_999)).toBe(false);
    expect(cooldowns.allow('other', 4_000, 3_999)).toBe(true);
    expect(cooldowns.allow('saved', 4_000, 4_000)).toBe(true);
    expect(cooldowns.recent('saved', 1_000, 4_500)).toBe(true);
  });
});

describe('the store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    resetLife(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('falls asleep on its own timer and wakes on a key, with one timer at a time', () => {
    const stop = startLife(0);
    expect(getLife().pose).toBe('idle');
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(SLEEP_AFTER_MS);
    expect(getLife().pose).toBe('sleeping');
    // Asleep is a resting state: nothing ticks.
    expect(vi.getTimerCount()).toBe(0);
    lifeKey(Date.now());
    expect(getLife().pose).toBe('waking');
    vi.advanceTimersByTime(WAKE_MS);
    expect(getLife().pose).toBe('idle');
    stop();
  });

  it('types along and settles back without polling', () => {
    const stop = startLife(0);
    for (let i = 0; i < 8; i += 1) {
      vi.advanceTimersByTime(120);
      lifeKey(Date.now());
    }
    expect(getLife().pose).toBe('typing');
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(TYPING_PAUSE_MS + 10);
    expect(getLife().pose).toBe('idle');
    stop();
  });

  it('plays a reaction and a bubble for their time, then clears them', () => {
    react({ mood: 'cheer', motion: 'hop', burst: 'stars', ms: 1_000 });
    say('Hallo', 2_000);
    say('');
    expect(getLife().reaction?.mood).toBe('cheer');
    expect(getLife().bubble?.text).toBe('Hallo');
    vi.advanceTimersByTime(1_000);
    expect(getLife().reaction).toBeNull();
    expect(getLife().bubble).not.toBeNull();
    vi.advanceTimersByTime(1_000);
    expect(getLife().bubble).toBeNull();
  });
});
