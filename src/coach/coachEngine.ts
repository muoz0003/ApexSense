/**
 * Coach Analysis Engine
 *
 * Analyses a buffer of telemetry frames to find signals that correlate with
 * the user-reported problem, then returns ranked setup recommendations.
 */

import {
  ProblemId,
  CarCategory,
  SetupAdjustment,
  ProblemRule,
  detectCarCategory,
  getRulesForProblem,
  getAdjustmentsForCategory,
} from './setupRules';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TelemetryFrame {
  throttle: number;
  brake: number;
  steeringAngle: number;  // radians
  speed: number;          // m/s
  latAccel: number;       // m/s²
  longAccel: number;      // m/s²
  gear: number;
  rpm: number;
  lapDistPct: number;
  onPitRoad: boolean;
  tireTempAvgFront: number; // average of LF + RF
  tireTempAvgRear: number;  // average of LR + RR
  tireTempAvgLF: number;
  tireTempAvgRF: number;
  tireTempAvgLR: number;
  tireTempAvgRR: number;
}

export interface TelemetryInsight {
  signal: string;
  value: string;
  confirms: boolean; // true = supports the reported problem
}

export interface CoachRecommendation extends SetupAdjustment {
  rank: number;
  boosted: boolean; // true if telemetry evidence boosted this recommendation
}

export interface CoachAnalysis {
  problem: ProblemId;
  problemLabel: string;
  carCategory: CarCategory;
  carName: string;
  trackName: string;
  insights: TelemetryInsight[];
  recommendations: CoachRecommendation[];
  framesAnalyzed: number;
  timestamp: number;
  confidence: 'low' | 'medium' | 'high';
  /** Set when the problem was auto-detected from telemetry */
  detectedProblem?: string;
  /** Driver goal labels selected at analysis time */
  goalLabels?: string[];
  /** Session mode used during analysis */
  sessionMode?: 'race' | 'qualify';
  /** Session length info (e.g. "30 laps" or "45 mins") */
  sessionLength?: string;
}

