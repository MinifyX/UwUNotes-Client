/**
 * The Nyu-Zentrale's lists: what is shown for an achievement in each of its
 * three states, the secrets and their teasers, and the tab strip's wrapping.
 */

import { describe, expect, it } from 'vitest';
import {
  achievementRows,
  NYU_TABS,
  occasionRows,
  roundsUntilLongBreak,
  secretRows,
  stepTab,
} from './nyu-page';
import {
  ACHIEVEMENTS,
  FRESH_PROGRESS,
  noteSecret,
  sanitizeProgress,
  SECRETS,
  type NyuProgress,
} from './nyu-progress';

const withAchievements = (achievements: NyuProgress['achievements']): NyuProgress => ({
  ...FRESH_PROGRESS,
  achievements,
});

describe('achievementRows', () => {
  it('lists every achievement exactly once', () => {
    const rows = achievementRows(FRESH_PROGRESS);
    expect(rows.map((row) => row.id).sort()).toEqual(ACHIEVEMENTS.map((a) => a.id).sort());
  });

  it('hides a secret that is still locked, and nothing else', () => {
    const rows = achievementRows(FRESH_PROGRESS);
    const secret = rows.filter((row) => row.state === 'secret');
    expect(secret.map((row) => row.id).sort()).toEqual(
      ACHIEVEMENTS.filter((a) => a.secret)
        .map((a) => a.id)
        .sort(),
    );
    for (const row of secret) {
      expect(row.title).toBeNull();
      expect(row.hint).toBeNull();
    }
    for (const row of rows.filter((row) => row.state === 'open')) {
      expect(row.title).toBeTruthy();
      expect(row.hint).toBeTruthy();
    }
  });

  it('shows an unlocked secret like any other unlocked achievement', () => {
    const row = achievementRows(withAchievements({ konami: 5 })).find((r) => r.id === 'konami');
    expect(row).toMatchObject({ state: 'done', at: 5, title: 'Geheimcode' });
  });

  it('puts the unlocked ones first, newest on top, and the secrets last', () => {
    const rows = achievementRows(withAchievements({ 'first-line': 10, 'save-pro': 20 }));
    expect(rows[0]?.id).toBe('save-pro');
    expect(rows[1]?.id).toBe('first-line');
    expect(rows[2]?.state).toBe('open');
    expect(rows[rows.length - 1]?.state).toBe('secret');
    // The open ones keep the catalogue's order.
    const open = rows.filter((row) => row.state === 'open').map((row) => row.id);
    const catalogue = ACHIEVEMENTS.map((a) => a.id).filter((id) => open.includes(id));
    expect(open).toEqual(catalogue);
  });
});

describe('secrets', () => {
  it('teases what is not found and names what is', () => {
    const progress = noteSecret(FRESH_PROGRESS, 'owo');
    const rows = secretRows(progress);
    expect(rows).toHaveLength(SECRETS.length);
    const owo = rows.find((row) => row.id === 'owo');
    const uwu = rows.find((row) => row.id === 'uwu');
    expect(owo).toMatchObject({ found: true, text: '„owo“ getippt' });
    expect(uwu?.found).toBe(false);
    expect(uwu?.text).not.toContain('uwu');
  });

  it('remembers a secret once', () => {
    const once = noteSecret(FRESH_PROGRESS, 'konami');
    expect(noteSecret(once, 'konami')).toBe(once);
    expect(once.found).toEqual(['konami']);
  });

  it('keeps known secrets from storage and drops the rest', () => {
    const progress = sanitizeProgress({ found: ['nyu', 'nyu', 'rm -rf', 42, 'konami'] });
    expect(progress.found).toEqual(['nyu', 'konami']);
    expect(sanitizeProgress({}).found).toEqual([]);
    expect(sanitizeProgress({ found: 'uwu' }).found).toEqual([]);
  });
});

describe('occasionRows', () => {
  it('marks the occasions she has been around for', () => {
    const rows = occasionRows({ ...FRESH_PROGRESS, seen: ['halloween'] });
    expect(rows.find((row) => row.id === 'halloween')).toMatchObject({ seen: true, hat: 'witch' });
    expect(rows.filter((row) => row.seen)).toHaveLength(1);
    expect(rows[rows.length - 1]?.id).toBe('night');
  });
});

describe('the tab strip', () => {
  it('wraps around both ends', () => {
    const first = NYU_TABS[0].id;
    const last = NYU_TABS[NYU_TABS.length - 1]!.id;
    expect(stepTab(first, -1)).toBe(last);
    expect(stepTab(last, 1)).toBe(first);
    expect(stepTab(first, 1)).toBe(NYU_TABS[1].id);
  });
});

describe('roundsUntilLongBreak', () => {
  it('counts down to the long break and starts over after it', () => {
    expect(roundsUntilLongBreak(0, 4)).toBe(4);
    expect(roundsUntilLongBreak(3, 4)).toBe(1);
    expect(roundsUntilLongBreak(4, 4)).toBe(4);
    expect(roundsUntilLongBreak(2, 0)).toBe(1);
  });
});
