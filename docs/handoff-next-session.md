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

## Next Work

1. Remove the remaining `Regulator_Linear:AMS1117-3.3`/`AP1117-15` inherited-symbol mismatch and regulator net-stub warnings so both supported profiles reach ERC `0` errors and `0` warnings in official KiCad 10.0.3.
2. Add exact orderable regulator/connector/passive part choices, datasheet pin mapping, and JLCPCB live sourcing evidence.
3. Add PCB/layout generation and DRC/manufacturing export gates before any `ready-for-release` status.
4. Add user-selectable supported-board profiles in the panel, with diff preview and approval-gated conversion from a blocked generic prompt to a supported profile.
5. Keep official KiCad latest-stable validation separate from the embedded fork panel path.
6. Install or document `ngspice` on Windows so simulation checks can run instead of returning `NGSPICE_UNAVAILABLE`.
7. Re-run direct Computer Use GUI verification when the Computer Use tool is callable again.
