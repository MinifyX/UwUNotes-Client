import { describe, expect, it } from 'vitest';
import { MENU_MARGIN, placeMenu, scrollToShow } from './menu-placement';

const viewport = { width: 800, height: 420 };
const button = { left: 10, right: 60, top: 30, bottom: 54 };

describe('a list under the menu row', () => {
  it('starts under its button and gets the height left below it', () => {
    const at = placeMenu(button, { width: 260, height: 900 }, viewport, 'below');
    expect(at).toEqual({ left: 10, top: 54, maxHeight: 420 - MENU_MARGIN - 54 });
  });

  it('moves left rather than leave the window on the right', () => {
    const at = placeMenu(
      { ...button, left: 700, right: 750 },
      { width: 260, height: 100 },
      viewport,
      'below',
    );
    expect(at.left).toBe(800 - MENU_MARGIN - 260);
  });

  it('is never wider than the window', () => {
    const at = placeMenu(button, { width: 380, height: 100 }, { width: 300, height: 420 }, 'below');
    expect(at.left).toBe(MENU_MARGIN);
  });
});

describe('a submenu', () => {
  const item = { left: 20, right: 280, top: 300, bottom: 326 };

  it('opens beside its item when there is room', () => {
    const at = placeMenu(item, { width: 200, height: 60 }, viewport, 'side');
    expect(at.left).toBe(278);
    expect(at.top).toBe(295);
  });

  it('moves up just enough to end inside the window', () => {
    const at = placeMenu(item, { width: 200, height: 200 }, viewport, 'side');
    expect(at.top).toBe(420 - MENU_MARGIN - 200);
    expect(at.top + at.maxHeight).toBe(420 - MENU_MARGIN);
  });

  it('fills the window and scrolls when it is taller than the window', () => {
    const at = placeMenu(item, { width: 200, height: 2000 }, viewport, 'side');
    expect(at.top).toBe(MENU_MARGIN);
    expect(at.maxHeight).toBe(420 - 2 * MENU_MARGIN);
  });

  it('flips to the left of its parent when the right has no room', () => {
    const parent = { left: 500, right: 760, top: 100, bottom: 126 };
    const at = placeMenu(parent, { width: 200, height: 60 }, viewport, 'side');
    expect(at.left).toBe(500 - 200 + 2);
  });
});

describe('keeping the highlight in view', () => {
  const list = { scrollTop: 100, clientHeight: 200 };

  it('leaves a visible item alone', () => {
    expect(scrollToShow({ top: 150, height: 26 }, list)).toBe(100);
  });

  it('scrolls up to an item above', () => {
    expect(scrollToShow({ top: 40, height: 26 }, list)).toBe(40);
  });

  it('scrolls down just far enough for an item below', () => {
    expect(scrollToShow({ top: 320, height: 26 }, list)).toBe(146);
  });
});
