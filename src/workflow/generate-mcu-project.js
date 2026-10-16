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
import { reviewCircuitReadiness } from './review-project.js';

export async function generateMcuPeripheralProject({ projectDir, prompt, projectName = 'chatpcb_mcu_peripheral' }) {
  if (!projectDir) {
    throw new Error('projectDir is required.');
  }

  const conversation = await loadCircuitConversation(projectDir).catch(() => null);
  const drafted = applyDiscreteLedSpec(applyProductDraft(applyBoardProfile(normalizeCircuitSpec(prompt)), conversation));
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
  await mkdir(projectDir, { recursive: true });

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
  await writeFile(files.spice, renderSpiceFixture(spec), 'utf8');
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
    role: discretePartRole(component)
  }));
  return {
    ...spec,
    partManifest: { parts }
  };
}

function discretePartRole(component) {
  if (component.libId === 'Device:LED') return 'led';
  if (component.libId === 'Device:R') return 'resistor';
  if (component.libId === 'power:+5V') return 'supply';
  if (component.libId === 'power:GND') return 'ground';
  if (String(component.libId ?? '').startsWith('Connector')) return 'power-connector';
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
