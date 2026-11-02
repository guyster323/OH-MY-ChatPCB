// PR #29 Hygiene r1 / BT AP-1: fail-closed paths of validateProject, the
// opt-in launcher retry in runKicadCli, and the shared stderr excerpt.
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runCommand, runKicadCli } from '../src/kicad/kicad-cli.js';
import { STDERR_EXCERPT_CHARS, stderrExcerpt } from '../src/kicad/stderr-excerpt.js';
import { dispatchToolCall } from '../src/runtime/agent-daemon.js';
import { ercApprovalDecision, normalizeRecordedErc } from '../src/runtime/erc-gate.js';
import { createPatchApprovalRegistry } from '../src/runtime/patch-approval-registry.js';
import { validateProject } from '../src/workflow/validate-project.js';

const SCHEMATIC = '(kicad_sch (version 20231120))\n';
const MERGE_DIRS = 'error: Extension org.freedesktop.Platform.GL.default has invalid merge-dirs';
const POSIX_ONLY = process.platform === 'win32';
const approved = (result, override) => ercApprovalDecision(normalizeRecordedErc(result), override).allow === true;
const clean = () => ({ exitCode: 0, stdout: '', stderr: '', command: 'kicad-cli', source: 'path' });

async function withProject(run) {
  const dir = await mkdtemp(path.join(tmpdir(), 'chatpcb-erc-closed-'));
  await writeFile(path.join(dir, 'demo.kicad_sch'), SCHEMATIC);
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function throwing(error) {
  return async (args) => {
    if (args[1] === 'upgrade') return clean();
    throw error;
  };
}

function enoent(fields) {
  return Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT', ...fields });
}

test('a generic error fails closed and the skipped override cannot allow it', () => withProject(async (dir) => {
  const result = await validateProject({ projectDir: dir, runKicadCliImpl: throwing(new Error('boom')) });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, false);
  assert.equal(result.reason.code, 'VALIDATION_ERROR');
  assert.equal(approved(result), false);
  assert.equal(approved(result, 'skipped'), false);
}));

test('an ENOENT that is not a spawn of kicad-cli does not skip', () => withProject(async (dir) => {
  const result = await validateProject({
    projectDir: dir,
    runKicadCliImpl: throwing(enoent({ syscall: 'open', path: path.join(dir, 'chatpcb-erc.json') }))
  });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, false);
  assert.equal(result.reason.code, 'VALIDATION_ERROR');
  assert.equal(approved(result, 'skipped'), false);
}));

test('only a provably missing kicad-cli is an overridable skip', () => withProject(async (dir) => {
  const unresolved = await validateProject({ projectDir: dir, runKicadCliImpl: throwing(enoent({})) });
  assert.equal(unresolved.skipped, true);
  assert.equal(unresolved.reason.code, 'KICAD_CLI_UNAVAILABLE');

  const missing = path.join(dir, 'no-such-kicad-cli');
  const spawnMissing = await validateProject({
    projectDir: dir,
    runKicadCliImpl: throwing(enoent({ syscall: `spawn ${missing}`, path: missing }))
  });
  assert.equal(spawnMissing.skipped, true);
  assert.equal(spawnMissing.reason.code, 'KICAD_CLI_UNAVAILABLE');
  assert.equal(approved(spawnMissing, 'skipped'), true);

  const present = process.execPath;
  const spawnPresent = await validateProject({
    projectDir: dir,
    runKicadCliImpl: throwing(enoent({ syscall: `spawn ${present}`, path: present }))
  });
  assert.equal(spawnPresent.skipped, false);
  assert.equal(spawnPresent.ok, false);
  assert.equal(approved(spawnPresent, 'skipped'), false);
}));

