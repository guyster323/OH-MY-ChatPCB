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
