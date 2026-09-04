import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runConfiguredAnalyzer } from '../src/analyzer/external-adapter.js';

const executableHash = createHash('sha256').update(await readFile(process.execPath)).digest('hex');

async function makeContext() {
  const projectDir = await mkdtemp(path.join(tmpdir(), 'chatpcb-external-adapter-project-'));
  await writeFile(path.join(projectDir, 'demo.kicad_sch'), '(kicad_sch)', 'utf8');
  const inventory = {
    projectDigest: 'a'.repeat(64),
    artifacts: [{ path: 'demo.kicad_sch' }]
  };
  return {
    projectDir,
    inventory,
    sourceFiles: [{ artifact: inventory.artifacts[0], source: '(kicad_sch)' }]
  };
}

function validDefinition(overrides = {}) {
  return {
    id: 'test.adapter',
    namespace: 'external.test',
    command: process.execPath,
    args: [],
    version: '1.0.0',
    sha256: executableHash,
    timeoutMs: 5_000,
    input: 'json',
    ...overrides
  };
}

async function script(source) {
  const directory = await mkdtemp(path.join(tmpdir(), 'chatpcb-external-adapter-script-'));
  const scriptPath = path.join(directory, 'adapter.mjs');
  await writeFile(scriptPath, source, 'utf8');
  return { directory, scriptPath };
}

test('checksum mismatch skips before spawning the adapter', async () => {
  const context = await makeContext();
  try {
    const result = await runConfiguredAnalyzer({
      definition: validDefinition({ sha256: '0'.repeat(64) }),
      ...context,
      spawnImpl: () => { throw new Error('must not spawn'); }
    });
    assert.equal(result.analyzer.status, 'failed');
    assert.equal(result.analyzer.diagnostics[0].code, 'ANALYZER_ADAPTER_CHECKSUM_MISMATCH');
  } finally {
    await rm(context.projectDir, { force: true, recursive: true });
  }
});

test('project-copy adapter receives a disposable project copy', async () => {
  const context = await makeContext();
  const adapter = await script(`
    import { writeFile } from 'node:fs/promises';
    import path from 'node:path';
    const projectDir = process.argv[2];
    await writeFile(path.join(projectDir, 'created-by-adapter.txt'), 'created');
    console.log(JSON.stringify({ schemaVersion: 1, facts: [{ id: 'created', category: 'test', sourceArtifact: 'demo.kicad_sch', value: { projectDir } }] }));
  `);
  try {
    const before = await readFile(path.join(context.projectDir, 'demo.kicad_sch'), 'utf8');
    const result = await runConfiguredAnalyzer({
      definition: validDefinition({ input: 'project-copy', args: [adapter.scriptPath, '{projectDir}'] }),
      ...context
    });
    assert.equal(result.analyzer.status, 'complete');
    assert.equal(result.facts[0].id, 'external.test.created');
    assert.equal(await readFile(path.join(context.projectDir, 'demo.kicad_sch'), 'utf8'), before);
    await assert.rejects(readFile(path.join(context.projectDir, 'created-by-adapter.txt')));
    const copyDir = result.facts[0].value.projectDir;
    await assert.rejects(readFile(path.join(copyDir, 'created-by-adapter.txt')));
  } finally {
    await rm(context.projectDir, { force: true, recursive: true });
    await rm(adapter.directory, { force: true, recursive: true });
  }
});

test('project-copy rejects symlinked source artifacts before an adapter can mutate them', async () => {
  const context = await makeContext();
  const outside = path.join(context.projectDir, '..', `chatpcb-external-outside-${Date.now()}.kicad_sch`);
  const adapter = await script(`
    import { writeFile } from 'node:fs/promises';
    import path from 'node:path';
    await writeFile(path.join(process.argv[2], 'demo.kicad_sch'), 'adapter mutation');
    console.log(JSON.stringify({ schemaVersion: 1, facts: [] }));
  `);
  try {
    await writeFile(outside, 'protected source', 'utf8');
    await rm(path.join(context.projectDir, 'demo.kicad_sch'));
    await symlink(outside, path.join(context.projectDir, 'demo.kicad_sch'), 'file');
    const result = await runConfiguredAnalyzer({
      definition: validDefinition({ input: 'project-copy', args: [adapter.scriptPath, '{projectDir}'] }),
      ...context
    });
    assert.equal(result.analyzer.status, 'failed');
    assert.equal(result.analyzer.diagnostics[0].code, 'ANALYZER_ADAPTER_UNSAFE_INPUT');
    assert.equal(await readFile(outside, 'utf8'), 'protected source');
  } finally {
    await rm(context.projectDir, { force: true, recursive: true });
    await rm(outside, { force: true });
    await rm(adapter.directory, { force: true, recursive: true });
  }
});

