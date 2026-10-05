// Regenerates the desktop icons from brand/:
//
//   node scripts/icons.mjs
//
// Everything below comes from the SVGs in brand/, so a new logo is a new SVG
// there and one run of this script — nothing else to touch.
//
// Most of the work is the suite's own tool, `uwu-icons` from @uwusuite/design:
// the tiles (Square*/StoreLogo) from brand/uwunotes-app-icon.svg, the taskbar,
// window and Linux icons from brand/uwunotes-taskbar-icon.svg, and the 16 and
// 24 px ICO frames from brand/uwunotes-taskbar-icon-small.svg.
//
// What stays here is the Mac. macOS draws no frame around an app icon: the file
// has to be the frame. Apple's grid puts the tile at 824 of 1024 pixels,
// centred, with a soft shadow in the 100 pixel margin, and every icon in the
// Dock is drawn to it. The full-bleed tile `uwu-icons` 1.1 writes looks a size
// too big next to everyone else's. So the app icon is scaled into that grid,
// clipped to Apple's rounded square, given the shadow, rendered at every size
// from 16 to 1024 and written into icon.icns by hand (see `writeIcns`),
// replacing the one `uwu-icons` wrote. The master is also kept as
// icons/macos/icon-1024.png, to look at.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const brand = join(root, 'brand');
const desktop = join(root, 'apps/desktop');
const icons = join(desktop, 'src-tauri/icons');
/** Apple's macOS icon grid, in pixels of the 1024 canvas. */
const MAC = {
  canvas: 1024,
  tile: 824,
  /** The drop shadow of Apple's icon templates: straight down, soft, black. */
  shadow: { dy: 10, blur: 6, opacity: 0.3 },
};

/**
 * Every ICNS entry: its type, the pixel size it holds, and how. `ic04` and
 * `ic05` are the 16 and 32 point sizes and carry raw ARGB, as `iconutil` writes
 * them; everything from 32 pixels up is a PNG. Together that is every size from
 * 16 to 512 points, at 1x and at 2x.
 */
const ICNS_ENTRIES = [
  { type: 'ic04', size: 16, argb: true }, // 16
  { type: 'ic05', size: 32, argb: true }, // 16@2x (32 at 1x on older systems)
  { type: 'ic11', size: 32 }, // 16@2x
  { type: 'ic12', size: 64 }, // 32@2x
  { type: 'ic07', size: 128 }, // 128
  { type: 'ic13', size: 256 }, // 128@2x
  { type: 'ic08', size: 256 }, // 256
  { type: 'ic14', size: 512 }, // 256@2x
  { type: 'ic09', size: 512 }, // 512
  { type: 'ic10', size: 1024 }, // 512@2x
];

function tauriIcon(svgPath, out, sizes) {
  execFileSync(
    'pnpm',
    ['tauri', 'icon', svgPath, '-o', out, ...(sizes ? ['-p', sizes.join(',')] : [])],
    { cwd: desktop, stdio: 'ignore', shell: process.platform === 'win32' },
  );
}

/**
 * Apple's rounded square: a superellipse, |x|^5 + |y|^5 = 1, rather than a
 * rectangle with circular corners. The curvature runs out smoothly into the
 * sides instead of starting at a point, which is what makes a macOS icon look
 * like one. At the tile size of the grid its corner matches Apple's radius of
 * about 185 pixels.
 */
function squirclePath(x, y, size, exponent = 5, steps = 720) {
  const half = size / 2;
  const points = [];
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const px = Math.sign(cos) * Math.abs(cos) ** (2 / exponent);
    const py = Math.sign(sin) * Math.abs(sin) ** (2 / exponent);
    points.push(`${(x + half + px * half).toFixed(2)} ${(y + half + py * half).toFixed(2)}`);
  }
  return `M${points.join('L')}Z`;
}

/**
 * The macOS master as an SVG: the app icon, whatever it draws, scaled into the
 * tile of Apple's grid and clipped to its rounded square, over the shadow.
 * Clipping is what makes this work for any artwork — a tile with corners of
 * its own keeps them where they are rounder than Apple's, a square one gets
 * Apple's.
 */
function macMasterSvg(appIconSvg) {
  const open = appIconSvg.match(/<svg\b[^>]*>/);
  if (!open) throw new Error('The app icon is not an SVG.');
  const viewBox = open[0].match(/viewBox="([^"]+)"/)?.[1];
  if (!viewBox) throw new Error('The app icon has no viewBox, so it cannot be scaled.');
  const inner = appIconSvg.slice(open.index + open[0].length, appIconSvg.lastIndexOf('</svg>'));

  const { canvas, tile, shadow } = MAC;
  const margin = (canvas - tile) / 2;
  const shape = squirclePath(margin, margin, tile);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas} ${canvas}" width="${canvas}" height="${canvas}">
  <defs>
    <clipPath id="mac-tile"><path d="${shape}"/></clipPath>
    <filter id="mac-shadow" x="-10%" y="-10%" width="120%" height="125%">
      <feGaussianBlur stdDeviation="${shadow.blur}"/>
    </filter>
  </defs>
  <path d="${shape}" transform="translate(0 ${shadow.dy})" fill="#000" fill-opacity="${shadow.opacity}" filter="url(#mac-shadow)"/>
  <g clip-path="url(#mac-tile)">
    <svg x="${margin}" y="${margin}" width="${tile}" height="${tile}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">${inner}</svg>
  </g>
