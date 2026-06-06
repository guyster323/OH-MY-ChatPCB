# KiCad Fork Panel Skeleton

This directory contains the C++ drop-in skeleton for the KiCad fork branch.

Integration points:

- Add this directory to the KiCad source tree near the frame that owns the right dock area.
- Instantiate `CHATPCB_PANEL` inside the schematic and PCB editor frame side pane.
- Package `apps/panel/*` into the KiCad install tree at `share/chatpcb_panel/`.
- Ensure the `chatpcb` CLI is available on `PATH`, or change `EnsureAgentRunning()` to use the bundled executable path.

The panel intentionally loads a local WebView bundle and talks only to `chatpcb-agentd` on `127.0.0.1:41317`.
