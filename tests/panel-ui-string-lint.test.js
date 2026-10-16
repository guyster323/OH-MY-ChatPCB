import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

const root = fileURLToPath(new URL('..', import.meta.url));
const eslint = new ESLint({
  cwd: root,
  overrideConfigFile: path.join(root, 'eslint.config.js')
});

const header = `
function t(key) { return key; }
const el = { setAttribute() {}, textContent: '' };
const x = 'name';
const ok = true;
`;

async function restrictedSyntax(code) {
  const [result] = await eslint.lintText(`${header}${code}`, {
    filePath: path.join(root, 'apps/panel/ui-string-probe.js')
  });
  return result.messages.filter((message) => message.ruleId === 'no-restricted-syntax');
}

test('panel UI string rule rejects hardcoded copy and allows t()', async () => {
  const rejected = [
    ["el.textContent = 'Pending';", 'textContent string literal'],
    ['el.textContent = `ERC failed: ${x}`;', 'textContent template'],
    ["el.textContent = 'ERC ' + x;", 'textContent concatenation'],
    ["el.textContent = ok ? 'Passed' : 'Failed';", 'textContent ternary'],
    ["el.innerText = 'Pending';", 'innerText literal'],
    ["el.innerHTML = '<b>Pending</b>';", 'innerHTML literal'],
    ["el.title = 'Pending';", 'title assignment'],
    ["el.placeholder = 'Type here';", 'placeholder assignment'],
    ["el.ariaLabel = 'Apply';", 'ariaLabel assignment'],
    ["el.setAttribute('title', 'Pending');", 'setAttribute title'],
    ["el.setAttribute('aria-label', 'Apply');", 'setAttribute aria-label'],
    ["el.setAttribute('placeholder', 'Type here');", 'setAttribute placeholder'],
    ["el.setAttribute('aria-label', 'Hello ' + x);", 'setAttribute concatenation'],
    ["el.setAttribute('title', ok ? 'Passed' : 'Failed');", 'setAttribute ternary'],
    ["renderRequestStatus({ summary: 'Applying the circuit draft…' });", 'summary property'],
    ["appendProgress({ text: '스키매틱에 넣는 중…' });", 'appendProgress text property'],
    ["const steps = { apply: { title: '스키매틱에 넣는 중', sprite: 'apply' } };", 'progress title property'],
    ["clearPatchApproval('Patch preview cancelled.');", 'function argument sentence'],
    ["clearPatchApproval('스키매틱');", 'function argument Hangul'],
    ['show({ text: `스키매틱` });', 'Hangul template property'],
    ["renderRequestStatus({ label: 'Apply', message: 'Saved' });", 'label and message properties'],
    ["appendProgress({ text: ok ? 'Passed' : 'Failed' });", 'conditional object text'],
    ["appendProgress({ summary: 'ERC ' + x });", 'concatenated object summary']
  ];

  for (const [code, label] of rejected) {
    const errors = await restrictedSyntax(code);
    assert.ok(errors.length > 0, `${label} should be rejected`);
  }

  const allowed = [
    "el.textContent = t('request.pending');",
    "el.textContent = t(ok ? 'validation.unavailable' : 'validation.skipped');",
    "el.textContent = ok ? t('review.ready-release') : t('review.blocked');",
    "el.textContent = '';",
    "el.textContent = ok ? x : '';",
    "el.title = x || '';",
    "el.setAttribute('aria-label', t('workflow.step.aria'));",
    "el.setAttribute('placeholder', t('composer.placeholder'));",
    "el.setAttribute('title', t('patch.title'));",
    "el.setAttribute('aria-checked', ok ? 'false' : 'true');",
    "el.setAttribute('d', 'M2 6.5l2.5 2.5L10 3.5');",
    "renderRequestStatus({ state: 'running', summaryKey: 'request.applying' });",
    "appendProgress({ stage: 'apply', text: t('request.apply-progress') });",
    "const steps = { apply: { titleKey: 'progress.apply', sprite: 'apply' } };",
    "clearPatchApproval('patch.cancelled');",
    'show({ label: `${t(\'workflow.lane.circuit\')} ${t(\'workflow.step.circuit.draft\')}` });',
    "document.querySelector('.lane-h, .lane-name');"
  ];

  for (const code of allowed) {
    const errors = await restrictedSyntax(code);
    assert.deepEqual(errors.map((error) => error.message), [], code);
  }
});
