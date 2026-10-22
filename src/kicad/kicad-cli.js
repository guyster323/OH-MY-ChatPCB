import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { KICAD_FLATPAK_APP_ID, cliIsFlatpakKicad, isFlatpakPath, isKicadDirectoryEnv } from './flatpak.js';

const WINDOWS_CANDIDATES = [
  'C:/Program Files/KiCad/10.0/bin/kicad-cli.exe',
  'C:/Program Files/KiCad/9.0/bin/kicad-cli.exe',
  'C:/Program Files/KiCad/8.0/bin/kicad-cli.exe',
  'C:/Program Files/KiCad/7.0/bin/kicad-cli.exe'
];

const MACOS_CANDIDATES = [
  '/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli',
  '/Applications/KiCad 10.0/KiCad.app/Contents/MacOS/kicad-cli',
  '/Applications/KiCad 9.0/KiCad.app/Contents/MacOS/kicad-cli'
];

const LINUX_CANDIDATES = [
  '/usr/bin/kicad-cli',
  '/usr/local/bin/kicad-cli'
];

let kicadCliDisableWarned = false;

function warnIfKicadCliDisabled(env) {
  if (env.CHATPCB_KICAD_CLI_DISABLE !== '1' || kicadCliDisableWarned) return;
  kicadCliDisableWarned = true;
  console.error('kicad-cli disabled by CHATPCB_KICAD_CLI_DISABLE');
}

export function resolveKicadCli(options = {}) {
  const resolved = findKicadCli(options);
  if (!resolved.path) return resolved;
  if (cliIsFlatpakKicad(resolved.path, {
    env: options.env ?? process.env,
    platform: options.platform ?? process.platform
  })) {
    return { path: resolved.path, source: 'flatpak' };
  }
  return resolved;
}

function findKicadCli({
  explicitPath,
  env = process.env,
  platform = process.platform,
  cwd = process.cwd(),
  exists = fs.existsSync,
  excludeProjectDir
} = {}) {
  // Tests set this so discovery cannot fall through to a host kicad-cli.
  // Operators who leave it set get one stderr warning and unavailable checks.
  if (env.CHATPCB_KICAD_CLI_DISABLE === '1') {
    warnIfKicadCliDisabled(env);
    return { path: null, source: 'unavailable' };
  }

  if (explicitPath && exists(explicitPath)) {
    return { path: explicitPath, source: 'explicit' };
  }

  if (env.KICAD_CLI_PATH && exists(env.KICAD_CLI_PATH)) {
    return { path: env.KICAD_CLI_PATH, source: 'env' };
  }

  if (platform === 'win32') {
    const userInstallPath = windowsUserCandidates(env).find((candidate) => exists(candidate));
    if (userInstallPath) {
      return { path: userInstallPath, source: 'windows-user-install' };
    }

    const installPath = WINDOWS_CANDIDATES.find((candidate) => exists(candidate));
    if (installPath) {
      return { path: installPath, source: 'windows-install' };
    }
  }

  if (platform === 'darwin') {
    const installPath = MACOS_CANDIDATES.find((candidate) => exists(candidate));
    if (installPath) {
      return { path: installPath, source: 'macos-install' };
    }
  }

  if (platform === 'linux') {
    const installPath = LINUX_CANDIDATES.find((candidate) => exists(candidate));
    if (installPath) {
      return { path: installPath, source: 'linux-install' };
    }
  }

  const paths = platform === 'win32' ? path.win32 : path.posix;
  const workingDir = paths.resolve(cwd);
  const excludedProject = excludeProjectDir ? paths.resolve(excludeProjectDir) : null;
  const normalize = (value) => platform === 'win32' ? value.toLowerCase() : value;
  const searchPath = env.PATH ?? env.Path ?? '';
  for (const directory of searchPath.split(platform === 'win32' ? ';' : ':')) {
    // Never let cwd, the original project, or a relative PATH entry select an executable.
    if (!paths.isAbsolute(directory)) continue;
    const absolute = paths.resolve(directory);
    if (isInsideOrSame(paths, normalize, workingDir, absolute)) continue;
    if (excludedProject && isInsideOrSame(paths, normalize, excludedProject, absolute)) continue;
    const candidate = paths.join(absolute, platform === 'win32' ? 'kicad-cli.exe' : 'kicad-cli');
    if (exists(candidate)) return { path: candidate, source: 'path' };
  }
  return { path: null, source: 'unavailable' };
}

