import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { isolateProcessHome } from './setup/isolate-home.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const hookUrl = pathToFileURL(path.join(repoRoot, 'tests/setup/isolate-home.mjs')).href;

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
  const parentHome = process.env.HOME;
  const parentHomeExisted = typeof parentHome === 'string' && existsSync(parentHome);
  const script = `
    import { existsSync } from 'node:fs';
    import { tmpdir, userInfo } from 'node:os';
    import path from 'node:path';
    const root = process.env.HOME;
    await import(${JSON.stringify(hookUrl)});
    console.log(JSON.stringify({
      root,
      same: process.env.HOME === root,
      userProfile: process.env.USERPROFILE,
      appData: process.env.APPDATA,
      localAppData: Object.hasOwn(process.env, 'LOCALAPPDATA') ? process.env.LOCALAPPDATA : null,
      xdg: Object.hasOwn(process.env, 'XDG_CONFIG_HOME') ? process.env.XDG_CONFIG_HOME : null,
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
  assert.equal(info.same, true);
  assert.equal(info.underTmp, true);
  assert.notEqual(path.resolve(info.root), path.resolve(info.realHome));
  assert.notEqual(path.resolve(info.root), path.resolve(userInfo().homedir));
  assert.equal(info.userProfile, info.root);
  assert.equal(info.appData, path.join(info.root, 'AppData', 'Roaming'));
  if (process.platform === 'win32') {
    const inherited = Object.hasOwn(process.env, 'LOCALAPPDATA') ? process.env.LOCALAPPDATA : null;
    assert.equal(info.localAppData, inherited);
  } else {
    assert.equal(info.localAppData, path.join(info.root, 'AppData', 'Local'));
  }
  if (process.platform === 'darwin' || process.platform === 'win32') {
    const inherited = Object.hasOwn(process.env, 'XDG_CONFIG_HOME') ? process.env.XDG_CONFIG_HOME : null;
    assert.equal(info.xdg, inherited);
  } else {
    assert.equal(info.xdg, path.join(info.root, '.config'));
  }
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

test('isolateProcessHome leaves LOCALAPPDATA inherited on win32', () => {
  const homeBefore = process.env.HOME;
  const localBefore = process.env.LOCALAPPDATA;
  const temporaryDirectory = path.join(tmpdir(), 'chatpcb-win32-inject');
  const inherited = 'C:\\Users\\dev\\AppData\\Local';
  const env = { LOCALAPPDATA: inherited, XDG_CONFIG_HOME: 'C:\\keep-xdg' };
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
  assert.equal(env.HOME, root);
  assert.equal(env.USERPROFILE, root);
  assert.equal(env.APPDATA, path.join(root, 'AppData', 'Roaming'));
  assert.equal(env.LOCALAPPDATA, inherited);
  assert.equal(env.XDG_CONFIG_HOME, 'C:\\keep-xdg');
  assert.equal(Object.hasOwn(bare, 'LOCALAPPDATA'), false);
  assert.equal(bare.HOME, bareRoot);
  assert.equal(bare.USERPROFILE, bareRoot);
  assert.equal(bare.APPDATA, path.join(bareRoot, 'AppData', 'Roaming'));
  assert.equal(Object.hasOwn(bare, 'XDG_CONFIG_HOME'), false);
  assert.equal(process.env.HOME, homeBefore);
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
    if (platform === 'darwin') {
      assert.equal(env.XDG_CONFIG_HOME, 'inherit-xdg', platform);
    } else {
      assert.equal(env.XDG_CONFIG_HOME, path.join(root, '.config'), platform);
    }
  }
  assert.equal(process.env.HOME, homeBefore);
  assert.equal(process.env.LOCALAPPDATA, localBefore);
});
