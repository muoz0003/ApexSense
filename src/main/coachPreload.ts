/**
 * Preload for the Live Coach window.
 * Exposes telemetry, file I/O, and coaching data IPC to the renderer.
 * Uses direct window assignment (contextIsolation: false, nodeIntegration: true).
 */

import { ipcRenderer } from 'electron';

(window as any).coachAPI = {
  // ── Telemetry ─────────────────────────────────────────────────────────────
  onCoachTelemetry: (cb: (snapshot: any) => void) => {
    ipcRenderer.on('coach-telemetry', (_event: any, snapshot: any) => cb(snapshot));
  },

  // ── Setup file import ──────────────────────────────────────────────────────
  openSetupFile: (): Promise<{ filePath: string; content: string } | null> =>
    ipcRenderer.invoke('coach:open-setup-file'),

  // ── Session persistence ────────────────────────────────────────────────────
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

  // ── Window controls ────────────────────────────────────────────────────────
  minimizeWindow: () => ipcRenderer.send('coach:minimize'),
  closeWindow: () => ipcRenderer.send('coach:close'),
};
