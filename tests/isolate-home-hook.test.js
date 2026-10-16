import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { resolveChatGPTConfigDir } from '../src/runtime/auth/chatgpt-auth.js';
import { isolateProcessHome, resolveRealKicadConfigDir } from './setup/isolate-home.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const hookUrl = pathToFileURL(path.join(repoRoot, 'tests/setup/isolate-home.mjs')).href;
const configDirUrl = pathToFileURL(path.join(repoRoot, 'src/runtime/auth/chatgpt-auth.js')).href;

function pathInside(child, parent) {
  const fromParent = path.relative(path.resolve(parent), path.resolve(child));
  return fromParent !== ''
    && fromParent !== '..'
    && !fromParent.startsWith(`..${path.sep}`)
    && !path.isAbsolute(fromParent);
}

// The first statement must be the home-hook import. Normalize a leading BOM
// and CR/LF so git autocrlf does not hide that import, then require the
// specifier itself to be exactly ./setup/isolate-home.mjs. One or more
// backslashes are accepted as the path separator and folded to '/'.
const HOME_HOOK_IMPORT = /^[ \t]*import\s+(['"])([^'"]+)\1\s*;(?:\n|$)/;

export function sourceImportsHomeHook(source) {
  const text = String(source).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const match = HOME_HOOK_IMPORT.exec(text);
  if (!match) return false;
  return match[2].replace(/\\+/g, '/') === './setup/isolate-home.mjs';
}

test('isolate-home hook sets a private home before the entry module and removes it on exit', () => {
  const parentHome = Object.hasOwn(process.env, 'HOME') ? process.env.HOME : null;
  const parentKicadConfig = Object.hasOwn(process.env, 'KICAD_CONFIG_HOME') ? process.env.KICAD_CONFIG_HOME : null;
  const parentUserProfile = Object.hasOwn(process.env, 'USERPROFILE') ? process.env.USERPROFILE : null;
  const parentHomeExisted = typeof parentHome === 'string' && existsSync(parentHome);
  const script = `
    import { existsSync } from 'node:fs';
    import { tmpdir, userInfo } from 'node:os';
    import path from 'node:path';
    const homeAtStart = Object.hasOwn(process.env, 'HOME') ? process.env.HOME : null;
    const userProfileAtStart = Object.hasOwn(process.env, 'USERPROFILE') ? process.env.USERPROFILE : null;
    const appDataAtStart = Object.hasOwn(process.env, 'APPDATA') ? process.env.APPDATA : null;
    const { isolateProcessHome } = await import(${JSON.stringify(hookUrl)});
    const { resolveChatGPTConfigDir } = await import(${JSON.stringify(configDirUrl)});
    const root = isolateProcessHome();
    console.log(JSON.stringify({
      root,
      homeAtStart,
      homeAfter: Object.hasOwn(process.env, 'HOME') ? process.env.HOME : null,
      userProfileAtStart,
      userProfileAfter: Object.hasOwn(process.env, 'USERPROFILE') ? process.env.USERPROFILE : null,
      appDataAtStart,
      appDataAfter: Object.hasOwn(process.env, 'APPDATA') ? process.env.APPDATA : null,
      localAppData: Object.hasOwn(process.env, 'LOCALAPPDATA') ? process.env.LOCALAPPDATA : null,
      xdg: Object.hasOwn(process.env, 'XDG_CONFIG_HOME') ? process.env.XDG_CONFIG_HOME : null,
      kicadConfig: Object.hasOwn(process.env, 'KICAD_CONFIG_HOME') ? process.env.KICAD_CONFIG_HOME : null,
      configDir: resolveChatGPTConfigDir(),
      exists: existsSync(root),
      realHome: userInfo().homedir,
      underTmp: typeof root === 'string' && (root === tmpdir() || root.startsWith(tmpdir() + path.sep))
    }));
  `;
  const child = spawnSync(process.execPath, [
    '--import', './tests/setup/isolate-home.mjs',
    '--input-type=module',
    '--eval', script
  ], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const info = JSON.parse(child.stdout.trim().split('\n').at(-1));
  assert.equal(info.exists, true);
  assert.equal(info.underTmp, true);
  assert.notEqual(path.resolve(info.root), path.resolve(info.realHome));
  assert.notEqual(path.resolve(info.root), path.resolve(userInfo().homedir));
  // --import already redirected APPDATA, and the second import must not move it.
  assert.equal(info.appDataAtStart, path.join(info.root, 'AppData', 'Roaming'));
  assert.equal(info.appDataAfter, info.appDataAtStart);
  assert.equal(info.homeAfter, info.homeAtStart);
  assert.equal(info.userProfileAfter, info.userProfileAtStart);
  assert.equal(pathInside(info.configDir, info.root), true);
  if (process.platform === 'win32') {
    assert.equal(info.homeAtStart, parentHome);
    assert.equal(info.userProfileAtStart, parentUserProfile);
    const inheritedLocal = Object.hasOwn(process.env, 'LOCALAPPDATA') ? process.env.LOCALAPPDATA : null;
    assert.equal(info.localAppData, inheritedLocal);
    assert.equal(info.configDir, path.join(info.appDataAfter, 'chatpcb'));
  } else {
    assert.equal(info.homeAtStart, info.root);
    assert.equal(info.userProfileAtStart, info.root);
    assert.equal(info.localAppData, path.join(info.root, 'AppData', 'Local'));
    if (process.platform === 'darwin') {
      assert.equal(info.configDir, path.join(info.root, 'Library', 'Application Support', 'chatpcb'));
    } else {
      assert.equal(info.configDir, path.join(info.root, '.config', 'chatpcb'));
    }
  }
  if (process.platform === 'darwin' || process.platform === 'win32') {
    const inherited = Object.hasOwn(process.env, 'XDG_CONFIG_HOME') ? process.env.XDG_CONFIG_HOME : null;
    assert.equal(info.xdg, inherited);
  } else {
    assert.equal(info.xdg, path.join(info.root, '.config'));
  }
  // The child inherits the parent's pin. A second hook must not point KiCad at
  // the temporary home, and must not replace a value already set.
  assert.equal(info.kicadConfig, parentKicadConfig);
  if (parentKicadConfig) assert.equal(pathInside(info.kicadConfig, info.root), false);
  assert.equal(existsSync(info.root), false);
  if (parentHomeExisted) assert.equal(existsSync(parentHome), true);
});

test('auth, provider-registry, and panel tests import the home hook on their own', async () => {
  for (const name of ['auth-chatgpt.test.js', 'provider-registry.test.js', 'chatgpt-panel-ui.test.js']) {
    const source = await readFile(new URL(`./${name}`, import.meta.url), 'utf8');
    assert.equal(sourceImportsHomeHook(source), true, name);
  }
});

test('sourceImportsHomeHook accepts a CRLF home-hook import read from a file', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'chatpcb-hook-import-'));
  try {
    const positive = path.join(dir, 'auth-chatgpt.test.js');
    const negative = path.join(dir, 'other.test.js');
    await writeFile(positive, "import './setup/isolate-home.mjs';\r\nimport assert from 'node:assert/strict';\r\n");
    await writeFile(negative, "import './setup/isolate-home.mjs.js';\r\n");
    const positiveRaw = await readFile(positive);
    const negativeRaw = await readFile(negative);
    assert.equal(positiveRaw.includes(Buffer.from('\r\n')), true);
    assert.equal(negativeRaw.includes(Buffer.from('\r\n')), true);
    assert.equal(sourceImportsHomeHook(positiveRaw.toString('utf8')), true);
    assert.equal(sourceImportsHomeHook(negativeRaw.toString('utf8')), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sourceImportsHomeHook matches only the exact home-hook specifier', () => {
  assert.equal(sourceImportsHomeHook("import './setup/isolate-home.mjs';\n"), true);
  assert.equal(sourceImportsHomeHook("import \"./setup/isolate-home.mjs\";"), true);
  assert.equal(sourceImportsHomeHook("\uFEFFimport './setup/isolate-home.mjs';\r\n"), true);
  assert.equal(sourceImportsHomeHook("import './setup/isolate-home.mjs';\r"), true);
  assert.equal(sourceImportsHomeHook("import './setup\\\\isolate-home.mjs';\n"), true);
  assert.equal(sourceImportsHomeHook("import './setup\\isolate-home.mjs';\n"), true);
  assert.equal(sourceImportsHomeHook("import 'file:///D:/repo/tests/setup/isolate-home.mjs';\n"), false);
  assert.equal(sourceImportsHomeHook("import './tests/setup/isolate-home.mjs';\n"), false);
  assert.equal(sourceImportsHomeHook("import './setup/isolate-home.mjs.js';\n"), false);
  assert.equal(sourceImportsHomeHook("import './setup//isolate-home.mjs';\n"), false);
  assert.equal(sourceImportsHomeHook("\nimport './setup/isolate-home.mjs';\n"), false);
  assert.equal(
    sourceImportsHomeHook("import assert from 'node:assert/strict';\r\nimport './setup/isolate-home.mjs';\r\n"),
    false
  );
});

test('isolateProcessHome leaves HOME, USERPROFILE, and LOCALAPPDATA inherited on win32', () => {
  const homeBefore = process.env.HOME;
  const userProfileBefore = process.env.USERPROFILE;
  const localBefore = process.env.LOCALAPPDATA;
  const temporaryDirectory = path.join(tmpdir(), 'chatpcb-win32-inject');
  const inheritedHome = 'C:\\Users\\dev';
  const inheritedLocal = 'C:\\Users\\dev\\AppData\\Local';
  const env = {
    HOME: inheritedHome,
    USERPROFILE: inheritedHome,
    LOCALAPPDATA: inheritedLocal,
    XDG_CONFIG_HOME: 'C:\\keep-xdg'
  };
  let prefix = '';
  const root = isolateProcessHome({
    platform: 'win32',
    env,
    temporaryDirectory,
    mkdtemp(value) {
      prefix = value;
      return `${value}fixed`;
    }
  });
  const bare = {};
  const bareRoot = isolateProcessHome({
    platform: 'win32',
    env: bare,
    temporaryDirectory,
    mkdtemp: (value) => `${value}bare`
  });
  assert.equal(prefix, path.join(temporaryDirectory, 'chatpcb-home-'));
  assert.equal(root, `${prefix}fixed`);
  assert.equal(env.HOME, inheritedHome);
  assert.equal(env.USERPROFILE, inheritedHome);
  assert.equal(env.APPDATA, path.join(root, 'AppData', 'Roaming'));
  assert.equal(env.LOCALAPPDATA, inheritedLocal);
  assert.equal(env.XDG_CONFIG_HOME, 'C:\\keep-xdg');
  assert.equal(
    resolveChatGPTConfigDir({ platform: 'win32', env }),
    path.join(root, 'AppData', 'Roaming', 'chatpcb')
  );
  assert.equal(pathInside(resolveChatGPTConfigDir({ platform: 'win32', env }), root), true);
  assert.equal(Object.hasOwn(bare, 'HOME'), false);
  assert.equal(Object.hasOwn(bare, 'USERPROFILE'), false);
  assert.equal(Object.hasOwn(bare, 'LOCALAPPDATA'), false);
  assert.equal(bare.APPDATA, path.join(bareRoot, 'AppData', 'Roaming'));
  assert.equal(Object.hasOwn(bare, 'XDG_CONFIG_HOME'), false);
  assert.equal(
    resolveChatGPTConfigDir({ platform: 'win32', env: bare }),
    path.join(bareRoot, 'AppData', 'Roaming', 'chatpcb')
  );
  assert.equal(pathInside(resolveChatGPTConfigDir({ platform: 'win32', env: bare }), bareRoot), true);
  assert.equal(process.env.HOME, homeBefore);
  assert.equal(process.env.USERPROFILE, userProfileBefore);
  assert.equal(process.env.LOCALAPPDATA, localBefore);
});

test('isolateProcessHome redirects LOCALAPPDATA off win32', () => {
  const homeBefore = process.env.HOME;
  const localBefore = process.env.LOCALAPPDATA;
  for (const platform of ['linux', 'darwin']) {
    const env = { LOCALAPPDATA: 'inherit-me', XDG_CONFIG_HOME: 'inherit-xdg' };
    const root = isolateProcessHome({
      platform,
      env,
      temporaryDirectory: tmpdir(),
      mkdtemp: (value) => `${value}${platform}`
    });
    assert.equal(env.HOME, root, platform);
    assert.equal(env.USERPROFILE, root, platform);
    assert.equal(env.APPDATA, path.join(root, 'AppData', 'Roaming'), platform);
    assert.equal(env.LOCALAPPDATA, path.join(root, 'AppData', 'Local'), platform);
    const configDir = resolveChatGPTConfigDir({ platform, env, home: root });
    assert.equal(pathInside(configDir, root), true, platform);
    if (platform === 'darwin') {
      assert.equal(env.XDG_CONFIG_HOME, 'inherit-xdg', platform);
      assert.equal(configDir, path.join(root, 'Library', 'Application Support', 'chatpcb'), platform);
    } else {
      assert.equal(env.XDG_CONFIG_HOME, path.join(root, '.config'), platform);
      assert.equal(configDir, path.join(root, '.config', 'chatpcb'), platform);
    }
  }
  assert.equal(process.env.HOME, homeBefore);
  assert.equal(process.env.LOCALAPPDATA, localBefore);
});

function kicadPaths(home, { xdg, appData } = {}) {
  return {
    flatpak: path.join(home, '.var', 'app', 'org.kicad.KiCad', 'config', 'kicad'),
    xdg: xdg ? path.join(xdg, 'kicad') : null,
    homeConfig: path.join(home, '.config', 'kicad'),
    mac: path.join(home, 'Library', 'Preferences', 'kicad'),
    win: appData ? path.join(appData, 'kicad') : null
  };
}

function isolateInjected(platform, env, present, suffix) {
  const found = new Set(present.filter(Boolean));
  return isolateProcessHome({
    platform,
    env,
    exists: (dir) => found.has(dir),
    temporaryDirectory: tmpdir(),
    mkdtemp: (value) => `${value}${suffix}`
  });
}

test('resolveRealKicadConfigDir uses the platform default only when that directory exists', () => {
  const home = '/home/dev';
  const xdg = '/xdg/config';
  const macHome = '/Users/dev';
  const appData = 'C:\\Users\\dev\\AppData\\Roaming';
  const linux = kicadPaths(home, { xdg });
  const mac = kicadPaths(macHome, { xdg });
  const win = kicadPaths('C:\\Users\\dev', { appData });
  const present = (dirs) => (dir) => dirs.includes(dir);

  assert.equal(resolveRealKicadConfigDir({
    platform: 'linux',
    env: { HOME: home, XDG_CONFIG_HOME: xdg },
    exists: present([linux.flatpak, linux.xdg, linux.homeConfig])
  }), linux.flatpak);
  assert.equal(resolveRealKicadConfigDir({
    platform: 'linux',
    env: { HOME: home, XDG_CONFIG_HOME: xdg },
    exists: present([linux.xdg, linux.homeConfig])
  }), linux.xdg);
  assert.equal(resolveRealKicadConfigDir({
    platform: 'linux',
    env: { HOME: home },
    exists: present([linux.homeConfig])
  }), linux.homeConfig);
  assert.equal(resolveRealKicadConfigDir({
    platform: 'linux',
    env: { HOME: home, XDG_CONFIG_HOME: xdg },
    exists: present([linux.homeConfig])
  }), null);
  assert.equal(resolveRealKicadConfigDir({
    platform: 'linux',
    env: { XDG_CONFIG_HOME: xdg },
    exists: present([linux.xdg])
  }), linux.xdg);
  assert.equal(resolveRealKicadConfigDir({
    platform: 'linux',
    env: { HOME: home },
    exists: present([])
  }), null);
  assert.equal(resolveRealKicadConfigDir({
    platform: 'linux',
    env: {},
    exists: present([linux.homeConfig])
  }), null);

  assert.equal(resolveRealKicadConfigDir({
    platform: 'darwin',
    env: { HOME: macHome, XDG_CONFIG_HOME: xdg },
    exists: present([mac.mac, mac.xdg])
  }), mac.mac);
  assert.equal(resolveRealKicadConfigDir({
    platform: 'darwin',
    env: { HOME: macHome, XDG_CONFIG_HOME: xdg },
    exists: present([mac.xdg])
  }), null);
  assert.equal(resolveRealKicadConfigDir({
    platform: 'darwin',
    env: { XDG_CONFIG_HOME: xdg },
    exists: present([mac.mac])
  }), null);

  assert.equal(resolveRealKicadConfigDir({
    platform: 'win32',
    env: { APPDATA: appData, HOME: 'C:\\Users\\dev', XDG_CONFIG_HOME: xdg },
    exists: present([win.win, linux.homeConfig])
  }), win.win);
  assert.equal(resolveRealKicadConfigDir({
    platform: 'win32',
    env: { HOME: 'C:\\Users\\dev', USERPROFILE: 'C:\\Users\\dev' },
    exists: present([
      win.win,
      path.join('C:\\Users\\dev', '.config', 'kicad'),
      path.join('C:\\Users\\dev', '.var', 'app', 'org.kicad.KiCad', 'config', 'kicad')
    ])
  }), null);
  assert.equal(resolveRealKicadConfigDir({
    platform: 'win32',
    env: { APPDATA: appData },
    exists: present([])
  }), null);
});

test('isolateProcessHome pins the real KiCad config before redirecting home', () => {
  const homeBefore = process.env.HOME;
  const kicadBefore = process.env.KICAD_CONFIG_HOME;
  const appDataBefore = process.env.APPDATA;
  const home = '/home/dev';
  const xdg = '/xdg/config';
  const paths = kicadPaths(home, { xdg });
  const linux = { HOME: home, XDG_CONFIG_HOME: xdg };
  const linuxRoot = isolateInjected('linux', linux, [paths.flatpak, paths.xdg], 'pin-flatpak');
  assert.equal(linux.KICAD_CONFIG_HOME, paths.flatpak);
  assert.equal(linux.HOME, linuxRoot);
  assert.equal(linux.XDG_CONFIG_HOME, path.join(linuxRoot, '.config'));
  assert.equal(pathInside(linux.KICAD_CONFIG_HOME, linuxRoot), false);

  const fallback = { HOME: home, XDG_CONFIG_HOME: xdg };
  const fallbackRoot = isolateInjected('linux', fallback, [paths.xdg], 'pin-xdg');
  assert.equal(fallback.KICAD_CONFIG_HOME, paths.xdg);
  assert.equal(fallback.HOME, fallbackRoot);
  assert.equal(fallback.XDG_CONFIG_HOME, path.join(fallbackRoot, '.config'));

  const fromHome = { HOME: home };
  isolateInjected('linux', fromHome, [paths.homeConfig], 'pin-home');
  assert.equal(fromHome.KICAD_CONFIG_HOME, paths.homeConfig);

  const absent = { HOME: home, XDG_CONFIG_HOME: xdg };
  const absentRoot = isolateInjected('linux', absent, [paths.homeConfig], 'pin-absent');
  assert.equal(Object.hasOwn(absent, 'KICAD_CONFIG_HOME'), false);
  assert.equal(absent.HOME, absentRoot);

  const presetDir = path.join('/custom', 'kicad');
  const preset = { HOME: home, KICAD_CONFIG_HOME: presetDir };
  let existsCalls = 0;
  const presetRoot = isolateProcessHome({
    platform: 'linux',
    env: preset,
    exists() {
      existsCalls += 1;
      return true;
    },
    temporaryDirectory: tmpdir(),
    mkdtemp: (value) => `${value}pin-preset`
  });
  assert.equal(existsCalls, 0);
  assert.equal(preset.KICAD_CONFIG_HOME, presetDir);
  assert.equal(preset.HOME, presetRoot);

  const blank = { HOME: home, KICAD_CONFIG_HOME: '' };
  isolateInjected('linux', blank, [paths.homeConfig], 'pin-blank');
  assert.equal(blank.KICAD_CONFIG_HOME, paths.homeConfig);

  const macHome = '/Users/dev';
  const macPaths = kicadPaths(macHome, { xdg });
  const mac = { HOME: macHome, XDG_CONFIG_HOME: xdg };
  const macRoot = isolateInjected('darwin', mac, [macPaths.mac, macPaths.xdg], 'pin-mac');
  assert.equal(mac.KICAD_CONFIG_HOME, macPaths.mac);
  assert.equal(mac.HOME, macRoot);
  assert.equal(mac.XDG_CONFIG_HOME, xdg);

  const appData = 'C:\\Users\\dev\\AppData\\Roaming';
  const winPaths = kicadPaths('C:\\Users\\dev', { appData });
  const win = {
    HOME: 'C:\\Users\\dev',
    USERPROFILE: 'C:\\Users\\dev',
    APPDATA: appData,
    LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local',
    XDG_CONFIG_HOME: 'C:\\keep-xdg'
  };
  const winRoot = isolateInjected('win32', win, [winPaths.win], 'pin-win');
  assert.equal(win.KICAD_CONFIG_HOME, winPaths.win);
  assert.equal(win.APPDATA, path.join(winRoot, 'AppData', 'Roaming'));
  assert.notEqual(win.KICAD_CONFIG_HOME, path.join(win.APPDATA, 'kicad'));
  assert.equal(win.HOME, 'C:\\Users\\dev');
  assert.equal(win.USERPROFILE, 'C:\\Users\\dev');
  assert.equal(win.XDG_CONFIG_HOME, 'C:\\keep-xdg');

  const winBare = { HOME: 'C:\\Users\\dev', USERPROFILE: 'C:\\Users\\dev' };
  const winBareRoot = isolateInjected('win32', winBare, [
    winPaths.win,
    path.join('C:\\Users\\dev', '.config', 'kicad')
  ], 'pin-win-bare');
  assert.equal(Object.hasOwn(winBare, 'KICAD_CONFIG_HOME'), false);
  assert.equal(winBare.APPDATA, path.join(winBareRoot, 'AppData', 'Roaming'));
  assert.equal(winBare.HOME, 'C:\\Users\\dev');

  assert.equal(process.env.HOME, homeBefore);
  assert.equal(process.env.KICAD_CONFIG_HOME, kicadBefore);
  assert.equal(process.env.APPDATA, appDataBefore);
});
