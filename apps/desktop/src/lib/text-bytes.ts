/**
 * A document's text as UTF-8, built a slice at a time.
 *
 * `new TextEncoder().encode(doc.toString())` is one blocking call, and for a
 * log with two million lines it is half a second in which the window does not
 * answer — every time a draft is written. A CodeMirror `Text` is immutable and
 * already stored in chunks, so it can be walked across several tasks without
 * anything changing under the walk: this encodes for a few milliseconds,
 * yields to the event loop, and carries on.
 *
 * Small documents take the one-call path; slicing them would only add waits.
 */

import type { Text } from '@codemirror/state';

/** Below this many UTF-16 units the whole text is encoded in one go. */
const SMALL_TEXT = 256 * 1024;
/** How long one slice may run before giving the event loop a turn. */
const SLICE_MS = 8;
/** Pieces are joined to about this size before each `encodeInto`. */
const BATCH_UNITS = 64 * 1024;

const encoder = new TextEncoder();

/** Lets input and painting run, then continues. A message, not a 4 ms-clamped timer. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

export async function encodeText(doc: Text): Promise<Uint8Array> {
  if (doc.length <= SMALL_TEXT) return encoder.encode(doc.toString());

  // Mostly-ASCII text is one byte per unit, so the length is a good first
  // guess; anything wider grows the buffer the usual way.
  let buffer = new Uint8Array(Math.ceil(doc.length * 1.1) + 16);
  let used = 0;

  const write = (piece: string) => {
    // UTF-8 needs at most three bytes per UTF-16 unit.
    const needed = used + piece.length * 3;
    if (needed > buffer.length) {
      const grown = new Uint8Array(Math.max(needed, buffer.length * 2));
      grown.set(buffer.subarray(0, used));
      buffer = grown;
    }
    const { written } = encoder.encodeInto(piece, buffer.subarray(used));
    used += written;
  };

  let batch: string[] = [];
  let batchUnits = 0;
  let sliceStart = performance.now();
  const iterator = doc.iter();
  for (;;) {
    iterator.next();
    if (iterator.done) break;
    const piece = iterator.lineBreak ? '\n' : iterator.value;
    batch.push(piece);
    batchUnits += piece.length;
    if (batchUnits < BATCH_UNITS) continue;
    // `iter()` hands out whole lines and the breaks between them, so no
    // surrogate pair is ever split across two `encodeInto` calls.
    write(batch.join(''));
    batch = [];
    batchUnits = 0;
    if (performance.now() - sliceStart > SLICE_MS) {
      await yieldToEventLoop();
      sliceStart = performance.now();
    }
  }
  if (batch.length > 0) write(batch.join(''));
  return buffer.subarray(0, used);
}
