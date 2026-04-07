/**
 * Coach Renderer — frontend logic for the Live Coach window.
 *
 * Responsibilities:
 *  - Buffer live telemetry frames (rolling 60-second window)
 *  - Update live telemetry strip
 *  - Run analyzeSession() client-side when the user clicks "Analyze Now"
 *  - Render insights, recommendations, setup diffs, and session history
 */

import { analyzeSession, autoDetectProblem, TelemetryFrame, CoachAnalysis, WeatherContext } from './coachEngine';

// ─── Goal boosts (substring matching against component names) ─────────────────
const GOAL_BOOSTS: Record<string, { label: string; boosts: Array<[string, number]> }> = {
  top_speed:   { label: '🏎 More Top Speed',      boosts: [['wing', 14], ['aero', 12]] },
  cornering:   { label: '🔄 More Cornering Grip', boosts: [['camber', 12], ['anti-roll bar', 10], ['spring rate', 8], ['toe', 5]] },
  traction:    { label: '⚡ Better Traction',      boosts: [['differential', 14], ['rear anti-roll', 10], ['rear spring', 8], ['traction', 8]] },
  braking:     { label: '🛑 Better Braking',       boosts: [['brake', 14], ['front anti-roll', 8]] },
  consistency: { label: '📊 Lap Consistency',      boosts: [['rear anti-roll', 10], ['rear toe', 10], ['pressure', 7]] },
  tyre_life:   { label: '🔥 Save Tyres',           boosts: [['camber', 10], ['toe', 7], ['pressure', 7]] },
};
import { parseSetupFile, ParsedSetup, SetupValue, setupSummary } from './setupParser';
import { calculateHtmChanges, HtmChange } from './setupGenerator';
import { ProblemId, COMPONENT_LOCATIONS } from './setupRules';
import { resolveCarLogo } from './carLogoMap';
import { clubNameToIso, flagSrc } from './countryCodeMap';

// Logo base path relative to this HTML file (src/coach/coach.html → img/car-logos/)
const LOGO_BASE = '../../img/car-logos/';

// ─── API type shim ────────────────────────────────────────────────────────────

declare const window: Window & {
  coachAPI: {
    onCoachTelemetry: (cb: (s: any) => void) => void;
    openSetupFile: () => Promise<{ filePath: string; content: string } | null>;
    saveSetupFile: (content: string, suggestedName: string) => Promise<string | null>;
    saveSession: (analysis: CoachAnalysis) => Promise<any>;
    getSessions: () => Promise<any[]>;
    recordFeedback: (sessionId: string, feedback: 'helpful' | 'not_helpful') => Promise<void>;
    saveNotes: (sessionId: string, notes: string) => Promise<void>;
    getPreferences: () => Promise<Record<string, number>>;
    minimizeWindow: () => void;
    closeWindow: () => void;
  };
};

// ─── State ────────────────────────────────────────────────────────────────────

const BUFFER_MAX_FRAMES = 300; // ~60 s at 200 ms polling

let frameBuffer: TelemetryFrame[] = [];
let isRecording = false;
let lastLapDistPctRec = -1;
let selectedProblem: ProblemId | null = null;
let isAutoDetect = false;
let selectedGoals = new Set<string>();
let lastAnalysis: CoachAnalysis | null = null;
let lastSessionId: string | null = null;
let baseSetup: ParsedSetup | null = null;
let baseSetupRaw: string | null = null;

// Session mode & length
let sessionMode: 'race' | 'qualify' = 'race';
let sessionLengthUnit: 'laps' | 'mins' = 'laps';
let sessionLengthVal = 30;

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const sessionDot      = document.getElementById('session-dot')!;
const carLogoImg      = document.getElementById('car-logo') as HTMLImageElement;
const playerFlagImg   = document.getElementById('player-flag') as HTMLImageElement;
const siCar           = document.getElementById('si-car')!;
const siTrack         = document.getElementById('si-track')!;
const siSep           = document.getElementById('si-sep') as HTMLElement;

let lastLogoKey = '';
let lastPlayerClub = '';
const tvThrottle      = document.getElementById('tv-throttle')!;
const tvBrake         = document.getElementById('tv-brake')!;
const tvSpeed         = document.getElementById('tv-speed')!;
const tvLatG          = document.getElementById('tv-latg')!;
const tvSteer         = document.getElementById('tv-steer')!;
const tvGear          = document.getElementById('tv-gear')!;
const tvTF            = document.getElementById('tv-tf')!;
const tvTR            = document.getElementById('tv-tr')!;
const bufferStatus    = document.getElementById('buffer-status')!;
const lapTimeDisplay  = document.getElementById('lap-time-display')!;
const btnRecord       = document.getElementById('btn-record') as HTMLButtonElement;
const btnGoAnalyze    = document.getElementById('btn-go-analyze') as HTMLButtonElement;
const btnAnalyze      = document.getElementById('btn-analyze')    as HTMLButtonElement;
const selectedDisplay = document.getElementById('selected-problem-display')!;

const recsEmpty   = document.getElementById('recs-empty')!;
const recsContent = document.getElementById('recs-content')!;
const confBadge   = document.getElementById('confidence-badge')!;
const confText    = document.getElementById('conf-text')!;
const recsInsights = document.getElementById('recs-insights')!;
const recsList    = document.getElementById('recs-list')!;
const btnHelpful  = document.getElementById('btn-helpful')   as HTMLButtonElement;
const btnNotHelp  = document.getElementById('btn-not-helpful') as HTMLButtonElement;
const notesInput  = document.getElementById('notes-input')   as HTMLTextAreaElement;
const btnSaveNotes = document.getElementById('btn-save-notes') as HTMLButtonElement;

