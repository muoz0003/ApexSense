/**
 * Telemetry worker — runs as a child process under system Node.js (not Electron)
 * so the irsdk-node native addon uses the correct ABI.
 *
 * Communicates with the main Electron process via IPC (process.send / process.on).
 */

import { IRacingSDK } from 'irsdk-node';

// ─── TIRE CHANNEL NAMES ──────────────────────────────────────────────────────
const TIRE_CHANNELS: Record<string, string[]> = {
  LF: ['LFtempCL', 'LFtempCM', 'LFtempCR'],
  RF: ['RFtempCL', 'RFtempCM', 'RFtempCR'],
  LR: ['LRtempCL', 'LRtempCM', 'LRtempCR'],
  RR: ['RRtempCL', 'RRtempCM', 'RRtempCR'],
};

const TIRE_PRESSURE_CHANNELS: Record<string, string> = {
  LF: 'LFcoldPressure',
  RF: 'RFcoldPressure',
  LR: 'LRcoldPressure',
  RR: 'RRcoldPressure',
};

const TIRE_WEAR_CHANNELS: Record<string, string[]> = {
  LF: ['LFwearL', 'LFwearM', 'LFwearR'],
  RF: ['RFwearL', 'RFwearM', 'RFwearR'],
  LR: ['LRwearL', 'LRwearM', 'LRwearR'],
  RR: ['RRwearL', 'RRwearM', 'RRwearR'],
};

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

interface DrivingData {
  throttle: number;
  brake: number;
  steeringAngle: number;
  speed: number;
  latAccel: number;
  longAccel: number;
  gear: number;
  rpm: number;
  lapDistPct: number;
  onPitRoad: boolean;
  lapCurrentTime: number;
  lapLastTime: number;
  lapBestTime: number;
}

interface SessionInfo {
  carName: string;
  carPath: string;
  trackName: string;
  trackConfig: string;
  sessionType: string;
  playerClub: string;
}

interface DriverRosterEntry {
  carIdx: number;
  userName: string;
  carNumber: string;
  flairName: string;
  iRating: number;
  licString: string;
  incidents: number;
  carMake: string;
  carClassId: number;
  carClassName: string;
  carClassColor: number;
}

interface StandingEntry {
  carIdx: number;
  position: number;
  userName: string;
  carNumber: string;
  flairName: string;
  iRating: number;
  licString: string;
  lap: number;
  bestLapTime: number;
  lastLapTime: number;
  incidents: number;
  carMake: string;
  carClassId: number;
  carClassName: string;
  carClassColor: number;
  isPlayer: boolean;
}

interface TelemetrySnapshot {
  connected: boolean;
  tires: TireData[];
  radar: RadarSnapshot;
  driving: DrivingData | null;
  session: SessionInfo | null;
  weather: { airTempC: number; trackTempC: number } | null;
  standings: StandingEntry[];
}

// ─── State ───────────────────────────────────────────────────────────────────
let sdk: IRacingSDK | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let cachedTrackLengthM = 0;
let cachedSessionInfo: SessionInfo | null = null;
let sessionInfoResolved = false;
let driverRoster: DriverRosterEntry[] = [];
let rosterPollCounter = 0;
const ROSTER_REFRESH_INTERVAL = 30; // re-read session YAML every N polls

const emptyRadar: RadarSnapshot = {
  connected: false, playerSpeed: 0, carLeftRight: 0, nearbyCars: [], trackLengthM: 0,
};



// ─── Tire Temperature Estimation State ───────────────────────────────────────
interface TireEstState {
  estOutside: number;
  estMiddle: number;
  estInside: number;
  /** Baseline temps captured when real data was last confirmed fresh */
  baseOutside: number;
  baseMiddle: number;
  baseInside: number;
  /** How many consecutive polls the average temp stayed within STALE_TOLERANCE of baseline */
  staleTicks: number;
  isEstimating: boolean;
  initialized: boolean;
}

// Smoothed driving inputs for the thermal model
let smoothSpeed = 0;
let smoothBrake = 0;
let smoothThrottle = 0;
let smoothLatAccel = 0;

// Per-tire estimation state
const tireEstStates: Record<string, TireEstState> = {};

// Thermal model constants (tuned for typical racing tire behavior)
const HEAT_TAU = 30;             // seconds — heating time constant
const COOL_TAU = 45;             // seconds — cooling time constant (tires cool slower than they heat)
const STALE_TICKS = 8;           // consecutive unchanged polls (~1.6s at 200ms) before treating as stale
const STALE_TOLERANCE = 3;       // °C — temps must change more than this to be considered "fresh"
const INPUT_SMOOTH_TAU = 2.5;    // seconds — smoothing window for driving inputs

