import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { findChrome } from '../scripts/lib/find-chrome.js';

function finder(overrides = {}) {
  return findChrome({
    env: {},
    platform: 'linux',
    playwrightExecutablePath: '',
    exists: async () => false,
    ...overrides
  });
}

test('CHATPCB_CHROME_PATH wins over Playwright and system Chrome', async () => {
  const seen = [];
  const found = await finder({
    env: {
      CHATPCB_CHROME_PATH: '/opt/pinned/chrome',
      CHATPCB_BROWSER_PATH: '/opt/other/chrome'
    },
    playwrightExecutablePath: '/cache/chromium/chrome',
    exists: async (candidate) => {
      seen.push(candidate);
      return true;
    }
  });

  assert.deepEqual(seen, ['/opt/pinned/chrome']);
  assert.equal(found.path, '/opt/pinned/chrome');
  assert.equal(found.source, 'env');
});

test('CHATPCB_BROWSER_PATH is the override when CHATPCB_CHROME_PATH is unset', async () => {
  const found = await finder({
    env: { CHATPCB_BROWSER_PATH: '/opt/browser/chrome' },
    playwrightExecutablePath: '/cache/chromium/chrome',
    exists: async (candidate) => candidate === '/opt/browser/chrome' || candidate === '/cache/chromium/chrome'
  });

  assert.equal(found.path, '/opt/browser/chrome');
  assert.equal(found.source, 'env');
});

test('a missing CHATPCB_CHROME_PATH does not fall through to another browser', async () => {
  const seen = [];
  const found = await finder({
    env: { CHATPCB_CHROME_PATH: '/opt/missing/chrome' },
    playwrightExecutablePath: '/cache/chromium/chrome',
    exists: async (candidate) => {
      seen.push(candidate);
      return candidate === '/cache/chromium/chrome';
    }
  });

  assert.deepEqual(seen, ['/opt/missing/chrome']);
  assert.equal(found.path, null);
  assert.equal(found.source, 'unavailable');
  assert.match(found.reason, /CHATPCB_CHROME_PATH is set but is not an executable file: \/opt\/missing\/chrome/);
});

test('blank Chrome path overrides are ignored', async () => {
  const found = await finder({
    env: { CHATPCB_CHROME_PATH: '   ', CHATPCB_BROWSER_PATH: '' },
    playwrightExecutablePath: '/cache/chromium/chrome',
    exists: async (candidate) => candidate === '/cache/chromium/chrome'
  });

  assert.equal(found.path, '/cache/chromium/chrome');
  assert.equal(found.source, 'playwright');
});

test('trims the env override before checking it', async () => {
  const found = await finder({
    env: { CHATPCB_CHROME_PATH: '  /opt/pinned/chrome  ' },
    exists: async (candidate) => candidate === '/opt/pinned/chrome'
  });

  assert.equal(found.path, '/opt/pinned/chrome');
  assert.equal(found.source, 'env');
});

test('Playwright chromium is used when its executable exists', async () => {
  const seen = [];
  const found = await finder({
    playwrightExecutablePath: '/cache/chromium/chrome',
    exists: async (candidate) => {
      seen.push(candidate);
      return candidate === '/cache/chromium/chrome';
    }
  });

  assert.deepEqual(seen, ['/cache/chromium/chrome']);
  assert.equal(found.path, '/cache/chromium/chrome');
  assert.equal(found.source, 'playwright');
});

test('linux lookup tries google-chrome, then stable, chromium, and chromium-browser', async () => {
  const seen = [];
  const found = await finder({
    exists: async (candidate) => {
      seen.push(candidate);
      return candidate === '/usr/bin/chromium-browser';
    }
  });

  assert.deepEqual(seen, [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ]);
  assert.equal(found.path, '/usr/bin/chromium-browser');
  assert.equal(found.source, 'linux');
});

test('darwin lookup uses the Google Chrome application bundle, then Chromium', async () => {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const chromiumApp = '/Applications/Chromium.app/Contents/MacOS/Chromium';
  const seen = [];
  const found = await finder({
    platform: 'darwin',
    exists: async (candidate) => {
      seen.push(candidate);
      return candidate === chromiumApp;
    }
  });

  assert.deepEqual(seen, [chrome, chromiumApp]);
  assert.equal(found.path, chromiumApp);
  assert.equal(found.source, 'darwin');
});

test('win32 lookup checks Program Files Chrome, then the user install, before Edge', async () => {
  const local = 'C:\\Users\\dev\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
  const seen = [];
  const found = await finder({
    platform: 'win32',
    env: { LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local' },
    exists: async (candidate) => {
      seen.push(candidate);
      return candidate === local;
    }
  });

  assert.equal(found.path, local);
  assert.equal(found.source, 'win32');
  assert.deepEqual(seen, [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    local
  ]);
});

test('win32 lookup uses Edge only after Chrome locations are missing', async () => {
  const edge = 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe';
  const seen = [];
  const found = await finder({
    platform: 'win32',
    env: {},
    exists: async (candidate) => {
      seen.push(candidate);
      return candidate === edge;
    }
  });

  assert.equal(found.path, edge);
  assert.equal(seen[0], 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
  assert.equal(seen.at(-1), edge);
  assert.ok(seen.some((candidate) => candidate.endsWith('Google\\Chrome\\Application\\chrome.exe')));
});

test('win32 lookup honors PROGRAMFILES before the C: default', async () => {
  const installed = 'D:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const seen = [];
  const found = await finder({
    platform: 'win32',
    env: { PROGRAMFILES: 'D:\\Program Files' },
    exists: async (candidate) => {
      seen.push(candidate);
      return candidate === installed;
    }
  });

  assert.equal(found.path, installed);
  assert.equal(seen[0], installed);
});

test('reports a skip reason when no browser exists', async () => {
  const found = await finder({
    platform: 'linux',
    playwrightExecutablePath: '/cache/missing-chromium'
  });

  assert.equal(found.path, null);
  assert.equal(found.source, 'unavailable');
  assert.match(found.reason, /No Chrome or Chromium executable found on linux/);
  assert.match(found.reason, /CHATPCB_CHROME_PATH/);
  assert.match(found.reason, /\/cache\/missing-chromium/);
  assert.match(found.reason, /\/usr\/bin\/google-chrome/);
  assert.match(found.reason, /google-chrome-stable/);
  assert.match(found.reason, /\/usr\/bin\/chromium,/);
  assert.match(found.reason, /\/usr\/bin\/chromium-browser/);
});

test('a directory is not an executable Chrome path', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'chatpcb-chrome-'));
  try {
    const found = await findChrome({
      env: { CHATPCB_CHROME_PATH: dir },
      platform: 'linux',
      playwrightExecutablePath: ''
    });
    assert.equal(found.path, null);
    assert.match(found.reason, /CHATPCB_CHROME_PATH is set but is not an executable file:/);
    assert.match(found.reason, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test('browser launchers resolve Chrome through the shared helper', async () => {
  const verifier = await readFile(new URL('../scripts/verify-panel-ui.js', import.meta.url), 'utf8');
  const uiTest = await readFile(new URL('./panel-ui-verifier.test.js', import.meta.url), 'utf8');

  assert.match(verifier, /findChrome\(/);
  assert.match(uiTest, /findChrome\(/);
  assert.doesNotMatch(verifier, /\/usr\/bin\/google-chrome/);
  assert.doesNotMatch(uiTest, /\/usr\/bin\/google-chrome/);
  assert.doesNotMatch(verifier, /findBrowserExecutable/);
});
