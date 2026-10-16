import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// One temporary home per process. A second import (node --import plus a test
// file importing this module, or a worker that evaluates it twice) must not
// replace that home. Child processes do not inherit the marker, so each one
// gets its own directory instead of sharing the parent's.
const MARKER = Symbol.for('chatpcb.isolateHomeHook');

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
  env.HOME = root;
  env.USERPROFILE = root;
  env.APPDATA = path.join(root, 'AppData', 'Roaming');
  // Windows config uses %APPDATA% only (resolveChatGPTConfigDir). Chrome's
  // default profile is %LOCALAPPDATA%\Google\Chrome\User Data. Chrome 136+
  // refuses DevTools remote debugging when that path is missing or is the
  // launch profile, which a temp LOCALAPPDATA triggers even though Playwright
  // already passes --user-data-dir. Leave the inherited value on win32.
  // Transaction journals and KiCad/Chrome discovery still read LOCALAPPDATA,
  // so on Windows they keep the real location.
  if (platform !== 'win32') {
    env.LOCALAPPDATA = path.join(root, 'AppData', 'Local');
  }
  // Credential files follow an absolute XDG_CONFIG_HOME on Linux and any other
  // platform that is not macOS or Windows. Point it inside this home so a
  // developer value cannot redirect writes. macOS and Windows ignore XDG and
  // use the native directory under HOME / APPDATA, which are already redirected.
  if (platform !== 'darwin' && platform !== 'win32') {
    env.XDG_CONFIG_HOME = path.join(root, '.config');
  }
  if (env === process.env) {
    globalThis[MARKER] = root;
    if (registerCleanup) {
      process.once('exit', () => {
        try {
          rmSync(root, { recursive: true, force: true });
        } catch {
          // The process is exiting. A leftover temp directory is the only fallback.
        }
      });
    }
  }
  return root;
}

isolateProcessHome();
