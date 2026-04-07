/**
 * Coach Data Store
 *
 * Persists coaching sessions and driver preferences to the user data directory.
 * Runs in the main process only.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { ProblemId } from './setupRules';
import { CoachAnalysis } from './coachEngine';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CoachSession {
  id: string;
  timestamp: number;
  carName: string;
  carPath: string;
  trackName: string;
  problem: ProblemId;
  confidence: 'low' | 'medium' | 'high';
  topRecommendations: string[]; // component names of top-3 recommendations
  userFeedback?: 'helpful' | 'not_helpful';
  notes?: string;
}

interface CoachStore {
  sessions: CoachSession[];
  /** component name → positive feedback count (used to re-rank recommendations) */
  helpfulPreferences: Record<string, number>;
  /** component name → negative feedback count */
  notHelpfulPreferences: Record<string, number>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getStorePath(): string {
  return path.join(app.getPath('userData'), 'coach-data.json');
}

function loadStore(): CoachStore {
  try {
    const raw = fs.readFileSync(getStorePath(), 'utf-8');
    const parsed = JSON.parse(raw) as CoachStore;
    return {
      sessions: parsed.sessions ?? [],
      helpfulPreferences: parsed.helpfulPreferences ?? {},
      notHelpfulPreferences: parsed.notHelpfulPreferences ?? {},
    };
  } catch {
    return { sessions: [], helpfulPreferences: {}, notHelpfulPreferences: {} };
  }
}

function saveStore(store: CoachStore): void {
  const p = getStorePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(store, null, 2), 'utf-8');
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function saveCoachSession(analysis: CoachAnalysis): CoachSession {
  const store = loadStore();

  const session: CoachSession = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: analysis.timestamp,
    carName: analysis.carName,
    carPath: '',
    trackName: analysis.trackName,
    problem: analysis.problem,
    confidence: analysis.confidence,
    topRecommendations: analysis.recommendations.slice(0, 3).map(r => r.component),
  };

  store.sessions.unshift(session); // newest first
  // Keep only last 100 sessions
  if (store.sessions.length > 100) store.sessions = store.sessions.slice(0, 100);

  saveStore(store);
  return session;
}

export function getCoachSessions(): CoachSession[] {
  return loadStore().sessions;
}

export function recordFeedback(sessionId: string, feedback: 'helpful' | 'not_helpful'): void {
  const store = loadStore();
  const session = store.sessions.find(s => s.id === sessionId);
  if (!session) return;

  session.userFeedback = feedback;

  // Update preferences based on the top recommendations of this session
  for (const component of session.topRecommendations) {
    if (feedback === 'helpful') {
      store.helpfulPreferences[component] = (store.helpfulPreferences[component] ?? 0) + 1;
    } else {
      store.notHelpfulPreferences[component] = (store.notHelpfulPreferences[component] ?? 0) + 1;
    }
  }

  saveStore(store);
}

export function getPreferences(): Record<string, number> {
  const store = loadStore();
  const prefs: Record<string, number> = {};
  for (const [k, v] of Object.entries(store.helpfulPreferences)) {
    prefs[k] = (prefs[k] ?? 0) + v * 2;
  }
  for (const [k, v] of Object.entries(store.notHelpfulPreferences)) {
    prefs[k] = (prefs[k] ?? 0) - v * 3;
  }
  return prefs;
}

export function saveSessionNotes(sessionId: string, notes: string): void {
  const store = loadStore();
  const session = store.sessions.find(s => s.id === sessionId);
  if (session) {
    session.notes = notes;
    saveStore(store);
  }
}
