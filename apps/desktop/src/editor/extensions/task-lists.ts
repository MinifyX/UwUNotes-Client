/**
 * Task lists as a plugin: Ctrl+Enter and Ctrl+click on `- [ ]`, plus a faint
 * tint on the box so it reads as something to click.
 *
 * A plugin rather than core because it claims a key and a click that mean
 * something else everywhere else, and a person who never writes task lists
 * may reasonably want both back untouched. The command "Aufgabe abhaken" and
 * the preview's checkboxes keep working with it switched off; they do not
 * depend on anything in the editor's configuration.
 */

import { N_ } from '../../lib/i18n';
import { taskLists } from '../tasks';
import { registerPlugin } from './registry';

export function registerTaskLists(): void {
  registerPlugin({
    id: 'task-lists',
    name: N_('Aufgabenlisten'),
    description: N_('Strg+Enter oder Strg+Klick auf [ ] hakt eine Aufgabe ab.'),
    defaultEnabled: true,
    build: taskLists,
  });
}
