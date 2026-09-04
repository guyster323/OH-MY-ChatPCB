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

test('normalizeFacts sorts invalid diagnostics deterministically', () => {
  const invalidA = { id: 'fact:b' };
  const invalidB = { id: 'fact:a' };
  const forward = normalizeFacts([invalidA, invalidB]);
  const reversed = normalizeFacts([invalidB, invalidA]);
  assert.deepEqual(forward.diagnostics, reversed.diagnostics);
});
