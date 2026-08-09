import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createNamedProject } from '../src/workflow/project-workspace.js';

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
