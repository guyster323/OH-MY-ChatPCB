import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { resolveKicadCli, runCommand } from '../src/kicad/kicad-cli.js';

test('resolves an explicit KiCad CLI path first', () => {
  const found = resolveKicadCli({
    explicitPath: 'C:/KiCad/bin/kicad-cli.exe',
    env: { KICAD_CLI_PATH: 'C:/Other/kicad-cli.exe' },
    platform: 'win32',
    exists: (candidate) => candidate === 'C:/KiCad/bin/kicad-cli.exe'
  });

  assert.equal(found.path, 'C:/KiCad/bin/kicad-cli.exe');
  assert.equal(found.source, 'explicit');
});

test('falls back to Windows KiCad install directories before PATH lookup', () => {
  const found = resolveKicadCli({
    env: {},
    platform: 'win32',
    exists: (candidate) => candidate.includes('KiCad/10.0/bin/kicad-cli.exe')
  });

  assert.equal(found.source, 'windows-install');
  assert.match(found.path, /KiCad\/10\.0\/bin\/kicad-cli\.exe$/);
});

test('prefers current-user KiCad 10 install before older all-users installs on Windows', () => {
  const found = resolveKicadCli({
    env: {
      LOCALAPPDATA: 'C:/Users/test/AppData/Local'
    },
    platform: 'win32',
    exists: (candidate) =>
      candidate === 'C:/Users/test/AppData/Local/Programs/KiCad/10.0/bin/kicad-cli.exe' ||
      candidate === 'C:/Program Files/KiCad/9.0/bin/kicad-cli.exe'
  });

  assert.equal(found.path, 'C:/Users/test/AppData/Local/Programs/KiCad/10.0/bin/kicad-cli.exe');
  assert.equal(found.source, 'windows-user-install');
});

test('CHATPCB_KICAD_CLI_DISABLE reports unavailable without falling back to install paths', () => {
  const found = resolveKicadCli({
    explicitPath: '/usr/local/bin/kicad-cli',
    env: {
      CHATPCB_KICAD_CLI_DISABLE: '1',
      KICAD_CLI_PATH: '/missing/kicad-cli',
      PATH: '/usr/local/bin:/usr/bin'
    },
    platform: 'linux',
    exists: () => true
  });

  assert.deepEqual(found, { path: null, source: 'unavailable' });
});

test('CHATPCB_KICAD_CLI_DISABLE warns once on stderr', () => {
  const moduleUrl = pathToFileURL(path.resolve('src/kicad/kicad-cli.js')).href;
  const script = `
    import { resolveKicadCli } from ${JSON.stringify(moduleUrl)};
    const options = {
      env: { CHATPCB_KICAD_CLI_DISABLE: '1', PATH: '' },
      platform: 'linux',
      exists: () => true
    };
    const first = resolveKicadCli(options);
    const second = resolveKicadCli(options);
    if (first.path !== null || second.source !== 'unavailable' || second.path !== null) {
      process.exit(2);
    }
  `;
  const env = { ...process.env };
  delete env.FORCE_COLOR;
  delete env.NO_COLOR;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr.trim(), 'kicad-cli disabled by CHATPCB_KICAD_CLI_DISABLE');
});

test('returns unavailable when no absolute KiCad installation can be found', () => {
  const found = resolveKicadCli({
    env: {},
    platform: 'linux',
    exists: () => false
  });

  assert.deepEqual(found, { path: null, source: 'unavailable' });
});

test('PATH lookup excludes relative and project working directories', () => {
  const found = resolveKicadCli({
    env: { PATH: '.;C:/project;relative;C:/tools' },
    platform: 'win32', cwd: 'C:/project',
    exists: (candidate) => ['C:\\project\\kicad-cli.exe', 'C:\\tools\\kicad-cli.exe'].includes(candidate)
  });
  assert.deepEqual(found, { path: 'C:\\tools\\kicad-cli.exe', source: 'path' });
});

test('absolute PATH lookup works on POSIX without passing a bare command to spawn', () => {
  const found = resolveKicadCli({
    env: { PATH: '.:/project:/opt/kicad/bin' },
    platform: 'linux', cwd: '/project',
    exists: (candidate) => ['/project/kicad-cli', '/opt/kicad/bin/kicad-cli'].includes(candidate)
  });
  assert.deepEqual(found, { path: '/opt/kicad/bin/kicad-cli', source: 'path' });
});

test('PATH lookup excludes the original project even when cwd is an inspection copy (posix)', () => {
  const found = resolveKicadCli({
    platform: 'linux',
    cwd: '/tmp/chatpcb-copy/project',
    env: { PATH: '/untrusted-project/bin:/trusted/bin' },
    excludeProjectDir: '/untrusted-project',
    exists: (candidate) => 
      candidate.endsWith('kicad-cli') && 
      !candidate.startsWith('/usr/') && 
      !candidate.startsWith('/usr/local/')
  });
  assert.deepEqual(found, { path: '/trusted/bin/kicad-cli', source: 'path' });
});

test('PATH lookup excludes the original project even when cwd is an inspection copy (win32)', () => {
  const found = resolveKicadCli({
    platform: 'win32',
    cwd: 'C:\\tmp\\chatpcb-copy\\project',
    env: { PATH: 'C:\\untrusted-project\\bin;C:\\trusted\\bin' },
    excludeProjectDir: 'C:\\untrusted-project',
    exists: (candidate) => [
      'C:\\untrusted-project\\bin\\kicad-cli.exe',
      'C:\\trusted\\bin\\kicad-cli.exe'
    ].includes(candidate)
  });
  assert.deepEqual(found, { path: 'C:\\trusted\\bin\\kicad-cli.exe', source: 'path' });
});

test('trusted explicitPath and KICAD_CLI_PATH still select inside an excluded project', () => {
  const explicit = resolveKicadCli({
    explicitPath: '/untrusted-project/bin/kicad-cli',
    platform: 'linux',
    cwd: '/tmp/chatpcb-copy/project',
    env: { PATH: '/trusted/bin' },
    excludeProjectDir: '/untrusted-project',
    exists: (candidate) => candidate === '/untrusted-project/bin/kicad-cli' || candidate === '/trusted/bin/kicad-cli'
  });
  assert.deepEqual(explicit, { path: '/untrusted-project/bin/kicad-cli', source: 'explicit' });

  const fromEnv = resolveKicadCli({
    platform: 'linux',
    cwd: '/tmp/chatpcb-copy/project',
    env: { KICAD_CLI_PATH: '/untrusted-project/bin/kicad-cli', PATH: '/trusted/bin' },
    excludeProjectDir: '/untrusted-project',
    exists: (candidate) => candidate === '/untrusted-project/bin/kicad-cli' || candidate === '/trusted/bin/kicad-cli'
  });
  assert.deepEqual(fromEnv, { path: '/untrusted-project/bin/kicad-cli', source: 'env' });
});

test('KiCad command timeout reports a typed failure after terminating the process', async () => {
  await assert.rejects(runCommand(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);'],
    { timeoutMs: 200 }), { code: 'KICAD_CLI_TIMEOUT' });
  const normal = await runCommand(process.execPath, ['-e', 'process.stdout.write("normal");']);
  assert.equal(normal.exitCode, 0);
  assert.equal(normal.stdout, 'normal');
});
