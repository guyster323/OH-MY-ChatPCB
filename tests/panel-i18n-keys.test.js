import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const panelRoot = path.resolve('apps/panel');

test('panel i18n keys are defined in both locales and every locale key is used', async () => {
  const en = JSON.parse(await readFile(path.join(panelRoot, 'locales/en.json'), 'utf8'));
  const ko = JSON.parse(await readFile(path.join(panelRoot, 'locales/ko.json'), 'utf8'));
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ko).sort());

  const jsFiles = (await readdir(panelRoot)).filter((name) => name.endsWith('.js'));
  let source = await readFile(path.join(panelRoot, 'index.html'), 'utf8');
  for (const name of jsFiles) source += `\n${await readFile(path.join(panelRoot, name), 'utf8')}`;

  const staticKeys = new Set();
  const prefixes = [];
  const add = (key) => {
    if (key) staticKeys.add(key);
  };

  for (const match of source.matchAll(/\bt\(\s*'([^']+)'/g)) add(match[1]);
  for (const match of source.matchAll(/\bt\(\s*"([^"]+)"/g)) add(match[1]);
  for (const match of source.matchAll(/\bt\(\s*`([^`$]+)`/g)) add(match[1]);
  for (const match of source.matchAll(/\bt\(\s*`([^`$]*?)\$\{/g)) {
    if (match[1]) prefixes.push(match[1]);
  }
  for (const attr of ['data-i18n', 'data-i18n-placeholder', 'data-i18n-aria-label', 'data-i18n-title', 'data-i18n-help']) {
    for (const match of source.matchAll(new RegExp(`${attr}="([^"]+)"`, 'g'))) add(match[1]);
  }
  for (const match of source.matchAll(/dataset\.i18n\s*=\s*'([^']+)'/g)) add(match[1]);

  // Apostrophes in prose break a global quote scan, so match each key as its own quoted token.
  for (const key of Object.keys(en)) {
    if (source.includes(`'${key}'`) || source.includes(`"${key}"`) || source.includes(`\`${key}\``)) add(key);
  }

  const missing = [...staticKeys].filter((key) => !Object.hasOwn(en, key) || !Object.hasOwn(ko, key)).sort();
  assert.deepEqual(missing, [], `missing locale keys: ${missing.join(', ')}`);

  const unused = Object.keys(en).filter((key) => {
    if (staticKeys.has(key)) return false;
    return !prefixes.some((prefix) => key.startsWith(prefix));
  }).sort();
  assert.deepEqual(unused, [], `unused locale keys: ${unused.join(', ')}`);
});
