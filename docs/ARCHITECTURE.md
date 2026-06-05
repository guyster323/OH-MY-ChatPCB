# ChatPCB Architecture

## Runtime Boundaries

ChatPCB is split into three local-only layers:

- KiCad fork UI: a `wxWebView` side panel and a small launcher for `chatpcb-agentd`
- Agent daemon: websocket and HTTP tool-call bridge on `127.0.0.1`
- KiCad automation: project generation, `kicad-cli` validation, and `ngspice` simulation hooks

The daemon does not store provider API keys. Provider-specific adapters should call already-authenticated local CLI tools through the process bridge.

## Message Envelope

All panel/daemon messages use this shape:

```json
{
  "version": 1,
  "id": "evt_<uuid>",
  "type": "tool.call",
  "createdAt": "2026-06-05T00:00:00.000Z",
  "payload": {}
}
```

Supported types:

- `chat.message`
- `agent.delta`
- `tool.call`
- `tool.result`
- `project.diff`
- `system.status`

## Generation Contract

The v1 generator produces review drafts for MCU peripheral circuits. It writes:

- `.kicad_pro`
- `.kicad_sch`
- `.chatpcb.json`
- `_simulation.cir`

The schematic intentionally uses KiCad-visible `text` notes in this scaffold. Direct symbol placement belongs in the next implementation phase, after fixture-based ERC tests are in place.

## Validation Contract

KiCad CLI lookup order:

1. explicit command flag
2. `KICAD_CLI_PATH`
3. Windows install directories for KiCad 10, 9, 8, then 7
4. `kicad-cli` from `PATH`

If KiCad CLI or ngspice is missing, commands return `ok: true` with `skipped: true` and a typed reason.
