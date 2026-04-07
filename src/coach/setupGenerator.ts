/**
 * Setup Generator
 *
 * Takes a parsed iRacing .sto base setup and a list of coach recommendations,
 * applies directional adjustments to matching parameters, and serialises the
 * result back into a valid .sto string that iRacing can load.
 */

import { ParsedSetup } from './setupParser';
import { CoachRecommendation } from './coachEngine';

// ─── Key-pattern map ──────────────────────────────────────────────────────────
// Maps lowercased component name fragments → substrings to search for in .sto keys.
// First matching rule wins.

interface KeyRule {
  componentFragments: string[];
  keyPatterns: string[];
  htmLabels: string[];
  /** Exact section names (case-insensitive) to restrict matching. If empty, uses front/rear inference. */
  htmSections: string[];
  isIndex: boolean;
  positiveDirection: string[];
  /** Flip delta direction (e.g. spring perch offset: more = LOWER ride height) */
  invertDelta?: boolean;
}

export interface HtmChange {
  section: string;
  label: string;
  oldValue: string;
  newValue: string;
  component: string;
  direction: string;
}

const KEY_RULES: KeyRule[] = [
  {
    componentFragments: ['front anti-roll', 'front arb', 'front anti roll'],
    keyPatterns: ['frontarb', 'frontrollbar', 'frontswaybar'],
    htmLabels: ['arb setting'],
    htmSections: ['front/brakes'],
    isIndex: true,
    positiveDirection: ['stiffen', 'increase', 'harder', 'more'],
  },
  {
    componentFragments: ['rear anti-roll', 'rear arb', 'rear anti roll'],
    keyPatterns: ['reararb', 'rearrollbar', 'rearswaybar'],
    htmLabels: ['arb setting'],
    htmSections: ['rear'],
    isIndex: true,
    positiveDirection: ['stiffen', 'increase', 'harder', 'more'],
  },
  {
    componentFragments: ['front spring'],
    keyPatterns: ['frontspringrate', 'frontspring'],
    htmLabels: ['spring rate'],
    htmSections: ['left front', 'right front'],
    isIndex: false,
    positiveDirection: ['stiffen', 'increase', 'harder', 'more'],
  },
  {
    componentFragments: ['rear spring'],
    keyPatterns: ['rearspringrate', 'rearspring'],
    htmLabels: ['spring rate'],
    htmSections: ['left rear', 'right rear'],
    isIndex: false,
    positiveDirection: ['stiffen', 'increase', 'harder', 'more'],
  },
  {
    componentFragments: ['front damper', 'front shock', 'front bump'],
    keyPatterns: ['frontshockcollar', 'frontbump', 'frontdamper'],
    htmLabels: ['bump stiffness'],
    htmSections: ['left front', 'right front'],
    isIndex: true,
    positiveDirection: ['stiffen', 'increase', 'harder', 'more'],
  },
  {
    componentFragments: ['front rebound'],
    keyPatterns: ['frontrebound'],
    htmLabels: ['rebound stiffness'],
    htmSections: ['left front', 'right front'],
    isIndex: true,
    positiveDirection: ['stiffen', 'increase', 'harder', 'more'],
  },
  {
    componentFragments: ['rear damper', 'rear shock', 'rear bump'],
    keyPatterns: ['rearshockcollar', 'rearbump', 'reardamper'],
    htmLabels: ['bump stiffness'],
    htmSections: ['left rear', 'right rear'],
    isIndex: true,
    positiveDirection: ['stiffen', 'increase', 'harder', 'more'],
  },
  {
    componentFragments: ['rear rebound'],
    keyPatterns: ['rearrebound'],
    htmLabels: ['rebound stiffness'],
    htmSections: ['left rear', 'right rear'],
    isIndex: true,
    positiveDirection: ['stiffen', 'increase', 'harder', 'more'],
  },
  // ── 4-way dampers (LMP / prototype: LS comp, HS comp, LS rebound, HS rebound) ──
  {
    componentFragments: ['front ls comp', 'front ls compression', 'front low speed comp'],
    keyPatterns: ['lflscompdamping', 'rflscompdamping', 'frontlscomp', 'lscompdamping'],
    htmLabels: ['ls comp damping'],
    htmSections: ['left front damper', 'right front damper'],
    isIndex: true,
    positiveDirection: ['stiffen', 'increase', 'harder', 'more'],
  },
  {
    componentFragments: ['front hs comp', 'front hs compression', 'front high speed comp'],
    keyPatterns: ['lfhscompdamping', 'rfhscompdamping', 'fronthscomp', 'hscompdamping'],
    htmLabels: ['hs comp damping'],
    htmSections: ['left front damper', 'right front damper'],
    isIndex: true,
    positiveDirection: ['stiffen', 'increase', 'harder', 'more'],
  },
  {
    componentFragments: ['front ls rebound', 'front ls rbd', 'front low speed rebound'],
    keyPatterns: ['lflsrbddamping', 'rflsrbddamping', 'frontlsrbd', 'lsrbddamping'],
    htmLabels: ['ls rbd damping'],
    htmSections: ['left front damper', 'right front damper'],
    isIndex: true,
    positiveDirection: ['stiffen', 'increase', 'harder', 'more'],
  },
  {
    componentFragments: ['front hs rebound', 'front hs rbd', 'front high speed rebound'],
    keyPatterns: ['lfhsrbddamping', 'rfhsrbddamping', 'fronthsrbd', 'hsrbddamping'],
    htmLabels: ['hs rbd damping'],
    htmSections: ['left front damper', 'right front damper'],
    isIndex: true,
    positiveDirection: ['stiffen', 'increase', 'harder', 'more'],
  },
  {
    componentFragments: ['rear ls comp', 'rear ls compression', 'rear low speed comp'],
    keyPatterns: ['lrlscompdamping', 'rrlscompdamping', 'rearlscomp', 'lscompdamping'],
    htmLabels: ['ls comp damping'],
    htmSections: ['left rear damper', 'right rear damper'],
    isIndex: true,
    positiveDirection: ['stiffen', 'increase', 'harder', 'more'],
  },
  {
    componentFragments: ['rear hs comp', 'rear hs compression', 'rear high speed comp'],
    keyPatterns: ['lrhscompdamping', 'rrhscompdamping', 'rearhscomp', 'hscompdamping'],
    htmLabels: ['hs comp damping'],
    htmSections: ['left rear damper', 'right rear damper'],
    isIndex: true,
    positiveDirection: ['stiffen', 'increase', 'harder', 'more'],
  },
  {
    componentFragments: ['rear ls rebound', 'rear ls rbd', 'rear low speed rebound'],
    keyPatterns: ['lrlsrbddamping', 'rrlsrbddamping', 'rearlsrbd', 'lsrbddamping'],
    htmLabels: ['ls rbd damping'],
    htmSections: ['left rear damper', 'right rear damper'],
    isIndex: true,
    positiveDirection: ['stiffen', 'increase', 'harder', 'more'],
  },
  {
    componentFragments: ['rear hs rebound', 'rear hs rbd', 'rear high speed rebound'],
    keyPatterns: ['lrhsrbddamping', 'rrhsrbddamping', 'rearhsrbd', 'hsrbddamping'],
    htmLabels: ['hs rbd damping'],
    htmSections: ['left rear damper', 'right rear damper'],
    isIndex: true,
    positiveDirection: ['stiffen', 'increase', 'harder', 'more'],
  },
  {
    componentFragments: ['brake bias', 'brake balance'],
    keyPatterns: ['brakebalance', 'brakebias'],
    htmLabels: ['brake pressure bias', 'brake balance'],
    htmSections: ['in-car dials'],
    isIndex: false,
    positiveDirection: ['forward', 'front', 'increase forward'],
  },
  {
    componentFragments: ['front wing', 'front aero', 'front downforce', 'nose wing'],
    keyPatterns: ['frontwing', 'nosewing', 'frontdownforce'],
    htmLabels: ['front wing', 'nose wing'],
    htmSections: ['front/brakes', 'left front', 'right front'],
    isIndex: true,
    positiveDirection: ['increase', 'more', 'raise', 'add'],
  },
  {
    componentFragments: ['rear wing', 'rear aero', 'rear downforce'],
    keyPatterns: ['rearwing', 'reardecklid', 'reardownforce', 'rearsplitter'],
    htmLabels: ['wing angle', 'rear wing'],
    htmSections: ['rear'],
    isIndex: true,
    positiveDirection: ['increase', 'more', 'raise', 'add'],
  },
  {
    componentFragments: ['front camber'],
    keyPatterns: ['frontcamber', 'leftfrontcamber', 'rightfrontcamber'],
    htmLabels: ['camber'],
    htmSections: ['left front', 'right front'],
    isIndex: false,
    positiveDirection: ['less negative', 'reduce', 'decrease'],
  },
  {
    componentFragments: ['rear camber'],
    keyPatterns: ['rearcamber', 'leftrearcamber', 'rightrearcamber'],
    htmLabels: ['camber'],
    htmSections: ['left rear', 'right rear'],
    isIndex: false,
    positiveDirection: ['less negative', 'reduce', 'decrease'],
  },
  {
    componentFragments: ['front toe'],
    keyPatterns: ['fronttoein', 'lefttoe', 'righttoe'],
    htmLabels: ['toe-in', 'toe in'],
    htmSections: ['front/brakes', 'left front', 'right front'],
    isIndex: false,
    positiveDirection: ['add toe-in', 'increase', 'more toe-in'],
  },
  {
    componentFragments: ['rear toe'],
    keyPatterns: ['reartoein', 'leftreartoe', 'rightreartoe'],
    htmLabels: ['toe-in', 'toe in'],
    htmSections: ['left rear', 'right rear'],
    isIndex: false,
    positiveDirection: ['add toe-in', 'increase', 'more toe-in'],
  },
  {
    componentFragments: ['tyre pressure (front)', 'tire pressure (front)', 'front tyre', 'front tire'],
    keyPatterns: ['leftfrontcoldpressure', 'rightfrontcoldpressure'],
    htmLabels: ['starting pressure'],
    htmSections: ['left front', 'right front'],
    isIndex: false,
    positiveDirection: ['increase', 'raise', 'higher'],
  },
  {
    componentFragments: ['tyre pressure (rear)', 'tire pressure (rear)', 'rear tyre', 'rear tire'],
    keyPatterns: ['leftrearcoldpressure', 'rightrearcoldpressure'],
    htmLabels: ['starting pressure'],
    htmSections: ['left rear', 'right rear'],
    isIndex: false,
    positiveDirection: ['increase', 'raise', 'higher'],
  },
  {
    componentFragments: ['differential', 'diff '],
    keyPatterns: ['difframp', 'diffentry', 'diffpreload'],
    htmLabels: ['differential', 'diff preload', 'diff ramp', 'rear differential'],
    htmSections: [],
    isIndex: true,
    positiveDirection: ['lock', 'stiffen', 'increase', 'more'],
  },
  {
    componentFragments: ['nose wedge', 'left rear wedge', 'wedge'],
    keyPatterns: ['wedge', 'jackingnuts'],
    htmLabels: ['cross weight'],
    htmSections: ['front/brakes'],
    isIndex: false,
    positiveDirection: ['add', 'increase', 'more'],
  },
  {
    componentFragments: ['rear track bar', 'panhard bar', 'track bar'],
    keyPatterns: ['trackbar', 'panhardbar'],
    htmLabels: ['track bar', 'panhard bar'],
    htmSections: [],
    isIndex: false,
    positiveDirection: ['raise', 'higher', 'increase'],
  },
  {
    componentFragments: ['ride height (front)', 'front ride height'],
    keyPatterns: ['frontride'],
    htmLabels: ['spring perch offset', 'ride height'],
    htmSections: ['left front', 'right front'],
    isIndex: false,
    positiveDirection: ['raise', 'higher', 'increase'],
    invertDelta: true,
  },
  {
    componentFragments: ['ride height (rear)', 'rear ride height'],
    keyPatterns: ['rearride'],
    htmLabels: ['spring perch offset', 'ride height'],
    htmSections: ['left rear', 'right rear'],
    isIndex: false,
    positiveDirection: ['raise', 'higher', 'increase'],
    invertDelta: true,
  },
];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AppliedChange {
  section: string;
  key: string;
  oldValue: string;
  newValue: string;
  recommendation: string;  // component + direction label
}

