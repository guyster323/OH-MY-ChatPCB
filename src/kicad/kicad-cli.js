import fs from 'node:fs';
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
  exists = fs.existsSync
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

  return { path: 'kicad-cli', source: 'path' };
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

export function runKicadCli(args, options = {}) {
  const resolved = resolveKicadCli(options);
  return runCommand(resolved.path, args, {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? 120000
  }).then((result) => ({ ...result, command: resolved.path, source: resolved.source }));
}

export function runCommand(command, args, { cwd = process.cwd(), timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`${command} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout: stdout.join(''),
        stderr: stderr.join('')
      });
    });
  });
}
