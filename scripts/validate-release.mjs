import { readFile } from 'node:fs/promises';

function fail(message) {
  console.error(`Release validation failed: ${message}`);
  process.exitCode = 1;
}

const tag = process.argv[2] ?? '';
const match = /^v(\d+\.\d+\.\d+)$/.exec(tag);

if (!match) {
  fail(`tag must match vX.Y.Z exactly; received ${JSON.stringify(tag)}`);
} else {
  const expectedVersion = match[1];
  const manifests = ['package.json', 'apps/desktop/package.json', 'packages/core/package.json'];

  for (const path of manifests) {
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    if (manifest.version !== expectedVersion) {
      fail(`${path} has version ${JSON.stringify(manifest.version)}, expected ${expectedVersion}`);
    }
  }

  const cmake = await readFile('native/discord-bridge/CMakeLists.txt', 'utf8');
  const cmakeVersion = /project\(roon_discord_bridge VERSION ([0-9]+\.[0-9]+\.[0-9]+)/.exec(
    cmake
  )?.[1];
  if (cmakeVersion !== expectedVersion) {
    fail(
      `native/discord-bridge/CMakeLists.txt has version ${JSON.stringify(cmakeVersion)}, expected ${expectedVersion}`
    );
  }
}

if (!process.exitCode) {
  console.log(`Release metadata is consistent for ${tag}.`);
}
