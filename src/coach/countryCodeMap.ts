/**
 * Mapping from iRacing club names to ISO 3166-1 alpha-2 country codes.
 * Used to look up flag SVGs from the hampusborgos/country-flags repository.
 *
 * iRacing club names do not always match a single country — regional clubs
 * (e.g. "Benelux", "Scandinavia") are mapped to the most representative
 * country, and US regional clubs all map to "us".
 */

const CLUB_TO_ISO: Record<string, string> = {
  // ── United States — FlairName sends "United States" ────────────────────
  'United States':         'us',
  // ── United States (legacy regional club names) ───────────────────────────
  'Atlantic Club':         'us',
  'Central South Club':    'us',
  'Great Plains Club':     'us',
  'Mid Atlantic Club':     'us',
  'Mid South Club':        'us',
  'Mountain West Club':    'us',
  'Northeast Club':        'us',
  'Northwest Club':        'us',
  'Pacific Club':          'us',
  'Southeast Club':        'us',
  'Southwest Club':        'us',
  'Midwest Club':          'us',
  'Indiana Club':          'us',
  'Ohio Club':             'us',
  'Texas Club':            'us',
  'Florida Club':          'us',
  'California Club':       'us',

  // ── Americas ─────────────────────────────────────────────────────────────
  'Canada':      'ca',
  'Brazil':      'br',
  'Argentina':   'ar',
  'Chile':       'cl',
  'Mexico':      'mx',
  'Colombia':    'co',
  'Peru':        'pe',
  'Venezuela':   've',
  'Uruguay':     'uy',
  'Ecuador':     'ec',

  // ── Europe — single country ───────────────────────────────────────────────
  'UK and I':              'gb',
  'United Kingdom':        'gb',
  'England':               'gb-eng',
  'Scotland':              'gb-sct',
  'Wales':                 'gb-wls',
  'Ireland':               'ie',
  'France':                'fr',
  'Germany':               'de',
  'Italy':                 'it',
  'Spain':                 'es',
  'Portugal':              'pt',
  'Netherlands':           'nl',
  'Belgium':               'be',
  'Switzerland':           'ch',
  'Austria':               'at',
  'Poland':                'pl',
  'Czech Republic':        'cz',
  'Czechia':               'cz',
  'Hungary':               'hu',
  'Romania':               'ro',
  'Bulgaria':              'bg',
  'Russia':                'ru',
  'Ukraine':               'ua',
  'Turkey':                'tr',
  'Greece':                'gr',
  'Finland':               'fi',
  'Sweden':                'se',
  'Norway':                'no',
  'Denmark':               'dk',
  'Croatia':               'hr',
  'Slovenia':              'si',
  'Serbia':                'rs',
  'Slovakia':              'sk',
  'Estonia':               'ee',
  'Latvia':                'lv',
  'Lithuania':             'lt',
  'Luxembourg':            'lu',

  // ── Europe — multi-country regions (mapped to primary / most common country) ─
  'Germany Austria and Switzerland': 'de',
  'Benelux':               'be',
  'Scandinavia':           'se',
  'Nordic':                'se',
  'Iberia':                'es',
  'Eastern Europe':        'pl',
  'Balkans':               'rs',

  // ── Asia-Pacific ─────────────────────────────────────────────────────────
  'Japan':                 'jp',
  'Korea':                 'kr',
  'China':                 'cn',
  'India':                 'in',
  'Australia':             'au',
  'Australia and New Zealand': 'au',
  'New Zealand':           'nz',
  'Singapore':             'sg',
  'Malaysia':              'my',
  'Thailand':              'th',
  'Indonesia':             'id',
  'Taiwan':                'tw',
  'Hong Kong':             'hk',
  'Philippines':           'ph',
  'Vietnam':               'vn',

  // ── Middle East & Africa ─────────────────────────────────────────────────
  'Middle East':           'ae',
  'South Africa':          'za',
  'Israel':                'il',
};

/**
 * Resolve an iRacing club name to a 2-letter ISO country code.
 * Returns null if the club is unknown or cannot be mapped to a single country.
 */
export function clubNameToIso(clubName: string): string | null {
  if (!clubName || clubName === 'None') return null;

  // Exact match first
  const exact = CLUB_TO_ISO[clubName];
  if (exact) return exact;

  // Case-insensitive fallback
  const lower = clubName.toLowerCase();
  for (const [key, code] of Object.entries(CLUB_TO_ISO)) {
    if (key.toLowerCase() === lower) return code;
  }

  // Partial match: club name contains a known key (or vice-versa)
  for (const [key, code] of Object.entries(CLUB_TO_ISO)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) {
      return code;
    }
  }

  return null;
}

/**
 * Build the relative path to a flag SVG file.
 * @param isoCode  2-letter ISO code (e.g. "fr", "gb-eng")
 * @param base     Path prefix pointing at the country-flags/svg/ directory,
 *                 relative to the HTML file that loads the image.
 *                 Defaults to the path from src/coach/coach.html.
 */
export function flagSrc(isoCode: string, base = '../../country-flags/svg/'): string {
  return `${base}${isoCode.toLowerCase()}.svg`;
}
