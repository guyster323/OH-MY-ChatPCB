import assert from 'node:assert/strict';
import { access, appendFile, cp, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { dispatchToolCall, startDaemon } from '../src/runtime/agent-daemon.js';
import { createPatchApprovalRegistry } from '../src/runtime/patch-approval-registry.js';
import { createProjectMutexRegistry } from '../src/runtime/project-mutex-registry.js';
import { createTransactionJournal } from '../src/runtime/transaction-journal.js';
import { createEnvelope } from '../src/runtime/envelope.js';
import { getProviderDefinition } from '../src/runtime/provider-registry.js';
import { generateMcuPeripheralProject } from '../src/workflow/generate-mcu-project.js';
import { saveCircuitConversation } from '../src/runtime/request-conversation.js';
import { FIXTURE_LIBS, restoreKicadLibraryEnv, setKicadLibraryEnv } from './helpers/kicad-library-env.js';

const passingVerify = async () => ({
  erc: { ok: true, skipped: false, executed: true, erc: { errorCount: 0, warningCount: 0 } },
  drc: { ok: true, skipped: true }
});
const passingDrc = async () => ({ ok: true, skipped: false, executed: true, violations: [], unconnectedItems: [] });
const passingErc = async () => ({ ok: true, skipped: false, erc: { errorCount: 0, warningCount: 0, byType: {} } });

async function kicadArtifacts(projectDir) {
  const names = await readdir(projectDir);
  return names.filter((name) => (
    name.endsWith('.kicad_sch')
    || name.endsWith('.kicad_pcb')
    || name.endsWith('.kicad_pro')
    || name.endsWith('.chatpcb.json')
  ));
}

async function listRelativeFiles(directory) {
  const names = [];
  const walk = async (current) => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else names.push(path.relative(directory, absolute).split(path.sep).join('/'));
    }
  };
  await walk(directory);
  names.sort();
  return names;
}

async function transactionServices(extra = {}) {
  const stateRoot = extra.stateRoot ?? await mkdtemp(path.join(tmpdir(), 'chatpcb-daemon-journal-'));
  return {
    stateRoot,
    patchApprovalRegistry: extra.patchApprovalRegistry ?? createPatchApprovalRegistry(),
    projectMutexRegistry: extra.projectMutexRegistry ?? createProjectMutexRegistry(),
    transactionJournal: extra.transactionJournal ?? createTransactionJournal({ stateRoot }),
    verifyAppliedProjectImpl: extra.verifyAppliedProjectImpl ?? passingVerify,
    validateProjectImpl: extra.validateProjectImpl ?? passingErc,
    validateBoardImpl: extra.validateBoardImpl ?? passingDrc,
    ...extra
  };
}

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
    assert.equal(result.result.requiresApproval, true);
    assert.equal(result.result.applied, false);
    assert.match(result.result.files.schematic, /\.kicad_sch$/);
    assert.equal((await kicadArtifacts(root)).length, 0);
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

