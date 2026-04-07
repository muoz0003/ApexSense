/**
 * Preload for the standings overlay window.
 * Uses contextBridge + contextIsolation:true (same pattern as radarPreload).
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('standingsAPI', {
  /** Receive full telemetry snapshots (connected, standings[], session) */
  onStandingsUpdate: (callback: (snapshot: any) => void) => {
    ipcRenderer.on('standings-update', (_event, snapshot) => callback(snapshot));
  },

  /** Receive config updates pushed from the launcher when the user saves settings */
  onConfigUpdate: (callback: (config: any) => void) => {
    ipcRenderer.on('config-updated', (_event, config) => callback(config));
  },

  /** Get the current overlay config (for initial column toggle state) */
  getConfig: (): Promise<any> => ipcRenderer.invoke('get-config'),

  /** Persist column visibility back to config */
  saveColumnToggles: (cols: Record<string, boolean>): Promise<void> =>
    ipcRenderer.invoke('standings:save-columns', cols),

  /** Allow the renderer to control mouse-event pass-through (for scroll while locked) */
  setIgnoreMouseEvents: (ignore: boolean): void =>
    ipcRenderer.send('standings:set-ignore-mouse', ignore),
});