// ─── Drivetrain Detection ────────────────────────────────────────────────────
type Drivetrain = 'RWD' | 'FWD' | 'AWD' | 'RWD_Hybrid';

interface DrivetrainProfile {
  brakeHeatFront: number;
  brakeHeatRear: number;
  throttleHeatFront: number;
  throttleHeatRear: number;
}

const DRIVETRAIN_PROFILES: Record<Drivetrain, DrivetrainProfile> = {
  RWD:        { brakeHeatFront: 40, brakeHeatRear: 12, throttleHeatFront:  8, throttleHeatRear: 37 },
  FWD:        { brakeHeatFront: 34, brakeHeatRear: 17, throttleHeatFront: 37, throttleHeatRear:  8 },
  AWD:        { brakeHeatFront: 34, brakeHeatRear: 17, throttleHeatFront: 20, throttleHeatRear: 26 },
  RWD_Hybrid: { brakeHeatFront: 37, brakeHeatRear: 14, throttleHeatFront: 14, throttleHeatRear: 31 },
};

// Map iRacing car name patterns to drivetrain type.
// Lowercase substrings matched against CarScreenName / CarPath from session info.
// Only non-RWD cars are listed — everything else defaults to RWD.
const CAR_DRIVETRAIN_MAP: Array<{ pattern: string; drive: Drivetrain }> = [
  // ── FWD (TCR) ──
  { pattern: 'elantra',            drive: 'FWD' },   // Hyundai Elantra N TCR
  { pattern: 'civic type r',       drive: 'FWD' },   // Honda Civic Type R TCR
  { pattern: 'civic tcr',          drive: 'FWD' },   // alternate name
  { pattern: 'rs3 lms',            drive: 'FWD' },   // Audi RS3 LMS TCR

  // ── AWD ──
  { pattern: 'audi 90 gto',        drive: 'AWD' },   // Audi 90 GTO
  { pattern: 'fiesta rallycross',  drive: 'AWD' },   // Ford Fiesta Rallycross
  { pattern: 'beetle rallycross',  drive: 'AWD' },   // Volkswagen Beetle Rallycross

  // ── RWD Hybrid (GTP / LMDh / F1 — rear drive + front e-motor) ──
  { pattern: 'cadillac v-series',  drive: 'RWD_Hybrid' },  // Cadillac V-Series.R GTP
  { pattern: 'bmw m hybrid',       drive: 'RWD_Hybrid' },  // BMW M Hybrid V8
  { pattern: 'acura arx',          drive: 'RWD_Hybrid' },  // Acura ARX-06
  { pattern: 'mercedes-amg w13',   drive: 'RWD_Hybrid' },  // Mercedes-AMG W13 (F1)
  { pattern: 'w13',                drive: 'RWD_Hybrid' },  // alternate match
];

let detectedDrivetrain: Drivetrain = 'RWD';
let drivetrainDetected = false;

function detectDrivetrain(sdkInst: IRacingSDK): Drivetrain {
  if (drivetrainDetected) return detectedDrivetrain;

  try {
    const session = (sdkInst as any).getSessionData?.();
    const driverInfo = session?.DriverInfo;
    const drivers: any[] = driverInfo?.Drivers;
    const playerIdx = driverInfo?.DriverCarIdx;

    let carName = '';
    if (drivers && playerIdx != null) {
      const player = drivers[playerIdx];
      carName = (player?.CarScreenName || player?.CarPath || '').toLowerCase();
    }

    if (!carName) {
      const weekendInfo = session?.WeekendInfo;
      carName = (weekendInfo?.CarName || '').toLowerCase();
    }

    if (carName) {
      for (const { pattern, drive } of CAR_DRIVETRAIN_MAP) {
        if (carName.includes(pattern)) {
          detectedDrivetrain = drive;
          drivetrainDetected = true;
          console.log(`[Worker] Detected car "${carName}" → drivetrain: ${drive}`);
          return drive;
        }
      }
      console.log(`[Worker] Car "${carName}" → defaulting to RWD`);
    }
  } catch {
    // Session info not available yet — keep default
  }

  drivetrainDetected = true;
  return detectedDrivetrain;
}

// Heat generation coefficients (drivetrain-independent)
const SPEED_HEAT_COEFF = 58;     // base heat from rolling friction (scaled by speed/V_REF)
const V_REF = 70;                // reference speed (m/s) for normalization (~252 km/h)
const LATERAL_HEAT_COEFF = 23;   // heat from cornering forces
const LATERAL_G_REF = 15;        // reference lateral accel (m/s²) for normalization
const LATERAL_ZONE_BIAS = 0.30;  // fraction of lateral heat biased toward outside zone
const TRACK_SURFACE_HEAT = 0.50; // how much track temp above air temp contributes to tire heat

