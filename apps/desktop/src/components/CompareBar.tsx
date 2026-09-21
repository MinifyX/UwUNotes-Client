/**
 * The strip above the two panes while they are being compared.
 *
 * It says which two files are compared and how many places differ, walks the
 * differences, switches the scroll sync, and ends the comparison. A bar and not
 * a dialog, for the same reason as the find bar: the answer is in the text
 * behind it, and nothing may cover that text.
 */

import { useSyncExternalStore } from 'react';
import {
  compareNames,
  gotoDifference,
  setSyncScroll,
  stopCompare,
  useCompare,
} from '../lib/compare';
import { documentsVersion, subscribeDocuments } from '../lib/documents';
import { t, useLanguage } from '../lib/i18n';
import { shortcutLabel } from '../lib/shortcuts';
import { useWorkspace } from '../lib/workspace';
import { Icon } from './Icon';

export function CompareBar() {
  useLanguage();
  useWorkspace();
  useSyncExternalStore(subscribeDocuments, documentsVersion);
  const compare = useCompare();
  if (!compare.active) return null;

  const names = compareNames();
  const differences = compare.differences;
  const status =
    differences === null
      ? t('Wähle in beiden Bereichen eine Datei.')
      : differences === 0
        ? t('Keine Unterschiede')
        : differences === 1
          ? t('1 Unterschied')
          : t('{count} Unterschiede', { count: differences });
  const none = !differences;

  return (
    <div className="comparebar" role="region" aria-label={t('Dateivergleich')}>
      <Icon name="diff" size={15} className="comparebar-icon" />
      <span className="comparebar-files">
        <span className="comparebar-name comparebar-name-a">{names.left ?? '—'}</span>
        <span aria-hidden>↔</span>
        <span className="comparebar-name comparebar-name-b">{names.right ?? '—'}</span>
      </span>
      <span className="comparebar-status" role="status">
        {status}
        {compare.coarse ? ` · ${t('grob, die Dateien sind sehr verschieden')}` : ''}
      </span>
      <span className="comparebar-spacer" />
      <button
        type="button"
        className="comparebar-button"
        disabled={none}
        onClick={() => gotoDifference(true)}
        aria-label={t('Vorheriger Unterschied')}
        title={`${t('Vorheriger Unterschied')} (${shortcutLabel('view.previousDifference') ?? ''})`}
      >
        <span aria-hidden>↑</span>
      </button>
      <button
        type="button"
        className="comparebar-button"
        disabled={none}
        onClick={() => gotoDifference()}
        aria-label={t('Nächster Unterschied')}
        title={`${t('Nächster Unterschied')} (${shortcutLabel('view.nextDifference') ?? ''})`}
      >
        <span aria-hidden>↓</span>
      </button>
      <label className="comparebar-sync">
        <input
          type="checkbox"
          checked={compare.syncScroll}
          onChange={(event) => setSyncScroll(event.target.checked)}
        />
        {t('Synchron scrollen')}
      </label>
      <button type="button" className="comparebar-close" onClick={stopCompare}>
        {t('Vergleich beenden')}
      </button>
    </div>
  );
}
