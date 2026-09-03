import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { collectArtifactInventory } from '../evidence/artifact-inventory.js';
import { evidenceFreshness, normalizeEvidenceManifest } from '../evidence/evidence-manifest.js';
import { assertSafeProjectDir, readChatPcbManifest } from './project-workspace.js';
import { validateBoard } from './validate-board.js';
import { validateProject } from './validate-project.js';

export async function inspectProject(options = {}) {
  const projectDir = assertSafeProjectDir(options.projectDir);
  const inventory = await collectArtifactInventory({ projectDir });
  const rawManifest = await readChatPcbManifest(projectDir);
  const manifest = rawManifest ? normalizeManifest(rawManifest) : null;
  const { erc, drc } = await validateInspectionCopy({ projectDir, options });

  return {
    ok: true,
    inspectedAt: (options.now ?? (() => new Date().toISOString()))(),
    inspection: { ...inventory, artifactCount: inventory.artifacts.length },
    manifest: {
      schemaVersion: manifest?.schemaVersion ?? null,
      freshness: evidenceFreshness({ manifest, projectDigest: inventory.projectDigest })
    },
    validation: { erc, drc },
    validationClean: erc.ok === true && drc.ok === true
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
    return { erc, drc };
  } finally {
    await rm(inspectionRoot, { force: true, recursive: true });
  }
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
