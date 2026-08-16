import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const client = resolve(root, 'dist/client');
const server = resolve(root, 'dist/server');

await rm(resolve(root, 'dist'), { recursive: true, force: true });
await mkdir(client, { recursive: true });
await mkdir(server, { recursive: true });

for (const file of ['index.html', 'styles.css', 'script.js', 'og.png']) {
  await cp(resolve(root, 'website', file), resolve(client, file));
}

await cp(resolve(root, 'website/worker.js'), resolve(server, 'index.js'));
console.log('Built the Roon Rich Presence site for Cloudflare Workers.');
