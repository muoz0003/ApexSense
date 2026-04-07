/**
 * Preload for the launcher window.
 * contextIsolation: false � assigns directly to window so coachRenderer.js
 * (which uses CommonJS require) can access both APIs in the same world.
 */

import { ipcRenderer } from 'electron';

(window as any).launcherAPI = {
  getConfig: (): Promise<any> => ipcRenderer.invoke('launcher:get-config'),
  saveConfig: (cfg: any): Promise<void> => ipcRenderer.invoke('launcher:save-config', cfg),
  startOverlay: (): Promise<void> => ipcRenderer.invoke('launcher:start-overlay'),
  stopOverlay: (): Promise<void> => ipcRenderer.invoke('launcher:stop-overlay'),
  isOverlayRunning: (): Promise<boolean> => ipcRenderer.invoke('launcher:is-overlay-running'),
  onOverlayStatus: (callback: (running: boolean) => void) => {
    ipcRenderer.on('overlay-status', (_event: any, running: boolean) => callback(running));
  },
  startRadar: (): Promise<void> => ipcRenderer.invoke('launcher:start-radar'),
  stopRadar: (): Promise<void> => ipcRenderer.invoke('launcher:stop-radar'),
  isRadarRunning: (): Promise<boolean> => ipcRenderer.invoke('launcher:is-radar-running'),
  onRadarStatus: (callback: (running: boolean) => void) => {
    ipcRenderer.on('radar-status', (_event: any, running: boolean) => callback(running));
  },
  startStandings: (): Promise<void> => ipcRenderer.invoke('launcher:start-standings'),
  stopStandings: (): Promise<void> => ipcRenderer.invoke('launcher:stop-standings'),
  isStandingsRunning: (): Promise<boolean> => ipcRenderer.invoke('launcher:is-standings-running'),
  onStandingsStatus: (callback: (running: boolean) => void) => {
    ipcRenderer.on('standings-status', (_event: any, running: boolean) => callback(running));
  },
  minimizeWindow: () => ipcRenderer.send('launcher:minimize'),
  closeWindow:    () => ipcRenderer.send('launcher:close'),
  openAbout:      () => ipcRenderer.send('launcher:open-about'),
  resizeLauncher: (w: number, h: number) => ipcRenderer.send('launcher:resize', w, h),
};

(window as any).coachAPI = {
  onCoachTelemetry: (cb: (snapshot: any) => void) => {
    ipcRenderer.on('coach-telemetry', (_event: any, snapshot: any) => cb(snapshot));
  },
  openSetupFile: (): Promise<{ filePath: string; content: string } | null> =>
    ipcRenderer.invoke('coach:open-setup-file'),
  saveSetupFile: (content: string, suggestedName: string): Promise<string | null> =>
    ipcRenderer.invoke('coach:save-setup-file', content, suggestedName),
  saveSession: (analysis: any): Promise<any> =>
    ipcRenderer.invoke('coach:save-session', analysis),
  getSessions: (): Promise<any[]> =>
    ipcRenderer.invoke('coach:get-sessions'),
  recordFeedback: (sessionId: string, feedback: 'helpful' | 'not_helpful'): Promise<void> =>
    ipcRenderer.invoke('coach:record-feedback', sessionId, feedback),
  saveNotes: (sessionId: string, notes: string): Promise<void> =>
    ipcRenderer.invoke('coach:save-notes', sessionId, notes),
  getPreferences: (): Promise<Record<string, number>> =>
    ipcRenderer.invoke('coach:get-preferences'),
  minimizeWindow: () => ipcRenderer.send('launcher:minimize'),
  closeWindow:    () => {},
};