// Step 1 — garage
const btnImportBase    = document.getElementById('btn-import-base')    as HTMLButtonElement;
const garageCard       = document.getElementById('garage-card')!;
const garageFileInfo   = document.getElementById('garage-file-info')!;
const garageSections   = document.getElementById('garage-sections')!;
const btnGotoProblem   = document.getElementById('btn-goto-problem')   as HTMLButtonElement;
// Step 5 — export
const exportNoRecs     = document.getElementById('export-no-recs')!;
const exportContent    = document.getElementById('export-content')!;
const exportChangesList = document.getElementById('export-changes-list')!;
const exportSkippedNote = document.getElementById('export-skipped-note')!;
const btnExportText    = document.getElementById('btn-export-text')    as HTMLButtonElement;
const exportStatus     = document.getElementById('export-status')!;
// Recs panel — goto export button
const btnGotoExport    = document.getElementById('btn-goto-export')    as HTMLButtonElement;

const historyList   = document.getElementById('history-list')!;
const btnRefreshHist = document.getElementById('btn-refresh-history') as HTMLButtonElement;

// Standings panel
const standingsEmpty      = document.getElementById('standings-empty') as HTMLElement | null;
const standingsTableWrap  = document.getElementById('standings-table-wrap') as HTMLElement | null;
const standingsTbody      = document.getElementById('standings-tbody') as HTMLElement | null;
const standingsSessionType = document.getElementById('standings-session-type') as HTMLElement | null;

// Weather strip
const weatherStrip  = document.getElementById('weather-strip') as HTMLElement;
const wxAir         = document.getElementById('wx-air')!;
const wxTrack       = document.getElementById('wx-track')!;
const wxDelta       = document.getElementById('wx-delta')!;

// ─── Navigation ───────────────────────────────────────────────────────────────

document.querySelectorAll<HTMLButtonElement>('.step-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.step-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll<HTMLElement>('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const panelId = 'panel-' + btn.dataset['panel'];
    document.getElementById(panelId)?.classList.add('active');
    if (btn.dataset['panel'] === 'history') loadHistory();
  });
});

function goToPanel(name: string): void {
  document.querySelectorAll('.step-btn').forEach(b => {
    (b as HTMLButtonElement).classList.toggle('active', b.getAttribute('data-panel') === name);
  });
  document.querySelectorAll<HTMLElement>('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-' + name)?.classList.add('active');
}

// ─── Window controls ──────────────────────────────────────────────────────────
// Coach is embedded in the launcher — window controls are handled by the launcher.

// ─── Session mode toggle ──────────────────────────────────────────────────────

document.querySelectorAll<HTMLButtonElement>('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    sessionMode = btn.dataset['mode'] as 'race' | 'qualify';
  });
});

// ─── Session length ───────────────────────────────────────────────────────────

(document.getElementById('session-length-unit') as HTMLSelectElement)
  .addEventListener('change', (e) => {
    sessionLengthUnit = (e.target as HTMLSelectElement).value as 'laps' | 'mins';
  });

(document.getElementById('session-length-val') as HTMLInputElement)
  .addEventListener('change', (e) => {
    const v = parseInt((e.target as HTMLInputElement).value, 10);
    if (!isNaN(v) && v > 0) sessionLengthVal = v;
  });

// ─── Telemetry buffering ──────────────────────────────────────────────────────

