import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('WebView panel bundle connects to the local ChatPCB daemon', async () => {
  const html = await readFile('apps/panel/index.html', 'utf8');
  const script = await readFile('apps/panel/panel.js', 'utf8');

  assert.match(html, /id="chat-log"/);
  assert.match(html, /id="preview-patch-button"/);
  assert.match(html, /id="provider"/);
  assert.match(html, /id="provider-status"/);
  assert.match(html, /id="cancel-provider-button"/);
  assert.match(html, /id="patch-diff"/);
  assert.match(html, /id="review-status"/);
  assert.match(html, /id="review-blockers"/);
  assert.match(html, /id="review-warnings"/);
  assert.match(html, /id="review-notes"/);
  assert.match(html, /id="review-fixes"/);
  assert.match(html, /id="approve-patch-button"/);
  assert.match(html, /id="cancel-patch-button"/);
  assert.match(html, /panel\.js/);
  assert.match(script, /ws:\/\/127\.0\.0\.1:41317\/ws/);
  assert.match(script, /tool\.call/);
  assert.match(script, /schematic\.generate/);
  assert.match(script, /schematic\.patch/);
  assert.match(script, /provider\.invoke/);
  assert.match(script, /provider\.cancel/);
  assert.match(script, /sendProviderChat/);
  assert.match(script, /sendProviderCancel/);
  assert.match(script, /activeProviderInvocationId/);
  assert.match(script, /provider\.status/);
  assert.match(script, /refreshProviderStatus/);
  assert.match(script, /rolledBack/);
  assert.match(script, /Patch validation failed/);
  assert.match(script, /renderReview/);
  assert.match(script, /ready for prototype review/i);
});

test('KiCad fork skeleton declares a wxWebView-backed ChatPCB panel', async () => {
  const header = await readFile('kicad-fork/chatpcb_panel/chatpcb_panel.h', 'utf8');
  const implementation = await readFile('kicad-fork/chatpcb_panel/chatpcb_panel.cpp', 'utf8');

  assert.match(header, /class CHATPCB_PANEL/);
  assert.match(header, /wxWebView/);
  assert.match(implementation, /CHATPCB_AGENT_PORT/);
  assert.match(implementation, /LoadURL/);
});
