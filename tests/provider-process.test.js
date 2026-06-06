import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runProviderProcess } from '../src/runtime/provider-process.js';

test('parses provider stdout into deltas and tool calls', async () => {
  const script = [
    'console.log("Drafting circuit.");',
    'console.log(JSON.stringify({type:"tool.call", payload:{id:"1", name:"schematic.generate", args:{mcu:"STM32"}}}));',
    'console.log("Waiting for tool result from daemon.");'
  ].join('');

  const transcript = await runProviderProcess({
    command: process.execPath,
    args: ['-e', script],
    input: 'Generate an STM32 board.',
    timeoutMs: 2000
  });

  assert.equal(transcript.exitCode, 0);
  assert.deepEqual(
    transcript.events.map((event) => event.type),
    ['agent.delta', 'tool.call', 'agent.delta']
  );
  assert.equal(transcript.events[1].payload.name, 'schematic.generate');
});

test('runs Windows command-shim provider scripts', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-provider-cmd-'));
  const scriptPath = path.join(root, 'fake-provider.cmd');

  try {
    await writeFile(scriptPath, '@echo off\r\necho hello from cmd shim\r\n', 'utf8');

    const transcript = await runProviderProcess({
      command: scriptPath,
      timeoutMs: 2000
    });

    assert.equal(transcript.exitCode, 0);
    assert.equal(transcript.events[0].payload.text, 'hello from cmd shim');
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('passes arguments to Windows command-shim provider scripts', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-provider-cmd-args-'));
  const scriptPath = path.join(root, 'fake-provider.cmd');

  try {
    await writeFile(scriptPath, '@echo off\r\necho %1 %2\r\n', 'utf8');

    const transcript = await runProviderProcess({
      command: scriptPath,
      args: ['hello', 'two words'],
      timeoutMs: 2000
    });

    assert.equal(transcript.exitCode, 0);
    assert.equal(transcript.events[0].payload.text, 'hello "two words"');
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('parses Codex CLI json agent messages into assistant deltas', async () => {
  const script = [
    'console.log(JSON.stringify({type:"thread.started", thread_id:"thread_1"}));',
    'console.log(JSON.stringify({type:"turn.started"}));',
    'console.log(JSON.stringify({type:"item.completed", item:{id:"item_1", type:"agent_message", text:"CHATPCB_PROVIDER_SMOKE_OK"}}));',
    'console.log(JSON.stringify({type:"turn.completed", usage:{input_tokens:1, output_tokens:1}}));'
  ].join('');

  const transcript = await runProviderProcess({
    command: process.execPath,
    args: ['-e', script],
    timeoutMs: 2000
  });

  assert.equal(transcript.exitCode, 0);
  assert.deepEqual(
    transcript.events.map((event) => event.type),
    ['agent.delta']
  );
  assert.equal(transcript.events[0].payload.text, 'CHATPCB_PROVIDER_SMOKE_OK');
});

test('rejects provider-emitted tool results before execution', async () => {
  const script = 'console.log(JSON.stringify({type:"tool.result", payload:{id:"1", ok:true}}));';

  await assert.rejects(
    () =>
      runProviderProcess({
        command: process.execPath,
        args: ['-e', script],
        timeoutMs: 2000
      }),
    /Providers may only emit tool\.call/
  );
});

test('rejects unknown provider tool calls before execution', async () => {
  const script = 'console.log(JSON.stringify({type:"tool.call", payload:{id:"1", name:"board.autoroute", args:{}}}));';

  await assert.rejects(
    () =>
      runProviderProcess({
        command: process.execPath,
        args: ['-e', script],
        timeoutMs: 2000
      }),
    /Unsupported provider tool call: board\.autoroute/
  );
});

test('redacts provider stderr secrets from transcripts', async () => {
  const script = 'console.error("OPENAI_API_KEY=sk-testsecret1234567890");';

  const transcript = await runProviderProcess({
    command: process.execPath,
    args: ['-e', script],
    timeoutMs: 2000
  });

  assert.doesNotMatch(transcript.stderr, /sk-testsecret/);
  assert.match(transcript.stderr, /OPENAI_API_KEY=\[REDACTED\]/);
});

test('writes redacted local provider trace files when requested', async () => {
  const traceDir = await mkdtemp(path.join(tmpdir(), 'chatpcb-provider-trace-'));

  try {
    const script = [
      'console.log("Using token sk-visible1234567890");',
      'console.log(JSON.stringify({type:"tool.call", payload:{id:"1", name:"schematic.generate", args:{prompt:"hello"}}}));',
      'console.error("ANTHROPIC_API_KEY=sk-antsecret1234567890");'
    ].join('');

    const transcript = await runProviderProcess({
      command: process.execPath,
      args: ['-e', script],
      input: 'OPENAI_API_KEY=sk-inputsecret1234567890',
      traceDir,
      timeoutMs: 2000
    });

    const files = await readdir(traceDir);
    assert.equal(files.length, 1);
    assert.equal(transcript.tracePath, path.join(traceDir, files[0]));

    const trace = await readFile(transcript.tracePath, 'utf8');
    assert.doesNotMatch(trace, /sk-visible/);
    assert.doesNotMatch(trace, /sk-antsecret/);
    assert.doesNotMatch(trace, /sk-inputsecret/);
    assert.match(trace, /schematic\.generate/);
  } finally {
    await rm(traceDir, { force: true, recursive: true });
  }
});

test('times out hung provider processes', async () => {
  await assert.rejects(
    () =>
      runProviderProcess({
        command: process.execPath,
        args: ['-e', 'setTimeout(() => {}, 10000)'],
        input: 'hello',
        timeoutMs: 50
      }),
    /timed out/
  );
});

test('cancels provider processes with an abort signal', async () => {
  const controller = new AbortController();
  const promise = runProviderProcess({
    command: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 10000)'],
    signal: controller.signal,
    timeoutMs: 5000
  });

  setTimeout(() => controller.abort(), 20);

  await assert.rejects(promise, /cancelled/);
});