function isInsideOrSame(paths, normalize, root, candidate) {
  const relative = paths.relative(normalize(root), normalize(candidate));
  return relative === '' || (!relative.startsWith('..' + paths.sep) && relative !== '..' && !paths.isAbsolute(relative));
}

function windowsUserCandidates(env) {
  if (!env.LOCALAPPDATA) {
    return [];
  }

  const localAppData = env.LOCALAPPDATA.replace(/\\/g, '/').replace(/\/+$/, '');
  return [
    `${localAppData}/Programs/KiCad/10.0/bin/kicad-cli.exe`,
    `${localAppData}/Programs/KiCad/9.0/bin/kicad-cli.exe`,
    `${localAppData}/Programs/KiCad/8.0/bin/kicad-cli.exe`,
    `${localAppData}/Programs/KiCad/7.0/bin/kicad-cli.exe`
  ];
}

// The flatpak wrapper can fail before KiCad starts, e.g. "error: Extension
// org.freedesktop.Platform.GL.default has invalid merge-dirs". KiCad never ran,
// so nothing it would have written exists and no file was touched.
const LAUNCHER_STDERR = /^(?:error|bwrap): /;
// flatpak prints "F: ..." warnings (e.g. "F: Can't get document portal") ahead
// of the launcher error, so those lines are dropped before the check.
const FLATPAK_WARNING_LINE = /^F: .*(?:\r?\n|$)/gm;

export function isKicadLauncherFailure(result) {
  if (!result || typeof result !== 'object' || result.source !== 'flatpak') return false;
  if (result.exitCode === 0) return false;
  if (typeof result.stdout === 'string' && result.stdout.trim() !== '') return false;
  const stderr = typeof result.stderr === 'string' ? result.stderr.replace(FLATPAK_WARNING_LINE, '').trim() : '';
  return LAUNCHER_STDERR.test(stderr);
}

export async function retryOnceOnLauncherFailure(run) {
  const first = await run();
  if (!isKicadLauncherFailure(first)) return first;
  const second = await run();
  if (!isKicadLauncherFailure(second)) return { ...second, launchRetried: true };
  return {
    ...second,
    launchRetried: true,
    launchFailed: true,
    reason: {
      code: 'KICAD_CLI_LAUNCH_FAILED',
      message: 'The KiCad CLI launcher failed before KiCad started, twice.'
    }
  };
}

export async function runKicadCli(args, options = {}) {
  const resolved = resolveKicadCli(options);
  if (!resolved.path) {
    const error = new Error('No KiCad CLI found in configured installations or absolute PATH directories.');
    error.code = 'ENOENT';
    throw error;
  }
  const flatpak = resolved.source === 'flatpak';
  const platform = options.platform ?? process.platform;
  const env = kicadCliChildEnv(options.env ?? process.env, { flatpak, platform });
  // Concurrent kicad-cli processes rewrite the shared kicad_common.json.
  // Each invocation copies the live config into a private directory and deletes it.
  const privateConfigHome = await assignPrivateKicadConfigHome(env, {
    flatpak,
    platform,
    cwd: options.cwd
  });
  try {
    return await retryOnceOnLauncherFailure(async () => ({
      ...(await runCommand(resolved.path, args, {
        cwd: options.cwd,
        timeoutMs: options.timeoutMs ?? 120000,
        env
      })),
      command: resolved.path,
      source: resolved.source
    }));
  } finally {
    if (privateConfigHome) {
      await fs.promises.rm(privateConfigHome, { recursive: true, force: true });
    }
  }
}

