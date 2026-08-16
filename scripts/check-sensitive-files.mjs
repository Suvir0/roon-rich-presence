import { readdir } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

const root = process.cwd();
const ignoredDirectories = new Set(['.git', 'node_modules', 'out', 'release', 'dist', 'coverage']);
const forbiddenNames = new Set(['config.json', 'roon-state.bin']);
const findings = [];

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await visit(path);
    } else if (forbiddenNames.has(basename(path))) {
      findings.push(relative(root, path));
    }
  }
}

await visit(root);

if (findings.length) {
  console.error('Sensitive Roon state files must not exist inside the repository:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log('No forbidden Roon authorization files found.');
