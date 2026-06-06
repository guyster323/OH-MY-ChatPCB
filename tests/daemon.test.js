import assert from 'node:assert/strict';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { dispatchToolCall, startDaemon } from '../src/runtime/agent-daemon.js';
import { createEnvelope } from '../src/runtime/envelope.js';

test('daemon dispatches schematic.generate tool calls to the project generator', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-daemon-'));

  try {
    const result = await dispatchToolCall({
      name: 'schematic.generate',
      args: {
        projectDir: root,
        prompt: 'RP2040 board with USB-C power, I2C connector, reset button, and LED.'
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.result.spec.mcu.family, 'RP2040');
    assert.match(result.result.files.schematic, /\.kicad_sch$/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('daemon rejects unknown tool calls with a typed failure', async () => {
  const result = await dispatchToolCall({
    name: 'board.autoroute',
    args: {}
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'UNKNOWN_TOOL');
});

test('daemon dispatches schematic.patch as an approval-gated preview', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-daemon-patch-'));

  try {
    const generated = await dispatchToolCall({
      name: 'schematic.generate',
      args: {
        projectDir: root,
        prompt: 'RP2040 board with USB-C power, I2C connector, reset button, and LED.'
      }
    });
    const before = await readFile(generated.result.files.spec, 'utf8');

    const result = await dispatchToolCall({
      name: 'schematic.patch',
      args: {
        projectDir: root,
        prompt: 'STM32 board with USB-C power, 3.3V regulator, I2C connector, UART header, reset button, boot button, and LED.'
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.result.requiresApproval, true);
    assert.equal(result.result.applied, false);
    assert.match(result.result.diff, /--- chatpcb_mcu_peripheral.chatpcb.json/);
    assert.equal(await readFile(generated.result.files.spec, 'utf8'), before);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('daemon reports provider availability through provider.status', async () => {
  const result = await dispatchToolCall(
    {
      name: 'provider.status',
      args: {
        provider: 'codex'
      }
    },
    {
      checkProviderAvailabilityImpl: async ({ provider }) => ({
        provider,
        command: 'codex',
        available: true,
        status: 'available'
      })
    }
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.result, {
    provider: 'codex',
    command: 'codex',
    available: true,
    status: 'available'
  });
});

test('daemon lists provider definitions through provider.list', async () => {
  const result = await dispatchToolCall({
    name: 'provider.list',
    args: {}
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.result.providers.map((provider) => provider.id),
    ['codex', 'claude', 'copilot']
  );
});

test('daemon invokes a selected provider and executes emitted tool calls', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-provider-invoke-'));
  const providerCalls = [];

  try {
    const result = await dispatchToolCall(
      {
        id: 'call_provider_generate',
        name: 'provider.invoke',
        args: {
          provider: 'codex',
          projectDir: root,
          prompt: 'Generate an STM32 board from chat.'
        }
      },
      {
        checkProviderAvailabilityImpl: async ({ provider }) => ({
          provider,
          command: 'codex',
          available: true,
          status: 'available'
        }),
        runProviderProcessImpl: async (options) => {
          providerCalls.push(options);
          return {
            exitCode: 0,
            stderr: '',
            events: [
              createEnvelope('agent.delta', { text: 'Drafting from Codex.' }),
              createEnvelope('tool.call', {
                id: 'call_provider_generate',
                name: 'schematic.generate',
                args: {
                  prompt: 'STM32 board with USB-C power, I2C connector, reset button, and status LED.'
                }
              })
            ]
          };
        }
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.result.providerInvocation, true);
    assert.equal(result.result.provider, 'codex');
    assert.equal(providerCalls[0].command, 'codex');
    assert.match(providerCalls[0].input, /Generate an STM32 board from chat\./);
    assert.match(providerCalls[0].input, /Project directory:/);
    assert.deepEqual(
      result.result.events.map((event) => event.type),
      ['agent.delta', 'tool.call']
    );
    assert.equal(result.result.toolResults.length, 1);
    assert.equal(result.result.toolResults[0].ok, true);
    assert.equal(result.result.toolResults[0].result.spec.mcu.family, 'STM32');
    assert.match(result.result.toolResults[0].result.files.schematic, /\.kicad_sch$/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('daemon cancels an in-flight provider invocation', async () => {
  const controllers = new Map();
  let observedAbort = false;

  const invokePromise = dispatchToolCall(
    {
      id: 'call_provider_slow',
      name: 'provider.invoke',
      args: {
        provider: 'codex',
        prompt: 'Slow provider request.'
      }
    },
    {
      providerControllers: controllers,
      checkProviderAvailabilityImpl: async ({ provider }) => ({
        provider,
        command: 'codex',
        available: true,
        status: 'available'
      }),
      runProviderProcessImpl: async ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            observedAbort = true;
            reject(new Error('Provider process cancelled.'));
          });
        })
    }
  );

  await waitFor(() => controllers.has('call_provider_slow'));

  const cancelResult = await dispatchToolCall(
    {
      name: 'provider.cancel',
      args: {
        id: 'call_provider_slow'
      }
    },
    {
      providerControllers: controllers
    }
  );

  assert.equal(cancelResult.ok, true);
  assert.equal(cancelResult.result.cancelled, true);
  await assert.rejects(invokePromise, /cancelled/);
  assert.equal(observedAbort, true);
  assert.equal(controllers.has('call_provider_slow'), false);
});

test('daemon websocket cancels an in-flight provider invocation by id', async () => {
  let observedAbort = false;
  let providerStarted;
  const startedPromise = new Promise((resolve) => {
    providerStarted = resolve;
  });

  const daemon = await startDaemon({
    port: 0,
    dispatchOptions: {
      checkProviderAvailabilityImpl: async ({ provider }) => ({
        provider,
        command: 'codex',
        available: true,
        status: 'available'
      }),
      runProviderProcessImpl: async ({ signal }) =>
        new Promise((_resolve, reject) => {
          providerStarted();
          signal.addEventListener('abort', () => {
            observedAbort = true;
            reject(new Error('Provider process cancelled.'));
          });
        })
    }
  });

  try {
    const cancelResult = await new Promise((resolve, reject) => {
      const socket = new WebSocket(`${daemon.url.replace('http:', 'ws:')}/ws`);
      const timer = setTimeout(() => reject(new Error('websocket provider cancel timed out')), 2000);

      socket.addEventListener('open', () => {
        socket.send(
          JSON.stringify(
            createEnvelope('tool.call', {
              id: 'call_ws_provider_slow',
              name: 'provider.invoke',
              args: {
                provider: 'codex',
                prompt: 'Slow provider request.'
              }
            })
          )
        );
      });

      socket.addEventListener('message', (event) => {
        const envelope = JSON.parse(event.data);
        if (envelope.type !== 'tool.result' || envelope.payload.id !== 'call_ws_provider_cancel') return;
        clearTimeout(timer);
        socket.close();
        resolve(envelope.payload);
      });

      socket.addEventListener('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });

      startedPromise.then(() => {
        socket.send(
          JSON.stringify(
            createEnvelope('tool.call', {
              id: 'call_ws_provider_cancel',
              name: 'provider.cancel',
              args: {
                id: 'call_ws_provider_slow'
              }
            })
          )
        );
      });
    });

    assert.equal(cancelResult.ok, true);
    assert.equal(cancelResult.result.cancelled, true);
    assert.equal(observedAbort, true);
  } finally {
    await daemon.close();
  }
});

async function waitFor(predicate, timeoutMs = 1000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('daemon exposes health and websocket status endpoints for the WebView panel', async () => {
  const daemon = await startDaemon({ port: 0 });

  try {
    const health = await fetch(`${daemon.url}/health`).then((response) => response.json());
    assert.equal(health.ok, true);
    assert.equal(health.websocket, '/ws');

    const status = await new Promise((resolve, reject) => {
      const socket = new WebSocket(`${daemon.url.replace('http:', 'ws:')}/ws`);
      socket.addEventListener('message', (event) => {
        socket.close();
        resolve(JSON.parse(event.data));
      });
      socket.addEventListener('error', reject);
      setTimeout(() => reject(new Error('websocket status timed out')), 1000);
    });

    assert.equal(status.type, 'system.status');
    assert.equal(status.payload.service, 'chatpcb-agentd');
  } finally {
    await daemon.close();
  }
});

test('daemon websocket transports approved patch results with large diffs', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-daemon-ws-large-'));
  const daemon = await startDaemon({ port: 0 });

  try {
    const generated = await dispatchToolCall({
      name: 'schematic.generate',
      args: {
        projectDir: root,
        prompt:
          'STM32 board with USB-C power, 3.3V regulator, I2C sensor connector, UART debug header, reset button, and status LED.'
      }
    });
    await appendFile(generated.result.files.schematic, `${'; oversized diff fixture\n'.repeat(4000)}`, 'utf8');

    const result = await new Promise((resolve, reject) => {
      const socket = new WebSocket(`${daemon.url.replace('http:', 'ws:')}/ws`);
      const timer = setTimeout(() => reject(new Error('websocket approved patch timed out')), 10000);

      socket.addEventListener('open', () => {
        socket.send(
          JSON.stringify({
            version: 1,
            id: 'evt_large_patch',
            type: 'tool.call',
            createdAt: new Date().toISOString(),
            payload: {
              id: 'call_large_patch',
              name: 'schematic.patch',
              args: {
                projectDir: root,
                prompt: 'RP2040 board with USB-C power, I2C connector, reset button, and status LED.',
                approved: true
              }
            }
          })
        );
      });

      socket.addEventListener('message', (event) => {
        const envelope = JSON.parse(event.data);
        if (envelope.type !== 'tool.result') return;
        clearTimeout(timer);
        socket.close();
        resolve(envelope.payload);
      });
      socket.addEventListener('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    assert.equal(result.ok, true);
    assert.equal(result.result.applied, true);
    assert.equal(result.result.validation.ok, true);
    assert.ok(result.result.diff.length > 65535);
  } finally {
    await daemon.close();
    await rm(root, { force: true, recursive: true });
  }
});

test('daemon rejects when the requested port is already in use', async () => {
  const daemon = await startDaemon({ port: 0 });

  try {
    await assert.rejects(
      Promise.race([
        startDaemon({ port: daemon.port }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('startDaemon did not reject port collision')), 500))
      ]),
      /EADDRINUSE/
    );
  } finally {
    await daemon.close();
  }
});
