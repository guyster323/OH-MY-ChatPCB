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
- supported ESP32-S3 and STM32 USB-C sensor-board profiles that expand the real schematic structure and stop at `ready-for-prototype-review` unless release gates are satisfied

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
- Supported board profiles improve the structure enough for prototype review, but still do not claim JLCPCB release readiness without live sourcing, final part choices, and layout/manufacturing checks.
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

## 2026-06-08 Supported Profile Improvement Findings

- User question answered by implementation: there is a practical improvement path for `ESP32-S3 USB-C sensor board is not release-quality yet`, but it should be a supported-profile and review-gate path, not a blanket claim that arbitrary prompts produce release-quality boards.
- Added reusable supported-board profile normalization in `src/runtime/board-profiles.js`.
- Added two profile paths:
  - `esp32-s3-usbc-sensor`: exact module value `ESP32-S3-WROOM-1-N8R2`, real KiCad 10 footprint `RF_Module:ESP32-S3-WROOM-1`, USB-C 5V sink rails, I2C, UART, USB, SPI, GPIO, reset, boot, status LED, decoupling, CC pulldowns, and ESP32 USB-JTAG/JTAG debug mapping.
  - `stm32-usbc-sensor`: exact MCU value `STM32G0B1CBT6`, KiCad footprint `Package_QFP:LQFP-48_7x7mm_P0.5mm`, same board structure, and direct ARM SWD nets `SWDIO`, `SWCLK`, `NRST`.
- Improved schematic generation so supported profiles use exact profile MCU symbols instead of `MCU_PLACEHOLDER`, include USB-C/SPI/GPIO/debug/decoupling/CC components, and only embed project-local symbols used by the schematic.
- Fixed KiCad 10 local symbol-library compatibility for exact profile MCU symbols by separating symbol ID from part value.
- Verified KiCad 10 official footprints exist locally for `RF_Module:ESP32-S3-WROOM-1`, `Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12`, and `Package_QFP:LQFP-48_7x7mm_P0.5mm`.
- Official KiCad latest stable was rechecked from official KiCad sources during this session:
  - KiCad Windows downloads page reported Current Version `10.0.3`.
  - KiCad 10.0.3 release post dated 2026-05-15 described `10.0.3` as the stable bug-fix release.
  - Installed CLI path `C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe` returned version `10.0.3`.
- Fresh ESP32 profile sample: `workspaces/esp32-s3-usbc-sensor-profile`.
- Fresh STM32 profile sample: `workspaces/stm32-usbc-sensor-profile`.
- Official KiCad 10.0.3 validation result for both profile samples: format upgrade ok, ERC `0` errors and `0` warnings.
- Official KiCad 10.0.3 export result:
  - ESP32 SVG/PDF under `workspaces/esp32-s3-usbc-sensor-profile/exports`.
  - STM32 SVG/PDF under `workspaces/stm32-usbc-sensor-profile/exports`.
- Official KiCad 10.0.3 `eeschema.exe` process smoke: ESP32 profile schematic launched and stayed alive for 5 seconds, then was stopped.
- Built fork executable smoke: `C:\Users\windo\kicad-source-mirror-chatpcb\build\chatpcb-vcpkg\eeschema\eeschema.exe` launched the ESP32 profile schematic and stayed alive for 5 seconds, then was stopped.
- Direct Computer Use was not callable in this run; GUI evidence is therefore CLI export/process smoke plus automated browser panel verification, not a visual click-through of the native KiCad panel.
- Final readiness decision for the improved ESP32/STM32 profile samples: `ready-for-prototype-review`, not `ready-for-release`. Remaining release blockers are live JLCPCB sourcing/orderability, exact regulator and connector orderable part decisions, pin-level electrical review against the datasheets, protection/ESD policy, layout/DRC/manufacturing files, and simulation because `ngspice` is unavailable.

## 2026-06-08 Release Gate and Cross-Profile Circuit Expansion

- Added another TDD increment toward the persistent release-quality goal without claiming release readiness.
- Both supported profiles now add actual support-circuit structure that had been implicit before:
  - `R3` status LED series resistor, value `1k`.
  - `R4` I2C SCL pull-up, value `4.7k`.
  - `R5` I2C SDA pull-up, value `4.7k`.
- Both supported profiles now carry explicit `boardProfile.releaseGates` in `.chatpcb.json`:
  - `production-symbols`: pending until support components use production KiCad symbols.
  - `sourcing`: pending until JLCPCB/LCSC live orderability is checked for every exact component.
  - `datasheet-pin-review`: pending until MCU/regulator/USB/debug/reset/boot pins are checked against datasheets.
  - `simulation`: pending until power, LED, reset/boot, and I2C pull-up assumptions have simulation or calculation evidence.
  - `layout-drc`: pending until PCB layout DRC, Gerbers, drill files, and manufacturer constraints exist.
- Review output now warns with `profile-support-symbols` when a supported profile still uses project-local ChatPCB fixture symbols for support components.
- Review output now lists each pending release gate in `residualRisks`, so ERC-clean profile schematics remain visibly not release-ready.
- Official KiCad latest stable was rechecked again from official KiCad sources during this increment:
  - KiCad Windows downloads page still reported current stable `10.0.3`.
  - KiCad 10.0.3 release post dated 2026-05-15 still identified `10.0.3` as the stable bug-fix release.
  - Installed CLI path `C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe` returned version `10.0.3`.
- Fresh ESP32 and STM32 profile samples were regenerated after the release-gate changes.
- Official KiCad 10.0.3 validation result for both regenerated profile samples: format upgrade ok, ERC `0` errors and `0` warnings.
- Official KiCad 10.0.3 SVG/PDF export succeeded for both regenerated profile samples.
- Official KiCad 10.0.3 `eeschema.exe` process smoke: ESP32 profile schematic launched and stayed alive for 5 seconds, then was stopped.
- Built fork `eeschema.exe` process smoke: STM32 profile schematic launched and stayed alive for 5 seconds, then was stopped.
- Direct Computer Use remained unavailable as a callable tool in this run, so native GUI click-through was not repeated.

## 2026-06-08 Production Support Symbol Increment

- Answered the user's follow-up directly: yes, there is an improvement path for `ESP32-S3 USB-C sensor board is not release-quality yet`, but the safe path is staged. The current session advanced the supported-profile schematic toward release quality without changing the final state to release-ready.
- Current root baseline before this increment was `ce8a7f5 feat: expose release gates for board profiles`; KiCad fork baseline remained clean at `6818a8e feat: wire ChatPCB panel into schematic editor`.
- Official KiCad latest stable was rechecked from official KiCad sources:
  - KiCad Windows downloads page reported Current Version `10.0.3`.
  - KiCad 10.0.3 release post dated 2026-05-15 described `10.0.3` as the stable bug-fix release.
  - Installed CLI path `C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe` returned version `10.0.3`.
