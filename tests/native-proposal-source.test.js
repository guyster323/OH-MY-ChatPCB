import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collectTransactionInventory } from '../src/evidence/transaction-inventory.js';
import { generateMcuPeripheralProject } from '../src/workflow/generate-mcu-project.js';
import { createNativeProposal, disposeNativeProposal, publicProposal } from '../src/workflow/native-proposal-source.js';

const RP2040_PROMPT = 'RP2040 board with USB-C power, I2C connector, reset button, and LED.';
const STM32_PROMPT = 'STM32 board with USB-C power, 3.3V regulator, I2C connector, UART header, reset button, boot button, and LED.';
const BOARD_PROMPT = 'Release profile ESP32-S3 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED.';
const DIFF_LIMIT = 5 * 1024 * 1024;

const passingCandidate = async () => ({
  erc: { ok: true, skipped: false, executed: true, erc: { errorCount: 0, warningCount: 0 } },
  drc: { ok: true, skipped: true }
});

const passingBoardCandidate = async () => ({
  erc: { ok: true, skipped: false, executed: true, erc: { errorCount: 0, warningCount: 0 } },
  drc: { ok: true, skipped: false, executed: true, drc: { violationCount: 0, unconnectedCount: 0 } }
});

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function snapshotTree(root) {
  const files = {};
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => (left.name < right.name ? -1 : 1));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) {
        files[path.relative(root, absolute).split(path.sep).join('/')] = await readFile(absolute);
      }
    }
  }
  await walk(root);
  return files;
}

async function createProject(prompt = RP2040_PROMPT) {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-native-proposal-'));
  await generateMcuPeripheralProject({ projectDir: root, prompt });
  return root;
}

