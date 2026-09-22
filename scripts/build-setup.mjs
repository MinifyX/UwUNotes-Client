// Builds UwUNotes' own installer for the system it runs on: the editor, packed
// into the setup with Nyu in it.
//
//   pnpm build:setup     (for this machine)
//
// What comes out, in target/release:
//
//   Windows x64    UwUNotes-Setup-<version>.exe                     the setup itself
//   Windows ARM64  UwUNotes-Setup-<version>-windows-arm64.exe       the setup itself
//   macOS          UwUNotes-Setup-<version>-macos-universal.dmg     Intel and Apple Silicon
//   Linux          UwUNotes-Setup-<version>-linux-x86_64.tar.gz     one executable inside
//
// Those are the names the builds and the update signatures use; the release
// publishes the same bytes under stable names (UwUNotes-windows-x64-setup.exe
// and so on). scripts/release-files.mjs has the table and the reason.
//
// Windows builds for the processor of the Rust toolchain it finds — x64 on an
// x64 runner, ARM64 on `windows-11-arm` — and says which in the file name,
// because an ARM64 copy updates itself from a setup of its own. One Mac image
// for both processors: `--target universal-apple-darwin` compiles each half
// and joins them with `lipo`, for the editor and for the setup. It is a bigger
// download than a single-processor image and spares everyone the question
// which Mac they have. The Linux setup is x86_64 only: it is there for the
// copies it installed in 0.4.x, and published for them alone as
// UwUNotes-update-linux-x64.tar.gz; everyone else on Linux gets the .deb, the
// .rpm or the portable folder from scripts/build-linux-packages.mjs.
//
// With TAURI_SIGNING_PRIVATE_KEY (and _PASSWORD) set, the result is also signed
// for the updater, which writes a .sig next to it. That signature is what
// scripts/update-feed.mjs puts in the feed, and what an installed copy checks
// against its compiled-in public key before it runs the file it downloaded.
// The release workflow never sets the key here — it signs in a job of its own,
// on a runner that has not built anything — but a local build still can.
//
// What it deliberately does not do: use Tauri's installers. No NSIS, no MSI, no
// Tauri DMG — the editor is built `--no-bundle` on Windows and Linux and as a
// bare `.app` on macOS, and the setup around it is ours. This script produces
// one file and its signature.

import { execFileSync, execSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (command, env = {}) =>
  execSync(command, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });

// Keep the update-signing key out of the app build. Only `tauri signer sign`
// needs it; the builds below run hundreds of third-party build scripts (Cargo
// build.rs, npm) that would otherwise see it in their environment. Captured
// here and removed from the environment, then handed only to the signing command.
const signingKey = process.env.TAURI_SIGNING_PRIVATE_KEY;
const signingPassword = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '';
delete process.env.TAURI_SIGNING_PRIVATE_KEY;
delete process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

try {
  parseArgs({ options: {} });
} catch (error) {
  fail(`${error.message}\n  Usage: node scripts/build-setup.mjs`);
}

/** The one Mac build: both processors, by the target Tauri knows for that. */
const MAC_TARGET = 'universal-apple-darwin';
/** The Windows processors, by Rust host: what that adds to the file name. */
const WINDOWS = {
  'x86_64-pc-windows-msvc': '',
  'aarch64-pc-windows-msvc': '-windows-arm64',
};

const platform = process.platform;
if (!['win32', 'darwin', 'linux'].includes(platform)) {
  fail(`The UwUNotes setup is built on Windows, macOS or Linux, not on ${platform}.`);
}
if (platform === 'linux' && process.arch !== 'x64') {
  fail('The Linux setup is built for x86_64 only, and on x86_64.');
}
const target = platform === 'darwin' ? MAC_TARGET : undefined;
// What Cargo builds for without --target is the toolchain's host, not the
// processor Node was built for. The two can differ under emulation, and the
// file name has to say what is inside the file.
let windowsSuffix = '';
if (platform === 'win32') {
  const host = /^host: (\S+)$/m.exec(execFileSync('rustc', ['-vV'], { encoding: 'utf8' }))?.[1];
  if (!(host in WINDOWS)) {
    fail(`rustc builds for ${host}; a Windows setup is ${Object.keys(WINDOWS).join(' or ')}.`);
  }
  windowsSuffix = WINDOWS[host];
}

