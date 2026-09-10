import assert from 'node:assert/strict';
import test from 'node:test';

import { createFact, normalizeFinding } from '../src/analyzer/fact-contract.js';
import { buildSelectionEvidence, normalizeSelectionContext } from '../src/context/selection-context.js';

const CONNECTIVITY = {
  code: 'SELECTION_CONNECTIVITY_UNPROVEN',
  message: 'Pin-to-net connectivity is not proven by the current saved-artifact analyzer.'
};

function componentFact({ uuid, reference, x = 10, y = 20 }) {
  return createFact({
    id: `builtin.schematic.component:${uuid}`,
    category: 'schematic.component',
    value: { uuid, reference, value: 'Part', position: { x, y }, rotation: 0, unit: 1 },
    sourceArtifact: 'demo.kicad_sch',
    extractor: 'builtin.kicad-schematic@1',
    confidence: 'deterministic'
  });
}

function labelFact({ category, kind, text, index = 0, x = 1, y = 1 }) {
  return createFact({
    id: `builtin.${category}:${index}`,
    category,
    value: { kind, text, position: { x, y }, rotation: 0 },
    sourceArtifact: 'demo.kicad_sch',
    extractor: 'builtin.kicad-schematic@1',
    confidence: 'deterministic'
  });
}

function netFact(name, labelFactIds) {
  return createFact({
    id: `builtin.schematic.net:${name}`,
    category: 'schematic.net',
    value: { name, labelFactIds },
    sourceArtifact: 'demo.kicad_sch',
    extractor: 'builtin.kicad-schematic@1',
    confidence: 'deterministic'
  });
}

function finding(id, factIds) {
  return normalizeFinding({
    id,
    extractor: 'builtin.kicad-schematic@1',
    severity: 'warning',
    confidence: 'deterministic',
    factIds,
    sourceArtifacts: ['demo.kicad_sch'],
    message: id
  });
}

function coverageOf(result) {
  return result.coverage;
}

test('normalizeSelectionContext trims fields, keeps a closed item set, and sorts anchors', () => {
  const callerItem = {
    kind: '  symbol ',
    kiid: '  sym-1 ',
    reference: ' U1 ',
    position: { x: 10, y: 20 },
    beforeImage: 'secret-bytes',
    candidatePath: '/tmp/chatpcb-native-proposal-xyz'
  };
  const selection = {
    editor: ' schematic ',
    sheet: ' /Power ',
    dirty: true,
    hostState: 'embedded',
    items: [
      { kind: 'hierarchical_label', text: ' SPI ', position: { x: 3, y: 4 } },
      callerItem,
      { kind: 'global_label', text: '+3V3', position: { x: 2, y: 2 } },
      { kind: 'label', text: 'SDA', position: { x: 1, y: 1 } }
    ]
  };

  const normalized = normalizeSelectionContext(selection);
  callerItem.reference = 'HACK';
  selection.sheet = '/mutated';

  assert.equal(normalized.editor, 'schematic');
  assert.equal(normalized.sheet, '/Power');
  assert.equal(normalized.dirty, true);
  assert.equal(normalized.hostState, 'embedded');
  assert.deepEqual(normalized.items, [
    { kind: 'global_label', text: '+3V3', position: { x: 2, y: 2 } },
    { kind: 'hierarchical_label', text: 'SPI', position: { x: 3, y: 4 } },
    { kind: 'label', text: 'SDA', position: { x: 1, y: 1 } },
    { kind: 'symbol', kiid: 'sym-1', reference: 'U1', position: { x: 10, y: 20 } }
  ]);
  assert.equal(normalized.items.some((item) => 'beforeImage' in item || 'candidatePath' in item), false);
  assert.doesNotThrow(() => { callerItem.reference = 'still-mutable'; });
});

test('normalizeSelectionContext omits unsupported items, collapses duplicate anchors, and rejects invalid coordinates', () => {
  const normalized = normalizeSelectionContext({
    hostState: 'mock',
    items: [
      { kind: 'wire', kiid: 'w1', position: { x: 0, y: 0 } },
      { kind: 'symbol', kiid: 'sym-1', reference: 'U1', position: { x: 10, y: 20 } },
      { kind: 'symbol', kiid: 'sym-1', reference: 'U1', position: { x: 99, y: 99 } },
      { kind: 'label', text: 'SDA', position: { x: 1, y: 1 } },
      { kind: 'label', text: ' SDA ', position: { x: 1, y: 1 } },
      { kind: 'symbol', reference: 'U2', position: { x: Infinity, y: 1 } },
      { kind: 'symbol', reference: 'U3', position: { x: '1', y: 2 } },
      { kind: 'global_label', text: '+3V3' },
      { kind: 'hierarchical_label', text: 'SPI', position: { x: 1, y: Number.NaN } },
      { kind: 'symbol', position: { x: 8, y: 8 } }
    ]
  });

  assert.equal(normalized.hostState, 'mock');
  assert.deepEqual(normalized.items, [
    { kind: 'label', text: 'SDA', position: { x: 1, y: 1 } },
    { kind: 'symbol', kiid: 'sym-1', reference: 'U1', position: { x: 10, y: 20 } }
  ]);
  assert.equal(normalized.diagnostics.some((diagnostic) => diagnostic.code === 'KICAD_SELECTION_UNSUPPORTED'), true);
  assert.equal(normalized.diagnostics.some((diagnostic) => diagnostic.code === 'SELECTION_ITEM_INVALID'), true);
});

