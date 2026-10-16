import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { cliIsFlatpakKicad } from '../src/kicad/flatpak.js';
import { kicadCliChildEnv, resolveKicadCli, runCommand, runKicadCli } from '../src/kicad/kicad-cli.js';

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

const FLATPAK_LIBRARY = path.join(path.sep, 'var', 'lib', 'flatpak', 'app', 'org.kicad.KiCad', 'current', 'active', 'files', 'share', 'kicad');
const NATIVE_LIBRARY = path.join(path.sep, 'usr', 'share', 'kicad');
const FLATPAK_SCRIPT = '#!/bin/sh\nexec flatpak run --command=kicad-cli org.kicad.KiCad "$@"\n';
const NATIVE_SCRIPT = '#!/bin/sh\nexec /usr/bin/kicad-cli "$@"\n';
const COMMENT_SCRIPT = '#!/bin/sh\n# previously: flatpak run --command=kicad-cli org.kicad.KiCad\nexec /usr/bin/kicad-cli "$@"\n';
const TRAILING_COMMENT_SCRIPT = '#!/bin/sh\nexec /usr/bin/kicad-cli "$@" # flatpak run --command=kicad-cli org.kicad.KiCad\n';

function libraryEnv() {
  return {
    KICAD_SYMBOL_DIR: path.join(NATIVE_LIBRARY, 'symbols'),
    KICAD10_SYMBOL_DIR: path.join(FLATPAK_LIBRARY, 'symbols'),
    KICAD10_FOOTPRINT_DIR: path.join(FLATPAK_LIBRARY, 'footprints'),
    KICAD9_SYMBOL_DIR: path.join(FLATPAK_LIBRARY, 'symbols'),
    KICAD8_FOOTPRINT_DIR: path.join(FLATPAK_LIBRARY, 'footprints'),
    KICAD7_3DMODEL_DIR: path.join(FLATPAK_LIBRARY, '3dmodels'),
    KICAD_3DMODEL_DIR: path.join(FLATPAK_LIBRARY, '3dmodels'),
    KICAD6_SYMBOL_DIR: path.join(FLATPAK_LIBRARY, 'symbols'),
    KICAD_TEMPLATE_DIR: path.join(FLATPAK_LIBRARY, 'template'),
    KICAD_USER_TEMPLATE_DIR: path.join(FLATPAK_LIBRARY, 'template'),
    KICAD_FOOTPRINT_DIR: path.join(NATIVE_LIBRARY, 'footprints'),
    KICAD11_SYMBOL_DIR: path.join(path.sep, 'opt', 'flatpak-kicad', 'symbols'),
    KICAD_CLI_PATH: path.join(FLATPAK_LIBRARY, 'bin', 'kicad-cli'),
    CUSTOM_FLATPAK: path.join(FLATPAK_LIBRARY, 'symbols'),
    PATH: path.join(path.sep, 'usr', 'bin')
  };
}

function spyFsReads() {
  const events = [];
  const original = {
    readFileSync: fs.readFileSync,
    openSync: fs.openSync,
    readSync: fs.readSync,
    statSync: fs.statSync
  };
  fs.readFileSync = (...args) => {
    events.push({ op: 'readFileSync', path: args[0] });
    return original.readFileSync(...args);
  };
  fs.openSync = (...args) => {
    events.push({ op: 'openSync', path: args[0] });
    return original.openSync(...args);
  };
  fs.readSync = (fd, buffer, offset, length, position) => {
    events.push({ op: 'readSync', length, position: position ?? null });
    return original.readSync(fd, buffer, offset, length, position);
  };
  fs.statSync = (...args) => {
    events.push({ op: 'statSync', path: args[0] });
    return original.statSync(...args);
  };
  return {
    events,
    restore() {
      fs.readFileSync = original.readFileSync;
      fs.openSync = original.openSync;
      fs.readSync = original.readSync;
      fs.statSync = original.statSync;
    }
  };
}

function assertFlatpakDirsStripped(env, child) {
  for (const key of [
    'KICAD10_SYMBOL_DIR',
    'KICAD10_FOOTPRINT_DIR',
    'KICAD9_SYMBOL_DIR',
    'KICAD8_FOOTPRINT_DIR',
    'KICAD7_3DMODEL_DIR',
    'KICAD_3DMODEL_DIR',
    'KICAD6_SYMBOL_DIR',
    'KICAD_TEMPLATE_DIR',
    'KICAD_USER_TEMPLATE_DIR'
  ]) {
    assert.equal(Object.hasOwn(child, key), false, key);
  }
  assert.equal(child.KICAD_SYMBOL_DIR, env.KICAD_SYMBOL_DIR);
  assert.equal(child.KICAD_FOOTPRINT_DIR, env.KICAD_FOOTPRINT_DIR);
  assert.equal(child.KICAD11_SYMBOL_DIR, env.KICAD11_SYMBOL_DIR);
  assert.equal(child.KICAD_CLI_PATH, env.KICAD_CLI_PATH);
  assert.equal(child.CUSTOM_FLATPAK, env.CUSTOM_FLATPAK);
  assert.equal(child.PATH, env.PATH);
}

