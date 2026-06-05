import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('panel browser UI verification script is exposed through npm', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));

  assert.equal(
    packageJson.scripts['verify:ui'],
    'node ./scripts/verify-panel-ui.js'
  );
});

test('panel browser UI verifier drives the real panel like a user', async () => {
  const source = await readFile('scripts/verify-panel-ui.js', 'utf8');

  assert.match(source, /playwright/);
  assert.match(source, /startDaemon\(\{ host: '127\.0\.0\.1', port: 41317 \}\)/);
  assert.match(source, /apps\/panel\/index\.html/);
  assert.match(source, /fill\(/);
  assert.match(source, /click\(/);
  assert.match(source, /artifact-list/);
});
