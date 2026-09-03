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
  }
  return result;
}

export function normalizeEvidenceManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('manifest must be an object');
  const version = raw.schemaVersion === undefined ? 1 : raw.schemaVersion;
  if (version !== 1 && version !== 2) throw new TypeError('unsupported schema version');
  if (version === 1) return { schemaVersion: 1, intent: clone(raw) };
  const manifest = clone(raw);
  manifest.schemaVersion = 2;
  manifest.facts = assertArray(manifest.facts, 'facts');
  manifest.findings = assertArray(manifest.findings, 'findings');
  manifest.approvals = assertArray(manifest.approvals, 'approvals');
  if (manifest.inspection?.artifacts !== undefined) manifest.inspection.artifacts = assertRelativeArtifacts(manifest.inspection.artifacts);
  if (manifest.evidence?.artifacts !== undefined) manifest.evidence.artifacts = assertRelativeArtifacts(manifest.evidence.artifacts);
  return manifest;
}

export function evidenceFreshness({ manifest, projectDigest }) {
  if (!manifest) return { status: 'missing', reason: 'No ChatPCB manifest exists.' };
  if (manifest.schemaVersion === 1) return { status: 'legacy-unverified', reason: 'Schema version 1 has no artifact-bound evidence.' };
  const recorded = manifest.evidence?.projectDigest;
  if (!recorded) return { status: 'missing', reason: 'Schema version 2 has no project digest.' };
  if (recorded !== projectDigest) return { status: 'stale', reason: `Evidence digest ${recorded} does not match saved project digest ${projectDigest}.` };
  return { status: 'current', reason: 'Evidence matches the saved project artifacts.' };
}

export function createEvidenceManifestV2({ intent = {}, inspection = {}, toolchain = {}, facts = [], findings = [], approvals = [], evidence = {} } = {}) {
  return normalizeEvidenceManifest({ schemaVersion: 2, intent: clone(intent), inspection: clone(inspection), toolchain: clone(toolchain), evidence: clone(evidence), facts, findings, approvals });
}