- Implemented with TDD:
  - Supported ESP32-S3 and STM32 profiles no longer place support components as `ChatPCB:*` fixture symbols.
  - Support components now use production-facing KiCad library IDs where possible: `Regulator_Linear:AMS1117-3.3`, `Device:R`, `Device:C`, `Device:LED`, `Switch:SW_Push`, `Connector:USB_C_Receptacle_USB2.0_16P`, `Connector_Generic:Conn_01x02`, `Connector_Generic:Conn_01x04`, `Connector_Generic:Conn_01x05`, `Connector_Generic:Conn_01x06`, and `Connector_Generic:Conn_02x05_Odd_Even`.
  - The project-local `chatpcb.kicad_sym` is now filtered to only the used ChatPCB symbols, so supported profiles keep the profile MCU local symbol but drop support fixture symbols from the project-local library.
  - The schematic-level symbol cache includes generated definitions for support symbols so KiCad 10 can preserve label connectivity instead of producing dangling/isolated-label ERC errors.
  - `production-symbols` release gate moved from pending to complete for the supported profile support components. It still explicitly notes that profile MCU symbols remain project-local when an exact official KiCad symbol is unavailable.
- Root-cause note: changing only the placed `lib_id` to official KiCad symbols caused KiCad 10.0.3 ERC failures (`label_dangling`, `isolated_pin_label`, `unconnected_wire_endpoint`) because the generated label stubs were positioned for ChatPCB's rectangular symbol geometry, not the official library geometry. Adding schematic symbol cache definitions fixed the connectivity errors, but KiCad now reports `lib_symbol_mismatch` warnings because those cached definitions intentionally do not match the official library drawings.
- Fresh generated samples:
  - `workspaces/esp32-s3-usbc-sensor-profile`
  - `workspaces/stm32-usbc-sensor-profile`
- Official KiCad 10.0.3 validation result for both samples:
  - Format upgrade ok.
  - ERC errors: `0`.
  - ERC warnings: `18`, all `lib_symbol_mismatch`.
  - Integration status: KiCad 10 can parse, upgrade, ERC-check, and export the generated projects.
  - Release-quality status: not release-quality because the release bar requires zero ERC warnings and real production symbol geometry.
- Official KiCad 10.0.3 export result:
  - ESP32 PDF `workspaces/esp32-s3-usbc-sensor-profile/exports/chatpcb_mcu_peripheral.pdf`, 96542 bytes.
  - ESP32 SVG `workspaces/esp32-s3-usbc-sensor-profile/exports/chatpcb_mcu_peripheral.svg`, 959495 bytes.
  - STM32 PDF `workspaces/stm32-usbc-sensor-profile/exports/chatpcb_mcu_peripheral.pdf`, 94074 bytes.
  - STM32 SVG `workspaces/stm32-usbc-sensor-profile/exports/chatpcb_mcu_peripheral.svg`, 945449 bytes.
- GUI/process smoke:
  - Official `C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\eeschema.exe` opened the ESP32 profile schematic and stayed alive for 5 seconds.
  - Fork `C:\Users\windo\kicad-source-mirror-chatpcb\build\chatpcb-vcpkg\eeschema\eeschema.exe` opened the ESP32 profile schematic and stayed alive for 5 seconds.
  - Direct Computer Use remained unavailable as a callable desktop tool; the native KiCad panel click-through was not repeated in this increment.
- Final user-facing decision after this increment:
  - `integration works`: yes, for KiCad latest stable 10.0.3, including generate, validate, export, panel verification, and process launch smoke.
  - `release-quality circuit`: no. The generated ESP32-S3 and STM32 supported profiles are `ready-for-prototype-review`, not `ready-for-release`.
  - Remaining blockers: replace generated cached support definitions with real official KiCad symbol geometry or connect to official pin locations, remove `lib_symbol_mismatch` warnings, complete datasheet pin review, live JLCPCB/LCSC sourcing, exact orderable regulator/connector/passive decisions, ESD/protection policy, PCB layout/DRC/Gerbers/drill/manufacturing outputs, and simulation/calculation evidence.

Verification commands run for this increment:

```powershell
node --test tests\board-profiles.test.js
npm test
npm run verify:sample
npm run verify:panel
npm run verify:ui
$env:KICAD_CLI_PATH='C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe'
node ./bin/chatpcb-cli.js generate --project ./workspaces/esp32-s3-usbc-sensor-profile --prompt "Release profile ESP32-S3 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED."
node ./bin/chatpcb-cli.js validate --project ./workspaces/esp32-s3-usbc-sensor-profile
node ./bin/chatpcb-cli.js generate --project ./workspaces/stm32-usbc-sensor-profile --prompt "Release profile STM32 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED."
node ./bin/chatpcb-cli.js validate --project ./workspaces/stm32-usbc-sensor-profile
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export svg --output .\workspaces\esp32-s3-usbc-sensor-profile\exports .\workspaces\esp32-s3-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export pdf --output .\workspaces\esp32-s3-usbc-sensor-profile\exports\chatpcb_mcu_peripheral.pdf .\workspaces\esp32-s3-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export svg --output .\workspaces\stm32-usbc-sensor-profile\exports .\workspaces\stm32-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export pdf --output .\workspaces\stm32-usbc-sensor-profile\exports\chatpcb_mcu_peripheral.pdf .\workspaces\stm32-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
```

## 2026-06-08 Official Symbol Cache and Pin-Location Increment

- Added a second TDD increment after `e303555` to move from generated support-symbol cache geometry toward official KiCad symbol geometry.
- Current root baseline before this increment: `e303555 feat: use KiCad support symbols for profiles`.
- KiCad fork baseline remained clean at `6818a8e feat: wire ChatPCB panel into schematic editor`.
- Official KiCad latest stable was rechecked from official KiCad sources during this increment:
  - `https://www.kicad.org/download/windows/` reported Stable Release Current Version `10.0.3`.
  - `https://www.kicad.org/blog/2026/05/KiCad-10.0.3-Release/` identifies KiCad 10.0.3 as the 2026-05-15 stable bug-fix release.
  - Installed CLI path `C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe` remains the validation path.
- Implemented behavior:
  - Production-facing support symbols now cache the official KiCad 10 `.kicad_sym` symbol bodies from the local KiCad install instead of ChatPCB-generated rectangle symbols.
  - The generator adds official cache dependencies for inherited symbols such as `Regulator_Linear:AP1117-15` used by `Regulator_Linear:AMS1117-3.3`.
  - Supported profile components now carry pin-number-to-net maps so repeated official symbols such as `Device:R`, `Device:C`, `Switch:SW_Push`, connectors, and USB-C pins can be wired by real pin number rather than by a generic generated pin order.
  - The renderer now has explicit official pin-location tables for the supported KiCad symbols used by the ESP32-S3 and STM32 profile boards.
