/**
 * Standings overlay renderer.
 * Receives `standings-update` IPC messages (full TelemetrySnapshot) and
 * renders a live driver standings table with configurable column visibility,
 * position-change animations, and incident-based aggression scoring.
 */

interface StandingsAPI {
  onStandingsUpdate: (cb: (snapshot: any) => void) => void;
  onConfigUpdate:    (cb: (config: any)   => void) => void;
  getConfig: () => Promise<any>;
  saveColumnToggles: (cols: Record<string, boolean>) => Promise<void>;
  setIgnoreMouseEvents: (ignore: boolean) => void;
}

interface Window {
  standingsAPI: StandingsAPI;
}

// ─── DOM refs ────────────────────────────────────────────────────────────────

const dragBar        = document.getElementById('drag-bar')!;
const sessionLabel   = document.getElementById('session-label')!;
const statusMsg      = document.getElementById('status-message')!;
const standingsThead = document.getElementById('standings-thead')!;
const standingsTbody = document.getElementById('standings-tbody')!;
const tableWrap      = document.getElementById('table-wrap')!;

// ─── Scroll-while-locked ──────────────────────────────────────────────────────
// Only toggle mouse-event pass-through when the overlay is actually locked.
let isLocked = false;

tableWrap.addEventListener('mouseenter', () => {
  if (isLocked) window.standingsAPI.setIgnoreMouseEvents(false);
});
tableWrap.addEventListener('mouseleave', () => {
  if (isLocked) window.standingsAPI.setIgnoreMouseEvents(true);
});

const togFlags     = document.getElementById('tog-flags')     as HTMLInputElement;
const togCar       = document.getElementById('tog-car')       as HTMLInputElement;
const togMake      = document.getElementById('tog-make')      as HTMLInputElement;
const togIRating   = document.getElementById('tog-irating')   as HTMLInputElement;
const togSafety    = document.getElementById('tog-safety')    as HTMLInputElement;
const togBest      = document.getElementById('tog-best')      as HTMLInputElement;
const togLast      = document.getElementById('tog-last')      as HTMLInputElement;
const togIncidents = document.getElementById('tog-incidents') as HTMLInputElement;

// ─── State ───────────────────────────────────────────────────────────────────

let cols = {
  flags:     true,
  car:       true,
  make:      true,
  irating:   false,
  safety:    false,
  best:      true,
  last:      true,
  incidents: true,
};

/** carIdx → last known position (1-based). Used to detect position changes. */
const prevPositions = new Map<number, number>();

/** carIdx → whether this driver has been seen before (for "new" animation). */
const seenDrivers = new Set<number>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(t: number): string {
  if (!t || t <= 0) return '–';
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(3).padStart(6, '0');
  return `${m}:${s}`;
}

function licClass(lic: string): string {
  const l = (lic || '').trim().toLowerCase();
  if (l.startsWith('r')) return 'lic-r';
  if (l.startsWith('d')) return 'lic-d';
  if (l.startsWith('c')) return 'lic-c';
  if (l.startsWith('b')) return 'lic-b';
  if (l.startsWith('a')) return 'lic-a';
  if (l.startsWith('p')) return 'lic-p';
  return '';
}

// Resolve asset base URLs from the HTML file's own file:// URL.
// document.baseURI handles spaces automatically (e.g. "iracing%20widget").
// standings.html is at src/renderer/ → two levels up = app root.
const _docBase = new URL('./', document.baseURI).href;           // .../src/renderer/
const FLAG_BASE     = new URL('../../country-flags/svg/', _docBase).href;
const CAR_LOGO_BASE = new URL('../../img/car-logos/', _docBase).href;

// ─── Car brand logo map ─────────────────────────────────────────────────────

