import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { collectTransactionSnapshot, transactionArtifactKind } from '../evidence/transaction-inventory.js';
import { CONVERSATION_FILE } from '../runtime/request-conversation.js';
import { generateMcuPeripheralProject } from './generate-mcu-project.js';
import { assertSafeProjectDir } from './project-workspace.js';
import { reviewCircuitReadiness } from './review-project.js';
import { validateBoard } from './validate-board.js';
import { validateProject } from './validate-project.js';

const WHAT = 'Regenerate the supported ChatPCB project artifact set from the requested circuit specification.';
const RISKS = [
  'This NativeProposalSource performs full project regeneration rather than a surgical selection edit.',
  'Selection connectivity is not proven by the current analyzer.'
];
const WHY = 'Replace live ChatPCB project artifacts with a regenerated native candidate from the requested circuit specification.';
const MAX_DIFF_BYTES = 5 * 1024 * 1024;
const TRANSIENT_NAMES = new Set(['chatpcb-erc.json', 'chatpcb-drc.json']);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function coded(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function promptFrom(request) {
  if (typeof request === 'string') return request;
  return request?.prompt;
}

function decodeUtf8(bytes, relativePath) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw coded('PROPOSAL_INVALID_UTF8', `Candidate artifact is not valid UTF-8: ${relativePath}`);
  }
}

function normalizeContext(context) {
  if (context == null || typeof context !== 'object') return null;
  const items = Array.isArray(context.items)
    ? context.items.map((item) => ({
      kind: item?.kind ?? null,
      kiid: item?.kiid ?? null,
      reference: item?.reference ?? null,
      text: item?.text ?? null
    })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
    : [];
  return {
    editor: context.editor ?? null,
    sheet: context.sheet ?? null,
    dirty: Boolean(context.dirty),
    items
  };
}

function firstArtifactPath(artifacts, extension) {
  return artifacts
    .map((item) => item.path)
    .filter((relativePath) => relativePath.endsWith(extension))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))[0] ?? null;
}

function requiredFromArtifacts(artifacts) {
  return {
    erc: artifacts.some((item) => item.path.endsWith('.kicad_sch')),
    drc: artifacts.some((item) => item.path.endsWith('.kicad_pcb'))
  };
}

function requiredFromChanges(changes) {
  return {
    erc: changes.some((change) => change.path.endsWith('.kicad_sch')),
    drc: changes.some((change) => change.path.endsWith('.kicad_pcb'))
  };
}

function isTransient(relativePath) {
  const base = path.posix.basename(relativePath);
  return TRANSIENT_NAMES.has(base) || base.endsWith('.kicad_prl');
}

async function walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

async function assertRecognizedCandidateFiles(candidateDir) {
  for (const absolute of await walkFiles(candidateDir)) {
    const relative = path.relative(candidateDir, absolute).split(path.sep).join('/');
    if (isTransient(relative)) continue;
    if (!transactionArtifactKind(relative)) {
      throw coded('PROPOSAL_UNRECOGNIZED_FILE', `Unrecognized candidate file: ${relative}`);
    }
  }
}

async function materializeCandidate(snapshot, candidateDir) {
  for (const file of snapshot.files) {
    const destination = path.join(candidateDir, ...file.path.split('/'));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, file.bytes);
  }
}

function prefixLines(value, prefix) {
  const lines = value.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.map((line) => `${prefix}${line}`);
}

function renderUnifiedDiff(relativePath, beforeText, afterText) {
  return [
    `--- ${relativePath}`,
    `+++ ${relativePath}`,
    '@@',
    ...prefixLines(beforeText, '-'),
    ...prefixLines(afterText, '+')
  ].join('\n');
}

function snapshotMap(snapshot) {
  return new Map(snapshot.files.map((file) => [file.path, file]));
}

