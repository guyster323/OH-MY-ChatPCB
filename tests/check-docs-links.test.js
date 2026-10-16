import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  checkTree,
  githubSlug,
  headingAnchors,
  repoRelative,
  resolveMarkdownPath
} from '../scripts/check-docs-links.js';

const scriptPath = path.resolve('scripts/check-docs-links.js');

async function writeFixture(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chatpcb-links-'));
  for (const [name, content] of Object.entries(files)) {
    const fullPath = path.join(root, name);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content);
  }
  return root;
}

function runChecker(root) {
  return spawnSync(process.execPath, [scriptPath, root], { encoding: 'utf8' });
}

test('markdown links resolve relative to the containing file and report file:line', async () => {
  const root = await writeFixture({
    'README.md': '# Home\n\nRoot page.\n',
    'docs/guide.md': [
      '# Guide',
      '',
      'This introductory line is long enough that a character offset would not equal the line number.',
      '',
      'See [home](../README.md) and [missing](./missing.md).',
      'Ignore `[skip](./also-missing.md)` and fenced samples.',
      '',
      '```md',
      '[fenced](./fence-missing.md)',
      '```',
      ''
    ].join('\n')
  });

  try {
    const report = await checkTree(root);
    assert.equal(report.errors.length, 1);
    assert.equal(repoRelative(root, report.errors[0].file), 'docs/guide.md');
    assert.equal(report.errors[0].line, 5);
    assert.match(report.errors[0].message, /\[missing\]\(\.\/missing\.md\)/);
    assert.match(report.errors[0].message, /file not found/);
    assert.equal(report.warnings.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('heading anchors use GitHub slugs for same-file and cross-file links', async () => {
  assert.equal(githubSlug('Hello, World!'), 'hello-world');
  assert.equal(githubSlug('[Visible](./ignored.md)'), 'visible');
  assert.equal(githubSlug('개요'), '개요');

  const duplicate = headingAnchors('# Notes\n\n# Notes\n');
  assert.deepEqual([...duplicate], ['notes', 'notes-1']);
  const fenced = headingAnchors('# Real\n\n```\n# Fake\n```\n');
  assert.deepEqual([...fenced], ['real']);

  const root = await writeFixture({
    'README.md': [
      '# Readme Title',
      '',
      'See [guide](docs/guide.md#hello-world) and [second](docs/guide.md#notes-1).',
      'Broken [slug](docs/guide.md#not-a-heading).',
      ''
    ].join('\n'),
    'docs/guide.md': [
      '# Hello, World!',
      '',
      'Same file [ok](#hello-world) and [dup](#notes-1).',
      'Missing [anchor](#missing-anchor).',
      '',
      '# Notes',
      '',
      '# Notes',
      ''
    ].join('\n')
  });

  try {
    const report = await checkTree(root);
    assert.equal(report.errors.length, 2);
    const lines = report.errors.map((issue) => `${repoRelative(root, issue.file)}:${issue.line}`);
    assert.deepEqual(lines, ['README.md:4', 'docs/guide.md:4']);
    assert.match(report.errors[0].message, /heading "not-a-heading" not found/);
    assert.match(report.errors[1].message, /heading "missing-anchor" not found/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('backtick filenames warn without failing, and a broken link exits non-zero', async () => {
  const warningRoot = await writeFixture({
    'docs/page.md': [
      '# Page',
      '',
      'Stale `docs/gone.md` and a Windows-style `docs\\also-gone.md`.',
      'Not a path: `node --test tests/missing.js` or `--port`.',
      'Bare name `agent-daemon.js` is not a path warning.',
      ''
    ].join('\n')
  });
  const brokenRoot = await writeFixture({
    'README.md': 'See [nope](docs/missing.md).\n'
  });

  try {
    const warningReport = await checkTree(warningRoot);
    assert.equal(warningReport.errors.length, 0);
    assert.equal(warningReport.warnings.length, 2);
    assert.equal(warningReport.warnings[0].line, 3);
    assert.match(warningReport.warnings[0].message, /`docs\/gone\.md`/);
    assert.match(warningReport.warnings[1].message, /`docs\\also-gone\.md`/);

    const warningRun = runChecker(warningRoot);
    assert.equal(warningRun.status, 0, warningRun.stderr);
    assert.match(warningRun.stdout, /docs\/page\.md:3: warning: backtick path `docs\/gone\.md` not found/);
    assert.match(warningRun.stdout, /0 broken, 2 warnings/);

    const brokenRun = runChecker(brokenRoot);
    assert.notEqual(brokenRun.status, 0);
    assert.match(brokenRun.stdout, /README\.md:1: broken link \[nope\]\(docs\/missing\.md\): file not found/);
  } finally {
    await rm(warningRoot, { recursive: true, force: true });
    await rm(brokenRoot, { recursive: true, force: true });
  }
});

test('relative link paths use path.relative and posix separators on Windows', () => {
  const win = path.win32;
  const root = 'C:\\repo';
  const fromFile = 'C:\\repo\\docs\\guide.md';

  assert.equal(repoRelative(root, fromFile, win), 'docs/guide.md');
  assert.equal(
    resolveMarkdownPath(fromFile, '../README.md', root, win),
    'C:\\repo\\README.md'
  );
  assert.equal(
    resolveMarkdownPath(fromFile, '..\\README.md', root, win),
    'C:\\repo\\README.md'
  );
  assert.equal(
    resolveMarkdownPath(fromFile, '/docs/guide.md', root, win),
    'C:\\repo\\docs\\guide.md'
  );
});
