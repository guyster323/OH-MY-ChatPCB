import assert from 'node:assert/strict';
import test from 'node:test';

import { createFact, normalizeFacts } from '../src/analyzer/fact-contract.js';

test('normalizeFacts sorts facts and rejects duplicate fully-qualified IDs', () => {
  const result = normalizeFacts([
    createFact({ id: 'builtin.board.net:2', category: 'board.net', value: { name: 'B' }, sourceArtifact: 'b.kicad_pcb', extractor: 'builtin.kicad-pcb@1', confidence: 'deterministic' }),
    createFact({ id: 'builtin.board.net:1', category: 'board.net', value: { name: 'A' }, sourceArtifact: 'b.kicad_pcb', extractor: 'builtin.kicad-pcb@1', confidence: 'deterministic' }),
    { id: 'builtin.board.net:1', category: 'board.net', value: { name: 'duplicate' }, sourceArtifact: 'b.kicad_pcb', extractor: 'other@1', confidence: 'heuristic' }
  ]);
  assert.deepEqual(result.facts.map((fact) => fact.id), ['builtin.board.net:1', 'builtin.board.net:2']);
  assert.equal(result.diagnostics.some((item) => item.code === 'ANALYZER_FACT_COLLISION'), true);
});
