/**
 * Which desktop the window is on — for the one place that differs: macOS.
 *
 * On Windows and Linux the window draws its own frame (`decorations: false`)
 * and its own menu row. On macOS it has the system's title bar with the
 * traffic lights (`src-tauri/tauri.macos.conf.json`) and the menus live in the
 * menu bar at the top of the screen (`lib/native-menu.ts`), so the page leaves
 * both out.
 *
 * Read from the user agent rather than asked of Rust: it is synchronous, so
 * the first paint already has the right chrome instead of flashing the custom
 * title bar for a frame. WebKit on macOS always says "Macintosh"; iPads say it
 * too, but this app has no iPad build.
 */

let mac: boolean | null = null;

export function isMac(): boolean {
  if (mac === null) {
    mac = typeof navigator !== 'undefined' && /Macintosh|Mac OS X/.test(navigator.userAgent);
  }
  return mac;
}

/** For tests: pretend to be on a Mac, or not; `null` goes back to asking the browser. */
export function setMacForTests(value: boolean | null): void {
  mac = value;
}
