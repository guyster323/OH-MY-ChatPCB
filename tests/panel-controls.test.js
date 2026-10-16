import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { chromium } from 'playwright';

function findBrowserExecutable() {
  const candidates = [
    process.env.CHATPCB_BROWSER_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

const panelRoot = path.resolve('apps/panel');
const projectDir = '/tmp/chatpcb-panel-project';

let browserPromise = null;
let server = null;

// Launch lazily so importing this file never fails; tests skip when no browser can start.
async function getBrowser() {
  browserPromise ??= chromium
    .launch({
      headless: true,
      // CHATPCB_BROWSER_PATH wins; otherwise use a system Chrome/Edge if present,
      // else Playwright's bundled Chromium (npx playwright install chromium).
      executablePath: findBrowserExecutable(),
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    })
    .catch((error) => ({ unavailable: error }));
  const browser = await browserPromise;
  return browser.unavailable ? null : browser;
}

test.after(async () => {
  const browser = browserPromise ? await browserPromise : null;
  if (browser && !browser.unavailable) await browser.close();
  if (server) await server.close();
});

test('stop button enables for the active request and reports a cancelled:false result', async (t) => {
  const opened = await openPanel(t);
  if (!opened) return;
  const { page, pageErrors } = opened;
  try {
    await createProject(page);
    assert.equal(await page.locator('#stop-request-button').isDisabled(), true);
    assert.equal(await page.locator('#stop-request-button').getAttribute('title'), 'No active request');

    await page.getByLabel('Circuit request').fill('STM32 sensor board');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.waitForFunction(() => document.querySelector('#stop-request-button')?.disabled === false);
    assert.equal(await page.locator('#stop-request-button').getAttribute('title'), 'Stop the current request');

    const request = await waitForCallNumber(page, 'project.request', 1);
    await page.getByRole('button', { name: 'Stop request' }).click();
    const rejected = await waitForCallNumber(page, 'provider.cancel', 1);
    assert.equal(rejected.payload.name, 'provider.cancel');
    assert.equal(rejected.payload.args.id, request.payload.id);

    await deliver(page, rejected.payload.id, {
      ok: false,
      error: { code: 'CANCEL_FAILED', message: 'Cancel was rejected.' }
    });
    await page.getByRole('status', { name: 'Request status' }).filter({ hasText: 'The request was not cancelled.' }).waitFor();
    const rejectedCancel = await readRequest(page);
    assert.match(rejectedCancel.detail, /CANCEL_FAILED: Cancel was rejected\./);
    assert.equal(rejectedCancel.stopDisabled, false);
    assert.doesNotMatch(rejectedCancel.summary, /rolled back successfully/i);

    await page.getByRole('button', { name: 'Stop request' }).click();
    const missed = await waitForCallNumber(page, 'provider.cancel', 2);
    assert.equal(missed.payload.args.id, request.payload.id);
    await deliver(page, missed.payload.id, {
      ok: true,
      result: { cancelled: false, id: request.payload.id, reason: 'not_found' }
    });
    await page.waitForFunction(() => /not_found/.test(document.querySelector('#request-technical-detail')?.textContent ?? ''));
    const missedCancel = await readRequest(page);
    assert.equal(missedCancel.summary, 'The request was not cancelled.');
    assert.match(missedCancel.detail, /not_found/);
    assert.equal(missedCancel.stopDisabled, false);
    assert.equal(missedCancel.state, 'running');

    await deliver(page, request.payload.id, {
      ok: true,
      result: {
        operation: 'clarify',
        assistantMessage: 'Need a sensor.',
        conversation: { status: 'awaiting-input', messages: [{ role: 'assistant', text: 'Need a sensor.' }] }
      }
    });
    await page.waitForFunction(() => document.querySelector('#stop-request-button')?.disabled === true);
    assert.equal(await page.locator('#stop-request-button').getAttribute('title'), 'No active request');

    await page.getByRole('button', { name: 'Send' }).click();
    await page.waitForFunction(() => document.querySelector('#stop-request-button')?.disabled === false);
    const missingBinary = await waitForCallNumber(page, 'project.request', 2);
    await deliver(page, missingBinary.payload.id, {
      ok: false,
      error: {
        code: 'ENOENT',
        message: 'Codex CLI was not found on the daemon PATH (spawn codex ENOENT). Install: npm install -g @openai/codex, then: codex login --device-auth. Add global npm bin to PATH if needed (check with: npm prefix -g).'
      }
    });
    await page.waitForFunction(() => /spawn codex ENOENT/.test(document.querySelector('#request-technical-detail')?.textContent ?? ''));
    const enoent = await readRequest(page);
    assert.match(enoent.detail, /npm install -g @openai\/codex/);
    assert.match(enoent.detail, /codex login --device-auth/);
    assert.equal(enoent.stopDisabled, true);
    assert.equal(enoent.state, 'failed');
    assertNoPageErrors(pageErrors);
  } finally {
    await page.close();
  }
});

test('rollback maps transactionId and status, confirms in the panel, and handles failure results', async (t) => {
  const opened = await openPanel(t);
  if (!opened) return;
  const { page, pageErrors } = opened;
  try {
    await createProject(page);
    const transactions = [1, 2, 3, 4, 5, 6].map((number) => ({
      transactionId: `txn-${number}`,
      status: number === 1 ? 'rolled-back' : 'applied',
      operation: 'NOT_A_STATUS',
      createdAt: number,
      changes: [
        { path: `txn-${number}-a.kicad_sch`, operation: 'modify' },
        { path: `txn-${number}-b.kicad_sch`, operation: 'create' }
      ]
    }));

    await page.locator('[data-open="transaction-dialog"]').click();
    const statusCall = await waitForCallNumber(page, 'project.transaction.status', 1);
    assert.equal(statusCall.payload.args.projectDir, projectDir);
    await deliver(page, statusCall.payload.id, { ok: true, result: { transactions } });

    await page.waitForFunction(() => document.querySelectorAll('#transaction-list li').length === 5);
    const rows = await page.locator('#transaction-list li').evaluateAll((nodes) => nodes.map((node) => ({
      id: node.dataset.transactionId,
      status: node.dataset.status,
      text: node.textContent
    })));
    assert.deepEqual(rows.map((row) => row.id), ['txn-6', 'txn-5', 'txn-4', 'txn-3', 'txn-2']);
    assert.deepEqual(rows.map((row) => row.status), ['applied', 'applied', 'applied', 'applied', 'applied']);
    assert.match(rows[0].text, /txn-6: applied · 2 file\(s\)/);
    assert.doesNotMatch(rows[0].text, /NOT_A_STATUS|undefined/);
    assert.equal(await page.locator('#rollback-button').isDisabled(), false);
    assert.equal(await page.locator('#rollback-button').getAttribute('title'), 'Rollback transaction txn-6');

    await page.locator('#rollback-button').click();
    await page.locator('#rollback-confirm-dialog').waitFor({ state: 'visible' });
    assert.match(await page.locator('#rollback-confirm-message').textContent(), /txn-6/);
    await page.locator('#rollback-confirm-no').click();
    await page.waitForFunction(() => document.querySelector('#rollback-confirm-dialog')?.open !== true);
    assert.equal((await callsNamed(page, 'project.transaction.rollback')).length, 0);
    assert.equal(await page.locator('#request-status').textContent(), 'Project ready. Describe the circuit you want to create.');

    await page.locator('#rollback-button').click();
    await page.locator('#rollback-confirm-yes').click();
    await page.getByRole('status', { name: 'Request status' }).filter({ hasText: 'Rolling back transaction...' }).waitFor();
    const failedCall = await waitForCallNumber(page, 'project.transaction.rollback', 1);
    assert.equal(failedCall.payload.args.transactionId, 'txn-6');
    assert.equal(failedCall.payload.args.projectDir, projectDir);
    await deliver(page, failedCall.payload.id, {
      ok: false,
      error: { code: 'JOURNAL_NOT_FOUND', message: 'Transaction journal is not configured.' }
    });
    await page.getByRole('status', { name: 'Request status' }).filter({ hasText: 'Rollback failed.' }).waitFor();
    const failed = await readRequest(page);
    assert.equal(failed.summary, 'Rollback failed.');
    assert.match(failed.detail, /JOURNAL_NOT_FOUND: Transaction journal is not configured\./);
    assert.doesNotMatch(failed.summary, /Rolling back|successfully/);
    assert.equal(failed.state, 'failed');

    await page.locator('#rollback-button').click();
    await page.locator('#rollback-confirm-yes').click();
    const notRolled = await waitForCallNumber(page, 'project.transaction.rollback', 2);
    assert.equal(notRolled.payload.args.transactionId, 'txn-6');
    await deliver(page, notRolled.payload.id, {
      ok: true,
      result: { rolledBack: false, reason: { code: 'JOURNAL_NOT_FOUND', message: 'No matching journal entry.' } }
    });
    await page.waitForFunction(() => /No matching journal entry/.test(document.querySelector('#request-technical-detail')?.textContent ?? ''));
    const refused = await readRequest(page);
    assert.equal(refused.summary, 'Rollback failed.');
    assert.match(refused.detail, /JOURNAL_NOT_FOUND: No matching journal entry\./);
    assert.doesNotMatch(refused.summary, /successfully/);

    await page.locator('#rollback-button').click();
    await page.locator('#rollback-confirm-yes').click();
    const rolled = await waitForCallNumber(page, 'project.transaction.rollback', 3);
    const statusBefore = (await callsNamed(page, 'project.transaction.status')).length;
    await deliver(page, rolled.payload.id, {
      ok: true,
      result: { rolledBack: true, transaction: { transactionId: 'txn-6', status: 'rolled-back' } }
    });
    await page.getByRole('status', { name: 'Request status' }).filter({ hasText: 'Transaction rolled back successfully.' }).waitFor();
    const success = await readRequest(page);
    assert.equal(success.summary, 'Transaction rolled back successfully.');
    assert.equal(success.detail, '');
    assert.equal(success.state, 'completed');
    await page.waitForFunction((previous) => window.__sent.filter((envelope) => envelope.payload?.name === 'project.transaction.status').length > previous, statusBefore);
    assertNoPageErrors(pageErrors);
  } finally {
    await page.close();
  }
});

test('patch preview shows ERC counts and apply refreshes the transaction list', async (t) => {
  const opened = await openPanel(t);
  if (!opened) return;
  const { page, pageErrors } = opened;
  try {
    await createProject(page);
    await replyInspect(page);
    assert.equal(await page.locator('#patch-preview-erc').isHidden(), true);

    await sendPrompt(page, 'Generate the board');
    const applied = await waitForCallNumber(page, 'project.request', 1);
    assert.equal(await page.locator('#stop-request-button').isDisabled(), false);
    const statusBeforeApply = (await callsNamed(page, 'project.transaction.status')).length;
    await deliver(page, applied.payload.id, {
      ok: true,
      result: {
        operation: 'generated',
        files: { project: `${projectDir}/board.kicad_pro` },
        validation: { ok: true, erc: { errorCount: 0, warningCount: 3 } },
        review: {
          status: 'ready-for-prototype-review',
          findings: { blockers: [], warnings: [], notes: [] },
          proposedFixes: []
        }
      }
    });
    await page.waitForFunction((previous) => window.__sent.filter((envelope) => envelope.payload?.name === 'project.transaction.status').length > previous, statusBeforeApply);
    await page.waitForFunction(() => document.querySelector('#stop-request-button')?.disabled === true);

    await sendPrompt(page, 'Preview the board');
    const preview = await waitForCallNumber(page, 'project.request', 2);
    const statusBeforePreview = (await callsNamed(page, 'project.transaction.status')).length;
    await deliver(page, preview.payload.id, {
      ok: true,
      result: previewResult({ errorCount: 17, warningCount: 162 })
    });
    await page.locator('#patch-preview-erc-summary').filter({ hasText: 'ERC: 17 errors, 162 warnings' }).waitFor();
    assert.equal(await page.locator('#patch-preview-erc').isHidden(), false);
    assert.equal(await page.locator('#patch-preview-erc-warning').isHidden(), false);
    assert.match(await page.locator('#patch-preview-erc-warning').textContent() ?? '', /ERC errors detected/);
    assert.match(await page.locator('#patch-preview-erc-warning').textContent() ?? '', /label_dangling \(17\)/);
    assert.equal((await callsNamed(page, 'project.transaction.status')).length, statusBeforePreview);
    await replyInspect(page);
    await page.waitForFunction(() => document.querySelector('#cancel-patch-button')?.disabled === false);

    await page.locator('#cancel-patch-button').click();
    await page.waitForFunction(() => document.querySelector('#patch-preview-erc')?.hidden === true);

    await sendPrompt(page, 'Preview a clean board');
    const clean = await waitForCallNumber(page, 'project.request', 3);
    await deliver(page, clean.payload.id, {
      ok: true,
      result: previewResult({ errorCount: 0, warningCount: 3, patchId: 'patch_clean' })
    });
    await page.locator('#patch-preview-erc-summary').filter({ hasText: 'ERC: 0 errors, 3 warnings' }).waitFor();
    assert.equal(await page.locator('#patch-preview-erc-warning').isHidden(), true);
    await replyInspect(page);
    await page.waitForFunction(() => document.querySelector('#approve-patch-button')?.disabled === false);

    const statusBeforeApprove = (await callsNamed(page, 'project.transaction.status')).length;
    const patchesBeforeApprove = (await callsNamed(page, 'schematic.patch')).length;
    await page.getByRole('button', { name: 'Approve' }).click();
    await page.waitForFunction(() => document.querySelector('#patch-preview-erc')?.hidden === true);
    const approval = await waitForCallNumber(page, 'schematic.patch', patchesBeforeApprove + 1);
    assert.equal(approval.payload.args.approved, true);
    assert.equal(approval.payload.args.patchId, 'patch_clean');
    assert.equal(approval.payload.args.projectDir, projectDir);
    await deliver(page, approval.payload.id, {
      ok: true,
      result: {
        operation: 'patched',
        files: { project: `${projectDir}/board.kicad_pro` },
        validation: { ok: true, erc: { errorCount: 0, warningCount: 3 } },
        review: {
          status: 'ready-for-prototype-review',
          findings: { blockers: [], warnings: [], notes: [] },
          proposedFixes: []
        }
      }
    });
    await page.getByRole('status', { name: 'Request status' }).filter({ hasText: 'Completed:' }).waitFor();
    await page.waitForFunction((previous) => window.__sent.filter((envelope) => envelope.payload?.name === 'project.transaction.status').length > previous, statusBeforeApprove);
    assertNoPageErrors(pageErrors);
  } finally {
    await page.close();
  }
});

function previewResult({ errorCount, warningCount, patchId = 'patch_erc' }) {
  return {
    operation: 'generated',
    requiresApproval: true,
    patchId,
    expiresAt: Date.now() + 60000,
    files: { schematic: `${projectDir}/board.kicad_sch` },
    validation: {
      ok: errorCount === 0,
      erc: {
        errorCount,
        warningCount,
        byType: errorCount > 0 ? { label_dangling: errorCount } : {}
      }
    },
    review: {
      status: 'needs-input',
      findings: { blockers: [], warnings: [], notes: [] },
      proposedFixes: []
    }
  };
}

async function openPanel(t) {
  const browser = await getBrowser();
  if (!browser) {
    const reason = (await browserPromise).unavailable?.message?.split('\n')[0] ?? 'unknown error';
    t.skip(`No Chromium browser available (${reason}). Set CHATPCB_BROWSER_PATH or run npx playwright install chromium.`);
    return null;
  }
  server ??= await startStaticServer(panelRoot);
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.__sent = [];
    window.confirm = () => {
      throw new Error('window.confirm should not be used');
    };
    class FakeSocket {
      constructor() {
        this.readyState = FakeSocket.CONNECTING;
        this.listeners = new Map();
        window.__ws = this;
        queueMicrotask(() => {
          this.readyState = FakeSocket.OPEN;
          this.emit('open', {});
        });
      }

      addEventListener(type, fn) {
        const list = this.listeners.get(type) ?? [];
        list.push(fn);
        this.listeners.set(type, list);
      }

      emit(type, event) {
        for (const fn of this.listeners.get(type) ?? []) fn(event);
      }

      send(data) {
        window.__sent.push(JSON.parse(data));
      }
    }
    FakeSocket.CONNECTING = 0;
    FakeSocket.OPEN = 1;
    FakeSocket.CLOSED = 3;
    window.WebSocket = FakeSocket;
    window.__deliver = (envelope) => {
      window.__ws.emit('message', { data: JSON.stringify(envelope) });
    };
  });
  await page.goto(`${server.url}/index.html`);
  await page.getByText('Connected', { exact: true }).waitFor();
  return { page, pageErrors };
}

