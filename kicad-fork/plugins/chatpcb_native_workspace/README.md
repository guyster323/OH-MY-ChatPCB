# ChatPCB Native Workspace Plugin Skeleton

This source folder is the replacement for the failed WebView panel direction.

The panel is native wxWidgets code:

- `wxSplitterWindow` for the 70/30 workspace split
- `wxNotebook` for Schematic, PCB Layout, Validation, and Manufacturing Preview
- `wxTextCtrl`, `wxButton`, and `wxChoice` for chat and provider controls

Do not add `wxWebView`, HTML bundles, localhost URLs, or browser-hosted UI here.

Next KiCad fork step:

1. Rebase or clone from KiCad latest stable.
2. Add this folder under the fork's plugin/source tree.
3. Register `CHATPCB_WORKSPACE_PANEL` in the selected KiCad workspace frame.
4. Launch `chatpcb-core.exe` as a child process.
5. Send one JSON-RPC request per stdin line and read one response per stdout
   line.
