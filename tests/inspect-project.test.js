import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collectArtifactInventory } from '../src/evidence/artifact-inventory.js';
import { inspectProject } from '../src/workflow/inspect-project.js';

async function makeProject() {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-inspect-'));
  await writeFile(path.join(root, 'demo.kicad_sch'), '(kicad_sch)\n', 'utf8');
  await writeFile(path.join(root, 'demo.kicad_pcb'), '(kicad_pcb)\n', 'utf8');
  return root;
}

async function snapshot(root) {
  const names = (await readdir(root)).sort();
  return Object.fromEntries(await Promise.all(names.map(async (name) => [name, await readFile(path.join(root, name), 'utf8')])));
}

const cleanErc = async () => ({ ok: true, erc: { errorCount: 0, warningCount: 0 } });
const cleanDrc = async () => ({ ok: true, drc: { violationCount: 0, unconnectedCount: 0 } });

test('inspectProject returns stable artifact evidence and separate validation results', async () => {
  const root = await makeProject();
  try {
    const result = await inspectProject({
      projectDir: root,
      now: () => '2026-09-03T00:00:00.000Z',
      validateProjectImpl: cleanErc,
      validateBoardImpl: async () => ({ ok: false, drc: { violationCount: 0, unconnectedCount: 2 } })
    });

    assert.equal(result.ok, true);
    assert.equal(result.inspection.artifactCount, 2);
    assert.equal(result.validation.erc.ok, true);
    assert.equal(result.validation.drc.ok, false);
    assert.equal(result.validationClean, false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('inspectProject isolates validator mutations from saved project files and evidence', async () => {
  const root = await makeProject();
  const before = await snapshot(root);
  const beforeInventory = await collectArtifactInventory({ projectDir: root });
  const validationDirs = [];
  try {
    const result = await inspectProject({
      projectDir: root,
      validateProjectImpl: async ({ projectDir }) => {
        validationDirs.push(projectDir);
        await writeFile(path.join(projectDir, 'demo.kicad_sch'), '(mutated by ERC)\n', 'utf8');
        await writeFile(path.join(projectDir, 'chatpcb-erc.json'), '{"generated":true}', 'utf8');
        return { ok: true, erc: { errorCount: 0, warningCount: 0 } };
      },
      validateBoardImpl: async ({ projectDir }) => {
        validationDirs.push(projectDir);
        await writeFile(path.join(projectDir, 'chatpcb-drc.json'), '{"generated":true}', 'utf8');
        return { ok: false, drc: { violationCount: 1, unconnectedCount: 0 } };
      }
    });

    assert.equal(result.validation.erc.ok, true);
    assert.equal(result.validation.drc.ok, false);
    assert.equal(result.validationClean, false);
    assert.equal(validationDirs.every((validationDir) => validationDir !== root), true);
    assert.deepEqual(await snapshot(root), before);
    assert.deepEqual(await collectArtifactInventory({ projectDir: root }), beforeInventory);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('inspectProject rejects an unsafe project path without changing source files', async () => {
  await assert.rejects(
    inspectProject({ projectDir: homedir(), validateProjectImpl: cleanErc, validateBoardImpl: cleanDrc }),
    { code: 'UNSAFE_PROJECT_DIR' }
  );
});

test('inspectProject rejects invalid manifest JSON without changing source files', async () => {
  const root = await makeProject();
  await writeFile(path.join(root, 'demo.chatpcb.json'), '{not-json', 'utf8');
  const before = await snapshot(root);
  try {
    await assert.rejects(inspectProject({ projectDir: root, validateProjectImpl: cleanErc, validateBoardImpl: cleanDrc }), {
      code: 'CHATPCB_MANIFEST_INVALID'
    });
    assert.deepEqual(await snapshot(root), before);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('inspectProject rejects multiple manifests without changing source files', async () => {
  const root = await makeProject();
  await writeFile(path.join(root, 'one.chatpcb.json'), '{}', 'utf8');
  await writeFile(path.join(root, 'two.chatpcb.json'), '{}', 'utf8');
  const before = await snapshot(root);
  try {
    await assert.rejects(inspectProject({ projectDir: root, validateProjectImpl: cleanErc, validateBoardImpl: cleanDrc }), {
      code: 'MULTIPLE_CHATPCB_MANIFESTS'
    });
    assert.deepEqual(await snapshot(root), before);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('inspectProject reports a missing board through DRC validation without changing source files', async () => {
  const root = await makeProject();
  await rm(path.join(root, 'demo.kicad_pcb'));
  const before = await snapshot(root);
  try {
    const result = await inspectProject({ projectDir: root, validateProjectImpl: cleanErc });
    assert.equal(result.validation.drc.ok, true);
    assert.equal(result.validation.drc.skipped, true);
    assert.equal(result.validation.drc.reason.code, 'NO_BOARD');
    assert.deepEqual(await snapshot(root), before);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('inspectProject reports missing manifest freshness without changing source files', async () => {
  const root = await makeProject();
  const before = await snapshot(root);
  try {
    const result = await inspectProject({ projectDir: root, validateProjectImpl: cleanErc, validateBoardImpl: cleanDrc });
    assert.equal(result.manifest.schemaVersion, null);
    assert.equal(result.manifest.freshness.status, 'missing');
    assert.deepEqual(await snapshot(root), before);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
