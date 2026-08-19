// Regenerates the product site's application screenshots from a running build.
//
// The screenshots on rrp.suvir.net are captures of the real interface, not
// mock-ups, so this script drives an actual application window over the Chrome
// DevTools Protocol rather than rendering the renderer bundle on its own.
//
// Usage:
//   1. Start a build with remote debugging enabled, for example
//      "/Applications/Roon Rich Presence.app/Contents/MacOS/Roon Rich Presence" \
//        --remote-debugging-port=9222
//   2. Connect it to Roon and play something, so the panels are populated.
//   3. node scripts/capture-app-screenshots.mjs
//
// The script changes the theme and returns to the setup screen while it works,
// then restores the settings it found. It never writes anything but image files.

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const PORT = process.env.RRP_DEBUG_PORT ?? '9222';
const OUT = resolve(import.meta.dirname, '../website/screenshots');
const WIDTH = 1040;
const HEIGHT = 880;
const SCALE = 2;

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((target) => target.type === 'page');
  if (!page) throw new Error(`No application window found on port ${PORT}.`);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    socket.onopen = done;
    socket.onerror = fail;
  });
  const pending = new Map();
  let lastId = 0;
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const handler = message.id && pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
    if (message.error) handler.fail(new Error(JSON.stringify(message.error)));
    else handler.done(message.result);
  };
  const send = (method, params = {}) =>
    new Promise((done, fail) => {
      const id = ++lastId;
      pending.set(id, { done, fail });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) =>
    (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result
      .value;
  return { send, evaluate, close: () => socket.close() };
}

const cdp = await connect();
const restore = JSON.parse(
  await cdp.evaluate(
    'window.rrp.getSnapshot().then((snapshot) => JSON.stringify(snapshot.settings))'
  )
);

const update = async (patch) => {
  await cdp.evaluate(`window.rrp.updateSettings(${JSON.stringify(patch)}).then(() => true)`);
  await wait(800);
};

// Scrollbars belong to the operating system, not to the interface being shown.
await cdp.evaluate(`(() => {
  const style = document.createElement('style');
  style.id = 'rrp-capture';
  style.textContent = '::-webkit-scrollbar{width:0;height:0;display:none}';
  document.head.appendChild(style);
  return true;
})()`);

async function capture(name, selector, { pad = 0, maxHeight } = {}) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false
  });
  await wait(900);
  const rect = JSON.parse(
    await cdp.evaluate(`(() => {
      const element = document.querySelector('${selector}');
      if (!element) return 'null';
      const box = element.getBoundingClientRect();
      return JSON.stringify({ x: box.x + scrollX, y: box.y + scrollY, w: box.width, h: box.height });
    })()`)
  );
  if (!rect) throw new Error(`Selector ${selector} matched nothing.`);
  const height = rect.h + pad * 2;
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'webp',
    quality: 92,
    captureBeyondViewport: true,
    clip: {
      x: Math.max(0, rect.x - pad),
      y: Math.max(0, rect.y - pad),
      width: rect.w + pad * 2,
      height: maxHeight ? Math.min(height, maxHeight) : height,
      scale: SCALE
    }
  });
  await writeFile(resolve(OUT, `${name}.webp`), Buffer.from(shot.data, 'base64'));
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  console.log(`captured ${name}.webp`);
}

const sections = "document.querySelectorAll('.dashboard-main .section')";

for (const theme of ['light', 'dark']) {
  await update({ theme, onboardingComplete: true });
  await capture(`dashboard-${theme}`, '.app-card', { maxHeight: 820 });
  await capture(`now-playing-${theme}`, '.now-playing', { maxHeight: 620 });
  await capture(`published-${theme}`, '.published-block', { pad: 14 });
  await capture(`zones-${theme}`, `${sections}[1]`, { pad: 16 });
  await capture(`sharing-${theme}`, `${sections}[2]`, { pad: 16 });
  await capture(`artwork-${theme}`, `${sections}[3]`, { pad: 16 });

  await update({ onboardingComplete: false });
  await capture(`setup-${theme}`, '.app-card');
  await cdp.evaluate('window.rrp.completeOnboarding().then(() => true)');
  await wait(600);
}

await cdp.evaluate(`document.getElementById('rrp-capture')?.remove()`);
await update({
  theme: restore.theme,
  presenceEnabled: restore.presenceEnabled,
  zoneMode: restore.zoneMode,
  showAlbum: restore.showAlbum,
  showProgress: restore.showProgress,
  showZone: restore.showZone,
  showWhenPaused: restore.showWhenPaused,
  artworkLookupEnabled: restore.artworkLookupEnabled
});
cdp.close();
console.log('Restored the settings that were in place before capturing.');
