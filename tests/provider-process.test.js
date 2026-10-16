import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  activeProviderGroupIds,
  buildProviderKillCommand,
  killProviderGroupNow,
  noteActiveProviderGroup,
  parseProcStatStartTime,
  providerProcessCommand,
  pruneDeadProviderGroups,
  runProviderProcess
} from '../src/runtime/provider-process.js';
import { PROMPT_FILE_PLACEHOLDER } from '../src/runtime/provider-registry.js';

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
      args: [scriptPath, '--prompt-file', PROMPT_FILE_PLACEHOLDER],
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

test('usePromptFile handles empty input by writing empty temp file', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-empty-prompt-'));
  const scriptPath = path.join(root, 'fake-grok-empty.js');

  try {
    await writeFile(
      scriptPath,
      [
        'const fs = require("fs");',
        'const args = process.argv.slice(2);',
        'const promptFileIndex = args.indexOf("--prompt-file");',
        'const promptPath = args[promptFileIndex + 1];',
        'const content = fs.readFileSync(promptPath, "utf8");',
        'console.log("Prompt length:", content.length);'
      ].join('\n'),
      'utf8'
    );

    const transcript = await runProviderProcess({
      command: process.execPath,
      args: [scriptPath, '--prompt-file', PROMPT_FILE_PLACEHOLDER],
      input: '',
      usePromptFile: true,
      timeoutMs: 2000
    });

    assert.equal(transcript.exitCode, 0);
    assert.match(transcript.events[0].payload.text, /Prompt length: 0/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('rejects immediately with cleanup when abort signal is already aborted', async () => {
  const { readdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');

  const beforeFiles = await readdir(tmpdir());
  const chatpcbPromptsBefore = beforeFiles.filter((f) => f.startsWith('chatpcb-prompt-'));

  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () =>
      runProviderProcess({
        command: process.execPath,
        args: ['-e', 'console.log("should not run");'],
        input: 'Pre-aborted test prompt.',
        usePromptFile: true,
        signal: controller.signal,
        timeoutMs: 2000
      }),
    /cancelled/
  );

  const afterFiles = await readdir(tmpdir());
  const chatpcbPromptsAfter = afterFiles.filter((f) => f.startsWith('chatpcb-prompt-'));

  assert.equal(chatpcbPromptsAfter.length, chatpcbPromptsBefore.length);
});

test('trace write failure still settles with the provider result and removes the temp dir', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-trace-fail-'));
  const blocker = path.join(root, 'not-a-directory');
  await writeFile(blocker, 'blocked');
  const traceDir = path.join(blocker, 'traces');
  const before = (await readdir(tmpdir())).filter((name) => name.startsWith('chatpcb-prompt-'));
  const originalError = console.error;
  const originalWarn = console.warn;
  const errors = [];
  const warnings = [];
  console.error = (...args) => {
    errors.push(args);
  };
  console.warn = (...args) => {
    warnings.push(args);
  };

  try {
    const transcript = await runProviderProcess({
      command: process.execPath,
      args: ['-e', 'console.log("TRACE_FAIL_OK");'],
      input: 'prompt that must be cleaned up',
      usePromptFile: true,
      traceDir,
      timeoutMs: 2000
    });

    assert.equal(transcript.exitCode, 0);
    assert.equal(transcript.events[0].payload.text, 'TRACE_FAIL_OK');
    assert.equal(transcript.tracePath, undefined);
    assert.equal((await readdir(tmpdir())).filter((name) => name.startsWith('chatpcb-prompt-')).length, before.length);
    assert.ok(errors.some((args) => String(args[0]).includes('Failed to write provider trace')));
    assert.ok(errors.some((args) => args[1] instanceof Error));
    assert.equal(warnings.length, 0);
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
    await rm(root, { force: true, recursive: true });
  }
});

test('a provider output error still rejects when the trace directory cannot be written', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-trace-reject-'));
  const blocker = path.join(root, 'not-a-directory');
  await writeFile(blocker, 'blocked');
  const before = (await readdir(tmpdir())).filter((name) => name.startsWith('chatpcb-prompt-'));

  try {
    await assert.rejects(
      () => runProviderProcess({
        command: process.execPath,
        args: ['-e', 'console.log(JSON.stringify({type:"tool.call", payload:{id:"bad", name:"unknown.tool", args:{}}}));'],
        input: 'bad output',
        usePromptFile: true,
        traceDir: path.join(blocker, 'traces'),
        timeoutMs: 2000
      }),
      /Unsupported provider tool call/
    );

    assert.equal((await readdir(tmpdir())).filter((name) => name.startsWith('chatpcb-prompt-')).length, before.length);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('usePromptFile cleans up temp file on cancel', async () => {
  const before = (await readdir(tmpdir())).filter((name) => name.startsWith('chatpcb-prompt-'));
  const controller = new AbortController();
  const promise = runProviderProcess({
    command: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 10000)'],
    input: 'Cancel this prompt.',
    usePromptFile: true,
    signal: controller.signal,
    timeoutMs: 5000
  });

  setTimeout(() => controller.abort(), 20);

  await assert.rejects(promise, /cancelled/);
  assert.equal((await readdir(tmpdir())).filter((name) => name.startsWith('chatpcb-prompt-')).length, before.length);
});

test('Windows shim caret-escapes cmd metacharacters and double-escapes batch shims', () => {
  const args = ['a&b', 'c^d', 'e%f', 'two words', 'say "hi"', '100% done', 'a|b', ''];
  // cmd /d /s /c does not collapse %%. Match cross-spawn: caret-escape meta chars,
  // and escape .cmd/.bat arguments twice because cmd re-parses batch arguments.
  const doubleEscaped = '"grok.cmd ^^^"a^^^&b^^^" ^^^"c^^^^d^^^" ^^^"e^^^%f^^^" ^^^"two^^^ words^^^" ^^^"say^^^ \\^^^"hi\\^^^"^^^" ^^^"100^^^%^^^ done^^^" ^^^"a^^^|b^^^" ^^^"^^^""';
  const singleEscaped = '"grok ^"a^&b^" ^"c^^d^" ^"e^%f^" ^"two^ words^" ^"say^ \\^"hi\\^"^" ^"100^%^ done^" ^"a^|b^" ^"^""';

  const shim = providerProcessCommand('grok.cmd', args, 'win32');
  assert.equal(shim.windowsShim, true);
  assert.equal(shim.windowsVerbatimArguments, true);
  assert.equal(shim.command, process.env.ComSpec ?? 'cmd.exe');
  assert.deepEqual(shim.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(shim.args[3], doubleEscaped);
  assert.equal(shim.args[3].includes('%%'), false);

  const batch = providerProcessCommand('grok.bat', args, 'win32');
  assert.equal(batch.args[3], doubleEscaped.replace('grok.cmd', 'grok.bat'));

  const extensionless = providerProcessCommand('grok', args, 'win32');
  assert.equal(extensionless.windowsShim, true);
  assert.equal(extensionless.args[3], singleEscaped);

  const executable = providerProcessCommand('C:\\Tools\\grok.exe', ['a&b', '100%'], 'win32');
  assert.equal(executable.windowsShim, false);
  assert.equal(executable.windowsVerbatimArguments, undefined);
  assert.equal(executable.command, 'C:\\Tools\\grok.exe');
  assert.deepEqual(executable.args, ['a&b', '100%']);

  const posix = providerProcessCommand('grok.cmd', ['a&b'], 'linux');
  assert.equal(posix.windowsShim, false);
  assert.deepEqual(posix.args, ['a&b']);
});

test('aborts during prompt write without spawning', async () => {
  const before = (await readdir(tmpdir())).filter((name) => name.startsWith('chatpcb-prompt-'));
  const controller = new AbortController();
  let releaseWrite;
  const writeGate = new Promise((resolve) => {
    releaseWrite = resolve;
  });
  let entered;
  const writeEntered = new Promise((resolve) => {
    entered = resolve;
  });
  let spawns = 0;

  const promise = runProviderProcess({
    command: process.execPath,
    args: ['-e', 'process.exit(0)'],
    input: 'abort during write',
    usePromptFile: true,
    signal: controller.signal,
    timeoutMs: 5000,
    writeFileImpl: async (file, data, options) => {
      entered();
      controller.abort();
      await writeGate;
      return writeFile(file, data, options);
    },
    spawnImpl: () => {
      spawns += 1;
      throw new Error('spawn should not be called');
    }
  });

  await writeEntered;
  releaseWrite();
  await assert.rejects(promise, /cancelled/);
  assert.equal(spawns, 0);
  assert.equal((await readdir(tmpdir())).filter((name) => name.startsWith('chatpcb-prompt-')).length, before.length);
});

test('parses a recorded grok json-schema result into one schematic.generate tool call', async () => {
  // Recorded from `grok -m grok-4.7 --prompt-file --output-format json --json-schema` (provider flags).
  const recorded = await readFile(grokFixture('json-schema-result.json'), 'utf8');
  const expected = JSON.parse(recorded).structuredOutput.payload;
  const transcript = await runProviderStdout(recorded, { providerId: 'grok' });

  assert.equal(transcript.exitCode, 0);
  assert.deepEqual(transcript.events.map((event) => event.type), ['tool.call']);
  assert.equal(transcript.events[0].payload.id, expected.id);
  assert.equal(transcript.events[0].payload.name, expected.name);
  assert.equal(transcript.events[0].payload.args.prompt, expected.args.prompt);
});

test('grok cut-off JSON fails instead of counting as success', async () => {
  const recorded = await readFile(grokFixture('json-schema-result.json'), 'utf8');
  const cutOff = recorded.slice(0, recorded.indexOf('"structuredOutput"'));
  await assert.rejects(
    () => runProviderStdout(cutOff, { providerId: 'grok' }),
    (error) => {
      assert.equal(error.code, 'GROK_OUTPUT_UNPARSEABLE');
      assert.match(error.message, /cut off/);
      return true;
    }
  );

  const incomplete = JSON.parse(recorded);
  delete incomplete.text;
  delete incomplete.structuredOutput;
  delete incomplete.sessionId;
  await assert.rejects(
    () => runProviderStdout(`${JSON.stringify(incomplete, null, 2)}\n`, { providerId: 'grok' }),
    (error) => {
      assert.equal(error.code, 'GROK_OUTPUT_INCOMPLETE');
      assert.match(error.message, /complete result/);
      return true;
    }
  );
});

test('grok stopReason error fails the run', async () => {
  // grok 1.0.52 did not emit stopReason "error" (invalid model emits type:error;
  // documented stop reasons are end_turn, max_tokens, max_turn_requests, refusal, cancelled).
  // The recorded result is real; this case only changes stopReason.
  const recorded = JSON.parse(await readFile(grokFixture('json-schema-result.json'), 'utf8'));
  recorded.stopReason = 'error';
  await assert.rejects(
    () => runProviderStdout(`${JSON.stringify(recorded, null, 2)}\n`, { providerId: 'grok' }),
    (error) => {
      assert.equal(error.code, 'GROK_STOP_ERROR');
      assert.match(error.message, /error/i);
      return true;
    }
  );
});

test('recorded grok error JSON fails the run', async () => {
  const recorded = await readFile(grokFixture('error-result.json'), 'utf8');
  const expected = JSON.parse(recorded);
  await assert.rejects(
    () => runProviderStdout(recorded, { providerId: 'grok' }),
    (error) => {
      assert.equal(error.code, 'GROK_OUTPUT_ERROR');
      assert.equal(error.message, expected.message);
      return true;
    }
  );
});

test('non-grok providers stream each stdout line before the process exits', async () => {
  const seen = [];
  let settled = false;
  const script = [
    'console.log("Drafting circuit.");',
    'setTimeout(() => process.exit(0), 2000);'
  ].join('\n');
  const pending = runProviderProcess({
    command: process.execPath,
    args: ['-e', script],
    providerId: 'codex',
    timeoutMs: 5000,
    onEvent: (event) => seen.push(event)
  }).finally(() => {
    settled = true;
  });

  const deadline = Date.now() + 1500;
  while (seen.length === 0 && Date.now() < deadline) await delay(20);

  assert.equal(settled, false);
  assert.equal(seen[0].type, 'agent.delta');
  assert.match(seen[0].payload.text, /Drafting circuit/);
  const transcript = await pending;
  assert.equal(transcript.exitCode, 0);
  assert.equal(transcript.events[0].payload.text, 'Drafting circuit.');
});

test('non-grok JSON error lines keep the main rejection', async () => {
  const script = 'console.log(JSON.stringify({type:"error", message:"provider blew up"}));';

  await assert.rejects(
    () => runProviderProcess({
      command: process.execPath,
      args: ['-e', script],
      providerId: 'claude',
      timeoutMs: 2000
    }),
    /Providers may only emit tool\.call/
  );
});

test('parses grok streaming-json text into a tool call and ignores grok tool_call events', async () => {
  const toolCall = JSON.stringify({
    type: 'tool.call',
    payload: {
      id: 'sg1',
      name: 'schematic.generate',
      args: { prompt: 'RP2040 board with USB-C power and an I2C connector.' }
    }
  });
  const splitAt = toolCall.indexOf('schematic.generate');
  const lines = [
    { type: 'available_commands', data: [] },
    { type: 'thought', data: 'Preparing a ChatPCB tool call for schematic generation.' },
    { type: 'auto_compact_begin' },
    { type: 'text', data: toolCall.slice(0, splitAt) },
    { type: 'text', data: toolCall.slice(splitAt) },
    { type: 'tool_call', toolCallId: 'call_1', title: 'Read', kind: 'read', status: 'completed', toolName: 'read_file' },
    { type: 'tool_call_update', toolCallId: 'call_1', status: 'completed' },
    { type: 'usage', messageId: 'resp_1', stopReason: 'end_turn', usage: { input_tokens: 10, output_tokens: 20 } },
    { type: 'end', stopReason: 'end_turn', sessionId: '01a14236-498c-79d3-894e-653380daf41a' }
  ];
  const script = `for (const line of ${JSON.stringify(lines)}) console.log(JSON.stringify(line));`;
  const transcript = await runProviderProcess({
    command: process.execPath,
    args: ['-e', script],
    providerId: 'grok',
    timeoutMs: 2000
  });

  assert.equal(transcript.exitCode, 0);
  assert.deepEqual(transcript.events.map((event) => event.type), ['tool.call']);
  assert.equal(transcript.events[0].payload.name, 'schematic.generate');
  assert.equal(transcript.events[0].payload.id, 'sg1');
});

test('Windows shim kill command is taskkill /T /F with an args array', () => {
  const spec = buildProviderKillCommand({ platform: 'win32', pid: 4242, windowsShim: true });

  assert.equal(spec.command, 'taskkill');
  assert.deepEqual(spec.args, ['/PID', '4242', '/T', '/F']);
  assert.equal(Object.hasOwn(spec, 'shell'), false);

  const executable = buildProviderKillCommand({ platform: 'win32', pid: 4242, windowsShim: false });
  assert.equal(executable.command, undefined);
  assert.equal(executable.directSignal, 'SIGTERM');

  const posix = buildProviderKillCommand({ platform: 'linux', pid: 4242, windowsShim: true });
  assert.equal(posix.command, undefined);
  assert.equal(posix.group, true);
  assert.equal(posix.signal, 'SIGTERM');
  assert.equal(posix.escalateSignal, 'SIGKILL');
});

test('SIGTERM on the parent kills a grandchild after the provider leader has exited', { skip: process.platform === 'win32' }, async () => {
  await assertLeaderlessGroupKilled('SIGTERM');
});

test('SIGHUP on the parent kills a grandchild after the provider leader has exited', { skip: process.platform === 'win32' }, async () => {
  await assertLeaderlessGroupKilled('SIGHUP');
});

test('shutdown does not signal a stale provider group id after the group has exited', { skip: process.platform === 'win32' }, async () => {
  const observed = await observeExitedProviderGroup('kill');
  assert.equal(observed.trackedWhileGrandchildLives, true);
  assert.equal(observed.groupGone, true);
  assert.equal(observed.trackedAfterGroupExit, true);
  assert.equal(observed.signalled, false);
  assert.equal(observed.trackedAfter, false);
});

test('prune removes finished provider groups without spawning another provider', { skip: process.platform === 'win32' }, async () => {
  const observed = await observeExitedProviderGroup('prune');
  assert.equal(observed.trackedWhileGrandchildLives, true);
  assert.equal(observed.keptWhileGrandchildLives, true);
  assert.equal(observed.groupGone, true);
  assert.equal(observed.trackedAfterGroupExit, true);
  assert.equal(observed.trackedAfter, false);
  assert.equal(observed.signalled, false);
});

test('periodic prune drops finished provider groups and stops when none remain', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-pgid-interval-'));
  const runner = path.join(root, 'runner.mjs');
  const resultFile = path.join(root, 'result.json');
  await writeFile(runner, intervalPruneRunnerScript(), 'utf8');
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', runner, resultFile], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const output = collectProcessOutput(child);

  try {
    const result = await waitForProcessExit(child, 8000);
    const body = JSON.parse(await readFile(resultFile, 'utf8'));
    assert.equal(result.code, 0, `${output.stderr()}\n${JSON.stringify(body)}`);
    assert.equal(body.trackedStale, true);
    assert.equal(body.trackedLive, true);
    assert.equal(body.scheduledWhileTracked, true);
    assert.equal(body.staleBefore, true);
    assert.equal(body.liveBefore, true);
    assert.equal(body.staleAfter, false);
    assert.equal(body.liveAfter, true);
    assert.equal(body.scheduledWhileLive, true);
    assert.equal(body.groupGone, true);
    assert.equal(body.liveAfterExit, false);
    assert.equal(body.scheduledAfterEmpty, false);
  } catch (error) {
    error.message += `\nstderr: ${output.stderr()}`;
    throw error;
  } finally {
    forceKillPid(child.pid);
    await rm(root, { force: true, recursive: true });
  }
});

test('the provider group prune timer does not keep the process alive', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-pgid-unref-'));
  const runner = path.join(root, 'runner.mjs');
  await writeFile(runner, unrefPruneTimerScript(), 'utf8');
  const child = spawn(process.execPath, [runner], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const output = collectProcessOutput(child);

  try {
    const result = await waitForProcessExit(child, 2000);
    assert.equal(result.code, 0, output.stderr());
  } finally {
    forceKillPid(child.pid);
    await rm(root, { force: true, recursive: true });
  }
});

test('shutdown does not signal a reused pid whose start time differs', { skip: process.platform !== 'linux' }, async () => {
  const child = spawnDetachedSleeper();

  try {
    await waitForGroupLeader(child.pid);
    const realStart = parseProcStatStartTime(readFileSync(`/proc/${child.pid}/stat`, 'utf8'));
    assert.notEqual(realStart, '1');
    noteActiveProviderGroup(child.pid, '1');
    const calls = captureProcessKill(() => {
      pruneDeadProviderGroups();
      killProviderGroupNow(child.pid);
    });
    assert.equal(calls.some(([pid, signal]) => pid === -child.pid && signal && signal !== 0), false);
    assert.equal(activeProviderGroupIds().includes(child.pid), false);
    process.kill(child.pid, 0);
  } finally {
    forceKillPid(child.pid);
  }
});

test('shutdown still signals a provider group whose leader start time matches', { skip: process.platform !== 'linux' }, async () => {
  const child = spawnDetachedSleeper();

  try {
    await waitForGroupLeader(child.pid);
    noteActiveProviderGroup(child.pid);
    const calls = captureProcessKill(() => {
      killProviderGroupNow(child.pid);
    });
    assert.equal(calls.some(([pid, signal]) => pid === -child.pid && signal === 'SIGKILL'), true);
    await assertPidGone(child.pid);
  } finally {
    forceKillPid(child.pid);
    pruneDeadProviderGroups();
  }
});

test('linux proc stat start time is field 22, after the comm field', () => {
  const fields = ['S', '1', '42', '42', '0', '-1', '0', '0', '0', '0', '0', '0', '0', '0', '0', '20', '0', '1', '0', '999888'];
  assert.equal(fields.length, 20);
  assert.equal(parseProcStatStartTime(`42 (comm with spaces) ${fields.join(' ')}\n`), '999888');
  assert.equal(parseProcStatStartTime(`7 (na)me) ${fields.join(' ')}\n`), '999888');
  assert.equal(parseProcStatStartTime('no comm field'), null);
});

test('an extra SIGINT listener on the parent runs once', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-sigint-once-'));
  const providerScript = path.join(root, 'provider.cjs');
  const parentScript = path.join(root, 'parent.mjs');
  const pidFile = path.join(root, 'pid.json');
  const countFile = path.join(root, 'count.txt');
  await writeFile(providerScript, holdProviderScript(), 'utf8');
  await writeFile(parentScript, sigintOnceParentScript(), 'utf8');

  const parent = spawn(process.execPath, [parentScript, providerScript, pidFile, countFile], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  parent.stderr?.on('data', (chunk) => {
    stderr += chunk;
  });
  parent.stdout?.on('data', () => {});
  let providerPid = null;

  try {
    const info = await waitForJson(pidFile);
    providerPid = info.pid;
    assert.equal(typeof providerPid, 'number');
    process.kill(providerPid, 0);

    const exited = waitForProcessExit(parent, 2000);
    process.kill(parent.pid, 'SIGINT');
    const result = await exited;
    assert.equal(result.code, 0);
    assert.equal(result.signal, null);
    assert.equal(await readFile(countFile, 'utf8'), '1');
  } catch (error) {
    error.message += `\nparent stderr: ${stderr}`;
    throw error;
  } finally {
    try {
      if (parent.exitCode === null && parent.signalCode === null) process.kill(parent.pid, 'SIGKILL');
    } catch {
      // The parent has already exited.
    }
    if (providerPid) forceKillTree(providerPid);
    await rm(root, { force: true, recursive: true });
  }
});

test('SIGINT on the parent kills detached provider and grandchild processes', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-sigint-orphan-'));
  const providerScript = path.join(root, 'provider.cjs');
  const parentScript = path.join(root, 'parent.mjs');
  const pidFile = path.join(root, 'pids.json');
  await writeFile(providerScript, sigintProviderScript(), 'utf8');
  await writeFile(parentScript, sigintParentScript(), 'utf8');

  // SIGINT has to hit the process that spawned the detached provider, not this test runner.
  const parent = spawn(process.execPath, [parentScript, providerScript, pidFile], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  parent.stderr?.on('data', (chunk) => {
    stderr += chunk;
  });
  parent.stdout?.on('data', () => {});
  let pids = null;

  try {
    pids = await waitForJson(pidFile);
    assert.equal(typeof pids.provider, 'number');
    assert.equal(typeof pids.grandchild, 'number');
    process.kill(pids.provider, 0);
    process.kill(pids.grandchild, 0);

    const exited = waitForProcessExit(parent, 2000);
    process.kill(parent.pid, 'SIGINT');
    const result = await exited;
    assert.equal(result.code, null);
    assert.equal(result.signal, 'SIGINT');
    await assertPidGone(pids.provider);
    await assertPidGone(pids.grandchild);
  } catch (error) {
    error.message += `\nparent stderr: ${stderr}`;
    throw error;
  } finally {
    try {
      if (parent.exitCode === null && parent.signalCode === null) process.kill(parent.pid, 'SIGKILL');
    } catch {
      // The parent has already exited.
    }
    if (pids?.provider) forceKillTree(pids.provider);
    if (pids?.grandchild) forceKillPid(pids.grandchild);
    await rm(root, { force: true, recursive: true });
  }
});

test('timeout kills the process group when the child and grandchild ignore SIGTERM', { skip: process.platform === 'win32' }, async () => {
  await assertProcessTreeStopped({
    timeoutMs: 2000,
    killGraceMs: 250,
    expectedError: /timed out/
  });
});

test('cancel kills the process group when the child and grandchild ignore SIGTERM', { skip: process.platform === 'win32' }, async () => {
  const controller = new AbortController();
  await assertProcessTreeStopped({
    timeoutMs: 10000,
    killGraceMs: 250,
    signal: controller.signal,
    expectedError: /cancelled/,
    onReady: () => controller.abort()
  });
});

test('usePromptFile keeps the prompt file until the child exits after cancel', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-prompt-lifetime-'));
  const marker = path.join(root, 'marker.json');
  const scriptPath = path.join(root, 'hold-prompt.js');
  await writeFile(scriptPath, promptHoldScript(), 'utf8');
  const controller = new AbortController();
  const promise = runProviderProcess({
    command: process.execPath,
    args: [scriptPath, marker, '--prompt-file', PROMPT_FILE_PLACEHOLDER],
    input: 'keep this prompt until exit',
    usePromptFile: true,
    signal: controller.signal,
    timeoutMs: 10000,
    killGraceMs: 500
  });
  const captured = promise.then(
    (value) => ({ ok: true, value }),
    (failure) => ({ ok: false, error: failure })
  );
  let pid = null;

  try {
    const info = await waitForJson(marker);
    pid = info.pid;
    assert.equal(typeof info.promptPath, 'string');
    assert.equal(existsSync(info.promptPath), true);
    process.kill(info.pid, 0);

    controller.abort();
    assert.equal(existsSync(info.promptPath), true);

    if (process.platform !== 'win32') {
      await delay(80);
      assert.equal(existsSync(info.promptPath), true);
      process.kill(info.pid, 0);
    }

    const result = await captured;
    assert.equal(result.ok, false);
    assert.match(result.error.message, /cancelled/);
    assert.equal(existsSync(info.promptPath), false);
  } finally {
    controller.abort();
    if (pid) forceKillTree(pid);
    await captured;
    await rm(root, { force: true, recursive: true });
  }
});

async function assertProcessTreeStopped({ timeoutMs, killGraceMs, signal, expectedError, onReady }) {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-proc-tree-'));
  const pidFile = path.join(root, 'pids.json');
  const scriptPath = path.join(root, 'tree.js');
  await writeFile(scriptPath, processTreeScript(), 'utf8');
  const promise = runProviderProcess({
    command: process.execPath,
    args: [scriptPath, pidFile],
    timeoutMs,
    killGraceMs,
    signal
  });
  const captured = promise.then(
    (value) => ({ ok: true, value }),
    (failure) => ({ ok: false, error: failure })
  );
  let pids = null;

  try {
    pids = await waitForJson(pidFile);
    assert.equal(typeof pids.parent, 'number');
    assert.equal(typeof pids.child, 'number');
    process.kill(pids.parent, 0);
    process.kill(pids.child, 0);
    if (onReady) onReady(pids);

    const result = await captured;
    assert.equal(result.ok, false);
    assert.match(result.error.message, expectedError);
    await assertPidGone(pids.parent);
    await assertPidGone(pids.child);
  } finally {
    if (pids?.parent) forceKillTree(pids.parent);
    if (pids?.child) forceKillPid(pids.child);
    await captured;
    await rm(root, { force: true, recursive: true });
  }
}

async function assertLeaderlessGroupKilled(signal) {
  const root = await mkdtemp(path.join(tmpdir(), `chatpcb-${signal.toLowerCase()}-orphan-`));
  const providerScript = path.join(root, 'provider.cjs');
  const parentScript = path.join(root, 'parent.mjs');
  const pidFile = path.join(root, 'pids.json');
  const readyFile = path.join(root, 'ready.json');
  await writeFile(providerScript, exitingLeaderProviderScript(), 'utf8');
  await writeFile(parentScript, exitingLeaderParentScript(), 'utf8');

  // The signal has to hit the process that spawned the detached provider, not this test runner.
  // The ready file is written only after that parent has observed the leader exit, so the group
  // id would already have been dropped by the old leader-exit cleanup.
  const parent = spawn(process.execPath, [parentScript, providerScript, pidFile, readyFile], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  parent.stderr?.on('data', (chunk) => {
    stderr += chunk;
  });
  parent.stdout?.on('data', () => {});
  let pids = null;

  try {
    await waitForJson(readyFile);
    pids = JSON.parse(await readFile(pidFile, 'utf8'));
    assert.equal(typeof pids.provider, 'number');
    assert.equal(typeof pids.grandchild, 'number');
    assert.throws(() => process.kill(pids.provider, 0), { code: 'ESRCH' });
    process.kill(pids.grandchild, 0);

    const exited = waitForProcessExit(parent, 2000);
    process.kill(parent.pid, signal);
    const result = await exited;
    assert.equal(result.code, null);
    assert.equal(result.signal, signal);
    await assertPidGone(pids.grandchild);
  } catch (error) {
    error.message += `\nparent stderr: ${stderr}`;
    throw error;
  } finally {
    try {
      if (parent.exitCode === null && parent.signalCode === null) process.kill(parent.pid, 'SIGKILL');
    } catch {
      // The parent has already exited.
    }
    if (pids?.provider) forceKillTree(pids.provider);
    if (pids?.grandchild) forceKillPid(pids.grandchild);
    await rm(root, { force: true, recursive: true });
  }
}

async function observeExitedProviderGroup(mode) {
  const root = await mkdtemp(path.join(tmpdir(), `chatpcb-pgid-${mode}-`));
  const providerScript = path.join(root, 'provider.cjs');
  const runnerScript = path.join(root, 'runner.mjs');
  const pidFile = path.join(root, 'pids.json');
  const resultFile = path.join(root, 'result.json');
  await writeFile(providerScript, exitingLeaderProviderScript(), 'utf8');
  await writeFile(runnerScript, exitedProviderGroupRunnerScript(), 'utf8');
  const child = spawn(process.execPath, [runnerScript, providerScript, pidFile, resultFile, mode], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const output = collectProcessOutput(child);

  try {
    const result = await waitForProcessExit(child, 8000);
    let body = {};
    try {
      body = JSON.parse(await readFile(resultFile, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (result.code !== 0 || body.error) {
      throw new Error(`provider group observer exited ${result.code} signal ${result.signal}\n${body.error || ''}\n${output.stderr()}\n${output.stdout()}`);
    }
    return body;
  } catch (error) {
    error.message += `\nstderr: ${output.stderr()}\nstdout: ${output.stdout()}`;
    throw error;
  } finally {
    forceKillPid(child.pid);
    await rm(root, { force: true, recursive: true });
  }
}

function exitedProviderGroupRunnerScript() {
  const moduleUrl = JSON.stringify(new URL('../src/runtime/provider-process.js', import.meta.url).href);
  return String.raw`
import { readFileSync, writeFileSync } from 'node:fs';
import {
  activeProviderGroupIds,
  killActiveProviderGroups,
  pruneDeadProviderGroups,
  runProviderProcess
} from ${moduleUrl};

const [providerScript, pidFile, resultFile, mode] = process.argv.slice(2);
let grandchild = null;

try {
  await runProviderProcess({
    command: process.execPath,
    args: [providerScript, pidFile],
    timeoutMs: 5000
  });
  const pids = JSON.parse(readFileSync(pidFile, 'utf8'));
  grandchild = pids.grandchild;
  const trackedWhileGrandchildLives = activeProviderGroupIds().includes(pids.provider);
  let keptWhileGrandchildLives = null;
  if (mode === 'prune') {
    pruneDeadProviderGroups();
    keptWhileGrandchildLives = activeProviderGroupIds().includes(pids.provider);
  }
  process.kill(grandchild, 'SIGKILL');
  const started = Date.now();
  let groupGone = false;
  while (Date.now() - started < 2000) {
    try {
      process.kill(-pids.provider, 0);
    } catch (error) {
      if (error.code === 'ESRCH') {
        groupGone = true;
        break;
      }
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const trackedAfterGroupExit = activeProviderGroupIds().includes(pids.provider);
  const calls = [];
  const originalKill = process.kill;
  process.kill = (pid, signal) => {
    calls.push([pid, signal]);
    return originalKill.call(process, pid, signal);
  };
  try {
    if (mode === 'kill') killActiveProviderGroups();
    else pruneDeadProviderGroups();
  } finally {
    process.kill = originalKill;
  }
  const signalled = calls.some(([pid, signal]) => pid === -pids.provider && signal && signal !== 0);
  writeFileSync(resultFile, JSON.stringify({
    trackedWhileGrandchildLives,
    keptWhileGrandchildLives,
    groupGone,
    trackedAfterGroupExit,
    signalled,
    trackedAfter: activeProviderGroupIds().includes(pids.provider)
  }));
} catch (error) {
  writeFileSync(resultFile, JSON.stringify({ error: error.stack || String(error) }));
  process.exitCode = 1;
} finally {
  if (grandchild) {
    try { process.kill(grandchild, 'SIGKILL'); } catch { /* already exited */ }
  }
}
`;
}

function intervalPruneRunnerScript() {
  const moduleUrl = JSON.stringify(new URL('../src/runtime/provider-process.js', import.meta.url).href);
  return String.raw`
import { mock } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import {
  activeProviderGroupIds,
  noteActiveProviderGroup,
  PROVIDER_GROUP_PRUNE_MS,
  providerGroupPruneScheduled
} from ${moduleUrl};

const resultFile = process.argv[2];
let sleeper = null;

function unusedPid() {
  for (let pid = 2000000001; pid < 2000000100; pid += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return pid;
    }
  }
  throw new Error('no unused pid');
}

function waitForLeader(pid) {
  const started = Date.now();
  while (Date.now() - started < 2000) {
    try {
      process.kill(-pid, 0);
      if (process.platform !== 'linux') return;
      const stat = readFileSync('/proc/' + pid + '/stat', 'utf8');
      const pgrp = Number(stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/)[2]);
      if (pgrp !== pid) throw new Error('sleeper is not a process group leader');
      return;
    } catch (error) {
      if (error.code !== 'ESRCH' && error.code !== 'ENOENT') throw error;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  throw new Error('leader not ready');
}

try {
  sleeper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], {
    detached: true,
    stdio: 'ignore'
  });
  waitForLeader(sleeper.pid);
  mock.timers.enable({ apis: ['setInterval'] });
  const stalePid = unusedPid();
  noteActiveProviderGroup(stalePid);
  noteActiveProviderGroup(sleeper.pid);
  const trackedStale = activeProviderGroupIds().includes(stalePid);
  const trackedLive = activeProviderGroupIds().includes(sleeper.pid);
  const scheduledWhileTracked = providerGroupPruneScheduled();
  mock.timers.tick(PROVIDER_GROUP_PRUNE_MS - 1);
  const staleBefore = activeProviderGroupIds().includes(stalePid);
  const liveBefore = activeProviderGroupIds().includes(sleeper.pid);
  mock.timers.tick(1);
  const staleAfter = activeProviderGroupIds().includes(stalePid);
  const liveAfter = activeProviderGroupIds().includes(sleeper.pid);
  const scheduledWhileLive = providerGroupPruneScheduled();
  process.kill(-sleeper.pid, 'SIGKILL');
  // setTimeout, not a blocking wait: the sleeper is this process's child, and a
  // zombie still answers kill(-pid, 0) until the event loop reaps it.
  const groupGone = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(false), 2000);
    const poll = () => {
      try {
        process.kill(-sleeper.pid, 0);
        setTimeout(poll, 20);
      } catch (error) {
        clearTimeout(timer);
        if (error.code === 'ESRCH') resolve(true);
        else reject(error);
      }
    };
    poll();
  });
  mock.timers.tick(PROVIDER_GROUP_PRUNE_MS);
  const liveAfterExit = activeProviderGroupIds().includes(sleeper.pid);
  const scheduledAfterEmpty = providerGroupPruneScheduled();
  writeFileSync(resultFile, JSON.stringify({
    trackedStale,
    trackedLive,
    scheduledWhileTracked,
    staleBefore,
    liveBefore,
    staleAfter,
    liveAfter,
    scheduledWhileLive,
    groupGone,
    liveAfterExit,
    scheduledAfterEmpty
  }));
} catch (error) {
  try {
    writeFileSync(resultFile, JSON.stringify({ error: error.stack || String(error) }));
  } catch {
    // The result path may be missing if startup failed.
  }
  process.exitCode = 1;
} finally {
  try { mock.timers.reset(); } catch { /* timers were not enabled */ }
  if (sleeper?.pid) {
    try { process.kill(sleeper.pid, 'SIGKILL'); } catch { /* already exited */ }
  }
}
`;
}

function unrefPruneTimerScript() {
  const moduleUrl = JSON.stringify(new URL('../src/runtime/provider-process.js', import.meta.url).href);
  return String.raw`
import { noteActiveProviderGroup } from ${moduleUrl};

let pid = null;
for (let candidate = 2000000001; candidate < 2000000100; candidate += 1) {
  try {
    process.kill(candidate, 0);
  } catch (error) {
    if (error.code === 'ESRCH') {
      pid = candidate;
      break;
    }
  }
}
if (pid === null) throw new Error('no unused pid');
noteActiveProviderGroup(pid);
`;
}

function spawnDetachedSleeper() {
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], {
    detached: true,
    stdio: 'ignore'
  });
}

async function waitForGroupLeader(pid) {
  const started = Date.now();
  while (Date.now() - started < 2000) {
    try {
      process.kill(-pid, 0);
      if (process.platform !== 'linux') return;
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const pgrp = Number(stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/)[2]);
      if (pgrp === pid) return;
    } catch (error) {
      if (error.code !== 'ESRCH' && error.code !== 'ENOENT') throw error;
    }
    await delay(20);
  }
  throw new Error(`Process ${pid} did not become its own process group leader.`);
}

function captureProcessKill(fn) {
  const calls = [];
  const original = process.kill;
  process.kill = (pid, signal) => {
    calls.push([pid, signal]);
    return original.call(process, pid, signal);
  };
  try {
    fn();
  } finally {
    process.kill = original;
  }
  return calls;
}

function collectProcessOutput(child) {
  let stderr = '';
  let stdout = '';
  child.stderr?.on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdout?.on('data', (chunk) => {
    stdout += chunk;
  });
  return {
    stderr: () => stderr,
    stdout: () => stdout
  };
}

function exitingLeaderParentScript() {
  const moduleUrl = new URL('../src/runtime/provider-process.js', import.meta.url).href;
  return [
    `import { writeFileSync } from 'node:fs';`,
    `import { runProviderProcess } from ${JSON.stringify(moduleUrl)};`,
    'const [providerScript, pidFile, readyFile] = process.argv.slice(2);',
    'await runProviderProcess({',
    '  command: process.execPath,',
    '  args: [providerScript, pidFile],',
    '  timeoutMs: 30000',
    '});',
    "writeFileSync(readyFile, JSON.stringify({ ready: true }));",
    'setInterval(() => {}, 1000);',
    ''
  ].join('\n');
}

function exitingLeaderProviderScript() {
  return [
    "const { spawn } = require('node:child_process');",
    "const fs = require('node:fs');",
    'const pidFile = process.argv[2];',
    'const grandchild = [',
    "  'process.on(\"SIGTERM\", () => {});',",
    "  'process.on(\"SIGINT\", () => {});',",
    "  'process.on(\"SIGHUP\", () => {});',",
    "  'setInterval(() => {}, 1000);'",
    "].join('');",
    "const child = spawn(process.execPath, ['-e', grandchild], { stdio: 'ignore' });",
    'fs.writeFileSync(pidFile, JSON.stringify({ provider: process.pid, grandchild: child.pid }));',
    'process.exit(0);',
    ''
  ].join('\n');
}

function sigintOnceParentScript() {
  const moduleUrl = new URL('../src/runtime/provider-process.js', import.meta.url).href;
  return [
    `import { writeFileSync } from 'node:fs';`,
    `import { runProviderProcess } from ${JSON.stringify(moduleUrl)};`,
    'const [providerScript, pidFile, countFile] = process.argv.slice(2);',
    'let calls = 0;',
    "process.on('SIGINT', () => {",
    '  calls += 1;',
    '  writeFileSync(countFile, String(calls));',
    '});',
    'await runProviderProcess({',
    '  command: process.execPath,',
    '  args: [providerScript, pidFile],',
    '  timeoutMs: 30000',
    '});',
    ''
  ].join('\n');
}

function holdProviderScript() {
  return [
    "const fs = require('node:fs');",
    'fs.writeFileSync(process.argv[2], JSON.stringify({ pid: process.pid }));',
    'setInterval(() => {}, 1000);',
    ''
  ].join('\n');
}

function sigintParentScript() {
  const moduleUrl = new URL('../src/runtime/provider-process.js', import.meta.url).href;
  return [
    `import { runProviderProcess } from ${JSON.stringify(moduleUrl)};`,
    'const [providerScript, pidFile] = process.argv.slice(2);',
    'await runProviderProcess({',
    '  command: process.execPath,',
    '  args: [providerScript, pidFile],',
    '  timeoutMs: 30000',
    '});',
    ''
  ].join('\n');
}

function sigintProviderScript() {
  return [
    "const { spawn } = require('node:child_process');",
    "const fs = require('node:fs');",
    'const pidFile = process.argv[2];',
    'const grandchild = [',
    "  'process.on(\"SIGTERM\", () => {});',",
    "  'process.on(\"SIGINT\", () => {});',",
    "  'setInterval(() => {}, 1000);'",
    "].join('');",
    "const child = spawn(process.execPath, ['-e', grandchild], { stdio: 'ignore' });",
    'fs.writeFileSync(pidFile, JSON.stringify({ provider: process.pid, grandchild: child.pid }));',
    'setInterval(() => {}, 1000);',
    ''
  ].join('\n');
}

function processTreeScript() {
  return [
    "const fs = require('fs');",
    "const { spawn } = require('child_process');",
    'const pidFile = process.argv[2];',
    'const grandchild = [',
    "  'process.on(\"SIGTERM\", () => {});',",
    "  'process.on(\"SIGINT\", () => {});',",
    "  'setInterval(() => {}, 1000);'",
    "].join('');",
    "process.on('SIGTERM', () => {});",
    "process.on('SIGINT', () => {});",
    "const child = spawn(process.execPath, ['-e', grandchild], { stdio: 'ignore' });",
    'fs.writeFileSync(pidFile, JSON.stringify({ parent: process.pid, child: child.pid }));',
    'setInterval(() => {}, 1000);',
    ''
  ].join('\n');
}

function promptHoldScript() {
  return [
    "const fs = require('fs');",
    'const marker = process.argv[2];',
    'const args = process.argv.slice(2);',
    "const promptIndex = args.indexOf('--prompt-file');",
    'const promptPath = args[promptIndex + 1];',
    'if (!promptPath || !fs.existsSync(promptPath)) process.exit(2);',
    "process.on('SIGTERM', () => {});",
    "process.on('SIGINT', () => {});",
    'fs.writeFileSync(marker, JSON.stringify({ promptPath, pid: process.pid }));',
    'setInterval(() => {}, 1000);',
    ''
  ].join('\n');
}

function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Process did not exit within ${timeoutMs}ms.`));
    }, timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function waitForJson(filePath) {
  const started = Date.now();
  while (Date.now() - started < 4000) {
    try {
      return JSON.parse(await readFile(filePath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await delay(20);
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

async function assertPidGone(pid) {
  const started = Date.now();
  while (Date.now() - started < 2000) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      assert.equal(error.code, 'ESRCH');
      return;
    }
    await delay(25);
  }
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
}

function forceKillTree(pid) {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // The process group has already exited.
  }
  forceKillPid(pid);
}

function forceKillPid(pid) {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // The process has already exited.
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function grokFixture(name) {
  return fileURLToPath(new URL(`./fixtures/grok/${name}`, import.meta.url));
}

function runProviderStdout(stdout, options = {}) {
  return runProviderProcess({
    command: process.execPath,
    args: ['-e', `process.stdout.write(${JSON.stringify(stdout)})`],
    timeoutMs: 2000,
    ...options
  });
}
