import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { dispatchToolCall } from '../src/runtime/agent-daemon.js';
import { ercApprovalDecision, normalizeRecordedErc } from '../src/runtime/erc-gate.js';
import { createPatchApprovalRegistry } from '../src/runtime/patch-approval-registry.js';
import { generateMcuPeripheralProject } from '../src/workflow/generate-mcu-project.js';

const passingVerify = async () => ({
  erc: { ok: true, skipped: false, executed: true, erc: { errorCount: 0, warningCount: 0 } },
  drc: { ok: true, skipped: true }
});
const passingDrc = async () => ({ ok: true, skipped: false, executed: true, violations: [], unconnectedItems: [] });
const passingErc = async () => ({ ok: true, skipped: false, erc: { errorCount: 0, warningCount: 0, byType: {} } });
const skippedErc = async () => ({
  ok: true,
  skipped: true,
  reason: { code: 'KICAD_CLI_UNAVAILABLE', message: 'KiCad CLI was not available.' }
});
const skippedWithErrors = async () => ({
  ok: true,
  skipped: true,
  erc: { errorCount: 2, warningCount: 0, byType: { test: 2 } }
});
const failedErc = async () => ({ ok: false, skipped: false, erc: { errorCount: 1, warningCount: 0, byType: { test: 1 } } });

function services(registry, validateProjectImpl) {
  return {
    patchApprovalRegistry: registry,
    validateProjectImpl,
    validateBoardImpl: passingDrc,
    verifyAppliedProjectImpl: passingVerify
  };
}

test('recorded ERC normalizes to passed, failed, skipped, or missing', () => {
  assert.deepEqual(
    normalizeRecordedErc({ ok: true, skipped: false, status: 'passed', erc: { errorCount: 0, warningCount: 0 } }),
    { passed: true, skipped: false, failed: false, missing: false, errorCount: 0 }
  );
  assert.equal(normalizeRecordedErc({ ok: true, skipped: false, erc: { errorCount: 0 } }).passed, true);
  assert.deepEqual(normalizeRecordedErc({ ok: false, skipped: false, status: 'failed', erc: { errorCount: 1 } }).failed, true);
  assert.equal(normalizeRecordedErc({ ok: true, skipped: true, reason: { code: 'KICAD_CLI_UNAVAILABLE' } }).skipped, true);
  assert.equal(normalizeRecordedErc({ ok: true, skipped: true, executed: false }).skipped, true);
  assert.equal(normalizeRecordedErc({ ok: true, skipped: true, erc: { errorCount: 2 } }).failed, true);
  assert.equal(normalizeRecordedErc({}).missing, true);
  assert.equal(normalizeRecordedErc(null).missing, true);
  assert.equal(ercApprovalDecision(normalizeRecordedErc({ ok: true, status: 'passed', skipped: false, erc: { errorCount: 0 } }), 'skipped').allow, true);
  const skipped = normalizeRecordedErc({ ok: true, skipped: true });
  assert.equal(ercApprovalDecision(skipped, undefined).allow, false);
  assert.equal(ercApprovalDecision(skipped, 'skip').allow, false);
  assert.equal(ercApprovalDecision(skipped, 'skipped').allowSkippedErc, true);
  const failed = normalizeRecordedErc({ ok: false, erc: { errorCount: 1 } });
  assert.equal(ercApprovalDecision(failed, 'skipped').allow, false);
  assert.equal(ercApprovalDecision(normalizeRecordedErc(null), 'skipped').allow, false);
});

