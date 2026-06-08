import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { generateMcuPeripheralProject } from './generate-mcu-project.js';
import { reviewCircuitReadiness } from './review-project.js';
import { validateProject } from './validate-project.js';

const applyLocks = new Set();

export async function applySchematicPatch({
  projectDir,
  prompt,
  projectName = 'chatpcb_mcu_peripheral',
  approved = false,
  cancel = false,
  validateProjectImpl = validateProject
} = {}) {
  if (!projectDir) {
    throw new Error('projectDir is required.');
  }

  const resolvedProjectDir = path.resolve(projectDir);

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

  const plan = await buildPatchPlan({ projectDir: resolvedProjectDir, prompt, projectName });

  if (!approved) {
    return {
      requiresApproval: true,
      approved: false,
      applied: false,
      files: plan.targetFiles,
      changedFiles: plan.changedFiles,
      diff: plan.diff,
      review: plan.proposed.review
    };
  }

  if (applyLocks.has(resolvedProjectDir)) {
    throw new Error(`A schematic patch is already being applied to ${resolvedProjectDir}.`);
  }

  applyLocks.add(resolvedProjectDir);
  try {
    const snapshots = await snapshotFiles(plan.targetFiles);
    await writePlannedFiles(plan);

    const validation = await validateProjectImpl({ projectDir: resolvedProjectDir });
    if (!validation.ok) {
      await restoreSnapshots(snapshots);
      return {
        requiresApproval: false,
        approved: true,
        applied: false,
        rolledBack: true,
        files: plan.targetFiles,
        changedFiles: plan.changedFiles,
        diff: plan.diff,
        validation,
        review: reviewCircuitReadiness({ spec: plan.proposed.spec, validation })
      };
    }

    return {
      requiresApproval: false,
      approved: true,
      applied: true,
      rolledBack: false,
      files: plan.targetFiles,
      changedFiles: plan.changedFiles,
      diff: plan.diff,
      validation,
      review: reviewCircuitReadiness({ spec: plan.proposed.spec, validation })
    };
  } finally {
    applyLocks.delete(resolvedProjectDir);
    await rm(plan.tempDir, { force: true, recursive: true });
  }
}

async function buildPatchPlan({ projectDir, prompt, projectName }) {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'chatpcb-patch-plan-'));
  const proposed = await generateMcuPeripheralProject({ projectDir: tempDir, prompt, projectName });
  const targetFiles = {};
  const proposedFiles = {};

  for (const [kind, proposedPath] of Object.entries(proposed.files)) {
    const relativeName = path.basename(proposedPath);
    targetFiles[kind] = path.join(projectDir, relativeName);
    proposedFiles[kind] = proposedPath;
  }

  const changedFiles = [];
  const diffSections = [];

  for (const [kind, targetPath] of Object.entries(targetFiles)) {
    const proposedPath = proposedFiles[kind];
    const [before, after] = await Promise.all([readOptional(targetPath), readFile(proposedPath, 'utf8')]);
    if (before !== after) {
      const relativeName = path.basename(targetPath);
      changedFiles.push(relativeName);
      diffSections.push(renderUnifiedDiff(relativeName, before ?? '', after));
    }
  }

  return {
    tempDir,
    proposed,
    proposedFiles,
    targetFiles,
    changedFiles,
    diff: diffSections.join('\n')
  };
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
