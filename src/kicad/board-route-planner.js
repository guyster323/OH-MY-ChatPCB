const EPSILON = 1e-9;

export function findGridRoute({
  start,
  end,
  netName,
  padGeometries = [],
  segments = [],
  outline,
  gridMm = 2,
  keepOutMm = 1,
  traceWidthMm = 0.2,
  maxLegMm = 30,
  layer = 'F.Cu'
}) {
  if (!start || !end || !outline || gridMm <= 0 || maxLegMm <= 0) {
    return null;
  }

  const xs = routeAxisCoordinates(outline.minX, outline.maxX, gridMm, start.x, end.x);
  const ys = routeAxisCoordinates(outline.minY, outline.maxY, gridMm, start.y, end.y);
  const startKey = pointKey(start);
  const endKey = pointKey(end);
  const open = [{ point: start, cost: 0, estimate: manhattanDistance(start, end), order: 0 }];
  const costs = new Map([[startKey, 0]]);
  const previous = new Map();
  const visited = new Set();
  let insertionOrder = 1;

  while (open.length > 0) {
    open.sort((a, b) => a.cost + a.estimate - (b.cost + b.estimate) || a.estimate - b.estimate || a.order - b.order);
    const current = open.shift();
    const currentKey = pointKey(current.point);
    if (visited.has(currentKey)) {
      continue;
    }
    if (currentKey === endKey) {
      return splitLongLegs(compressRoute(reconstructRoute(previous, current.point)), maxLegMm);
    }
    visited.add(currentKey);

    for (const neighbor of routeNeighbors(current.point, xs, ys)) {
      const neighborKey = pointKey(neighbor);
      if (
        visited.has(neighborKey) ||
        routeEdgeBlocked(current.point, neighbor, {
          netName,
          padGeometries,
          segments,
          keepOutMm,
          traceWidthMm,
          layer
        })
      ) {
        continue;
      }

      const nextCost = current.cost + manhattanDistance(current.point, neighbor);
      if (nextCost + EPSILON >= (costs.get(neighborKey) ?? Number.POSITIVE_INFINITY)) {
        continue;
      }

      costs.set(neighborKey, nextCost);
      previous.set(neighborKey, current.point);
      open.push({ point: neighbor, cost: nextCost, estimate: manhattanDistance(neighbor, end), order: insertionOrder });
      insertionOrder += 1;
    }
  }

  return null;
}

function routeAxisCoordinates(min, max, step, ...required) {
  const values = new Set(required.filter((value) => value >= min && value <= max).map(normalizedCoordinate));
  for (let value = min; value <= max + EPSILON; value += step) {
    values.add(normalizedCoordinate(Math.min(value, max)));
  }
  values.add(normalizedCoordinate(max));
  return [...values].sort((a, b) => a - b);
}

function routeNeighbors(point, xs, ys) {
  const xIndex = coordinateIndex(xs, point.x);
  const yIndex = coordinateIndex(ys, point.y);
  const neighbors = [];

  if (xIndex + 1 < xs.length) neighbors.push({ x: xs[xIndex + 1], y: point.y });
  if (yIndex + 1 < ys.length) neighbors.push({ x: point.x, y: ys[yIndex + 1] });
  if (xIndex > 0) neighbors.push({ x: xs[xIndex - 1], y: point.y });
  if (yIndex > 0) neighbors.push({ x: point.x, y: ys[yIndex - 1] });

  return neighbors;
}

function coordinateIndex(values, target) {
  return values.findIndex((value) => Math.abs(value - target) <= EPSILON);
}

function routeEdgeBlocked(start, end, options) {
  const clearance = options.keepOutMm + options.traceWidthMm / 2;
  const blockedByPad = options.padGeometries.some((pad) => {
    if (pad.netName === options.netName || !padTouchesLayer(pad, options.layer)) {
      return false;
    }
    return segmentIntersectsInflatedPad(start, end, pad, clearance);
  });
  if (blockedByPad) {
    return true;
  }

  return options.segments.some((segment) => {
    const segmentLayer = segment.layer ?? 'F.Cu';
    return segment.netName !== options.netName && segmentLayer === options.layer && segmentsIntersect(start, end, segment.start, segment.end);
  });
}

function padTouchesLayer(pad, layer) {
  return (pad.layers ?? []).some((padLayer) => padLayer === layer || padLayer === '*.Cu');
}

function segmentIntersectsInflatedPad(start, end, pad, clearance) {
  const localStart = rotateAroundPad(start, pad);
  const localEnd = rotateAroundPad(end, pad);
  const width = pad.width ?? 0;
  const height = pad.height ?? 0;

  if (pad.shape === 'circle') {
    return distancePointToSegment({ x: 0, y: 0 }, localStart, localEnd) <= Math.max(width, height) / 2 + clearance + EPSILON;
  }

  if (pad.shape === 'oval') {
    const radius = Math.min(width, height) / 2 + clearance;
    const halfSpine = Math.max(0, (Math.max(width, height) - Math.min(width, height)) / 2);
    const horizontal = width >= height;
    const spineStart = horizontal ? { x: -halfSpine, y: 0 } : { x: 0, y: -halfSpine };
    const spineEnd = horizontal ? { x: halfSpine, y: 0 } : { x: 0, y: halfSpine };
    return distanceBetweenSegments(localStart, localEnd, spineStart, spineEnd) <= radius + EPSILON;
  }

  return segmentIntersectsRectangle(
    localStart,
    localEnd,
    -width / 2 - clearance,
    width / 2 + clearance,
    -height / 2 - clearance,
    height / 2 + clearance
  );
}

