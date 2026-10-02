/**
 * The two small pieces of zen mode that are elements rather than rules.
 *
 * Everything else zen mode does to the window is `styles/focus.css` keyed off
 * `data-zen` on `.app`: the chrome is not removed from the tree, only moved out
 * of sight, so leaving zen is one attribute coming off and every component
 * still has the state it had.
 */

import { useEffect, useState } from 'react';
import { t } from '../lib/i18n';

/**
 * A thin, invisible strip along the top or bottom edge. Resting the pointer on
 * it brings the title bar or the status bar back until the pointer leaves
 * them again — a reveal you have to go looking for, so nothing slides in while
 * you are reading.
 */
export function ZenEdge({ edge }: { edge: 'top' | 'bottom' }) {
  return <div className="zen-edge" data-edge={edge} aria-hidden />;
}

/** How long the hint stays before it fades: long enough to read twice. */
const HINT_MS = 2_400;
/** Matches the fade in `focus.css`, so the element goes once it is invisible. */
const HINT_FADE_MS = 400;

/**
 * "Esc zum Verlassen", once, on the way in.
 *
 * A status, not a toast: it is not news, and a toast would sit in the corner
 * zen mode just emptied. Mounted by `App.tsx` while zen is on, so each entry
 * shows it again and leaving takes it away mid-fade if need be.
 */
export function ZenHint() {
  const [phase, setPhase] = useState<'shown' | 'fading' | 'gone'>('shown');

  useEffect(() => {
    const fade = window.setTimeout(() => setPhase('fading'), HINT_MS);
    const gone = window.setTimeout(() => setPhase('gone'), HINT_MS + HINT_FADE_MS);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(gone);
    };
  }, []);

  if (phase === 'gone') return null;
  return (
    <div className="zen-hint" role="status" data-phase={phase}>
      {t('Esc zum Verlassen')}
    </div>
  );
}
