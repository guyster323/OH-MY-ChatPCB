# Handoff: OH-MY-ChatPCB

## Current State

`chatpcb2` now contains a runnable scaffold for the proposed KiCad ChatPCB plan, including real-symbol MCU schematic generation, safe patch review, provider status checks, provider chat invocation plumbing, provider Stop cancellation, and the first local provider adapter contracts.

Working surfaces:

- `npm test`
- `node ./bin/chatpcb-cli.js generate --project <dir> --prompt <text>`
- `node ./bin/chatpcb-cli.js validate --project <dir>`
- `node ./bin/chatpcb-cli.js simulate --project <dir>`
- `node ./bin/chatpcb-cli.js daemon --host 127.0.0.1 --port 41317`
- `apps/panel/index.html`
- `kicad-fork/chatpcb_panel`
- provider registry/status checks for Codex, Claude, and Copilot
- fake-provider verified panel chat invocation and provider Stop cancellation through `npm run verify:ui`
- real Codex CLI provider smoke from panel chat without test injection
- direct Computer Use verification of the built KiCad fork panel: visible ChatPCB side panel, `Connected`, `codex: available`, in-KiCad `Generate`, artifact rendering, and generated schematic open in the fork editor
- review-loop readiness output for generated schematics: blockers, warnings, notes, approval-required proposed fixes, residual risks, and final status
- official KiCad latest-stable validation now upgrades generated schematics with `kicad-cli sch upgrade --force` before ERC so validated artifacts open in KiCad 10 without the old-version conversion banner

New next-session entrypoint:

- `docs/next-goal-kicad10-release-quality.md`

## Important Constraints

- The repo is the companion/runtime scaffold; the full KiCad fork checkout is at `C:\Users\windo\kicad-source-mirror-chatpcb` on `chatpcb-panel-scaffold`.
- Generated schematics now use project-local ChatPCB fixture symbols, labels, wire stubs, no-connect markers, footprint mappings, and `.chatpcb.json` explanations.
- KiCad 9 is still installed at `C:/Program Files/KiCad/9.0/bin/kicad-cli.exe`.
- As of 2026-06-08, the latest official stable release found from KiCad sources was KiCad 10.0.3. It was installed with `winget` using user scope.
- Official KiCad 10.0.3 path: `C:/Users/windo/AppData/Local/Programs/KiCad/10.0/bin/kicad-cli.exe`.
- KiCad 10.0.3 `kicad.exe` product/file version: `10.0.3` / `10.0.3.49839`.
- The generated schematic quality is still not production/release quality. Treat the current generator as a reviewable integration draft unless blockers are resolved by a supported board generator.
- `ngspice` was not found on PATH during this run.
- Provider CLI availability is status-checked locally; provider credentials must never be stored in repo files.
- The KiCad fork checkout has source-level schematic editor panel integration. Visual Studio CMake plus vcpkg can configure and build the local `eeschema/eeschema.exe` target, including ChatPCB runtime assets.

## 2026-06-08 KiCad 10.0.3 and Review Loop Findings

- Root repo was reconstructed from `ff9b888 feat: complete ChatPCB KiCad panel flow`; the KiCad fork was clean on `chatpcb-panel-scaffold` at `6818a8e feat: wire ChatPCB panel into schematic editor`.
- Official KiCad latest stable was verified from official KiCad sources as 10.0.3, then installed in the current user profile. The downloaded installer signature was valid for `KICAD SERVICES CORPORATION`; SHA256 matched the winget manifest: `C2751315F4B8E19239A88F2055F6DBCCEABEC56F5A3FAB726269CEBD04333971`.
- First-run official KiCad setup used built-in libraries. Update checks were left enabled; anonymous data collection was disabled by default.
- Fresh target sample: `workspaces/esp32s3-usbc-sensor-kicad10-final`, prompt `USB-C 5V powered ESP32-S3 sensor board... JLCPCB orderable prototype`.
- Official KiCad 10.0.3 validate result: format upgrade ok, schematic version `(version 20260306)`, ERC `0` errors and `0` warnings.
- Official KiCad 10.0.3 export result: SVG `workspaces/esp32s3-usbc-sensor-kicad10-final/exports-svg/chatpcb_mcu_peripheral.svg`, PDF `workspaces/esp32s3-usbc-sensor-kicad10-final/chatpcb_mcu_peripheral.pdf`.
- Official KiCad GUI result: both raw generated schematic and validate/upgraded schematic open without the old-version conversion banner; project manager and schematic editor both open.
- Built fork GUI result: `C:\Users\windo\kicad-source-mirror-chatpcb\build\chatpcb-vcpkg\eeschema\eeschema.exe` launched, ChatPCB panel showed `Connected`, provider status showed `codex: available`, and in-KiCad Generate wrote artifacts to `workspaces/panel-project-from-kicad-20260608`.
- Product decision: choose the review-and-improve UX loop for this session. The ESP32-S3/JLCPCB request is not sufficiently specified for release-quality generation because exact ESP32-S3 part/module, USB-C connector, regulator, debug connector, GPIO/SPI/USB pinout, footprints, ESD/protection, and JLCPCB sourcing assumptions are missing.
- Current readiness for the ESP32-S3 sample: blocked, not release-ready. ERC clean means KiCad can parse/check the draft; it does not prove manufacturing quality.

Verification commands run:

```powershell
npm test
npm run verify:sample
npm run verify:panel
npm run verify:ui
node ./bin/chatpcb-cli.js generate --project ./workspaces/esp32s3-usbc-sensor-kicad10-final --prompt "USB-C 5V powered ESP32-S3 sensor board. 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, reset button, status LED, USB, SPI, GPIO header. Manufacturing target: JLCPCB orderable prototype."
node ./bin/chatpcb-cli.js validate --project ./workspaces/esp32s3-usbc-sensor-kicad10-final
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export svg --output .\workspaces\esp32s3-usbc-sensor-kicad10-final\exports-svg .\workspaces\esp32s3-usbc-sensor-kicad10-final\chatpcb_mcu_peripheral.kicad_sch
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export pdf --output .\workspaces\esp32s3-usbc-sensor-kicad10-final\chatpcb_mcu_peripheral.pdf .\workspaces\esp32s3-usbc-sensor-kicad10-final\chatpcb_mcu_peripheral.kicad_sch
```

## Next Work

1. Improve the review-loop fix proposals so a user can choose a supported ESP32-S3 module/USB-C/regulator profile and preview an actual schematic diff.
2. Add supported-board profiles only when exact orderable parts, footprints, pinout, and assumptions are known.
3. Keep official KiCad latest-stable validation separate from the embedded fork panel path.
4. Install or document `ngspice` on Windows so simulation checks can run instead of returning `NGSPICE_UNAVAILABLE`.
5. Re-run direct GUI verification with a fresh unlocked sample project after any KiCad file-format or panel changes.