- Result versus previous increment:
  - Previous profile ERC: `0` errors, `18` warnings, all `lib_symbol_mismatch`.
  - Current ESP32-S3 profile ERC: `0` errors, `5` warnings: `multiple_net_names: 1`, `unconnected_wire_endpoint: 3`, `lib_symbol_mismatch: 1`.
  - Current STM32 profile ERC: `0` errors, `5` warnings: `multiple_net_names: 1`, `unconnected_wire_endpoint: 3`, `lib_symbol_mismatch: 1`.
  - The remaining warning cluster is still centered on the inherited `Regulator_Linear:AMS1117-3.3`/`AP1117-15` symbol and regulator net stubs.
- Fresh generated samples:
  - `workspaces/esp32-s3-usbc-sensor-profile`
  - `workspaces/stm32-usbc-sensor-profile`
- Official KiCad 10.0.3 export result after this increment:
  - ESP32 PDF `workspaces/esp32-s3-usbc-sensor-profile/exports/chatpcb_mcu_peripheral.pdf`, 105448 bytes.
  - ESP32 SVG `workspaces/esp32-s3-usbc-sensor-profile/exports/chatpcb_mcu_peripheral.svg`, 932016 bytes.
  - STM32 PDF `workspaces/stm32-usbc-sensor-profile/exports/chatpcb_mcu_peripheral.pdf`, 102951 bytes.
  - STM32 SVG `workspaces/stm32-usbc-sensor-profile/exports/chatpcb_mcu_peripheral.svg`, 917970 bytes.
- Verification commands run:

```powershell
node --test tests\board-profiles.test.js
npm test
npm run verify:sample
npm run verify:panel
npm run verify:ui
$env:KICAD_CLI_PATH='C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe'
node ./bin/chatpcb-cli.js generate --project ./workspaces/esp32-s3-usbc-sensor-profile --prompt "Release profile ESP32-S3 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED."
node ./bin/chatpcb-cli.js validate --project ./workspaces/esp32-s3-usbc-sensor-profile
node ./bin/chatpcb-cli.js generate --project ./workspaces/stm32-usbc-sensor-profile --prompt "Release profile STM32 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED."
node ./bin/chatpcb-cli.js validate --project ./workspaces/stm32-usbc-sensor-profile
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export svg --output .\workspaces\esp32-s3-usbc-sensor-profile\exports .\workspaces\esp32-s3-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export pdf --output .\workspaces\esp32-s3-usbc-sensor-profile\exports\chatpcb_mcu_peripheral.pdf .\workspaces\esp32-s3-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export svg --output .\workspaces\stm32-usbc-sensor-profile\exports .\workspaces\stm32-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export pdf --output .\workspaces\stm32-usbc-sensor-profile\exports\chatpcb_mcu_peripheral.pdf .\workspaces\stm32-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
```

- `npm run verify:ui` initially failed with `EADDRINUSE` on `127.0.0.1:41317` because a global installed `oh-my-chatpcb` daemon was already running. The stale ChatPCB daemon process was stopped, and `npm run verify:ui` then passed.
- Final readiness decision after this increment:
  - `integration works`: yes, KiCad 10.0.3 can generate, validate, and export both supported profiles.
  - `release-quality circuit`: still no. Release-quality requires ERC `0` errors and `0` warnings, exact orderable parts, datasheet pin review, sourcing, simulation/calculation evidence, and layout/manufacturing outputs.
  - Next concrete engineering target: remove the remaining AMS1117/AP1117 inherited-symbol mismatch and regulator net-stub warnings, then rerun ESP32/STM32 cross-profile ERC until both are `0` errors and `0` warnings.

## 2026-06-08 Direct 500mA Regulator and Zero-Warning ERC Increment

- Added a TDD increment after `1a11828 feat: cache official KiCad symbols for profiles` to remove the remaining regulator warning cluster without claiming release readiness.
- Root repo baseline before this increment: `1a11828 feat: cache official KiCad symbols for profiles`.
- KiCad fork baseline remained clean at `6818a8e feat: wire ChatPCB panel into schematic editor`.
- Official KiCad latest stable was rechecked from official KiCad sources during this increment:
  - `https://www.kicad.org/download/windows/` reported Stable Release Current Version `10.0.3`.
  - `https://www.kicad.org/blog/2026/05/KiCad-10.0.3-Release/` identifies KiCad 10.0.3 as the 2026-05-15 stable bug-fix release.
  - Installed CLI path `C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe` returned version `10.0.3`.
- Implemented behavior:
  - Replaced supported-profile `Regulator_Linear:AMS1117-3.3` with direct official KiCad symbol `Regulator_Linear:TC1262-33`.
  - `TC1262-33` was selected because the installed KiCad 10 symbol is direct, not inherited, and its description is `500mA Low Dropout CMOS Voltage Regulator, Fixed Output 3.3V, TO-220/SOT-223/TO-263`.
  - Updated the regulator pin-number map to `1=VBUS`, `2=GND`, `3=+3V3`.
  - Added `power:PWR_FLAG` markers for both `VBUS` and `GND` in supported profiles so KiCad ERC sees the USB-C input rail and board ground as driven.
  - Corrected 90/270-degree pin-label stub direction so official bottom/top pins connect outward instead of folding back through the symbol.
  - Increased schematic placement to 5 columns with larger row spacing to avoid official USB-C symbol pin stubs colliding with passives below it.
- Result versus previous increment:
  - Previous ESP32-S3 profile ERC: `0` errors, `5` warnings: `multiple_net_names: 1`, `unconnected_wire_endpoint: 3`, `lib_symbol_mismatch: 1`.
  - Previous STM32 profile ERC: `0` errors, `5` warnings: `multiple_net_names: 1`, `unconnected_wire_endpoint: 3`, `lib_symbol_mismatch: 1`.
  - Current ESP32-S3 profile ERC: `0` errors, `0` warnings.
  - Current STM32 profile ERC: `0` errors, `0` warnings.
- Fresh generated samples:
  - `workspaces/esp32-s3-usbc-sensor-profile`
  - `workspaces/stm32-usbc-sensor-profile`
- Official KiCad 10.0.3 export result after this increment:
  - ESP32 PDF `workspaces/esp32-s3-usbc-sensor-profile/exports/chatpcb_mcu_peripheral.pdf`, 106637 bytes.
  - ESP32 SVG `workspaces/esp32-s3-usbc-sensor-profile/exports/chatpcb_mcu_peripheral.svg`, 784815 bytes.
  - STM32 PDF `workspaces/stm32-usbc-sensor-profile/exports/chatpcb_mcu_peripheral.pdf`, 104108 bytes.
  - STM32 SVG `workspaces/stm32-usbc-sensor-profile/exports/chatpcb_mcu_peripheral.svg`, 773116 bytes.
