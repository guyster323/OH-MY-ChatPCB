import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

import { chromium } from 'playwright';

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

export async function findChrome({
  env = process.env,
  platform = process.platform,
  playwrightExecutablePath,
  exists = defaultExists
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

  const checked = [];
  if (bundled) checked.push(bundled);
  checked.push(...candidates);
  return {
    path: null,
    source: 'unavailable',
    reason: unavailableReason(platform, checked)
  };
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
  return `No Chrome or Chromium executable found on ${platform}. Set CHATPCB_CHROME_PATH or install Playwright's Chromium. Checked: ${list}`;
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