</svg>
`;
}

/** Width, height and RGBA bytes of an 8-bit RGBA PNG, the only kind Tauri writes. */
function decodePng(png) {
  let at = 8;
  let width = 0;
  let height = 0;
  const data = [];
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) {
        throw new Error('Expected a non-interlaced 8-bit RGBA PNG.');
      }
    } else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const corner = x >= 4 && y > 0 ? pixels[(y - 1) * stride + x - 4] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner;
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)];
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      }
      pixels[y * stride + x] = value & 0xff;
    }
  }
  return { width, height, pixels };
}

/**
 * One channel in Apple's PackBits: a byte below 128 is "the next n + 1 bytes
 * as they are", 128 and up is "the next byte, n - 125 times" for runs of 3 to
 * 130.
 */
function packBits(channel) {
  const out = [];
  let i = 0;
  while (i < channel.length) {
    let run = 1;
    while (i + run < channel.length && run < 130 && channel[i + run] === channel[i]) run++;
    if (run >= 3) {
      out.push(run + 125, channel[i]);
      i += run;
      continue;
    }
    const start = i;
    while (i < channel.length && i - start < 128) {
      if (
        i + 2 < channel.length &&
        channel[i] === channel[i + 1] &&
        channel[i] === channel[i + 2]
      ) {
        break;
      }
      i++;
    }
    out.push(i - start - 1, ...channel.subarray(start, i));
  }
  return Buffer.from(out);
}

/** An `ic04`/`ic05` payload: 'ARGB', then A, R, G and B, each packed on its own. */
function argbPayload(png) {
  const { width, height, pixels } = decodePng(png);
  const count = width * height;
  const channels = [3, 0, 1, 2].map((offset) => {
    const channel = Buffer.alloc(count);
    for (let i = 0; i < count; i++) channel[i] = pixels[i * 4 + offset];
    return packBits(channel);
  });
  return Buffer.concat([Buffer.from('ARGB', 'latin1'), ...channels]);
}

/**
 * An ICNS file: 'icns', the total length, then one entry per image — four
 * bytes of type, four of length (header included), the payload. Big-endian
 * throughout. `pngs` maps a pixel size to that size's PNG.
 */
function writeIcns(path, pngs) {
  const entries = ICNS_ENTRIES.map(({ type, size, argb }) => {
    const png = pngs.get(size);
    if (!png) throw new Error(`No ${size}px image for ${type}.`);
    const payload = argb ? argbPayload(png) : png;
    const header = Buffer.alloc(8);
    header.write(type, 0, 'latin1');
    header.writeUInt32BE(payload.length + 8, 4);
    return Buffer.concat([header, payload]);
  });
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'latin1');
  header.writeUInt32BE(8 + entries.reduce((sum, entry) => sum + entry.length, 0), 4);
  writeFileSync(path, Buffer.concat([header, ...entries]));
}

/**
 * Reads an ICNS back and checks every entry: the lengths add up, each PNG has
 * the size its type promises, each ARGB entry unpacks to exactly four full
 * channels. A broken icon file is otherwise only noticed on a Mac, as a blank
 * square in the Dock.
 */
function checkIcns(path) {
  const buf = readFileSync(path);
  if (buf.toString('latin1', 0, 4) !== 'icns' || buf.readUInt32BE(4) !== buf.length) {
    throw new Error(`${path}: not an ICNS file, or its length is wrong.`);
  }
  const found = new Map();
  for (let at = 8; at < buf.length;) {
    const type = buf.toString('latin1', at, at + 4);
    const length = buf.readUInt32BE(at + 4);
    if (length < 8 || at + length > buf.length) throw new Error(`${path}: ${type} runs over.`);
    found.set(type, buf.subarray(at + 8, at + length));
    at += length;
  }
  for (const { type, size, argb } of ICNS_ENTRIES) {
    const payload = found.get(type);
    if (!payload) throw new Error(`${path}: ${type} is missing.`);
    if (argb) {
      if (payload.toString('latin1', 0, 4) !== 'ARGB') throw new Error(`${type}: no ARGB tag.`);
      let produced = 0;
      for (let i = 4; i < payload.length;) {
        const control = payload[i];
        if (control < 128) {
          produced += control + 1;
          i += control + 2;
        } else {
          produced += control - 125;
          i += 2;
        }
      }
      if (produced !== size * size * 4) throw new Error(`${type}: unpacks to ${produced} bytes.`);
    } else {
      const isPng = payload.subarray(1, 4).toString('latin1') === 'PNG';
      if (!isPng || payload.readUInt32BE(16) !== size || payload.readUInt32BE(20) !== size) {
        throw new Error(`${type}: expected a ${size}×${size} PNG.`);
      }
    }
  }
  return found.size;
}

execFileSync('pnpm', ['exec', 'uwu-icons', '--brand', brand, '--name', 'uwunotes'], {
  cwd: desktop,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

const mac = mkdtempSync(join(tmpdir(), 'uwunotes-icons-mac-'));
try {
  const master = join(mac, 'macos-master.svg');
  writeFileSync(master, macMasterSvg(readFileSync(join(brand, 'uwunotes-app-icon.svg'), 'utf8')));
  const sizes = [...new Set(ICNS_ENTRIES.map((entry) => entry.size))];
  tauriIcon(master, mac, sizes);
  const pngs = new Map(sizes.map((size) => [size, readFileSync(join(mac, `${size}x${size}.png`))]));
  writeIcns(join(icons, 'icon.icns'), pngs);
  mkdirSync(join(icons, 'macos'), { recursive: true });
  writeFileSync(join(icons, 'macos', 'icon-1024.png'), pngs.get(1024));
  console.log(`icon.icns: ${checkIcns(join(icons, 'icon.icns'))} images, 16 to 1024 px`);
} finally {
  rmSync(mac, { recursive: true, force: true });
}