function initTireEstState(): TireEstState {
  return {
    estOutside: 0, estMiddle: 0, estInside: 0,
    baseOutside: -999, baseMiddle: -999, baseInside: -999,
    staleTicks: 0, isEstimating: false, initialized: false,
  };
}

function readSessionInfo(sdkInst: IRacingSDK): SessionInfo | null {
  if (sessionInfoResolved && cachedSessionInfo) return cachedSessionInfo;
  try {
    const session = (sdkInst as any).getSessionData?.();
    const weekendInfo = session?.WeekendInfo;
    const driverInfo = session?.DriverInfo;
    const sessionInfo = session?.SessionInfo;

    const trackName   = weekendInfo?.TrackDisplayName || weekendInfo?.TrackName || '';
    const trackConfig = weekendInfo?.TrackConfigName  || '';

    const playerIdx = driverInfo?.DriverCarIdx;
    const drivers: any[] = driverInfo?.Drivers || [];
    let carName = '';
    let carPath = '';
    let playerClub = '';
    if (playerIdx != null && drivers[playerIdx]) {
      const p = drivers[playerIdx];
      carName = p.CarScreenName || p.CarScreenNameShort || '';
      carPath = p.CarPath || '';
      playerClub = p.FlairName || '';
    }

    // Determine current session type from SessionNum
    let sessionType = 'Practice';
    const sessions: any[] = sessionInfo?.Sessions || [];
    if (sessions.length > 0) {
      const lastSession = sessions[sessions.length - 1];
      sessionType = lastSession?.SessionType || 'Practice';
    }

    if (trackName || carName) {
      const info: SessionInfo = { carName, carPath, trackName, trackConfig, sessionType, playerClub };
      cachedSessionInfo = info;
      sessionInfoResolved = true;
      return info;
    }
  } catch {
    // Session data not yet available
  }
  return cachedSessionInfo;
}

function readDriverRoster(sdkInst: IRacingSDK): void {
  try {
    const session = (sdkInst as any).getSessionData?.();
    const driverInfo = session?.DriverInfo;
    const drivers: any[] = driverInfo?.Drivers || [];

    driverRoster = drivers
      .filter((d: any) => !d.CarIsPaceCar && !d.IsSpectator)
      .map((d: any) => ({
        carIdx:      d.CarIdx ?? 0,
        userName:    d.UserName || d.TeamName || 'Driver',
        carNumber:   String(d.CarNumber ?? ''),
        flairName:   d.FlairName || '',
        iRating:     typeof d.IRating === 'number' ? d.IRating : 0,
        licString:   d.LicString || '',
        incidents:   typeof d.CurDriverIncidentCount === 'number' ? d.CurDriverIncidentCount : 0,
        carMake:     d.CarScreenNameShort || d.CarScreenName || '',
        carClassId:    typeof d.CarClassID === 'number' ? d.CarClassID : 0,
        carClassName:  d.CarClassShortName || '',
        carClassColor: typeof d.CarClassColor === 'number' ? d.CarClassColor : 0xFFFFFF,
      }));
  } catch {
    // Session data not yet available
  }
}

