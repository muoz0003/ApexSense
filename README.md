# ApexSense

Real-time iRacing telemetry overlay widget built with Electron. Displays **live tire telemetry** (temperatures, wear, pressure) and a **proximity radar** as transparent HUD overlays on top of iRacing.

![Platform](https://img.shields.io/badge/platform-Windows-blue)
![Electron](https://img.shields.io/badge/electron-28-teal)

---

## Download

**[Download the latest release (.zip)](https://github.com/muoz0003/ApexSense/releases)** — no installation or Node.js required. Extract the zip and run `ApexSense.exe`.

---

## Features

- **Tire Overlay** — 2×2 grid showing all four tires with color-coded temperature zones (outside / middle / inside), wear %, and pressure (kPa)
- **Proximity Radar** — Top-down canvas showing nearby cars in real time
- **Physics-based thermal model** — Estimates live tire temperatures on track (iRacing SDK only updates temps in the pits)
- **Drivetrain-aware** — Adjusts heat distribution for RWD, FWD, AWD, and RWD Hybrid cars
- **Frameless & transparent** — Overlays sit on top of the game with no window chrome

---

## Architecture Overview

The app runs **three windows**:

| Window | Purpose | Size (default) |
|--------|---------|----------------|
| **Launcher** | Settings panel — start/stop overlays, adjust thresholds, configure radar | 420 × 560 px |
| **Tire Overlay** | Transparent HUD showing live tire temps, wear & pressures | 440 × 360 px (scalable) |
| **Radar Overlay** | Top-down proximity canvas showing nearby cars | 200 × 420 px (scalable) |

All windows are **frameless** (no OS title bar). The overlay and radar windows are **transparent** and designed to sit on top of iRacing during gameplay.

---

## Tire Overlay

### What It Shows

A 2×2 grid displaying all four tires (LEFT FRONT, RIGHT FRONT, LEFT REAR, RIGHT REAR). Each tile shows three temperature zones and additional data:

- **Outside temperature** (°C) — outer tread sensor (left sensor for left-side tires, right sensor for right-side tires)
- **Middle temperature** (°C) — center tread sensor
- **Inside temperature** (°C) — inner tread sensor
- **Wear %** — average tread wear across all three sensors (0 % = new, 100 % = worn out)
- **Pressure** (kPa) — live tire pressure from the SDK

Each zone cell is individually color-coded based on its temperature.

### Real-Time Temperature Estimation

iRacing's SDK only updates tire temperature channels when the car is **in the pits**. Once you leave pit lane, those values freeze at the last pit reading. To solve this, ApexSense includes a **physics-based thermal estimation model** that provides live estimated temperatures while on track.

#### Drivetrain Detection

The thermal model distributes brake and throttle heat differently depending on the car's drivetrain. On session connect, the worker reads the car name from iRacing's `DriverInfo.Drivers[playerIdx].CarScreenName` (or `CarPath` / `WeekendInfo.CarName` as fallback) and matches it against a built-in lookup table.

| Drivetrain | Matched Cars | Default? |
|---|---|---|
| **RWD** | All GT3, GT4, GTE, LMP2, Formula (except W13), all oval, all dirt oval, MX-5, GR86 | Yes (fallback) |
| **FWD** | Hyundai Elantra N TCR, Honda Civic Type R TCR, Audi RS3 LMS TCR | — |
| **AWD** | Audi 90 GTO, Ford Fiesta Rallycross, VW Beetle Rallycross | — |
| **RWD_Hybrid** | Cadillac V-Series.R GTP, BMW M Hybrid V8, Acura ARX-06, Mercedes-AMG W13 | — |

Detection runs once per session and resets on disconnect.

#### How It Works

1. **Stale detection** — Each poll cycle, the worker sums the absolute change across all three zone temps vs. the stored baseline. If the total drift is ≤ 3 °C for 8 consecutive polls (~1.6 s at 200 ms), the data is declared stale and estimation activates. If the car is on pit road or stationary (speed < 1 m/s), real SDK data is always used regardless.

2. **Driving input smoothing** — Raw SDK values for speed, brake, throttle, and lateral acceleration are smoothed with an exponential low-pass filter:

   $$\alpha = 1 - e^{-\Delta t / 2.5}$$
   $$\text{smoothed} = \text{current} + (\text{raw} - \text{current}) \times \alpha$$

   The 2.5-second time constant prevents jittery temperature swings from momentary pedal inputs.

3. **Thermal model** — Each tire's equilibrium temperature is computed from five additive heat sources, then divided by an airflow cooling factor:

##### Heat Sources

**a) Rolling friction (speed-based):**

$$\text{speedNorm} = \min\!\left(\frac{\text{speed}}{70}, 1.5\right)$$

$$\text{trackSurfaceBonus} = \max\!\left(0,\; (\text{trackTemp} - \text{airTemp}) \times 0.50\right)$$

$$\text{baseHeat} = 58 \times \text{speedNorm} + \text{trackSurfaceBonus} \times \text{speedNorm}$$

Speed is normalized to a reference of 70 m/s (~252 km/h), capped at 1.5×. Hot track surfaces contribute additional heat proportional to the air-to-track temperature difference.

**b) Brake heat (drivetrain-aware):**

$$\text{brakeHeat} = \text{brakePedal} \times \begin{cases} \text{brakeHeatFront} & \text{if front tire} \\ \text{brakeHeatRear} & \text{if rear tire} \end{cases}$$

| Drivetrain | Front | Rear | Front:Rear Ratio |
|---|---|---|---|
| RWD | 40 | 12 | 3.3:1 |
| FWD | 34 | 17 | 2.0:1 |
| AWD | 34 | 17 | 2.0:1 |
| RWD_Hybrid | 37 | 14 | 2.6:1 |

**c) Throttle / traction heat (drivetrain-aware):**

