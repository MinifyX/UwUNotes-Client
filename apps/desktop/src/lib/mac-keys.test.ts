/**
 * Shortcuts written the Mac way: symbols in Apple's order, the keys the native
 * menu actually registers, and nothing changed anywhere else.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { setMacForTests } from './platform';
import { updateSettings } from './settings';
import {
  CONTROL_ON_MAC,
  keysText,
  macAccelerator,
  macKeysText,
  macroShortcutText,
  shortcutLabel,
} from './shortcuts';

afterEach(() => setMacForTests(null));

describe('macKeysText', () => {
  it('writes modifiers as symbols in Apple’s order, without plus signs', () => {
    expect(macKeysText('CmdOrCtrl+S')).toBe('⌘S');
    expect(macKeysText('CmdOrCtrl+Shift+S')).toBe('⇧⌘S');
    expect(macKeysText('Shift+CmdOrCtrl+S')).toBe('⇧⌘S');
    expect(macKeysText('CmdOrCtrl+Alt+F')).toBe('⌥⌘F');
    expect(macKeysText('Ctrl+Alt+Shift+Cmd+K')).toBe('⌃⌥⇧⌘K');
  });

  it('knows the keys that have a glyph, and the plus key', () => {
    expect(macKeysText('CmdOrCtrl++')).toBe('⌘+');
    expect(macKeysText('CmdOrCtrl+-')).toBe('⌘-');
    expect(macKeysText('Ctrl+Tab')).toBe('⌃⇥');
    expect(macKeysText('Ctrl+Shift+Tab')).toBe('⌃⇧⇥');
    expect(macKeysText('CmdOrCtrl+Enter')).toBe('⌘↩');
    expect(macKeysText('Shift+F2')).toBe('⇧F2');
    expect(macKeysText('F11')).toBe('F11');
    expect(macKeysText('CmdOrCtrl+,')).toBe('⌘,');
    expect(macKeysText('Ctrl')).toBe('⌃');
  });
});

describe('labels on a Mac', () => {
  it('show what the menu bar registers, remapped chords included', () => {
    setMacForTests(true);
    expect(shortcutLabel('file.save')).toBe('⌘S');
    expect(shortcutLabel('file.saveAs')).toBe('⇧⌘S');
    expect(shortcutLabel('find.replace')).toBe('⌥⌘F');
    expect(shortcutLabel('view.columns3')).toBe('⌥⌘3');
    expect(shortcutLabel('view.zoomIn')).toBe('⌘+');
    expect(shortcutLabel('bookmark.toggle')).toBe('⌘F2');
    expect(shortcutLabel('view.nextDifference')).toBe('F8');
    expect(shortcutLabel('markdown.toggleTask')).toBe('⌘↩');
    // Logging out is ⌘⇧Q; the pane keeps no key on a Mac.
    expect(shortcutLabel('view.closePane')).toBeUndefined();
    expect(shortcutLabel('file.saveCopyAs')).toBeUndefined();
  });

  it('say ⌃ for what only the page’s own listener answers', () => {
    setMacForTests(true);
    expect(shortcutLabel('tab.next')).toBe('⌃⇥');
    expect(shortcutLabel('view.moveTabToOtherPane')).toBe('⌃⇧M');
    expect(shortcutLabel('view.nextPane')).toBe('F6');
    expect(macroShortcutText('Ctrl+Shift+KeyM')).toBe('⌃⇧M');
    expect(keysText(['Strg'], { control: true })).toBe('⌃');
    expect(keysText(['Strg', 'Z'])).toBe('⌘Z');
    expect(keysText(['Umschalt', 'Enter'])).toBe('⇧↩');
  });

  it('agree with the accelerator for every command the menu answers', () => {
    setMacForTests(true);
    for (const id of ['file.new', 'find.inFiles', 'app.palette', 'macro.playLast']) {
      expect(CONTROL_ON_MAC.has(id)).toBe(false);
      expect(shortcutLabel(id)).toBe(macKeysText(macAccelerator(id)!));
    }
  });
});

describe('labels elsewhere', () => {
  it('stay as they were', () => {
    setMacForTests(false);
    updateSettings({ language: 'de' });
    expect(shortcutLabel('file.saveAs')).toBe('Strg+Umschalt+S');
    expect(shortcutLabel('find.replace')).toBe('Strg+H');
    expect(shortcutLabel('view.closePane')).toBe('Strg+Umschalt+Q');
    expect(macroShortcutText('Ctrl+Shift+KeyM')).toBe('Strg+Umschalt+M');
    expect(keysText(['Strg', 'Z'])).toBe('Strg+Z');
  });
});