- Verification run in this increment:
  - `node --test tests\board-profiles.test.js`: pass.
  - `npm test`: 62/62 pass.
  - `npm run verify:sample`: pass; sample ERC `0` errors and `0` warnings; simulation skipped with `NGSPICE_UNAVAILABLE`.
  - `npm run verify:panel`: pass.
  - `npm run verify:ui`: first hit stale global daemon on `127.0.0.1:41317`; stopped `cmd.exe`/`node.exe` daemon processes, reran, pass.
  - Official KiCad 10.0.3 ESP32/STM32 generate + validate: both ERC `0` errors and `0` warnings.
  - Official KiCad 10.0.3 ESP32/STM32 SVG/PDF export: pass.
  - Official `eeschema.exe` process smoke: ESP32 profile schematic launched and stayed alive for 4 seconds, then was stopped.
  - Fork `eeschema.exe` process smoke: ESP32 profile schematic launched and stayed alive for 4 seconds, then was stopped.
  - Direct Computer Use remained unavailable as a callable desktop tool; native KiCad panel click-through was not repeated in this increment.
- Final user-facing decision after this increment:
  - `integration works`: yes, with official KiCad latest stable 10.0.3 for generate, validate, ERC, export, and process launch smoke.
  - `schematic prototype-review quality`: improved materially; both supported profiles now have real support-component KiCad symbols, explicit part/value choices, PWR_FLAG rails, and ERC `0` errors/`0` warnings.
  - `release-quality circuit`: still no. Remaining release blockers are live JLCPCB/LCSC orderability, exact sourced part numbers for regulator/USB-C/passives/connectors, datasheet pin and electrical review, ESD/protection decisions, simulation or calculation evidence, PCB layout, DRC, Gerbers, drill files, and manufacturing constraints.

## 2026-06-08 Cross-Profile Release Evidence Increment

- Added a TDD increment after `68225f4 feat: use direct 500mA regulator symbol` to make the release gates follow the supported board profile instead of living only as generic prose.
- Root repo baseline before this increment: `68225f4 feat: use direct 500mA regulator symbol`.
- KiCad fork baseline remained clean at `6818a8e feat: wire ChatPCB panel into schematic editor`.
- Implemented behavior:
  - Supported ESP32-S3 and STM32 profiles now publish `boardProfile.productionParts` in `.chatpcb.json`.
  - Each supported profile currently records 19 production parts, including MCU/module, `U1 TC1262-33`, USB-C connector, reset/boot switches, status LED, headers, decoupling capacitors, CC pulldowns, LED resistor, and I2C pull-ups.
  - Each production part carries reusable `releaseChecks.sourcing` and `releaseChecks.datasheet` status. Electrically significant parts also carry `releaseChecks.simulation`.
  - Supported profiles now publish `boardProfile.releaseEvidence` with required checks `sourcing`, `datasheet`, `simulation`, and `layoutDrc`.
  - ESP32-S3 and STM32 differ in MCU part and debug-header role only; the same common evidence structure follows both profiles.
  - Review output now adds `release-gates-incomplete` when any release gate is pending, and residual risks now name concrete missing evidence such as `U1 TC1262-33`.
- Current generated metadata evidence:
  - ESP32 profile: `releaseEvidence.status = incomplete`, required checks `sourcing,datasheet,simulation,layoutDrc`, 19 production parts, MCU `ESP32-S3-WROOM-1-N8R2`.
  - STM32 profile: `releaseEvidence.status = incomplete`, required checks `sourcing,datasheet,simulation,layoutDrc`, 19 production parts, MCU `STM32G0B1CBT6`.
- Verification run in this increment:
  - `node --test tests\board-profiles.test.js`: pass.
  - `npm test`: 62/62 pass.
  - `npm run verify:sample`: pass; generic sample remains blocked for missing exact MCU and fixture symbols; sample ERC `0` errors and `0` warnings; simulation skipped with `NGSPICE_UNAVAILABLE`.
  - `npm run verify:panel`: pass.
  - `npm run verify:ui`: first hit stale global daemon on `127.0.0.1:41317`; stopped `cmd.exe`/`node.exe` daemon processes, reran, pass.
  - Official KiCad 10.0.3 ESP32/STM32 generate + validate: both ERC `0` errors and `0` warnings.
- Final user-facing decision after this increment:
  - `integration works`: still yes for official KiCad 10.0.3 generate/validate and panel/browser flows.
  - `flexibility improved`: yes. If the supported MCU changes from ESP32-S3 to STM32, the common release evidence and pending checks still follow the profile.
  - `release-quality circuit`: still no. The evidence structure now makes the remaining release blockers explicit per part, but sourcing, datasheet review, simulation/calculation evidence, PCB layout, DRC, Gerbers, drill files, and manufacturing constraints are not complete.

## 2026-06-08 Cross-Profile Calculation Evidence Increment

- Added a TDD increment after `ecd2a50 feat: track release evidence for profiles` to attach reusable electrical calculation evidence to both supported profiles.
- Root repo baseline before this increment: `ecd2a50 feat: track release evidence for profiles`.
- KiCad fork baseline remained clean at `6818a8e feat: wire ChatPCB panel into schematic editor`.
- Implemented behavior:
  - `boardProfile.releaseEvidence.calculations` now exists for both ESP32-S3 and STM32 supported profiles.
  - `status-led-current`: pass, `(3.3V - 2.0V) / 1k = 1.3mA` nominal LED current.
  - `usb-c-cc-pulldown-current`: pass, `5V / 5.1k = 0.98mA` per asserted CC pulldown path.
  - `i2c-pullup-rise-time`: warning, `0.8473 * 4.7k * 100pF = 398ns`; acceptable for 100kHz standard-mode assumptions but fast-mode requires actual bus capacitance review.
  - `regulator-thermal-budget`: blocker, `(5.0V - 3.3V) * 0.5A = 0.85W`; release remains blocked until package thermal resistance, copper area, ambient temperature, and sourced regulator variant are reviewed.
  - Review residual risks now include `calculation-blocker` and `calculation-warning` summaries when calculation evidence is not release-clean.
  - Tests now assert that the generated user review output exposes the regulator thermal blocker and I2C rise-time warning for both ESP32-S3 and STM32 profiles.
- Official KiCad stable recheck during final verification:
  - `https://www.kicad.org/download/windows/` still reported Stable Release Current Version `10.0.3`.
  - Installed CLI path `C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe` returned version `10.0.3`.
- Current generated metadata evidence:
  - ESP32 profile and STM32 profile both include the same four calculation evidence records.
  - MCU/profile changes do not drop LED, USB-C CC, I2C pull-up, or regulator thermal checks.
- Verification run in this increment:
  - `node --test tests\board-profiles.test.js`: pass.
  - `npm test`: 62/62 pass.
  - `npm run verify:sample`: pass; generic sample remains blocked; sample ERC `0` errors and `0` warnings; simulation skipped with `NGSPICE_UNAVAILABLE`.
  - `npm run verify:panel`: pass.
  - `npm run verify:ui`: pass.
  - Official KiCad 10.0.3 ESP32/STM32 validate: both ERC `0` errors and `0` warnings.
  - Official KiCad 10.0.3 ESP32/STM32 SVG/PDF export: pass for both generated profile projects.