function configHomeDirectory(env) {
  for (const key of ['HOME', 'USERPROFILE']) {
    const value = env[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

// os.homedir() follows HOME. A test hook can point HOME at an empty temp dir,
// so the real account home is the passwd entry, not the environment.
function realAccountHome() {
  try {
    const home = os.userInfo().homedir;
    if (typeof home === 'string' && home.trim()) return home.trim();
  } catch {
    // No passwd entry. The project directory is the remaining visible place.
  }
  return null;
}

function directoryExists(candidate) {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function pathInside(root, candidate) {
  if (!root || !candidate) return false;
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (
    !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
  );
}

// Our per-call copy must not be treated as the upstream config. That includes
// the cache directory used now and the old /tmp/chatpcb-kicad-config-* prefix.
function isOurPrivateKicadConfig(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const parts = path.resolve(value.trim()).split(path.sep).filter(Boolean);
  for (let index = 0; index < parts.length; index += 1) {
    const name = parts[index];
    const legacy = name.startsWith('chatpcb-kicad-config-');
    const parent = parts[index - 1];
    const current = /^kicad-config-[A-Za-z0-9]+$/.test(name)
      && (parent === 'chatpcb' || parent === '.chatpcb');
    if (!legacy && !current) continue;
    const rest = parts.slice(index + 1);
    if (rest.length === 0 || (rest.length === 1 && rest[0] === 'kicad')) return true;
  }
  return false;
}

// Flatpak KiCad 10 keeps settings under its app config. ~/.config/kicad can be
// a different major version, so a flatpak CLI does not copy that tree.
// An existing KICAD_CONFIG_HOME wins, unless it is one of our own private copies.
// Otherwise use the platform directory under the environment home when that
// directory exists, then the same directory under the real account home.
function findKicadConfigSource(env, { flatpak, platform = process.platform, exists = directoryExists } = {}) {
  const pinned = typeof env.KICAD_CONFIG_HOME === 'string' ? env.KICAD_CONFIG_HOME.trim() : '';
  if (pinned && !isOurPrivateKicadConfig(pinned) && exists(pinned)) return pinned;

  const envHome = configHomeDirectory(env);
  const realHome = realAccountHome();
  const fromEnv = kicadConfigCandidates(env, { flatpak, platform, home: envHome, realHome });
  const foundEnv = fromEnv.find((candidate) => exists(candidate));
  if (foundEnv) return foundEnv;

  if (realHome && (!envHome || path.resolve(realHome) !== path.resolve(envHome))) {
    const fromReal = kicadConfigCandidates({}, {
      flatpak,
      platform,
      home: realHome,
      realHome
    });
    return fromReal.find((candidate) => exists(candidate)) ?? null;
  }
  return null;
}

function kicadConfigCandidates(env, { flatpak, platform, home, realHome }) {
  const candidates = [];
  const push = (candidate) => {
    if (candidate) candidates.push(candidate);
  };
  const redirected = Boolean(home && realHome && path.resolve(home) !== path.resolve(realHome));
  const allowEnvPath = (candidate) => candidate && !(redirected && home && pathInside(home, candidate));

  if (platform === 'darwin') {
    if (home) push(path.join(home, 'Library', 'Preferences', 'kicad'));
    return candidates;
  }
  if (platform === 'win32') {
    const appData = typeof env.APPDATA === 'string' ? env.APPDATA.trim() : '';
    if (allowEnvPath(appData)) push(path.join(appData, 'kicad'));
    else if (home) push(path.join(home, 'AppData', 'Roaming', 'kicad'));
    return candidates;
  }

  if (flatpak && home) {
    push(path.join(home, '.var', 'app', KICAD_FLATPAK_APP_ID, 'config', 'kicad'));
  }
  const xdg = typeof env.XDG_CONFIG_HOME === 'string' ? env.XDG_CONFIG_HOME.trim() : '';
  if (allowEnvPath(xdg)) push(path.join(xdg, 'kicad'));
  const appData = typeof env.APPDATA === 'string' ? env.APPDATA.trim() : '';
  if (allowEnvPath(appData)) push(path.join(appData, 'kicad'));
  if (!flatpak && home) push(path.join(home, '.config', 'kicad'));
  return candidates;
}

// The private copy is resolved from the env handed to this call, not from the
// passwd home. An absolute XDG_CACHE_HOME wins. Otherwise use HOME/.cache
// (USERPROFILE on win32). A relative or blank XDG_CACHE_HOME is ignored. With
// no home, the copy lives in the project directory.
function cacheDirectoryFromEnv(env, platform) {
  const xdg = typeof env.XDG_CACHE_HOME === 'string' ? env.XDG_CACHE_HOME.trim() : '';
  if (xdg && path.isAbsolute(xdg)) return xdg;
  const home = cacheHomeDirectory(env, platform);
  if (home) return path.join(home, '.cache');
  return null;
}

function privateConfigBase(env, cwd, platform = process.platform) {
  const cache = cacheDirectoryFromEnv(env, platform);
  if (cache) return path.join(cache, 'chatpcb');
  return path.join(cwd || process.cwd(), '.chatpcb');
}

// The XDG base-dir spec ignores a relative or empty XDG_CACHE_HOME. Replace it
// with the absolute fallback, or drop it when there is no home, so kicad-cli
// cannot create that relative cache under cwd.
function sanitizeChildCacheHome(env, platform) {
  if (!Object.prototype.hasOwnProperty.call(env, 'XDG_CACHE_HOME')) return;
  const cache = cacheDirectoryFromEnv(env, platform);
  if (cache) env.XDG_CACHE_HOME = cache;
  else delete env.XDG_CACHE_HOME;
}

function cacheHomeDirectory(env, platform) {
  const keys = platform === 'win32' ? ['USERPROFILE', 'HOME'] : ['HOME'];
  for (const key of keys) {
    const value = typeof env[key] === 'string' ? env[key].trim() : '';
    if (value && path.isAbsolute(value)) return value;
  }
  return null;
}

async function chmodOwnerOnly(directory) {
  if (process.platform === 'win32') return;
  await fs.promises.chmod(directory, 0o700);
}

// Returns the private parent to delete. KICAD_CONFIG_HOME on the child is the
// copied kicad directory inside that parent. An empty copy turns on KiCad's
// default ERC checks, so copy the live config when one exists.
async function assignPrivateKicadConfigHome(env, { flatpak, platform, cwd }) {
  const base = privateConfigBase(env, cwd, platform);
  await fs.promises.mkdir(base, { recursive: true, mode: 0o700 });
  await chmodOwnerOnly(base);
  const parent = await fs.promises.mkdtemp(path.join(base, 'kicad-config-'));
  try {
    await chmodOwnerOnly(parent);
    const dest = path.join(parent, 'kicad');
    const source = findKicadConfigSource(env, { flatpak, platform });
    if (source) {
      await fs.promises.cp(source, dest, { recursive: true });
    } else {
      await fs.promises.mkdir(dest);
    }
    env.KICAD_CONFIG_HOME = dest;
    return parent;
  } catch (error) {
    await fs.promises.rm(parent, { recursive: true, force: true });
    throw error;
  }
}

// Flatpak hides /var/lib/flatpak even with --filesystem=host. Forwarding
// KICAD*_DIR from that runtime makes kicad-cli report lib_symbol_issues for
// libraries it already has under /app/extensions. Node still reads those
// directories to embed symbols; only the CLI child drops them.
export function kicadCliChildEnv(env = {}, { flatpak = false, platform = process.platform } = {}) {
  const child = { ...env };
  sanitizeChildCacheHome(child, platform);
  if (!flatpak) return child;
  for (const key of Object.keys(child)) {
    const value = child[key];
    if (isKicadDirectoryEnv(key) && typeof value === 'string' && isFlatpakPath(value)) {
      delete child[key];
    }
  }
  return child;
}

export function runCommand(command, args, { cwd = process.cwd(), timeoutMs = 120000, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    const stdout = [];
    const stderr = [];
    let settled = false;
    let timedOut = false;
    let forceKillTimer;

    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => {
        if (!settled) child.kill('SIGKILL');
      }, 250);
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceKillTimer);
      reject(error);
    });

    child.on('close', (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceKillTimer);
      if (timedOut) {
        const error = new Error(`${command} timed out after ${timeoutMs}ms.`);
        error.code = 'KICAD_CLI_TIMEOUT';
        reject(error);
        return;
      }
      resolve({
        exitCode,
        stdout: stdout.join(''),
        stderr: stderr.join('')
      });
    });
  });
}