export interface GenerateResult {
  content: string;          // modified .sto file string
  applied: AppliedChange[];
  skipped: string[];        // component names we couldn't find in the setup
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isPositive(direction: string, positiveWords: string[]): boolean {
  const d = direction.toLowerCase();
  const negWords = ['soften', 'reduce', 'decrease', 'less', 'lower', 'rearward', 'remove'];
  for (const nw of negWords) if (d.includes(nw)) return false;
  for (const pw of positiveWords) if (d.includes(pw)) return true;
  return false; // default to negative (soften)
}

function applyDelta(raw: string, isIdx: boolean, positive: boolean): string | null {
  const trimmed = raw.trim();
  // Parse: number + optional unit
  const match = trimmed.match(/^(-?[\d.]+)(\s*.*)$/);
  if (!match) return null;

  const num = parseFloat(match[1]);
  const suffix = match[2]; // preserves space + unit

  if (isNaN(num)) return null;

  let newNum: number;
  if (isIdx) {
    // Index / integer → ±1
    newNum = Math.round(num) + (positive ? 1 : -1);
    if (newNum < 0) newNum = 0;
    return `${newNum}${suffix}`;
  } else {
    // Float → ±5%
    const delta = Math.abs(num) * 0.05;
    newNum = num + (positive ? delta : -delta);
    // Keep same decimal places as original (integers stay integers)
    const decimals = (match[1].split('.')[1] ?? '').length;
    return `${newNum.toFixed(decimals)}${suffix}`;
  }
}

// Find key in setup whose name (case-insensitive, stripped) contains any of the patterns.
// Returns [{section, key, raw}]
function findKeys(
  setup: ParsedSetup,
  patterns: string[]
): Array<{ section: string; key: string; raw: string }> {
  const results: Array<{ section: string; key: string; raw: string }> = [];
  for (const [section, kvs] of Object.entries(setup.sections)) {
    for (const [key, val] of Object.entries(kvs)) {
      const keyLower = key.toLowerCase().replace(/\s/g, '');
      for (const pat of patterns) {
        if (keyLower.includes(pat.toLowerCase().replace(/\s/g, ''))) {
          results.push({ section, key, raw: val.raw });
          break;
        }
      }
    }
  }
  return results;
}

// ─── Core generator ───────────────────────────────────────────────────────────

export function applyRecommendations(
  setup: ParsedSetup,
  rawContent: string,
  recs: CoachRecommendation[],
): GenerateResult {
  const applied: AppliedChange[] = [];
  const skipped: string[] = [];

  // Detect original line ending and preserve it
  const lineEnding = rawContent.includes('\r\n') ? '\r\n' : '\n';

  // Work on a mutable line array for in-place replacements
  const lines = rawContent.split(/\r?\n/);

  // Track which keys we've already modified (avoid double-applying)
  const modified = new Set<string>();

  for (const rec of recs) {
    const compLower = rec.component.toLowerCase();
    let ruleFound: KeyRule | null = null;

    for (const rule of KEY_RULES) {
      if (rule.componentFragments.some(f => compLower.includes(f))) {
        ruleFound = rule;
        break;
      }
    }

    if (!ruleFound) {
      skipped.push(rec.component);
      continue;
    }

    const matches = findKeys(setup, ruleFound.keyPatterns);
    if (matches.length === 0) {
      skipped.push(rec.component);
      continue;
    }

    const positive = isPositive(rec.direction, ruleFound.positiveDirection);

    for (const m of matches) {
      const dedupKey = `${m.section}.${m.key}`;
      if (modified.has(dedupKey)) continue;

      const newVal = applyDelta(m.raw, ruleFound.isIndex, positive);
      if (!newVal) continue;

      // Replace in the lines array — find the line with this exact key=value
      for (let i = 0; i < lines.length; i++) {
        const lineKey = lines[i].trim().split('=')[0].trim();
        if (lineKey.toLowerCase() === m.key.toLowerCase()) {
          const indent = lines[i].match(/^(\s*)/)?.[1] ?? '';
          lines[i] = `${indent}${m.key}=${newVal}`;
          modified.add(dedupKey);
          applied.push({
            section: m.section,
            key: m.key,
            oldValue: m.raw,
            newValue: newVal,
            recommendation: `${rec.component}: ${rec.direction}`,
          });
          break;
        }
      }
    }

    if (!matches.some(m => modified.has(`${m.section}.${m.key}`))) {
      skipped.push(rec.component);
    }
  }

  // Increment UpdateCount so iRacing recognises this as a modified setup
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('UpdateCount=')) {
      const parts = trimmed.split('=')[1].split(',');
      const first = parseInt(parts[0] ?? '0', 10);
      const second = parseInt(parts[1] ?? '0', 10);
      const indent = lines[i].match(/^(\s*)/)?.[1] ?? '';
      lines[i] = `${indent}UpdateCount=${first + 1},${second + 1}`;
      break;
    }
  }

  return {
    content: lines.join(lineEnding),
    applied,
    skipped,
  };
}

