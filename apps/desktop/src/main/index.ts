import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  protocol,
  session,
  shell,
  Tray,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions
} from 'electron';
import electronUpdater from 'electron-updater';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { IPC_CHANNELS, type AppSnapshot } from '../shared/contracts';
import { AppController } from './app-controller';
import { parseSettingsPatch } from './defaults';
import { beginVisibleNetworkAccess, requestLocalNetworkAccess } from './local-network';
import { rendererUrlIsTrusted, resolveRendererAssetPath } from './security';

const { autoUpdater } = electronUpdater;

app.setName('Roon Rich Presence');
app.setPath('userData', join(app.getPath('appData'), 'Roon Rich Presence'));

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'rrp',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false }
  }
]);

const ALLOWED_EXTERNAL_HOSTS = new Set([
  'github.com',
  'roon.app',
  'help.roonlabs.com',
  'discord.com',
  'docs.discord.com',
  'musicbrainz.org',
  'coverartarchive.org'
]);
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://coverartarchive.org https://*.coverartarchive.org https://archive.org https://*.archive.org",
  "connect-src 'none'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'"
].join('; ');

let window: BrowserWindow | undefined;
let tray: Tray | undefined;
let controller: AppController | undefined;
let isQuitting = false;
let lastTrayMenuKey = '';
let localNetworkAccessRequest: Promise<void> | undefined;

// Mirrors the --color-bg token for each theme in styles.css, so the window
// never flashes the wrong background color while the renderer loads.
const BACKGROUND_BY_THEME: Record<'light' | 'dark', string> = {
  light: '#f3f2f2',
  dark: '#1c1a17'
};

function requestLocalNetworkAccessOnce(): Promise<void> {
  localNetworkAccessRequest ??= requestLocalNetworkAccess();
  return localNetworkAccessRequest;
}

function shouldLaunchHidden(): boolean {
  const settings = controller?.getSnapshot().settings;
  return Boolean(
    settings?.onboardingComplete &&
    settings.launchHidden &&
    app.getLoginItemSettings().wasOpenedAtLogin
  );
}

function beginVisibleConnectivity(): void {
  void beginVisibleNetworkAccess(requestLocalNetworkAccessOnce, () =>
    controller?.startConnectivity()
  );
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (
    !event.senderFrame ||
    !rendererUrlIsTrusted(event.senderFrame.url, process.env.ELECTRON_RENDERER_URL)
  ) {
    throw new Error('Untrusted IPC sender');
  }
}

function createTrayIcon(): Electron.NativeImage {
  const filename = process.platform === 'darwin' ? 'trayTemplate.png' : 'trayTemplate@2x.png';
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'tray', filename)
    : join(import.meta.dirname, '../../resources/tray', filename);
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) throw new Error(`Tray icon is missing or invalid: ${iconPath}`);
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  return icon;
}

