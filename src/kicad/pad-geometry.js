export function boardPadGeometry(padBlock, footprintPosition = {}) {
  const localAt = padBlock.match(/\(at\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)(?:\s+(-?\d+(?:\.\d+)?))?/);
  const size = padBlock.match(/\(size\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/);
  const layers = padBlock.match(/\(layers\s+([^\)]+)\)/);
  if (!localAt || !size || !layers) {
    return null;
  }

  const localX = Number(localAt[1]);
  const localY = Number(localAt[2]);
  const footprintRotation = footprintPosition.rotation ?? 0;
  const radians = footprintRotation * Math.PI / 180;
  return {
    ref: footprintPosition.ref,
    x: (footprintPosition.x ?? 0) + localX * Math.cos(radians) - localY * Math.sin(radians),
    y: (footprintPosition.y ?? 0) + localX * Math.sin(radians) + localY * Math.cos(radians),
    width: Number(size[1]),
    height: Number(size[2]),
    rotation: footprintRotation + Number(localAt[3] ?? 0),
    layers: [...layers[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]).filter((layer) => layer.endsWith('.Cu'))
  };
}
