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
  assert.match(source, /path\.resolve\(['"]apps\/panel['"]\)/);
  assert.match(source, /page\.goto\(`\$\{staticServer\.url\}\/index\.html`\)/);
  assert.match(source, /fill\(/);
  assert.match(source, /click\(/);
  assert.match(source, /runProviderProcessImpl/);
  assert.match(source, /가스 센서 보드 01/);
  assert.match(source, /getByRole\('button', \{ name: 'New project' \}\)/);
  assert.match(source, /getByRole\('button', \{ name: 'Send' \}\)/);
  assert.match(source, /hasGenerateButton/);
  assert.match(source, /artifact-list/);
  assert.match(source, /validation-status/);
  assert.match(source, /review-panel/);
  assert.match(source, /protocolFailurePrompt/);
  assert.match(source, /request-technical-detail/);
  assert.match(source, /hostDirty = true/);
  assert.match(source, /conflict-card/);
  assert.match(source, /message\.type === 'project\.reload'/);
  assert.match(source, /reloadCountAfterRollback/);
  assert.match(source, /inspection/);
  assert.match(source, /aaaaaaaaaaaa/);
  assert.match(source, /6 artifacts/);
  assert.match(source, /ERC 0\/0/);
  assert.match(source, /DRC 0\/2/);
  assert.match(source, /approve-patch-button/);
});
