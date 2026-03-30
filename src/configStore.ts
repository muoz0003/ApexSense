/**
 * Persistent config store — saves/loads OverlayConfig as JSON in the app's
 * user data directory so settings survive between sessions.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { defaultConfig, OverlayConfig } from './config';

const CONFIG_FILENAME = 'overlay-config.json';

function getConfigPath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILENAME);
}

export function loadConfig(): OverlayConfig {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    // Merge with defaults so new fields added in future versions get defaults
    return {
      ...defaultConfig,
      ...parsed,
      thresholds: { ...defaultConfig.thresholds, ...parsed.thresholds },
    };
  } catch {
    return { ...defaultConfig };
  }
}

export function saveConfig(config: OverlayConfig): void {
  const dir = path.dirname(getConfigPath());
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}