test('daemon dispatches board-level DRC validation using server configuration', async () => {
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
      kicadCliPath: 'C:/KiCad/bin/kicad-cli.exe',
      inspectProjectImpl: async (args) => {
        calls.push(args);
        return {
          ok: true,
          validation: {
            drc: {
              ok: false,
              skipped: false,
              report: 'C:/workspace/demo/chatpcb-drc.json',
              drc: {
                violationCount: 1,
                unconnectedCount: 2,
                byType: { clearance: 1, unconnected_items: 2 }
              }
            }
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
  assert.equal(calls.length, 1);
  assert.equal(calls[0].projectDir, 'C:/workspace/demo');
  assert.equal(calls[0].kicadCliPath, 'C:/KiCad/bin/kicad-cli.exe');
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
    const generated = await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power, I2C connector, reset button, and LED.'
    });
    const before = await readFile(generated.files.spec, 'utf8');

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
    assert.equal(await readFile(generated.files.spec, 'utf8'), before);
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
  const options = { patchApprovalRegistry: registry, validateProjectImpl: passingErc, validateBoardImpl: passingDrc, verifyAppliedProjectImpl: passingVerify };
  const prompt = 'STM32 board with USB-C power, 3.3V regulator, I2C connector, UART header, reset button, boot button, and LED.';

  try {
    const generated = await generateMcuPeripheralProject({ projectDir: root, prompt: 'RP2040 board with USB-C power and I2C connector.' });
    const preview = await dispatchToolCall({ name: 'schematic.patch', args: { projectDir: root, prompt } }, options);
    const approved = await dispatchToolCall({ name: 'schematic.patch', args: { projectDir: root, approved: true, patchId: preview.result.patchId } }, options);
    const replay = await dispatchToolCall({ name: 'schematic.patch', args: { projectDir: root, approved: true, patchId: preview.result.patchId } }, options);

    assert.equal(approved.ok, true);
    assert.equal(approved.result.applied, true);
    assert.equal(replay.ok, false);
    assert.equal(replay.error.code, 'PATCH_APPROVAL_MISSING');

    const stalePreview = await dispatchToolCall({ name: 'schematic.patch', args: { projectDir: root, prompt } }, options);
    await appendFile(generated.files.schematic, '\n(user edit)\n');
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
    await generateMcuPeripheralProject({ projectDir: root, prompt: 'RP2040 board with USB-C power and I2C connector.' });
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
    ['codex', 'claude', 'copilot', 'grok', 'chatgpt']
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
    assert.equal(providerCalls[0].providerId, 'codex');
    assert.deepEqual(providerCalls[0].args, getProviderDefinition('codex').args);
    assert.equal(providerCalls[0].timeoutMs, getProviderDefinition('codex').timeoutMs);
    assert.equal(providerCalls[0].args.includes('--cwd'), false);
    assert.match(providerCalls[0].input, /Generate an STM32 board from chat\./);
    assert.match(providerCalls[0].input, /Project directory:/);
    assert.deepEqual(
      result.result.events.map((event) => event.type),
      ['agent.delta', 'tool.call']
    );
    assert.equal(result.result.toolResults.length, 1);
    assert.equal(result.result.toolResults[0].ok, true);
    assert.equal(result.result.toolResults[0].result.requiresApproval, true);
    assert.match(result.result.toolResults[0].result.files.schematic, /\.kicad_sch$/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('daemon spawns grok at the resolved path with --cwd and the grok timeout', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-grok-invoke-'));
  const resolvedPath = path.join(root, 'grok');
  const providerCalls = [];

  try {
    const result = await dispatchToolCall(
      {
        id: 'call_grok_cwd',
        name: 'provider.invoke',
        args: {
          provider: 'grok',
          projectDir: root,
          prompt: 'Generate an ESP32-S3 sensor board.'
        }
      },
      {
        checkProviderAvailabilityImpl: async () => ({
          provider: 'grok',
          command: resolvedPath,
          resolvedPath,
          available: true,
          status: 'available'
        }),
        runProviderProcessImpl: async (options) => {
          providerCalls.push(options);
          return { exitCode: 0, stderr: '', events: [] };
        }
      }
    );

    assert.equal(result.ok, true);
    assert.equal(providerCalls.length, 1);
    assert.equal(providerCalls[0].command, resolvedPath);
    assert.equal(providerCalls[0].args[0], '--cwd');
    assert.equal(providerCalls[0].args[1], root);
    assert.ok(providerCalls[0].args.includes('--prompt-file'));
    assert.equal(providerCalls[0].usePromptFile, true);
    assert.equal(providerCalls[0].providerId, 'grok');
    assert.equal(providerCalls[0].timeoutMs, getProviderDefinition('grok').timeoutMs);
    assert.ok(getProviderDefinition('grok', {}).timeoutMs >= 300000);
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
    assert.equal(result.result.requiresApproval, true);
    assert.equal(result.result.applied, false);
    assert.equal(result.result.validation.erc.errorCount, 0);
    assert.ok(result.result.files.schematic.endsWith('.kicad_sch'));
    assert.equal((await kicadArtifacts(created.result.projectDir)).length, 0);
    assert.deepEqual(result.result.providerEvents.map((event) => event.type), ['agent.delta', 'tool.call']);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test('project.request fills a missing provider generate prompt from the user request', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-provider-missing-prompt-'));
  const previous = setKicadLibraryEnv({ symbols: FIXTURE_LIBS.symbols });

  try {
    const created = await dispatchToolCall({
      name: 'project.create',
      args: { workspaceRoot, projectName: 'ESP32 Display Board' }
    });
    const result = await dispatchToolCall(
      {
        id: 'call_project_request_missing_prompt',
        name: 'project.request',
        args: {
          provider: 'codex',
          projectDir: created.result.projectDir,
          prompt: 'ESP32-S3와 가스 센서를 연결하고 3.3V 전원을 사용하는 회로를 만들어줘'
        }
      },
      providerOptions({
        events: [
          createEnvelope('tool.call', {
            id: 'call_generated_without_prompt',
            name: 'schematic.generate',
            args: { projectDir: created.result.projectDir }
          })
        ]
      })
    );

    assert.equal(result.ok, true);
    assert.equal(result.result.requiresApproval, true);
    assert.match(result.result.files.schematic, /\.kicad_sch$/);
    assert.doesNotMatch(result.error?.message ?? '', /Circuit prompt is required/);
  } finally {
    restoreKicadLibraryEnv(previous);
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
    await generateMcuPeripheralProject({
      projectDir: created.result.projectDir,
      prompt: 'RP2040 board with USB-C power and I2C connector.'
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
    assert.equal(first.result.operation, 'patched');
    assert.equal(first.result.requiresApproval, true);
    assert.equal(second.ok, true);
    assert.equal(second.result.operation, 'patched');
    assert.equal(second.result.requiresApproval, true);
    assert.equal(second.result.applied, false);
    assert.ok(second.result.patchId);
    assert.equal(registrations, 2);

    const approved = await dispatchToolCall(
      { name: 'schematic.patch', args: { projectDir: created.result.projectDir, approved: true, patchId: second.result.patchId } },
      { patchApprovalRegistry: registry, validateProjectImpl: passingErc, validateBoardImpl: passingDrc, verifyAppliedProjectImpl: passingVerify }
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
    const generated = await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power and I2C connector.'
    });
    await writeFile(sentinel, 'keep-me\n', 'utf8');
    const before = await readFile(generated.files.spec, 'utf8');

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
    assert.equal(result.result.requiresApproval, true);
    const dir = await readdir(root, { withFileTypes: true });
    assert.ok(dir.some((entry) => entry.isDirectory() === false || entry.name));
    assert.equal(await readFile(generated.files.spec, 'utf8'), before);
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

test('daemon ignores disallowed provider-emitted project.create calls and falls back to native preview during project.request', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-project-create-request-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'chatpcb-project-create-outside-'));

  try {
    const created = await dispatchToolCall({
      name: 'project.create',
      args: { workspaceRoot, projectName: 'Active Board' }
    });

    await generateMcuPeripheralProject({
      projectDir: created.result.projectDir,
      prompt: 'RP2040 board with USB-C power and I2C connector.'
    });

    const result = await dispatchToolCall(
      {
        id: 'call_project_request_create',
        name: 'project.request',
        args: { provider: 'codex', projectDir: created.result.projectDir, prompt: 'Add a reset button.' }
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
    );
    assert.equal(result.ok, true);
    assert.equal(result.result.requiresApproval, true);
    assert.equal(result.result.operation, 'patched');
    await assert.rejects(() => readdir(path.join(outside, 'Escaped-Board')), { code: 'ENOENT' });
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
    await rm(outside, { force: true, recursive: true });
  }
});

test('daemon retries with corrective note when provider emits only disallowed calls', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-provider-disallowed-retry-'));

  try {
    const created = await dispatchToolCall({
      name: 'project.create',
      args: { workspaceRoot, projectName: 'Retry Board' }
    });

    await generateMcuPeripheralProject({
      projectDir: created.result.projectDir,
      prompt: 'RP2040 board with USB-C power and I2C connector.'
    });

    let callCount = 0;
    const result = await dispatchToolCall(
      {
        id: 'call_project_request_persistent_disallow',
        name: 'project.request',
        args: { provider: 'codex', projectDir: created.result.projectDir, prompt: '회로를 수정해 주세요.' }
      },
      {
        checkProviderAvailabilityImpl: async ({ provider }) => ({ provider, command: 'codex', available: true, status: 'available' }),
        runProviderProcessImpl: async () => {
          callCount += 1;
          return {
            exitCode: 0,
            stderr: '',
            events: [
              createEnvelope('tool.call', {
                id: `call_provider_create_${callCount}`,
                name: 'project.create',
                args: { workspaceRoot, projectName: `Board ${callCount}` }
              })
            ]
          };
        },
        validateProjectImpl: passingErc,
        validateBoardImpl: passingDrc
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.result.requiresApproval, true);
    assert.equal(callCount, 2);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test('daemon ignores disallowed schematic.generate on existing project and falls back', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-generate-disallowed-'));

  try {
    const created = await dispatchToolCall({
      name: 'project.create',
      args: { workspaceRoot, projectName: 'Existing Board' }
    });

    await generateMcuPeripheralProject({
      projectDir: created.result.projectDir,
      prompt: 'STM32 board with USB-C power.'
    });

    const result = await dispatchToolCall(
      {
        id: 'call_project_request_generate_existing',
        name: 'project.request',
        args: { provider: 'codex', projectDir: created.result.projectDir, prompt: 'Add reset button.' }
      },
      providerOptions({
        events: [
          createEnvelope('tool.call', {
            id: 'call_provider_generate',
            name: 'schematic.generate',
            args: { prompt: 'New board' }
          })
        ]
      })
    );

    assert.equal(result.ok, true);
    assert.equal(result.result.requiresApproval, true);
    assert.equal(result.result.operation, 'patched');
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test('PROVIDER_DISALLOWED_TOOL names the disallowed tools in Korean and English', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-disallowed-message-'));

  try {
    await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power and I2C connector.'
    });

    const cases = [
      {
        prompt: '회로를 수정해 주세요.',
        tools: ['project.create'],
        message: /AI가 이 단계에서 쓸 수 없는 작업\(project\.create\)을 시도해/
      },
      {
        prompt: 'Add a reset button.',
        tools: ['project.create'],
        message: /The AI attempted an operation \(project\.create\) that is not allowed at this stage/
      },
      {
        prompt: '회로에 버튼을 추가해 주세요.',
        tools: ['schematic.generate'],
        message: /AI가 이 단계에서 쓸 수 없는 작업\(schematic\.generate\)을 시도해/
      },
      {
        prompt: 'Add a status LED.',
        tools: ['schematic.generate'],
        message: /The AI attempted an operation \(schematic\.generate\) that is not allowed at this stage/
      },
      {
        prompt: 'Change the connector.',
        tools: ['schematic.generate', 'project.create'],
        message: /The AI attempted an operation \(schematic\.generate, project\.create\) that is not allowed at this stage/
      }
    ];

    for (const item of cases) {
      const mutex = createProjectMutexRegistry();
      await mutex.runExclusive({ projectDir: root }, async () => {
        const result = await dispatchToolCall(
          {
            id: `call_disallowed_message_${item.tools.join('_')}`,
            name: 'project.request',
            args: { provider: 'codex', projectDir: root, prompt: item.prompt }
          },
          {
            projectMutexRegistry: mutex,
            checkProviderAvailabilityImpl: async ({ provider }) => ({
              provider,
              command: 'codex',
              available: true,
              status: 'available'
            }),
            runProviderProcessImpl: async () => ({
              exitCode: 0,
              stderr: '',
              events: item.tools.map((name, index) => createEnvelope('tool.call', {
                id: `call_disallowed_${name}_${index}`,
                name,
                args: { projectName: 'Blocked', prompt: 'Blocked' }
              }))
            })
          }
        );

        assert.equal(result.ok, false);
        assert.equal(result.error.code, 'PROVIDER_DISALLOWED_TOOL');
        assert.match(result.error.message, item.message);
        assert.doesNotMatch(result.error.message, /프로젝트 생성|project creation/);
      });
    }
  } finally {
    await rm(root, { force: true, recursive: true });
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
      const result = await dispatchToolCall(
        {
          id: `call_project_request_${failure.name}`,
          name: 'project.request',
          args: { provider: 'codex', projectDir: root, prompt: 'Create an RP2040 board.' }
        },
        providerOptions({ runProviderProcessImpl: failure.provider })
      );
      assert.equal(result.ok, false);
      assert.match(result.error.message, failure.error);
      assert.ok(result.conversation);
      assert.equal(result.conversation.status, 'generate');
      await assert.rejects(() => readFile(path.join(root, 'chatpcb_mcu_peripheral.chatpcb.json'), 'utf8'), { code: 'ENOENT' });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }
});

test('grok project.request uses a generate schema for a new project and a patch schema with spec context for an existing one', async () => {
  const createdRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-grok-new-schema-'));
  const existingRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-grok-existing-schema-'));
  const patchApprovalRegistry = createPatchApprovalRegistry();
  const captured = [];
  const grokOptions = (events) => ({
    patchApprovalRegistry,
    checkProviderAvailabilityImpl: async () => ({
      available: true,
      command: 'grok',
      resolvedPath: 'grok',
      status: 'available'
    }),
    runProviderProcessImpl: async (invocation) => {
      captured.push({ args: invocation.args, input: invocation.input });
      return { exitCode: 0, stderr: '', events };
    },
    validateProjectImpl: passingErc,
    validateBoardImpl: passingDrc
  });

  try {
    const prompt = 'STM32 board with USB-C power, 3.3V regulator, I2C sensor connector, UART debug header, reset button, and status LED.';
    const created = await dispatchToolCall({
      id: 'grok-schema-new',
      name: 'project.request',
      args: { provider: 'grok', projectDir: createdRoot, prompt }
    }, grokOptions([
      createEnvelope('tool.call', {
        id: 'gen',
        name: 'schematic.generate',
        args: { prompt }
      })
    ]));

    assert.equal(created.ok, true);
    assert.equal(created.result.providerFallback, undefined);
    assert.equal(created.result.source.id, 'native');
    assert.equal(created.result.source.provider, getProviderDefinition('grok').id);
    assert.equal(created.result.source.via, 'provider');
    const generateSchema = JSON.parse(captured[0].args[captured[0].args.indexOf('--json-schema') + 1]);
    assert.deepEqual(generateSchema.properties.payload.properties.name.enum, ['schematic.generate']);
    assert.equal(captured[0].args.includes('--permission-mode'), true);
    assert.equal(captured[0].args.includes('plan'), true);
    assert.match(captured[0].input, /Do not explore, read, or modify project files/);
    assert.equal(captured[0].input.includes('project.inspect'), false);

    await generateMcuPeripheralProject({
      projectDir: existingRoot,
      prompt: 'RP2040 board with USB-C power and I2C connector.'
    });
    const patched = await dispatchToolCall({
      id: 'grok-schema-existing',
      name: 'project.request',
      args: { provider: 'grok', projectDir: existingRoot, prompt: 'Add a status LED.' }
    }, grokOptions([
      createEnvelope('tool.call', {
        id: 'patch',
        name: 'schematic.patch',
        args: { prompt: 'RP2040 board with USB-C power, I2C connector, and a status LED.' }
      })
    ]));

    assert.equal(patched.ok, true);
    assert.equal(patched.result.providerFallback, undefined);
    assert.equal(patched.result.operation, 'patched');
    assert.equal(patched.result.source.id, 'native');
    assert.equal(patched.result.source.provider, getProviderDefinition('grok').id);
    assert.equal(patched.result.source.via, 'provider');
    const patchSchema = JSON.parse(captured[1].args[captured[1].args.indexOf('--json-schema') + 1]);
    assert.deepEqual(patchSchema.properties.payload.properties.name.enum, ['schematic.patch']);
    assert.equal(patchSchema.properties.payload.properties.args.properties.projectName.type, 'string');
    assert.match(captured[1].input, /Existing project inspection context/);
    assert.match(captured[1].input, /RP2040/);
    assert.match(captured[1].input, /I2C/);
    assert.match(captured[1].input, /Do not explore/);
    assert.equal(captured[1].input.includes('project.inspect'), false);
  } finally {
    patchApprovalRegistry.disposeAll();
    await rm(createdRoot, { force: true, recursive: true });
    await rm(existingRoot, { force: true, recursive: true });
  }
});

test('project.request falls back to a native preview when the provider only inspects', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-project-inspect-only-'));
  const previous = setKicadLibraryEnv({ symbols: FIXTURE_LIBS.symbols });

  try {
    const created = await dispatchToolCall({
      name: 'project.create',
      args: { workspaceRoot, projectName: 'Inspect Only Board' }
    });
    const result = await dispatchToolCall(
      {
        id: 'call_project_request_inspect_only',
        name: 'project.request',
        args: {
          provider: 'codex',
          projectDir: created.result.projectDir,
          prompt: 'ESP32-S3와 가스 센서를 연결하고 3.3V 전원을 사용하는 회로를 만들어줘.'
        }
      },
      {
        ...providerOptions({
          events: [
            createEnvelope('tool.call', {
              id: 'call_inspect_only',
              name: 'project.inspect',
              args: {}
            })
          ]
        }),
        inspectProjectImpl: async () => ({
          ok: true,
          inspection: { projectDigest: 'fixture' },
          manifest: { freshness: { status: 'missing' } },
          validation: { erc: { ok: true } }
        })
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.result.requiresApproval, true);
    assert.equal(result.result.applied, false);
    assert.equal(result.result.operation, 'generated');
    assert.equal(result.result.providerFallback, 'built-in-draft');
    assert.equal(result.result.source.id, 'native');
    assert.equal(result.result.source.provider, null);
    assert.equal(result.result.source.via, 'native-fallback');
    assert.ok(result.result.conversation.specRows.some((row) => row.label === 'MCU'));
    assert.equal((await kicadArtifacts(created.result.projectDir)).length, 0);
  } finally {
    restoreKicadLibraryEnv(previous);
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test('project.request journals a new conversation file and rollback restores the pre-request tree', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-conversation-rollback-'));
  const services = await transactionServices({
    ...providerOptions({ events: [createEnvelope('agent.delta', { text: 'No tool call.' })] }),
    validateProjectImpl: passingErc
  });
  const progress = [];

  try {
    const before = await listRelativeFiles(root);
    const result = await dispatchToolCall({
      id: 'call_fallback_conversation_rollback',
      name: 'project.request',
      args: {
        provider: 'codex',
        projectDir: root,
        prompt: 'RP2040 board with USB-C power and I2C connector.'
      }
    }, { ...services, emit: (type, payload) => progress.push({ type, ...payload }) });

    assert.equal(result.ok, true);
    assert.equal(result.result.providerFallback, 'built-in-draft');
    assert.equal(result.result.source.id, 'native');
    assert.equal(result.result.source.provider, null);
    assert.equal(result.result.source.via, 'native-fallback');
    assert.equal(result.result.requiresApproval, true);
    assert.equal(result.result.applied, false);
    assert.ok(result.result.changedFiles.includes('.chatpcb-conversation.json'));
    assert.deepEqual(await listRelativeFiles(root), before);
    await assert.rejects(() => access(path.join(root, '.chatpcb-conversation.json')), { code: 'ENOENT' });
    assert.ok(progress.some((item) => (
      item.fallback === 'built-in-draft'
      && item.reason === 'provider-returned-no-tool-call'
      && /no tool call/i.test(item.text ?? '')
    )));

    const approved = await dispatchToolCall({
      name: 'schematic.patch',
      args: { projectDir: root, approved: true, patchId: result.result.patchId }
    }, services);
    assert.equal(approved.ok, true);
    assert.equal(approved.result.applied, true);
    assert.equal(approved.result.transaction.proposal.source.id, 'native');
    assert.equal(approved.result.transaction.proposal.source.provider, null);
    assert.equal(approved.result.transaction.proposal.source.via, 'native-fallback');
    const conversation = await readFile(path.join(root, '.chatpcb-conversation.json'), 'utf8');
    assert.match(conversation, /"status": "generate"/);
    const created = approved.result.transaction.changes.find((change) => change.path === '.chatpcb-conversation.json');
    assert.equal(created.operation, 'create');

    const rolled = await dispatchToolCall({
      name: 'project.transaction.rollback',
      args: { projectDir: root, transactionId: approved.result.transaction.transactionId }
    }, services);
    assert.equal(rolled.ok, true);
    assert.equal(rolled.result.rolledBack, true);
    assert.deepEqual(await listRelativeFiles(root), before);
    await assert.rejects(() => access(path.join(root, '.chatpcb-conversation.json')), { code: 'ENOENT' });
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(root, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

test('daemon keeps existing project artifacts when candidate ERC validation fails', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-project-rollback-'));
  const registry = createPatchApprovalRegistry();

  try {
    const generated = await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power and I2C connector.'
    });
    const before = await readFile(generated.files.spec, 'utf8');
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
    assert.equal(await readFile(generated.files.spec, 'utf8'), before);
  } finally {
    registry.disposeAll();
    await rm(root, { force: true, recursive: true });
  }
});

test('daemon returns a provider-emitted patch as a preview without writing until its patchId is approved', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-provider-patch-'));
  const registry = createPatchApprovalRegistry();

  try {
    const generated = await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power and I2C connector.'
    });
    const before = await readFile(generated.files.spec, 'utf8');
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
    assert.equal(result.result.source.id, 'native');
    assert.equal(result.result.source.provider, getProviderDefinition('codex').id);
    assert.equal(result.result.source.via, 'provider');
    assert.equal(await readFile(generated.files.spec, 'utf8'), before);

    const approved = await dispatchToolCall(
      { name: 'schematic.patch', args: { projectDir: root, approved: true, patchId: result.result.patchId } },
      { patchApprovalRegistry: registry, validateProjectImpl: passingErc, validateBoardImpl: passingDrc, verifyAppliedProjectImpl: passingVerify }
    );
    assert.equal(approved.ok, true);
    assert.equal(approved.result.applied, true);
    assert.equal(approved.result.transaction.proposal.source.id, 'native');
    assert.equal(approved.result.transaction.proposal.source.provider, getProviderDefinition('codex').id);
    assert.equal(approved.result.transaction.proposal.source.via, 'provider');
  } finally {
    registry.disposeAll();
    await rm(root, { force: true, recursive: true });
  }
});

test('daemon normalizes provider patch controls to an approval-gated preview', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-provider-normalized-patch-'));
  const registry = createPatchApprovalRegistry();

  try {
    const generated = await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power and I2C connector.'
    });
    const before = await readFile(generated.files.spec, 'utf8');
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
    assert.equal(await readFile(generated.files.spec, 'utf8'), before);
  } finally {
    registry.disposeAll();
    await rm(root, { force: true, recursive: true });
  }
});

test('daemon ignores disallowed provider calls with inspect and succeeds via fallback', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-provider-exception-restore-'));

  try {
    const generated = await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power and I2C connector.'
    });
    const before = await readFile(generated.files.spec, 'utf8');

    let callCount = 0;
    const result = await dispatchToolCall(
      {
        id: 'call_provider_exception_restore',
        name: 'project.request',
        args: { provider: 'codex', projectDir: root, prompt: 'Add reset button.' }
      },
      {
        checkProviderAvailabilityImpl: async ({ provider }) => ({ provider, command: 'codex', available: true, status: 'available' }),
        runProviderProcessImpl: async () => {
          callCount += 1;
          return {
            exitCode: 0,
            stderr: '',
            events: [
              createEnvelope('tool.call', { id: 'call_provider_inspect_then_fail', name: 'project.inspect', args: {} }),
              createEnvelope('tool.call', { id: 'call_provider_forbidden_create', name: 'project.create', args: { projectName: 'forbidden' } })
            ]
          };
        },
        inspectProjectImpl: async ({ projectDir }) => ({ ok: true, inspection: { projectDir }, validation: { erc: { ok: true } } }),
        validateProjectImpl: passingErc,
        validateBoardImpl: passingDrc
      }
    );
    assert.equal(result.ok, true);
    assert.equal(result.result.requiresApproval, true);
    assert.equal(callCount, 2);

    assert.equal(await readFile(generated.files.spec, 'utf8'), before);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('daemon ignores disallowed calls after patch preview and succeeds without retry', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-provider-created-file-restore-'));

  try {
    const generated = await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power and I2C connector.'
    });
    const originalFiles = await Promise.all(
      Object.values(generated.files).map(async (file) => [file, await readFile(file)])
    );

    let callCount = 0;
    const result = await dispatchToolCall(
      {
        id: 'call_provider_created_file_exception_restore',
        name: 'project.request',
        args: { provider: 'codex', projectDir: root, prompt: 'Add reset button.' }
      },
      {
        checkProviderAvailabilityImpl: async ({ provider }) => ({ provider, command: 'codex', available: true, status: 'available' }),
        runProviderProcessImpl: async () => {
          callCount += 1;
          return {
            exitCode: 0,
            stderr: '',
            events: [
              createEnvelope('tool.call', {
                id: 'call_patch_then_fail',
                name: 'schematic.patch',
                args: { prompt: 'STM32 board with USB-C power and UART header.' }
              }),
              createEnvelope('tool.call', {
                id: 'call_provider_forbidden_create',
                name: 'project.create',
                args: { projectName: 'forbidden' }
              })
            ]
          };
        },
        validateProjectImpl: passingErc,
        validateBoardImpl: passingDrc,
        patchApprovalRegistry: createPatchApprovalRegistry()
      }
    );
    assert.equal(result.ok, true);
    assert.equal(result.result.requiresApproval, true);
    assert.equal(callCount, 1);

    for (const [file, content] of originalFiles) {
      assert.deepEqual(await readFile(file), content);
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('daemon restores an existing project snapshot after an exceptional provider exit', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-provider-exception-restore-'));

  try {
    const generated = await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power and I2C connector.'
    });
    const before = await readFile(generated.files.spec, 'utf8');

    const rejected = await dispatchToolCall(
      {
        id: 'call_provider_exception_restore',
        name: 'project.request',
        args: { provider: 'codex', projectDir: root, prompt: 'Inspect then fail.' }
      },
      {
        checkProviderAvailabilityImpl: async ({ provider }) => ({
          provider,
          command: 'codex',
          available: true,
          status: 'available'
        }),
        runProviderProcessImpl: async () => ({
          exitCode: 0,
          stderr: '',
          events: [
            createEnvelope('tool.call', {
              id: 'call_provider_inspect_then_fail',
              name: 'project.inspect',
              args: {}
            })
          ]
        }),
        inspectProjectImpl: async () => {
          await writeFile(generated.files.spec, 'mutated before exceptional exit\n', 'utf8');
          throw new Error('inspection failed after mutating the project');
        }
      }
    );

    assert.equal(rejected.ok, false);
    assert.match(rejected.error.message, /inspection failed after mutating the project/);
    assert.equal(await readFile(generated.files.spec, 'utf8'), before);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('daemon removes provider-created files when restoring after an exceptional project request', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-provider-created-file-restore-'));

  try {
    const generated = await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power and I2C connector.'
    });
    const originalFiles = await Promise.all(
      Object.values(generated.files).map(async (file) => [file, await readFile(file)])
    );
    const createdFile = path.join(root, 'exception-created.kicad_sch');
    let candidateDir;

    const rejected = await dispatchToolCall(
      {
        id: 'call_provider_created_file_exception_restore',
        name: 'project.request',
        args: { provider: 'codex', projectDir: root, prompt: 'Inspect then fail.' }
      },
      {
        checkProviderAvailabilityImpl: async ({ provider }) => ({
          provider,
          command: 'codex',
          available: true,
          status: 'available'
        }),
        runProviderProcessImpl: async () => ({
          exitCode: 0,
          stderr: '',
          events: [
            createEnvelope('tool.call', {
              id: 'call_patch_then_fail',
              name: 'schematic.patch',
              args: { prompt: 'STM32 board with USB-C power and UART header.' }
            }),
            createEnvelope('tool.call', {
              id: 'call_provider_inspect_after_patch',
              name: 'project.inspect',
              args: {}
            })
          ]
        }),
        validateProjectImpl: async ({ projectDir }) => {
          if (path.resolve(projectDir) !== path.resolve(root)) candidateDir = projectDir;
          return { ok: true, skipped: false, erc: { errorCount: 0, warningCount: 0, byType: {} } };
        },
        validateBoardImpl: passingDrc,
        inspectProjectImpl: async () => {
          await writeFile(createdFile, 'provider-created schematic\n', 'utf8');
          throw new Error('dispatch failed after creating a project file');
        }
      }
    );

    assert.equal(rejected.ok, false);
    assert.match(rejected.error.message, /dispatch failed after creating a project file/);
    await assert.rejects(() => access(createdFile), { code: 'ENOENT' });
    for (const [file, content] of originalFiles) {
      assert.deepEqual(await readFile(file), content);
    }
    assert.ok(candidateDir);
    assert.equal(path.resolve(candidateDir).startsWith(`${path.resolve(root)}${path.sep}`), false);
    await assert.rejects(() => access(candidateDir), { code: 'ENOENT' });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('daemon keeps the project and snapshot when restore copy fails', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-restore-cp-fail-'));
  let rejected;

  try {
    const generated = await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power and I2C connector.'
    });
    const originalFiles = await Promise.all(
      Object.values(generated.files).map(async (file) => [file, await readFile(file)])
    );

    rejected = await dispatchToolCall(
      {
        id: 'call_restore_cp_fails',
        name: 'project.request',
        args: { provider: 'codex', projectDir: root, prompt: 'Inspect then fail.' }
      },
      {
        checkProviderAvailabilityImpl: async ({ provider }) => ({
          provider,
          command: 'codex',
          available: true,
          status: 'available'
        }),
        runProviderProcessImpl: async () => {
          throw new Error('provider exploded before restore');
        },
        snapshotFs: {
          cp: async (source, dest, options) => {
            if (String(dest).includes('.chatpcb-staging-')) {
              throw new Error('injected cp failure');
            }
            return cp(source, dest, options);
          }
        }
      }
    );

    assert.equal(rejected.ok, false);
    assert.equal(typeof rejected.error.snapshotPath, 'string');
    assert.ok(rejected.error.message.includes(rejected.error.snapshotPath));
    assert.match(rejected.error.message, /injected cp failure/);
    assert.match(rejected.error.message, /provider exploded before restore/);
    for (const [file, content] of originalFiles) {
      assert.deepEqual(await readFile(file), content);
    }
    assert.ok((await readdir(root)).length > 0);
    const snapshotSpec = path.join(rejected.error.snapshotPath, 'project', path.basename(generated.files.spec));
    assert.equal(await readFile(snapshotSpec, 'utf8'), await readFile(generated.files.spec, 'utf8'));
    const base = path.basename(root);
    const leftovers = (await readdir(path.dirname(root))).filter((name) => name.includes(base) && name !== base);
    assert.deepEqual(leftovers, []);
  } finally {
    if (rejected?.error?.snapshotPath) await rm(rejected.error.snapshotPath, { recursive: true, force: true });
    await rm(root, { force: true, recursive: true });
  }
});

test('daemon puts the project back when the restore rename fails and keeps the snapshot', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-restore-rename-fail-'));
  let rejected;

  try {
    const generated = await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power and I2C connector.'
    });
    const before = await readFile(generated.files.spec, 'utf8');

    rejected = await dispatchToolCall(
      {
        id: 'call_restore_rename_fails',
        name: 'project.request',
        args: { provider: 'codex', projectDir: root, prompt: 'Inspect then fail.' }
      },
      {
        checkProviderAvailabilityImpl: async ({ provider }) => ({
          provider,
          command: 'codex',
          available: true,
          status: 'available'
        }),
        runProviderProcessImpl: async () => {
          await writeFile(generated.files.spec, `${before}\nmutated during request\n`, 'utf8');
          throw new Error('provider exploded after mutating the project');
        },
        snapshotFs: {
          rename: async (source, dest) => {
            if (String(source).includes('.chatpcb-staging-')) {
              throw new Error('injected rename failure');
            }
            return rename(source, dest);
          }
        }
      }
    );

    assert.equal(rejected.ok, false);
    assert.equal(typeof rejected.error.snapshotPath, 'string');
    assert.ok(rejected.error.message.includes(rejected.error.snapshotPath));
    assert.match(rejected.error.message, /injected rename failure/);
    assert.match(await readFile(generated.files.spec, 'utf8'), /mutated during request/);
    assert.equal(await readFile(path.join(rejected.error.snapshotPath, 'project', path.basename(generated.files.spec)), 'utf8'), before);
    const base = path.basename(root);
    const leftovers = (await readdir(path.dirname(root))).filter((name) => name.includes(base) && name !== base);
    assert.deepEqual(leftovers, []);
  } finally {
    if (rejected?.error?.snapshotPath) await rm(rejected.error.snapshotPath, { recursive: true, force: true });
    await rm(root, { force: true, recursive: true });
  }
});

test('daemon names the backup directory when the restore swap and rollback renames both fail', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-restore-double-rename-'));
  const specPath = path.join(root, 'board.chatpcb.json');
  let rejected;

  try {
    await writeFile(specPath, 'original-spec\n');
    let renames = 0;

    rejected = await dispatchToolCall(
      {
        id: 'call_restore_swap_and_rollback_fail',
        name: 'project.request',
        args: { provider: 'codex', projectDir: root, prompt: 'Inspect then fail.' }
      },
      {
        checkProviderAvailabilityImpl: async ({ provider }) => ({
          provider,
          command: 'codex',
          available: true,
          status: 'available'
        }),
        runProviderProcessImpl: async () => {
          await writeFile(specPath, 'mutated-spec\n');
          throw new Error('provider exploded after mutating the project');
        },
        snapshotFs: {
          rename: async (source, dest) => {
            renames += 1;
            if (renames >= 2) {
              const error = new Error(`EPERM ${renames}`);
              error.code = 'EPERM';
              throw error;
            }
            return rename(source, dest);
          }
        }
      }
    );

    assert.equal(rejected.ok, false);
    assert.equal(renames >= 3, true);
    assert.equal(typeof rejected.error.backupPath, 'string');
    assert.match(rejected.error.backupPath, /\.chatpcb-backup-/);
    assert.equal(typeof rejected.error.snapshotPath, 'string');
    assert.ok(rejected.error.message.includes(rejected.error.backupPath));
    assert.ok(rejected.error.message.includes(rejected.error.snapshotPath));
    assert.match(rejected.error.message, /provider exploded after mutating the project/);
    assert.match(rejected.error.message, /EPERM/);
    await assert.rejects(() => access(root), { code: 'ENOENT' });
    assert.equal(await readFile(path.join(rejected.error.backupPath, 'board.chatpcb.json'), 'utf8'), 'mutated-spec\n');
    assert.equal(
      await readFile(path.join(rejected.error.snapshotPath, 'project', 'board.chatpcb.json'), 'utf8'),
      'original-spec\n'
    );
  } finally {
    if (rejected?.error?.snapshotPath) await rm(rejected.error.snapshotPath, { recursive: true, force: true });
    if (rejected?.error?.backupPath) await rm(rejected.error.backupPath, { recursive: true, force: true });
    const parent = path.dirname(root);
    const base = path.basename(root);
    const names = await readdir(parent).catch(() => []);
    await Promise.all(names.filter((name) => (
      name.startsWith(`.chatpcb-staging-${base}-`) || name.startsWith(`.chatpcb-backup-${base}-`)
    )).map((name) => rm(path.join(parent, name), { recursive: true, force: true })));
    await rm(root, { force: true, recursive: true });
  }
});

test('daemon keeps the restored project and warns when backup cleanup fails', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-restore-backup-rm-fail-'));
  const progress = [];
  const snapshotRoots = [];
  let rejected;

  try {
    const generated = await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power and I2C connector.'
    });
    const before = await readFile(generated.files.spec, 'utf8');

    rejected = await dispatchToolCall(
      {
        id: 'call_restore_backup_rm_fails',
        name: 'project.request',
        args: { provider: 'codex', projectDir: root, prompt: 'Inspect then fail.' }
      },
      {
        checkProviderAvailabilityImpl: async ({ provider }) => ({
          provider,
          command: 'codex',
          available: true,
          status: 'available'
        }),
        runProviderProcessImpl: async () => {
          await writeFile(generated.files.spec, `${before}\nmutated during request\n`, 'utf8');
          throw new Error('provider exploded after mutating the project');
        },
        emit: (type, payload) => progress.push({ type, ...payload }),
        snapshotFs: {
          mkdtemp: async (prefix) => {
            const created = await mkdtemp(prefix);
            snapshotRoots.push(created);
            return created;
          },
          rm: async (target, options) => {
            if (String(target).includes('.chatpcb-backup-')) {
              const error = new Error('injected backup rm failure');
              error.code = 'EPERM';
              throw error;
            }
            return rm(target, options);
          }
        }
      }
    );

    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.message, 'provider exploded after mutating the project');
    assert.equal(rejected.error.snapshotPath, undefined);
    assert.equal(rejected.error.backupPath, undefined);
    assert.doesNotMatch(rejected.error.message, /Failed to restore|injected backup rm failure/);
    assert.equal(await readFile(generated.files.spec, 'utf8'), before);
    const warning = progress.find((item) => (
      item.type === 'agent.delta'
      && item.channel === 'progress'
      && typeof item.text === 'string'
      && item.text.includes('.chatpcb-backup-')
    ));
    assert.ok(warning);
    assert.equal(warning.stage, 'warn');
    const backupPath = warning.text.match(/(\S*\.chatpcb-backup-\S+)/)?.[1];
    assert.equal(typeof backupPath, 'string');
    assert.ok(warning.text.includes(backupPath));
    assert.equal(
      await readFile(path.join(backupPath, path.basename(generated.files.spec)), 'utf8'),
      `${before}\nmutated during request\n`
    );
    assert.equal(snapshotRoots.length > 0, true);
    for (const snapshotRoot of snapshotRoots) {
      await assert.rejects(() => access(snapshotRoot), { code: 'ENOENT' });
    }
  } finally {
    if (rejected?.error?.snapshotPath) await rm(rejected.error.snapshotPath, { recursive: true, force: true });
    if (rejected?.error?.backupPath) await rm(rejected.error.backupPath, { recursive: true, force: true });
    const parent = path.dirname(root);
    const base = path.basename(root);
    const names = await readdir(parent).catch(() => []);
    await Promise.all(names.filter((name) => (
      name.startsWith(`.chatpcb-staging-${base}-`) || name.startsWith(`.chatpcb-backup-${base}-`)
    )).map((name) => rm(path.join(parent, name), { recursive: true, force: true })));
    await Promise.all(snapshotRoots.map((snapshotRoot) => rm(snapshotRoot, { recursive: true, force: true })));
    await rm(root, { recursive: true, force: true });
  }
});

