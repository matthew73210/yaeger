# Flash-size and code optimization analysis (April 12, 2026)

## Scope

Reviewed firmware build and high-footprint runtime paths:

- `platformio.ini` compiler/linker settings and debug profile defaults.
- `src/main.cpp` startup/runtime dependencies.
- `src/CommandLoop.cpp` control-path complexity.
- Feature flags in `src/config.h`.

## Key findings

1. The build used `CORE_DEBUG_LEVEL=3`, which increases compiled logging strings and debug plumbing.
2. No explicit size-oriented optimization/link-time flags were configured in `platformio.ini`.
3. Status pixel support (NeoPixel) was always linked from `main.cpp`, even though it is optional behavior.
4. `CommandLoop.cpp` is the largest translation unit (1271 lines), and remains the best next target for follow-up refactors (protocol dispatch split + minimizing repeated string work).

## Changes implemented

### 1) Size-oriented toolchain profile in `platformio.ini`

- Set `CORE_DEBUG_LEVEL=0` (reduce debug-level overhead in release firmware).
- Enabled code-size-oriented compile/link settings:
  - `-Os`
  - `-flto`
  - `-ffunction-sections`
  - `-fdata-sections`
  - `-fno-rtti`
  - `-fno-exceptions`
  - `-Wl,--gc-sections`

These options combine dead-code elimination and smaller code generation to reduce flash use.

### 2) Feature-gated status pixel dependency

- Added `ENABLE_STATUS_PIXEL` config flag (default `0`) in `src/config.h`.
- Wrapped NeoPixel include/instantiation and status updates in `src/main.cpp` with `#if ENABLE_STATUS_PIXEL`.

Result: the status pixel feature can be compiled out by default, removing related code paths from the final binary while still allowing opt-in builds.

## Expected impact (qualitative)

Because PlatformIO is unavailable in this environment, exact `.text` deltas could not be measured. Based on typical ESP32 builds:

- `-Os` + LTO + section GC frequently provides meaningful flash reduction versus default optimization.
- Disabling RTTI/exceptions can save additional space when not required by dependencies.
- Compiling out NeoPixel status code can provide a small-to-moderate reduction depending on linked symbols.

## Recommended follow-up (for further reduction)

1. Capture baseline and post-change sizes with:
   - `pio run -e esp32-s3`
   - `pio run -e esp32-s3 -t size`
2. Split `CommandLoop.cpp` into focused modules (`pid`, `roast_history`, `ws_commands`) so LTO/GC can drop unused helper paths more aggressively.
3. Move non-critical log strings to lower-verbosity builds only, or wrap debug-only messages in compile-time macros.
4. Consider a dedicated `release-size` environment in `platformio.ini` to keep current developer debug environment intact.
