import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('panel user-flow verification script is exposed through npm', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));

  assert.equal(packageJson.scripts['verify:panel'], 'node ./scripts/verify-panel-flow.js');
});

test('panel user-flow verifier checks named project requests and dirty host gating over websocket', async () => {
  const source = await readFile('scripts/verify-panel-flow.js', 'utf8');

  assert.match(source, /new WebSocket/);
  assert.match(source, /가스 센서 보드 01/);
  assert.match(source, /project\.create/);
  assert.match(source, /project\.request/);
  assert.match(source, /schematic\.generate/);
  assert.match(source, /\.kicad_pro/);
  assert.match(source, /validation\.erc/);
  assert.match(source, /result\.review/);
  assert.match(source, /linkState: 'conflict'/);
  assert.match(source, /message\.type === 'project\.reload'/);
  assert.match(source, /chatpcb-agentd/);
});
