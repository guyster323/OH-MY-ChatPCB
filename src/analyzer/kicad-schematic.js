import { createFact, normalizeFacts, normalizeFinding } from './fact-contract.js';
import { parseSExpression, SExpressionParseError } from './sexpr.js';

const EXTRACTOR = 'builtin.kicad-schematic@1';

function children(node, name) {
  return node.filter((item) => Array.isArray(item) && item[0] === name);
}

function child(node, name) {
  return children(node, name)[0];
}

function number(value) {
  return Number(value);
}

function isFiniteNumber(value) {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
}

function at(node) {
  const position = child(node, 'at');
  if (!position) return undefined;
  return { x: number(position[1]), y: number(position[2]), rotation: number(position[3] ?? 0) };
}

function validateAt(node, nodeName) {
  const position = child(node, 'at');
  if (!position) return `${nodeName} requires an at coordinate`;
  if (!isFiniteNumber(position[1]) || !isFiniteNumber(position[2]) || (position[3] !== undefined && !isFiniteNumber(position[3]))) {
    return `${nodeName} has invalid at coordinates`;
  }
  return undefined;
}

function validateSchematic(root) {
  if (!Array.isArray(root) || root[0] !== 'kicad_sch') return 'expected kicad_sch root';
  for (const symbol of children(root, 'symbol')) {
    const error = validateAt(symbol, 'symbol');
    if (error) return error;
    const unit = child(symbol, 'unit');
    if (unit && !isFiniteNumber(unit[1])) return 'symbol has invalid unit';
  }
  for (const label of children(root, 'label')) {
    if (typeof label[1] !== 'string' || label[1].trim() === '') return 'label requires non-empty text';
    const error = validateAt(label, 'label');
    if (error) return error;
  }
  for (const wire of children(root, 'wire')) {
    const points = children(child(wire, 'pts') ?? [], 'xy');
    if (points.length < 2) return 'wire requires at least two xy points';
    if (points.some((point) => !isFiniteNumber(point[1]) || !isFiniteNumber(point[2]))) return 'wire has invalid xy coordinates';
  }
  for (const junction of children(root, 'junction')) {
    const error = validateAt(junction, 'junction');
    if (error) return error;
  }
  for (const noConnect of children(root, 'no_connect')) {
    const error = validateAt(noConnect, 'no_connect');
    if (error) return error;
  }
  return undefined;
}

function properties(symbol) {
  return Object.fromEntries(children(symbol, 'property').map((property) => [property[1], property[2]]));
}

function emptySummary() {
  return { formatVersion: undefined, symbolCount: 0, labelCount: 0, wireCount: 0, junctionCount: 0, noConnectCount: 0 };
}

function parseFailure(error, sourceArtifact) {
  return {
    facts: [],
    findings: [],
    diagnostics: [{ code: error.code, message: error.message, sourceArtifact }],
    summary: emptySummary()
  };
}

function sortByPositionAndText(left, right) {
  return left.position.x - right.position.x || left.position.y - right.position.y || left.text.localeCompare(right.text) || left.position.rotation - right.position.rotation;
}