$$\text{throttleHeat} = \text{throttlePedal} \times \begin{cases} \text{throttleHeatFront} & \text{if front tire} \\ \text{throttleHeatRear} & \text{if rear tire} \end{cases}$$

| Drivetrain | Front | Rear | Rear:Front Ratio |
|---|---|---|---|
| RWD | 8 | 37 | 4.6:1 |
| FWD | 37 | 8 | 0.2:1 (front-biased) |
| AWD | 20 | 26 | 1.3:1 |
| RWD_Hybrid | 14 | 31 | 2.2:1 |

**d) Cornering forces (lateral load):**

$$\text{lateralSign} = \begin{cases} +1 & \text{if left tire} \\ -1 & \text{if right tire} \end{cases}$$

$$\text{tireLoadFactor} = \max\!\left(0,\; \text{latAccel} \times \text{lateralSign}\right)$$

$$\text{lateralHeat} = \frac{\text{tireLoadFactor}}{15} \times 23$$

Positive `LatAccel` means turning right → left tires are loaded. The loaded tire receives more heat; the unloaded tire receives zero lateral heat. Reference lateral acceleration is 15 m/s².

##### Zone Distribution

When cornering, heat is distributed unevenly across the three tread zones:

$$\text{zoneShift} = \frac{\text{tireLoadFactor}}{15} \times 0.30$$

| Zone | Heat Multiplier |
|---|---|
| Outside | $1 + \text{zoneShift}$ |
| Middle | $1$ |
| Inside | $\max(0.5,\; 1 - \text{zoneShift} \times 0.5)$ |

This simulates the tire deforming under lateral load, concentrating heat on the outside shoulder.

##### Weather-Aware Cooling

$$\text{effectiveAirflow} = \text{speed} + \text{windSpeed} \times 0.5$$

$$\text{humidityFactor} = 1 - \text{humidity} \times 0.15$$

$$\text{coolFactor} = 1 + \sqrt{\frac{\text{effectiveAirflow}}{10}} \times 0.35 \times \text{humidityFactor}$$

