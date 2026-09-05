import assert from 'node:assert/strict';
import test from 'node:test';

import { parseSExpression } from '../src/analyzer/sexpr.js';

test('parseSExpression preserves nested lists and unescapes quoted atoms', () => {
  const tree = parseSExpression('(root (name "A\\"B") (at 1.25 -2 90) bare)');
  assert.deepEqual(tree, ['root', ['name', 'A"B'], ['at', '1.25', '-2', '90'], 'bare']);
});

test('parseSExpression rejects unterminated strings and lists with a typed error', () => {
  assert.throws(() => parseSExpression('(root "unterminated'), (error) =>
    error.code === 'ANALYZER_PARSE_ERROR' && /unterminated/i.test(error.message));
});
