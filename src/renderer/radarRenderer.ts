/**
 * Radar renderer — draws a top-down proximity radar on an HTML5 Canvas.
 * Player car is fixed at the vertical centre; nearby cars are drawn as
 * coloured rectangles positioned by longitudinal gap and lateral hints.
 */

// ── Types (mirrored from main, no import in renderer context) ────────────────
interface NearbyCarInfo {
  carIdx: number;
  relativeDistM: number;
  /** -1 = on player's left, 0 = ahead/behind, 1 = on player's right */
  lateralOffset: number;
}

interface RadarSnapshot {
  connected: boolean;
  playerSpeed: number;
  carLeftRight: number;
  nearbyCars: NearbyCarInfo[];
  trackLengthM: number;
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

interface RadarAPI {
  onRadarUpdate: (cb: (snapshot: RadarSnapshot) => void) => void;
  onConfigUpdate: (cb: (config: OverlayConfig) => void) => void;
  getConfig: () => Promise<OverlayConfig>;
  setConfig: (partial: Partial<OverlayConfig>) => Promise<OverlayConfig>;
}

interface Window {
  radarAPI: RadarAPI;
}

// ── iRacing CarLeftRight enum values ─────────────────────────────────────────
const CLR_OFF          = 0;
const CLR_CLEAR        = 1;
const CLR_LEFT         = 2;
const CLR_RIGHT        = 3;
const CLR_LEFT_RIGHT   = 4;
const CLR_2_CARS_LEFT  = 5;
const CLR_2_CARS_RIGHT = 6;

(function () {

// ── Constants ────────────────────────────────────────────────────────────────
const CANVAS_W = 180;
const CANVAS_H = 380;
const PLAYER_Y = CANVAS_H / 2;   // player pinned at vertical centre
const LANE_GAP = 50;              // pixels between lane centres (half the canvas width)

// Mutable car dimensions — updated from config
let CAR_W = 20;
let CAR_H = 48;

// ── DOM ──────────────────────────────────────────────────────────────────────
const canvas           = document.getElementById('radar-canvas') as HTMLCanvasElement;
const radarContainer   = document.getElementById('radar-container')!;
const statusMessage    = document.getElementById('status-message')!;
const dragBar          = document.getElementById('drag-bar')!;
const ctx              = canvas.getContext('2d')!;

canvas.width  = CANVAS_W;
canvas.height = CANVAS_H;

let config: OverlayConfig;
let latestSnapshot: RadarSnapshot | null = null;

// ── Interpolation state (smooth animation) ───────────────────────────────────
interface SmoothedCar {
  carIdx: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  opacity: number;
}

const smoothedCars = new Map<number, SmoothedCar>();
const LERP_FACTOR = 0.12; // 0–1, lower = smoother

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ── Colour helpers ───────────────────────────────────────────────────────────
function proximityColor(absDistM: number): string {
  if (absDistM < 5) return '#e74c3c';       // red — danger
  if (absDistM < 15) return '#f1c40f';      // yellow — caution
  return '#2ecc71';                          // green — safe
}

function proximityAlpha(absDistM: number, range: number): number {
  // Fade out cars near the edge of the radar range
  const edgeFade = range * 0.15;
  if (absDistM > range - edgeFade) {
    return Math.max(0.2, 1 - (absDistM - (range - edgeFade)) / edgeFade);
  }
  return 1;
}

// ── Lateral offset logic ─────────────────────────────────────────────────────

/**
 * Convert a car's pre-assigned lateralOffset (-1/0/1) to canvas pixels.
 * Full offset when the car is truly alongside (<5 m longitudinal gap),
 * smoothly fading back to centre as the gap grows beyond 5 m.
 */
function lateralOffsetPx(car: NearbyCarInfo): number {
  if (car.lateralOffset === 0) return 0;
  const absDist = Math.abs(car.relativeDistM);
  const strength = absDist < 5 ? 1 : absDist < 30 ? 1 - (absDist - 5) / 25 : 0;
  return car.lateralOffset * LANE_GAP * strength;
}

// ── Draw helpers ─────────────────────────────────────────────────────────────
function drawCar(x: number, y: number, w: number, h: number, color: string, alpha: number, isPlayer: boolean): void {
  ctx.save();
  ctx.globalAlpha = alpha;

  const radius = 4;

  if (isPlayer) {
    // Player car — filled white with an outline
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#aaaaaa';
    ctx.lineWidth = 2;
    roundRect(x, y, w, h, radius);
    ctx.fill();
    ctx.stroke();
  } else {
    // Other cars — filled with proximity colour
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    roundRect(x, y, w, h, radius);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

function roundRect(x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function drawSideIndicator(side: 'left' | 'right', color: string): void {
  ctx.save();
  const barW = 6;
  const barH = CAR_H + 20;
  const x = side === 'left' ? 2 : CANVAS_W - barW - 2;
  const y = PLAYER_Y - barH / 2;

  ctx.globalAlpha = 0.7;
  ctx.fillStyle = color;
  roundRect(x, y, barW, barH, 3);
  ctx.fill();
  ctx.restore();
}

function drawRangeLines(range: number): void {
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;

  // Draw subtle horizontal lines at quarter-range intervals
  const pxPerM = (CANVAS_H / 2 - 20) / range;
  for (let d = 10; d <= range; d += 10) {
    const yUp   = PLAYER_Y - d * pxPerM;
    const yDown = PLAYER_Y + d * pxPerM;
    ctx.beginPath();
    ctx.moveTo(20, yUp);
    ctx.lineTo(CANVAS_W - 20, yUp);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(20, yDown);
    ctx.lineTo(CANVAS_W - 20, yDown);
    ctx.stroke();
  }

  ctx.restore();
}

// ── Main render ──────────────────────────────────────────────────────────────
function render(): void {
  requestAnimationFrame(render); // keep loop alive unconditionally

  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  if (!latestSnapshot || !latestSnapshot.connected) return;

  const range = config.radarRange;
  const pxPerM = (CANVAS_H / 2 - 20) / range; // pixels per metre

  // Range lines
  drawRangeLines(range);

  // Centre line (very subtle)
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(CANVAS_W / 2, 10);
  ctx.lineTo(CANVAS_W / 2, CANVAS_H - 10);
  ctx.stroke();
  ctx.restore();

  // ── Update smoothed positions for nearby cars ──────────────────────────
  const activeCars = new Set<number>();

  for (const car of latestSnapshot.nearbyCars) {
    activeCars.add(car.carIdx);

    const absDist = Math.abs(car.relativeDistM);
    const lateralOff = lateralOffsetPx(car);

    const targetX = CANVAS_W / 2 - CAR_W / 2 + lateralOff;
    // Positive relativeDistM = ahead = up on screen
    const targetY = PLAYER_Y - car.relativeDistM * pxPerM - CAR_H / 2;
    const alpha = proximityAlpha(absDist, range);

    let sc = smoothedCars.get(car.carIdx);
    if (!sc) {
      sc = { carIdx: car.carIdx, x: targetX, y: targetY, targetX, targetY, opacity: alpha };
      smoothedCars.set(car.carIdx, sc);
    } else {
      sc.targetX = targetX;
      sc.targetY = targetY;
      sc.opacity = alpha;
    }
  }

  // Remove cars that left the radar
  for (const [idx] of smoothedCars) {
    if (!activeCars.has(idx)) smoothedCars.delete(idx);
  }

  // Interpolate and draw
  for (const sc of smoothedCars.values()) {
    sc.x = lerp(sc.x, sc.targetX, LERP_FACTOR);
    sc.y = lerp(sc.y, sc.targetY, LERP_FACTOR);

    const distM = Math.abs(latestSnapshot.nearbyCars.find(c => c.carIdx === sc.carIdx)?.relativeDistM ?? 999);
    const color = proximityColor(distM);
    drawCar(sc.x, sc.y, CAR_W, CAR_H, color, sc.opacity, false);
  }

  // ── Player car (always centred) ────────────────────────────────────────
  drawCar(CANVAS_W / 2 - CAR_W / 2, PLAYER_Y - CAR_H / 2, CAR_W, CAR_H, '#fff', 1, true);

  // ── Side danger indicators ─────────────────────────────────────────────
  const clr = latestSnapshot.carLeftRight;
  if (clr === CLR_LEFT || clr === CLR_LEFT_RIGHT || clr === CLR_2_CARS_LEFT) {
    drawSideIndicator('left', '#e74c3c');
  }
  if (clr === CLR_RIGHT || clr === CLR_LEFT_RIGHT || clr === CLR_2_CARS_RIGHT) {
    drawSideIndicator('right', '#e74c3c');
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────
(async () => {
  config = await window.radarAPI.getConfig();
  CAR_W = config.radarCarWidth  ?? 20;
  CAR_H = config.radarCarHeight ?? 48;
  applyLockUI(config.locked);

  window.radarAPI.onConfigUpdate((updatedConfig: OverlayConfig) => {
    config = updatedConfig;
    CAR_W = config.radarCarWidth  ?? CAR_W;
    CAR_H = config.radarCarHeight ?? CAR_H;
    applyLockUI(config.locked);
    applyScale(config.radarScale);
  });

  window.radarAPI.onRadarUpdate((snapshot: RadarSnapshot) => {
    if (!snapshot.connected) {
      radarContainer.classList.add('hidden');
      statusMessage.classList.remove('hidden');
      statusMessage.textContent = 'Waiting for iRacing telemetry…';
      latestSnapshot = null;
      return;
    }

    // Hide the entire radar when no cars are nearby
    if (snapshot.nearbyCars.length === 0) {
      radarContainer.classList.add('hidden');
      statusMessage.classList.add('hidden');
      latestSnapshot = snapshot;
      return;
    }

    statusMessage.classList.add('hidden');
    radarContainer.classList.remove('hidden');
    latestSnapshot = snapshot;
  });

  // Start render loop
  requestAnimationFrame(render);
})();

function applyLockUI(locked: boolean): void {
  (dragBar.style as any).webkitAppRegion = locked ? 'no-drag' : 'drag';
  if (locked) {
    document.body.classList.remove('move-mode');
  } else {
    document.body.classList.add('move-mode');
  }
}

function applyScale(scale: number): void {
  (document.body.style as any).zoom = String(scale);
}

})();
