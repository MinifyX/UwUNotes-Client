/**
 * Two very small noises: one for a save that went through, one for something
 * that went wrong.
 *
 * Synthesised with WebAudio rather than shipped as files. Two sine blips are a
 * dozen lines of code and no bytes in the bundle, and nothing here ever touches
 * the network — an editor that phones out to play a chirp would be an editor
 * nobody should install.
 *
 * Off by default, and this module does NOT decide when to play: it is called
 * from `lib/files.ts` at the two moments that earn a sound. A keystroke does
 * not.
 */

import { getSettings } from './settings';

let context: AudioContext | null = null;

/**
 * The shared context, created on the first sound rather than at start-up.
 *
 * Browsers refuse to start audio before a user gesture; by the time anything
 * here plays, the user has saved a file, which counts. `resume()` covers the
 * case where the window was backgrounded long enough for the context to be
 * suspended underneath us.
 */
function audio(): AudioContext | null {
  if (!context) {
    try {
      context = new AudioContext();
    } catch {
      // No audio device, or the API is unavailable. Silence is an acceptable
      // outcome for a decorative blip.
      return null;
    }
  }
  if (context.state === 'suspended') void context.resume().catch(() => undefined);
  return context;
}

/** Zero when sounds are off, so callers need no second check. */
function level(): number {
  const settings = getSettings();
  // Scaled well below the system volume on purpose: these are punctuation, not
  // an alarm, and 0.14 is about where a sine stops being startling.
  return settings.sounds ? settings.soundVolume * 0.14 : 0;
}

function blip(delaySeconds: number, hertz: number, seconds: number, peak: number): void {
  const ctx = audio();
  if (!ctx) return;
  const at = ctx.currentTime + delaySeconds;
  const oscillator = ctx.createOscillator();
  const envelope = ctx.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(hertz, at);
  // A square-edged start clicks audibly; 8 ms of attack removes it without
  // being long enough to hear as a fade.
  envelope.gain.setValueAtTime(0, at);
  envelope.gain.linearRampToValueAtTime(peak, at + 0.008);
  // Exponential, because a linear decay on a sine sounds like it was cut off.
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  oscillator.connect(envelope).connect(ctx.destination);
  oscillator.start(at);
  oscillator.stop(at + seconds + 0.02);
}

/** A rising two-note chirp: A5 into E6, which reads as "done" rather than "attention". */
export function playSaved(): void {
  const peak = level();
  if (peak <= 0) return;
  blip(0, 880, 0.09, peak);
  blip(0.07, 1318.5, 0.13, peak * 0.85);
}

/** One low note. Down and short — an error is not worth a melody. */
export function playError(): void {
  const peak = level();
  if (peak <= 0) return;
  blip(0, 196, 0.22, peak);
}
