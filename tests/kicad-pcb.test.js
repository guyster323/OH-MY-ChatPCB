import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePcb } from '../src/analyzer/kicad-pcb.js';

const sourceArtifact = 'boards/example.kicad_pcb';

const board = `(kicad_pcb
  (version 20240108)
  (layers (31 "B.Cu" signal) (0 "F.Cu" signal) (44 "Edge.Cuts" user))
  (net 1 "GND")
  (net 2 "VCC")
  (footprint "Resistor_SMD:R_0603_1608Metric"
    (layer "F.Cu")
    (at 10 20 90)
    (property "Reference" "R1")
    (uuid "footprint-uuid")
    (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask") (net 1 "GND"))
    (pad "2" smd rect (at 1 0 180) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask")))
  (segment (start 10 20) (end 15 20) (width 0.25) (layer "F.Cu") (net 1))
  (via (at 15 20) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1))
  (gr_rect (start 0 0) (end 30 40) (stroke (width 0.05) (type default)) (fill none) (layer "Edge.Cuts"))
  (zone (net 1) (net_name "GND") (layers "F.Cu" "B.Cu") (hatch edge 0.5)))`;

function factsById(result) {
  return Object.fromEntries(result.facts.map((fact) => [fact.id, fact]));
}

test('extracts deterministic board facts with local pad geometry', () => {
  const result = analyzePcb({ source: board, sourceArtifact });
  const facts = factsById(result);

  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.summary, {
    formatVersion: '20240108', layers: ['F.Cu', 'B.Cu', 'Edge.Cuts'], outline: { minX: 0, minY: 0, maxX: 30, maxY: 40 },
    footprintCount: 1, padCount: 2, segmentCount: 1, viaCount: 1, zoneCount: 1, graphicCount: 1
  });
  assert.deepEqual(facts['builtin.board.net:1'].value, { id: 1, name: 'GND' });
  assert.deepEqual(facts['builtin.board.footprint:footprint-uuid'].value.position, { x: 10, y: 20 });
  assert.equal(facts['builtin.board.footprint:footprint-uuid'].value.rotation, 90);
  assert.equal(facts['builtin.board.footprint:footprint-uuid'].value.layer, 'F.Cu');
  assert.equal(facts['builtin.board.footprint:footprint-uuid'].value.padCount, 2);
  assert.deepEqual(facts['builtin.board.pad:footprint-uuid:1'].value, {
    footprintId: 'footprint-uuid', number: '1', type: 'smd', shape: 'rect',
    position: { x: -1, y: 0 }, rotation: 0, footprintPosition: { x: 10, y: 20 }, footprintRotation: 90,
    size: { x: 1, y: 1 }, drill: null, layers: ['F.Cu', 'F.Mask', 'F.Paste'], netId: 1, netName: 'GND'
  });
  assert.equal(facts['builtin.board.pad:footprint-uuid:2'].value.netId, null);
  assert.equal(facts['builtin.board.pad:footprint-uuid:2'].value.netName, null);
  assert.deepEqual(facts['builtin.board.segment:0'].value, {
    start: { x: 10, y: 20 }, end: { x: 15, y: 20 }, width: 0.25, layer: 'F.Cu', netId: 1
  });
  assert.deepEqual(facts['builtin.board.via:0'].value, {
    position: { x: 15, y: 20 }, size: 0.8, drill: 0.4, layers: ['B.Cu', 'F.Cu'], netId: 1
  });
});

test('reports malformed boards without partial facts', () => {
  const result = analyzePcb({ source: '(kicad_pcb (version 20240108) (segment (start 0 0)))', sourceArtifact });
  assert.deepEqual(result.facts, []);
  assert.deepEqual(result.findings, []);
  assert.equal(result.diagnostics[0].code, 'ANALYZER_PARSE_ERROR');
  assert.match(result.diagnostics[0].message, /segment end requires coordinates/);
  assert.equal(result.diagnostics[0].sourceArtifact, sourceArtifact);
  assert.deepEqual(result.summary, {
    formatVersion: undefined, layers: [], outline: null,
    footprintCount: 0, padCount: 0, segmentCount: 0, viaCount: 0, zoneCount: 0, graphicCount: 0
  });
});