window.coachAPI.onCoachTelemetry((snapshot: any) => {
  // Update session bar
  if (snapshot.connected) {
    sessionDot.className = 'connected';
    const s = snapshot.session;
    if (s) {
      siCar.textContent   = s.carName  || 'Unknown Car';
      siTrack.textContent = s.trackConfig ? `${s.trackName} — ${s.trackConfig}` : s.trackName;
      siSep.style.display = '';

      // Update car logo (only when car changes)
      const logoKey = s.carPath + '|' + s.carName;
      if (logoKey !== lastLogoKey) {
        lastLogoKey = logoKey;
        const logoFile = resolveCarLogo(s.carPath, s.carName);
        if (logoFile) {
          carLogoImg.src = LOGO_BASE + logoFile;
          carLogoImg.alt = s.carName;
          carLogoImg.style.display = 'inline-block';
        } else {
          carLogoImg.style.display = 'none';
        }
      }

      // Update player country flag (only when club changes)
      const club = s.playerClub || '';
      if (club !== lastPlayerClub) {
        lastPlayerClub = club;
        const iso = clubNameToIso(club);
        if (playerFlagImg) {
          if (iso) {
            playerFlagImg.src = flagSrc(iso);
            playerFlagImg.alt = club;
            playerFlagImg.style.display = 'inline-block';
          } else {
            playerFlagImg.style.display = 'none';
          }
        }
      }
    }
  } else {
    sessionDot.className = 'disconnected';
    siCar.textContent = 'Waiting for iRacing…';
    siTrack.textContent = '';
    siSep.style.display = 'none';
    carLogoImg.style.display = 'none';
    if (playerFlagImg) playerFlagImg.style.display = 'none';
    lastLogoKey = '';
    lastPlayerClub = '';
  }

  // Update standings panel
  updateStandings(snapshot.standings ?? [], snapshot.session?.sessionType ?? '');

  // Update weather strip
  const wx = snapshot.weather;
  if (wx && snapshot.connected) {
    weatherStrip.style.display = 'flex';
    wxAir.textContent   = `🌡 ${wx.airTempC.toFixed(0)}°C`;
    wxTrack.textContent = `🛣 ${wx.trackTempC.toFixed(0)}°C`;
    const delta = wx.trackTempC - wx.airTempC;
    wxDelta.textContent = `+${delta.toFixed(0)}°C`;
  } else {
    weatherStrip.style.display = 'none';
  }

  // ── Recording (runs before early-return so it captures data regardless of display state) ──
  const dRec = snapshot.driving;
  const tiresRec: any[] = snapshot.tires ?? [];
  if (isRecording) {
    if (!snapshot.connected) {
      bufferStatus.textContent = 'Not connected to iRacing\u2026';
    } else if (!dRec) {
      bufferStatus.textContent = 'Connected \u2014 waiting for driving data\u2026';
    } else {
      const fTemps = tiresRec.filter((t: any) => t.label === 'LF' || t.label === 'RF');
      const rTemps = tiresRec.filter((t: any) => t.label === 'LR' || t.label === 'RR');
      const recAvgF = fTemps.length ? fTemps.reduce((a: number, t: any) => a + t.tempC, 0) / fTemps.length : 0;
      const recAvgR = rTemps.length ? rTemps.reduce((a: number, t: any) => a + t.tempC, 0) / rTemps.length : 0;

      if (lastLapDistPctRec > 0.85 && dRec.lapDistPct < 0.15 && frameBuffer.length >= 30) {
        stopRecording();
      } else {
        const frame: TelemetryFrame = {
          throttle:         dRec.throttle,
          brake:            dRec.brake,
          steeringAngle:    dRec.steeringAngle,
          speed:            dRec.speed,
          latAccel:         dRec.latAccel,
          longAccel:        dRec.longAccel,
          gear:             dRec.gear,
          rpm:              dRec.rpm,
          lapDistPct:       dRec.lapDistPct,
          onPitRoad:        dRec.onPitRoad,
          tireTempAvgFront: recAvgF,
          tireTempAvgRear:  recAvgR,
          tireTempAvgLF: tiresRec.find((t: any) => t.label === 'LF')?.tempC ?? 0,
          tireTempAvgRF: tiresRec.find((t: any) => t.label === 'RF')?.tempC ?? 0,
          tireTempAvgLR: tiresRec.find((t: any) => t.label === 'LR')?.tempC ?? 0,
          tireTempAvgRR: tiresRec.find((t: any) => t.label === 'RR')?.tempC ?? 0,
        };
        frameBuffer.push(frame);
        if (frameBuffer.length >= BUFFER_MAX_FRAMES) stopRecording();
        else bufferStatus.textContent = `Recording\u2026 ${frameBuffer.length} frames`;
      }
      lastLapDistPctRec = dRec.lapDistPct;
    }
  }

  if (!snapshot.connected || !snapshot.driving) return;

  const d = snapshot.driving;
  const tires: any[] = snapshot.tires ?? [];

  // Update live strip
  tvThrottle.textContent = (d.throttle * 100).toFixed(0) + '%';
  tvBrake.textContent    = (d.brake    * 100).toFixed(0) + '%';
  tvSpeed.textContent    = (d.speed * 3.6).toFixed(0) + ' km/h';
  tvLatG.textContent     = (d.latAccel / 9.81).toFixed(2) + ' G';
  tvSteer.textContent    = (d.steeringAngle * 180 / Math.PI).toFixed(0) + '°';
  tvGear.textContent     = d.gear === 0 ? 'N' : d.gear === -1 ? 'R' : String(d.gear);

  const frontTemps = tires.filter((t: any) => t.label === 'LF' || t.label === 'RF');
  const rearTemps  = tires.filter((t: any) => t.label === 'LR' || t.label === 'RR');
  const avgF = frontTemps.length ? frontTemps.reduce((a: number, t: any) => a + t.tempC, 0) / frontTemps.length : 0;
  const avgR = rearTemps.length  ? rearTemps.reduce((a: number,  t: any) => a + t.tempC, 0) / rearTemps.length  : 0;
  tvTF.textContent = avgF > 0 ? avgF.toFixed(0) + '°' : '–';
  tvTR.textContent = avgR > 0 ? avgR.toFixed(0) + '°' : '–';

  if (d.lapLastTime > 0) {
    lapTimeDisplay.textContent = 'Last lap: ' + formatLapTime(d.lapLastTime);
  }

  btnAnalyze.disabled = isRecording || frameBuffer.length < 10 || (!selectedProblem && !isAutoDetect);
});

// ─── Record button ────────────────────────────────────────────────────────────

function stopRecording(): void {
  isRecording = false;
  lastLapDistPctRec = -1;
  if (frameBuffer.length >= 10) {
    btnRecord.className = 'btn-record';
    btnRecord.textContent = '\u23fa Re-record';
    bufferStatus.textContent = `Captured: ${frameBuffer.length} frames`;
  } else {
    btnRecord.className = 'btn-record';
    btnRecord.textContent = '\u23fa Start Recording';
    bufferStatus.textContent = 'Not enough data \u2014 try again';
  }
  btnAnalyze.disabled = frameBuffer.length < 10 || (!selectedProblem && !isAutoDetect);
}

btnRecord.addEventListener('click', () => {
  if (!isRecording) {
    frameBuffer = [];
    isRecording = true;
    lastLapDistPctRec = -1;
    btnRecord.className = 'btn-record recording';
    btnRecord.textContent = '\u23f9 Stop Recording';
    bufferStatus.textContent = 'Recording\u2026 0 frames';
    btnAnalyze.disabled = true;
  } else {
    stopRecording();
  }
});

// ─── Problem selection ────────────────────────────────────────────────────────

document.querySelectorAll<HTMLButtonElement>('.problem-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.problem-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    const val = btn.dataset['problem'] as string;
    if (val === 'auto_detect') {
      isAutoDetect = true;
      selectedProblem = null;
      const label = btn.querySelector('.prob-label')?.textContent ?? 'Auto-Detect';
      selectedDisplay.innerHTML = `<strong style="color:var(--text)">${label}</strong> selected`;
    } else {
      isAutoDetect = false;
      selectedProblem = val as ProblemId;
      const label = btn.querySelector('.prob-label')?.textContent ?? selectedProblem;
      selectedDisplay.innerHTML = `<strong style="color:var(--text)">${label}</strong> selected`;
    }
    btnGoAnalyze.disabled = false;
    btnAnalyze.disabled = frameBuffer.length < 10;
  });
});

// ─── Goal chip selection ──────────────────────────────────────────────────────

