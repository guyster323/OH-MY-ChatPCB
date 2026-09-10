import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { simulateProject } from '../src/workflow/simulate-project.js';

test('simulateProject passes an absolute circuit path to ngspice', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-simulate-'));
  await writeFile(path.join(root, 'demo.cir'), '.op\n.end\n', 'utf8');

  try {
    const calls = [];
    const result = await simulateProject({
      projectDir: root,
      runCommandImpl: async (command, args, options) => {
        calls.push({ command, args, options });
        return {
          exitCode: 0,
          stdout: '',
          stderr: ''
        };
      }
    });

    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(path.isAbsolute(calls[0].args.at(-1)), true);
    assert.equal(calls[0].options.cwd, root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('simulateProject uses only ngspicePath and ignores request executable aliases', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-simulate-trusted-'));
  await writeFile(path.join(root, 'demo.cir'), '.op\n.end\n', 'utf8');

  try {
    const commands = [];
    const result = await simulateProject({
      projectDir: root,
      ngspicePath: '/trusted/ngspice',
      requestNgspicePath: '/untrusted/ngspice',
      ngspice: '/also-untrusted/ngspice',
      runCommandImpl: async (command, args) => {
        commands.push({ command, args });
        return { exitCode: 0, stdout: 'raw stdout', stderr: '' };
      }
    });

    assert.equal(result.ok, true);
    assert.equal(commands.length, 1);
    assert.equal(commands[0].command, '/trusted/ngspice');
    assert.notEqual(commands[0].command, '/untrusted/ngspice');
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
