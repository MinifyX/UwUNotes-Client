// Every file a release publishes, what the builds call it, and what the
// updater of an installed copy expects it to be called. One table, read by the
// release workflow, by scripts/update-feed.mjs and by scripts/aur.mjs.
//
//   node scripts/release-files.mjs stage   <version> --dir dist             (sign job, publish job)
//   node scripts/release-files.mjs publish <version> --dir dist --out out   (publish job)
//   node scripts/release-files.mjs notes   <version> --out body.md          (publish job)
//
// Three names per file, because three different readers need three different
// things from it:
//
// - **built**: what the build job leaves behind. Versioned where the file is
//   also something an installed copy downloads, so a stray file from another
//   version can never be mistaken for this one's.
// - **signed**: the name the update signature is made under, per feed entry.
//   `tauri signer sign` writes `file:<name>` into the signature's trusted
//   comment, and an installed copy refuses a download whose signature names
//   another file than the one it expects for that version — that is its
//   protection against being offered an old, properly signed setup under a new
//   version number. Those expected names are compiled into every copy out
//   there (`release_file_name` in apps/desktop/src-tauri/src/updates.rs), so
//   for every platform that existed before they stay exactly what they were.
// - **asset**: what the release page shows, without a version in it, so
//   `…/releases/latest/download/<asset>` is a link that never goes stale.
//
// A signature covers bytes and a comment, not a URL. So the file is signed
// under its versioned name and uploaded under its stable one, and the feed
// points at the stable one: an installed copy downloads `UwUNotes-windows-x64-
// setup.exe` and finds a signature that says `file:UwUNotes-Setup-0.5.0.exe`,
// which is what it asked for. The Mac image is signed twice, once per name the
// two kinds of Mac expect, and both feed entries point at the one universal
// image.
//
// It uses Node's own modules only, so the sign job can run it without
// installing anything.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const APP = 'UwUNotes';
export const PACKAGE = 'uwunotes';
export const REPOSITORY = 'MinifyX/UwUNotes-Client';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Where an asset of release v<version> ends up on github.com. */
export const downloadUrl = (version, asset) =>
  `https://github.com/${REPOSITORY}/releases/download/v${version}/${asset}`;

/**
 * Everything a release of `version` attaches, besides SHA256SUMS.txt.
 *
 * `feed` maps a Tauri updater platform key to the name that entry is signed
 * under; a file without one is a download only.
 */
export function releaseFiles(version) {
  const v = version;
  return [
    {
      asset: `${APP}-windows-x64-setup.exe`,
      built: `${APP}-Setup-${v}.exe`,
      // What every Windows copy since 0.2.0 downloads and runs with --update.
      feed: { 'windows-x86_64': `${APP}-Setup-${v}.exe` },
    },
    {
      asset: `${APP}-windows-arm64-setup.exe`,
      built: `${APP}-Setup-${v}-windows-arm64.exe`,
      feed: { 'windows-aarch64': `${APP}-Setup-${v}-windows-arm64.exe` },
    },
    {
      asset: `${APP}-macos-universal.dmg`,
      built: `${APP}-Setup-${v}-macos-universal.dmg`,
      // The names the two per-processor images of 0.4.x were signed under. A
      // Mac copy only announces an update, but the feed has to name its
      // platform for it to hear of one at all.
      feed: {
        'darwin-aarch64': `${APP}-Setup-${v}-macos-arm64.dmg`,
        'darwin-x86_64': `${APP}-Setup-${v}-macos-x64.dmg`,
      },
    },
    ...['x64', 'arm64'].flatMap((arch) => {
      const rust = arch === 'x64' ? 'x86_64' : 'aarch64';
      return ['deb', 'rpm'].map((kind) => ({
        asset: `${APP}-linux-${arch}.${kind}`,
        built: `${APP}-${v}-linux-${rust}.${kind}`,
        // tauri-plugin-updater looks for `linux-<arch>-<deb|rpm>` first in a
        // copy that was bundled as one; `pkexec dpkg -i` / `rpm -U --oldpackage` installs it.
        feed: { [`linux-${rust}-${kind}`]: `${APP}-${v}-linux-${rust}.${kind}` },
      }));
    }),
    {
      asset: `${APP}-linux-x64-portable.tar.gz`,
      built: `${APP}-linux-x64-portable.tar.gz`,
      // The x64 portable copy asks for `linux-x86_64`, which the entry below
      // answers; it never downloads anything, it only hears about the version.
      feed: {},
    },
    {
      asset: `${APP}-linux-arm64-portable.tar.gz`,
      built: `${APP}-linux-arm64-portable.tar.gz`,
      // Nothing older runs on arm64 Linux, so nothing else answers
      // `linux-aarch64` — an AppImage-bundled copy falls back to it.
      feed: { 'linux-aarch64': `${APP}-${v}-linux-aarch64-portable.tar.gz` },
    },
    {
      asset: `${APP}-update-linux-x64.tar.gz`,
      built: `${APP}-Setup-${v}-linux-x86_64.tar.gz`,
      // The per-user setup of 0.4.x. Copies it installed ask for
      // `linux-x86_64` and expect this name in the signature; the setup inside
      // is what brings such a copy up to date in place.
      feed: { 'linux-x86_64': `${APP}-Setup-${v}-linux-x86_64.tar.gz` },
    },
  ];
}

