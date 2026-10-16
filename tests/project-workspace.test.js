import assert from 'node:assert/strict';
import { realpathSync as nodeRealpathSync } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { generateMcuPeripheralProject } from '../src/workflow/generate-mcu-project.js';
import { assertSafeProjectDir, createNamedProject } from '../src/workflow/project-workspace.js';

const skipPosixSymlink = process.platform === 'win32'
  ? 'symbolic links require privileges on Windows'
  : false;
const skipUnreadableParent = process.platform === 'win32'
  ? 'mode 000 is not a portable denial on Windows'
  : (typeof process.getuid === 'function' && process.getuid() === 0)
    ? 'mode 000 does not deny the root user'
    : false;
const PROJECT_PROMPT = 'RP2040 board with USB-C power and I2C connector.';

function assertMessageHasNoAbsolutePath(message, ...absent) {
  assert.equal(typeof message, 'string');
  for (const value of absent) {
    assert.equal(message.includes(value), false, message);
  }
  for (const token of message.split(/\s+/u)) {
    const trimmed = token.replace(/^['"`(]+|['"`).,:;]+$/gu, '');
    if (!trimmed) continue;
    assert.equal(path.isAbsolute(trimmed), false, message);
    assert.equal(path.win32.isAbsolute(trimmed), false, message);
  }
}

function assertUnsafeCanonical(error, causeCode, ...absent) {
  assert.equal(error.code, 'UNSAFE_PROJECT_DIR');
  assert.equal(error.cause?.code, causeCode);
  assert.ok(error.cause instanceof Error);
  assertMessageHasNoAbsolutePath(error.message, ...absent);
}

test('createNamedProject creates a Unicode slug inside the workspace root', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-workspace-'));

  try {
    const created = await createNamedProject({ workspaceRoot, projectName: '가스 센서 보드 01' });

    assert.equal(created.displayName, '가스 센서 보드 01');
    assert.equal(created.slug, '가스-센서-보드-01');
    assert.equal(created.projectDir, path.join(workspaceRoot, '가스-센서-보드-01'));
    assert.equal(path.relative(path.resolve(workspaceRoot), path.resolve(created.projectDir)).startsWith('..'), false);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test('createNamedProject rejects traversal and Windows reserved names', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-workspace-'));

  try {
    await assert.rejects(
      () => createNamedProject({ workspaceRoot, projectName: '../outside' }),
      { code: 'INVALID_PROJECT_NAME' }
    );
    await assert.rejects(
      () => createNamedProject({ workspaceRoot, projectName: 'CON' }),
      { code: 'INVALID_PROJECT_NAME' }
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test('createNamedProject rejects duplicate directories', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-workspace-'));

  try {
    await createNamedProject({ workspaceRoot, projectName: 'Sensor Board' });

    await assert.rejects(
      () => createNamedProject({ workspaceRoot, projectName: 'Sensor Board' }),
      { code: 'PROJECT_EXISTS' }
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test('missing project directory inside the workspace is still allowed', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-missing-project-'));
  const projectDir = path.join(workspaceRoot, 'new', 'board');

  try {
    assert.equal(assertSafeProjectDir(projectDir, { allowedWorkspaceRoot: workspaceRoot }), path.resolve(projectDir));
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test('dangling symlink parent is rejected', { skip: skipPosixSymlink }, async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'chatpcb-dangling-parent-'));
  const workspaceRoot = path.join(base, 'ws');
  const target = path.join(base, 'outside', 'newdir');
  const link = path.join(workspaceRoot, 'dang');
  const projectDir = path.join(link, 'p');
  await mkdir(workspaceRoot);
  await symlink(target, link);

  try {
    assert.equal(await lstat(link).then((info) => info.isSymbolicLink()), true);
    await assert.rejects(() => lstat(target), { code: 'ENOENT' });
    assert.throws(
      () => assertSafeProjectDir(projectDir, { allowedWorkspaceRoot: workspaceRoot }),
      (error) => {
        assert.equal(error.code, 'UNSAFE_PROJECT_DIR');
        assertMessageHasNoAbsolutePath(error.message, base, projectDir, link, target);
        return true;
      }
    );
    assert.throws(
      () => assertSafeProjectDir(path.join(link, 'a', 'b'), { allowedWorkspaceRoot: workspaceRoot }),
      { code: 'UNSAFE_PROJECT_DIR' }
    );
    assert.throws(() => assertSafeProjectDir(projectDir), { code: 'UNSAFE_PROJECT_DIR' });
  } finally {
    await rm(base, { force: true, recursive: true });
  }
});

test('looping symlink becomes UNSAFE_PROJECT_DIR without an absolute path', { skip: skipPosixSymlink }, async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'chatpcb-loop-link-'));
  const workspaceRoot = path.join(base, 'ws');
  const loop = path.join(workspaceRoot, 'loop');
  const projectDir = path.join(loop, 'project');
  await mkdir(workspaceRoot);
  await symlink('loop', loop);

  try {
    assert.throws(
      () => assertSafeProjectDir(projectDir, { allowedWorkspaceRoot: workspaceRoot }),
      (error) => {
        assertUnsafeCanonical(error, 'ELOOP', base, projectDir, loop);
        return true;
      }
    );
  } finally {
    await rm(base, { force: true, recursive: true });
  }
});

test('unreadable project parent becomes UNSAFE_PROJECT_DIR', { skip: skipUnreadableParent }, async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'chatpcb-unreadable-parent-'));
  const workspaceRoot = path.join(base, 'ws');
  const locked = path.join(workspaceRoot, 'locked');
  const projectDir = path.join(locked, 'project');
  await mkdir(workspaceRoot);
  await mkdir(locked);
  await chmod(locked, 0o000);

  try {
    assert.throws(
      () => assertSafeProjectDir(projectDir, { allowedWorkspaceRoot: workspaceRoot }),
      (error) => {
        assertUnsafeCanonical(error, 'EACCES', base, projectDir, locked);
        return true;
      }
    );
  } finally {
    await chmod(locked, 0o755);
    await rm(base, { force: true, recursive: true });
  }
});

test('non-directory project parent becomes UNSAFE_PROJECT_DIR', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'chatpcb-enotdir-parent-'));
  const workspaceRoot = path.join(base, 'ws');
  const file = path.join(workspaceRoot, 'not-a-directory');
  const projectDir = path.join(file, 'project');
  await mkdir(workspaceRoot);
  await writeFile(file, 'x');

  try {
    assert.throws(
      () => assertSafeProjectDir(projectDir, { allowedWorkspaceRoot: workspaceRoot }),
      (error) => {
        assertUnsafeCanonical(error, 'ENOTDIR', base, projectDir, file);
        return true;
      }
    );
  } finally {
    await rm(base, { force: true, recursive: true });
  }
});

