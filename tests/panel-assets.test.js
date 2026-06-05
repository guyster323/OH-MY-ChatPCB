import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('WebView panel bundle connects to the local ChatPCB daemon', async () => {
  const html = await readFile('apps/panel/index.html', 'utf8');
  const script = await readFile('apps/panel/panel.js', 'utf8');

  assert.match(html, /id="chat-log"/);
  assert.match(html, /panel\.js/);
  assert.match(script, /ws:\/\/127\.0\.0\.1:41317\/ws/);
  assert.match(script, /tool\.call/);
  assert.match(script, /schematic\.generate/);
});

test('KiCad fork skeleton declares a wxWebView-backed ChatPCB panel', async () => {
  const header = await readFile('kicad-fork/chatpcb_panel/chatpcb_panel.h', 'utf8');
  const implementation = await readFile('kicad-fork/chatpcb_panel/chatpcb_panel.cpp', 'utf8');

  assert.match(header, /class CHATPCB_PANEL/);
  assert.match(header, /wxWebView/);
  assert.match(implementation, /CHATPCB_AGENT_PORT/);
  assert.match(implementation, /LoadURL/);
});
