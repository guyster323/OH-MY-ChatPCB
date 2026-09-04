import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { analyzePcb } from './kicad-pcb.js';
import { analyzeSchematic } from './kicad-schematic.js';
import { normalizeFacts, normalizeFinding } from './fact-contract.js';
import { collectArtifactInventory } from '../evidence/artifact-inventory.js';
import { runConfiguredAnalyzer } from './external-adapter.js';

const BUILTIN_ANALYZER = {
  id: 'builtin.kicad',
  namespace: 'builtin',
  version: '1'
};

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function compareDiagnostics(left, right) {
  return compareText(left.code ?? '', right.code ?? '')
    || compareText(left.sourceKind ?? '', right.sourceKind ?? '')
    || compareText(left.sourceArtifact ?? '', right.sourceArtifact ?? '')
    || compareText(left.factId ?? '', right.factId ?? '')
    || compareText(left.message ?? '', right.message ?? '');
}

function inputChangedResult(sourceArtifacts) {
  return {
    facts: [],
    findings: [],
    analyzers: [{
      ...BUILTIN_ANALYZER,
      status: 'failed',
      sourceArtifacts,
      diagnostics: [{ code: 'ANALYZER_INPUT_CHANGED', message: 'Project artifact digest changed during analysis' }]
    }]
  };
}

function sourceArtifactsFrom(inventory) {
  return inventory.artifacts
    .filter((artifact) => artifact.path.endsWith('.kicad_sch') || artifact.path.endsWith('.kicad_pcb'))
    .map((artifact) => artifact.path)
    .sort(compareText);
}

function missingSourceDiagnostic(extension, sourceKind) {
  return {
    code: 'ANALYZER_SOURCE_MISSING',
    message: `No ${extension} source artifact found`,
    sourceKind
  };
}

function sourceType(artifactPath) {
  if (artifactPath.endsWith('.kicad_sch')) return 'schematic';
  if (artifactPath.endsWith('.kicad_pcb')) return 'board';
  return null;
}

function scopeArtifactResult(result, artifactPath, shouldScope) {
  if (!shouldScope) return result;
  const factIds = new Map(result.facts.map((fact) => [fact.id, scopedId(fact.id, artifactPath)]));
  return {
    ...result,
    facts: result.facts.map((fact) => ({
      ...fact,
      id: factIds.get(fact.id),
      value: remapFactReferences(fact.value, factIds)
    })),
    findings: result.findings.map((finding) => ({
      ...finding,
      id: scopedId(finding.id, artifactPath),
      factIds: finding.factIds.map((factId) => factIds.get(factId) ?? factId)
    }))
  };
}

function scopedId(id, artifactPath) {
  return `${id}@${Buffer.from(artifactPath, 'utf8').toString('base64url')}`;
}

function remapFactReferences(value, factIds) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.labelFactIds)) return value;
  return { ...value, labelFactIds: value.labelFactIds.map((factId) => factIds.get(factId) ?? factId) };
}

function sourceReadDiagnostic(error, artifact) {
  return {
    code: 'ANALYZER_SOURCE_READ_ERROR',
    message: `Could not read source artifact ${artifact.path}: ${error.code ?? error.message}`,
    sourceArtifact: artifact.path
  };
}

function normalizeFindings(findings) {
  return findings.slice().sort((left, right) => compareText(left.id, right.id)
    || compareText(left.extractor, right.extractor)
    || compareText(left.message ?? '', right.message ?? ''));
}

