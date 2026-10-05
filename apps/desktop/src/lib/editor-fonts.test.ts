import { describe, expect, it } from 'vitest';
import { groupFonts, previewStack } from './editor-fonts';

const system = [
  { family: 'Cascadia Code', monospace: true },
  { family: 'JetBrains Mono Variable', monospace: true },
  { family: 'Arial', monospace: false },
  { family: 'Noto Sans Mono', monospace: true },
];

describe('the editor font groups', () => {
  it('lists bundled faces once, then the system monospace ones, then the rest', () => {
    expect(groupFonts(system, '')).toEqual({
      bundled: ['JetBrains Mono Variable', 'Fira Code Variable', 'UwU Console'],
      monospace: ['Cascadia Code', 'Noto Sans Mono'],
      other: ['Arial'],
    });
  });

  it('finds every word of the search in any case', () => {
    expect(groupFonts(system, 'MONO noto')).toEqual({
      bundled: [],
      monospace: ['Noto Sans Mono'],
      other: [],
    });
  });
});

describe('a preview stack', () => {
  it('quotes the name and keeps it inside its string', () => {
    expect(previewStack('Cascadia Code')).toBe('"Cascadia Code", var(--uwu-mono)');
    expect(previewStack('a"}\\b')).toBe('"ab", var(--uwu-mono)');
    expect(previewStack('')).toBe('var(--uwu-mono)');
    expect(previewStack('UwU Console')).toBe('"UwU Console", ui-monospace, monospace');
  });
});
