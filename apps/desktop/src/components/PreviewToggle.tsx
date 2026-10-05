/**
 * The preview switch at the end of a pane's tab bar.
 *
 * Only there while the pane shows a Markdown document — a button that is
 * greyed out on every other file is a button people learn to stop seeing.
 * Pressed while the preview is open, so the same button closes it.
 */

import { useSyncExternalStore } from 'react';
import { documentsVersion, subscribeDocuments } from '../lib/documents';
import { t, useLanguage } from '../lib/i18n';
import type { PaneId } from '../lib/layout';
import { isMarkdownDoc, togglePreview, usePreviewOpen } from '../lib/preview';
import { shortcutLabel } from '../lib/shortcuts';
import { useWorkspace } from '../lib/workspace';
import { Icon } from '@uwusuite/design';
import { APP_ICONS } from '../lib/icons';

export function PreviewToggle({ pane }: { pane: PaneId }) {
  useLanguage();
  // A rename to `.md` or a hand-picked language is a metadata change.
  useSyncExternalStore(subscribeDocuments, documentsVersion);
  const workspace = useWorkspace();
  const docId = workspace.panes[pane]?.active ?? null;
  const open = usePreviewOpen(docId);
  if (!docId || !isMarkdownDoc(docId)) return null;

  const label = t('Markdown-Vorschau');
  const shortcut = shortcutLabel('markdown.togglePreview');
  return (
    <button
      type="button"
      className="tabbar-preview"
      aria-pressed={open}
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      onClick={() => togglePreview(docId)}
    >
      <Icon icon={APP_ICONS.preview} />
    </button>
  );
}