// BT AP-1 (triage/erc-flake/pr29-rereview.md): a real spawn ENOENT caused by a
// vanished cwd names an existing binary and must not become a skip.
test('a vanished project dir is not a missing kicad-cli skip', { skip: POSIX_ONLY }, () => withProject(async (dir) => {
  const result = await validateProject({ projectDir: dir, runKicadCliImpl: async (args, options) => {
    if (args[1] === 'upgrade') return clean();
    await rm(dir, { recursive: true, force: true });
    return { ...(await runCommand(process.execPath, ['-e', ''], { cwd: options.cwd })), source: 'flatpak' };
  } });
  assert.equal(result.skipped, false);
  assert.equal(result.ok, false);
  assert.equal(approved(result, 'skipped'), false);
}));

test('validateProject opts its upgrade and ERC calls into the launcher retry', () => withProject(async (dir) => {
  const seen = [];
  await validateProject({ projectDir: dir, runKicadCliImpl: async (args, options) => {
    seen.push(options.retryLauncherFailure);
    if (args[1] === 'erc') await writeFile(args[args.indexOf('--output') + 1], JSON.stringify({ sheets: [] }));
    return clean();
  } });
  assert.deepEqual(seen, [true, true]);
}));

// A fake flatpak kicad-cli: the first run fails like the flatpak launcher,
// later runs succeed. Each run appends a line to a counter file.
async function withFakeFlatpakCli(run) {
  const dir = await mkdtemp(path.join(tmpdir(), 'chatpcb-fake-flatpak-'));
  const counter = path.join(dir, 'runs');
  const script = path.join(dir, 'kicad-cli');
  await writeFile(counter, '');
  await writeFile(script, [
    '#!/bin/sh',
    `echo run >> '${counter}'`,
    `if [ "$(wc -l < '${counter}')" -eq 1 ]; then echo "F: Can't get document portal" >&2; echo '${MERGE_DIRS}' >&2; exit 1; fi`,
    'echo ok',
    ''
  ].join('\n'));
  await chmod(script, 0o755);
  const env = { PATH: process.env.PATH ?? '', HOME: dir, KICAD_CLI_FLATPAK: '1' };
  const runs = async () => (await readFile(counter, 'utf8')).split('\n').filter(Boolean).length;
  try {
    return await run({ script, env, cwd: dir, runs });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('runKicadCli retries a flatpak launcher failure exactly once when asked', { skip: POSIX_ONLY }, () => withFakeFlatpakCli(async ({ script, env, cwd, runs }) => {
  const result = await runKicadCli(['version'], { explicitPath: script, env, cwd, retryLauncherFailure: true });
  assert.equal(result.source, 'flatpak');
  assert.equal(result.exitCode, 0);
  assert.equal(result.launchRetried, true);
  assert.equal(await runs(), 2);
}));

test('runKicadCli does not retry when the caller did not opt in', { skip: POSIX_ONLY }, () => withFakeFlatpakCli(async ({ script, env, cwd, runs }) => {
  const result = await runKicadCli(['version'], { explicitPath: script, env, cwd });
  assert.equal(result.exitCode, 1);
  assert.equal(result.launchRetried, undefined);
  assert.equal(await runs(), 1);
}));

test('stderrExcerpt masks POSIX and Windows absolute paths', () => {
  assert.equal(
    stderrExcerpt('error: cannot open /home/sunny/.cache/kicad/x.json'),
    'error: cannot open <path>'
  );
  assert.equal(
    stderrExcerpt('Error: C:\\Users\\sunny\\proj\\demo.kicad_sch not found'),
    'Error: <path> not found'
  );
  assert.equal(stderrExcerpt('org.freedesktop.Platform.GL.default and/or 3/4'), 'org.freedesktop.Platform.GL.default and/or 3/4');
});

test('stderrExcerpt collapses lines and truncates to the shared limit', () => {
  assert.equal(stderrExcerpt("F: Can't get document portal\nerror: merge-dirs\r\n\n"), "F: Can't get document portal error: merge-dirs");
  const long = stderrExcerpt('x'.repeat(STDERR_EXCERPT_CHARS + 50));
  assert.equal(long.length, STDERR_EXCERPT_CHARS);
  assert.ok(long.endsWith('...'));
  assert.equal(stderrExcerpt('y'.repeat(STDERR_EXCERPT_CHARS)), 'y'.repeat(STDERR_EXCERPT_CHARS));
  assert.equal(stderrExcerpt(undefined), '');
});

test('the ERC_BLOCKED reason reuses the shared excerpt for recorded stderr', () => {
  const decision = ercApprovalDecision(normalizeRecordedErc({
    ok: false,
    status: 'failed',
    reason: { code: 'KICAD_CLI_LAUNCH_FAILED', stderr: `/var/x ${'z'.repeat(400)}` }
  }));
  assert.equal(decision.reasonCode, 'KICAD_CLI_LAUNCH_FAILED');
  assert.ok(decision.stderr.startsWith('<path> '));
  assert.equal(decision.stderr.length, STDERR_EXCERPT_CHARS);
});

test('the upgrade-failure reason says whether the ERC result was kept', () => withProject(async (dir) => {
  const run = (upgrade) => validateProject({ projectDir: dir, runKicadCliImpl: async (args) => {
    if (args[1] === 'upgrade') return upgrade;
    await writeFile(args[args.indexOf('--output') + 1], JSON.stringify({ sheets: [] }));
    return { ...clean(), source: 'flatpak' };
  } });
  const tolerated = await run({ exitCode: 1, stdout: '', stderr: MERGE_DIRS, source: 'flatpak' });
  assert.equal(tolerated.ok, true);
  assert.match(tolerated.reason.message, /schematic is unchanged/);
  const rejected = await run({ exitCode: 1, stdout: '', stderr: 'Failed to load schematic', source: 'path' });
  assert.equal(rejected.ok, false);
  assert.match(rejected.reason.message, /not trusted/);
}));

test('a spawn ENOENT with a vanished cwd is not a skip even when the binary is missing too', () => withProject(async (dir) => {
  const missing = path.join(dir, 'no-such-kicad-cli');
  const result = await validateProject({ projectDir: dir, runKicadCliImpl: async (args) => {
    if (args[1] === 'upgrade') return clean();
    await rm(dir, { recursive: true, force: true });
    throw enoent({ syscall: `spawn ${missing}`, path: missing });
  } });
  assert.equal(result.skipped, false);
  assert.equal(approved(result, 'skipped'), false);
}));

test('the ERC_BLOCKED detail is only shown for a failed run with a well-formed code', () => {
  const skippedRun = ercApprovalDecision(normalizeRecordedErc({ ok: true, skipped: true, reason: { code: 'KICAD_CLI_UNAVAILABLE', stderr: 'x' } }));
  assert.equal(skippedRun.reason, 'skipped');
  assert.equal(skippedRun.reasonCode, undefined);
  assert.doesNotMatch(skippedRun.message, /Reason:/);

  const badCode = ercApprovalDecision(normalizeRecordedErc({ ok: false, status: 'failed', reason: { code: 'not a code\n', stderr: 'x' } }));
  assert.equal(badCode.reasonCode, undefined);
  assert.equal(badCode.message, 'ERC_BLOCKED: ERC did not pass for this patch.');
});

test('the daemon ERC_BLOCKED response carries the recorded reason and stderr excerpt', () => withProject(async (dir) => {
  const registry = createPatchApprovalRegistry();
  registry.register({
    patchId: 'patch-reason',
    projectDir: dir,
    plan: {
      proposalId: 'patch-reason',
      changes: [],
      candidateVerification: {
        erc: { ok: false, status: 'failed', errorCount: 0, erc: { errorCount: 0 }, reason: { code: 'KICAD_CLI_LAUNCH_FAILED', stderr: MERGE_DIRS } }
      }
    }
  });
  const blocked = await dispatchToolCall({
    name: 'schematic.patch',
    args: { projectDir: dir, approved: true, patchId: 'patch-reason' }
  }, { patchApprovalRegistry: registry });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'ERC_BLOCKED');
  assert.match(blocked.error.message, /Reason: KICAD_CLI_LAUNCH_FAILED/);
  assert.deepEqual(blocked.ercReason, { code: 'KICAD_CLI_LAUNCH_FAILED', stderr: MERGE_DIRS });
}));
