import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { dispatchToolCall, withProjectContext } from '../src/runtime/agent-daemon.js';
import { saveCredentials } from '../src/runtime/auth/chatgpt-auth.js';
import { createEnvelope } from '../src/runtime/envelope.js';
import { callChatGPTResponses } from '../src/runtime/providers/chatgpt-provider.js';
import { createPatchApprovalRegistry } from '../src/runtime/patch-approval-registry.js';
import { createProjectMutexRegistry } from '../src/runtime/project-mutex-registry.js';
import { createTransactionJournal } from '../src/runtime/transaction-journal.js';
import { generateMcuPeripheralProject } from '../src/workflow/generate-mcu-project.js';
import {
  mixedRemovalAndEditMessage,
  modifyRefusalMessage,
  removalIntentUnclearMessage,
  removalNeedsVerbMessage,
  resistorRefAmbiguousMessage,
  resistorRefNotFoundMessage,
  resistorRefUnsupportedMessage,
  resistorTargetUnclearMessage,
  resistorValueInvalidMessage,
  resistorValueUnchangedMessage
} from '../src/workflow/existing-project-edit.js';
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertListsRemoved(removed) {
  assert.ok(Array.isArray(removed) && removed.length > 0, JSON.stringify(removed));
  for (const item of removed) {
    assert.equal(typeof item.ref, 'string');
    assert.ok(item.ref.length > 0);
    assert.equal(typeof item.libId, 'string');
    assert.ok(Object.prototype.hasOwnProperty.call(item, 'value'));
  }
  const i2c = removed.find((item) => item.ref === 'J2');
  assert.ok(i2c, JSON.stringify(removed));
  assert.equal(i2c.libId, 'ChatPCB:I2C_CONNECTOR');
  assert.equal(i2c.value, 'I2C_CONNECTOR');
}

function assertBlockedRemoval(result, { mismatch = false } = {}) {
  assert.equal(result.applied, false);
  assert.equal(result.requiresApproval, false);
  assert.equal(result.reason?.code, 'EXISTING_COMPONENTS_REMOVED');
  assertListsRemoved(result.removedComponents);
  assert.deepEqual(result.reason?.removedComponents, result.removedComponents);
  const blocker = removalBlocker(result.review);
  assert.ok(blocker, JSON.stringify(result.review?.findings?.blockers ?? null));
  assert.deepEqual(blocker.removedComponents, result.removedComponents);
  for (const item of blocker.removedComponents) {
    assert.match(blocker.en, new RegExp(escapeRegExp(item.ref)));
    assert.match(blocker.en, new RegExp(escapeRegExp(item.libId)));
    assert.match(blocker.ko, new RegExp(escapeRegExp(item.ref)));
    assert.match(blocker.ko, new RegExp(escapeRegExp(item.libId)));
    if (item.value) {
      assert.match(blocker.en, new RegExp(escapeRegExp(item.value)));
      assert.match(blocker.ko, new RegExp(escapeRegExp(item.value)));
    }
  }
  assert.match(blocker.en, /removed/i);
  assert.match(blocker.ko, /기존/);
  if (mismatch) {
    assert.equal(result.reason.mismatch?.code, 'ALLOW_REMOVED_COMPONENTS_MISMATCH');
    assert.ok(Array.isArray(result.reason.mismatch.missing));
    assert.ok(Array.isArray(result.reason.mismatch.extra));
  } else {
    assert.equal(result.reason.mismatch, undefined);
  }
}

async function withRemovalCandidate(prompt, fn) {
  const { projectDir, generated } = await generatedStm32Project();
  const before = await readFile(generated.files.schematic, 'utf8');
  const plan = await createSchematicPatchPlan({
    projectDir,
    prompt,
    projectName: 'stm32_i2c',
    validateProjectImpl: passingErc,
    validateBoardImpl: passingDrc
  });
  try {
    await fn({ projectDir, generated, plan, before, prompt });
  } finally {
    await disposeSchematicPatchPlan(plan);
    await rm(projectDir, { force: true, recursive: true });
  }
}

function applyApproved(projectDir, prompt, plan, extra = {}) {
  return applySchematicPatch({
    projectDir,
    prompt,
    approved: true,
    expectedPatchId: plan.patchId,
    patchPlan: plan,
    validateProjectImpl: passingErc,
    validateBoardImpl: passingDrc,
    verifyAppliedProjectImpl: passingVerify,
    ...extra
  });
}

async function assertApplyStaysBlocked(prompt) {
  await withRemovalCandidate(prompt, async ({ projectDir, generated, plan, before }) => {
    const preview = await applySchematicPatch({
      projectDir,
      prompt,
      approved: false,
      patchPlan: plan
    });
    assertBlockedRemoval(preview);
    const blocked = await applyApproved(projectDir, prompt, plan);
    assertBlockedRemoval(blocked);
    assert.equal(await readFile(generated.files.schematic, 'utf8'), before);
    assert.match(before, /I2C_CONNECTOR/);
  });
}

// keep-refused: nothing to edit, so the request must refuse with PROVIDER_NO_PATCH. A plan is a failure.
// refuse-clarify: the removal is ambiguous, so the request must ask which part to remove.
// edit-applied: the value edit must be in the plan (680Ω and I2C). Refusal is a failure.
// removal-candidate: I2C removal must be proposed and Apply must stay blocked. Refusal is a failure.
async function assertNegationOutcome(prompt, outcome) {
  const { projectDir, generated } = await generatedStm32Project();
  const before = await readFile(generated.files.schematic, 'utf8');
  const beforeSpec = JSON.parse(await readFile(generated.files.spec, 'utf8'));
  assert.match(before, /I2C_CONNECTOR/);
  let plan;
  try {
    if (outcome === 'keep-refused' || outcome === 'refuse-clarify') {
      await assert.rejects(
        () => createSchematicPatchPlan({
          projectDir,
          prompt,
          projectName: 'stm32_i2c',
          validateProjectImpl: passingErc,
          validateBoardImpl: passingDrc
        }),
        (error) => {
          if (outcome === 'refuse-clarify') {
            assert.equal(error.code, 'REMOVAL_INTENT_UNCLEAR', `${prompt}: ${error.message}`);
            assert.equal(error.message, [
              'Which part should I remove? Give its reference, like J2. Nothing was removed.',
              '어떤 부품을 뺄까요? 참조번호(예: J2)로 알려 주세요. 아무것도 빼지 않았어요.'
            ].join('\n'), prompt);
          } else {
            assert.equal(error.code, 'PROVIDER_NO_PATCH', `${prompt}: ${error.message}`);
          }
          return true;
        }
      );
      return;
    }

    plan = await createSchematicPatchPlan({
      projectDir,
      prompt,
      projectName: 'stm32_i2c',
      validateProjectImpl: passingErc,
      validateBoardImpl: passingDrc
    });

    if (outcome === 'edit-applied') {
      assert.equal(hasI2c(plan.components), true, JSON.stringify(plan.components));
      assert.equal(hasOhm680(plan.components), true, JSON.stringify(plan.components));
      assert.equal(removalBlocker(plan.review), null, JSON.stringify(plan.review?.findings?.blockers ?? null));
      const afterRefs = new Set((plan.proposed?.spec?.schematic?.components ?? []).map((component) => component?.ref));
      for (const component of beforeSpec.schematic?.components ?? []) {
        assert.ok(afterRefs.has(component.ref), `${prompt} removed ${component.ref}`);
      }
      return;
    }

    if (outcome === 'removal-candidate') {
      assert.equal(plan.components.some((component) => component.ref === 'J2'), false, JSON.stringify(plan.components));
      assert.equal(plan.components.some((component) => component.ref === 'D1'), true, JSON.stringify(plan.components));
      const preview = await applySchematicPatch({
        projectDir,
        prompt,
        approved: false,
        patchPlan: plan
      });
      assertBlockedRemoval(preview);
      assert.deepEqual(preview.removedComponents.map((item) => item.ref), ['J2']);
      const blocked = await applyApproved(projectDir, prompt, plan);
      assertBlockedRemoval(blocked);
      assert.deepEqual(blocked.removedComponents.map((item) => item.ref), ['J2']);
      return;
    }

    assert.fail(`Unknown negation outcome ${outcome}`);
  } finally {
    if (plan) await disposeSchematicPatchPlan(plan);
    assert.equal(await readFile(generated.files.schematic, 'utf8'), before);
    await rm(projectDir, { force: true, recursive: true });
  }
}

function codexPatchRewrite(modelPrompt) {
  return {
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
          id: 'call_rewritten_patch',
          name: 'schematic.patch',
          args: { prompt: modelPrompt }
        })
      ]
    })
  };
}

async function withBoardResistor(ohms, fn) {
  const { projectDir, generated } = await generatedStm32Project();
  const prompt = `Change the status LED series resistor to ${ohms} ohm.`;
  const plan = await createSchematicPatchPlan({
    projectDir,
    prompt,
    projectName: 'stm32_i2c',
    validateProjectImpl: passingErc,
    validateBoardImpl: passingDrc
  });
  try {
    const applied = await applySchematicPatch({
      projectDir,
      prompt,
      approved: true,
      expectedPatchId: plan.patchId,
      patchPlan: plan,
      validateProjectImpl: passingErc,
      validateBoardImpl: passingDrc,
      verifyAppliedProjectImpl: passingVerify
    });
    assert.equal(applied.applied, true, JSON.stringify(applied.reason));
    const schematic = await readFile(generated.files.schematic, 'utf8');
    assert.match(schematic, new RegExp(String(ohms)));
    assert.match(schematic, /I2C_CONNECTOR/);
    await fn({ projectDir, generated });
  } finally {
    await disposeSchematicPatchPlan(plan);
    await rm(projectDir, { force: true, recursive: true });
  }
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
      assert.equal(liveAfter, liveBefore);
      // The sentence is covered, so it applies locally and never nudges ChatGPT.
      assert.equal(fetchStub.bodies.length, 0);
      assert.equal(result.ok, true, result.error?.message);
      assert.equal(result.result.source?.via, 'native-fallback');
      assert.equal(hasI2c(result.result?.components), true, JSON.stringify(result.result.components));
      assert.equal(hasOhm680(result.result.components), true, JSON.stringify(result.result.components));
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
      assert.equal(result.result.source?.via, 'native-fallback');
      assert.equal(fetchStub.bodies.length, 0);
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

test('removing an existing component blocks Apply unless the client sends the exact allowRemovedComponents override', async () => {
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

test('explicit delete text does not authorize Apply when I2C is removed', async () => {
  await assertApplyStaysBlocked('I2C 커넥터 삭제');
});

test('positive delete remove the I2C connector stays blocked without allowRemovedComponents', async () => {
  await assertApplyStaysBlocked('remove the I2C connector');
});

for (const prompt of [
  'I2C 삭제하지 마',
  'I2C 커넥터는 삭제하지 마세요',
  'I2C 지우지 마'
]) {
  test(`negated Korean removal keeps I2C (${prompt})`, async () => {
    await assertNegationOutcome(prompt, 'refuse-clarify');
  });
}

for (const prompt of [
  "don't remove I2C",
  'do not delete the I2C connector',
  "keep I2C, don't remove it"
]) {
  test(`negated English removal keeps I2C (${prompt})`, async () => {
    await assertNegationOutcome(prompt, 'refuse-clarify');
  });
}

for (const prompt of ['I2C 지워줘', 'I2C 커넥터 지워', 'drop the I2C connector', 'I2C 빼줘']) {
  test(`positive delete ${prompt} stays blocked without allowRemovedComponents`, async () => {
    await assertApplyStaysBlocked(prompt);
  });
}

for (const prompt of [
  "remove the LED but don't remove I2C",
  "don't remove I2C, remove LED",
  'I2C 남기고 LED 저항 삭제'
]) {
  test(`mixed removal keeps I2C (${prompt})`, async () => {
    await assertNegationOutcome(prompt, 'refuse-clarify');
  });
}

test('a resistor edit that says not to remove I2C keeps I2C and changes the resistor', async () => {
  await assertNegationOutcome(
    "Change the status LED series resistor to 680 ohm. don't remove I2C.",
    'edit-applied'
  );
});

test("don't remove the LED, remove I2C refuses instead of removing I2C", async () => {
  // Two removal targets and a negation used to propose an I2C removal. Fail closed asks instead.
  await assertNegationOutcome("don't remove the LED, remove I2C", 'refuse-clarify');
});

test('reset 버튼 삭제 in a separate sentence does not remove I2C', async () => {
  await assertNegationOutcome('reset 버튼 삭제. I2C 커넥터는 유지하세요.', 'keep-refused');
});

test('casual Like an ESP32 board mention blocks Apply without an override', async () => {
  await assertApplyStaysBlocked('Like an ESP32 board, change the status LED resistor to 680 ohm on this STM32 board.');
});

test('withProjectContext strips locale from a model-issued tool call', () => {
  const toolCall = withProjectContext({
    id: 'call_model_locale',
    name: 'schematic.patch',
    args: {
      prompt: 'remove the I2C connector',
      locale: 'ko-KR',
      approved: true
    }
  }, '/tmp/chatpcb-existing-project', true, {
    prompt: 'Change the status LED series resistor to 680 ohm. Keep everything else unchanged.'
  });

  assert.equal(Object.hasOwn(toolCall.args, 'locale'), false);
  assert.equal(JSON.stringify(toolCall.args).includes('locale'), false);
  assert.equal(JSON.stringify(toolCall.args).includes('ko-KR'), false);
  assert.equal(toolCall.args.userPrompt, 'Change the status LED series resistor to 680 ohm. Keep everything else unchanged.');
});

test('withProjectContext strips allowRemovedComponents from a provider schematic.patch', () => {
  const toolCall = withProjectContext({
    id: 'call_model_patch_override',
    name: 'schematic.patch',
    args: {
      prompt: 'remove the I2C connector',
      approved: true,
      patchId: 'patch-from-model',
      allowRemovedComponents: ['J2', 'R4', 'R5']
    }
  }, '/tmp/chatpcb-existing-project', true, {
    prompt: 'Change the status LED series resistor to 680 ohm. Keep everything else unchanged.'
  });

  assert.equal(toolCall.name, 'schematic.patch');
  assert.equal(Object.hasOwn(toolCall.args, 'allowRemovedComponents'), false);
  assert.equal(JSON.stringify(toolCall.args).includes('allowRemovedComponents'), false);
  assert.equal(JSON.stringify(toolCall.args).includes('J2'), false);
  assert.equal(toolCall.args.prompt, 'remove the I2C connector');
  assert.equal(toolCall.args.userPrompt, 'Change the status LED series resistor to 680 ohm. Keep everything else unchanged.');
});

test('withProjectContext strips a model userPrompt from a provider schematic.patch', () => {
  // forceProjectDir is false and there is no caller prompt, so nothing below
  // the delete assigns userPrompt. The model value must not survive.
  const toolCall = withProjectContext({
    id: 'call_model_patch_user_prompt',
    name: 'schematic.patch',
    args: {
      prompt: 'remove the I2C connector',
      approved: true,
      patchId: 'patch-from-model',
      userPrompt: 'remove I2C'
    }
  }, '/tmp/chatpcb-existing-project', false);

  assert.equal(toolCall.name, 'schematic.patch');
  assert.equal(Object.hasOwn(toolCall.args, 'userPrompt'), false);
  assert.equal(toolCall.args.userPrompt, undefined);
  assert.equal(JSON.stringify(toolCall.args).includes('userPrompt'), false);
  assert.equal(JSON.stringify(toolCall.args).includes('remove I2C'), false);
  assert.equal(toolCall.args.prompt, 'remove the I2C connector');
});

test('withProjectContext ignores a model-supplied userPrompt', () => {
  const client = 'Change the status LED series resistor to 680 ohm. Keep everything else unchanged.';
  const injected = withProjectContext({
    id: 'call_model_user_prompt',
    name: 'schematic.patch',
    args: {
      prompt: 'remove the I2C connector',
      userPrompt: 'remove I2C'
    }
  }, '/tmp/chatpcb-existing-project', true, { prompt: client });
  assert.equal(injected.args.userPrompt, client);
  assert.equal(injected.args.userPrompt.includes('remove I2C'), false);

  // The client prompt is not injected on a direct patch, so the delete is what
  // drops the model value. Assigning userPrompt later would not run here.
  const direct = withProjectContext({
    id: 'call_model_user_prompt_direct',
    name: 'schematic.patch',
    args: {
      prompt: 'remove I2C',
      userPrompt: 'delete the I2C connector'
    }
  }, '/tmp/chatpcb-existing-project', false, { prompt: client });
  assert.equal(Object.hasOwn(direct.args, 'userPrompt'), false);
  assert.equal(direct.args.prompt, client);

  const absent = withProjectContext({
    id: 'call_model_user_prompt_absent',
    name: 'schematic.patch',
    args: {
      prompt: 'remove I2C',
      userPrompt: 'delete the I2C connector'
    }
  }, '/tmp/chatpcb-existing-project', true, {});
  assert.equal(Object.hasOwn(absent.args, 'userPrompt'), false);
  assert.equal(absent.args.prompt, 'remove I2C');
});

test('provider-emitted allowRemovedComponents cannot authorize an I2C removal', async () => {
  const services = await transactionServices();
  const { projectDir, generated } = await generatedStm32Project();
  const before = await readFile(generated.files.schematic, 'utf8');
  try {
    const preview = await dispatchToolCall({
      id: 'call_model_override_i2c',
      name: 'project.request',
      args: {
        provider: 'codex',
        projectDir,
        prompt: 'Keep the STM32 board unchanged.'
      }
    }, {
      ...services,
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
            id: 'call_model_patch_override',
            name: 'schematic.patch',
            args: {
              prompt: 'remove the I2C connector',
              approved: true,
              allowRemovedComponents: ['J2']
            }
          })
        ]
      })
    });
    assert.equal(preview.ok, false);
    assert.equal(preview.error?.code, 'PROVIDER_NO_PATCH');
    assert.match(await readFile(generated.files.schematic, 'utf8'), /I2C_CONNECTOR/);
    assert.equal(await readFile(generated.files.schematic, 'utf8'), before);
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

test('model-written schematic.patch prompt cannot remove I2C when the user kept it', async () => {
  const services = await transactionServices();
  const { projectDir, generated } = await generatedStm32Project();
  const before = await readFile(generated.files.schematic, 'utf8');
  try {
    const preview = await dispatchToolCall({
      id: 'call_model_remove_i2c',
      name: 'project.request',
      args: {
        provider: 'codex',
        projectDir,
        prompt: 'Change the status LED series resistor to 680 ohm. Keep everything else unchanged.'
      }
    }, {
      ...services,
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
            id: 'call_model_patch',
            name: 'schematic.patch',
            args: { prompt: 'remove I2C' }
          })
        ]
      })
    });
    assert.equal(preview.ok, true, preview.error?.message);
    assert.equal(hasI2c(preview.result.components), true, JSON.stringify(preview.result.components));
    assert.equal(hasOhm680(preview.result.components), true, JSON.stringify(preview.result.components));
    assert.equal(removalBlocker(preview.result.review), null);
    const approved = await dispatchToolCall({
      name: 'schematic.patch',
      args: { projectDir, approved: true, patchId: preview.result.patchId }
    }, services);
    assert.equal(approved.ok, true, approved.error?.message ?? JSON.stringify(approved.result?.reason));
    assert.equal(approved.result.applied, true, JSON.stringify(approved.result?.reason));
    const schematic = await readFile(generated.files.schematic, 'utf8');
    assert.match(schematic, /I2C_CONNECTOR/);
    assert.match(schematic, /680/);
    assert.notEqual(schematic, before);
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

