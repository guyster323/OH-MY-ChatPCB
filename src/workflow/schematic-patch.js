import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { collectArtifactInventory } from '../evidence/artifact-inventory.js';
import { generateMcuPeripheralProject } from './generate-mcu-project.js';
import { assertSafeProjectDir } from './project-workspace.js';
import { reviewCircuitReadiness } from './review-project.js';
import { validateProject } from './validate-project.js';

const applyLocks = new Set();

export async function applySchematicPatch({
  projectDir,
  prompt,
  projectName = 'chatpcb_mcu_peripheral',
  approved = false,
  cancel = false,
  expectedPatchId,
  patchPlan,
  validateProjectImpl = validateProject
} = {}) {
  if (!projectDir) {
    throw new Error('projectDir is required.');
  }

  const resolvedProjectDir = assertSafeProjectDir(projectDir);

  if (cancel) {
    return {
      requiresApproval: false,
      approved: false,
      canceled: true,
      applied: false,
      files: {},
      changedFiles: [],
      diff: ''
    };
  }

  if (approved && !expectedPatchId) {
    return patchFailure('PATCH_APPROVAL_REQUIRED', 'expectedPatchId is required to apply a patch preview.');
  }

  const plan = patchPlan ?? await buildPatchPlan({
    projectDir: resolvedProjectDir,
    prompt,
    projectName,
    validateProjectImpl
  });
  const ownsPlan = !patchPlan;

  if (!approved) {
    const preview = {
      requiresApproval: true,
      approved: false,
      applied: false,
      files: plan.targetFiles,
      changedFiles: plan.changedFiles,
      diff: plan.diff,
      review: plan.proposed.review,
      patchId: plan.patchId,
      beforeArtifacts: plan.beforeArtifacts,
      afterArtifacts: plan.afterArtifacts,
      beforeProjectDigest: plan.beforeProjectDigest,
      afterProjectDigest: plan.afterProjectDigest,
      validation: plan.validation
    };
    if (ownsPlan) await disposePatchPlan(plan);
    return preview;
  }

  const currentInventory = await collectArtifactInventory({ projectDir: resolvedProjectDir });
  if (
    (expectedPatchId && expectedPatchId !== plan.patchId) ||
    currentInventory.projectDigest !== plan.beforeProjectDigest
  ) {
    if (ownsPlan) await disposePatchPlan(plan);
    return patchFailure('PATCH_STALE', 'Patch preview no longer matches the project artifacts.');
  }

  if (applyLocks.has(resolvedProjectDir)) {
    throw new Error(`A schematic patch is already being applied to ${resolvedProjectDir}.`);
  }

  applyLocks.add(resolvedProjectDir);
  try {
    if (!plan.validation.ok) {
      return rejectedCandidate(plan);
    }

    const snapshots = await snapshotFiles(plan.targetFiles);
    await writePlannedFiles(plan);
    const savedInventory = await collectArtifactInventory({ projectDir: resolvedProjectDir });
    if (
      savedInventory.projectDigest !== plan.afterProjectDigest ||
      !artifactsMatch(await collectArtifacts(plan.targetFiles), plan.afterArtifacts)
    ) {
      await restoreSnapshots(snapshots);
      return patchFailure('PATCH_FINAL_BYTES_MISMATCH', 'Saved project bytes did not match the approved candidate and were restored.', plan);
    }

    return {
      requiresApproval: false,
      approved: true,
      applied: true,
      rolledBack: false,
      files: plan.targetFiles,
      changedFiles: plan.changedFiles,
      diff: plan.diff,
      validation: plan.validation,
      review: reviewCircuitReadiness({ spec: plan.proposed.spec, validation: plan.validation })
    };
  } finally {
    applyLocks.delete(resolvedProjectDir);
    if (ownsPlan) await disposePatchPlan(plan);
  }
}

export async function createSchematicPatchPlan({ projectDir, prompt, projectName = 'chatpcb_mcu_peripheral', validateProjectImpl = validateProject } = {}) {
  return buildPatchPlan({ projectDir: assertSafeProjectDir(projectDir), prompt, projectName, validateProjectImpl });
}

export async function disposeSchematicPatchPlan(plan) {
  await disposePatchPlan(plan);
}

