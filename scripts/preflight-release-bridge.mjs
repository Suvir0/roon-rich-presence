import { spawn } from 'node:child_process';

const [bridgePath, applicationId] = process.argv.slice(2);
if (!bridgePath || !/^\d{16,22}$/.test(applicationId ?? '')) {
  console.error('Usage: node scripts/preflight-release-bridge.mjs <bridge> <application-id>');
  process.exit(2);
}

const child = spawn(bridgePath, ['--application-id', applicationId], {
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true
});
let stdout = '';
let stderr = '';
const maximumOutputBytes = 64 * 1024;
const timeout = setTimeout(() => {
  child.kill();
}, 15_000);

child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  stdout = (stdout + chunk).slice(-maximumOutputBytes);
});
child.stderr.on('data', (chunk) => {
  stderr = (stderr + chunk).slice(-maximumOutputBytes);
});
child.stdin.end('{"command":"shutdown","request_id":"release-preflight"}\n');

child.once('error', (error) => {
  clearTimeout(timeout);
  console.error(`Production bridge failed to start: ${error.message}`);
  process.exit(1);
});

child.once('close', (code, signal) => {
  clearTimeout(timeout);
  const lines = stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return undefined;
      }
    })
    .filter(Boolean);
  const ready = lines.find((event) => event.event === 'ready');
  if (ready?.mode !== 'discord-social-sdk') {
    console.error(
      `Production bridge preflight failed (exit=${code ?? signal ?? 'unknown'}): ${stderr.slice(0, 500)}`
    );
    process.exitCode = 1;
    return;
  }
  console.log('Production Discord bridge preflight passed.');
});
