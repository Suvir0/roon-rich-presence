/**
 * Rasterizes apps/desktop/resources/icon.svg into the platform icon files that
 * electron-builder consumes: icon.png (Linux), icon.icns (macOS), icon.ico
 * (Windows). Run it after editing the SVG, then commit the regenerated files.
 *
 * Requires rsvg-convert (`brew install librsvg`). The .icns step additionally
 * requires macOS, which provides iconutil.
 */
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const resources = join(repoRoot, 'apps', 'desktop', 'resources');
const source = join(resources, 'icon.svg');

const ICNS_SLICES = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024]
];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: 'inherit' });
  if (result.error?.code === 'ENOENT') {
    throw new Error(`${command} is not installed. Install it and run this script again.`);
  }
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

async function render(size, destination) {
  run('rsvg-convert', ['-w', String(size), '-h', String(size), source, '-o', destination]);
  return readFile(destination);
}

/** Builds an ICO directory around already-encoded PNG frames. */
function buildIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);

  let offset = 6 + frames.length * 16;
  const entries = frames.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...frames.map(({ data }) => data)]);
}

const workspace = await mkdtemp(join(tmpdir(), 'rrp-icons-'));
try {
  await render(512, join(resources, 'icon.png'));

  const iconset = join(workspace, 'icon.iconset');
  run('mkdir', ['-p', iconset]);
  for (const [name, size] of ICNS_SLICES) await render(size, join(iconset, name));
  run('iconutil', ['-c', 'icns', iconset, '-o', join(resources, 'icon.icns')]);

  const frames = [];
  for (const size of ICO_SIZES) {
    frames.push({ size, data: await render(size, join(workspace, `ico-${size}.png`)) });
  }
  await writeFile(join(resources, 'icon.ico'), buildIco(frames));

  console.log('Wrote icon.png, icon.icns, and icon.ico from icon.svg.');
} finally {
  await rm(workspace, { recursive: true, force: true });
}
