import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { applyDiscreteLedSpec, normalizeCircuitSpec } from '../runtime/circuit-spec.js';
import { applyBoardProfile } from '../runtime/board-profiles.js';
import { applyProductDraft } from '../runtime/product-catalog.js';
import { loadCircuitConversation } from '../runtime/request-conversation.js';
import {
  buildMcuSchematicAst,
  renderKiCadBoard,
  renderKiCadProject,
  renderKiCadSchematic,
  renderProjectSymbolLibrary,
  renderProjectSymbolTable,
  renderSpiceFixture
} from '../kicad/project-generator.js';
import { isLoneMilliResistorSuffix } from '../kicad/resistor-ohms.js';
import { loneMilliCountsAsResistor } from '../runtime/quantity-tokens.js';
import { reviewCircuitReadiness } from './review-project.js';
import { assertInspectionTree, assertUnlinkedAncestors } from './inspection-copy.js';
import { assertSafeProjectDir } from './project-workspace.js';

export async function generateMcuPeripheralProject({
  projectDir,
  prompt,
  projectName = 'chatpcb_mcu_peripheral',
  allowedWorkspaceRoot
}) {
  if (!projectDir) {
    throw new Error('projectDir is required.');
  }

  const guard = allowedWorkspaceRoot ? { allowedWorkspaceRoot } : {};
  // Reject escapes, dangling links, and untrusted symlink ancestors before any directory is created.
  assertSafeProjectDir(projectDir, guard);
  await assertUnlinkedAncestors(projectDir, guard);
  const conversation = await loadCircuitConversation(projectDir).catch(() => null);
  const drafted = applyDiscreteLedSpec(applyProductDraft(applyBoardProfile(normalizeCircuitSpec(prompt)), conversation));
  return writeGeneratedProject({
    projectDir,
    spec: stampLoneMilliStatusResistor(drafted, prompt),
    projectName,
    allowedWorkspaceRoot
  });
}

// A lone m in a resistor phrase (4m7, "1m resistor") is not a value. Put it on
// the status LED resistor so SPICE throws before writeGeneratedProject creates
// the directory. A length or a time (1 m cable, every 5m) is left alone.
// 10mA and 4M7 do not match.
function loneMilliResistorToken(prompt) {
  const text = String(prompt ?? '').normalize('NFKC');
  const pattern = /(?<![\w.])(\d+m\d+|\d+(?:\.\d+)?\s*m)(?![\w])/g;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[1].length;
    if (!isLoneMilliResistorSuffix(match[1])) continue;
    if (!loneMilliCountsAsResistor(text, start, end)) continue;
    return match[1].replace(/\s+/g, '');
  }
  return null;
}

function stampLoneMilliStatusResistor(spec, prompt) {
  const peripherals = Array.isArray(spec?.peripherals) ? spec.peripherals : null;
  if (!peripherals?.some((item) => item?.kind === 'status-led')) return spec;
  const token = loneMilliResistorToken(prompt);
  if (!token) return spec;
  let found = false;
  const next = peripherals.map((item) => {
    if (item?.kind !== 'status-led-resistor') return item;
    found = true;
    return { ...item, value: token };
  });
  if (!found) next.push({ kind: 'status-led-resistor', value: token });
  return { ...spec, peripherals: next };
}

