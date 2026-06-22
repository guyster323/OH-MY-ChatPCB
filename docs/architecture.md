# ChatPCB3 Architecture

## Product Shape

ChatPCB3 is a native KiCad fork product, not a web application. The v1 Windows
application is named `ChatPCB KiCad` and is expected to ship as one installer
containing:

- forked KiCad latest-stable source
- native wxWidgets ChatPCB workspace
- `chatpcb-core.exe`
- bundled Freerouting runtime
- local provider CLI discovery for Codex, Claude Code, and Gemini CLI

## Native UI Contract

The workspace uses a fixed project-focused split:

- left 70 percent: schematic, PCB layout, validation, manufacturing preview
- right 30 percent: chat, provider login, model selector, pipeline status,
  patch approval

The UI must not use:

- `wxWebView`
- local HTML bundles
- Electron or Tauri
- browser-hosted localhost UI
- HTTP/WebSocket as the UI bridge

## Core Runtime Contract

KiCad launches `chatpcb-core.exe` as a child process and communicates through
stdio JSONL. Each request is one JSON object per line, and each response is one
JSON object per line.

Initial methods:

- `provider.list`
- `project.create`
- `layout.autoroute`
- `manufacturing.package`

Planned methods:

- `provider.loginStatus`
- `provider.invoke`
- `design.plan`
- `design.proposePatch`
- `patch.apply`
- `validation.run`
- `releaseGate.evaluate`

## V1 Board Target

The first supported board is fixed:

- ESP32-S3
- USB-C 5V input
- 3.3V 500mA rail
- 2-layer PCB
- 50 mm by 50 mm maximum board size
- I2C sensor connector
- UART debug
- USB device
- GPIO header
- JTAG debug
- JLCPCB/LCSC-oriented part selection

This constrained board is the proof vehicle for automatic placement,
Freerouting-based autorouting, ERC/DRC validation, manufacturing package
generation, and release evidence reporting.

## Release Gate

`order-ready-evidence` does not mean unattended ordering. It means the generated
evidence is complete enough for a human to upload to JLCPCB, inspect the quote
and preview, and make the final signoff.

The release gate is blocked if any of these are missing or failing:

- zero-error ERC evidence
- zero-error DRC evidence
- no unrouted nets
- Gerber zip
- drill file
- BOM with JLCPCB-aligned columns
- CPL / position file with JLCPCB-aligned columns
- visual review evidence
- explicit user signoff requirement
