/**
 * Settings → Updates: which version this is, a button that looks for a newer
 * one, and the switch for the look shortly after start.
 *
 * Everything it says comes from `lib/updates.ts` — the phase, the sentence for
 * it, the install. This file is the drawing. A build that is not updated from
 * inside the app (the Mac App Store one, or a package somebody built
 * themselves) gets one line saying where updates come from instead of a button
 * that could never do anything.
 */

import type { ReactNode } from 'react';
import { openExternal } from '../../lib/api';
import { t } from '../../lib/i18n';
import { APP_VERSION } from '../../lib/settings';
import {
  checkForUpdateNow,
  dismissUpdate,
  installUpdateNow,
  RELEASES_URL,
  updateHeadline,
  useUpdateChannel,
  useUpdatesAvailableInApp,
  useUpdateState,
} from '../../lib/updates';
import { Button, Icon, ICONS, ProgressBar } from '@uwusuite/design';

/** `children` is the auto-check switch, drawn by the settings page like its neighbours. */
export function UpdatesSection({ children }: { children: ReactNode }) {
  const available = useUpdatesAvailableInApp();
  const channel = useUpdateChannel();
  const state = useUpdateState();

  if (!available) {
    return (
      <div className="settings-update">
        <p className="settings-update-version">
          {t('Installiert: UwUNotes {version}', { version: APP_VERSION })}
        </p>
        <p className="settings-hint">
          {channel === 'app-store'
            ? t('Updates kommen über den App Store.')
            : channel === 'none'
              ? t('Diese Version wird über die Paketverwaltung aktualisiert.')
              : null}
        </p>
      </div>
    );
  }

  const busy = state.phase === 'checking' || state.phase === 'downloading';
  const percent =
    state.phase === 'downloading' && state.progress !== null
      ? Math.round(state.progress * 100)
      : null;
  const line = updateHeadline(state);

  return (
    <>
      <div className="settings-update">
        <p className="settings-update-version">
          {t('Installiert: UwUNotes {version}', { version: APP_VERSION })}
        </p>
        <div className="settings-update-row">
          <Button
            variant="secondary"
            size="sm"
            type="button"
            className="settings-update-check"
            disabled={busy}
            onClick={() => checkForUpdateNow({ quiet: true })}
          >
            <Icon
              icon={ICONS.refresh}
              size="xs"
              className={state.phase === 'checking' ? 'settings-update-spin' : undefined}
            />
            {t('Jetzt nach Updates suchen')}
          </Button>
          {state.phase === 'available' ? (
            state.installable ? (
              <Button
                variant="primary"
                size="sm"
                type="button"
                className="settings-update-install"
                onClick={() => void installUpdateNow()}
              >
                {t('Installieren und neu starten')}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                type="button"
                className="settings-update-install"
                onClick={() => void openExternal(RELEASES_URL).catch(() => undefined)}
              >
                {t('Zur Download-Seite')}
              </Button>
            )
          ) : null}
          {state.phase === 'failed' ? (
            <button type="button" onClick={dismissUpdate}>
              {t('Schließen')}
            </button>
          ) : null}
        </div>
        {line ? (
          <p
            className="settings-update-status"
            data-tone={state.phase === 'failed' ? 'error' : state.phase}
            role={state.phase === 'failed' ? 'alert' : 'status'}
          >
            {state.phase === 'current' ? <Icon icon={ICONS.done} size="xs" /> : null}
            {state.phase === 'failed' ? <Icon icon={ICONS.warning} size="xs" /> : null}
            {line}
          </p>
        ) : null}
        {state.phase === 'downloading' && percent !== null ? (
          // The suite's bar once the size is known; it fills from where it was.
          <ProgressBar share={percent / 100} label={line} className="settings-update-progress" />
        ) : state.phase === 'downloading' ? (
          // No size yet: the package's bar has no "busy" mode, so this one
          // slides until the first byte count arrives.
          <span className="settings-update-bar" role="progressbar" aria-label={line}>
            <span className="settings-update-bar-fill" data-indeterminate />
          </span>
        ) : null}
      </div>
      {children}
    </>
  );
}
