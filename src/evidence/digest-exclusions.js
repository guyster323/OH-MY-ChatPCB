import { createHash } from 'node:crypto';
import path from 'node:path';

// One allowlist and one KiCad by-product filter for the panel digest and the
// daemon transaction digest. A file that fails this filter must not be able to
// change either digest, or approval locks with no user edit.
// ChatPCB's own manifest and evidence records are also outside both digests:
// the file that stores the digest cannot be an input to it. The conversation
// file stays in the digest. Manifests are still transaction files so apply can
// write them; see transactionArtifactKind.
const SOURCE_KINDS = new Map([
  ['.kicad_pro', 'project'],
  ['.kicad_sch', 'schematic'],
  ['.kicad_pcb', 'board'],
  ['.kicad_sym', 'symbol-library'],
  ['.kicad_mod', 'footprint'],
  ['.kicad_dru', 'design-rules'],
  ['.cir', 'spice']
]);
const SOURCE_NAMES = new Map([
  ['sym-lib-table', 'symbol-table'],
  ['fp-lib-table', 'footprint-table']
]);
const REPORT_NAMES = new Set(['chatpcb-erc.json', 'chatpcb-drc.json']);
const CONVERSATION_FILE = '.chatpcb-conversation.json';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export function compareArtifactPaths(left, right) {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function normalizeRelative(relativePath) {
  return String(relativePath ?? '').split(path.sep).join('/');
}

function relativeParts(relativePath) {
  const normalized = normalizeRelative(relativePath);
  const parts = normalized.split('/');
  const base = parts.at(-1) ?? '';
  return { normalized, parts, base, baseLower: base.toLowerCase() };
}

function isByproductPath(relativePath) {
  const { normalized, parts, base, baseLower } = relativeParts(relativePath);
  if (!normalized || normalized === '.') return true;
  if (!base || base === '.' || base === '..') return true;
  if (parts.slice(0, -1).some((segment) => segment.toLowerCase().endsWith('-backups'))) return true;
  if (baseLower.endsWith('.lck')) return true;
  if (baseLower.startsWith('_autosave-')) return true;
  if (baseLower.endsWith('-bak')) return true;
  if (baseLower === 'fp-info-cache') return true;
  if (baseLower.endsWith('.kicad_prl')) return true;
  if (REPORT_NAMES.has(baseLower)) return true;
  return false;
}

// *.chatpcb.json and *.evidence.json. Not .chatpcb-conversation.json, which
// does not end in .chatpcb.json. Backup and autosave copies are by-products.
export function isOwnRecordPath(relativePath) {
  if (isByproductPath(relativePath)) return false;
  const { baseLower } = relativeParts(relativePath);
  return baseLower.endsWith('.chatpcb.json') || baseLower.endsWith('.evidence.json');
}

export function isExcludedFromDigest(relativePath) {
  return isByproductPath(relativePath) || isOwnRecordPath(relativePath);
}

export function digestArtifactKind(relativePath) {
  const normalized = normalizeRelative(relativePath);
  if (isExcludedFromDigest(normalized)) return null;
  const base = path.posix.basename(normalized);
  if (base === CONVERSATION_FILE) return 'conversation';
  return SOURCE_NAMES.get(base) ?? SOURCE_KINDS.get(path.posix.extname(base)) ?? null;
}

export function digestOfArtifacts(artifacts) {
  const normalized = artifacts
    .map(({ path: artifactPath, kind, sha256: digest, size }) => ({
      path: artifactPath,
      kind,
      sha256: digest,
      size
    }))
    .sort(compareArtifactPaths);
  return sha256(JSON.stringify(normalized));
}