test('daemon schematic.patch approval is fail-closed on the recorded ERC result', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-erc-gate-'));
  const registry = createPatchApprovalRegistry();
  const prompt = 'STM32 board with USB-C power, 3.3V regulator, I2C connector, UART header, reset button, boot button, and LED.';

  try {
    const generated = await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power and I2C connector.'
    });
    const specPath = generated.files.spec;

    const passedPreview = await dispatchToolCall(
      { name: 'schematic.patch', args: { projectDir: root, prompt } },
      services(registry, passingErc)
    );
    assert.equal(passedPreview.result.candidateVerification.erc.status, 'passed');
    const passed = await dispatchToolCall(
      { name: 'schematic.patch', args: { projectDir: root, approved: true, patchId: passedPreview.result.patchId, passed: false } },
      services(registry, passingErc)
    );
    assert.equal(passed.ok, true);
    assert.equal(passed.result.applied, true);

    const skippedPreview = await dispatchToolCall(
      { name: 'schematic.patch', args: { projectDir: root, prompt: `${prompt} with a power LED.` } },
      services(registry, skippedErc)
    );
    assert.equal(skippedPreview.result.candidateVerification.erc.skipped, true);
    const beforeSkipped = await readFile(specPath, 'utf8');
    const skippedBlocked = await dispatchToolCall(
      { name: 'schematic.patch', args: { projectDir: root, approved: true, patchId: skippedPreview.result.patchId } },
      services(registry, skippedErc)
    );
    assert.equal(skippedBlocked.ok, false);
    assert.equal(skippedBlocked.error.code, 'ERC_BLOCKED');
    assert.match(skippedBlocked.error.message, /ERC_BLOCKED/);
    assert.equal(await readFile(specPath, 'utf8'), beforeSkipped);
    const wrongOverride = await dispatchToolCall(
      { name: 'schematic.patch', args: { projectDir: root, approved: true, patchId: skippedPreview.result.patchId, ercOverride: 'skip', passed: true } },
      services(registry, skippedErc)
    );
    assert.equal(wrongOverride.error.code, 'ERC_BLOCKED');
    const skippedApplied = await dispatchToolCall(
      { name: 'schematic.patch', args: { projectDir: root, approved: true, patchId: skippedPreview.result.patchId, ercOverride: 'skipped' } },
      services(registry, skippedErc)
    );
    assert.equal(skippedApplied.ok, true, JSON.stringify(skippedApplied));
    assert.equal(skippedApplied.result.applied, true);

    const failedPreview = await dispatchToolCall(
      { name: 'schematic.patch', args: { projectDir: root, prompt: `${prompt} with a UART status LED.` } },
      services(registry, failedErc)
    );
    const beforeFailed = await readFile(specPath, 'utf8');
    const failed = await dispatchToolCall(
      {
        name: 'schematic.patch',
        args: {
          projectDir: root,
          approved: true,
          patchId: failedPreview.result.patchId,
          ercOverride: 'skipped',
          passed: true,
          validation: { ok: true, skipped: false, status: 'passed', erc: { errorCount: 0 } },
          ercResult: { passed: true }
        }
      },
      services(registry, failedErc)
    );
    assert.equal(failed.ok, false);
    assert.equal(failed.error.code, 'ERC_BLOCKED');
    assert.match(failed.error.message, /ERC_BLOCKED/);
    assert.equal(await readFile(specPath, 'utf8'), beforeFailed);

    const dirtySkipPreview = await dispatchToolCall(
      { name: 'schematic.patch', args: { projectDir: root, prompt: `${prompt} with a boot LED.` } },
      services(registry, skippedWithErrors)
    );
    const beforeDirty = await readFile(specPath, 'utf8');
    const dirtySkip = await dispatchToolCall(
      { name: 'schematic.patch', args: { projectDir: root, approved: true, patchId: dirtySkipPreview.result.patchId, ercOverride: 'skipped' } },
      services(registry, skippedWithErrors)
    );
    assert.equal(dirtySkip.ok, false);
    assert.equal(dirtySkip.error.code, 'ERC_BLOCKED');
    assert.equal(await readFile(specPath, 'utf8'), beforeDirty);

    registry.register({
      patchId: 'patch-missing-erc',
      projectDir: root,
      plan: { proposalId: 'patch-missing-erc', changes: [] }
    });
    const missing = await dispatchToolCall(
      {
        name: 'schematic.patch',
        args: {
          projectDir: root,
          approved: true,
          patchId: 'patch-missing-erc',
          ercOverride: 'skipped',
          passed: true,
          validation: { ok: true, status: 'passed', skipped: false }
        }
      },
      services(registry, passingErc)
    );
    assert.equal(missing.ok, false);
    assert.equal(missing.error.code, 'ERC_BLOCKED');
    assert.match(missing.error.message, /no ERC result/i);
  } finally {
    registry.disposeAll();
    await rm(root, { force: true, recursive: true });
  }
});

