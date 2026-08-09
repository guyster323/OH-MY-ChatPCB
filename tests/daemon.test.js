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

test('daemon creates a named project and runs provider generation with ERC validation', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-project-request-'));

  try {
    const created = await dispatchToolCall({
      name: 'project.create',
      args: { workspaceRoot, projectName: '가스 센서 보드 01' }
    });
    const result = await dispatchToolCall(
      {
        id: 'call_project_request_generate',
        name: 'project.request',
        args: {
          provider: 'codex',
          projectDir: created.result.projectDir,
          prompt: '가스 센서용 STM32 보드와 USB-C 전원을 만들어 주세요.'
        }
      },
      providerOptions({
        events: [
          createEnvelope('agent.delta', { text: '가스 센서 보드를 생성하겠습니다.' }),
          createEnvelope('tool.call', {
            id: 'call_generated_schematic',
            name: 'schematic.generate',
            args: { prompt: 'STM32 board with USB-C power, I2C gas sensor connector, reset button, and status LED.' }
          })
        ]
      })
    );

    assert.equal(created.ok, true);
    assert.equal(result.ok, true);
    assert.equal(result.result.operation, 'generated');
    assert.equal(result.result.validation.erc.errorCount, 0);
    assert.ok(result.result.files.schematic.endsWith('.kicad_sch'));
    assert.deepEqual(result.result.providerEvents.map((event) => event.type), ['agent.delta', 'tool.call']);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test('daemon falls back to bounded generation then approved patch after a successful provider transcript without calls', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-project-fallback-'));

  try {
    const created = await dispatchToolCall({
      name: 'project.create',
      args: { workspaceRoot, projectName: 'Fallback Board' }
    });
    const first = await dispatchToolCall(
      {
        id: 'call_project_request_first',
        name: 'project.request',
        args: { provider: 'codex', projectDir: created.result.projectDir, prompt: 'RP2040 board with USB-C power and I2C connector.' }
      },
      providerOptions({ events: [createEnvelope('agent.delta', { text: 'Generating locally.' })] })
    );
    const second = await dispatchToolCall(
      {
        id: 'call_project_request_second',
        name: 'project.request',
        args: { provider: 'codex', projectDir: created.result.projectDir, prompt: 'RP2040 board with USB-C power, I2C connector, reset button, and LED.' }
      },
      providerOptions({ events: [createEnvelope('agent.delta', { text: 'Patching locally.' })] })
    );

    assert.equal(first.ok, true);
    assert.equal(first.result.operation, 'generated');
    assert.equal(second.ok, true);
    assert.equal(second.result.operation, 'patched');
    assert.equal(second.result.approved, true);
    assert.equal(second.result.applied, true);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test('daemon confines provider-emitted project paths to the active project.request directory', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-project-confinement-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'chatpcb-project-outside-'));

  try {
    const created = await dispatchToolCall({
      name: 'project.create',
      args: { workspaceRoot, projectName: 'Confined Board' }
    });
    const result = await dispatchToolCall(
      {
        id: 'call_project_request_confined',
        name: 'project.request',
        args: { provider: 'codex', projectDir: created.result.projectDir, prompt: 'Create an RP2040 sensor board.' }
      },
      providerOptions({
        events: [
          createEnvelope('tool.call', {
            id: 'call_escape_attempt',
            name: 'schematic.generate',
            args: {
              projectDir: outside,
              prompt: 'RP2040 board with USB-C power and I2C connector.'
            }
          })
        ]
      })
    );

    assert.equal(result.ok, true);
    assert.equal(result.result.files.spec, path.join(created.result.projectDir, 'chatpcb_mcu_peripheral.chatpcb.json'));
    await assert.rejects(() => readFile(path.join(outside, 'chatpcb_mcu_peripheral.chatpcb.json'), 'utf8'), { code: 'ENOENT' });
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
    await rm(outside, { force: true, recursive: true });
  }
});

test('daemon retains the last generation or patch result after later provider tools', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-project-multi-tool-'));

  try {
    const result = await dispatchToolCall(
      {
        id: 'call_project_request_multi_tool',
        name: 'project.request',
        args: { provider: 'codex', projectDir: root, prompt: 'Create an STM32 board.' }
      },
      providerOptions({
        events: [
          createEnvelope('tool.call', {
            id: 'call_generate_first',
            name: 'schematic.generate',
            args: { prompt: 'STM32 board with USB-C power, I2C connector, reset button, and status LED.' }
          }),
          createEnvelope('tool.call', {
            id: 'call_validate_last',
            name: 'validate.erc',
            args: {}
          })
        ]
      })
    );

    assert.equal(result.ok, true);
    assert.ok(result.result.files.schematic.endsWith('.kicad_sch'));
    assert.ok(result.result.files.spec.endsWith('.chatpcb.json'));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('daemon does not fall back after provider parse, cancellation, or non-zero failures', async () => {
  const failures = [
    { name: 'parse', provider: async () => { throw new Error('Provider parse failure.'); }, error: /parse failure/ },
    { name: 'cancellation', provider: async () => { throw new Error('Provider process cancelled.'); }, error: /cancelled/ },
    { name: 'non-zero exit', provider: async () => ({ exitCode: 1, stderr: '', events: [] }), error: /exited with code 1/ }
  ];

  for (const failure of failures) {
    const root = await mkdtemp(path.join(tmpdir(), `chatpcb-project-provider-${failure.name}-`));
    try {
      await assert.rejects(
        () => dispatchToolCall(
          {
            id: `call_project_request_${failure.name}`,
            name: 'project.request',
            args: { provider: 'codex', projectDir: root, prompt: 'Create an RP2040 board.' }
          },
          providerOptions({ runProviderProcessImpl: failure.provider })
        ),
        failure.error
      );
      await assert.rejects(() => readFile(path.join(root, 'chatpcb_mcu_peripheral.chatpcb.json'), 'utf8'), { code: 'ENOENT' });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }
});

test('daemon restores existing project artifacts when automatic ERC validation fails', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-project-rollback-'));

  try {
    const generated = await dispatchToolCall({
      name: 'schematic.generate',
      args: { projectDir: root, prompt: 'RP2040 board with USB-C power and I2C connector.' }
    });
    const before = await readFile(generated.result.files.spec, 'utf8');
    const result = await dispatchToolCall(
      {
        id: 'call_project_request_rollback',
        name: 'project.request',
        args: { provider: 'codex', projectDir: root, prompt: 'STM32 board with USB-C power and UART header.' }
      },
      providerOptions({
        events: [
          createEnvelope('tool.call', {
            id: 'call_unsafe_regenerate',
            name: 'schematic.generate',
            args: { prompt: 'STM32 board with USB-C power and UART header.' }
          })
        ],
        validation: { ok: false, skipped: false, erc: { errorCount: 1, warningCount: 0, byType: { test: 1 } } }
      })
    );

    assert.equal(result.ok, true);
    assert.equal(result.result.validation.erc.errorCount, 1);
    assert.equal(await readFile(generated.result.files.spec, 'utf8'), before);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('daemon automatically approves a provider-emitted patch during project.request', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-provider-patch-'));

  try {
    await dispatchToolCall({
      name: 'schematic.generate',
      args: { projectDir: root, prompt: 'RP2040 board with USB-C power and I2C connector.' }
    });
    const result = await dispatchToolCall(
      {
        id: 'call_project_request_patch',
        name: 'project.request',
        args: { provider: 'codex', projectDir: root, prompt: 'Add reset button and status LED.' }
      },
      providerOptions({
        events: [
          createEnvelope('tool.call', {
            id: 'call_provider_patch',
            name: 'schematic.patch',
            args: { prompt: 'RP2040 board with USB-C power, I2C connector, reset button, and status LED.' }
          })
        ]
      })
    );

    assert.equal(result.ok, true);
    assert.equal(result.result.approved, true);
    assert.equal(result.result.applied, true);
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

function providerOptions({
  events = [],
  validation = { ok: true, skipped: false, erc: { errorCount: 0, warningCount: 0, byType: {} } },
  runProviderProcessImpl = async () => ({ exitCode: 0, stderr: '', events })
}) {
  return {
    checkProviderAvailabilityImpl: async ({ provider }) => ({
      provider,
      command: 'codex',
      available: true,
      status: 'available'
    }),
    runProviderProcessImpl,
    validateProjectImpl: async () => validation
  };
}

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
