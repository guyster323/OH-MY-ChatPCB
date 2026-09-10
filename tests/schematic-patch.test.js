import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { generateMcuPeripheralProject } from '../src/workflow/generate-mcu-project.js';
import { collectTransactionInventory } from '../src/evidence/transaction-inventory.js';
import { createNativeProposal, disposeNativeProposal } from '../src/workflow/native-proposal-source.js';
import { applySchematicPatch, createSchematicPatchPlan, disposeSchematicPatchPlan } from '../src/workflow/schematic-patch.js';

const passingVerify = async () => ({
  erc: { ok: true, skipped: false, executed: true, erc: { errorCount: 0, warningCount: 0 } },
  drc: { ok: true, skipped: true }
});

async function applyApprovedPatch(options) {
  const plan = await createSchematicPatchPlan(options);
  try {
    return await applySchematicPatch({
      ...options,
      approved: true,
      expectedPatchId: plan.patchId,
      patchPlan: plan,
      verifyAppliedProjectImpl: options.verifyAppliedProjectImpl ?? passingVerify
    });
  } finally {
    await disposeSchematicPatchPlan(plan);
  }
}

test('schematic patch preview returns a diff without modifying existing project files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-patch-preview-'));

  try {
    const initial = await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power, I2C connector, reset button, and LED.'
    });
    const before = await readFile(initial.files.spec, 'utf8');

    const preview = await applySchematicPatch({
      projectDir: root,
      prompt: 'STM32 board with USB-C power, 3.3V regulator, I2C connector, UART header, reset button, boot button, and LED.',
      approved: false,
      validateProjectImpl: async () => ({ ok: true, skipped: false, erc: { errorCount: 0, warningCount: 0, byType: {} } })
    });

    assert.equal(preview.requiresApproval, true);
    assert.equal(preview.applied, false);
    assert.ok(preview.diff.includes('--- chatpcb_mcu_peripheral.chatpcb.json'));
    assert.ok(preview.diff.includes('+++ chatpcb_mcu_peripheral.chatpcb.json'));
    assert.ok(preview.changedFiles.includes('chatpcb_mcu_peripheral.chatpcb.json'));
    assert.equal(typeof preview.why, 'string');
    assert.ok(preview.why.length > 0);
    assert.equal(await readFile(initial.files.spec, 'utf8'), before);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('approved schematic patch writes generated files and returns validation result', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-patch-approve-'));

  try {
    await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power, I2C connector, reset button, and LED.'
    });

    const result = await applyApprovedPatch({
      projectDir: root,
      prompt: 'STM32 board with USB-C power, 3.3V regulator, I2C connector, UART header, reset button, boot button, and LED.',
      validateProjectImpl: async () => ({ ok: true, skipped: false, erc: { errorCount: 0, warningCount: 0, byType: {} } })
    });

    const metadata = JSON.parse(await readFile(result.files.spec, 'utf8'));
    assert.equal(result.applied, true);
    assert.equal(result.validation.ok, true);
    assert.equal(metadata.mcu.family, 'STM32');
    assert.ok(metadata.interfaces.some((iface) => iface.kind === 'uart'));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('approved schematic patch requires an expected patch ID before building or writing a plan', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-patch-required-'));

  try {
    const initial = await generateMcuPeripheralProject({ projectDir: root, prompt: 'RP2040 board with USB-C power and I2C connector.' });
    const before = await readFile(initial.files.spec, 'utf8');
    const result = await applySchematicPatch({ projectDir: root, prompt: 'STM32 board with USB-C power and UART header.', approved: true });
    assert.equal(result.applied, false);
    assert.equal(result.reason.code, 'PATCH_APPROVAL_REQUIRED');
    assert.equal(await readFile(initial.files.spec, 'utf8'), before);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('approved schematic patch rejects a preview after project artifacts change', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-patch-stale-'));

  try {
    const initial = await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power, I2C connector, reset button, and LED.'
    });
    const prompt = 'STM32 board with USB-C power, 3.3V regulator, I2C connector, UART header, reset button, boot button, and LED.';
    const plan = await createSchematicPatchPlan({
      projectDir: root,
      prompt,
      validateProjectImpl: async () => ({ ok: true, skipped: false, erc: { errorCount: 0, warningCount: 0, byType: {} } })
    });
    await appendFile(initial.files.schematic, '\n(user edit)\n');

    const result = await applySchematicPatch({
      projectDir: root,
      prompt,
      approved: true,
      expectedPatchId: plan.patchId,
      patchPlan: plan,
      validateProjectImpl: async () => ({ ok: true }),
      verifyAppliedProjectImpl: passingVerify
    });

    assert.equal(result.applied, false);
    assert.equal(result.reason.code, 'PATCH_STALE');
    assert.match(await readFile(initial.files.schematic, 'utf8'), /user edit/);
    await disposeSchematicPatchPlan(plan);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('approved schematic patch becomes stale when an unchanged tracked artifact is added or edited', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-patch-whole-project-stale-'));

  try {
    await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power, I2C connector, reset button, and LED.'
    });
    const prompt = 'STM32 board with USB-C power, 3.3V regulator, I2C connector, UART header, reset button, boot button, and LED.';
    const plan = await createSchematicPatchPlan({
      projectDir: root,
      prompt,
      validateProjectImpl: async () => ({ ok: true, skipped: false, erc: { errorCount: 0, warningCount: 0, byType: {} } })
    });
    const unrelatedSchematic = path.join(root, 'user-sheet.kicad_sch');
    await appendFile(unrelatedSchematic, '(user-authored-sheet)\n');

    const result = await applySchematicPatch({
      projectDir: root,
      prompt,
      approved: true,
      expectedPatchId: plan.patchId,
      patchPlan: plan,
      verifyAppliedProjectImpl: passingVerify
    });

    assert.equal(result.applied, false);
    assert.equal(result.reason.code, 'PATCH_STALE');
    assert.match(await readFile(unrelatedSchematic, 'utf8'), /user-authored-sheet/);
    await disposeSchematicPatchPlan(plan);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('approved schematic patch writes the KiCad-normalized candidate bytes it previewed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-patch-normalized-candidate-'));

  try {
    await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power, I2C connector, reset button, and LED.'
    });
    const prompt = 'STM32 board with USB-C power, 3.3V regulator, I2C connector, UART header, reset button, boot button, and LED.';
    const validateCandidate = async ({ projectDir }) => {
      await appendFile(path.join(projectDir, 'chatpcb_mcu_peripheral.kicad_sch'), '\n(kicad-cli-normalized)\n');
      return { ok: true, skipped: false, erc: { errorCount: 0, warningCount: 0, byType: {} } };
    };
    const plan = await createSchematicPatchPlan({ projectDir: root, prompt, validateProjectImpl: validateCandidate });
    const preview = await applySchematicPatch({ projectDir: root, approved: false, patchPlan: plan });

    assert.ok(preview.afterArtifacts.some((artifact) => artifact.path === 'chatpcb_mcu_peripheral.kicad_sch'));
    const result = await applySchematicPatch({
      projectDir: root,
      approved: true,
      expectedPatchId: plan.patchId,
      patchPlan: plan,
      validateProjectImpl: async () => {
        throw new Error('the authoritative project must not be revalidated after candidate approval');
      },
      verifyAppliedProjectImpl: passingVerify
    });

    assert.equal(result.applied, true);
    assert.match(await readFile(path.join(root, 'chatpcb_mcu_peripheral.kicad_sch'), 'utf8'), /kicad-cli-normalized/);
    const saved = await collectTransactionInventory({ projectDir: root });
    const finalSchematic = await readFile(path.join(root, 'chatpcb_mcu_peripheral.kicad_sch'), 'utf8');
    assert.equal(
      preview.afterArtifacts.find((artifact) => artifact.path === 'chatpcb_mcu_peripheral.kicad_sch')?.hash,
      `sha256:${createHash('sha256').update(finalSchematic).digest('hex')}`
    );
    assert.equal(saved.transactionDigest, preview.afterProjectDigest);
    await disposeSchematicPatchPlan(plan);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('canceled schematic patch leaves the project unchanged without building a diff', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-patch-cancel-'));

  try {
    const initial = await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power, I2C connector, reset button, and LED.'
    });
    const before = await readFile(initial.files.spec, 'utf8');

    const result = await applySchematicPatch({
      projectDir: root,
      cancel: true
    });

    assert.equal(result.canceled, true);
    assert.equal(result.applied, false);
    assert.equal(result.diff, '');
    assert.deepEqual(result.changedFiles, []);
    assert.equal(await readFile(initial.files.spec, 'utf8'), before);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('failed candidate verification disables approval without writing live files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-patch-candidate-unverified-'));

  try {
    const initial = await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power, I2C connector, reset button, and LED.'
    });
    const before = await readFile(initial.files.spec, 'utf8');

    const result = await applyApprovedPatch({
      projectDir: root,
      prompt: 'STM32 board with USB-C power, 3.3V regulator, I2C connector, UART header, reset button, boot button, and LED.',
      validateProjectImpl: async () => ({ ok: false, skipped: false, erc: { errorCount: 1, warningCount: 0, byType: { test: 1 } } })
    });

    assert.equal(result.applied, false);
    assert.equal(result.rolledBack, false);
    assert.equal(result.reason.code, 'PATCH_CANDIDATE_UNVERIFIED');
    assert.equal(result.validation.ok, false);
    assert.equal(await readFile(initial.files.spec, 'utf8'), before);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('transaction verification failure restores live files after a write', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-patch-txn-restore-'));

  try {
    const initial = await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power, I2C connector, reset button, and LED.'
    });
    const before = await readFile(initial.files.spec, 'utf8');

    const result = await applyApprovedPatch({
      projectDir: root,
      prompt: 'STM32 board with USB-C power, 3.3V regulator, I2C connector, UART header, reset button, boot button, and LED.',
      validateProjectImpl: async () => ({ ok: true, skipped: false, erc: { errorCount: 0, warningCount: 0, byType: {} } }),
      verifyAppliedProjectImpl: async () => ({
        erc: { ok: false, skipped: false, executed: true, erc: { errorCount: 1, warningCount: 0 } },
        drc: { ok: true, skipped: true }
      })
    });

    assert.equal(result.applied, false);
    assert.equal(result.rolledBack, true);
    assert.equal(result.reason.code, 'VERIFICATION_FAILED');
    assert.equal(await readFile(initial.files.spec, 'utf8'), before);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('approved schematic patch returns readiness review after validation reruns', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-patch-review-'));

  try {
    await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power, I2C connector, reset button, and LED.'
    });

    const result = await applyApprovedPatch({
      projectDir: root,
      prompt:
        'USB-C powered ESP32-S3 sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, reset button, status LED, USB, SPI, GPIO header, JLCPCB order ready.',
      validateProjectImpl: async () => ({
        ok: true,
        skipped: false,
        erc: { errorCount: 0, warningCount: 2, byType: { footprint_link_issues: 2 } }
      })
    });

    assert.equal(result.applied, true);
    assert.equal(result.review.status, 'blocked');
    assert.ok(result.review.findings.blockers.some((finding) => /footprint/i.test(finding.message)));
    assert.ok(result.review.findings.blockers.some((finding) => /JLCPCB/i.test(finding.message)));
    assert.ok(result.review.residualRisks.some((risk) => /not release-ready/i.test(risk)));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('last schematic delete stays fail-closed as VERIFICATION_UNAVAILABLE', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-patch-last-sch-delete-'));

  try {
    const initial = await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power, I2C connector, reset button, and LED.'
    });
    const before = await readFile(initial.files.schematic, 'utf8');
    const plan = await createNativeProposal({
      projectDir: root,
      request: { prompt: 'STM32 board with USB-C power, 3.3V regulator, I2C connector, UART header, reset button, boot button, and LED.' },
      validateCandidateImpl: async () => ({ ok: true, skipped: false, erc: { errorCount: 0, warningCount: 0, byType: {} } }),
      generateProjectImpl: async (options) => {
        const generated = await generateMcuPeripheralProject(options);
        await rm(generated.files.schematic, { force: true });
        delete generated.files.schematic;
        return generated;
      }
    });

    try {
      const result = await applySchematicPatch({
        projectDir: root,
        approved: true,
        expectedPatchId: plan.patchId,
        patchPlan: plan
      });

      assert.equal(result.applied, false);
      assert.equal(result.rolledBack, true);
      assert.equal(result.reason.code, 'VERIFICATION_UNAVAILABLE');
      assert.equal(await readFile(initial.files.schematic, 'utf8'), before);
    } finally {
      await disposeNativeProposal(plan);
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
