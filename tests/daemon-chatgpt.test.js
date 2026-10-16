import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { transactionArtifactKind } from '../src/evidence/transaction-inventory.js';
import { dispatchToolCall } from '../src/runtime/agent-daemon.js';
import { saveCredentials } from '../src/runtime/auth/chatgpt-auth.js';
import { createPatchApprovalRegistry } from '../src/runtime/patch-approval-registry.js';
import { createProjectMutexRegistry } from '../src/runtime/project-mutex-registry.js';
import { CONVERSATION_FILE } from '../src/runtime/request-conversation.js';
import { createTransactionJournal } from '../src/runtime/transaction-journal.js';
import { FIXTURE_LIBS, restoreKicadLibraryEnv, setKicadLibraryEnv } from './helpers/kicad-library-env.js';
import { isolateHome } from './isolate-home.js';

// Same service stub as tests/daemon.test.js. Kept here so the ChatGPT cases
// can leave that file; the stub is small and the rest of the daemon suite stays put.
const passingVerify = async () => ({
  erc: { ok: true, skipped: false, executed: true, erc: { errorCount: 0, warningCount: 0 } },
  drc: { ok: true, skipped: true }
});
const passingDrc = async () => ({ ok: true, skipped: false, executed: true, violations: [], unconnectedItems: [] });
const passingErc = async () => ({ ok: true, skipped: false, erc: { errorCount: 0, warningCount: 0, byType: {} } });

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

const PROFILE_PROMPT = 'Release profile ESP32-S3 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED.';

