# ChatPCB Native Workspace Plugin Skeleton

This source folder is the replacement for the failed WebView panel direction.

The panel is native wxWidgets code:

- `wxSplitterWindow` for the 70/30 workspace split
- `wxNotebook` for Schematic, PCB Layout, Validation, and Manufacturing Preview
- `wxTextCtrl`, `wxButton`, and `wxChoice` for chat and provider controls
- `CMakeLists.txt` builds a `chatpcb_native_workspace` static library for
  drop-in use from a KiCad fork source tree
- `CHATPCB_CORE_CLIENT` launches `chatpcb-core.exe` and sends one stdio JSONL
  request per line

Do not add `wxWebView`, HTML bundles, localhost URLs, or browser-hosted UI here.

Next KiCad fork step:

1. Rebase or clone from KiCad latest stable.
2. Add this folder under the fork's plugin/source tree.
3. Add `add_subdirectory( plugins/chatpcb_native_workspace )` to the selected
   KiCad CMake entrypoint and link `chatpcb_native_workspace`.
4. Register `CHATPCB_WORKSPACE_PANEL` in the selected KiCad workspace frame.
5. Call `SetCoreExecutablePath(...)` with the installed `chatpcb-core.exe`.
