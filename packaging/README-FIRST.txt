ChatPCB KiCad Preview
=====================

This is a native Windows preview of the ChatPCB KiCad app.

Install
-------
1. Double-click "Install ChatPCB KiCad Preview.cmd".
2. A desktop shortcut named "ChatPCB KiCad Preview" will be created.
3. A Start Menu folder named "ChatPCB KiCad Preview" will be created.
4. A Start Menu shortcut named "Run ChatPCB Self Test" will be created.
5. The app starts after installation.

Self-test
---------
Open the Start Menu folder and click "Run ChatPCB Self Test" to verify the
installed executable prints the native app contract. The JSON should include
"provider_login_shows_local_cli_login_hints": true.

First chat
----------
1. Type a PCB request immediately after the app opens. The starter prompt is already selected.
2. Press Enter to send it.
3. Confirm the model selector has already picked an available local provider if one is found.
4. Click Provider Login to check local Codex, Claude Code, and Gemini CLI status without erasing chat.
5. If a provider is missing, confirm the chat transcript shows a local CLI install/login hint and says to click Provider Login again after local CLI login.
6. If no local provider is ready yet, continue anyway; the built-in preview still works.
7. Type immediately after Provider Login; focus returns to the prompt box.
8. Click Use example if the prompt box is empty.
9. Type or edit a PCB request in the prompt box, or press Enter immediately after Use example.
10. Press Enter in the prompt box, or click Send design.
11. Confirm the chat transcript keeps the Provider Login status and appends the new design response.
12. Confirm the transcript is positioned at the latest response.
13. Confirm the chat transcript says "Preview workspace saved".
14. Confirm the large left preview body also shows the saved KiCad scaffold files.
15. Confirm the chat transcript and left preview body mention "KiCad CLI check".
16. Confirm kicad-pcb-check.txt is listed in the saved preview folder.
17. Confirm the chat transcript and left preview body mention "KiCad ERC/DRC reports".
18. Confirm erc-report.json, drc-report.json, and kicad-validation-summary.txt are listed in the saved preview folder.
19. Confirm the bottom status says "Validated: ERC/DRC clear. Next: Open PCB or Open evidence. Still prototype-review." when local ERC/DRC reports are clear.
20. Click Open PCB to inspect chatpcb3-esp32s3.kicad_pcb.
21. Confirm the bottom status says either "Opened preview PCB in KiCad PCB Editor." or "Opened preview PCB file. Install KiCad 10 if PCB Editor did not open."
22. If KiCad 10 is installed, confirm the KiCad PCB preview contains a 50mm x 50mm Edge.Cuts outline.
23. Click Open evidence to inspect the first-run evidence folder with FIRST-RUN-SUMMARY.txt selected.
24. Close and reopen the app, then click Open evidence before sending again.
25. Confirm the left project status says "Previous preview workspace found".
26. Confirm the chat transcript also says "Previous preview workspace found".
27. Confirm it reopens the same previous preview folder with FIRST-RUN-SUMMARY.txt selected.
28. The folder path is:
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
