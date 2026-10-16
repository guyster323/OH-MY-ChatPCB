import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { renderTokensCss } from '../scripts/panel-tokens/build.mjs';

// Git for Windows may still hand the working tree CRLF. Compare the text, not the bytes.
function normalizeEol(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

test('generated panel tokens.css matches the committed file', async () => {
  const committed = await readFile(new URL('../apps/panel/styles/tokens.css', import.meta.url), 'utf8');
  assert.equal(normalizeEol(renderTokensCss()), normalizeEol(committed));
});
