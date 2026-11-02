import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { isKicadLauncherFailure, retryOnceOnLauncherFailure } from '../src/kicad/kicad-cli.js';
import { ercApprovalDecision, normalizeRecordedErc } from '../src/runtime/erc-gate.js';
import { validateProject } from '../src/workflow/validate-project.js';

const MERGE_DIRS = 'error: Extension org.freedesktop.Platform.GL.default has invalid merge-dirs\n';
const SCHEMATIC = '(kicad_sch (version 20231120))\n';

function launcherFailure() {
  return { exitCode: 1, stdout: '', stderr: MERGE_DIRS, command: 'flatpak', source: 'flatpak' };
}

async function writeReport(args, violations) {
  const reportPath = args[args.indexOf('--output') + 1];
  await writeFile(reportPath, JSON.stringify({ sheets: [{ violations }] }), 'utf8');
}

const WARNINGS = [
  { type: 'isolated_pin_label', severity: 'warning' },
  { type: 'isolated_pin_label', severity: 'warning' }
];

async function withProject(run) {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-launcher-flake-'));
  await writeFile(path.join(root, 'demo.kicad_sch'), SCHEMATIC, 'utf8');
  try {
    return await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

// Bug Triage stub (triage/erc-flake/stub.mjs): the flatpak launcher fails the
// format upgrade before KiCad starts, and ERC itself runs clean.
test('a flatpak launcher failure in sch upgrade does not block a clean ERC', async () => {
  await withProject(async (root) => {
    const result = await validateProject({
      projectDir: root,
      runKicadCliImpl: async (args) => {
        if (args[1] === 'upgrade') return launcherFailure();
        await writeReport(args, WARNINGS);
        return { exitCode: 0, stdout: 'Found 2 violations\n', stderr: '', command: 'flatpak', source: 'flatpak' };
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.erc.errorCount, 0);
    assert.equal(result.formatUpgrade.ok, false);
    assert.equal(result.formatUpgrade.launchFailed, true);
    assert.equal(result.reason.code, 'ERC_FORMAT_UPGRADE_FAILED');
    assert.match(result.reason.stderr, /invalid merge-dirs/);
    assert.equal(await readFile(path.join(root, 'demo.kicad_sch'), 'utf8'), SCHEMATIC);
    assert.equal(ercApprovalDecision(normalizeRecordedErc(result)).allow, true);
  });
});

test('a launcher failure that still changed the schematic stays a non-pass', async () => {
  await withProject(async (root) => {
    const result = await validateProject({
      projectDir: root,
      runKicadCliImpl: async (args) => {
        if (args[1] === 'upgrade') {
          await writeFile(args.at(-1), '(kicad_sch (version 20250114))\n', 'utf8');
          return launcherFailure();
        }
        await writeReport(args, []);
        return { exitCode: 0, stdout: '', stderr: '', command: 'flatpak', source: 'flatpak' };
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason.code, 'ERC_FORMAT_UPGRADE_FAILED');
    const decision = ercApprovalDecision(normalizeRecordedErc({ ...result, status: 'failed' }));
    assert.equal(decision.allow, false);
    assert.match(decision.message, /ERC_FORMAT_UPGRADE_FAILED/);
  });
});

test('a KiCad upgrade failure that is not a launcher failure stays a non-pass with a reason', async () => {
  await withProject(async (root) => {
    const result = await validateProject({
      projectDir: root,
      runKicadCliImpl: async (args) => {
        if (args[1] === 'upgrade') {
          return { exitCode: 1, stdout: '', stderr: 'Failed to load schematic\n', command: 'kicad-cli', source: 'path' };
        }
        await writeReport(args, []);
        return { exitCode: 0, stdout: '', stderr: '', command: 'kicad-cli', source: 'path' };
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.formatUpgrade.launchFailed, false);
    assert.equal(result.reason.code, 'ERC_FORMAT_UPGRADE_FAILED');
    const decision = ercApprovalDecision(normalizeRecordedErc({ ...result, status: 'failed' }));
    assert.equal(decision.allow, false);
    assert.equal(decision.reasonCode, 'ERC_FORMAT_UPGRADE_FAILED');
    assert.match(decision.message, /^ERC_BLOCKED: ERC did not pass for this patch\. Reason: ERC_FORMAT_UPGRADE_FAILED/);
    assert.match(decision.message, /Failed to load schematic/);
  });
});

test('a launcher failure in the ERC run is KICAD_CLI_LAUNCH_FAILED and never reads a stale report', async () => {
  await withProject(async (root) => {
    await writeFile(path.join(root, 'chatpcb-erc.json'), JSON.stringify({ sheets: [] }), 'utf8');
    const result = await validateProject({
      projectDir: root,
      runKicadCliImpl: async (args) => {
        if (args[1] === 'upgrade') {
          return { exitCode: 0, stdout: '', stderr: '', command: 'flatpak', source: 'flatpak' };
        }
        return launcherFailure();
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason.code, 'KICAD_CLI_LAUNCH_FAILED');
    assert.match(result.reason.stderr, /invalid merge-dirs/);
    const decision = ercApprovalDecision(normalizeRecordedErc({ ...result, status: 'failed' }));
    assert.equal(decision.allow, false);
    assert.match(decision.message, /KICAD_CLI_LAUNCH_FAILED/);
  });
});

test('ERC errors still block even when the upgrade launcher failed', async () => {
  await withProject(async (root) => {
    const result = await validateProject({
      projectDir: root,
      runKicadCliImpl: async (args) => {
        if (args[1] === 'upgrade') return launcherFailure();
        await writeReport(args, [{ type: 'pin_not_connected', severity: 'error' }]);
        return { exitCode: 5, stdout: '', stderr: '', command: 'flatpak', source: 'flatpak' };
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.erc.errorCount, 1);
    assert.equal(ercApprovalDecision(normalizeRecordedErc(result)).allow, false);
  });
});

test('isKicadLauncherFailure only matches flatpak launcher errors with no KiCad output', () => {
  assert.equal(isKicadLauncherFailure(launcherFailure()), true);
  assert.equal(isKicadLauncherFailure({ ...launcherFailure(), stderr: 'bwrap: Can\'t mount proc\n' }), true);
  assert.equal(isKicadLauncherFailure({ ...launcherFailure(), exitCode: 0 }), false);
  assert.equal(isKicadLauncherFailure({ ...launcherFailure(), stdout: 'Loading schematic\n' }), false);
  assert.equal(isKicadLauncherFailure({ ...launcherFailure(), source: 'path' }), false);
  assert.equal(isKicadLauncherFailure({ ...launcherFailure(), stderr: 'Failed to load schematic\n' }), false);
  assert.equal(isKicadLauncherFailure(null), false);
});

test('retryOnceOnLauncherFailure retries a launcher failure exactly once', async () => {
  let calls = 0;
  const recovered = await retryOnceOnLauncherFailure(async () => {
    calls += 1;
    return calls === 1 ? launcherFailure() : { exitCode: 0, stdout: 'ok', stderr: '', source: 'flatpak' };
  });
  assert.equal(calls, 2);
  assert.equal(recovered.exitCode, 0);
  assert.equal(recovered.launchRetried, true);
  assert.equal(recovered.launchFailed, undefined);

  calls = 0;
  const failed = await retryOnceOnLauncherFailure(async () => {
    calls += 1;
    return launcherFailure();
  });
  assert.equal(calls, 2);
  assert.equal(failed.launchFailed, true);
  assert.equal(failed.reason.code, 'KICAD_CLI_LAUNCH_FAILED');

  calls = 0;
  const kicadError = await retryOnceOnLauncherFailure(async () => {
    calls += 1;
    return { exitCode: 1, stdout: '', stderr: 'Failed to load schematic\n', source: 'flatpak' };
  });
  assert.equal(calls, 1);
  assert.equal(kicadError.launchRetried, undefined);
});

test('ERC_BLOCKED keeps the original message when no reason is recorded', () => {
  const decision = ercApprovalDecision(normalizeRecordedErc({ ok: false, status: 'failed', erc: { errorCount: 1 } }));
  assert.equal(decision.message, 'ERC_BLOCKED: ERC did not pass for this patch.');
  assert.equal(decision.reasonCode, undefined);
});