async function createProject(page) {
  await page.getByLabel('Workspace root').fill('/tmp/chatpcb-ui');
  await page.getByLabel('Project name').fill('Sensor Board');
  await page.locator('#new-project-form').getByRole('button', { name: 'New project' }).click();
  const call = await waitForCallNumber(page, 'project.create', 1);
  await deliver(page, call.payload.id, {
    ok: true,
    result: { displayName: 'Sensor Board', slug: 'Sensor-Board', projectDir }
  });
  await page.getByRole('status', { name: 'Active project' }).getByText('Sensor Board').waitFor();
  await page.waitForFunction(() => document.querySelector('#prompt')?.disabled === false);
}

async function sendPrompt(page, prompt) {
  await page.getByLabel('Circuit request').fill(prompt);
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForFunction(() => document.querySelector('#stop-request-button')?.disabled === false);
}

const repliedInspectIds = new WeakMap();

async function replyInspect(page) {
  await page.waitForFunction(() => window.__sent.some((envelope) => envelope.payload?.name === 'project.inspect'));
  const calls = await callsNamed(page, 'project.inspect');
  const seen = repliedInspectIds.get(page) ?? new Set();
  repliedInspectIds.set(page, seen);
  for (const call of calls) {
    if (seen.has(call.payload.id)) continue;
    seen.add(call.payload.id);
    await deliver(page, call.payload.id, {
      ok: true,
      result: {
        manifest: { freshness: { status: 'current', reason: 'Fresh.' } },
        inspection: { projectDigest: 'a'.repeat(64), artifactCount: 2 },
        validation: {
          erc: { errorCount: 0, warningCount: 0 },
          drc: { violationCount: 0, unconnectedCount: 0 }
        }
      }
    });
  }
}

