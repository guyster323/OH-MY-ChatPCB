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
  assert.match(implementation, /KICTL_REVERT/);
  assert.match(implementation, /"linkState"\s*,\s*"conflict"/);
  assert.match(implementation, /"completed"\s*,\s*true/);
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
