import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// One temporary home per process. A second import (node --import plus a test
// file importing this module, or a worker that evaluates it twice) must not
// replace that home. Child processes do not inherit the marker, so each one
// gets its own directory instead of sharing the parent's.
const MARKER = Symbol.for('chatpcb.isolateHomeHook');

function isolateProcessHome() {
  if (globalThis[MARKER]) return globalThis[MARKER];
  const root = mkdtempSync(path.join(tmpdir(), 'chatpcb-home-'));
  process.env.HOME = root;
  process.env.USERPROFILE = root;
  process.env.APPDATA = path.join(root, 'AppData', 'Roaming');
  process.env.LOCALAPPDATA = path.join(root, 'AppData', 'Local');
  // Credential files follow an absolute XDG_CONFIG_HOME on Linux and any other
  // platform that is not macOS or Windows. Point it inside this home so a
  // developer value cannot redirect writes. macOS and Windows ignore XDG and
  // use the native directory under HOME / APPDATA, which are already redirected.
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    process.env.XDG_CONFIG_HOME = path.join(root, '.config');
  }
  globalThis[MARKER] = root;
  process.once('exit', () => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // The process is exiting. A leftover temp directory is the only fallback.
    }
  });
  return root;
}

isolateProcessHome();
