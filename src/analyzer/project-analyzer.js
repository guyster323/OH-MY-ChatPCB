import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { analyzePcb } from './kicad-pcb.js';
import { analyzeSchematic } from './kicad-schematic.js';
import { normalizeFacts } from './fact-contract.js';
import { collectArtifactInventory } from '../evidence/artifact-inventory.js';

const BUILTIN_ANALYZER = {
  id: 'builtin.kicad',
  namespace: 'builtin',
  version: '1'
};

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function compareDiagnostics(left, right) {
  return compareText(left.code ?? '', right.code ?? '')
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

function missingSourceDiagnostic(extension, sourceArtifact) {
  return {
    code: 'ANALYZER_SOURCE_MISSING',
    message: `No ${extension} source artifact found`,
    sourceArtifact
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
  void analyzerAdapters;
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
  const contents = await Promise.all(sources.map(async (artifact) => ({
    artifact,
    source: asUtf8(await readFileImpl(path.join(projectDir, artifact.path)))
  })));

  const diagnostics = [];
  const facts = [];
  const findings = [];
  const schematics = contents.filter(({ artifact }) => artifact.path.endsWith('.kicad_sch'));
  const boards = contents.filter(({ artifact }) => artifact.path.endsWith('.kicad_pcb'));
  if (schematics.length === 0) diagnostics.push(missingSourceDiagnostic('.kicad_sch', 'demo.kicad_sch'));
  if (boards.length === 0) diagnostics.push(missingSourceDiagnostic('.kicad_pcb', 'demo.kicad_pcb'));

  for (const { artifact, source } of contents) {
    const result = artifact.path.endsWith('.kicad_sch')
      ? analyzeSchematic({ source, sourceArtifact: artifact.path })
      : analyzePcb({ source, sourceArtifact: artifact.path });
    facts.push(...result.facts);
    findings.push(...result.findings);
    diagnostics.push(...result.diagnostics);
  }

  const finalInventory = await collectInventoryImpl({ projectDir });
  if (finalInventory.projectDigest !== inventory.projectDigest) return inputChangedResult(sourceArtifacts);

  const normalized = normalizeFacts(facts);
  diagnostics.push(...normalized.diagnostics);
  diagnostics.sort(compareDiagnostics);
  const status = sourceArtifacts.length === 0 ? 'skipped' : diagnostics.length === 0 ? 'complete' : 'partial';
  return {
    facts: normalized.facts,
    findings: normalizeFindings(findings),
    analyzers: [{ ...BUILTIN_ANALYZER, status, sourceArtifacts, diagnostics }]
  };
}

function asUtf8(source) {
  return typeof source === 'string' ? source : Buffer.from(source).toString('utf8');
}