const LOGO_MAP: Array<{ pattern: string; logo: string }> = [
  { pattern: 'ligier',       logo: 'ligier.png' },
  { pattern: 'porsche',      logo: 'porsche.png' },
  { pattern: 'mustang',      logo: 'ford-mustang.png' },
  { pattern: 'ford',         logo: 'ford.png' },
  { pattern: 'ferrari',      logo: 'ferrari.png' },
  { pattern: 'bmw_m',        logo: 'bmw-m.png' },
  { pattern: 'bmw',          logo: 'bmw.png' },
  { pattern: 'corvette',     logo: 'chevrolet-corvette.png' },
  { pattern: 'chevrolet',    logo: 'chevrolet.png' },
  { pattern: 'camaro',       logo: 'chevrolet.png' },
  { pattern: 'cadillac',     logo: 'cadillac.png' },
  { pattern: 'acura',        logo: 'acura.png' },
  { pattern: 'arx',          logo: 'acura.png' },
  { pattern: 'honda',        logo: 'honda.png' },
  { pattern: 'civic',        logo: 'honda.png' },
  { pattern: 'audi_r8',      logo: 'audi-sport.png' },
  { pattern: 'audi',         logo: 'audi.png' },
  { pattern: 'rs3',          logo: 'audi.png' },
  { pattern: 'alpine',       logo: 'alpine.png' },
  { pattern: 'aston',        logo: 'aston-martin.png' },
  { pattern: 'mercedes',     logo: 'mercedes-amg.png' },
  { pattern: 'amg',          logo: 'mercedes-amg.png' },
  { pattern: 'mclaren',      logo: 'mclaren.png' },
  { pattern: 'lamborghini',  logo: 'lamborghini.png' },
  { pattern: 'huracan',      logo: 'lamborghini.png' },
  { pattern: 'mazda',        logo: 'mazda.png' },
  { pattern: 'mx5',          logo: 'mazda.png' },
  { pattern: 'nissan',       logo: 'nissan.png' },
  { pattern: 'gt-r',         logo: 'nissan-gt-r.png' },
  { pattern: 'toyota',       logo: 'toyota.png' },
  { pattern: 'gr86',         logo: 'toyota.png' },
  { pattern: 'supra',        logo: 'toyota.png' },
  { pattern: 'subaru',       logo: 'subaru.png' },
  { pattern: 'volkswagen',   logo: 'volkswagen.png' },
  { pattern: 'hyundai',      logo: 'hyundai.png' },
  { pattern: 'elantra',      logo: 'hyundai.png' },
  { pattern: 'radical',      logo: 'radical.png' },
  { pattern: 'lotus',        logo: 'lotus.png' },
  { pattern: 'ginetta',      logo: 'ginetta.png' },
  { pattern: 'riley',        logo: 'riley.png' },
  { pattern: 'mazda',        logo: 'mazda.png' },
];

function resolveCarLogo(carName: string): string | null {
  const h = carName.toLowerCase();
  for (const entry of LOGO_MAP) {
    if (h.includes(entry.pattern)) return entry.logo;
  }
  return null;
}

// ─── Aggression scoring ───────────────────────────────────────────────────────

/**
 * Returns an aggression tier based on incident count and laps completed.
 *  'none'  → 0 incidents
 *  'low'   → 1-2 total, or < 0.3/lap from lap 4 onwards
 *  'med'   → 3-5 total, or 0.3-0.7/lap
 *  'high'  → 6+ total, or >= 0.7/lap (from lap 4 onwards)
 */
function aggressionTier(incidents: number, lap: number): 'none' | 'low' | 'med' | 'high' {
  if (incidents <= 0) return 'none';

  // Early race: use raw count only
  if (lap < 4) {
    if (incidents <= 2) return 'low';
    if (incidents <= 5) return 'med';
    return 'high';
  }

  // Mid/late race: weight by lap count
  const rate = incidents / lap;
  if (rate < 0.3) return 'low';
  if (rate < 0.7) return 'med';
  return 'high';
}

