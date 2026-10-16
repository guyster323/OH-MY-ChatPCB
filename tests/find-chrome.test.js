import assert from 'node:assert/strict';
import { access, chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executablePathForLaunch, findChrome } from '../scripts/lib/find-chrome.js';

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
  assert.match(found.reason, /npx playwright install chromium/);
  assert.match(found.reason, /npx playwright install chromium --only-shell/);
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

test('headless shell launch omits executablePath so Playwright can select it', () => {
  assert.equal(
    executablePathForLaunch({ path: '/cache/chrome-headless-shell', source: 'playwright-headless-shell' }),
    undefined
  );
  assert.equal(
    executablePathForLaunch({ path: '/usr/bin/google-chrome', source: 'linux' }),
    '/usr/bin/google-chrome'
  );
  assert.equal(
    executablePathForLaunch({ path: '/cache/chromium/chrome', source: 'playwright' }),
    '/cache/chromium/chrome'
  );
  assert.equal(executablePathForLaunch({ path: null, source: 'unavailable' }), undefined);
});

test('Playwright registry headless shell is used before the browsers directory is scanned', async () => {
  let listed = false;
  const found = await finder({
    playwrightHeadlessShellPath: '/opt/pw/chrome-headless-shell',
    listDir: async () => {
      listed = true;
      return ['chromium_headless_shell-1223'];
    },
    exists: async (candidate) => candidate === '/opt/pw/chrome-headless-shell'
  });

  assert.equal(listed, false);
  assert.equal(found.path, '/opt/pw/chrome-headless-shell');
  assert.equal(found.source, 'playwright-headless-shell');
  assert.equal(executablePathForLaunch(found), undefined);
});

test('system Chrome wins over a Playwright headless shell', async () => {
  let listed = false;
  const found = await finder({
    env: { PLAYWRIGHT_BROWSERS_PATH: '/cache/ms-playwright' },
    playwrightExecutablePath: '/cache/missing-chromium',
    listDir: async () => {
      listed = true;
      return ['chromium_headless_shell-1223'];
    },
    exists: async (candidate) => candidate === '/usr/bin/google-chrome'
  });

  assert.equal(listed, false);
  assert.equal(found.path, '/usr/bin/google-chrome');
  assert.equal(found.source, 'linux');
});

test('a browsers directory that contains only the headless shell is used', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-headless-shell-'));
  const shell = path.join(
    root,
    'chromium_headless_shell-1223',
    'chrome-headless-shell-linux64',
    'chrome-headless-shell'
  );
  const decoy = path.join(root, 'chromium-1223', 'chrome-linux64', 'chrome');
  try {
    await writeExecutable(shell);
    await writeExecutable(decoy);
    const seen = [];
    const found = await findChrome({
      env: { PLAYWRIGHT_BROWSERS_PATH: root },
      platform: 'linux',
      arch: 'x64',
      playwrightExecutablePath: '',
      exists: async (candidate) => {
        seen.push(candidate);
        return candidate === shell && await isExecutableFile(candidate);
      }
    });

    assert.equal(found.path, shell);
    assert.equal(found.source, 'playwright-headless-shell');
    assert.equal(executablePathForLaunch(found), undefined);
    assert.ok(seen.includes('/usr/bin/google-chrome'));
    assert.ok(seen.includes(shell));
    assert.equal(seen.includes(decoy), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the newest headless shell revision in the browsers directory wins', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-headless-shell-rev-'));
  // "999" sorts after "1223" as text and before it as a number.
  const older = headlessShell(root, '999');
  const newer = headlessShell(root, '1223');
  try {
    await writeExecutable(older);
    await writeExecutable(newer);
    const found = await findChrome({
      env: { PLAYWRIGHT_BROWSERS_PATH: root },
      platform: 'linux',
      arch: 'x64',
      playwrightExecutablePath: '',
      playwrightHeadlessShellPath: '',
      exists: async (candidate) => (candidate === older || candidate === newer) && await isExecutableFile(candidate)
    });

    assert.equal(found.path, newer);
    assert.equal(found.source, 'playwright-headless-shell');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('darwin lookup finds the mac headless shell in a browsers directory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-headless-shell-mac-'));
  const shell = path.join(
    root,
    'chromium_headless_shell-1223',
    'chrome-headless-shell-mac-arm64',
    'chrome-headless-shell'
  );
  try {
    await writeExecutable(shell);
    const found = await findChrome({
      env: { PLAYWRIGHT_BROWSERS_PATH: root },
      platform: 'darwin',
      arch: 'arm64',
      playwrightExecutablePath: '',
      playwrightHeadlessShellPath: '',
      exists: async (candidate) => candidate === shell && await isExecutableFile(candidate)
    });

    assert.equal(found.path, shell);
    assert.equal(found.source, 'playwright-headless-shell');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('win32 lookup finds chrome-headless-shell.exe in a browsers directory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-headless-shell-win-'));
  const shell = path.join(
    root,
    'chromium_headless_shell-1223',
    'chrome-headless-shell-win64',
    'chrome-headless-shell.exe'
  );
  try {
    await writeExecutable(shell);
    const found = await findChrome({
      env: { PLAYWRIGHT_BROWSERS_PATH: root },
      platform: 'win32',
      arch: 'x64',
      playwrightExecutablePath: '',
      playwrightHeadlessShellPath: '',
      exists: async (candidate) => candidate === shell && await isExecutableFile(candidate)
    });

    assert.equal(found.path, shell);
    assert.equal(found.source, 'playwright-headless-shell');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a non-executable headless shell file is not a browser', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-headless-shell-mode-'));
  const shell = headlessShell(root, '1223');
  try {
    await mkdir(path.dirname(shell), { recursive: true });
    await writeFile(shell, '');
    await chmod(shell, 0o644);
    const found = await findChrome({
      env: { PLAYWRIGHT_BROWSERS_PATH: root },
      platform: 'linux',
      arch: 'x64',
      playwrightExecutablePath: '',
      playwrightHeadlessShellPath: '',
      exists: async (candidate) => candidate.startsWith(root) && await isExecutableFile(candidate)
    });

    assert.equal(found.path, null);
    assert.equal(found.source, 'unavailable');
    assert.match(found.reason, /npx playwright install chromium/);
    assert.match(found.reason, /--only-shell/);
    assert.match(found.reason, /CHATPCB_CHROME_PATH/);
    assert.match(found.reason, /chrome-headless-shell/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the Playwright registry headless shell is used when full Chromium and system Chrome are missing', async () => {
  const { registry: playwrightRegistryApi } = await import('playwright-core/lib/coreBundle');
  const shellPath = playwrightRegistryApi.registry.findExecutable('chromium-headless-shell').executablePath();
  let listed = false;
  const seen = [];
  const found = await finder({
    playwrightExecutablePath: '',
    listDir: async () => {
      listed = true;
      return [];
    },
    exists: async (candidate) => {
      seen.push(candidate);
      return candidate === shellPath;
    }
  });

  assert.equal(found.path, shellPath);
  assert.equal(found.source, 'playwright-headless-shell');
  assert.equal(listed, false);
  assert.ok(seen.indexOf('/usr/bin/google-chrome') < seen.indexOf(shellPath));
});