test('a pronoun with no resistor target asks which resistor and does not apply the provider rewrite', async () => {
  const services = await transactionServices();
  try {
    await withBoardResistor(330, async ({ projectDir, generated }) => {
      const before = await readFile(generated.files.schematic, 'utf8');
      let calls = 0;
      const preview = await dispatchToolCall({
        id: 'call_en_680',
        name: 'project.request',
        args: {
          provider: 'codex',
          projectDir,
          prompt: "Change it to 680 ohm. Don't delete the I2C."
        }
      }, {
        ...services,
        checkProviderAvailabilityImpl: async ({ provider }) => ({
          provider,
          command: 'codex',
          available: true,
          status: 'available'
        }),
        runProviderProcessImpl: async () => {
          calls += 1;
          throw new Error('provider must not be called');
        }
      });
      assert.equal(calls, 0);
      assert.equal(preview.ok, false, preview.error?.message);
      assert.equal(preview.error?.code, 'RESISTOR_TARGET_UNCLEAR');
      assert.match(preview.error?.message ?? '', /Nothing was changed|아무것도 바꾸지 않았어요/);
      assert.equal(await readFile(generated.files.schematic, 'utf8'), before);
    });
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

test('Korean keep-I2C edit applies 680 ohm when the model rewrites the negation', async () => {
  const services = await transactionServices();
  try {
    await withBoardResistor(330, async ({ projectDir, generated }) => {
      const before = await readFile(generated.files.schematic, 'utf8');
      const preview = await dispatchToolCall({
        id: 'call_ko_680',
        name: 'project.request',
        args: {
          provider: 'codex',
          projectDir,
          prompt: '680옴으로 바꿔줘. I2C는 삭제하지 마'
        }
      }, {
        ...services,
        ...codexPatchRewrite('기존 프로젝트에서 상태 LED D1의 전류 제한 저항 R3 값만 330Ω에서 680Ω으로 변경하는 편집을 미리보기로 준비하세요. I2C는 절대 삭제하거나 변경하지 마세요.')
      });
      assert.equal(preview.ok, true, preview.error?.message);
      assert.equal(hasI2c(preview.result.components), true, JSON.stringify(preview.result.components));
      assert.equal(hasOhm680(preview.result.components), true, JSON.stringify(preview.result.components));
      assert.equal(removalBlocker(preview.result.review), null);
      const approved = await dispatchToolCall({
        name: 'schematic.patch',
        args: { projectDir, approved: true, patchId: preview.result.patchId }
      }, services);
      assert.equal(approved.result.applied, true, JSON.stringify(approved.result?.reason));
      const schematic = await readFile(generated.files.schematic, 'utf8');
      assert.match(schematic, /I2C_CONNECTOR/);
      assert.match(schematic, /680/);
      assert.notEqual(schematic, before);
    });
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

for (const prompt of ['Delete the I2C connector', 'Remove the I2C connector', 'I2C 커넥터 삭제']) {
  test(`rewritten tool text still proposes removal for ${prompt}`, async () => {
    const services = await transactionServices();
    const { projectDir, generated } = await generatedStm32Project();
    const before = await readFile(generated.files.schematic, 'utf8');
    try {
      const preview = await dispatchToolCall({
        id: 'call_delete_rewrite',
        name: 'project.request',
        args: { provider: 'codex', projectDir, prompt }
      }, {
        ...services,
        ...codexPatchRewrite('Delete J2 from the existing project.')
      });
      assert.equal(preview.ok, true, preview.error?.message);
      assert.equal(hasI2c(preview.result.components), false, prompt);
      assertBlockedRemoval(preview.result);
      const approved = await dispatchToolCall({
        name: 'schematic.patch',
        args: { projectDir, approved: true, patchId: preview.result.patchId }
      }, services);
      assert.equal(approved.ok, true, approved.error?.message);
      assertBlockedRemoval(approved.result);
      assert.equal(await readFile(generated.files.schematic, 'utf8'), before);
    } finally {
      services.patchApprovalRegistry.disposeAll();
      await rm(projectDir, { force: true, recursive: true });
      await rm(services.stateRoot, { force: true, recursive: true });
    }
  });
}

test('allowRemovedComponents exact set applies and a mismatch stays blocked', async () => {
  const prompt = 'Like an ESP32 board, change the status LED resistor to 680 ohm on this STM32 board.';
  await withRemovalCandidate(prompt, async ({ projectDir, generated, plan, before }) => {
    const preview = await applySchematicPatch({
      projectDir,
      prompt,
      approved: false,
      patchPlan: plan
    });
    assertBlockedRemoval(preview);
    const refs = preview.removedComponents.map((item) => item.ref);
    assert.deepEqual([...refs].sort(), ['J2', 'J3', 'J4']);

    const missing = await applyApproved(projectDir, prompt, plan, {
      allowRemovedComponents: refs.filter((ref) => ref !== 'J2')
    });
    assertBlockedRemoval(missing, { mismatch: true });
    assert.deepEqual(missing.reason.mismatch.missing, ['J2']);
    assert.deepEqual(missing.reason.mismatch.extra, []);

    const extra = await applyApproved(projectDir, prompt, plan, {
      allowRemovedComponents: [...refs, 'R99']
    });
    assertBlockedRemoval(extra, { mismatch: true });
    assert.deepEqual(extra.reason.mismatch.missing, []);
    assert.deepEqual(extra.reason.mismatch.extra, ['R99']);

    const wrong = await applyApproved(projectDir, prompt, plan, {
      allowRemovedComponents: ['SW1']
    });
    assertBlockedRemoval(wrong, { mismatch: true });
    assert.deepEqual(wrong.reason.mismatch.missing, ['J2', 'J3', 'J4']);
    assert.deepEqual(wrong.reason.mismatch.extra, ['SW1']);

    const empty = await applyApproved(projectDir, prompt, plan, {
      allowRemovedComponents: []
    });
    assertBlockedRemoval(empty, { mismatch: true });
    assert.deepEqual(empty.reason.mismatch.missing, ['J2', 'J3', 'J4']);
    assert.deepEqual(empty.reason.mismatch.extra, []);
    assert.equal(await readFile(generated.files.schematic, 'utf8'), before);

    const applied = await applyApproved(projectDir, prompt, plan, {
      allowRemovedComponents: [...refs].reverse()
    });
    assert.equal(applied.applied, true, JSON.stringify(applied.reason));
    assert.equal(applied.reason, undefined);
    const schematic = await readFile(generated.files.schematic, 'utf8');
    assert.equal(schematic.includes('I2C_CONNECTOR'), false);
  });
});

test('daemon apply threads allowRemovedComponents and an exact set removes only those parts', async () => {
  const services = await transactionServices();
  const { projectDir, generated } = await generatedStm32Project();
  const before = await readFile(generated.files.schematic, 'utf8');
  try {
    const preview = await dispatchToolCall({
      name: 'schematic.patch',
      args: { projectDir, prompt: 'I2C 커넥터 삭제', projectName: 'stm32_i2c' }
    }, services);
    assert.equal(preview.ok, true, preview.error?.message);
    assertBlockedRemoval(preview.result);
    const refs = preview.result.removedComponents.map((item) => item.ref);
    assert.deepEqual(refs, ['J2']);

    const blocked = await dispatchToolCall({
      name: 'schematic.patch',
      args: { projectDir, approved: true, patchId: preview.result.patchId }
    }, services);
    assert.equal(blocked.ok, true, blocked.error?.message);
    assertBlockedRemoval(blocked.result);
    assert.equal(await readFile(generated.files.schematic, 'utf8'), before);

    const approved = await dispatchToolCall({
      name: 'schematic.patch',
      args: {
        projectDir,
        approved: true,
        patchId: preview.result.patchId,
        allowRemovedComponents: refs
      }
    }, services);
    assert.equal(approved.ok, true, approved.error?.message ?? JSON.stringify(approved.result?.reason));
    assert.equal(approved.result.applied, true, JSON.stringify(approved.result?.reason));
    assert.equal(approved.result.reason, undefined);
    const schematic = await readFile(generated.files.schematic, 'utf8');
    const spec = JSON.parse(await readFile(generated.files.spec, 'utf8'));
    assert.equal(schematic.includes('I2C_CONNECTOR'), false);
    assert.match(schematic, /UART_HEADER/);
    assert.equal(spec.sourcePrompt, STM32_USER_PROMPT);
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

test('allowRemovedComponents is ignored when nothing is removed', async () => {
  await withRemovalCandidate(MODIFY, async ({ projectDir, generated, plan, before }) => {
    const applied = await applyApproved(projectDir, MODIFY, plan, {
      allowRemovedComponents: ['J2', 'R99']
    });
    assert.equal(applied.applied, true, JSON.stringify(applied.reason));
    assert.equal(applied.reason, undefined);
    const schematic = await readFile(generated.files.schematic, 'utf8');
    const spec = JSON.parse(await readFile(generated.files.spec, 'utf8'));
    assert.match(schematic, /I2C_CONNECTOR/);
    assert.match(schematic, /680/);
    assert.notEqual(schematic, before);
    assert.equal(spec.sourcePrompt, STM32_USER_PROMPT);
  });
});

function codexNoPatch() {
  return {
    checkProviderAvailabilityImpl: async ({ provider }) => ({
      provider,
      command: 'codex',
      available: true,
      status: 'available'
    }),
    runProviderProcessImpl: async () => ({ exitCode: 0, stderr: '', events: [] })
  };
}

function assertExactRemoved(result, refs) {
  assert.equal(result.applied, false);
  assert.equal(result.requiresApproval, false);
  assert.equal(result.reason?.code, 'EXISTING_COMPONENTS_REMOVED');
  assert.deepEqual(result.removedComponents.map((item) => item.ref), refs);
}

test('the unclear hint example removes that reference on a project that has it', async () => {
  const hint = removalIntentUnclearMessage();
  const example = hint.split('\n')[0].match(/like\s+([A-Za-z]{1,3}\d+)/u);
  assert.ok(example, hint);
  const ref = example[1].toUpperCase();
  const { projectDir, generated } = await generatedStm32Project();
  try {
    const spec = JSON.parse(await readFile(generated.files.spec, 'utf8'));
    assert.ok((spec.schematic?.components ?? []).some((component) => component.ref?.toUpperCase() === ref));
    const before = await readFile(generated.files.schematic, 'utf8');
    for (const prompt of [`remove ${ref}`, `${ref} 삭제`]) {
      const plan = await createSchematicPatchPlan({
        projectDir,
        prompt,
        projectName: 'stm32_i2c',
        validateProjectImpl: passingErc,
        validateBoardImpl: passingDrc
      });
      try {
        const preview = await applySchematicPatch({
          projectDir,
          prompt,
          approved: false,
          patchPlan: plan
        });
        assertExactRemoved(preview, [ref]);
        assert.equal(await readFile(generated.files.schematic, 'utf8'), before);
      } finally {
        await disposeSchematicPatchPlan(plan);
      }
    }
  } finally {
    await rm(projectDir, { force: true, recursive: true });
  }
});

test('a provider with no patch removes nothing when a reference conflicts with a keep or a role', async () => {
  const services = await transactionServices();
  const { projectDir, generated } = await generatedStm32Project();
  const before = await readFile(generated.files.schematic, 'utf8');
  const prompts = [
    'remove J2 but keep I2C',
    'remove J2 but keep the I2C connector',
    'J2 삭제하고 I2C는 남겨',
    'remove D1 but keep LED',
    'D1 빼고 LED는 유지',
    'remove J2 (the LED)',
    'remove J2, the LED',
    'remove D1 (I2C connector)',
    'delete the LED J2',
    'J2(LED) 삭제'
  ];
  try {
    for (const [index, prompt] of prompts.entries()) {
      const preview = await dispatchToolCall({
        id: `call_conflict_${index}`,
        name: 'project.request',
        args: { provider: 'codex', projectDir, prompt }
      }, { ...services, ...codexNoPatch() });
      assert.equal(preview.ok, false, prompt);
      assert.equal(preview.error?.code, 'REMOVAL_INTENT_UNCLEAR', prompt);
      assert.equal(preview.error?.message, removalIntentUnclearMessage(), prompt);
      assert.equal(preview.result, undefined, prompt);
      assert.equal(await readFile(generated.files.schematic, 'utf8'), before, prompt);
    }
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

test('a provider with no patch still proposes one reference and the override must match', async () => {
  const services = await transactionServices();
  const { projectDir, generated } = await generatedStm32Project();
  let before = await readFile(generated.files.schematic, 'utf8');
  try {
    for (const [prompt, refs] of [['J2 삭제해줘', ['J2']], ['Remove D1', ['D1']]]) {
      const preview = await dispatchToolCall({
        id: `call_ref_${refs[0]}`,
        name: 'project.request',
        args: { provider: 'codex', projectDir, prompt }
      }, { ...services, ...codexNoPatch() });
      assert.equal(preview.ok, true, preview.error?.message);
      assert.equal(preview.result.providerFallback, 'built-in-draft');
      assert.equal(preview.result.source?.via, 'native-fallback');
      assertExactRemoved(preview.result, refs);
      assert.equal(await readFile(generated.files.schematic, 'utf8'), before);

      const blocked = await dispatchToolCall({
        name: 'schematic.patch',
        args: { projectDir, approved: true, patchId: preview.result.patchId }
      }, services);
      assert.equal(blocked.ok, true, blocked.error?.message);
      assertExactRemoved(blocked.result, refs);

      const mismatch = await dispatchToolCall({
        name: 'schematic.patch',
        args: {
          projectDir,
          approved: true,
          patchId: preview.result.patchId,
          allowRemovedComponents: ['J9']
        }
      }, services);
      assert.equal(mismatch.ok, true, mismatch.error?.message);
      assert.equal(mismatch.result.applied, false);
      assert.equal(mismatch.result.reason?.mismatch?.code, 'ALLOW_REMOVED_COMPONENTS_MISMATCH');
      assert.equal(await readFile(generated.files.schematic, 'utf8'), before);

      const approved = await dispatchToolCall({
        name: 'schematic.patch',
        args: {
          projectDir,
          approved: true,
          patchId: preview.result.patchId,
          allowRemovedComponents: refs
        }
      }, services);
      assert.equal(approved.ok, true, approved.error?.message ?? JSON.stringify(approved.result?.reason));
      assert.equal(approved.result.applied, true, JSON.stringify(approved.result?.reason));
      before = await readFile(generated.files.schematic, 'utf8');
    }
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

test('removing D1 after its series resistor exists lists D1 and R3 and the override must match', async () => {
  const services = await transactionServices();
  try {
    await withBoardResistor(330, async ({ projectDir, generated }) => {
      const prompt = 'Remove D1';
      const preview = await dispatchToolCall({
        name: 'schematic.patch',
        args: { projectDir, prompt, projectName: 'stm32_i2c' }
      }, services);
      assert.equal(preview.ok, true, preview.error?.message);
      assertExactRemoved(preview.result, ['D1', 'R3']);
      const mismatch = await dispatchToolCall({
        name: 'schematic.patch',
        args: {
          projectDir,
          approved: true,
          patchId: preview.result.patchId,
          allowRemovedComponents: ['D1']
        }
      }, services);
      assert.equal(mismatch.result.applied, false);
      assert.deepEqual(mismatch.result.reason?.mismatch?.missing, ['R3']);
      const applied = await dispatchToolCall({
        name: 'schematic.patch',
        args: {
          projectDir,
          approved: true,
          patchId: preview.result.patchId,
          allowRemovedComponents: ['D1', 'R3']
        }
      }, services);
      assert.equal(applied.ok, true, applied.error?.message ?? JSON.stringify(applied.result?.reason));
      assert.equal(applied.result.applied, true, JSON.stringify(applied.result?.reason));
      const schematic = await readFile(generated.files.schematic, 'utf8');
      assert.equal(schematic.includes('STATUS_LED'), false);
      assert.equal(schematic.includes('LED_RESISTOR'), false);
      assert.match(schematic, /I2C_CONNECTOR/);
    });
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

test('PROVIDER_NO_PATCH tells the user to name the part or start a new project', async () => {
  const { projectDir } = await generatedStm32Project();
  try {
    await assert.rejects(
      () => createSchematicPatchPlan({
        projectDir,
        prompt: 'reset 버튼 삭제',
        projectName: 'stm32_i2c',
        validateProjectImpl: passingErc,
        validateBoardImpl: passingDrc
      }),
      (error) => {
        assert.equal(error.code, 'PROVIDER_NO_PATCH');
        assert.match(error.message, /name the part or reference and the value/i);
        assert.match(error.message, /start a new project/i);
        assert.match(error.message, /참조 이름과 값/);
        assert.match(error.message, /새 프로젝트를 시작/);
        return true;
      }
    );
  } finally {
    await rm(projectDir, { force: true, recursive: true });
  }
});

test('a value-only prompt and a bare reference never call the provider', async () => {
  const services = await transactionServices();
  const { projectDir, generated } = await generatedStm32Project();
  const before = await readFile(generated.files.schematic, 'utf8');
  let called = false;
  const provider = {
    checkProviderAvailabilityImpl: async ({ provider }) => ({
      provider,
      command: 'codex',
      available: true,
      status: 'available'
    }),
    runProviderProcessImpl: async () => {
      called = true;
      throw new Error('provider must not be called');
    }
  };
  const rows = [
    ['1k', 'RESISTOR_TARGET_UNCLEAR'],
    ['4.99k로', 'RESISTOR_TARGET_UNCLEAR'],
    ['680Ω', 'RESISTOR_TARGET_UNCLEAR'],
    ['330옴으로', 'RESISTOR_TARGET_UNCLEAR'],
    ['-10 ohm', 'RESISTOR_VALUE_INVALID'],
    ['±10 ohm', 'RESISTOR_VALUE_INVALID'],
    ['4m7', 'RESISTOR_VALUE_INVALID'],
    ['1/4W', 'RESISTOR_VALUE_INVALID'],
    ['J2', 'REMOVAL_NEEDS_VERB'],
    ['J2부터', 'REMOVAL_NEEDS_VERB'],
    ['J2 first', 'REMOVAL_NEEDS_VERB'],
    ['J2 먼저', 'REMOVAL_NEEDS_VERB'],
    ['j2', 'REMOVAL_NEEDS_VERB'],
    ['J9', 'REMOVAL_REF_NOT_FOUND'],
    ['J2 D1', 'REMOVAL_ONE_AT_A_TIME']
  ];
  try {
    for (const [index, [prompt, code]] of rows.entries()) {
      const preview = await dispatchToolCall({
        id: `call_closed_${index}`,
        name: 'project.request',
        args: { provider: 'codex', projectDir, prompt }
      }, { ...services, ...provider });
      assert.equal(called, false, prompt);
      assert.equal(preview.ok, false, `${prompt} ${preview.error?.message ?? ''}`);
      assert.equal(preview.error?.code, code, `${prompt} ${preview.error?.message ?? ''}`);
      assert.match(preview.error?.message ?? '', /Nothing was (?:changed|removed)/, prompt);
      assert.equal(await readFile(generated.files.schematic, 'utf8'), before, prompt);
    }
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

function schematicRefValue(schematic, ref) {
  const match = schematic.match(new RegExp(`\\(property "Reference" "${ref}"[\\s\\S]*?\\(property "Value" "([^"]*)"`));
  return match?.[1] ?? null;
}

test('a named resistor that is not the LED series resistor never calls the provider', async () => {
  const services = await transactionServices();
  const projectDir = await mkdtemp(path.join(tmpdir(), 'chatpcb-resistor-ref-'));
  const spec = {
    sourcePrompt: 'existing',
    mcu: { family: 'STM32' },
    peripherals: [
      { kind: 'status-led' },
      { kind: 'status-led-resistor', value: '330' }
    ],
    schematic: {
      components: [
        { ref: 'R1', libId: 'Device:R', value: '1k' },
        { ref: 'R3', libId: 'ChatPCB:LED_RESISTOR', value: '330Ω' },
        { ref: 'R4', libId: 'ChatPCB:I2C_PULLUP', value: '4.7k' }
      ]
    },
    boardProfile: {
      productionParts: [
        { ref: 'R1', role: 'generic-resistor', libId: 'Device:R', value: '1k' },
        { ref: 'R3', role: 'status-led-resistor', libId: 'ChatPCB:LED_RESISTOR', value: '330Ω' },
        { ref: 'R4', role: 'i2c-scl-pullup', libId: 'ChatPCB:I2C_PULLUP', value: '4.7k' }
      ]
    }
  };
  const before = [
    '(kicad_sch (version 20250114) (generator chatpcb)',
    '  (symbol (lib_id "Device:R") (at 0 0 0)',
    '    (property "Reference" "R1" (at 0 0 0))',
    '    (property "Value" "1k" (at 0 0 0)))',
    '  (symbol (lib_id "ChatPCB:LED_RESISTOR") (at 10 0 0)',
    '    (property "Reference" "R3" (at 10 0 0))',
    '    (property "Value" "330Ω" (at 10 0 0)))',
    '  (symbol (lib_id "ChatPCB:I2C_PULLUP") (at 20 0 0)',
    '    (property "Reference" "R4" (at 20 0 0))',
    '    (property "Value" "4.7k" (at 20 0 0))))'
  ].join('\n');
  const schematicPath = path.join(projectDir, 'board.kicad_sch');
  await writeFile(path.join(projectDir, 'board.chatpcb.json'), `${JSON.stringify(spec, null, 2)}\n`);
  await writeFile(schematicPath, before);
  const r1Before = schematicRefValue(before, 'R1');
  const r3Before = schematicRefValue(before, 'R3');
  const r4Before = schematicRefValue(before, 'R4');
  let called = false;
  const provider = {
    checkProviderAvailabilityImpl: async ({ provider: id }) => ({
      provider: id,
      command: 'codex',
      available: true,
      status: 'available'
    }),
    runProviderProcessImpl: async () => {
      called = true;
      throw new Error('provider must not be called');
    }
  };
  const supported = resistorRefUnsupportedMessage('R3');
  const rows = [
    ['change R1 to 470', 'RESISTOR_REF_UNSUPPORTED', supported],
    ['R1 470', 'RESISTOR_REF_UNSUPPORTED', supported],
    ['저항 R1 470으로 바꿔줘', 'RESISTOR_REF_UNSUPPORTED', supported],
    ['change R1 to 1k', 'RESISTOR_REF_UNSUPPORTED', supported],
    ['change R4 to 470', 'RESISTOR_REF_UNSUPPORTED', supported],
    ['change R9 to 470', 'RESISTOR_REF_NOT_FOUND', resistorRefNotFoundMessage('R9')],
    ['change R1 and R3 to 470', 'RESISTOR_REF_AMBIGUOUS', resistorRefAmbiguousMessage(['R1', 'R3'])],
    ['change R3 to 4m7', 'RESISTOR_VALUE_INVALID', null]
  ];
  try {
    for (const [index, [prompt, code, message]] of rows.entries()) {
      const preview = await dispatchToolCall({
        id: `call_resistor_ref_${index}`,
        name: 'project.request',
        args: { provider: 'codex', projectDir, prompt }
      }, { ...services, ...provider });
      assert.equal(called, false, prompt);
      assert.equal(preview.ok, false, `${prompt} ${preview.error?.message ?? ''}`);
      assert.equal(preview.error?.code, code, `${prompt} ${preview.error?.message ?? ''}`);
      if (message) assert.equal(preview.error?.message, message, prompt);
      assert.match(preview.error?.message ?? '', /Nothing was changed/, prompt);
      const schematic = await readFile(schematicPath, 'utf8');
      assert.equal(schematic, before, prompt);
      assert.equal(schematicRefValue(schematic, 'R1'), r1Before, prompt);
      assert.equal(schematicRefValue(schematic, 'R1'), '1k', prompt);
      assert.equal(schematicRefValue(schematic, 'R3'), r3Before, prompt);
      assert.equal(schematicRefValue(schematic, 'R3'), '330Ω', prompt);
      assert.equal(schematicRefValue(schematic, 'R4'), r4Before, prompt);
      assert.equal(schematicRefValue(schematic, 'R4'), '4.7k', prompt);
    }
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

test('a non-resistor ref never calls the provider', async () => {
  const services = await transactionServices();
  const projectDir = await mkdtemp(path.join(tmpdir(), 'chatpcb-non-r-ref-'));
  const spec = {
    sourcePrompt: 'existing',
    mcu: { family: 'STM32' },
    peripherals: [
      { kind: 'status-led' },
      { kind: 'status-led-resistor', value: '330' }
    ],
    schematic: {
      components: [
        { ref: 'R3', libId: 'ChatPCB:LED_RESISTOR', value: '330Ω', role: 'status-led-resistor' },
        { ref: 'C1', libId: 'Device:C', value: '100n' },
        { ref: 'D1', libId: 'ChatPCB:STATUS_LED', value: 'STATUS_LED', role: 'status-led' }
      ]
    }
  };
  const schematic = [
    '(kicad_sch (version 20250114) (generator chatpcb)',
    '  (symbol (lib_id "ChatPCB:LED_RESISTOR") (at 0 0 0)',
    '    (property "Reference" "R3" (at 0 0 0))',
    '    (property "Value" "330Ω" (at 0 0 0)))',
    '  (symbol (lib_id "Device:C") (at 10 0 0)',
    '    (property "Reference" "C1" (at 10 0 0))',
    '    (property "Value" "100n" (at 10 0 0)))',
    '  (symbol (lib_id "ChatPCB:STATUS_LED") (at 20 0 0)',
    '    (property "Reference" "D1" (at 20 0 0))',
    '    (property "Value" "STATUS_LED" (at 20 0 0))))'
  ].join('\n');
  await writeFile(path.join(projectDir, 'board.chatpcb.json'), `${JSON.stringify(spec, null, 2)}\n`);
  await writeFile(path.join(projectDir, 'board.kicad_sch'), schematic);
  let called = false;
  const provider = {
    checkProviderAvailabilityImpl: async ({ provider: id }) => ({
      provider: id,
      command: 'codex',
      available: true,
      status: 'available'
    }),
    runProviderProcessImpl: async () => {
      called = true;
      throw new Error('provider must not be called');
    }
  };
  const unsupported = resistorRefUnsupportedMessage('R3');
  const rows = [
    ['change C1 to 470Ω', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['change D1 to 680Ω', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['J2 저항 680옴으로', 'RESISTOR_REF_NOT_FOUND', resistorRefNotFoundMessage('J2')]
  ];
  try {
    for (const [index, [prompt, code, message]] of rows.entries()) {
      const preview = await dispatchToolCall({
        id: `call_non_r_${index}`,
        name: 'project.request',
        args: { provider: 'codex', projectDir, prompt }
      }, { ...services, ...provider });
      assert.equal(called, false, prompt);
      assert.equal(preview.ok, false, `${prompt} ${preview.error?.message ?? ''}`);
      assert.equal(preview.error?.code, code, prompt);
      assert.equal(preview.error?.message, message, prompt);
      assert.equal(await readFile(path.join(projectDir, 'board.kicad_sch'), 'utf8'), schematic, prompt);
      assert.equal(schematicRefValue(schematic, 'R3'), '330Ω', prompt);
      assert.equal(schematicRefValue(await readFile(path.join(projectDir, 'board.kicad_sch'), 'utf8'), 'C1'), '100n', prompt);
      assert.equal(schematicRefValue(await readFile(path.join(projectDir, 'board.kicad_sch'), 'utf8'), 'D1'), 'STATUS_LED', prompt);
    }
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

test('naming R3 on a board with no series resistor never calls the provider', async () => {
  const services = await transactionServices();
  const projectDir = await mkdtemp(path.join(tmpdir(), 'chatpcb-no-series-'));
  const spec = {
    sourcePrompt: 'status LED without a series resistor',
    peripherals: [{ kind: 'status-led' }],
    schematic: {
      components: [
        { ref: 'D1', libId: 'Device:LED', value: 'LED' },
        { ref: 'R1', libId: 'Device:R', value: '1k' }
      ]
    }
  };
  const schematicPath = path.join(projectDir, 'led.kicad_sch');
  const schematic = [
    '(kicad_sch (version 20250114) (generator chatpcb)',
    '  (symbol (lib_id "Device:LED") (at 0 0 0)',
    '    (property "Reference" "D1" (at 0 0 0))',
    '    (property "Value" "LED" (at 0 0 0)))',
    '  (symbol (lib_id "Device:R") (at 10 0 0)',
    '    (property "Reference" "R1" (at 10 0 0))',
    '    (property "Value" "1k" (at 10 0 0))))'
  ].join('\n');
  await writeFile(path.join(projectDir, 'led.chatpcb.json'), `${JSON.stringify(spec, null, 2)}\n`);
  await writeFile(schematicPath, schematic);
  let called = false;
  const provider = {
    checkProviderAvailabilityImpl: async ({ provider: id }) => ({
      provider: id,
      command: 'codex',
      available: true,
      status: 'available'
    }),
    runProviderProcessImpl: async () => {
      called = true;
      throw new Error('provider must not be called');
    }
  };
  try {
    const missing = await dispatchToolCall({
      id: 'call_missing_r3',
      name: 'project.request',
      args: { provider: 'codex', projectDir, prompt: 'change R3 to 470' }
    }, { ...services, ...provider });
    assert.equal(called, false);
    assert.equal(missing.ok, false, missing.error?.message);
    assert.equal(missing.error?.code, 'RESISTOR_REF_NOT_FOUND');
    assert.equal(missing.error?.message, resistorRefNotFoundMessage('R3', { ledHint: true }));
    const unsupported = await dispatchToolCall({
      id: 'call_r1_no_series',
      name: 'project.request',
      args: { provider: 'codex', projectDir, prompt: 'change R1 to 470' }
    }, { ...services, ...provider });
    assert.equal(called, false);
    assert.equal(unsupported.ok, false, unsupported.error?.message);
    assert.equal(unsupported.error?.code, 'RESISTOR_REF_UNSUPPORTED');
    assert.equal(unsupported.error?.message, resistorRefUnsupportedMessage(null));
    assert.equal(await readFile(schematicPath, 'utf8'), schematic);
    assert.equal(schematicRefValue(schematic, 'R1'), '1k');
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

test('the same LED resistor value and another resistor role never call the provider', async () => {
  const services = await transactionServices();
  const projectDir = await mkdtemp(path.join(tmpdir(), 'chatpcb-resistor-same-'));
  const spec = {
    sourcePrompt: 'existing',
    mcu: { family: 'STM32' },
    peripherals: [
      { kind: 'status-led' },
      { kind: 'status-led-resistor', value: '330Ω' }
    ],
    schematic: {
      components: [
        { ref: 'R1', libId: 'Device:R', value: '5.1k' },
        { ref: 'R3', libId: 'ChatPCB:LED_RESISTOR', value: '330Ω' },
        { ref: 'R4', libId: 'ChatPCB:I2C_PULLUP', value: '4.7k' }
      ]
    },
    boardProfile: {
      productionParts: [
        { ref: 'R1', role: 'usb-c-cc1-pulldown', value: '5.1k' },
        { ref: 'R3', role: 'status-led-resistor', libId: 'ChatPCB:LED_RESISTOR', value: '330Ω' },
        { ref: 'R4', role: 'i2c-scl-pullup', value: '4.7k' }
      ]
    }
  };
  const before = [
    '(kicad_sch (version 20250114) (generator chatpcb)',
    '  (symbol (lib_id "ChatPCB:LED_RESISTOR") (at 10 0 0)',
    '    (property "Reference" "R3" (at 10 0 0))',
    '    (property "Value" "330Ω" (at 10 0 0))))'
  ].join('\n');
  const schematicPath = path.join(projectDir, 'board.kicad_sch');
  await writeFile(path.join(projectDir, 'board.chatpcb.json'), `${JSON.stringify(spec, null, 2)}\n`);
  await writeFile(schematicPath, before);
  let called = false;
  const provider = {
    checkProviderAvailabilityImpl: async ({ provider: id }) => ({
      provider: id,
      command: 'codex',
      available: true,
      status: 'available'
    }),
    runProviderProcessImpl: async () => {
      called = true;
      throw new Error('provider must not be called');
    }
  };
  const unchanged = resistorValueUnchangedMessage('R3', '330Ω');
  const unsupported = resistorRefUnsupportedMessage('R3');
  const rows = [
    ['LED 저항 330Ω으로', 'RESISTOR_VALUE_UNCHANGED', unchanged],
    ['change R3 to 330Ω', 'RESISTOR_VALUE_UNCHANGED', unchanged],
    ['LED resistor to 330 ohm', 'RESISTOR_VALUE_UNCHANGED', unchanged],
    ['LED resistor 330R', 'RESISTOR_VALUE_UNCHANGED', unchanged],
    ['change the LED resistor to 0.33k', 'RESISTOR_VALUE_UNCHANGED', unchanged],
    ['change R3 to 330', 'RESISTOR_UNIT_REQUIRED', null],
    ['CC 저항 5.1k → 10k', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['I2C 저항 2.2k로', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['SDA 저항 2.2k', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['pull up resistor 2.2k', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['USB CC resistor to 10k', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['풀업 저항 4.7k로', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['디바운스 저항 10k로', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['분압 저항 10k', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['feedback resistor 10k', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['버튼 저항 10k로', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['gate resistor 10Ω', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['termination resistor 120Ω', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['베이스 저항 680Ω으로', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['foo resistor 10k', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['파란 저항 10k', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['the second resistor 10k', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['bias resistor 10k', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['shunt resistor 10Ω', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['sense resistor 0.1Ω', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['change the sense resistor to 0.1Ω', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['센스 저항 0.1Ω으로', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['shunt resistor 10mΩ', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['션트 저항 0.05Ω', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['current sense resistor 0.1Ω', 'RESISTOR_REF_UNSUPPORTED', unsupported],
    ['저항 680Ω으로', 'RESISTOR_TARGET_UNCLEAR', resistorTargetUnclearMessage('680')]
  ];
  try {
    for (const [index, [prompt, code, message]] of rows.entries()) {
      const preview = await dispatchToolCall({
        id: `call_resistor_same_${index}`,
        name: 'project.request',
        args: { provider: 'codex', projectDir, prompt }
      }, { ...services, ...provider });
      assert.equal(called, false, prompt);
      assert.equal(preview.ok, false, `${prompt} ${preview.error?.message ?? ''}`);
      assert.equal(preview.error?.code, code, `${prompt} ${preview.error?.message ?? ''}`);
      if (message) assert.equal(preview.error?.message, message, prompt);
      assert.match(preview.error?.message ?? '', /Nothing was changed|아무것도 바꾸지 않았어요/, prompt);
      const schematic = await readFile(schematicPath, 'utf8');
      assert.equal(schematic, before, prompt);
      assert.equal(schematicRefValue(schematic, 'R3'), '330Ω', prompt);
    }
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

test('project.request locale returns one language of a bilingual refusal', async () => {
  const services = await transactionServices();
  const { projectDir, generated } = await generatedStm32Project();
  const before = await readFile(generated.files.schematic, 'utf8');
  let called = false;
  const provider = {
    checkProviderAvailabilityImpl: async ({ provider: id }) => ({
      provider: id,
      command: 'codex',
      available: true,
      status: 'available'
    }),
    runProviderProcessImpl: async () => {
      called = true;
      throw new Error('provider must not be called');
    }
  };
  const rows = [
    ['REMOVAL_INTENT_UNCLEAR', 'remove J2 but keep I2C', removalIntentUnclearMessage()],
    ['REMOVAL_NEEDS_VERB', 'J2', removalNeedsVerbMessage('J2')],
    ['RESISTOR_VALUE_INVALID', '-10 ohm', resistorValueInvalidMessage()],
    ['MIXED_REMOVAL_AND_EDIT', 'remove I2C and set the LED resistor to 680 ohm', mixedRemovalAndEditMessage()]
  ];
  // Absent and unknown stay bilingual. Region tags use the language prefix.
  const locales = [
    ['en', 'en'],
    ['en-US', 'en'],
    ['ko', 'ko'],
    ['ko-KR', 'ko'],
    [undefined, 'both'],
    ['ja', 'both']
  ];
  try {
    for (const [code, prompt, full] of rows) {
      const [en, ko, rest] = full.split('\n');
      assert.equal(rest, undefined, code);
      assert.match(ko, /[가-힣]/, code);
      assert.doesNotMatch(en, /[가-힣]/, code);
      for (const [locale, expectLang] of locales) {
        const args = { provider: 'codex', projectDir, prompt };
        if (locale !== undefined) args.locale = locale;
        const preview = await dispatchToolCall({
          id: `call_locale_${code}_${locale ?? 'absent'}`,
          name: 'project.request',
          args
        }, { ...services, ...provider });
        const label = `${code} ${locale ?? 'absent'}`;
        assert.equal(called, false, label);
        assert.equal(preview.ok, false, label);
        assert.equal(preview.error?.code, code, `${label} ${preview.error?.message ?? ''}`);
        const message = preview.error?.message ?? '';
        if (expectLang === 'en') {
          assert.equal(message, en, label);
          assert.doesNotMatch(message, /[가-힣]/, label);
        } else if (expectLang === 'ko') {
          assert.equal(message, ko, label);
          assert.equal(message.includes(en), false, label);
          assert.match(message, /[가-힣]/, label);
        } else {
          assert.equal(message, full, label);
          assert.match(message, /[가-힣]/, label);
          assert.match(message, /Nothing was/, label);
        }
        assert.equal(await readFile(generated.files.schematic, 'utf8'), before, label);
      }
    }

    const plain = await dispatchToolCall({
      name: 'project.request',
      args: { provider: 'codex', projectDir, locale: 'en' }
    }, { ...services, ...provider });
    assert.equal(plain.ok, false);
    assert.equal(plain.error?.message, 'project.request requires a prompt.');
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

test('coded native refusal uses the client locale and ignores a model locale', async () => {
  const services = await transactionServices();
  const { projectDir, generated } = await generatedStm32Project();
  const before = await readFile(generated.files.schematic, 'utf8');
  const [en, ko] = modifyRefusalMessage().split('\n');
  const provider = (modelLocale) => ({
    checkProviderAvailabilityImpl: async ({ provider: id }) => ({
      provider: id,
      command: 'codex',
      available: true,
      status: 'available'
    }),
    runProviderProcessImpl: async () => ({
      exitCode: 0,
      stderr: '',
      events: [
        createEnvelope('tool.call', {
          id: 'call_model_locale_patch',
          name: 'schematic.patch',
          args: {
            prompt: 'remove the I2C connector',
            locale: modelLocale,
            approved: true
          }
        })
      ]
    })
  });
  try {
    const english = await dispatchToolCall({
      id: 'call_client_locale_en',
      name: 'project.request',
      args: {
        provider: 'codex',
        projectDir,
        prompt: 'Keep the STM32 board unchanged.',
        locale: 'en-US'
      }
    }, { ...services, ...provider('ko') });
    assert.equal(english.ok, false, english.error?.message);
    assert.equal(english.error?.code, 'PROVIDER_NO_PATCH');
    assert.equal(english.error?.message, en);
    assert.doesNotMatch(english.error?.message ?? '', /[가-힣]/);

    const korean = await dispatchToolCall({
      id: 'call_client_locale_ko',
      name: 'project.request',
      args: {
        provider: 'codex',
        projectDir,
        prompt: 'Keep the STM32 board unchanged.',
        locale: 'ko-KR'
      }
    }, { ...services, ...provider('en') });
    assert.equal(korean.ok, false, korean.error?.message);
    assert.equal(korean.error?.code, 'PROVIDER_NO_PATCH');
    assert.equal(korean.error?.message, ko);
    assert.equal((korean.error?.message ?? '').includes(en), false);

    const both = await dispatchToolCall({
      id: 'call_client_locale_absent',
      name: 'project.request',
      args: {
        provider: 'codex',
        projectDir,
        prompt: 'Keep the STM32 board unchanged.'
      }
    }, { ...services, ...provider('ko') });
    assert.equal(both.ok, false, both.error?.message);
    assert.equal(both.error?.code, 'PROVIDER_NO_PATCH');
    assert.equal(both.error?.message, modifyRefusalMessage());
    assert.equal(await readFile(generated.files.schematic, 'utf8'), before);
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

test('the pre-provider gate lets counts, pins, colors, and questions reach the provider', async () => {
  const services = await transactionServices();
  const projectDir = await mkdtemp(path.join(tmpdir(), 'chatpcb-gate-reach-'));
  const spec = {
    sourcePrompt: 'existing board',
    mcu: { family: 'STM32' },
    peripherals: [
      { kind: 'status-led' },
      { kind: 'status-led-resistor', value: '1000' }
    ],
    schematic: {
      components: [
        { ref: 'R3', libId: 'ChatPCB:LED_RESISTOR', value: '1k' }
      ]
    }
  };
  const schematic = [
    '(kicad_sch (version 20250114) (generator chatpcb)',
    '  (symbol (lib_id "ChatPCB:LED_RESISTOR") (at 0 0 0)',
    '    (property "Reference" "R3" (at 0 0 0))',
    '    (property "Value" "1k" (at 0 0 0))))'
  ].join('\n');
  const schematicPath = path.join(projectDir, 'board.kicad_sch');
  await writeFile(path.join(projectDir, 'board.chatpcb.json'), `${JSON.stringify(spec, null, 2)}\n`);
  await writeFile(schematicPath, schematic);
  const reach = [
    'add 2 LEDs',
    'use 2 LEDs',
    'add 3 status LEDs',
    'LED 2개 추가',
    'LED 4개 추가',
    'LED 2개',
    'status LED on pin 13',
    'LED를 GPIO 4번에 연결',
    'LED 1 Hz',
    'LED blink 1Hz',
    'change LED color to red',
    'LED 색 바꿔줘',
    'change LED to green',
    'LED를 0805로',
    'LED 전류 5mA로',
    'LED 핀 GPIO15로',
    'why is R3 330?',
    'R3가 뭐야?',
    'what does R3 do?',
    'add a decoupling cap',
    'change MCU to ESP32-S3',
    'rename net',
    'add test point',
    'make the board smaller',
    'use 3.3V',
    'I2C at 400kHz',
    'USB-C 5V 3A',
    '0603 package',
    'R3 전력 0.25W',
    'LED 저항 5V',
    'LED current 2mA',
    'LED on GPIO2',
    'LED 저항 3.3V 기준으로',
    'LED 저항 2개',
    'LED 저항 2019년형'
  ];
  const either = [
    'LED 3개 저항 330',
    'LED 저항 330, LED 2개'
  ];
  let calls = 0;
  let bareDir = null;
  const provider = {
    checkProviderAvailabilityImpl: async ({ provider: id }) => ({
      provider: id,
      command: 'codex',
      available: true,
      status: 'available'
    }),
    runProviderProcessImpl: async () => {
      calls += 1;
      const error = new Error('provider-reached');
      error.code = 'PROVIDER_REACHED';
      throw error;
    }
  };
  try {
    for (const [index, prompt] of reach.entries()) {
      calls = 0;
      const preview = await dispatchToolCall({
        id: `call_gate_reach_${index}`,
        name: 'project.request',
        args: { provider: 'codex', projectDir, prompt }
      }, { ...services, ...provider });
      assert.equal(calls, 1, prompt);
      assert.equal(preview.ok, false, prompt);
      assert.equal(preview.error?.code, 'PROVIDER_REACHED', `${prompt} ${preview.error?.code} ${preview.error?.message ?? ''}`);
      assert.equal(await readFile(schematicPath, 'utf8'), schematic, prompt);
      assert.equal(schematicRefValue(schematic, 'R3'), '1k', prompt);
    }
    for (const [index, prompt] of either.entries()) {
      calls = 0;
      const preview = await dispatchToolCall({
        id: `call_gate_either_${index}`,
        name: 'project.request',
        args: { provider: 'codex', projectDir, prompt }
      }, { ...services, ...provider });
      assert.equal(await readFile(schematicPath, 'utf8'), schematic, prompt);
      assert.equal(schematicRefValue(await readFile(schematicPath, 'utf8'), 'R3'), '1k', prompt);
      if (calls === 0) {
        assert.equal(preview.ok, false, prompt);
        assert.equal(preview.error?.code, 'RESISTOR_UNIT_REQUIRED', `${prompt} ${preview.error?.message ?? ''}`);
        assert.match(preview.error?.message ?? '', /Nothing was changed/, prompt);
      } else {
        assert.equal(calls, 1, prompt);
        assert.equal(preview.error?.code, 'PROVIDER_REACHED', prompt);
      }
    }

    bareDir = await mkdtemp(path.join(tmpdir(), 'chatpcb-gate-nor3-'));
    const bareSpec = {
      sourcePrompt: 'board without R3',
      mcu: { family: 'STM32' },
      peripherals: [{ kind: 'status-led' }],
      schematic: {
        components: [
          { ref: 'D1', libId: 'Device:LED', value: 'LED' },
          { ref: 'R1', libId: 'Device:R', value: '1k' }
        ]
      }
    };
    const bareSchematic = [
      '(kicad_sch (version 20250114) (generator chatpcb)',
      '  (symbol (lib_id "Device:LED") (at 0 0 0)',
      '    (property "Reference" "D1" (at 0 0 0))',
      '    (property "Value" "LED" (at 0 0 0))))'
    ].join('\n');
    const barePath = path.join(bareDir, 'bare.kicad_sch');
    await writeFile(path.join(bareDir, 'bare.chatpcb.json'), `${JSON.stringify(bareSpec, null, 2)}\n`);
    await writeFile(barePath, bareSchematic);
    for (const [index, prompt] of ['why is R3 330?', 'R3가 뭐야?'].entries()) {
      calls = 0;
      const preview = await dispatchToolCall({
        id: `call_gate_nor3_${index}`,
        name: 'project.request',
        args: { provider: 'codex', projectDir: bareDir, prompt }
      }, { ...services, ...provider });
      assert.equal(calls, 1, prompt);
      assert.equal(preview.error?.code, 'PROVIDER_REACHED', `${prompt} ${preview.error?.code} ${preview.error?.message ?? ''}`);
      assert.equal(await readFile(barePath, 'utf8'), bareSchematic, prompt);
    }
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    if (bareDir) await rm(bareDir, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

test('the pre-provider gate sends non-resistor edits to the provider and blocks real resistor refusals', async () => {
  const services = await transactionServices();
  const projectDir = await mkdtemp(path.join(tmpdir(), 'chatpcb-gate-table-'));
  const spec = {
    sourcePrompt: 'existing board',
    mcu: { family: 'STM32' },
    peripherals: [
      { kind: 'status-led' },
      { kind: 'status-led-resistor', value: '1000' }
    ],
    schematic: {
      components: [
        { ref: 'R3', libId: 'ChatPCB:LED_RESISTOR', value: '1k' }
      ]
    }
  };
  const schematic = [
    '(kicad_sch (version 20250114) (generator chatpcb)',
    '  (symbol (lib_id "ChatPCB:LED_RESISTOR") (at 0 0 0)',
    '    (property "Reference" "R3" (at 0 0 0))',
    '    (property "Value" "1k" (at 0 0 0))))'
  ].join('\n');
  const schematicPath = path.join(projectDir, 'board.kicad_sch');
  await writeFile(path.join(projectDir, 'board.chatpcb.json'), `${JSON.stringify(spec, null, 2)}\n`);
  await writeFile(schematicPath, schematic);
  const reach = [
    'add 100nF cap near U1',
    'C1을 10uF로',
    'change C1 to 100nF',
    'L1 10uH로',
    'set VCC to 3.3V',
    'add 10k pull-up on reset',
    'reset에 10k 풀업 추가',
    'add a 120Ω termination resistor',
    'LED 하나 더 추가하고 저항 330Ω',
    '1kΩ 저항 추가해줘',
    'add a 1kΩ resistor',
    'why is R3 330?',
    'R3는 왜 330이야?',
    'what does R3 do?',
    '포트 8080',
    'port 8080',
    '12만',
    '3천',
    '저항 12만으로',
    'LED 저항 1kΩ 괜찮아?',
    'is 1kΩ ok for the LED resistor?',
    'rev 2',
    'the 2019 model',
    'LED 저항 2개',
    'LED 저항 2019년형',
    'v2 board',
    'change the LED resistor to the 2019 model',
    'LED resistor rev 2',
    'change R3 to 0603',
    'LED 저항 0805로',
    'R3 0603',
    'R3 470?',
    'why is R3 470'
  ];
  const blocked = [
    ['pull-up 10k', 'RESISTOR_REF_UNSUPPORTED'],
    ['풀업 10k', 'RESISTOR_REF_UNSUPPORTED'],
    ['change the pull-up to 10k', 'RESISTOR_REF_UNSUPPORTED'],
    ['CC 5.1k로', 'RESISTOR_REF_UNSUPPORTED'],
    ['R3 470', 'RESISTOR_UNIT_REQUIRED'],
    ['change R3 to 470', 'RESISTOR_UNIT_REQUIRED'],
    ['LED 저항 330으로', 'RESISTOR_UNIT_REQUIRED'],
    ['set the LED resistor to 470', 'RESISTOR_UNIT_REQUIRED'],
    ['LED 저항 4m7으로', 'RESISTOR_VALUE_INVALID'],
    ['change the LED resistor to 4m7', 'RESISTOR_VALUE_INVALID'],
    ['change R3 to 2.2kΩ and keep the 1 m cable', 'RESISTOR_TARGET_UNCLEAR']
  ];
  let calls = 0;
  const provider = {
    checkProviderAvailabilityImpl: async ({ provider: id }) => ({
      provider: id,
      command: 'codex',
      available: true,
      status: 'available'
    }),
    runProviderProcessImpl: async () => {
      calls += 1;
      const error = new Error('provider-reached');
      error.code = 'PROVIDER_REACHED';
      throw error;
    }
  };
  try {
    for (const [index, prompt] of reach.entries()) {
      calls = 0;
      const preview = await dispatchToolCall({
        id: `call_gate_table_reach_${index}`,
        name: 'project.request',
        args: { provider: 'codex', projectDir, prompt }
      }, { ...services, ...provider });
      assert.equal(calls, 1, prompt);
      assert.equal(preview.ok, false, prompt);
      assert.equal(preview.error?.code, 'PROVIDER_REACHED', `${prompt} ${preview.error?.code} ${preview.error?.message ?? ''}`);
      assert.equal(await readFile(schematicPath, 'utf8'), schematic, prompt);
      assert.equal(schematicRefValue(schematic, 'R3'), '1k', prompt);
    }
    for (const [index, [prompt, code]] of blocked.entries()) {
      calls = 0;
      const preview = await dispatchToolCall({
        id: `call_gate_table_block_${index}`,
        name: 'project.request',
        args: { provider: 'codex', projectDir, prompt }
      }, { ...services, ...provider });
      assert.equal(calls, 0, prompt);
      assert.equal(preview.ok, false, prompt);
      assert.equal(preview.error?.code, code, `${prompt} ${preview.error?.code} ${preview.error?.message ?? ''}`);
      assert.match(preview.error?.message ?? '', /Nothing was changed|아무것도 바꾸지 않았어요/, prompt);
      assert.equal(await readFile(schematicPath, 'utf8'), schematic, prompt);
    }
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

async function readGeneratedBytes(generated) {
  return {
    schematic: await readFile(generated.files.schematic, 'utf8'),
    spice: await readFile(generated.files.spice, 'utf8'),
    spec: await readFile(generated.files.spec, 'utf8'),
    board: generated.files.board ? await readFile(generated.files.board, 'utf8') : null
  };
}

async function writeGeneratedBytes(generated, bytes) {
  await writeFile(generated.files.schematic, bytes.schematic);
  await writeFile(generated.files.spice, bytes.spice);
  await writeFile(generated.files.spec, bytes.spec);
  if (generated.files.board && bytes.board != null) await writeFile(generated.files.board, bytes.board);
}

function spiceWithoutLed(spice) {
  return spice.split('\n').filter((line) => !/^RLED\b/.test(line)).join('\n');
}

function referenceValues(schematic) {
  const values = {};
  for (const match of schematic.matchAll(/\(property "Reference" "([A-Za-z]{1,3}\d+)"[\s\S]*?\(property "Value" "([^"]*)"/g)) {
    values[match[1]] = match[2];
  }
  return values;
}

function assertOnlySeriesValueChanged(schematic, beforeSchematic, label, spice, beforeSpice, ohms, prompt) {
  const next = referenceValues(schematic);
  const prev = referenceValues(beforeSchematic);
  assert.equal(next.R3, label, prompt);
  assert.deepEqual(Object.keys(next).sort(), Object.keys(prev).sort(), prompt);
  for (const ref of Object.keys(prev)) {
    if (ref === 'R3') continue;
    assert.equal(next[ref], prev[ref], `${prompt} ${ref}`);
  }
  assert.match(spice, new RegExp(`^RLED\\s+\\S+\\s+\\S+\\s+${ohms}$`, 'm'), prompt);
  assert.equal(spiceWithoutLed(spice), spiceWithoutLed(beforeSpice), prompt);
}

async function materializeSeriesResistor(services, projectDir, generated) {
  const preview = await dispatchToolCall({
    id: `call_materialize_${projectDir.length}`,
    name: 'project.request',
    args: { provider: 'codex', projectDir, prompt: 'set the LED resistor to 1kΩ' }
  }, { ...services, ...codexNoPatch() });
  assert.equal(preview.ok, true, preview.error?.message ?? '');
  const approved = await dispatchToolCall({
    name: 'schematic.patch',
    args: { projectDir, approved: true, patchId: preview.result.patchId }
  }, services);
  assert.equal(approved.result?.applied, true, JSON.stringify(approved.result?.reason ?? approved.error));
  const before = await readGeneratedBytes(generated);
  assert.equal(schematicRefValue(before.schematic, 'R3'), '1k');
  assert.match(before.spice, /^RLED\s+\S+\s+\S+\s+1000$/m);
  return before;
}

test('a polite question with an LED target, edit verb, and unit value applies R3=680Ω and RLED 680', async () => {
  const services = await transactionServices();
  const { projectDir, generated } = await generatedStm32Project();
  const before = await materializeSeriesResistor(services, projectDir, generated);
  const prompts = [
    'can you set the LED resistor to 680Ω?',
    'LED 저항 680Ω으로 바꿔줄래?',
    'LED 저항 680Ω으로 바꿔 줄 수 있어?',
    'could you change R3 to 680Ω?',
    'can I change the LED resistor to 680Ω?'
  ];
  const paths = [
    ['patch', codexPatchRewrite('Change the LED resistor to 680Ω.')],
    ['native', codexNoPatch()]
  ];
  try {
    let index = 0;
    for (const prompt of prompts) {
      for (const [pathName, provider] of paths) {
        index += 1;
        await writeGeneratedBytes(generated, before);
        const preview = await dispatchToolCall({
          id: `call_polite_${index}`,
          name: 'project.request',
          args: { provider: 'codex', projectDir, prompt }
        }, { ...services, ...provider });
        assert.equal(preview.ok, true, `${pathName} ${prompt} ${preview.error?.code ?? ''} ${preview.error?.message ?? ''}`);
        const approved = await dispatchToolCall({
          name: 'schematic.patch',
          args: { projectDir, approved: true, patchId: preview.result.patchId }
        }, services);
        assert.equal(approved.ok, true, approved.error?.message ?? JSON.stringify(approved.result?.reason));
        assert.equal(approved.result.applied, true, `${pathName} ${prompt} ${JSON.stringify(approved.result?.reason)}`);
        const schematic = await readFile(generated.files.schematic, 'utf8');
        const spice = await readFile(generated.files.spice, 'utf8');
        assertOnlySeriesValueChanged(schematic, before.schematic, '680Ω', spice, before.spice, '680', `${pathName} ${prompt}`);
        assert.match(schematic, /I2C_CONNECTOR/, prompt);
      }
    }

    await writeGeneratedBytes(generated, before);
    const permission = 'LED 저항 10k로 바꿔도 돼?';
    const permissionPreview = await dispatchToolCall({
      id: 'call_polite_permission',
      name: 'project.request',
      args: { provider: 'codex', projectDir, prompt: permission }
    }, { ...services, ...codexNoPatch() });
    assert.equal(permissionPreview.ok, true, `${permissionPreview.error?.code ?? ''} ${permissionPreview.error?.message ?? ''}`);
    const permissionApproved = await dispatchToolCall({
      name: 'schematic.patch',
      args: { projectDir, approved: true, patchId: permissionPreview.result.patchId }
    }, services);
    assert.equal(permissionApproved.ok, true, permissionApproved.error?.message ?? JSON.stringify(permissionApproved.result?.reason));
    assert.equal(permissionApproved.result.applied, true, JSON.stringify(permissionApproved.result?.reason));
    const permissionSchematic = await readFile(generated.files.schematic, 'utf8');
    const permissionSpice = await readFile(generated.files.spice, 'utf8');
    assertOnlySeriesValueChanged(permissionSchematic, before.schematic, '10k', permissionSpice, before.spice, '10000', permission);

    let calls = 0;
    const counting = {
      checkProviderAvailabilityImpl: async ({ provider }) => ({
        provider,
        command: 'codex',
        available: true,
        status: 'available'
      }),
      runProviderProcessImpl: async () => {
        calls += 1;
        return {
          exitCode: 0,
          stderr: '',
          events: [
            createEnvelope('tool.call', {
              id: 'call_polite_should_not_apply',
              name: 'schematic.patch',
              args: { prompt: 'Change the LED resistor to 680Ω.' }
            })
          ]
        };
      }
    };
    const blocked = [
      ['can you set the LED resistor to 0R?', 'RESISTOR_VALUE_INVALID', 0],
      ['could you change the pull-up to 10k?', 'RESISTOR_REF_UNSUPPORTED', 0],
      ['can you add a 1kΩ resistor?', 'PROVIDER_NO_PATCH', 1],
      ['how about R3 = 2.2k?', 'PROVIDER_NO_PATCH', 1],
      ['LED 저항 1kΩ 괜찮아?', 'PROVIDER_NO_PATCH', 1],
      ['R3 470?', 'PROVIDER_NO_PATCH', 1]
    ];
    for (const [prompt, code, expectedCalls] of blocked) {
      calls = 0;
      await writeGeneratedBytes(generated, before);
      const preview = await dispatchToolCall({
        id: `call_polite_block_${prompt.length}`,
        name: 'project.request',
        args: { provider: 'codex', projectDir, prompt }
      }, { ...services, ...counting });
      assert.equal(calls, expectedCalls, prompt);
      assert.equal(preview.ok, false, prompt);
      assert.equal(preview.error?.code, code, `${prompt} ${preview.error?.code ?? ''} ${preview.error?.message ?? ''}`);
      assert.equal(await readFile(generated.files.schematic, 'utf8'), before.schematic, prompt);
      assert.equal(await readFile(generated.files.spice, 'utf8'), before.spice, prompt);
    }
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

test('Korean keep clause applies only R3', async () => {
  const services = await transactionServices();
  const { projectDir, generated } = await generatedStm32Project();
  const before = await materializeSeriesResistor(services, projectDir, generated);
  const prompts = [
    'I2C는 그대로 두고 LED 저항 680옴으로',
    '풀업은 그대로 두고 LED 저항 680Ω으로 바꿔줘',
    '풀업 저항은 건드리지 말고 LED 저항 680Ω으로',
    'CC 저항은 유지하고 LED 저항 680Ω으로 바꿔줘',
    '풀업 빼고 LED 저항 680Ω으로',
    'I2C는 놔두고 LED 저항 680Ω으로'
  ];
  const paths = [
    ['patch', codexPatchRewrite('Change the LED resistor to 680Ω.')],
    ['native', codexNoPatch()]
  ];
  try {
    let index = 0;
    for (const prompt of prompts) {
      for (const [pathName, provider] of paths) {
        index += 1;
        await writeGeneratedBytes(generated, before);
        const preview = await dispatchToolCall({
          id: `call_keep_${index}`,
          name: 'project.request',
          args: { provider: 'codex', projectDir, prompt }
        }, { ...services, ...provider });
        assert.equal(preview.ok, true, `${pathName} ${prompt} ${preview.error?.code ?? ''} ${preview.error?.message ?? ''}`);
        const approved = await dispatchToolCall({
          name: 'schematic.patch',
          args: { projectDir, approved: true, patchId: preview.result.patchId }
        }, services);
        assert.equal(approved.result.applied, true, `${pathName} ${prompt} ${JSON.stringify(approved.result?.reason)}`);
        const schematic = await readFile(generated.files.schematic, 'utf8');
        const spice = await readFile(generated.files.spice, 'utf8');
        assertOnlySeriesValueChanged(schematic, before.schematic, '680Ω', spice, before.spice, '680', `${pathName} ${prompt}`);
      }
    }

    let calls = 0;
    const blockedProvider = {
      checkProviderAvailabilityImpl: async ({ provider }) => ({
        provider,
        command: 'codex',
        available: true,
        status: 'available'
      }),
      runProviderProcessImpl: async () => {
        calls += 1;
        throw new Error('provider must not be called');
      }
    };
    const blocked = [
      ['LED 저항은 그대로 두고 풀업 저항 10k로', 'RESISTOR_REF_UNSUPPORTED'],
      ['LED 저항은 그대로 두고 680Ω으로', 'RESISTOR_TARGET_UNCLEAR']
    ];
    for (const [prompt, code] of blocked) {
      calls = 0;
      await writeGeneratedBytes(generated, before);
      const preview = await dispatchToolCall({
        id: `call_keep_block_${prompt.length}`,
        name: 'project.request',
        args: { provider: 'codex', projectDir, prompt }
      }, { ...services, ...blockedProvider });
      assert.equal(calls, 0, prompt);
      assert.equal(preview.ok, false, prompt);
      assert.equal(preview.error?.code, code, `${prompt} ${preview.error?.code ?? ''} ${preview.error?.message ?? ''}`);
      assert.equal(schematicRefValue(await readFile(generated.files.schematic, 'utf8'), 'R3'), schematicRefValue(before.schematic, 'R3'), prompt);
      assert.equal(await readFile(generated.files.spice, 'utf8'), before.spice, prompt);
    }
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

test('LED synonyms/plurals and port noise edit R3', async () => {
  const services = await transactionServices();
  const { projectDir, generated } = await generatedStm32Project();
  const before = await materializeSeriesResistor(services, projectDir, generated);
  const rows = [
    ['엘예디 저항 680Ω으로', '680Ω', '680'],
    ['발광 다이오드 저항 680Ω으로', '680Ω', '680'],
    ['LED들 저항 680Ω으로', '680Ω', '680'],
    ['LED들의 저항 680Ω으로', '680Ω', '680'],
    ['port 8080 LED 저항 330Ω', '330Ω', '330'],
    ['포트 8080 LED 저항 330Ω', '330Ω', '330'],
    ['pin 13 LED 저항 330Ω', '330Ω', '330'],
    ['GPIO 4 LED 저항 330Ω', '330Ω', '330'],
    ['3.3V LED 저항 330Ω', '330Ω', '330'],
    ['100nF LED 저항 330Ω', '330Ω', '330']
  ];
  try {
    for (const [index, [prompt, label, ohms]] of rows.entries()) {
      await writeGeneratedBytes(generated, before);
      const preview = await dispatchToolCall({
        id: `call_synonym_${index}`,
        name: 'project.request',
        args: { provider: 'codex', projectDir, prompt }
      }, { ...services, ...codexNoPatch() });
      assert.equal(preview.ok, true, `${prompt} ${preview.error?.code ?? ''} ${preview.error?.message ?? ''}`);
      assert.equal(preview.result.providerFallback, undefined, prompt);
      assert.equal(preview.result.source?.via, 'native-fallback', prompt);
      const approved = await dispatchToolCall({
        name: 'schematic.patch',
        args: { projectDir, approved: true, patchId: preview.result.patchId }
      }, services);
      assert.equal(approved.result.applied, true, `${prompt} ${JSON.stringify(approved.result?.reason)}`);
      const schematic = await readFile(generated.files.schematic, 'utf8');
      const spice = await readFile(generated.files.spice, 'utf8');
      assertOnlySeriesValueChanged(schematic, before.schematic, label, spice, before.spice, ohms, prompt);
    }

    let calls = 0;
    const blockedProvider = {
      checkProviderAvailabilityImpl: async ({ provider }) => ({
        provider,
        command: 'codex',
        available: true,
        status: 'available'
      }),
      runProviderProcessImpl: async () => {
        calls += 1;
        throw new Error('provider must not be called');
      }
    };
    for (const [index, prompt] of ['그 저항 10k로', 'that resistor to 10k', '이 저항 10k로', 'this resistor to 10k'].entries()) {
      calls = 0;
      await writeGeneratedBytes(generated, before);
      const preview = await dispatchToolCall({
        id: `call_demonstrative_${index}`,
        name: 'project.request',
        args: { provider: 'codex', projectDir, prompt }
      }, { ...services, ...blockedProvider });
      assert.equal(calls, 0, prompt);
      assert.equal(preview.error?.code, 'RESISTOR_TARGET_UNCLEAR', `${prompt} ${preview.error?.code ?? ''} ${preview.error?.message ?? ''}`);
      assert.equal(schematicRefValue(await readFile(generated.files.schematic, 'utf8'), 'R3'), '1k', prompt);
    }

    calls = 0;
    await writeGeneratedBytes(generated, before);
    const plain = await dispatchToolCall({
      id: 'call_demonstrative_plain',
      name: 'project.request',
      args: { provider: 'codex', projectDir, prompt: '이 저항' }
    }, { ...services, ...blockedProvider });
    assert.notEqual(plain.error?.code, 'RESISTOR_REF_UNSUPPORTED');
    assert.equal(schematicRefValue(await readFile(generated.files.schematic, 'utf8'), 'R3'), '1k');
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

test('a current-limiting resistor with no LED word applies R3=470Ω and RLED 470 before the provider', async () => {
  const services = await transactionServices();
  const { projectDir, generated } = await generatedStm32Project();
  const before = await materializeSeriesResistor(services, projectDir, generated);
  const prompts = [
    'current limiting resistor 470Ω',
    'current-limiting resistor 470Ω',
    '전류제한 저항 470Ω',
    '전류 제한 저항 470Ω으로'
  ];
  let calls = 0;
  const provider = {
    checkProviderAvailabilityImpl: async ({ provider }) => ({
      provider,
      command: 'codex',
      available: true,
      status: 'available'
    }),
    runProviderProcessImpl: async () => {
      calls += 1;
      throw new Error('provider must not be called');
    }
  };
  try {
    for (const [index, prompt] of prompts.entries()) {
      calls = 0;
      await writeGeneratedBytes(generated, before);
      const preview = await dispatchToolCall({
        id: `call_current_limit_${index}`,
        name: 'project.request',
        args: { provider: 'codex', projectDir, prompt }
      }, { ...services, ...provider });
      assert.equal(calls, 0, prompt);
      assert.equal(preview.ok, true, `${prompt} ${preview.error?.code ?? ''} ${preview.error?.message ?? ''}`);
      assert.equal(preview.result.providerFallback, undefined, prompt);
      assert.equal(preview.result.source?.via, 'native-fallback', prompt);
      const approved = await dispatchToolCall({
        name: 'schematic.patch',
        args: { projectDir, approved: true, patchId: preview.result.patchId }
      }, services);
      assert.equal(approved.result?.applied, true, `${prompt} ${JSON.stringify(approved.result?.reason ?? approved.error)}`);
      const schematic = await readFile(generated.files.schematic, 'utf8');
      const spice = await readFile(generated.files.spice, 'utf8');
      assertOnlySeriesValueChanged(schematic, before.schematic, '470Ω', spice, before.spice, '470', prompt);
    }
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

function countingProvider(onCall) {
  return {
    checkProviderAvailabilityImpl: async ({ provider }) => ({
      provider,
      command: 'codex',
      available: true,
      status: 'available'
    }),
    runProviderProcessImpl: async () => onCall()
  };
}

function nativeNoPatchCounter() {
  let calls = 0;
  return {
    calls: () => calls,
    impl: countingProvider(() => {
      calls += 1;
      return { exitCode: 0, stderr: '', events: [] };
    })
  };
}

function maliciousPatchCounter(modelPrompt) {
  let calls = 0;
  return {
    calls: () => calls,
    impl: countingProvider(() => {
      calls += 1;
      return {
        exitCode: 0,
        stderr: '',
        events: [
          createEnvelope('tool.call', {
            id: `call_malicious_${calls}`,
            name: 'schematic.patch',
            args: { prompt: modelPrompt }
          })
        ]
      };
    })
  };
}

function rledOhms(spice) {
  const match = spice.match(/^RLED\s+\S+\s+\S+\s+(\S+)$/m);
  return match ? match[1] : null;
}

// project.request → schematic.patch approve. A refusal has no patch to approve.
// A merge is approved so a wrong R3 value is visible on the schematic and in RLED.
async function requestAndMaybeApprove(services, projectDir, prompt, provider, id) {
  const preview = await dispatchToolCall({
    id,
    name: 'project.request',
    args: { provider: 'codex', projectDir, prompt }
  }, { ...services, ...provider });
  if (preview.ok && preview.result?.patchId) {
    await dispatchToolCall({
      name: 'schematic.patch',
      args: { projectDir, approved: true, patchId: preview.result.patchId }
    }, services);
  }
  return preview;
}

function assertResistorUntouched(preview, calls, schematic, spice, before, prompt) {
  const r3 = schematicRefValue(schematic, 'R3');
  const rled = rledOhms(spice);
  assert.equal(calls, 0, `${prompt} provider calls ${calls} R3=${r3} RLED=${rled} code=${preview.error?.code ?? preview.result?.applied}`);
  assert.equal(preview.ok, false, `${prompt} R3=${r3} RLED=${rled}`);
  assert.equal(preview.error?.code, 'RESISTOR_REF_UNSUPPORTED', `${prompt} code=${preview.error?.code ?? 'none'} R3=${r3} RLED=${rled} ${preview.error?.message ?? ''}`);
  assert.equal(r3, schematicRefValue(before.schematic, 'R3'), `${prompt} R3`);
  assert.equal(rled, rledOhms(before.spice), `${prompt} RLED`);
  assert.equal(schematic, before.schematic, prompt);
  assert.equal(spice, before.spice, prompt);
}

// A question or an approximate value reaches the provider and writes nothing.
// The malicious model prompt must not land either.
async function assertProviderLeavesSeries(services, projectDir, generated, before, prompt, id) {
  for (const kind of ['native', 'malicious']) {
    const provider = kind === 'native'
      ? nativeNoPatchCounter()
      : maliciousPatchCounter('LED 22Ω, R4 10k');
    await writeGeneratedBytes(generated, before);
    const preview = await requestAndMaybeApprove(services, projectDir, prompt, provider.impl, `${id}_${kind}`);
    const schematic = await readFile(generated.files.schematic, 'utf8');
    const spice = await readFile(generated.files.spice, 'utf8');
    const code = preview.error?.code ?? '';
    assert.equal(provider.calls(), 1, `${kind} ${prompt} calls=${provider.calls()} code=${code || preview.result?.applied} R3=${schematicRefValue(schematic, 'R3')}`);
    assert.equal(preview.ok, false, `${kind} ${prompt} ${code} ${preview.error?.message ?? ''}`);
    assert.equal(code, 'PROVIDER_NO_PATCH', `${kind} ${prompt} ${code}`);
    assert.equal(code.startsWith('RESISTOR_'), false, `${kind} ${prompt} ${code}`);
    assert.equal(schematicRefValue(schematic, 'R3'), '1k', `${kind} ${prompt}`);
    assert.equal(rledOhms(spice), '1000', `${kind} ${prompt}`);
    assert.equal(schematic, before.schematic, `${kind} ${prompt}`);
    assert.equal(spice, before.spice, `${kind} ${prompt}`);
  }
}

test('LED and pull-up values in one request never apply the pull-up value to R3', async () => {
  const services = await transactionServices();
  const { projectDir, generated } = await generatedStm32Project();
  const before = await materializeSeriesResistor(services, projectDir, generated);
  const prompts = [
    'LED resistor to 680Ω and pull-up to 2.2k',
    'LED resistor to 680Ω, pull-up to 2.2k',
    'LED 저항 680Ω, 풀업 2.2kΩ으로',
    '풀업은 2.2k로, LED 저항은 680Ω으로',
    'LED 저항 680Ω으로 그리고 풀업 저항 2.2k로',
    'set the LED resistor to 680Ω and the I2C pull-up to 4.7kΩ',
    'CC 저항 5.1k, LED 저항 680Ω으로'
  ];
  try {
    let index = 0;
    for (const prompt of prompts) {
      for (const kind of ['native', 'malicious']) {
        index += 1;
        const provider = kind === 'native'
          ? nativeNoPatchCounter()
          : maliciousPatchCounter('LED 22Ω, R4 10k');
        await writeGeneratedBytes(generated, before);
        const preview = await requestAndMaybeApprove(services, projectDir, prompt, provider.impl, `call_h1_mix_${index}`);
        const schematic = await readFile(generated.files.schematic, 'utf8');
        const spice = await readFile(generated.files.spice, 'utf8');
        assertResistorUntouched(preview, provider.calls(), schematic, spice, before, `${kind} ${prompt}`);
      }
    }
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

test('LED and pull\u2011up (U+2010/2011/2013/2014 hyphen) values in one request never apply the pull-up value to R3', async () => {
  const services = await transactionServices();
  const { projectDir, generated } = await generatedStm32Project();
  const before = await materializeSeriesResistor(services, projectDir, generated);
  const prompts = [
    ...['\u2010', '\u2011', '\u2013', '\u2014', '\u2212', '\uFF0D'].map((dash) => `LED resistor to 680Ω, pull${dash}up to 2.2k`),
    'LED 저항 680Ω\uFF0C 풀업 2.2kΩ',
    'LED 저항 680Ω\uFF0C풀업 2.2kΩ'
  ];
  try {
    let index = 0;
    for (const prompt of prompts) {
      for (const kind of ['native', 'malicious']) {
        index += 1;
        const provider = kind === 'native'
          ? nativeNoPatchCounter()
          : maliciousPatchCounter('LED 22Ω, R4 10k');
        await writeGeneratedBytes(generated, before);
        const preview = await requestAndMaybeApprove(services, projectDir, prompt, provider.impl, `call_h1_dash_${index}`);
        const schematic = await readFile(generated.files.schematic, 'utf8');
        const spice = await readFile(generated.files.spice, 'utf8');
        assertResistorUntouched(preview, provider.calls(), schematic, spice, before, `${kind} ${prompt}`);
      }
    }
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

test('\'may I ask why R3 is 680Ω?\' and \'may I know why\u2026\' reach the provider and create no R3 patch', async () => {
  const services = await transactionServices();
  const { projectDir, generated } = await generatedStm32Project();
  const before = await materializeSeriesResistor(services, projectDir, generated);
  const prompts = [
    'may I ask why R3 is 680Ω?',
    'may I know why R3 is 680Ω?',
    'can I ask why the LED resistor is 680Ω?',
    'could I know what R3 is?',
    'LED 저항이 왜 680Ω인지 물어봐도 돼?'
  ];
  try {
    for (const [index, prompt] of prompts.entries()) {
      await assertProviderLeavesSeries(services, projectDir, generated, before, prompt, `call_m5_${index}`);
    }
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

test('approximate values with a unit (\'약 680Ω\', \'~680Ω\', \'680Ω 내외\') reach the provider', async () => {
  const services = await transactionServices();
  const { projectDir, generated } = await generatedStm32Project();
  const before = await materializeSeriesResistor(services, projectDir, generated);
  const prompts = [
    'LED 저항 약 680Ω으로',
    'LED resistor ~680Ω',
    'change the LED resistor to ~680Ω',
    'change the LED resistor to about 4.7kΩ',
    'LED 저항 680옴 정도로',
    'LED 저항을 680옴 정도로',
    'LED 저항 4.7k 내외로',
    'LED 저항을 4.7k 내외로',
    'change the LED resistor to 680Ω 내외',
    'change the LED resistor to around 680Ω',
    'change the LED resistor to approximately 680Ω',
    'set the LED resistor to approximately 680Ω',
    'change the LED resistor to roughly 680Ω',
    'LED resistor roughly 680Ω',
    'LED 저항 대략 680Ω으로',
    'change the LED resistor to 680Ω-ish',
    'LED resistor 680Ω-ish'
  ];
  try {
    for (const [index, prompt] of prompts.entries()) {
      await assertProviderLeavesSeries(services, projectDir, generated, before, prompt, `call_l1_${index}`);
    }
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

test('a negated keep clause on the pull-up (\'풀업을 그대로 두지 말고 2.2k로\') never changes R3', async () => {
  const services = await transactionServices();
  const { projectDir, generated } = await generatedStm32Project();
  const before = await materializeSeriesResistor(services, projectDir, generated);
  const prompts = [
    '풀업을 그대로 두지 말고 2.2k로',
    '풀업은 유지하지 말고 2.2k로',
    "don't keep the pull-up, set it to 2.2k",
    "don't leave the pull-up as is, change it to 2.2k"
  ];
  try {
    let index = 0;
    for (const prompt of prompts) {
      for (const kind of ['native', 'malicious']) {
        index += 1;
        const provider = kind === 'native'
          ? nativeNoPatchCounter()
          : maliciousPatchCounter('LED 22Ω, R4 10k');
        await writeGeneratedBytes(generated, before);
        const preview = await requestAndMaybeApprove(services, projectDir, prompt, provider.impl, `call_h1_keep_${index}`);
        const schematic = await readFile(generated.files.schematic, 'utf8');
        const spice = await readFile(generated.files.spice, 'utf8');
        assertResistorUntouched(preview, provider.calls(), schematic, spice, before, `${kind} ${prompt}`);
      }
    }
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

// Mix of one LED clause and non-LED or unknown role clauses. The board's 1k
// is not in the pool, so a stale R3 cannot look like a foreign value.
// Each run picks a seed. CHATPCB_PROP_SEED overrides it.
const MIXED_ROLE_CASES = 200;
const MIXED_ROLE_SEPARATORS = [', ', ' and ', '; ', ' then ', ' 그리고 ', ' 하고 ', ' 이고 ', ' 이랑 ', '\n', ' / ', ' • ', ',\n'];
const MIXED_ROLE_VALUES = [
  { en: '220Ω', ko: '220Ω', ohms: 220 },
  { en: '330Ω', ko: '330Ω', ohms: 330 },
  { en: '470Ω', ko: '470Ω', ohms: 470 },
  { en: '680Ω', ko: '680Ω', ohms: 680 },
  { en: '2.2kΩ', ko: '2.2kΩ', ohms: 2200 },
  { en: '4.7kΩ', ko: '4.7kΩ', ohms: 4700 },
  { en: '5.1kΩ', ko: '5.1kΩ', ohms: 5100 },
  { en: '10kΩ', ko: '10kΩ', ohms: 10000 },
  { en: '100Ω', ko: '100Ω', ohms: 100 },
  { en: '1.5kΩ', ko: '1.5kΩ', ohms: 1500 },
  { en: '3.3kΩ', ko: '3.3kΩ', ohms: 3300 },
  { en: '22Ω', ko: '22Ω', ohms: 22 }
];
const MIXED_ROLE_WORDS = [
  { en: 'pull-up', ko: '풀업' },
  { en: 'CC', ko: 'CC' },
  { en: 'I2C', ko: 'I2C' },
  { en: 'SDA', ko: 'SDA' },
  { en: 'SCL', ko: 'SCL' },
  { en: 'USB', ko: 'USB' },
  { en: 'reset', ko: '리셋' },
  { en: 'button', ko: '버튼' },
  { en: 'base', ko: '베이스' },
  { en: 'gate', ko: '게이트' },
  { en: 'sense', ko: '센스' },
  { en: 'shunt', ko: '션트' },
  { en: 'feedback', ko: '피드백' },
  { en: 'divider', ko: '분압' },
  { en: 'debounce', ko: '디바운스' },
  { en: 'termination', ko: '종단' }
];

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function pickItem(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

function shuffleItems(rng, list) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    const held = copy[index];
    copy[index] = copy[swap];
    copy[swap] = held;
  }
  return copy;
}

const PROP_DASHES = ['\u2010', '\u2011', '\u2012', '\u2013', '\u2014', '\u2015', '\u2212', '\uFE58', '\uFE63', '\uFF0D'];
const UNKNOWN_ROLE_WORDS = ['terminator', 'NRST', 'BOOT0', 'transistor', 'opamp', 'ADC', '플업', '풀 업'];

function propertySeed() {
  const raw = process.env.CHATPCB_PROP_SEED;
  if (raw != null && String(raw).trim() !== '' && Number.isFinite(Number(raw))) return Number(raw) >>> 0;
  return randomInt(0, 0x100000000);
}

function mixedRoleClause(role, value, lang) {
  if (lang === 'ko') return `${role.ko} 저항 ${value.ko}으로`;
  return `${role.en} resistor to ${value.en}`;
}

function fullwidthDigits(text) {
  return String(text).replace(/[0-9]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) + 0xFEE0));
}

function mixedLedClause(value, lang) {
  if (lang === 'ko') return `LED 저항 ${value.ko}으로`;
  return `LED resistor to ${value.en}`;
}

function buildMixedRoleCase(rng) {
  const led = pickItem(rng, MIXED_ROLE_VALUES);
  const foreignValue = pickItem(rng, MIXED_ROLE_VALUES.filter((item) => item.ohms !== led.ohms));
  const role = pickItem(rng, MIXED_ROLE_WORDS);
  const unknown = pickItem(rng, UNKNOWN_ROLE_WORDS);
  const lang = rng() < 0.5 ? 'en' : 'ko';
  const dash = pickItem(rng, PROP_DASHES);
  const shape = Math.floor(rng() * 12);
  const foreign = [{ ohms: foreignValue.ohms, label: foreignValue.en }];
  let prompt;
  if (shape === 0) {
    const count = 1 + Math.floor(rng() * 3);
    const values = shuffleItems(rng, MIXED_ROLE_VALUES).slice(0, count);
    const roles = shuffleItems(rng, MIXED_ROLE_WORDS);
    const parts = [];
    if (count === 1) {
      parts.push({ text: mixedRoleClause(roles[0], values[0], lang), ohms: values[0].ohms, label: values[0].en });
    } else {
      parts.push({ text: mixedLedClause(values[0], lang), ohms: null, label: null });
      for (let index = 1; index < count; index += 1) {
        parts.push({
          text: mixedRoleClause(roles[index - 1], values[index], lang),
          ohms: values[index].ohms,
          label: values[index].en
        });
      }
    }
    const ordered = shuffleItems(rng, parts);
    return {
      prompt: ordered.map((part) => part.text).join(pickItem(rng, MIXED_ROLE_SEPARATORS)),
      foreign: ordered.filter((part) => part.ohms != null),
      modelPrompt: `LED resistor to ${ordered.find((part) => part.ohms != null).label}`
    };
  }
  if (shape === 1) {
    const ledText = lang === 'ko' ? `LED 저항 ${led.ko}으로` : `LED resistor to ${led.en}`;
    const roleText = lang === 'ko' ? `${role.ko}용` : `for ${role.en}`;
    prompt = `${ledText}, ${roleText}`;
    foreign[0] = { ohms: led.ohms, label: led.en };
  } else if (shape === 2) {
    prompt = lang === 'ko'
      ? `${foreignValue.ko} ${role.ko}, LED 저항 ${led.ko}으로`
      : `${foreignValue.en} ${role.en}, LED resistor to ${led.en}`;
  } else if (shape === 3) {
    prompt = lang === 'ko'
      ? `전류제한 저항 ${led.ko}으로 (${role.ko}용)`
      : `current limiting resistor to ${led.en} (for ${role.en})`;
    foreign[0] = { ohms: led.ohms, label: led.en };
  } else if (shape === 4) {
    const ledText = lang === 'ko' ? `LED 저항 ${led.ko}` : `LED resistor ${led.en}`;
    prompt = rng() < 0.5 ? `${unknown} ${foreignValue.en}` : `${ledText}, ${unknown} ${foreignValue.en}`;
  } else if (shape === 5) {
    prompt = lang === 'ko'
      ? `LED 저항이랑 ${role.ko}, 둘 다 ${foreignValue.ko}`
      : `LED resistor and ${role.en}, both ${foreignValue.en}`;
  } else if (shape === 6) {
    prompt = lang === 'ko'
      ? `LED 저항과 ${role.ko} 저항을 각각 ${led.ko}, ${foreignValue.ko}로`
      : `LED resistor and ${role.en} to ${led.en} and ${foreignValue.en} respectively`;
  } else if (shape === 7) {
    prompt = lang === 'ko'
      ? `그거 ${led.ko}으로, ${role.ko}는 ${foreignValue.ko}`
      : `set it to ${led.en} and the ${role.en} to ${foreignValue.en}`;
  } else if (shape === 8) {
    const pulled = `pull${dash}up`;
    prompt = `LED resistor to ${led.en}${pickItem(rng, ['\n', ' • ', ' / '])}${pulled} to ${foreignValue.en}`;
    foreign[0] = { ohms: foreignValue.ohms, label: foreignValue.en };
  } else if (shape === 9) {
    prompt = `LED 저항 ${fullwidthDigits(led.en)}\uFF0C풀업 ${fullwidthDigits(foreignValue.en)}`;
  } else if (shape === 10) {
    prompt = lang === 'ko'
      ? `LED 저항 ${led.ko}으로\n• ${role.ko} ${foreignValue.ko}`
      : `LED resistor to ${led.en}\n• ${role.en} ${foreignValue.en}`;
  } else {
    prompt = `LED resistor to ${led.en} / ${unknown} ${foreignValue.en}`;
  }
  return {
    prompt,
    foreign,
    modelPrompt: `LED resistor to ${foreign[0].label}`
  };
}

function assertForeignValueDidNotLand(preview, calls, schematic, spice, before, prompt, seed) {
  const where = `seed ${seed} ${prompt}`;
  const r3 = schematicRefValue(schematic, 'R3');
  const rled = rledOhms(spice);
  const code = preview.error?.code ?? 'none';
  assert.equal(calls, 0, `${where} provider calls ${calls} R3=${r3} RLED=${rled} code=${code}`);
  assert.equal(preview.ok, false, `${where} code=${code}`);
  assert.ok(code === 'RESISTOR_REF_UNSUPPORTED' || code === 'RESISTOR_TARGET_UNCLEAR', `${where} code=${code} ${preview.error?.message ?? ''}`);
  assert.equal(r3, schematicRefValue(before.schematic, 'R3'), `${where} R3`);
  assert.equal(rled, rledOhms(before.spice), `${where} RLED`);
  assert.equal(schematic, before.schematic, where);
  assert.equal(spice, before.spice, where);
}

test('random LED and non-LED role clauses never put a non-LED value on R3', { timeout: 20000 }, async () => {
  const services = await transactionServices();
  const { projectDir, generated } = await generatedStm32Project();
  const before = await materializeSeriesResistor(services, projectDir, generated);
  const seed = propertySeed();
  const rng = mulberry32(seed);
  const started = Date.now();
  console.log(`property seed ${seed}`);
  try {
    for (let index = 0; index < MIXED_ROLE_CASES; index += 1) {
      const sample = buildMixedRoleCase(rng);
      for (const kind of ['native', 'malicious']) {
        const provider = kind === 'native'
          ? nativeNoPatchCounter()
          : maliciousPatchCounter(sample.modelPrompt);
        await writeGeneratedBytes(generated, before);
        const preview = await requestAndMaybeApprove(
          services,
          projectDir,
          sample.prompt,
          provider.impl,
          `call_h1_mixrand_${index}_${kind}`
        );
        const schematic = await readFile(generated.files.schematic, 'utf8');
        const spice = await readFile(generated.files.spice, 'utf8');
        const label = `${kind} #${index} seed ${seed} ${sample.prompt}`;
        assertForeignValueDidNotLand(preview, provider.calls(), schematic, spice, before, label, seed);
        const rled = Number(rledOhms(spice));
        for (const role of sample.foreign) {
          assert.notEqual(rled, role.ohms, `${label} RLED took ${role.ohms}`);
          assert.equal(schematicRefValue(schematic, 'R3'), '1k', `${label} R3`);
        }
      }
    }
    assert.ok(Date.now() - started < 5000, `property seed ${seed} took ${Date.now() - started}ms`);
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

test('current limiting resistor for the pull-up / on SDA refuses with RESISTOR_REF_UNSUPPORTED and never applies R3', async () => {
  const services = await transactionServices();
  const { projectDir, generated } = await generatedStm32Project();
  const before = await materializeSeriesResistor(services, projectDir, generated);
  const trailing = [
    'current limiting resistor for the pull-up to 680Ω',
    'current limiting resistor for the I2C pull-up to 680Ω',
    'current limiting resistor on SDA to 680Ω',
    'current limiting resistor for the CC pin to 680Ω',
    '전류제한 저항 680Ω으로 (리셋 버튼용)'
  ];
  const noLedDir = await mkdtemp(path.join(tmpdir(), 'chatpcb-no-led-'));
  const noLedSpec = {
    sourcePrompt: 'board with pull-ups and no LED',
    mcu: { family: 'STM32' },
    peripherals: [{ kind: 'i2c-sensor-header' }],
    schematic: {
      components: [
        { ref: 'R1', libId: 'Device:R', value: '4.7k', role: 'i2c-scl-pullup' },
        { ref: 'R2', libId: 'Device:R', value: '4.7k', role: 'i2c-sda-pullup' }
      ]
    }
  };
  const noLedSchematic = [
    '(kicad_sch (version 20250114) (generator chatpcb)',
    '  (symbol (lib_id "Device:R") (at 0 0 0)',
    '    (property "Reference" "R1" (at 0 0 0))',
    '    (property "Value" "4.7k" (at 0 0 0)))',
    '  (symbol (lib_id "Device:R") (at 10 0 0)',
    '    (property "Reference" "R2" (at 10 0 0))',
    '    (property "Value" "4.7k" (at 10 0 0))))'
  ].join('\n');
  const noLedPath = path.join(noLedDir, 'board.kicad_sch');
  await writeFile(path.join(noLedDir, 'board.chatpcb.json'), `${JSON.stringify(noLedSpec, null, 2)}\n`);
  await writeFile(noLedPath, noLedSchematic);
  const noLedRows = [
    'current limiting resistor to 680Ω',
    '전류제한 저항 680Ω으로'
  ];
  try {
    let index = 0;
    for (const prompt of trailing) {
      for (const kind of ['native', 'malicious']) {
        index += 1;
        const provider = kind === 'native'
          ? nativeNoPatchCounter()
          : maliciousPatchCounter('current limiting resistor to 680Ω');
        await writeGeneratedBytes(generated, before);
        const preview = await requestAndMaybeApprove(services, projectDir, prompt, provider.impl, `call_m1_trail_${index}`);
        const schematic = await readFile(generated.files.schematic, 'utf8');
        const spice = await readFile(generated.files.spice, 'utf8');
        assertResistorUntouched(preview, provider.calls(), schematic, spice, before, `${kind} ${prompt}`);
      }
    }
    for (const [rowIndex, prompt] of noLedRows.entries()) {
      const provider = nativeNoPatchCounter();
      const preview = await dispatchToolCall({
        id: `call_m1_noled_${rowIndex}`,
        name: 'project.request',
        args: { provider: 'codex', projectDir: noLedDir, prompt }
      }, { ...services, ...provider.impl });
      const schematic = await readFile(noLedPath, 'utf8');
      assert.equal(provider.calls(), 0, `${prompt} provider calls ${provider.calls()} code=${preview.error?.code ?? preview.result?.applied}`);
      assert.equal(preview.ok, false, `${prompt} ${preview.error?.code ?? ''} ${preview.error?.message ?? ''}`);
      assert.equal(preview.error?.code, 'RESISTOR_TARGET_UNCLEAR', `${prompt} ${preview.error?.code ?? ''}`);
      assert.equal(preview.result?.patchId, undefined, prompt);
      assert.equal(schematic, noLedSchematic, prompt);
      assert.equal(schematicRefValue(schematic, 'R1'), '4.7k', prompt);
      assert.equal(schematicRefValue(schematic, 'R2'), '4.7k', prompt);
      assert.equal(schematicRefValue(schematic, 'R3'), null, prompt);
    }
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    await rm(noLedDir, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

const GEN_NOLED_PROMPT = 'STM32 board with USB-C, 3.3V regulator, I2C sensor connector, UART header, SWD header, reset button';

function resistorRefs(schematic) {
  return Object.keys(referenceValues(schematic)).filter((ref) => /^R\d+$/i.test(ref)).sort();
}

// The test name still says "reaches the provider". The board has a status LED
// symbol and no LED series resistor, so the edit is RESISTOR_TARGET_UNCLEAR
// and the provider is not called. Approval cannot add a resistor.
test('current limiting resistor on a generated board without a status LED reaches the provider and adds no resistor', async () => {
  const services = await transactionServices();
  const projectDir = await mkdtemp(path.join(tmpdir(), 'chatpcb-gen-noled-'));
  const generated = await generateMcuPeripheralProject({
    projectDir,
    prompt: GEN_NOLED_PROMPT,
    projectName: 'stm32_no_led'
  });
  const beforeSpec = JSON.parse(await readFile(generated.files.spec, 'utf8'));
  const beforeSchematic = await readFile(generated.files.schematic, 'utf8');
  const beforeSpice = await readFile(generated.files.spice, 'utf8');
  const beforeRefs = resistorRefs(beforeSchematic);
  assert.equal(beforeSpec.peripherals.some((item) => item.kind === 'status-led' || item.kind === 'status-led-resistor'), false);
  assert.match(beforeSchematic, /ChatPCB:STATUS_LED/);
  assert.match(beforeSpice, /^RREG\s/m);
  assert.match(beforeSpice, /^RBUTTON\s/m);
  assert.doesNotMatch(beforeSpice, /^RLED\b/m);
  const prompts = [
    '전류제한 저항 680Ω으로',
    'current limiting resistor to 680Ω',
    'LED resistor to 680Ω',
    '저항 680Ω으로 바꿔줘'
  ];
  try {
    let index = 0;
    for (const prompt of prompts) {
      for (const kind of ['native', 'malicious']) {
        index += 1;
        const provider = kind === 'native'
          ? nativeNoPatchCounter()
          : maliciousPatchCounter('current limiting resistor to 680Ω');
        await writeFile(generated.files.schematic, beforeSchematic);
        await writeFile(generated.files.spice, beforeSpice);
        await writeFile(generated.files.spec, `${JSON.stringify(beforeSpec, null, 2)}\n`);
        const preview = await requestAndMaybeApprove(services, projectDir, prompt, provider.impl, `call_gen_noled_${index}`);
        const schematic = await readFile(generated.files.schematic, 'utf8');
        const spice = await readFile(generated.files.spice, 'utf8');
        const where = `${kind} ${prompt}`;
        assert.equal(provider.calls(), 0, `${where} calls ${provider.calls()} code=${preview.error?.code ?? preview.result?.applied}`);
        assert.equal(preview.ok, false, `${where} ${preview.error?.message ?? ''}`);
        assert.equal(preview.error?.code, 'RESISTOR_TARGET_UNCLEAR', `${where} ${preview.error?.code ?? ''}`);
        assert.equal(preview.result?.patchId, undefined, where);
        assert.deepEqual(resistorRefs(schematic), beforeRefs, where);
        assert.equal(schematic, beforeSchematic, where);
        assert.equal(spice, beforeSpice, where);
      }
    }
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

// A question is an edit only with a request or permission ending. Other question
// forms reach the provider: no RESISTOR_* code and no R3 patch.
const QUESTION_PROVIDER_ROWS = [
  { lang: 'en', prompt: 'should I change the LED resistor to 680Ω?' },
  { lang: 'en', prompt: 'why not change the LED resistor to 680Ω?' },
  { lang: 'en', prompt: 'how do I change the LED resistor to 680Ω?' },
  { lang: 'en', prompt: 'what happens if I change the LED resistor to 680Ω?' },
  { lang: 'en', prompt: 'which resistor should I change to 680Ω?' },
  { lang: 'ko', prompt: '왜 LED 저항을 680Ω으로 바꿔야 해?' },
  { lang: 'ko', prompt: 'LED 저항 680Ω으로 바꿔야 할까?' },
  { lang: 'en', prompt: 'LED resistor to 2.2k ok?' },
  { lang: 'en', prompt: 'LED resistor to 2.2k okay?' },
  { lang: 'ko', prompt: 'LED 저항 680Ω으로 바꾸면 어떻게 돼?' }
];

async function assertQuestionLeavesR3(services, projectDir, generated, before, row, id) {
  const provider = nativeNoPatchCounter();
  await writeGeneratedBytes(generated, before);
  const preview = await requestAndMaybeApprove(services, projectDir, row.prompt, provider.impl, id);
  const schematic = await readFile(generated.files.schematic, 'utf8');
  const spice = await readFile(generated.files.spice, 'utf8');
  const code = preview.error?.code ?? '';
  assert.equal(provider.calls(), 1, `${row.lang} ${row.prompt} calls=${provider.calls()} code=${code || preview.result?.applied}`);
  assert.equal(preview.ok, false, `${row.prompt} ${code} ${preview.error?.message ?? ''}`);
  assert.equal(code, 'PROVIDER_NO_PATCH', `${row.lang} ${row.prompt} ${code}`);
  assert.equal(code.startsWith('RESISTOR_'), false, `${row.prompt} ${code}`);
  assert.equal(schematicRefValue(schematic, 'R3'), '1k', row.prompt);
  assert.equal(schematic, before.schematic, row.prompt);
  assert.equal(spice, before.spice, row.prompt);
}

test('should/why not/how do I/what happens if questions with an edit verb reach the provider and do not report RESISTOR_REF_UNSUPPORTED', async () => {
  const rows = QUESTION_PROVIDER_ROWS.filter((row) => (
    row.prompt !== 'LED 저항 680Ω으로 바꿔야 할까?'
    && row.prompt !== 'LED resistor to 2.2k ok?'
    && row.prompt !== 'LED resistor to 2.2k okay?'
    && row.prompt !== 'LED 저항 680Ω으로 바꾸면 어떻게 돼?'
  ));
  assert.ok(rows.some((row) => row.lang === 'ko'));
  assert.ok(rows.some((row) => row.lang === 'en'));
  const services = await transactionServices();
  const { projectDir, generated } = await generatedStm32Project();
  const before = await materializeSeriesResistor(services, projectDir, generated);
  try {
    for (const [index, row] of rows.entries()) {
      await assertQuestionLeavesR3(services, projectDir, generated, before, row, `call_q_real_${index}`);
    }
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});

test("'바꿔야 할까?' and '<value> ok?' are questions and do not create an R3 patch", async () => {
  const rows = QUESTION_PROVIDER_ROWS.filter((row) => (
    row.prompt === 'LED 저항 680Ω으로 바꿔야 할까?'
    || row.prompt === 'LED resistor to 2.2k ok?'
    || row.prompt === 'LED resistor to 2.2k okay?'
    || row.prompt === 'LED 저항 680Ω으로 바꾸면 어떻게 돼?'
  ));
  assert.ok(rows.some((row) => row.lang === 'ko'));
  assert.ok(rows.some((row) => row.lang === 'en'));
  const services = await transactionServices();
  const { projectDir, generated } = await generatedStm32Project();
  const before = await materializeSeriesResistor(services, projectDir, generated);
  try {
    for (const [index, row] of rows.entries()) {
      await assertQuestionLeavesR3(services, projectDir, generated, before, row, `call_q_form_${index}`);
    }
  } finally {
    services.patchApprovalRegistry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    await rm(services.stateRoot, { force: true, recursive: true });
  }
});
