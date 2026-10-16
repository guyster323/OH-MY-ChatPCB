import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { dispatchToolCall } from '../src/runtime/agent-daemon.js';
import { saveCredentials } from '../src/runtime/auth/chatgpt-auth.js';
import { callChatGPTResponses } from '../src/runtime/providers/chatgpt-provider.js';
import { createPatchApprovalRegistry } from '../src/runtime/patch-approval-registry.js';
import { createProjectMutexRegistry } from '../src/runtime/project-mutex-registry.js';
import { createTransactionJournal } from '../src/runtime/transaction-journal.js';
import { generateMcuPeripheralProject } from '../src/workflow/generate-mcu-project.js';
import { applySchematicPatch, createSchematicPatchPlan, disposeSchematicPatchPlan } from '../src/workflow/schematic-patch.js';
import { FIXTURE_LIBS, restoreKicadLibraryEnv, setKicadLibraryEnv } from './helpers/kicad-library-env.js';
import { isolateHome } from './isolate-home.js';

const passingVerify = async () => ({
  erc: { ok: true, skipped: false, executed: true, erc: { errorCount: 0, warningCount: 0 } },
  drc: { ok: true, skipped: true }
});
const passingDrc = async () => ({ ok: true, skipped: false, executed: true, violations: [], unconnectedItems: [] });
const passingErc = async () => ({ ok: true, skipped: false, erc: { errorCount: 0, warningCount: 0, byType: {} } });

const STM32_USER_PROMPT = 'Prototype STM32 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, reset button, and status LED.';
const MODIFY = 'Change the status LED series resistor to 680 ohm. Keep everything else unchanged.';

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

