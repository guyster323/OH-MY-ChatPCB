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

test('streams parsed provider events through onEvent', async () => {
  const seen = [];
  const script = [
    'console.log("Drafting circuit.");',
    'console.log(JSON.stringify({type:"tool.call", payload:{id:"1", name:"schematic.generate", args:{mcu:"STM32"}}}));'
  ].join('');

  const transcript = await runProviderProcess({
    command: process.execPath,
    args: ['-e', script],
    timeoutMs: 2000,
    onEvent: (event) => seen.push(event.type)
  });

  assert.deepEqual(seen, ['agent.delta', 'tool.call']);
  assert.equal(transcript.events.length, 2);
});

test('allows providers to request read-only project inspection', async () => {
  const script = 'console.log(JSON.stringify({type:"tool.call", payload:{id:"inspect_1", name:"project.inspect", args:{projectDir:"C:/workspace/demo"}}}));';

  const transcript = await runProviderProcess({
    command: process.execPath,
    args: ['-e', script],
    timeoutMs: 2000
  });

  assert.equal(transcript.exitCode, 0);
  assert.equal(transcript.events[0].payload.name, 'project.inspect');
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

test('normalizes Codex lifecycle events and Korean assistant messages with embedded tool calls', async () => {
  const message = [
    '요청한 회로 초안을 생성합니다.',
    '{"type":"tool.call","payload":{"id":"call_ko","name":"schematic.generate","args":{"prompt":"ESP32-S3 회로"}}}'
  ].join('\n');
  const script = [
    'console.log(JSON.stringify({type:"thread.started", thread_id:"thread_1"}));',
    'console.log(JSON.stringify({type:"turn.started"}));',
    'console.log(JSON.stringify({type:"item.started", item:{id:"item_1", type:"command_execution"}}));',
    'console.log(JSON.stringify({type:"item.completed", item:{id:"item_1", type:"command_execution", status:"completed"}}));',
    `console.log(JSON.stringify({type:"item.completed", item:{id:"item_2", type:"agent_message", text:${JSON.stringify(message)}}}));`,
    'console.log(JSON.stringify({type:"turn.completed", usage:{input_tokens:1, output_tokens:1}}));'
  ].join('');

  const transcript = await runProviderProcess({
    command: process.execPath,
    args: ['-e', script],
    timeoutMs: 2000
  });

  assert.deepEqual(transcript.events.map((event) => event.type), ['agent.delta', 'tool.call']);
  assert.equal(transcript.events[0].payload.text, '요청한 회로 초안을 생성합니다.');
  assert.equal(transcript.events[1].payload.id, 'call_ko');
});

test('rejects unsupported embedded calls while ignoring completed command executions', async () => {
  const unsupportedMessage = [
    '초안을 준비합니다.',
    '{"type":"tool.call","payload":{"id":"call_bad","name":"board.autoroute","args":{}}}'
  ].join('\n');
  const script = [
    'console.log(JSON.stringify({type:"item.completed", item:{id:"item_1", type:"command_execution", status:"completed"}}));',
    `console.log(JSON.stringify({type:"item.completed", item:{id:"item_2", type:"agent_message", text:${JSON.stringify(unsupportedMessage)}}}));`
  ].join('');

  await assert.rejects(
    () => runProviderProcess({ command: process.execPath, args: ['-e', script], timeoutMs: 2000 }),
    /Unsupported provider tool call/
  );
});

test('rejects a syntactically malformed embedded tool call instead of treating it as assistant text', async () => {
  const message = [
    '초안을 준비합니다.',
    '{"type":"tool.call","payload":{"id":"call_broken","name":"schematic.generate","args":{}}'
  ].join('\n');
  const script = `console.log(JSON.stringify({type:"item.completed", item:{id:"item_1", type:"agent_message", text:${JSON.stringify(message)}}}));`;

  await assert.rejects(
    () => runProviderProcess({ command: process.execPath, args: ['-e', script], timeoutMs: 2000 }),
    /Malformed embedded provider tool call/
  );
});

test('preserves ordinary non-JSON assistant text from completed messages', async () => {
  const message = 'Use {R1, R2} as the divider and continue with the schematic.';
  const script = `console.log(JSON.stringify({type:"item.completed", item:{id:"item_1", type:"agent_message", text:${JSON.stringify(message)}}}));`;

  const transcript = await runProviderProcess({ command: process.execPath, args: ['-e', script], timeoutMs: 2000 });

  assert.deepEqual(transcript.events.map((event) => event.type), ['agent.delta']);
  assert.equal(transcript.events[0].payload.text, message);
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

test('grok provider emits text output as agent deltas', async () => {
  const script = [
    'console.log("Analyzing the circuit requirements.");',
    'console.log("Based on your specifications, I will generate a schematic for an ESP32-S3 board.");',
    'console.log(JSON.stringify({type:"tool.call", payload:{id:"grok_1", name:"schematic.generate", args:{prompt:"ESP32-S3 board"}}}));',
    'console.log("The schematic has been generated. Please review it before applying.");'
  ].join('');

  const transcript = await runProviderProcess({
    command: process.execPath,
    args: ['-e', script],
    input: 'Generate an ESP32-S3 board.',
    timeoutMs: 2000
  });

  assert.equal(transcript.exitCode, 0);
  assert.deepEqual(
    transcript.events.map((event) => event.type),
    ['agent.delta', 'agent.delta', 'tool.call', 'agent.delta']
  );
  assert.match(transcript.events[0].payload.text, /Analyzing/);
  assert.equal(transcript.events[2].payload.name, 'schematic.generate');
});

test('usePromptFile writes temp file on all platforms and child can read it', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-grok-test-'));
  const scriptPath = path.join(root, 'fake-grok.js');

  try {
    await writeFile(
      scriptPath,
      [
        'const fs = require("fs");',
        'const args = process.argv.slice(2);',
        'const promptFileIndex = args.indexOf("--prompt-file");',
        'if (promptFileIndex === -1 || !args[promptFileIndex + 1]) {',
        '  console.error("Missing --prompt-file argument");',
        '  process.exit(1);',
        '}',
        'const promptPath = args[promptFileIndex + 1];',
        'const content = fs.readFileSync(promptPath, "utf8");',
        'console.log("Prompt received:", content);'
      ].join('\n'),
      'utf8'
    );

    const input = 'Test prompt for Grok from temp file.';

    const transcript = await runProviderProcess({
      command: process.execPath,
      args: [scriptPath, '--prompt-file', '<temp>'],
      input,
      usePromptFile: true,
      timeoutMs: 2000
    });

    assert.equal(transcript.exitCode, 0);
    assert.match(transcript.events[0].payload.text, /Test prompt for Grok from temp file/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('usePromptFile cleans up temp file on success', async () => {
  const { readdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');

  const beforeFiles = await readdir(tmpdir());
  const chatpcbPromptsBefore = beforeFiles.filter((f) => f.startsWith('chatpcb-prompt-'));

  const script = 'console.log("CHATPCB_CLEANUP_TEST");';

  await runProviderProcess({
    command: process.execPath,
    args: ['-e', script],
    input: 'Cleanup test prompt.',
    usePromptFile: true,
    timeoutMs: 2000
  });

  const afterFiles = await readdir(tmpdir());
  const chatpcbPromptsAfter = afterFiles.filter((f) => f.startsWith('chatpcb-prompt-'));

  assert.equal(chatpcbPromptsAfter.length, chatpcbPromptsBefore.length);
});

test('usePromptFile cleans up temp file on error', async () => {
  const { readdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');

  const beforeFiles = await readdir(tmpdir());
  const chatpcbPromptsBefore = beforeFiles.filter((f) => f.startsWith('chatpcb-prompt-'));

  const script = 'console.log(JSON.stringify({type:"tool.call", payload:{id:"bad", name:"unknown.tool", args:{}}}));';

  await assert.rejects(
    () =>
      runProviderProcess({
        command: process.execPath,
        args: ['-e', script],
        input: 'Error test prompt.',
        usePromptFile: true,
        timeoutMs: 2000
      }),
    /Unsupported provider tool call/
  );

  const afterFiles = await readdir(tmpdir());
  const chatpcbPromptsAfter = afterFiles.filter((f) => f.startsWith('chatpcb-prompt-'));

  assert.equal(chatpcbPromptsAfter.length, chatpcbPromptsBefore.length);
});

test('usePromptFile cleans up temp file on timeout', async () => {
  const { readdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');

  const beforeFiles = await readdir(tmpdir());
  const chatpcbPromptsBefore = beforeFiles.filter((f) => f.startsWith('chatpcb-prompt-'));

  const script = 'setTimeout(() => {}, 10000);';

  await assert.rejects(
    () =>
      runProviderProcess({
        command: process.execPath,
        args: ['-e', script],
        input: 'Timeout test prompt.',
        usePromptFile: true,
        timeoutMs: 50
      }),
    /timed out/
  );

  await new Promise((resolve) => setTimeout(resolve, 100));

  const afterFiles = await readdir(tmpdir());
  const chatpcbPromptsAfter = afterFiles.filter((f) => f.startsWith('chatpcb-prompt-'));

  assert.equal(chatpcbPromptsAfter.length, chatpcbPromptsBefore.length);
});
