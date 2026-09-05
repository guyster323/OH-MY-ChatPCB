const CONFIDENCES = new Set(['deterministic', 'heuristic', 'datasheet-backed']);
const SEVERITIES = new Set(['info', 'warning', 'blocker']);
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function diagnosticFactId(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item) ?? 'null').join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function createFact({ id, category, value, sourceArtifact, extractor, confidence } = {}) {
  requiredString(id, 'fact id');
  requiredString(category, 'fact category');
  requiredString(sourceArtifact, 'fact sourceArtifact');
  requiredString(extractor, 'fact extractor');
  if (!CONFIDENCES.has(confidence)) throw new TypeError('fact confidence must be deterministic, heuristic, or datasheet-backed');
  return { id, category, value: clone(value), sourceArtifact, extractor, confidence };
}

export function normalizeFacts(facts) {
  if (!Array.isArray(facts)) throw new TypeError('facts must be an array');
  const valid = [];
  const diagnostics = [];
  for (const fact of facts) {
    try { valid.push(createFact(fact)); }
    catch (cause) {
      const diagnostic = { code: 'ANALYZER_FACT_INVALID', message: cause.message };
      const factId = diagnosticFactId(fact?.id);
      if (factId !== undefined) diagnostic.factId = factId;
      diagnostics.push(diagnostic);
    }
  }
  valid.sort((left, right) => compare(left.id, right.id) || compare(left.category, right.category) || compare(canonicalJson(left.value), canonicalJson(right.value)) || compare(left.sourceArtifact, right.sourceArtifact) || compare(left.extractor, right.extractor) || compare(left.confidence, right.confidence));
  const result = [];
  for (const fact of valid) {
    if (result.some((existing) => existing.id === fact.id)) {
      diagnostics.push({ code: 'ANALYZER_FACT_COLLISION', message: `Duplicate fact ID: ${fact.id}`, factId: fact.id });
    } else result.push(fact);
  }
  diagnostics.sort((left, right) => compare(left.code, right.code) || compare(left.factId ?? '', right.factId ?? '') || compare(left.message, right.message));
  return { facts: result, diagnostics };
}

export function normalizeFinding(finding = {}) {
  if (!finding || typeof finding !== 'object' || Array.isArray(finding)) throw new TypeError('finding must be an object');
  const id = requiredString(finding.id, 'finding id');
  const extractor = requiredString(finding.extractor, 'finding extractor');
  if (!SEVERITIES.has(finding.severity)) throw new TypeError('finding severity must be info, warning, or blocker');
  if (!CONFIDENCES.has(finding.confidence)) throw new TypeError('finding confidence must be deterministic, heuristic, or datasheet-backed');
  if (!Array.isArray(finding.factIds) || finding.factIds.some((item) => typeof item !== 'string' || item.trim() === '')) throw new TypeError('finding factIds must be an array of non-empty strings');
  if (!Array.isArray(finding.sourceArtifacts) || finding.sourceArtifacts.some((item) => typeof item !== 'string' || item.trim() === '')) throw new TypeError('finding sourceArtifacts must be an array of non-empty strings');
  return { ...clone(finding), id, extractor, severity: finding.severity, confidence: finding.confidence, factIds: [...new Set(finding.factIds)].sort(compare), sourceArtifacts: [...new Set(finding.sourceArtifacts)].sort(compare) };
}
