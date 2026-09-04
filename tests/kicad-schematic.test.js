import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeSchematic } from '../src/analyzer/kicad-schematic.js';

const fixture = `(kicad_sch
  (version 20260306)
  (symbol (lib_id "ChatPCB:MCU_PLACEHOLDER") (at 10 20 0) (unit 1) (uuid sym-1)
    (property "Reference" "U1")
    (property "Value" "MCU")
    (property "Footprint" "Package_QFP:LQFP-32"))
  (label "SDA" (at 20 30 0))
  (wire (pts (xy 10 20) (xy 20 30)))
  (junction (at 20 30))
  (no_connect (at 30 40)))`;

test('analyzeSchematic extracts stable component and structural facts', () => {
  const result = analyzeSchematic({ source: fixture, sourceArtifact: 'demo.kicad_sch' });

  assert.deepEqual(result.summary, {
    formatVersion: '20260306', symbolCount: 1, labelCount: 1, wireCount: 1,
    junctionCount: 1, noConnectCount: 1
  });
  assert.deepEqual(result.facts.find((fact) => fact.category === 'schematic.component').value, {
    uuid: 'sym-1', reference: 'U1', value: 'MCU', libId: 'ChatPCB:MCU_PLACEHOLDER',
    footprint: 'Package_QFP:LQFP-32', position: { x: 10, y: 20 }, rotation: 0, unit: 1
  });
  assert.equal(result.facts.find((fact) => fact.category === 'schematic.component').id, 'builtin.schematic.component:sym-1');
});

test('analyzeSchematic ignores library symbol definitions and gives labels order-independent IDs', () => {
  const result = analyzeSchematic({
    source: `(kicad_sch (version 20260306)
      (lib_symbols (symbol "Ignored" (property "Reference" "LIB")))
      (label "SCL" (at 30 20 0))
      (label "SDA" (at 10 20 90))
      (label "SCL" (at 20 20 0))
      (symbol (lib_id "ChatPCB:Part") (at 0 0 0) (uuid placed-1)
        (property "Reference" "U1") (property "Value" "Part") (property "Footprint" "Package:Part")))`,
    sourceArtifact: 'ordered.kicad_sch'
  });

  assert.equal(result.summary.symbolCount, 1);
  assert.deepEqual(
    result.facts.filter((fact) => fact.category === 'schematic.label').map((fact) => [fact.id, fact.value.text, fact.value.position]),
    [
      ['builtin.schematic.label:0', 'SDA', { x: 10, y: 20 }],
      ['builtin.schematic.label:1', 'SCL', { x: 20, y: 20 }],
      ['builtin.schematic.label:2', 'SCL', { x: 30, y: 20 }]
    ]
  );
  assert.deepEqual(result.facts.find((fact) => fact.category === 'schematic.net' && fact.value.name === 'SCL').value, {
    name: 'SCL', labelFactIds: ['builtin.schematic.label:1', 'builtin.schematic.label:2']
  });
});

test('analyzeSchematic reports parse errors without fabricating facts', () => {
  const result = analyzeSchematic({ source: '(kicad_sch (version 20260306)', sourceArtifact: 'broken.kicad_sch' });

  assert.deepEqual(result.facts, []);
  assert.deepEqual(result.findings, []);
  assert.equal(result.diagnostics[0].code, 'ANALYZER_PARSE_ERROR');
  assert.deepEqual(result.summary, {
    formatVersion: undefined, symbolCount: 0, labelCount: 0, wireCount: 0,
    junctionCount: 0, noConnectCount: 0
  });
});

test('analyzeSchematic warns when a placed component lacks required structural metadata', () => {
  const result = analyzeSchematic({
    source: '(kicad_sch (version 20260306) (symbol (at 1 2 0) (uuid broken-part) (property "Value" "Part")))',
    sourceArtifact: 'missing-metadata.kicad_sch'
  });

  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].severity, 'warning');
  assert.match(result.findings[0].message, /Reference and Footprint/);
});

test('analyzeSchematic fails closed for semantically malformed schematic nodes', () => {
  const malformedSources = [
    '(foo)',
    '(kicad_sch (version 1) (label "SDA"))',
    '(kicad_sch (version 1) (symbol (uuid missing-position)))',
    '(kicad_sch (version 1) (symbol (at x 2 0)))',
    '(kicad_sch (version 1) (wire (pts (xy x 2) (xy 3 4))))',
    '(kicad_sch (version 1) (junction (at 2 nope)))',
    '(kicad_sch (version 1) (no_connect (at nope 2)))'
  ];

  for (const source of malformedSources) {
    const result = analyzeSchematic({ source, sourceArtifact: 'malformed.kicad_sch' });

    assert.deepEqual(result.facts, [], source);
    assert.deepEqual(result.findings, [], source);
    assert.equal(result.diagnostics[0]?.code, 'ANALYZER_PARSE_ERROR', source);
    assert.deepEqual(result.summary, {
      formatVersion: undefined, symbolCount: 0, labelCount: 0, wireCount: 0,
      junctionCount: 0, noConnectCount: 0
    }, source);
  }
});
