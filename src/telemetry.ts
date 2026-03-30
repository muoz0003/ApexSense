/**
 * Telemetry bridge — forks a child process running under system Node.js
 * so the irsdk-node native addon uses the correct ABI (not Electron's).
 *
 * The child process (telemetryWorker.js) polls the SDK and sends snapshots
 * back via IPC. This module forwards them to registered listeners.
 */

import { fork, ChildProcess } from 'child_process';
import * as path from 'path';

export interface TireData {
  label: string;
  tempC: number;
  tempOutside: number;
  tempMiddle: number;
  tempInside: number;
  wear: number;
  pressureKpa: number;
}

export interface NearbyCarInfo {
  carIdx: number;
  relativeDistM: number;
  lateralOffset: number;
}

export interface RadarSnapshot {
  connected: boolean;
  playerSpeed: number;
  carLeftRight: number;
  nearbyCars: NearbyCarInfo[];
  trackLengthM: number;
}

export interface TelemetrySnapshot {
  connected: boolean;
  tires: TireData[];
  radar: RadarSnapshot;
}

type TelemetryListener = (snapshot: TelemetrySnapshot) => void;

let worker: ChildProcess | null = null;
let workerArgs: { pollIntervalMs: number; radarRange: number } | null = null;
let stopRequested = false;
let latestSnapshot: TelemetrySnapshot = {
  connected: false,
  tires: [],
  radar: { connected: false, playerSpeed: 0, carLeftRight: 0, nearbyCars: [], trackLengthM: 0 },
};
const listeners: TelemetryListener[] = [];

function notifyListeners(): void {
  for (const fn of listeners) {
    fn(latestSnapshot);
  }
}

/**
 * Start polling iRacing telemetry by forking a child process that runs
 * under Electron's embedded Node.js (via ELECTRON_RUN_AS_NODE).
 */
export function startTelemetry(pollIntervalMs: number, radarRange: number = 40): void {
  if (worker) return; // already running

  stopRequested = false;
  workerArgs = { pollIntervalMs, radarRange };
  spawnWorker(pollIntervalMs, radarRange);
}

function spawnWorker(pollIntervalMs: number, radarRange: number): void {
  const workerScript = path.join(__dirname, 'telemetryWorker.js');


  // Fork using Electron as a Node.js runtime (ELECTRON_RUN_AS_NODE strips
  // the Chromium/GPU layers so the child behaves like plain Node).
  worker = fork(workerScript, [], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });

  worker.on('message', (msg: any) => {
    if (msg.type === 'telemetry') {
      latestSnapshot = msg.snapshot;
      notifyListeners();
    } else if (msg.type === 'error') {
      console.error('Telemetry worker error:', msg.message);
    }
  });

  worker.on('error', (err) => {
    console.error('Telemetry worker process error:', err);
  });

  worker.on('exit', (code) => {
    console.log('Telemetry worker exited with code', code);
    worker = null;
    if (latestSnapshot.connected) {
      latestSnapshot = {
        connected: false,
        tires: [],
        radar: { connected: false, playerSpeed: 0, carLeftRight: 0, nearbyCars: [], trackLengthM: 0 },
      };
      notifyListeners();
    }
    // Auto-restart if we didn't request the stop
    if (!stopRequested && workerArgs) {
      console.log('Restarting telemetry worker in 2 seconds...');
      setTimeout(() => {
        if (!stopRequested && workerArgs) {
          spawnWorker(workerArgs.pollIntervalMs, workerArgs.radarRange);
        }
      }, 2000);
    }
  });

  // Tell the worker to start polling
  worker.send({ type: 'start', pollIntervalMs, radarRange });
}

export function stopTelemetry(): void {
  stopRequested = true;
  workerArgs = null;
  if (worker) {
    try {
      worker.send({ type: 'stop' });
    } catch {
      // Worker may already be dead
    }
    worker.kill();
    worker = null;
  }
}

export function onTelemetryUpdate(listener: TelemetryListener): void {
  listeners.push(listener);
}

export function getLatestSnapshot(): TelemetrySnapshot {
  return latestSnapshot;
}