// Where Cargo leaves what it built: target/<triple>/release when a target is
// named, target/release when it is not. The finished setup always goes to
// target/release, which is where the release workflow looks.
const release = join(root, 'target', 'release');
const built = target ? join(root, 'target', target, 'release') : release;
const targetFlag = target ? ` --target ${target}` : '';
const exeSuffix = platform === 'win32' ? '.exe' : '';

/**
 * A workspace app: the name pnpm filters by, the version it claims, and the
 * executable `--no-bundle` leaves behind.
 *
 * All three are read rather than written down here, because all three live in
 * files this script does not own — a crate renamed in Cargo.toml would
 * otherwise show up as a missing file two builds later.
 */
function app(folder) {
  const here = join(root, 'apps', folder);
  const manifest = join(here, 'package.json');
  const config = join(here, 'src-tauri/tauri.conf.json');
  const crate = join(here, 'src-tauri/Cargo.toml');
  for (const file of [manifest, config, crate]) {
    if (!existsSync(file)) fail(`apps/${folder} is not a Tauri app here: ${file} is missing.`);
  }
  // The `name` of the `[package]` section, and not of a section after it.
  const named = /^\s*\[package\][^[]*?^\s*name\s*=\s*"([^"]+)"/ms.exec(readFileSync(crate, 'utf8'));
  if (!named) fail(`${crate} names no package, so there is no executable to look for.`);
  const conf = JSON.parse(readFileSync(config, 'utf8'));
  return {
    name: JSON.parse(readFileSync(manifest, 'utf8')).name,
    version: conf.version,
    product: conf.productName,
    exe: join(built, `${named[1]}${exeSuffix}`),
    bundle: join(built, 'bundle', 'macos', `${conf.productName}.app`),
  };
}

// One tag, one version. A setup that reports something other than the editor it
// carries is a support question forever. The release workflow checks both
// against the tag before it compiles anything; this is the same check for every
// build that no tag started.
const editor = app('desktop');
const setup = app('setup');
if (setup.version !== editor.version) {
  fail(`apps/setup says ${setup.version}, the editor says ${editor.version}.`);
}
const version = editor.version;

// Safety net against a future refactor: the builds must never run with the signing key in reach.
if (process.env.TAURI_SIGNING_PRIVATE_KEY || process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
  throw new Error('The update-signing key must be removed from the environment before building.');
}

const output = join(
  release,
  {
    win32: `UwUNotes-Setup-${version}${windowsSuffix}.exe`,
    darwin: `UwUNotes-Setup-${version}-macos-universal.dmg`,
    linux: `UwUNotes-Setup-${version}-linux-x86_64.tar.gz`,
  }[platform],
);
// The folders the Mac image and the Linux archive are put together in.
const staging = join(release, `setup-staging-${target ?? platform}`);

// Yesterday's build left all of these behind, and `pnpm --filter` prints "no
// projects matched" and exits 0 when it matches nothing — so without this, a
// filter that stopped matching would look exactly like a successful build, and
// a stale .sig would be published for bytes it does not belong to.
for (const stale of [editor.exe, setup.exe, editor.bundle, setup.bundle, staging]) {
  rmSync(stale, { force: true, recursive: true });
}
rmSync(output, { force: true });
rmSync(`${output}.sig`, { force: true });
mkdirSync(release, { recursive: true });

/**
 * A `--config` file for one build. A file rather than JSON on the command line,
 * because the quoting of that is different in every shell this runs in.
 */
function configFile(name, config) {
  const file = join(tmpdir(), `uwunotes-${name}-${process.pid}.json`);
  writeFileSync(file, JSON.stringify(config));
  return file;
}

console.log(`\n▸ Building UwUNotes ${version}${target ? ` for ${target}` : ''}`);
let payload;
if (platform === 'darwin') {
  // The editor as a bare app bundle. `createUpdaterArtifacts` is off for this
  // build alone, as it is for the Linux packages: Tauri would otherwise find the public key
  // in tauri.conf.json, expect to sign an .app.tar.gz nobody reads, and stop
  // without the private half — which is the whole point of it not being here.
  const config = configFile('editor', { bundle: { createUpdaterArtifacts: false } });
  run(`pnpm --filter "${editor.name}" tauri build${targetFlag} --bundles app --config "${config}"`);
  payload = editor.bundle;
} else {
  run(`pnpm --filter "${editor.name}" tauri build${targetFlag} --no-bundle`);
  payload = editor.exe;
}
if (!existsSync(payload)) fail(`The editor build left no ${payload}.`);