- Final user-facing decision after this increment:
  - `integration works`: still yes.
  - `flexibility improved`: yes. The same calculation evidence follows ESP32-S3 and STM32 supported profiles.
  - `release-quality circuit`: still no. The regulator thermal calculation is now an explicit release blocker, and sourcing, datasheet, layout/DRC, manufacturing outputs, and live orderability evidence remain incomplete.

Additional verification commands run for this increment:

```powershell
node --test tests\board-profiles.test.js
npm test
npm run verify:sample
npm run verify:panel
npm run verify:ui
node ./bin/chatpcb-cli.js generate --project ./workspaces/esp32-s3-usbc-sensor-profile --prompt "Release profile ESP32-S3 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED."
node ./bin/chatpcb-cli.js validate --project ./workspaces/esp32-s3-usbc-sensor-profile
node ./bin/chatpcb-cli.js generate --project ./workspaces/stm32-usbc-sensor-profile --prompt "Release profile STM32 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED."
node ./bin/chatpcb-cli.js validate --project ./workspaces/stm32-usbc-sensor-profile
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export svg --output .\workspaces\esp32-s3-usbc-sensor-profile\exports .\workspaces\esp32-s3-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export pdf --output .\workspaces\esp32-s3-usbc-sensor-profile\exports\chatpcb_mcu_peripheral.pdf .\workspaces\esp32-s3-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export svg --output .\workspaces\stm32-usbc-sensor-profile\exports .\workspaces\stm32-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export pdf --output .\workspaces\stm32-usbc-sensor-profile\exports\chatpcb_mcu_peripheral.pdf .\workspaces\stm32-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
```

Additional verification commands run:

```powershell
node --test tests\board-profiles.test.js
npm test
npm run verify:sample
npm run verify:panel
npm run verify:ui
node ./bin/chatpcb-cli.js generate --project ./workspaces/esp32-s3-usbc-sensor-profile --prompt "Release profile ESP32-S3 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED."
node ./bin/chatpcb-cli.js validate --project ./workspaces/esp32-s3-usbc-sensor-profile
node ./bin/chatpcb-cli.js generate --project ./workspaces/stm32-usbc-sensor-profile --prompt "Release profile STM32 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED."
node ./bin/chatpcb-cli.js validate --project ./workspaces/stm32-usbc-sensor-profile
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export svg --output .\workspaces\esp32-s3-usbc-sensor-profile\exports .\workspaces\esp32-s3-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export pdf --output .\workspaces\esp32-s3-usbc-sensor-profile\exports\chatpcb_mcu_peripheral.pdf .\workspaces\esp32-s3-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export svg --output .\workspaces\stm32-usbc-sensor-profile\exports .\workspaces\stm32-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export pdf --output .\workspaces\stm32-usbc-sensor-profile\exports\chatpcb_mcu_peripheral.pdf .\workspaces\stm32-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
```

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

## 2026-06-08 Cross-Profile Buck Regulator Increment

- Added a TDD increment after `a8f46d4 feat: add profile calculation evidence` to turn the previous 500mA LDO thermal blocker into a real schematic topology change.
- Root repo baseline before this increment: `a8f46d4 feat: add profile calculation evidence`.
- KiCad fork baseline remained clean at `6818a8e feat: wire ChatPCB panel into schematic editor`.
- Implemented behavior:
  - Supported ESP32-S3 and STM32 profiles now use official KiCad symbol `Regulator_Switching:TPS62177DQC` instead of `Regulator_Linear:TC1262-33`.
  - The generated schematic now includes the buck support structure: `U1 TPS62177DQC`, `L1 2.2uH`, `C2 10uF` output capacitor, and `C3 10uF` input capacitor.
  - The buck IC pins are mapped as `VIN/EN/~SLEEP=VBUS`, `PGND/AGND/PAD=GND`, `SW=SW_3V3`, and `FB/VOS=+3V3`; `L1` connects `SW_3V3` to `+3V3`.
  - `boardProfile.productionParts` now records the buck regulator, inductor, input capacitor, and output capacitor for both profiles.
  - `regulator-topology-selection`: pass, because the previous equivalent LDO loss would be `0.85W`.
  - `buck-loss-estimate`: warning, `183mW` estimated converter loss at a provisional 90% efficiency assumption.
  - `regulator-thermal-budget`: pass, because the `0.85W` LDO loss is avoided by the buck topology.
- Current generated metadata evidence:
  - ESP32 profile and STM32 profile both include `U1 TPS62177DQC`, `L1 2.2uH`, `C2 10uF`, and `C3 10uF`.
  - MCU/profile changes do not drop the power-topology calculation checks.
- Verification run in this increment:
  - `node --test tests\board-profiles.test.js`: initially failed because the previous `TC1262-33` LDO was still generated; passed after implementation.
  - `npm test`: 62/62 pass.
  - `npm run verify:sample`: pass; generic sample remains blocked; sample ERC `0` errors and `0` warnings; simulation skipped with `NGSPICE_UNAVAILABLE`.
  - `npm run verify:panel`: pass.
  - `npm run verify:ui`: pass.
  - Official KiCad 10.0.3 ESP32/STM32 validate: both ERC `0` errors and `0` warnings.
  - Official KiCad 10.0.3 ESP32/STM32 SVG/PDF export: pass for both generated profile projects.
- Final user-facing decision after this increment:
  - `integration works`: still yes.
  - `flexibility improved`: yes. The buck regulator topology and calculation evidence follow both ESP32-S3 and STM32 supported profiles.
  - `release-quality circuit`: still no. The previous LDO thermal blocker is improved, but release-quality still requires sourced/orderable exact parts, datasheet review for TPS62177DQC and support passives, regulator efficiency/thermal/layout evidence, PCB layout, DRC, Gerbers, drill files, and manufacturing constraints.

Additional verification commands run for this increment:

```powershell
node --test tests\board-profiles.test.js
npm test
npm run verify:sample
npm run verify:panel
npm run verify:ui
node ./bin/chatpcb-cli.js generate --project ./workspaces/esp32-s3-usbc-sensor-profile --prompt "Release profile ESP32-S3 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED."
node ./bin/chatpcb-cli.js validate --project ./workspaces/esp32-s3-usbc-sensor-profile
node ./bin/chatpcb-cli.js generate --project ./workspaces/stm32-usbc-sensor-profile --prompt "Release profile STM32 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED."
node ./bin/chatpcb-cli.js validate --project ./workspaces/stm32-usbc-sensor-profile
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export svg --output .\workspaces\esp32-s3-usbc-sensor-profile\exports .\workspaces\esp32-s3-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export pdf --output .\workspaces\esp32-s3-usbc-sensor-profile\exports\chatpcb_mcu_peripheral.pdf .\workspaces\esp32-s3-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export svg --output .\workspaces\stm32-usbc-sensor-profile\exports .\workspaces\stm32-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export pdf --output .\workspaces\stm32-usbc-sensor-profile\exports\chatpcb_mcu_peripheral.pdf .\workspaces\stm32-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
```

