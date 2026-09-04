import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { redactProviderText } from '../runtime/provider-process.js';
import { normalizeFacts, normalizeFinding } from './fact-contract.js';

const MAX_TIMEOUT_MS = 5 * 60 * 1000;
const TERMINATION_GRACE_MS = 75;
const CONFIDENCES = new Set(['deterministic', 'heuristic', 'datasheet-backed']);

function diagnostic(code, message, stderr = '') {
  const result = { code, message };
  if (stderr) result.stderr = redactProviderText(stderr);
  return result;
}

function sourceArtifacts(inventory) {
  return Array.isArray(inventory?.artifacts)
    ? inventory.artifacts.map((artifact) => artifact.path).filter((artifact) => typeof artifact === 'string').sort()
    : [];
}

function analyzerFor(definition, inventory, status, diagnostics = []) {
  return {
    id: definition?.id ?? 'unknown',
    namespace: definition?.namespace ?? 'unknown',
    version: definition?.version ?? 'unknown',
    status,
    sourceArtifacts: sourceArtifacts(inventory),
    diagnostics
  };
}

function invalidDefinition(definition, inventory, message) {
  return { analyzer: analyzerFor(definition, inventory, 'failed', [diagnostic('ANALYZER_ADAPTER_INVALID_DEFINITION', message)]), facts: [], findings: [] };
}

function validateDefinition(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) return 'Adapter definition must be an object';
  for (const field of ['id', 'namespace', 'version']) {
    if (typeof definition[field] !== 'string' || definition[field].trim() === '') return `Adapter ${field} must be a non-empty string`;
  }
  if (typeof definition.command !== 'string' || !path.isAbsolute(definition.command)) return 'Adapter command must be an absolute path';
  if (!Array.isArray(definition.args) || definition.args.some((arg) => typeof arg !== 'string')) return 'Adapter args must be an array of strings';
  if (typeof definition.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(definition.sha256)) return 'Adapter sha256 must be a lowercase SHA-256 digest';
  if (!Number.isInteger(definition.timeoutMs) || definition.timeoutMs <= 0 || definition.timeoutMs > MAX_TIMEOUT_MS) return 'Adapter timeoutMs must be an integer between 1 and 300000';
  if (definition.input !== 'project-copy' && definition.input !== 'json') return 'Adapter input must be project-copy or json';
  return null;
}

function hashBuffer(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

function sourceMap(sourceFiles, allowedArtifacts) {
  if (sourceFiles && !Array.isArray(sourceFiles) && typeof sourceFiles === 'object') {
    return Object.fromEntries(Object.entries(sourceFiles)
      .filter(([artifact]) => allowedArtifacts.has(artifact))
      .map(([artifact, source]) => [artifact, asUtf8(source)]));
  }
  return Object.fromEntries((sourceFiles ?? []).flatMap((entry) => {
    const artifact = entry?.artifact?.path ?? entry?.path;
    const source = entry?.source ?? entry?.content;
    return typeof artifact === 'string' && allowedArtifacts.has(artifact) && source !== undefined ? [[artifact, asUtf8(source)]] : [];
  }));
}

function asUtf8(value) {
  return typeof value === 'string' ? value : Buffer.from(value).toString('utf8');
}

function unsafeInputError(entry) {
  const error = new Error(`Project copy contains a symbolic link: ${entry}`);
  error.code = 'ANALYZER_ADAPTER_UNSAFE_INPUT';
  return error;
}

async function assertSymlinkFree(directory, fileSystem) {
  if ((await fileSystem.lstat(directory)).isSymbolicLink()) throw unsafeInputError(directory);
  for (const entry of await fileSystem.readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw unsafeInputError(entryPath);
    if (entry.isDirectory()) await assertSymlinkFree(entryPath, fileSystem);
  }
}

function runProcess({ command, args, input, cwd, env, timeoutMs, spawnImpl }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (error) {
      resolve({ error, stdout: '', stderr: '' });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let timer;
    let forceKillTimer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceKillTimer);
      resolve({ stdout, stderr, ...result });
    };
    timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch { /* process is already gone */ }
      forceKillTimer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* process is already gone */ }
      }, TERMINATION_GRACE_MS);
    }, timeoutMs);

    child.stdout?.setEncoding?.('utf8');
    child.stderr?.setEncoding?.('utf8');
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => finish({ error, timedOut }));
    child.once('close', (exitCode) => finish({ exitCode, timedOut }));
    try {
      if (input) child.stdin.write(input);
      child.stdin.end();
    } catch (error) {
      try { child.kill('SIGTERM'); } catch { /* process is already gone */ }
      finish({ error });
    }
  });
}

