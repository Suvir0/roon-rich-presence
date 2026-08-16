import { createHash } from 'node:crypto';
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const expectedArchive = 'DiscordSocialSdk-1.10.18687.zip';
const expectedSha256 = '7041ca2c9de67ed923d2f626d1982aa397a89566da5a945e3605110a2ff9f207';
const archivePath = resolve(process.argv[2] ?? join(homedir(), 'Downloads', expectedArchive));
const repoRoot = resolve(import.meta.dirname, '..');
const resourceDirectory = join(repoRoot, 'apps', 'desktop', 'resources', 'discord-bridge', 'bin');

if (process.platform !== 'darwin') {
  throw new Error('This command creates the local macOS beta and must run on a Mac.');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
    ...options
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}`);
  }
}

async function sha256(path) {
  const hash = createHash('sha256');
  hash.update(await readFile(path));
  return hash.digest('hex');
}

await access(archivePath);
if (basename(archivePath) !== expectedArchive) {
  console.warn(`Using ${basename(archivePath)}; checksum verification remains mandatory.`);
}

const actualSha256 = await sha256(archivePath);
if (actualSha256 !== expectedSha256) {
  throw new Error(
    `Discord Social SDK checksum mismatch. Expected ${expectedSha256}, received ${actualSha256}.`
  );
}

console.log(`Verified ${basename(archivePath)} (${actualSha256}).`);

const temporaryRoot = await mkdtemp(join(tmpdir(), 'roon-rich-presence-sdk-'));
const sdkRoot = join(temporaryRoot, 'sdk');
const buildRoot = join(temporaryRoot, 'build');
const stagingRoot = join(temporaryRoot, 'staging');

try {
  await mkdir(sdkRoot);
  run('ditto', ['-x', '-k', archivePath, sdkRoot]);

  run('cmake', [
    '-S',
    'native/discord-bridge',
    '-B',
    buildRoot,
    '-DRRP_DISCORD_STUB=OFF',
    '-DRRP_BUILD_TESTS=OFF',
    `-DDISCORD_SOCIAL_SDK_ROOT=${sdkRoot}`,
    '-DCMAKE_BUILD_TYPE=Release',
    '-DCMAKE_OSX_ARCHITECTURES=arm64;x86_64'
  ]);
  run('cmake', ['--build', buildRoot, '--config', 'Release', '--parallel']);
  run('cmake', ['--install', buildRoot, '--config', 'Release', '--prefix', stagingRoot]);

  const stagedBin = join(stagingRoot, 'bin');
  const bridge = join(stagedBin, 'discord-bridge');
  const sdkLibrary = join(stagedBin, 'libdiscord_partner_sdk.dylib');
  const notices = join(stagedBin, 'DiscordSocialSdk-License-Notices.txt');

  run('lipo', [bridge, '-verify_arch', 'arm64', 'x86_64']);
  run('lipo', [sdkLibrary, '-verify_arch', 'arm64', 'x86_64']);

  await mkdir(resourceDirectory, { recursive: true });
  await copyFile(bridge, join(resourceDirectory, 'discord-bridge'));
  await copyFile(sdkLibrary, join(resourceDirectory, 'libdiscord_partner_sdk.dylib'));
  await copyFile(notices, join(resourceDirectory, 'DiscordSocialSdk-License-Notices.txt'));
  await chmod(join(resourceDirectory, 'discord-bridge'), 0o755);
  await chmod(join(resourceDirectory, 'libdiscord_partner_sdk.dylib'), 0o755);

  run('node', [
    'scripts/preflight-release-bridge.mjs',
    join(resourceDirectory, 'discord-bridge'),
    process.env.DISCORD_APPLICATION_ID ?? '1538003707147325546'
  ]);

  run('npm', ['run', 'package:mac:beta']);

  const manifest = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
  const releaseDirectory = join(repoRoot, 'release');
  const assetNames = [
    `Roon Rich Presence-Beta-${manifest.version}-universal.dmg`,
    `Roon Rich Presence-Beta-${manifest.version}-universal.zip`
  ];
  const checksumLines = [];
  for (const assetName of assetNames) {
    checksumLines.push(`${await sha256(join(releaseDirectory, assetName))}  ${assetName}`);
  }
  await writeFile(
    join(releaseDirectory, 'SHA256SUMS-mac-beta.txt'),
    `${checksumLines.join('\n')}\n`,
    { mode: 0o644 }
  );

  console.log('macOS beta installers are ready in the release directory.');
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