## 2026-06-08 Evidence-Based Release Status Increment

- Added a TDD increment after `e253d4b feat: use buck regulator for profile power` so clean ERC alone cannot promote a profile to `ready-for-release`.
- Root repo baseline before this increment: `e253d4b feat: use buck regulator for profile power`.
- KiCad fork baseline remained clean at `6818a8e feat: wire ChatPCB panel into schematic editor`.
- Implemented behavior:
  - `reviewCircuitReadiness` now adds `release-evidence-incomplete` when profile production-part evidence, datasheet checks, simulation checks, release-evidence status, or calculation status is not release-clean.
  - A clean ERC result with pending production evidence now returns `ready-for-prototype-review`, not `ready-for-release`.
  - A profile can return `ready-for-release` only when ERC is `0` errors and `0` warnings, findings have no warnings/blockers, release gates are complete, production evidence checks are complete, and calculations are release-clean.
- TDD evidence:
  - New `tests/review-project.test.js` first reproduced the failure: a clean ERC plus pending sourcing evidence incorrectly returned `ready-for-release`.
  - After implementation, the same test verifies the result is `ready-for-prototype-review` with a `release-evidence-incomplete` warning.
  - A positive test verifies `ready-for-release` remains possible when all release evidence and ERC are complete.
- Verification run in this increment:
  - `node --test tests\review-project.test.js`: initially failed as expected, then passed.
  - `node --test tests\board-profiles.test.js tests\review-project.test.js`: pass.
  - `npm test`: 64/64 pass.
  - `npm run verify:sample`: pass; generic sample remains blocked; sample ERC `0` errors and `0` warnings; simulation skipped with `NGSPICE_UNAVAILABLE`.
  - `npm run verify:panel`: pass.
  - `npm run verify:ui`: pass.
  - Official KiCad 10.0.3 ESP32/STM32 validate: both ERC `0` errors and `0` warnings.
  - Official KiCad 10.0.3 ESP32/STM32 SVG/PDF export: pass for both generated profile projects.
- Final user-facing decision after this increment:
  - `integration works`: still yes.
  - `flexibility improved`: yes. Release readiness is now evidence-driven and cannot be accidentally granted when changing MCU/profile or support ICs.
  - `release-quality circuit`: still no. This increment improves the decision gate; the remaining concrete work is sourced/orderable parts, datasheet review, buck efficiency/thermal/layout evidence, PCB layout, DRC, Gerbers, drill files, and manufacturing constraints.

Additional verification commands run for this increment:

```powershell
node --test tests\review-project.test.js
node --test tests\board-profiles.test.js tests\review-project.test.js
npm test
npm run verify:sample
npm run verify:panel
npm run verify:ui
node ./bin/chatpcb-cli.js generate --project ./workspaces/esp32-s3-usbc-sensor-profile --prompt "Release profile ESP32-S3 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED."
node ./bin/chatpcb-cli.js validate --project ./workspaces/esp32-s3-usbc-sensor-profile
node ./bin/chatpcb-cli.js generate --project ./workspaces/stm32-usbc-sensor-profile --prompt "Release profile STM32 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED."
node ./bin/chatpcb-cli.js validate --project ./workspaces/stm32-usbc-sensor-profile
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export svg --output .\workspaces\esp32-s3-usbc-sensor-profile\exports .\workspaces\esp32-s3-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export pdf --output .\workspaces\esp32-s3-usbc-sensor-profile\exports\chatpcb_mcu_peripheral.pdf .\workspaces\esp32-s3-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export svg --output .\workspaces\stm32-usbc-sensor-profile\exports .\workspaces\stm32-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export pdf --output .\workspaces\stm32-usbc-sensor-profile\exports\chatpcb_mcu_peripheral.pdf .\workspaces\stm32-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
```

## 2026-06-08 PCB Draft and DRC Smoke Increment

- Added a TDD increment after `1f68035 feat: gate release status on evidence` to create the first supported-profile PCB artifact without claiming manufacturing readiness.
- Root repo baseline before this increment: `1f68035 feat: gate release status on evidence`.
- KiCad fork baseline remained clean at `6818a8e feat: wire ChatPCB panel into schematic editor`.
- Implemented behavior:
  - Supported ESP32-S3 and STM32 profiles now write `chatpcb_mcu_peripheral.kicad_pcb` and return `files.board`.
  - The generated board file contains a KiCad 10 PCB container, an `Edge.Cuts` board outline, and placement-only footprint references for all schematic components that declare footprints.
  - Supported-profile metadata now records `boardProfile.manufacturing.boardDraft.status = generated`.
  - The same metadata keeps `drc`, `exports.gerber`, and `exports.drill` as `pending`, with explicit reasons.
- TDD evidence:
  - `tests/project-generator.test.js` first failed because supported profiles did not return `files.board`.
  - After implementation, the test verifies `.kicad_pcb` creation, outline generation, key footprint references (`U1`, `L1`, `J4`), and pending manufacturing metadata.
- Verification run in this increment:
  - `node --test tests\project-generator.test.js`: pass, 7/7.
  - `npm test`: pass, 65/65.
  - `npm run verify:sample`: pass; generic sample remains blocked; sample ERC `0` errors and `0` warnings; simulation skipped with `NGSPICE_UNAVAILABLE`.
  - `npm run verify:panel`: pass.
  - `npm run verify:ui`: pass.
  - Official KiCad CLI path: `C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe`.
  - Official KiCad CLI version: `10.0.3`.
  - Official KiCad 10.0.3 ESP32/STM32 validate: both ERC `0` errors and `0` warnings.
  - Official KiCad 10.0.3 ESP32/STM32 SVG/PDF export: pass for both generated profile projects.
  - Official KiCad 10.0.3 ESP32/STM32 PCB DRC smoke: DRC runs and writes JSON reports, but both boards report `21` violations, `0` unconnected items, all grouped as `lib_footprint_mismatch`.
- Computer Use GUI verification:
  - Direct Windows Computer Use tooling was not callable in this session after tool discovery; only browser/Node automation tools were exposed.
  - GUI verification should be rerun in a future session where Computer Use is available.
- Final user-facing decision after this increment:
  - `integration works`: still yes.
  - `flexibility improved`: yes. The same PCB-draft/manufacturing metadata behavior now follows both ESP32-S3 and STM32 supported profiles.
  - `release-quality circuit`: still no. The board artifact is placement-only, the KiCad DRC reports `21` `lib_footprint_mismatch` violations, and routing, copper zones, constraints, DRC-clean evidence, Gerbers, drill files, sourced BOM, datasheets, and manufacturer checks remain incomplete.