test('null and unproven verifier results are not passed and stay ERC_BLOCKED', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-erc-unproven-'));
  const registry = createPatchApprovalRegistry();
  const base = 'STM32 board with USB-C power, 3.3V regulator, I2C connector, UART header, reset button, boot button, and LED.';
  const nullErc = async () => null;
  const undefinedErc = async () => undefined;
  const okOnly = async () => ({ ok: true });
  const proven = async () => ({ ok: true, errorCount: 0 });
  const errors = async () => ({ ok: true, errorCount: 2 });

  async function preview(prompt, validateProjectImpl) {
    return dispatchToolCall(
      { name: 'schematic.patch', args: { projectDir: root, prompt } },
      services(registry, validateProjectImpl)
    );
  }

  async function approve(patchId, validateProjectImpl, extra = {}) {
    return dispatchToolCall(
      {
        name: 'schematic.patch',
        args: {
          projectDir: root,
          approved: true,
          patchId,
          passed: true,
          validation: { ok: true, status: 'passed', skipped: false, erc: { errorCount: 0 } },
          ...extra
        }
      },
      services(registry, validateProjectImpl)
    );
  }

  try {
    const generated = await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power and I2C connector.'
    });
    const specPath = generated.files.spec;
    const before = await readFile(specPath, 'utf8');

    const nullPreview = await preview(`${base} null verifier.`, nullErc);
    assert.equal(nullPreview.ok, true, JSON.stringify(nullPreview));
    assert.equal(nullPreview.result.candidateVerification.erc.status, 'missing');
    assert.notEqual(nullPreview.result.candidateVerification.erc.skipped, true);
    const nullApproved = await approve(nullPreview.result.patchId, nullErc, { ercOverride: 'skipped' });
    assert.equal(nullApproved.ok, false);
    assert.equal(nullApproved.error.code, 'ERC_BLOCKED');
    assert.match(nullApproved.error.message, /no ERC result/i);
    assert.equal(await readFile(specPath, 'utf8'), before);

    const undefinedPreview = await preview(`${base} undefined verifier.`, undefinedErc);
    assert.equal(undefinedPreview.result.candidateVerification.erc.status, 'missing');
    assert.notEqual(undefinedPreview.result.candidateVerification.erc.skipped, true);
    const undefinedApproved = await approve(undefinedPreview.result.patchId, undefinedErc, { ercOverride: 'skipped' });
    assert.equal(undefinedApproved.ok, false);
    assert.equal(undefinedApproved.error.code, 'ERC_BLOCKED');
    assert.match(undefinedApproved.error.message, /no ERC result/i);

    const okPreview = await preview(`${base} ok without a count.`, okOnly);
    assert.notEqual(okPreview.result.candidateVerification.erc.status, 'passed');
    const okApproved = await approve(okPreview.result.patchId, okOnly, { ercOverride: 'skipped' });
    assert.equal(okApproved.ok, false);
    assert.equal(okApproved.error.code, 'ERC_BLOCKED');
    assert.equal(await readFile(specPath, 'utf8'), before);

    const errorPreview = await preview(`${base} with a power LED.`, errors);
    assert.equal(errorPreview.result.candidateVerification.erc.status, 'failed');
    const errorApproved = await approve(errorPreview.result.patchId, errors, { ercOverride: 'skipped' });
    assert.equal(errorApproved.ok, false);
    assert.equal(errorApproved.error.code, 'ERC_BLOCKED');
    assert.equal(await readFile(specPath, 'utf8'), before);

    const skippedPreview = await preview(`${base} with a status LED.`, skippedErc);
    assert.equal(skippedPreview.result.candidateVerification.erc.skipped, true);
    assert.notEqual(skippedPreview.result.candidateVerification.erc.status, 'passed');
    const skippedBlocked = await approve(skippedPreview.result.patchId, skippedErc);
    assert.equal(skippedBlocked.ok, false);
    assert.equal(skippedBlocked.error.code, 'ERC_BLOCKED');
    const skippedApplied = await approve(skippedPreview.result.patchId, skippedErc, { ercOverride: 'skipped' });
    assert.equal(skippedApplied.ok, true, JSON.stringify(skippedApplied));
    assert.equal(skippedApplied.result.applied, true);

    const provenPreview = await preview(`${base} with a boot LED.`, proven);
    assert.equal(provenPreview.result.candidateVerification.erc.status, 'passed');
    const provenApplied = await approve(provenPreview.result.patchId, proven);
    assert.equal(provenApplied.ok, true, JSON.stringify(provenApplied));
    assert.equal(provenApplied.result.applied, true);
  } finally {
    registry.disposeAll();
    await rm(root, { force: true, recursive: true });
  }
});
