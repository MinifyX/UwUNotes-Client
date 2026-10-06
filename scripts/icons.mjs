// Regenerates the desktop icons from brand/:
//
//   node scripts/icons.mjs
//
// Everything comes from the SVGs in brand/, so a new logo is a new SVG there
// and one run of this script — nothing else to touch. The work is the suite's
// own tool, `uwu-icons` from @uwusuite/design (docs/app-icons.md there):
//
// - the tiles (Square*/StoreLogo) from brand/uwunotes-app-icon.svg,
// - the Mac's icon.icns from the same tile set into Apple's icon grid (824 of
//   1024 pixels, Apple's rounded square, a soft shadow), with the master kept
//   as icons/macos/icon-1024.png to look at,
// - the taskbar, window and Linux icons from brand/uwunotes-taskbar-icon.svg,
// - the 16 and 24 px ICO frames from brand/uwunotes-taskbar-icon-small.svg.

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

execFileSync('pnpm', ['exec', 'uwu-icons', '--brand', join(root, 'brand'), '--name', 'uwunotes'], {
  cwd: join(root, 'apps/desktop'),
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
