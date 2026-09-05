// External execution is unavailable until a sandboxed launcher can enforce
// payload integrity and deny writes to the authoritative project.
// Do not add a caller-controlled override or fall back to child_process.
export async function runConfiguredAnalyzer({ definition, inventory } = {}) {
  const text = (value) => typeof value === 'string' && value ? value : 'unknown';
  return {
    analyzer: {
      id: text(definition?.id),
      namespace: text(definition?.namespace),
      version: text(definition?.version),
      status: 'skipped',
      sourceArtifacts: (inventory?.artifacts ?? [])
        .map((artifact) => artifact.path).filter((value) => typeof value === 'string').sort(),
      diagnostics: [{
        code: 'ANALYZER_SANDBOX_UNAVAILABLE',
        message: 'External analyzer execution is disabled until a sandboxed launcher enforces payload integrity and read-only project access.'
      }]
    },
    facts: [],
    findings: []
  };
}
