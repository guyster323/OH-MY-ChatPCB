import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { cliIsFlatpakKicad, flatpakAppLibraryPaths, flatpakLibraryRoots, isFlatpakPath } from '../src/kicad/flatpak.js';
import { kicadCliChildEnv, resolveKicadCli, runCommand, runKicadCli } from '../src/kicad/kicad-cli.js';
import { findInstalledSymbolLibraryDirectory } from '../src/kicad/project-generator.js';
import { generateMcuPeripheralProject } from '../src/workflow/generate-mcu-project.js';

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

test('flatpak detection recognizes export layouts and the KiCad app id, and Windows ignores KICAD_CLI_FLATPAK', () => {
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
    assert.equal(windows.source, 'windows-install');
    assert.match(windows.path, /kicad-cli\.exe$/);
  } finally {
    spy.restore();
  }
});

test('flatpak path layouts, directory stripping, and KICAD_CLI_FLATPAK are table-driven', () => {
  const blindIo = {
    realpathSync() {
      throw new Error('blind');
    },
    statSync() {
      throw new Error('blind');
    },
    openSync() {
      throw new Error('blind');
    },
    readSync() {
      throw new Error('blind');
    },
    closeSync() {}
  };
  const flatpakCases = [
    ['/var/lib/flatpak/exports/bin/org.kicad.KiCad', true, true],
    ['/var/lib/flatpak/exports/bin/kicad-cli', true, true],
    ['/var/lib/flatpak/app/org.kicad.KiCad/current/active/files/bin/kicad-cli', true, true],
    ['/var/lib/flatpak/runtime/org.kicad.KiCad.Library.Symbols/x86_64/stable/active/files/bin/kicad-cli', true, true],
    ['/home/u/.local/share/flatpak/exports/bin/org.kicad.KiCad', true, true],
    ['/home/u/.local/share/flatpak/app/org.kicad.KiCad/current/active/files/bin/kicad-cli', true, true],
    ['/home/u/.local/share/flatpak/runtime/org.kicad.KiCad/x86_64/stable/active/files/bin/kicad-cli', true, true],
    ['/usr/bin/org.kicad.KiCad', true, false],
    ['/usr/local/bin/org.kicad.KiCad.exe', true, false],
    [String.raw`C:\Users\u\.local\share\flatpak\exports\bin\org.kicad.KiCad`, true, true],
    [String.raw`\var\lib\flatpak\app\org.kicad.KiCad\bin\kicad-cli`, true, true],
    ['/home/u/flatpak/kicad/bin/kicad-cli', false, false],
    ['/opt/flatpak-tools/bin/kicad-cli', false, false],
    ['/opt/flatpak-tools/kicad-cli', false, false],
    ['/opt/flatpak-kicad/bin/kicad-cli', false, false],
    ['/opt/flatpak/exports/bin/kicad-cli', false, false],
    ['/x/flatpak/t', false, false],
    ['/var/lib/flatpak', false, false],
    ['/var/lib/flatpak/repo/kicad-cli', false, false],
    ['/usr/share/kicad/bin/kicad-cli', false, false],
    ['/opt/org.kicad.KiCad/bin/kicad-cli', false, false],
    [String.raw`C:\Users\u\flatpak\kicad\bin\kicad-cli`, false, false]
  ];
  for (const [candidate, detected, strip] of flatpakCases) {
    assert.equal(isFlatpakPath(candidate), strip, `path ${candidate}`);
    assert.equal(
      cliIsFlatpakKicad(candidate, { platform: 'linux', env: {}, io: blindIo }),
      detected,
      candidate
    );
    const env = {
      KICAD10_SYMBOL_DIR: candidate,
      KICAD_SYMBOL_DIR: '/usr/share/kicad/symbols',
      PATH: '/usr/bin'
    };
    const child = kicadCliChildEnv(env, { flatpak: true });
    assert.equal(Object.hasOwn(child, 'KICAD10_SYMBOL_DIR'), !strip, `strip ${candidate}`);
    assert.equal(child.KICAD_SYMBOL_DIR, env.KICAD_SYMBOL_DIR, candidate);
    assert.equal(child.PATH, env.PATH, candidate);
    assert.deepEqual(kicadCliChildEnv(env, { flatpak: false }), env, candidate);
  }

  const native = '/opt/native/bin/kicad-cli';
  const wrapped = '/var/lib/flatpak/exports/bin/kicad-cli';
  const appId = '/usr/bin/org.kicad.KiCad';
  for (const value of ['1', 'true', 'TRUE', 'Yes', ' yes ', 'yes\n', 'on', 'ON', ' on ', 'on\n']) {
    assert.equal(cliIsFlatpakKicad(native, { platform: 'linux', env: { KICAD_CLI_FLATPAK: value }, io: blindIo }), true, value);
    const resolved = resolveKicadCli({
      env: { KICAD_CLI_FLATPAK: value, KICAD_CLI_PATH: native, PATH: '' },
      platform: 'linux',
      exists: (candidate) => candidate === native
    });
    assert.deepEqual(resolved, { path: native, source: 'flatpak' }, value);
  }
  for (const value of ['0', 'false', 'FALSE', 'No', 'no', 'off', 'OFF', ' off ', 'off\n']) {
    let reads = 0;
    const countingIo = {
      realpathSync() {
        reads += 1;
        throw new Error('blind');
      },
      statSync() {
        reads += 1;
        throw new Error('blind');
      },
      openSync() {
        reads += 1;
        throw new Error('blind');
      },
      readSync() {
        reads += 1;
        throw new Error('blind');
      },
      closeSync() {}
    };
    assert.equal(cliIsFlatpakKicad(wrapped, { platform: 'linux', env: { KICAD_CLI_FLATPAK: value }, io: countingIo }), false, value);
    assert.equal(cliIsFlatpakKicad(appId, { platform: 'linux', env: { KICAD_CLI_FLATPAK: value }, io: countingIo }), false, value);
    assert.equal(reads, 0, value);
    const resolved = resolveKicadCli({
      env: { KICAD_CLI_FLATPAK: value, KICAD_CLI_PATH: wrapped, PATH: '' },
      platform: 'linux',
      exists: (candidate) => candidate === wrapped
    });
    assert.deepEqual(resolved, { path: wrapped, source: 'env' }, value);
  }
  for (const value of ['2', 'maybe', '', 'trueish']) {
    assert.equal(cliIsFlatpakKicad(native, { platform: 'linux', env: { KICAD_CLI_FLATPAK: value }, io: blindIo }), false, value);
    assert.equal(cliIsFlatpakKicad(wrapped, { platform: 'linux', env: { KICAD_CLI_FLATPAK: value }, io: blindIo }), true, value);
    assert.equal(cliIsFlatpakKicad(appId, { platform: 'linux', env: { KICAD_CLI_FLATPAK: value }, io: blindIo }), true, value);
  }
  for (const value of ['1', 'true', 'yes', 'on', '0', 'false', 'no', 'off', 'maybe']) {
    assert.equal(cliIsFlatpakKicad(wrapped, { platform: 'win32', env: { KICAD_CLI_FLATPAK: value }, io: blindIo }), false, value);
    assert.equal(cliIsFlatpakKicad(appId, { platform: 'win32', env: { KICAD_CLI_FLATPAK: value }, io: blindIo }), false, value);
    const windows = resolveKicadCli({
      env: { KICAD_CLI_FLATPAK: value, PATH: '' },
      platform: 'win32',
      exists: (candidate) => candidate.includes('KiCad/10.0/bin/kicad-cli.exe')
    });
    assert.equal(windows.source, 'windows-install', value);
  }

  const missingHome = [{}, { HOME: '' }, { USERPROFILE: '' }, { HOME: '   ', USERPROFILE: '  ' }, { HOME: undefined, USERPROFILE: undefined }];
  for (const env of missingHome) {
    const roots = flatpakLibraryRoots({ platform: 'linux', env, mapPath: (candidate) => candidate });
    const apps = flatpakAppLibraryPaths('symbols', { platform: 'linux', env, mapPath: (candidate) => candidate });
    const text = [...roots, ...apps].join('\n');
    assert.equal(text.includes('undefined'), false, `${JSON.stringify(env)} ${text}`);
    assert.deepEqual(roots, ['/var/lib/flatpak'], JSON.stringify(env));
    assert.equal(apps.length, 1, JSON.stringify(env));
    assert.match(apps[0], /^\/var\/lib\/flatpak\/app\/org\.kicad\.KiCad\//, JSON.stringify(env));
  }
  const withHome = flatpakAppLibraryPaths('footprints', {
    platform: 'linux',
    env: { HOME: '/home/u', USERPROFILE: '/users/other' },
    mapPath: (candidate) => candidate
  });
  assert.ok(withHome.includes('/home/u/.local/share/flatpak/app/org.kicad.KiCad/current/active/files/share/kicad/footprints'));
  assert.equal(withHome.some((candidate) => candidate.includes('/users/other')), false);
  const withProfile = flatpakLibraryRoots({
    platform: 'linux',
    env: { USERPROFILE: '/users/u' },
    mapPath: (candidate) => candidate
  });
  assert.deepEqual(withProfile, ['/var/lib/flatpak', '/users/u/.local/share/flatpak']);
  assert.deepEqual(flatpakAppLibraryPaths('symbols', {
    platform: 'win32',
    env: { HOME: '/home/u', USERPROFILE: 'C:/Users/u' },
    mapPath: (candidate) => candidate
  }), []);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatpcb-kicad-flatpak-flag-'));
  const scriptPath = path.join(root, 'kicad-cli');
  try {
    fs.writeFileSync(scriptPath, FLATPAK_SCRIPT, { mode: 0o755 });
    const spy = spyFsReads();
    try {
      assert.equal(cliIsFlatpakKicad(scriptPath, { platform: 'linux', env: { KICAD_CLI_FLATPAK: 'no' } }), false);
      assert.equal(spy.events.length, 0);
    } finally {
      spy.restore();
    }
    assert.equal(cliIsFlatpakKicad(scriptPath, { platform: 'linux', env: { KICAD_CLI_FLATPAK: 'maybe' } }), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runKicadCli drops flatpak KiCad directory env when KICAD_CLI_FLATPAK=1', {
  skip: process.platform === 'win32' ? 'flatpak and /bin/sh scripts are POSIX-only' : false
}, async () => {
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

function writeConfigMarker(dir, marker) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'marker'), marker);
}

function configProbeScript(root) {
  const scriptPath = path.join(root, 'kicad-cli');
  fs.writeFileSync(scriptPath, [
    '#!/bin/sh',
    'printf "%s\\n" "${KICAD_CONFIG_HOME-unset}"',
    'if [ -f "${KICAD_CONFIG_HOME}/marker" ]; then cat "${KICAD_CONFIG_HOME}/marker"; fi',
    ''
  ].join('\n'), { mode: 0o755 });
  return scriptPath;
}

function privateConfigPath(stdout) {
  return stdout.split('\n')[0];
}

test('runKicadCli isolates each invocation in a private KICAD_CONFIG_HOME', {
  skip: process.platform === 'win32' ? 'POSIX shell script' : false
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatpcb-kicad-config-home-'));
  const cache = path.join(root, 'cache');
  const scriptPath = configProbeScript(root);
  try {
    const env = {
      KICAD_CLI_PATH: scriptPath,
      XDG_CACHE_HOME: cache,
      PATH: process.env.PATH ?? ''
    };
    const [first, second] = await Promise.all([
      runKicadCli(['--first'], { env }),
      runKicadCli(['--second'], { env })
    ]);
    assert.equal(first.exitCode, 0, first.stderr);
    assert.equal(second.exitCode, 0, second.stderr);
    const firstHome = privateConfigPath(first.stdout);
    const secondHome = privateConfigPath(second.stdout);
    assert.ok(firstHome.startsWith(path.join(cache, 'chatpcb', 'kicad-config-')), firstHome);
    assert.ok(secondHome.startsWith(path.join(cache, 'chatpcb', 'kicad-config-')), secondHome);
    assert.ok(firstHome.endsWith(`${path.sep}kicad`), firstHome);
    assert.notEqual(firstHome, secondHome);
    assert.equal(fs.existsSync(firstHome), false);
    assert.equal(fs.existsSync(secondHome), false);
    assert.equal(fs.existsSync(path.dirname(firstHome)), false);
    assert.equal(fs.existsSync(path.dirname(secondHome)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('private KiCad config is copied from KICAD_CONFIG_HOME, then the real platform home', {
  skip: process.platform === 'win32' ? 'POSIX shell script' : false
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatpcb-kicad-config-source-'));
  const cache = path.join(root, 'cache');
  const scriptPath = configProbeScript(root);
  const baseEnv = {
    KICAD_CLI_PATH: scriptPath,
    XDG_CACHE_HOME: cache,
    PATH: process.env.PATH ?? ''
  };
  try {
    const pinned = path.join(root, 'pinned-config');
    const home = path.join(root, 'home');
    writeConfigMarker(pinned, 'from-env\n');
    writeConfigMarker(path.join(home, '.config', 'kicad'), 'from-home\n');
    writeConfigMarker(path.join(home, '.var', 'app', 'org.kicad.KiCad', 'config', 'kicad'), 'from-flatpak\n');
    const pinnedResult = await runKicadCli([], {
      env: { ...baseEnv, HOME: home, KICAD_CONFIG_HOME: pinned }
    });
    assert.equal(pinnedResult.exitCode, 0, pinnedResult.stderr);
    const pinnedHome = privateConfigPath(pinnedResult.stdout);
    assert.ok(pinnedHome.startsWith(path.join(cache, 'chatpcb', 'kicad-config-')), pinnedHome);
    assert.notEqual(pinnedHome, pinned);
    assert.match(pinnedResult.stdout, /from-env/);
    assert.equal(pinnedResult.stdout.includes('from-home'), false);
    assert.equal(fs.existsSync(pinned), true);
    assert.equal(fs.existsSync(pinnedHome), false);

    const stale = path.join(cache, 'chatpcb', 'kicad-config-stale');
    writeConfigMarker(stale, 'from-stale\n');
    const ignored = await runKicadCli([], {
      env: { ...baseEnv, HOME: home, KICAD_CONFIG_HOME: stale },
      platform: 'linux'
    });
    assert.match(ignored.stdout, /from-home/);
    assert.equal(ignored.stdout.includes('from-stale'), false, ignored.stdout);
    assert.equal(fs.existsSync(stale), true);

    const legacy = path.join(root, 'chatpcb-kicad-config-legacy');
    writeConfigMarker(path.join(legacy, 'kicad'), 'from-legacy\n');
    const ignoredLegacy = await runKicadCli([], {
      env: { ...baseEnv, HOME: home, KICAD_CONFIG_HOME: path.join(legacy, 'kicad') },
      platform: 'linux'
    });
    assert.match(ignoredLegacy.stdout, /from-home/);
    assert.equal(ignoredLegacy.stdout.includes('from-legacy'), false, ignoredLegacy.stdout);

    const flatpakCli = await runKicadCli([], {
      env: { ...baseEnv, HOME: home, KICAD_CLI_FLATPAK: '1' },
      platform: 'linux'
    });
    assert.equal(flatpakCli.source, 'flatpak');
    assert.match(flatpakCli.stdout, /from-flatpak/);
    assert.equal(flatpakCli.stdout.includes('from-home'), false, flatpakCli.stdout);

    const nativeCli = await runKicadCli([], {
      env: { ...baseEnv, HOME: home },
      platform: 'linux'
    });
    assert.match(nativeCli.stdout, /from-home/);
    assert.equal(nativeCli.stdout.includes('from-flatpak'), false, nativeCli.stdout);

    const darwinHome = path.join(root, 'darwin-home');
    writeConfigMarker(path.join(darwinHome, 'Library', 'Preferences', 'kicad'), 'from-darwin\n');
    writeConfigMarker(path.join(darwinHome, '.config', 'kicad'), 'from-darwin-config\n');
    const darwin = await runKicadCli([], {
      env: { ...baseEnv, HOME: darwinHome },
      platform: 'darwin'
    });
    assert.match(darwin.stdout, /from-darwin/);
    assert.equal(darwin.stdout.includes('from-darwin-config'), false, darwin.stdout);

    const winHome = path.join(root, 'win-home');
    const appData = path.join(winHome, 'AppData', 'Roaming');
    writeConfigMarker(path.join(appData, 'kicad'), 'from-appdata\n');
    const windows = await runKicadCli([], {
      env: { ...baseEnv, HOME: winHome, APPDATA: appData },
      platform: 'win32'
    });
    assert.match(windows.stdout, /from-appdata/);

    const redirected = path.join(root, 'redirected-home');
    fs.mkdirSync(path.join(redirected, '.config', 'kicad'), { recursive: true });
    const realPin = path.join(root, 'real-kicad-config');
    writeConfigMarker(realPin, 'from-real-pin\n');
    const hooked = await runKicadCli([], {
      env: {
        ...baseEnv,
        HOME: redirected,
        XDG_CONFIG_HOME: path.join(redirected, '.config'),
        KICAD_CONFIG_HOME: realPin
      }
    });
    assert.match(hooked.stdout, /from-real-pin/);
    const hookedPath = privateConfigPath(hooked.stdout);
    assert.ok(hookedPath.startsWith(path.join(cache, 'chatpcb', 'kicad-config-')), hookedPath);
    assert.equal(hookedPath.startsWith(redirected), false, hookedPath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function modeProbeScript(root) {
  const scriptPath = path.join(root, 'mode-kicad-cli');
  // GNU stat -c is absent on macOS. Print the same octal bits Node uses, then
  // fall back to BSD stat when GNU stat rejects -c.
  const node = `'${process.execPath.replaceAll("'", "'\\''")}'`;
  const printMode = 'const fs=require("fs");const p=process.argv[1];process.stdout.write((fs.statSync(p).mode & 0o777).toString(8)+"\\n")';
  fs.writeFileSync(scriptPath, [
    '#!/bin/sh',
    'parent=$(dirname "$KICAD_CONFIG_HOME")',
    'base=$(dirname "$parent")',
    'printf "%s\\n" "$KICAD_CONFIG_HOME"',
    'print_mode() {',
    `  ${node} -e '${printMode}' "$1" || stat -c %a "$1" || stat -f %Lp "$1"`,
    '}',
    'print_mode "$parent"',
    'print_mode "$base"',
    ''
  ].join('\n'), { mode: 0o755 });
  return scriptPath;
}

test('private KiCad config cache follows the injected env, not the account home', {
  skip: process.platform === 'win32' ? 'POSIX shell script' : false
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatpcb-kicad-config-cache-'));
  const scriptPath = configProbeScript(root);
  const home = path.join(root, 'empty-home');
  const otherHome = path.join(root, 'other-home');
  const project = path.join(root, 'project');
  fs.mkdirSync(home);
  fs.mkdirSync(otherHome);
  fs.mkdirSync(project);
  const accountCache = path.join(os.userInfo().homedir, '.cache', 'chatpcb');
  try {
    const injected = await runKicadCli([], {
      env: {
        KICAD_CLI_PATH: scriptPath,
        HOME: home,
        PATH: process.env.PATH ?? ''
      },
      cwd: project
    });
    assert.equal(injected.exitCode, 0, injected.stderr);
    const injectedHome = privateConfigPath(injected.stdout);
    assert.ok(injectedHome.startsWith(path.join(home, '.cache', 'chatpcb', 'kicad-config-')), injectedHome);
    assert.ok(injectedHome.endsWith(`${path.sep}kicad`), injectedHome);
    assert.equal(injectedHome.startsWith(accountCache), false, injectedHome);
    assert.equal(fs.existsSync(injectedHome), false);

    const cache = path.join(root, 'xdg-cache');
    const absolute = await runKicadCli([], {
      env: {
        KICAD_CLI_PATH: scriptPath,
        XDG_CACHE_HOME: cache,
        HOME: home,
        PATH: process.env.PATH ?? ''
      }
    });
    const absoluteHome = privateConfigPath(absolute.stdout);
    assert.ok(absoluteHome.startsWith(path.join(cache, 'chatpcb', 'kicad-config-')), absoluteHome);
    assert.equal(absoluteHome.startsWith(home), false, absoluteHome);

    const relative = await runKicadCli([], {
      env: {
        KICAD_CLI_PATH: scriptPath,
        XDG_CACHE_HOME: 'rel-cache',
        HOME: home,
        PATH: process.env.PATH ?? ''
      },
      cwd: project
    });
    const relativeHome = privateConfigPath(relative.stdout);
    assert.ok(relativeHome.startsWith(path.join(home, '.cache', 'chatpcb', 'kicad-config-')), relativeHome);
    assert.equal(fs.existsSync(path.join(project, 'rel-cache')), false);

    const projectFallback = await runKicadCli([], {
      env: {
        KICAD_CLI_PATH: scriptPath,
        XDG_CACHE_HOME: 'rel-cache',
        PATH: process.env.PATH ?? ''
      },
      cwd: project
    });
    const projectHome = privateConfigPath(projectFallback.stdout);
    assert.ok(projectHome.startsWith(path.join(project, '.chatpcb', 'kicad-config-')), projectHome);
    assert.equal(projectHome.startsWith(accountCache), false, projectHome);

    const profile = path.join(root, 'win-profile');
    fs.mkdirSync(profile);
    const windows = await runKicadCli([], {
      env: {
        KICAD_CLI_PATH: scriptPath,
        USERPROFILE: profile,
        HOME: otherHome,
        PATH: process.env.PATH ?? ''
      },
      platform: 'win32',
      cwd: project
    });
    const windowsHome = privateConfigPath(windows.stdout);
    assert.ok(windowsHome.startsWith(path.join(profile, '.cache', 'chatpcb', 'kicad-config-')), windowsHome);
    assert.equal(windowsHome.startsWith(otherHome), false, windowsHome);
    assert.equal(windowsHome.startsWith(accountCache), false, windowsHome);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function cacheEnvProbeScript(root) {
  const scriptPath = path.join(root, 'cache-env-kicad-cli');
  fs.writeFileSync(scriptPath, [
    '#!/bin/sh',
    'printf "XDG=%s\\n" "${XDG_CACHE_HOME-unset}"',
    'printf "CFG=%s\\n" "${KICAD_CONFIG_HOME-unset}"',
    ''
  ].join('\n'), { mode: 0o755 });
  return scriptPath;
}

function probeField(stdout, name) {
  const line = stdout.split('\n').find((item) => item.startsWith(`${name}=`));
  assert.ok(line, stdout);
  return line.slice(name.length + 1);
}

test('relative or blank XDG_CACHE_HOME falls back to HOME/.cache and is not passed to kicad-cli', {
  skip: process.platform === 'win32' ? 'POSIX shell script' : false
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatpcb-kicad-cache-env-'));
  const scriptPath = cacheEnvProbeScript(root);
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  const absoluteCache = path.join(root, 'absolute-cache');
  fs.mkdirSync(home);
  fs.mkdirSync(project);
  const fallback = path.join(home, '.cache');
  try {
    for (const xdg of ['rel-cache', 'rel/cache', '', '   ', './rel-cache']) {
      const result = await runKicadCli([], {
        env: {
          KICAD_CLI_PATH: scriptPath,
          XDG_CACHE_HOME: xdg,
          HOME: home,
          PATH: process.env.PATH ?? ''
        },
        cwd: project
      });
      assert.equal(result.exitCode, 0, result.stderr);
      const childXdg = probeField(result.stdout, 'XDG');
      const configHome = probeField(result.stdout, 'CFG');
      assert.equal(childXdg, fallback, `XDG_CACHE_HOME ${JSON.stringify(xdg)} -> ${JSON.stringify(childXdg)}`);
      assert.equal(path.isAbsolute(childXdg), true, childXdg);
      assert.ok(configHome.startsWith(path.join(fallback, 'chatpcb', 'kicad-config-')), configHome);
      assert.equal(fs.existsSync(path.join(project, 'rel-cache')), false);
      assert.equal(fs.existsSync(path.join(project, 'rel')), false);
    }

    const kept = await runKicadCli([], {
      env: {
        KICAD_CLI_PATH: scriptPath,
        XDG_CACHE_HOME: absoluteCache,
        HOME: home,
        PATH: process.env.PATH ?? ''
      },
      cwd: project
    });
    assert.equal(probeField(kept.stdout, 'XDG'), absoluteCache);
    assert.ok(probeField(kept.stdout, 'CFG').startsWith(path.join(absoluteCache, 'chatpcb', 'kicad-config-')));

    const noHome = await runKicadCli([], {
      env: {
        KICAD_CLI_PATH: scriptPath,
        XDG_CACHE_HOME: 'rel/cache',
        PATH: process.env.PATH ?? ''
      },
      cwd: project
    });
    assert.equal(noHome.exitCode, 0, noHome.stderr);
    assert.equal(probeField(noHome.stdout, 'XDG'), 'unset');
    assert.ok(probeField(noHome.stdout, 'CFG').startsWith(path.join(project, '.chatpcb', 'kicad-config-')));
    assert.equal(fs.existsSync(path.join(project, 'rel')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('private KiCad config directories are mode 0700, including an existing parent', {
  skip: process.platform === 'win32' ? 'POSIX modes' : false
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatpcb-kicad-config-mode-'));
  const scriptPath = modeProbeScript(root);
  const freshCache = path.join(root, 'fresh-cache');
  const existingCache = path.join(root, 'existing-cache');
  const existingBase = path.join(existingCache, 'chatpcb');
  fs.mkdirSync(existingBase, { recursive: true });
  fs.chmodSync(existingBase, 0o755);
  assert.equal(fs.statSync(existingBase).mode & 0o777, 0o755);
  try {
    const fresh = await runKicadCli([], {
      env: {
        KICAD_CLI_PATH: scriptPath,
        XDG_CACHE_HOME: freshCache,
        PATH: process.env.PATH ?? ''
      }
    });
    assert.equal(fresh.exitCode, 0, fresh.stderr);
    const [freshHome, freshCallMode, freshBaseMode] = fresh.stdout.trim().split('\n');
    assert.equal(freshCallMode, '700', fresh.stdout);
    assert.equal(freshBaseMode, '700', fresh.stdout);
    assert.equal(fs.statSync(path.join(freshCache, 'chatpcb')).mode & 0o777, 0o700);
    assert.equal(fs.existsSync(path.dirname(freshHome)), false);

    const existing = await runKicadCli([], {
      env: {
        KICAD_CLI_PATH: scriptPath,
        XDG_CACHE_HOME: existingCache,
        PATH: process.env.PATH ?? ''
      }
    });
    assert.equal(existing.exitCode, 0, existing.stderr);
    const [existingHome, existingCallMode, existingBaseMode] = existing.stdout.trim().split('\n');
    assert.equal(existingCallMode, '700', existing.stdout);
    assert.equal(existingBaseMode, '700', existing.stdout);
    assert.equal(fs.statSync(existingBase).mode & 0o777, 0o700);
    assert.equal(fs.existsSync(path.dirname(existingHome)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function ercCounts(reportPath) {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const violations = (report.sheets ?? []).flatMap((sheet) => sheet.violations ?? []);
  const byType = {};
  let errorCount = 0;
  let warningCount = 0;
  for (const violation of violations) {
    byType[violation.type] = (byType[violation.type] ?? 0) + 1;
    if (violation.severity === 'error') errorCount += 1;
    else if (violation.severity === 'warning') warningCount += 1;
  }
  return { errorCount, warningCount, byType };
}

function pathInside(root, candidate) {
  if (!root || !candidate) return false;
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (
    !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
  );
}

function flatpakChildEnv(configHome) {
  const env = { ...process.env, KICAD_CONFIG_HOME: configHome };
  // Stock flatpak mounts $HOME for filesystems=home. A test hook can point HOME
  // at a temp dir, which hides the account-home probe. Give the sandbox the
  // passwd home, where the probe and the copied config live.
  const home = realAccountHome();
  if (home) {
    env.HOME = home;
    env.USERPROFILE = home;
    const xdg = typeof env.XDG_CONFIG_HOME === 'string' ? env.XDG_CONFIG_HOME.trim() : '';
    if (xdg && !pathInside(home, xdg)) delete env.XDG_CONFIG_HOME;
  }
  for (const key of Object.keys(env)) {
    if (/^KICAD\d*(?:_[A-Z0-9]+)+_DIR$/.test(key)) delete env[key];
  }
  return env;
}

function directoryExists(candidate) {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

// os.homedir() follows HOME. A test hook can point that at an empty temp dir
// and pin the real KiCad config on KICAD_CONFIG_HOME. The passwd home is what
// the stock flatpak sandbox (filesystems=home) can see.
function realAccountHome() {
  try {
    const home = os.userInfo().homedir;
    if (typeof home === 'string' && home.trim()) return home.trim();
  } catch {
    // No passwd entry.
  }
  return null;
}

function stockFlatpakConfigDir() {
  const pinned = typeof process.env.KICAD_CONFIG_HOME === 'string'
    ? process.env.KICAD_CONFIG_HOME.trim()
    : '';
  if (pinned && directoryExists(pinned)) return pinned;
  const home = realAccountHome();
  if (!home) return null;
  const candidate = path.join(home, '.var', 'app', 'org.kicad.KiCad', 'config', 'kicad');
  return directoryExists(candidate) ? candidate : null;
}

function kicadCliIgnoringAmbientPath() {
  const env = { ...process.env };
  delete env.KICAD_CLI_PATH;
  return resolveKicadCli({ env });
}

function runStockFlatpakKicad(args, configHome) {
  return spawnSync('flatpak', ['run', '--command=kicad-cli', 'org.kicad.KiCad', ...args], {
    env: flatpakChildEnv(configHome),
    encoding: 'utf8',
    timeout: 90000
  });
}

test('stock flatpak KiCad reads a home-visible config and ignores an empty one', {
  timeout: 180000
}, async (t) => {
  const info = spawnSync('flatpak', ['info', '--show-permissions', 'org.kicad.KiCad'], { encoding: 'utf8' });
  if (info.status !== 0) {
    t.skip('flatpak KiCad is not installed');
    return;
  }
  assert.match(info.stdout, /filesystems=home/);
  assert.doesNotMatch(info.stdout, /filesystems=[^\n]*\/tmp/);
  const symbols = findInstalledSymbolLibraryDirectory();
  if (!symbols) {
    t.skip('real KiCad symbol library is not available');
    return;
  }
  const realConfig = stockFlatpakConfigDir();
  if (!realConfig) {
    t.skip('real KiCad config is not available');
    return;
  }
  const accountHome = realAccountHome();
  if (!accountHome) {
    t.skip('real account home is not available for a sandbox-visible KiCad probe');
    return;
  }
  const stockCli = kicadCliIgnoringAmbientPath();
  const ambientCli = typeof process.env.KICAD_CLI_PATH === 'string' ? process.env.KICAD_CLI_PATH.trim() : '';
  if (!stockCli.path && ambientCli) {
    t.skip(`ambient KICAD_CLI_PATH is a custom wrapper (${ambientCli}) and no stock kicad-cli is available`);
    return;
  }

  const visibleCache = path.join(accountHome, '.cache');
  fs.mkdirSync(visibleCache, { recursive: true });
  const root = fs.mkdtempSync(path.join(visibleCache, 'chatpcb-flatpak-probe-'));
  const previous = {
    KICAD_SYMBOL_DIR: process.env.KICAD_SYMBOL_DIR,
    KICAD10_SYMBOL_DIR: process.env.KICAD10_SYMBOL_DIR
  };
  process.env.KICAD_SYMBOL_DIR = symbols;
  process.env.KICAD10_SYMBOL_DIR = symbols;
  try {
    const projectDir = path.join(root, 'project');
    const generated = await generateMcuPeripheralProject({
      projectDir,
      prompt: 'red LED on 5V',
      projectName: 'discrete_led'
    });
    const schematic = generated.files.schematic;
    const fullCopy = path.join(root, 'real-config');
    const emptyConfig = path.join(root, 'empty-config');
    const emptyHome = path.join(root, 'empty-home');
    fs.cpSync(realConfig, fullCopy, { recursive: true });
    fs.mkdirSync(emptyConfig);
    fs.mkdirSync(path.join(emptyHome, '.var', 'app', 'org.kicad.KiCad', 'config', 'kicad'), { recursive: true });
    fs.mkdirSync(path.join(emptyHome, '.config', 'kicad'), { recursive: true });

    const markedCopy = path.join(root, 'marked-config');
    fs.cpSync(fullCopy, markedCopy, { recursive: true });
    const deviceLib = '(lib (name "Device") (type "KiCad") (uri "${KICAD10_SYMBOL_DIR}/Device.kicad_sym")';
    const missingLib = path.join(root, 'ChatpcbMarkerMissing.kicad_sym');
    const markedTable = path.join(markedCopy, '10.0', 'sym-lib-table');
    const table = fs.readFileSync(markedTable, 'utf8');
    assert.equal(table.includes(deviceLib), true);
    fs.writeFileSync(
      markedTable,
      table.replace(deviceLib, `(lib (name "Device") (type "KiCad") (uri "${missingLib}")`)
    );
    assert.equal(fs.existsSync(missingLib), false);

    const cache = path.join(root, 'cache');
    const hookedEnv = (configHome) => {
      const env = {
        ...process.env,
        HOME: emptyHome,
        USERPROFILE: emptyHome,
        XDG_CONFIG_HOME: path.join(emptyHome, '.config'),
        XDG_CACHE_HOME: cache,
        KICAD_CONFIG_HOME: configHome,
        PATH: process.env.PATH ?? ''
      };
      delete env.KICAD_SYMBOL_DIR;
      delete env.KICAD10_SYMBOL_DIR;
      delete env.KICAD_CLI_PATH;
      if (stockCli.path) env.KICAD_CLI_PATH = stockCli.path;
      return env;
    };
    const runHookedKicad = (args, configHome) => runKicadCli(args, {
      env: hookedEnv(configHome),
      explicitPath: stockCli.path || undefined,
      cwd: projectDir
    });
    const upgrade = await runHookedKicad(['sch', 'upgrade', '--force', schematic], fullCopy);
    assert.equal(upgrade.exitCode, 0, upgrade.stderr);
    const report = path.join(projectDir, 'hooked-erc.json');
    const erc = await runHookedKicad(
      ['sch', 'erc', '--format', 'json', '--output', report, schematic],
      fullCopy
    );
    const hookedCounts = ercCounts(report);
    const hookedDetail = `exitCode=${erc.exitCode} stderr=${JSON.stringify(erc.stderr ?? '')} ${JSON.stringify(hookedCounts)}`;
    assert.equal(erc.exitCode, 0, hookedDetail);
    assert.equal(hookedCounts.errorCount, 0, hookedDetail);
    assert.equal(hookedCounts.warningCount, 0, hookedDetail);

    const markedReport = path.join(projectDir, 'hooked-marked-erc.json');
    const marked = await runHookedKicad(
      ['sch', 'erc', '--format', 'json', '--output', markedReport, schematic],
      markedCopy
    );
    assert.equal(fs.existsSync(markedReport), true, `exitCode=${marked.exitCode} stderr=${JSON.stringify(marked.stderr ?? '')} ${marked.stdout}`);
    const markedCounts = ercCounts(markedReport);
    assert.ok(
      (markedCounts.byType.lib_symbol_issues ?? 0) > 0,
      `exitCode=${marked.exitCode} stderr=${JSON.stringify(marked.stderr ?? '')} ${JSON.stringify(markedCounts)}`
    );
    const cacheBase = path.join(cache, 'chatpcb');
    if (fs.existsSync(cacheBase)) {
      assert.deepEqual(fs.readdirSync(cacheBase).filter((name) => name.startsWith('kicad-config-')), []);
    }

    const stockReport = path.join(projectDir, 'stock-erc.json');
    const stock = runStockFlatpakKicad(
      ['sch', 'erc', '--format', 'json', '--output', stockReport, schematic],
      fullCopy
    );
    const stockDetail = `exitCode=${stock.status} stderr=${JSON.stringify(stock.stderr ?? '')} ${JSON.stringify(ercCounts(stockReport))}`;
    assert.equal(stock.status, 0, stockDetail);
    const stockCounts = ercCounts(stockReport);
    assert.equal(stockCounts.errorCount, 0, stockDetail);
    assert.equal(stockCounts.warningCount, 0, stockDetail);

    const stockMarkedReport = path.join(projectDir, 'stock-marked-erc.json');
    const stockMarked = runStockFlatpakKicad(
      ['sch', 'erc', '--format', 'json', '--output', stockMarkedReport, schematic],
      markedCopy
    );
    assert.equal(fs.existsSync(stockMarkedReport), true, `exitCode=${stockMarked.status} stderr=${JSON.stringify(stockMarked.stderr ?? '')} ${stockMarked.stdout}`);
    const stockMarkedCounts = ercCounts(stockMarkedReport);
    assert.ok(
      (stockMarkedCounts.byType.lib_symbol_issues ?? 0) > 0,
      `exitCode=${stockMarked.status} stderr=${JSON.stringify(stockMarked.stderr ?? '')} ${JSON.stringify(stockMarkedCounts)}`
    );

    const emptyReport = path.join(projectDir, 'empty-erc.json');
    const empty = runStockFlatpakKicad(
      ['sch', 'erc', '--format', 'json', '--output', emptyReport, schematic],
      emptyConfig
    );
    assert.equal(fs.existsSync(emptyReport), true, `exitCode=${empty.status} stderr=${JSON.stringify(empty.stderr ?? '')} ${empty.stdout}`);
    const emptyCounts = ercCounts(emptyReport);
    assert.ok(
      (emptyCounts.byType.lib_symbol_issues ?? 0) > 0 || emptyCounts.warningCount > 0,
      `exitCode=${empty.status} stderr=${JSON.stringify(empty.stderr ?? '')} ${JSON.stringify(emptyCounts)}`
    );
  } finally {
    if (previous.KICAD_SYMBOL_DIR == null) delete process.env.KICAD_SYMBOL_DIR;
    else process.env.KICAD_SYMBOL_DIR = previous.KICAD_SYMBOL_DIR;
    if (previous.KICAD10_SYMBOL_DIR == null) delete process.env.KICAD10_SYMBOL_DIR;
    else process.env.KICAD10_SYMBOL_DIR = previous.KICAD10_SYMBOL_DIR;
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
