/**
 * The Nyu-Pomodoro. The machine is pure and judged by an injected clock; the
 * store is driven with fake timers to check it keeps exactly one timeout and
 * tells Nyu when a round ends.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onNyu, type NyuEventKind } from './nyu-events';
import {
  advancePomodoro,
  formatRemaining,
  getPomodoro,
  IDLE,
  pausePomodoro,
  remainingMs,
  resetPomodoro,
  resumePomodoro,
  setPomodoroFinishHandler,
  skipPhase,
  startFocus,
  startPomodoro,
  stopFocus,
  togglePomodoro,
  type PomodoroConfig,
} from './nyu-pomodoro';
import { resetSettings } from './settings';

const MIN = 60_000;
const CONFIG: PomodoroConfig = {
  focusMs: 25 * MIN,
  breakMs: 5 * MIN,
  longBreakMs: 15 * MIN,
  longEvery: 4,
};

describe('the machine', () => {
  it('runs a focus round, starts the break by itself, and ends idle', () => {
    let state = startPomodoro(IDLE, CONFIG, 0);
    expect(state.phase).toBe('focus');
    expect(remainingMs(state, 10 * MIN)).toBe(15 * MIN);
    expect(advancePomodoro(state, CONFIG, 25 * MIN - 1).finished).toBeNull();

    const ended = advancePomodoro(state, CONFIG, 25 * MIN);
    expect(ended.finished).toBe('focus');
    state = ended.state;
    expect(state).toMatchObject({ phase: 'break', done: 1, endsAt: 30 * MIN });

    const rested = advancePomodoro(state, CONFIG, 30 * MIN);
    expect(rested.finished).toBe('break');
    expect(rested.state).toEqual({ ...IDLE, done: 1 });
  });

  it('takes the long break after every fourth round, then starts the count again', () => {
    let state = { ...IDLE, done: 3 };
    state = startPomodoro(state, CONFIG, 0);
    const ended = advancePomodoro(state, CONFIG, 25 * MIN);
    expect(ended.state.phase).toBe('longBreak');
    expect(ended.state.endsAt).toBe(40 * MIN);
    expect(advancePomodoro(ended.state, CONFIG, 40 * MIN).state.done).toBe(0);
  });

  it('starts a break from when it is noticed, not from when the round should have ended', () => {
    const state = startPomodoro(IDLE, CONFIG, 0);
    const late = advancePomodoro(state, CONFIG, 60 * MIN);
    expect(late.state.endsAt).toBe(65 * MIN);
  });

  it('pauses and resumes without losing time', () => {
    let state = startPomodoro(IDLE, CONFIG, 0);
    state = pausePomodoro(state, 10 * MIN);
    expect(state.endsAt).toBeNull();
    expect(remainingMs(state, 99 * MIN)).toBe(15 * MIN);
    expect(advancePomodoro(state, CONFIG, 99 * MIN).finished).toBeNull();
    state = resumePomodoro(state, 50 * MIN);
    expect(state.endsAt).toBe(65 * MIN);
  });

  it('formats the countdown the way a clock does', () => {
    expect(formatRemaining(25 * MIN)).toBe('25:00');
    expect(formatRemaining(61_000)).toBe('1:01');
    expect(formatRemaining(500)).toBe('0:01');
    expect(formatRemaining(0)).toBe('0:00');
    expect(formatRemaining(62 * MIN)).toBe('1:02:00');
  });
});

describe('the store', () => {
  const events: NyuEventKind[] = [];
  let stopListening = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    window.localStorage.clear();
    resetSettings();
    resetPomodoro();
    events.length = 0;
    stopListening = onNyu((event) => events.push(event.kind));
  });

  afterEach(() => {
    stopListening();
    setPomodoroFinishHandler(null);
    resetPomodoro();
    vi.useRealTimers();
  });

  it('keeps one timeout, ends the round on time and tells Nyu', () => {
    const finished: string[] = [];
    setPomodoroFinishHandler((phase) => finished.push(phase));
    startFocus();
    expect(events).toEqual(['pomodoro-started']);
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(25 * MIN + 100);
    expect(getPomodoro().phase).toBe('break');
    expect(events).toContain('pomodoro-done');
    expect(finished).toEqual(['focus']);
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(5 * MIN + 100);
    expect(getPomodoro().phase).toBeNull();
    expect(finished).toEqual(['focus', 'break']);
    // Idle is quiet: nothing left ticking.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('toggles between running and paused, and a pause holds no timer', () => {
    togglePomodoro();
    expect(getPomodoro().endsAt).not.toBeNull();
    vi.advanceTimersByTime(MIN);
    togglePomodoro();
    expect(getPomodoro().endsAt).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60 * MIN);
    expect(getPomodoro().phase).toBe('focus');
    togglePomodoro();
    expect(remainingMs(getPomodoro(), Date.now())).toBe(24 * MIN);
  });

  it('skips to the break and stops', () => {
    startFocus();
    skipPhase();
    expect(getPomodoro().phase).toBe('break');
    stopFocus();
    expect(getPomodoro()).toEqual(IDLE);
    expect(vi.getTimerCount()).toBe(0);
  });
});
