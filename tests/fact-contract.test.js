import assert from 'node:assert/strict';
import test from 'node:test';

import { createFact, normalizeFacts, normalizeFinding } from '../src/analyzer/fact-contract.js';

test('normalizeFacts sorts facts and rejects duplicate fully-qualified IDs', () => {
  const result = normalizeFacts([
    createFact({ id: 'builtin.board.net:2', category: 'board.net', value: { name: 'B' }, sourceArtifact: 'b.kicad_pcb', extractor: 'builtin.kicad-pcb@1', confidence: 'deterministic' }),
    createFact({ id: 'builtin.board.net:1', category: 'board.net', value: { name: 'A' }, sourceArtifact: 'b.kicad_pcb', extractor: 'builtin.kicad-pcb@1', confidence: 'deterministic' }),
    { id: 'builtin.board.net:1', category: 'board.net', value: { name: 'duplicate' }, sourceArtifact: 'b.kicad_pcb', extractor: 'other@1', confidence: 'heuristic' }
  ]);
  assert.deepEqual(result.facts.map((fact) => fact.id), ['builtin.board.net:1', 'builtin.board.net:2']);
  assert.equal(result.diagnostics.some((item) => item.code === 'ANALYZER_FACT_COLLISION'), true);
});

test('normalizeFacts chooses duplicate facts deterministically using provenance tie-breakers', () => {
  const first = createFact({ id: 'fact:1', category: 'board.net', value: { name: 'same' }, sourceArtifact: 'z.kicad_pcb', extractor: 'z@1', confidence: 'heuristic' });
  const second = createFact({ id: 'fact:1', category: 'board.net', value: { name: 'same' }, sourceArtifact: 'a.kicad_pcb', extractor: 'a@1', confidence: 'deterministic' });
  const forward = normalizeFacts([first, second]);
  const reversed = normalizeFacts([second, first]);
  assert.deepEqual(forward, reversed);
  assert.equal(forward.facts[0].sourceArtifact, 'a.kicad_pcb');
});

test('normalizeFinding requires an extractor provenance field', () => {
  assert.throws(() => normalizeFinding({ id: 'finding:1', severity: 'warning', confidence: 'heuristic', factIds: [], sourceArtifacts: [] }), /extractor/i);
  assert.equal(normalizeFinding({ id: 'finding:1', severity: 'warning', confidence: 'heuristic', factIds: [], sourceArtifacts: [], extractor: 'builtin@1' }).extractor, 'builtin@1');
});

test('normalizeFinding canonicalizes referenced IDs and artifact paths', () => {
  const finding = normalizeFinding({ id: 'finding:1', severity: 'warning', confidence: 'heuristic', extractor: 'builtin@1', factIds: ['b', 'a', 'b'], sourceArtifacts: ['z.kicad_sch', 'a.kicad_sch', 'z.kicad_sch'] });
  assert.deepEqual(finding.factIds, ['a', 'b']);
  assert.deepEqual(finding.sourceArtifacts, ['a.kicad_sch', 'z.kicad_sch']);
});

test('normalizeFacts sorts invalid diagnostics deterministically', () => {
  const invalidA = { id: 'fact:b' };
  const invalidB = { id: 'fact:a' };
  const forward = normalizeFacts([invalidA, invalidB]);
  const reversed = normalizeFacts([invalidB, invalidA]);
  assert.deepEqual(forward.diagnostics, reversed.diagnostics);
});

test('normalizeFacts keeps malformed fact IDs safe and preserves valid string IDs regardless of input order', () => {
  const malformedObjectId = {
    id: { unsafe: true }, category: 'board.net', value: {}, sourceArtifact: 'board.kicad_pcb', extractor: 'fixture@1', confidence: 'deterministic'
  };
  const malformedSymbolId = {
    id: Symbol('unsafe'), category: 'board.net', value: {}, sourceArtifact: 'board.kicad_pcb', extractor: 'fixture@1', confidence: 'deterministic'
  };
  const malformedUndefinedId = {
    id: undefined, category: 'board.net', value: {}, sourceArtifact: 'board.kicad_pcb', extractor: 'fixture@1', confidence: 'deterministic'
  };
  const malformedWithValidId = {
    id: 'fact:valid', category: 'board.net', value: {}, sourceArtifact: 'board.kicad_pcb', confidence: 'deterministic'
  };

  const forward = normalizeFacts([malformedObjectId, malformedSymbolId, malformedUndefinedId, malformedWithValidId]);
  const reversed = normalizeFacts([malformedWithValidId, malformedUndefinedId, malformedSymbolId, malformedObjectId]);

  assert.deepEqual(forward, reversed);
  assert.equal(JSON.stringify(forward.diagnostics), JSON.stringify(reversed.diagnostics));
  assert.deepEqual(forward.diagnostics.filter((diagnostic) => 'factId' in diagnostic).map((diagnostic) => diagnostic.factId), ['fact:valid']);
  assert.equal(forward.diagnostics.every((diagnostic) => typeof diagnostic.factId === 'string' || !('factId' in diagnostic)), true);
});