test('headless shell lookup uses the default ms-playwright cache when PLAYWRIGHT_BROWSERS_PATH is unset', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'chatpcb-home-cache-'));
  const shell = path.join(
    home,
    '.cache',
    'ms-playwright',
    'chromium_headless_shell-1223',
    'chrome-headless-shell-linux64',
    'chrome-headless-shell'
  );
  try {
    await writeExecutable(shell);
    const found = await findChrome({
      env: { HOME: home, XDG_CACHE_HOME: '', PLAYWRIGHT_BROWSERS_PATH: '' },
      platform: 'linux',
      arch: 'x64',
      playwrightExecutablePath: '',
      playwrightHeadlessShellPath: '',
      exists: async (candidate) => candidate === shell && await isExecutableFile(candidate)
    });

    assert.equal(found.path, shell);
    assert.equal(found.source, 'playwright-headless-shell');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('linux arm64 lookup finds headless_shell in a browsers directory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-headless-shell-arm-'));
  const shell = path.join(root, 'chromium_headless_shell-1223', 'chrome-linux', 'headless_shell');
  try {
    await writeExecutable(shell);
    const found = await findChrome({
      env: { PLAYWRIGHT_BROWSERS_PATH: root },
      platform: 'linux',
      arch: 'arm64',
      playwrightExecutablePath: '',
      playwrightHeadlessShellPath: '',
      exists: async (candidate) => candidate === shell && await isExecutableFile(candidate)
    });

    assert.equal(found.path, shell);
    assert.equal(found.source, 'playwright-headless-shell');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('verify:ui docs tell users how to install Chromium or the headless shell', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const start = readme.indexOf('## Browser UI verification');
  const end = readme.indexOf('## Computer Use verification status');
  const section = readme.slice(start, end);

  assert.ok(start !== -1 && end > start);
  assert.match(section, /CHATPCB_CHROME_PATH/);
  assert.match(section, /npx playwright install chromium/);
  assert.match(section, /--only-shell/);
  assert.match(section, /headless shell/);
  assert.match(section, /PLAYWRIGHT_BROWSERS_PATH/);
});

test('browser launchers resolve Chrome through the shared helper', async () => {
  const verifier = await readFile(new URL('../scripts/verify-panel-ui.js', import.meta.url), 'utf8');
  const uiTest = await readFile(new URL('./panel-ui-verifier.test.js', import.meta.url), 'utf8');
  const finderSource = await readFile(new URL('../scripts/lib/find-chrome.js', import.meta.url), 'utf8');

  assert.match(verifier, /findChrome\(/);
  assert.match(uiTest, /findChrome\(/);
  assert.match(finderSource, /playwright-headless-shell/);
  assert.doesNotMatch(verifier, /\/usr\/bin\/google-chrome/);
  assert.doesNotMatch(uiTest, /\/usr\/bin\/google-chrome/);
  assert.doesNotMatch(verifier, /findBrowserExecutable/);
  assert.match(verifier, /executablePathForLaunch\(/);
  assert.match(uiTest, /executablePathForLaunch\(/);
});

function headlessShell(root, revision) {
  return path.join(
    root,
    `chromium_headless_shell-${revision}`,
    'chrome-headless-shell-linux64',
    'chrome-headless-shell'
  );
}

async function writeExecutable(file) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, '');
  await chmod(file, 0o755);
}

async function isExecutableFile(candidate) {
  try {
    await access(candidate, constants.X_OK);
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}
