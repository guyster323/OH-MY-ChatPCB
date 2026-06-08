import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveKicadCli } from '../src/kicad/kicad-cli.js';

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

test('returns PATH command when no concrete install is found', () => {
  const found = resolveKicadCli({
    env: {},
    platform: 'linux',
    exists: () => false
  });

  assert.deepEqual(found, { path: 'kicad-cli', source: 'path' });
});
