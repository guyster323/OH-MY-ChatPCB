import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { collectArtifactInventory } from '../evidence/artifact-inventory.js';
import { analyzeProject } from '../analyzer/project-analyzer.js';
import { evidenceFreshness, normalizeEvidenceManifest } from '../evidence/evidence-manifest.js';
import { runKicadCli } from '../kicad/kicad-cli.js';
import { assertSafeProjectDir, readChatPcbManifest } from './project-workspace.js';
import { validateBoard } from './validate-board.js';
import { validateProject } from './validate-project.js';
import { assertInspectionTree, copyInspectionTree } from './inspection-copy.js';

export async function inspectProject(options = {}) {
  const projectDir = assertSafeProjectDir(options.projectDir);
  await assertInspectionTree(projectDir, { allowedWorkspaceRoot: options.allowedWorkspaceRoot });
  const inventory = await collectArtifactInventory({ projectDir });
  const rawManifest = await readChatPcbManifest(projectDir);
  const manifest = rawManifest ? normalizeManifest(rawManifest) : null;
  const analyzeProjectImpl = options.analyzeProjectImpl ?? analyzeProject;
  const [{ toolchain, erc, drc }, analysis] = await Promise.all([
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
  let canonicalRoot = inspectionRoot;

  try {
    canonicalRoot = await realpath(inspectionRoot);
    const validationProjectDir = await copyInspectionTree(projectDir, path.join(canonicalRoot, 'project'));
    const discovery = { kicadCliPath: options.kicadCliPath, excludeProjectDir: projectDir };
    const results = await Promise.allSettled([
      Promise.resolve().then(() => inspectToolchain({ projectDir: validationProjectDir, options: { ...options, ...discovery } })),
      Promise.resolve().then(() => (options.validateProjectImpl ?? validateProject)({ projectDir: validationProjectDir, ...discovery })),
      Promise.resolve().then(() => (options.validateBoardImpl ?? validateBoard)({ projectDir: validationProjectDir, ...discovery }))
    ]);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;
    const [toolchain, erc, drc] = results.map((result) => result.value);
    return {
      toolchain,
      erc: omitEphemeralReport(erc, { projectDir, validationProjectDir }),
      drc: omitEphemeralReport(drc, { projectDir, validationProjectDir })
    };
  } finally {
    await rm(canonicalRoot, { force: true, recursive: true });
    if (canonicalRoot !== inspectionRoot) {
      await rm(inspectionRoot, { force: true, recursive: true });
    }
  }
}

async function inspectToolchain({ projectDir, options }) {
  const getKicadVersionImpl = options.getKicadVersionImpl ?? getKicadVersion;
  try {
    const kicadCli = await getKicadVersionImpl({
      projectDir,
      kicadCliPath: options.kicadCliPath,
      excludeProjectDir: options.excludeProjectDir
    });
    return kicadCli ? { kicadCli } : {};
  } catch {
    return {};
  }
}

async function getKicadVersion({ projectDir, kicadCliPath, excludeProjectDir }) {
  const result = await runKicadCli(['version'], {
    explicitPath: kicadCliPath,
    cwd: projectDir,
    excludeProjectDir
  });
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
