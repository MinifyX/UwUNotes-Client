/**
 * The panel on the left, and the row of buttons that picks what it shows.
 *
 * The views themselves live in `views.ts`; this component only switches
 * between them. The row also holds the button that folds the panel away, and
 * {@link SidebarRail} is what stays of it then: a slim strip with the way back
 * and the same view buttons, so a folded sidebar is one click from any view.
 */

import { setSidebarOpen, setSidebarView, useSidebarView } from '../../lib/chrome';
import { t } from '../../lib/i18n';
import { shortcutLabel } from '../../lib/shortcuts';
import { Icon, ICONS } from '@uwusuite/design';
import { SIDEBAR_VIEWS } from './views';

/** "Seitenleiste ausblenden (Strg+B)": the label, and the key that does the same. */
function withShortcut(label: string): string {
  const keys = shortcutLabel('view.toggleSidebar');
  return keys ? `${label} (${keys})` : label;
}

export function Sidebar() {
  const current = useSidebarView();
  const active = SIDEBAR_VIEWS.find((view) => view.id === current) ?? SIDEBAR_VIEWS[0];
  if (!active) return null;
  const { Component } = active;

  return (
    <aside className="sidebar" aria-label={t(active.label)}>
      <div className="sidebar-switcher">
        <nav className="sidebar-switches" role="tablist" aria-label={t('Seitenleiste')}>
          {SIDEBAR_VIEWS.map((view) => (
            <button
              key={view.id}
              type="button"
              role="tab"
              aria-selected={view.id === active.id}
              className="sidebar-switch"
              title={t(view.label)}
              onClick={() => setSidebarView(view.id)}
            >
              <Icon icon={ICONS[view.icon]} size="xs" label={t(view.label)} />
            </button>
          ))}
        </nav>
        <button
          type="button"
          className="sidebar-switch sidebar-collapse"
          title={withShortcut(t('Seitenleiste ausblenden'))}
          onClick={() => setSidebarOpen(false)}
        >
          <Icon icon={ICONS.sidebarHide} label={t('Seitenleiste ausblenden')} />
        </button>
      </div>
      <Component />
    </aside>
  );
}

/**
 * The folded sidebar: a strip down the left edge with the button that brings
 * the panel back and one button per view, which opens the panel on that view.
 */
export function SidebarRail() {
  const current = useSidebarView();
  return (
    <nav className="sidebar-rail" aria-label={t('Seitenleiste')}>
      <button
        type="button"
        className="sidebar-switch sidebar-expand"
        title={withShortcut(t('Seitenleiste einblenden'))}
        onClick={() => setSidebarOpen(true)}
      >
        <Icon icon={ICONS.sidebarShow} label={t('Seitenleiste einblenden')} />
      </button>
      <span className="sidebar-rail-rule" aria-hidden />
      {SIDEBAR_VIEWS.map((view) => (
        <button
          key={view.id}
          type="button"
          className="sidebar-switch"
          data-current={view.id === current ? true : undefined}
          title={t(view.label)}
          onClick={() => setSidebarView(view.id)}
        >
          <Icon icon={ICONS[view.icon]} size="xs" label={t(view.label)} />
        </button>
      ))}
    </nav>
  );
}