// ─── HTM-aware change calculator ─────────────────────────────────────────────
// Matches recommendations against an HTM-parsed setup (sections use human
// labels like "Spring rate", "ARB setting", etc.) and returns exact
// current → new value pairs for display in the export panel.

export function calculateHtmChanges(
  setup: ParsedSetup,
  recs: CoachRecommendation[],
): HtmChange[] {
  const changes: HtmChange[] = [];
  const seen = new Set<string>();

  for (const rec of recs) {
    const compLower = rec.component.toLowerCase();
    let ruleFound: KeyRule | null = null;
    for (const rule of KEY_RULES) {
      if (rule.componentFragments.some(f => compLower.includes(f))) {
        ruleFound = rule;
        break;
      }
    }
    if (!ruleFound) continue;

    const positive = isPositive(rec.direction, ruleFound.positiveDirection);

    // Search HTM sections for labels matching this rule
    for (const [section, kvs] of Object.entries(setup.sections)) {
      for (const [label, val] of Object.entries(kvs)) {
        if (val.numeric === null) continue;
        const labelLower = label.toLowerCase();
        const matches = ruleFound.htmLabels.some(h => labelLower.includes(h.toLowerCase()));
        if (!matches) continue;

        // Determine if this section is relevant to the component.
        // Strip " (2)", " (3)" etc. suffixes the parser adds for duplicate section names.
        const secLower = section.toLowerCase().replace(/\s*\(\d+\)\s*$/, '');
        if (ruleFound.htmSections.length > 0) {
          if (!ruleFound.htmSections.some(s => secLower === s.toLowerCase())) continue;
        } else {
          const isFront = compLower.includes('front');
          const isRear = compLower.includes('rear');
          if (isFront && (secLower.includes('rear') && !secLower.includes('front'))) continue;
          if (isRear && (secLower.includes('front') && !secLower.includes('rear') || secLower.includes('brakes'))) continue;
        }

        const dedupKey = `${section}.${label}`;
        if (seen.has(dedupKey)) continue;

        const effectivePositive = ruleFound.invertDelta ? !positive : positive;
        const newVal = applyDelta(val.raw, ruleFound.isIndex, effectivePositive);
        if (!newVal) continue;

        seen.add(dedupKey);
        // Prefix approximate (percentage-based) values with ≈ so the user
        // knows to pick the nearest available click in iRacing.
        const displayVal = ruleFound.isIndex ? newVal : `≈ ${newVal}`;
        changes.push({
          section,
          label,
          oldValue: val.raw,
          newValue: displayVal,
          component: rec.component,
          direction: rec.direction,
        });
      }
    }
  }

  return changes;
}
