import assert from 'node:assert/strict';
import test from 'node:test';

import { runProviderProcess } from '../src/runtime/provider-process.js';

test('parses provider stdout into deltas and tool calls', async () => {
  const script = [
    'console.log("Drafting circuit.");',
    'console.log(JSON.stringify({type:"tool.call", payload:{id:"1", name:"schematic.generate", args:{mcu:"STM32"}}}));',
    'console.log(JSON.stringify({type:"tool.result", payload:{id:"1", ok:true}}));'
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
    ['agent.delta', 'tool.call', 'tool.result']
  );
  assert.equal(transcript.events[1].payload.name, 'schematic.generate');
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
