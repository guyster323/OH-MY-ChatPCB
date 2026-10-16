import { access, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { chromium } from 'playwright';

const require = createRequire(import.meta.url);

// CHATPCB_BROWSER_PATH is the override scripts/verify-panel-ui.js already honored.
const OVERRIDE_ENV_VARS = ['CHATPCB_CHROME_PATH', 'CHATPCB_BROWSER_PATH'];

const LINUX_CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
];

const DARWIN_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'
];

// Playwright's chromium-headless-shell layout. Hyphens in the browser name
// become underscores in the cache directory: chromium_headless_shell-<revision>.
const HEADLESS_SHELL_LAYOUTS = {
  linux: {
    x64: ['chrome-headless-shell-linux64', 'chrome-headless-shell'],
    arm64: ['chrome-linux', 'headless_shell']
  },
  darwin: {
    x64: ['chrome-headless-shell-mac-x64', 'chrome-headless-shell'],
    arm64: ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell']
  },
  win32: {
    x64: ['chrome-headless-shell-win64', 'chrome-headless-shell.exe'],
    arm64: ['chrome-headless-shell-win64', 'chrome-headless-shell.exe']
  }
};

export async function findChrome({
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  playwrightExecutablePath,
  playwrightHeadlessShellPath,
  exists = defaultExists,
  listDir = defaultListDir
} = {}) {
  const override = envOverride(env);
  if (override) {
    if (await canExecute(override.path, exists)) {
      return { path: override.path, source: 'env' };
    }
    return {
      path: null,
      source: 'unavailable',
      reason: `${override.name} is set but is not an executable file: ${override.path}`
    };
  }

  const bundled = playwrightChromiumPath(playwrightExecutablePath);
  if (await canExecute(bundled, exists)) {
    return { path: bundled, source: 'playwright' };
  }

  const candidates = platformCandidates(platform, env);
  for (const candidate of candidates) {
    if (await canExecute(candidate, exists)) {
      return { path: candidate, source: platform };
    }
  }

  const shell = await findHeadlessShell({
    env,
    platform,
    arch,
    explicitPath: playwrightHeadlessShellPath,
    exists,
    listDir
  });
  if (shell.path) {
    // Callers may pass this path as executablePath. Omitting executablePath is
    // also fine: headless chromium.launch() selects the shell itself.
    return { path: shell.path, source: 'playwright-headless-shell' };
  }

  const checked = [];
  if (bundled) checked.push(bundled);
  checked.push(...candidates, ...shell.checked);
  return {
    path: null,
    source: 'unavailable',
    reason: unavailableReason(platform, unique(checked))
  };
}

// undefined lets Playwright pick chromium-headless-shell for a headless launch.
export function executablePathForLaunch(found) {
  if (!found?.path || found.source === 'playwright-headless-shell') return undefined;
  return found.path;
}

function envOverride(env) {
  for (const name of OVERRIDE_ENV_VARS) {
    const value = env[name];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return { name, path: trimmed };
  }
  return null;
}

function playwrightChromiumPath(explicit) {
  if (explicit !== undefined) return explicit || '';
  try {
    return chromium.executablePath() || '';
  } catch {
    return '';
  }
}

async function findHeadlessShell({ env, platform, arch, explicitPath, exists, listDir }) {
  const checked = [];
  const registryPath = explicitPath !== undefined
    ? (explicitPath || '')
    : registryHeadlessShellPath();
  if (registryPath) {
    checked.push(registryPath);
    if (await canExecute(registryPath, exists)) return { path: registryPath, checked };
  }

  const root = browsersCacheDir(env);
  if (!root) return { path: null, checked };
  let names = [];
  try {
    names = await listDir(root);
  } catch {
    names = [];
  }
  const shellDirs = names
    .filter((name) => typeof name === 'string' && name.startsWith('chromium_headless_shell-'))
    .sort((left, right) => shellRevision(right) - shellRevision(left) || (left < right ? -1 : left > right ? 1 : 0));
  for (const dirName of shellDirs) {
    for (const parts of headlessShellLayouts(platform, arch)) {
      const candidate = path.join(root, dirName, ...parts);
      checked.push(candidate);
      if (await canExecute(candidate, exists)) return { path: candidate, checked };
    }
  }
  return { path: null, checked };
}

