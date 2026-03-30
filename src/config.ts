/**
 * Configuration for the iRacing Tire Overlay.
 *
 * ─── HOW TO TUNE THRESHOLDS ───
 * Each tire position (LF, RF, LR, RR) uses the same global thresholds by default.
 * To set per-car thresholds, create a new config object and pass it to
 * `mapTemperatureToStatus()` in colorUtils.ts.
 *
 * Temperature values are in Celsius (iRacing SDK default).
 * Adjust the ranges below to match the tire compound / car you're driving.
 */

export interface TireThresholds {
  /** Below this → too cold (red) */
  coldRedMax: number;
  /** coldRedMax..coldYellowMax → caution cold (yellow) */
  coldYellowMax: number;
  /** coldYellowMax..hotYellowMin → ideal (green) */
  hotYellowMin: number;
  /** hotYellowMin..hotRedMin → caution hot (yellow) */
  hotRedMin: number;
  /** Above hotRedMin → overheating (red) */
}

export interface OverlayConfig {
  /** Scale multiplier for the widget (1 = 100%) */
  widgetScale: number;
  /** Window opacity 0.0–1.0 */
  opacity: number;
  /** Keep overlay above all windows */
  alwaysOnTop: boolean;
  /** When true, overlay is click-through and not draggable */
  locked: boolean;
  /** Telemetry poll interval in milliseconds */
  pollIntervalMs: number;
  /** Temperature thresholds (Celsius) — change these per car */
  thresholds: TireThresholds;

  // ─── Radar ────────────────────────────────────────────────────────────────
  /** Show the proximity radar overlay */
  radarEnabled: boolean;
  /** Scale multiplier for the radar window (1 = 100%) */
  radarScale: number;
  /** Radar window opacity 0.0–1.0 */
  radarOpacity: number;
  /** How far ahead/behind to show cars (metres) */
  radarRange: number;
  /** Width of each car rectangle on the radar (pixels) */
  radarCarWidth: number;
  /** Height of each car rectangle on the radar (pixels) */
  radarCarHeight: number;

  // ─── Window positions (persisted) ───────────────────────────────────────
  /** Saved overlay window position [x, y] */
  overlayPosition?: [number, number];
  /** Saved radar window position [x, y] */
  radarPosition?: [number, number];
}

// ─── DEFAULT CONFIG ───────────────────────────────────────────────────────────
// Tweak the numbers below to suit different cars / tire compounds.
export const defaultConfig: OverlayConfig = {
  widgetScale: 1.0,
  opacity: 0.9,
  alwaysOnTop: true,
  locked: false,
  pollIntervalMs: 200, // 5 updates/sec

  thresholds: {
    coldRedMax: 50,      // below 50 °C → red (too cold)
    coldYellowMax: 70,   // 50–70 °C   → yellow (warming up)
    hotYellowMin: 110,   // 70–110 °C  → green (ideal)
    hotRedMin: 130,      // 110–130 °C → yellow (getting hot)
                         // above 130 °C → red (overheating)
  },

  // ─── Radar defaults ─────────────────────────────────────────────────────
  radarEnabled: true,
  radarScale: 1.0,
  radarOpacity: 0.9,
  radarRange: 40,        // show cars within ±40 metres
  radarCarWidth: 12,
  radarCarHeight: 28,
};
