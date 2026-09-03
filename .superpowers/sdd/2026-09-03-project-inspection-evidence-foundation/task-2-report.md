# Task 2 Report: Evidence Manifest Normalization and Freshness

## Status

Complete. Implementation commit: `feat: define artifact-bound evidence manifest`.

## Implementation summary

Implemented `normalizeEvidenceManifest`, `evidenceFreshness`, and `createEvidenceManifestV2` in `src/evidence/evidence-manifest.js`.

- Legacy schema-v1 metadata remains readable under `intent` and is reported as `legacy-unverified`.
- Schema v2 is normalized with defensive copies, default empty `facts`, `findings`, and `approvals` arrays, and validated artifact paths.
- Unsupported schema versions, non-object manifests, malformed arrays, and absolute/traversal artifact paths are rejected.
- Freshness reports `missing`, `legacy-unverified`, `stale`, or `current` using the specified reasons.

## Files

- `src/evidence/evidence-manifest.js`
- `tests/evidence-manifest.test.js`

## TDD evidence

### RED

Command:

```text
node --test tests/evidence-manifest.test.js
```

Result: failed as expected with `ERR_MODULE_NOT_FOUND` because the evidence manifest module did not yet exist.

### GREEN

Command:

```text
node --test tests/evidence-manifest.test.js
```

Result: 4 tests passed, 0 failed.

The tests cover legacy readability and freshness, digest mismatch staleness, strict version/array rejection, stable v2 keys, defensive array copies, defaults, and relative artifact paths.

## Full-suite verification

Command:

```text
npm test
```

Result: 118 tests passed, 0 failed, 1 skipped (the Windows symlink test).

## Self-review

- `git diff --check` completed without whitespace errors.
- No release-readiness logic was added.
- Legacy input is cloned and retained under `intent`; v2 arrays and nested records are defensively copied.
- Artifact paths are required to be relative and cannot contain traversal segments.