test('structured native proposal preview is public, redacted, and leaves the live tree unchanged', async () => {
  const root = await createProject();
  try {
    const beforeTree = await snapshotTree(root);
    const plan = await createNativeProposal({
      projectDir: root,
      request: { prompt: STM32_PROMPT },
      validateCandidateImpl: passingCandidate
    });
    try {
      const afterTree = await snapshotTree(root);
      assert.deepEqual(afterTree, beforeTree);

      const preview = publicProposal(plan);
      assert.equal(typeof preview.why, 'string');
      assert.ok(preview.why.length > 0);
      assert.equal(preview.what, 'Regenerate the supported ChatPCB project artifact set from the requested circuit specification.');
      assert.ok(Array.isArray(preview.files) && preview.files.length > 0);
      assert.ok(Array.isArray(preview.components) && preview.components.length > 0);
      assert.ok(Array.isArray(preview.nets) && preview.nets.length > 0);
      assert.ok(Array.isArray(preview.risks) && preview.risks.length > 0);
      assert.ok(preview.verificationPlan && typeof preview.verificationPlan === 'object');
      assert.ok(preview.candidateVerification && typeof preview.candidateVerification === 'object');
      assert.ok(Array.isArray(preview.artifactChanges) && preview.artifactChanges.length > 0);
      for (const change of preview.artifactChanges) {
        assert.ok(typeof change.unifiedDiff === 'string' && change.unifiedDiff.length > 0);
        assert.match(change.unifiedDiff, new RegExp(`--- ${change.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
        assert.equal(Object.hasOwn(change, 'beforeBytes'), false);
        assert.equal(Object.hasOwn(change, 'afterBytes'), false);
      }

      const json = JSON.stringify(preview);
      assert.doesNotMatch(json, /beforeBytes/);
      assert.doesNotMatch(json, /afterBytes/);
      assert.doesNotMatch(json, /candidateRoot/);
      assert.ok(!json.includes(plan.candidateRoot));
      assert.ok(!json.includes(plan.tempDir));
    } finally {
      await disposeNativeProposal(plan);
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('identical inputs produce the same content-addressed proposal ID', async () => {
  const root = await createProject();
  const fixture = await mkdtemp(path.join(tmpdir(), 'chatpcb-native-id-fixture-'));
  try {
    const generated = await generateMcuPeripheralProject({ projectDir: fixture, prompt: STM32_PROMPT });
    const generateProjectImpl = async ({ projectDir }) => {
      await cp(fixture, projectDir, { recursive: true });
      return {
        spec: JSON.parse(await readFile(generated.files.spec, 'utf8')),
        files: Object.fromEntries(
          Object.entries(generated.files).map(([kind, filePath]) => [
            kind,
            path.join(projectDir, path.relative(fixture, filePath))
          ])
        ),
        review: generated.review
      };
    };
    const first = await createNativeProposal({
      projectDir: root,
      request: { prompt: STM32_PROMPT },
      validateCandidateImpl: passingCandidate,
      generateProjectImpl
    });
    const second = await createNativeProposal({
      projectDir: root,
      request: { prompt: STM32_PROMPT },
      validateCandidateImpl: passingCandidate,
      generateProjectImpl
    });
    try {
      assert.equal(first.proposalId, second.proposalId);
      assert.match(first.proposalId, /^sha256:[0-9a-f]{64}$/);
      assert.deepEqual(
        first.changes.map((change) => change.afterHash),
        second.changes.map((change) => change.afterHash)
      );
    } finally {
      await disposeNativeProposal(first);
      await disposeNativeProposal(second);
    }
  } finally {
    await rm(root, { force: true, recursive: true });
    await rm(fixture, { force: true, recursive: true });
  }
});

test('nested candidate paths stay relative through the final change list', async () => {
  const root = await createProject();
  try {
    await mkdir(path.join(root, 'nested'), { recursive: true });
    await writeFile(path.join(root, 'nested', '전원.kicad_sch'), '(kicad_sch nested-before)\n', 'utf8');
    const plan = await createNativeProposal({
      projectDir: root,
      request: { prompt: STM32_PROMPT },
      validateCandidateImpl: async ({ projectDir }) => {
        await appendFile(path.join(projectDir, 'nested', '전원.kicad_sch'), '(kicad-cli-normalized)\n');
        return passingCandidate();
      }
    });
    try {
      const nested = plan.changes.find((change) => change.path === 'nested/전원.kicad_sch');
      assert.ok(nested);
      assert.equal(nested.operation, 'modify');
      assert.match(nested.unifiedDiff, /--- nested\/전원\.kicad_sch/);
      assert.ok(!plan.changes.some((change) => change.path === '전원.kicad_sch'));
      assert.equal(nested.beforeHash, sha256(Buffer.from('(kicad_sch nested-before)\n')));
      assert.equal(nested.afterHash, sha256(nested.afterBytes));
      assert.equal(sha256(nested.beforeBytes), nested.beforeHash);
    } finally {
      await disposeNativeProposal(plan);
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('a supported board profile requests candidate ERC and DRC', async () => {
  const root = await createProject();
  try {
    const calls = [];
    const plan = await createNativeProposal({
      projectDir: root,
      request: { prompt: BOARD_PROMPT },
      validateCandidateImpl: async (options) => {
        calls.push(options);
        return passingBoardCandidate();
      }
    });
    try {
      assert.equal(calls.length, 1);
      assert.equal(calls[0].requiredValidation.erc, true);
      assert.equal(calls[0].requiredValidation.drc, true);
      assert.ok(plan.changes.some((change) => change.path.endsWith('.kicad_pcb')));
      assert.equal(plan.requiredValidation.erc, true);
      assert.equal(plan.requiredValidation.drc, true);
      assert.equal(plan.verificationPlan.erc.required, true);
      assert.equal(plan.verificationPlan.drc.required, true);
      assert.equal(plan.candidateVerification.erc.status, 'passed');
      assert.equal(plan.candidateVerification.drc.status, 'passed');
    } finally {
      await disposeNativeProposal(plan);
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('combined diffs larger than 5 MiB are blocked as PROPOSAL_DIFF_TOO_LARGE', async () => {
  const root = await createProject();
  try {
    const beforeTree = await snapshotTree(root);
    await assert.rejects(
      () => createNativeProposal({
        projectDir: root,
        request: { prompt: STM32_PROMPT },
        validateCandidateImpl: async ({ projectDir }) => {
          await writeFile(path.join(projectDir, 'nested-huge.kicad_sch'), 'x'.repeat(DIFF_LIMIT + 1));
          return passingCandidate();
        }
      }),
      (error) => error.code === 'PROPOSAL_DIFF_TOO_LARGE'
    );
    assert.deepEqual(await snapshotTree(root), beforeTree);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('artifact-derived required ERC/DRC cannot be disabled and beforeBytes match beforeHash', async () => {
  const root = await createProject();
  try {
    const plan = await createNativeProposal({
      projectDir: root,
      request: { prompt: STM32_PROMPT },
      validateCandidateImpl: passingCandidate
    });
    try {
      assert.equal(plan.requiredValidation.erc, true);
      assert.notDeepEqual(plan.requiredValidation, { erc: false, drc: false });
      for (const change of plan.changes) {
        if (change.operation === 'create') {
          assert.equal(change.beforeBytes, null);
          assert.equal(change.beforeHash, null);
        } else {
          assert.equal(sha256(change.beforeBytes), change.beforeHash);
        }
        if (change.operation === 'delete') {
          assert.equal(change.afterBytes, null);
          assert.equal(change.afterHash, null);
        } else {
          assert.equal(sha256(change.afterBytes), change.afterHash);
        }
      }
      const live = await collectTransactionInventory({ projectDir: root });
      assert.equal(plan.baseTransactionDigest, live.transactionDigest);
    } finally {
      await disposeNativeProposal(plan);
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('deleting the last schematic stays fail-closed with required ERC', async () => {
  const root = await createProject();
  try {
    const plan = await createNativeProposal({
      projectDir: root,
      request: { prompt: STM32_PROMPT },
      validateCandidateImpl: passingCandidate,
      generateProjectImpl: async (options) => {
        const generated = await generateMcuPeripheralProject(options);
        await rm(generated.files.schematic, { force: true });
        delete generated.files.schematic;
        return generated;
      }
    });
    try {
      const deleted = plan.changes.find((change) => change.path.endsWith('.kicad_sch') && change.operation === 'delete');
      assert.ok(deleted);
      assert.equal(plan.requiredValidation.erc, true);
    } finally {
      await disposeNativeProposal(plan);
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