Wind adds convective cooling on top of car-speed airflow. Humidity reduces cooling efficiency (at 100% humidity, cooling is 85% as effective as dry air). The square-root gives diminishing returns at high speeds.

##### Equilibrium Temperature

$$\text{baseTemp} = \text{airTemp} + (\text{trackTemp} - \text{airTemp}) \times 0.65$$

$$T_{\text{eq}}^{\text{zone}} = \text{baseTemp} + \frac{\text{totalHeat} \times \text{zoneMultiplier}}{\text{coolFactor}}$$

The baseline sits 65% of the way from air temp to track temp, reflecting heat transfer from the contact patch.

##### Exponential Approach (Asymmetric)

Each zone's estimated temperature moves toward its equilibrium using a first-order exponential:

$$\alpha = 1 - e^{-\Delta t / \tau}$$

$$T_{\text{est}} = T_{\text{current}} + (T_{\text{eq}} - T_{\text{current}}) \times \alpha$$

| Direction | Time Constant ($\tau$) |
|---|---|
| Heating ($T_{\text{eq}} > T_{\text{current}}$) | 30 seconds |
| Cooling ($T_{\text{eq}} < T_{\text{current}}$) | 45 seconds |

Tires heat up 50% faster than they cool, matching real rubber thermal behavior. It takes approximately 2–3 laps to reach full operating temperature from cold.

#### Pit Snap-Back

When the car enters the pits (detected via four redundant sources: `OnPitRoad`, `CarIdxOnPitRoad[playerIdx]`, `CarIdxTrackSurface[playerIdx]`, `PlayerTrackSurface`) or is stationary (speed < 1 m/s), the estimation is immediately replaced by actual SDK values. The model re-seeds all three zone baselines from those real readings, so when you leave the pits, estimation resumes from the correct starting point.

#### Visual Indicators

| Indicator | Meaning |
|---|---|
| `~95°` (tilde prefix) | Temperature is estimated |
| `95°` (no tilde) | Temperature is from the SDK (real data) |
| **"EST"** label suffix | Appears after the tire name (e.g., "LEFT FRONT EST") when estimating |
| Slightly dimmed temps | Estimated zone temps render at 85% opacity |

#### SDK Channels Used for Estimation

| Channel | Purpose |
|---|---|
| `Speed` | Car speed (m/s) — rolling friction & cooling |
| `Brake` | Brake pedal position (0–1) — front-biased heat |
| `Throttle` | Throttle position (0–1) — drivetrain-dependent heat |
| `LatAccel` | Lateral acceleration (m/s²) — cornering heat distribution |
| `TrackTempCrew` | Track surface temperature (°C) — baseline & surface bonus |
| `AirTemp` | Air temperature (°C) — cooling baseline |
| `WindSpeed` | Wind speed (m/s) — additional convective cooling |
| `RelativeHumidity` | Humidity (0–1) — reduces cooling efficiency |
| `OnPitRoad` | Scalar pit road flag |
| `CarIdxOnPitRoad` | Per-car pit road array (indexed by player car) |
| `CarIdxTrackSurface` | Per-car track surface enum (1 = InPitStall, 2 = ApproachingPits) |
| `PlayerTrackSurface` | Player-specific track surface enum |

### Color Palette

Colors transition smoothly using linear interpolation through the ApexSense palette:

| Temperature | Color | Hex | Meaning |
|-------------|-------|-----|--------|
| Below cold threshold | Dark teal | `#16231f` | Too cold — no grip |
| Warming / Ideal range | Forest green | `#213c30` | **Optimal operating zone** |
| Above hot threshold | Amber | `#433b24` | Caution — getting hot |
| Above overheat threshold | Crimson | `#412126` | Overheating — tire degradation risk |

> **Thresholds are fully adjustable** in the launcher's Tires tab. Tune them per car/compound.

---

## Proximity Radar

### What It Shows

A 180 × 380 pixel canvas rendered at 60 fps. Your car is fixed at the center; nearby cars appear as colored rectangles that move relative to your position.