Additional verification commands run for this increment:

```powershell
node --test tests\project-generator.test.js
npm test
npm run verify:sample
npm run verify:panel
npm run verify:ui
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" --version
node ./bin/chatpcb-cli.js generate --project ./workspaces/esp32-s3-usbc-sensor-profile --prompt "Release profile ESP32-S3 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED."
node ./bin/chatpcb-cli.js validate --project ./workspaces/esp32-s3-usbc-sensor-profile
node ./bin/chatpcb-cli.js generate --project ./workspaces/stm32-usbc-sensor-profile --prompt "Release profile STM32 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED."
node ./bin/chatpcb-cli.js validate --project ./workspaces/stm32-usbc-sensor-profile
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export svg --output .\workspaces\esp32-s3-usbc-sensor-profile\exports .\workspaces\esp32-s3-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export pdf --output .\workspaces\esp32-s3-usbc-sensor-profile\exports\chatpcb_mcu_peripheral.pdf .\workspaces\esp32-s3-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export svg --output .\workspaces\stm32-usbc-sensor-profile\exports .\workspaces\stm32-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export pdf --output .\workspaces\stm32-usbc-sensor-profile\exports\chatpcb_mcu_peripheral.pdf .\workspaces\stm32-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" pcb drc --output .\workspaces\esp32-s3-usbc-sensor-profile\chatpcb-drc.json --format json .\workspaces\esp32-s3-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_pcb
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" pcb drc --output .\workspaces\stm32-usbc-sensor-profile\chatpcb-drc.json --format json .\workspaces\stm32-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_pcb
```

## 2026-06-08 PCB Footprint and Net Assignment Increment

- Added a TDD increment after `2507a41 feat: add profile PCB draft metadata` to turn the PCB draft from footprint-name shells into a real KiCad footprint-body placement draft.
- Root repo baseline before this increment: `2507a41 feat: add profile PCB draft metadata`.
- KiCad fork baseline remained clean at `6818a8e feat: wire ChatPCB panel into schematic editor`.
- Implemented behavior:
  - `renderKiCadBoard` now resolves KiCad footprint files from `KICAD_FOOTPRINT_DIR`, the current-user KiCad 10 footprint library, or the all-users KiCad 10 footprint library.
  - Resolved `.kicad_mod` bodies are embedded into the generated board while preserving the `Lib:Footprint` board name and replacing `Reference`, `Value`, `at`, and UUIDs for each component instance.
  - The board now emits a top-level net table from component `pinNets`.
  - Embedded pads now receive `(net <id> "<name>")` assignments when the schematic component has a pin-to-net map, so USB-C A/B duplicate pads are treated as the same electrical nets rather than false shorts.
  - The supported board outline is now widened to `160mm x 120mm` to keep real embedded footprints away from the board edge in the placement draft.
  - The generated `.kicad_pro` now records board design rules for the supported footprint set, including `min_through_hole_diameter: 0.2` and `min_hole_clearance: 0.15`.
- TDD evidence:
  - `tests/project-generator.test.js` first failed because embedded footprint bodies lacked pads.
  - A second RED check failed because the board had no net table or pad-level net assignments.
  - A third RED check failed because the board outline was still `110mm x 80mm`.
  - A fourth RED check failed because `.kicad_pro` had no `board.design_settings.rules`.
  - After implementation, the test verifies cross-profile footprint embedding for ESP32-S3 and STM32, pad body preservation, resistor net assignment, the larger board outline, and project DRC rules.
- Verification run in this increment:
  - `node --test tests\project-generator.test.js`: pass, 8/8.
  - `npm test`: pass, 66/66.
  - `npm run verify:sample`: pass; generic sample remains blocked; sample ERC `0` errors and `0` warnings; simulation skipped with `NGSPICE_UNAVAILABLE`.
  - `npm run verify:panel`: pass.
  - `npm run verify:ui`: pass.
  - Official KiCad CLI path: `C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe`.
  - Official KiCad CLI version previously verified in this session: `10.0.3`.
  - Official KiCad 10.0.3 ESP32/STM32 validate: both schematic ERC `0` errors and `0` warnings.
  - Official KiCad 10.0.3 ESP32/STM32 SVG/PDF export: pass for both generated profile projects.
  - Official KiCad 10.0.3 PCB DRC after embedding/net/rule/outline changes:
    - ESP32-S3: `1` violation, `53` unconnected items; remaining violation type is `lib_footprint_mismatch:1` for `U2 RF_Module:ESP32-S3-WROOM-1`.
    - STM32: `0` violations, `51` unconnected items.
- Final user-facing decision after this increment:
  - `integration works`: still yes.
  - `flexibility improved`: yes. The footprint embedding, net table, pad assignment, outline, and DRC-rule logic apply across ESP32-S3 and STM32 supported profiles.
  - `release-quality circuit`: still no. STM32 now has zero PCB DRC violations for the placement draft, but both profiles still have many unconnected items because the board is not routed. ESP32 still has one RF module footprint-library mismatch. Neither profile has reviewed routing, copper zones, Gerbers, drill files, sourcing evidence, or datasheet signoff.

Additional verification commands run for this increment:

```powershell
node --test tests\project-generator.test.js
npm test
npm run verify:sample
npm run verify:panel
npm run verify:ui
node ./bin/chatpcb-cli.js generate --project ./workspaces/esp32-s3-usbc-sensor-profile --prompt "Release profile ESP32-S3 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED."
node ./bin/chatpcb-cli.js generate --project ./workspaces/stm32-usbc-sensor-profile --prompt "Release profile STM32 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED."
node ./bin/chatpcb-cli.js validate --project ./workspaces/esp32-s3-usbc-sensor-profile
node ./bin/chatpcb-cli.js validate --project ./workspaces/stm32-usbc-sensor-profile
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export svg --output .\workspaces\esp32-s3-usbc-sensor-profile\exports .\workspaces\esp32-s3-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export pdf --output .\workspaces\esp32-s3-usbc-sensor-profile\exports\chatpcb_mcu_peripheral.pdf .\workspaces\esp32-s3-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export svg --output .\workspaces\stm32-usbc-sensor-profile\exports .\workspaces\stm32-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export pdf --output .\workspaces\stm32-usbc-sensor-profile\exports\chatpcb_mcu_peripheral.pdf .\workspaces\stm32-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" pcb drc --output .\workspaces\esp32-s3-usbc-sensor-profile\chatpcb-drc.json --format json .\workspaces\esp32-s3-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_pcb
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" pcb drc --output .\workspaces\stm32-usbc-sensor-profile\chatpcb-drc.json --format json .\workspaces\stm32-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_pcb
```

## 2026-06-08 Conservative PCB Trace Scaffold Increment