/** Returns the icon and badge class for a given tier. */
function incBadgeHtml(incidents: number, lap: number): string {
  const tier = aggressionTier(incidents, lap);
  if (tier === 'none') return '<span class="inc-badge inc-0"></span>';

  const icon  = tier === 'high' ? '!!' : '!';
  const cls   = tier === 'low' ? 'inc-low' : tier === 'med' ? 'inc-med' : 'inc-high';
  const title = tier === 'high'
    ? `Aggressive — ${incidents}x incidents`
    : tier === 'med'
    ? `Caution — ${incidents}x incidents`
    : `Minor — ${incidents}x incidents`;

  const safeTitle = title.replace(/"/g, '&quot;');
  return `<span class="inc-badge ${cls}" title="${safeTitle}">${icon}&thinsp;${incidents}</span>`;
}

// ─── Club → flag ───────────────────────────────────────────────────────────────────

const CLUB_ISO: Record<string, string> = {
  // United States — FlairName is "United States" for all US drivers
  'United States': 'us',
  // Americas
  'Canada': 'ca', 'Brazil': 'br', 'Argentina': 'ar', 'Chile': 'cl',
  'Mexico': 'mx', 'Colombia': 'co', 'Peru': 'pe', 'Venezuela': 've',
  'Uruguay': 'uy', 'Ecuador': 'ec', 'Bolivia': 'bo', 'Paraguay': 'py',
  'Guatemala': 'gt', 'Costa Rica': 'cr', 'Panama': 'pa', 'Cuba': 'cu',
  'Dominican Republic': 'do', 'Puerto Rico': 'pr',
  // Europe
  'United Kingdom': 'gb', 'England': 'gb', 'Scotland': 'gb', 'Wales': 'gb',
  'Ireland': 'ie', 'France': 'fr', 'Germany': 'de', 'Italy': 'it',
  'Spain': 'es', 'Portugal': 'pt', 'Netherlands': 'nl', 'Belgium': 'be',
  'Switzerland': 'ch', 'Austria': 'at', 'Poland': 'pl', 'Czech Republic': 'cz',
  'Hungary': 'hu', 'Romania': 'ro', 'Bulgaria': 'bg', 'Russia': 'ru',
  'Ukraine': 'ua', 'Turkey': 'tr', 'Greece': 'gr', 'Finland': 'fi',
  'Sweden': 'se', 'Norway': 'no', 'Denmark': 'dk', 'Croatia': 'hr',
  'Slovenia': 'si', 'Serbia': 'rs', 'Slovakia': 'sk', 'Estonia': 'ee',
  'Latvia': 'lv', 'Lithuania': 'lt', 'Luxembourg': 'lu', 'Iceland': 'is',
  'Albania': 'al', 'Bosnia and Herzegovina': 'ba', 'Malta': 'mt', 'Cyprus': 'cy',
  'North Macedonia': 'mk', 'Montenegro': 'me', 'Kosovo': 'xk',
  // Asia-Pacific
  'Japan': 'jp', 'South Korea': 'kr', 'Korea': 'kr', 'China': 'cn',
  'India': 'in', 'Australia': 'au', 'New Zealand': 'nz',
  'Singapore': 'sg', 'Malaysia': 'my', 'Thailand': 'th', 'Indonesia': 'id',
  'Taiwan': 'tw', 'Hong Kong': 'hk', 'Philippines': 'ph', 'Vietnam': 'vn',
  'Pakistan': 'pk', 'Bangladesh': 'bd', 'Sri Lanka': 'lk',
  // Middle East & Africa
  'United Arab Emirates': 'ae', 'Saudi Arabia': 'sa', 'Israel': 'il',
  'South Africa': 'za', 'Egypt': 'eg', 'Morocco': 'ma', 'Nigeria': 'ng',
  'Kuwait': 'kw', 'Qatar': 'qa', 'Bahrain': 'bh', 'Oman': 'om',
};

function clubNameToIso(flair: string): string | null {
  if (!flair || flair === 'None') return null;
  const exact = CLUB_ISO[flair];
  if (exact) return exact;
  const lc = flair.toLowerCase();
  for (const [k, v] of Object.entries(CLUB_ISO)) {
    if (k.toLowerCase() === lc) return v;
  }
  return null;
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderHeader(): void {
  const cells = ['<th class="col-pos">P</th>'];
  if (cols.flags)     cells.push('<th class="col-flag"></th>');
  cells.push('<th class="col-driver">Driver</th>');
  if (cols.car)       cells.push('<th class="col-car">#</th>');
  if (cols.make)      cells.push('<th class="col-make">Car</th>');
  if (cols.irating)   cells.push('<th class="col-irating">iR</th>');
  if (cols.safety)    cells.push('<th class="col-safety">SR</th>');
  if (cols.best)      cells.push('<th class="col-best">Best</th>');
  if (cols.last)      cells.push('<th class="col-last">Last</th>');
  if (cols.incidents) cells.push('<th class="col-inc" title="Incidents">INC</th>');
  standingsThead.innerHTML = `<tr>${cells.join('')}</tr>`;
}

function renderRows(entries: any[]): void {
  if (!entries || entries.length === 0) {
    statusMsg.classList.remove('hidden');
    standingsTbody.innerHTML = '';
    prevPositions.clear();
    seenDrivers.clear();
    return;
  }
  statusMsg.classList.add('hidden');

  // ── Group by car class ───────────────────────────────────────────────────
  // Preserve insertion order so classes appear in the order of their fastest car.
  const classOrder: number[] = [];
  const classMap = new Map<number, { name: string; color: number; entries: any[] }>();
  for (const e of entries) {
    const id = typeof e.carClassId === 'number' ? e.carClassId : 0;
    if (!classMap.has(id)) {
      classOrder.push(id);
      classMap.set(id, { name: e.carClassName || '', color: e.carClassColor ?? 0xFFFFFF, entries: [] });
    }
    classMap.get(id)!.entries.push(e);
  }
  const multiClass = classMap.size > 1;

  const totalCols = 1
    + (cols.flags ? 1 : 0)
    + 1 // driver
    + (cols.car ? 1 : 0)
    + (cols.make ? 1 : 0)
    + (cols.irating ? 1 : 0)
    + (cols.safety ? 1 : 0)
    + (cols.best ? 1 : 0)
    + (cols.last ? 1 : 0)
    + (cols.incidents ? 1 : 0);

  const html: string[] = [];

  for (const classId of classOrder) {
    const cls = classMap.get(classId)!;

    // Class separator header row (only when multiple classes present)
    if (multiClass) {
      const r = (cls.color >> 16) & 0xFF;
      const g = (cls.color >> 8) & 0xFF;
      const b = cls.color & 0xFF;
      const hexColor = `rgb(${r},${g},${b})`;
      const safeName = String(cls.name || 'Class')
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      html.push(
        `<tr class="class-header-row">` +
        `<td colspan="${totalCols}">` +
        `<span class="class-color-dot" style="background:${hexColor}"></span>` +
        `${safeName}` +
        `</td></tr>`
      );
    }

    // Driver rows
    for (const e of cls.entries) {
      const idx = e.carIdx as number;
      const pos = e.position as number;

      // ── Determine animation marker ────────────────────────────────────────
      let movedAttr = '';
      if (!seenDrivers.has(idx)) {
        movedAttr = 'data-moved="new"';
      } else {
        const prev = prevPositions.get(idx) ?? 0;
        if (prev > 0 && pos > 0 && prev !== pos) {
          movedAttr = prev > pos ? 'data-moved="up"' : 'data-moved="down"';
        }
      }

      // ── Position cell with delta badge ───────────────────────────────────
      const posStr = pos > 0 ? String(pos) : '–';
      const prev   = prevPositions.get(idx) ?? 0;
      let deltaHtml = '';
      if (prev > 0 && pos > 0 && prev !== pos) {
        const delta = prev - pos;
        const deltaCls = delta > 0 ? 'up' : 'down';
        const arrow = delta > 0 ? '▲' : '▼';
        deltaHtml = `<span class="pos-delta ${deltaCls}">${arrow}${Math.abs(delta)}</span>`;
      }
      const posCell = `<td class="col-pos"><span class="pos-wrap"><span>${posStr}</span>${deltaHtml}</span></td>`;

      // ── Aggression row class ──────────────────────────────────────────────
      const incidents = typeof e.incidents === 'number' ? e.incidents : 0;
      const lap       = typeof e.lap === 'number' ? e.lap : 0;
      const tier      = aggressionTier(incidents, lap);
      const aggrClass = tier === 'none' ? '' : tier === 'low' ? '' : ` aggr-${tier}`;
      const playerClass = e.isPlayer ? ' is-player' : '';
      const rowClass    = `class="${(playerClass + aggrClass).trim()}"`;

      const safeName = String(e.userName || 'Driver')
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const safeCar  = String(e.carNumber || '')
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

      const iso      = cols.flags ? clubNameToIso(e.flairName || '') : null;
      const flagCell = cols.flags
        ? `<td class="col-flag">${iso ? `<img class="standings-flag" src="${FLAG_BASE}${iso}.svg" alt="" onerror="this.style.display='none'">` : ''}</td>`
        : '';

      const safeMake    = String(e.carMake || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const carLogoFile = resolveCarLogo(String(e.carMake || ''));
      const carLogoImg  = carLogoFile
        ? `<img class="car-brand-logo" src="${CAR_LOGO_BASE}${carLogoFile}" alt="" onerror="this.style.display='none'" />`
        : '';
      const carCell     = cols.car     ? `<td class="col-car">${safeCar}</td>` : '';
      const makeCell    = cols.make    ? `<td class="col-make">${carLogoImg}${safeMake || '–'}</td>` : '';
      const iRatingCell = cols.irating ? `<td class="col-irating">${e.iRating && e.iRating > 0 ? e.iRating : '–'}</td>` : '';
      const licSafe     = String(e.licString || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const safetyCell  = cols.safety  ? `<td class="col-safety ${licClass(e.licString)}">${licSafe || '–'}</td>` : '';
      const bestCell    = cols.best    ? `<td class="col-best">${fmt(e.bestLapTime)}</td>` : '';
      const lastCell    = cols.last    ? `<td class="col-last">${fmt(e.lastLapTime)}</td>` : '';
      const incCell     = cols.incidents ? `<td class="col-inc">${incBadgeHtml(incidents, lap)}</td>` : '';

      html.push(
        `<tr ${rowClass} ${movedAttr} data-caridx="${idx}">` +
        `${posCell}${flagCell}<td class="col-driver">${safeName}</td>` +
        `${carCell}${makeCell}${iRatingCell}${safetyCell}${bestCell}${lastCell}${incCell}` +
        `</tr>`
      );
    }
  }

  standingsTbody.innerHTML = html.join('');

  // ── Update tracking state after render ───────────────────────────────────
  for (const e of entries) {
    seenDrivers.add(e.carIdx as number);
    if ((e.position as number) > 0) {
      prevPositions.set(e.carIdx as number, e.position as number);
    }
  }
}

function applyToggles(): void {
  cols.flags     = togFlags.checked;
  cols.car       = togCar.checked;
  cols.make      = togMake.checked;
  cols.irating   = togIRating.checked;
  cols.safety    = togSafety.checked;
  cols.best      = togBest.checked;
  cols.last      = togLast.checked;
  cols.incidents = togIncidents.checked;
  renderHeader();
  // Persist to config
  window.standingsAPI.saveColumnToggles(cols);
}

// ─── Toggle event listeners ───────────────────────────────────────────────────

[togFlags, togCar, togMake, togIRating, togSafety, togBest, togLast, togIncidents].forEach((t) => {
  t.addEventListener('change', applyToggles);
});

// ─── Config init ──────────────────────────────────────────────────────────────

(async () => {
  const cfg = await window.standingsAPI.getConfig();
  applyConfig(cfg);
  renderHeader();
})();

function applyConfig(cfg: any): void {
  if (!cfg) return;
  isLocked = cfg.locked ?? false;
  togFlags.checked     = cfg.standingsShowFlags         ?? true;
  togCar.checked       = cfg.standingsShowCarNumber     ?? true;
  togMake.checked      = cfg.standingsShowMake          ?? true;
  togIRating.checked   = cfg.standingsShowIRating       ?? false;
  togSafety.checked    = cfg.standingsShowSafetyRating  ?? false;
  togBest.checked      = cfg.standingsShowBestLap       ?? true;
  togLast.checked      = cfg.standingsShowLastLap       ?? true;
  togIncidents.checked = cfg.standingsShowIncidents     ?? true;
  cols.flags     = togFlags.checked;
  cols.car       = togCar.checked;
  cols.make      = togMake.checked;
  cols.irating   = togIRating.checked;
  cols.safety    = togSafety.checked;
  cols.best      = togBest.checked;
  cols.last      = togLast.checked;
  cols.incidents = togIncidents.checked;
}

window.standingsAPI.onConfigUpdate((cfg) => {
  applyConfig(cfg);
  renderHeader();
});

// ─── Live telemetry ───────────────────────────────────────────────────────────

window.standingsAPI.onStandingsUpdate((snapshot: any) => {
  if (!snapshot.connected) {
    statusMsg.textContent = 'Waiting for iRacing…';
    statusMsg.classList.remove('hidden');
    standingsTbody.innerHTML = '';
    sessionLabel.textContent = '';
    prevPositions.clear();
    seenDrivers.clear();
    return;
  }

  sessionLabel.textContent = snapshot.session?.sessionType ?? '';
  renderRows(snapshot.standings ?? []);
});