function artifactRecords(snapshot) {
  return snapshot.artifacts.map((item) => ({
    path: item.path,
    hash: `sha256:${item.sha256}`
  }));
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

// ERC passes only with a numeric errorCount of 0 and no listed violations.
// DRC passes only when its violation and unconnected evidence is actually empty.
function numericErrorCount(result) {
  if (!result || typeof result !== 'object') return undefined;
  const nested = result.erc;
  if (nested && typeof nested === 'object') {
    const nestedCount = finiteNumber(nested.errorCount);
    if (nestedCount !== undefined) return nestedCount;
  }
  return finiteNumber(result.errorCount);
}

function missingVerdict(required) {
  return { skipped: false, executed: false, status: 'missing', required: required === true };
}

function withStatus(result, required, status) {
  return { ...result, status, required: required === true };
}

function ercViolationsClear(result) {
  if (!Object.hasOwn(result, 'violations')) return true;
  return Array.isArray(result.violations) && result.violations.length === 0;
}

function ercVerdict(result, required) {
  // null/undefined is missing evidence, not a skip. A skip can be overridden; missing cannot.
  if (result == null) return missingVerdict(required);
  const errorCount = numericErrorCount(result);
  const explicitSkip = result.skipped === true || result.executed === false;
  const violationsClear = ercViolationsClear(result);
  let status = 'unverified';
  if (!violationsClear || (typeof errorCount === 'number' && errorCount > 0)) status = 'failed';
  else if (explicitSkip) status = 'unverified';
  else if (result.ok === false) status = 'failed';
  else if (result.ok === true && errorCount === 0 && violationsClear) status = 'passed';
  else if (result.ok === true) status = 'missing';
  return withStatus(result, required, status);
}

function lengthIfArray(value) {
  return Array.isArray(value) ? value.length : undefined;
}

function drcProof(result) {
  const violations = lengthIfArray(result.violations);
  const unconnected = lengthIfArray(
    Object.hasOwn(result, 'unconnectedItems') ? result.unconnectedItems : result.unconnected_items
  );
  const nested = result.drc && typeof result.drc === 'object' && !Array.isArray(result.drc) ? result.drc : null;
  const violationCount = finiteNumber(nested ? nested.violationCount : result.violationCount);
  const unconnectedCount = finiteNumber(nested ? nested.unconnectedCount : result.unconnectedCount);
  const dirty = (violations !== undefined && violations > 0)
    || (unconnected !== undefined && unconnected > 0)
    || (violationCount !== undefined && violationCount > 0)
    || (unconnectedCount !== undefined && unconnectedCount > 0)
    || (Object.hasOwn(result, 'violations') && !Array.isArray(result.violations))
    || (Object.hasOwn(result, 'unconnectedItems') && !Array.isArray(result.unconnectedItems))
    || (Object.hasOwn(result, 'unconnected_items') && !Array.isArray(result.unconnected_items));
  const cleanLists = violations === 0 && unconnected === 0;
  const cleanCounts = violationCount === 0 && unconnectedCount === 0;
  return { dirty, clean: dirty === false && (cleanLists || cleanCounts) };
}

function drcVerdict(result, required) {
  if (result == null) return missingVerdict(required);
  const proof = drcProof(result);
  const explicitSkip = result.skipped === true || result.executed === false;
  let status = 'unverified';
  if (proof.dirty) status = 'failed';
  else if (explicitSkip) status = 'unverified';
  else if (result.ok === false) status = 'failed';
  else if (result.ok === true && proof.clean) status = 'passed';
  else if (result.ok === true) status = 'missing';
  return withStatus(result, required, status);
}

function isLegacyErcResult(result) {
  return Boolean(
    result
    && typeof result.ok === 'boolean'
    && result.erc
    && typeof result.erc.errorCount === 'number'
    && result.drc == null
  );
}

function ercReport(result) {
  if (result == null) return result;
  if (result.erc && typeof result.erc === 'object' && typeof result.erc.errorCount === 'number') {
    return result.erc;
  }
  return result;
}

function normalizeCandidateVerification(result, required) {
  const skipped = { ok: true, skipped: true, executed: false };
  if (result == null) {
    return {
      erc: ercVerdict(null, required.erc),
      drc: drcVerdict(null, required.drc)
    };
  }
  if (isLegacyErcResult(result)) {
    return {
      erc: ercVerdict(result, required.erc),
      drc: drcVerdict(skipped, required.drc)
    };
  }
  // A missing erc/drc field is an absent verifier result. Do not invent a skip.
  return {
    erc: ercVerdict(result.erc ?? null, required.erc),
    drc: drcVerdict(result.drc ?? null, required.drc)
  };
}

function candidatePassed(verification, required) {
  if (required.erc && verification.erc.status !== 'passed') return false;
  if (required.drc && verification.drc.status !== 'passed') return false;
  return true;
}

function componentsFrom(spec) {
  return (spec?.schematic?.components ?? []).map((component) => ({
    ref: component.ref,
    value: component.value,
    libId: component.libId
  }));
}

function netsFrom(spec) {
  return (spec?.schematic?.nets ?? []).map((net) => net.name);
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw coded('PROPOSAL_CANCELLED', 'Candidate generation was cancelled.');
  }
}

export function createCandidateValidator({
  validateProjectImpl = validateProject,
  validateBoardImpl = validateBoard
} = {}) {
  return async function validateCandidate({
    projectDir,
    excludeProjectDir,
    requiredValidation,
    schematicPath,
    boardPath
  }) {
    const [erc, drc] = await Promise.all([
      requiredValidation.erc
        ? validateProjectImpl({ projectDir, schematicPath, excludeProjectDir })
        : Promise.resolve({ ok: true, skipped: true, executed: false }),
      requiredValidation.drc
        ? validateBoardImpl({ projectDir, boardPath, excludeProjectDir })
        : Promise.resolve({ ok: true, skipped: true, executed: false })
    ]);
    return { erc, drc };
  };
}

