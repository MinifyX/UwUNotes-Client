/**
 * Smoke tests for the drawings and the companion's components: every hat,
 * every cameo scene, the companion in each pose, the Pomodoro item and Nyu's
 * page render without throwing and show what they should. The rules behind
 * them have their own tests in `lib/`; this only makes sure the pictures and
 * the wiring hold together.
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDialog, openDialog } from '../../../lib/commands';
import { CAMEOS, type CameoName } from '../../../lib/nyu-cameo';
import { react, resetLife, say } from '../../../lib/nyu-life';
import { resetPomodoro, startFocus } from '../../../lib/nyu-pomodoro';
import { resetProgress } from '../../../lib/nyu-progress';
import { getSettings, resetSettings, updateSettings } from '../../../lib/settings';
import { getNyuTab, setNyuTab } from '../../../lib/nyu-page';
import { HAT_IDS, hatParts } from '../hats';
import { NyuFigure } from '../Nyu';
import { NyuScene } from '../scenes';
import CameoScene from './CameoScenes';
import { NyuCompanion } from './NyuCompanion';
import { NyuDialog } from './NyuDialog';
import { PomodoroItem } from './PomodoroItem';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function mount(element: Parameters<Root['render']>[0]) {
  act(() => root.render(element));
}

beforeEach(() => {
  window.localStorage.clear();
  resetSettings();
  resetProgress();
  resetLife();
  resetPomodoro();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  closeDialog();
  resetPomodoro();
});

describe('drawings', () => {
  it('draws Nyu in every hat', () => {
    for (const hat of HAT_IDS) {
      const markup = renderToStaticMarkup(
        createElement('svg', null, createElement(NyuFigure, { mood: 'happy', ...hatParts(hat) })),
      );
      expect(markup).toContain('<path');
    }
  });

  it('draws the empty-state scenes with a hat on', () => {
    const markup = renderToStaticMarkup(createElement(NyuScene, { name: 'empty', hat: 'witch' }));
    expect(markup).toContain('nyu-host');
  });

  it('draws every cameo', () => {
    for (const name of Object.keys(CAMEOS) as CameoName[]) {
      const markup = renderToStaticMarkup(createElement(CameoScene, { name, hat: 'santa' }));
      expect(markup).toContain('nyu-cameo-svg');
    }
  });
});

describe('the companion', () => {
  it('sits in the bar, says her line, and goes away when switched off', () => {
    mount(createElement(NyuCompanion));
    expect(host.querySelector('.nyu-companion')).not.toBeNull();
    expect(host.querySelector('.nyu-look')).not.toBeNull();

    act(() => {
      react({ mood: 'cheer', motion: 'dance', burst: 'confetti', ms: 1_000 });
      say('Hallo Welt');
    });
    expect(host.querySelector('.nyu-burst')).not.toBeNull();
    expect(host.querySelector('.nyu-bubble')?.textContent).toBe('Hallo Welt');
    expect(host.querySelector('[data-motion="dance"]')).not.toBeNull();

    act(() => updateSettings({ nyuCompanion: false }));
    expect(host.querySelector('.nyu-companion')).toBeNull();
  });
});

describe('the Pomodoro item', () => {
  it('is a tomato when idle and a countdown while running', () => {
    mount(createElement(PomodoroItem));
    const button = host.querySelector('.nyu-pomodoro-item');
    expect(button).not.toBeNull();
    expect(button?.textContent).toBe('');
    act(() => startFocus());
    expect(host.querySelector('.nyu-pomodoro-time')?.textContent).toBe('25:00');
  });

  it('hides when the setting says so and nothing is running', () => {
    updateSettings({ pomodoroButton: false });
    mount(createElement(PomodoroItem));
    expect(host.querySelector('.nyu-pomodoro-item')).toBeNull();
  });
});

describe('Nyu’s page', () => {
  it('shows the level, the wardrobe with locked hats, and the achievements', () => {
    updateSettings({ language: 'de' });
    setNyuTab('wardrobe');
    openDialog('nyu');
    mount(createElement(NyuDialog));
    expect(document.body.textContent).toContain('Level 1');
    const crown = [...document.querySelectorAll<HTMLButtonElement>('.nyu-hat')].find((button) =>
      button.textContent?.includes('Krone'),
    );
    expect(crown?.disabled).toBe(true);
    act(() => setNyuTab('achievements'));
    expect(document.querySelectorAll('.nyu-achievement').length).toBeGreaterThan(10);
  });

  it('keeps the secret achievements secret until they are found', () => {
    updateSettings({ language: 'de' });
    setNyuTab('achievements');
    openDialog('nyu');
    mount(createElement(NyuDialog));
    const secret = document.querySelectorAll('.nyu-achievement[data-secret]');
    expect(secret.length).toBeGreaterThan(0);
    for (const row of secret) expect(row.textContent).toContain('???');
    expect(document.body.textContent).not.toContain('Geheimcode');
  });

  it('switches tabs and flips a setting from its own tab', () => {
    updateSettings({ language: 'de' });
    setNyuTab('overview');
    openDialog('nyu');
    mount(createElement(NyuDialog));
    const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (button) => button.textContent === 'Einstellungen',
    );
    act(() => tab?.click());
    expect(getNyuTab()).toBe('settings');
    const companion = document.querySelector<HTMLButtonElement>('[role="switch"]');
    expect(companion?.getAttribute('aria-checked')).toBe('true');
    act(() => companion?.click());
    expect(getSettings().nyuCompanion).toBe(false);
  });

  it('hides the counting when levels are off, but keeps the wardrobe', () => {
    updateSettings({ nyuLevels: false });
    setNyuTab('achievements');
    openDialog('nyu');
    mount(createElement(NyuDialog));
    expect(document.querySelector('.nyu-level')).toBeNull();
    expect(document.querySelector('.nyu-achievement')).toBeNull();
    act(() => setNyuTab('wardrobe'));
    expect(document.querySelector('.nyu-hats')).not.toBeNull();
  });
});
