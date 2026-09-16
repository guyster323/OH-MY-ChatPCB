# ChatPCB KiCad panel

The product UI is the KiCad schematic editor's right-side ChatPCB panel.

`chatpcb_panel/` is the C++ `wxWebView` host. `apps/panel/` in the repository root is the bundle that host loads. That HTML is not a standalone web app; the browser path is only a fallback when this ChatPCB-enabled KiCad host is unavailable.

This repository owns:

- the panel C++ and WebView bundle
- the schematic-editor wiring patch in `integration/wire-chatpcb-panel.patch`
- the sync, configure, and launch scripts under `scripts/`

The KiCad source checkout lives beside this runtime at `C:\Users\windo\kicad-source-mirror-chatpcb` on `chatpcb-panel-scaffold`.

```powershell
npm run sync:kicad-fork
npm run configure:kicad-fork
npm run launch:kicad
```