document.querySelectorAll<HTMLButtonElement>('.goal-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const gid = chip.dataset['goal']!;
    if (selectedGoals.has(gid)) {
      selectedGoals.delete(gid);
      chip.classList.remove('selected');
    } else {
      selectedGoals.add(gid);
      chip.classList.add('selected');
    }
  });
});

btnGoAnalyze.addEventListener('click', () => goToPanel('analyze'));

// ─── Analyze ─────────────────────────────────────────────────────────────────

btnAnalyze.addEventListener('click', async () => {
  if (!selectedProblem && !isAutoDetect) return;

  const preferences = await window.coachAPI.getPreferences();

  const snap: any = (window as any).__lastSnap;
  const carPath  = snap?.session?.carPath  ?? '';
  const carName  = snap?.session?.carName  ?? '';
  const trackName   = snap?.session?.trackName   ?? '';
  const trackConfig = snap?.session?.trackConfig ?? '';
  const weatherRaw = snap?.weather;
  const weather: WeatherContext | undefined = weatherRaw
    ? { airTempC: weatherRaw.airTempC, trackTempC: weatherRaw.trackTempC }
    : undefined;

  // Build goal boosts and labels from selected goals
  const goalBoosts: Array<[string, number]> = [];
  const goalLabels: string[] = [];
  for (const gid of selectedGoals) {
    const g = GOAL_BOOSTS[gid];
    if (g) { goalBoosts.push(...g.boosts); goalLabels.push(g.label); }
  }

  // Inject session-mode boosts
  const isLongRace = sessionLengthUnit === 'laps' ? sessionLengthVal > 30 : sessionLengthVal > 45;
  const isShortSprint = sessionLengthUnit === 'laps' ? sessionLengthVal < 10 : sessionLengthVal < 20;
  if (sessionMode === 'qualify') {
    // Qualifying: maximise single-lap grip (more wing, camber, spring rate)
    goalBoosts.push(['wing', 12], ['aero', 10], ['camber', 10], ['spring rate', 6]);
    goalLabels.unshift('⚡ Qualifying Setup');
  } else if (isLongRace) {
    // Long race: prioritise tyre management
    goalBoosts.push(['pressure', 9], ['camber', 8], ['toe', 6], ['rear anti-roll', 7]);
    goalLabels.unshift(`🏁 Race (${sessionLengthVal} ${sessionLengthUnit} — tyre life focus)`);
  } else if (isShortSprint) {
    goalLabels.unshift(`🏁 Sprint (${sessionLengthVal} ${sessionLengthUnit})`);
  } else {
    goalLabels.unshift(`🏁 Race (${sessionLengthVal} ${sessionLengthUnit})`);
  }
  const sessionLengthStr = `${sessionLengthVal} ${sessionLengthUnit}`;

  let problemToAnalyze: ProblemId;
  let detectedLabel: string | undefined;

  if (isAutoDetect) {
    const detected = autoDetectProblem(frameBuffer);
    problemToAnalyze = detected.problem;
    detectedLabel = detected.label;
  } else {
    problemToAnalyze = selectedProblem!;
  }

  const analysis = analyzeSession(
    frameBuffer,
    problemToAnalyze,
    carPath,
    carName,
    trackName,
    trackConfig,
    preferences,
    weather,
    detectedLabel,
    goalBoosts,
    goalLabels,
    sessionMode,
    sessionLengthStr,
  );

  lastAnalysis = analysis;
  renderRecommendations(analysis);
  refreshExportPanel();
  if (baseSetup) renderGarageView(baseSetup);
  goToPanel('recommendations');

  // Save to history
  const session = await window.coachAPI.saveSession(analysis);
  lastSessionId = session?.id ?? null;
});

// ─── Recommendations rendering ────────────────────────────────────────────────

function renderRecommendations(analysis: CoachAnalysis): void {
  recsEmpty.style.display = 'none';
  recsContent.style.display = 'flex';

  // ── Car logo + context header ────────────────────────────────────────────
  let existingHeader = document.getElementById('recs-car-header');
  if (!existingHeader) {
    existingHeader = document.createElement('div');
    existingHeader.id = 'recs-car-header';
    existingHeader.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 0 4px';
    recsContent.insertBefore(existingHeader, recsContent.firstChild);
  }
  const snap: any = (window as any).__lastSnap;
  const carPath = snap?.session?.carPath ?? '';
  const logoFile = resolveCarLogo(carPath, analysis.carName);
  const logoHtml = logoFile
    ? `<img src="${LOGO_BASE}${logoFile}" alt="${esc(analysis.carName)}" style="height:32px;width:auto;object-fit:contain;opacity:0.92;flex-shrink:0;" />`
    : '';
  existingHeader.innerHTML = `
    ${logoHtml}
    <div>
      <div style="font-size:15px;font-weight:700;color:var(--text)">${esc(analysis.carName)}</div>
      <div style="font-size:13px;color:var(--text-muted)">${esc(analysis.trackName)} · ${esc(analysis.problemLabel)}</div>
      ${analysis.detectedProblem ? `<div style="font-size:12px;color:#5bb8f5;margin-top:2px">🔍 Auto-detected: ${esc(analysis.detectedProblem)}</div>` : ''}
      ${analysis.goalLabels?.length ? `<div style="font-size:12px;color:#a78df5;margin-top:2px">🎯 Priorities: ${analysis.goalLabels.map(esc).join(' · ')}</div>` : ''}
      ${analysis.sessionMode ? `<div style="font-size:12px;color:${analysis.sessionMode === 'qualify' ? '#5bb8f5' : '#7ed56f'};margin-top:2px">${analysis.sessionMode === 'qualify' ? '⚡ Qualifying Setup' : '🏁 Race Setup'}${analysis.sessionLength ? ` · ${esc(analysis.sessionLength)}` : ''}</div>` : ''}
    </div>`;

  // Confidence badge
  confBadge.className = analysis.confidence;
  const confLabels = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence — drive more laps for better analysis' };
  confText.textContent = confLabels[analysis.confidence];

  // Insights
  recsInsights.innerHTML = '';
  if (analysis.insights.length === 0) {
    recsInsights.innerHTML = '<p style="font-size:11px;color:var(--text-muted)">No specific telemetry signals detected. Drive more laps for richer data.</p>';
  } else {
    for (const ins of analysis.insights) {
      const div = document.createElement('div');
      div.className = 'insight-item';
      div.innerHTML = `
        <span class="insight-icon">${ins.confirms ? '✅' : 'ℹ️'}</span>
        <div class="insight-body">
          <div class="insight-signal">${esc(ins.signal)}</div>
          <div class="insight-value">${esc(ins.value)}</div>
        </div>`;
      recsInsights.appendChild(div);
    }
  }

  // Recommendations
  recsList.innerHTML = '';
  if (analysis.recommendations.length === 0) {
    recsList.innerHTML = '<p style="font-size:11px;color:var(--text-muted)">No specific adjustments found for this car category. Try selecting a different problem.</p>';
  } else {
    for (const rec of analysis.recommendations) {
      const div = document.createElement('div');
      div.className = 'rec-item' + (rec.boosted ? ' boosted' : '');
      const loc = COMPONENT_LOCATIONS[rec.component];
      div.innerHTML = `
        <span class="rec-rank">#${rec.rank}</span>
        <span class="rec-impact-badge ${rec.impact}">${rec.impact.toUpperCase()}</span>
        <div class="rec-body">
          <div class="rec-component">${esc(rec.component)}</div>
          <div class="rec-direction">${esc(rec.direction)}</div>
          <div class="rec-explanation">${esc(rec.explanation)}</div>
          ${loc ? `<div class="rec-location">📍 ${esc(loc)}</div>` : ''}
          ${rec.boosted ? '<div class="rec-boosted-tag">✦ Telemetry signal confirms this issue</div>' : ''}
        </div>`;
      recsList.appendChild(div);
    }
  }

  // Reset feedback UI
  btnHelpful.className = 'btn-feedback';
  btnNotHelp.className = 'btn-feedback';
  notesInput.value = '';
}

