/**
 * Launcher renderer — controls for starting/stopping the overlay and editing settings.
 */

interface TireThresholds {
  coldRedMax: number;
  coldYellowMax: number;
  hotYellowMin: number;
  hotRedMin: number;
}

interface OverlayConfig {
  widgetScale: number;
  opacity: number;
  alwaysOnTop: boolean;
  locked: boolean;
  pollIntervalMs: number;
  thresholds: TireThresholds;
  radarEnabled: boolean;
  tiresEnabled: boolean;
  radarScale: number;
  radarOpacity: number;
  radarRange: number;
  radarCarWidth: number;
  radarCarHeight: number;
  standingsEnabled: boolean;
  standingsOpacity: number;
  standingsShowFlags: boolean;
  standingsShowCarNumber: boolean;
  standingsShowMake: boolean;
  standingsShowIRating: boolean;
  standingsShowSafetyRating: boolean;
  standingsShowBestLap: boolean;
  standingsShowLastLap: boolean;
  standingsShowIncidents: boolean;
}

interface LauncherAPI {
  getConfig: () => Promise<OverlayConfig>;
  saveConfig: (cfg: OverlayConfig) => Promise<void>;
  startOverlay: () => Promise<void>;
  stopOverlay: () => Promise<void>;
  isOverlayRunning: () => Promise<boolean>;
  onOverlayStatus: (cb: (running: boolean) => void) => void;
  startRadar: () => Promise<void>;
  stopRadar: () => Promise<void>;
  isRadarRunning: () => Promise<boolean>;
  onRadarStatus: (cb: (running: boolean) => void) => void;
  startStandings: () => Promise<void>;
  stopStandings: () => Promise<void>;
  isStandingsRunning: () => Promise<boolean>;
  onStandingsStatus: (cb: (running: boolean) => void) => void;
  minimizeWindow: () => void;
  closeWindow: () => void;
  openAbout: () => void;
  resizeLauncher: (w: number, h: number) => void;
}

interface Window {
  launcherAPI: LauncherAPI;
}

(function () {

// ── DOM refs ─────────────────────────────────────────────────────────────────
const btnToggle   = document.getElementById('btn-toggle')!;
const statusDot   = document.getElementById('status-dot')!;
const statusText  = document.getElementById('status-text')!;

const setScale    = document.getElementById('set-scale') as HTMLInputElement;
const valScale    = document.getElementById('val-scale')!;
const setOpacity  = document.getElementById('set-opacity') as HTMLInputElement;
const valOpacity  = document.getElementById('val-opacity')!;
const setAOT      = document.getElementById('set-aot') as HTMLInputElement;
const setLocked   = document.getElementById('set-locked') as HTMLInputElement;
const setPoll     = document.getElementById('set-poll') as HTMLInputElement;

const thInputs = {
  coldRedMax:    document.getElementById('th-coldRedMax') as HTMLInputElement,
  coldYellowMax: document.getElementById('th-coldYellowMax') as HTMLInputElement,
  hotYellowMin:  document.getElementById('th-hotYellowMin') as HTMLInputElement,
  hotRedMin:     document.getElementById('th-hotRedMin') as HTMLInputElement,
};

const setRadarEnabled      = document.getElementById('set-radar-enabled-radar') as HTMLInputElement;
const setTiresEnabled      = document.getElementById('set-tires-enabled') as HTMLInputElement;
const setRadarRange        = document.getElementById('set-radar-range') as HTMLInputElement;
const valRadarRange        = document.getElementById('val-radar-range')!;
const setRadarScale        = document.getElementById('set-radar-scale') as HTMLInputElement;
const valRadarScale        = document.getElementById('val-radar-scale')!;
const setRadarOpacity      = document.getElementById('set-radar-opacity') as HTMLInputElement;
const valRadarOpacity      = document.getElementById('val-radar-opacity')!;
const setCarWidth          = document.getElementById('set-car-width') as HTMLInputElement;
const valCarWidth          = document.getElementById('val-car-width')!;
const setCarHeight         = document.getElementById('set-car-height') as HTMLInputElement;
const valCarHeight         = document.getElementById('val-car-height')!;

// Standings controls
const setStandingsEnabled  = document.getElementById('set-standings-enabled')  as HTMLInputElement;
const setStandingsOpacity  = document.getElementById('set-standings-opacity')  as HTMLInputElement;
const valStandingsOpacity  = document.getElementById('val-standings-opacity')!;
const setColFlags          = document.getElementById('set-col-flags')          as HTMLInputElement;
const setColCar            = document.getElementById('set-col-car')            as HTMLInputElement;
const setColMake           = document.getElementById('set-col-make')           as HTMLInputElement;
const setColIRating        = document.getElementById('set-col-irating')        as HTMLInputElement;
const setColSafety         = document.getElementById('set-col-safety')         as HTMLInputElement;
const setColBest           = document.getElementById('set-col-best')           as HTMLInputElement;
const setColLast           = document.getElementById('set-col-last')           as HTMLInputElement;
const setColIncidents      = document.getElementById('set-col-incidents')      as HTMLInputElement;

const btnSaveGeneral = document.getElementById('btn-save-general')!;
const btnSaveTires   = document.getElementById('btn-save-tires')!;
const btnSaveRadar   = document.getElementById('btn-save-radar')!;
const btnSaveStandings = document.getElementById('btn-save-standings')!;
const btnAbout       = document.getElementById('btn-about')!;
const saveStatus     = document.getElementById('save-status')!;

const btnMin   = document.getElementById('btn-minimize')!;
const btnClose = document.getElementById('btn-close')!;

// ── Sync both "Enable Radar" checkboxes ──────────────────────────────────────
setRadarEnabled.addEventListener('change', () => {
  // nothing to sync: Radar tab has its own checkbox, Tires tab has its own
});

// ── Tabs ─────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    const panelId = 'panel-' + (tab as HTMLElement).dataset.tab;
    document.getElementById(panelId)?.classList.add('active');
    const tabName = (tab as HTMLElement).dataset.tab;
    if (tabName === 'coach') {
      document.body.classList.add('coach-mode');
      window.launcherAPI.resizeLauncher(760, 820);
    } else {
      document.body.classList.remove('coach-mode');
      window.launcherAPI.resizeLauncher(420, 700);
    }
  });
});

