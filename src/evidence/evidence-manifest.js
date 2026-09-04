import { createHash } from 'node:crypto';
import { compareArtifactPaths } from './artifact-inventory.js';

const clone = (value) => value === undefined ? undefined : structuredClone(value);

function assertArray(value, name) {
  if (value !== undefined && !Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value === undefined ? [] : clone(value);
}

function assertRelativeArtifacts(artifacts) {
  const result = assertArray(artifacts, 'artifacts');
  for (const artifact of result) {
    if (!artifact || typeof artifact !== 'object' || typeof artifact.path !== 'string' ||
      !artifact.path || artifact.path.startsWith('/') || artifact.path.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(artifact.path) || artifact.path.split(/[\\/]/).includes('..')) {
      throw new TypeError('artifact paths must be relative');
    }
    if (typeof artifact.kind !== 'string' || !artifact.kind || typeof artifact.sha256 !== 'string' || !artifact.sha256 || !Number.isInteger(artifact.size) || artifact.size < 0) {
      throw new TypeError('artifacts must include kind, sha256, and non-negative size');
    }
  }
  return result;
}

export function normalizeEvidenceManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('manifest must be an object');
  const version = raw.schemaVersion === undefined ? 1 : raw.schemaVersion;
  if (version !== 1 && version !== 2) throw new TypeError('unsupported schema version');
  if (version === 1) return { schemaVersion: 1, intent: clone(raw) };
  return {
    schemaVersion: 2,
    intent: clone(raw.intent ?? {}),
    constraints: assertArray(raw.constraints, 'constraints'),
    artifacts: assertRelativeArtifacts(raw.artifacts),
    toolchain: clone(raw.toolchain ?? {}),
    facts: assertArray(raw.facts, 'facts'),
    findings: assertArray(raw.findings, 'findings'),
    approvals: assertArray(raw.approvals, 'approvals'),
    releaseGates: assertArray(raw.releaseGates, 'releaseGates')
  };
}

export function evidenceFreshness({ manifest, projectDigest }) {
  if (!manifest) return { status: 'missing', reason: 'No ChatPCB manifest exists.' };
  if (manifest.schemaVersion === 1) return { status: 'legacy-unverified', reason: 'Schema version 1 has no artifact-bound evidence.' };
  const recorded = manifest.artifacts.length > 0 ? projectDigestForArtifacts(manifest.artifacts) : null;
  if (!recorded) return { status: 'missing', reason: 'Schema version 2 has no project digest.' };
  if (recorded !== projectDigest) return { status: 'stale', reason: `Evidence digest ${recorded} does not match saved project digest ${projectDigest}.` };
  return { status: 'current', reason: 'Evidence matches the saved project artifacts.' };
}

export function projectDigestForArtifacts(artifacts) {
  const normalized = assertRelativeArtifacts(artifacts)
    .map(({ path, kind, sha256, size }) => ({ path, kind, sha256, size }))
    .sort(compareArtifactPaths);
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export function createEvidenceManifestV2({ intent = {}, constraints = [], artifacts = [], toolchain = {}, facts = [], findings = [], approvals = [], releaseGates = [] } = {}) {
  return normalizeEvidenceManifest({
    schemaVersion: 2,
    intent: clone(intent),
    constraints,
    artifacts,
    toolchain: clone(toolchain),
    facts,
    findings,
    approvals,
    releaseGates
  });
}
