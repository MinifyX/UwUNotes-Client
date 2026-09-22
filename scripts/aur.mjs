// Writes the AUR package uwunotes-bin for a release: PKGBUILD and .SRCINFO.
//
//   node scripts/aur.mjs v0.5.0 --sums SHA256SUMS.txt --out aur/
//
// The package repacks the release's .deb, the usual way for a Tauri `-bin`
// package, and the checksums come from the release's own SHA256SUMS.txt — so
// this is run once the release exists, by the `aur` job in
// .github/workflows/release.yml, which then commits both files to
// ssh://aur@aur.archlinux.org/uwunotes-bin.git.
//
// .SRCINFO is what the AUR reads instead of running the PKGBUILD. `makepkg
// --printsrcinfo` would write it, but there is no makepkg on an Ubuntu runner,
// so it is written here from the same values, in the same order.
//
// Node's own modules only.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { APP, PACKAGE, downloadUrl } from './release-files.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const NAME = `${PACKAGE}-bin`;
const TEMPLATE = join(root, 'packaging', 'aur', NAME, 'PKGBUILD.in');

/**
 * pacman's version for a release: no hyphen allowed, and without one
 * `0.3.0beta.2` sorts before `0.3.0` the way the release does.
 */
export const pkgver = (version) => version.replaceAll('-', '');

/** `sha256sum` output → file name → checksum. */
export function parseSums(text) {
  const sums = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(line.trim());
    if (match) sums[match[2]] = match[1];
  }
  return sums;
}

/** The debs the package is made from, per pacman architecture. */
const DEBS = { x86_64: `${APP}-linux-x64.deb`, aarch64: `${APP}-linux-arm64.deb` };

export function pkgbuild(template, version, sums) {
  const values = {
    VERSION: version,
    PKGVER: pkgver(version),
    SHA256_X86_64: sums[DEBS.x86_64],
    SHA256_AARCH64: sums[DEBS.aarch64],
  };
  return template.replace(/@([A-Z0-9_]+)@/g, (whole, key) => {
    if (!values[key]) throw new Error(`Nothing to fill in for ${whole}.`);
    return values[key];
  });
}

/** Single-quoted and array values of a PKGBUILD, read back for .SRCINFO. */
function field(text, name) {
  const match = new RegExp(`^${name}=(\\(([^)]*)\\)|'([^']*)'|(\\S+))`, 'm').exec(text);
  if (!match) return [];
  if (match[2] !== undefined) {
    return [...match[2].matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]);
  }
  return [match[3] ?? match[4]];
}

export function srcinfo(text) {
  const version = pkgver(field(text, 'pkgver')[0]);
  const expand = (value) => value.replaceAll('${pkgver}', version);
  const lines = [`pkgbase = ${NAME}`];
  const add = (key, name = key) => {
    for (const value of field(text, name)) lines.push(`\t${key} = ${expand(value)}`);
  };
  add('pkgdesc');
  add('pkgver');
  add('pkgrel');
  add('url');
  add('arch');
  add('license');
  add('depends');
  add('optdepends');
  add('provides');
  add('conflicts');
  add('options');
  for (const arch of field(text, 'arch')) {
    add(`source_${arch}`);
    add(`sha256sums_${arch}`);
  }
  lines.push('', `pkgname = ${NAME}`, '');
  return lines.join('\n');
}

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

if (import.meta.main) {
  const usage = 'Usage: node scripts/aur.mjs <tag> --sums <SHA256SUMS.txt> --out <folder>';
  let positionals = [];
  let values = {};
  try {
    ({ positionals, values } = parseArgs({
      allowPositionals: true,
      options: { sums: { type: 'string' }, out: { type: 'string' } },
    }));
  } catch (error) {
    fail(`${error.message}\n  ${usage}`);
  }
  const version = (positionals[0] ?? '').replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version) || !values.sums || !values.out) {
    fail(usage);
  }

  const sums = parseSums(readFileSync(values.sums, 'utf8'));
  for (const deb of Object.values(DEBS)) {
    if (!sums[deb]) fail(`${values.sums} has no checksum for ${deb}.`);
  }
  const text = pkgbuild(readFileSync(TEMPLATE, 'utf8'), version, sums);
  // The URLs the template builds have to be the ones the release serves.
  for (const deb of Object.values(DEBS)) {
    if (!text.includes(downloadUrl(version, deb))) fail(`The PKGBUILD does not point at ${deb}.`);
  }

  const out = resolve(values.out);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'PKGBUILD'), text);
  writeFileSync(join(out, '.SRCINFO'), srcinfo(text));
  console.log(`✧ ${NAME} ${pkgver(version)}-1 in ${out}`);
}
