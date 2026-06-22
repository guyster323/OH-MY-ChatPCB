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
1. Type a PCB request immediately after the app opens. The starter prompt is already selected.
2. Press Enter to send it.
3. Confirm the model selector has already picked an available local provider if one is found.
4. Click Provider Login to check local Codex, Claude Code, and Gemini CLI status.
5. Click Use example if the prompt box is empty.
6. Type or edit a PCB request in the prompt box.
7. Press Enter in the prompt box, or click Send design.
8. Confirm the chat transcript keeps the Provider Login status and appends the new design response.
9. Confirm the transcript is positioned at the latest response.
10. Confirm the chat transcript says "Preview workspace saved".
11. Confirm the large left preview body also shows the saved workspace files.
12. Click Open evidence to inspect the first-run evidence folder.
13. The folder path is:
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