export async function writeGeneratedProject({
  projectDir,
  spec: drafted,
  projectName = 'chatpcb_mcu_peripheral',
  allowedWorkspaceRoot
}) {
  if (!projectDir) {
    throw new Error('projectDir is required.');
  }
  if (!drafted || typeof drafted !== 'object') {
    throw new Error('spec is required.');
  }

  const guard = allowedWorkspaceRoot ? { allowedWorkspaceRoot } : {};
  assertSafeProjectDir(projectDir, guard);
  await assertUnlinkedAncestors(projectDir, guard);
  const schematic = buildMcuSchematicAst(drafted);
  const spec = attachDiscretePartManifest(drafted, schematic);
  const baseName = sanitizeProjectName(projectName);
  const boardFileName = `${baseName}.kicad_pcb`;
  const hasBoardDraft = Boolean(spec.boardProfile?.id && spec.boardProfile?.pcbDraft !== false);
  const projectMetadata = {
    ...spec,
    boardProfile: spec.boardProfile
      ? {
          ...spec.boardProfile,
          ...(hasBoardDraft ? { manufacturing: manufacturingMetadataFor(boardFileName) } : {})
        }
      : spec.boardProfile,
    schematic
  };

  const files = {
    project: path.join(projectDir, `${baseName}.kicad_pro`),
    schematic: path.join(projectDir, `${baseName}.kicad_sch`),
    symbolLibrary: path.join(projectDir, 'chatpcb.kicad_sym'),
    symbolTable: path.join(projectDir, 'sym-lib-table'),
    spice: path.join(projectDir, `${baseName}_simulation.cir`),
    spec: path.join(projectDir, `${baseName}.chatpcb.json`)
  };

  if (hasBoardDraft) {
    files.board = path.join(projectDir, boardFileName);
  }

  // Invalid resistor text throws here, before mkdir, so a failure leaves no project files.
  const spiceText = renderSpiceFixture(spec);

  await mkdir(projectDir, { recursive: true });
  await assertInspectionTree(projectDir, guard);

  await writeFile(files.project, renderKiCadProject(baseName), 'utf8');
  await writeFile(files.schematic, renderKiCadSchematic({ baseName, spec, schematic }), 'utf8');
  if (files.board) {
    const boardWarnings = [];
    await writeFile(files.board, renderKiCadBoard({
      baseName,
      schematic,
      boardProfile: spec.boardProfile,
      warnings: boardWarnings
    }), 'utf8');
    if (boardWarnings.length > 0 && projectMetadata.boardProfile) {
      projectMetadata.boardProfile.boardDraftWarnings = boardWarnings;
    }
  }
  await writeFile(files.symbolLibrary, renderProjectSymbolLibrary(schematic.components.map((component) => component.libId)), 'utf8');
  await writeFile(files.symbolTable, renderProjectSymbolTable(), 'utf8');
  await writeFile(files.spice, spiceText, 'utf8');
  await writeFile(files.spec, `${JSON.stringify(projectMetadata, null, 2)}\n`, 'utf8');

  const review = reviewCircuitReadiness({ spec: projectMetadata });

  return {
    spec: projectMetadata,
    files,
    review,
    nextActions: [
      'Review findings and resolve blockers before release.',
      'Review generated schematic text notes before applying to a production board.',
      'Run ERC with kicad-cli when KiCad is installed.',
      'Run SPICE simulation for supported power and simple analog subcircuits.'
    ]
  };
}

function attachDiscretePartManifest(spec, schematic) {
  if (spec.kind !== 'discrete-led') return spec;
  const parts = (schematic.components ?? []).map((component) => ({
    ref: component.ref,
    libId: component.libId,
    value: component.value,
    ...(component.description ? { description: component.description } : {}),
    role: discretePartRole(component)
  }));
  return {
    ...spec,
    partManifest: { parts }
  };
}

function discretePartRole(component) {
  const libId = String(component.libId ?? '');
  if (libId === 'Device:LED') return 'led';
  if (libId === 'Device:R') return 'resistor';
  if (libId === 'power:GND') return 'ground';
  if (libId.startsWith('power:')) return 'supply';
  if (libId.startsWith('Connector')) return 'power-connector';
  return 'part';
}

function manufacturingMetadataFor(boardFileName) {
  return {
    boardDraft: {
      status: 'generated',
      file: boardFileName,
      note: 'PCB draft with board outline, embedded footprints, conservative same-net traces, SW_3V3 detours, safe CC1/CC2 escapes, and an F.Cu GND zone that KiCad must refill (`pcb drc --refill-zones`) before DRC copper is counted; VBUS/USB-data pad-field fanout, full routing signoff, Gerbers, and drill files remain pending.'
    },
    drc: {
      status: 'pending',
      reason: 'Board DRC is measured, but supported-profile drafts still contain unconnected items; release requires zero violations and zero unconnected items.'
    },
    exports: {
      gerber: {
        status: 'pending',
        reason: 'Gerber export requires reviewed PCB layout and DRC.'
      },
      drill: {
        status: 'pending',
        reason: 'Drill export requires reviewed PCB layout and DRC.'
      }
    }
  };
}

function sanitizeProjectName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'chatpcb_project';
}
