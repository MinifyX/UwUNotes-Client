/**
 * The panel on the left, and the row of buttons that picks what it shows.
 *
 * The views themselves live in `views.ts`; this component only switches
 * between them. With a single view there is nothing to pick, so the row is not
 * drawn at all rather than holding one lonely button.
 */

import { setSidebarView, useSidebarView } from '../../lib/chrome';
import { t } from '../../lib/i18n';
import { Icon } from '../Icon';
import { SIDEBAR_VIEWS } from './views';

export function Sidebar() {
  const current = useSidebarView();
  const active = SIDEBAR_VIEWS.find((view) => view.id === current) ?? SIDEBAR_VIEWS[0];
  if (!active) return null;
  const { Component } = active;

  return (
    <aside className="sidebar" aria-label={t(active.label)}>
      {SIDEBAR_VIEWS.length > 1 && (
        <nav className="sidebar-switcher" role="tablist" aria-label={t('Seitenleiste')}>
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
              <Icon name={view.icon} size={14} title={t(view.label)} />
            </button>
          ))}
        </nav>
      )}
      <Component />
    </aside>
  );
}
