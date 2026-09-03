import assert from 'node:assert/strict';
import test from 'node:test';

import { boardPadGeometry } from '../src/kicad/pad-geometry.js';

test('boardPadGeometry preserves a rotated pad center and copper dimensions', () => {
  const geometry = boardPadGeometry(
    `(pad "1" smd rect
      (at -2.625 -0.85 180)
      (size 1.55 1)
      (layers "F.Cu" "F.Mask" "F.Paste")
    )`,
    { ref: 'SW1', x: 91, y: 25, rotation: 0 }
  );

  assert.deepEqual(geometry, {
    ref: 'SW1',
    x: 88.375,
    y: 24.15,
    shape: 'rect',
    width: 1.55,
    height: 1,
    rotation: 180,
    layers: ['F.Cu']
  });
});
