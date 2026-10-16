import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { resolveChatGPTConfigDir } from '../src/runtime/auth/chatgpt-auth.js';
import { applyIsolatedConfigEnv } from './isolate-home.js';

const home = path.join('/home', 'tester');
const xdg = path.join('/tmp', 'xdg-config');
const appData = path.join('C:/Users/tester/AppData/Roaming');
const libraryDir = path.join(home, 'Library', 'Application Support', 'chatpcb');
const linuxDefault = path.join(home, '.config', 'chatpcb');
const windowsAppData = path.join(appData, 'chatpcb');
const windowsFallback = path.join(home, 'AppData', 'Roaming', 'chatpcb');

test('resolveChatGPTConfigDir uses an absolute XDG_CONFIG_HOME only off macOS and Windows', () => {
  assert.equal(path.isAbsolute(xdg), true);
  assert.equal(
    resolveChatGPTConfigDir({
      platform: 'linux',
      home,
      env: { XDG_CONFIG_HOME: xdg, APPDATA: appData }
    }),
    path.join(xdg, 'chatpcb')
  );
  assert.equal(
    resolveChatGPTConfigDir({
      platform: 'freebsd',
      home,
      env: { XDG_CONFIG_HOME: xdg, APPDATA: appData }
    }),
    path.join(xdg, 'chatpcb')
  );
});

test('resolveChatGPTConfigDir keeps the native directory when XDG_CONFIG_HOME is set on darwin and win32', () => {
  assert.equal(
    resolveChatGPTConfigDir({
      platform: 'darwin',
      home,
      env: { XDG_CONFIG_HOME: xdg, APPDATA: appData }
    }),
    libraryDir
  );
  assert.equal(
    resolveChatGPTConfigDir({
      platform: 'win32',
      home,
      env: { XDG_CONFIG_HOME: xdg, APPDATA: appData }
    }),
    windowsAppData
  );
  assert.equal(
    resolveChatGPTConfigDir({
      platform: 'win32',
      home,
      env: { XDG_CONFIG_HOME: xdg }
    }),
    windowsFallback
  );
  assert.equal(
    resolveChatGPTConfigDir({
      platform: 'win32',
      home,
      env: { XDG_CONFIG_HOME: xdg, APPDATA: '' }
    }),
    windowsFallback
  );
});

test('resolveChatGPTConfigDir ignores a blank or relative XDG_CONFIG_HOME', () => {
  const ignored = ['', '  ', '\t', 'rel/cfg', './cfg', 'rel\\cfg'];
  for (const value of ignored) {
    assert.equal(path.isAbsolute(value), false, JSON.stringify(value));
    assert.equal(
      resolveChatGPTConfigDir({
        platform: 'linux',
        home,
        env: { XDG_CONFIG_HOME: value, APPDATA: appData }
      }),
      linuxDefault,
      `linux ${JSON.stringify(value)}`
    );
    assert.equal(
      resolveChatGPTConfigDir({
        platform: 'darwin',
        home,
        env: { XDG_CONFIG_HOME: value, APPDATA: appData }
      }),
      libraryDir,
      `darwin ${JSON.stringify(value)}`
    );
    assert.equal(
      resolveChatGPTConfigDir({
        platform: 'win32',
        home,
        env: { XDG_CONFIG_HOME: value, APPDATA: appData }
      }),
      windowsAppData,
      `win32 ${JSON.stringify(value)}`
    );
  }
});

test('isolated config env puts the native directory inside the temp home without XDG on darwin and win32', () => {
  const root = path.join('/tmp', 'chatpcb-isolated-home');
  const keys = ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'APPDATA', 'LOCALAPPDATA'];
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  const userXdg = path.join('/tmp', 'user-xdg');
  try {
    process.env.XDG_CONFIG_HOME = userXdg;
    applyIsolatedConfigEnv(root, 'darwin');
    assert.equal(process.env.HOME, root);
    assert.equal(process.env.USERPROFILE, root);
    assert.equal(process.env.APPDATA, path.join(root, 'AppData', 'Roaming'));
    assert.equal(process.env.LOCALAPPDATA, path.join(root, 'AppData', 'Local'));
    assert.equal(process.env.XDG_CONFIG_HOME, undefined);
    assert.equal(
      resolveChatGPTConfigDir({ platform: 'darwin', env: process.env }),
      path.join(root, 'Library', 'Application Support', 'chatpcb')
    );

    process.env.XDG_CONFIG_HOME = userXdg;
    applyIsolatedConfigEnv(root, 'win32');
    assert.equal(process.env.XDG_CONFIG_HOME, undefined);
    assert.equal(
      resolveChatGPTConfigDir({ platform: 'win32', env: process.env }),
      path.join(process.env.APPDATA, 'chatpcb')
    );
    assert.equal(path.isAbsolute(process.env.APPDATA), true);

    applyIsolatedConfigEnv(root, 'linux');
    assert.equal(process.env.XDG_CONFIG_HOME, path.join(root, '.config'));
    assert.equal(path.isAbsolute(process.env.XDG_CONFIG_HOME), true);
    assert.equal(
      resolveChatGPTConfigDir({ platform: 'linux', env: process.env }),
      path.join(root, '.config', 'chatpcb')
    );
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('resolveChatGPTConfigDir uses the platform directory when XDG_CONFIG_HOME is unset', () => {
  assert.equal(
    resolveChatGPTConfigDir({ platform: 'linux', home, env: { APPDATA: appData } }),
    linuxDefault
  );
  assert.equal(
    resolveChatGPTConfigDir({ platform: 'linux', home, env: { XDG_CONFIG_HOME: '' } }),
    linuxDefault
  );
  assert.equal(
    resolveChatGPTConfigDir({ platform: 'darwin', home, env: { APPDATA: appData } }),
    libraryDir
  );
  assert.equal(
    resolveChatGPTConfigDir({ platform: 'darwin', home, env: {} }),
    libraryDir
  );
  assert.equal(
    resolveChatGPTConfigDir({ platform: 'win32', home, env: { APPDATA: appData } }),
    windowsAppData
  );
  assert.equal(
    resolveChatGPTConfigDir({
      platform: 'win32',
      home,
      env: { XDG_CONFIG_HOME: '', APPDATA: appData }
    }),
    windowsAppData
  );
  assert.equal(
    resolveChatGPTConfigDir({ platform: 'win32', home, env: {} }),
    windowsFallback
  );
  assert.equal(
    resolveChatGPTConfigDir({ platform: 'win32', home, env: { APPDATA: '' } }),
    windowsFallback
  );
});