/**
 * A universal build that quietly came out with one processor would install
 * and run on half the Macs, so the executable is asked what it carries.
 */
function checkUniversal(bundle) {
  const folder = join(bundle, 'Contents', 'MacOS');
  const [exe] = readdirSync(folder);
  const archs = execFileSync('lipo', ['-archs', join(folder, exe)], { encoding: 'utf8' }).trim();
  if (!archs.split(/\s+/).includes('x86_64') || !archs.split(/\s+/).includes('arm64')) {
    fail(`${bundle} carries ${archs}, not both x86_64 and arm64.`);
  }
  console.log(`  ${exe}: ${archs}`);
}
if (platform === 'darwin') checkUniversal(payload);

console.log('\n▸ Packing it into the setup');
if (platform === 'darwin') {
  // The setup is an app of its own on a Mac — a bare executable in a disk
  // image is something Finder offers to open in a text editor. Bundling is off
  // in its tauri.conf.json because no other system wants a bundle of it, so it
  // is switched on here, for this one build, with the icon a Mac reads.
  const config = configFile('setup', {
    bundle: {
      active: true,
      targets: ['app'],
      icon: [
        '../../desktop/src-tauri/icons/32x32.png',
        '../../desktop/src-tauri/icons/128x128.png',
        '../../desktop/src-tauri/icons/icon.icns',
      ],
    },
  });
  run(`pnpm --filter "${setup.name}" tauri build${targetFlag} --bundles app --config "${config}"`, {
    UWUNOTES_SETUP_PAYLOAD: payload,
  });
  if (!existsSync(setup.bundle)) fail(`The setup build left no ${setup.bundle}.`);
  checkUniversal(setup.bundle);

  // The disk image people download: one window with the setup in it. `ditto`
  // rather than a plain copy, because it keeps what a bundle is made of —
  // links, modes and extended attributes — exactly as they are.
  mkdirSync(staging, { recursive: true });
  execFileSync('ditto', [setup.bundle, join(staging, `${setup.product}.app`)], {
    stdio: 'inherit',
  });
  execFileSync(
    'hdiutil',
    ['create', '-volname', setup.product, '-srcfolder', staging, '-ov', '-format', 'UDZO', output],
    { stdio: 'inherit' },
  );
} else {
  run(`pnpm --filter "${setup.name}" tauri build${targetFlag} --no-bundle`, {
    UWUNOTES_SETUP_PAYLOAD: payload,
  });
  if (!existsSync(setup.exe)) fail(`The setup build left no ${setup.exe}.`);

  if (platform === 'win32') {
    copyFileSync(setup.exe, output);
  } else {
    // One executable in an archive, because an archive is what keeps its
    // executable bit on the way through a browser's download folder — a bare
    // file arrives as 0644 and a double-click does nothing.
    const inside = `UwUNotes-Setup-${version}`;
    mkdirSync(staging, { recursive: true });
    copyFileSync(setup.exe, join(staging, inside));
    chmodSync(join(staging, inside), 0o755);
    execFileSync(
      'tar',
      ['--owner=0', '--group=0', '--numeric-owner', '-czf', output, '-C', staging, inside],
      { stdio: 'inherit' },
    );
  }
}
rmSync(staging, { force: true, recursive: true });
if (!existsSync(output)) fail(`Nothing was written to ${output}.`);

if (signingKey) {
  console.log('\n▸ Signing for the updater');
  run(`pnpm --filter "${editor.name}" exec tauri signer sign "${output}"`, {
    TAURI_SIGNING_PRIVATE_KEY: signingKey,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: signingPassword,
  });
  if (!existsSync(`${output}.sig`)) fail('The signer reported success but wrote no .sig.');
} else {
  console.log('\n▸ No TAURI_SIGNING_PRIVATE_KEY, so this setup is unsigned:');
  console.log('  fine for trying out, but no installed copy would update to it.');
}

console.log(`\n✧ ${output}`);
