import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collectArtifactInventory } from '../src/evidence/artifact-inventory.js';
import { analyzeProject } from '../src/analyzer/project-analyzer.js';

const schematic = `(kicad_sch (version 1)
  (symbol (lib_id "Demo:Part") (at 10 20 0) (uuid schematic-1)
    (property "Reference" "U1") (property "Value" "Part") (property "Footprint" "Package:Demo"))
  (label "SDA" (at 20 30 0)))`;

const board = `(kicad_pcb (version 1) (layers (0 "F.Cu" signal))
  (net 1 "GND")
  (footprint "Demo:Part" (layer "F.Cu") (at 10 20)
    (property "Reference" "U1") (uuid "board-1")
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "GND"))))`;

const scopedId = (id, artifactPath) => `${id}@${Buffer.from(artifactPath, 'utf8').toString('base64url')}`;

async function makeProject({ withBoard = true, withSchematic = true } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-project-analyzer-'));
  if (withSchematic) await writeFile(path.join(root, 'demo.kicad_sch'), schematic, 'utf8');
  if (withBoard) await writeFile(path.join(root, 'demo.kicad_pcb'), board, 'utf8');
  return root;
}

test('analyzeProject merges canonical facts and reports a complete built-in analyzer', async () => {
  const root = await makeProject();
  try {
    const inventory = await collectArtifactInventory({ projectDir: root });
    const result = await analyzeProject({ projectDir: root, inventory });

    assert.deepEqual(result.facts.map((fact) => fact.id), [
      'builtin.board.footprint:board-1',
      'builtin.board.net:1',
      'builtin.board.pad:board-1:1',
      'builtin.board.summary',
      'builtin.board.unrouted',
      'builtin.schematic.component:schematic-1',
      'builtin.schematic.label:0',
      'builtin.schematic.net:SDA'
    ]);
    assert.deepEqual(result.analyzers, [{
      id: 'builtin.kicad', namespace: 'builtin', status: 'complete', version: '1',
      sourceArtifacts: ['demo.kicad_pcb', 'demo.kicad_sch'], diagnostics: []
    }]);
    assert.deepEqual(result.findings, []);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('analyzeProject reports a typed missing-source diagnostic while preserving other facts', async () => {
  const root = await makeProject({ withBoard: false });
  try {
    const inventory = await collectArtifactInventory({ projectDir: root });
    const result = await analyzeProject({ projectDir: root, inventory });

    assert.equal(result.facts.every((fact) => fact.category.startsWith('schematic.')), true);
    assert.deepEqual(result.analyzers[0], {
      id: 'builtin.kicad', namespace: 'builtin', status: 'partial', version: '1',
      sourceArtifacts: ['demo.kicad_sch'],
      diagnostics: [{ code: 'ANALYZER_SOURCE_MISSING', message: 'No .kicad_pcb source artifact found', sourceKind: 'board' }]
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('analyzeProject discards analysis when an inventoried source disappears before it can be read', async () => {
  const root = await makeProject();
  try {
    const inventory = await collectArtifactInventory({ projectDir: root });
    const result = await analyzeProject({
      projectDir: root,
      inventory,
      readFileImpl: async (sourcePath) => {
        await rm(sourcePath);
        return readFile(sourcePath);
      }
    });

    assert.deepEqual(result.facts, []);
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.analyzers, [{
      id: 'builtin.kicad', namespace: 'builtin', status: 'failed', version: '1',
      sourceArtifacts: ['demo.kicad_pcb', 'demo.kicad_sch'],
      diagnostics: [{ code: 'ANALYZER_INPUT_CHANGED', message: 'Project artifact digest changed during analysis' }]
    }]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('analyzeProject scopes local built-in IDs so every inventoried board and schematic survives normalization', async () => {
  const root = await makeProject();
  try {
    await writeFile(path.join(root, 'alternate.kicad_sch'), schematic.replace(' (property "Footprint" "Package:Demo")', ''), 'utf8');
    await writeFile(path.join(root, 'alternate.kicad_pcb'), board, 'utf8');
    const inventory = await collectArtifactInventory({ projectDir: root });
    const result = await analyzeProject({ projectDir: root, inventory });

    assert.equal(result.facts.length, 16);
    assert.equal(new Set(result.facts.map((fact) => fact.id)).size, 16);
    assert.equal(result.facts.some((fact) => fact.id === scopedId('builtin.schematic.component:schematic-1', 'alternate.kicad_sch')), true);
    assert.equal(result.facts.some((fact) => fact.id === scopedId('builtin.schematic.component:schematic-1', 'demo.kicad_sch')), true);
    assert.equal(result.facts.some((fact) => fact.id === scopedId('builtin.board.summary', 'alternate.kicad_pcb')), true);
    assert.equal(result.facts.some((fact) => fact.id === scopedId('builtin.board.summary', 'demo.kicad_pcb')), true);
    assert.deepEqual(result.facts.find((fact) => fact.id === scopedId('builtin.schematic.net:SDA', 'alternate.kicad_sch')).value.labelFactIds, [
      scopedId('builtin.schematic.label:0', 'alternate.kicad_sch')
    ]);
    assert.deepEqual(result.findings[0].factIds, [scopedId('builtin.schematic.component:schematic-1', 'alternate.kicad_sch')]);
    assert.deepEqual(result.analyzers[0].diagnostics, []);
    assert.deepEqual(result.analyzers[0].sourceArtifacts, [
      'alternate.kicad_pcb', 'alternate.kicad_sch', 'demo.kicad_pcb', 'demo.kicad_sch'
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('analyzeProject uses injective artifact scopes when fact IDs and paths contain at signs', async () => {
  const root = await makeProject({ withBoard: false, withSchematic: false });
  try {
    await writeFile(path.join(root, 'x@y.kicad_sch'), schematic.replace('"SDA"', '"foo"'), 'utf8');
    await writeFile(path.join(root, 'y.kicad_sch'), schematic.replace('"SDA"', '"foo@x"'), 'utf8');
    const inventory = await collectArtifactInventory({ projectDir: root });
    const result = await analyzeProject({ projectDir: root, inventory });

    const netFacts = result.facts.filter((fact) => fact.category === 'schematic.net');
    assert.equal(netFacts.length, 2);
    assert.equal(new Set(result.facts.map((fact) => fact.id)).size, result.facts.length);
    assert.deepEqual(netFacts.map((fact) => [fact.sourceArtifact, fact.value.name]).sort(), [
      ['x@y.kicad_sch', 'foo'],
      ['y.kicad_sch', 'foo@x']
    ]);
    assert.equal(result.analyzers[0].diagnostics.some((diagnostic) => diagnostic.code === 'ANALYZER_FACT_COLLISION'), false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('analyzeProject discards facts when the post-extraction inventory digest changes', async () => {
  const root = await makeProject();
  try {
    const inventory = await collectArtifactInventory({ projectDir: root });
    let calls = 0;
    const result = await analyzeProject({
      projectDir: root,
      inventory,
      collectInventoryImpl: async () => {
        calls += 1;
        return calls === 1 ? inventory : { ...inventory, projectDigest: 'f'.repeat(64) };
      }
    });

    assert.deepEqual(result.facts, []);
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.analyzers, [{
      id: 'builtin.kicad', namespace: 'builtin', status: 'failed', version: '1',
      sourceArtifacts: ['demo.kicad_pcb', 'demo.kicad_sch'],
      diagnostics: [{ code: 'ANALYZER_INPUT_CHANGED', message: 'Project artifact digest changed during analysis' }]
    }]);
    assert.equal(calls, 2);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
