import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(import.meta.dirname, '..');
const hookUrl = pathToFileURL(path.join(repoRoot, 'tests/setup/isolate-home.mjs')).href;

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
      localAppData: process.env.LOCALAPPDATA,
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
  assert.equal(info.localAppData, path.join(info.root, 'AppData', 'Local'));
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
    assert.equal(source.startsWith("import './setup/isolate-home.mjs';\n"), true, name);
  }
});
