import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type AppSnapshot, type RrpApi } from '../shared/contracts';

const api: RrpApi = {
  getSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.getSnapshot) as Promise<AppSnapshot>,
  updateSettings: (patch) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateSettings, patch) as Promise<AppSnapshot>,
  completeOnboarding: () =>
    ipcRenderer.invoke(IPC_CHANNELS.completeOnboarding) as Promise<AppSnapshot>,
  forgetRoon: () => ipcRenderer.invoke(IPC_CHANNELS.forgetRoon) as Promise<AppSnapshot>,
  copyDiagnostics: () => ipcRenderer.invoke(IPC_CHANNELS.copyDiagnostics) as Promise<boolean>,
  openLocalNetworkSettings: () =>
    ipcRenderer.invoke(IPC_CHANNELS.openLocalNetworkSettings) as Promise<boolean>,
  openExternal: (url: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.openExternal, url) as Promise<boolean>,
  subscribe: (callback: (snapshot: AppSnapshot) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot): void =>
      callback(snapshot);
    ipcRenderer.on(IPC_CHANNELS.snapshot, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.snapshot, listener);
  }
};

contextBridge.exposeInMainWorld('rrp', Object.freeze(api));
