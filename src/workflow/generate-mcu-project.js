import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { normalizeCircuitSpec } from '../runtime/circuit-spec.js';
import { renderKiCadProject, renderKiCadSchematic, renderSpiceFixture } from '../kicad/project-generator.js';

export async function generateMcuPeripheralProject({ projectDir, prompt, projectName = 'chatpcb_mcu_peripheral' }) {
  if (!projectDir) {
    throw new Error('projectDir is required.');
  }

  const spec = normalizeCircuitSpec(prompt);
  await mkdir(projectDir, { recursive: true });

  const baseName = sanitizeProjectName(projectName);
  const files = {
    project: path.join(projectDir, `${baseName}.kicad_pro`),
    schematic: path.join(projectDir, `${baseName}.kicad_sch`),
    spice: path.join(projectDir, `${baseName}_simulation.cir`),
    spec: path.join(projectDir, `${baseName}.chatpcb.json`)
  };

  await writeFile(files.project, renderKiCadProject(baseName), 'utf8');
  await writeFile(files.schematic, renderKiCadSchematic({ baseName, spec }), 'utf8');
  await writeFile(files.spice, renderSpiceFixture(spec), 'utf8');
  await writeFile(files.spec, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');

  return {
    spec,
    files,
    nextActions: [
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
