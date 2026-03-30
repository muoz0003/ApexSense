/**
 * Electron main process — manages the launcher window and the overlay window.
 *
 * The launcher is a normal framed window where users configure and start/stop
 * the overlay. The overlay is a separate transparent, frameless window that
 * shows live tire telemetry on top of the game.
 */

import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';
import * as path from 'path';
import { OverlayConfig } from '../config';
import { loadConfig, saveConfig } from '../configStore';
import { startTelemetry, stopTelemetry, onTelemetryUpdate, TelemetrySnapshot } from '../telemetry';

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
let aboutWindow: BrowserWindow | null = null;
let config: OverlayConfig;

const BASE_WIDTH = 440;
const BASE_HEIGHT = 400;

const RADAR_BASE_WIDTH = 200;
const RADAR_BASE_HEIGHT = 420;

const APP_ICON = path.join(__dirname, '..', '..', 'img', 'icon.ico');

// ── Launcher Window ──────────────────────────────────────────────────────────

function createLauncherWindow(): void {
  launcherWindow = new BrowserWindow({
    width: 420,
    height: 700,
    frame: false,
    resizable: false,
    icon: APP_ICON,
    backgroundColor: '#181820',
    webPreferences: {
      preload: path.join(__dirname, 'launcherPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  launcherWindow.loadFile(path.join(__dirname, '..', '..', 'src', 'launcher', 'launcher.html'));

  launcherWindow.on('closed', () => {
    launcherWindow = null;
    // When the launcher closes, tear down overlay too
    destroyOverlay();
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
    stopTelemetry();
    destroyRadar();
    notifyLauncherStatus(false);
  });

  // Start telemetry polling (with radar range)
  startTelemetry(config.pollIntervalMs, config.radarRange);

  // Forward telemetry to overlay renderer and radar
  onTelemetryUpdate((snapshot: TelemetrySnapshot) => {
    overlayWindow?.webContents.send('telemetry-update', snapshot);
    radarWindow?.webContents.send('radar-update', snapshot.radar);
  });

  notifyLauncherStatus(true);

  // Auto-create radar if enabled
  if (config.radarEnabled) {
    createRadarWindow();
  }
}

function destroyOverlay(): void {
  stopTelemetry();
  if (overlayWindow) {
    overlayWindow.close();
    overlayWindow = null;
  }
  destroyRadar();
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

// ── IPC: Launcher ────────────────────────────────────────────────────────────

ipcMain.handle('launcher:get-config', () => config);

ipcMain.handle('launcher:save-config', (_event, newCfg: OverlayConfig) => {
  // Preserve window positions from the running config (they're saved on move events)
  const savedOverlayPos = config.overlayPosition;
  const savedRadarPos = config.radarPosition;
  config = { ...config, ...newCfg, thresholds: { ...config.thresholds, ...newCfg.thresholds } };
  config.overlayPosition = savedOverlayPos;
  config.radarPosition = savedRadarPos;
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

  // Toggle radar window based on radarEnabled (only when overlay is running)
  if (overlayWindow) {
    if (config.radarEnabled && !radarWindow) {
      createRadarWindow();
    } else if (!config.radarEnabled && radarWindow) {
      destroyRadar();
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
});

app.on('window-all-closed', () => {
  app.quit();
});
