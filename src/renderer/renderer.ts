/**
 * Renderer process — updates the ApexSense tire widget UI with live telemetry data.
 * Runs in the browser context; communicates with main via overlayAPI (preload).
 */

interface TireData {
  label: string;
  tempC: number;
  tempOutside: number;
  tempMiddle: number;
  tempInside: number;
  wear: number;
  pressureKpa: number;
  isEstimated: boolean;
}

interface TelemetrySnapshot {
  connected: boolean;
  tires: TireData[];
}

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
  radarScale: number;
  radarOpacity: number;
  radarRange: number;
  radarCarWidth: number;
  radarCarHeight: number;
}

// ── Bridge from preload ──────────────────────────────────────────────────────
interface OverlayAPI {
  onTelemetryUpdate: (cb: (snapshot: TelemetrySnapshot) => void) => void;
  onConfigUpdate: (cb: (config: OverlayConfig) => void) => void;
  getConfig: () => Promise<OverlayConfig>;
  setConfig: (partial: Partial<OverlayConfig>) => Promise<OverlayConfig>;
}

interface Window {
  overlayAPI: OverlayAPI;
}

(function () {

// ── ApexSense color palette ──────────────────────────────────────────────────
// Tire zone background colors mapped to temperature thresholds:
//   #16231f (very cold) → #213c30 (warming/ideal) → #433b24 (hot) → #412126 (overheat)
function temperatureToZoneColor(tempC: number, t: TireThresholds): string {
  if (tempC <= t.coldRedMax) return '#16231f';
  if (tempC < t.coldYellowMax) {
    const pct = (tempC - t.coldRedMax) / (t.coldYellowMax - t.coldRedMax);
    return lerpColor(0x16,0x23,0x1f, 0x21,0x3c,0x30, pct);
  }
  if (tempC <= t.hotYellowMin) return '#213c30';
  if (tempC <= t.hotRedMin) {
    const pct = (tempC - t.hotYellowMin) / (t.hotRedMin - t.hotYellowMin);
    return lerpColor(0x21,0x3c,0x30, 0x43,0x3b,0x24, pct);
  }
  const overRange = (t.hotRedMin - t.hotYellowMin) || 20;
  const pct = Math.min(1, (tempC - t.hotRedMin) / overRange);
  return lerpColor(0x43,0x3b,0x24, 0x41,0x21,0x26, pct);
}

function lerpColor(r1:number,g1:number,b1:number, r2:number,g2:number,b2:number, t:number): string {
  const r = Math.round(r1+(r2-r1)*t), g = Math.round(g1+(g2-g1)*t), b = Math.round(b1+(b2-b1)*t);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

// ── DOM references ───────────────────────────────────────────────────────────
const tireContainer   = document.getElementById('tire-container')!;
const statusMessage   = document.getElementById('status-message')!;
const dragBar         = document.getElementById('drag-bar')!;
const estimateBanner  = document.getElementById('estimate-banner')!;

let config: OverlayConfig;

// ── Init ─────────────────────────────────────────────────────────────────────
(async () => {
  config = await window.overlayAPI.getConfig();
  applyLockUI(config.locked);

  window.overlayAPI.onConfigUpdate((updatedConfig: OverlayConfig) => {
    config = updatedConfig;
    applyLockUI(config.locked);
    applyScale(config.widgetScale);
  });

  window.overlayAPI.onTelemetryUpdate((snapshot: TelemetrySnapshot) => {
    if (!snapshot.connected || snapshot.tires.length === 0) {
      tireContainer.classList.add('hidden');
      statusMessage.classList.remove('hidden');
      statusMessage.textContent = 'Waiting for iRacing telemetry…';
      return;
    }

    statusMessage.classList.add('hidden');
    tireContainer.classList.remove('hidden');

    const anyEstimated = snapshot.tires.some((t: TireData) => t.isEstimated);
    if (anyEstimated) {
      estimateBanner.classList.remove('hidden');
      tireContainer.classList.add('no-bottom-radius');
    } else {
      estimateBanner.classList.add('hidden');
      tireContainer.classList.remove('no-bottom-radius');
    }

    for (const tire of snapshot.tires) {
      updateTireBlock(tire);
    }
  });
})();

// ── Update a single tire block ───────────────────────────────────────────────
function updateTireBlock(tire: TireData): void {
  const el = document.getElementById(`tire-${tire.label}`);
  if (!el) return;

  const zoneCells = el.querySelectorAll('.zone-cell');
  const pressureEl = el.querySelector('.tire-pressure') as HTMLElement;
  const temps = [tire.tempOutside, tire.tempMiddle, tire.tempInside];

  zoneCells.forEach((cell, i) => {
    const tempEl = cell.querySelector('.zone-temp') as HTMLElement;
    const wearEl = cell.querySelector('.zone-wear') as HTMLElement;
    const temp = temps[i] ?? 0;
    const color = temperatureToZoneColor(temp, config.thresholds);

    tempEl.textContent = `${temp}°`;
    wearEl.textContent = `${tire.wear}%`;
    (cell as HTMLElement).style.background = color;
  });

  pressureEl.textContent = tire.pressureKpa ? `${tire.pressureKpa} kPa` : '-- kPa';
}

// ── Lock UI ──────────────────────────────────────────────────────────────────
function applyLockUI(locked: boolean): void {
  (dragBar.style as any).webkitAppRegion = locked ? 'no-drag' : 'drag';
  if (locked) {
    document.body.classList.remove('move-mode');
  } else {
    document.body.classList.add('move-mode');
  }
}

// ── Scale ────────────────────────────────────────────────────────────────────
function applyScale(scale: number): void {
  (document.body.style as any).zoom = String(scale);
}

})();