function chatGptEventStream(text) {
  return new Response([
    `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}`,
    'data: {"type":"response.completed"}',
    ''
  ].join('\n'), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function stubChatGptFetch(responseText) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes('/v1/models')) {
      return new Response(JSON.stringify({ models: [{ slug: 'gpt-x', visibility: 'list' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (target.includes('/v1/responses')) return chatGptEventStream(responseText);
    return new Response('no', { status: 404 });
  };
  return () => {
    globalThis.fetch = original;
  };
}

async function withChatGptHome(fn) {
  const home = await isolateHome();
  try {
    await saveCredentials({
      client_id: 'oaiapp_TEST',
      access_token: 'AT',
      refresh_token: 'RT',
      expires_in: 3600,
      issued_at: Date.now(),
      scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
      scopes: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'.split(' ')
    });
    return await fn();
  } finally {
    await home.restore();
  }
}

function spyDaemonError() {
  const lines = [];
  const original = console.error;
  console.error = (...args) => {
    lines.push(args.map((part) => String(part)).join(' '));
  };
  return {
    lines,
    restore() {
      console.error = original;
    }
  };
}

function assertProfileParts(result) {
  const components = result.components ?? [];
  assert.equal(components.some((component) => component.value === 'TPS62177DQC' || String(component.libId).includes('TPS62177')), true);
}

test('chatgpt tool call records source.provider and keeps the profile parts list', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-chatgpt-source-'));
  const services = await transactionServices({
    validateProjectImpl: passingErc,
    verifyAppliedProjectImpl: async () => ({
      erc: { ok: true, skipped: false, executed: true, erc: { errorCount: 0, warningCount: 0 } },
      drc: { ok: true, skipped: false, executed: true, violations: [], unconnectedItems: [] }
    })
  });
  const logs = spyDaemonError();
  const previousLibs = setKicadLibraryEnv({ symbols: FIXTURE_LIBS.symbols, footprints: FIXTURE_LIBS.footprints });
  const restoreFetch = stubChatGptFetch(JSON.stringify({
    type: 'tool.call',
    payload: {
      id: 'call_draft',
      name: 'schematic.generate',
      args: { prompt: 'draft it' }
    }
  }));
  try {
    await withChatGptHome(async () => {
      const created = await dispatchToolCall({
        name: 'project.create',
        args: { workspaceRoot, projectName: 'Sensor Board' }
      });
      const result = await dispatchToolCall({
        id: 'call_chatgpt_profile',
        name: 'project.request',
        args: {
          provider: 'chatgpt',
          projectDir: created.result.projectDir,
          prompt: PROFILE_PROMPT
        }
      }, services);
      assert.equal(result.ok, true, result.error?.message);
      assert.equal(result.result.requiresApproval, true);
      assert.equal(result.result.source.provider, 'chatgpt');
      assert.equal(result.result.source.via, 'provider');
      assert.equal(result.result.source.id, 'native');
      assertProfileParts(result.result);
      const decision = logs.lines.filter((line) => line.includes('provider chatgpt:'));
      assert.deepEqual(decision, ['provider chatgpt: tool call schematic.generate via provider']);

      const approved = await dispatchToolCall({
        name: 'schematic.patch',
        args: {
          projectDir: created.result.projectDir,
          approved: true,
          patchId: result.result.patchId
        }
      }, services);
      assert.equal(approved.ok, true, approved.error?.message);
      assert.equal(approved.result.applied, true, JSON.stringify(approved.result.reason ?? approved.result));
      const status = await dispatchToolCall({
        name: 'project.transaction.status',
        args: { projectDir: created.result.projectDir }
      }, services);
      assert.equal(status.ok, true, status.error?.message);
      assert.equal(status.result.transactions[0].proposal.source.provider, 'chatgpt');
      assert.equal(status.result.transactions[0].proposal.source.via, 'provider');
    });
  } finally {
    restoreKicadLibraryEnv(previousLibs);
    logs.restore();
    restoreFetch();
    services.patchApprovalRegistry.disposeAll();
    await rm(workspaceRoot, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

test('chatgpt native fallback records provider null and still drafts profile parts', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-chatgpt-fallback-'));
  const services = await transactionServices({ validateProjectImpl: passingErc });
  const logs = spyDaemonError();
  const previousLibs = setKicadLibraryEnv({ symbols: FIXTURE_LIBS.symbols, footprints: FIXTURE_LIBS.footprints });
  const restoreFetch = stubChatGptFetch('The draft is ready.');
  try {
    await withChatGptHome(async () => {
      const created = await dispatchToolCall({
        name: 'project.create',
        args: { workspaceRoot, projectName: 'Fallback Sensor' }
      });
      const result = await dispatchToolCall({
        id: 'call_chatgpt_fallback',
        name: 'project.request',
        args: {
          provider: 'chatgpt',
          projectDir: created.result.projectDir,
          prompt: PROFILE_PROMPT
        }
      }, services);
      assert.equal(result.ok, true, result.error?.message);
      assert.equal(result.result.source.provider, null);
      assert.equal(result.result.source.via, 'native-fallback');
      assertProfileParts(result.result);
      const saved = JSON.parse(await readFile(path.join(created.result.projectDir, CONVERSATION_FILE), 'utf8'));
      assert.deepEqual(saved.lastSource, { provider: null, via: 'native-fallback' });
      const decision = logs.lines.filter((line) => line.includes('provider chatgpt:'));
      assert.deepEqual(decision, ['provider chatgpt: fell back to native: provider returned no tool call']);
    });
  } finally {
    restoreKicadLibraryEnv(previousLibs);
    logs.restore();
    restoreFetch();
    services.patchApprovalRegistry.disposeAll();
    await rm(workspaceRoot, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

const STM32_USER_PROMPT = 'Release profile STM32 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED.';
const STM32_REWRITTEN_PROMPT = 'STM32F103C8T6 board. USB-C is 5V power input only, with an AP2112K 3.3V regulator, UART debug header, reset button, status LED, and an SWD header for firmware download.';

test('provider.invoke keeps the user I2C connector when ChatGPT rewrites the tool prompt', async () => {
  const projectDir = await mkdtemp(path.join(tmpdir(), 'chatpcb-chatgpt-rewrite-'));
  const services = await transactionServices({ validateProjectImpl: passingErc });
  const previousLibs = setKicadLibraryEnv({ symbols: FIXTURE_LIBS.symbols, footprints: FIXTURE_LIBS.footprints });
  const restoreFetch = stubChatGptFetch(JSON.stringify({
    type: 'tool.call',
    payload: {
      id: 'call_rewrite',
      name: 'schematic.generate',
      args: { prompt: STM32_REWRITTEN_PROMPT }
    }
  }));
  try {
    await withChatGptHome(async () => {
      const result = await dispatchToolCall({
        id: 'call_chatgpt_rewrite',
        name: 'provider.invoke',
        args: {
          provider: 'chatgpt',
          projectDir,
          prompt: STM32_USER_PROMPT
        }
      }, services);
      assert.equal(result.ok, true, result.error?.message);
      const toolEvent = result.result.events.find((event) => event.type === 'tool.call');
      assert.equal(/\bi2c\b/i.test(toolEvent.payload.args.prompt), false);
      assert.match(toolEvent.payload.args.prompt, /\bswd\b/i);
      const preview = result.result.toolResults[0].result;
      assert.equal(preview.requiresApproval, true);
      const components = preview.components ?? [];
      assert.equal(
        components.some((component) => component.value === 'I2C_CONNECTOR' || component.libId === 'ChatPCB:I2C_CONNECTOR'),
        true
      );
      const blockers = preview.review?.findings?.blockers ?? [];
      assert.equal(blockers.some((finding) => finding.code === 'missing-swd'), false);
    });
  } finally {
    restoreKicadLibraryEnv(previousLibs);
    restoreFetch();
    services.patchApprovalRegistry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

test('apply succeeds after preview writes lastSource to the conversation file', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-apply-source-'));
  const services = await transactionServices({
    validateProjectImpl: passingErc,
    verifyAppliedProjectImpl: async () => ({
      erc: { ok: true, skipped: false, executed: true, erc: { errorCount: 0, warningCount: 0 } },
      drc: { ok: true, skipped: false, executed: true, violations: [], unconnectedItems: [] }
    })
  });
  const previousLibs = setKicadLibraryEnv({ symbols: FIXTURE_LIBS.symbols, footprints: FIXTURE_LIBS.footprints });
  const restoreFetch = stubChatGptFetch(JSON.stringify({
    type: 'tool.call',
    payload: {
      id: 'call_apply_source',
      name: 'schematic.generate',
      args: { prompt: 'draft it' }
    }
  }));
  try {
    await withChatGptHome(async () => {
      const created = await dispatchToolCall({
        name: 'project.create',
        args: { workspaceRoot, projectName: 'Apply Source' }
      });
      const projectDir = created.result.projectDir;
      assert.equal(transactionArtifactKind(CONVERSATION_FILE), 'conversation');
      const preview = await dispatchToolCall({
        id: 'call_apply_after_source',
        name: 'project.request',
        args: {
          provider: 'chatgpt',
          projectDir,
          prompt: PROFILE_PROMPT
        }
      }, services);
      assert.equal(preview.ok, true, preview.error?.message);
      assert.equal(preview.result.requiresApproval, true);
      const conversationPath = path.join(projectDir, CONVERSATION_FILE);
      const saved = JSON.parse(await readFile(conversationPath, 'utf8'));
      assert.deepEqual(saved.lastSource, { provider: 'chatgpt', via: 'provider' });

      const approved = await dispatchToolCall({
        name: 'schematic.patch',
        args: {
          projectDir,
          approved: true,
          patchId: preview.result.patchId
        }
      }, services);
      assert.equal(approved.ok, true, approved.error?.message);
      assert.equal(
        approved.result.applied,
        true,
        JSON.stringify(approved.result.reason ?? approved.result)
      );
      assert.equal(approved.result.reason, undefined);
      const names = await readdir(projectDir);
      assert.equal(names.some((name) => name.endsWith('.kicad_sch')), true);
      assert.equal(names.includes(CONVERSATION_FILE), true);
      const after = JSON.parse(await readFile(conversationPath, 'utf8'));
      assert.deepEqual(after.lastSource, { provider: 'chatgpt', via: 'provider' });
    });
  } finally {
    restoreKicadLibraryEnv(previousLibs);
    restoreFetch();
    services.patchApprovalRegistry.disposeAll();
    await rm(workspaceRoot, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});
