import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('panel Korean copy has no 합니다/습니다 endings', async () => {
  const ko = JSON.parse(await readFile(new URL('../apps/panel/locales/ko.json', import.meta.url), 'utf8'));
  const isB = (ch) => {
    const code = ch.codePointAt(0) - 0xAC00;
    return code >= 0 && code < 11172 && code % 28 === 17;
  };
  const hits = [];
  for (const [key, value] of Object.entries(ko)) {
    if (typeof value !== 'string') continue;
    const re = /([가-힣])(니다|니까)|십시오/g;
    const found = [];
    for (const match of value.matchAll(re)) {
      if (match[0] === '십시오' || isB(match[1])) found.push(match[0]);
    }
    if (found.length > 0) hits.push(key);
  }
  assert.deepEqual(hits, []);
});
