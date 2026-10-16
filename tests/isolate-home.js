import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const KEYS = ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'APPDATA', 'LOCALAPPDATA'];

// Point config lookups at a temporary home for the duration of a test.
// XDG_CONFIG_HOME is honored on every OS. APPDATA and LOCALAPPDATA cover the
// Windows defaults when XDG_CONFIG_HOME is unset. Restores the previous
// environment and deletes only the directory it created.
export async function isolateHome() {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-home-'));
  const saved = new Map(KEYS.map((key) => [key, process.env[key]]));
  process.env.HOME = root;
  process.env.USERPROFILE = root;
  process.env.XDG_CONFIG_HOME = path.join(root, '.config');
  process.env.APPDATA = path.join(root, 'AppData', 'Roaming');
  process.env.LOCALAPPDATA = path.join(root, 'AppData', 'Local');
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