test('extracts through-hole drill and fails closed for malformed pad structure', () => {
  const valid = `(kicad_pcb (version 1) (layers (0 "F.Cu" signal))
    (footprint "Connector" (layer "F.Cu") (at 0 0) (property "Reference" "J1")
      (pad "1" thru_hole circle (at 0 0) (size 2 2) (drill 1) (layers "*.Cu" "*.Mask"))))`;
  const result = analyzePcb({ source: valid, sourceArtifact });
  assert.equal(factsById(result)['builtin.board.pad:J1:1'].value.drill, 1);

  const malformed = analyzePcb({ source: `(kicad_pcb (version 1) (footprint "X" (layer "F.Cu") (at 0 0) (pad "1" smd rect (at 0 0) (size 1 1))))`, sourceArtifact });
  assert.deepEqual(malformed.facts, []);
  assert.equal(malformed.diagnostics[0].code, 'ANALYZER_PARSE_ERROR');
  assert.match(malformed.diagnostics[0].message, /pad requires layers/);
});

test('fails closed for unsupported Edge.Cuts geometry and a footprint without a layer', () => {
  const unsupportedOutline = analyzePcb({ source: `(kicad_pcb (version 1) (layers (44 "Edge.Cuts" user)) (gr_arc (start 0 0) (mid 5 5) (end 10 0) (layer "Edge.Cuts")))`, sourceArtifact });
  assert.deepEqual(unsupportedOutline.facts, []);
  assert.equal(unsupportedOutline.diagnostics[0].code, 'ANALYZER_PARSE_ERROR');
  assert.match(unsupportedOutline.diagnostics[0].message, /unsupported Edge\.Cuts geometry: gr_arc/);

  const missingLayer = analyzePcb({ source: `(kicad_pcb (version 1) (footprint "X" (at 0 0)))`, sourceArtifact });
  assert.deepEqual(missingLayer.facts, []);
  assert.equal(missingLayer.diagnostics[0].code, 'ANALYZER_PARSE_ERROR');
  assert.match(missingLayer.diagnostics[0].message, /footprint requires a layer/);
});

test('analyzePcb rejects vias without two non-empty layers', () => {
  const result = analyzePcb({ source: '(kicad_pcb (version 1) (via (at 1 2) (size 1) (drill 0.5) (layers "F.Cu") (net 1)))', sourceArtifact: 'demo.kicad_pcb' });
  assert.deepEqual(result.facts, []);
  assert.equal(result.diagnostics[0].code, 'ANALYZER_PARSE_ERROR');
});

test('flags undeclared pad nets and conservatively identifies unrouted nets', () => {
  const source = `(kicad_pcb (version 1) (layers (0 "F.Cu" signal))
    (net 1 "GND") (net 2 "VCC")
    (footprint "X" (layer "F.Cu") (at 0 0) (property "Reference" "J1")
      (pad "1" thru_hole circle (at 0 0) (size 1 1) (drill 0.5) (layers "*.Cu") (net 1 "GND"))
      (pad "2" thru_hole circle (at 2 0) (size 1 1) (drill 0.5) (layers "*.Cu") (net 9 "MISSING")))
  )`;
  const result = analyzePcb({ source, sourceArtifact });
  const facts = factsById(result);

  assert.deepEqual(facts['builtin.board.unrouted'].value, { netIds: [1, 2] });
  assert.equal(facts['builtin.board.unrouted'].confidence, 'heuristic');
  assert.deepEqual(result.findings.map((finding) => ({ id: finding.id, severity: finding.severity, factIds: finding.factIds })), [{
    id: 'builtin.board.pad-undeclared-net:builtin.board.pad:J1:2', severity: 'warning', factIds: ['builtin.board.pad:J1:2']
  }]);
});
