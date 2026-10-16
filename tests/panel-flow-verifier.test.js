import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  findInstalledSymbolLibraryDirectory,
  UNCONFIGURED_SYMBOL_LIBRARY_MESSAGE,
  unconfiguredSymbolLibraryError
} from '../src/kicad/project-generator.js';
import { FIXTURE_LIBS, restoreProcessEnv } from './helpers/kicad-library-env.js';

const execFileAsync = promisify(execFile);

function childEnvWithFixtureSymbols() {
  const env = { ...process.env, KICAD_SYMBOL_DIR: FIXTURE_LIBS.symbols };
  delete env.KICAD10_SYMBOL_DIR;
  delete env.FORCE_COLOR;
  return env;
}

function childEnvWithoutSymbolDirs(librarySearchRoot) {
  const env = { ...process.env };
  delete env.KICAD_SYMBOL_DIR;
  delete env.KICAD10_SYMBOL_DIR;
  delete env.FORCE_COLOR;
  env.CHATPCB_KICAD_LIBRARY_SEARCH_ROOTS = librarySearchRoot;
  return env;
}

test('panel user-flow verification script is exposed through npm', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));

  assert.equal(packageJson.scripts['verify:panel'], 'node ./scripts/verify-panel-flow.js');
});

test('panel user-flow verifier completes the daemon websocket project request', async () => {
  const { stdout } = await execFileAsync(process.execPath, ['./scripts/verify-panel-flow.js'], {
    timeout: 60_000,
    env: { ...childEnvWithFixtureSymbols(), CHATPCB_FAKE_KICAD_ERC: '1' }
  });
  const result = JSON.parse(stdout);

  assert.equal(result.ok, true);
  assert.equal(result.service, 'chatpcb-agentd');
  assert.equal(result.verified, 'named project.create and project.request websocket flow');
  assert.equal(result.displayName, '가스 센서 보드 01');
  assert.equal(result.operation, 'generated');
  assert.match(result.project, /\.kicad_pro$/);
  assert.equal(typeof result.erc.errorCount, 'number');
  assert.equal(typeof result.reviewStatus, 'string');
  assert.equal('dirtyHost' in result, false);
});

test('panel user-flow verifier exits before running when no symbol library is configured', async () => {
  const librarySearchRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-no-symbol-libs-'));

  try {
    await assert.rejects(
      () => execFileAsync(process.execPath, ['./scripts/verify-panel-flow.js'], {
        timeout: 60_000,
        env: childEnvWithoutSymbolDirs(librarySearchRoot)
      }),
      (error) => {
        assert.equal(error.code, 1);
        assert.equal(error.stdout, '');
        assert.equal(error.stderr.trim(), UNCONFIGURED_SYMBOL_LIBRARY_MESSAGE);
        return true;
      }
    );
  } finally {
    await rm(librarySearchRoot, { force: true, recursive: true });
  }
});

test('symbol library startup error names the env var and the offline fixture', () => {
  assert.match(UNCONFIGURED_SYMBOL_LIBRARY_MESSAGE, /KICAD_SYMBOL_DIR=\/path\/to\/kicad\/symbols/);
  assert.match(UNCONFIGURED_SYMBOL_LIBRARY_MESSAGE, /KICAD10_SYMBOL_DIR/);
  assert.match(UNCONFIGURED_SYMBOL_LIBRARY_MESSAGE, /tests\/fixtures\/kicad-libraries\/symbols/);
  assert.match(UNCONFIGURED_SYMBOL_LIBRARY_MESSAGE, /offline checks/);
  assert.equal(unconfiguredSymbolLibraryError({ KICAD_SYMBOL_DIR: FIXTURE_LIBS.symbols }), null);
  assert.equal(unconfiguredSymbolLibraryError({ KICAD10_SYMBOL_DIR: FIXTURE_LIBS.symbols }), null);
  assert.equal(
    unconfiguredSymbolLibraryError({ KICAD_SYMBOL_DIR: '', KICAD10_SYMBOL_DIR: '' }),
    unconfiguredSymbolLibraryError({})
  );
});

test('installed symbol library lookup ignores KICAD_SYMBOL_DIR', () => {
  const missing = path.join(tmpdir(), 'missing-chatpcb-symbols');
  const previousSymbol = process.env.KICAD_SYMBOL_DIR;
  const previousSymbol10 = process.env.KICAD10_SYMBOL_DIR;
  process.env.KICAD_SYMBOL_DIR = missing;
  process.env.KICAD10_SYMBOL_DIR = `${missing}-10`;

  try {
    const found = findInstalledSymbolLibraryDirectory();
    assert.notEqual(found, process.env.KICAD_SYMBOL_DIR);
    assert.notEqual(found, process.env.KICAD10_SYMBOL_DIR);
  } finally {
    restoreProcessEnv('KICAD_SYMBOL_DIR', previousSymbol);
    restoreProcessEnv('KICAD10_SYMBOL_DIR', previousSymbol10);
  }
});