const defaultValidateCandidate = createCandidateValidator();

function buildChanges(beforeSnapshot, afterSnapshot) {
  const beforeFiles = snapshotMap(beforeSnapshot);
  const afterFiles = snapshotMap(afterSnapshot);
  const paths = [...new Set([...beforeFiles.keys(), ...afterFiles.keys()])].sort((left, right) => (
    left < right ? -1 : left > right ? 1 : 0
  ));
  const changes = [];

  for (const relativePath of paths) {
    const before = beforeFiles.get(relativePath);
    const after = afterFiles.get(relativePath);
    if (before && after && before.sha256 === after.sha256) continue;

    const beforeBytes = before ? Buffer.from(before.bytes) : null;
    const afterBytes = after ? Buffer.from(after.bytes) : null;
    const beforeHash = beforeBytes ? sha256(beforeBytes) : null;
    const afterHash = afterBytes ? sha256(afterBytes) : null;
    if (beforeBytes && beforeHash !== before.sha256) {
      throw coded('PROPOSAL_UNVERIFIED_BYTES', `Before bytes do not hash to beforeHash for ${relativePath}.`);
    }
    if (afterBytes && afterHash !== after.sha256) {
      throw coded('PROPOSAL_UNVERIFIED_BYTES', `After bytes do not hash to afterHash for ${relativePath}.`);
    }

    const operation = !before ? 'create' : !after ? 'delete' : 'modify';
    const beforeText = beforeBytes ? decodeUtf8(beforeBytes, relativePath) : '';
    const afterText = afterBytes ? decodeUtf8(afterBytes, relativePath) : '';
    changes.push({
      path: relativePath,
      operation,
      beforeHash,
      afterHash,
      beforeBytes,
      afterBytes,
      unifiedDiff: renderUnifiedDiff(relativePath, beforeText, afterText)
    });
  }

  return changes;
}

export function proposalSource(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const id = typeof source.id === 'string' && source.id.length > 0 ? source.id : 'native';
  const version = typeof source.version === 'string' && source.version.length > 0 ? source.version : '1';
  const namedProvider = typeof source.provider === 'string' && source.provider.length > 0 ? source.provider : null;
  const via = source.via === 'provider' && namedProvider ? 'provider' : 'native-fallback';
  return {
    id,
    version,
    provider: via === 'provider' ? namedProvider : null,
    via
  };
}

function proposalIdFor({ baseTransactionDigest, context, changes, source }) {
  const payload = JSON.stringify({
    baseTransactionDigest,
    source,
    context: normalizeContext(context),
    afterHashes: changes.map((change) => ({ path: change.path, afterHash: change.afterHash }))
  });
  return `sha256:${sha256(payload)}`;
}

function targetFilesFrom(proposed, candidateDir, projectDir) {
  const targetFiles = {};
  for (const [kind, proposedPath] of Object.entries(proposed.files ?? {})) {
    const relativeName = path.relative(candidateDir, proposedPath).split(path.sep).join('/');
    targetFiles[kind] = path.join(projectDir, ...relativeName.split('/'));
  }
  return targetFiles;
}

export function publicProposal(plan) {
  return {
    schemaVersion: 1,
    proposalId: plan.proposalId,
    source: plan.source,
    why: plan.why,
    what: plan.what,
    files: plan.changes.map((change) => ({ path: change.path, operation: change.operation })),
    components: plan.components,
    nets: plan.nets,
    risks: plan.risks,
    verificationPlan: plan.verificationPlan,
    candidateVerification: plan.candidateVerification,
    artifactChanges: plan.changes.map((change) => ({
      path: change.path,
      operation: change.operation,
      beforeHash: change.beforeHash,
      afterHash: change.afterHash,
      unifiedDiff: change.unifiedDiff
    })),
    contextSummary: plan.contextSummary,
    baseTransactionDigest: plan.baseTransactionDigest,
    requiredValidation: plan.requiredValidation
  };
}

export async function disposeNativeProposal(plan) {
  if (!plan?.tempDir) return;
  await rm(plan.tempDir, { force: true, recursive: true });
}

export const nativeProposalSource = {
  id: 'native',
  createCandidate(args) {
    return createNativeProposal(args);
  },
  disposeCandidate(plan) {
    return disposeNativeProposal(plan);
  }
};