test('non-directory project parent becomes UNSAFE_PROJECT_DIR when realpath reports ENOENT', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'chatpcb-enotdir-enoent-'));
  const workspaceRoot = path.join(base, 'ws');
  const file = path.join(workspaceRoot, 'not-a-directory');
  const projectDir = path.join(file, 'project');
  await mkdir(workspaceRoot);
  await writeFile(file, 'x');
  let reportedEnoent = false;
  const fsImpl = {
    realpathSync(candidate) {
      if (path.resolve(candidate) === path.resolve(projectDir)) {
        reportedEnoent = true;
        const error = new Error('ENOENT: no such file or directory, realpath');
        error.code = 'ENOENT';
        throw error;
      }
      return nodeRealpathSync(candidate);
    }
  };

  try {
    assert.throws(
      () => assertSafeProjectDir(projectDir, { allowedWorkspaceRoot: workspaceRoot, fsImpl }),
      (error) => {
        assertUnsafeCanonical(error, 'ENOTDIR', base, projectDir, file);
        return true;
      }
    );
    assert.equal(reportedEnoent, true);
  } finally {
    await rm(base, { force: true, recursive: true });
  }
});

test('resolved symlink ancestor of a missing project stays inside the workspace', { skip: skipPosixSymlink }, async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'chatpcb-resolved-ancestor-'));
  const real = path.join(base, 'real');
  const alias = path.join(base, 'alias');
  const projectDir = path.join(alias, 'board');
  await mkdir(real);
  await symlink(real, alias);

  try {
    assert.equal(assertSafeProjectDir(projectDir, { allowedWorkspaceRoot: real }), path.resolve(projectDir));
    assert.equal(assertSafeProjectDir(projectDir, { allowedWorkspaceRoot: alias }), path.resolve(projectDir));
  } finally {
    await rm(base, { force: true, recursive: true });
  }
});

