# Yaeger deep dive review (April 12, 2026)

This report focuses on two goals:

1. A general codebase health review across firmware and web UI.
2. A practical build-size reduction plan (firmware flash size and web assets sent to LittleFS).

## Scope reviewed

- Firmware runtime loop, API, control path, sensors, logging
  - `src/main.cpp`
  - `src/CommandLoop.cpp`
  - `src/api.cpp`
  - `src/sensors.cpp`
  - `src/logging.cpp`
  - `platformio.ini`
- Web app/runtime/build setup
  - `miniweb/src/*.tsx|*.ts`
  - `miniweb/package.json`
  - `miniweb/vite.config.ts`
- Build scripts
  - `build_and_flash.sh`

## What is strong already

- Clear module boundaries in firmware (`sensors`, `heater`, `fan`, `api`, `security`, `wifi_setup`).
- Runtime loop is mostly cooperative and tick-based rather than long blocking logic.
- Mutable API and command surfaces already have auth and CSRF checks.
- LittleFS static serving and OTA wiring are straightforward and maintainable.
- `miniweb` is organized by feature and has strongly-typed models.

## What "PWA" means in this project

**PWA** = **Progressive Web App**.

In this repo, that is the `vite-plugin-pwa` integration in `miniweb/vite.config.ts`, which generates a web app manifest and service-worker-related output for install/offline-style behavior in browsers.

In this project, treat PWA support as intentional (used to improve browser-side resilience/disconnect behavior), so it is **not** listed as a primary size-cut target.

## General deep-dive findings

## Firmware findings

1. **Always-on debug verbosity inflates binary and serial overhead**
   - `platformio.ini` sets `-D CORE_DEBUG_LEVEL=3` at the shared env level.
   - Recommendation: keep debug for dev environments only; use `CORE_DEBUG_LEVEL=0` in a release env.

2. **Feature flags are present, but not used aggressively for release-size profiles**
   - `ENABLE_LCD` and `ENABLE_WEBSERIAL_LOGGING` exist, but no explicit size-tuned env currently exists.
   - Recommendation: add dedicated `*-release` PlatformIO environments optimized for flash size.

## Web UI findings

1. **Potentially removable chart dependency stack**
   - `miniweb/src/chart.ts` imports Chart.js + trendline + adapter packages.
   - Active pages render graphs through `miniweb/src/graphs.tsx` (`@visx/*`) and not through `chart.ts`.
   - Recommendation: remove unused `chart.ts` and chartjs dependencies if confirmed unused in runtime. This is likely the single biggest web bundle reduction.

2. **Dual graph ecosystems increase maintenance + dependency weight**
   - Both `@visx/*` and Chart.js ecosystems are present in the repo.
   - Recommendation: keep one graph stack only.

3. **PWA plugin is intentional in this project**
   - `VitePWA` is enabled and should be treated as a required feature for browser resilience/disconnect handling.
   - Recommendation: keep `vite-plugin-pwa`; focus size cuts on unused dependencies and code-splitting first.

4. **Build script/package manager mismatch**
   - Root script uses `npm ci`, but `miniweb` currently tracks `yarn.lock` and no `package-lock.json`.
   - Recommendation: standardize to one package manager and lockfile to prevent drift and CI friction.

## Concrete build-size reduction plan

## Phase 1 (quick wins, low risk)

1. Add release environments in `platformio.ini`:
   - `-D CORE_DEBUG_LEVEL=0`
   - `-Os` (if not default via toolchain profile)
   - `-flto`
   - `-ffunction-sections -fdata-sections`
   - linker gc sections: `-Wl,--gc-sections`

2. Remove unused web chart stack if not referenced at runtime:
   - delete `miniweb/src/chart.ts`
   - remove from `miniweb/package.json`:
     - `chart.js`
     - `chartjs-adapter-date-fns`
     - `chartjs-plugin-trendline`
     - `date-fns`

## Phase 2 (medium effort, bigger wins)

1. Web code-splitting by tab:
   - lazy-load heavier tabs (`roast`, `autotune`, `logs`, `update`) from `main.tsx`.

2. Keep `vite-plugin-pwa` and optimize around it:
   - prioritize dependency pruning + lazy loading before considering PWA-level tradeoffs.

## Phase 3 (validation + guardrails)

1. Add a size budget check for web assets in CI:
   - fail if `data/assets/*` exceeds threshold.

2. Add firmware size regression check:
   - parse `pio run -t size` output and fail if flash exceeds budget.

3. Keep a simple changelog table for size deltas per release build.

## Evidence snapshots used for this review

- `platformio.ini` currently sets debug level and shared deps/flags globally.
- `miniweb/src/graphs.tsx` (visx-based) is actively used by `roast.tsx` and `autotune.tsx`.
- `miniweb/src/chart.ts` introduces a separate chart stack and appears not imported by active UI code.
- `miniweb/vite.config.ts` includes `VitePWA` and it is treated as intentional for browser resilience/disconnect behavior.

## Commands run for this review

- `rg --files`
- `sed -n '1,220p' README.md`
- `sed -n '1,260p' platformio.ini`
- `sed -n '1,260p' src/main.cpp`
- `sed -n '1,260p' src/api.cpp`
- `sed -n '1,280p' src/CommandLoop.cpp`
- `sed -n '1,260p' src/sensors.cpp`
- `sed -n '1,220p' src/logging.cpp`
- `sed -n '1,260p' miniweb/src/main.tsx`
- `sed -n '1,260p' miniweb/src/graphs.tsx`
- `sed -n '1,260p' miniweb/src/chart.ts`
- `sed -n '1,260p' miniweb/vite.config.ts`
- `sed -n '1,260p' miniweb/package.json`
- `rg "initializeChart|updateChart|chart\\.ts|RoastGraphs|AutotuneGraph" miniweb/src -n`
- `rg "chart\\.js|chartjs|trendline|date-fns" miniweb/src -n`

## Environment limitations encountered

- `pio run -e esp32-s3` could not run in this container (`pio: command not found`).
- `miniweb` build path currently has lockfile/peer dependency issues:
  - `npm ci` fails (no `package-lock.json`)
  - `yarn build` fails due to missing peer dependencies (`@babel/core`, `react`) required by current yarn/pnp resolution.

