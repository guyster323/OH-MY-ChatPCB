import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { resolveChatGPTConfigDir } from '../src/runtime/auth/chatgpt-auth.js';

const home = path.join('/home', 'tester');
const xdg = path.join('/tmp', 'xdg-config');
const appData = path.join('C:/Users/tester/AppData/Roaming');

test('resolveChatGPTConfigDir honors XDG_CONFIG_HOME on linux, darwin, and win32', () => {
  for (const platform of ['linux', 'darwin', 'win32']) {
    assert.equal(
      resolveChatGPTConfigDir({
        platform,
        home,
        env: { XDG_CONFIG_HOME: xdg, APPDATA: appData }
      }),
      path.join(xdg, 'chatpcb'),
      platform
    );
  }
});

test('resolveChatGPTConfigDir uses the platform directory when XDG_CONFIG_HOME is unset', () => {
  assert.equal(
    resolveChatGPTConfigDir({ platform: 'linux', home, env: { APPDATA: appData } }),
    path.join(home, '.config', 'chatpcb')
  );
  assert.equal(
    resolveChatGPTConfigDir({ platform: 'linux', home, env: { XDG_CONFIG_HOME: '' } }),
    path.join(home, '.config', 'chatpcb')
  );
  assert.equal(
    resolveChatGPTConfigDir({ platform: 'darwin', home, env: { APPDATA: appData } }),
    path.join(home, 'Library', 'Application Support', 'chatpcb')
  );
  assert.equal(
    resolveChatGPTConfigDir({ platform: 'darwin', home, env: {} }),
    path.join(home, 'Library', 'Application Support', 'chatpcb')
  );
  assert.equal(
    resolveChatGPTConfigDir({ platform: 'win32', home, env: { APPDATA: appData } }),
    path.join(appData, 'chatpcb')
  );
  assert.equal(
    resolveChatGPTConfigDir({
      platform: 'win32',
      home,
      env: { XDG_CONFIG_HOME: '', APPDATA: appData }
    }),
    path.join(appData, 'chatpcb')
  );
  assert.equal(
    resolveChatGPTConfigDir({ platform: 'win32', home, env: {} }),
    path.join(home, 'AppData', 'Roaming', 'chatpcb')
  );
  assert.equal(
    resolveChatGPTConfigDir({ platform: 'win32', home, env: { APPDATA: '' } }),
    path.join(home, 'AppData', 'Roaming', 'chatpcb')
  );
});
