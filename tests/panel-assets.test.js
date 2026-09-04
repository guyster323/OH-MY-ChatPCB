import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('WebView panel provides named-project creation and Send-only request controls', async () => {
  const html = await readFile('apps/panel/index.html', 'utf8');
  const script = await readFile('apps/panel/panel.js', 'utf8');

  assert.match(html, /id="workspace-root"/);
  assert.match(html, /id="project-name"/);
  assert.match(html, /id="active-project"/);
  assert.match(html, /aria-label="Active project"/);
  assert.match(html, /id="request-status"/);
  assert.match(html, /aria-label="Request status"/);
  assert.match(html, /id="validation-status"/);
  assert.match(html, /id="inspection-card"/);
  assert.match(html, /id="inspection-freshness"/);
  assert.match(html, /id="inspection-digest"/);
  assert.match(html, /id="inspection-artifact-count"/);
  assert.match(html, /id="inspection-erc"/);
  assert.match(html, /id="inspection-drc"/);
  assert.match(html, /id="approve-patch-button"/);
  assert.match(html, /id="kicad-link"/);
  assert.doesNotMatch(html, /id="generate-button"/);
  assert.match(script, /project\.create/);
  assert.match(script, /project\.request/);
  assert.match(script, /renderRequestStatus/);
  assert.match(script, /renderValidation/);
  assert.match(script, /renderKiCadLink/);
  assert.match(script, /project\.inspect/);
  assert.match(script, /inspectionState/);
  assert.match(script, /renderInspection/);
  assert.match(script, /patchId/);
  assert.match(script, /expiresAt/);
  assert.match(script, /clearPatchApproval/);
  assert.match(script, /approved: true, patchId: patchApprovalState\.patchId/);
  assert.match(script, /cancel: true, patchId: patchApprovalState\.patchId/);
  assert.match(script, /chatpcbHost/);
});

test('KiCad fork skeleton declares a wxWebView-backed ChatPCB panel', async () => {
  const header = await readFile('kicad-fork/chatpcb_panel/chatpcb_panel.h', 'utf8');
  const implementation = await readFile('kicad-fork/chatpcb_panel/chatpcb_panel.cpp', 'utf8');

  assert.match(header, /class CHATPCB_PANEL/);
  assert.match(header, /wxWebView/);
  assert.match(implementation, /CHATPCB_AGENT_PORT/);
  assert.match(implementation, /LoadURL/);
});