export async function analyzeProject({
  projectDir,
  inventory,
  analyzerAdapters = [],
  readFileImpl = readFile,
  collectInventoryImpl = collectArtifactInventory
} = {}) {
  if (!inventory || !Array.isArray(inventory.artifacts) || typeof inventory.projectDigest !== 'string') {
    throw new TypeError('inventory with artifacts and projectDigest is required');
  }

  const sourceArtifacts = sourceArtifactsFrom(inventory);
  const initialInventory = await collectInventoryImpl({ projectDir });
  if (initialInventory.projectDigest !== inventory.projectDigest) return inputChangedResult(sourceArtifacts);

  const sources = inventory.artifacts
    .filter((artifact) => artifact.path.endsWith('.kicad_sch') || artifact.path.endsWith('.kicad_pcb'))
    .slice()
    .sort((left, right) => compareText(left.path, right.path));
  const sourceCounts = new Map();
  for (const artifact of sources) {
    const type = sourceType(artifact.path);
    sourceCounts.set(type, (sourceCounts.get(type) ?? 0) + 1);
  }
  const reads = await Promise.allSettled(sources.map(async (artifact) => ({
    artifact,
    source: asUtf8(await readFileImpl(path.join(projectDir, artifact.path)))
  })));

  const failedReads = reads.flatMap((read, index) => read.status === 'rejected' ? [{ artifact: sources[index], error: read.reason }] : []);
  if (failedReads.length > 0) {
    const inventoryAfterReadFailure = await collectInventoryImpl({ projectDir });
    if (inventoryAfterReadFailure.projectDigest !== inventory.projectDigest) return inputChangedResult(sourceArtifacts);
  }
  const contents = reads.flatMap((read) => read.status === 'fulfilled' ? [read.value] : []);

  const diagnostics = failedReads.map(({ artifact, error }) => sourceReadDiagnostic(error, artifact));
  const facts = [];
  const findings = [];
  if ((sourceCounts.get('schematic') ?? 0) === 0) diagnostics.push(missingSourceDiagnostic('.kicad_sch', 'schematic'));
  if ((sourceCounts.get('board') ?? 0) === 0) diagnostics.push(missingSourceDiagnostic('.kicad_pcb', 'board'));

  for (const { artifact, source } of contents) {
    const result = artifact.path.endsWith('.kicad_sch')
      ? analyzeSchematic({ source, sourceArtifact: artifact.path })
      : analyzePcb({ source, sourceArtifact: artifact.path });
    const scoped = scopeArtifactResult(result, artifact.path, (sourceCounts.get(sourceType(artifact.path)) ?? 0) > 1);
    facts.push(...scoped.facts);
    findings.push(...scoped.findings);
    diagnostics.push(...scoped.diagnostics);
  }

  const finalInventory = await collectInventoryImpl({ projectDir });
  if (finalInventory.projectDigest !== inventory.projectDigest) return inputChangedResult(sourceArtifacts);

  const normalized = normalizeFacts(facts);
  diagnostics.push(...normalized.diagnostics);
  diagnostics.sort(compareDiagnostics);
  const status = sourceArtifacts.length === 0 ? 'skipped' : diagnostics.length === 0 ? 'complete' : 'partial';
  const builtinAnalyzer = { ...BUILTIN_ANALYZER, status, sourceArtifacts, diagnostics };

  const external = [];
  const mergedFacts = [...normalized.facts];
  const factIds = new Set(mergedFacts.map((fact) => fact.id));
  const mergedFindings = [...findings];
  const adapterDefinitions = Array.isArray(analyzerAdapters) ? analyzerAdapters.slice().sort((left, right) => compareText(left?.id ?? '', right?.id ?? '')) : [];
  for (const definition of adapterDefinitions) {
    const result = await runConfiguredAnalyzer({ definition, projectDir, inventory, sourceFiles: contents });
    const adapterDiagnostics = [...result.analyzer.diagnostics];
    const adapterFacts = normalizeFacts(result.facts);
    adapterDiagnostics.push(...adapterFacts.diagnostics);
    for (const fact of adapterFacts.facts) {
      if (factIds.has(fact.id)) {
        adapterDiagnostics.push({ code: 'ANALYZER_FACT_COLLISION', message: `Duplicate fact ID: ${fact.id}`, factId: fact.id });
      } else {
        factIds.add(fact.id);
        mergedFacts.push(fact);
      }
    }
    for (const finding of result.findings) {
      try { mergedFindings.push(normalizeFinding(finding)); }
      catch (cause) {
        adapterDiagnostics.push({ code: 'ANALYZER_FINDING_INVALID', message: cause.message, findingId: finding?.id });
      }
    }
    adapterDiagnostics.sort(compareDiagnostics);
    external.push({ ...result.analyzer, diagnostics: adapterDiagnostics });
  }

  return {
    facts: normalizeFacts(mergedFacts).facts,
    findings: normalizeFindings(mergedFindings),
    analyzers: [builtinAnalyzer, ...external].sort((left, right) => compareText(left.id, right.id))
  };
}

function asUtf8(source) {
  return typeof source === 'string' ? source : Buffer.from(source).toString('utf8');
}
