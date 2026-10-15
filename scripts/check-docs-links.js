#!/usr/bin/env node
import { readFile, access } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

async function checkLinks(filePath) {
  const content = await readFile(filePath, 'utf8');
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  const links = [];
  const issues = [];
  
  let match;
  while ((match = linkPattern.exec(content)) !== null) {
    const [, text, url] = match;
    links.push({ text, url, line: content.substring(0, match.index).split('\n').length });
    
    // Check local file links
    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('#')) {
      const linkPath = resolve(dirname(filePath), url);
      try {
        await access(linkPath);
      } catch {
        issues.push({ file: filePath, line: match.index, text, url, error: 'File not found' });
      }
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
    // Skip inaccessible directories
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
      
      const relPath = filePath.replace(rootDir + '/', '');
      console.log(`${relPath}: ${links.length} links, ${issues.length} issues`);
      
      if (issues.length > 0) {
        for (const issue of issues) {
          console.log(`  ✗ [${issue.text}](${issue.url}) - ${issue.error}`);
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
