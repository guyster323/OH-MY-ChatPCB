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
  assert.match(source, /startDaemon\(\{/);
  assert.match(source, /dispatchOptions/);
  assert.match(source, /apps\/panel\/index\.html/);
  assert.match(source, /fill\(/);
  assert.match(source, /click\(/);
  assert.match(source, /runProviderProcessImpl/);
  assert.match(source, /providerPrompt/);
  assert.match(source, /slowProviderPrompt/);
  assert.match(source, /#composer button\[type="submit"\]/);
  assert.match(source, /cancel-provider-button/);
  assert.match(source, /Provider request cancelled/);
  assert.match(source, /Drafting from fake provider/);
  assert.match(source, /preview-patch-button/);
  assert.match(source, /approve-patch-button/);
  assert.match(source, /cancel-patch-button/);
  assert.match(source, /patch-diff/);
  assert.match(source, /artifact-list/);
  assert.match(source, /\.kicad_sym/);
  assert.match(source, /sym-lib-table/);
});