function rebuildTray(snapshot: AppSnapshot): void {
  if (!tray) return;
  const track = snapshot.playback?.track ?? 'Nothing playing';
  const artistAndAlbum = [snapshot.playback?.artist, snapshot.playback?.album]
    .filter(Boolean)
    .join(' — ');
  tray.setToolTip(`Roon Rich Presence — ${track}`);
  const menuKey = JSON.stringify({
    track,
    artistAndAlbum,
    presenceEnabled: snapshot.settings.presenceEnabled,
    zoneMode: snapshot.settings.zoneMode,
    selectedZoneId: snapshot.settings.selectedZoneId,
    zones: snapshot.zones.map(({ id, name, state }) => [id, name, state]),
    roon: snapshot.roon.status,
    discord: snapshot.discord.status
  });
  if (menuKey === lastTrayMenuKey) return;
  lastTrayMenuKey = menuKey;

  const zoneItems: MenuItemConstructorOptions[] = [
    {
      label: 'Automatic — follow the active zone',
      type: 'radio',
      checked: snapshot.settings.zoneMode === 'automatic',
      click: () => controller?.updateSettings({ zoneMode: 'automatic' })
    },
    { type: 'separator' },
    ...snapshot.zones.map<MenuItemConstructorOptions>((zone) => ({
      label: `${zone.name}${zone.state === 'playing' ? '  •  Playing' : ''}`,
      type: 'radio',
      checked:
        snapshot.settings.zoneMode === 'selected' && snapshot.settings.selectedZoneId === zone.id,
      click: () => controller?.updateSettings({ zoneMode: 'selected', selectedZoneId: zone.id })
    }))
  ];
  const template: MenuItemConstructorOptions[] = [
    { label: track.slice(0, 55), enabled: false },
    ...(artistAndAlbum ? [{ label: artistAndAlbum.slice(0, 70), enabled: false }] : []),
    { type: 'separator' },
    {
      label: 'Share on Discord',
      type: 'checkbox',
      checked: snapshot.settings.presenceEnabled,
      click: () =>
        controller?.updateSettings({
          presenceEnabled: !snapshot.settings.presenceEnabled
        })
    },
    { label: 'Playback zone', submenu: zoneItems },
    { type: 'separator' },
    { label: `Roon: ${snapshot.roon.status}`, enabled: false },
    { label: `Discord: ${snapshot.discord.status}`, enabled: false },
    { type: 'separator' },
    { label: 'Open Dashboard…', accelerator: 'CommandOrControl+O', click: () => showWindow() },
    { type: 'separator' },
    {
      label: 'Quit Roon Rich Presence',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function showWindow(): void {
  if (!window || window.isDestroyed()) createWindow();
  if (window?.isMinimized()) window.restore();
  window?.show();
  window?.focus();
  if (process.platform === 'darwin') app.focus({ steal: true });
}

function createWindow(): BrowserWindow {
  const theme = controller?.getSnapshot().settings.theme ?? 'light';
  const created = new BrowserWindow({
    width: 1040,
    height: 880,
    minWidth: 900,
    minHeight: 720,
    show: false,
    backgroundColor: BACKGROUND_BY_THEME[theme],
    title: 'Roon Rich Presence',
    titleBarStyle: 'default',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false
    }
  });
  created.removeMenu();
  created.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      created.hide();
    }
  });
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  created.webContents.on('will-navigate', (event, url) => {
    if (!rendererUrlIsTrusted(url, process.env.ELECTRON_RENDERER_URL)) event.preventDefault();
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    void created.loadURL(process.env.ELECTRON_RENDERER_URL).catch(() => {
      dialog.showErrorBox('Roon Rich Presence', 'The application interface could not be loaded.');
    });
  } else {
    void created.loadURL('rrp://app/index.html').catch(() => {
      dialog.showErrorBox('Roon Rich Presence', 'The application interface could not be loaded.');
    });
  }
  created.once('ready-to-show', () => {
    if (!shouldLaunchHidden()) created.show();
  });
  // macOS can suppress a privacy prompt raised while an app is hidden. Wait until
  // the dashboard is actually visible, including a later tray-open after login.
  created.once('show', beginVisibleConnectivity);
  window = created;
  return created;
}

const RENDERER_MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png'
};

