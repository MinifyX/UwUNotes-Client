import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { encodeText } from './text-bytes';

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('encodeText', () => {
  it('encodes a small document in one go', async () => {
    const doc = Text.of(['Grüße', 'zweite Zeile 🐱']);
    expect(decode(await encodeText(doc))).toBe('Grüße\nzweite Zeile 🐱');
  });

  it('encodes a large document in slices, byte for byte', async () => {
    const lines = Array.from(
      { length: 40_000 },
      (_, i) => `Zeile ${i} — äöü 🐱 ${'x'.repeat(i % 7)}`,
    );
    const doc = Text.of(lines);
    const bytes = await encodeText(doc);
    const expected = new TextEncoder().encode(lines.join('\n'));
    expect(bytes.byteLength).toBe(expected.byteLength);
    expect(Buffer.compare(bytes, expected)).toBe(0);
  });

  it('grows past a wrong size guess for wide text', async () => {
    const lines = Array.from({ length: 20_000 }, () => '漢字漢字漢字漢字漢字漢字漢字');
    const bytes = await encodeText(Text.of(lines));
    expect(decode(bytes)).toBe(lines.join('\n'));
  });
});