btnHelpful.addEventListener('click', async () => {
  if (!lastSessionId) return;
  await window.coachAPI.recordFeedback(lastSessionId, 'helpful');
  btnHelpful.classList.add('selected-helpful');
  btnNotHelp.classList.remove('selected-not-helpful');
});

btnNotHelp.addEventListener('click', async () => {
  if (!lastSessionId) return;
  await window.coachAPI.recordFeedback(lastSessionId, 'not_helpful');
  btnNotHelp.classList.add('selected-not-helpful');
  btnHelpful.classList.remove('selected-helpful');
});

btnSaveNotes.addEventListener('click', async () => {
  if (!lastSessionId) return;
  await window.coachAPI.saveNotes(lastSessionId, notesInput.value);
  btnSaveNotes.textContent = 'Saved!';
  setTimeout(() => { btnSaveNotes.textContent = 'Save Notes'; }, 2000);
});

// ─── Garage Setup panel (Step 1) ─────────────────────────────────────────────

// Human-friendly labels for .sto keys
const KEY_LABELS: Record<string, string> = {
  FrontARBBladeIndex: 'Front ARB', RearARBBladeIndex: 'Rear ARB',
  BrakeBalance: 'Brake Bias', FrontSpringRate: 'Front Spring',
  RearSpringRate: 'Rear Spring', FrontCamber: 'Front Camber',
  RearCamber: 'Rear Camber', FrontToeIn: 'Front Toe', RearToeIn: 'Rear Toe',
  FrontWingAngle: 'Front Wing', RearWingAngle: 'Rear Wing',
  LeftFrontColdPressure: 'FL Pressure', RightFrontColdPressure: 'FR Pressure',
  LeftRearColdPressure: 'RL Pressure', RightRearColdPressure: 'RR Pressure',
  FrontRideHeight: 'Front Ride Height', RearRideHeight: 'Rear Ride Height',
  FrontBumpStopRate: 'Front Bump Stop', RearBumpStopRate: 'Rear Bump Stop',
  FrontShockDeflection: 'Front Shock', RearShockDeflection: 'Rear Shock',
  AbsLevel: 'ABS', TractionControlLevel: 'Traction Control',
  BrakingStabilityHelper: 'Brake Stab.', SteeringHelperLevel: 'Steering Help',
};
const SKIP_SECTIONS = new Set(['__root__', 'SymmetricSetup', 'iSetup', 'Notes', 'Tire Type']);

function humanKeyLabel(key: string): string {
  return KEY_LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/\s*Index\s*$/, '').trim();
}

function getRecComponents(): string[] {
  return lastAnalysis?.recommendations.map(r => r.component.toLowerCase().replace(/\s+/g, '')) ?? [];
}

