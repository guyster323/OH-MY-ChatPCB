import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runConfiguredAnalyzer } from '../src/analyzer/external-adapter.js';

test('external execution fails closed before accessing or spawning any payload', async () => {
  const sha256 = createHash('sha256').update(await readFile(process.execPath)).digest('hex');
  for (const input of ['json', 'project-copy']) {
    for (const args of [[], ['extensionless'], ['-e', 'process.exit(0)'], ['--sandbox', 'true']]) {
      let touched = false;
      const result = await runConfiguredAnalyzer({
        definition: { id: 'external.test', namespace: 'external.test', version: '1',
          command: process.execPath, sha256, args, input, timeoutMs: 100,
          sandbox: true, allowUnsafe: true },
        projectDir: process.cwd(), inventory: { artifacts: [] },
        spawnImpl: () => { touched = true; throw new Error('execution forbidden'); },
        fsImpl: { lstat: () => { touched = true; throw new Error('payload access forbidden'); } }
      });
      assert.equal(result.analyzer.status, 'skipped');
      assert.equal(result.analyzer.diagnostics[0].code, 'ANALYZER_SANDBOX_UNAVAILABLE');
      assert.deepEqual(result.facts, []);
      assert.deepEqual(result.findings, []);
      assert.equal(touched, false);
    }
  }
});
