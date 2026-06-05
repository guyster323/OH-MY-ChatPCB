import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('panel user-flow verification script is exposed through npm', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));

  assert.equal(packageJson.scripts['verify:panel'], 'node ./scripts/verify-panel-flow.js');
});

test('panel user-flow verifier source checks the real panel defaults over websocket', async () => {
  const source = await readFile('scripts/verify-panel-flow.js', 'utf8');

  assert.match(source, /apps\/panel\/index\.html/);
  assert.match(source, /new WebSocket/);
  assert.match(source, /schematic\.generate/);
  assert.match(source, /chatpcb-agentd/);
});