function renderGarageView(setup: ParsedSetup): void {
  garageSections.innerHTML = '';

  // Build highlighted section+label pairs from current recommendations
  const hiSet = new Set<string>(); // "section||label" lowercased
  if (lastAnalysis && lastAnalysis.recommendations.length > 0) {
    for (const c of calculateHtmChanges(setup, lastAnalysis.recommendations)) {
      hiSet.add(`${c.section.toLowerCase()}||${c.label.toLowerCase()}`);
    }
  }

  // Merge duplicate corner sections (Left Front + Left Front (2), etc.) into one
  const CORNER_NAMES = ['Left Front', 'Right Front', 'Left Rear', 'Right Rear'];
  const CORNER_CSS: Record<string, string> = {
    'Left Front': 'lf', 'Right Front': 'rf', 'Left Rear': 'lr', 'Right Rear': 'rr',
  };
  const cornerKvs = new Map<string, Record<string, SetupValue>>();
  const otherSecs: Array<[string, Record<string, SetupValue>]> = [];

  for (const [sec, kvs] of Object.entries(setup.sections)) {
    if (SKIP_SECTIONS.has(sec)) continue;
    const rows = Object.entries(kvs).filter(([, v]) => v.numeric !== null);
    if (!rows.length) continue;
    const base = CORNER_NAMES.find(c => {
      const sl = sec.toLowerCase(), cl = c.toLowerCase();
      return sl === cl || sl.startsWith(cl + ' (');
    });
    if (base) {
      cornerKvs.set(base, { ...(cornerKvs.get(base) ?? {}), ...Object.fromEntries(rows) });
    } else {
      otherSecs.push([sec, Object.fromEntries(rows)]);
    }
  }

  // Build a parameter row element
  function makeRow(secName: string, lbl: string, val: SetupValue, altSecName?: string): HTMLElement {
    const lblLow = lbl.toLowerCase();
    const hi = hiSet.has(`${secName.toLowerCase()}||${lblLow}`) ||
               (altSecName ? hiSet.has(`${altSecName}||${lblLow}`) : false);
    const numStr = val.unit && val.raw.endsWith(val.unit)
      ? val.raw.slice(0, -val.unit.length).trim() : val.raw;
    const row = document.createElement('div');
    row.className = 'garage-row' + (hi ? ' has-rec' : '');
    row.innerHTML = `<span class="grv-lbl">${esc(lbl)}</span>` +
      `<span class="grv-val">${esc(numStr)}</span>` +
      `<span class="grv-unit">${esc(val.unit)}</span>`;
    return row;
  }

  // Build a full section block (header + rows)
  function makeBlock(secName: string, kvs: Record<string, SetupValue>): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'garage-section';
    const hdr = document.createElement('div');
    hdr.className = 'garage-section-hdr';
    hdr.textContent = secName;
    wrap.appendChild(hdr);
    for (const [lbl, val] of Object.entries(kvs)) {
      wrap.appendChild(makeRow(secName, lbl, val));
    }
    return wrap;
  }

  // Render order: In-Car Dials → Front/Brakes → other → Suspension corners → Rear
  const FIRST = ['In-Car Dials', 'Front/Brakes'];
  const LAST  = ['Rear'];

  for (const [s, kvs] of otherSecs.filter(([s]) => FIRST.includes(s)))
    garageSections.appendChild(makeBlock(s, kvs));

  for (const [s, kvs] of otherSecs.filter(([s]) => !FIRST.includes(s) && !LAST.includes(s)))
    garageSections.appendChild(makeBlock(s, kvs));

  // 2×2 corner grid
  if (cornerKvs.size > 0) {
    const cornersWrap = document.createElement('div');
    cornersWrap.className = 'garage-corners-wrap';
    const cornersHdr = document.createElement('div');
    cornersHdr.className = 'garage-section-hdr';
    cornersHdr.textContent = 'Suspension & Tyres';
    cornersWrap.appendChild(cornersHdr);

    const grid = document.createElement('div');
    grid.className = 'garage-corners-grid';

    for (const name of CORNER_NAMES) {
      const kvs = cornerKvs.get(name);
      if (!kvs) continue;
      const card = document.createElement('div');
      card.className = `garage-corner-card ${CORNER_CSS[name] ?? ''}`;
      const cardHdr = document.createElement('div');
      cardHdr.className = 'garage-corner-hdr';
      cardHdr.textContent = name;
      card.appendChild(cardHdr);
      // Check both original section names (name and name (2)) for highlights
      const alt = name.toLowerCase() + ' (2)';
      for (const [lbl, val] of Object.entries(kvs)) {
        card.appendChild(makeRow(name, lbl, val, alt));
      }
      grid.appendChild(card);
    }

    cornersWrap.appendChild(grid);
    garageSections.appendChild(cornersWrap);
  }

  for (const [s, kvs] of otherSecs.filter(([s]) => LAST.includes(s)))
    garageSections.appendChild(makeBlock(s, kvs));
}

btnImportBase.addEventListener('click', async () => {
  try {
    const result = await window.coachAPI.openSetupFile();
    if (!result) return;

    baseSetup = parseSetupFile(result.content);
    baseSetupRaw = result.content;

    const fileName = result.filePath.replace(/\\/g, '/').split('/').pop() ?? '';
    garageFileInfo.innerHTML = `<div class="file-name">${esc(fileName)}</div>
      <div class="file-meta">${esc(setupSummary(baseSetup))}</div>`;

    renderGarageView(baseSetup);
    garageCard.style.display = 'flex';
  } catch (err: any) {
    console.error('[ApexSense] openSetupFile error:', err);
  }
});

btnGotoProblem.addEventListener('click', () => goToPanel('problem'));

// ─── Export Setup panel (Step 5) ─────────────────────────────────────────────

