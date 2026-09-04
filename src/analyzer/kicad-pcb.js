import { createFact, normalizeFacts, normalizeFinding } from './fact-contract.js';
import { parseSExpression, SExpressionParseError } from './sexpr.js';

const EXTRACTOR = 'builtin.kicad-pcb@1';

function children(node, name) {
  return Array.isArray(node) ? node.filter((item) => Array.isArray(item) && item[0] === name) : [];
}

function child(node, name) {
  return children(node, name)[0];
}

function numeric(value) {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
}

function asNumber(value) {
  return Number(value);
}

function emptySummary() {
  return {
    formatVersion: undefined,
    layers: [],
    outline: false,
    footprintCount: 0,
    padCount: 0,
    segmentCount: 0,
    viaCount: 0,
    zoneCount: 0,
    graphicCount: 0
  };
}

function parseFailure(error, sourceArtifact) {
  return { facts: [], findings: [], diagnostics: [{ code: error.code, message: error.message, sourceArtifact }], summary: emptySummary() };
}

function position(node, name, { rotation = true } = {}) {
  const at = child(node, 'at');
  if (!at) throw new Error(`${name} requires an at coordinate`);
  if (!numeric(at[1]) || !numeric(at[2]) || (rotation && at[3] !== undefined && !numeric(at[3]))) throw new Error(`${name} has invalid at coordinates`);
  return { x: asNumber(at[1]), y: asNumber(at[2]), rotation: rotation ? asNumber(at[3] ?? 0) : undefined };
}

function point(node, name) {
  if (!node) throw new Error(`${name} requires coordinates`);
  if (!numeric(node[1]) || !numeric(node[2])) throw new Error(`${name} has invalid coordinates`);
  return { x: asNumber(node[1]), y: asNumber(node[2]) };
}

function properties(node) {
  return Object.fromEntries(children(node, 'property').map((property) => [property[1], property[2]]));
}

function boardError(root) {
  if (!Array.isArray(root) || root[0] !== 'kicad_pcb') return 'expected kicad_pcb root';
  for (const layer of children(root, 'layers')) {
    for (const entry of layer.filter(Array.isArray)) {
      if (!numeric(entry[0]) || typeof entry[1] !== 'string') return 'layer has invalid ID or name';
    }
  }
  for (const net of children(root, 'net')) if (!numeric(net[1]) || typeof net[2] !== 'string') return 'net has invalid ID or name';
  try {
    for (const footprint of children(root, 'footprint')) {
      position(footprint, 'footprint');
      for (const pad of children(footprint, 'pad')) {
        if (typeof pad[1] !== 'string') return 'pad requires a number';
        position(pad, 'pad');
        const size = child(pad, 'size');
        if (!size || !numeric(size[1]) || !numeric(size[2])) return 'pad requires a valid size';
        const net = child(pad, 'net');
        if (net && (!numeric(net[1]) || typeof net[2] !== 'string')) return 'pad has invalid net';
      }
    }
    for (const segment of children(root, 'segment')) {
      point(child(segment, 'start'), 'segment start');
      point(child(segment, 'end'), 'segment end');
      const width = child(segment, 'width');
      const layer = child(segment, 'layer');
      const net = child(segment, 'net');
      if (!width || !numeric(width[1]) || !layer || typeof layer[1] !== 'string' || !net || !numeric(net[1])) return 'segment has invalid width, layer, or net';
    }
    for (const via of children(root, 'via')) {
      position(via, 'via');
      const size = child(via, 'size');
      const drill = child(via, 'drill');
      const layers = child(via, 'layers');
      const net = child(via, 'net');
      if (!size || !numeric(size[1]) || !drill || !numeric(drill[1]) || !layers || layers.slice(1).some((item) => typeof item !== 'string') || !net || !numeric(net[1])) return 'via has invalid size, drill, layers, or net';
    }
  } catch (error) {
    return error.message;
  }
  return undefined;
}

function graphicNodes(root) {
  return root.filter((node) => Array.isArray(node) && typeof node[0] === 'string' && node[0].startsWith('gr_'));
}

