ChatPCB KiCad Preview
=====================

This is a native Windows preview of the ChatPCB KiCad app.

Install
-------
1. Double-click "Install ChatPCB KiCad Preview.cmd".
2. A desktop shortcut named "ChatPCB KiCad Preview" will be created.
3. A Start Menu folder named "ChatPCB KiCad Preview" will be created.
4. The app starts after installation.

First chat
----------
1. Click Provider Login to check local Codex, Claude Code, and Gemini CLI status.
2. Confirm the model selector moves to an available local provider if one is found.
3. Click Use example if the prompt box is empty.
4. Type or edit a PCB request in the prompt box.
5. Click Send design.
6. Confirm the chat transcript says "Preview workspace saved".
7. Confirm the large left preview body also shows the saved workspace files.
8. Click Open evidence to inspect the first-run evidence folder.
9. The folder path is:
   %LOCALAPPDATA%\ChatPCB3\Projects\chatpcb3-esp32s3-preview

Current boundary
----------------
This preview proves the native app shell and local runtime contract.
It saves prototype-review first-run evidence, but it does not yet generate
order-ready KiCad PCB files.

Evidence files
--------------
- RELEASE-EVIDENCE.txt records the source commit and package contents.
- SHA256SUMS.txt records hashes for the packaged files.

Uninstall
---------
Open the Start Menu folder and click "Uninstall ChatPCB KiCad Preview", or run
"Uninstall ChatPCB KiCad Preview.cmd" from the installed app folder.