export function analyzeSchematic({ source, sourceArtifact } = {}) {
  let root;
  try {
    root = parseSExpression(source, { sourcePath: sourceArtifact });
  } catch (error) {
    if (!(error instanceof SExpressionParseError)) throw error;
    return parseFailure(error, sourceArtifact);
  }
  const structureError = validateSchematic(root);
  if (structureError) return parseFailure(new SExpressionParseError(structureError, sourceArtifact), sourceArtifact);

  const symbols = children(root, 'symbol');
  const labels = children(root, 'label').map((node) => ({ text: node[1], position: at(node) }));
  const wires = children(root, 'wire');
  const junctions = children(root, 'junction');
  const noConnects = children(root, 'no_connect');
  const summary = {
    formatVersion: child(root, 'version')?.[1],
    symbolCount: symbols.length,
    labelCount: labels.length,
    wireCount: wires.length,
    junctionCount: junctions.length,
    noConnectCount: noConnects.length
  };
  const facts = [];
  const findings = [];

  for (const symbol of symbols) {
    const values = properties(symbol);
    const position = at(symbol) ?? { x: undefined, y: undefined, rotation: 0 };
    const uuid = child(symbol, 'uuid')?.[1];
    const reference = values.Reference;
    const footprint = values.Footprint;
    const fact = createFact({
      id: uuid ? `builtin.schematic.component:${uuid}` : `builtin.schematic.component:ref:${reference ?? ''}`,
      category: 'schematic.component',
      value: {
        uuid,
        reference,
        value: values.Value,
        libId: child(symbol, 'lib_id')?.[1],
        footprint,
        position: { x: position.x, y: position.y },
        rotation: position.rotation,
        unit: number(child(symbol, 'unit')?.[1] ?? 1)
      },
      sourceArtifact,
      extractor: EXTRACTOR,
      confidence: 'deterministic'
    });
    facts.push(fact);
    if (!reference || !footprint) {
      findings.push(normalizeFinding({
        id: `builtin.schematic.component-metadata:${fact.id}`,
        extractor: EXTRACTOR,
        severity: 'warning',
        confidence: 'deterministic',
        factIds: [fact.id],
        sourceArtifacts: [sourceArtifact],
        message: `Component ${reference || uuid || fact.id} is missing ${[!reference && 'Reference', !footprint && 'Footprint'].filter(Boolean).join(' and ')}`
      }));
    }
  }

  const sortedLabels = labels
    .filter((label) => label.position && typeof label.text === 'string')
    .sort(sortByPositionAndText);
  for (const [index, label] of sortedLabels.entries()) {
    facts.push(createFact({
      id: `builtin.schematic.label:${index}`,
      category: 'schematic.label',
      value: { text: label.text, position: { x: label.position.x, y: label.position.y }, rotation: label.position.rotation },
      sourceArtifact,
      extractor: EXTRACTOR,
      confidence: 'deterministic'
    }));
  }

  for (const [index, wire] of wires.entries()) {
    facts.push(createFact({ id: `builtin.schematic.wire:${index}`, category: 'schematic.wire', value: { points: children(child(wire, 'pts') ?? [], 'xy').map((point) => ({ x: number(point[1]), y: number(point[2]) })) }, sourceArtifact, extractor: EXTRACTOR, confidence: 'deterministic' }));
  }
  for (const [index, junction] of junctions.entries()) {
    const position = at(junction);
    facts.push(createFact({ id: `builtin.schematic.junction:${index}`, category: 'schematic.junction', value: { position: position && { x: position.x, y: position.y } }, sourceArtifact, extractor: EXTRACTOR, confidence: 'deterministic' }));
  }
  for (const [index, noConnect] of noConnects.entries()) {
    const position = at(noConnect);
    facts.push(createFact({ id: `builtin.schematic.no-connect:${index}`, category: 'schematic.no_connect', value: { position: position && { x: position.x, y: position.y } }, sourceArtifact, extractor: EXTRACTOR, confidence: 'deterministic' }));
  }

  const labelsByText = new Map();
  for (const fact of facts.filter((item) => item.category === 'schematic.label')) {
    const groupedLabels = labelsByText.get(fact.value.text) ?? [];
    groupedLabels.push(fact);
    labelsByText.set(fact.value.text, groupedLabels);
  }
  for (const [text, groupedLabels] of labelsByText) {
    facts.push(createFact({
      id: `builtin.schematic.net:${text}`,
      category: 'schematic.net',
      value: { name: text, labelFactIds: groupedLabels.map((fact) => fact.id).sort() },
      sourceArtifact,
      extractor: EXTRACTOR,
      confidence: 'deterministic'
    }));
  }

  const normalized = normalizeFacts(facts);
  return {
    facts: normalized.facts,
    findings: findings.sort((left, right) => left.id.localeCompare(right.id)),
    diagnostics: normalized.diagnostics,
    summary
  };
}
