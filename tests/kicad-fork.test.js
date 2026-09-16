import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('KiCad fork panel binds the WebView host bridge protocol', async () => {
  const header = await readFile('kicad-fork/chatpcb_panel/chatpcb_panel.h', 'utf8');
  const implementation = await readFile('kicad-fork/chatpcb_panel/chatpcb_panel.cpp', 'utf8');

  assert.match(header, /OnScriptMessage\s*\(\s*wxWebViewEvent&/);
  assert.match(header, /PostHostEvent\s*\(/);
  assert.match(header, /OpenProject\s*\(/);
  assert.match(header, /IsEditorDirty\s*\(\s*\)\s*const/);
  assert.match(header, /ReloadActiveProject\s*\(/);
  assert.match(implementation, /AddScriptMessageHandler\s*\(\s*wxT\(\s*"chatpcbHost"\s*\)\s*\)/);
  assert.match(implementation, /wxEVT_WEBVIEW_SCRIPT_MESSAGE_RECEIVED/);
  assert.match(implementation, /nlohmann::json::parse/);

  for (const token of ['project.open', 'project.status', 'project.reload', 'dirty']) {
    assert.ok(implementation.includes(`"${token}"`), `missing host protocol token ${token}`);
  }
});

test('KiCad fork bridge uses the active editor APIs and protects unsaved changes', async () => {
  const implementation = await readFile('kicad-fork/chatpcb_panel/chatpcb_panel.cpp', 'utf8');

  assert.match(implementation, /GetExt\s*\(\s*\).*CmpNoCase\s*\(\s*wxT\(\s*"kicad_pro"\s*\)\s*\)/s);
  assert.match(implementation, /OpenProjectFiles\s*\(/);
  assert.match(implementation, /IsContentModified\s*\(\s*\)/);
  assert.match(implementation, /wxEVT_IDLE/);
  assert.match(implementation, /OnIdle/);
  assert.match(implementation, /KICTL_REVERT/);
  assert.match(implementation, /"linkState"\s*,\s*"conflict"/);
  assert.match(implementation, /"completed"\s*,\s*true/);
});

test('project.open responses correlate with the panel active project directory', async () => {
  const implementation = await readFile('kicad-fork/chatpcb_panel/chatpcb_panel.cpp', 'utf8');
  const panel = await readFile('apps/panel/panel.js', 'utf8');
  const openProject = implementation.slice(
    implementation.indexOf('void CHATPCB_PANEL::OpenProject'),
    implementation.indexOf('bool CHATPCB_PANEL::IsEditorDirty')
  );

  assert.match(panel, /hostPathMatchesActive\s*\(\s*message\.projectPath\s*\)/);
  assert.match(openProject, /const wxString responsePath\s*=\s*projectFile\.GetPath\(\s*\)/);
  assert.doesNotMatch(openProject, /"projectPath"\s*,\s*ToUtf8\(\s*aProjectPath\s*\)/);
  assert.match(openProject, /"projectPath"\s*,\s*ToUtf8\(\s*responsePath\s*\)/);
});

test('KiCad fork host protocol echoes requestId and captures schematic selection', async () => {
  const header = await readFile('kicad-fork/chatpcb_panel/chatpcb_panel.h', 'utf8');
  const implementation = await readFile('kicad-fork/chatpcb_panel/chatpcb_panel.cpp', 'utf8');

  assert.match(header, /BuildSelectionContext\s*\(/);
  assert.match(header, /PostHostEvent\s*\(\s*const nlohmann::json&\s+\w+,\s*const std::string&\s+\w+/);
  assert.match(header, /OpenProject\s*\(\s*const wxString&\s+\w+,\s*const std::string&\s+\w+/);
  assert.match(header, /ReloadActiveProject\s*\(\s*const wxString&\s+\w+,\s*const std::string&\s+\w+/);

  assert.match(implementation, /"selection\.get"/);
  assert.match(implementation, /"selection\.context"/);
  assert.match(implementation, /SCH_SELECTION_TOOL/);
  assert.match(implementation, /GetSelection\s*\(\s*\)/);
  assert.match(implementation, /GetToolManager\s*\(\s*\)\s*->\s*GetTool\s*<\s*SCH_SELECTION_TOOL\s*>\s*\(\s*\)\s*->\s*GetSelection\s*\(\s*\)/);
  assert.match(implementation, /case\s+SCH_SYMBOL_T/);
  assert.match(implementation, /case\s+SCH_LABEL_T/);
  assert.match(implementation, /case\s+SCH_GLOBAL_LABEL_T/);
  assert.match(implementation, /case\s+SCH_HIER_LABEL_T/);
  assert.match(implementation, /m_Uuid\.AsString\s*\(\s*\)/);
  assert.match(implementation, /GetRef\(\s*&sheet,\s*false\s*\)/);
  assert.match(implementation, /GetShownText\(\s*&sheet,\s*false\s*\)/);
  assert.match(implementation, /schIUScale\.IUTomm/);
  assert.match(implementation, /GetCurrentSheet\s*\(\s*\)/);
  assert.match(implementation, /request\.value\(\s*"requestId"/);
  assert.match(implementation, /#include\s*<tool\/tool_manager\.h>/);
  assert.match(implementation, /#include\s*<tools\/sch_selection_tool\.h>/);
  assert.match(implementation, /#include\s*<sch_symbol\.h>/);
  assert.match(implementation, /#include\s*<sch_label\.h>/);
  assert.match(implementation, /#include\s*<base_units\.h>/);
  assert.match(implementation, /KICAD_SELECTION_UNSUPPORTED/);

  const postHostEvent = implementation.slice(
    implementation.indexOf('void CHATPCB_PANEL::PostHostEvent'),
    implementation.indexOf('void CHATPCB_PANEL::OpenProject')
  );
  assert.match(postHostEvent, /\.dump\s*\(\s*\)/);
  assert.match(postHostEvent, /wxT\(\s*"window\.postMessage\("\s*\)\s*\+\s*payload\s*\+\s*wxT\(\s*", '\*'\);"\s*\)/);
  assert.doesNotMatch(postHostEvent, /wxString::Format/);
  assert.match(postHostEvent, /"requestId"/);

  const onScriptMessage = implementation.slice(
    implementation.indexOf('void CHATPCB_PANEL::OnScriptMessage'),
    implementation.indexOf('void CHATPCB_PANEL::PostHostEvent')
  );
  assert.match(onScriptMessage, /"project\.status"/);
  assert.match(onScriptMessage, /"project\.reload"/);
  assert.match(onScriptMessage, /"selection\.get"/);
  assert.match(onScriptMessage, /PostHostEvent\s*\([\s\S]*requestId/);
  assert.match(onScriptMessage, /BuildSelectionContext\s*\(\s*requestId/);

  const openProject = implementation.slice(
    implementation.indexOf('void CHATPCB_PANEL::OpenProject'),
    implementation.indexOf('bool CHATPCB_PANEL::IsEditorDirty')
  );
  assert.match(openProject, /PostHostEvent\s*\([\s\S]*aRequestId/);

  const reload = implementation.slice(
    implementation.indexOf('void CHATPCB_PANEL::ReloadActiveProject'),
    implementation.indexOf('void CHATPCB_PANEL::LoadPanel')
  );
  assert.match(reload, /PostHostEvent\s*\([\s\S]*aRequestId/);

  for (const match of implementation.matchAll(/wxString::Format\s*\(([\s\S]*?)\)\s*;/g)) {
    assert.doesNotMatch(match[1], /\.dump\s*\(/);
    assert.doesNotMatch(match[1], /payload/);
  }
});

test('KiCad fork bootstrap documents project opening and dirty conflict fallback', async () => {
  const bootstrap = await readFile('docs/KICAD_FORK_BOOTSTRAP.md', 'utf8');

  assert.match(bootstrap, /\.kicad_pro/);
  assert.match(bootstrap, /project\.open/);
  assert.match(bootstrap, /project\.status/);
  assert.match(bootstrap, /project\.reload/);
  assert.match(bootstrap, /unsaved|dirty/i);
  assert.match(bootstrap, /official KiCad/i);
  assert.match(bootstrap, /manual|browser fallback/i);
});

test('KiCad fork bootstrap documents correlated selection without claiming a compiled host', async () => {
  const bootstrap = await readFile('docs/KICAD_FORK_BOOTSTRAP.md', 'utf8');

  assert.match(bootstrap, /selection\.get/);
  assert.match(bootstrap, /selection\.context/);
  assert.match(bootstrap, /requestId/);
  assert.match(bootstrap, /symbol/);
  assert.match(bootstrap, /label/);
  assert.match(bootstrap, /global_label/);
  assert.match(bootstrap, /hierarchical_label/);
  assert.match(bootstrap, /source contract/i);
  assert.match(bootstrap, /compiled KiCad 10 selection remains unverified/i);
  assert.match(bootstrap, /kicad-source-mirror-chatpcb/);
  assert.doesNotMatch(bootstrap, /interactive selection works/i);
});

test('product UI is the KiCad right-side ChatPCB panel, not a standalone web app', async () => {
  const readme = await readFile('README.md', 'utf8');
  const architecture = await readFile('docs/ARCHITECTURE.md', 'utf8');
  const bootstrap = await readFile('docs/KICAD_FORK_BOOTSTRAP.md', 'utf8');
  const panelReadme = await readFile('kicad-fork/README.md', 'utf8');

  assert.match(readme, /right-side ChatPCB panel/);
  assert.match(readme, /npm run launch:kicad/);
  assert.match(readme, /standalone browser fallback/i);
  assert.match(architecture, /product UI is the KiCad schematic editor's right-side ChatPCB panel/i);
  assert.match(architecture, /not a standalone web application/i);
  assert.match(bootstrap, /npm run launch:kicad/);
  assert.match(panelReadme, /right-side ChatPCB panel/);
  assert.match(panelReadme, /wxWebView/);
});

test('this repository owns the schematic-editor ChatPCB wiring patch', async () => {
  const patch = await readFile('kicad-fork/integration/wire-chatpcb-panel.patch', 'utf8');

  assert.match(patch, /m_chatPcbPanel = new CHATPCB_PANEL/);
  assert.match(patch, /ChatPcbPaneName/);
  assert.match(patch, /Caption\(\s*wxS\(\s*"ChatPCB"\s*\)\s*\)/);
  assert.match(patch, /plugins\/chatpcb_panel\/chatpcb_panel\.cpp/);
  assert.match(patch, /share\/chatpcb_panel/);
  assert.match(patch, /eeschema\/sch_edit_frame\.cpp/);
  assert.match(patch, /eeschema\/CMakeLists\.txt/);
});

test('launch script starts the ChatPCB-enabled schematic editor, not a browser product path', async () => {
  const launch = await readFile('scripts/launch-kicad-chatpcb.ps1', 'utf8');
  const sync = await readFile('scripts/sync-kicad-fork-panel.ps1', 'utf8');
  const configure = await readFile('scripts/configure-kicad-fork.ps1', 'utf8');
  const verifyKicad = await readFile('scripts/verify-kicad-panel.ps1', 'utf8');
  const computerUseSkill = await readFile('.grok/skills/kicad-panel-computer-use/SKILL.md', 'utf8');
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));

  assert.match(launch, /eeschema\.exe/);
  assert.match(launch, /CHATPCB_PANEL_URL/);
  assert.match(launch, /\?v=/);
  assert.match(launch, /CHATPCB_CLI_COMMAND/);
  assert.match(launch, /kicad-source-mirror-chatpcb/);
  assert.match(launch, /start "ChatPCB KiCad"/);
  assert.match(launch, /vcpkg_installed/);
  assert.doesNotMatch(launch, /Start-Process ['"]https?:\/\//);
  assert.match(sync, /plugins\\chatpcb_panel/);
  assert.match(sync, /apps\\panel/);
  assert.match(configure, /build\\chatpcb-vcpkg/);
  assert.equal(packageJson.scripts['launch:kicad'], 'powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/launch-kicad-chatpcb.ps1');
  assert.equal(packageJson.scripts['sync:kicad-fork'], 'powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/sync-kicad-fork-panel.ps1');
  assert.equal(packageJson.scripts['verify:kicad'], 'powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/verify-kicad-panel.ps1');
  assert.match(verifyKicad, /kicad-panel-computer-use/);
  assert.match(computerUseSkill, /set-value/);
  assert.match(computerUseSkill, /eeschema/);
  assert.match(computerUseSkill, /Circuit request/);
});

test('KiCad panel honors CHATPCB_PANEL_URL before packaged share assets', async () => {
  const implementation = await readFile('kicad-fork/chatpcb_panel/chatpcb_panel.cpp', 'utf8');
  const resolve = implementation.slice(
    implementation.indexOf('wxString CHATPCB_PANEL::ResolvePanelUrl'),
    implementation.length
  );

  assert.match(resolve, /wxGetEnv\s*\(\s*wxT\(\s*"CHATPCB_PANEL_URL"/);
  assert.match(resolve, /WithFileCacheBust/);
  assert.match(resolve, /CHATPCB_PANEL_ASSET_URL/);
  assert.ok(
    resolve.indexOf('CHATPCB_PANEL_URL') < resolve.indexOf('CHATPCB_PANEL_ASSET_URL'),
    'CHATPCB_PANEL_URL must be checked before the compile-time asset URL'
  );
});
