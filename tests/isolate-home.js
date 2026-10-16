import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const KEYS = ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'APPDATA', 'LOCALAPPDATA'];

// Point config lookups at a temporary home. HOME, USERPROFILE, APPDATA, and
// LOCALAPPDATA make the native directory (macOS Library, Windows %APPDATA%,
// Linux ~/.config) live inside that home. XDG_CONFIG_HOME is honored only
// off macOS and Windows, and only when absolute, so set it inside the temp
// home there and leave it unset on darwin and win32. Restores the previous
// environment and deletes only the directory it created.
export function applyIsolatedConfigEnv(root, platform = process.platform) {
  process.env.HOME = root;
  process.env.USERPROFILE = root;
  process.env.APPDATA = path.join(root, 'AppData', 'Roaming');
  process.env.LOCALAPPDATA = path.join(root, 'AppData', 'Local');
  if (platform === 'darwin' || platform === 'win32') {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = path.join(root, '.config');
  }
}

export async function isolateHome() {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-home-'));
  const saved = new Map(KEYS.map((key) => [key, process.env[key]]));
  applyIsolatedConfigEnv(root);
  return {
    root,
    async restore() {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(root, { recursive: true, force: true });
    }
  };
}
