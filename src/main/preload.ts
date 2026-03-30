/**
 * Preload script — exposes a safe API to the renderer via contextBridge.
 * The renderer never gets direct access to Node.js or Electron internals.
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('overlayAPI', {
  /** Receive telemetry snapshots from the main process */
  onTelemetryUpdate: (callback: (snapshot: any) => void) => {
    ipcRenderer.on('telemetry-update', (_event, snapshot) => callback(snapshot));
  },

  /** Receive config updates pushed from the launcher */
  onConfigUpdate: (callback: (config: any) => void) => {
    ipcRenderer.on('config-updated', (_event, config) => callback(config));
  },

  /** Get current overlay config */
  getConfig: (): Promise<any> => ipcRenderer.invoke('get-config'),

  /** Update overlay config (partial merge) */
  setConfig: (partial: Record<string, any>): Promise<any> =>
    ipcRenderer.invoke('set-config', partial),
});
