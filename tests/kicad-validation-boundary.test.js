import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { inspectProject } from '../src/workflow/inspect-project.js';
import { validateProject } from '../src/workflow/validate-project.js';
import { validateBoard } from '../src/workflow/validate-board.js';
import { copyInspectionTree } from '../src/workflow/inspection-copy.js';
import { applySchematicPatch } from '../src/workflow/schematic-patch.js';
import { dispatchToolCall } from '../src/runtime/agent-daemon.js';
import { createEnvelope } from '../src/runtime/envelope.js';

const clean = async () => ({ ok: true });
test('ERC timeout is a validation failure, not a successful unavailable-tool skip', async () => {
  const { root, projectDir } = await fixture();
  try {
    const result = await validateProject({ projectDir, runKicadCliImpl: async () => {
      throw Object.assign(new Error('timed out'), { code: 'KICAD_CLI_TIMEOUT' });
    } });
    assert.equal(result.ok, false);
    assert.equal(result.skipped, false);
    assert.equal(result.reason.code, 'KICAD_CLI_TIMEOUT');
  } finally { await rm(root, { recursive: true, force: true }); }
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-validation-boundary-'));
  const projectDir = path.join(root, 'project');
  await mkdir(projectDir);
  await writeFile(path.join(projectDir, 'demo.kicad_sch'), '(kicad_sch)');
  await writeFile(path.join(projectDir, 'demo.kicad_pcb'), '(kicad_pcb)');
  return { root, projectDir };
}
test('daemon uses only server KiCad configuration for inspect, ERC and DRC', async () => {
  const { root, projectDir } = await fixture();
  try {
    for (const name of ['project.inspect', 'validate.erc', 'validate.drc']) {
      for (const configured of [undefined, '/trusted/kicad-cli']) {
        const received = [];
        const capture = async (args) => { received.push(args); return { ok: true }; };
        const result = await dispatchToolCall({ name, args: { projectDir, kicadCliPath: process.execPath } }, {
          kicadCliPath: configured, inspectProjectImpl: capture, validateProjectImpl: capture, validateBoardImpl: capture
        });
        assert.equal(result.ok, true);
        assert.equal(received.length, 1);
        assert.equal(received[0].kicadCliPath, configured);
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('provider validation aliases cannot override trusted KiCad configuration', async () => {
  const { root, projectDir } = await fixture();
  try {
    const received = [];
    const trusted = '/trusted/kicad-cli';
    await dispatchToolCall({ name: 'provider.invoke', id: 'boundary', args: {
      projectDir, prompt: 'Inspect', kicadCliPath: process.execPath
    } }, {
      kicadCliPath: trusted,
      checkProviderAvailabilityImpl: async () => ({ available: true }),
      runProviderProcessImpl: async () => ({ exitCode: 0, stderr: '', events:
        ['project.inspect', 'validate.erc', 'validate.drc'].map((name, i) =>
          createEnvelope('tool.call', { id: String(i), name, args: { kicadCliPath: process.execPath } }))
      }),
      inspectProjectImpl: async (args) => { received.push(args); return { ok: true }; }
    });
    assert.equal(received.length, 3);
    assert.deepEqual(received.map((args) => args.kicadCliPath), [trusted, trusted, trusted]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const kind of ['root', 'ancestor', 'child-directory', 'report-file']) {
  test('inspection rejects ' + kind + ' links before toolchain or validation', async (t) => {
    const { root, projectDir } = await fixture();
    const outside = path.join(root, 'outside');
    await mkdir(outside);
    const marker = path.join(outside, 'protected.txt');
    await writeFile(marker, 'protected');
    let inspected = projectDir;
    let linkPath;
    try {
      if (kind === 'root' || kind === 'ancestor') {
        linkPath = path.join(root, 'alias');
        await symlink(kind === 'root' ? projectDir : root, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
        inspected = kind === 'root' ? linkPath : path.join(linkPath, 'project');
      } else {
        linkPath = path.join(projectDir, kind === 'report-file' ? 'chatpcb-erc.json' : 'library');
        await symlink(kind === 'report-file' ? marker : outside, linkPath,
          kind === 'report-file' ? 'file' : process.platform === 'win32' ? 'junction' : 'dir');
      }
      let calls = 0;
      const mustNotRun = async () => { calls++; return { ok: true }; };
      await assert.rejects(inspectProject({ projectDir: inspected, getKicadVersionImpl: mustNotRun,
        validateProjectImpl: mustNotRun, validateBoardImpl: mustNotRun }), { code: 'UNSAFE_INSPECTION_LINK' });
      assert.equal(calls, 0);
      assert.equal(await readFile(marker, 'utf8'), 'protected');
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'ENOTSUP') t.skip('Symlink creation unavailable');
      else throw error;
    } finally {
      if (linkPath) await rm(linkPath, { force: true, recursive: true });
      await rm(root, { recursive: true, force: true });
    }
  });
}

test('version query operates only on a disposable copy cleaned after inspection', async () => {
  const { root, projectDir } = await fixture();
  let versionDir;
  try {
    const result = await inspectProject({ projectDir, validateProjectImpl: clean, validateBoardImpl: clean,
      getKicadVersionImpl: async ({ projectDir: cwd }) => {
        versionDir = cwd;
        await writeFile(path.join(cwd, 'version-marker'), 'written');
        return { version: '10.0.3' };
      }
    });
    assert.notEqual(versionDir, projectDir);
    assert.equal(result.inspection.toolchain.kicadCli.version, '10.0.3');
    await assert.rejects(access(path.join(projectDir, 'version-marker')));
    await assert.rejects(access(versionDir));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('inspection propagates original-project exclusion to version, ERC and DRC discovery', async () => {
  const { root, projectDir } = await fixture();
  const captured = {};
  try {
    await inspectProject({
      projectDir,
      getKicadVersionImpl: async (args) => {
        captured.version = args;
        return { version: '10.0.3' };
      },
      validateProjectImpl: async (args) => {
        captured.erc = args;
        return { ok: true };
      },
      validateBoardImpl: async (args) => {
        captured.drc = args;
        return { ok: true };
      }
    });
    for (const name of ['version', 'erc', 'drc']) {
      assert.equal(captured[name].excludeProjectDir, projectDir);
      assert.notEqual(captured[name].projectDir, projectDir);
      assert.match(captured[name].projectDir, /chatpcb-inspection-/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('validateProject and validateBoard forward original-project exclusion to KiCad discovery', async () => {
  const { root, projectDir } = await fixture();
  const originalProject = path.join(root, 'original-untrusted');
  try {
    const ercOptions = [];
    const drcOptions = [];
    await validateProject({
      projectDir,
      excludeProjectDir: originalProject,
      runKicadCliImpl: async (args, options) => {
        ercOptions.push(options);
        if (args[1] === 'erc') {
          await writeFile(args[args.indexOf('--output') + 1], JSON.stringify({ sheets: [] }), 'utf8');
        }
        return { exitCode: 0, stdout: '', stderr: '', command: '/trusted/kicad-cli', source: 'path' };
      }
    });
    await validateBoard({
      projectDir,
      excludeProjectDir: originalProject,
      runKicadCliImpl: async (args, options) => {
        drcOptions.push(options);
        await writeFile(args[args.indexOf('--output') + 1], JSON.stringify({ violations: [], unconnected_items: [] }), 'utf8');
        return { exitCode: 0, stdout: '', stderr: '', command: '/trusted/kicad-cli', source: 'path' };
      }
    });
    assert.equal(ercOptions.length > 0, true);
    assert.equal(drcOptions.length, 1);
    assert.equal(ercOptions.every((options) => options.excludeProjectDir === originalProject), true);
    assert.equal(drcOptions[0].excludeProjectDir, originalProject);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('inspection copy accepts OS temp aliases after canonicalizing the private root', async (t) => {
  const { root, projectDir } = await fixture();
  const realTemp = await mkdtemp(path.join(tmpdir(), 'chatpcb-real-temp-'));
  const aliasTemp = path.join(path.dirname(realTemp), `${path.basename(realTemp)}-alias`);
  try {
    await symlink(realTemp, aliasTemp, process.platform === 'win32' ? 'junction' : 'dir');
    const dest = path.join(aliasTemp, 'project');
    await copyInspectionTree(projectDir, dest);
    assert.equal(await readFile(path.join(dest, 'demo.kicad_sch'), 'utf8'), '(kicad_sch)');
    assert.equal(await readFile(path.join(projectDir, 'demo.kicad_sch'), 'utf8'), '(kicad_sch)');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'ENOTSUP') t.skip('Symlink creation unavailable');
    else throw error;
  } finally {
    await rm(aliasTemp, { force: true, recursive: true });
    await rm(realTemp, { force: true, recursive: true });
    await rm(root, { recursive: true, force: true });
  }
});

test('user-supplied project and ancestor links remain rejected after temp-root canonicalization', async (t) => {
  const { root, projectDir } = await fixture();
  const alias = path.join(root, 'user-alias');
  try {
    await symlink(projectDir, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(inspectProject({
      projectDir: alias,
      getKicadVersionImpl: async () => { throw new Error('must not run'); },
      validateProjectImpl: clean,
      validateBoardImpl: clean
    }), { code: 'UNSAFE_INSPECTION_LINK' });
    await assert.rejects(validateProject({ projectDir: alias }), { code: 'UNSAFE_INSPECTION_LINK' });
    await assert.rejects(validateBoard({ projectDir: alias }), { code: 'UNSAFE_INSPECTION_LINK' });
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'ENOTSUP') t.skip('Symlink creation unavailable');
    else throw error;
  } finally {
    await rm(alias, { force: true, recursive: true });
    await rm(root, { recursive: true, force: true });
  }
});

test('project.request and schematic.patch use trusted KiCad configuration', async () => {
  const { root, projectDir } = await fixture();
  const trusted = '/trusted/kicad-cli';
  const received = [];
  const capture = async (args) => {
    received.push(args);
    return { ok: true, skipped: false, erc: { errorCount: 0, warningCount: 0, byType: {} } };
  };
  const providerOptions = {
    kicadCliPath: trusted,
    checkProviderAvailabilityImpl: async () => ({ available: true, provider: 'codex', command: 'codex', status: 'available' }),
    runProviderProcessImpl: async () => ({
      exitCode: 0,
      stderr: '',
      events: [createEnvelope('tool.call', {
        id: 'gen',
        name: 'schematic.generate',
        args: { prompt: 'RP2040 board with USB-C power and I2C connector.', kicadCliPath: process.execPath }
      })]
    }),
    validateProjectImpl: capture
  };
  try {
    const request = await dispatchToolCall({
      id: 'boundary-request',
      name: 'project.request',
      args: {
        projectDir,
        prompt: 'RP2040 board with USB-C power and I2C connector.',
        kicadCliPath: process.execPath
      }
    }, providerOptions);
    assert.equal(request.ok, true);
    assert.equal(received.length > 0, true);
    assert.equal(received.every((args) => args.kicadCliPath === trusted), true);

    received.length = 0;
    const patch = await dispatchToolCall({
      name: 'schematic.patch',
      args: {
        projectDir,
        prompt: 'RP2040 board with USB-C power, I2C connector, reset button, and LED.',
        kicadCliPath: process.execPath
      }
    }, { kicadCliPath: trusted, validateProjectImpl: capture });
    assert.equal(patch.ok, true);
    assert.equal(received.length > 0, true);
    assert.equal(received.every((args) => args.kicadCliPath === trusted), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('daemon exposes the typed inspection link rejection', async (t) => {
  const { root, projectDir } = await fixture();
  const alias = path.join(root, 'alias');
  try {
    await symlink(projectDir, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const result = await dispatchToolCall({ name: 'project.inspect', args: { projectDir: alias } });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'UNSAFE_INSPECTION_LINK');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'ENOTSUP') t.skip('Symlink creation unavailable');
    else throw error;
  } finally {
    await rm(alias, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});
test('inspection waits for another validator before deleting the failed validation copy', async () => {
  const { root, projectDir } = await fixture();
  let release;
  let started;
  let copyDir;
  const barrier = new Promise((r) => { release = r; });
  const begun = new Promise((r) => { started = r; });
  try {
    const pending = inspectProject({ projectDir, getKicadVersionImpl: async () => null,
      validateProjectImpl: async () => { await begun; throw new Error('ERC failed'); },
      validateBoardImpl: async ({ projectDir: cwd }) => {
        copyDir = cwd; started(); await barrier;
        await access(cwd);
        await writeFile(path.join(cwd, 'drc-marker'), 'done');
        return { ok: true };
      }
    });
    const caught = pending.then(() => 'unexpected', (error) => error.message);
    await begun;
    await new Promise((r) => setTimeout(r, 30));
    await access(copyDir);
    release();
    assert.equal(await caught, 'ERC failed');
    await assert.rejects(access(copyDir));
  } finally { release?.(); await rm(root, { recursive: true, force: true }); }
});

test('private inspection copy is independent of original artifact bytes', async () => {
  const { root, projectDir } = await fixture();
  const destRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-validation-copy-'));
  const dest = path.join(destRoot, 'project');
  try {
    const beforeSch = await readFile(path.join(projectDir, 'demo.kicad_sch'), 'utf8');
    const beforePcb = await readFile(path.join(projectDir, 'demo.kicad_pcb'), 'utf8');
    await copyInspectionTree(projectDir, dest);
    await writeFile(path.join(dest, 'demo.kicad_sch'), '(mutated copy)');
    await writeFile(path.join(dest, 'chatpcb-erc.json'), '{"generated":true}');
    await writeFile(path.join(dest, 'chatpcb-drc.json'), '{"generated":true}');
    assert.equal(await readFile(path.join(projectDir, 'demo.kicad_sch'), 'utf8'), beforeSch);
    assert.equal(await readFile(path.join(projectDir, 'demo.kicad_pcb'), 'utf8'), beforePcb);
    await assert.rejects(access(path.join(projectDir, 'chatpcb-erc.json')));
    await assert.rejects(access(path.join(projectDir, 'chatpcb-drc.json')));
  } finally {
    await rm(destRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

for (const tool of [
  { name: 'validate.erc', run: validateProject, report: 'chatpcb-erc.json' },
  { name: 'validate.drc', run: validateBoard, report: 'chatpcb-drc.json' }
]) {
  test(tool.name + ' rejects report links before KiCad and keeps the outside target unchanged', async (t) => {
    const { root, projectDir } = await fixture();
    const outside = path.join(root, 'outside');
    await mkdir(outside);
    const marker = path.join(outside, 'protected.txt');
    await writeFile(marker, 'protected');
    const linkPath = path.join(projectDir, tool.report);
    try {
      await symlink(marker, linkPath, 'file');
      let calls = 0;
      await assert.rejects(tool.run({
        projectDir,
        runKicadCliImpl: async () => { calls += 1; return { exitCode: 0, stdout: '', stderr: '' }; }
      }), { code: 'UNSAFE_INSPECTION_LINK' });
      assert.equal(calls, 0);
      const result = await dispatchToolCall({ name: tool.name, args: { projectDir } });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'UNSAFE_INSPECTION_LINK');
      assert.equal(await readFile(marker, 'utf8'), 'protected');
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'ENOTSUP') t.skip('Symlink creation unavailable');
      else throw error;
    } finally {
      await rm(linkPath, { force: true });
      await rm(root, { recursive: true, force: true });
    }
  });
}

test('patch candidate ERC excludes the original project from KiCad discovery', async () => {
  const { root, projectDir } = await fixture();
  const captured = [];
  try {
    const preview = await applySchematicPatch({
      projectDir,
      prompt: 'RP2040 board with USB-C power and I2C connector.',
      approved: false,
      validateProjectImpl: async (args) => {
        captured.push(args);
        return { ok: true, skipped: false, erc: { errorCount: 0, warningCount: 0, byType: {} } };
      }
    });
    assert.equal(preview.requiresApproval, true);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].excludeProjectDir, projectDir);
    assert.notEqual(captured[0].projectDir, projectDir);
    assert.match(captured[0].projectDir, /chatpcb-patch-plan-/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('patch preview works when the internal temp root is an OS alias', async (t) => {
  const { root, projectDir } = await fixture();
  const realTemp = await mkdtemp(path.join(tmpdir(), 'chatpcb-patch-real-temp-'));
  const aliasTemp = path.join(path.dirname(realTemp), `${path.basename(realTemp)}-alias`);
  const scriptPath = path.join(realTemp, 'run-patch-preview.mjs');
  try {
    await symlink(realTemp, aliasTemp, process.platform === 'win32' ? 'junction' : 'dir');
    const patchModule = pathToFileURL(path.resolve('src/workflow/schematic-patch.js')).href;
    const copyModule = pathToFileURL(path.resolve('src/workflow/inspection-copy.js')).href;
    await writeFile(scriptPath, `
      import { applySchematicPatch } from ${JSON.stringify(patchModule)};
      import { assertInspectionTree } from ${JSON.stringify(copyModule)};
      const projectDir = ${JSON.stringify(projectDir)};
      const preview = await applySchematicPatch({
        projectDir,
        prompt: 'RP2040 board with USB-C power and I2C connector.',
        approved: false,
        validateProjectImpl: async (args) => {
          await assertInspectionTree(args.projectDir);
          return { ok: true, skipped: false, erc: { errorCount: 0, warningCount: 0, byType: {} } };
        }
      });
      if (preview.requiresApproval !== true) throw new Error('expected patch preview');
      console.log(JSON.stringify({ ok: true, candidateDir: preview.validation ? 'previewed' : 'previewed' }));
    `, 'utf8');
    const child = spawn(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      env: { ...process.env, TEMP: aliasTemp, TMP: aliasTemp, TMPDIR: aliasTemp },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout = [];
    const stderr = [];
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    const status = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    assert.equal(status, 0, stderr.join('') || stdout.join(''));
    assert.equal(JSON.parse(stdout.join('')).ok, true);
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'ENOTSUP') t.skip('Symlink creation unavailable');
    else throw error;
  } finally {
    await rm(aliasTemp, { force: true, recursive: true });
    await rm(realTemp, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});
