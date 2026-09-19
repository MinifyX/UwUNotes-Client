/**
 * One chirp, for the moment the install is finished.
 *
 * Synthesised here rather than shipped as a file, exactly as `lib/sound.ts` in
 * the editor does it: two sine blips are a few lines of code and no bytes in a
 * setup people download, and nothing in this window may touch the network.
 *
 * It is the same rising A5 → E6 the editor plays after a save, so the first
 * thing UwUNotes ever says sounds like the thing it will keep saying.
 *
 * What this module does NOT do: make a noise when something fails. The editor
 * has a low note for that; an installer that has just told someone their disk
 * is full should not also beep at them. It also does not decide whether to
 * play — `App.tsx` owns the mute toggle in the title bar.
 */

/** Punctuation, not an alarm: well under the editor's own 0.14 ceiling. */
const PEAK = 0.09;

function blip(context: AudioContext, delaySeconds: number, hertz: number, seconds: number): void {
  const at = context.currentTime + delaySeconds;
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(hertz, at);
  // A square-edged start clicks audibly; 8 ms of attack removes it without
  // being long enough to hear as a fade.
  envelope.gain.setValueAtTime(0, at);
  envelope.gain.linearRampToValueAtTime(PEAK, at + 0.008);
  // Exponential, because a linear decay on a sine sounds like it was cut off.
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  oscillator.connect(envelope).connect(context.destination);
  oscillator.start(at);
  oscillator.stop(at + seconds + 0.02);
}

/**
 * The finish chirp. Safe to call when there is no audio device at all: a
 * decorative noise is not worth an error on a page whose job is to install
 * something.
 */
export function chirp(): void {
  let context: AudioContext;
  try {
    context = new AudioContext();
  } catch {
    return;
  }
  blip(context, 0, 880, 0.09);
  blip(context, 0.07, 1318.5, 0.13);
  // The window usually closes before this fires, and the context would go with
  // it; closing it anyway keeps the audio device free in the run that does not.
  setTimeout(() => void context.close().catch(() => undefined), 1200);
}
