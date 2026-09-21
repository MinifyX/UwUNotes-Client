// Builds latest.json, the feed an installed UwUNotes asks whether there is
// something newer, out of finished, signed builds.
//
//   node scripts/update-feed.mjs v0.2.0 --out latest.json
//   node scripts/update-feed.mjs v0.2.0            (dry run: prints it, writes nothing)
//   node scripts/update-feed.mjs v0.2.0 --dir dist --require-all --verify-release --out latest.json
//
// The version and the notes come from the tag and release-notes/<version>.json,
// the signatures from the .sig files beside the setups, and the URLs from the
// release's own download paths. One entry per system, each naming the file a
// release publishes for it:
//
//   windows-x86_64   UwUNotes-Setup-<v>.exe                   run with --update by the editor
//   linux-x86_64     UwUNotes-Setup-<v>-linux-x86_64.tar.gz   announced, installed by hand
//   darwin-aarch64   UwUNotes-Setup-<v>-macos-arm64.dmg       announced, installed by hand
//   darwin-x86_64    UwUNotes-Setup-<v>-macos-x64.dmg         announced, installed by hand
//
// Only Windows installs an update by itself (see apps/desktop/src-tauri/src/
// updates.rs). The others are in the feed all the same, because the updater
// plugin answers "platform not found" to a copy whose system the feed does not
// name — and those copies should hear about a new version as much as any other.
//
// Everything this is about to write is checked first: every signature against
// the public key installed copies have baked in, and with --verify-release
// against the release on GitHub. A feed naming a file nobody can download is
// worse than no feed: the app keeps asking it, and keeps failing.
//
// Windows is required, always: it is what every installed copy since 0.2.0
// follows. The others are included when their files are there, and with
// --require-all — which is what the release workflow passes — a missing one is
// an error rather than a quieter feed.
//
// It deliberately publishes nothing. Pushing the `updates` branch is
// .github/workflows/release.yml's job, and it happens only once the release
// exists with its assets attached.

import { createHash, createPublicKey, verify } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const REPOSITORY = 'MinifyX/UwUNotes-Client';
export const FEED_BRANCH = 'updates';
/** The one platform the feed cannot be without. */
export const PLATFORM = 'windows-x86_64';

