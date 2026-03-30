import { TireThresholds } from './config';

export type TireStatus = 'cold' | 'caution' | 'ideal' | 'hot';

export function mapTemperatureToStatus(
  tempC: number,
  thresholds: TireThresholds
): TireStatus {
  if (tempC < thresholds.coldRedMax) return 'cold';
  if (tempC < thresholds.coldYellowMax) return 'caution';
  if (tempC <= thresholds.hotYellowMin) return 'ideal';
  if (tempC <= thresholds.hotRedMin) return 'caution';
  return 'hot';
}

/** CSS color string for a given status. */
export function statusToColor(status: TireStatus): string {
  switch (status) {
    case 'cold':    return '#16231f';
    case 'caution': return '#433b24';
    case 'ideal':   return '#213c30';
    case 'hot':     return '#412126';
  }
}

/**
 * Smooth continuous color from temperature — ApexSense palette.
 *
 * Gradient stops (mapped to thresholds):
 *   below coldRedMax       → very cold   #16231f
 *   coldRedMax→coldYellow   → warming     #16231f → #213c30
 *   coldYellowMax→hotYellow → ideal       #213c30
 *   hotYellowMin→hotRedMin  → hot         #213c30 → #433b24
 *   above hotRedMin         → overheat    #433b24 → #412126
 */
export function temperatureToColor(tempC: number, t: TireThresholds): string {
  if (tempC <= t.coldRedMax) {
    return '#16231f';
  }
  if (tempC < t.coldYellowMax) {
    const pct = (tempC - t.coldRedMax) / (t.coldYellowMax - t.coldRedMax);
    return lerpColor(0x16, 0x23, 0x1f,   0x21, 0x3c, 0x30,  pct);
  }
  if (tempC <= t.hotYellowMin) {
    return '#213c30';
  }
  if (tempC <= t.hotRedMin) {
    const pct = (tempC - t.hotYellowMin) / (t.hotRedMin - t.hotYellowMin);
    return lerpColor(0x21, 0x3c, 0x30,   0x43, 0x3b, 0x24,  pct);
  }
  const overRange = (t.hotRedMin - t.hotYellowMin) || 20;
  const pct = Math.min(1, (tempC - t.hotRedMin) / overRange);
  return lerpColor(0x43, 0x3b, 0x24,   0x41, 0x21, 0x26,  pct);
}

function lerpColor(
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number,
  t: number,
): string {
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function hex(n: number): string {
  return n.toString(16).padStart(2, '0');
}