function refreshExportPanel(): void {
  if (!lastAnalysis || lastAnalysis.recommendations.length === 0) {
    exportNoRecs.style.display = '';
    exportContent.style.display = 'none';
    return;
  }
  exportNoRecs.style.display = 'none';
  exportContent.style.display = 'flex';

  exportChangesList.innerHTML = '';
  exportSkippedNote.style.display = 'none';

  if (baseSetup) {
    // Calculate exact current → new values from the imported HTM setup
    const htmChanges = calculateHtmChanges(baseSetup, lastAnalysis.recommendations);
    const matchedComps = new Set(htmChanges.map(c => c.component));
    const unmatched = lastAnalysis.recommendations.filter(r => !matchedComps.has(r.component));

    // Group by section
    const bySec = new Map<string, HtmChange[]>();
    for (const ch of htmChanges) {
      if (!bySec.has(ch.section)) bySec.set(ch.section, []);
      bySec.get(ch.section)!.push(ch);
    }

    if (htmChanges.length === 0 && unmatched.length === 0) {
      const note = document.createElement('div');
      note.style.cssText = 'font-size:11px;color:var(--text-muted)';
      note.textContent = 'No matching parameters found in this setup for the current recommendations.';
      exportChangesList.appendChild(note);
    } else {
      // Disclaimer: approximate values
      if (htmChanges.some(c => c.newValue.startsWith('\u2248'))) {
        const disc = document.createElement('p');
        disc.style.cssText = 'font-size:10px;color:var(--text-muted);margin:0 0 6px;line-height:1.5;border-left:2px solid var(--text-muted);padding-left:6px';
        disc.textContent = '\u2248 values are approximate (\u00b15%). iRacing uses discrete click steps \u2014 select the nearest available value in the garage.';
        exportChangesList.appendChild(disc);
      }
      // Matched changes with exact values
      for (const [section, changes] of bySec) {
        const secHeader = document.createElement('p');
        secHeader.className = 'section-header';
        secHeader.style.marginTop = '6px';
        secHeader.textContent = section;
        exportChangesList.appendChild(secHeader);

        for (const ch of changes) {
          const row = document.createElement('div');
          row.style.cssText = 'display:grid;grid-template-columns:1fr auto auto auto;align-items:center;gap:8px;padding:5px 8px;background:var(--surface);border-radius:6px;margin-bottom:3px';
          row.innerHTML = `
            <span style="font-size:13px;font-weight:600;color:var(--text)">${esc(ch.label)}</span>
            <span style="font-size:13px;color:var(--text-muted)">${esc(ch.oldValue)}</span>
            <span style="font-size:13px;color:var(--text-muted)">→</span>
            <span style="font-size:15px;font-weight:700;color:var(--accent2)">${esc(ch.newValue)}</span>`;
          exportChangesList.appendChild(row);
        }
      }

      // Unmatched — show direction only
      if (unmatched.length > 0) {
        const unmatchedHdr = document.createElement('p');
        unmatchedHdr.className = 'section-header';
        unmatchedHdr.style.marginTop = '6px';
        unmatchedHdr.textContent = 'Additional adjustments (apply manually)';
        exportChangesList.appendChild(unmatchedHdr);
        for (const rec of unmatched) {
          const row = document.createElement('div');
          row.style.cssText = 'padding:5px 8px;background:var(--surface);border-radius:6px;margin-bottom:3px;display:flex;flex-direction:column;gap:2px';
          const impColor = rec.impact === 'high' ? 'var(--red,#e74c3c)' : rec.impact === 'medium' ? 'var(--yellow,#f39c12)' : 'var(--text-muted)';
          const loc = COMPONENT_LOCATIONS[rec.component];
          row.innerHTML = `<div style="display:flex;gap:6px;align-items:center">
            <span style="font-size:13px;font-weight:600;color:var(--text)">${esc(rec.component)}</span>
            <span style="font-size:11px;color:${impColor};text-transform:uppercase;font-weight:700">${esc(rec.impact)}</span>
          </div>
          <div style="font-size:13px;color:var(--accent2)">${esc(rec.direction)}</div>
          ${loc ? `<div style="font-size:12px;color:#5bb8f5;margin-top:1px">📍 ${esc(loc)}</div>` : ''}`;
          exportChangesList.appendChild(row);
        }
      }

      exportSkippedNote.style.display = 'none';
    }

    // Refresh garage highlights
    if (garageSections.children.length > 0) renderGarageView(baseSetup);
  } else {
    // No setup imported — just show recommendation directions
    for (const rec of lastAnalysis.recommendations) {
      const row = document.createElement('div');
      row.style.cssText = 'padding:6px 0;border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:2px';
      const impColor = rec.impact === 'high' ? 'var(--red,#e74c3c)' : rec.impact === 'medium' ? 'var(--yellow,#f39c12)' : 'var(--text-muted)';
      const loc = COMPONENT_LOCATIONS[rec.component];
      row.innerHTML = `<div style="display:flex;align-items:center;gap:6px">
        <span style="font-size:13px;font-weight:600;color:var(--text)">${esc(rec.component)}</span>
        <span style="font-size:11px;color:${impColor};text-transform:uppercase;font-weight:700">${esc(rec.impact)}</span>
      </div>
      <div style="font-size:13px;color:var(--accent2)">${esc(rec.direction)}</div>
      <div style="font-size:12px;color:var(--text-muted)">${esc(rec.explanation)}</div>
      ${loc ? `<div style="font-size:12px;color:#5bb8f5;margin-top:1px">📍 ${esc(loc)}</div>` : ''}`;
      exportChangesList.appendChild(row);
    }
    exportSkippedNote.textContent = 'Import your setup in Step 1 to see exact target values.';
    exportSkippedNote.style.display = '';
  }
}

btnGotoExport.addEventListener('click', () => goToPanel('export'));

