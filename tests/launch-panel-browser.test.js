import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { launchPanelBrowser } from '../scripts/lib/launch-panel-browser.js';

test('launchPanelBrowser launches the executable findChrome returns', async () => {
  const launches = [];
  const browser = { launched: true };
  const opened = await launchPanelBrowser({ skip() {} }, {
    env: {},
    findChrome: async () => ({ path: path.join(tmpdir(), 'chatpcb-fake-chrome'), source: 'env' }),
    launch: async (options) => {
      launches.push(options);
      return browser;
    }
  });

  assert.equal(opened, browser);
  assert.equal(launches.length, 1);
  assert.equal(launches[0].executablePath, path.join(tmpdir(), 'chatpcb-fake-chrome'));
  assert.notEqual(launches[0].executablePath, '/usr/bin/google-chrome');
  assert.equal(launches[0].headless, true);
});

test('launchPanelBrowser fails in CI and skips locally when findChrome finds nothing', async () => {
  const skips = [];
  const launches = [];
  const missing = async () => ({ path: null, source: 'unavailable', reason: 'stubbed: no Chrome' });
  const t = {
    skip(message) {
      skips.push(message);
    }
  };
  const launch = async (options) => {
    launches.push(options);
    return { launched: true };
  };

  await assert.rejects(
    () => launchPanelBrowser(t, { env: { CI: 'true' }, findChrome: missing, launch }),
    /stubbed: no Chrome/
  );
  assert.deepEqual(skips, []);
  assert.deepEqual(launches, []);

  const opened = await launchPanelBrowser(t, { env: {}, findChrome: missing, launch });
  assert.equal(opened, null);
  assert.equal(skips.length, 1);
  assert.match(skips[0], /Chromium unavailable: stubbed: no Chrome/);
  assert.deepEqual(launches, []);
});
