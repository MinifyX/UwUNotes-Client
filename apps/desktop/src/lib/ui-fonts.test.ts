import { describe, expect, it } from 'vitest';
import { applyUiFont, isUiFont, UI_FONT_CHOICES, UI_FONT_STACKS } from './ui-fonts';

describe('the interface font', () => {
  it('puts the chosen stack on the root for every rule to read', () => {
    const root = document.createElement('html');
    applyUiFont('dmsans', root);
    expect(root.style.getPropertyValue('--font-ui')).toBe(UI_FONT_STACKS.dmsans);
    expect(root.dataset.font).toBe('dmsans');
  });

  it('knows its four choices and nothing else', () => {
    expect(UI_FONT_CHOICES).toEqual(['uwu', 'rubik', 'dmsans', 'system']);
    expect(isUiFont('rubik')).toBe(true);
    expect(isUiFont('manrope')).toBe(false);
    expect(isUiFont(undefined)).toBe(false);
  });

  it('falls back to the system font behind every bundled one', () => {
    for (const choice of UI_FONT_CHOICES) {
      expect(UI_FONT_STACKS[choice]).toContain('system-ui');
    }
  });
});