export interface WeatherContext {
  airTempC: number;
  trackTempC: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEG = Math.PI / 180;

// Thresholds for telemetry signal detection
const STEER_HIGH_DEG = 25;        // °: significant steering input
const STEER_CORRECTION_DEG = 10;  // °: mid-corner correction steer
const BRAKE_HIGH = 0.6;
const THROTTLE_HIGH = 0.7;
const LAT_ACCEL_HIGH = 8;         // m/s²: loaded corner
const LONG_ACCEL_LOW = 2;         // m/s²: poor acceleration under full throttle
const TEMP_DIFF_SIGNIFICANT = 12; // °C: front vs rear imbalance
const SPEED_STRAIGHT = 30;        // m/s: car likely on a straight

// ─── Frame filter helpers ─────────────────────────────────────────────────────

function onTrack(f: TelemetryFrame): boolean {
  return !f.onPitRoad && f.speed > 5;
}

function isCornerEntry(f: TelemetryFrame): boolean {
  return f.brake > BRAKE_HIGH && Math.abs(f.steeringAngle) > STEER_HIGH_DEG * DEG;
}

function isCornerMid(f: TelemetryFrame): boolean {
  return f.brake < 0.2 && f.throttle < 0.3 && Math.abs(f.latAccel) > LAT_ACCEL_HIGH * 0.6;
}

function isCornerExit(f: TelemetryFrame): boolean {
  return f.throttle > THROTTLE_HIGH && Math.abs(f.latAccel) > LAT_ACCEL_HIGH * 0.5;
}

function isStraight(f: TelemetryFrame): boolean {
  return f.speed > SPEED_STRAIGHT && Math.abs(f.steeringAngle) < 5 * DEG && f.throttle > THROTTLE_HIGH;
}

// ─── Metric extractors ────────────────────────────────────────────────────────

function avgTempDiff(frames: TelemetryFrame[]): number {
  if (frames.length === 0) return 0;
  const diffs = frames.map(f => f.tireTempAvgFront - f.tireTempAvgRear);
  return diffs.reduce((a, b) => a + b, 0) / diffs.length;
}

function pctFramesWithHighSteering(frames: TelemetryFrame[]): number {
  if (frames.length === 0) return 0;
  const high = frames.filter(f => Math.abs(f.steeringAngle) > STEER_HIGH_DEG * DEG).length;
  return high / frames.length;
}

function avgLatAccelAtExit(frames: TelemetryFrame[]): number {
  const exitFrames = frames.filter(isCornerExit);
  if (exitFrames.length === 0) return 0;
  return exitFrames.reduce((a, f) => a + Math.abs(f.latAccel), 0) / exitFrames.length;
}

function avgThrottleAccelOnStraight(frames: TelemetryFrame[]): number {
  const strFrames = frames.filter(isStraight);
  if (strFrames.length === 0) return 0;
  return strFrames.reduce((a, f) => a + f.longAccel, 0) / strFrames.length;
}

function midCornerSteeringVariance(frames: TelemetryFrame[]): number {
  const mid = frames.filter(isCornerMid);
  if (mid.length < 3) return 0;
  const angles = mid.map(f => f.steeringAngle);
  const mean = angles.reduce((a, b) => a + b, 0) / angles.length;
  return Math.sqrt(angles.reduce((a, v) => a + (v - mean) ** 2, 0) / angles.length) / DEG;
}

// ─── Insight generators ───────────────────────────────────────────────────────

function buildInsights(
  problem: ProblemId,
  frames: TelemetryFrame[],
): TelemetryInsight[] {
  if (frames.length === 0) return [];

  const trackFrames = frames.filter(onTrack);
  const insights: TelemetryInsight[] = [];

  // ── Tyre temperature balance ─────────────────────────────────────────────
  const tempDiff = avgTempDiff(frames);
  if (Math.abs(tempDiff) > TEMP_DIFF_SIGNIFICANT) {
    const frontHotter = tempDiff > 0;
    insights.push({
      signal: 'Tyre temperature balance',
      value: `Front avg ${tempDiff > 0 ? '+' : ''}${tempDiff.toFixed(0)}°C vs rear`,
      confirms:
        (frontHotter && (problem === 'understeer_entry' || problem === 'understeer_mid' || problem === 'general_understeer' || problem === 'braking_instability')) ||
        (!frontHotter && (problem === 'oversteer_exit' || problem === 'oversteer_mid' || problem === 'general_oversteer' || problem === 'poor_traction')),
    });
  }

  // ── High steering input at entry ──────────────────────────────────────────
  const entryFrames = trackFrames.filter(isCornerEntry);
  if (entryFrames.length > 3) {
    const pctHigh = pctFramesWithHighSteering(entryFrames);
    if (pctHigh > 0.5) {
      insights.push({
        signal: 'Steering angle at corner entry',
        value: `${(pctHigh * 100).toFixed(0)}% of entry frames show high steering lock (>${STEER_HIGH_DEG}°)`,
        confirms: problem === 'understeer_entry' || problem === 'general_understeer',
      });
    }
  }

  // ── High steer + high throttle at exit (suggests snap) ───────────────────
  const exitHighSteering = frames.filter(
    f => isCornerExit(f) && Math.abs(f.steeringAngle) > STEER_HIGH_DEG * DEG,
  );
  if (exitHighSteering.length > 0) {
    insights.push({
      signal: 'Steering during throttle application',
      value: `Significant steering lock detected while at ${(THROTTLE_HIGH * 100).toFixed(0)}%+ throttle`,
      confirms: problem === 'oversteer_exit' || problem === 'poor_traction',
    });
  }

  // ── Traction loss signal (throttle high, accel low) ───────────────────────
  const avgAccelExit = avgThrottleAccelOnStraight(trackFrames);
  if (avgAccelExit < LONG_ACCEL_LOW && trackFrames.some(isStraight)) {
    insights.push({
      signal: 'Acceleration efficiency',
      value: `Avg longitudinal accel on full throttle: ${avgAccelExit.toFixed(1)} m/s² (low — possible wheelspin or drag)`,
      confirms: problem === 'poor_traction' || problem === 'bad_topspeed',
    });
  }

  // ── Mid-corner steering variance (corrections) ────────────────────────────
  const steerVariance = midCornerSteeringVariance(frames);
  if (steerVariance > 4) {
    insights.push({
      signal: 'Mid-corner steering corrections',
      value: `High steering variance mid-corner (${steerVariance.toFixed(1)}° RMS) — suggests rear instability`,
      confirms: problem === 'oversteer_mid' || problem === 'general_oversteer',
    });
  }

  // ── High lateral accel without matching speed ──────────────────────────────
  const avgLatExit = avgLatAccelAtExit(trackFrames);
  if (avgLatExit > LAT_ACCEL_HIGH) {
    insights.push({
      signal: 'Lateral loading on exit',
      value: `High lateral accel (${avgLatExit.toFixed(1)} m/s²) under throttle — rear under load`,
      confirms: problem === 'oversteer_exit' || problem === 'poor_traction',
    });
  }

  return insights;
}

// ─── Ranking ──────────────────────────────────────────────────────────────────

const IMPACT_SCORE: Record<string, number> = { high: 3, medium: 2, low: 1 };

function rankAdjustments(
  adjustments: SetupAdjustment[],
  insights: TelemetryInsight[],
  preferences: Record<string, number>,
  carCategory: CarCategory,
  goalBoosts: Array<[string, number]> = [],
): CoachRecommendation[] {
  // Pre-compute goal boost for a component using substring matching
  function goalScore(component: string): number {
    const cl = component.toLowerCase();
    return goalBoosts.reduce((sum, [key, pts]) => cl.includes(key.toLowerCase()) ? sum + pts : sum, 0);
  }

  return adjustments
    .map((adj, idx): CoachRecommendation => {
      let score = IMPACT_SCORE[adj.impact] * 10;
      const anyConfirmed = insights.some(i => i.confirms);
      const boosted = anyConfirmed && adj.impact === 'high';
      if (boosted) score += 5;
      score += (preferences[adj.component] ?? 0);
      score += goalScore(adj.component);
      // Resolve category-specific direction override
      const direction = (adj.categoryDirections?.[carCategory]) ?? adj.direction;
      return { ...adj, direction, rank: idx, boosted };
    })
    .sort((a, b) => {
      const aScore = IMPACT_SCORE[a.impact] * 10 + (a.boosted ? 5 : 0) + (preferences[a.component] ?? 0) + goalScore(a.component);
      const bScore = IMPACT_SCORE[b.impact] * 10 + (b.boosted ? 5 : 0) + (preferences[b.component] ?? 0) + goalScore(b.component);
      return bScore - aScore;
    })
    .map((adj, newIdx) => ({ ...adj, rank: newIdx + 1 }));
}

// ─── Main analyze function ────────────────────────────────────────────────────

/** Score each known problem against the telemetry and return the best match. */
export function autoDetectProblem(
  frames: TelemetryFrame[],
): { problem: ProblemId; label: string } {
  const ALL_PROBLEMS: ProblemId[] = [
    'understeer_entry', 'understeer_mid', 'oversteer_exit', 'oversteer_mid',
    'poor_traction', 'braking_instability', 'bad_topspeed',
    'general_understeer', 'general_oversteer',
  ];
  let bestProblem: ProblemId = 'general_understeer';
  let bestScore = -1;
  for (const problem of ALL_PROBLEMS) {
    const ins = buildInsights(problem, frames);
    const score = ins.filter(i => i.confirms).length * 10 + ins.length;
    if (score > bestScore) { bestScore = score; bestProblem = problem; }
  }
  const rule = getRulesForProblem(bestProblem);
  return { problem: bestProblem, label: rule?.label ?? bestProblem };
}

export function analyzeSession(
  frames: TelemetryFrame[],
  problem: ProblemId,
  carPath: string,
  carName: string,
  trackName: string,
  trackConfig: string,
  preferences: Record<string, number> = {},
  weather?: WeatherContext,
  detectedProblem?: string,
  goalBoosts: Array<[string, number]> = [],
  goalLabels: string[] = [],
  sessionMode?: 'race' | 'qualify',
  sessionLength?: string,
): CoachAnalysis {
  const carCategory = detectCarCategory(carPath, carName);
  const rule: ProblemRule | undefined = getRulesForProblem(problem);

  const insights = buildInsights(problem, frames);

  // Weather insight
  if (weather) {
    const { airTempC, trackTempC } = weather;
    const delta = trackTempC - airTempC;
    let msg: string;
    if (airTempC > 35 || trackTempC > 50) {
      msg = `Hot conditions (air ${airTempC.toFixed(0)}°C, track ${trackTempC.toFixed(0)}°C) — tyres may overheat; consider lower starting pressures.`;
    } else if (airTempC < 15 || trackTempC < 22) {
      msg = `Cold conditions (air ${airTempC.toFixed(0)}°C, track ${trackTempC.toFixed(0)}°C) — tyres slow to warm up; consider higher starting pressures.`;
    } else {
      msg = `Conditions: air ${airTempC.toFixed(0)}°C, track ${trackTempC.toFixed(0)}°C (+${delta.toFixed(0)}°C above air).`;
    }
    insights.push({ signal: 'Track conditions', value: msg, confirms: false });
  }

  // Confidence based on how much data we have and how many telemetry signals fired.
  // Any detected insight counts — the user self-reported the problem, we just need
  // enough laps of data to back the recommendations.
  const insightCount = insights.length;
  let confidence: 'low' | 'medium' | 'high' = 'low';
  if (frames.length >= 60 && insightCount >= 2) confidence = 'high';
  else if (frames.length >= 20 && insightCount >= 1) confidence = 'medium';

  const rawAdjustments = rule
    ? getAdjustmentsForCategory(rule.adjustments, carCategory)
    : [];

  const recommendations = rankAdjustments(rawAdjustments, insights, preferences, carCategory, goalBoosts);

  const trackFull = trackConfig ? `${trackName} — ${trackConfig}` : trackName;

  return {
    problem,
    problemLabel: rule?.label ?? problem,
    carCategory,
    carName: carName || 'Unknown Car',
    trackName: trackFull || 'Unknown Track',
    insights,
    recommendations,
    framesAnalyzed: frames.length,
    timestamp: Date.now(),
    confidence,
    detectedProblem,
    goalLabels: goalLabels.length > 0 ? goalLabels : undefined,
    sessionMode,
    sessionLength,
  };
}
