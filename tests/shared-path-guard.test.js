import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isInside, assertInside } from '../src/shared/path-guard.js';

test('isInside: child is inside parent', () => {
  assert.ok(isInside('/workspace', '/workspace/project'));
  assert.ok(isInside('/workspace', '/workspace/a/b/c'));
});

test('isInside: same path is not inside', () => {
  assert.ok(!isInside('/workspace', '/workspace'));
});

test('isInside: parent is not inside child', () => {
  assert.ok(!isInside('/workspace/project', '/workspace'));
});

test('isInside: sibling is not inside', () => {
  assert.ok(!isInside('/workspace/project-a', '/workspace/project-b'));
});

test('isInside: path traversal with .. is not inside', () => {
  assert.ok(!isInside('/workspace', '/workspace/project/../..'));
  assert.ok(!isInside('/workspace', '/workspace/../etc'));
});

test('isInside: absolute path is not inside', () => {
  assert.ok(!isInside('/workspace', '/etc/passwd'));
});

test('isInside: handles trailing slashes consistently', () => {
  assert.ok(isInside('/workspace/', '/workspace/project'));
  assert.ok(isInside('/workspace', '/workspace/project/'));
  assert.ok(isInside('/workspace/', '/workspace/project/'));
});

test('isInside: Windows-style paths', () => {
  if (process.platform === 'win32') {
    assert.ok(isInside('C:\\workspace', 'C:\\workspace\\project'));
    assert.ok(!isInside('C:\\workspace\\project', 'C:\\workspace'));
    assert.ok(!isInside('C:\\workspace', 'C:\\workspace\\project\\..\\..'));
  }
});

test('isInside: normalized paths', () => {
  assert.ok(isInside('/workspace', '/workspace/a/../b'));
  const normalized = path.resolve('/workspace/a/../b');
  assert.equal(normalized, '/workspace/b');
  assert.ok(isInside('/workspace', normalized));
});

test('assertInside: accepts valid child path', () => {
  const result = assertInside('/workspace', '/workspace/project', { code: 'UNSAFE_PROJECT_DIR' });
  assert.equal(result, '/workspace/project');
});

test('assertInside: throws for path outside workspace', () => {
  assert.throws(() => {
    assertInside('/workspace', '/etc/passwd', { code: 'UNSAFE_PROJECT_DIR' });
  }, {
    code: 'UNSAFE_PROJECT_DIR'
  });
});

test('assertInside: throws for traversal attack', () => {
  assert.throws(() => {
    assertInside('/workspace', '/workspace/../etc', { code: 'UNSAFE_PROJECT_DIR' });
  }, {
    code: 'UNSAFE_PROJECT_DIR'
  });
});

test('assertInside: throws for same path', () => {
  assert.throws(() => {
    assertInside('/workspace', '/workspace', { code: 'UNSAFE_PROJECT_DIR' });
  }, {
    code: 'UNSAFE_PROJECT_DIR'
  });
});

test('assertInside: custom error message', () => {
  assert.throws(() => {
    assertInside('/workspace', '/etc', {
      message: 'Custom error message',
      code: 'UNSAFE_PROJECT_DIR'
    });
  }, {
    message: 'Custom error message',
    code: 'UNSAFE_PROJECT_DIR'
  });
});

test('assertInside: rejects a string or missing code', () => {
  assert.throws(() => assertInside('/workspace', '/etc', 'Custom error message'), TypeError);
  assert.throws(() => assertInside('/workspace', '/etc/passwd'), TypeError);
  assert.throws(() => assertInside('/workspace', '/etc/passwd', { message: 'missing code' }), TypeError);
});

test('assertInside: symlink path normalization', async () => {
  const tmpDir = path.join(tmpdir(), `chatpcb-test-${Date.now()}`);
  const workspaceDir = path.join(tmpDir, 'workspace');
  const projectDir = path.join(workspaceDir, 'project');
  const linkDir = path.join(tmpDir, 'link');

  try {
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, 'file.txt'), 'test');

    if (process.platform !== 'win32') {
      await symlink(projectDir, linkDir);
      
      const resolvedProject = path.resolve(projectDir);
      const resolvedLink = path.resolve(linkDir);
      assert.notEqual(resolvedProject, resolvedLink);
      
      assert.ok(isInside(workspaceDir, projectDir));
      
      const linkIsInside = isInside(workspaceDir, linkDir);
      assert.ok(!linkIsInside, 'Symlink outside workspace should not be considered inside');
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('assertInside: Windows reserved device names', () => {
  if (process.platform === 'win32') {
    assert.throws(() => {
      assertInside('C:\\workspace', 'CON', { code: 'UNSAFE_PROJECT_DIR' });
    }, {
      code: 'UNSAFE_PROJECT_DIR'
    });
    
    assert.throws(() => {
      assertInside('C:\\workspace', 'C:\\workspace\\..\\CON', { code: 'UNSAFE_PROJECT_DIR' });
    }, {
      code: 'UNSAFE_PROJECT_DIR'
    });
  }
});

test('assertInside: deeply nested paths', () => {
  const workspace = '/workspace';
  const deep = '/workspace/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p';
  assert.ok(isInside(workspace, deep));
  assert.equal(assertInside(workspace, deep, { code: 'UNSAFE_PROJECT_DIR' }), deep);
});

test('assertInside: Unicode paths', () => {
  const workspace = '/workspace';
  const unicodePath = '/workspace/프로젝트/测试/тест';
  assert.ok(isInside(workspace, unicodePath));
  assert.equal(assertInside(workspace, unicodePath, { code: 'UNSAFE_PROJECT_DIR' }), unicodePath);
});
