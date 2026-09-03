import assert from 'node:assert/strict';
import test from 'node:test';

import { findGridRoute } from '../src/kicad/board-route-planner.js';

const outline = { minX: 0, minY: 0, maxX: 60, maxY: 30 };

function routeOptions(overrides = {}) {
  return {
    start: { x: 10, y: 10 },
    end: { x: 50, y: 10 },
    netName: 'RESET',
    padGeometries: [],
    segments: [],
    outline,
    gridMm: 2,
    keepOutMm: 1,
    traceWidthMm: 0.2,
    maxLegMm: 30,
    layer: 'F.Cu',
    ...overrides
  };
}

test('findGridRoute avoids the physical boundary of a different-net rectangular pad', () => {
  const route = findGridRoute(routeOptions({
    padGeometries: [
      {
        x: 30,
        y: 13,
        shape: 'rect',
        width: 20,
        height: 4,
        rotation: 0,
        layers: ['F.Cu'],
        netName: 'GND',
        ref: 'JX'
      }
    ]
  }));

  assert.ok(route);
  assert.ok(route.some((point) => point.y !== 10));
  assert.equal(route.every((point) => point.x >= 0 && point.x <= 60 && point.y >= 0 && point.y <= 30), true);
});

test('findGridRoute ignores pads and traces on another copper layer', () => {
  const route = findGridRoute(routeOptions({
    padGeometries: [
      {
        x: 30,
        y: 10,
        shape: 'rect',
        width: 10,
        height: 10,
        rotation: 0,
        layers: ['B.Cu'],
        netName: 'GND',
        ref: 'JX'
      }
    ],
    segments: [
      {
        start: { x: 30, y: 0 },
        end: { x: 30, y: 20 },
        netName: 'BOOT',
        layer: 'B.Cu'
      }
    ]
  }));

  assert.deepEqual(route, [
    { x: 10, y: 10 },
    { x: 40, y: 10 },
    { x: 50, y: 10 }
  ]);
});

test('findGridRoute is deterministic and limits compressed legs', () => {
  const options = routeOptions({
    start: { x: 2, y: 2 },
    end: { x: 58, y: 28 },
    padGeometries: [
      {
        x: 30,
        y: 14,
        shape: 'oval',
        width: 8,
        height: 14,
        rotation: 35,
        layers: ['F.Cu'],
        netName: '+3V3',
        ref: 'U1'
      }
    ]
  });

  const first = findGridRoute(options);
  const second = findGridRoute(options);

  assert.deepEqual(first, second);
  assert.ok(first);
  assert.equal(
    first.slice(1).every((point, index) => Math.hypot(point.x - first[index].x, point.y - first[index].y) <= 30),
    true
  );
});

test('findGridRoute returns null when a physical pad barrier closes every corridor', () => {
  const route = findGridRoute(routeOptions({
    start: { x: 2, y: 10 },
    end: { x: 18, y: 10 },
    outline: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    keepOutMm: 0,
    padGeometries: [
      {
        x: 10,
        y: 10,
        shape: 'rect',
        width: 2,
        height: 20,
        rotation: 0,
        layers: ['F.Cu'],
        netName: 'GND',
        ref: 'JX'
      }
    ]
  }));

  assert.equal(route, null);
});