test('json adapter receives only relative source paths and namespaces normalized output', async () => {
  const context = await makeContext();
  const adapter = await script(`
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { input += chunk; });
    process.stdin.on('end', () => {
      const parsed = JSON.parse(input);
      console.log(JSON.stringify({ schemaVersion: 1, facts: [{ id: 'summary', category: 'test', sourceArtifact: Object.keys(parsed.sources)[0], confidence: 'deterministic', value: { sourcePaths: Object.keys(parsed.sources) } }], findings: [] }));
    });
  `);
  try {
    const result = await runConfiguredAnalyzer({
      definition: validDefinition({ args: [adapter.scriptPath] }),
      ...context,
      sourceFiles: [...context.sourceFiles, { path: path.join(context.projectDir, 'must-not-be-sent.kicad_sch'), source: 'secret' }]
    });
    assert.deepEqual(result.facts, [{
      id: 'external.test.summary', category: 'test', sourceArtifact: 'demo.kicad_sch',
      extractor: 'external.test@1.0.0', confidence: 'deterministic', value: { sourcePaths: ['demo.kicad_sch'] }
    }]);
    assert.equal(result.analyzer.status, 'complete');
  } finally {
    await rm(context.projectDir, { force: true, recursive: true });
    await rm(adapter.directory, { force: true, recursive: true });
  }
});

test('timeout reports a typed diagnostic and redacts stderr secrets', async () => {
  const context = await makeContext();
  const adapter = await script(`console.error('API_KEY=not-for-logs'); setInterval(() => {}, 1_000);`);
  try {
    const result = await runConfiguredAnalyzer({
      definition: validDefinition({ args: [adapter.scriptPath], timeoutMs: 30 }),
      ...context
    });
    assert.equal(result.analyzer.status, 'failed');
    assert.equal(result.analyzer.diagnostics[0].code, 'ANALYZER_ADAPTER_TIMEOUT');
    assert.equal(JSON.stringify(result.analyzer.diagnostics).includes('not-for-logs'), false);
  } finally {
    await rm(context.projectDir, { force: true, recursive: true });
    await rm(adapter.directory, { force: true, recursive: true });
  }
});

test('timeout waits for a TERM-ignoring adapter to be killed before returning', async () => {
  const context = await makeContext();
  try {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const signals = [];
    child.kill = (signal) => {
      signals.push(signal);
      if (signal === 'SIGKILL') setImmediate(() => child.emit('close', null));
    };
    const started = Date.now();
    const result = await runConfiguredAnalyzer({
      definition: validDefinition({ timeoutMs: 30 }),
      ...context,
      spawnImpl: () => child
    });
    assert.equal(result.analyzer.diagnostics[0].code, 'ANALYZER_ADAPTER_TIMEOUT');
    assert.ok(Date.now() - started >= 80);
    assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  } finally {
    await rm(context.projectDir, { force: true, recursive: true });
  }
});

test('invalid adapter output returns no facts', async () => {
  const context = await makeContext();
  const adapter = await script(`console.log('not-json');`);
  try {
    const result = await runConfiguredAnalyzer({ definition: validDefinition({ args: [adapter.scriptPath] }), ...context });
    assert.equal(result.analyzer.status, 'failed');
    assert.equal(result.analyzer.diagnostics[0].code, 'ANALYZER_ADAPTER_INVALID_OUTPUT');
    assert.deepEqual(result.facts, []);
  } finally {
    await rm(context.projectDir, { force: true, recursive: true });
    await rm(adapter.directory, { force: true, recursive: true });
  }
});

test('malformed nested facts fail the adapter instead of reporting completion', async () => {
  const context = await makeContext();
  const adapter = await script(`console.log(JSON.stringify({ schemaVersion: 1, facts: [{ id: 'bad', category: 42, sourceArtifact: 'demo.kicad_sch' }] }));`);
  try {
    const result = await runConfiguredAnalyzer({ definition: validDefinition({ args: [adapter.scriptPath] }), ...context });
    assert.equal(result.analyzer.status, 'failed');
    assert.equal(result.analyzer.diagnostics[0].code, 'ANALYZER_ADAPTER_INVALID_OUTPUT');
  } finally {
    await rm(context.projectDir, { force: true, recursive: true });
    await rm(adapter.directory, { force: true, recursive: true });
  }
});

test('an unavailable optional executable is skipped', async () => {
  const context = await makeContext();
  try {
    const result = await runConfiguredAnalyzer({
      definition: validDefinition({ command: path.join(context.projectDir, 'missing-adapter.exe') }),
      ...context
    });
    assert.equal(result.analyzer.status, 'skipped');
    assert.equal(result.analyzer.diagnostics[0].code, 'ANALYZER_ADAPTER_UNAVAILABLE');
  } finally {
    await rm(context.projectDir, { force: true, recursive: true });
  }
});