test('daemon PROJECT_BUSY responses hide the project path and follow the prompt language', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-project-busy-'));
  const mutex = createProjectMutexRegistry();
  const registry = createPatchApprovalRegistry();
  const services = await transactionServices({
    projectMutexRegistry: mutex,
    patchApprovalRegistry: registry
  });
  const english = 'Another operation is using this project. Try again in a moment.';
  const korean = '다른 작업이 이 프로젝트를 사용 중이에요. 잠시 후 다시 시도하세요.';
  const assertHidden = (result) => {
    const encoded = JSON.stringify(result);
    assert.equal(encoded.includes(root), false);
    assert.equal(encoded.includes('Another ChatPCB transaction is active'), false);
  };

  try {
    await writeFile(path.join(root, 'board.chatpcb.json'), '{}\n');
    registry.register({
      patchId: 'patch-busy',
      projectDir: root,
      plan: { proposalId: 'patch-busy', changes: [] }
    });

    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    let started;
    const startedLock = new Promise((resolve) => {
      started = resolve;
    });
    const lockPromise = mutex.runExclusive({ projectDir: root }, async () => {
      started();
      await held;
    });
    await startedLock;

    try {
      const request = await dispatchToolCall({
        id: 'busy-request-en',
        name: 'project.request',
        args: { provider: 'codex', projectDir: root, prompt: 'Add a status LED.' }
      }, services);
      assert.equal(request.ok, false);
      assert.equal(request.error.code, 'PROJECT_BUSY');
      assert.equal(request.error.message, english);
      assertHidden(request);

      const requestKo = await dispatchToolCall({
        id: 'busy-request-ko',
        name: 'project.request',
        args: { provider: 'codex', projectDir: root, prompt: '상태 LED를 추가해 주세요.' }
      }, services);
      assert.equal(requestKo.ok, false);
      assert.equal(requestKo.error.code, 'PROJECT_BUSY');
      assert.equal(requestKo.error.message, korean);
      assertHidden(requestKo);

      const patch = await dispatchToolCall({
        name: 'schematic.patch',
        args: { projectDir: root, prompt: 'Add a UART header.' }
      }, services);
      assert.equal(patch.ok, false);
      assert.equal(patch.error.code, 'PROJECT_BUSY');
      assert.equal(patch.error.message, english);
      assertHidden(patch);

      const generate = await dispatchToolCall({
        name: 'schematic.generate',
        args: { projectDir: root, prompt: 'UART 헤더를 추가해 주세요.' }
      }, services);
      assert.equal(generate.ok, false);
      assert.equal(generate.error.code, 'PROJECT_BUSY');
      assert.equal(generate.error.message, korean);
      assertHidden(generate);

      const apply = await dispatchToolCall({
        name: 'schematic.patch',
        args: { projectDir: root, approved: true, patchId: 'patch-busy' }
      }, services);
      assert.equal(apply.ok, false);
      assert.equal(apply.error.code, 'PROJECT_BUSY');
      assert.equal(apply.error.message, english);
      assertHidden(apply);

      const applyKo = await dispatchToolCall({
        name: 'schematic.patch',
        args: { projectDir: root, approved: true, patchId: 'patch-busy', prompt: 'LED를 추가해 주세요.' }
      }, services);
      assert.equal(applyKo.ok, false);
      assert.equal(applyKo.error.code, 'PROJECT_BUSY');
      assert.equal(applyKo.error.message, korean);
      assertHidden(applyKo);

      const bareApply = await dispatchToolCall({
        name: 'schematic.patch',
        args: { projectDir: root, approved: true, patchId: 'patch-busy' }
      }, {
        projectMutexRegistry: mutex,
        patchApprovalRegistry: registry
      });
      assert.equal(bareApply.ok, false);
      assert.equal(bareApply.error.code, 'PROJECT_BUSY');
      assert.equal(bareApply.error.message, english);
      assertHidden(bareApply);

      const status = await dispatchToolCall({
        name: 'project.transaction.status',
        args: { projectDir: root }
      }, services);
      assert.equal(status.ok, false);
      assert.equal(status.error.code, 'PROJECT_BUSY');
      assert.equal(status.error.message, english);
      assertHidden(status);
    } finally {
      release();
      await lockPromise;
    }
  } finally {
    registry.disposeAll();
    await rm(root, { recursive: true, force: true });
    await rm(services.stateRoot, { recursive: true, force: true });
  }
});

