/**
 * Preload for the launcher window — exposes launcher-specific IPC to the renderer.
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('launcherAPI', {
  getConfig: (): Promise<any> => ipcRenderer.invoke('launcher:get-config'),

  saveConfig: (cfg: any): Promise<void> => ipcRenderer.invoke('launcher:save-config', cfg),

  startOverlay: (): Promise<void> => ipcRenderer.invoke('launcher:start-overlay'),

  stopOverlay: (): Promise<void> => ipcRenderer.invoke('launcher:stop-overlay'),

  isOverlayRunning: (): Promise<boolean> => ipcRenderer.invoke('launcher:is-overlay-running'),

  onOverlayStatus: (callback: (running: boolean) => void) => {
    ipcRenderer.on('overlay-status', (_event, running) => callback(running));
  },

  // ── Radar ──────────────────────────────────────────────────────────────
  startRadar: (): Promise<void> => ipcRenderer.invoke('launcher:start-radar'),

  stopRadar: (): Promise<void> => ipcRenderer.invoke('launcher:stop-radar'),

  isRadarRunning: (): Promise<boolean> => ipcRenderer.invoke('launcher:is-radar-running'),

  onRadarStatus: (callback: (running: boolean) => void) => {
    ipcRenderer.on('radar-status', (_event, running) => callback(running));
  },
  minimizeWindow: () => ipcRenderer.send('launcher:minimize'),

  closeWindow: () => ipcRenderer.send('launcher:close'),

  openAbout: () => ipcRenderer.send('launcher:open-about'),
});
