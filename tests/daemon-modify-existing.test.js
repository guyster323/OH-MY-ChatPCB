import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
import { removalIntentUnclearMessage } from '../src/workflow/existing-project-edit.js';
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

test('English resistor edit applies 680 ohm on a board that already has the resistor', async () => {
  const services = await transactionServices();
  try {
    await withBoardResistor(330, async ({ projectDir, generated }) => {
      const before = await readFile(generated.files.schematic, 'utf8');
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
        ...codexPatchRewrite('Change the status LED resistor R3 from 330Ω to 680Ω. Do not delete the I2C.')
      });
      assert.equal(preview.ok, true, preview.error?.message);
      assert.equal(preview.error?.code, undefined);
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
      assert.equal(schematic.includes('330Ω'), false);
      assert.notEqual(schematic, before);
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
