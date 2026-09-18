/**
 * What a pane shows when there is no document in it.
 *
 * An empty editor is a blank rectangle with a caret in it, which tells a person
 * nothing about what the window can do. This puts the three things that are
 * actually useful in that space: how to get a file in, what the keys are, and
 * what was open recently.
 *
 * It opens nothing itself apart from a recent file. The buttons run the same
 * commands the palette and the keyboard run, and take their labels and key
 * hints from the same table, so nothing here can drift out of step with what
 * Ctrl+O actually does.
 */

import { useMemo } from 'react';
import { allCommands, runCommand } from '../lib/commands';
import { openPaths } from '../lib/files';
import { t, useLanguage } from '../lib/i18n';
import type { PaneId } from '../lib/layout';
import { useWorkspace } from '../lib/workspace';
import { pickGreeting } from './nyu/greetings';
import { NyuScene } from './nyu/scenes';
import { Icon } from './Icon';

/** The handful worth listing here, in the order a first-time window needs them. */
const SUGGESTED = ['file.new', 'file.open', 'file.openFolder', 'find.inFiles', 'app.palette'];

function fileNameOf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function EmptyPane({ pane }: { pane: PaneId }) {
  const language = useLanguage();
  const { recentFiles } = useWorkspace();
  // Nyu keeps the same line for the whole run, so a pane that redraws while a
  // neighbour is being typed in does not change the joke mid-sentence.
  const greeting = pickGreeting('empty');

  // `allCommands()` rebuilds a list of a few hundred entries, most of them one
  // per encoding and one per language. Worth memoising even here, where the
  // pane redraws on every tab change in the window.
  const suggestions = useMemo(() => {
    const byId = new Map(allCommands().map((command) => [command.id, command]));
    return SUGGESTED.flatMap((id) => {
      const command = byId.get(id);
      return command ? [{ id, title: command.title(), shortcut: command.shortcut }] : [];
    });
  }, [language]);

  return (
    <div className="emptypane">
      <NyuScene name="empty" className="emptypane-scene" />
      {greeting ? <p className="emptypane-greeting">{greeting}</p> : null}

      <ul className="emptypane-actions">
        {suggestions.map((suggestion) => (
          <li key={suggestion.id}>
            <button
              type="button"
              className="emptypane-action"
              onClick={() => runCommand(suggestion.id)}
            >
              <span className="emptypane-action-label">{suggestion.title}</span>
              {suggestion.shortcut ? (
                <kbd className="emptypane-keys">{suggestion.shortcut}</kbd>
              ) : null}
            </button>
          </li>
        ))}
      </ul>

      {recentFiles.length > 0 ? (
        <section className="emptypane-recent" aria-labelledby={`recent-${pane}`}>
          <h2 id={`recent-${pane}`} className="emptypane-recent-title">
            {t('Zuletzt geöffnet')}
          </h2>
          <ul className="emptypane-recent-list">
            {recentFiles.slice(0, 6).map((path) => (
              <li key={path}>
                <button
                  type="button"
                  className="emptypane-recent-item"
                  // Into *this* pane rather than the active one: the user is
                  // looking at this empty half and clicked inside it.
                  onClick={() => void openPaths([path], pane)}
                  title={path}
                >
                  <Icon name="file" size={14} />
                  <span className="emptypane-recent-name">{fileNameOf(path)}</span>
                  <span className="emptypane-recent-path">{path}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
