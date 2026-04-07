/**
 * iRacing Setup File Parser
 *
 * Parses the text-based .sto format that iRacing uses for car setups.
 * Files are structured as INI-like sections with key=value pairs.
 *
 * Example:
 *   UpdateCount=17,19
 *   CarPath=dallara_f3
 *   [Front]
 *    FrontARBBladeIndex=3
 *    BrakeBalance=51.8 %
 *   [Rear]
 *    RearARBBladeIndex=2
 */

export interface SetupValue {
  raw: string;       // raw value string from file, e.g. "51.8 %"
  numeric: number | null;
  unit: string;      // e.g. "%", "bar", "mm", "°", or ""
}

export interface ParsedSetup {
  carPath: string;
  updateCount: string;
  sections: Record<string, Record<string, SetupValue>>;
  /** All keys in a flat map for easy lookup: "Section.Key" → SetupValue */
  flat: Record<string, SetupValue>;
}

export interface SetupDiff {
  key: string;        // e.g. "Front.BrakeBalance"
  label: string;      // human-readable label
  a: SetupValue;
  b: SetupValue;
  changed: boolean;
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

function parseValue(raw: string): SetupValue {
  const trimmed = raw.trim();
  // Match number (+/- prefix) with optional unit — handles "+4 clicks", "-3.5 deg", "176 kPa", "3745 N"
  const match = trimmed.match(/^([+-]?[\d.]+)\s*(N\/mm|kPa|bar|psi|deg|°|mm|cm|rpm|nm|kg|lbs|clicks?|N|%|L)?/i);
  if (match) {
    const numeric = parseFloat(match[1]);
    if (!isNaN(numeric)) {
      const unit = (match[2] || '').trim();
      return { raw: trimmed, numeric, unit };
    }
  }
  return { raw: trimmed, numeric: null, unit: '' };
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s\-\/])(\w)/g, (_, sep, c) => sep + c.toUpperCase());
}

/** Parse iRacing's .htm export format (the human-readable HTML file from Garage > Save Setup) */
export function parseHtmFile(content: string): ParsedSetup {
  const sections: Record<string, Record<string, SetupValue>> = {};
  const flat: Record<string, SetupValue> = {};
  let carPath = '';

  // Extract car identifier from title line: "mercedesamggt4 setup: ..."
  const titleMatch = content.match(/([a-z0-9_]+)\s+setup:/i);
  if (titleMatch) carPath = titleMatch[1].toLowerCase();

  // Split on section headers <H2><U>NAME:</U></H2>
  const blocks = content.split(/<H2><U>/i);
  const sectionCounts: Record<string, number> = {};

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    // Extract section name up to </U></H2>
    const nameMatch = block.match(/^([^<]+?)\s*:?\s*<\/U><\/H2>/i);
    if (!nameMatch) continue;
    const sectionName = titleCase(nameMatch[1].trim());

    sectionCounts[sectionName] = (sectionCounts[sectionName] ?? 0) + 1;
    const uniqueName = sectionCounts[sectionName] > 1
      ? `${sectionName} (${sectionCounts[sectionName]})`
      : sectionName;

    if (!sections[uniqueName]) sections[uniqueName] = {};

    // Parse "Label: <U>value</U>" pairs — exclude > from label so <br>Foo doesn't bleed in
    const kvRegex = /([A-Za-z][^:><\n\r]{1,60}?):?\s*<U>([^<]+)<\/U>/g;
    let kv: RegExpExecArray | null;
    while ((kv = kvRegex.exec(block)) !== null) {
      const label = kv[1].trim();
      const rawVal = kv[2].trim();
      if (!label || !rawVal) continue;
      const val = parseValue(rawVal);
      sections[uniqueName][label] = val;
      flat[`${uniqueName}.${label}`] = val;
    }
  }

  return { carPath, updateCount: '', sections, flat };
}

export function parseSetupFile(content: string): ParsedSetup {
  // Detect HTML format (iRacing .htm export)
  if (/^\s*<!DOCTYPE|^\s*<html/i.test(content.substring(0, 200))) {
    return parseHtmFile(content);
  }
  const lines = content.split(/\r?\n/);
  const sections: Record<string, Record<string, SetupValue>> = {};
  const flat: Record<string, SetupValue> = {};
  let currentSection = '__root__';
  let carPath = '';
  let updateCount = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('//')) continue;

    // Section header [SectionName]
    const sectionMatch = trimmed.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      if (!sections[currentSection]) sections[currentSection] = {};
      continue;
    }

    // Key=Value
    const kvMatch = trimmed.match(/^([^=]+)=(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      const val = parseValue(kvMatch[2]);

      if (!sections[currentSection]) sections[currentSection] = {};
      sections[currentSection][key] = val;
      flat[`${currentSection}.${key}`] = val;

      // Top-level metadata
      if (currentSection === '__root__') {
        if (key === 'CarPath') carPath = kvMatch[2].trim();
        if (key === 'UpdateCount') updateCount = kvMatch[2].trim();
      }
    }
  }

  return { carPath, updateCount, sections, flat };
}

// ─── Diffing ──────────────────────────────────────────────────────────────────

function humanKey(flatKey: string): string {
  // "Front.BrakeBalance" → "Front › Brake Balance"
  const [section, ...rest] = flatKey.split('.');
  const keyPart = rest.join('.').replace(/([A-Z])/g, ' $1').trim();
  return `${section} › ${keyPart}`;
}

export function diffSetups(a: ParsedSetup, b: ParsedSetup): SetupDiff[] {
  const allKeys = new Set([...Object.keys(a.flat), ...Object.keys(b.flat)]);
  const diffs: SetupDiff[] = [];

  for (const key of allKeys) {
    const av = a.flat[key];
    const bv = b.flat[key];
    if (!av || !bv) continue; // skip keys only in one file

    const changed = av.raw !== bv.raw;
    diffs.push({
      key,
      label: humanKey(key),
      a: av,
      b: bv,
      changed,
    });
  }

  // Sort: changed first, then alphabetically
  return diffs.sort((x, y) => {
    if (x.changed !== y.changed) return x.changed ? -1 : 1;
    return x.key.localeCompare(y.key);
  });
}

// ─── Summary ──────────────────────────────────────────────────────────────────

export function setupSummary(setup: ParsedSetup): string {
  const keys = Object.keys(setup.flat).length;
  const sectionNames = Object.keys(setup.sections)
    .filter(s => s !== '__root__')
    .join(', ');
  return `Car: ${setup.carPath || 'unknown'} · ${keys} values · Sections: ${sectionNames}`;
}
