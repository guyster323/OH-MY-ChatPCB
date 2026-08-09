import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

test('panel user-flow verification script is exposed through npm', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));

  assert.equal(packageJson.scripts['verify:panel'], 'node ./scripts/verify-panel-flow.js');
});

test('panel user-flow verifier completes the daemon websocket project request', async () => {
  const { stdout } = await execFileAsync(process.execPath, ['./scripts/verify-panel-flow.js'], {
    timeout: 60_000
  });
  const result = JSON.parse(stdout);

  assert.equal(result.ok, true);
  assert.equal(result.service, 'chatpcb-agentd');
  assert.equal(result.verified, 'named project.create and project.request websocket flow');
  assert.equal(result.displayName, '가스 센서 보드 01');
  assert.equal(result.operation, 'generated');
  assert.match(result.project, /\.kicad_pro$/);
  assert.equal(typeof result.erc.errorCount, 'number');
  assert.equal(typeof result.reviewStatus, 'string');
  assert.equal('dirtyHost' in result, false);
});
