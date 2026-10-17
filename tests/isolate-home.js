import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';

import { resolveChatGPTConfigDir } from '../src/runtime/auth/chatgpt-auth.js';

const KEYS = ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'APPDATA', 'LOCALAPPDATA'];
const CONFIG_GUARD_CODE = 'CHATPCB_TEST_CONFIG_HOME';

function pathInside(child, parent) {
  const fromParent = path.relative(path.resolve(parent), path.resolve(child));
  return fromParent === '' || (fromParent !== '' && !fromParent.startsWith('..') && !path.isAbsolute(fromParent));
}

// Tests inject a temporary home through the environment. Refuse a resolved
// ChatPCB config directory that escaped that home, or that still sits inside
// the real account home from userInfo().
export function assertIsolatedConfigDir(configDir, tempRoot) {
  const resolvedDir = path.resolve(configDir);
  const resolvedRoot = path.resolve(tempRoot);
  if (!pathInside(resolvedDir, resolvedRoot)) {
    const error = new Error(
      `Refusing ChatPCB config directory ${resolvedDir} because it is not inside the temporary home ${resolvedRoot}.`
    );
    error.code = CONFIG_GUARD_CODE;
    throw error;
  }
  let realHome;
  try {
    realHome = userInfo().homedir;
  } catch {
    return resolvedDir;
  }
  if (realHome && pathInside(resolvedDir, realHome)) {
    const error = new Error(
      `Refusing ChatPCB config directory ${resolvedDir} because it is inside the real home ${path.resolve(realHome)}. Point HOME at a temporary directory, APPDATA on Windows, or an absolute XDG_CONFIG_HOME on Linux.`
    );
    error.code = CONFIG_GUARD_CODE;
    throw error;
  }
  return resolvedDir;
}

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
  return assertIsolatedConfigDir(
    resolveChatGPTConfigDir({ platform, env: process.env }),
    root
  );
}

export async function isolateHome() {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-home-'));
  const saved = new Map(KEYS.map((key) => [key, process.env[key]]));
  const restoreEnv = () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    applyIsolatedConfigEnv(root);
  } catch (error) {
    restoreEnv();
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  return {
    root,
    async restore() {
      restoreEnv();
      await rm(root, { recursive: true, force: true });
    }
  };
}