export function analyzePcb({ source, sourceArtifact } = {}) {
  let root;
  try {
    root = parseSExpression(source, { sourcePath: sourceArtifact });
  } catch (error) {
    if (!(error instanceof SExpressionParseError)) throw error;
    return parseFailure(error, sourceArtifact);
  }
  const structureError = boardError(root);
  if (structureError) return parseFailure(new SExpressionParseError(structureError, sourceArtifact), sourceArtifact);

  const layerEntries = children(root, 'layers').flatMap((layers) => layers.filter(Array.isArray));
  const layers = layerEntries.slice().sort((left, right) => asNumber(left[0]) - asNumber(right[0]) || left[1].localeCompare(right[1])).map((layer) => layer[1]);
  const nets = children(root, 'net').map((net) => ({ id: asNumber(net[1]), name: net[2] }));
  const footprints = children(root, 'footprint');
  const segments = children(root, 'segment');
  const vias = children(root, 'via');
  const zones = children(root, 'zone');
  const graphics = graphicNodes(root);
  const pads = footprints.flatMap((footprint) => children(footprint, 'pad'));
  const summary = {
    formatVersion: child(root, 'version')?.[1], layers,
    outline: graphics.some((graphic) => child(graphic, 'layer')?.[1] === 'Edge.Cuts'),
    footprintCount: footprints.length, padCount: pads.length, segmentCount: segments.length,
    viaCount: vias.length, zoneCount: zones.length, graphicCount: graphics.length
  };
  const facts = [];
  const findings = [];
  const netNames = new Map(nets.map((net) => [net.id, net.name]));

  for (const net of nets) facts.push(createFact({ id: `builtin.board.net:${net.id}`, category: 'board.net', value: net, sourceArtifact, extractor: EXTRACTOR, confidence: 'deterministic' }));

  const padFactsByNet = new Map();
  for (const footprint of footprints) {
    const footprintPosition = position(footprint, 'footprint');
    const values = properties(footprint);
    const footprintId = child(footprint, 'uuid')?.[1] ?? values.Reference ?? '';
    const footprintFactId = `builtin.board.footprint:${footprintId}`;
    facts.push(createFact({
      id: footprintFactId, category: 'board.footprint',
      value: { id: footprintId, reference: values.Reference, value: values.Value, library: footprint[1], position: { x: footprintPosition.x, y: footprintPosition.y }, rotation: footprintPosition.rotation },
      sourceArtifact, extractor: EXTRACTOR, confidence: 'deterministic'
    }));
    for (const pad of children(footprint, 'pad')) {
      const padPosition = position(pad, 'pad');
      const size = child(pad, 'size');
      const net = child(pad, 'net');
      const netId = net ? asNumber(net[1]) : null;
      const padFact = createFact({
        id: `builtin.board.pad:${footprintId}:${pad[1]}`, category: 'board.pad',
        value: {
          footprintId, number: pad[1], type: pad[2], shape: pad[3], position: { x: padPosition.x, y: padPosition.y }, rotation: padPosition.rotation,
          footprintPosition: { x: footprintPosition.x, y: footprintPosition.y }, footprintRotation: footprintPosition.rotation,
          size: { x: asNumber(size[1]), y: asNumber(size[2]) }, layers: (child(pad, 'layers')?.slice(1) ?? []).slice().sort(), netId, netName: netId === null ? null : (netNames.get(netId) ?? net[2] ?? null)
        }, sourceArtifact, extractor: EXTRACTOR, confidence: 'deterministic'
      });
      facts.push(padFact);
      if (netId !== null) {
        const grouped = padFactsByNet.get(netId) ?? [];
        grouped.push(padFact.id);
        padFactsByNet.set(netId, grouped);
        if (!netNames.has(netId)) findings.push(normalizeFinding({
          id: `builtin.board.pad-undeclared-net:${padFact.id}`, extractor: EXTRACTOR, severity: 'warning', confidence: 'deterministic', factIds: [padFact.id], sourceArtifacts: [sourceArtifact],
          message: `Pad ${padFact.id} references undeclared net ID ${netId}`
        }));
      }
    }
  }

  for (const [index, segment] of segments.entries()) {
    facts.push(createFact({ id: `builtin.board.segment:${index}`, category: 'board.segment', value: { start: point(child(segment, 'start'), 'segment start'), end: point(child(segment, 'end'), 'segment end'), width: asNumber(child(segment, 'width')[1]), layer: child(segment, 'layer')[1], netId: asNumber(child(segment, 'net')[1]) }, sourceArtifact, extractor: EXTRACTOR, confidence: 'deterministic' }));
  }
  for (const [index, via] of vias.entries()) {
    const viaPosition = position(via, 'via');
    facts.push(createFact({ id: `builtin.board.via:${index}`, category: 'board.via', value: { position: { x: viaPosition.x, y: viaPosition.y }, size: asNumber(child(via, 'size')[1]), drill: asNumber(child(via, 'drill')[1]), layers: child(via, 'layers').slice(1).slice().sort(), netId: asNumber(child(via, 'net')[1]) }, sourceArtifact, extractor: EXTRACTOR, confidence: 'deterministic' }));
  }
  facts.push(createFact({ id: 'builtin.board.summary', category: 'board.summary', value: summary, sourceArtifact, extractor: EXTRACTOR, confidence: 'deterministic' }));

  const evidenceNetIds = new Set([...segments, ...vias].map((node) => asNumber(child(node, 'net')[1])));
  const unroutedNetIds = nets.filter((net) => net.name && ((padFactsByNet.get(net.id)?.length ?? 0) < 2 || !evidenceNetIds.has(net.id))).map((net) => net.id).sort((left, right) => left - right);
  facts.push(createFact({ id: 'builtin.board.unrouted', category: 'board.unrouted', value: { netIds: unroutedNetIds }, sourceArtifact, extractor: EXTRACTOR, confidence: 'heuristic' }));

  const normalized = normalizeFacts(facts);
  return { facts: normalized.facts, findings: findings.sort((left, right) => left.id.localeCompare(right.id)), diagnostics: normalized.diagnostics, summary };
}