btnExportText.addEventListener('click', () => {
  if (!lastAnalysis) return;

  const htmChanges = baseSetup ? calculateHtmChanges(baseSetup, lastAnalysis.recommendations) : [];
  const matchedComps = new Set(htmChanges.map(c => c.component));
  const unmatchedRecs = lastAnalysis.recommendations.filter(r => !matchedComps.has(r.component));
  const snap: any = (window as any).__lastSnap;
  const car = lastAnalysis.carName || snap?.session?.carName || '';
  const weatherSnap = snap?.weather;

  const lines: string[] = [
    `ApexSense Setup Recommendations`,
    `Car: ${car}`,
    `Track: ${lastAnalysis.trackName ?? ''}`,
    `Problem: ${lastAnalysis.problemLabel ?? lastAnalysis.problem ?? ''}`,
    ...(lastAnalysis.detectedProblem ? [`Auto-detected: ${lastAnalysis.detectedProblem}`] : []),
    ...(lastAnalysis.sessionMode ? [`Mode: ${lastAnalysis.sessionMode === 'qualify' ? 'Qualifying' : 'Race'}`] : []),
    ...(lastAnalysis.sessionLength ? [`Session length: ${lastAnalysis.sessionLength}`] : []),
    ...(lastAnalysis.goalLabels?.length ? [`Priorities: ${lastAnalysis.goalLabels.join(', ')}`] : []),
    `Confidence: ${lastAnalysis.confidence}`,
    ...(weatherSnap ? [`Conditions: air ${weatherSnap.airTempC?.toFixed(0)}°C, track ${weatherSnap.trackTempC?.toFixed(0)}°C`] : []),
    ``,
  ];

  if (htmChanges.length > 0) {
    lines.push(`EXACT CHANGES (from your imported setup):`);
    lines.push(``);
    const bySec = new Map<string, typeof htmChanges>();
    for (const ch of htmChanges) {
      if (!bySec.has(ch.section)) bySec.set(ch.section, []);
      bySec.get(ch.section)!.push(ch);
    }
    for (const [section, changes] of bySec) {
      lines.push(`  [ ${section} ]`);
      for (const ch of changes) {
        lines.push(`    ${ch.label}: ${ch.oldValue}  →  ${ch.newValue}`);
      }
      lines.push(``);
    }
  }

  if (unmatchedRecs.length > 0) {
    lines.push(`ADDITIONAL ADJUSTMENTS (apply manually in iRacing Garage):`);
    lines.push(``);
    for (const r of unmatchedRecs) {
      lines.push(`  [${r.impact.toUpperCase()}] ${r.component}`);
      lines.push(`    ${r.direction}`);
      lines.push(``);
    }
  }

  lines.push(`TELEMETRY OBSERVATIONS:`);
  for (const i of lastAnalysis.insights) lines.push(`  • ${i.signal}: ${i.value}`);
  lines.push(``);
  lines.push(`FULL RECOMMENDATIONS:`);
  for (const r of lastAnalysis.recommendations)
    lines.push(`  [${r.impact.toUpperCase()}] ${r.component}\n    ${r.direction}\n    ${r.explanation}`);

  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ApexSense_${(lastAnalysis.problem ?? 'report').replace(/\s+/g, '_')}.txt`;
  a.click();
  URL.revokeObjectURL(url);
});

function showExportStatus(msg: string): void {
  exportStatus.textContent = msg;
  exportStatus.style.display = '';
  setTimeout(() => { exportStatus.style.display = 'none'; }, 5000);
}

// ─── History ──────────────────────────────────────────────────────────────────

btnRefreshHist.addEventListener('click', loadHistory);

async function loadHistory(): Promise<void> {
  const sessions = await window.coachAPI.getSessions();
  historyList.innerHTML = '';
  if (sessions.length === 0) {
    historyList.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📋</span>
        No sessions recorded yet. Run an analysis to start building your history.
      </div>`;
    return;
  }
  for (const s of sessions) {
    const div = document.createElement('div');
    div.className = 'history-item';
    const fbTag = s.userFeedback
      ? `<span class="hist-feedback-tag ${s.userFeedback === 'helpful' ? 'helpful' : 'not-helpful'}">${s.userFeedback === 'helpful' ? '👍 Helpful' : '👎 Not helpful'}</span>`
      : '';
    const logoFile = resolveCarLogo(s.carPath ?? '', s.carName ?? '');
    const logoHtml = logoFile
      ? `<img src="${LOGO_BASE}${logoFile}" alt="${esc(s.carName)}" style="height:20px;width:auto;object-fit:contain;opacity:0.85;flex-shrink:0;" />`
      : '';
    div.innerHTML = `
      <div class="hist-header">
        <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:0">
          ${logoHtml}
          <span class="hist-title">${esc(s.problem.replace(/_/g, ' '))}</span>
        </div>
        ${fbTag}
        <span class="hist-date">${formatDate(s.timestamp)}</span>
      </div>
      <div class="hist-meta">${esc(s.carName)} · ${esc(s.trackName)}</div>
      ${s.notes ? `<div class="hist-meta" style="color:var(--text);font-style:italic;margin-top:3px">${esc(s.notes)}</div>` : ''}`;
    historyList.appendChild(div);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function esc(s: string): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatLapTime(t: number): string {
  if (!t || t <= 0) return '–';
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(3).padStart(6, '0');
  return `${m}:${s}`;
}

// ─── Standings renderer ───────────────────────────────────────────────────────

function updateStandings(entries: any[], sessionType: string): void {
  if (!standingsSessionType || !standingsEmpty || !standingsTableWrap || !standingsTbody) return;
  standingsSessionType.textContent = sessionType || '';

  if (!entries || entries.length === 0) {
    standingsEmpty.style.display = '';
    standingsTableWrap.style.display = 'none';
    return;
  }

  standingsEmpty.style.display = 'none';
  standingsTableWrap.style.display = '';

  const rows = entries.map((entry: any) => {
    const iso = clubNameToIso(entry.flairName || entry.clubName || '');
    const flagHtml = iso
      ? `<img class="standings-flag" src="${flagSrc(iso)}" alt="${entry.flairName || ''}" title="${entry.flairName || ''}" onerror="this.style.display='none'">`
      : '';

    const bestStr = formatLapTime(entry.bestLapTime);
    const lastStr = formatLapTime(entry.lastLapTime);
    const posStr  = entry.position > 0 ? String(entry.position) : '–';
    const isPlayer = entry.isPlayer ? ' class="is-player"' : '';

    // Sanitise driver name to avoid XSS
    const safeDriver = String(entry.userName || 'Driver')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeCar = String(entry.carNumber || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    return `<tr${isPlayer}>
      <td class="col-pos">${posStr}</td>
      <td class="col-flag">${flagHtml}</td>
      <td class="col-driver">${safeDriver}</td>
      <td class="col-car">${safeCar}</td>
      <td class="col-best">${bestStr}</td>
      <td class="col-last">${lastStr}</td>
    </tr>`;
  });

  standingsTbody.innerHTML = rows.join('');
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Store last snapshot for analysis context
window.coachAPI.onCoachTelemetry((snapshot: any) => {
  (window as any).__lastSnap = snapshot;
});
