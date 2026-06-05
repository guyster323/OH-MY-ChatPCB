import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Phase 1 exposes a single sample verification script', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));

  assert.equal(
    packageJson.scripts['verify:sample'],
    'npm run generate:sample && npm run validate:sample && npm run simulate:sample'
  );
});

test('Phase 1 public development documents are present and actionable', async () => {
  const contributing = await readFile('CONTRIBUTING.md', 'utf8');
  const readme = await readFile('README.md', 'utf8');
  const plan = await readFile('plan.md', 'utf8');

  assert.match(contributing, /Test-first workflow/);
  assert.match(contributing, /Local-only credentials/);
  assert.match(contributing, /KiCad fork workflow/);

  assert.match(readme, /User Test Guide/);
  assert.match(readme, /Codex CLI verification/);
  assert.match(readme, /npm install/);
  assert.match(readme, /npm run verify:sample/);
  assert.match(readme, /npm run verify:panel/);
  assert.match(readme, /npm run verify:ui/);
  assert.match(readme, /Browser UI verification/);
  assert.match(readme, /Computer Use verification status/);
  assert.match(readme, /codex exec -C C:\\Users\\windo\\chatpcb2 --dangerously-bypass-approvals-and-sandbox/);
  assert.doesNotMatch(readme, /--ask-for-approval/);
  assert.match(readme, /Keep this terminal running/);

  assert.match(plan, /- \[x\] Add `npm run verify:sample`/);
  assert.match(plan, /- \[x\] Add `npm run verify:panel`/);
  assert.match(plan, /- \[x\] Add `npm run verify:ui`/);
  assert.match(plan, /- \[x\] Add a short `CONTRIBUTING\.md`/);
  assert.match(plan, /- \[x\] Replace the placeholder SPDX license file/);
});

test('LICENSE contains the full GPL v3 license text, not only an SPDX pointer', async () => {
  const license = await readFile('LICENSE', 'utf8');

  assert.match(license, /GNU GENERAL PUBLIC LICENSE/);
  assert.match(license, /Version 3, 29 June 2007/);
  assert.match(license, /TERMS AND CONDITIONS/);
  assert.match(license, /END OF TERMS AND CONDITIONS/);
  assert.ok(license.length > 30000);
});