/** Every platform the feed names, and what a release calls its file. */
export const PLATFORMS = {
  'windows-x86_64': (version) => `UwUNotes-Setup-${version}.exe`,
  'linux-x86_64': (version) => `UwUNotes-Setup-${version}-linux-x86_64.tar.gz`,
  'darwin-aarch64': (version) => `UwUNotes-Setup-${version}-macos-arm64.dmg`,
  'darwin-x86_64': (version) => `UwUNotes-Setup-${version}-macos-x64.dmg`,
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Where an asset of release v<version> ends up on github.com. */
export const downloadUrl = (version, name) =>
  `https://github.com/${REPOSITORY}/releases/download/v${version}/${name}`;

/**
 * Tauri v2's updater format, for one setup per platform:
 * `setups` maps a platform key to `{ name, signature }`.
 */
export function updateFeed({ version, notes, setups, date = new Date() }) {
  return {
    version,
    notes,
    // RFC 3339. Without the milliseconds: nothing reads them, and they make two
    // feeds built a second apart look more different than they are.
    pub_date: date.toISOString().replace(/\.\d+Z$/, 'Z'),
    platforms: Object.fromEntries(
      Object.entries(setups).map(([platform, setup]) => [
        platform,
        { signature: setup.signature, url: downloadUrl(version, setup.name) },
      ]),
    ),
  };
}

/** The 32-byte key out of a base64 minisign public key, with its id. */
export function publicKey(pubkeyBase64) {
  const blob = Buffer.from(
    Buffer.from(pubkeyBase64, 'base64').toString('utf8').split(/\r?\n/)[1] ?? '',
    'base64',
  );
  return { blob, id: keyId(blob) };
}

// Minisign puts the key id in little-endian; the id people read is the other
// way round. Buffer.from copies, so this does not turn the caller's key around.
const keyId = (blob) => Buffer.from(blob.subarray(2, 10)).reverse().toString('hex').toUpperCase();

/**
 * Checks a Tauri updater signature the way an installed copy will, against the
 * public key from tauri.conf.json. Returns what is wrong with it, if anything.
 */
export function signatureProblems({ file, signature, pubkey, name }) {
  const pub = publicKey(pubkey).blob;
  const [, signatureLine, trustedLine, globalLine] = Buffer.from(signature, 'base64')
    .toString('utf8')
    .split(/\r?\n/);
  const sig = Buffer.from(signatureLine ?? '', 'base64');
  // Two bytes of algorithm, eight of key id, then the key or the signature.
  if (pub.length !== 42 || sig.length !== 74) {
    return ['The public key or the signature is not minisign of the expected shape.'];
  }
  if (!sig.subarray(2, 10).equals(pub.subarray(2, 10))) {
    return [
      `${name} is signed with key ${keyId(sig)}, but installed copies trust ${keyId(pub)}, ` +
        'so nobody could install this update.',
    ];
  }

  const key = createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: pub.subarray(10).toString('base64url') },
    format: 'jwk',
  });
  // 'ED' means the hash of the file was signed, 'Ed' the file itself.
  const prehashed = sig.subarray(0, 2).toString('latin1') === 'ED';
  const signed = prehashed ? createHash('blake2b512').update(file).digest() : file;
  const problems = [];
  if (!verify(null, signed, key, sig.subarray(10))) {
    problems.push(`The signature does not match ${name}: the .sig is for other bytes.`);
  }

  const trusted = Buffer.from((trustedLine ?? '').replace(/^trusted comment: /, ''), 'utf8');
  const global = Buffer.concat([sig.subarray(10), trusted]);
  if (!verify(null, global, key, Buffer.from(globalLine ?? '', 'base64'))) {
    problems.push('The trusted comment does not verify against the signature.');
  }
  // Tauri writes the file name into the trusted comment, and that is what
  // catches a .sig an earlier build of another version left in target/.
  const named = trusted
    .toString('utf8')
    .split('\t')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('file:'))
    .map((part) => part.slice('file:'.length));
  if (named.length > 0 && !named.includes(name)) {
    problems.push(`The signature names ${named.join(', ')}, not ${name}.`);
  }
  return problems;
}

/**
 * Reads back what would be published and says what is wrong with it.
 * `names` maps each platform the feed is meant to carry to its file name.
 */
export function feedProblems(text, { version, names }) {
  let feed;
  try {
    feed = JSON.parse(text);
  } catch (error) {
    return [`The feed is not JSON: ${error.message}`];
  }

  const problems = [];
  if (feed.version !== version) problems.push(`The feed says version ${feed.version}.`);
  if (typeof feed.notes !== 'string' || !feed.notes.trim()) problems.push('The feed has no notes.');
  if (Number.isNaN(Date.parse(feed.pub_date))) {
    problems.push(`pub_date ${feed.pub_date} is not a date.`);
  }
  if (!feed.platforms?.[PLATFORM]) {
    problems.push(`The feed has no ${PLATFORM}, which every installed copy since 0.2.0 follows.`);
  }

  for (const [key, name] of Object.entries(names)) {
    const platform = feed.platforms?.[key];
    if (!platform) {
      problems.push(`The feed has no ${key}.`);
      continue;
    }
    if (typeof platform.signature !== 'string' || !platform.signature.trim()) {
      problems.push(`${key} carries no signature: every installed copy would refuse the update.`);
    }
    if (platform.url !== downloadUrl(version, name)) {
      problems.push(`${key} points at ${platform.url} instead of ${downloadUrl(version, name)}.`);
    }
  }
  for (const key of Object.keys(feed.platforms ?? {})) {
    if (!(key in names)) problems.push(`The feed names ${key}, which nothing was built for.`);
  }
  return problems;
}