function rotateAroundPad(point, pad) {
  const radians = -(pad.rotation ?? 0) * Math.PI / 180;
  const dx = point.x - pad.x;
  const dy = point.y - pad.y;
  return {
    x: dx * Math.cos(radians) - dy * Math.sin(radians),
    y: dx * Math.sin(radians) + dy * Math.cos(radians)
  };
}

function segmentIntersectsRectangle(start, end, minX, maxX, minY, maxY) {
  let lower = 0;
  let upper = 1;
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  for (const [origin, delta, min, max] of [
    [start.x, dx, minX, maxX],
    [start.y, dy, minY, maxY]
  ]) {
    if (Math.abs(delta) <= EPSILON) {
      if (origin < min - EPSILON || origin > max + EPSILON) return false;
      continue;
    }
    const first = (min - origin) / delta;
    const second = (max - origin) / delta;
    lower = Math.max(lower, Math.min(first, second));
    upper = Math.min(upper, Math.max(first, second));
    if (lower > upper + EPSILON) return false;
  }

  return true;
}

function distanceBetweenSegments(firstStart, firstEnd, secondStart, secondEnd) {
  if (segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) {
    return 0;
  }
  return Math.min(
    distancePointToSegment(firstStart, secondStart, secondEnd),
    distancePointToSegment(firstEnd, secondStart, secondEnd),
    distancePointToSegment(secondStart, firstStart, firstEnd),
    distancePointToSegment(secondEnd, firstStart, firstEnd)
  );
}

function distancePointToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + ratio * dx), point.y - (start.y + ratio * dy));
}

function segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd) {
  const orientation = (start, end, point) => (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
  const onSegment = (start, end, point) =>
    Math.abs(orientation(start, end, point)) <= EPSILON &&
    point.x >= Math.min(start.x, end.x) - EPSILON && point.x <= Math.max(start.x, end.x) + EPSILON &&
    point.y >= Math.min(start.y, end.y) - EPSILON && point.y <= Math.max(start.y, end.y) + EPSILON;
  const a = orientation(firstStart, firstEnd, secondStart);
  const b = orientation(firstStart, firstEnd, secondEnd);
  const c = orientation(secondStart, secondEnd, firstStart);
  const d = orientation(secondStart, secondEnd, firstEnd);

  return (
    (a > EPSILON && b < -EPSILON || a < -EPSILON && b > EPSILON) &&
    (c > EPSILON && d < -EPSILON || c < -EPSILON && d > EPSILON)
  ) || onSegment(firstStart, firstEnd, secondStart) || onSegment(firstStart, firstEnd, secondEnd) ||
    onSegment(secondStart, secondEnd, firstStart) || onSegment(secondStart, secondEnd, firstEnd);
}

function reconstructRoute(previous, end) {
  const route = [end];
  let current = end;
  while (previous.has(pointKey(current))) {
    current = previous.get(pointKey(current));
    route.push(current);
  }
  return route.reverse();
}

function compressRoute(route) {
  if (route.length <= 2) return route;
  const compressed = [route[0]];
  for (let index = 1; index < route.length - 1; index += 1) {
    const previous = compressed.at(-1);
    const current = route[index];
    const next = route[index + 1];
    const sameX = Math.abs(previous.x - current.x) <= EPSILON && Math.abs(current.x - next.x) <= EPSILON;
    const sameY = Math.abs(previous.y - current.y) <= EPSILON && Math.abs(current.y - next.y) <= EPSILON;
    if (!sameX && !sameY) compressed.push(current);
  }
  compressed.push(route.at(-1));
  return compressed;
}

function splitLongLegs(route, maxLegMm) {
  const split = [route[0]];
  for (let index = 1; index < route.length; index += 1) {
    const start = split.at(-1);
    const end = route[index];
    const distance = manhattanDistance(start, end);
    for (let traveled = maxLegMm; traveled < distance; traveled += maxLegMm) {
      const ratio = traveled / distance;
      split.push({
        x: normalizedCoordinate(start.x + (end.x - start.x) * ratio),
        y: normalizedCoordinate(start.y + (end.y - start.y) * ratio)
      });
    }
    split.push(end);
  }
  return split;
}

function manhattanDistance(first, second) {
  return Math.abs(second.x - first.x) + Math.abs(second.y - first.y);
}

function pointKey(point) {
  return `${normalizedCoordinate(point.x)},${normalizedCoordinate(point.y)}`;
}

function normalizedCoordinate(value) {
  return Number(value.toFixed(6));
}
