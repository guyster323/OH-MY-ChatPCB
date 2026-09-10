import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createProjectMutexRegistry } from '../src/runtime/project-mutex-registry.js';

async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('timed out waiting for mutex state');
}

test('project mutex registry rejects same-project contention and releases after completion', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-mutex-busy-'));
  try {
    const registry = createProjectMutexRegistry();
    let release;
    const first = registry.runExclusive({ projectDir: root }, async () => {
      await new Promise((resolve) => { release = resolve; });
      return 'first';
    });
    await waitUntil(() => registry.isLocked({ projectDir: root }));
    await assert.rejects(
      registry.runExclusive({ projectDir: root }, async () => 'second'),
      (error) => {
        assert.equal(error.code, 'PROJECT_BUSY');
        assert.match(error.message, /Another ChatPCB transaction is active/);
        return true;
      }
    );
    release();
    assert.equal(await first, 'first');
    assert.equal(await registry.isLocked({ projectDir: root }), false);
    assert.equal(await registry.runExclusive({ projectDir: root }, async () => 'third'), 'third');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('project mutex registry allows different projects to run concurrently', async () => {
  const firstRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-mutex-a-'));
  const secondRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-mutex-한글 경로-'));
  try {
    const registry = createProjectMutexRegistry();
    let releaseFirst;
    let releaseSecond;
    const first = registry.runExclusive({ projectDir: firstRoot }, async () => {
      await new Promise((resolve) => { releaseFirst = resolve; });
      return 'one';
    });
    const second = registry.runExclusive({ projectDir: secondRoot }, async () => {
      await new Promise((resolve) => { releaseSecond = resolve; });
      return 'two';
    });
    await waitUntil(async () => (
      await registry.isLocked({ projectDir: firstRoot })
      && await registry.isLocked({ projectDir: secondRoot })
    ));
    releaseFirst();
    releaseSecond();
    assert.deepEqual(await Promise.all([first, second]), ['one', 'two']);
  } finally {
    await rm(firstRoot, { recursive: true, force: true });
    await rm(secondRoot, { recursive: true, force: true });
  }
});

test('project mutex registry releases the lock when work throws', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-mutex-throw-'));
  try {
    const registry = createProjectMutexRegistry();
    await assert.rejects(
      registry.runExclusive({ projectDir: root }, async () => {
        throw new Error('boom');
      }),
      { message: 'boom' }
    );
    assert.equal(await registry.isLocked({ projectDir: root }), false);
    assert.equal(await registry.runExclusive({ projectDir: root }, async () => 'recovered'), 'recovered');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('project mutex registry locks aliases of the same canonical project', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-mutex-alias-'));
  await mkdir(path.join(root, 'nested'));
  try {
    const registry = createProjectMutexRegistry();
    const alias = path.join(root, 'nested', '..');
    let release;
    const first = registry.runExclusive({ projectDir: root }, async () => {
      await new Promise((resolve) => { release = resolve; });
      return 'canonical';
    });
    await waitUntil(() => registry.isLocked({ projectDir: alias }));
    await assert.rejects(
      registry.runExclusive({ projectDir: alias }, async () => 'alias'),
      { code: 'PROJECT_BUSY' }
    );
    release();
    assert.equal(await first, 'canonical');
    assert.equal(await registry.runExclusive({ projectDir: alias }, async () => 'after'), 'after');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
