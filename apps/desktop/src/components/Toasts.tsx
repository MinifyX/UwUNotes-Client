/**
 * The corner where `lib/toast.ts` shows up.
 *
 * Nothing here decides when a message appears or how long it stays — the store
 * owns both, including the longer life an error gets and the longer one still
 * for a toast with a button. This is the rendering, and it is deliberately the
 * only part of the toast system that knows what a button looks like.
 *
 * The region is polite rather than assertive: a toast never carries a question,
 * so interrupting whatever a screen reader is in the middle of would be rude
 * for no gain. The exception is an error, which is announced as an alert,
 * because a file that would not open is worth cutting in for.
 */

import { dismissToast, useToasts, type Toast } from '../lib/toast';
import { t, useLanguage } from '../lib/i18n';
import { Icon, type IconName } from './Icon';

const TONE_ICONS: Record<Toast['tone'], IconName> = {
  info: 'file',
  success: 'check',
  error: 'warning',
};

export function Toasts() {
  useLanguage();
  const toasts = useToasts();
  if (toasts.length === 0) return null;

  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {toasts.map((entry) => (
        <div
          key={entry.id}
          className="toast"
          data-tone={entry.tone}
          role={entry.tone === 'error' ? 'alert' : 'status'}
        >
          <span className="toast-icon" aria-hidden>
            <Icon name={TONE_ICONS[entry.tone]} size={15} />
          </span>
          <span className="toast-text">{entry.text}</span>
          {entry.action ? (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                // Dismissed first: every action so far either opens something
                // or reloads the file the toast is about, and both make the
                // sentence on screen stale the moment they run.
                dismissToast(entry.id);
                entry.action?.run();
              }}
            >
              {entry.action.label}
            </button>
          ) : null}
          <button
            type="button"
            className="toast-dismiss"
            onClick={() => dismissToast(entry.id)}
            aria-label={t('Meldung schließen')}
          >
            <Icon name="close" size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