/** Every feed entry of a release: platform key → { signed, asset, built }. */
export function feedEntries(version) {
  return Object.fromEntries(
    releaseFiles(version).flatMap(({ asset, built, feed }) =>
      Object.entries(feed).map(([key, signed]) => [key, { signed, asset, built }]),
    ),
  );
}

/** The names under which `stage` leaves files to sign, one per feed entry. */
export const signedNames = (version) =>
  Object.values(feedEntries(version)).map(({ signed }) => signed);

/**
 * The Downloads section of the release page, in English and German, from the
 * same table as everything else so it cannot name a file that is not there.
 */
export function downloadsSection() {
  const code = (name) => `\`${name}\``;
  const rows = [
    ['Windows (x64)', 'Windows (x64)', code(`${APP}-windows-x64-setup.exe`)],
    ['Windows on ARM', 'Windows auf ARM', code(`${APP}-windows-arm64-setup.exe`)],
    [
      'macOS (Intel & Apple chip)',
      'macOS (Intel & Apple chip)',
      code(`${APP}-macos-universal.dmg`),
    ],
    [
      'Ubuntu / Debian',
      'Ubuntu / Debian',
      `${code(`${APP}-linux-x64.deb`)} · ARM: ${code(`${APP}-linux-arm64.deb`)}`,
    ],
    [
      'Fedora / openSUSE',
      'Fedora / openSUSE',
      `${code(`${APP}-linux-x64.rpm`)} · ARM: ${code(`${APP}-linux-arm64.rpm`)}`,
    ],
    ['Arch Linux', 'Arch Linux', `AUR: ${code(`yay -S ${PACKAGE}-bin`)}`],
    [
      'Linux portable',
      'Linux portabel',
      `${code(`${APP}-linux-x64-portable.tar.gz`)} · ARM: ${code('…-arm64-portable.tar.gz')}`,
    ],
  ];
  return [
    '## Downloads',
    '',
    '| | |',
    '|---|---|',
    ...rows.map(([en, de, files]) => `| ${en === de ? en : `${en} / ${de}`} | ${files} |`),
    '',
    'macOS: the app has no Apple developer ID, so the first start is blocked. System Settings → Privacy & Security → "Open Anyway". ' +
      'Details in docs/install.md.',
    '',
    'macOS: Die App hat keine Apple-Entwickler-ID, deshalb wird der erste Start blockiert. Systemeinstellungen → Datenschutz & Sicherheit → „Dennoch öffnen“. ' +
      'Mehr in docs/install.md.',
    '',
    `\`SHA256SUMS.txt\` lists the checksum of every file here · listet die Prüfsumme jeder Datei hier. ` +
      `\`${APP}-update-…\` files are for the in-app updater · sind für die Update-Funktion der App.`,
  ].join('\n');
}

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

/**
 * Puts a copy of each file under every name it is signed under, next to it.
 * Copies, not links: the signer and the feed read them as plain files, and the
 * artifact upload would not keep a link anyway.
 */
function stage(version, dir) {
  const missing = [];
  for (const [key, { signed, built }] of Object.entries(feedEntries(version))) {
    const from = join(dir, built);
    if (!existsSync(from)) {
      missing.push(`${built} (for ${key})`);
      continue;
    }
    if (signed !== built) copyFileSync(from, join(dir, signed));
  }
  if (missing.length > 0) fail(`Not built: ${missing.join(', ')}`);
  for (const name of signedNames(version)) console.log(join(dir, name));
}

/** The release's files under their public names, and nothing else, in `out`. */
function publish(version, dir, out) {
  mkdirSync(out, { recursive: true });
  for (const { asset, built } of releaseFiles(version)) {
    const from = join(dir, built);
    if (!existsSync(from)) fail(`${built} is missing, so there is no ${asset}.`);
    copyFileSync(from, join(out, asset));
    console.log(`  ${built} → ${asset}`);
  }
}

function notes(version, out) {
  const file = join(root, 'release-notes', `${version}.json`);
  if (!existsSync(file)) fail(`${file} is missing. See release-notes/README.md.`);
  const english = JSON.parse(readFileSync(file, 'utf8')).en;
  if (typeof english !== 'string' || !english.trim()) fail(`${file} has no 'en' text.`);
  writeFileSync(out, `${english.trim()}\n\n${downloadsSection()}\n`);
}

if (import.meta.main) {
  const usage =
    'Usage: node scripts/release-files.mjs <stage|publish|notes> <version> [--dir <folder>] [--out <path>]';
  let positionals = [];
  let values = {};
  try {
    ({ positionals, values } = parseArgs({
      allowPositionals: true,
      options: { dir: { type: 'string' }, out: { type: 'string' } },
    }));
  } catch (error) {
    fail(`${error.message}\n  ${usage}`);
  }
  const [command, tag] = positionals;
  const version = (tag ?? '').replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) fail(usage);
  const dir = resolve(values.dir ?? join(root, 'target/release'));

  if (command === 'stage') stage(version, dir);
  else if (command === 'publish' && values.out) publish(version, dir, resolve(values.out));
  else if (command === 'notes' && values.out) notes(version, resolve(values.out));
  else fail(usage);
}
