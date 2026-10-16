import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { launchPanelBrowser } from './helpers/launch-panel-browser.js';
import { resolveVerifyUiTimeoutMs, waitForCompletedOrFailFast } from '../scripts/verify-panel-ui.js';

test('panel browser UI verification script is exposed through npm', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));

  assert.equal(
    packageJson.scripts['verify:ui'],
    'node ./scripts/verify-panel-ui.js'
  );
});

test('verify UI script reaches main when invoked without a file extension', async () => {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const result = spawnSync(process.execPath, ['scripts/verify-panel-ui'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, CHATPCB_VERIFY_UI_DRY_RUN: '1' },
    timeout: 15_000
  });

  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.equal(result.stdout, 'chatpcb-verify-ui-dry-run\n');
});

test('verify UI script reaches main when invoked through a symlink', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'chatpcb-verify-ui-symlink-'));
  const linkPath = path.join(dir, 'verify-panel-ui.js');
  const scriptPath = fileURLToPath(new URL('../scripts/verify-panel-ui.js', import.meta.url));

  try {
    await symlink(scriptPath, linkPath);
    const result = spawnSync(process.execPath, [linkPath], {
      encoding: 'utf8',
      env: { ...process.env, CHATPCB_VERIFY_UI_DRY_RUN: '1' },
      timeout: 15_000
    });

    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.equal(result.stdout, 'chatpcb-verify-ui-dry-run\n');
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test('verify UI wait timeout keeps 120000 unless env or --timeout-ms overrides it', () => {
  assert.equal(resolveVerifyUiTimeoutMs({ env: {}, argv: ['node', 'scripts/verify-panel-ui.js'] }), 120000);
  assert.equal(resolveVerifyUiTimeoutMs({
    env: { CHATPCB_VERIFY_UI_TIMEOUT_MS: '45000' },
    argv: ['node', 'scripts/verify-panel-ui.js']
  }), 45000);
  assert.equal(resolveVerifyUiTimeoutMs({
    env: { CHATPCB_VERIFY_UI_TIMEOUT_MS: '45000' },
    argv: ['node', 'scripts/verify-panel-ui.js', '--timeout-ms', '8000']
  }), 8000);
  assert.equal(resolveVerifyUiTimeoutMs({
    env: {},
    argv: ['--timeout-ms=1500']
  }), 1500);
  assert.throws(
    () => resolveVerifyUiTimeoutMs({ env: { CHATPCB_VERIFY_UI_TIMEOUT_MS: 'soon' }, argv: [] }),
    /CHATPCB_VERIFY_UI_TIMEOUT_MS must be a positive integer/
  );
  assert.throws(
    () => resolveVerifyUiTimeoutMs({ env: {}, argv: ['--timeout-ms'] }),
    /--timeout-ms requires a positive integer/
  );
});

test('waitForCompletedOrFailFast rejects from failed data-state with ERC details', async (t) => {
  const browser = await launchChrome(t);
  if (!browser) return;
  const page = await browser.newPage();
  try {
    await page.setContent(statusDocument({
      state: 'running',
      statusText: 'Applying the circuit draft…',
      extra: '<p>Completed</p><p>ERC validation failed</p>'
    }));
    const ercDetail = '17 label_dangling errors: VBUS, CC1, CC2, SW_3V3';
    const timeoutMs = 12000;
    const started = Date.now();
    await page.evaluate((detail) => {
      setTimeout(() => {
        const status = document.querySelector('#request-status');
        status.dataset.state = 'failed';
        status.textContent = 'ERC validation failed. Review the validation details before continuing.';
        const card = document.querySelector('#validation-status');
        card.dataset.state = 'failed';
        card.textContent = detail;
        document.querySelector('#inspection-erc').textContent = 'ERC 17/162';
        document.querySelector('#request-technical-detail').textContent = 'KiCad ERC rejected the applied schematic.';
        document.querySelector('#request-progress').textContent = 'Applying the circuit draft failed.';
      }, 200);
    }, ercDetail);
    await assert.rejects(waitForCompletedOrFailFast(page, timeoutMs), (error) => {
      assert.equal(error.message, [
        'Apply failed instead of completing.',
        'ERC validation failed. Review the validation details before continuing.',
        'KiCad ERC rejected the applied schematic.',
        'Applying the circuit draft failed.',
        ercDetail,
        'ERC 17/162'
      ].join('\n'));
      assert.equal(error.message.split(ercDetail).length - 1, 1);
      return true;
    });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < timeoutMs / 2, `expected fail-fast before ${timeoutMs}ms, took ${elapsed}ms`);
  } finally {
    await page.close();
    await browser.close();
  }
});

test('waitForCompletedOrFailFast resolves when data-state becomes completed', async (t) => {
  const browser = await launchChrome(t);
  if (!browser) return;
  const page = await browser.newPage();
  try {
    await page.setContent(statusDocument({
      state: 'running',
      statusText: 'Applying the circuit draft…'
    }));
    const timeoutMs = 12000;
    const started = Date.now();
    await page.evaluate(() => {
      setTimeout(() => {
        const status = document.querySelector('#request-status');
        status.dataset.state = 'completed';
        status.textContent = 'Generated project.';
      }, 200);
    });
    await waitForCompletedOrFailFast(page, timeoutMs);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < timeoutMs / 2, `expected completion before ${timeoutMs}ms, took ${elapsed}ms`);
    assert.equal(await page.locator('#request-status').getAttribute('data-state'), 'completed');
    assert.equal(await page.locator('#request-status').textContent(), 'Generated project.');
  } finally {
    await page.close();
    await browser.close();
  }
});

test('waitForCompletedOrFailFast ignores Completed text and whole-page ERC text', async (t) => {
  const browser = await launchChrome(t);
  if (!browser) return;
  const page = await browser.newPage();
  try {
    await page.setContent(statusDocument({
      state: 'running',
      statusText: 'Completed',
      extra: '<p>ERC validation failed</p>'
    }));
    const timeoutMs = 800;
    const started = Date.now();
    await assert.rejects(waitForCompletedOrFailFast(page, timeoutMs), (error) => {
      assert.equal(error.name, 'TimeoutError');
      assert.doesNotMatch(error.message, /Apply failed instead of completing/);
      return true;
    });
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= timeoutMs - 50, `returned before the timeout (${elapsed}ms)`);
    assert.equal(await page.locator('#request-status').getAttribute('data-state'), 'running');
  } finally {
    await page.close();
    await browser.close();
  }
});

function statusDocument({ state, statusText, extra = '' }) {
  return `<!DOCTYPE html>
<html>
<body>
  <p id="request-status" role="status" aria-label="Request status" data-state="${state}">${statusText}</p>
  <details id="request-technical-details"><pre id="request-technical-detail"></pre></details>
  <ol id="request-progress" aria-label="Request progress"></ol>
  <section class="validation-card" aria-labelledby="validation-title">
    <h2 id="validation-title">ERC validation</h2>
    <p id="validation-status" data-state="idle">Not run</p>
  </section>
  <p id="inspection-erc">ERC —</p>
  ${extra}
</body>
</html>`;
}

function launchChrome(t) {
  return launchPanelBrowser(t, {
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
}
