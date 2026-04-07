/**
 * Electron main process — manages the launcher window and the overlay window.
 *
 * The launcher is a normal framed window where users configure and start/stop
 * the overlay. The overlay is a separate transparent, frameless window that
 * shows live tire telemetry on top of the game.
 */

import { app, BrowserWindow, ipcMain, screen, shell, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { OverlayConfig } from '../config';
import { loadConfig, saveConfig } from '../configStore';
import { startTelemetry, stopTelemetry, onTelemetryUpdate, TelemetrySnapshot } from '../telemetry';
import {
  saveCoachSession,
  getCoachSessions,
  recordFeedback,
  getPreferences,
  saveSessionNotes,
} from '../coach/coachStore';

app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});

let launcherWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let radarWindow: BrowserWindow | null = null;
let standingsWindow: BrowserWindow | null = null;
let aboutWindow: BrowserWindow | null = null;
let config: OverlayConfig;

const BASE_WIDTH = 440;
const BASE_HEIGHT = 310;

const RADAR_BASE_WIDTH = 200;
const RADAR_BASE_HEIGHT = 420;

const APP_ICON = path.join(__dirname, '..', '..', 'img', 'icon.ico');

// ── Launcher Window ──────────────────────────────────────────────────────────

function createLauncherWindow(): void {
  launcherWindow = new BrowserWindow({
    width: 420,
    height: 960,
    frame: false,
    resizable: true,
    icon: APP_ICON,
    backgroundColor: '#222330',
    webPreferences: {
      preload: path.join(__dirname, 'launcherPreload.js'),
      contextIsolation: false,
      nodeIntegration: true,
    },
  });

  launcherWindow.loadFile(path.join(__dirname, '..', '..', 'src', 'launcher', 'launcher.html'));

  launcherWindow.on('closed', () => {
    launcherWindow = null;
    // When the launcher closes, tear down overlay and stop telemetry
    destroyOverlay();
    stopTelemetry();
    app.quit();
  });
}

// ── Overlay Window ───────────────────────────────────────────────────────────

function createOverlayWindow(): void {
  if (overlayWindow) return; // already open

  const { width: screenW } = screen.getPrimaryDisplay().workAreaSize;

  const scaledW = Math.round(BASE_WIDTH * config.widgetScale);
  const scaledH = Math.round(BASE_HEIGHT * config.widgetScale);

  const overlayX = config.overlayPosition?.[0] ?? (screenW - scaledW - 30);
  const overlayY = config.overlayPosition?.[1] ?? 30;

  overlayWindow = new BrowserWindow({
    width: scaledW,
    height: scaledH,
    x: overlayX,
    y: overlayY,
    frame: false,
    transparent: true,
    alwaysOnTop: config.alwaysOnTop,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    opacity: config.opacity,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWindow.loadFile(path.join(__dirname, '..', '..', 'src', 'renderer', 'index.html'));
  if (config.alwaysOnTop) overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  applyLock(config.locked);

  // Save position when the user drags the overlay
  overlayWindow.on('moved', () => {
    if (!overlayWindow) return;
    const [x, y] = overlayWindow.getPosition();
    config.overlayPosition = [x, y];
    saveConfig(config);
  });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
    // Do NOT stop telemetry here — the coach still needs it while the launcher is open.
    destroyRadar();
    notifyLauncherStatus(false);
  });

  // Telemetry is already started at app launch; just add overlay-window forwarders.
  onTelemetryUpdate((snapshot: TelemetrySnapshot) => {
    overlayWindow?.webContents.send('telemetry-update', snapshot);
    radarWindow?.webContents.send('radar-update', snapshot.radar);
    standingsWindow?.webContents.send('standings-update', snapshot);
  });

  notifyLauncherStatus(true);

  // Auto-create radar if enabled
  if (config.radarEnabled) {
    createRadarWindow();
  }

  // Auto-create standings if enabled
  if (config.standingsEnabled) {
    createStandingsWindow();
  }

  // Hide the tires overlay window immediately if disabled
  if (!config.tiresEnabled && overlayWindow) {
    overlayWindow.hide();
  }
}

function destroyOverlay(): void {
  if (overlayWindow) {
    overlayWindow.close();
    overlayWindow = null;
  }
  destroyRadar();
  destroyStandings();
  notifyLauncherStatus(false);
}

// ── Radar Window ─────────────────────────────────────────────────────────────

