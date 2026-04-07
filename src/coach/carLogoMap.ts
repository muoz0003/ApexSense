/**
 * Car logo resolver — maps iRacing carPath / carName strings to a brand logo filename.
 *
 * Logo images live in img/car-logos/ (relative to the workspace root).
 * The resolver does a substring match (case-insensitive) against both carPath and carName.
 */

interface LogoEntry {
  pattern: string;  // lowercase substring to match against carPath+carName
  logo: string;     // filename in img/car-logos/
}

const LOGO_MAP: LogoEntry[] = [
  // ── Acura / Honda ──────────────────────────────────────────────────────
  { pattern: 'acura',           logo: 'acura.png' },
  { pattern: 'arx',             logo: 'acura.png' },
  { pattern: 'honda',           logo: 'honda.png' },
  { pattern: 'civic',           logo: 'honda.png' },

  // ── Audi ──────────────────────────────────────────────────────────────
  { pattern: 'audi_r8',         logo: 'audi-sport.png' },
  { pattern: 'rs3',             logo: 'audi.png' },
  { pattern: 'audi',            logo: 'audi.png' },

  // ── Alpine / Renault ──────────────────────────────────────────────────
  { pattern: 'alpine',          logo: 'alpine.png' },
  { pattern: 'renault',         logo: 'renault.png' },

  // ── Aston Martin ──────────────────────────────────────────────────────
  { pattern: 'aston',           logo: 'aston-martin.png' },

  // ── BMW ───────────────────────────────────────────────────────────────
  { pattern: 'bmw_m',           logo: 'bmw-m.png' },
  { pattern: 'bmw',             logo: 'bmw.png' },

  // ── Cadillac ──────────────────────────────────────────────────────────
  { pattern: 'cadillac',        logo: 'cadillac.png' },

  // ── Chevrolet / Corvette ──────────────────────────────────────────────
  { pattern: 'corvette',        logo: 'chevrolet-corvette.png' },
  { pattern: 'camaro',          logo: 'chevrolet.png' },
  { pattern: 'silverado',       logo: 'chevrolet.png' },
  { pattern: 'chevrolet',       logo: 'chevrolet.png' },

  // ── Dallara (no brand logo — use a generic formula placeholder) ───────
  // Dallara is a chassis maker; use the series badge instead where possible
  { pattern: 'dallara_ir18',    logo: 'acura.png' },  // IndyCar runs Dallara/Honda or Chevy but we'll skip
  // (Intentionally left without entry so it falls back to null)

  // ── Ferrari ───────────────────────────────────────────────────────────
  { pattern: 'ferrari',         logo: 'ferrari.png' },

  // ── Ford ──────────────────────────────────────────────────────────────
  { pattern: 'mustang',         logo: 'ford-mustang.png' },
  { pattern: 'ford',            logo: 'ford.png' },
  { pattern: 'fiesta',          logo: 'ford.png' },
  { pattern: 'gt40',            logo: 'ford.png' },

  // ── Ginetta ────────────────────────────────────────────────────────────
  { pattern: 'ginetta',         logo: 'ginetta.png' },

  // ── Hyundai ───────────────────────────────────────────────────────────
  { pattern: 'hyundai',         logo: 'hyundai.png' },
  { pattern: 'elantra',         logo: 'hyundai.png' },

  // ── Kia ───────────────────────────────────────────────────────────────
  { pattern: 'kia',             logo: 'kia.png' },

  // ── Lamborghini ───────────────────────────────────────────────────────
  { pattern: 'lamborghini',     logo: 'lamborghini.png' },
  { pattern: 'huracan',         logo: 'lamborghini.png' },

  // ── Ligier ────────────────────────────────────────────────────────────
  { pattern: 'ligier',          logo: 'ligier.png' },

  // ── Lotus ─────────────────────────────────────────────────────────────
  { pattern: 'lotus',           logo: 'lotus.png' },

  // ── Mazda ─────────────────────────────────────────────────────────────
  { pattern: 'mazda',           logo: 'mazda.png' },
  { pattern: 'mx5',             logo: 'mazda.png' },
  { pattern: 'mx-5',            logo: 'mazda.png' },
  { pattern: 'miata',           logo: 'mazda.png' },

  // ── McLaren ───────────────────────────────────────────────────────────
  { pattern: 'mclaren',         logo: 'mclaren.png' },
  { pattern: '720s',            logo: 'mclaren.png' },

  // ── Mercedes ──────────────────────────────────────────────────────────
  { pattern: 'mercedes',        logo: 'mercedes-amg.png' },
  { pattern: 'amg',             logo: 'mercedes-amg.png' },
  { pattern: 'w13',             logo: 'mercedes-amg.png' },
  { pattern: 'w12',             logo: 'mercedes-amg.png' },

  // ── Nissan ────────────────────────────────────────────────────────────
  { pattern: 'nissan',          logo: 'nissan.png' },
  { pattern: 'gt-r',            logo: 'nissan-gt-r.png' },

  // ── Porsche ───────────────────────────────────────────────────────────
  { pattern: 'porsche',         logo: 'porsche.png' },

  // ── Radical ───────────────────────────────────────────────────────────
  { pattern: 'radical',         logo: 'radical.png' },

  // ── Riley ─────────────────────────────────────────────────────────────
  { pattern: 'riley',           logo: 'riley.png' },

  // ── Subaru ────────────────────────────────────────────────────────────
  { pattern: 'subaru',          logo: 'subaru.png' },
  { pattern: 'impreza',         logo: 'subaru.png' },
  { pattern: 'wrx',             logo: 'subaru.png' },

  // ── Toyota ────────────────────────────────────────────────────────────
  { pattern: 'toyota',          logo: 'toyota.png' },
  { pattern: 'gr86',            logo: 'toyota.png' },
  { pattern: 'supra',           logo: 'toyota.png' },
  { pattern: 'gr supra',        logo: 'toyota.png' },

  // ── Volkswagen ────────────────────────────────────────────────────────
  { pattern: 'volkswagen',      logo: 'volkswagen.png' },
  { pattern: 'beetle',          logo: 'volkswagen.png' },
  { pattern: ' vw',             logo: 'volkswagen.png' },
];

/**
 * Returns the filename of the logo for a given car, or null if none found.
 * Pass the path relative to img/car-logos/ to build the full src attribute.
 */
export function resolveCarLogo(carPath: string, carName: string): string | null {
  const haystack = (carPath + ' ' + carName).toLowerCase();
  for (const entry of LOGO_MAP) {
    if (haystack.includes(entry.pattern)) return entry.logo;
  }
  return null;
}

/**
 * Build a fully resolved file:// src string for use in <img> tags.
 * `appRoot` should be the absolute path to the workspace root (passed from the main process
 * via a data attribute, or derived at runtime).
 */
export function buildLogoSrc(logoFile: string, appRoot: string): string {
  return `${appRoot}/img/car-logos/${logoFile}`.replace(/\\/g, '/');
}
