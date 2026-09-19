// Builds latest.json, the feed an installed UwUNotes asks whether there is
// something newer, out of a finished Windows build.
//
//   node scripts/update-feed.mjs v0.2.0 --out latest.json
//   node scripts/update-feed.mjs v0.2.0            (dry run: prints it, writes nothing)
//
// The version and the notes come from the tag and release-notes/<version>.json,
// the signature from the .sig that `pnpm build:setup` leaves next to
// UwUNotes-Setup-<version>.exe, and the URL from the release's own download
// path. That setup is UwUNotes' own installer rather than Tauri's NSIS one —
// the file the release publishes, and the file an installed copy runs.
// Everything this is about to write is checked first: the signature against the
// public key installed copies have baked in, and with --verify-release against
// the release on GitHub. A feed naming a file nobody can download is worse than
// no feed: the app keeps asking it, and keeps failing.
//
// It deliberately publishes nothing. Pushing the `updates` branch is
// .github/workflows/release.yml's job, and it happens only once the release
// exists with its assets attached.

import { createHash, createPublicKey, verify } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const REPOSITORY = 'MinifyX/UwUNotes-Client';
export const FEED_BRANCH = 'updates';
export const PLATFORM = 'windows-x86_64';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Where an asset of release v<version> ends up on github.com. */
export const downloadUrl = (version, name) =>
  `https://github.com/${REPOSITORY}/releases/download/v${version}/${name}`;

/** Tauri v2's updater format, for one setup ({ name, signature }). */
export function updateFeed({ version, notes, setup, date = new Date() }) {
  return {
    version,
    notes,
    // RFC 3339. Without the milliseconds: nothing reads them, and they make two
    // feeds built a second apart look more different than they are.
    pub_date: date.toISOString().replace(/\.\d+Z$/, 'Z'),
    platforms: {
      [PLATFORM]: { signature: setup.signature, url: downloadUrl(version, setup.name) },
    },
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

/** Reads back what would be published and says what is wrong with it. */
export function feedProblems(text, { version, name }) {
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

  const platform = feed.platforms?.[PLATFORM];
  if (!platform) {
    problems.push(`The feed has no ${PLATFORM}, the only platform UwUNotes ships on.`);
    return problems;
  }
  if (typeof platform.signature !== 'string' || !platform.signature.trim()) {
    problems.push('The feed carries no signature: every installed copy would refuse the update.');
  }
  if (platform.url !== downloadUrl(version, name)) {
    problems.push(`The feed points at ${platform.url} instead of ${downloadUrl(version, name)}.`);
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

/** What `pnpm build:setup` calls the setup for a version, and where it puts it. */
export const setupName = (version) => `UwUNotes-Setup-${version}.exe`;
const setupFor = (version) => join(root, 'target/release', setupName(version));

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

const usage =
  'Usage: node scripts/update-feed.mjs <tag> [--setup <exe>] [--out <file>] [--verify-release]';

if (import.meta.main) {
  let positionals = [];
  let values = {};
  try {
    ({ positionals, values } = parseArgs({
      allowPositionals: true,
      options: {
        setup: { type: 'string' },
        out: { type: 'string' },
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

  const setupPath = values.setup ? resolve(values.setup) : setupFor(version);
  if (!existsSync(setupPath)) fail(`${setupPath} is missing. Run pnpm build:setup first.`);
  const name = basename(setupPath);
  if (!existsSync(`${setupPath}.sig`)) {
    fail(`${name}.sig is missing: the build did not sign the setup, so there is nothing to feed.`);
  }
  const signature = readFileSync(`${setupPath}.sig`, 'utf8').trim();
  if (!signature) fail(`${name}.sig is empty.`);

  console.log(`UwUNotes ${version}, ${name}`);
  const signed = signatureProblems({ file: readFileSync(setupPath), signature, pubkey, name });
  if (signed.length > 0) fail(signed.join('\n  '));
  console.log(`  ✓ signed with ${publicKey(pubkey).id}, the key installed copies trust`);

  const feed = updateFeed({ version, notes, setup: { name, signature } });
  const text = `${JSON.stringify(feed, null, 2)}\n`;
  const written = feedProblems(text, { version, name });
  if (written.length > 0) fail(written.join('\n  '));
  console.log(`  ✓ ${PLATFORM}, ${notes.length} characters of notes`);

  if (values['verify-release']) {
    const asset = await releaseAsset(version, name);
    if (!asset || asset.state !== 'uploaded') {
      fail(`Release v${version} has no finished ${name}: the feed would send everyone to a 404.`);
    }
    if (asset.browser_download_url !== feed.platforms[PLATFORM].url) {
      fail(`The release serves ${name} from ${asset.browser_download_url}.`);
    }
    const size = statSync(setupPath).size;
    if (asset.size !== size) {
      fail(`The attached ${name} is ${asset.size} bytes, the signed one ${size}.`);
    }
    console.log(`  ✓ attached to release v${version}, ${size} bytes`);
  }

  if (values.out) {
    writeFileSync(values.out, text);
    console.log(`\n✧ ${values.out}`);
  } else {
    console.log('\nDry run, nothing written:\n');
    console.log(text);
  }
}
