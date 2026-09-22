// Builds the Linux downloads for the processor it runs on: a .deb, an .rpm and
// a portable folder in a tar.gz.
//
//   node scripts/build-linux-packages.mjs      (on x86_64 or arm64 Linux)
//
// What comes out, in target/release:
//
//   UwUNotes-<version>-linux-<x86_64|aarch64>.deb     Debian, Ubuntu
//   UwUNotes-<version>-linux-<x86_64|aarch64>.rpm     Fedora, openSUSE
//   UwUNotes-linux-<x64|arm64>-portable.tar.gz        unpack and run
//
// The packages are Tauri's own bundles of the editor, installing system-wide
// to /usr, and they update themselves: the editor finds out that dpkg or rpm
// owns it and hands the signed update to `pkexec dpkg -i` / `rpm -U --oldpackage` (see
// apps/desktop/src-tauri/src/updates.rs). Their names carry the version
// because the update signature is made under that name; the release publishes
// them as UwUNotes-linux-<x64|arm64>.<deb|rpm> (scripts/release-files.mjs).
//
// The build uses apps/desktop/src-tauri/linux-packages.conf.json on top of
// tauri.conf.json, for three reasons:
//
// - The package is called `uwunotes`. Tauri names it after the product name in
//   kebab case, which for "UwUNotes" is `uw-u-notes`, and the product name is
//   the only handle on it; so it is `uwunotes` for this build, and the desktop
//   entry (linux/uwunotes.desktop) says "UwUNotes" to people regardless.
// - The executable is /usr/bin/uwunotes rather than the crate's name.
// - `createUpdaterArtifacts` is off. Left on, `tauri build` would find the
//   public key, expect to sign, and stop without the private half — which is
//   the point of it not being on a build machine. The release signs in a job
//   of its own.
//
// The portable folder is the AppImage Tauri builds, unpacked: an AppDir with
// its libraries in it, started through `AppRun`. Unpacked, because a folder
// needs no FUSE and nothing mounted to start. The editor in it knows it came
// from an AppImage bundle, finds no package manager that owns it, and so never
// installs an update — it only says there is one.

import { execFileSync, execSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { APP, PACKAGE } from './release-files.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Nothing here signs, so nothing here needs the key — and the build below runs
// hundreds of third-party build scripts. Same rule as build-setup.mjs.
delete process.env.TAURI_SIGNING_PRIVATE_KEY;
delete process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

/** Node's name for the processor → Rust's, and the one the release uses. */
const ARCHES = {
  x64: { rust: 'x86_64', name: 'x64' },
  arm64: { rust: 'aarch64', name: 'arm64' },
};
if (process.platform !== 'linux') fail('The Linux packages are built on Linux.');
const arch = ARCHES[process.arch];
if (!arch) fail(`The Linux packages are built on x64 or arm64, not on ${process.arch}.`);

const tauriDir = join(root, 'apps/desktop/src-tauri');
const { version } = JSON.parse(readFileSync(join(tauriDir, 'tauri.conf.json'), 'utf8'));
const editor = JSON.parse(readFileSync(join(root, 'apps/desktop/package.json'), 'utf8')).name;
const overlay = join(tauriDir, 'linux-packages.conf.json');
const overlayConf = JSON.parse(readFileSync(overlay, 'utf8'));
if (overlayConf.productName !== PACKAGE || overlayConf.mainBinaryName !== PACKAGE) {
  fail(`${overlay} has to name the package and the executable ${PACKAGE}.`);
}

const release = join(root, 'target', 'release');
const bundles = join(release, 'bundle');
const deb = join(release, `${APP}-${version}-linux-${arch.rust}.deb`);
const rpm = join(release, `${APP}-${version}-linux-${arch.rust}.rpm`);
const portable = join(release, `${APP}-linux-${arch.name}-portable.tar.gz`);
const staging = join(release, 'portable-staging');

// Yesterday's bundles would otherwise be picked up as today's.
for (const stale of ['deb', 'rpm', 'appimage'].map((kind) => join(bundles, kind))) {
  rmSync(stale, { force: true, recursive: true });
}
for (const stale of [deb, rpm, portable, staging]) rmSync(stale, { force: true, recursive: true });

console.log(`\n▸ Building ${APP} ${version} for Linux ${arch.rust}: deb, rpm, AppImage`);
execSync(`pnpm --filter "${editor}" tauri build --bundles deb,rpm,appimage --config "${overlay}"`, {
  cwd: root,
  stdio: 'inherit',
});

/** The one file of that kind the bundler made. */
function bundled(kind, extension) {
  const folder = join(bundles, kind);
  const found = existsSync(folder) ? readdirSync(folder).filter((f) => f.endsWith(extension)) : [];
  if (found.length !== 1) fail(`Expected one ${extension} in ${folder}, found ${found.length}.`);
  return join(folder, found[0]);
}

copyFileSync(bundled('deb', '.deb'), deb);
copyFileSync(bundled('rpm', '.rpm'), rpm);

console.log('\n▸ Unpacking the AppImage into the portable folder');
mkdirSync(staging, { recursive: true });
const appImage = bundled('appimage', '.AppImage');
chmodSync(appImage, 0o755);
// The AppImage's own runtime unpacks it into ./squashfs-root, links and modes
// included, without mounting anything.
execFileSync(appImage, ['--appimage-extract'], { cwd: staging, stdio: 'ignore' });
const folder = join(staging, APP);
renameSync(join(staging, 'squashfs-root'), folder);
if (!existsSync(join(folder, 'AppRun'))) fail(`The AppImage has no AppRun: ${folder}`);

// The editor has to know it is the AppImage build, or it would take itself for
// something a package manager might update.
const exe = join(folder, 'usr', 'bin', PACKAGE);
if (!readFileSync(exe).includes('__TAURI_BUNDLE_TYPE_VAR_APP')) {
  fail(`${exe} is not marked as an AppImage build.`);
}

const launcher = join(folder, PACKAGE);
if (existsSync(launcher)) fail(`The AppDir already has a ${PACKAGE} at its top.`);
writeFileSync(
  launcher,
  [
    '#!/bin/sh',
    `# Starts the portable ${APP} in this folder. It does not update itself.`,
    'here="$(dirname "$(readlink -f "$0")")"',
    'exec "$here/AppRun" "$@"',
    '',
  ].join('\n'),
);
chmodSync(launcher, 0o755);
writeFileSync(
  join(folder, 'README.txt'),
  [
    `${APP} ${version}, portable`,
    '',
    'Nothing to install. Start it from this folder:',
    '',
    `    ./${PACKAGE}`,
    '',
    '(or ./AppRun, which is the same thing). The folder can live anywhere and be',
    'moved; the settings stay in your home folder, shared with any other copy.',
    '',
    `This copy does not update itself. ${APP} tells you when there is a new`,
    'version; then download the portable archive again and replace this folder.',
    'The .deb and the .rpm from the same release page do update themselves.',
    '',
    'https://github.com/MinifyX/UwUNotes-Client/releases/latest',
    '',
  ].join('\n'),
);

// tar, not zip: the AppDir is made of links and executables, and a zip keeps
// neither reliably. No owner from this machine goes into the download.
execFileSync(
  'tar',
  ['--owner=0', '--group=0', '--numeric-owner', '-czf', portable, '-C', staging, APP],
  { stdio: 'inherit' },
);
rmSync(staging, { force: true, recursive: true });

for (const file of [deb, rpm, portable]) console.log(`✧ ${file}`);