function createRadarWindow(): void {
  if (radarWindow) return;

  const scaledW = Math.round(RADAR_BASE_WIDTH * config.radarScale);
  const scaledH = Math.round(RADAR_BASE_HEIGHT * config.radarScale);

  const radarX = config.radarPosition?.[0] ?? 30;
  const radarY = config.radarPosition?.[1] ?? 30;

  radarWindow = new BrowserWindow({
    width: scaledW,
    height: scaledH,
    x: radarX,
    y: radarY,
    frame: false,
    transparent: true,
    alwaysOnTop: config.alwaysOnTop,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    opacity: config.radarOpacity,
    webPreferences: {
      preload: path.join(__dirname, 'radarPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  radarWindow.loadFile(path.join(__dirname, '..', '..', 'src', 'renderer', 'radar.html'));
  if (config.alwaysOnTop) radarWindow.setAlwaysOnTop(true, 'screen-saver');
  applyLock(config.locked, radarWindow);

  // Save position when the user drags the radar
  radarWindow.on('moved', () => {
    if (!radarWindow) return;
    const [x, y] = radarWindow.getPosition();
    config.radarPosition = [x, y];
    saveConfig(config);
  });

  radarWindow.on('closed', () => {
    radarWindow = null;
    notifyLauncherRadarStatus(false);
  });

  notifyLauncherRadarStatus(true);
}

function destroyRadar(): void {
  if (radarWindow) {
    radarWindow.close();
    radarWindow = null;
  }
  notifyLauncherRadarStatus(false);
}

// ── Standings Window ──────────────────────────────────────────────────────────

const STANDINGS_DEFAULT_W = 900;
const STANDINGS_DEFAULT_H = 520;

function createStandingsWindow(): void {
  if (standingsWindow) return;

  const { width: screenW } = screen.getPrimaryDisplay().workAreaSize;

  const sx = config.standingsPosition?.[0] ?? (screenW - STANDINGS_DEFAULT_W - 30);
  const sy = config.standingsPosition?.[1] ?? 30;
  const sw = config.standingsSize?.[0] ?? STANDINGS_DEFAULT_W;
  const sh = config.standingsSize?.[1] ?? STANDINGS_DEFAULT_H;

  standingsWindow = new BrowserWindow({
    width: sw,
    height: sh,
    x: sx,
    y: sy,
    frame: false,
    transparent: true,
    alwaysOnTop: config.alwaysOnTop,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    opacity: config.standingsOpacity ?? 0.9,
    webPreferences: {
      preload: path.join(__dirname, 'standingsPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  standingsWindow.loadFile(path.join(__dirname, '..', '..', 'src', 'renderer', 'standings.html'));
  if (config.alwaysOnTop) standingsWindow.setAlwaysOnTop(true, 'screen-saver');
  applyLock(config.locked, standingsWindow);

  standingsWindow.on('moved', () => {
    if (!standingsWindow) return;
    const [x, y] = standingsWindow.getPosition();
    config.standingsPosition = [x, y];
    saveConfig(config);
  });

  standingsWindow.on('resized', () => {
    if (!standingsWindow) return;
    const [w, h] = standingsWindow.getSize();
    config.standingsSize = [w, h];
    saveConfig(config);
  });

  standingsWindow.on('closed', () => {
    standingsWindow = null;
    notifyLauncherStandingsStatus(false);
  });

  notifyLauncherStandingsStatus(true);
}

function destroyStandings(): void {
  if (standingsWindow) {
    standingsWindow.close();
    standingsWindow = null;
  }
  notifyLauncherStandingsStatus(false);
}



function applyLock(locked: boolean, win?: BrowserWindow | null): void {
  const target = win ?? overlayWindow;
  if (!target) return;
  target.setIgnoreMouseEvents(locked, { forward: true });
}

function notifyLauncherStatus(running: boolean): void {
  launcherWindow?.webContents.send('overlay-status', running);
}

function notifyLauncherRadarStatus(running: boolean): void {
  launcherWindow?.webContents.send('radar-status', running);
}

function notifyLauncherStandingsStatus(running: boolean): void {
  launcherWindow?.webContents.send('standings-status', running);
}

// ── IPC: Launcher ────────────────────────────────────────────────────────────

ipcMain.handle('launcher:get-config', () => config);

ipcMain.handle('launcher:save-config', (_event, newCfg: OverlayConfig) => {
  // Preserve window positions from the running config (they're saved on move events)
  const savedOverlayPos = config.overlayPosition;
  const savedRadarPos = config.radarPosition;
  const savedStandingsPos = config.standingsPosition;
  const savedStandingsSize = config.standingsSize;
  config = { ...config, ...newCfg, thresholds: { ...config.thresholds, ...newCfg.thresholds } };
  config.overlayPosition = savedOverlayPos;
  config.radarPosition = savedRadarPos;
  config.standingsPosition = savedStandingsPos;
  config.standingsSize = savedStandingsSize;
  saveConfig(config);

  // Apply live changes to overlay if it's running
  if (overlayWindow) {
    overlayWindow.setAlwaysOnTop(config.alwaysOnTop, config.alwaysOnTop ? 'screen-saver' : 'normal');
    overlayWindow.setOpacity(config.opacity);
    applyLock(config.locked);
    // Resize window to match new scale
    const newW = Math.round(BASE_WIDTH * config.widgetScale);
    const newH = Math.round(BASE_HEIGHT * config.widgetScale);
    overlayWindow.setSize(newW, newH);
    // Push updated config to overlay renderer
    overlayWindow.webContents.send('config-updated', config);
    // Show/hide tires overlay
    if (config.tiresEnabled) {
      overlayWindow.show();
    } else {
      overlayWindow.hide();
    }
  }

  // Apply live changes to radar if it's running
  if (radarWindow) {
    radarWindow.setAlwaysOnTop(config.alwaysOnTop, config.alwaysOnTop ? 'screen-saver' : 'normal');
    radarWindow.setOpacity(config.radarOpacity);
    applyLock(config.locked, radarWindow);
    const newRW = Math.round(RADAR_BASE_WIDTH * config.radarScale);
    const newRH = Math.round(RADAR_BASE_HEIGHT * config.radarScale);
    radarWindow.setSize(newRW, newRH);
    radarWindow.webContents.send('config-updated', config);
  }

  // Apply live changes to standings if it's running
  if (standingsWindow) {
    standingsWindow.setAlwaysOnTop(config.alwaysOnTop, config.alwaysOnTop ? 'screen-saver' : 'normal');
    standingsWindow.setOpacity(config.standingsOpacity ?? 0.9);
    applyLock(config.locked, standingsWindow);
    standingsWindow.webContents.send('config-updated', config);
  }

  // Toggle radar window based on radarEnabled (only when overlay is running)
  if (overlayWindow) {
    if (config.radarEnabled && !radarWindow) {
      createRadarWindow();
    } else if (!config.radarEnabled && radarWindow) {
      destroyRadar();
    }

    // Toggle standings window based on standingsEnabled
    if (config.standingsEnabled && !standingsWindow) {
      createStandingsWindow();
    } else if (!config.standingsEnabled && standingsWindow) {
      destroyStandings();
    }
  }
});

ipcMain.handle('launcher:start-overlay', () => {
  createOverlayWindow();
});

ipcMain.handle('launcher:stop-overlay', () => {
  destroyOverlay();
});

ipcMain.handle('launcher:is-overlay-running', () => {
  return overlayWindow !== null;
});

ipcMain.on('launcher:minimize', () => {
  launcherWindow?.minimize();
});

ipcMain.on('launcher:resize', (_e, w: number, h: number) => {
  launcherWindow?.setSize(w, h);
});

ipcMain.on('launcher:close', () => {
  launcherWindow?.close();
});

ipcMain.on('launcher:open-about', () => {
  if (aboutWindow) {
    aboutWindow.focus();
    return;
  }
  aboutWindow = new BrowserWindow({
    width: 660,
    height: 720,
    frame: false,
    resizable: true,
    icon: APP_ICON,
    autoHideMenuBar: true,
    backgroundColor: '#222330',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  aboutWindow.setMenu(null);
  aboutWindow.loadFile(path.join(__dirname, '..', '..', 'src', 'about', 'about.html'));
  aboutWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  aboutWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  aboutWindow.on('closed', () => { aboutWindow = null; });
});

// ── IPC: Radar ───────────────────────────────────────────────────────────────

ipcMain.handle('launcher:start-radar', () => {
  createRadarWindow();
});

ipcMain.handle('launcher:stop-radar', () => {
  destroyRadar();
});

ipcMain.handle('launcher:is-radar-running', () => {
  return radarWindow !== null;
});

// ── IPC: Standings ────────────────────────────────────────────────────────────

ipcMain.handle('launcher:start-standings', () => {
  createStandingsWindow();
});

ipcMain.handle('launcher:stop-standings', () => {
  destroyStandings();
});

ipcMain.handle('launcher:is-standings-running', () => {
  return standingsWindow !== null;
});

/** Renderer requests temporary mouse capture (for scrolling while locked) */
ipcMain.on('standings:set-ignore-mouse', (_event, ignore: boolean) => {
  if (standingsWindow) {
    standingsWindow.setIgnoreMouseEvents(ignore, { forward: true });
  }
});

/** Called by the standings overlay to persist column toggle changes */
ipcMain.handle('standings:save-columns', (_event, cols: Record<string, boolean>) => {
  config.standingsShowFlags          = cols.flags     ?? config.standingsShowFlags;
  config.standingsShowCarNumber      = cols.car       ?? config.standingsShowCarNumber;
  config.standingsShowMake           = cols.make      ?? config.standingsShowMake;
  config.standingsShowIRating        = cols.irating   ?? config.standingsShowIRating;
  config.standingsShowSafetyRating   = cols.safety    ?? config.standingsShowSafetyRating;
  config.standingsShowBestLap        = cols.best      ?? config.standingsShowBestLap;
  config.standingsShowLastLap        = cols.last      ?? config.standingsShowLastLap;
  config.standingsShowIncidents      = cols.incidents ?? config.standingsShowIncidents;
  saveConfig(config);
  // Also push the updated config back to launcher so its checkboxes stay in sync
  launcherWindow?.webContents.send('config-updated', config);
});

// ── IPC: Coach ───────────────────────────────────────────────────────────────

ipcMain.handle('coach:open-setup-file', async () => {
  const result = await dialog.showOpenDialog(launcherWindow!, {
    title: 'Open iRacing Setup File',
    filters: [{ name: 'iRacing Setup', extensions: ['html', 'htm', 'sto', 'txt'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  // iRacing .sto files are UTF-16 LE — detect BOM and decode accordingly
  const raw = fs.readFileSync(filePath);
  const isUtf16 = raw[0] === 0xFF && raw[1] === 0xFE;
  const content = raw.toString(isUtf16 ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '');
  return { filePath, content };
});

ipcMain.handle('coach:save-setup-file', async (_event, content: string, suggestedName: string) => {
  const result = await dialog.showSaveDialog({
    title: 'Save Modified Setup',
    defaultPath: suggestedName,
    filters: [{ name: 'iRacing Setup', extensions: ['sto'] }],
  });
  if (result.canceled || !result.filePath) return null;
  // Write as UTF-16 LE with BOM to match iRacing's expected encoding
  const bom = Buffer.from([0xFF, 0xFE]);
  const body = Buffer.from(content, 'utf16le');
  fs.writeFileSync(result.filePath, Buffer.concat([bom, body]));
  return result.filePath;
});

ipcMain.handle('coach:save-session', (_event, analysis: any) => {
  return saveCoachSession(analysis);
});

ipcMain.handle('coach:get-sessions', () => {
  return getCoachSessions();
});

ipcMain.handle('coach:record-feedback', (_event, sessionId: string, feedback: 'helpful' | 'not_helpful') => {
  recordFeedback(sessionId, feedback);
});

ipcMain.handle('coach:save-notes', (_event, sessionId: string, notes: string) => {
  saveSessionNotes(sessionId, notes);
});

ipcMain.handle('coach:get-preferences', () => {
  return getPreferences();
});

// ── IPC: Overlay widget ──────────────────────────────────────────────────────

ipcMain.handle('get-config', () => config);

ipcMain.handle('set-config', (_event, partial: Partial<OverlayConfig>) => {
  config = { ...config, ...partial };
  if (partial.thresholds) {
    config.thresholds = { ...config.thresholds, ...partial.thresholds };
  }
  saveConfig(config);

  if (overlayWindow) {
    if (partial.alwaysOnTop !== undefined) overlayWindow.setAlwaysOnTop(partial.alwaysOnTop, partial.alwaysOnTop ? 'screen-saver' : 'normal');
    if (partial.opacity !== undefined) overlayWindow.setOpacity(partial.opacity);
    if (partial.locked !== undefined) applyLock(partial.locked);
  }

  if (radarWindow) {
    if (partial.alwaysOnTop !== undefined) radarWindow.setAlwaysOnTop(partial.alwaysOnTop, partial.alwaysOnTop ? 'screen-saver' : 'normal');
    if (partial.radarOpacity !== undefined) radarWindow.setOpacity(partial.radarOpacity);
    if (partial.locked !== undefined) applyLock(partial.locked, radarWindow);
  }

  return config;
});

// ── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  config = loadConfig();
  createLauncherWindow();

  // Start telemetry immediately so the coach buffers laps even before
  // the tires/radar overlay windows are opened.
  startTelemetry(config.pollIntervalMs, config.radarRange);
  onTelemetryUpdate((snapshot: TelemetrySnapshot) => {
    launcherWindow?.webContents.send('coach-telemetry', snapshot);
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
