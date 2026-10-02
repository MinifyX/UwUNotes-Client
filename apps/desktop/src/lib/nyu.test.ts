/**
 * Nyu's manners: good news in one breath, and nothing next to bad news.
 *
 * The first start unlocks several achievements at once — the first day, the
 * season's occasion, maybe a level. That must be one short toast, not a stack
 * of four that stays; zen mode gets none until it is left. And while a
 * question or an error is on screen she neither reacts nor speaks.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./toast')>();
  return { ...actual, toast: vi.fn(actual.toast) };
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  document.body.replaceChildren();
});

async function fresh() {
  vi.resetModules();
  window.localStorage.clear();
  const nyu = await import('./nyu');
  const events = await import('./nyu-events');
  const life = await import('./nyu-life');
  const prompt = await import('./prompt');
  const toastModule = await import('./toast');
  return { nyu, events, life, prompt, toastModule, toast: vi.mocked(toastModule.toast) };
}

/** Toasts that are achievement or level notices: the brief ones with a button. */
function notices(toast: ReturnType<typeof vi.mocked<typeof import('./toast').toast>>) {
  return toast.mock.calls.filter(([, , action, options]) => action && options?.brief);
}

describe('achievement notices', () => {
  it('gather what the first start unlocks into one toast', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    // October: the season's occasion unlocks along with the first day.
    vi.setSystemTime(new Date(2026, 9, 2, 10, 0));
    const { nyu, toast } = await fresh();
    const stop = nyu.startNyu();

    expect(notices(toast)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(nyu.NOTICE_GATHER_MS + 100);

    const shown = notices(toast);
    expect(shown).toHaveLength(1);
    expect(shown[0]?.[1]).toMatch(/Spooky season/);
    // Brief: it goes by itself, like any good news.
    expect(shown[0]?.[3]).toEqual({ brief: true });
    stop();
  });

  it('wait for zen mode to end, then come as one', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date(2026, 9, 2, 10, 0));
    const zen = document.createElement('div');
    zen.dataset.zen = 'true';
    document.body.append(zen);
    const { nyu, events, toast } = await fresh();
    const stop = nyu.startNyu();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(notices(toast)).toHaveLength(0);

    zen.remove();
    events.emitNyu('zen-left');
    await vi.advanceTimersByTimeAsync(nyu.NOTICE_GATHER_MS + 100);
    expect(notices(toast)).toHaveLength(1);
    stop();
  });

  it('say how many there are when there are several', async () => {
    const { nyu } = await fresh();
    // The test page speaks English, in the playful tone.
    expect(nyu.noticeText(['first-line'], null)).toBe('New achievement: First line ✧');
    const several = nyu.noticeText(['first-line', 'spooky'], { from: 1, to: 2 });
    expect(several).toMatch(/^Level 2!/);
    expect(several).toMatch(/2 new achievements: First line, Spooky season ✧$/);
  });
});

describe('bad news', () => {
  it('keeps her still while a question is open', async () => {
    const { nyu, events, life, prompt } = await fresh();
    const stop = nyu.startNyu();
    const question = prompt.ask('Papierkorb leeren?', undefined, [
      { id: 'empty', label: 'Endgültig löschen', tone: 'danger' },
      { id: 'cancel', label: 'Abbrechen', tone: 'quiet' },
    ]);

    // Whatever the start-up already played stays; 'saved' adds nothing.
    const before = life.getLife().reaction;
    events.emitNyu('saved');
    expect(life.getLife().reaction).toBe(before);

    prompt.dismissPrompt(1);
    await question;
    events.emitNyu('saved');
    expect(life.getLife().reaction).toEqual(expect.objectContaining({ motion: 'nod' }));
    stop();
  });

  it('keeps her still while an error toast is showing', async () => {
    const { nyu, events, life, toastModule } = await fresh();
    const stop = nyu.startNyu();
    const error = toastModule.toast('error', 'Die Datei ließ sich nicht lesen.');

    const before = life.getLife().reaction;
    events.emitNyu('saved');
    expect(life.getLife().reaction).toBe(before);

    toastModule.dismissToast(error);
    events.emitNyu('saved');
    expect(life.getLife().reaction).toEqual(expect.objectContaining({ motion: 'nod' }));
    stop();
  });
});
