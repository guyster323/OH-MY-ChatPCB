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

async function main() {
  const docFiles = [
    'README.md',
    'docs/ROADMAP.md',
    'docs/ARCHITECTURE.md',
    'docs/KICAD_FORK_BOOTSTRAP.md'
  ];
  
  let totalLinks = 0;
  let totalIssues = 0;
  
  for (const file of docFiles) {
    const filePath = join(rootDir, file);
    try {
      const { links, issues } = await checkLinks(filePath);
      totalLinks += links.length;
      totalIssues += issues.length;
      
      console.log(`${file}: ${links.length} links, ${issues.length} issues`);
      
      if (issues.length > 0) {
        for (const issue of issues) {
          console.log(`  ✗ [${issue.text}](${issue.url}) - ${issue.error}`);
        }
      }
    } catch (err) {
      console.error(`Error checking ${file}:`, err.message);
    }
  }
  
  console.log(`\nTotal: ${totalLinks} links checked, ${totalIssues} broken links`);
  
  if (totalIssues > 0) {
    process.exit(1);
  }
}

main();
