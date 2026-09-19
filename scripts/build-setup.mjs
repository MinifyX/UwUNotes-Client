// Builds UwUNotes-Setup-<version>.exe: the editor, packed into UwUNotes' own
// installer.
//
//   pnpm build:setup
//
// With TAURI_SIGNING_PRIVATE_KEY (and _PASSWORD) set, the setup is also signed
// for the updater, which writes UwUNotes-Setup-<version>.exe.sig next to it.
// That signature is what scripts/update-feed.mjs puts in the feed, and what an
// installed copy checks against its compiled-in public key before it runs the
// file it downloaded.
//
// What it deliberately does not do: bundle anything. No NSIS, no MSI — both
// builds below are `--no-bundle`, and the MSI a release also carries is a
// separate `tauri build --bundles msi` in .github/workflows/release.yml. This
// script produces one file and its signature.

import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

if (process.platform !== 'win32') {
  fail('The UwUNotes setup is a Windows program; build it on Windows.');
}

const release = join(root, 'target', 'release');

/**
 * A workspace app: the name pnpm filters by, the version it claims, and the exe
 * `--no-bundle` leaves behind.
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
  if (!named) fail(`${crate} names no package, so there is no exe to look for.`);
  return {
    name: JSON.parse(readFileSync(manifest, 'utf8')).name,
    version: JSON.parse(readFileSync(config, 'utf8')).version,
    exe: join(release, `${named[1]}.exe`),
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

const output = join(release, `UwUNotes-Setup-${version}.exe`);

// Yesterday's build left all of these behind, and `pnpm --filter` prints "no
// projects matched" and exits 0 when it matches nothing — so without this, a
// filter that stopped matching would look exactly like a successful build, and
// a stale .sig would be published for bytes it does not belong to.
for (const stale of [editor.exe, setup.exe, output, `${output}.sig`]) {
  rmSync(stale, { force: true });
}

console.log(`\n▸ Building UwUNotes ${version}`);
run(`pnpm --filter "${editor.name}" tauri build --no-bundle`);
if (!existsSync(editor.exe)) fail(`The editor build left no ${editor.exe}.`);

console.log('\n▸ Packing it into the setup');
run(`pnpm --filter "${setup.name}" tauri build --no-bundle`, {
  UWUNOTES_SETUP_PAYLOAD: editor.exe,
});
if (!existsSync(setup.exe)) fail(`The setup build left no ${setup.exe}.`);
copyFileSync(setup.exe, output);

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
