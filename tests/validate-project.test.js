import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateProject } from '../src/workflow/validate-project.js';

test('validateProject passes absolute schematic and report paths to kicad-cli', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-validate-'));
  await writeFile(path.join(root, 'demo.kicad_sch'), '(kicad_sch)\n', 'utf8');

  try {
    const calls = [];
    const result = await validateProject({
      projectDir: root,
      runKicadCliImpl: async (args, options) => {
        calls.push({ args, options });
        return {
          exitCode: 0,
          stdout: '',
          stderr: '',
          command: 'fake-kicad-cli',
          source: 'test'
        };
      }
    });

    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(path.isAbsolute(calls[0].args.at(-1)), true);
    assert.equal(path.isAbsolute(calls[0].args[calls[0].args.indexOf('--output') + 1]), true);
    assert.equal(calls[0].options.cwd, root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('validateProject fails when KiCad ERC report contains errors', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-validate-errors-'));
  await writeFile(path.join(root, 'demo.kicad_sch'), '(kicad_sch)\n', 'utf8');

  try {
    const result = await validateProject({
      projectDir: root,
      runKicadCliImpl: async (args) => {
        const reportPath = args[args.indexOf('--output') + 1];
        await writeFile(
          reportPath,
          JSON.stringify({
            sheets: [
              {
                violations: [
                  { severity: 'warning', type: 'lib_symbol_issues' },
                  { severity: 'error', type: 'pin_not_connected' }
                ]
              }
            ]
          }),
          'utf8'
        );
        return { exitCode: 0, stdout: '', stderr: '', command: 'fake-kicad-cli', source: 'test' };
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.erc.errorCount, 1);
    assert.equal(result.erc.warningCount, 1);
    assert.deepEqual(result.erc.byType, {
      lib_symbol_issues: 1,
      pin_not_connected: 1
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('validateProject keeps warning-only KiCad ERC reports successful but visible', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-validate-warnings-'));
  await writeFile(path.join(root, 'demo.kicad_sch'), '(kicad_sch)\n', 'utf8');

  try {
    const result = await validateProject({
      projectDir: root,
      runKicadCliImpl: async (args) => {
        const reportPath = args[args.indexOf('--output') + 1];
        await writeFile(
          reportPath,
          JSON.stringify({
            sheets: [
              {
                violations: [
                  { severity: 'warning', type: 'lib_symbol_issues' },
                  { severity: 'warning', type: 'lib_symbol_issues' }
                ]
              }
            ]
          }),
          'utf8'
        );
        return { exitCode: 0, stdout: '', stderr: '', command: 'fake-kicad-cli', source: 'test' };
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.erc.errorCount, 0);
    assert.equal(result.erc.warningCount, 2);
    assert.deepEqual(result.erc.byType, {
      lib_symbol_issues: 2
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
