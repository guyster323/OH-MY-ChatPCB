#!/usr/bin/env node
import { readFile, access } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

async function checkLinks(filePath) {
  const content = await readFile(filePath, 'utf8');
  const markdownLinkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  const backtickPathPattern = /`([^`]+\.(md|js|json|ts|tsx|yml|yaml))`/g;
  const links = [];
  const issues = [];
  
  const lines = content.split('\n');
  const getLineNumber = (index) => {
    let pos = 0;
    for (let i = 0; i < lines.length; i++) {
      pos += lines[i].length + 1; // +1 for newline
      if (pos > index) return i + 1;
    }
    return lines.length;
  };
  
  // Check markdown links
  let match;
  while ((match = markdownLinkPattern.exec(content)) !== null) {
    const [, text, url] = match;
    const lineNum = getLineNumber(match.index);
    links.push({ text, url, line: lineNum, type: 'markdown' });
    
    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('#')) {
      const linkPath = resolve(dirname(filePath), url.split(path.sep).join('/'));
      try {
        await access(linkPath);
      } catch (err) {
        issues.push({ file: filePath, line: lineNum, text, url, error: `File not found: ${err.message}` });
      }
    }
  }
  
  // Check backtick-wrapped repo paths
  while ((match = backtickPathPattern.exec(content)) !== null) {
    const [, pathStr] = match;
    const lineNum = getLineNumber(match.index);
    
    // Skip absolute paths and URLs
    if (pathStr.startsWith('http') || pathStr.startsWith('/') || pathStr.includes('://')) continue;
    
    links.push({ text: pathStr, url: pathStr, line: lineNum, type: 'backtick' });
    
    const repoPath = join(rootDir, pathStr.split(path.sep).join('/'));
    try {
      await access(repoPath);
    } catch (err) {
      issues.push({ file: filePath, line: lineNum, text: pathStr, url: pathStr, error: `Repo file not found: ${err.message}` });
    }
  }
  
  return { links, issues };
}

async function findMarkdownFiles(dir, baseDir = rootDir) {
  const { readdir, stat } = await import('node:fs/promises');
  const files = [];
  
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await findMarkdownFiles(fullPath, baseDir));
      } else if (entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  } catch (err) {
    console.error(`Warning: Could not read directory ${dir}: ${err.message}`);
  }
  
  return files;
}

async function main() {
  const docsDir = join(rootDir, 'docs');
  const docFiles = [
    join(rootDir, 'README.md'),
    join(rootDir, 'plan.md'),
    ...(await findMarkdownFiles(docsDir))
  ].filter((f, i, a) => a.indexOf(f) === i); // deduplicate
  
  let totalLinks = 0;
  let totalIssues = 0;
  let totalFiles = 0;
  
  for (const filePath of docFiles) {
    try {
      const { links, issues } = await checkLinks(filePath);
      totalLinks += links.length;
      totalIssues += issues.length;
      totalFiles++;
      
      const relPath = filePath.replace(rootDir + path.sep, '').split(path.sep).join('/');
      console.log(`${relPath}: ${links.length} links, ${issues.length} issues`);
      
      if (issues.length > 0) {
        for (const issue of issues) {
          console.log(`  ✗ Line ${issue.line}: [${issue.text}](${issue.url}) - ${issue.error}`);
        }
      }
    } catch (err) {
      console.error(`Error checking ${filePath}:`, err.message);
    }
  }
  
  console.log(`\nTotal: ${totalFiles} files, ${totalLinks} links checked, ${totalIssues} broken links`);
  
  if (totalIssues > 0) {
    process.exit(1);
  }
}

main();
