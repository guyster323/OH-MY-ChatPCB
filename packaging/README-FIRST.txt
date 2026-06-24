ChatPCB KiCad Preview
=====================

This is a native Windows preview of the ChatPCB KiCad app.

Install
-------
1. Double-click "Install ChatPCB KiCad Preview.cmd".
   If ChatPCB KiCad Preview is already open, close it before running the installer again.
2. A desktop shortcut named "ChatPCB KiCad Preview" will be created.
3. A Start Menu folder named "ChatPCB KiCad Preview" will be created.
4. A Start Menu shortcut named "Run ChatPCB Self Test" will be created.
5. A Start Menu shortcut named "Run First Chat Smoke Test" will be created.
6. A Start Menu shortcut named "Start Here" will be created.
7. A Start Menu shortcut named "First Chat Guide" will be created.
8. INSTALL-SELF-TEST.txt will be written beside the installed app with a short PASS summary.
9. INSTALL-FIRST-CHAT-SMOKE.txt will be written beside the installed app with the chat-to-preview smoke result.
10. INSTALL-READY.txt will be written beside the installed app with "Type a board idea in Chat prompt, then press Enter."
11. The app starts after installation.

Self-test
---------
Open the Start Menu folder and click "Run ChatPCB Self Test" to verify the
installed executable prints a short PASS summary. It should include
"PASS Provider Login shows local CLI login hints" and
"PASS model selector falls back to built-in preview" and
"PASS app launch focuses the prompt for immediate first chat" and
"PASS prompt input has a visible label and empty cue" and
"PASS pressing Enter sends the first design" and
"PASS empty prompt visibly uses the built-in ESP32-S3 example" and
"PASS Send design returns focus for follow-up chat" and
"PASS provider/model selection is readiness-only for preview generation" and
"PASS first-run evidence blocks JLCPCB upload" and
"Boundary: prototype-review, not order-ready".

Open "Run First Chat Smoke Test" to verify the installed app can turn the
starter chat prompt into a saved preview workspace without provider login. It
should also match INSTALL-FIRST-CHAT-SMOKE.txt beside the installed app and
include these lines:

"PASS KiCad compatibility report written" and
"PASS beginner next steps written" and
"PASS JLCPCB manufacturing preview blockers written" and
"PASS ERC/DRC validation summary written".

First chat
----------
1. Type a PCB request immediately after the app opens. The starter prompt is already selected.
2. Press Enter to send it.
3. Confirm the model selector says built-in-preview when no local provider is ready, or has already picked an available local provider if one is found.
4. Click Provider Login to check local Codex, Claude Code, and Gemini CLI status without erasing chat.
5. If a provider is missing, confirm the chat transcript shows a local CLI install/login hint and says to click Provider Login again after local CLI login.
6. If no local provider is ready yet, continue anyway; the built-in preview still works.
7. Confirm Provider/model 선택은 준비 상태 확인용: preview 생성은 built-in local generator를 사용하며 provider CLI는 호출하지 않습니다.
8. Type immediately after Provider Login; focus returns to the prompt box.
9. Click Use example if the prompt box is empty.
10. The example text is selected, so typing replaces it.
11. Type or edit a PCB request in the prompt box, or press Enter immediately after Use example.
12. Press Enter in the prompt box, or click Send design.
13. If the prompt was empty, confirm the chat transcript says no prompt was typed and that the built-in ESP32-S3 example was used.
14. Confirm the chat transcript keeps the Provider Login status and appends the new design response.
15. Confirm the transcript is positioned at the latest response.
16. Confirm the chat transcript says "미리보기 저장 완료".
17. Confirm the large left preview body also shows the saved KiCad scaffold files.
18. Confirm the chat transcript and left preview body mention "KiCad CLI check".
19. Confirm kicad-pcb-check.txt is listed in the saved preview folder.
20. Confirm the chat transcript and left preview body mention "KiCad ERC/DRC reports".
21. Confirm erc-report.json, drc-report.json, and kicad-validation-summary.txt are listed in the saved preview folder.
22. Confirm BEGINNER-NEXT-STEPS.txt is listed in the saved preview folder.
23. Confirm jlcpcb-bom-preview.csv, jlcpcb-cpl-preview.csv, and manufacturing-readiness-preview.txt are listed in the saved preview folder.
24. Confirm the bottom status says "검증 완료: Open PCB/checklist 또는 후속 입력. 아직 prototype-review." when local ERC/DRC reports are clear.
25. Click Open PCB to inspect chatpcb3-esp32s3.kicad_pcb.
26. Confirm the bottom status says either "Opened preview PCB in KiCad PCB Editor." or "Opened preview PCB file. Install KiCad 10 if PCB Editor did not open."
27. If KiCad 10 is installed, confirm the KiCad PCB preview contains a 50mm x 50mm Edge.Cuts outline.
28. Click Review checklist to inspect the first-run evidence folder with BEGINNER-NEXT-STEPS.txt selected.
29. Confirm FIRST-RUN-SUMMARY.txt stays in the same folder for the prototype-review boundary.
30. Confirm manufacturing-readiness-preview.txt says not to upload this preview to JLCPCB.
31. Close and reopen the app, then click Review checklist before sending again.
32. Confirm the left project status says "이전 미리보기 발견".
33. Confirm the chat transcript also says "이전 미리보기 발견" and keeps the boundary visible as "order-ready 아님".
34. Confirm the short bottom status says "Recovered: 이어서 입력 후 Enter. Open PCB/Review checklist."
35. Confirm it reopens the same previous preview folder with BEGINNER-NEXT-STEPS.txt selected.
36. The folder path is:
   %LOCALAPPDATA%\ChatPCB3\Projects\chatpcb3-esp32s3-preview

Current boundary
----------------
This preview proves the native app shell and local runtime contract.
It saves prototype-review first-run evidence, but it does not yet generate
order-ready KiCad PCB files.

Evidence files
--------------
- INSTALL-READY.txt says where to start after install and keeps the Boundary: prototype-review, not order-ready.
- RELEASE-EVIDENCE.txt records the source commit and package contents.
- SHA256SUMS.txt records hashes for the packaged files.
- INSTALL-SELF-TEST.txt in the installed app folder records the installed executable PASS summary.

Uninstall
---------
Open the Start Menu folder and click "Uninstall ChatPCB KiCad Preview", or run
"Uninstall ChatPCB KiCad Preview.cmd" from the installed app folder.
