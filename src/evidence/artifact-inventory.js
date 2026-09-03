import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const SOURCE_KINDS = new Map([
  ['.kicad_pro', 'project'], ['.kicad_sch', 'schematic'], ['.kicad_pcb', 'board'],
  ['.kicad_sym', 'symbol-library'], ['.kicad_mod', 'footprint'],
  ['.kicad_dru', 'design-rules'], ['.cir', 'spice']
]);
const SOURCE_NAMES = new Map([['sym-lib-table', 'symbol-table'], ['fp-lib-table', 'footprint-table']]);
const TRANSIENT_NAMES = new Set(['chatpcb-erc.json', 'chatpcb-drc.json']);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const files = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

export async function collectArtifactInventory({ projectDir }) {
  const root = path.resolve(projectDir);
  const artifacts = [];
  for (const absolutePath of await walk(root)) {
    const relative = path.relative(root, absolutePath).split(path.sep).join('/');
    const base = path.basename(absolutePath);
    if (TRANSIENT_NAMES.has(base) || base.endsWith('.chatpcb.json')) continue;
    const kind = SOURCE_NAMES.get(base) ?? SOURCE_KINDS.get(path.extname(base));
    if (!kind) continue;
    const content = await readFile(absolutePath);
    artifacts.push({ path: relative, kind, sha256: sha256(content), size: (await stat(absolutePath)).size });
  }
  artifacts.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { projectDigest: sha256(JSON.stringify(artifacts)), artifacts };
}
