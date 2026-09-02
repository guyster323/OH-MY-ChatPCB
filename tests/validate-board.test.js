import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateBoard } from '../src/workflow/validate-board.js';

async function makeProject({ board = true } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-validate-board-'));
  if (board) {
    await writeFile(path.join(root, 'demo.kicad_pcb'), '(kicad_pcb)\n', 'utf8');
  }
  return root;
}

function successfulRunner(report) {
  return async (args, options) => {
    const reportPath = args[args.indexOf('--output') + 1];
    await writeFile(reportPath, JSON.stringify(report), 'utf8');
    return {
      exitCode: 0,
      stdout: 'DRC complete',
      stderr: '',
      command: 'fake-kicad-cli',
      source: 'test'
    };
  };
}

test('validateBoard runs refillable KiCad PCB DRC and parses a clean report', async () => {
  const root = await makeProject();
  const calls = [];

  try {
    const result = await validateBoard({
      projectDir: root,
      kicadCliPath: 'C:/KiCad/bin/kicad-cli.exe',
      runKicadCliImpl: async (args, options) => {
        calls.push({ args, options });
        return successfulRunner({ violations: [], unconnected_items: [] })(args, options);
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.skipped, false);
    assert.equal(result.drc.violationCount, 0);
    assert.equal(result.drc.unconnectedCount, 0);
    assert.deepEqual(result.drc.byType, {});
    assert.equal(path.isAbsolute(result.report), true);
    assert.deepEqual(calls[0].args.slice(0, 6), ['pcb', 'drc', '--refill-zones', '--format', 'json', '--output']);
    assert.equal(path.isAbsolute(calls[0].args.at(-1)), true);
    assert.equal(path.isAbsolute(calls[0].args[calls[0].args.indexOf('--output') + 1]), true);
    assert.equal(calls[0].options.cwd, root);
    assert.equal(calls[0].options.explicitPath, 'C:/KiCad/bin/kicad-cli.exe');
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('validateBoard fails when KiCad reports violations or unconnected items', async () => {
  const root = await makeProject();

  try {
    const result = await validateBoard({
      projectDir: root,
      runKicadCliImpl: successfulRunner({
        violations: [{ type: 'clearance', severity: 'error' }, { type: 'clearance', severity: 'warning' }],
        unconnected_items: [
          {
            type: 'unconnected_items',
            items: [
              { description: 'Pad A4 [VBUS] on J4 F.Cu' },
              { description: 'Pad 1 [VBUS] on C3 F.Cu' }
            ]
          },
          {
            type: 'unconnected_items',
            items: [
              { description: 'Pad 1 [+3V3] on R5 F.Cu' },
              { description: 'PTH pad 7 [+3V3] on J7' }
            ]
          }
        ]
      })
    });

    assert.equal(result.ok, false);
    assert.equal(result.skipped, false);
    assert.equal(result.drc.violationCount, 2);
    assert.equal(result.drc.unconnectedCount, 2);
    assert.deepEqual(result.drc.byType, {
      clearance: 2,
      unconnected_items: 2
    });
    assert.deepEqual(result.drc.unconnectedByNet, { VBUS: 1, '+3V3': 1 });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('validateBoard fails with a typed result when the DRC report is invalid or missing', async () => {
  const root = await makeProject();

  try {
    const invalid = await validateBoard({
      projectDir: root,
      runKicadCliImpl: async () => {
        return {
          exitCode: 0,
          stdout: '',
          stderr: '',
          command: 'fake-kicad-cli',
          source: 'test'
        };
      }
    });

    assert.equal(invalid.ok, false);
    assert.equal(invalid.skipped, false);
    assert.equal(invalid.reason.code, 'PCB_DRC_REPORT_INVALID');
    assert.equal(invalid.drc.violationCount, 0);
    assert.equal(invalid.drc.unconnectedCount, 0);

    const malformed = await validateBoard({
      projectDir: root,
      runKicadCliImpl: async (args) => {
        const reportPath = args[args.indexOf('--output') + 1];
        await writeFile(reportPath, '{not-json', 'utf8');
        return {
          exitCode: 0,
          stdout: '',
          stderr: '',
          command: 'fake-kicad-cli',
          source: 'test'
        };
      }
    });

    assert.equal(malformed.ok, false);
    assert.equal(malformed.reason.code, 'PCB_DRC_REPORT_INVALID');
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('validateBoard skips cleanly when the project has no PCB', async () => {
  const root = await makeProject({ board: false });

  try {
    const result = await validateBoard({ projectDir: root });

    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
    assert.equal(result.reason.code, 'NO_BOARD');
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('validateBoard returns a typed skip when KiCad CLI is unavailable', async () => {
  const root = await makeProject();

  try {
    const result = await validateBoard({
      projectDir: root,
      runKicadCliImpl: async () => {
        throw new Error('spawn kicad-cli ENOENT');
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
    assert.equal(result.reason.code, 'KICAD_CLI_UNAVAILABLE');
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('validateBoard fails closed for KiCad execution errors other than missing CLI', async () => {
  const root = await makeProject();

  try {
    const result = await validateBoard({
      projectDir: root,
      runKicadCliImpl: async () => {
        const error = new Error('permission denied while starting kicad-cli');
        error.code = 'EACCES';
        throw error;
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.skipped, false);
    assert.equal(result.reason.code, 'PCB_DRC_FAILED');
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
