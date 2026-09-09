import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const WINDOWS_CANDIDATES = [
  'C:/Program Files/KiCad/10.0/bin/kicad-cli.exe',
  'C:/Program Files/KiCad/9.0/bin/kicad-cli.exe',
  'C:/Program Files/KiCad/8.0/bin/kicad-cli.exe',
  'C:/Program Files/KiCad/7.0/bin/kicad-cli.exe'
];

export function resolveKicadCli({
  explicitPath,
  env = process.env,
  platform = process.platform,
  cwd = process.cwd(),
  exists = fs.existsSync,
  excludeProjectDir
} = {}) {
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
    timeoutMs: options.timeoutMs ?? 120000
  }).then((result) => ({ ...result, command: resolved.path, source: resolved.source }));
}

export function runCommand(command, args, { cwd = process.cwd(), timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
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