// ── State ────────────────────────────────────────────────────────────────────
let overlayRunning = false;
let loadedConfig: OverlayConfig | null = null;

function updateToggleUI(running: boolean): void {
  overlayRunning = running;
  if (running) {
    btnToggle.textContent = 'STOP OVERLAY';
    btnToggle.className = 'btn-primary stop';
    statusDot.className = 'running';
    statusText.textContent = 'Overlay running';
  } else {
    btnToggle.textContent = 'START OVERLAY';
    btnToggle.className = 'btn-primary start';
    statusDot.className = 'stopped';
    statusText.textContent = 'Overlay stopped';
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────
(async () => {
  const config = await window.launcherAPI.getConfig();
  loadedConfig = config;
  applyConfigToUI(config);

  const running = await window.launcherAPI.isOverlayRunning();
  updateToggleUI(running);

  window.launcherAPI.onOverlayStatus((r) => updateToggleUI(r));

  window.launcherAPI.onStandingsStatus((_r) => {
    // standings window status feedback — reserved for future UI indicator
  });
})();

// ── Start / Stop ─────────────────────────────────────────────────────────────
btnToggle.addEventListener('click', async () => {
  if (overlayRunning) {
    await window.launcherAPI.stopOverlay();
  } else {
    await window.launcherAPI.startOverlay();
  }
});

// ── Save helper ──────────────────────────────────────────────────────────────
function collectConfig(): OverlayConfig {
  return {
    ...loadedConfig,
    widgetScale: parseFloat(setScale.value),
    opacity: parseFloat(setOpacity.value),
    alwaysOnTop: setAOT.checked,
    locked: setLocked.checked,
    pollIntervalMs: parseInt(setPoll.value, 10),
    thresholds: {
      coldRedMax:    parseInt(thInputs.coldRedMax.value, 10),
      coldYellowMax: parseInt(thInputs.coldYellowMax.value, 10),
      hotYellowMin:  parseInt(thInputs.hotYellowMin.value, 10),
      hotRedMin:     parseInt(thInputs.hotRedMin.value, 10),
    },
    radarEnabled: setRadarEnabled.checked,
    tiresEnabled: setTiresEnabled.checked,
    radarScale: parseFloat(setRadarScale.value),
    radarOpacity: parseFloat(setRadarOpacity.value),
    radarRange: parseInt(setRadarRange.value, 10),
    radarCarWidth: parseInt(setCarWidth.value, 10),
    radarCarHeight: parseInt(setCarHeight.value, 10),
    standingsEnabled: setStandingsEnabled.checked,
    standingsOpacity: parseFloat(setStandingsOpacity.value),
    standingsShowFlags:         setColFlags.checked,
    standingsShowCarNumber:     setColCar.checked,
    standingsShowMake:          setColMake.checked,
    standingsShowIRating:       setColIRating.checked,
    standingsShowSafetyRating:  setColSafety.checked,
    standingsShowBestLap:       setColBest.checked,
    standingsShowLastLap:       setColLast.checked,
    standingsShowIncidents:     setColIncidents.checked,
  } as OverlayConfig;
}

async function saveAndFlash(statusEl: HTMLElement): Promise<void> {
  const cfg = collectConfig();
  loadedConfig = cfg;
  await window.launcherAPI.saveConfig(cfg);
  statusEl.textContent = 'Saved!';
  statusEl.classList.add('show');
  setTimeout(() => statusEl.classList.remove('show'), 2000);
}

btnSaveGeneral.addEventListener('click', () => saveAndFlash(saveStatus));
btnSaveTires.addEventListener('click', () => saveAndFlash(document.getElementById('save-status-tires')!));
btnSaveRadar.addEventListener('click', () => saveAndFlash(document.getElementById('save-status-radar')!));
btnSaveStandings.addEventListener('click', () => saveAndFlash(document.getElementById('save-status-standings')!));

// ── About / FAQ ──────────────────────────────────────────────────────────────
btnAbout.addEventListener('click', () => {
  window.launcherAPI.openAbout();
});

// ── Window controls ──────────────────────────────────────────────────────────
btnMin.addEventListener('click', () => window.launcherAPI.minimizeWindow());
btnClose.addEventListener('click', () => window.launcherAPI.closeWindow());

// ── Live slider labels ───────────────────────────────────────────────────────
setScale.addEventListener('input', () => { valScale.textContent = setScale.value; });
setOpacity.addEventListener('input', () => { valOpacity.textContent = setOpacity.value; });
setRadarRange.addEventListener('input', () => { valRadarRange.textContent = setRadarRange.value; });
setRadarScale.addEventListener('input', () => { valRadarScale.textContent = setRadarScale.value; });
setRadarOpacity.addEventListener('input', () => { valRadarOpacity.textContent = setRadarOpacity.value; });
setCarWidth.addEventListener('input', () => { valCarWidth.textContent = setCarWidth.value; });
setCarHeight.addEventListener('input', () => { valCarHeight.textContent = setCarHeight.value; });
setStandingsOpacity.addEventListener('input', () => { valStandingsOpacity.textContent = setStandingsOpacity.value; });

// ── Apply config to UI ──────────────────────────────────────────────────────
function applyConfigToUI(cfg: OverlayConfig): void {
  setScale.value = String(cfg.widgetScale);
  valScale.textContent = String(cfg.widgetScale);
  setOpacity.value = String(cfg.opacity);
  valOpacity.textContent = String(cfg.opacity);
  setAOT.checked = cfg.alwaysOnTop;
  setLocked.checked = cfg.locked;
  setPoll.value = String(cfg.pollIntervalMs);

  thInputs.coldRedMax.value    = String(cfg.thresholds.coldRedMax);
  thInputs.coldYellowMax.value = String(cfg.thresholds.coldYellowMax);
  thInputs.hotYellowMin.value  = String(cfg.thresholds.hotYellowMin);
  thInputs.hotRedMin.value     = String(cfg.thresholds.hotRedMin);

  setTiresEnabled.checked      = cfg.tiresEnabled ?? true;
  setRadarEnabled.checked      = cfg.radarEnabled;
  setRadarRange.value          = String(cfg.radarRange);
  valRadarRange.textContent    = String(cfg.radarRange);
  setRadarScale.value          = String(cfg.radarScale);
  valRadarScale.textContent    = String(cfg.radarScale);
  setRadarOpacity.value        = String(cfg.radarOpacity);
  valRadarOpacity.textContent  = String(cfg.radarOpacity);
  setCarWidth.value            = String(cfg.radarCarWidth);
  valCarWidth.textContent      = String(cfg.radarCarWidth);
  setCarHeight.value           = String(cfg.radarCarHeight);
  valCarHeight.textContent     = String(cfg.radarCarHeight);

  setStandingsEnabled.checked      = cfg.standingsEnabled ?? false;
  setStandingsOpacity.value        = String(cfg.standingsOpacity ?? 0.9);
  valStandingsOpacity.textContent  = String(cfg.standingsOpacity ?? 0.9);
  setColFlags.checked              = cfg.standingsShowFlags ?? true;
  setColCar.checked                = cfg.standingsShowCarNumber ?? true;
  setColMake.checked               = cfg.standingsShowMake ?? false;
  setColIRating.checked            = cfg.standingsShowIRating ?? false;
  setColSafety.checked             = cfg.standingsShowSafetyRating ?? false;
  setColBest.checked               = cfg.standingsShowBestLap ?? true;
  setColLast.checked               = cfg.standingsShowLastLap ?? true;
  setColIncidents.checked          = cfg.standingsShowIncidents ?? true;
}

})();
