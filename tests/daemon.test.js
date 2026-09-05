import assert from 'node:assert/strict';
import { appendFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { dispatchToolCall, startDaemon } from '../src/runtime/agent-daemon.js';
import { createPatchApprovalRegistry } from '../src/runtime/patch-approval-registry.js';
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

test('daemon forwards project inspection adapter definitions to its injectable implementation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-daemon-inspect-'));
  const analyzerAdapters = [{ id: 'fixture-analyzer', command: 'fixture-analyzer', version: '1.0.0', sha256: 'a'.repeat(64) }];
  let received;

  try {
    const result = await dispatchToolCall(
      { name: 'project.inspect', args: { projectDir: root, analyzerAdapters } },
      {
        inspectProjectImpl: async (options) => {
          received = options;
          return { ok: true, inspection: { projectDigest: 'abc' } };
        }
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.result.inspection.projectDigest, 'abc');
    assert.deepEqual(received, { projectDir: root, kicadCliPath: undefined, analyzerAdapters });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('daemon strips nested provider analyzer definitions unless trusted outer definitions are supplied', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-daemon-analyzer-boundary-'));
  const nested = [{ id: 'nested-untrusted', namespace: 'external.nested', version: '1' }];
  const trusted = [{ id: 'trusted-outer', namespace: 'external.trusted', version: '1' }];
  const received = [];

  try {
    const options = {
      checkProviderAvailabilityImpl: async ({ provider }) => ({ provider, command: 'codex', available: true, status: 'available' }),
      runProviderProcessImpl: async () => ({
        exitCode: 0,
        stderr: '',
        events: [createEnvelope('tool.call', {
          id: 'call_nested_inspect',
          name: 'project.inspect',
          args: { analyzerAdapters: nested }
        })]
      }),
      inspectProjectImpl: async (args) => {
        received.push(args);
        return { ok: true, inspection: { projectDigest: 'fixture' } };
      }
    };

    const withoutOuter = await dispatchToolCall({
      id: 'call_without_outer_analyzers',
      name: 'provider.invoke',
      args: { provider: 'codex', projectDir: root, prompt: 'Inspect this project.' }
    }, options);
    const withOuter = await dispatchToolCall({
      id: 'call_with_outer_analyzers',
      name: 'provider.invoke',
      args: { provider: 'codex', projectDir: root, prompt: 'Inspect this project.', analyzerAdapters: trusted }
    }, options);

    assert.equal(withoutOuter.ok, true);
    assert.equal(withOuter.ok, true);
    assert.equal(received.length, 2);
    assert.equal(received[0].analyzerAdapters, undefined);
    assert.deepEqual(received[1].analyzerAdapters, trusted);
    assert.notDeepEqual(received[1].analyzerAdapters, nested);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('daemon strips nested analyzer definitions from provider validation aliases and applies only trusted outer definitions', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-daemon-validation-boundary-'));
  const nested = [{ id: 'nested-validation', namespace: 'external.nested', version: '1' }];
  const trusted = [{ id: 'trusted-validation', namespace: 'external.trusted', version: '1' }];
  const received = [];

  try {
    const options = {
      checkProviderAvailabilityImpl: async ({ provider }) => ({ provider, command: 'codex', available: true, status: 'available' }),
      runProviderProcessImpl: async () => ({
        exitCode: 0,
        stderr: '',
        events: [
          createEnvelope('tool.call', { id: 'call_nested_erc', name: 'validate.erc', args: { analyzerAdapters: nested } }),
          createEnvelope('tool.call', { id: 'call_nested_drc', name: 'validate.drc', args: { analyzerAdapters: nested } })
        ]
      }),
      inspectProjectImpl: async (args) => {
        received.push(args);
        return { ok: true, inspection: { projectDigest: 'fixture' } };
      }
    };
    const withoutOuter = await dispatchToolCall({
      id: 'call_provider_validation_aliases_without_outer',
      name: 'provider.invoke',
      args: { provider: 'codex', projectDir: root, prompt: 'Validate this project.' }
    }, options);
    const withOuter = await dispatchToolCall({
      id: 'call_provider_validation_aliases_with_outer',
      name: 'provider.invoke',
      args: { provider: 'codex', projectDir: root, prompt: 'Validate this project.', analyzerAdapters: trusted }
    }, options);

    assert.equal(withoutOuter.ok, true);
    assert.equal(withOuter.ok, true);
    assert.equal(received.length, 4);
    assert.deepEqual(received.map((args) => args.analyzerAdapters), [undefined, undefined, trusted, trusted]);
    assert.equal(withoutOuter.result.toolResults.every((toolResult) => toolResult.ok), true);
    assert.equal(withOuter.result.toolResults.every((toolResult) => toolResult.ok), true);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('daemon dispatches board-level DRC validation', async () => {
  const calls = [];
  const result = await dispatchToolCall(
    {
      name: 'validate.drc',
      args: {
        projectDir: 'C:/workspace/demo',
        kicadCliPath: 'C:/KiCad/bin/kicad-cli.exe'
      }
    },
    {
      validateBoardImpl: async (args) => {
        calls.push(args);
        return {
          ok: false,
          skipped: false,
          report: 'C:/workspace/demo/chatpcb-drc.json',
          drc: {
            violationCount: 1,
            unconnectedCount: 2,
            byType: { clearance: 1, unconnected_items: 2 }
          }
        };
      }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.result.ok, false);
  assert.deepEqual(result.result.drc, {
    violationCount: 1,
    unconnectedCount: 2,
    byType: { clearance: 1, unconnected_items: 2 }
  });
  assert.deepEqual(calls, [
    {
      projectDir: 'C:/workspace/demo',
      kicadCliPath: 'C:/KiCad/bin/kicad-cli.exe'
    }
  ]);
});

test('daemon returns provider board validation through a disposable inspection result', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-provider-drc-'));

  try {
    const result = await dispatchToolCall(
      {
        id: 'call_provider_drc',
        name: 'provider.invoke',
        args: {
          provider: 'codex',
          projectDir: root,
          prompt: 'Run board DRC.'
        }
      },
      {
        checkProviderAvailabilityImpl: async ({ provider }) => ({
          provider,
          command: 'codex',
          available: true,
          status: 'available'
        }),
        runProviderProcessImpl: async ({ allowedToolNames }) => {
          assert.ok(allowedToolNames.includes('validate.drc'));
          return {
            exitCode: 0,
            stderr: '',
            events: [
              createEnvelope('tool.call', {
                id: 'call_provider_drc_tool',
                name: 'validate.drc',
                args: {}
              })
            ]
          };
        },
        inspectProjectImpl: async ({ projectDir }) => ({
          ok: true,
          inspectedProjectDir: projectDir,
          validation: {
            drc: {
              ok: true,
              skipped: false,
              drc: { violationCount: 0, unconnectedCount: 0, byType: {} }
            }
          }
        })
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.result.toolResults[0].ok, true);
    assert.equal(result.result.toolResults[0].result.validation.drc.drc.unconnectedCount, 0);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
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
    assert.match(result.result.patchId, /^sha256:/);
    assert.ok(Number.isFinite(result.result.expiresAt));
    assert.ok(result.result.beforeArtifacts.every((artifact) => artifact.path && 'hash' in artifact));
    assert.ok(result.result.afterArtifacts.every((artifact) => artifact.path && /^sha256:/.test(artifact.hash)));
    assert.match(result.result.diff, /--- chatpcb_mcu_peripheral.chatpcb.json/);
    assert.equal(await readFile(generated.result.files.spec, 'utf8'), before);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('daemon routes provider-emitted validation through disposable project inspection', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-provider-inspection-'));

  try {
    const result = await dispatchToolCall(
      {
        id: 'call_provider_erc',
        name: 'provider.invoke',
        args: { provider: 'codex', projectDir: root, prompt: 'Run ERC.' }
      },
      {
        checkProviderAvailabilityImpl: async ({ provider }) => ({ provider, command: 'codex', available: true, status: 'available' }),
        runProviderProcessImpl: async () => ({
          exitCode: 0,
          stderr: '',
          events: [createEnvelope('tool.call', { id: 'call_provider_erc_tool', name: 'validate.erc', args: {} })]
        }),
        validateProjectImpl: async () => {
          throw new Error('provider validation must not target the authoritative project');
        },
        inspectProjectImpl: async ({ projectDir }) => ({
          ok: true,
          inspectedProjectDir: projectDir,
          validation: { erc: { ok: true, erc: { errorCount: 0, warningCount: 0 } } }
        })
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.result.toolResults[0].result.validation.erc.ok, true);
    assert.equal(result.result.toolResults[0].result.inspectedProjectDir, root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('daemon consumes a patch preview once and rejects replay or stale artifacts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-daemon-patch-approval-'));
  const registry = createPatchApprovalRegistry();
  const options = { patchApprovalRegistry: registry, validateProjectImpl: async () => ({ ok: true, skipped: false, erc: { errorCount: 0, warningCount: 0, byType: {} } }) };
  const prompt = 'STM32 board with USB-C power, 3.3V regulator, I2C connector, UART header, reset button, boot button, and LED.';

  try {
    const generated = await dispatchToolCall({ name: 'schematic.generate', args: { projectDir: root, prompt: 'RP2040 board with USB-C power and I2C connector.' } });
    const preview = await dispatchToolCall({ name: 'schematic.patch', args: { projectDir: root, prompt } }, options);
    const approved = await dispatchToolCall({ name: 'schematic.patch', args: { projectDir: root, approved: true, patchId: preview.result.patchId } }, options);
    const replay = await dispatchToolCall({ name: 'schematic.patch', args: { projectDir: root, approved: true, patchId: preview.result.patchId } }, options);

    assert.equal(approved.ok, true);
    assert.equal(approved.result.applied, true);
    assert.equal(replay.ok, false);
    assert.equal(replay.error.code, 'PATCH_APPROVAL_MISSING');

    const stalePreview = await dispatchToolCall({ name: 'schematic.patch', args: { projectDir: root, prompt } }, options);
    await appendFile(generated.result.files.schematic, '\n(user edit)\n');
    const stale = await dispatchToolCall({ name: 'schematic.patch', args: { projectDir: root, approved: true, patchId: stalePreview.result.patchId } }, options);
    assert.equal(stale.ok, true);
    assert.equal(stale.result.reason.code, 'PATCH_STALE');
  } finally {
    registry.disposeAll();
    await rm(root, { force: true, recursive: true });
  }
});

test('daemon rejects missing, cancelled, and expired patch approvals', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-daemon-patch-expiry-'));
  let time = 1000;
  const registry = createPatchApprovalRegistry({ ttlMs: 10, now: () => time });
  const options = { patchApprovalRegistry: registry };
  const prompt = 'STM32 board with USB-C power and UART header.';

  try {
    await dispatchToolCall({ name: 'schematic.generate', args: { projectDir: root, prompt: 'RP2040 board with USB-C power and I2C connector.' } });
    const missing = await dispatchToolCall({ name: 'schematic.patch', args: { projectDir: root, approved: true } }, options);
    assert.equal(missing.error.code, 'PATCH_APPROVAL_REQUIRED');

    const cancellable = await dispatchToolCall({ name: 'schematic.patch', args: { projectDir: root, prompt } }, options);
    const cancelled = await dispatchToolCall({ name: 'schematic.patch', args: { projectDir: root, cancel: true, patchId: cancellable.result.patchId } }, options);
    assert.equal(cancelled.result.canceled, true);

    const expiring = await dispatchToolCall({ name: 'schematic.patch', args: { projectDir: root, prompt } }, options);
    time = 1011;
    const expired = await dispatchToolCall({ name: 'schematic.patch', args: { projectDir: root, approved: true, patchId: expiring.result.patchId } }, options);
    assert.equal(expired.error.code, 'PATCH_APPROVAL_EXPIRED');
  } finally {
    registry.disposeAll();
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

test('daemon returns an approval-gated patch preview for an existing project after a provider transcript without calls', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-project-fallback-'));
  const registry = createPatchApprovalRegistry();
  const register = registry.register;
  let registrations = 0;
  registry.register = (record) => {
    registrations += 1;
    return register(record);
  };

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
      { ...providerOptions({ events: [createEnvelope('agent.delta', { text: 'Generating locally.' })] }), patchApprovalRegistry: registry }
    );
    const second = await dispatchToolCall(
      {
        id: 'call_project_request_second',
        name: 'project.request',
        args: { provider: 'codex', projectDir: created.result.projectDir, prompt: 'RP2040 board with USB-C power, I2C connector, reset button, and LED.' }
      },
      { ...providerOptions({ events: [createEnvelope('agent.delta', { text: 'Patching locally.' })] }), patchApprovalRegistry: registry }
    );

    assert.equal(first.ok, true);
    assert.equal(first.result.operation, 'generated');
    assert.equal(second.ok, true);
    assert.equal(second.result.operation, 'patched');
    assert.equal(second.result.requiresApproval, true);
    assert.equal(second.result.applied, false);
    assert.ok(second.result.patchId);
    assert.equal(registrations, 1);

    const approved = await dispatchToolCall(
      { name: 'schematic.patch', args: { projectDir: created.result.projectDir, approved: true, patchId: second.result.patchId } },
      { patchApprovalRegistry: registry, validateProjectImpl: async () => ({ ok: true, skipped: false, erc: { errorCount: 0, warningCount: 0, byType: {} } }) }
    );
    assert.equal(approved.ok, true);
    assert.equal(approved.result.applied, true);
  } finally {
    registry.disposeAll();
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test('daemon rejects generate and request calls that target the home directory', async () => {
  const result = await dispatchToolCall({
    name: 'schematic.generate',
    args: {
      projectDir: homedir(),
      prompt: 'RP2040 board with USB-C power and I2C connector.'
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'UNSAFE_PROJECT_DIR');
});

test('daemon candidate validation rejection does not delete the project directory itself', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-restore-dir-'));
  const sentinel = path.join(root, 'user-note.txt');
  const registry = createPatchApprovalRegistry();

  try {
    const generated = await dispatchToolCall({
      name: 'schematic.generate',
      args: {
        projectDir: root,
        prompt: 'RP2040 board with USB-C power and I2C connector.'
      }
    });
    await writeFile(sentinel, 'keep-me\n', 'utf8');
    const before = await readFile(generated.result.files.spec, 'utf8');

    const result = await dispatchToolCall(
      {
        id: 'call_project_request_restore_dir',
        name: 'project.request',
        args: { provider: 'codex', projectDir: root, prompt: 'STM32 board with USB-C power and UART header.' }
      },
      {
        ...providerOptions({
          events: [createEnvelope('agent.delta', { text: 'Preparing a patch.' })],
          validation: { ok: false, skipped: false, erc: { errorCount: 1, warningCount: 0, byType: { test: 1 } } }
        }),
        patchApprovalRegistry: registry
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.result.applied, false);
    const approved = await dispatchToolCall(
      { name: 'schematic.patch', args: { projectDir: root, approved: true, patchId: result.result.patchId } },
      { patchApprovalRegistry: registry }
    );
    assert.equal(approved.ok, true);
    assert.equal(approved.result.rolledBack, true);
    const dir = await readdir(root, { withFileTypes: true });
    assert.ok(dir.some((entry) => entry.isDirectory() === false || entry.name));
    assert.equal(await readFile(generated.result.files.spec, 'utf8'), before);
    assert.equal(await readFile(sentinel, 'utf8'), 'keep-me\n');
  } finally {
    registry.disposeAll();
    await rm(root, { force: true, recursive: true });
  }
});

test('daemon confines generate calls to an explicit workspace root', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-workspace-guard-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'chatpcb-workspace-outside-'));

  try {
    const rejected = await dispatchToolCall(
      {
        name: 'schematic.generate',
        args: {
          projectDir: outside,
          prompt: 'RP2040 board with USB-C power and I2C connector.'
        }
      },
      { allowedWorkspaceRoot: workspaceRoot }
    );

    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, 'UNSAFE_PROJECT_DIR');

    const created = await dispatchToolCall({
      name: 'project.create',
      args: { workspaceRoot, projectName: 'Guarded Board' }
    });
    const allowed = await dispatchToolCall(
      {
        name: 'schematic.generate',
        args: {
          projectDir: created.result.projectDir,
          prompt: 'RP2040 board with USB-C power and I2C connector.'
        }
      },
      { allowedWorkspaceRoot: workspaceRoot }
    );

    assert.equal(allowed.ok, true);
    assert.match(allowed.result.files.spec, /Guarded-Board/);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
    await rm(outside, { force: true, recursive: true });
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

test('daemon rejects provider-emitted project.create calls during project.request', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-project-create-request-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'chatpcb-project-create-outside-'));

  try {
    const created = await dispatchToolCall({
      name: 'project.create',
      args: { workspaceRoot, projectName: 'Active Board' }
    });

    await assert.rejects(
      () => dispatchToolCall(
        {
          id: 'call_project_request_create',
          name: 'project.request',
          args: { provider: 'codex', projectDir: created.result.projectDir, prompt: 'Create a second board.' }
        },
        providerOptions({
          events: [
            createEnvelope('tool.call', {
              id: 'call_provider_create',
              name: 'project.create',
              args: { workspaceRoot: outside, projectName: 'Escaped Board' }
            })
          ]
        })
      ),
      /project\.create is not allowed inside project\.request/
    );
    await assert.rejects(() => readdir(path.join(outside, 'Escaped-Board')), { code: 'ENOENT' });
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

test('daemon keeps existing project artifacts when candidate ERC validation fails', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-project-rollback-'));
  const registry = createPatchApprovalRegistry();

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
      {
        ...providerOptions({
          events: [createEnvelope('agent.delta', { text: 'Preparing a patch.' })],
          validation: { ok: false, skipped: false, erc: { errorCount: 1, warningCount: 0, byType: { test: 1 } } }
        }),
        patchApprovalRegistry: registry
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.result.applied, false);
    const approved = await dispatchToolCall(
      { name: 'schematic.patch', args: { projectDir: root, approved: true, patchId: result.result.patchId } },
      { patchApprovalRegistry: registry }
    );
    assert.equal(approved.result.validation.erc.errorCount, 1);
    assert.equal(await readFile(generated.result.files.spec, 'utf8'), before);
  } finally {
    registry.disposeAll();
    await rm(root, { force: true, recursive: true });
  }
});

test('daemon returns a provider-emitted patch as a preview without writing until its patchId is approved', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-provider-patch-'));
  const registry = createPatchApprovalRegistry();

  try {
    const generated = await dispatchToolCall({
      name: 'schematic.generate',
      args: { projectDir: root, prompt: 'RP2040 board with USB-C power and I2C connector.' }
    });
    const before = await readFile(generated.result.files.spec, 'utf8');
    const result = await dispatchToolCall(
      {
        id: 'call_project_request_patch',
        name: 'project.request',
        args: { provider: 'codex', projectDir: root, prompt: 'Add reset button and status LED.' }
      },
      { ...providerOptions({
        events: [
          createEnvelope('tool.call', {
            id: 'call_provider_patch',
            name: 'schematic.patch',
            args: { prompt: 'RP2040 board with USB-C power, I2C connector, reset button, and status LED.' }
          })
        ]
      }), patchApprovalRegistry: registry }
    );

    assert.equal(result.ok, true);
    assert.equal(result.result.requiresApproval, true);
    assert.equal(result.result.applied, false);
    assert.equal(await readFile(generated.result.files.spec, 'utf8'), before);

    const approved = await dispatchToolCall(
      { name: 'schematic.patch', args: { projectDir: root, approved: true, patchId: result.result.patchId } },
      { patchApprovalRegistry: registry, validateProjectImpl: async () => ({ ok: true, skipped: false, erc: { errorCount: 0, warningCount: 0, byType: {} } }) }
    );
    assert.equal(approved.ok, true);
    assert.equal(approved.result.applied, true);
  } finally {
    registry.disposeAll();
    await rm(root, { force: true, recursive: true });
  }
});

test('daemon normalizes provider patch controls to an approval-gated preview', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-provider-normalized-patch-'));
  const registry = createPatchApprovalRegistry();

  try {
    const generated = await dispatchToolCall({
      name: 'schematic.generate',
      args: { projectDir: root, prompt: 'RP2040 board with USB-C power and I2C connector.' }
    });
    const before = await readFile(generated.result.files.spec, 'utf8');
    const result = await dispatchToolCall(
      {
        id: 'call_provider_normalized_patch',
        name: 'project.request',
        args: { provider: 'codex', projectDir: root, prompt: 'Add a reset button.' }
      },
      {
        ...providerOptions({
          events: [createEnvelope('tool.call', {
            id: 'call_provider_patch_controls',
            name: 'schematic.patch',
            args: {
              prompt: 'RP2040 board with USB-C power, I2C connector, reset button, and status LED.',
              approved: true,
              cancel: true,
              patchId: 'provider-supplied-approval'
            }
          })]
        }),
        patchApprovalRegistry: registry
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.result.requiresApproval, true);
    assert.equal(result.result.applied, false);
    assert.match(result.result.patchId, /^sha256:/);
    assert.equal(await readFile(generated.result.files.spec, 'utf8'), before);
  } finally {
    registry.disposeAll();
    await rm(root, { force: true, recursive: true });
  }
});

test('daemon restores an existing project snapshot after an exceptional provider exit', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-provider-exception-restore-'));

  try {
    const generated = await dispatchToolCall({
      name: 'schematic.generate',
      args: { projectDir: root, prompt: 'RP2040 board with USB-C power and I2C connector.' }
    });
    const before = await readFile(generated.result.files.spec, 'utf8');

    await assert.rejects(
      () => dispatchToolCall(
        {
          id: 'call_provider_exception_restore',
          name: 'project.request',
          args: { provider: 'codex', projectDir: root, prompt: 'Inspect then fail.' }
        },
        {
          ...providerOptions({
            events: [
              createEnvelope('tool.call', { id: 'call_provider_inspect_then_fail', name: 'project.inspect', args: {} }),
              createEnvelope('tool.call', { id: 'call_provider_forbidden_create', name: 'project.create', args: { projectName: 'forbidden' } })
            ]
          }),
          inspectProjectImpl: async ({ projectDir }) => {
            await writeFile(generated.result.files.spec, 'mutated before exceptional exit\n', 'utf8');
            return { ok: true, inspection: { projectDir } };
          }
        }
      ),
      /project\.create is not allowed inside project\.request/
    );

    assert.equal(await readFile(generated.result.files.spec, 'utf8'), before);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('daemon removes provider-created files when restoring after an exceptional project request', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-provider-created-file-restore-'));

  try {
    const generated = await dispatchToolCall({
      name: 'schematic.generate',
      args: { projectDir: root, prompt: 'RP2040 board with USB-C power and I2C connector.' }
    });
    const originalFiles = await Promise.all(
      Object.values(generated.result.files).map(async (file) => [file, await readFile(file)])
    );
    const createdFile = path.join(root, 'exception-created.kicad_sch');

    await assert.rejects(
      () => dispatchToolCall(
        {
          id: 'call_provider_created_file_exception_restore',
          name: 'project.request',
          args: { provider: 'codex', projectDir: root, prompt: 'Inspect then fail.' }
        },
        providerOptions({
          runProviderProcessImpl: async () => {
            await writeFile(createdFile, 'provider-created schematic\n', 'utf8');
            throw new Error('Provider failed after creating a project file.');
          }
        })
      ),
      /Provider failed after creating a project file/
    );

    await assert.rejects(() => readFile(createdFile), { code: 'ENOENT' });
    for (const [file, content] of originalFiles) {
      assert.deepEqual(await readFile(file), content);
    }
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
              id: 'call_large_patch_preview',
              name: 'schematic.patch',
              args: {
                projectDir: root,
                prompt: 'RP2040 board with USB-C power, I2C connector, reset button, and status LED.',
                approved: false
              }
            }
          })
        );
      });

      socket.addEventListener('message', (event) => {
        const envelope = JSON.parse(event.data);
        if (envelope.type !== 'tool.result') return;
        if (envelope.payload.id === 'call_large_patch_preview') {
          socket.send(
            JSON.stringify(createEnvelope('tool.call', {
              id: 'call_large_patch_apply',
              name: 'schematic.patch',
              args: { projectDir: root, approved: true, patchId: envelope.payload.result.patchId }
            }))
          );
          return;
        }
        if (envelope.payload.id !== 'call_large_patch_apply') return;
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