/** The asset called `name` on release v<version>, if it is really there. */
export async function releaseAsset(version, name) {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'uwunotes-update-feed' };
  // Optional, because the repository is public. It keeps a runner off the
  // unauthenticated rate limit, which is per address and not this job's to use up.
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(
    `https://api.github.com/repos/${REPOSITORY}/releases/tags/v${version}`,
    { headers },
  );
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status} when asked for release v${version}.`);
  }
  const release = await response.json();
  return release.assets?.find((asset) => asset.name === name);
}

/** What `pnpm build:setup` calls the Windows setup for a version. */
export const setupName = (version) => PLATFORMS[PLATFORM](version);

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

const usage =
  'Usage: node scripts/update-feed.mjs <tag> [--dir <folder>] [--require-all] [--out <file>] [--verify-release]';

if (import.meta.main) {
  let positionals = [];
  let values = {};
  try {
    ({ positionals, values } = parseArgs({
      allowPositionals: true,
      options: {
        dir: { type: 'string' },
        out: { type: 'string' },
        'require-all': { type: 'boolean', default: false },
        'verify-release': { type: 'boolean', default: false },
      },
    }));
  } catch (error) {
    fail(`${error.message}\n  ${usage}`);
  }

  const version = (positionals[0] ?? '').replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) fail(usage);
  // Betas are for the people who went looking for them. The feed is what every
  // installed copy follows, so it stays on the last finished version.
  if (version.includes('-')) fail(`${version} is a pre-release and does not belong in the feed.`);

  const conf = JSON.parse(
    readFileSync(join(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'),
  );
  if (conf.version !== version) {
    fail(`The feed would say ${version}, but this build is ${conf.version} per tauri.conf.json.`);
  }
  const pubkey = conf.plugins?.updater?.pubkey;
  if (typeof pubkey !== 'string' || !pubkey.trim()) {
    fail('tauri.conf.json has no plugins.updater.pubkey, so no installed copy has an updater.');
  }

  const notesFile = join(root, 'release-notes', `${version}.json`);
  if (!existsSync(notesFile)) fail(`${notesFile} is missing. See release-notes/README.md.`);
  const notes = JSON.parse(readFileSync(notesFile, 'utf8')).en;
  if (typeof notes !== 'string' || !notes.trim()) {
    fail(`release-notes/${version}.json has no 'en' text, and that is what the feed shows.`);
  }

  const dir = values.dir ? resolve(values.dir) : join(root, 'target/release');
  console.log(`UwUNotes ${version}, from ${dir}`);

  const setups = {};
  const paths = {};
  for (const [platform, nameFor] of Object.entries(PLATFORMS)) {
    const name = nameFor(version);
    const path = join(dir, name);
    if (!existsSync(path)) {
      if (platform === PLATFORM || values['require-all']) {
        fail(`${path} is missing. Run pnpm build:setup first.`);
      }
      console.log(`  · ${platform}: no ${name} here, left out`);
      continue;
    }
    if (!existsSync(`${path}.sig`)) {
      fail(`${name}.sig is missing: the build was not signed, so there is nothing to feed.`);
    }
    const signature = readFileSync(`${path}.sig`, 'utf8').trim();
    if (!signature) fail(`${name}.sig is empty.`);
    const signed = signatureProblems({ file: readFileSync(path), signature, pubkey, name });
    if (signed.length > 0) fail(signed.join('\n  '));
    console.log(`  ✓ ${platform}: ${name}, signed with ${publicKey(pubkey).id}`);
    setups[platform] = { name, signature };
    paths[platform] = path;
  }

  const feed = updateFeed({ version, notes, setups });
  const text = `${JSON.stringify(feed, null, 2)}\n`;
  const names = Object.fromEntries(Object.entries(setups).map(([key, { name }]) => [key, name]));
  const written = feedProblems(text, { version, names });
  if (written.length > 0) fail(written.join('\n  '));
  console.log(`  ✓ ${Object.keys(setups).length} platforms, ${notes.length} characters of notes`);

  if (values['verify-release']) {
    for (const [platform, { name }] of Object.entries(setups)) {
      const asset = await releaseAsset(version, name);
      if (!asset || asset.state !== 'uploaded') {
        fail(`Release v${version} has no finished ${name}: the feed would send everyone to a 404.`);
      }
      if (asset.browser_download_url !== feed.platforms[platform].url) {
        fail(`The release serves ${name} from ${asset.browser_download_url}.`);
      }
      const size = statSync(paths[platform]).size;
      if (asset.size !== size) {
        fail(`The attached ${name} is ${asset.size} bytes, the signed one ${size}.`);
      }
      console.log(`  ✓ ${name} attached to release v${version}, ${size} bytes`);
    }
  }

  if (values.out) {
    writeFileSync(values.out, text);
    console.log(`\n✧ ${values.out}`);
  } else {
    console.log('\nDry run, nothing written:\n');
    console.log(text);
  }
}
