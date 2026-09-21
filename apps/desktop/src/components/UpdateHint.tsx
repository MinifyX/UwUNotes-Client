/**
 * The strip above the status bar that says a new version is there.
 *
 * A bar and never a dialog. An update is not urgent, it is not an answer to
 * anything the user just did, and a modal over somebody's half-written file to
 * announce one would be the rudest thing in the app. It takes a row of the
 * window, says what is on offer, and can be sent away with one button.
 *
 * It decides nothing: every phase, every failure and the whole install come
 * from `lib/updates.ts`. This is the drawing, plus the one piece of judgement
 * that belongs to drawing — that `tone: 'neutral'` means no cat, and that a
 * failure gets no cat either way, because a mascot next to bad news reads as
 * the app not taking it seriously.
 */

import { useState } from 'react';
import { openExternal } from '../lib/api';
import { t, useLanguage } from '../lib/i18n';
import { useSettings } from '../lib/settings';
import { dismissUpdate, installUpdateNow, useUpdateState, type UpdateState } from '../lib/updates';
import { Icon } from './Icon';
import { Nyu } from './nyu/Nyu';

/** Where a copy that cannot update itself sends people for the new version. */
const RELEASES_URL = 'https://github.com/MinifyX/UwUNotes-Client/releases/latest';

export function UpdateHint() {
  useLanguage();
  const settings = useSettings();
  const state = useUpdateState();
  const [showNotes, setShowNotes] = useState(false);

  // Nothing on offer and nothing running: the row collapses to no height at
  // all, which is why `.app` can carry it unconditionally.
  if (state.phase === 'idle' || state.phase === 'checking') return null;

  const failed = state.phase === 'failed';
  const withCat = settings.tone === 'playful' && !failed;
  const notes = state.phase === 'available' || state.phase === 'downloading' ? state.notes : null;
  const percent =
    state.phase === 'downloading' && state.progress !== null
      ? Math.round(state.progress * 100)
      : null;

  // `role` carries the urgency on its own — `status` is polite, `alert` cuts in
  // — so there is no `aria-live` on the element to disagree with it.
  return (
    <aside
      className="update-hint"
      data-tone={failed ? 'error' : 'info'}
      role={failed ? 'alert' : 'status'}
    >
      <span className="update-hint-mark" aria-hidden>
        {withCat ? (
          <Nyu size={26} mood="sparkle" blink={false} />
        ) : (
          <Icon name={failed ? 'warning' : 'refresh'} size={15} />
        )}
      </span>

      <div className="update-hint-text">
        <p className="update-hint-line">{headline(state)}</p>
        {notes && showNotes ? <p className="update-hint-notes">{notes}</p> : null}
      </div>

      {percent !== null ? (
        <span
          className="update-hint-bar"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span className="update-hint-bar-fill" style={{ width: `${percent}%` }} />
        </span>
      ) : null}

      <div className="update-hint-actions">
        {notes ? (
          <button
            type="button"
            className="update-hint-link"
            aria-expanded={showNotes}
            onClick={() => setShowNotes(!showNotes)}
          >
            {showNotes ? t('Weniger') : t('Was ist neu?')}
          </button>
        ) : null}

        {state.phase === 'available' ? (
          <>
            <button type="button" onClick={dismissUpdate}>
              {t('Später')}
            </button>
            {state.installable ? (
              <button
                type="button"
                className="update-hint-install"
                onClick={() => void installUpdateNow()}
              >
                {t('Installieren und neu starten')}
              </button>
            ) : (
              // macOS and Linux: the setup there is a DMG or an archive the
              // user opens by hand, so the hint takes them to it instead.
              <button
                type="button"
                className="update-hint-install"
                onClick={() => void openExternal(RELEASES_URL).catch(() => undefined)}
              >
                {t('Zur Download-Seite')}
              </button>
            )}
          </>
        ) : null}

        {state.phase === 'ready' || failed ? (
          <button type="button" onClick={dismissUpdate}>
            {t('Schließen')}
          </button>
        ) : null}
      </div>
    </aside>
  );
}

/** One sentence per phase. Never playful: the bar is information, not a joke. */
function headline(state: UpdateState): string {
  switch (state.phase) {
    case 'available':
      return t('UwUNotes {version} ist verfügbar.', { version: state.version });
    case 'downloading':
      return state.progress === null
        ? t('UwUNotes {version} wird geladen …', { version: state.version })
        : t('UwUNotes {version} wird geladen … {percent} %', {
            version: state.version,
            percent: Math.round(state.progress * 100),
          });
    case 'ready':
      // Only reachable where the installer does not replace the running app
      // itself. On Windows this process is already gone by now.
      return t('UwUNotes {version} ist installiert. Starte den Editor neu, um es zu benutzen.', {
        version: state.version,
      });
    case 'failed':
      return state.message;
    default:
      return '';
  }
}