async function buildPatchPlan({ projectDir, prompt, projectName, validateProjectImpl }) {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'chatpcb-patch-plan-'));
  const candidateDir = path.join(tempDir, 'project');
  try {
    await cp(projectDir, candidateDir, { recursive: true });
    const proposed = await generateMcuPeripheralProject({ projectDir: candidateDir, prompt, projectName });
    const validation = await validateProjectImpl({ projectDir: candidateDir });
    const targetFiles = {};
    const proposedFiles = {};

    for (const [kind, proposedPath] of Object.entries(proposed.files)) {
      const relativeName = path.relative(candidateDir, proposedPath);
      targetFiles[kind] = path.join(projectDir, relativeName);
      proposedFiles[kind] = proposedPath;
    }

    const changedFiles = [];
    const diffSections = [];
    const beforeArtifacts = [];
    const afterArtifacts = [];

    for (const [kind, targetPath] of Object.entries(targetFiles)) {
      const proposedPath = proposedFiles[kind];
      const [before, after] = await Promise.all([readOptional(targetPath), readFile(proposedPath, 'utf8')]);
      const relativeName = path.relative(projectDir, targetPath).split(path.sep).join('/');
      beforeArtifacts.push(artifactRecord(relativeName, before));
      afterArtifacts.push(artifactRecord(relativeName, after));
      if (before !== after) {
        changedFiles.push(relativeName);
        diffSections.push(renderUnifiedDiff(relativeName, before ?? '', after));
      }
    }

    const [beforeInventory, afterInventory] = await Promise.all([
      collectArtifactInventory({ projectDir }),
      collectArtifactInventory({ projectDir: candidateDir })
    ]);
    beforeArtifacts.sort(compareArtifacts);
    afterArtifacts.sort(compareArtifacts);
    changedFiles.sort();
    const patchId = `sha256:${createHash('sha256').update(JSON.stringify({
      projectDir,
      beforeArtifacts,
      afterArtifacts,
      beforeProjectDigest: beforeInventory.projectDigest,
      afterProjectDigest: afterInventory.projectDigest,
      changedFiles
    })).digest('hex')}`;

    return {
      tempDir,
      candidateDir,
      proposed,
      proposedFiles,
      targetFiles,
      changedFiles,
      diff: diffSections.join('\n'),
      patchId,
      beforeArtifacts,
      afterArtifacts,
      beforeProjectDigest: beforeInventory.projectDigest,
      afterProjectDigest: afterInventory.projectDigest,
      validation
    };
  } catch (error) {
    await rm(tempDir, { force: true, recursive: true });
    throw error;
  }
}

async function writePlannedFiles(plan) {
  await mkdir(path.dirname(Object.values(plan.targetFiles)[0]), { recursive: true });

  for (const [kind, targetPath] of Object.entries(plan.targetFiles)) {
    await writeFile(targetPath, await readFile(plan.proposedFiles[kind], 'utf8'), 'utf8');
  }
}

async function snapshotFiles(files) {
  const snapshots = [];

  for (const targetPath of Object.values(files)) {
    snapshots.push({
      path: targetPath,
      content: await readOptional(targetPath)
    });
  }

  return snapshots;
}

async function restoreSnapshots(snapshots) {
  for (const snapshot of snapshots) {
    if (snapshot.content === null) {
      await rm(snapshot.path, { force: true });
    } else {
      await mkdir(path.dirname(snapshot.path), { recursive: true });
      await writeFile(snapshot.path, snapshot.content, 'utf8');
    }
  }
}

async function readOptional(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function collectArtifacts(targetFiles) {
  const artifacts = await Promise.all(
    Object.values(targetFiles).map(async (targetPath) => artifactRecord(path.basename(targetPath), await readOptional(targetPath)))
  );
  return artifacts.sort(compareArtifacts);
}

function artifactRecord(relativePath, content) {
  return {
    path: relativePath,
    hash: content === null ? null : `sha256:${createHash('sha256').update(content).digest('hex')}`
  };
}

function compareArtifacts(left, right) {
  return left.path.localeCompare(right.path);
}

function artifactsMatch(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function disposePatchPlan(plan) {
  await rm(plan.tempDir, { force: true, recursive: true });
}

function rejectedCandidate(plan) {
  return {
    requiresApproval: false,
    approved: true,
    applied: false,
    rolledBack: true,
    files: plan.targetFiles,
    changedFiles: plan.changedFiles,
    diff: plan.diff,
    validation: plan.validation,
    review: reviewCircuitReadiness({ spec: plan.proposed.spec, validation: plan.validation })
  };
}

function patchFailure(code, message, plan) {
  return {
    requiresApproval: false,
    approved: true,
    applied: false,
    rolledBack: false,
    files: plan?.targetFiles ?? {},
    changedFiles: plan?.changedFiles ?? [],
    diff: plan?.diff ?? '',
    ...(plan ? { validation: plan.validation, review: reviewCircuitReadiness({ spec: plan.proposed.spec, validation: plan.validation }) } : {}),
    reason: { code, message }
  };
}

function renderUnifiedDiff(relativeName, before, after) {
  return [
    `--- ${relativeName}`,
    `+++ ${relativeName}`,
    '@@',
    ...prefixLines(before, '-'),
    ...prefixLines(after, '+')
  ].join('\n');
}

function prefixLines(value, prefix) {
  const lines = value.split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }
  return lines.map((line) => `${prefix}${line}`);
}
