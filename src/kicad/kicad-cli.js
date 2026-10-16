import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

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

export function resolveKicadCli({
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

export async function runKicadCli(args, options = {}) {
  const resolved = resolveKicadCli(options);
  if (!resolved.path) {
    const error = new Error('No KiCad CLI found in configured installations or absolute PATH directories.');
    error.code = 'ENOENT';
    throw error;
  }
  return runCommand(resolved.path, args, {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? 120000,
    env: kicadCliChildEnv(resolved.path, options.env ?? process.env)
  }).then((result) => ({ ...result, command: resolved.path, source: resolved.source }));
}

// Flatpak hides /var/lib/flatpak even with --filesystem=host. Forwarding
// KICAD*_DIR from that runtime makes kicad-cli report lib_symbol_issues for
// libraries it already has under /app/extensions. Node still reads those
// directories to embed symbols; only the CLI child drops them.
const MAX_FLATPAK_WRAPPER_BYTES = 64 * 1024;
const KICAD_DIRECTORY_ENV = /^KICAD\d*(?:_[A-Z0-9]+)+_DIR$/;

export function kicadCliChildEnv(cliPath, baseEnv, io) {
  const env = { ...baseEnv };
  if (!flatpakKicadWrapper(cliPath, io)) return env;
  const flatpakDir = `${path.sep}flatpak${path.sep}`;
  for (const key of Object.keys(env)) {
    const value = env[key];
    if (KICAD_DIRECTORY_ENV.test(key) && typeof value === 'string' && value.includes(flatpakDir)) {
      delete env[key];
    }
  }
  return env;
}

function stripShellComment(line) {
  if (/^\s*#!/.test(line)) return line;
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === '\\' && quote === '"') {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === '\'') {
      quote = char;
      continue;
    }
    if (char === '#') return line.slice(0, index);
  }
  return line;
}

function scriptUsesFlatpakKicad(text) {
  const code = String(text).split(/\r?\n/).map((line) => stripShellComment(line)).join('\n');
  return code.includes('flatpak run') && code.includes('kicad-cli');
}

function closeQuietly(closeSync, fd) {
  try {
    closeSync(fd);
  } catch (error) {
    return error;
  }
  return undefined;
}

// Shell wrappers are small and start with a shebang. Do not slurp a kicad-cli binary.
function readWrapperScript(cliPath, io = {}) {
  const statSync = io.statSync ?? fs.statSync;
  const openSync = io.openSync ?? fs.openSync;
  const readSync = io.readSync ?? fs.readSync;
  const closeSync = io.closeSync ?? fs.closeSync;
  const stat = statSync(cliPath);
  if (!stat?.isFile?.() || stat.size > MAX_FLATPAK_WRAPPER_BYTES || stat.size < 2) return null;
  const fd = openSync(cliPath, 'r');
  try {
    const header = Buffer.alloc(2);
    const headerBytes = readSync(fd, header, 0, 2, 0);
    if (headerBytes < 2 || header.toString('utf8', 0, headerBytes) !== '#!') return null;
    const body = Buffer.alloc(stat.size);
    const bodyBytes = readSync(fd, body, 0, stat.size, 0);
    return body.toString('utf8', 0, bodyBytes);
  } finally {
    closeQuietly(closeSync, fd);
  }
}

export function flatpakKicadWrapper(cliPath, io = {}) {
  if ((io.platform ?? process.platform) === 'win32') return false;
  try {
    const text = readWrapperScript(cliPath, io);
    return text != null && scriptUsesFlatpakKicad(text);
  } catch {
    return false;
  }
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