function functionCallSse({ name, callId, argumentsText }) {
  const item = {
    type: 'function_call',
    id: `fc_${callId}`,
    call_id: callId,
    name,
    arguments: argumentsText
  };
  const event = { type: 'response.completed', response: { output: [item] } };
  return new Response(`data: ${JSON.stringify(event)}\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' }
  });
}

function modelsResponse() {
  return new Response(JSON.stringify({ models: [{ slug: 'gpt-x', visibility: 'list' }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
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

function installFetch(handler) {
  const original = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (target.includes('/v1/models')) return modelsResponse();
    if (target.includes('/v1/responses')) {
      const body = init?.body ? String(init.body) : '';
      bodies.push(body);
      return handler(body, bodies.length);
    }
    return new Response('no', { status: 404 });
  };
  return {
    bodies,
    restore() {
      globalThis.fetch = original;
    }
  };
}

function hasI2c(components) {
  return (components ?? []).some((component) => /I2C_CONNECTOR/.test(`${component.libId ?? ''} ${component.value ?? ''}`));
}

function hasOhm680(components) {
  return (components ?? []).some((component) => /680/.test(`${component.ref ?? ''} ${component.value ?? ''} ${component.libId ?? ''}`));
}

function removalBlocker(review) {
  const blockers = review?.findings?.blockers ?? [];
  return blockers.find((finding) => (
    finding.code === 'existing-components-removed' || finding.id === 'existing-components-removed'
  )) ?? null;
}

async function generatedStm32Project() {
  const projectDir = await mkdtemp(path.join(tmpdir(), 'chatpcb-modify-'));
  const generated = await generateMcuPeripheralProject({
    projectDir,
    prompt: STM32_USER_PROMPT,
    projectName: 'stm32_i2c'
  });
  return { projectDir, generated };
}

test('modify on an applied project keeps I2C when ChatGPT only inspects', async () => {
  const services = await transactionServices();
  const previousLibs = setKicadLibraryEnv({ symbols: FIXTURE_LIBS.symbols, footprints: FIXTURE_LIBS.footprints });
  const fetchStub = installFetch(() => functionCallSse({
    name: 'project_inspect',
    callId: 'call_inspect_01',
    argumentsText: '{}'
  }));
  const { projectDir, generated } = await generatedStm32Project();
  try {
    await withChatGptHome(async () => {
      const liveBefore = await readFile(generated.files.schematic, 'utf8');
      assert.match(liveBefore, /I2C_CONNECTOR/);
      const result = await dispatchToolCall({
        id: 'call_mod_inspect',
        name: 'project.request',
        args: { provider: 'chatgpt', projectDir, prompt: MODIFY }
      }, services);
      const liveAfter = await readFile(generated.files.schematic, 'utf8');
      assert.match(liveAfter, /I2C_CONNECTOR/);
      const nudged = fetchStub.bodies.some((body) => /Call schematic\.patch now/.test(body));
      assert.equal(nudged, true);
      if (result.ok && hasI2c(result.result?.components)) {
        assert.equal(hasOhm680(result.result.components), true);
        assert.equal(result.result.requiresApproval, true);
        const approved = await dispatchToolCall({
          name: 'schematic.patch',
          args: { projectDir, approved: true, patchId: result.result.patchId }
        }, services);
        assert.equal(approved.ok, true, approved.error?.message ?? JSON.stringify(approved.result?.reason));
        assert.equal(approved.result.applied, true, JSON.stringify(approved.result?.reason));
        const spec = JSON.parse(await readFile(generated.files.spec, 'utf8'));
        const schematic = await readFile(generated.files.schematic, 'utf8');
        assert.equal(spec.sourcePrompt, STM32_USER_PROMPT);
        assert.match(schematic, /I2C_CONNECTOR/);
        assert.match(schematic, /680/);
        return;
      }
      assert.equal(result.ok, false);
      assert.match(liveAfter, /I2C_CONNECTOR/);
      assert.doesNotMatch(liveAfter, /680/);
      const message = `${result.error?.message ?? ''}`;
      assert.match(message, /could not be applied|수정 사항을 적용할 수 없습니다/);
    });
  } finally {
    fetchStub.restore();
    restoreKicadLibraryEnv(previousLibs);
    services.patchApprovalRegistry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

test('inspect then schematic.patch keeps I2C, applies 680 ohm, and leaves sourcePrompt', async () => {
  const services = await transactionServices();
  const previousLibs = setKicadLibraryEnv({ symbols: FIXTURE_LIBS.symbols, footprints: FIXTURE_LIBS.footprints });
  const fetchStub = installFetch((_body, count) => {
    if (count === 1) {
      return functionCallSse({ name: 'project_inspect', callId: 'call_inspect_01', argumentsText: '{}' });
    }
    return functionCallSse({
      name: 'schematic_patch',
      callId: 'call_patch_01',
      argumentsText: JSON.stringify({ prompt: MODIFY })
    });
  });
  const { projectDir, generated } = await generatedStm32Project();
  try {
    await withChatGptHome(async () => {
      const result = await dispatchToolCall({
        id: 'call_mod_patch',
        name: 'project.request',
        args: { provider: 'chatgpt', projectDir, prompt: MODIFY }
      }, services);
      assert.equal(result.ok, true, result.error?.message);
      assert.equal(hasI2c(result.result.components), true, JSON.stringify(result.result.components));
      assert.equal(hasOhm680(result.result.components), true, JSON.stringify(result.result.components));
      assert.equal(result.result.source?.via, 'provider');
      const first = JSON.parse(fetchStub.bodies[0]);
      const promptText = first.input.map((item) => item.content ?? '').join('\n');
      assert.match(promptText, /I2C_CONNECTOR/);
      assert.equal(promptText.includes('returns results'), false);
      assert.equal(first.tools.some((tool) => tool.name === 'schematic_generate'), false);
      assert.equal(first.tools.some((tool) => tool.name === 'project_create'), false);
      assert.equal(first.tools.some((tool) => tool.name === 'schematic_patch'), true);
      assert.equal(first.tool_choice?.type, 'function');
      assert.equal(first.tool_choice?.name, 'schematic_patch');
      assert.ok(fetchStub.bodies.length >= 2);
      const second = JSON.parse(fetchStub.bodies[1]);
      assert.equal(second.input.some((item) => item.type === 'function_call_output'), true);
      const approved = await dispatchToolCall({
        name: 'schematic.patch',
        args: { projectDir, approved: true, patchId: result.result.patchId }
      }, services);
      assert.equal(approved.ok, true, approved.error?.message ?? JSON.stringify(approved.result?.reason));
      assert.equal(approved.result.applied, true, JSON.stringify(approved.result?.reason));
      const spec = JSON.parse(await readFile(generated.files.spec, 'utf8'));
      const schematic = await readFile(generated.files.schematic, 'utf8');
      assert.equal(spec.sourcePrompt, STM32_USER_PROMPT);
      assert.match(schematic, /I2C_CONNECTOR/);
      assert.match(schematic, /680/);
    });
  } finally {
    fetchStub.restore();
    restoreKicadLibraryEnv(previousLibs);
    services.patchApprovalRegistry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

test('ChatGPT tool loop sends function_call_output and stops after 4 read-only turns', async () => {
  const fetchStub = installFetch(() => functionCallSse({
    name: 'project_inspect',
    callId: `call_inspect_${fetchStub.bodies.length + 1}`,
    argumentsText: '{}'
  }));
  try {
    await withChatGptHome(async () => {
      const result = await callChatGPTResponses({
        prompt: MODIFY,
        maxTurns: 4,
        executeTool: async (call) => ({ ok: true, tool: call.name, echoed: true })
      });
      assert.equal(fetchStub.bodies.length, 4);
      for (const [index, body] of fetchStub.bodies.entries()) {
        const request = JSON.parse(body);
        const hasOutput = request.input.some((item) => item.type === 'function_call_output');
        assert.equal(hasOutput, index > 0, `turn ${index + 1}`);
      }
      assert.match(result.text, /project\.inspect/);
      assert.equal(result.text.includes('schematic.patch'), false);
    });
  } finally {
    fetchStub.restore();
  }
});

test('removing an existing component blocks Apply unless the request deletes it', async () => {
  const { projectDir, generated } = await generatedStm32Project();
  const before = await readFile(generated.files.schematic, 'utf8');
  const plan = await createSchematicPatchPlan({
    projectDir,
    prompt: 'STM32 board with USB-C power, UART header, reset button, and status LED.',
    projectName: 'stm32_i2c',
    validateProjectImpl: passingErc,
    validateBoardImpl: passingDrc
  });
  try {
    const blocked = await applySchematicPatch({
      projectDir,
      prompt: 'STM32 board with USB-C power, UART header, reset button, and status LED.',
      approved: true,
      expectedPatchId: plan.patchId,
      patchPlan: plan,
      validateProjectImpl: passingErc,
      validateBoardImpl: passingDrc,
      verifyAppliedProjectImpl: passingVerify
    });
    assert.equal(blocked.applied, false);
    const blocker = removalBlocker(blocked.review) ?? removalBlocker(plan.review);
    assert.ok(blocker, JSON.stringify(blocked.reason ?? blocked.review ?? null));
    const text = `${blocker.en ?? ''}\n${blocker.ko ?? ''}\n${blocker.message ?? ''}`;
    assert.match(text, /I2C_CONNECTOR|J2/);
    assert.match(text, /removed|delete/i);
    assert.match(text, /기존|삭제/);
    assert.equal(await readFile(generated.files.schematic, 'utf8'), before);
  } finally {
    await disposeSchematicPatchPlan(plan);
    await rm(projectDir, { force: true, recursive: true });
  }
});

test('explicit I2C connector deletion removes that part and keeps the rest', async () => {
  const { projectDir, generated } = await generatedStm32Project();
  const prompt = 'I2C 커넥터 삭제';
  const plan = await createSchematicPatchPlan({
    projectDir,
    prompt,
    projectName: 'stm32_i2c',
    validateProjectImpl: passingErc,
    validateBoardImpl: passingDrc
  });
  try {
    const result = await applySchematicPatch({
      projectDir,
      prompt,
      approved: true,
      expectedPatchId: plan.patchId,
      patchPlan: plan,
      validateProjectImpl: passingErc,
      validateBoardImpl: passingDrc,
      verifyAppliedProjectImpl: passingVerify
    });
    assert.notEqual(result.reason?.code, 'EXISTING_COMPONENTS_REMOVED');
    assert.equal(removalBlocker(result.review), null);
    assert.equal(result.applied, true, JSON.stringify(result.reason ?? result.review));
    const schematic = await readFile(generated.files.schematic, 'utf8');
    const spec = JSON.parse(await readFile(generated.files.spec, 'utf8'));
    assert.equal(schematic.includes('I2C_CONNECTOR'), false);
    assert.match(schematic, /UART_HEADER/);
    assert.equal(spec.sourcePrompt, STM32_USER_PROMPT);
  } finally {
    await disposeSchematicPatchPlan(plan);
    await rm(projectDir, { force: true, recursive: true });
  }
});
