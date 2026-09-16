# ChatPCB schematic-editor panel

This is the C++ host for the KiCad right-side ChatPCB panel. It is not a standalone web UI.

The schematic editor instantiates `CHATPCB_PANEL` in the right AUI pane. The panel loads `apps/panel` in `wxWebView` and talks only to `chatpcb-agentd` on `127.0.0.1:41317`.

Development launch from this repository:

```powershell
npm run sync:kicad-fork
npm run launch:kicad
```

`CHATPCB_PANEL_URL` points the WebView at this checkout's `apps/panel/index.html`. `CHATPCB_CLI_COMMAND` starts the matching local daemon when one is not already running. Packaged builds still resolve `share/chatpcb_panel/index.html` next to the schematic editor.
