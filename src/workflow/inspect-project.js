import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { collectArtifactInventory } from '../evidence/artifact-inventory.js';
import { analyzeProject } from '../analyzer/project-analyzer.js';
import { evidenceFreshness, normalizeEvidenceManifest } from '../evidence/evidence-manifest.js';
import { runKicadCli } from '../kicad/kicad-cli.js';
import { assertSafeProjectDir, readChatPcbManifest } from './project-workspace.js';
import { validateBoard } from './validate-board.js';
import { validateProject } from './validate-project.js';

export async function inspectProject(options = {}) {
  const projectDir = assertSafeProjectDir(options.projectDir);
  const inventory = await collectArtifactInventory({ projectDir });
  const rawManifest = await readChatPcbManifest(projectDir);
  const manifest = rawManifest ? normalizeManifest(rawManifest) : null;
  const analyzeProjectImpl = options.analyzeProjectImpl ?? analyzeProject;
  const [toolchain, { erc, drc }, analysis] = await Promise.all([
    inspectToolchain({ projectDir, options }),
    validateInspectionCopy({ projectDir, options }),
    analyzeProjectImpl({ projectDir, inventory, analyzerAdapters: options.analyzerAdapters })
  ]);
  const finalInventory = await collectArtifactInventory({ projectDir });
  const boundAnalysis = finalInventory.projectDigest === inventory.projectDigest ? analysis : {
    facts: [], findings: [], analyzers: analysis.analyzers.map((analyzer) => ({
      ...analyzer, status: 'failed', diagnostics: [{ code: 'ANALYZER_INPUT_CHANGED', message: 'Project artifact digest changed during inspection' }]
    }))
  };

  return {
    ok: true,
    inspectedAt: (options.now ?? (() => new Date().toISOString()))(),
    inspection: { ...inventory, artifactCount: inventory.artifacts.length, toolchain, facts: boundAnalysis.facts, analyzers: boundAnalysis.analyzers },
    manifest: {
      schemaVersion: manifest?.schemaVersion ?? null,
      freshness: evidenceFreshness({ manifest, projectDigest: inventory.projectDigest })
    },
    validation: { erc, drc },
    validationClean: erc.ok === true && drc.ok === true,
    findings: boundAnalysis.findings
  };
}

async function validateInspectionCopy({ projectDir, options }) {
  const inspectionRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-inspection-'));
  const validationProjectDir = path.join(inspectionRoot, 'project');

  try {
    await cp(projectDir, validationProjectDir, { recursive: true });
    const [erc, drc] = await Promise.all([
      (options.validateProjectImpl ?? validateProject)({ projectDir: validationProjectDir, kicadCliPath: options.kicadCliPath }),
      (options.validateBoardImpl ?? validateBoard)({ projectDir: validationProjectDir, kicadCliPath: options.kicadCliPath })
    ]);
    return {
      erc: omitEphemeralReport(erc, { projectDir, validationProjectDir }),
      drc: omitEphemeralReport(drc, { projectDir, validationProjectDir })
    };
  } finally {
    await rm(inspectionRoot, { force: true, recursive: true });
  }
}

async function inspectToolchain({ projectDir, options }) {
  const getKicadVersionImpl = options.getKicadVersionImpl ?? getKicadVersion;
  try {
    const kicadCli = await getKicadVersionImpl({ projectDir, kicadCliPath: options.kicadCliPath });
    return kicadCli ? { kicadCli } : {};
  } catch {
    return {};
  }
}

async function getKicadVersion({ projectDir, kicadCliPath }) {
  const result = await runKicadCli(['version'], { explicitPath: kicadCliPath, cwd: projectDir });
  if (result.exitCode !== 0 || !result.stdout.trim()) return null;
  return {
    version: result.stdout.trim(),
    command: result.command,
    source: result.source
  };
}

function omitEphemeralReport(result, { projectDir, validationProjectDir }) {
  if (!result || typeof result !== 'object') return result;
  const { report, ...stableResult } = result;
  return replaceEphemeralPaths(stableResult, { projectDir, validationProjectDir });
}

function replaceEphemeralPaths(value, { projectDir, validationProjectDir }, key = '') {
  if (typeof value === 'string') {
    const replacement = key === 'message' ? projectDir : '<ephemeral-inspection-copy>';
    return value.replaceAll(validationProjectDir, replacement);
  }
  if (Array.isArray(value)) return value.map((item) => replaceEphemeralPaths(item, { projectDir, validationProjectDir }));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [
    childKey,
    replaceEphemeralPaths(child, { projectDir, validationProjectDir }, childKey)
  ]));
}

function normalizeManifest(rawManifest) {
  try {
    return normalizeEvidenceManifest(rawManifest);
  } catch (error) {
    const typed = new Error(`ChatPCB manifest is invalid: ${error.message}`);
    typed.code = 'CHATPCB_MANIFEST_INVALID';
    throw typed;
  }
}