### Proximity Colors

| Distance | Color | Meaning |
|----------|-------|---------|
| < 5 m | Red | Danger — collision risk |
| 5–15 m | Yellow | Caution |
| > 15 m | Green | Safe distance |

Cars near the edge of the radar range fade out smoothly rather than disappearing abruptly.

### Spotter Integration

The radar uses iRacing's built-in `CarLeftRight` spotter data to shift nearby cars laterally:

| Spotter Value | Behavior |
|---------------|----------|
| Clear | Cars stay centered |
| Car Left | Closest car(s) shifted to the left lane |
| Car Right | Closest car(s) shifted to the right lane |
| Cars Both Sides | Closest car pushed to appropriate side |
| 2 Cars Left/Right | Same as single, with doubled indication |

Side danger bars appear on the left/right edges when the spotter is active.

### Smoothing

Car positions are interpolated at a factor of 0.12, so cars glide to new positions instead of teleporting. This produces fluid 60 fps animation.

### Car Size

Car rectangle dimensions are adjustable from the launcher's **Radar** tab:

- **Width**: 8–60 px (default 20)
- **Height**: 20–100 px (default 48)

Changes apply in real-time and persist across sessions.

### Filtering

The radar automatically hides:
- Cars on pit road
- Cars off-track
- Cars beyond the configured radar range
- The entire radar when no cars are nearby

---

## Telemetry System

### How It Connects

The app uses the **irsdk-node** native addon (v4.4.0) to communicate with iRacing's shared memory telemetry interface. Telemetry runs in a separate **forked child process** using `ELECTRON_RUN_AS_NODE=1` so it uses Electron's embedded Node.js runtime — no separate Node.js installation required.

### Data Flow

```
iRacing SDK (shared memory)
    ↓
telemetryWorker.js (child process, polls at configurable interval)
    ↓  IPC messages
main.ts (Electron main process)
    ↓  webContents.send()
Tire Overlay renderer    Radar renderer
```

### Polling Rate

Default: **200 ms** (5 updates/sec). Adjustable from 50 ms (20 Hz) to 2000 ms (0.5 Hz) in the launcher's General tab.

### Auto-Recovery

If the telemetry worker crashes, the main process waits 2 seconds and respawns it automatically.

### Data Collected

**Per tire (LF, RF, LR, RR):**
- Temperature Outside (°C): outer tread sensor
- Temperature Middle (°C): center tread sensor
- Temperature Inside (°C): inner tread sensor
- Wear (%): average of left, center, and right wear sensors (SDK 0–1 → percentage)
- Pressure (kPa)

**Radar:**
- Player speed (m/s)
- Spotter state (`CarLeftRight` enum)
- Nearby cars: index + relative distance in metres
- Track length for lap-distance-to-metres conversion

### Track Wrapping

Lap-distance percentages wrap correctly across the start/finish line:

```
if delta >  0.5 → subtract 1.0
if delta < -0.5 → add 1.0
```

This prevents cars on different laps from appearing at wrong positions.

---

## Configuration

### Where Settings Are Stored

`{userData}/overlay-config.json` — a human-readable JSON file in Electron's user data directory. Settings persist across sessions and are merged with defaults on load (so new settings added in updates get their defaults automatically).

### All Settings

| Setting | Default | Range | Description |
|---------|---------|-------|-------------|
| `widgetScale` | 1.0 | 0.5–2.5 | Tire overlay size multiplier |
| `opacity` | 0.9 | 0.2–1.0 | Tire overlay transparency |
| `alwaysOnTop` | true | — | Keep overlays above all windows |
| `locked` | false | — | Click-through mode (no dragging) |
| `pollIntervalMs` | 200 | 50–2000 | Telemetry update interval |
| `coldRedMax` | 50 °C | — | Below this = too cold (red) |
| `coldYellowMax` | 70 °C | — | Cold → ideal threshold |
| `hotYellowMin` | 110 °C | — | Ideal → hot threshold |
| `hotRedMin` | 130 °C | — | Above this = overheating (red) |
| `radarEnabled` | true | — | Show radar window |
| `radarScale` | 1.0 | 0.5–2.5 | Radar window size multiplier |
| `radarOpacity` | 0.9 | 0.2–1.0 | Radar transparency |
| `radarRange` | 40 m | 15–60 | Detection range ahead/behind |
| `radarCarWidth` | 12 px | 8–60 | Car rectangle width on radar |
| `radarCarHeight` | 28 px | 20–100 | Car rectangle height on radar |