test('buildSelectionEvidence matches symbols by UUID or reference and labels by text across families', () => {
  const u1 = componentFact({ uuid: 'sym-1', reference: 'U1', x: 10, y: 20 });
  const u2 = componentFact({ uuid: 'sym-2', reference: 'U2', x: 50, y: 20 });
  const local = labelFact({ category: 'schematic.label', kind: 'label', text: 'SDA', index: 0, x: 20, y: 30 });
  const global = labelFact({ category: 'schematic.global_label', kind: 'global_label', text: '+3V3', index: 0, x: 30, y: 10 });
  const hierarchical = labelFact({ category: 'schematic.hierarchical_label', kind: 'hierarchical_label', text: 'SPI', index: 0, x: 40, y: 10 });
  const sdaNet = netFact('SDA', [local.id]);
  const powerNet = netFact('+3V3', [global.id]);
  const spiNet = netFact('SPI', [hierarchical.id]);
  const inspection = {
    facts: [u1, u2, local, global, hierarchical, sdaNet, powerNet, spiNet],
    findings: [
      finding('keep-u1', [u1.id]),
      finding('drop-unselected-u2', [u2.id]),
      finding('drop-mixed', [u1.id, u2.id])
    ],
    project: {
      canonicalPath: 'C:/proj',
      evidenceDigest: 'abc',
      transactionDigest: 'def',
      manifestFreshness: { status: 'missing' }
    },
    verification: { erc: { ok: true }, drc: { ok: true } }
  };

  const result = buildSelectionEvidence({
    selection: {
      editor: 'schematic',
      sheet: '/Power',
      dirty: false,
      hostState: 'standalone',
      items: [
        { kind: 'symbol', kiid: 'sym-1', position: { x: 10, y: 20 } },
        { kind: 'label', text: 'SDA', position: { x: 20, y: 30 } },
        { kind: 'global_label', text: '+3V3', position: { x: 30, y: 10 } },
        { kind: 'hierarchical_label', text: 'SPI', position: { x: 40, y: 10 } }
      ]
    },
    inspection
  });

  assert.equal(result.schemaVersion, 1);
  assert.deepEqual(result.project, inspection.project);
  assert.deepEqual(result.editor, {
    kind: 'schematic',
    sheet: '/Power',
    dirty: false,
    hostState: 'standalone'
  });
  assert.equal(result.selection.mode, 'explicit');
  assert.deepEqual(result.facts.map((fact) => fact.id).sort(), [
    global.id, hierarchical.id, local.id, powerNet.id, sdaNet.id, spiNet.id, u1.id
  ].sort());
  assert.deepEqual(result.findings.map((item) => item.id), ['keep-u1']);
  assert.equal(result.facts.some((fact) => fact.id === u2.id), false);
  assert.deepEqual(coverageOf(result), { status: 'partial', diagnostics: [CONNECTIVITY] });
  assert.equal(result.coverage.diagnostics.some((diagnostic) => diagnostic.code === CONNECTIVITY.code), true);
});

test('buildSelectionEvidence matches a symbol by reference when KIID is absent', () => {
  const u1 = componentFact({ uuid: 'sym-1', reference: 'U1', x: 10, y: 20 });
  const result = buildSelectionEvidence({
    selection: { items: [{ kind: 'symbol', reference: 'U1', position: { x: 10, y: 20 } }] },
    inspection: { facts: [u1], findings: [] }
  });
  assert.deepEqual(result.facts.map((fact) => fact.id), [u1.id]);
  assert.equal(result.selection.items[0].reference, 'U1');
});

test('buildSelectionEvidence keeps findings only when every referenced fact remains and never fabricates matches', () => {
  const u1 = componentFact({ uuid: 'sym-1', reference: 'U1' });
  const result = buildSelectionEvidence({
    selection: {
      hostState: 'mock',
      items: [{ kind: 'symbol', kiid: 'missing-uuid', reference: 'U9', position: { x: 1, y: 1 } }]
    },
    inspection: {
      facts: [u1],
      findings: [finding('owned-by-u1', [u1.id])]
    }
  });

  assert.deepEqual(result.facts, []);
  assert.deepEqual(result.findings, []);
  assert.equal(result.diagnostics.some((diagnostic) => diagnostic.code === 'SELECTION_FACT_UNMATCHED'), true);
  assert.deepEqual(result.coverage.diagnostics, [CONNECTIVITY]);
});

test('buildSelectionEvidence clones caller objects and always reports unproven connectivity', () => {
  const u1 = componentFact({ uuid: 'sym-1', reference: 'U1' });
  const findings = [finding('keep-u1', [u1.id])];
  const selection = {
    hostState: 'embedded',
    items: [{ kind: 'symbol', kiid: 'sym-1', reference: 'U1', position: { x: 10, y: 20 }, secret: 'nope' }]
  };
  const inspection = { facts: [u1], findings, project: { transactionDigest: 'tx-1' } };
  const result = buildSelectionEvidence({ selection, inspection });

  selection.items[0].reference = 'HACK';
  inspection.facts.push(componentFact({ uuid: 'sym-x', reference: 'UX' }));
  findings.push(finding('later', [u1.id]));
  result.selection.items[0].reference = 'MUTATED';
  result.facts[0].value.reference = 'MUTATED';

  assert.equal(selection.items[0].reference, 'HACK');
  assert.equal(result.facts[0].id, u1.id);
  assert.equal('secret' in result.selection.items[0], false);
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(JSON.stringify(result).includes('beforeImage'), false);
  assert.deepEqual(result.coverage.diagnostics, [CONNECTIVITY]);
  assert.equal(result.coverage.status, 'partial');
});