async function waitForCallNumber(page, name, count) {
  await page.waitForFunction(({ name: expected, count: expectedCount }) => (
    window.__sent.filter((envelope) => envelope.payload?.name === expected).length >= expectedCount
  ), { name, count });
  const calls = await callsNamed(page, name);
  return calls[count - 1];
}

async function callsNamed(page, name) {
  return page.evaluate((expected) => window.__sent.filter((envelope) => envelope.payload?.name === expected), name);
}

async function deliver(page, id, body) {
  await page.evaluate(({ id: callId, body: payload }) => {
    window.__deliver({
      version: 1,
      id: `evt_${callId}`,
      type: 'tool.result',
      createdAt: new Date().toISOString(),
      payload: { id: callId, ...payload }
    });
  }, { id, body });
}

async function readRequest(page) {
  return page.evaluate(() => ({
    summary: document.querySelector('#request-status')?.textContent ?? '',
    detail: document.querySelector('#request-technical-detail')?.textContent ?? '',
    state: document.querySelector('#request-status')?.dataset.state ?? '',
    stopDisabled: document.querySelector('#stop-request-button')?.disabled === true
  }));
}

function assertNoPageErrors(pageErrors) {
  assert.deepEqual(pageErrors, []);
}

async function startStaticServer(rootDir) {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const filePath = path.resolve(rootDir, relativePath);
      if (!filePath.startsWith(rootDir)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }
      const body = await readFile(filePath);
      response.writeHead(200, { 'content-type': contentType(filePath) });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}
