# Schematic-editor wiring

`wire-chatpcb-panel.patch` is the ChatPCB delta against the KiCad schematic editor:

- instantiate `CHATPCB_PANEL` in the right AUI pane
- compile `plugins/chatpcb_panel/chatpcb_panel.cpp` into eeschema
- package `share/chatpcb_panel` for installed builds
- prepare build-tree assets and Windows runtime DLLs for direct `eeschema.exe` launch

Do not copy `share/chatpcb_panel` HTML from an old fork snapshot. Sync current sources from this repository:

```powershell
npm run sync:kicad-fork
```

That copies `kicad-fork/chatpcb_panel/*` into `plugins/chatpcb_panel/` and `apps/panel/*` into `share/chatpcb_panel/`.
