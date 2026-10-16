import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { resolveChatGPTConfigDir } from '../../src/runtime/auth/chatgpt-auth.js';

// One temporary home per process. A second import (node --import plus a test
// file importing this module, or a worker that evaluates it twice) must not
// replace that home. Child processes do not inherit the marker, so each one
// gets its own directory instead of sharing the parent's.
const MARKER = Symbol.for('chatpcb.isolateHomeHook');

function envPath(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// os.homedir() on Windows is USERPROFILE, not HOME. The resolver only needs
// that fallback when APPDATA is unset. Other platforms follow HOME.
function configHome(platform, env) {
  if (platform === 'win32') return envPath(env.USERPROFILE) || envPath(env.HOME);
  return envPath(env.HOME);
}

function assertConfigDirInsideTempRoot(configDir, root) {
  const resolvedDir = path.resolve(configDir);
  const resolvedRoot = path.resolve(root);
  const fromRoot = path.relative(resolvedRoot, resolvedDir);
  const inside = fromRoot !== ''
    && fromRoot !== '..'
    && !fromRoot.startsWith(`..${path.sep}`)
    && !path.isAbsolute(fromRoot);
  if (!inside) {
    throw new Error(
      `ChatPCB config directory ${resolvedDir} is not inside the temporary directory ${resolvedRoot}.`
    );
  }
}

// platform, env, and mkdtemp are injectable so a Linux test can pin the win32
// environment without touching process.env or creating a real directory.
export function isolateProcessHome({
  platform = process.platform,
  env = process.env,
  mkdtemp = mkdtempSync,
  temporaryDirectory = tmpdir(),
  registerCleanup = true
} = {}) {
  if (env === process.env && globalThis[MARKER]) return globalThis[MARKER];
  const root = mkdtemp(path.join(temporaryDirectory, 'chatpcb-home-'));
  if (platform === 'win32') {
    // ChatPCB config is %APPDATA%\chatpcb. USERPROFILE is only the fallback
    // when APPDATA is unset. Chrome's default profile comes from that user
    // profile (USERPROFILE, then %USERPROFILE%\AppData\Local), and Chrome 136+
    // refuses DevTools remote debugging when the launch profile is that
    // default. Leave USERPROFILE and LOCALAPPDATA inherited.
    // HOME is inherited too. find-chrome prefers HOME over USERPROFILE, and
    // provider lookup reads HOME when USERPROFILE is unset. Nothing else on
    // Windows needs a redirected HOME once APPDATA is set.
    env.APPDATA = path.join(root, 'AppData', 'Roaming');
  } else {
    env.HOME = root;
    env.USERPROFILE = root;
    env.APPDATA = path.join(root, 'AppData', 'Roaming');
    env.LOCALAPPDATA = path.join(root, 'AppData', 'Local');
  }
  // Credential files follow an absolute XDG_CONFIG_HOME on Linux and any other
  // platform that is not macOS or Windows. Point it inside this home so a
  // developer value cannot redirect writes. macOS uses HOME. Windows uses
  // APPDATA and ignores XDG.
  if (platform !== 'darwin' && platform !== 'win32') {
    env.XDG_CONFIG_HOME = path.join(root, '.config');
  }
  const home = configHome(platform, env);
  const configDir = resolveChatGPTConfigDir({
    platform,
    env,
    ...(home ? { home } : {})
  });
  // Register cleanup before the check so a failed import still removes the
  // directory. The marker is set only after the config dir is inside it.
  if (env === process.env && registerCleanup) {
    process.once('exit', () => {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // The process is exiting. A leftover temp directory is the only fallback.
      }
    });
  }
  assertConfigDirInsideTempRoot(configDir, root);
  if (env === process.env) globalThis[MARKER] = root;
  return root;
}

isolateProcessHome();
