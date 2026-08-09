# ChatPCB Architecture

## Runtime Boundaries

ChatPCB is split into three local-only layers:

- KiCad fork UI: a `wxWebView` side panel and a small launcher for `chatpcb-agentd`
- Agent daemon: websocket and HTTP tool-call bridge on `127.0.0.1`
- KiCad automation: project generation, `kicad-cli` validation, and `ngspice` simulation hooks

The daemon does not store provider API keys. Provider-specific adapters call already-authenticated local CLI tools through the process bridge, accept provider-emitted `tool.call` JSON only, redact secrets from stderr transcripts and optional local trace files, and support process-level cancellation with `AbortSignal`.

## Natural-Language Project Flow

The panel owns one active named project at a time:

1. `project.create { workspaceRoot, projectName }` validates the Unicode display name, creates a safe slugged directory inside the selected workspace, and returns its normal filesystem path.
2. The user writes a Korean or English circuit request and presses **Send**.
3. Before dispatch, the panel asks the KiCad host for `project.status`. A dirty editor produces `linkState: "conflict"`; the panel does not send `project.request` or request a reload until the unsaved edits are resolved.
4. `project.request { projectDir, prompt, provider }` invokes the selected local provider, confines emitted tool calls to the active project, and falls back to bounded local generation or an automatically approved patch when the provider returns no call.
5. The daemon validates ERC, restores the previous artifacts when an existing-project update fails validation, recomputes the readiness review, and returns `{ operation, files, validation, review, providerEvents }`.
6. The panel renders request status, ERC, readiness review, artifacts, and KiCad link state independently. A clean host may receive `project.reload`; standalone browser mode instead shows the `.kicad_pro` path for manual opening.

The host bridge accepts `project.open`, `project.status`, and `project.reload` messages. It validates absolute `.kicad_pro` paths, correlates responses with the containing active-project directory, uses the current schematic editor APIs, and refuses open/reload while the editor has unsaved content.

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
- `chatpcb.kicad_sym`
- `sym-lib-table`
- `.chatpcb.json`
- `_simulation.cir`

The schematic uses project-local ChatPCB fixture symbols, wire stubs, net labels, no-connect markers for intentionally unused optional pins, and review notes. ChatPCB metadata stays in `.chatpcb.json`; custom top-level `chatpcb_*` schematic nodes are not allowed.

## Validation Contract

KiCad CLI lookup order:

1. explicit command flag
2. `KICAD_CLI_PATH`
3. Windows install directories for KiCad 10, 9, 8, then 7
4. `kicad-cli` from `PATH`

If KiCad CLI or ngspice is missing, commands return `ok: true` with `skipped: true` and a typed reason.

ERC and readiness are deliberately separate. ERC reports schematic electrical-rule errors and warnings. It does not run PCB DRC and cannot establish manufacturing readiness. The readiness review also accounts for unresolved parts, sourcing, datasheet checks, simulations, layout/DRC evidence, and other release gates; therefore `validation.erc.errorCount === 0` may coexist with warnings or a blocked review.