test('flatpak wrapper detection does not read binary or oversized kicad-cli files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatpcb-kicad-cli-'));
  const largePath = path.join(root, 'kicad-cli-large');
  const binaryPath = path.join(root, 'kicad-cli-binary');
  const scriptPath = path.join(root, 'kicad-cli-script');
  const largeBody = Buffer.concat([
    Buffer.from(FLATPAK_SCRIPT),
    Buffer.alloc(64 * 1024 + 1 - Buffer.byteLength(FLATPAK_SCRIPT), 0x20)
  ]);
  const binary = Buffer.alloc(4096, 0);
  binary[0] = 0x7f;
  binary[1] = 0x45;
  binary[2] = 0x4c;
  binary[3] = 0x46;
  Buffer.from('flatpak run --command=kicad-cli').copy(binary, 128);
  try {
    fs.writeFileSync(largePath, largeBody);
    fs.writeFileSync(binaryPath, binary);
    fs.writeFileSync(scriptPath, FLATPAK_SCRIPT, { mode: 0o755 });
    assert.equal(largeBody.length, 64 * 1024 + 1);

    const largeSpy = spyFsReads();
    try {
      assert.equal(cliIsFlatpakKicad(largePath, { platform: 'linux', env: {} }), false);
      assert.equal(largeSpy.events.some((event) => event.op === 'readFileSync'), false);
      assert.equal(largeSpy.events.some((event) => event.op === 'openSync'), false);
      assert.equal(largeSpy.events.some((event) => event.op === 'readSync'), false);
    } finally {
      largeSpy.restore();
    }

    const binarySpy = spyFsReads();
    try {
      assert.equal(cliIsFlatpakKicad(binaryPath, { platform: 'linux', env: {} }), false);
      assert.equal(binarySpy.events.some((event) => event.op === 'readFileSync'), false);
      const readBytes = binarySpy.events
        .filter((event) => event.op === 'readSync')
        .reduce((sum, event) => sum + event.length, 0);
      assert.ok(readBytes > 0 && readBytes <= 64, `binary peek read ${readBytes} bytes`);
      assert.ok(readBytes < binary.length);
    } finally {
      binarySpy.restore();
    }

    const winSpy = spyFsReads();
    try {
      assert.equal(cliIsFlatpakKicad(scriptPath, { platform: 'win32', env: {} }), false);
      assert.equal(winSpy.events.length, 0);
      const env = libraryEnv();
      const child = kicadCliChildEnv(env, { flatpak: false });
      assert.deepEqual(child, env);
    } finally {
      winSpy.restore();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('flatpak run mentioned only in comments does not strip KiCad directory env', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatpcb-kicad-cli-comment-'));
  const commentPath = path.join(root, 'kicad-cli');
  const trailingPath = path.join(root, 'kicad-cli-trailing');
  try {
    fs.writeFileSync(commentPath, COMMENT_SCRIPT, { mode: 0o755 });
    fs.writeFileSync(trailingPath, TRAILING_COMMENT_SCRIPT, { mode: 0o755 });
    assert.equal(cliIsFlatpakKicad(commentPath, { platform: 'linux', env: {} }), false);
    assert.equal(cliIsFlatpakKicad(trailingPath, { platform: 'linux', env: {} }), false);
    const env = libraryEnv();
    assert.deepEqual(kicadCliChildEnv(env, { flatpak: false }), env);
    const resolved = resolveKicadCli({
      env: { KICAD_CLI_PATH: commentPath, PATH: '' },
      platform: 'linux',
      exists: (candidate) => candidate === commentPath
    });
    assert.deepEqual(resolved, { path: commentPath, source: 'env' });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generic KICAD directory env is stripped only for flatpak paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatpcb-kicad-cli-env-'));
  const flatpakPath = path.join(root, 'kicad-cli-flatpak');
  const nativePath = path.join(root, 'kicad-cli-native');
  try {
    fs.writeFileSync(flatpakPath, FLATPAK_SCRIPT, { mode: 0o755 });
    fs.writeFileSync(nativePath, NATIVE_SCRIPT, { mode: 0o755 });
    assert.equal(cliIsFlatpakKicad(flatpakPath, { platform: 'linux', env: {} }), true);
    const env = libraryEnv();
    assertFlatpakDirsStripped(env, kicadCliChildEnv(env, { flatpak: true }));
    assert.deepEqual(env, libraryEnv());
    const resolved = resolveKicadCli({
      env: { KICAD_CLI_PATH: flatpakPath, PATH: '' },
      platform: 'linux',
      exists: (candidate) => candidate === flatpakPath
    });
    assert.deepEqual(resolved, { path: flatpakPath, source: 'flatpak' });

    assert.equal(cliIsFlatpakKicad(nativePath, { platform: 'linux', env: {} }), false);
    const nativeChild = kicadCliChildEnv(env, { flatpak: false });
    assert.deepEqual(nativeChild, env);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('kicadCliChildEnv is pure and does not read the filesystem', () => {
  const spy = spyFsReads();
  try {
    const env = libraryEnv();
    const stripped = kicadCliChildEnv(env, { flatpak: true });
    assertFlatpakDirsStripped(env, stripped);
    assert.deepEqual(env, libraryEnv());
    assert.notEqual(stripped, env);
    stripped.PATH = 'changed';
    assert.equal(env.PATH, libraryEnv().PATH);
    assert.deepEqual(kicadCliChildEnv(env, { flatpak: false }), env);
    assert.equal(spy.events.length, 0);
  } finally {
    spy.restore();
  }
});

test('flatpak detection uses an explicit signal and does not sniff path or basename matches', () => {
  const exportPath = path.join(path.sep, 'var', 'lib', 'flatpak', 'exports', 'bin', 'org.kicad.KiCad');
  const namedPath = path.join(path.sep, 'usr', 'bin', 'org.kicad.KiCad');
  const nearPath = path.join(path.sep, 'opt', 'flatpak-kicad', 'bin', 'kicad-cli');
  const spy = spyFsReads();
  try {
    assert.equal(cliIsFlatpakKicad(exportPath, { platform: 'linux', env: {} }), true);
    assert.equal(cliIsFlatpakKicad(namedPath, { platform: 'linux', env: {} }), true);
    assert.equal(cliIsFlatpakKicad(nearPath, { platform: 'linux', env: {} }), false);
    assert.equal(spy.events.some((event) => event.op === 'readSync' || event.op === 'openSync' || event.op === 'readFileSync'), false);

    const forced = resolveKicadCli({
      env: { KICAD_CLI_FLATPAK: '1', KICAD_CLI_PATH: '/usr/local/bin/kicad-cli', PATH: '' },
      platform: 'linux',
      exists: (candidate) => candidate === '/usr/local/bin/kicad-cli'
    });
    assert.deepEqual(forced, { path: '/usr/local/bin/kicad-cli', source: 'flatpak' });

    const unavailable = resolveKicadCli({
      env: { KICAD_CLI_FLATPAK: '1', PATH: '' },
      platform: 'linux',
      exists: () => false
    });
    assert.deepEqual(unavailable, { path: null, source: 'unavailable' });

    const windows = resolveKicadCli({
      env: { KICAD_CLI_FLATPAK: '1', PATH: '' },
      platform: 'win32',
      exists: (candidate) => candidate.includes('KiCad/10.0/bin/kicad-cli.exe')
    });
    assert.equal(windows.source, 'flatpak');
    assert.match(windows.path, /kicad-cli\.exe$/);
  } finally {
    spy.restore();
  }
});

test('runKicadCli drops flatpak KiCad directory env when KICAD_CLI_FLATPAK=1', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatpcb-kicad-cli-run-'));
  const scriptPath = path.join(root, 'kicad-cli');
  try {
    fs.writeFileSync(scriptPath, '#!/bin/sh\nprintf %s "${KICAD10_SYMBOL_DIR-unset}"\n', { mode: 0o755 });
    const result = await runKicadCli([], {
      env: {
        KICAD_CLI_PATH: scriptPath,
        KICAD_CLI_FLATPAK: '1',
        KICAD10_SYMBOL_DIR: path.join(path.sep, 'var', 'lib', 'flatpak', 'runtime', 'symbols'),
        KICAD_SYMBOL_DIR: path.join(path.sep, 'usr', 'share', 'kicad', 'symbols'),
        PATH: process.env.PATH ?? ''
      }
    });
    assert.equal(result.source, 'flatpak');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, 'unset');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('KiCad command timeout reports a typed failure after terminating the process', async () => {
  await assert.rejects(runCommand(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);'],
    { timeoutMs: 200 }), { code: 'KICAD_CLI_TIMEOUT' });
  const normal = await runCommand(process.execPath, ['-e', 'process.stdout.write("normal");']);
  assert.equal(normal.exitCode, 0);
  assert.equal(normal.stdout, 'normal');
});