function registerProtocol(): void {
  protocol.handle('rrp', async (request) => {
    const root = join(import.meta.dirname, '../renderer');
    const requested = resolveRendererAssetPath(root, request.url);
    if (!requested) return new Response('Not found', { status: 404 });
    try {
      const contents = await readFile(requested);
      const type = RENDERER_MIME_TYPES[extname(requested)] ?? 'application/octet-stream';
      return new Response(contents, {
        headers: {
          'Content-Type': type,
          'Content-Security-Policy': CSP,
          'X-Content-Type-Options': 'nosniff'
        }
      });
    } catch {
      return new Response('Not found', {
        status: 404,
        headers: { 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff' }
      });
    }
  });
}

function registerIpc(): void {
  if (!controller) throw new Error('Controller must exist before IPC registration');
  ipcMain.handle(IPC_CHANNELS.getSnapshot, (event) => {
    assertTrustedSender(event);
    return controller?.getSnapshot();
  });
  ipcMain.handle(IPC_CHANNELS.updateSettings, (event, input: unknown) => {
    assertTrustedSender(event);
    const patch = parseSettingsPatch(input);
    return controller?.updateSettings(patch);
  });
  ipcMain.handle(IPC_CHANNELS.completeOnboarding, (event) => {
    assertTrustedSender(event);
    return controller?.completeOnboarding();
  });
  ipcMain.handle(IPC_CHANNELS.forgetRoon, (event) => {
    assertTrustedSender(event);
    return controller?.forgetRoon();
  });
  ipcMain.handle(IPC_CHANNELS.copyDiagnostics, (event) => {
    assertTrustedSender(event);
    clipboard.writeText(controller?.getRedactedDiagnostics() ?? '');
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.openLocalNetworkSettings, async (event) => {
    assertTrustedSender(event);
    if (process.platform !== 'darwin') return false;
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork'
    );
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.openExternal, async (event, input: unknown) => {
    assertTrustedSender(event);
    if (typeof input !== 'string' || input.length > 2_048) return false;
    try {
      const url = new URL(input);
      if (url.protocol !== 'https:' || !ALLOWED_EXTERNAL_HOSTS.has(url.hostname)) return false;
      await shell.openExternal(url.toString());
      return true;
    } catch {
      return false;
    }
  });
}

async function start(): Promise<void> {
  registerProtocol();
  // Allow the renderer to request local-network access (needed on macOS for the
  // Chromium-side Local Network TCC prompt). Deny every other permission.
  const LOCAL_NETWORK_PERMS = new Set(['local-network', 'local-network-access']);
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) =>
    callback(
      LOCAL_NETWORK_PERMS.has(permission) &&
        rendererUrlIsTrusted(webContents.getURL(), process.env.ELECTRON_RENDERER_URL)
    )
  );
  session.defaultSession.setPermissionCheckHandler((webContents, permission) =>
    Boolean(
      webContents &&
      LOCAL_NETWORK_PERMS.has(permission) &&
      rendererUrlIsTrusted(webContents.getURL(), process.env.ELECTRON_RENDERER_URL)
    )
  );

  controller = new AppController();
  await controller.initialize();
  registerIpc();
  controller.subscribe((snapshot) => {
    rebuildTray(snapshot);
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.snapshot, snapshot);
      window.setBackgroundColor(BACKGROUND_BY_THEME[snapshot.settings.theme]);
    }
  });
  tray = new Tray(createTrayIcon());
  if (process.platform === 'darwin') tray.setIgnoreDoubleClickEvents(true);
  tray.on('click', () => tray?.popUpContextMenu());
  rebuildTray(controller.getSnapshot());
  createWindow();

  const settings = controller.getSnapshot().settings;
  const updateConfiguration = join(process.resourcesPath, 'app-update.yml');
  if (
    app.isPackaged &&
    process.platform === 'darwin' &&
    process.env.RRP_ENABLE_AUTO_UPDATES === 'true' &&
    settings.automaticUpdates
  ) {
    // Skip the update check if the build was never configured with a real GitHub owner
    // (placeholder build).  The 404 from GitHub fills the console with unhelpful errors.
    const hasRealOwner = await readFile(updateConfiguration, 'utf8')
      .then((t) => !t.includes('PROJECT_OWNER'))
      .catch(() => false);
    if (hasRealOwner) {
      autoUpdater.autoDownload = false;
      void autoUpdater.checkForUpdatesAndNotify().catch(() => undefined);
    }
  }
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.on('activate', () => showWindow());
  app.on('before-quit', () => {
    isQuitting = true;
    controller?.shutdown();
  });
  app.on('will-quit', () => {
    isQuitting = true;
    controller?.shutdown();
  });
  app.on('window-all-closed', () => undefined);
  void app
    .whenReady()
    .then(start)
    .catch(() => {
      dialog.showErrorBox(
        'Roon Rich Presence could not start',
        'Quit the app and try again. If the problem continues, reinstall the latest release.'
      );
      app.quit();
    });
}
