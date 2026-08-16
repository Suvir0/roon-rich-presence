import { cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const client = resolve(root, 'dist/client');
const server = resolve(root, 'dist/server');

await mkdir(client, { recursive: true });
await mkdir(server, { recursive: true });

for (const file of ['index.html', 'styles.css', 'script.js', 'og.png', 'CNAME', '.nojekyll']) {
  await cp(resolve(root, 'website', file), resolve(client, file));
}

await cp(resolve(root, 'website/worker.js'), resolve(server, 'index.js'));
console.log('Built the Roon Rich Presence site for Cloudflare Workers.');