- Added a TDD increment after `9c491a1 feat: embed profile PCB footprints` to test and implement a safer first PCB routing scaffold.
- Root repo baseline before this increment: `9c491a1 feat: embed profile PCB footprints`.
- KiCad fork baseline remained clean at `6818a8e feat: wire ChatPCB panel into schematic editor`.
- Implemented behavior:
  - The PCB generator now records embedded-footprint pad centers while assigning pad nets.
  - It emits KiCad `(segment ...)` records only for local same-footprint, same-net pad pairs.
  - Segment generation is deliberately conservative: maximum local span is `8mm`, and a segment is skipped if it runs within `0.8mm` of a different-net pad center.
  - This avoids pretending to have a full autorouter while still reducing some KiCad unconnected items when the segment can be emitted without creating obvious DRC conflicts.
- TDD/debugging evidence:
  - Initial RED test failed because generated PCB drafts had no segments.
  - A naive global same-net segment implementation reduced unconnected items to zero but created severe DRC regressions:
    - ESP32-S3: `169` violations, `0` unconnected; major types included `solder_mask_bridge:114`, `tracks_crossing:32`, `shorting_items:15`.
    - STM32: `141` violations, `0` unconnected; major types included `solder_mask_bridge:89`, `tracks_crossing:44`, `shorting_items:3`.
  - Added a second RED check requiring the draft trace scaffold to emit only conservative local segments with span `<= 8mm`.
  - DRC item inspection showed the naive/local-unfiltered failures came from high-density USB-C and WSON regulator pads where centerline traces crossed or ran too close to other nets.
  - After adding the different-net pad keepout filter, official KiCad 10.0.3 PCB DRC reports:
    - ESP32-S3: `1` violation, `48` unconnected items; remaining violation type is `lib_footprint_mismatch:1` for `U2 RF_Module:ESP32-S3-WROOM-1`.
    - STM32: `0` violations, `46` unconnected items.
- Verification run in this increment:
  - `node --test tests\project-generator.test.js`: pass, 8/8.
  - `npm test`: pass, 66/66.
  - `npm run verify:sample`: pass; generic sample remains blocked; sample ERC `0` errors and `0` warnings; simulation skipped with `NGSPICE_UNAVAILABLE`.
  - `npm run verify:panel`: pass.
  - `npm run verify:ui`: pass.
  - Official KiCad CLI path: `C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe`.
  - Official KiCad CLI version: `10.0.3`.
  - Official KiCad 10.0.3 ESP32/STM32 validate: both schematic ERC `0` errors and `0` warnings.
  - Official KiCad 10.0.3 ESP32/STM32 SVG/PDF export: pass for both regenerated profile projects.
  - Official KiCad 10.0.3 PCB DRC smoke on regenerated ESP32-S3 and STM32 profile projects: pass as a smoke command, with the counts above.
- User-facing decision:
  - `improvement method exists`: yes. The safe path is incremental DRC-measured PCB construction plus a review/fix loop, not a blanket "release-ready" claim.
  - `integration works`: still yes.
  - `release-quality circuit`: still no. ESP32-S3 still has one footprint-library mismatch plus unconnected items; STM32 has no DRC violations but still has unconnected items. Neither profile has complete routing, zones, Gerbers, drill outputs, sourced BOM, datasheet signoff, or JLCPCB-ready manufacturing evidence.

Additional commands run for this increment:

```powershell
node --test tests\project-generator.test.js
npm test
npm run verify:sample
npm run verify:panel
npm run verify:ui
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" --version
node ./bin/chatpcb-cli.js generate --project ./workspaces/esp32-s3-usbc-sensor-profile --prompt "Release profile ESP32-S3 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED."
node ./bin/chatpcb-cli.js generate --project ./workspaces/stm32-usbc-sensor-profile --prompt "Release profile STM32 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED."
node ./bin/chatpcb-cli.js validate --project ./workspaces/esp32-s3-usbc-sensor-profile
node ./bin/chatpcb-cli.js validate --project ./workspaces/stm32-usbc-sensor-profile
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export svg --output .\workspaces\esp32-s3-usbc-sensor-profile\exports .\workspaces\esp32-s3-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export pdf --output .\workspaces\esp32-s3-usbc-sensor-profile\exports\chatpcb_mcu_peripheral.pdf .\workspaces\esp32-s3-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export svg --output .\workspaces\stm32-usbc-sensor-profile\exports .\workspaces\stm32-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" sch export pdf --output .\workspaces\stm32-usbc-sensor-profile\exports\chatpcb_mcu_peripheral.pdf .\workspaces\stm32-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_sch
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" pcb drc --output .\workspaces\esp32-s3-usbc-sensor-profile\chatpcb-drc.json --format json .\workspaces\esp32-s3-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_pcb
& "C:\Users\windo\AppData\Local\Programs\KiCad\10.0\bin\kicad-cli.exe" pcb drc --output .\workspaces\stm32-usbc-sensor-profile\chatpcb-drc.json --format json .\workspaces\stm32-usbc-sensor-profile\chatpcb_mcu_peripheral.kicad_pcb
```

## Next Work

1. Continue routed PCB connections for both supported profiles so KiCad DRC unconnected items drop from ESP32-S3 `48` and STM32 `46` to zero before manufacturing export, without adding new DRC violations.
2. Resolve the remaining ESP32 `RF_Module:ESP32-S3-WROOM-1` `lib_footprint_mismatch` warning, likely by using a KiCad board-update flow or recording an explicit supported footprint normalization for RF module keepout/layer behavior.
3. Add initial copper zones and placement intent for critical buck loop, USB-C connector orientation, headers, reset/boot/debug access, and ground/power return paths.
4. Generate and validate Gerber and drill outputs only after PCB DRC has zero violations and zero unconnected items.
5. Add live orderable JLCPCB/LCSC part evidence for the supported regulator, inductor, USB-C connector, headers, passives, switch, LED, and MCU/module choices.
6. Fill `boardProfile.productionParts[*].releaseChecks.datasheet` with pin/rating/footprint evidence for the MCU/module, TPS62177DQC, buck inductor, USB-C connector, debug connector, passives, switches, and LED.
7. Replace the provisional `buck-loss-estimate` with sourced datasheet efficiency and thermal evidence for the selected buck regulator, inductor, input capacitor, output capacitor, PCB copper, and ambient assumptions.
8. Extend calculation or simulation evidence for reset/boot behavior, USB protection/ESD decisions, and regulator ripple/stability after the sourced regulator BOM is locked.
9. Add user-selectable supported-board profiles in the panel, with diff preview and approval-gated conversion from a blocked generic prompt to a supported profile.
10. Keep official KiCad latest-stable validation separate from the embedded fork panel path.
11. Install or document `ngspice` on Windows so simulation checks can run instead of returning `NGSPICE_UNAVAILABLE`.
12. Re-run direct Computer Use GUI verification when the Computer Use tool is callable again.
