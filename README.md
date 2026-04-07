# ApexSense

A desktop overlay suite for iRacing that provides **live tire telemetry**, a **proximity radar**, a **floating standings board**, and an **AI-assisted setup coach** — all as transparent overlays directly on top of the game.

![Platform](https://img.shields.io/badge/platform-Windows-blue)
![Electron](https://img.shields.io/badge/electron-28-teal)

---

## Download

**[Download the latest release (.zip)](https://davidmunozjensen.com/ApexSense/ApexSense-win32-x64.zip)** — no installation or Node.js required. Extract the zip and run `ApexSense.exe`.

**[Support & info](https://davidmunozjensen.com/apexsense-support.html)**

---

## Features

- **Tire Overlay** — 2×2 grid with color-coded temperature zones (O/M/I), wear %, and pressure for all four tyres
- **Proximity Radar** — Top-down canvas showing nearby cars in real time
- **Standings Board** — Floating live standings with driver data, column toggles, multi-class grouping, and position-change animations
- **Setup Coach** — 5-step guided workflow that records lap telemetry and generates targeted setup recommendations
- **Physics-based thermal model** — Estimates live tyre temperatures on track (iRacing SDK only updates temps in the pits)
- **Drivetrain-aware** — Adjusts heat distribution for RWD, FWD, AWD, and RWD Hybrid
- **Frameless & transparent** — Overlays sit on top of the game with no window chrome

---

## Download

**[Download the latest release (.zip)](https://davidmunozjensen.com/ApexSense/ApexSense-win32-x64.zip)** — no installation or Node.js required. Extract the zip and run `ApexSense.exe`.

**[Support & info](https://davidmunozjensen.com/apexsense-support.html)**

---

## Architecture Overview

The app runs **five windows**:

| Window | Purpose | Default Size |
|--------|---------|--------------|
| **Launcher** | Settings panel — start/stop overlays, configure all options | 420 × 960 px |
| **Tire Overlay** | Transparent HUD — live tyre temps, wear & pressure for all 4 tyres | 440 × 310 px (scalable) |
| **Radar Overlay** | Top-down proximity canvas showing nearby cars | 200 × 420 px (scalable) |
| **Standings Board** | Floating live standings with driver data, column toggles, multi-class grouping | 900 × 500 px (resizable) |
| **About / FAQ** | Scrollable help page with features, FAQ and support links | 700 × 580 px |

All overlay windows are **frameless** and **transparent**, designed to sit above iRacing during gameplay. The standings board is the only overlay that is **resizable** — its size is remembered between sessions.

---

## Tire Overlay

### What It Shows

A 2×2 grid (LEFT FRONT / RIGHT FRONT / LEFT REAR / RIGHT REAR) separated by a chassis divider. Each tile shows:

- **Zone labels** — O (outside), M (middle), I (inside) above each temperature cell
- **Temperature** (°C) per tread zone
- **Wear %** — average across all three sensors (0 % = new, 100 % = worn out)
- **Pressure** (kPa) — live from the SDK

Zone cells are individually colour-coded using a dark-toned palette (cold blues → forest green → amber → crimson).

### Colour Palette

| State | Hex | Meaning |
|-------|-----|---------|
| Cold | `#0d1521` (deep blue) | Too cold — no grip |
| Warming | `#142818` (dark green) | Building temperature |
| Ideal | `#142818` (dark forest green) | Optimal operating zone |
| Hot | `#2c220e` (dark amber) | Caution |
| Overheating | `#2c0f16` (dark crimson) | Tyre degradation risk |

> **Thresholds are fully adjustable** in the launcher's Tires tab. Tune them per car/compound.

### Real-Time Temperature Estimation

iRacing's SDK only updates tyre temperature channels when the car is **in the pits**. Once you leave pit lane, those values freeze at the last pit reading. To solve this, ApexSense includes a **physics-based thermal estimation model** that provides live estimated temperatures while on track.

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

---

## Proximity Radar

### What It Shows

A canvas centred on your car showing nearby cars as coloured rectangles (180 × 380 px, 60 fps). Your car is fixed at the centre; nearby cars appear as coloured rectangles that move relative to your position.

### Colour Coding

| Distance | Colour | Meaning |
|----------|--------|---------|
| < 5 m | Red | Danger — collision risk |
| 5–15 m | Yellow | Caution |
| > 15 m | Green | Safe distance |

Cars near the edge of the detection range fade out smoothly.

### Spotter Integration

Uses iRacing's `CarLeftRight` enum to shift nearby cars laterally and display side danger bars.

| Spotter Value | Behaviour |
|---------------|-----------|
| Clear | Cars stay centred |
| Car Left | Closest car(s) shifted to the left lane |
| Car Right | Closest car(s) shifted to the right lane |
| Cars Both Sides | Closest car pushed to appropriate side |
| 2 Cars Left/Right | Same as single, with doubled indication |

### Smoothing

Car positions are interpolated at a factor of 0.12, so cars glide to new positions instead of teleporting.

### Settings

| Setting | Default | Range |
|---------|---------|-------|
| Radar Range | 40 m | 15–60 m |
| Radar Scale | 1.0 | 0.5–2.5 |
| Radar Opacity | 0.9 | 0.2–1.0 |
| Car Width | 20 px | 8–60 px |
| Car Height | 48 px | 20–100 px |

The radar automatically hides when no cars are nearby, and filters out cars on pit road or off-track.

---

## Standings Board

### What It Shows

A floating, scrollable standings overlay listing all drivers in the session. Columns are individually togglable both from the launcher's Standings tab and from toggle buttons inside the overlay.

| Column | Description |
|--------|-------------|
| **Pos** | Race / practice position with animated position-change indicators (▲▼) |
| **Flag** | Country flag derived from iRacing's `FlairName` field (full country names like "Brazil", "United States") |
| **Car #** | Car number |
| **Make** | Car model name with manufacturer logo |
| **iRating** | Driver iRating |
| **SR** | Safety rating with licence-colour coding (R/D/C/B/A/P) |
| **Best** | Best lap time |
| **Last** | Last lap time |
| **Inc** | Incident count with colour-coded severity badge |

### Multi-Class Support

In multi-class sessions (e.g. GT4 + LMP3), drivers are automatically grouped by `CarClassID`. Each class group is preceded by a header row showing the class name and a colour dot derived from the iRacing `CarClassColor` value. Single-class sessions show no separator rows.

### Practice Mode

In practice sessions `CarIdxPosition` is 0 for all drivers. The standings automatically detects this and ranks drivers by best lap time, assigning synthetic positions 1…N (drivers with no lap time appear at the bottom).

### Scroll While Locked

When overlays are locked (click-through mode), hovering over the standings table briefly captures mouse events so you can scroll — then releases them on mouse-leave so clicks still pass through to the game.

### Position Change Animations

- **Gained positions** — row slides up with a green flash (`row-pop-up` keyframe)
- **Lost positions** — row slides down with a red flash (`row-pop-down` keyframe)
- **New entry** — fades in from the left (`row-appear` keyframe)

### Window Behaviour

- Default width: 900 px (freely resizable)
- Window size and position saved on `resized` / `moved` events and restored on next launch

---

## Setup Coach

### Overview

A 5-step guided workflow that analyses lap telemetry and generates targeted setup recommendations.

| Step | What You Do |
|------|------------|
| **1 — Import Setup** | Paste or load your current iRacing `.sto` setup file |
| **2 — Select Problem** | Choose the handling issue you're experiencing |
| **3 — Record Lap** | Drive a lap while ApexSense records your telemetry |
| **4 — Recommendations** | Review ranked setup adjustments with telemetry evidence |
| **5 — Export Setup** | Download a modified `.sto` file ready to load in iRacing |
| **History** | Review all past coach sessions |

### Supported Problems

| ID | Label |
|----|-------|
| `understeer_entry` | Understeer on corner entry |
| `oversteer_exit` | Oversteer on corner exit |
| `poor_traction` | Poor traction out of slow corners |
| `understeer_mid` | Understeer mid-corner |
| `oversteer_mid` | Oversteer mid-corner |
| `braking_instability` | Car unstable under braking |
| `bad_topspeed` | Lacking top-end speed |
| `general_understeer` | General understeer |
| `general_oversteer` | General oversteer |

### Car Categories

| Category | Example Cars |
|----------|-------------|
| `formula` | F3, F4, IndyCar, Pro Mazda, IR-18 |
| `gt` | GT3, GT4, GTE |
| `prototype` | LMP2, LMDh/GTP |
| `stockcar` | NASCAR, ARCA |
| `touring` | TCR |
| `sportsman` | Skip Barber, MX-5, Street Stock |

### Analysis

The engine records `TelemetryFrame` objects at the poll interval (throttle, brake, steering, speed, lat/long acceleration, gear, RPM, lap distance %, per-tyre temps). After recording it:

1. Computes aggregate metrics (average throttle/brake/lat-accel, tyre temp deltas, traction loss indicators)
2. Scores each `SetupAdjustment` against `ProblemRule.telemetryHints`
3. Boosts high-evidence adjustments and sorts by impact × evidence
4. Returns a `CoachAnalysis` with confidence level (`low` / `medium` / `high`) and human-readable `TelemetryInsight` entries

### Session Bar

While the Coach tab is active, the launcher shows a live session bar with: connection dot, player country flag, car logo, car name, track name, air temperature, track temperature, and air-to-track delta.

---

## Telemetry System

### Architecture

```
iRacing SDK (shared memory)
    ↓
telemetryWorker.js (forked child process, ELECTRON_RUN_AS_NODE=1)
    ↓  IPC messages
main.ts (Electron main process)
    ↓  webContents.send()
Tire renderer · Radar renderer · Standings renderer · Coach (launcher)
```

The worker runs in a separate process using Electron's embedded Node.js — no external Node.js installation required.

### Polling

Default: **200 ms** (5 Hz). Adjustable 50–2000 ms from the General tab. If the worker crashes, the main process auto-respawns it after 2 seconds.

### iRacing SDK Channels

| Channel | Used By |
|---------|---------|
| `LFtempCL/CM/CR`, `RFtempCL/CM/CR`, etc. | Tyre zone temperatures |
| `LFwearL/M/R`, etc. | Tyre wear |
| `LFpressure`, `RFpressure`, etc. | Tyre pressure |
| `Speed` | Radar, tyre estimation cooling |
| `LatAccel` | Tyre estimation cornering heat |
| `Brake`, `Throttle` | Tyre estimation heat sources |
| `CarLeftRight` | Radar spotter integration |
| `TrackTempCrew`, `AirTemp` | Tyre estimation baseline |
| `WindSpeed`, `RelativeHumidity` | Tyre estimation cooling |
| `OnPitRoad`, `CarIdxOnPitRoad`, `CarIdxTrackSurface`, `PlayerTrackSurface` | Pit detection |
| `DriverInfo.Drivers[].CarClassID/ShortName/Color` | Standings multi-class grouping |
| `DriverInfo.Drivers[].FlairName` | Country flag (full country name, e.g. "Brazil") |
| `DriverInfo.Drivers[].IRating` | iRating column |
| `DriverInfo.Drivers[].LicString` | Safety rating column |
| `CarIdxPosition`, `CarIdxBestLapTime`, `CarIdxLastLapTime`, `CarIdxF2Time` | Standings positions & lap times |
| `CarIdxIncidents` | Incident count |

---

## Configuration

Stored at `{userData}/overlay-config.json`. Merged with defaults on load, so new fields added in updates get their defaults automatically.

### All Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `widgetScale` | 1.0 | Tyre overlay scale |
| `opacity` | 0.9 | Tyre overlay opacity |
| `alwaysOnTop` | `true` | Keep all overlays above iRacing |
| `locked` | `false` | Click-through mode |
| `pollIntervalMs` | 200 | Telemetry update interval (ms) |
| `tiresEnabled` | `true` | Show tyre overlay |
| `radarEnabled` | `true` | Show radar overlay |
| `radarScale` | 1.0 | Radar scale |
| `radarOpacity` | 0.9 | Radar opacity |
| `radarRange` | 40 m | Detection range ahead/behind |
| `radarCarWidth` | 20 px | Car rectangle width on radar |
| `radarCarHeight` | 48 px | Car rectangle height on radar |
| `standingsEnabled` | `false` | Show standings overlay |
| `standingsOpacity` | 0.9 | Standings opacity |
| `standingsShowFlags` | `true` | Country flag column |
| `standingsShowCarNumber` | `true` | Car number column |
| `standingsShowMake` | `true` | Car model column |
| `standingsShowIRating` | `false` | iRating column |
| `standingsShowSafetyRating` | `false` | Safety rating column |
| `standingsShowBestLap` | `false` | Best lap column |
| `standingsShowLastLap` | `true` | Last lap column |
| `standingsShowIncidents` | `false` | Incident count column |
| `coldRedMax` | 50 °C | Cold threshold |
| `coldYellowMax` | 70 °C | Warming threshold |
| `hotYellowMin` | 110 °C | Hot threshold |
| `hotRedMin` | 130 °C | Overheat threshold |
| `overlayPosition` | auto | Saved tyre overlay [x, y] |
| `radarPosition` | auto | Saved radar [x, y] |
| `standingsPosition` | auto | Saved standings [x, y] |
| `standingsSize` | `[900, 500]` | Saved standings [w, h] |

---

## Launcher Window

### Tabs

**General**
- Always on Top toggle
- Lock overlays toggle (click-through)
- Poll interval input with usage hints
- Fuel the Development support card
- About / FAQ button

**Tires**
- Enable Tires Overlay toggle
- Widget Scale slider
- Opacity slider
- Temperature threshold inputs (°C) with visual zone bar

**Radar**
- Enable Radar toggle
- Radar Range, Scale, Opacity sliders
- Car Width / Height sliders
- Distance colour legend

**Standings**
- Enable Standings Overlay toggle
- Opacity slider
- 8 column visibility checkboxes (Country Flags, Car Number, Car Model, iRating, Safety Rating, Best Lap, Last Lap, Incidents)

**Coach**
- Live session bar (connection, car, track, weather)
- 5-step guided workflow: Import Setup → Select Problem → Record Lap → Recommendations → Export Setup
- Session history

---

## Window Behaviour

| State | Behaviour |
|-------|-----------|
| **Unlocked** | Drag bars visible, dashed border in move mode, windows draggable |
| **Locked** | All overlays are click-through (`setIgnoreMouseEvents(true, { forward: true })`). Standings board still scrollable by hovering over the table |

Window positions auto-save on `moved` event. Standings size auto-saves on `resized` event. Everything restores on next launch.

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Desktop framework | Electron 28 |
| Language | TypeScript 5.3 (strict mode) |
| iRacing SDK binding | irsdk-node 4.4.0 |
| Rendering | HTML5 Canvas (radar), CSS (tyre overlay, standings) |
| Build target | ES2020, CommonJS |
| Fonts | Segoe UI (system — tyre/standings overlays), Poppins (Google Fonts CDN — launcher/coach) |
| Packaging | @electron/packager — portable exe, no installer |
| Security | Context isolation on, no nodeIntegration, all IPC via contextBridge preload scripts |

---

## Prerequisites (source build only)

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

Double-click **Start.bat** to compile and launch in one step.

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

## Packaging a Release

```bash
npm run package
```

Produces a portable build in `release/ApexSense-win32-x64/` that runs without Node.js installed.

---

## Project Structure

```
src/
├── main/               # Electron main process (main.ts, preloads)
├── renderer/           # Tyre overlay & radar (HTML/CSS/TS, standingsRenderer.ts)
├── launcher/           # Settings launcher window
├── coach/              # Setup coach engine, renderer, store, setup parser/rules
├── about/              # About / FAQ page
├── config.ts           # Default configuration
├── configStore.ts      # Persistent config storage
├── telemetry.ts        # iRacing SDK telemetry types & reader
└── telemetryWorker.ts  # Background telemetry worker (forked child process)
```

---

## FAQ

**Q: Does it work with VR?**
A: The overlays render on your monitor. Use a VR overlay tool like OVR Toolkit to bring them into the headset.

**Q: Do I need Node.js installed?**
A: No. The packaged exe includes Electron's own Node.js runtime.

**Q: What if iRacing isn't running?**
A: All overlays display a "Waiting for iRacing telemetry…" message and auto-connect when a session starts.

**Q: Can I change thresholds per car?**
A: Adjust the four threshold values in the Tires tab. They apply globally — tune them per car/compound before a session.

**Q: The radar is too cluttered. How do I clean it up?**
A: Reduce Radar Range (min 15 m) in the Radar tab.

**Q: How does the standings overlay know my country?**
A: It reads the `FlairName` field from the iRacing SDK driver info, which returns full country names (e.g. "Brazil", "United States"). These are mapped to ISO codes for flag images.

**Q: Can I move the overlays?**
A: Unlock them first (uncheck "Lock overlays" in the General tab), then drag by the title bar. Position saves automatically.

**Q: What does the standings overlay show in practice?**
A: In practice all `CarIdxPosition` values are 0, so the standings ranks drivers by best lap time automatically.

**Q: How does the Setup Coach work?**
A: Import your `.sto` setup file, pick the handling problem, drive one lap while recording, and the coach ranks setup adjustments by priority using your telemetry data. Export the modified `.sto` to load directly in iRacing.

---

## License

This project is licensed under the MIT License — see [LICENSE](LICENSE) for details.