function parseOutput(stdout, inventory, definition) {
  let output;
  try { output = JSON.parse(stdout); } catch { return null; }
  if (!output || typeof output !== 'object' || Array.isArray(output)
    || !Number.isInteger(output.schemaVersion) || !Array.isArray(output.facts)
    || (output.findings !== undefined && !Array.isArray(output.findings))) return null;

  const allowedArtifacts = new Set(sourceArtifacts(inventory));
  const prefix = `${definition.namespace}.`;
  const extractor = `${definition.namespace}@${definition.version}`;
  const facts = [];
  for (const fact of output.facts) {
    if (!fact || typeof fact !== 'object' || Array.isArray(fact)
      || typeof fact.id !== 'string' || fact.id.trim() === ''
      || typeof fact.sourceArtifact !== 'string' || !allowedArtifacts.has(fact.sourceArtifact)) return null;
    facts.push({
      ...fact,
      id: `${prefix}${fact.id}`,
      extractor,
      confidence: CONFIDENCES.has(fact.confidence) ? fact.confidence : 'heuristic'
    });
  }

  const findings = [];
  for (const finding of output.findings ?? []) {
    if (!finding || typeof finding !== 'object' || Array.isArray(finding)
      || typeof finding.id !== 'string' || finding.id.trim() === ''
      || (finding.sourceArtifacts !== undefined && (!Array.isArray(finding.sourceArtifacts) || finding.sourceArtifacts.some((artifact) => !allowedArtifacts.has(artifact))))
      || (finding.factIds !== undefined && (!Array.isArray(finding.factIds) || finding.factIds.some((factId) => typeof factId !== 'string')))) return null;
    findings.push({
      ...finding,
      id: `${prefix}${finding.id}`,
      extractor,
      confidence: CONFIDENCES.has(finding.confidence) ? finding.confidence : 'heuristic',
      factIds: (finding.factIds ?? []).map((factId) => `${prefix}${factId}`),
      sourceArtifacts: finding.sourceArtifacts ?? []
    });
  }
  const normalizedFacts = normalizeFacts(facts);
  if (normalizedFacts.diagnostics.some((item) => item.code === 'ANALYZER_FACT_INVALID')) return null;
  const normalizedFindings = [];
  try {
    for (const finding of findings) normalizedFindings.push(normalizeFinding(finding));
  } catch {
    return null;
  }
  return { facts: normalizedFacts.facts, findings: normalizedFindings, diagnostics: normalizedFacts.diagnostics };
}