function readStandings(telemetry: Record<string, any>, playerIdx: number): StandingEntry[] {
  if (driverRoster.length === 0) return [];

  const positions = readArray(telemetry['CarIdxPosition']);
  const laps      = readArray(telemetry['CarIdxLap']);
  const bestTimes = readArray(telemetry['CarIdxBestLapTime']);
  const lastTimes = readArray(telemetry['CarIdxLastLapTime']);

  const entries: StandingEntry[] = [];

  for (const driver of driverRoster) {
    const idx = driver.carIdx;
    const position    = positions ? (positions[idx] as number ?? 0) : 0;
    const lap         = laps      ? (laps[idx] as number ?? 0) : 0;
    const bestLapTime = bestTimes ? Math.max(0, bestTimes[idx] as number ?? 0) : 0;
    const lastLapTime = lastTimes ? Math.max(0, lastTimes[idx] as number ?? 0) : 0;

    entries.push({
      carIdx: idx,
      position,
      userName:    driver.userName,
      carNumber:   driver.carNumber,
      flairName:   driver.flairName,
      iRating:     driver.iRating,
      licString:   driver.licString,
      lap,
      bestLapTime,
      lastLapTime,
      incidents:   driver.incidents,
      carMake:     driver.carMake,
      carClassId:  driver.carClassId,
      carClassName: driver.carClassName,
      carClassColor: driver.carClassColor,
      isPlayer: idx === playerIdx,
    });
  }

  // If all positions are 0 (practice/qualifying), rank by best lap time instead.
  // Drivers with no lap time go to the end.
  const allZeroPos = entries.every(e => e.position === 0);
  if (allZeroPos) {
    entries.sort((a, b) => {
      const aT = a.bestLapTime > 0 ? a.bestLapTime : Infinity;
      const bT = b.bestLapTime > 0 ? b.bestLapTime : Infinity;
      if (aT !== bT) return aT - bT;
      return a.carIdx - b.carIdx;
    });
    // Assign synthetic position numbers
    entries.forEach((e, i) => { e.position = e.bestLapTime > 0 ? i + 1 : 0; });
  } else {
    // Sort by position (0 = unknown → push to end), then by car index as tiebreak
    entries.sort((a, b) => {
      if (a.position === 0 && b.position === 0) return a.carIdx - b.carIdx;
      if (a.position === 0) return 1;
      if (b.position === 0) return -1;
      return a.position - b.position;
    });
  }

  return entries;
}

function resetEstimationState(): void {
  for (const key of Object.keys(tireEstStates)) delete tireEstStates[key];
  smoothSpeed = 0;
  smoothBrake = 0;
  smoothThrottle = 0;
  smoothLatAccel = 0;
  detectedDrivetrain = 'RWD';
  drivetrainDetected = false;
  cachedSessionInfo = null;
  sessionInfoResolved = false;
  driverRoster = [];
  rosterPollCounter = 0;
}

function smoothInput(current: number, raw: number, dt: number): number {
  const alpha = 1 - Math.exp(-dt / INPUT_SMOOTH_TAU);
  return current + (raw - current) * alpha;
}

