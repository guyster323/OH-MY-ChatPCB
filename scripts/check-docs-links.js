#!/usr/bin/env node
// Checks markdown links relative to the file that contains them, including
// GitHub-style heading anchors. Backtick path mentions are warnings only.
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptDir, '..');

const LINK_PATTERN = /!?\[([^\]]*)\]\(\s*<?([^>\s)]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
const EXTERNAL_TARGET = /^(?:https?|mailto|ftp|irc|vscode):/i;
// Directory + filename. Bare names (`.chatpcb.json`, `agent-daemon.js`) are
// mentions, not path references, and command spans contain spaces or flags.
const BACKTICK_PATH = /^(?:\.\/|\.\.\/)?(?:[\p{L}\p{N}._~-]+\/)+[\p{L}\p{N}._~-]+\.[\p{L}\p{N}]+$/u;

const OPTIONAL_ROOT_FILES = ['README.md', 'plan.md'];

export function repoRelative(rootDir, filePath, pathImpl = path) {
  return pathImpl.relative(rootDir, filePath).split(pathImpl.sep).join('/');
}

export function resolveMarkdownPath(fromFile, urlPath, rootDir, pathImpl = path) {
  let decoded = urlPath;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch (error) {
    const wrapped = new Error(`invalid URL encoding: ${error.message}`);
    wrapped.code = 'BAD_ENCODING';
    throw wrapped;
  }

  const normalized = decoded.replace(/\\/g, '/');
  const segments = normalized === '' ? [] : normalized.split('/');
  if (normalized.startsWith('/')) {
    return pathImpl.resolve(rootDir, ...segments.slice(1));
  }
  return pathImpl.resolve(pathImpl.dirname(fromFile), ...segments);
}

export function githubSlug(headingText) {
  const visible = headingVisibleText(headingText);
  return visible
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-');
}

export function headingAnchors(content) {
  const fences = fenceRanges(content);
  const occurrences = Object.create(null);
  const slugs = new Set();
  let offset = 0;

  for (const line of content.split('\n')) {
    if (!rangesCover(fences, offset)) {
      const match = /^ {0,3}#{1,6}[ \t]+(.*)$/.exec(line);
      if (match) slugs.add(assignSlug(githubSlug(match[1]), occurrences));
    }
    offset += line.length + 1;
  }

  return slugs;
}

function headingVisibleText(text) {
  let value = text.replace(/\s+#+\s*$/, '').trim();
  value = value.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  value = value.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  value = value.replace(/<[^>\n]+>/g, '');
  value = value.replace(/`+/g, '');
  return value;
}

function assignSlug(base, occurrences) {
  let slug = base;
  while (Object.prototype.hasOwnProperty.call(occurrences, slug)) {
    occurrences[base] += 1;
    slug = `${base}-${occurrences[base]}`;
  }
  occurrences[slug] = 0;
  return slug;
}

function fenceRanges(content) {
  const ranges = [];
  let offset = 0;
  let open = null;

  for (const line of content.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      const token = marker[1];
      if (!open) {
        open = { start: offset, char: token[0], len: token.length };
      } else if (token[0] === open.char && token.length >= open.len && marker[2].trim() === '') {
        ranges.push({ start: open.start, end: offset + line.length });
        open = null;
      }
    }
    offset += line.length + 1;
  }

  if (open) ranges.push({ start: open.start, end: content.length });
  return ranges;
}

function codeSpanRanges(content, fences) {
  const ranges = [];
  let index = 0;

  while (index < content.length) {
    const fence = fences.find((range) => index >= range.start && index < range.end);
    if (fence) {
      index = fence.end;
      continue;
    }
    if (content[index] !== '`') {
      index += 1;
      continue;
    }

    let length = 0;
    while (content[index + length] === '`') length += 1;
    const closer = content.indexOf('`'.repeat(length), index + length);
    if (closer === -1) break;
    ranges.push({ start: index, end: closer + length, innerStart: index + length, innerEnd: closer });
    index = closer + length;
  }

  return ranges;
}

function rangesCover(ranges, index) {
  return ranges.some((range) => index >= range.start && index < range.end);
}

function lineAt(content, index) {
  let line = 1;
  const end = Math.min(index, content.length);
  for (let i = 0; i < end; i += 1) {
    if (content.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function splitTarget(raw) {
  const trimmed = raw.trim();
  const hashAt = trimmed.indexOf('#');
  const beforeHash = hashAt === -1 ? trimmed : trimmed.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : trimmed.slice(hashAt + 1);
  const queryAt = beforeHash.indexOf('?');
  const pathPart = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  return { pathPart, hash };
}

function isBacktickPath(text) {
  if (!text || /[\s*]/.test(text) || text.startsWith('-') || text.includes('--')) return false;
  if (EXTERNAL_TARGET.test(text) || text.includes('://')) return false;
  if (/^[A-Za-z]:[\\/]/.test(text)) return false;
  return BACKTICK_PATH.test(text.replace(/\\/g, '/'));
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function readMarkdown(filePath) {
  try {
    const content = await readFile(filePath, 'utf8');
    return { content, anchors: headingAnchors(content) };
  } catch (error) {
    return { error };
  }
}

function pushIssue(list, file, line, message) {
  list.push({ file, line, message });
}

async function inspectFile(filePath, rootDir, cache) {
  const errors = [];
  const warnings = [];
  let linkCount = 0;
  const loaded = await loadCached(cache, filePath);
  if (loaded.error) {
    pushIssue(errors, filePath, 1, `cannot read file: ${loaded.error.message}`);
    return { linkCount, errors, warnings };
  }

  const { content } = loaded;
  const fences = fenceRanges(content);
  const spans = codeSpanRanges(content, fences);

  for (const match of content.matchAll(LINK_PATTERN)) {
    if (rangesCover(fences, match.index) || rangesCover(spans, match.index)) continue;

    const text = match[1];
    const rawTarget = match[2];
    const line = lineAt(content, match.index);
    const { pathPart, hash } = splitTarget(rawTarget);
    if (EXTERNAL_TARGET.test(pathPart) || pathPart.startsWith('//')) continue;

    linkCount += 1;
    const label = `[${text}](${rawTarget})`;

    let targetFile = filePath;
    if (pathPart !== '') {
      let resolved;
      try {
        resolved = resolveMarkdownPath(filePath, pathPart, rootDir);
      } catch (error) {
        pushIssue(errors, filePath, line, `broken link ${label}: ${error.message}`);
        continue;
      }
      targetFile = resolved;
      let exists;
      try {
        exists = await pathExists(targetFile);
      } catch (error) {
        pushIssue(errors, filePath, line, `broken link ${label}: ${error.message}`);
        continue;
      }
      if (!exists) {
        pushIssue(errors, filePath, line, `broken link ${label}: file not found`);
        continue;
      }
    }

    if (hash === '') continue;
    if (!targetFile.endsWith('.md') && !targetFile.endsWith('.markdown')) continue;

    let fragment;
    try {
      fragment = decodeURIComponent(hash);
    } catch (error) {
      pushIssue(errors, filePath, line, `broken anchor ${label}: invalid URL encoding: ${error.message}`);
      continue;
    }

    const target = await loadCached(cache, targetFile);
    if (target.error) {
      pushIssue(errors, filePath, line, `broken anchor ${label}: cannot read ${errorPath(rootDir, targetFile)}: ${target.error.message}`);
      continue;
    }
    if (!target.anchors.has(fragment)) {
      pushIssue(errors, filePath, line, `broken anchor ${label}: heading "${fragment}" not found`);
    }
  }

  for (const span of spans) {
    const text = content.slice(span.innerStart, span.innerEnd);
    if (!isBacktickPath(text)) continue;
    const normalized = text.replace(/\\/g, '/');
    let target;
    try {
      // `./` and `../` are relative to the markdown file. Other backtick paths
      // are repository-root paths (`docs/...`, `src/...`).
      target = normalized.startsWith('./') || normalized.startsWith('../')
        ? resolveMarkdownPath(filePath, normalized, rootDir)
        : path.resolve(rootDir, ...normalized.split('/'));
    } catch (error) {
      pushIssue(warnings, filePath, lineAt(content, span.start), `backtick path \`${text}\`: ${error.message}`);
      continue;
    }
    let exists;
    try {
      exists = await pathExists(target);
    } catch (error) {
      pushIssue(errors, filePath, lineAt(content, span.start), `backtick path \`${text}\`: ${error.message}`);
      continue;
    }
    if (!exists) {
      pushIssue(warnings, filePath, lineAt(content, span.start), `backtick path \`${text}\` not found`);
    }
  }

  return { linkCount, errors, warnings };
}

function errorPath(rootDir, filePath) {
  const relative = repoRelative(rootDir, filePath);
  return relative.startsWith('..') ? filePath : relative;
}

async function loadCached(cache, filePath) {
  if (cache.has(filePath)) return cache.get(filePath);
  const loaded = await readMarkdown(filePath);
  cache.set(filePath, loaded);
  return loaded;
}

async function collectDocFiles(rootDir, errors) {
  const files = [];

  for (const name of OPTIONAL_ROOT_FILES) {
    const fullPath = path.join(rootDir, name);
    let exists;
    try {
      exists = await pathExists(fullPath);
    } catch (error) {
      pushIssue(errors, fullPath, 1, `cannot read file: ${error.message}`);
      continue;
    }
    if (exists) files.push(fullPath);
  }

  const docsDir = path.join(rootDir, 'docs');
  let docsExists;
  try {
    docsExists = await pathExists(docsDir);
  } catch (error) {
    pushIssue(errors, docsDir, 1, `cannot read directory: ${error.message}`);
    return files;
  }
  if (docsExists) files.push(...await walkMarkdown(docsDir, errors));

  return [...new Set(files)].sort();
}

async function walkMarkdown(dir, errors) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    pushIssue(errors, dir, 1, `cannot read directory: ${error.message}`);
    return [];
  }

  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkMarkdown(fullPath, errors));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files;
}

export async function checkTree(rootDir) {
  const errors = [];
  const warnings = [];
  const files = await collectDocFiles(rootDir, errors);
  const cache = new Map();
  let linkCount = 0;

  for (const filePath of files) {
    const report = await inspectFile(filePath, rootDir, cache);
    linkCount += report.linkCount;
    errors.push(...report.errors);
    warnings.push(...report.warnings);
  }

  const byLocation = (left, right) => {
    const leftPath = repoRelative(rootDir, left.file);
    const rightPath = repoRelative(rootDir, right.file);
    if (leftPath < rightPath) return -1;
    if (leftPath > rightPath) return 1;
    return left.line - right.line;
  };
  errors.sort(byLocation);
  warnings.sort(byLocation);

  return { rootDir, fileCount: files.length, linkCount, errors, warnings };
}

function formatIssue(rootDir, issue) {
  return `${repoRelative(rootDir, issue.file)}:${issue.line}: ${issue.message}`;
}

function printReport(result) {
  for (const issue of result.errors) console.log(formatIssue(result.rootDir, issue));
  for (const issue of result.warnings) {
    console.log(`${repoRelative(result.rootDir, issue.file)}:${issue.line}: warning: ${issue.message}`);
  }
  console.log(
    `\nChecked ${result.fileCount} files, ${result.linkCount} markdown links, ${result.errors.length} broken, ${result.warnings.length} warnings`
  );
}

export async function main(rootDir = defaultRoot) {
  const result = await checkTree(rootDir);
  printReport(result);
  return result.errors.length > 0 ? 1 : 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const rootArg = process.argv[2] ? path.resolve(process.argv[2]) : defaultRoot;
  main(rootArg).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error instanceof Error ? error.stack || error.message : String(error));
      process.exitCode = 1;
    }
  );
}