export async function createNativeProposal({
  projectDir,
  request,
  projectName = 'chatpcb_mcu_peripheral',
  context,
  signal,
  validateCandidateImpl,
  generateProjectImpl = generateMcuPeripheralProject,
  conversationBytes,
  source
} = {}) {
  if (!projectDir) {
    throw new Error('projectDir is required.');
  }

  const resolvedProjectDir = assertSafeProjectDir(projectDir);
  const designSource = proposalSource(source);
  const prompt = promptFrom(request);
  const beforeSnapshot = await collectTransactionSnapshot({ projectDir: resolvedProjectDir });
  const createdRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-native-proposal-'));
  let tempDir = createdRoot;
  try {
    tempDir = await realpath(createdRoot);
    const candidateDir = path.join(tempDir, 'project');
    await mkdir(candidateDir, { recursive: true });
    await materializeCandidate(beforeSnapshot, candidateDir);
    throwIfAborted(signal);

    const proposed = await generateProjectImpl({ projectDir: candidateDir, prompt, projectName });
    throwIfAborted(signal);
    if (conversationBytes?.length) {
      await writeFile(path.join(candidateDir, CONVERSATION_FILE), conversationBytes);
    }
    const generatedSnapshot = await collectTransactionSnapshot({ projectDir: candidateDir });
    const candidateRequired = requiredFromArtifacts(generatedSnapshot.artifacts);
    const schematicRelative = firstArtifactPath(generatedSnapshot.artifacts, '.kicad_sch');
    const boardRelative = firstArtifactPath(generatedSnapshot.artifacts, '.kicad_pcb');
    const validateImpl = validateCandidateImpl ?? defaultValidateCandidate;
    throwIfAborted(signal);
    const rawVerification = await validateImpl({
      projectDir: candidateDir,
      excludeProjectDir: resolvedProjectDir,
      requiredValidation: candidateRequired,
      schematicPath: schematicRelative ? path.join(candidateDir, ...schematicRelative.split('/')) : undefined,
      boardPath: boardRelative ? path.join(candidateDir, ...boardRelative.split('/')) : undefined
    });

    await assertRecognizedCandidateFiles(candidateDir);
    const afterSnapshot = await collectTransactionSnapshot({ projectDir: candidateDir });
    const changes = buildChanges(beforeSnapshot, afterSnapshot);
    const combinedDiff = changes.map((change) => change.unifiedDiff).join('\n');
    if (Buffer.byteLength(combinedDiff, 'utf8') > MAX_DIFF_BYTES) {
      throw coded('PROPOSAL_DIFF_TOO_LARGE', 'Combined proposal diff exceeds the 5 MiB review limit.');
    }

    const requiredValidation = requiredFromChanges(changes);
    const candidateVerification = normalizeCandidateVerification(rawVerification, candidateRequired);
    const changedFiles = changes.map((change) => change.path);
    const proposalId = proposalIdFor({
      baseTransactionDigest: beforeSnapshot.transactionDigest,
      context,
      changes,
      source: designSource
    });

    return {
      tempDir,
      candidateRoot: candidateDir,
      candidateDir,
      source: designSource,
      why: WHY,
      what: WHAT,
      risks: RISKS,
      components: componentsFrom(proposed.spec),
      nets: netsFrom(proposed.spec),
      contextSummary: normalizeContext(context),
      proposalId,
      patchId: proposalId,
      baseTransactionDigest: beforeSnapshot.transactionDigest,
      afterTransactionDigest: afterSnapshot.transactionDigest,
      changes,
      requiredValidation,
      verificationPlan: {
        erc: {
          required: requiredValidation.erc,
          target: firstArtifactPath(afterSnapshot.artifacts, '.kicad_sch')
        },
        drc: {
          required: requiredValidation.drc,
          target: firstArtifactPath(afterSnapshot.artifacts, '.kicad_pcb')
        }
      },
      candidateVerification,
      proposed,
      proposedFiles: proposed.files,
      targetFiles: targetFilesFrom(proposed, candidateDir, resolvedProjectDir),
      changedFiles,
      diff: combinedDiff,
      beforeArtifacts: artifactRecords(beforeSnapshot),
      afterArtifacts: artifactRecords(afterSnapshot),
      beforeProjectDigest: beforeSnapshot.transactionDigest,
      afterProjectDigest: afterSnapshot.transactionDigest,
      validation: {
        ok: candidatePassed(candidateVerification, requiredValidation),
        skipped: candidateVerification.erc.skipped === true,
        erc: ercReport(isLegacyErcResult(rawVerification) ? rawVerification : rawVerification?.erc),
        drc: isLegacyErcResult(rawVerification) ? undefined : rawVerification?.drc
      },
      review: reviewCircuitReadiness({
        spec: proposed.spec,
        validation: isLegacyErcResult(rawVerification) ? rawVerification : rawVerification?.erc
      })
    };
  } catch (error) {
    await rm(tempDir, { force: true, recursive: true });
    if (tempDir !== createdRoot) {
      await rm(createdRoot, { force: true, recursive: true });
    }
    throw error;
  }
}