function estimateTireTemps(
  state: TireEstState,
  raw: TireData,
  tirePos: string,
  speed: number,
  brake: number,
  throttle: number,
  latAccel: number,
  trackTemp: number,
  airTemp: number,
  windSpeed: number,
  humidity: number,
  dt: number,
  onPitRoad: boolean,
): TireData {
  const isFront = tirePos === 'LF' || tirePos === 'RF';
  const isLeft  = tirePos === 'LF' || tirePos === 'LR';

  const rawAvg = (raw.tempOutside + raw.tempMiddle + raw.tempInside) / 3;

  // ── CASE 1: On pit road OR stationary → always use real SDK data, re-seed estimation ──
  // When stopped (speed < 1 m/s) the thermal model adds nothing; real SDK data is always
  // preferable. This also catches pit stall scenarios where pit-road flags are unreliable.
  if (onPitRoad || speed < 1) {
    state.estOutside = raw.tempOutside;
    state.estMiddle  = raw.tempMiddle;
    state.estInside  = raw.tempInside;
    state.baseOutside = raw.tempOutside;
    state.baseMiddle  = raw.tempMiddle;
    state.baseInside  = raw.tempInside;
    state.staleTicks = 0;
    state.isEstimating = false;
    state.initialized = true;
    return { ...raw, isEstimated: false };
  }

  // ── CASE 2: All raw temps are near zero AND car is moving → data unavailable, estimate ──
  const tempsAreZero = rawAvg < 5;
  const carIsMoving = speed > 3;

  if (tempsAreZero && carIsMoving) {
    state.isEstimating = true;
    if (!state.initialized) {
      // Seed from track temp since we have no real data
      state.estOutside = trackTemp;
      state.estMiddle  = trackTemp;
      state.estInside  = trackTemp;
      state.initialized = true;
    }
    // Skip stale detection — go straight to thermal model below
  }

  // ── CASE 3: Non-zero temps — detect if data is stale (frozen at last pit values) ──
  else {
    // Check if temps have moved significantly from our baseline
    const driftFromBase =
      Math.abs(raw.tempOutside - state.baseOutside) +
      Math.abs(raw.tempMiddle  - state.baseMiddle) +
      Math.abs(raw.tempInside  - state.baseInside);

    if (driftFromBase > STALE_TOLERANCE) {
      // Significant change → data is genuinely fresh, re-seed estimation
      state.baseOutside = raw.tempOutside;
      state.baseMiddle  = raw.tempMiddle;
      state.baseInside  = raw.tempInside;
      state.estOutside = raw.tempOutside;
      state.estMiddle  = raw.tempMiddle;
      state.estInside  = raw.tempInside;
      state.staleTicks = 0;
      state.isEstimating = false;
      state.initialized = true;
      return { ...raw, isEstimated: false };
    }

    // Temps haven't moved meaningfully — increment stale counter
    state.staleTicks++;

    if (!state.initialized) {
      // First time seeing data — seed estimation and mark initialized
      state.estOutside = raw.tempOutside;
      state.estMiddle  = raw.tempMiddle;
      state.estInside  = raw.tempInside;
      state.baseOutside = raw.tempOutside;
      state.baseMiddle  = raw.tempMiddle;
      state.baseInside  = raw.tempInside;
      state.initialized = true;
    }

    // Not enough stale polls yet — pass through real data
    if (state.staleTicks < STALE_TICKS) {
      state.estOutside = raw.tempOutside;
      state.estMiddle  = raw.tempMiddle;
      state.estInside  = raw.tempInside;
      state.isEstimating = false;
      return { ...raw, isEstimated: false };
    }

    state.isEstimating = true;
  }

  // ── THERMAL ESTIMATION MODEL ──────────────────────────────────────────────

  // Track surface heat: hot tarmac transfers heat directly into the contact patch
  const trackSurfaceBonus = Math.max(0, (trackTemp - airTemp) * TRACK_SURFACE_HEAT);

  // Speed-based heat from rolling friction
  const speedNorm = Math.min(speed / V_REF, 1.5);
  const baseHeat = SPEED_HEAT_COEFF * speedNorm + trackSurfaceBonus * speedNorm;

  // Longitudinal heat: drivetrain-aware brake/throttle distribution
  const dp = DRIVETRAIN_PROFILES[detectedDrivetrain];
  const brakeHeat    = brake    * (isFront ? dp.brakeHeatFront    : dp.brakeHeatRear);
  const throttleHeat = throttle * (isFront ? dp.throttleHeatFront : dp.throttleHeatRear);

  // Lateral heat: loaded tire gets more heat
  // Positive latAccel = turning right = left tires carry more load
  const lateralSign = isLeft ? 1 : -1;
  const tireLoadFactor = Math.max(0, latAccel * lateralSign);
  const lateralHeat = (tireLoadFactor / LATERAL_G_REF) * LATERAL_HEAT_COEFF;

  // Total heat for this tire
  const totalHeat = baseHeat + brakeHeat + throttleHeat + lateralHeat;

  // Zone distribution: outside zone gets more heat when tire is loaded in corners
  const zoneShift = (tireLoadFactor / LATERAL_G_REF) * LATERAL_ZONE_BIAS;
  const outsideHeatMult = 1 + zoneShift;
  const middleHeatMult  = 1;
  const insideHeatMult  = Math.max(0.5, 1 - zoneShift * 0.5);

  // ── Weather-aware cooling ──
  // Wind adds convective cooling on top of car speed airflow
  const effectiveAirflow = speed + windSpeed * 0.5;
  // Humidity reduces evaporative cooling efficiency (less cooling in humid conditions)
  const humidityFactor = 1 - humidity * 0.15;  // 0% humidity = full cooling, 100% = 85% cooling
  // Cooling scales with airflow but with diminishing returns (sqrt-like)
  const coolFactor = 1 + Math.sqrt(effectiveAirflow / 10) * 0.35 * humidityFactor;

  // Equilibrium temperature: blend between air temp and track temp as baseline
  // Tires at speed sit closer to track temp due to contact patch heating
  const baseTemp = airTemp + (trackTemp - airTemp) * 0.65;
  const eqOutside = baseTemp + (totalHeat * outsideHeatMult) / coolFactor;
  const eqMiddle  = baseTemp + (totalHeat * middleHeatMult)  / coolFactor;
  const eqInside  = baseTemp + (totalHeat * insideHeatMult)  / coolFactor;

  // Exponential approach toward equilibrium (asymmetric: heats faster than it cools)
  const zones: Array<{ key: 'estOutside' | 'estMiddle' | 'estInside'; eq: number }> = [
    { key: 'estOutside', eq: eqOutside },
    { key: 'estMiddle',  eq: eqMiddle },
    { key: 'estInside',  eq: eqInside },
  ];

  for (const { key, eq } of zones) {
    const current = state[key];
    const tau = eq > current ? HEAT_TAU : COOL_TAU;
    const alpha = 1 - Math.exp(-dt / tau);
    state[key] = current + (eq - current) * alpha;
  }

  return {
    ...raw,
    tempOutside: Math.round(state.estOutside),
    tempMiddle:  Math.round(state.estMiddle),
    tempInside:  Math.round(state.estInside),
    tempC:       Math.round((state.estOutside + state.estMiddle + state.estInside) / 3),
    isEstimated: true,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Read a single scalar from a telemetry entry returned by getTelemetry() */
function readScalar(entry: any): number {
  if (!entry) return 0;
  const v = entry.value;
  if (Array.isArray(v)) {
    const first = v[0];
    if (typeof first === 'number') return first;
    if (typeof first === 'boolean') return first ? 1 : 0;
    return 0;
  }
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return 0;
}

/** Read an array from a telemetry entry */
function readArray(entry: any): any[] | undefined {
  if (!entry) return undefined;
  if (Array.isArray(entry.value)) return entry.value;
  return undefined;
}

function readTireData(telemetry: Record<string, any>): TireData[] {
  const tires: TireData[] = [];

  for (const [label, channels] of Object.entries(TIRE_CHANNELS)) {
    const temps = channels.map((ch) => readScalar(telemetry[ch]));
    const tempC = Math.round(average(temps));

    // Outside = left side for left tires, right side for right tires
    const isLeft = label.startsWith('L');
    const tempOutside = Math.round(isLeft ? temps[0] : temps[2]);
    const tempMiddle  = Math.round(temps[1]);
    const tempInside  = Math.round(isLeft ? temps[2] : temps[0]);

    const ch = TIRE_PRESSURE_CHANNELS[label];
    const coldPressure = readScalar(telemetry[ch]);

    // Wear: average of left/middle/right wear (0–1 in SDK, 1 = 100% remaining)
    const wearChannels = TIRE_WEAR_CHANNELS[label];
    const wearValues = wearChannels.map((wch) => readScalar(telemetry[wch]));
    const wear = Math.round(average(wearValues) * 100);

    tires.push({
      label,
      tempC,
      tempOutside,
      tempMiddle,
      tempInside,
      wear,
      pressureKpa: Math.round(coldPressure * 10) / 10,
      isEstimated: false,
    });
  }

  return tires;
}

function parseTrackLength(sdkInst: IRacingSDK): number {
  if (cachedTrackLengthM > 0) return cachedTrackLengthM;
  try {
    const weekendInfo = (sdkInst as any).getWeekendInfo?.();
    let raw: string | undefined = weekendInfo?.TrackLength;

    if (!raw) {
      const session = (sdkInst as any).getSessionData?.();
      raw = session?.WeekendInfo?.TrackLength;
    }

    if (!raw) return 0;
    const match = raw.match(/([\d.]+)\s*(km|mi)/i);
    if (!match) return 0;
    const val = parseFloat(match[1]);
    cachedTrackLengthM = match[2].toLowerCase() === 'mi' ? val * 1609.344 : val * 1000;
    return cachedTrackLengthM;
  } catch {
    return 0;
  }
}

function readRadarData(telemetry: Record<string, any>, radarRange: number): RadarSnapshot {
  const trackLen = parseTrackLength(sdk!);
  if (trackLen <= 0) return emptyRadar;

  const lapDistPct   = readArray(telemetry['CarIdxLapDistPct']);
  const trackSurface = readArray(telemetry['CarIdxTrackSurface']);
  const onPitRoad    = readArray(telemetry['CarIdxOnPitRoad']);
  const playerIdx    = readScalar(telemetry['PlayerCarIdx']);
  const playerSpeed  = readScalar(telemetry['Speed']);
  const carLeftRight = readScalar(telemetry['CarLeftRight']);

  if (!lapDistPct || playerIdx == null) return emptyRadar;

  const playerPct = lapDistPct[playerIdx as number];
  if (playerPct == null || playerPct < 0) return emptyRadar;

  const nearbyCars: NearbyCarInfo[] = [];

  for (let i = 0; i < lapDistPct.length; i++) {
    if (i === playerIdx) continue;
    const pct = lapDistPct[i];
    if (pct == null || pct < 0) continue;
    if (trackSurface && (trackSurface[i] == null || trackSurface[i] < 1)) continue;
    if (onPitRoad && onPitRoad[i]) continue;

    let delta = pct - playerPct;
    if (delta > 0.5) delta -= 1.0;
    if (delta < -0.5) delta += 1.0;

    const distM = delta * trackLen;
    if (Math.abs(distM) <= radarRange) {
      nearbyCars.push({ carIdx: i, relativeDistM: distM, lateralOffset: 0 });
    }
  }

  nearbyCars.sort((a, b) => Math.abs(a.relativeDistM) - Math.abs(b.relativeDistM));

  // Assign per-car lateral offsets using the carLeftRight spotter signal.
  // Cars within the alongside window are candidates; assign the closest first.
  const ALONGSIDE_M = 30;
  const clr = (carLeftRight as number) ?? 0;
  if (clr >= 2) {
    const alongside = nearbyCars.filter(c => Math.abs(c.relativeDistM) < ALONGSIDE_M);
    if (clr === 2 || clr === 5) {
      // CLR_LEFT or CLR_2_CARS_LEFT — cars on player's left
      const slots = clr === 5 ? 2 : 1;
      alongside.slice(0, slots).forEach(c => { c.lateralOffset = -1; });
    } else if (clr === 3 || clr === 6) {
      // CLR_RIGHT or CLR_2_CARS_RIGHT — cars on player's right
      const slots = clr === 6 ? 2 : 1;
      alongside.slice(0, slots).forEach(c => { c.lateralOffset = 1; });
    } else if (clr === 4) {
      // CLR_LEFT_RIGHT — cars on both sides; split by longitudinal sign
      const leftCandidates  = alongside.filter(c => c.relativeDistM <= 0);
      const rightCandidates = alongside.filter(c => c.relativeDistM >  0);
      if (leftCandidates.length)  leftCandidates[0].lateralOffset  = -1;
      if (rightCandidates.length) rightCandidates[0].lateralOffset =  1;
      // If all on same side, assign two closest to opposite sides
      if (!leftCandidates.length && alongside.length >= 2)  { alongside[0].lateralOffset = -1; alongside[1].lateralOffset = 1; }
      if (!rightCandidates.length && alongside.length >= 2) { alongside[0].lateralOffset =  1; alongside[1].lateralOffset = -1; }
    }
  }

  return {
    connected: true,
    playerSpeed: playerSpeed as number,
    carLeftRight: carLeftRight as number,
    nearbyCars,
    trackLengthM: trackLen,
  };
}

// ─── IPC message handling ────────────────────────────────────────────────────
interface StartMessage {
  type: 'start';
  pollIntervalMs: number;
  radarRange: number;
}

interface StopMessage {
  type: 'stop';
}

type WorkerMessage = StartMessage | StopMessage;

function startPolling(pollIntervalMs: number, radarRange: number): void {
  stopPolling();

  try {
    sdk = new IRacingSDK();
  } catch (err) {
    console.error('[Worker] Failed to create IRacingSDK:', err);
    process.send?.({ type: 'error', message: String(err) });
    return;
  }

  cachedTrackLengthM = 0;
  resetEstimationState();
  let wasConnected = false;
  const dt = pollIntervalMs / 1000; // time step in seconds

  pollTimer = setInterval(() => {
    try {
      if (!sdk) return;

      const started = sdk.startSDK();
      if (!started) {
        if (wasConnected) {
          wasConnected = false;
          resetEstimationState();
          const snapshot: TelemetrySnapshot = {
            connected: false,
            tires: [],
            radar: emptyRadar,
            driving: null,
            session: null,
            weather: null,
            standings: [],
          };
          process.send?.({ type: 'telemetry', snapshot });
        }
        return;
      }

      const hasData = sdk.waitForData(32);
      if (!hasData) return;

      // Use getTelemetry() for safe bulk access (avoids native crash on missing vars)
      const telemetry = sdk.getTelemetry();
      if (!telemetry) return;

      // Detect drivetrain type from car info (runs once per session)
      detectDrivetrain(sdk);

      // Read driving inputs for tire temperature estimation
      const rawSpeed    = readScalar(telemetry['Speed']);           // m/s
      const rawBrake    = readScalar(telemetry['Brake']);           // 0–1
      const rawThrottle = readScalar(telemetry['Throttle']);        // 0–1
      const rawLatAccel = readScalar(telemetry['LatAccel']);        // m/s² (positive = turning right)
      // Detect pit road: scalar OnPitRoad bool, CarIdxOnPitRoad[playerIdx] (most reliable),
      // PlayerTrackSurface enum, or CarIdxTrackSurface[playerIdx]
      const playerCarIdx   = readScalar(telemetry['PlayerCarIdx']) as number;
      const onPitRoadVal   = readScalar(telemetry['OnPitRoad']);
      const carIdxPitRoad  = readArray(telemetry['CarIdxOnPitRoad']);
      const playerOnPit    = carIdxPitRoad ? (carIdxPitRoad[playerCarIdx] ? 1 : 0) : 0;
      const trackSurfAll   = readArray(telemetry['CarIdxTrackSurface']);
      const playerSurf     = trackSurfAll ? (trackSurfAll[playerCarIdx] as number ?? 99) : 99;
      const trackSurfVal   = readScalar((telemetry as any)['PlayerTrackSurface']);
      // playerSurf 1 = InPitStall, 2 = AproachingPits
      const onPitRoad      = onPitRoadVal > 0 || playerOnPit > 0
        || playerSurf === 1 || playerSurf === 2
        || trackSurfVal === 1 || trackSurfVal === 2;

      // Weather conditions
      const airTemp     = readScalar(telemetry['AirTemp']) || 25;          // °C
      const trackTemp   = readScalar(telemetry['TrackTempCrew']) || airTemp + 10;  // °C (track is hotter than air)
      const windSpeed   = readScalar((telemetry as any)['WindSpeed']) || 0;         // m/s
      const humidity    = readScalar((telemetry as any)['RelativeHumidity']) || 0.5; // 0–1

      // Smooth driving inputs (removes jitter, matches thermal inertia of tires)
      smoothSpeed    = smoothInput(smoothSpeed,    rawSpeed,    dt);
      smoothBrake    = smoothInput(smoothBrake,    rawBrake,    dt);
      smoothThrottle = smoothInput(smoothThrottle, rawThrottle, dt);
      smoothLatAccel = smoothInput(smoothLatAccel, rawLatAccel, dt);

      // Read raw tire data and apply estimation
      const rawTires = readTireData(telemetry);
      const tires: TireData[] = rawTires.map((rawTire) => {
        if (!tireEstStates[rawTire.label]) {
          tireEstStates[rawTire.label] = initTireEstState();
        }
        return estimateTireTemps(
          tireEstStates[rawTire.label],
          rawTire,
          rawTire.label,
          smoothSpeed,
          smoothBrake,
          smoothThrottle,
          smoothLatAccel,
          trackTemp,
          airTemp,
          windSpeed,
          humidity,
          dt,
          onPitRoad,
        );
      });

      const radar = readRadarData(telemetry, radarRange);

      // ── Driving data ──────────────────────────────────────────────────────
      const steeringAngle  = readScalar(telemetry['SteeringWheelAngle']);
      const longAccel      = readScalar(telemetry['LongAccel']);
      const gear           = readScalar(telemetry['Gear']);
      const rpm            = readScalar(telemetry['RPM']);
      const lapDistPct     = readScalar(telemetry['LapDistPct']);
      const lapCurrentTime = readScalar(telemetry['LapCurrentLapTime']);
      const lapLastTime    = readScalar(telemetry['LapLastLapTime']);
      const lapBestTime    = readScalar(telemetry['LapBestLapTime']);

      const driving: DrivingData = {
        throttle: rawThrottle,
        brake: rawBrake,
        steeringAngle,
        speed: rawSpeed,
        latAccel: rawLatAccel,
        longAccel,
        gear,
        rpm,
        lapDistPct,
        onPitRoad,
        lapCurrentTime,
        lapLastTime,
        lapBestTime,
      };

      // ── Session info ──────────────────────────────────────────────────────
      const session = readSessionInfo(sdk!);

      if (!wasConnected) {
        console.log('[Worker] iRacing connected');
      }
      wasConnected = true;

      // Refresh driver roster periodically (names, club names for flags)
      rosterPollCounter++;
      if (rosterPollCounter >= ROSTER_REFRESH_INTERVAL || driverRoster.length === 0) {
        readDriverRoster(sdk!);
        rosterPollCounter = 0;
      }

      const standings = readStandings(telemetry, playerCarIdx);

      const snapshot: TelemetrySnapshot = { connected: true, tires, radar, driving, session, weather: { airTempC: airTemp, trackTempC: trackTemp }, standings };
      process.send?.({ type: 'telemetry', snapshot });
    } catch (err) {
      console.error('[Worker] Poll error:', err);
      if (wasConnected) {
        wasConnected = false;
        const snapshot: TelemetrySnapshot = {
          connected: false,
          tires: [],
          radar: emptyRadar,
          driving: null,
          session: null,
          weather: null,
          standings: [],
        };
        process.send?.({ type: 'telemetry', snapshot });
      }
    }
  }, pollIntervalMs);
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (sdk) {
    try { sdk.stopSDK(); } catch { /* ignore */ }
    sdk = null;
  }
}

process.on('message', (msg: WorkerMessage) => {
  if (msg.type === 'start') {
    startPolling(msg.pollIntervalMs, msg.radarRange);
  } else if (msg.type === 'stop') {
    stopPolling();
    process.exit(0);
  }
});

// Graceful shutdown
process.on('disconnect', () => {
  stopPolling();
  process.exit(0);
});
