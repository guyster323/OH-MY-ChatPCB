import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collectArtifactInventory } from '../src/evidence/artifact-inventory.js';
import { collectTransactionInventory } from '../src/evidence/transaction-inventory.js';
import { dispatchToolCall } from '../src/runtime/agent-daemon.js';
import { generateMcuPeripheralProject } from '../src/workflow/generate-mcu-project.js';
import { inspectProject } from '../src/workflow/inspect-project.js';

const passingErc = async () => ({ ok: true, skipped: false, erc: { errorCount: 0, warningCount: 0 } });
const passingDrc = async () => ({ ok: true, skipped: false, executed: true, violations: [], unconnectedItems: [] });

function inspectProjectImpl(options) {
  return inspectProject({
    ...options,
    validateProjectImpl: passingErc,
    validateBoardImpl: passingDrc,
    getKicadVersionImpl: async () => null,
    analyzerAdapters: []
  });
}

async function inspect(projectDir, args = {}) {
  return dispatchToolCall({
    id: `inspect_${Math.random().toString(16).slice(2)}`,
    name: 'project.inspect',
    args: { projectDir, ...args }
  }, { inspectProjectImpl });
}

test('a schematic edit after generation makes the preview digest stale without writing v2 evidence', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-preview-digest-'));
  try {
    const generated = await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power and I2C connector.'
    });
    const specText = await readFile(generated.files.spec, 'utf8');
    const spec = JSON.parse(specText);
    assert.equal(spec.schemaVersion, undefined);

    const first = await inspect(root);
    assert.equal(first.ok, true);
    assert.equal(first.result.manifest.freshness.status, 'legacy-unverified');
    const baseline = first.result.inspection.projectDigest;
    assert.equal(baseline, (await collectArtifactInventory({ projectDir: root })).projectDigest);
    assert.equal(first.result.evidenceDigest, undefined);

    spec.note = 'spec-only edit';
    await writeFile(generated.files.spec, `${JSON.stringify(spec, null, 2)}\n`);
    const afterSpec = await inspect(root, { expectedDigest: baseline });
    assert.equal(afterSpec.ok, true);
    assert.equal(afterSpec.result.evidenceDigest.matches, false);
    assert.notEqual(afterSpec.result.evidenceDigest.projectDigest, baseline);
    const afterSpecInventory = await collectArtifactInventory({ projectDir: root });
    const afterSpecTransaction = await collectTransactionInventory({ projectDir: root });
    assert.equal(afterSpecInventory.projectDigest, afterSpecTransaction.transactionDigest);
    assert.equal(afterSpec.result.evidenceDigest.projectDigest, afterSpecInventory.projectDigest);
    assert.equal(afterSpec.result.manifest.freshness.status, 'legacy-unverified');
    assert.equal(JSON.parse(await readFile(generated.files.spec, 'utf8')).schemaVersion, undefined);

    const schematicPath = generated.files.schematic;
    const schematic = await readFile(schematicPath, 'utf8');
    await writeFile(schematicPath, `${schematic}\n(text "disk edit")\n`);
    const afterSchematic = await inspect(root, { expectedDigest: baseline });
    assert.equal(afterSchematic.ok, true);
    assert.equal(afterSchematic.result.evidenceDigest.matches, false);
    assert.notEqual(afterSchematic.result.evidenceDigest.projectDigest, baseline);
    const afterSchematicInventory = await collectArtifactInventory({ projectDir: root });
    const afterSchematicTransaction = await collectTransactionInventory({ projectDir: root });
    assert.equal(afterSchematicInventory.projectDigest, afterSchematicTransaction.transactionDigest);
    assert.equal(afterSchematic.result.evidenceDigest.projectDigest, afterSchematicInventory.projectDigest);
    assert.equal(afterSchematic.result.manifest.freshness.status, 'legacy-unverified');
    assert.equal(JSON.parse(await readFile(generated.files.spec, 'utf8')).schemaVersion, undefined);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
