import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearToasts, getToasts, pauseToasts, resumeToasts, toast } from './toast';

describe('toast pause', () => {
  afterEach(() => {
    clearToasts();
    vi.useRealTimers();
  });

  it('keeps a toast while paused and lets it go after resuming', () => {
    vi.useFakeTimers();
    toast('info', 'Hallo');
    pauseToasts();
    vi.advanceTimersByTime(60_000);
    expect(getToasts()).toHaveLength(1);
    resumeToasts();
    vi.advanceTimersByTime(60_000);
    expect(getToasts()).toHaveLength(0);
  });

  it('is never left paused once the stack is empty', () => {
    vi.useFakeTimers();
    toast('info', 'eins');
    pauseToasts();
    clearToasts();
    toast('info', 'zwei');
    vi.advanceTimersByTime(60_000);
    expect(getToasts()).toHaveLength(0);
  });
});
