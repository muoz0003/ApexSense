/**
 * Preload for the radar overlay window — exposes a safe API via contextBridge.
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('radarAPI', {
  /** Receive radar telemetry snapshots from the main process */
  onRadarUpdate: (callback: (snapshot: any) => void) => {
    ipcRenderer.on('radar-update', (_event, snapshot) => callback(snapshot));
  },

  /** Receive config updates pushed from the launcher */
  onConfigUpdate: (callback: (config: any) => void) => {
    ipcRenderer.on('config-updated', (_event, config) => callback(config));
  },

  /** Get current overlay config */
  getConfig: (): Promise<any> => ipcRenderer.invoke('get-config'),

  /** Persist a partial config update */
  setConfig: (partial: Record<string, unknown>): Promise<any> => ipcRenderer.invoke('set-config', partial),
});