Window positions (tire overlay & radar) are also saved and restored automatically.

---

## Launcher Window

### Tabs

**General**
- Always on Top toggle
- Lock overlays (click-through) toggle
- Poll interval slider with descriptive hints
- "Fuel the Development" support link
- About / FAQ button

**Tires**
- Widget Scale slider
- Opacity slider
- Enable Radar toggle (synced with Radar tab)
- Four temperature threshold inputs (°C) with a visual zone bar

**Radar**
- Enable Radar toggle (synced with Tires tab)
- Radar Range slider (metres)
- Radar Scale slider
- Radar Opacity slider
- Car Width slider (8–60 px)
- Car Height slider (20–100 px)
- Color legend (red/yellow/green distances)

Each tab has its own **Save Settings** button.

---

## Window Behavior

### Lock / Unlock

| State | Behavior |
|-------|----------|
| **Unlocked** | Windows show a dashed border (move-mode), drag bar is visible, click events are captured |
| **Locked** | Windows are click-through (clicks pass to the game), drag bar hidden, minimal visual footprint |

### Always on Top

Uses Electron's `screen-saver` z-level to stay above fullscreen applications including iRacing.

### Scaling

Both overlays scale via CSS `zoom`. The Electron window resizes to match: `baseSize × scale`.

### Position Persistence

Dragging an overlay saves its `[x, y]` position to config immediately, so it returns to the same spot next launch.

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Desktop framework | Electron 28 |
| Language | TypeScript 5.3 (strict mode) |
| iRacing SDK binding | irsdk-node 4.4.0 |
| Rendering | HTML5 Canvas (radar), CSS (tires) |
| Build target | ES2020, CommonJS |
| Font | Poppins (Google Fonts CDN) |
| Packaging | @electron/packager (portable exe) |
| Security | Context isolation, no nodeIntegration, preload scripts via contextBridge |

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

## FAQ

**Q: Does it work with VR?**
A: Yes — the overlay uses `alwaysOnTop` with `screen-saver` z-level, so it renders above the game. In VR, you'll see it on your monitor but not in the headset. Use a VR overlay tool (like OVR Toolkit) to bring it into VR if needed.

**Q: Do users need Node.js installed to run the exe?**
A: No. The packaged exe includes Electron's own Node.js runtime. The telemetry worker runs via `ELECTRON_RUN_AS_NODE=1`, so no external Node.js is required.

**Q: Can I change thresholds per car?**
A: The code architecture supports per-car thresholds, but the current UI applies a single set globally. Adjust the four threshold values in the Tires tab to match the car/compound you're driving.

**Q: What happens if iRacing isn't running?**
A: The overlay shows "Waiting for iRacing telemetry…" and continues polling. It connects automatically when iRacing starts a session.

**Q: My radar is too cluttered. How do I clean it up?**
A: Reduce the Radar Range slider (default 40 m, minimum 15 m). You can also resize car rectangles using the Width/Height sliders in the launcher's Radar tab.

**Q: Can I move the overlays?**
A: Unlock them first (uncheck "Lock overlays" in General tab). Then drag them by their title bar. Your position is saved automatically.

**Q: How do I make the overlay invisible to the game?**
A: Lock the overlays. When locked, all clicks pass through to the window below. The overlays become non-interactive and click-through.

---

## License

This project is licensed under the MIT License — see [LICENSE](LICENSE) for details.