test('schematic apply issued during a failing project.request runs after it and keeps its changes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-request-apply-serialize-'));
  const services = await transactionServices();
  const order = [];
  let releaseProvider = () => {};
  const providerGate = new Promise((resolve) => {
    releaseProvider = resolve;
  });
  let markProviderEntered = () => {};
  const providerEntered = new Promise((resolve) => {
    markProviderEntered = resolve;
  });
  let requestPromise;
  let applyPromise;
  let observedBusy = false;

  try {
    const generated = await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power and I2C connector.'
    });
    const originalSpec = await readFile(generated.files.spec, 'utf8');
    const preview = await dispatchToolCall({
      name: 'schematic.patch',
      args: {
        projectDir: root,
        prompt: 'STM32 board with USB-C power, 3.3V regulator, I2C connector, UART header, reset button, boot button, and LED.'
      }
    }, services);
    assert.equal(preview.ok, true);
    assert.equal(preview.result.requiresApproval, true);
    assert.equal(await readFile(generated.files.spec, 'utf8'), originalSpec);

    const applyArgs = {
      name: 'schematic.patch',
      args: { projectDir: root, approved: true, patchId: preview.result.patchId }
    };
    requestPromise = dispatchToolCall(
      {
        id: 'call_failing_request_while_apply_waits',
        name: 'project.request',
        args: { provider: 'codex', projectDir: root, prompt: 'Inspect then fail.' }
      },
      {
        ...services,
        checkProviderAvailabilityImpl: async ({ provider }) => ({
          provider,
          command: 'codex',
          available: true,
          status: 'available'
        }),
        runProviderProcessImpl: async () => {
          markProviderEntered();
          await providerGate;
          throw new Error('provider failed while a schematic apply was in flight');
        },
        snapshotFs: {
          rename: async (source, dest) => {
            order.push('restore');
            return rename(source, dest);
          }
        }
      }
    );

    applyPromise = (async () => {
      await providerEntered;
      const during = await dispatchToolCall(applyArgs, services);
      assert.equal(during.ok, false);
      assert.equal(during.error.code, 'PROJECT_BUSY');
      observedBusy = true;
      const deadline = Date.now() + 60000;
      while (Date.now() < deadline) {
        const result = await dispatchToolCall(applyArgs, services);
        if (result.error?.code === 'PROJECT_BUSY') {
          await new Promise((resolve) => setTimeout(resolve, 10));
          continue;
        }
        if (!result.ok || result.result?.applied !== true) {
          throw new Error(`schematic apply did not stick: ${result.error?.code ?? ''} ${result.error?.message ?? ''}`.trim());
        }
        order.push('applied');
        return result;
      }
      throw new Error('schematic apply did not run after the failing project.request');
    })();

    await providerEntered;
    await waitFor(() => observedBusy, 5000);
    assert.equal(await readFile(generated.files.spec, 'utf8'), originalSpec);
    releaseProvider();

    const failed = await requestPromise;
    const applied = await applyPromise;
    assert.equal(failed.ok, false);
    assert.match(failed.error.message, /provider failed while a schematic apply was in flight/);
    assert.equal(failed.error.snapshotPath, undefined);
    assert.equal(applied.result.applied, true);
    assert.ok(order.indexOf('restore') >= 0);
    assert.ok(order.indexOf('applied') > order.indexOf('restore'));
    const finalSpec = await readFile(generated.files.spec, 'utf8');
    assert.notEqual(finalSpec, originalSpec);
    assert.equal(await readFile(generated.files.spec, 'utf8'), finalSpec);
  } finally {
    releaseProvider();
    await Promise.allSettled([requestPromise, applyPromise].filter(Boolean));
    services.patchApprovalRegistry.disposeAll();
    await rm(root, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
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

test('daemon does not retry or preview when provider.cancel lands before the disallowed-tool retry', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-cancel-before-retry-'));
  const controllers = new Map();
  const invocationId = 'call_cancel_before_retry';
  let providerCalls = 0;

  try {
    const result = await dispatchToolCall(
      {
        id: invocationId,
        name: 'project.request',
        args: { provider: 'codex', projectDir: root, prompt: 'Create an RP2040 board.' }
      },
      {
        providerControllers: controllers,
        checkProviderAvailabilityImpl: async ({ provider }) => ({
          provider,
          command: 'codex',
          available: true,
          status: 'available'
        }),
        runProviderProcessImpl: async () => {
          providerCalls += 1;
          if (providerCalls === 1) {
            const cancelResult = await dispatchToolCall(
              { name: 'provider.cancel', args: { id: invocationId } },
              { providerControllers: controllers }
            );
            assert.equal(cancelResult.ok, true);
            assert.equal(cancelResult.result.cancelled, true);
            assert.equal(controllers.has(invocationId), false);
            return {
              exitCode: 0,
              stderr: '',
              events: [
                createEnvelope('tool.call', {
                  id: 'call_disallowed_create',
                  name: 'project.create',
                  args: { projectName: 'Should Not Retry' }
                })
              ]
            };
          }
          return {
            exitCode: 0,
            stderr: '',
            events: [
              createEnvelope('tool.call', {
                id: 'call_retry_generate',
                name: 'schematic.generate',
                args: { prompt: 'RP2040 board with USB-C power and a status LED.' }
              })
            ]
          };
        },
        validateProjectImpl: passingErc,
        validateBoardImpl: passingDrc
      }
    );

    assert.equal(providerCalls, 1);
    assert.equal(result.ok, false);
    assert.match(result.error.message, /cancelled/);
    assert.equal(result.result, undefined);
    assert.equal(controllers.size, 0);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('daemon releases provider controllers after success and does not reuse an aborted one', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-controller-release-'));
  const controllers = new Map();
  const prompt = 'Create an STM32 board.';
  const events = [
    createEnvelope('tool.call', {
      id: 'call_generate_release',
      name: 'schematic.generate',
      args: { prompt: 'STM32 board with USB-C power, I2C connector, reset button, and status LED.' }
    })
  ];

  function seedAborted(id) {
    const aborted = new AbortController();
    aborted.abort();
    controllers.set(id, aborted);
    return aborted;
  }

  async function requestOnce({ id, invocationId, key }) {
    const registrationId = key ?? id;
    const seeded = seedAborted(registrationId);
    let observedAbort = null;
    let observedSignal = null;
    const result = await dispatchToolCall(
      {
        id,
        name: 'project.request',
        args: {
          provider: 'codex',
          projectDir: root,
          prompt,
          ...(invocationId ? { invocationId } : {})
        }
      },
      {
        ...providerOptions({
          events,
          runProviderProcessImpl: async ({ signal }) => {
            observedAbort = signal.aborted;
            observedSignal = signal;
            return { exitCode: 0, stderr: '', events };
          }
        }),
        providerControllers: controllers
      }
    );
    assert.equal(result.ok, true, result.error?.message);
    assert.equal(result.result.requiresApproval, true);
    assert.equal(observedAbort, false);
    assert.notEqual(observedSignal, seeded.signal);
    assert.equal(controllers.has(registrationId), false);
    assert.equal(controllers.has(id), false);
    assert.equal(controllers.size, 0);
    return result;
  }

  try {
    await requestOnce({ id: 'call_release_plain' });
    await requestOnce({ id: 'call_release_plain' });
    await requestOnce({ id: 'call_release_explicit', invocationId: 'explicit-invocation', key: 'explicit-invocation' });
    await requestOnce({ id: 'call_release_explicit', invocationId: 'explicit-invocation', key: 'explicit-invocation' });

    const invokeId = 'call_invoke_release';
    const seededInvoke = seedAborted(invokeId);
    let invokeAbort = null;
    let invokeSignal = null;
    const invoked = await dispatchToolCall(
      {
        id: invokeId,
        name: 'provider.invoke',
        args: { provider: 'codex', prompt: 'Say hello.' }
      },
      {
        providerControllers: controllers,
        checkProviderAvailabilityImpl: async ({ provider }) => ({ provider, command: 'codex', available: true, status: 'available' }),
        runProviderProcessImpl: async ({ signal }) => {
          invokeAbort = signal.aborted;
          invokeSignal = signal;
          return { exitCode: 0, stderr: '', events: [] };
        }
      }
    );
    assert.equal(invoked.ok, true, invoked.error?.message);
    assert.equal(invokeAbort, false);
    assert.notEqual(invokeSignal, seededInvoke.signal);
    assert.equal(controllers.size, 0);

    const explicitInvoke = 'explicit-invoke-id';
    const seededExplicit = seedAborted(explicitInvoke);
    let explicitAbort = null;
    let explicitSignal = null;
    const invokedExplicit = await dispatchToolCall(
      {
        id: 'call_invoke_explicit',
        name: 'provider.invoke',
        args: { provider: 'codex', prompt: 'Say hello again.', invocationId: explicitInvoke }
      },
      {
        providerControllers: controllers,
        checkProviderAvailabilityImpl: async ({ provider }) => ({ provider, command: 'codex', available: true, status: 'available' }),
        runProviderProcessImpl: async ({ signal }) => {
          explicitAbort = signal.aborted;
          explicitSignal = signal;
          return { exitCode: 0, stderr: '', events: [] };
        }
      }
    );
    assert.equal(invokedExplicit.ok, true, invokedExplicit.error?.message);
    assert.equal(explicitAbort, false);
    assert.notEqual(explicitSignal, seededExplicit.signal);
    assert.equal(controllers.has(explicitInvoke), false);
    assert.equal(controllers.has('call_invoke_explicit'), false);
    assert.equal(controllers.size, 0);

    let reusedAbort = null;
    const reused = await dispatchToolCall(
      {
        id: 'call_invoke_explicit',
        name: 'provider.invoke',
        args: { provider: 'codex', prompt: 'Say hello again.', invocationId: explicitInvoke }
      },
      {
        providerControllers: controllers,
        checkProviderAvailabilityImpl: async ({ provider }) => ({ provider, command: 'codex', available: true, status: 'available' }),
        runProviderProcessImpl: async ({ signal }) => {
          reusedAbort = signal.aborted;
          return { exitCode: 0, stderr: '', events: [] };
        }
      }
    );
    assert.equal(reused.ok, true, reused.error?.message);
    assert.equal(reusedAbort, false);
    assert.equal(controllers.size, 0);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
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
    validateProjectImpl: async () => validation,
    validateBoardImpl: passingDrc
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
  const stateRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-daemon-ws-journal-'));
  const daemon = await startDaemon({
    port: 0,
    dispatchOptions: {
      transactionStateRoot: stateRoot,
      verifyAppliedProjectImpl: passingVerify,
      validateProjectImpl: passingErc,
      validateBoardImpl: passingDrc
    }
  });

  try {
    const generated = await generateMcuPeripheralProject({
      projectDir: root,
      prompt:
        'STM32 board with USB-C power, 3.3V regulator, I2C sensor connector, UART debug header, reset button, and status LED.'
    });
    await appendFile(generated.files.schematic, `${'; oversized diff fixture\n'.repeat(4000)}`, 'utf8');

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
    await rm(stateRoot, { force: true, recursive: true });
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

test('daemon schematic.generate returns an approval preview and writes no KiCad artifacts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-daemon-generate-preview-'));

  try {
    const result = await dispatchToolCall({
      name: 'schematic.generate',
      args: {
        projectDir: root,
        prompt: 'RP2040 board with USB-C power, I2C connector, reset button, and LED.'
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.result.requiresApproval, true);
    assert.equal(result.result.applied, false);
    assert.match(result.result.patchId, /^sha256:/);
    assert.equal((await kicadArtifacts(root)).length, 0);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('initial project.request returns requiresApproval and writes no KiCad artifacts', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-request-preview-'));

  try {
    const created = await dispatchToolCall({
      name: 'project.create',
      args: { workspaceRoot, projectName: 'Preview Board' }
    });
    const result = await dispatchToolCall(
      {
        id: 'call_request_preview_only',
        name: 'project.request',
        args: {
          provider: 'codex',
          projectDir: created.result.projectDir,
          prompt: '가스 센서용 STM32 보드와 USB-C 전원을 만들어 주세요.'
        }
      },
      providerOptions({
        events: [
          createEnvelope('tool.call', {
            id: 'call_generated_schematic',
            name: 'schematic.generate',
            args: { prompt: 'STM32 board with USB-C power, I2C gas sensor connector, reset button, and status LED.' }
          })
        ]
      })
    );

    assert.equal(result.ok, true);
    assert.equal(result.result.requiresApproval, true);
    assert.equal(result.result.applied, false);
    assert.equal(result.result.operation, 'generated');
    assert.equal((await kicadArtifacts(created.result.projectDir)).length, 0);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test('project.request streams progress agent.delta events', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-request-progress-'));
  const progress = [];

  try {
    const created = await dispatchToolCall({
      name: 'project.create',
      args: { workspaceRoot, projectName: 'Progress Board' }
    });
    const result = await dispatchToolCall(
      {
        id: 'call_request_progress',
        name: 'project.request',
        args: {
          provider: 'codex',
          projectDir: created.result.projectDir,
          prompt: '가스 센서용 STM32 보드와 USB-C 전원을 만들어 주세요.'
        }
      },
      {
        ...providerOptions({
          events: [
            createEnvelope('agent.delta', { text: 'Drafting from Codex.' }),
            createEnvelope('tool.call', {
              id: 'call_generated_schematic',
              name: 'schematic.generate',
              args: { prompt: 'STM32 board with USB-C power, I2C gas sensor connector, reset button, and status LED.' }
            })
          ]
        }),
        emit: (type, payload) => progress.push({ type, ...payload })
      }
    );

    assert.equal(result.ok, true);
    assert.ok(progress.some((item) => item.type === 'agent.delta' && item.stage === 'conversation'));
    assert.ok(progress.some((item) => item.stage === 'conversation' && item.conversation?.specRows?.length > 0));
    assert.ok(progress.some((item) => item.stage === 'provider' && /Drafting from Codex/.test(item.text ?? '')));
    assert.ok(progress.some((item) => item.stage === 'tool' && item.toolName === 'schematic.generate'));
    assert.ok(progress.some((item) => item.stage === 'ready'));
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test('direct daemon ERC and DRC validator mutations never reach the source directory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-daemon-readonly-validation-'));
  const generated = await generateMcuPeripheralProject({
    projectDir: root,
    prompt: 'RP2040 board with USB-C power and I2C connector.'
  });
  const beforeSchematic = await readFile(generated.files.schematic);
  const beforeSpec = await readFile(generated.files.spec);

  try {
    for (const name of ['validate.erc', 'validate.drc']) {
      const result = await dispatchToolCall(
        { name, args: { projectDir: root } },
        {
          validateProjectImpl: async ({ projectDir }) => {
            await writeFile(path.join(projectDir, path.basename(generated.files.schematic)), 'mutated-erc\n', 'utf8');
            await writeFile(path.join(projectDir, 'validator-marker'), 'erc\n', 'utf8');
            return { ok: true, skipped: false, erc: { errorCount: 0, warningCount: 0, byType: {} } };
          },
          validateBoardImpl: async ({ projectDir }) => {
            await writeFile(path.join(projectDir, 'drc-marker'), 'drc\n', 'utf8');
            return {
              ok: true,
              skipped: false,
              drc: { violationCount: 0, unconnectedCount: 0, byType: {} }
            };
          }
        }
      );

      assert.equal(result.ok, true);
      assert.deepEqual(await readFile(generated.files.schematic), beforeSchematic);
      assert.deepEqual(await readFile(generated.files.spec), beforeSpec);
      await assert.rejects(() => access(path.join(root, 'validator-marker')), { code: 'ENOENT' });
      await assert.rejects(() => access(path.join(root, 'drc-marker')), { code: 'ENOENT' });
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('simulate.spice ignores request ngspicePath and uses configured dispatchOptions.ngspicePath', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-daemon-spice-'));
  await writeFile(path.join(root, 'demo.cir'), '.op\n.end\n', 'utf8');
  const commands = [];

  try {
    const result = await dispatchToolCall(
      {
        name: 'simulate.spice',
        args: { projectDir: root, ngspicePath: '/untrusted/ngspice' }
      },
      {
        ngspicePath: '/trusted/ngspice',
        runCommandImpl: async (command, args) => {
          commands.push({ command, args });
          return { exitCode: 0, stdout: 'raw spice stdout', stderr: '' };
        }
      }
    );

    assert.equal(result.ok, true);
    assert.equal(commands.length, 1);
    assert.equal(commands[0].command, '/trusted/ngspice');
    assert.equal(JSON.stringify(result.result).includes('raw spice stdout'), false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('provider-emitted approval, rollback, nested selection, requiredValidation, and executable fields are stripped', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-provider-sanitize-'));
  const registry = createPatchApprovalRegistry();
  const inspectCalls = [];
  const spiceCommands = [];
  await generateMcuPeripheralProject({
    projectDir: root,
    prompt: 'RP2040 board with USB-C power and I2C connector.'
  });

  try {
    const result = await dispatchToolCall(
      {
        id: 'call_provider_sanitize',
        name: 'project.request',
        args: {
          provider: 'codex',
          projectDir: root,
          prompt: 'Add a reset button.',
          selection: { items: [{ kind: 'symbol', reference: 'U1' }] }
        }
      },
      {
        ...providerOptions({
          events: [
            createEnvelope('tool.call', {
              id: 'call_provider_patch_controls',
              name: 'schematic.patch',
              args: {
                prompt: 'RP2040 board with USB-C power, I2C connector, reset button, and status LED.',
                approved: true,
                cancel: true,
                patchId: 'provider-supplied-approval',
                expectedPatchId: 'provider-supplied-approval',
                proposalId: 'provider-supplied-proposal',
                selection: { items: [{ kind: 'nested', kiid: 'evil' }] },
                context: { dirty: true },
                requiredValidation: { erc: false, drc: false },
                kicadCliPath: process.execPath,
                ngspicePath: '/untrusted/ngspice',
                transactionId: 'txn_provider'
              }
            }),
            createEnvelope('tool.call', {
              id: 'call_provider_inspect_nested',
              name: 'project.inspect',
              args: {
                selection: { items: [{ kind: 'nested' }] },
                kicadCliPath: process.execPath
              }
            }),
            createEnvelope('tool.call', {
              id: 'call_provider_spice',
              name: 'simulate.spice',
              args: { ngspicePath: '/untrusted/ngspice' }
            })
          ]
        }),
        patchApprovalRegistry: registry,
        ngspicePath: '/trusted/ngspice',
        kicadCliPath: '/trusted/kicad-cli',
        inspectProjectImpl: async (args) => {
          inspectCalls.push(args);
          return { ok: true, inspection: { projectDigest: 'fixture' }, validation: { erc: { ok: true } } };
        },
        runCommandImpl: async (command) => {
          spiceCommands.push(command);
          return { exitCode: 0, stdout: '', stderr: '' };
        }
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.result.requiresApproval, true);
    assert.equal(result.result.applied, false);
    assert.match(result.result.patchId, /^sha256:/);
    assert.notEqual(result.result.patchId, 'provider-supplied-approval');
    assert.equal(result.result.requiredValidation?.erc, true);
    assert.equal(inspectCalls.length, 1);
    assert.deepEqual(inspectCalls[0].selection, { items: [{ kind: 'symbol', reference: 'U1' }] });
    assert.equal(inspectCalls[0].kicadCliPath, '/trusted/kicad-cli');
    assert.deepEqual(spiceCommands, ['/trusted/ngspice']);
  } finally {
    registry.disposeAll();
    await rm(root, { force: true, recursive: true });
  }
});

test('rollback and status are unavailable through provider allowed tools', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-provider-txn-tools-'));
  const services = await transactionServices({
    validateProjectImpl: passingErc,
    validateBoardImpl: passingDrc
  });
  let allowedToolNames;

  try {
    await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power and I2C connector.',
      validateProjectImpl: passingErc,
      validateBoardImpl: passingDrc
    });
    const preview = await dispatchToolCall({
      name: 'schematic.generate',
      args: {
        projectDir: root,
        prompt: 'STM32 board with USB-C power, I2C connector, reset button, and LED.'
      }
    }, services);
    const applied = await dispatchToolCall({
      name: 'schematic.patch',
      args: { projectDir: root, approved: true, patchId: preview.result.patchId }
    }, services);
    assert.equal(applied.result.applied, true);

    const result = await dispatchToolCall(
      {
        id: 'call_provider_txn_tools',
        name: 'provider.invoke',
        args: { provider: 'codex', projectDir: root, prompt: 'Rollback the last transaction.' }
      },
      {
        ...services,
        checkProviderAvailabilityImpl: async ({ provider }) => ({ provider, command: 'codex', available: true, status: 'available' }),
        runProviderProcessImpl: async (options) => {
          allowedToolNames = options.allowedToolNames;
          return {
            exitCode: 0,
            stderr: '',
            events: [
              createEnvelope('tool.call', {
                id: 'call_provider_status',
                name: 'project.transaction.status',
                args: { projectDir: root }
              }),
              createEnvelope('tool.call', {
                id: 'call_provider_rollback',
                name: 'project.transaction.rollback',
                args: { projectDir: root, transactionId: applied.result.transaction.transactionId }
              })
            ]
          };
        }
      }
    );

    assert.ok(!allowedToolNames.includes('project.transaction.status'));
    assert.ok(!allowedToolNames.includes('project.transaction.rollback'));
    assert.equal(result.ok, true);
    assert.equal(result.result.toolResults.every((toolResult) => toolResult.ok === false), true);
    assert.equal(result.result.toolResults.every((toolResult) => toolResult.error.code === 'DISALLOWED_TOOL'), true);

    const status = await dispatchToolCall({
      name: 'project.transaction.status',
      args: { projectDir: root }
    }, services);
    assert.equal(status.ok, true);
    assert.equal(status.result.transactions[0].status, 'applied');
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(root, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

test('configured allowedWorkspaceRoot owns project.create placement', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-create-owned-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'chatpcb-create-outside-'));

  try {
    const created = await dispatchToolCall(
      {
        name: 'project.create',
        args: { workspaceRoot: outside, projectName: 'Owned Board' }
      },
      { allowedWorkspaceRoot: workspaceRoot }
    );

    assert.equal(created.ok, true);
    assert.equal(path.dirname(created.result.projectDir), path.resolve(workspaceRoot));
    await assert.rejects(() => readdir(path.join(outside, 'Owned-Board')), { code: 'ENOENT' });
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
    await rm(outside, { force: true, recursive: true });
  }
});

test('public daemon preview omits absolute candidate paths, live validator paths, and raw stdout', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-daemon-redact-'));

  try {
    const result = await dispatchToolCall(
      {
        name: 'schematic.generate',
        args: {
          projectDir: root,
          prompt: 'RP2040 board with USB-C power and I2C connector.'
        }
      },
      {
        validateProjectImpl: async ({ projectDir }) => ({
          ok: true,
          skipped: false,
          report: path.join(projectDir, 'chatpcb-erc.json'),
          tool: path.join(projectDir, 'kicad-cli.exe'),
          stdout: 'raw validator stdout',
          erc: { errorCount: 0, warningCount: 0, byType: {} }
        })
      }
    );

    assert.equal(result.ok, true);
    const json = JSON.stringify(result.result);
    assert.equal(json.includes('chatpcb-native-proposal'), false);
    assert.equal(json.includes('raw validator stdout'), false);
    assert.equal(json.includes('chatpcb-erc.json'), false);
    assert.equal(result.result.candidateVerification.erc.ok, true);
    assert.equal(result.result.candidateVerification.erc.status, 'passed');
    assert.equal(result.result.requiredValidation?.erc, true);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('direct approval applies through ProjectTransaction and rollback restores the journaled project', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-daemon-txn-apply-'));
  const services = await transactionServices({
    validateProjectImpl: passingErc,
    validateBoardImpl: passingDrc
  });

  try {
    const before = await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power and I2C connector.',
      validateProjectImpl: passingErc,
      validateBoardImpl: passingDrc
    });
    const originalSpec = await readFile(before.files.spec, 'utf8');
    const preview = await dispatchToolCall({
      name: 'schematic.patch',
      args: {
        projectDir: root,
        prompt: 'STM32 board with USB-C power, 3.3V regulator, I2C connector, UART header, reset button, boot button, and LED.'
      }
    }, services);
    assert.equal(preview.result.requiresApproval, true);
    assert.equal(await readFile(before.files.spec, 'utf8'), originalSpec);

    const applied = await dispatchToolCall({
      name: 'schematic.patch',
      args: { projectDir: root, approved: true, patchId: preview.result.patchId }
    }, services);
    assert.equal(applied.ok, true);
    assert.equal(applied.result.applied, true);
    assert.equal(applied.result.transaction.status, 'applied');
    assert.notEqual(await readFile(before.files.spec, 'utf8'), originalSpec);

    const listed = await services.transactionJournal.list({ projectDir: root });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].status, 'applied');

    const status = await dispatchToolCall({
      name: 'project.transaction.status',
      args: { projectDir: root }
    }, services);
    assert.equal(status.result.transactions[0].transactionId, applied.result.transaction.transactionId);
    assert.equal(JSON.stringify(status.result).includes('beforeBase64'), false);
    assert.equal(JSON.stringify(status.result).includes('beforeBytes'), false);

    const rolled = await dispatchToolCall({
      name: 'project.transaction.rollback',
      args: { projectDir: root, transactionId: applied.result.transaction.transactionId }
    }, services);
    assert.equal(rolled.ok, true);
    assert.equal(rolled.result.rolledBack, true);
    assert.equal(await readFile(before.files.spec, 'utf8'), originalSpec);
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(root, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

test('preview holds the project mutex so a concurrent generate returns PROJECT_BUSY', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-daemon-preview-mutex-'));
  const mutex = createProjectMutexRegistry();

  try {
    await mutex.runExclusive({ projectDir: root }, async () => {
      const result = await dispatchToolCall({
        name: 'schematic.generate',
        args: {
          projectDir: root,
          prompt: 'RP2040 board with USB-C power and I2C connector.'
        }
      }, { projectMutexRegistry: mutex });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'PROJECT_BUSY');
    });
    assert.equal((await kicadArtifacts(root)).length, 0);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('provider requiredValidation cannot disable artifact-derived ERC', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-provider-required-validation-'));
  const registry = createPatchApprovalRegistry();
  await generateMcuPeripheralProject({
    projectDir: root,
    prompt: 'RP2040 board with USB-C power and I2C connector.'
  });

  try {
    const result = await dispatchToolCall(
      {
        id: 'call_provider_required_validation',
        name: 'project.request',
        args: { provider: 'codex', projectDir: root, prompt: 'Change the MCU.' }
      },
      {
        ...providerOptions({
          events: [
            createEnvelope('tool.call', {
              id: 'call_patch_disable_gates',
              name: 'schematic.patch',
              args: {
                prompt: 'STM32 board with USB-C power, I2C connector, reset button, and LED.',
                requiredValidation: { erc: false, drc: false }
              }
            })
          ]
        }),
        patchApprovalRegistry: registry
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.result.requiredValidation.erc, true);
    assert.notEqual(result.result.requiredValidation.erc, false);
  } finally {
    registry.disposeAll();
    await rm(root, { force: true, recursive: true });
  }
});

test('board-regenerating daemon preview runs candidate DRC', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-daemon-board-drc-'));
  const previous = setKicadLibraryEnv({ symbols: FIXTURE_LIBS.symbols });
  const drcCalls = [];
  try {
    const result = await dispatchToolCall({
      name: 'schematic.generate',
      args: {
        projectDir: root,
        prompt: 'Release profile ESP32-S3 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED.'
      }
    }, {
      validateProjectImpl: passingErc,
      validateBoardImpl: async (options) => {
        drcCalls.push(options);
        return { ok: true, skipped: false, executed: true, violations: [], unconnectedItems: [] };
      }
    });
    assert.equal(result.ok, true);
    assert.equal(drcCalls.length, 1);
    assert.equal(result.result.candidateVerification.drc.status, 'passed');
    assert.equal(result.result.requiredValidation.drc, true);
  } finally {
    restoreKicadLibraryEnv(previous);
    await rm(root, { force: true, recursive: true });
  }
});

test('direct project.inspect forwards trusted selection and keeps provider nested selection stripped', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-daemon-inspect-selection-'));
  try {
    await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power and I2C connector.'
    });
    const inspected = await dispatchToolCall({
      name: 'project.inspect',
      args: {
        projectDir: root,
        selection: {
          items: [
            { kind: 'symbol', reference: 'U1', kiid: 'sel-u1', position: { x: 10, y: 20 } },
            { kind: 'global_label', text: '+3V3', kiid: 'sel-3v3', position: { x: 30, y: 40 } }
          ]
        }
      }
    });
    assert.equal(inspected.ok, true);
    assert.equal(inspected.result.context.coverage.status, 'partial');
    assert.ok(inspected.result.context.coverage.diagnostics.some((item) => item.code === 'SELECTION_CONNECTIVITY_UNPROVEN'));

    const inspectCalls = [];
    await dispatchToolCall({
      id: 'call_provider_inspect_strip',
      name: 'provider.invoke',
      args: {
        provider: 'codex',
        projectDir: root,
        prompt: 'Inspect the board.',
        selection: { items: [{ kind: 'symbol', reference: 'U1', kiid: 'trusted', position: { x: 1, y: 1 } }] }
      }
    }, {
      checkProviderAvailabilityImpl: async ({ provider }) => ({ provider, command: 'codex', available: true, status: 'available' }),
      runProviderProcessImpl: async () => ({
        exitCode: 0,
        stderr: '',
        events: [createEnvelope('tool.call', {
          id: 'call_nested_inspect',
          name: 'project.inspect',
          args: { selection: { items: [{ kind: 'nested' }] } }
        })]
      }),
      inspectProjectImpl: async (args) => {
        inspectCalls.push(args);
        return { ok: true, inspection: { projectDigest: 'fixture' }, validation: { erc: { ok: true } } };
      }
    });
    assert.equal(inspectCalls[0].selection.items[0].kiid, 'trusted');
    assert.notEqual(inspectCalls[0].selection.items[0].kind, 'nested');
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('follow-up project.request after a spec exists uses the new prompt', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-daemon-followup-prompt-'));
  const previous = setKicadLibraryEnv({ symbols: FIXTURE_LIBS.symbols });
  try {
    await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power and I2C connector.'
    });
    await saveCircuitConversation(root, {
      status: 'generate',
      generatePrompt: 'RP2040 board with USB-C power and I2C connector.',
      sourcePrompt: 'RP2040 board with USB-C power and I2C connector.',
      answers: {}
    });
    const result = await dispatchToolCall({
      id: 'call_followup_prompt',
      name: 'project.request',
      args: {
        projectDir: root,
        prompt: 'Release profile ESP32-S3 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED.'
      }
    }, {
      ...providerOptions({ events: [] }),
      validateBoardImpl: passingDrc,
      verifyAppliedProjectImpl: passingVerify
    });
    assert.equal(result.ok, true);
    assert.equal(result.result.requiresApproval, true);
    assert.match(result.result.diff ?? JSON.stringify(result.result), /ESP32-S3|ESP32_S3/);
  } finally {
    restoreKicadLibraryEnv(previous);
    await rm(root, { force: true, recursive: true });
  }
});

test('transaction status reconcile waits behind the project mutex', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-daemon-reconcile-lock-'));
  const services = await transactionServices();
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  try {
    await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power and I2C connector.'
    });
    let started;
    const startedLock = new Promise((resolve) => {
      started = resolve;
    });
    const lockPromise = services.projectMutexRegistry.runExclusive({ projectDir: root }, async () => {
      started();
      await held;
    });
    await startedLock;
    const status = await dispatchToolCall({
      name: 'project.transaction.status',
      args: { projectDir: root }
    }, services);
    assert.equal(status.ok, false);
    assert.equal(status.error.code, 'PROJECT_BUSY');
    release();
    await lockPromise;
  } finally {
    await rm(root, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

const DISCRETE_LED_PROMPT = 'LED 하나와 330옴 저항을 5V에 연결하는 간단한 회로 만들어줘';

test('native schematic.generate of the same discrete LED prompt keeps LED, 330 ohm, and 5V part evidence', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-native-led-'));
  const services = await transactionServices({ validateProjectImpl: passingErc });
  const previous = setKicadLibraryEnv({ symbols: FIXTURE_LIBS.symbols, footprints: FIXTURE_LIBS.footprints });
  try {
    const result = await dispatchToolCall({
      name: 'schematic.generate',
      args: { projectDir: root, prompt: DISCRETE_LED_PROMPT }
    }, services);
    assert.equal(result.ok, true, result.error?.message);
    assert.equal(result.result.requiresApproval, true);
    assert.equal(result.result.applied, false);
    const components = result.result.components ?? [];
    const manifestParts = result.result.manifest?.parts ?? [];
    assert.ok(components.length > 0, 'preview parts list is empty');
    assert.ok(manifestParts.length > 0, 'preview manifest has no part evidence');
    const evidence = [...components, ...manifestParts];
    assert.ok(evidence.some((part) => part.libId === 'Device:LED'), JSON.stringify(evidence));
    assert.ok(
      evidence.some((part) => part.libId === 'Device:R' && /330/.test(String(part.value ?? ''))),
      JSON.stringify(evidence)
    );
    assert.ok(
      evidence.some((part) => part.libId === 'power:+5V' && part.value === '+5V'),
      JSON.stringify(evidence)
    );
    assert.ok(
      evidence.some((part) => String(part.libId ?? '').startsWith('Connector') && part.value === 'Conn_01x02'),
      JSON.stringify(evidence)
    );
    assert.match(result.result.diff ?? '', /Device:LED/);
    assert.match(result.result.diff ?? '', /330/);
    assert.match(result.result.diff ?? '', /partManifest/);
    assert.ok(
      !(result.result.review?.findings?.blockers ?? []).some((finding) => finding.code === 'mcu-part-missing'),
      JSON.stringify(result.result.review?.findings?.blockers)
    );
    assert.ok(!evidence.some((part) => part.libId === 'ChatPCB:MCU_PLACEHOLDER'));
  } finally {
    restoreKicadLibraryEnv(previous);
    services.patchApprovalRegistry.disposeAll();
    await rm(root, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});
test('daemon ignores disallowed calls from real child process provider and retries with fallback', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-integration-disallowed-'));

  try {
    const created = await dispatchToolCall({
      name: 'project.create',
      args: { workspaceRoot, projectName: 'Integration Board' }
    });

    await generateMcuPeripheralProject({
      projectDir: created.result.projectDir,
      prompt: 'RP2040 board with USB-C power and I2C connector.'
    });

    const fakeProviderPath = path.join(import.meta.dirname, 'fixtures', 'fake-provider-disallowed.mjs');
    let callCount = 0;

    const result = await dispatchToolCall(
      {
        id: 'call_integration_disallowed',
        name: 'project.request',
        args: { provider: 'codex', projectDir: created.result.projectDir, prompt: 'Add reset button.' }
      },
      {
        checkProviderAvailabilityImpl: async () => ({ provider: 'codex', command: process.execPath, available: true, status: 'available' }),
        getProviderDefinitionImpl: () => ({
          id: 'codex',
          label: 'Codex CLI',
          command: process.execPath,
          args: [fakeProviderPath],
          description: 'Test provider'
        }),
        validateProjectImpl: passingErc,
        validateBoardImpl: passingDrc,
        runProviderProcessImpl: async (options) => {
          callCount += 1;
          return await import('../src/runtime/provider-process.js').then((m) => m.runProviderProcess(options));
        }
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.result.requiresApproval, true);
    assert.equal(result.result.operation, 'patched');
    assert.equal(callCount, 2);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test('real provider child process reports DISALLOWED_TOOL and UNKNOWN_TOOL', async () => {
  const fakeProviderPath = path.join(import.meta.dirname, 'fixtures', 'fake-provider-tool-codes.mjs');

  const result = await dispatchToolCall(
    {
      id: 'call_provider_tool_codes',
      name: 'provider.invoke',
      args: { provider: 'codex', prompt: 'Rollback the last transaction.' }
    },
    {
      checkProviderAvailabilityImpl: async () => ({
        provider: 'codex',
        command: process.execPath,
        available: true,
        status: 'available'
      }),
      getProviderDefinitionImpl: () => ({
        id: 'codex',
        label: 'Codex CLI',
        command: process.execPath,
        args: [fakeProviderPath],
        description: 'Test provider'
      })
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.result.events[0].payload.text, 'Generating circuit draft...');
  assert.deepEqual(
    result.result.events.filter((event) => event.type === 'tool.call').map((event) => event.payload.name),
    ['project.transaction.rollback', 'board.autoroute']
  );
  assert.equal(result.result.toolResults.length, 2);

  const byId = new Map(result.result.toolResults.map((toolResult) => [toolResult.id, toolResult]));
  const disallowed = byId.get('call_disallowed');
  const unknown = byId.get('call_unknown');
  assert.equal(disallowed.ok, false);
  assert.equal(disallowed.error.code, 'DISALLOWED_TOOL');
  assert.equal(disallowed.error.message, 'project.transaction.rollback is not in the allowed tool list');
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'UNKNOWN_TOOL');
  assert.equal(unknown.error.message, 'Unknown ChatPCB tool: board.autoroute');
});
