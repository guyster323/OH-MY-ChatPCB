import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { renderTokensCss } from '../scripts/panel-tokens/build.mjs';

test('generated panel tokens.css matches the committed file', async () => {
  const committed = await readFile(new URL('../apps/panel/styles/tokens.css', import.meta.url), 'utf8');
  assert.equal(renderTokensCss(), committed);
});
