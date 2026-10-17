import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

function sliceFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const end = source.indexOf('\nfunction ', start + 1);
  assert.ok(end > start, name);
  return source.slice(start, end);
}

test('patch apply fails closed and focus does not rewrite the Apply button', async () => {
  const panel = await readFile(new URL('../apps/panel/panel.js', import.meta.url), 'utf8');
  assert.equal(panel.includes('applied !== false'), false);
  assert.equal(panel.includes('applied === undefined ? true'), false);
  assert.match(panel, /function normalizeDaemonReply\(/);
  const focus = sliceFunction(panel, 'focusApplyButton');
  assert.equal(focus.includes('aria-disabled'), false);
  assert.equal(focus.includes('.disabled'), false);
  assert.match(sliceFunction(panel, 'approvePatchWithoutErc'), /patchApplyBusy\(\)/);
  assert.match(sliceFunction(panel, 'applyGateOpen'), /ercBlockState\(\)\.passed !== true/);
});
