---
name: kicad-panel-computer-use
description: >-
  Default interactive verification for ChatPCB: drive the KiCad schematic
  editor right-side panel with Orca computer-use. Use when verifying the
  panel, dirty/conflict, Send, host bridge, or after launch:kicad.
---

# KiCad panel computer-use

The product UI is `eeschema` with the ChatPCB `wxWebView` pane. `npm run verify:ui` is a mock-host contract test, not this path.

## Start

```powershell
npm run daemon
npm run launch:kicad
```

Use `orca computer` against `--app eeschema`. Load `orca skills get computer-use` first. Prefer `--json`. After every action, read `result.snapshot.treeText` for new indexes.

## Expand the WebView tree

The first snapshot often hides panel fields. Click the canvas or ChatPCB web content, then snapshot again. Required labels:

- `편집 Project name` with `SetValue`
- `단추 New project`
- `편집 Circuit request` with `SetValue`
- `단추 Send`

## Drive the panel

1. `set-value` on Project name. Confirm `verification.state` is `verified`.
2. Click **New project**. Confirm Active project shows the name and a `workspaces\` path.
3. `set-value` on Circuit request with the real Korean/English prompt. Confirm verified.
4. Click **Send**.
5. Fail if Request status is `Circuit prompt is required` or `Circuit request is required` after a verified non-empty prompt.
6. If Chat classifies the request (MCU, isolated DC-DC, BMS, HMI, comms) and says no complete profile, that is the product flow. Use conversation options for that field (part candidates plus skip), not skip-only. Continue one catalog field at a time. Do not treat a Blocked review of a dummy fixture as success for an unmatched product.
7. Pass generation only when status becomes `Running request…`, `Patch preview is ready for approval.`, or `Completed` after the user chose a generate path.

## Dirty / need attention

Untitled `[Unsaved]` must show **KiCad changes need attention** and **I saved — recheck**.

After a real KiCad save (window title no longer `[Unsaved]`), click **I saved — recheck** or wait ~1s. The conflict heading must disappear.

Windows `Schematic Files` dialogs are poorly settable. Prefer File → Save As, then fill `파일 이름` with `set-value`/`paste-text` only after that field is focused. If the dialog blocks the panel, click **취소**.

Do not report a synthetic File-menu click as a successful save.

## Report

State whether each of these was verified from the tree, not assumed: Connected, project created, prompt landed, Send result, conflict while unsaved, conflict after save.