function headlessShellLayouts(platform, arch) {
  const table = HEADLESS_SHELL_LAYOUTS[platform] || HEADLESS_SHELL_LAYOUTS.linux;
  const preferredKey = arch === 'arm64' ? 'arm64' : 'x64';
  const preferred = table[preferredKey];
  const alternateKey = preferredKey === 'arm64' ? 'x64' : 'arm64';
  const alternate = table[alternateKey];
  if (!alternate || alternate.join('\0') === preferred.join('\0')) return [preferred];
  return [preferred, alternate];
}

function shellRevision(name) {
  const match = /-(\d+)$/.exec(name);
  return match ? Number(match[1]) : 0;
}

function registryHeadlessShellPath() {
  let registryApi;
  try {
    registryApi = require('playwright-core/lib/coreBundle').registry;
  } catch {
    return '';
  }
  const registry = registryApi?.registry;
  if (!registry || typeof registry.findExecutable !== 'function') return '';
  try {
    const executable = registry.findExecutable('chromium-headless-shell');
    const shellPath = executable?.executablePath?.();
    return typeof shellPath === 'string' ? shellPath : '';
  } catch {
    return '';
  }
}

function browsersCacheDir(env) {
  const configured = stringValue(env.PLAYWRIGHT_BROWSERS_PATH);
  if (configured === '0') {
    try {
      return path.join(path.dirname(require.resolve('playwright-core/package.json')), '.local-browsers');
    } catch {
      return '';
    }
  }
  if (configured) {
    if (path.isAbsolute(configured)) return configured;
    const base = stringValue(env.INIT_CWD) || process.cwd();
    return path.resolve(base, configured);
  }
  return defaultMsPlaywrightDir(env, process.platform);
}

function defaultMsPlaywrightDir(env, platform) {
  if (platform === 'linux') {
    const root = stringValue(env.XDG_CACHE_HOME) || path.join(homeDir(env), '.cache');
    return path.join(root, 'ms-playwright');
  }
  if (platform === 'darwin') {
    return path.join(homeDir(env), 'Library', 'Caches', 'ms-playwright');
  }
  if (platform === 'win32') {
    const root = stringValue(env.LOCALAPPDATA) || path.join(homeDir(env), 'AppData', 'Local');
    return path.join(root, 'ms-playwright');
  }
  return '';
}

function homeDir(env) {
  return stringValue(env.HOME) || stringValue(env.USERPROFILE) || os.homedir();
}

function stringValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function platformCandidates(platform, env) {
  if (platform === 'linux') return LINUX_CANDIDATES;
  if (platform === 'darwin') return DARWIN_CANDIDATES;
  if (platform === 'win32') return windowsCandidates(env);
  return [];
}

function windowsCandidates(env) {
  const roots = unique([
    env.PROGRAMFILES,
    env.ProgramFiles,
    'C:\\Program Files',
    env['PROGRAMFILES(X86)'],
    env['ProgramFiles(x86)'],
    'C:\\Program Files (x86)'
  ]);
  const localAppData = typeof env.LOCALAPPDATA === 'string' ? env.LOCALAPPDATA.trim() : '';
  const candidates = [];
  for (const root of roots) {
    candidates.push(path.win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }
  if (localAppData) {
    candidates.push(path.win32.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }
  // Edge stays after Chrome. The panel verifier already launched it on Windows.
  for (const root of roots) {
    candidates.push(path.win32.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  }
  if (localAppData) {
    candidates.push(path.win32.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  }
  return unique(candidates);
}

function unavailableReason(platform, checked) {
  const looked = checked.filter(Boolean);
  const list = looked.length ? looked.join(', ') : 'no known locations';
  return `No Chrome or Chromium executable found on ${platform}. Set CHATPCB_CHROME_PATH, or run "npx playwright install chromium" (or "npx playwright install chromium --only-shell" for the headless shell). Checked: ${list}`;
}

function unique(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (typeof value !== 'string' || value === '' || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

async function canExecute(candidate, exists) {
  if (typeof candidate !== 'string' || candidate === '') return false;
  try {
    return Boolean(await exists(candidate));
  } catch {
    return false;
  }
}

async function defaultExists(candidate) {
  await access(candidate, constants.X_OK);
  const info = await stat(candidate);
  return info.isFile();
}

async function defaultListDir(dir) {
  return readdir(dir);
}