export async function runConfiguredAnalyzer({
  definition,
  projectDir,
  inventory,
  sourceFiles = [],
  fsImpl = {},
  spawnImpl = spawn
} = {}) {
  const definitionError = validateDefinition(definition);
  if (definitionError) return invalidDefinition(definition, inventory, definitionError);

  const fileSystem = { readFile, cp, lstat, mkdtemp, readdir, rm, ...fsImpl };
  let executable;
  try {
    executable = await fileSystem.readFile(definition.command);
  } catch (error) {
    const code = 'ANALYZER_ADAPTER_UNAVAILABLE';
    return { analyzer: analyzerFor(definition, inventory, error?.code === 'ENOENT' ? 'skipped' : 'failed', [diagnostic(code, `Adapter executable is unavailable: ${error?.code ?? error?.message}`)]), facts: [], findings: [] };
  }
  if (hashBuffer(executable) !== definition.sha256) {
    return { analyzer: analyzerFor(definition, inventory, 'failed', [diagnostic('ANALYZER_ADAPTER_CHECKSUM_MISMATCH', 'Adapter executable checksum does not match its pinned SHA-256')]), facts: [], findings: [] };
  }

  let disposableProjectDir;
  try {
    let args = [...definition.args];
    let input = '';
    const env = { ...process.env };
    if (definition.input === 'project-copy') {
      disposableProjectDir = await fileSystem.mkdtemp(path.join(tmpdir(), 'chatpcb-analyzer-'));
      await assertSymlinkFree(projectDir, fileSystem);
      await fileSystem.cp(projectDir, disposableProjectDir, { recursive: true });
      await assertSymlinkFree(disposableProjectDir, fileSystem);
      args = args.map((arg) => arg === '{projectDir}' ? disposableProjectDir : arg);
      env.CHATPCB_ANALYZER_PROJECT_DIR = disposableProjectDir;
    } else {
      input = JSON.stringify({ projectDigest: inventory?.projectDigest, artifacts: inventory?.artifacts ?? [], sources: sourceMap(sourceFiles, new Set(sourceArtifacts(inventory))) });
    }
    const processResult = await runProcess({ command: definition.command, args, input, cwd: disposableProjectDir, env, timeoutMs: definition.timeoutMs, spawnImpl });
    if (processResult.timedOut) {
      return { analyzer: analyzerFor(definition, inventory, 'failed', [diagnostic('ANALYZER_ADAPTER_TIMEOUT', `Adapter timed out after ${definition.timeoutMs}ms`, processResult.stderr)]), facts: [], findings: [] };
    }
    if (processResult.error || processResult.exitCode !== 0) {
      const code = processResult.error?.code === 'ENOENT' ? 'ANALYZER_ADAPTER_UNAVAILABLE' : 'ANALYZER_ADAPTER_FAILED';
      const status = code === 'ANALYZER_ADAPTER_UNAVAILABLE' ? 'skipped' : 'failed';
      return { analyzer: analyzerFor(definition, inventory, status, [diagnostic(code, `Adapter process failed${processResult.exitCode === undefined ? '' : ` with exit code ${processResult.exitCode}`}`, processResult.stderr)]), facts: [], findings: [] };
    }
    const normalized = parseOutput(processResult.stdout.trim(), inventory, definition);
    if (!normalized) {
      return { analyzer: analyzerFor(definition, inventory, 'failed', [diagnostic('ANALYZER_ADAPTER_INVALID_OUTPUT', 'Adapter output must be a valid analyzer JSON object', processResult.stderr)]), facts: [], findings: [] };
    }
    const status = normalized.diagnostics.length === 0 ? 'complete' : 'partial';
    return { analyzer: analyzerFor(definition, inventory, status, normalized.diagnostics), facts: normalized.facts, findings: normalized.findings };
  } catch (error) {
    if (error?.code === 'ANALYZER_ADAPTER_UNSAFE_INPUT') {
      return { analyzer: analyzerFor(definition, inventory, 'failed', [diagnostic(error.code, error.message)]), facts: [], findings: [] };
    }
    return { analyzer: analyzerFor(definition, inventory, 'failed', [diagnostic('ANALYZER_ADAPTER_FAILED', `Adapter execution failed: ${error?.code ?? error?.message}`)]), facts: [], findings: [] };
  } finally {
    if (disposableProjectDir) {
      try { await fileSystem.rm(disposableProjectDir, { force: true, recursive: true, maxRetries: 3, retryDelay: 100 }); }
      catch { /* process has closed; cleanup failure must not override the typed adapter result */ }
    }
  }
}
