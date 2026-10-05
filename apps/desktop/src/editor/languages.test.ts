import { describe, expect, it } from 'vitest';
import { LANGUAGES } from './languages';

describe('the language list', () => {
  it('gives C, C++ and C# ids of their own', () => {
    const id = (name: string) => LANGUAGES.find((entry) => entry.name === name)?.id;
    expect(new Set([id('C'), id('C++'), id('C#')]).size).toBe(3);
    expect(id('C++')).toBe('cpp');
    expect(id('C#')).toBe('csharp');
  });
});
