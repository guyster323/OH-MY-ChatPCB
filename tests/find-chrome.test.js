import assert from 'node:assert/strict';
import { access, chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { constants, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { chromeLaunchOptions, executablePathForLaunch, findChrome, isUiHeadless } from '../scripts/lib/find-chrome.js';

const playwrightVersion = JSON.parse(
  readFileSync(new URL('../node_modules/playwright/package.json', import.meta.url), 'utf8')
).version;

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

test('headless shell launch passes that shell path as executablePath', () => {
  const shell = { path: '/cache/chrome-headless-shell', source: 'playwright-headless-shell' };
  assert.equal(executablePathForLaunch(shell), '/cache/chrome-headless-shell');
  assert.deepEqual(chromeLaunchOptions(shell, { headless: true }), {
    headless: true,
    executablePath: '/cache/chrome-headless-shell'
  });
  assert.equal(
    executablePathForLaunch({ path: '/usr/bin/google-chrome', source: 'linux' }),
    '/usr/bin/google-chrome'
  );
  assert.deepEqual(
    chromeLaunchOptions({ path: '/usr/bin/google-chrome', source: 'linux' }, { headless: false }),
    { headless: false, executablePath: '/usr/bin/google-chrome' }
  );
  assert.equal(
    executablePathForLaunch({ path: '/cache/chromium/chrome', source: 'playwright' }),
    '/cache/chromium/chrome'
  );
  assert.deepEqual(
    chromeLaunchOptions({ path: '/cache/chromium/chrome', source: 'playwright' }, { headless: false }),
    { headless: false, executablePath: '/cache/chromium/chrome' }
  );
  assert.equal(executablePathForLaunch({ path: null, source: 'unavailable' }), undefined);
  assert.deepEqual(chromeLaunchOptions({ path: null, source: 'unavailable' }, { headless: false }), {
    headless: false
  });
});

test('CHATPCB_UI_HEADLESS=0 is headed and every other value stays headless', () => {
  assert.equal(isUiHeadless({}), true);
  assert.equal(isUiHeadless({ CHATPCB_UI_HEADLESS: '' }), true);
  assert.equal(isUiHeadless({ CHATPCB_UI_HEADLESS: '1' }), true);
  assert.equal(isUiHeadless({ CHATPCB_UI_HEADLESS: 'false' }), true);
  assert.equal(isUiHeadless({ CHATPCB_UI_HEADLESS: '0' }), false);
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
  assert.equal(executablePathForLaunch(found), '/opt/pw/chrome-headless-shell');
  assert.equal(chromeLaunchOptions(found, { headless: true }).executablePath, found.path);
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
    const options = chromeLaunchOptions(found, { headless: isUiHeadless({}) });
    assert.equal(options.headless, true);
    assert.equal(options.executablePath, shell);
    assert.equal(executablePathForLaunch(found), shell);
    assert.ok(seen.includes('/usr/bin/google-chrome'));
    assert.ok(seen.includes(shell));
    assert.equal(seen.includes(decoy), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('headed mode fails when a browsers directory contains only the headless shell', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-headed-shell-'));
  const shell = headlessShell(root, '1223');
  try {
    await writeExecutable(shell);
    const found = await findChrome({
      env: { PLAYWRIGHT_BROWSERS_PATH: root, CHATPCB_UI_HEADLESS: '0' },
      platform: 'linux',
      arch: 'x64',
      playwrightExecutablePath: '',
      playwrightHeadlessShellPath: '',
      exists: async (candidate) => candidate === shell && await isExecutableFile(candidate)
    });

    assert.equal(found.path, shell);
    assert.equal(found.source, 'playwright-headless-shell');
    assert.equal(isUiHeadless({ CHATPCB_UI_HEADLESS: '0' }), false);
    assert.throws(
      () => chromeLaunchOptions(found, { headless: isUiHeadless({ CHATPCB_UI_HEADLESS: '0' }) }),
      { message: 'headed mode needs full Chromium or Chrome: run npx playwright install chromium or set CHATPCB_CHROME_PATH' }
    );
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

test('a non-executable headless shell file is not a browser', {
  skip: process.platform === 'win32'
    ? 'Windows has no executable bit; win32 requires the .exe name instead'
    : false
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-headless-shell-mode-'));
  const shell = headlessShell(root, '1223');
  try {
    await mkdir(path.dirname(shell), { recursive: true });
    await writeFile(shell, '');
    await chmod(shell, 0o644);
    assert.equal(await isExecutableFile(shell), false);
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

test('win32 requires the .exe name instead of an executable bit', async () => {
  const extensionless = path.win32.join('C:\\ms-playwright', 'chrome-headless-shell-win64', 'chrome-headless-shell');
  const executable = path.win32.join('C:\\ms-playwright', 'chrome-headless-shell-win64', 'chrome-headless-shell.EXE');
  const rejected = await findChrome({
    env: { PLAYWRIGHT_BROWSERS_PATH: 'C:\\ms-playwright-empty' },
    platform: 'win32',
    arch: 'x64',
    playwrightExecutablePath: '',
    playwrightHeadlessShellPath: extensionless,
    listDir: async () => [],
    exists: async (candidate) => candidate === extensionless
  });

  assert.equal(rejected.path, null);
  assert.equal(rejected.source, 'unavailable');
  assert.match(rejected.reason, /chrome-headless-shell/);
  assert.match(rejected.reason, /npx playwright install chromium/);
  assert.match(rejected.reason, /--only-shell/);
  assert.match(rejected.reason, /CHATPCB_CHROME_PATH/);

  const accepted = await findChrome({
    env: { PLAYWRIGHT_BROWSERS_PATH: path.join(tmpdir(), 'chatpcb-no-such-browsers') },
    platform: 'win32',
    arch: 'arm64',
    playwrightExecutablePath: '',
    playwrightHeadlessShellPath: executable,
    listDir: async () => {
      throw new Error('registry path should win before the cache is scanned');
    },
    exists: async (candidate) => candidate === executable
  });
  assert.equal(accepted.path, executable);
  assert.equal(accepted.source, 'playwright-headless-shell');

  const override = await findChrome({
    env: { CHATPCB_CHROME_PATH: 'D:\\Tools\\chrome' },
    platform: 'win32',
    arch: 'x64',
    playwrightExecutablePath: '',
    exists: async () => true
  });
  assert.equal(override.path, null);
  assert.match(override.reason, /CHATPCB_CHROME_PATH is set but is not an executable file: D:\\Tools\\chrome/);

  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-headless-shell-win-mode-'));
  const shell = path.join(
    root,
    'chromium_headless_shell-1223',
    'chrome-headless-shell-win64',
    'chrome-headless-shell.exe'
  );
  try {
    await mkdir(path.dirname(shell), { recursive: true });
    await writeFile(shell, '');
    await chmod(shell, 0o644);
    const found = await findChrome({
      env: { PLAYWRIGHT_BROWSERS_PATH: root },
      platform: 'win32',
      arch: 'x64',
      playwrightExecutablePath: '',
      playwrightHeadlessShellPath: '',
      exists: async (candidate) => {
        if (candidate !== shell) return false;
        try {
          return (await stat(candidate)).isFile();
        } catch {
          return false;
        }
      }
    });

    assert.equal(found.path, shell);
    assert.equal(found.source, 'playwright-headless-shell');
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
  assert.equal(chromeLaunchOptions(found, { headless: true }).executablePath, shellPath);
  assert.equal(listed, false);
  assert.ok(seen.indexOf('/usr/bin/google-chrome') < seen.indexOf(shellPath));
});

test(`Playwright ${playwrightVersion} headless shell registry contract`, async (t) => {
  const executableName = expectedHeadlessShellExecutable(process.platform, process.arch);
  const registryPath = await probePlaywrightHeadlessShellRegistry();
  t.diagnostic(`playwright ${playwrightVersion} (${process.platform}-${process.arch})`);

  if (registryPath) {
    let listed = false;
    const found = await findChrome({
      env: {},
      platform: process.platform,
      arch: process.arch,
      playwrightExecutablePath: '',
      listDir: async () => {
        listed = true;
        return [];
      },
      exists: async (candidate) => candidate === registryPath
    });

    const layout = `playwright ${playwrightVersion}: ${found.path}`;
    assert.equal(found.source, 'playwright-headless-shell');
    assert.equal(found.path, registryPath);
    assert.equal(listed, false);
    assert.ok(found.path.includes('chromium_headless_shell-'), `${layout} should contain chromium_headless_shell-`);
    assert.ok(found.path.endsWith(executableName), `${layout} should end with ${executableName}`);
    t.diagnostic(`playwright ${playwrightVersion} registry path ${found.path}`);
    return;
  }

  t.diagnostic(`playwright ${playwrightVersion}: private registry API is missing; checking the cache fallback`);
  const env = { ...process.env };
  delete env.CHATPCB_CHROME_PATH;
  delete env.CHATPCB_BROWSER_PATH;
  const found = await findChrome({
    env,
    platform: process.platform,
    arch: process.arch,
    playwrightExecutablePath: '',
    exists: async (candidate) => (
      typeof candidate === 'string'
      && candidate.includes('chromium_headless_shell-')
      && candidate.endsWith(executableName)
      && await isExecutableFile(candidate)
    )
  });
  if (!found.path) {
    t.skip(`Playwright ${playwrightVersion}: private registry API is missing and no headless shell is installed`);
    return;
  }
  assert.equal(found.source, 'playwright-headless-shell');
  assert.ok(found.path.includes('chromium_headless_shell-'), found.path);
  assert.ok(found.path.endsWith(executableName), `${found.path} should end with ${executableName}`);
  t.diagnostic(`playwright ${playwrightVersion} fallback path ${found.path}`);
});

test('headless shell lookup uses the default ms-playwright cache when PLAYWRIGHT_BROWSERS_PATH is unset', async () => {
  await assertDefaultCache(linuxDefaultCache);
});

test('a missing Playwright registry falls back to chromium_headless_shell-* under PLAYWRIGHT_BROWSERS_PATH', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-registry-fallback-'));
  const shell = headlessShell(root, '1223');
  try {
    await writeExecutable(shell);
    const found = await findChrome({
      env: { PLAYWRIGHT_BROWSERS_PATH: root },
      platform: 'linux',
      arch: 'x64',
      playwrightExecutablePath: '',
      readPlaywrightHeadlessShellRegistry: () => null,
      exists: async (candidate) => candidate === shell && await isExecutableFile(candidate)
    });

    assert.equal(found.path, shell);
    assert.equal(found.source, 'playwright-headless-shell');
    assert.equal(executablePathForLaunch(found), shell);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a throwing Playwright registry falls back to the default ms-playwright cache', async () => {
  await assertDefaultCache(linuxDefaultCache, { throwingRegistry: true });
});

test('registry and cache misses leave no headless shell', async () => {
  const missing = path.join(tmpdir(), `chatpcb-missing-browsers-${process.pid}`);
  const found = await findChrome({
    env: { PLAYWRIGHT_BROWSERS_PATH: missing },
    platform: 'linux',
    arch: 'x64',
    playwrightExecutablePath: '',
    readPlaywrightHeadlessShellRegistry: () => {
      throw new Error('playwright registry internals missing');
    },
    exists: async () => false
  });

  assert.equal(found.path, null);
  assert.equal(found.source, 'unavailable');
  assert.match(found.reason, /npx playwright install chromium/);
  assert.match(found.reason, /--only-shell/);
  assert.match(found.reason, /CHATPCB_CHROME_PATH/);
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
  assert.match(section, /CHATPCB_UI_HEADLESS=0/);
  assert.match(section, /executablePath/);
  assert.match(section, /Headed mode/);
  assert.doesNotMatch(section, /no `executablePath`/);
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
  assert.match(verifier, /chromeLaunchOptions\(/);
  assert.match(uiTest, /chromeLaunchOptions\(/);
  assert.match(finderSource, /chromeLaunchOptions\(/);
  assert.match(finderSource, /const executablePath = executablePathForLaunch\(found\)/);
  assert.match(verifier, /isUiHeadless\(\)/);
  assert.match(finderSource, /CHATPCB_UI_HEADLESS !== '0'/);
  assert.match(finderSource, /headed mode needs full Chromium or Chrome: run npx playwright install chromium or set CHATPCB_CHROME_PATH/);
});

function expectedHeadlessShellExecutable(platform, arch) {
  if (platform === 'win32') return 'chrome-headless-shell.exe';
  if (platform === 'linux' && arch === 'arm64') return 'headless_shell';
  return 'chrome-headless-shell';
}

async function probePlaywrightHeadlessShellRegistry() {
  try {
    const { registry: registryModule } = await import('playwright-core/lib/coreBundle');
    const registry = registryModule.registry;
    if (!registry || typeof registry.findExecutable !== 'function') return null;
    const executable = registry.findExecutable('chromium-headless-shell');
    if (!executable || typeof executable.executablePath !== 'function') return null;
    const shellPath = executable.executablePath();
    return typeof shellPath === 'string' && shellPath ? shellPath : null;
  } catch {
    return null;
  }
}

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

const linuxDefaultCache = {
  platform: 'linux',
  arch: 'x64',
  env(home) {
    return {
      HOME: home,
      USERPROFILE: path.join(home, 'Profile'),
      LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
      XDG_CACHE_HOME: '',
      PLAYWRIGHT_BROWSERS_PATH: ''
    };
  },
  shell(home) {
    return path.join(
      home,
      '.cache',
      'ms-playwright',
      'chromium_headless_shell-1223',
      'chrome-headless-shell-linux64',
      'chrome-headless-shell'
    );
  }
};

function cacheLayout({ label, platform, arch, env, segments }) {
  return {
    label,
    platform,
    arch,
    env,
    shell(home) {
      return path.join(home, ...segments);
    }
  };
}

const otherOsDefaultCaches = [
  cacheLayout({
    label: 'darwin arm64',
    platform: 'darwin',
    arch: 'arm64',
    env(home) {
      return {
        HOME: home,
        USERPROFILE: path.join(home, 'Profile'),
        LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
        XDG_CACHE_HOME: path.join(home, '.cache'),
        PLAYWRIGHT_BROWSERS_PATH: ''
      };
    },
    segments: [
      'Library',
      'Caches',
      'ms-playwright',
      'chromium_headless_shell-1223',
      'chrome-headless-shell-mac-arm64',
      'chrome-headless-shell'
    ]
  }),
  cacheLayout({
    label: 'darwin x64',
    platform: 'darwin',
    arch: 'x64',
    env(home) {
      return {
        HOME: home,
        USERPROFILE: path.join(home, 'Profile'),
        LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
        XDG_CACHE_HOME: path.join(home, '.cache'),
        PLAYWRIGHT_BROWSERS_PATH: ''
      };
    },
    segments: [
      'Library',
      'Caches',
      'ms-playwright',
      'chromium_headless_shell-1223',
      'chrome-headless-shell-mac-x64',
      'chrome-headless-shell'
    ]
  }),
  cacheLayout({
    label: 'win32 x64',
    platform: 'win32',
    arch: 'x64',
    env(home) {
      return {
        HOME: path.join(home, 'Home'),
        USERPROFILE: path.join(home, 'Profile'),
        LOCALAPPDATA: path.join(home, 'LocalAppData'),
        XDG_CACHE_HOME: path.join(home, '.cache'),
        PLAYWRIGHT_BROWSERS_PATH: ''
      };
    },
    segments: [
      'LocalAppData',
      'ms-playwright',
      'chromium_headless_shell-1223',
      'chrome-headless-shell-win64',
      'chrome-headless-shell.exe'
    ]
  }),
  cacheLayout({
    label: 'win32 arm64',
    platform: 'win32',
    arch: 'arm64',
    env(home) {
      return {
        USERPROFILE: home,
        XDG_CACHE_HOME: path.join(home, '.cache'),
        PLAYWRIGHT_BROWSERS_PATH: ''
      };
    },
    segments: [
      'AppData',
      'Local',
      'ms-playwright',
      'chromium_headless_shell-1223',
      'chrome-headless-shell-win64',
      'chrome-headless-shell.exe'
    ]
  })
];

for (const layout of otherOsDefaultCaches) {
  test(`headless shell lookup uses the default ms-playwright cache on ${layout.label} when PLAYWRIGHT_BROWSERS_PATH is unset`, async () => {
    await assertDefaultCache(layout);
  });

  test(`a throwing Playwright registry falls back to the default ms-playwright cache on ${layout.label}`, async () => {
    await assertDefaultCache(layout, { throwingRegistry: true });
  });
}

async function assertDefaultCache(layout, { throwingRegistry = false } = {}) {
  const home = await mkdtemp(path.join(tmpdir(), `chatpcb-default-cache-${layout.platform}-`));
  const shell = layout.shell(home);
  try {
    await writeExecutable(shell);
    const found = await findChrome({
      env: layout.env(home),
      platform: layout.platform,
      arch: layout.arch,
      playwrightExecutablePath: '',
      ...(throwingRegistry
        ? {
          readPlaywrightHeadlessShellRegistry() {
            throw new Error('playwright registry internals missing');
          }
        }
        : { playwrightHeadlessShellPath: '' }),
      exists: async (candidate) => candidate === shell && await isExecutableFile(candidate)
    });

    assert.equal(found.path, shell);
    assert.equal(found.source, 'playwright-headless-shell');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}
