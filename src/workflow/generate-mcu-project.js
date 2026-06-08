import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { normalizeCircuitSpec } from '../runtime/circuit-spec.js';
import { applyBoardProfile } from '../runtime/board-profiles.js';
import {
  buildMcuSchematicAst,
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

  const spec = applyBoardProfile(normalizeCircuitSpec(prompt));
  const schematic = buildMcuSchematicAst(spec);
  const projectMetadata = { ...spec, schematic };
  await mkdir(projectDir, { recursive: true });

  const baseName = sanitizeProjectName(projectName);
  const files = {
    project: path.join(projectDir, `${baseName}.kicad_pro`),
    schematic: path.join(projectDir, `${baseName}.kicad_sch`),
    symbolLibrary: path.join(projectDir, 'chatpcb.kicad_sym'),
    symbolTable: path.join(projectDir, 'sym-lib-table'),
    spice: path.join(projectDir, `${baseName}_simulation.cir`),
    spec: path.join(projectDir, `${baseName}.chatpcb.json`)
  };

  await writeFile(files.project, renderKiCadProject(baseName), 'utf8');
  await writeFile(files.schematic, renderKiCadSchematic({ baseName, spec, schematic }), 'utf8');
  await writeFile(files.symbolLibrary, renderProjectSymbolLibrary(), 'utf8');
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

function sanitizeProjectName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'chatpcb_project';
}