test('generate rejects a dangling project path before writing', { skip: skipPosixSymlink }, async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'chatpcb-dangling-generate-'));
  const workspaceRoot = path.join(base, 'ws');
  const target = path.join(base, 'outside', 'newdir');
  const link = path.join(workspaceRoot, 'dang');
  const projectDir = path.join(link, 'p');
  await mkdir(workspaceRoot);
  await symlink(target, link);

  try {
    await assert.rejects(
      () => generateMcuPeripheralProject({
        projectDir,
        prompt: PROJECT_PROMPT,
        allowedWorkspaceRoot: workspaceRoot
      }),
      (error) => {
        assert.equal(error.code, 'UNSAFE_PROJECT_DIR');
        assertMessageHasNoAbsolutePath(error.message, base, projectDir, link, target);
        return true;
      }
    );
    await assert.rejects(() => lstat(target), { code: 'ENOENT' });
    await assert.rejects(() => lstat(projectDir), { code: 'ENOENT' });
    await assert.rejects(() => lstat(path.join(base, 'outside')), { code: 'ENOENT' });
  } finally {
    await rm(base, { force: true, recursive: true });
  }
});

test('generate does not write outside when a dangling link target appears', { skip: skipPosixSymlink }, async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'chatpcb-dangling-later-'));
  const workspaceRoot = path.join(base, 'ws');
  const target = path.join(base, 'outside', 'newdir');
  const link = path.join(workspaceRoot, 'dang');
  const projectDir = path.join(link, 'p');
  await mkdir(workspaceRoot);
  await symlink(target, link);

  try {
    assert.throws(
      () => assertSafeProjectDir(projectDir, { allowedWorkspaceRoot: workspaceRoot }),
      { code: 'UNSAFE_PROJECT_DIR' }
    );
    await mkdir(target, { recursive: true });
    await assert.rejects(
      () => generateMcuPeripheralProject({
        projectDir,
        prompt: PROJECT_PROMPT,
        allowedWorkspaceRoot: workspaceRoot
      }),
      { code: 'UNSAFE_PROJECT_DIR' }
    );
    await assert.rejects(() => lstat(path.join(target, 'p')), { code: 'ENOENT' });
    for (const name of [
      'chatpcb_mcu_peripheral.kicad_pro',
      'chatpcb_mcu_peripheral.kicad_sch',
      'chatpcb_mcu_peripheral.chatpcb.json'
    ]) {
      await assert.rejects(() => lstat(path.join(target, 'p', name)), { code: 'ENOENT' });
    }
  } finally {
    await rm(base, { force: true, recursive: true });
  }
});

test('generate rejects an untrusted symlink ancestor before mkdir', { skip: skipPosixSymlink }, async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'chatpcb-ancestor-mkdir-'));
  const outside = path.join(base, 'outside');
  const link = path.join(base, 'link');
  const projectDir = path.join(link, 'project');
  await mkdir(outside);
  await symlink(outside, link);

  try {
    await assert.rejects(
      () => generateMcuPeripheralProject({
        projectDir,
        prompt: PROJECT_PROMPT
      }),
      { code: 'UNSAFE_INSPECTION_LINK' }
    );
    await assert.rejects(() => lstat(path.join(outside, 'project')), { code: 'ENOENT' });

    // Canonical confinement would allow this alias of the workspace root.
    // The ancestor check still rejects it, and still does so before mkdir.
    await assert.rejects(
      () => generateMcuPeripheralProject({
        projectDir,
        prompt: PROJECT_PROMPT,
        allowedWorkspaceRoot: outside
      }),
      { code: 'UNSAFE_INSPECTION_LINK' }
    );
    await assert.rejects(() => lstat(path.join(outside, 'project')), { code: 'ENOENT' });
  } finally {
    await rm(base, { force: true, recursive: true });
  }
});

test('generate creates no directory when the project path fails the safety check', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'chatpcb-no-mkdir-'));
  const workspaceRoot = path.join(base, 'ws');
  const outside = path.join(base, 'outside');
  const projectDir = path.join(outside, 'nested', 'proj');
  await mkdir(workspaceRoot);

  try {
    await assert.rejects(
      () => generateMcuPeripheralProject({
        projectDir,
        prompt: PROJECT_PROMPT,
        allowedWorkspaceRoot: workspaceRoot
      }),
      { code: 'UNSAFE_PROJECT_DIR' }
    );
    await assert.rejects(() => lstat(outside), { code: 'ENOENT' });
    await assert.rejects(() => lstat(projectDir), { code: 'ENOENT' });
  } finally {
    await rm(base, { force: true, recursive: true });
  }
});
