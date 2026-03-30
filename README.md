# ApexSense

Real-time iRacing telemetry overlay widget built with Electron. Displays **live tire telemetry** (temperatures, wear, pressure) and a **proximity radar** as transparent HUD overlays on top of iRacing.

![Platform](https://img.shields.io/badge/platform-Windows-blue)
![Electron](https://img.shields.io/badge/electron-28-teal)

---

## Features

- **Tire Overlay** — 2×2 grid showing all four tires with color-coded temperature zones (outside / middle / inside), wear %, and pressure (kPa)
- **Proximity Radar** — Top-down canvas showing nearby cars in real time
- **Physics-based thermal model** — Estimates live tire temperatures on track (iRacing SDK only updates temps in the pits)
- **Drivetrain-aware** — Adjusts heat distribution for RWD, FWD, AWD, and RWD Hybrid cars
- **Frameless & transparent** — Overlays sit on top of the game with no window chrome

---

## Prerequisites

- **Windows 10/11** (x64)
- **Node.js** 18 or later — [https://nodejs.org](https://nodejs.org)
- **Git** — [https://git-scm.com](https://git-scm.com)
- **iRacing** installed and running (for live telemetry)

---

## Installation (from source)

```bash
# 1. Clone the repository
git clone https://github.com/muoz0003/ApexSense.git
cd ApexSense

# 2. Install dependencies
npm install

# 3. Build the TypeScript source
npm run build

# 4. Launch the app
npm start
```

### Quick start (alternative)

Double-click **Start.bat** — it compiles and launches in one step.

---

## Development

```bash
# Compile & run once
npm run dev

# Watch for changes (recompile on save)
npm run watch
# Then in another terminal:
npx electron .
```

---

## Packaging a release

```bash
npm run package
```

This produces a portable build in `release/ApexSense-win32-x64/` that can be run without Node.js installed.

---

## Pre-built release

A ready-to-run build is included in **`release/ApexSense-win32-x64/`**. To use it:

1. Navigate to `release/ApexSense-win32-x64/`
2. Run **`ApexSense.exe`**

No Node.js or npm required for the pre-built version.

---

## Project Structure

```
src/
├── main/           # Electron main process (main.ts, preloads)
├── renderer/       # Tire overlay & radar overlay (HTML/CSS/TS)
├── launcher/       # Settings launcher window
├── config.ts       # Default configuration
├── configStore.ts  # Persistent config storage
├── telemetry.ts    # iRacing SDK telemetry reader
└── telemetryWorker.ts  # Background telemetry worker
```

---

## License

See [LICENSE](release/ApexSense-win32-x64/LICENSE) for details.
