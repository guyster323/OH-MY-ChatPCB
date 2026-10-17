/* global document, window */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import test from 'node:test';

import { launchPanelBrowser } from '../scripts/lib/launch-panel-browser.js';

const PANEL_ROOT = resolve('apps/panel');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png'
};

const passedPreview = {
  patchId: 'patch_test',
  evidenceDigest: 'digest-before',
  afterDigest: 'digest-after',
  validation: { ok: true, skipped: false, erc: { errorCount: 0, warningCount: 0 } },
  candidateVerification: {
    erc: { ok: true, skipped: false, status: 'passed', errorCount: 0, erc: { errorCount: 0, warningCount: 0 } }
  },
  inspection: {
    manifest: { freshness: { status: 'current', reason: 'Evidence matches.' } },
    validation: {}
  }
};

function loadLocales() {
  return Promise.all([
    readFile(join(PANEL_ROOT, 'locales/en.json'), 'utf8'),
    readFile(join(PANEL_ROOT, 'locales/ko.json'), 'utf8')
  ]).then(([en, ko]) => ({ en: JSON.parse(en), ko: JSON.parse(ko) }));
}

async function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      let pathname = normalize(decodeURIComponent(url.pathname));
      if (pathname === '/' || pathname === sep) pathname = '/index.html';
      const file = resolve(PANEL_ROOT, `.${pathname}`);
      if (file !== PANEL_ROOT && !file.startsWith(PANEL_ROOT + sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  return server;
}

async function openPanel(browser, port, lang = 'en') {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.__CHATPCB_TEST_MODE__ = true;
    window.__chatpcbReconnectMs = 0;
    window.__sent = [];
    window.__sockets = [];
    class FakeSocket extends EventTarget {
      constructor(url) {
        super();
        this.url = url;
        this.readyState = 1;
        window.__sockets.push(this);
        queueMicrotask(() => this.dispatchEvent(new Event('open')));
      }
      send(data) {
        window.__sent.push(String(data));
      }
      close() {
        if (this.readyState === 3) return;
        this.readyState = 3;
        this.dispatchEvent(new Event('close'));
      }
    }
    FakeSocket.CONNECTING = 0;
    FakeSocket.OPEN = 1;
    FakeSocket.CLOSING = 2;
    FakeSocket.CLOSED = 3;
    window.WebSocket = FakeSocket;
  });
  await page.goto(`http://127.0.0.1:${port}/index.html?lang=${lang}&chatpcbTest=1`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.chatpcbI18n.ready);
  return { page, pageErrors };
}

async function showReady(page, timeoutMs = 30000) {
  await page.evaluate(({ preview, timeoutMs: nextTimeout }) => {
    window.__chatpcbApproveTimeoutMs = nextTimeout;
    window.__sent.length = 0;
    window.__chatpcbTest.showPatch(preview);
  }, { preview: passedPreview, timeoutMs });
  await page.waitForFunction(() => document.querySelector('#approve-patch-button')?.disabled === false);
}

async function clickApply(page) {
  const before = await page.evaluate(() => window.__sent.length);
  await page.evaluate(() => document.querySelector('#approve-patch-button').click());
  await page.waitForFunction((start) => window.__sent.length > start, before);
}

function requestText(page) {
  return page.locator('#request-status').innerText();
}

async function approveCalls(page) {
  return page.evaluate(() => window.__sent.map((raw) => JSON.parse(raw).payload).filter((call) => (
    call.name === 'schematic.patch' && call.args?.approved === true
  )));
}

async function waitForCall(page, name) {
  await page.waitForFunction((tool) => window.__sent.some((raw) => {
    const call = JSON.parse(raw).payload;
    return call.name === tool;
  }), name, { timeout: 3000 });
  return page.evaluate((tool) => {
    const raw = window.__sent.find((entry) => JSON.parse(entry).payload.name === tool);
    return JSON.parse(raw).payload;
  }, name);
}

async function emitResult(page, id, result, ok = true) {
  await page.evaluate(({ id: callId, result: body, ok: succeeded }) => {
    const socket = window.__sockets.at(-1);
    socket.readyState = 1;
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({
        version: 1,
        id: `evt_${callId}`,
        type: 'tool.result',
        createdAt: new Date().toISOString(),
        payload: { id: callId, ok: succeeded, result: body }
      })
    }));
  }, { id, result, ok });
}

function appliedTransaction(patchId = 'patch_test') {
  return { transactions: [{ proposal: { proposalId: patchId }, status: 'applied' }] };
}

function failedTransaction(status, patchId = 'patch_test') {
  return { transactions: [{ proposal: { proposalId: patchId }, status }] };
}

async function installHost(page) {
  await page.evaluate(() => {
    window.__hostMessages = [];
    window.chatpcbHost = {
      postMessage(message) {
        window.__hostMessages.push(JSON.parse(JSON.stringify(message)));
      }
    };
  });
}

async function completionSnapshot(page) {
  return page.evaluate(() => {
    const status = document.querySelector('#request-status');
    return {
      text: status?.textContent ?? '',
      state: status?.dataset.state ?? '',
      reloads: (window.__hostMessages ?? []).filter((message) => message?.type === 'project.reload'),
      validation: document.querySelector('#validation-status')?.dataset.state ?? '',
      kicadHidden: document.querySelector('#kicad-link-card')?.hidden === true,
      draft: document.querySelector('[data-step="circuit.draft"]')?.dataset.state ?? '',
      review: document.querySelector('[data-step="circuit.review"]')?.dataset.state ?? ''
    };
  });
}

async function approveCallCount(page) {
  return approveCalls(page).then((calls) => calls.length);
}

test('approve reconcile settles a lost reply, a closed socket, and a late reply', async (t) => {
  const browser = await launchPanelBrowser(t);
  if (!browser) return;
  const { en, ko } = await loadLocales();
  assert.equal(en['patch.apply.checking'], 'Checking whether it was applied…');
  assert.equal(ko['patch.apply.checking'], '적용됐는지 확인하고 있어요.');
  assert.equal(en['patch.apply.unconfirmed'], "Couldn't confirm whether it was applied. Check it in KiCad.");
  assert.equal(ko['patch.apply.unconfirmed'], '적용 여부를 확인하지 못했어요. KiCad에서 확인해 주세요.');
  const server = await startServer();
  const port = server.address().port;

  try {
    const lost = await openPanel(browser, port);
    try {
      await showReady(lost.page, 40);
      await clickApply(lost.page);
      assert.equal(await lost.page.locator('#approve-patch-button').isDisabled(), true);
      const first = (await approveCalls(lost.page)).length;
      await lost.page.locator('#approve-patch-button').dispatchEvent('click');
      assert.equal((await approveCalls(lost.page)).length, first);
      const statusCall = await waitForCall(lost.page, 'project.transaction.status');
      assert.equal(await requestText(lost.page), en['patch.apply.checking']);
      assert.notEqual(await requestText(lost.page), en['patch.apply.summary']);
      await emitResult(lost.page, statusCall.id, appliedTransaction());
      await lost.page.waitForFunction((text) => (
        document.querySelector('#request-status')?.dataset.state === 'completed'
        && document.querySelector('#request-status')?.textContent === text
      ), en['patch.apply.applied'], { timeout: 3000 });
      await lost.page.evaluate((preview) => window.__chatpcbTest.showPatch(preview), passedPreview);
      const afterRearm = (await approveCalls(lost.page)).length;
      await lost.page.locator('#approve-patch-button').dispatchEvent('click');
      assert.equal(await lost.page.locator('#approve-patch-button').isDisabled(), true);
      assert.equal((await approveCalls(lost.page)).length, afterRearm);
      assert.deepEqual(lost.pageErrors, []);
    } finally {
      await lost.page.close();
    }

    const absent = await openPanel(browser, port);
    try {
      await showReady(absent.page, 40);
      await clickApply(absent.page);
      const statusCall = await waitForCall(absent.page, 'project.transaction.status');
      await emitResult(absent.page, statusCall.id, { transactions: [] });
      const inspectCall = await waitForCall(absent.page, 'project.inspect');
      assert.equal(inspectCall.args.expectedDigest, 'digest-before');
      await emitResult(absent.page, inspectCall.id, {
        manifest: { freshness: { status: 'current' } },
        inspection: { projectDigest: 'digest-before' },
        evidenceDigest: { projectDigest: 'digest-before', matches: true }
      });
      await absent.page.waitForFunction((text) => (
        document.querySelector('#request-status')?.dataset.state === 'failed'
        && document.querySelector('#request-status')?.textContent === text
      ), en['patch.apply.unconfirmed'], { timeout: 3000 });
      const failed = await requestText(absent.page);
      assert.equal(failed, en['patch.apply.unconfirmed'], failed);
      assert.equal(failed.includes(en['patch.apply.failed.unknown']), false, failed);
      assert.equal(failed.includes(en['patch.apply.failed.recheck']), false, failed);
      assert.equal(failed.includes(en['patch.apply.summary']), false, failed);
      assert.equal(failed.includes(en['patch.apply.applied']), false, failed);
      await absent.page.evaluate((preview) => window.__chatpcbTest.showPatch(preview), passedPreview);
      const sent = (await approveCalls(absent.page)).length;
      await absent.page.locator('#approve-patch-button').dispatchEvent('click');
      assert.equal((await approveCalls(absent.page)).length, sent);
      assert.deepEqual(absent.pageErrors, []);
    } finally {
      await absent.page.close();
    }

    const unknown = await openPanel(browser, port, 'ko');
    try {
      await showReady(unknown.page, 40);
      await clickApply(unknown.page);
      const statusCall = await waitForCall(unknown.page, 'project.transaction.status');
      await emitResult(unknown.page, statusCall.id, { transactions: [{ proposal: { proposalId: 'patch_test' }, status: 'needs-inspection' }] });
      await unknown.page.waitForFunction((text) => document.querySelector('#request-status')?.textContent === text, ko['patch.apply.unconfirmed'], { timeout: 3000 });
      assert.equal(await unknown.page.locator('#request-status').getAttribute('data-state'), 'failed');
      const text = await requestText(unknown.page);
      assert.equal(text.includes(ko['patch.apply.failed.recheck']), false, text);
      assert.equal(text.includes(ko['patch.apply.applied']), false, text);
      await unknown.page.evaluate((preview) => window.__chatpcbTest.showPatch(preview), passedPreview);
      const sent = (await approveCalls(unknown.page)).length;
      await unknown.page.locator('#approve-patch-button').dispatchEvent('click');
      assert.equal((await approveCalls(unknown.page)).length, sent);
      assert.deepEqual(unknown.pageErrors, []);
    } finally {
      await unknown.page.close();
    }

    const closed = await openPanel(browser, port);
    try {
      await showReady(closed.page, 10000);
      await clickApply(closed.page);
      await closed.page.evaluate(() => window.__sockets.at(-1).close());
      await closed.page.waitForFunction((text) => document.querySelector('#request-status')?.textContent === text, en['patch.apply.checking'], { timeout: 3000 });
      const statusCall = await waitForCall(closed.page, 'project.transaction.status');
      await emitResult(closed.page, statusCall.id, { transactions: [] });
      const inspectCall = await waitForCall(closed.page, 'project.inspect');
      await emitResult(closed.page, inspectCall.id, {
        manifest: { freshness: { status: 'current' } },
        inspection: { projectDigest: 'digest-after' },
        evidenceDigest: { projectDigest: 'digest-after', matches: false }
      });
      await closed.page.waitForFunction((text) => (
        document.querySelector('#request-status')?.dataset.state === 'completed'
        && document.querySelector('#request-status')?.textContent === text
      ), en['patch.apply.applied'], { timeout: 3000 });
      assert.deepEqual(closed.pageErrors, []);
    } finally {
      await closed.page.close();
    }

    const early = await openPanel(browser, port);
    try {
      await showReady(early.page, 5000);
      await clickApply(early.page);
      const approve = (await approveCalls(early.page)).at(-1);
      await emitResult(early.page, approve.id, { applied: true, operation: 'patched', validation: { ok: true } });
      await early.page.waitForFunction((text) => document.querySelector('#request-status')?.textContent === text, en['patch.apply.applied'], { timeout: 3000 });
      assert.equal(await requestText(early.page) === en['patch.apply.checking'], false);
      await early.page.waitForTimeout(80);
      assert.equal(await requestText(early.page), en['patch.apply.applied']);
      assert.deepEqual(early.pageErrors, []);
    } finally {
      await early.page.close();
    }

    const late = await openPanel(browser, port);
    try {
      await showReady(late.page, 40);
      await clickApply(late.page);
      const approve = (await approveCalls(late.page)).at(-1);
      const statusCall = await waitForCall(late.page, 'project.transaction.status');
      await emitResult(late.page, approve.id, { applied: false, reason: { code: 'PATCH_STALE' }, validation: { ok: true } });
      assert.equal(await requestText(late.page), en['patch.apply.checking']);
      await emitResult(late.page, statusCall.id, appliedTransaction());
      await late.page.waitForFunction((text) => document.querySelector('#request-status')?.textContent === text, en['patch.apply.applied'], { timeout: 3000 });
      await late.page.waitForTimeout(50);
      const text = await requestText(late.page);
      assert.equal(text, en['patch.apply.applied']);
      assert.equal(text.includes(en['patch.apply.failed.PATCH_STALE']), false, text);
      assert.equal(await late.page.locator('#request-status').getAttribute('data-state'), 'completed');
      assert.deepEqual(late.pageErrors, []);
    } finally {
      await late.page.close();
    }
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    await browser.close();
  }
});

test('reconcile applied reloads once, a missing record stays unconfirmed, and reconcile times out', async (t) => {
  const browser = await launchPanelBrowser(t);
  if (!browser) return;
  const { en } = await loadLocales();
  const server = await startServer();
  const port = server.address().port;
  const appliedBody = { applied: true, operation: 'patched', validation: { ok: true }, patchId: 'patch_test' };

  try {
    const direct = await openPanel(browser, port);
    let directShot;
    try {
      await showReady(direct.page, 5000);
      await installHost(direct.page);
      await clickApply(direct.page);
      const approve = (await approveCalls(direct.page)).at(-1);
      await emitResult(direct.page, approve.id, appliedBody);
      await direct.page.waitForFunction((text) => (
        document.querySelector('#request-status')?.dataset.state === 'completed'
        && document.querySelector('#request-status')?.textContent === text
      ), en['patch.apply.applied'], { timeout: 3000 });
      directShot = await completionSnapshot(direct.page);
      assert.equal(directShot.text, en['patch.apply.applied']);
      assert.equal(directShot.state, 'completed');
      assert.equal(directShot.reloads.length, 1, 'direct applied:true posts project.reload once');
      assert.deepEqual(directShot.reloads, [{ type: 'project.reload', projectPath: '/tmp/demo-board' }]);
      assert.deepEqual(direct.pageErrors, []);
    } finally {
      await direct.page.close();
    }

    const reconciled = await openPanel(browser, port);
    try {
      await showReady(reconciled.page, 40);
      await installHost(reconciled.page);
      await clickApply(reconciled.page);
      const statusCall = await waitForCall(reconciled.page, 'project.transaction.status');
      await emitResult(reconciled.page, statusCall.id, appliedTransaction());
      await reconciled.page.waitForFunction((text) => (
        document.querySelector('#request-status')?.dataset.state === 'completed'
        && document.querySelector('#request-status')?.textContent === text
      ), en['patch.apply.applied'], { timeout: 3000 });
      const shot = await completionSnapshot(reconciled.page);
      assert.equal(shot.reloads.length, 1, 'reconcile applied posts project.reload once');
      assert.deepEqual(shot, directShot);
      await emitResult(reconciled.page, statusCall.id, appliedTransaction());
      const approve = (await approveCalls(reconciled.page)).at(-1);
      await emitResult(reconciled.page, approve.id, {
        applied: false,
        patchId: 'patch_test',
        reason: { code: 'PATCH_STALE' },
        validation: { ok: true }
      });
      await reconciled.page.waitForTimeout(50);
      const again = await completionSnapshot(reconciled.page);
      assert.deepEqual(again, shot);
      assert.equal(again.text.includes(en['patch.apply.failed.PATCH_STALE']), false, again.text);
      const sent = await approveCallCount(reconciled.page);
      await reconciled.page.evaluate((preview) => window.__chatpcbTest.showPatch(preview), passedPreview);
      await reconciled.page.locator('#approve-patch-button').dispatchEvent('click');
      assert.equal(await approveCallCount(reconciled.page), sent);
      assert.deepEqual(reconciled.pageErrors, []);
    } finally {
      await reconciled.page.close();
    }

    const missing = await openPanel(browser, port);
    try {
      await showReady(missing.page, 40);
      await installHost(missing.page);
      await clickApply(missing.page);
      const approve = (await approveCalls(missing.page)).at(-1);
      const statusCall = await waitForCall(missing.page, 'project.transaction.status');
      await emitResult(missing.page, statusCall.id, { transactions: [] });
      const inspectCall = await waitForCall(missing.page, 'project.inspect');
      assert.equal(inspectCall.args.expectedDigest, 'digest-before');
      await emitResult(missing.page, inspectCall.id, {
        manifest: { freshness: { status: 'current' } },
        inspection: { projectDigest: 'digest-before' },
        evidenceDigest: { projectDigest: 'digest-before', matches: true }
      });
      await missing.page.waitForFunction((text) => document.querySelector('#request-status')?.textContent === text, en['patch.apply.unconfirmed'], { timeout: 3000 });
      const unconfirmed = await requestText(missing.page);
      assert.equal(await missing.page.locator('#request-status').getAttribute('data-state'), 'failed');
      assert.equal(unconfirmed, en['patch.apply.unconfirmed'], unconfirmed);
      assert.equal(unconfirmed.includes('KiCad'), true, unconfirmed);
      assert.equal(unconfirmed.includes(en['patch.apply.failed.unknown']), false, unconfirmed);
      assert.equal(unconfirmed.includes(en['patch.apply.failed.recheck']), false, unconfirmed);
      assert.deepEqual(await completionSnapshot(missing.page).then((shot) => shot.reloads), []);
      await emitResult(missing.page, approve.id, { ...appliedBody, patchId: 'patch_other' });
      await missing.page.waitForTimeout(40);
      assert.equal(await requestText(missing.page), en['patch.apply.unconfirmed']);
      assert.deepEqual((await completionSnapshot(missing.page)).reloads, []);
      await emitResult(missing.page, approve.id, appliedBody);
      await missing.page.waitForFunction((text) => (
        document.querySelector('#request-status')?.dataset.state === 'completed'
        && document.querySelector('#request-status')?.textContent === text
      ), en['patch.apply.applied'], { timeout: 3000 });
      const corrected = await completionSnapshot(missing.page);
      assert.deepEqual(corrected.reloads, [{ type: 'project.reload', projectPath: '/tmp/demo-board' }]);
      assert.equal(corrected.text, directShot.text);
      assert.equal(corrected.state, directShot.state);
      await emitResult(missing.page, approve.id, appliedBody);
      await missing.page.waitForTimeout(40);
      assert.deepEqual((await completionSnapshot(missing.page)).reloads, corrected.reloads);
      const sent = await approveCallCount(missing.page);
      await missing.page.evaluate((preview) => window.__chatpcbTest.showPatch(preview), passedPreview);
      await missing.page.locator('#approve-patch-button').dispatchEvent('click');
      assert.equal(await missing.page.locator('#approve-patch-button').isDisabled(), true);
      assert.equal(await approveCallCount(missing.page), sent);
      assert.deepEqual(missing.pageErrors, []);
    } finally {
      await missing.page.close();
    }

    const rolledBack = await openPanel(browser, port);
    try {
      await showReady(rolledBack.page, 40);
      await installHost(rolledBack.page);
      await clickApply(rolledBack.page);
      const approve = (await approveCalls(rolledBack.page)).at(-1);
      const statusCall = await waitForCall(rolledBack.page, 'project.transaction.status');
      await emitResult(rolledBack.page, statusCall.id, failedTransaction('rolled-back'));
      await rolledBack.page.waitForFunction((needle) => (
        document.querySelector('#request-status')?.dataset.state === 'failed'
        && document.querySelector('#request-status')?.textContent?.includes(needle)
      ), en['patch.apply.failed.recheck'], { timeout: 3000 });
      const failed = await requestText(rolledBack.page);
      assert.equal(failed.includes(en['patch.apply.failed.unknown']), true, failed);
      assert.equal(failed.includes(en['patch.apply.unconfirmed']), false, failed);
      assert.deepEqual((await completionSnapshot(rolledBack.page)).reloads, []);
      await emitResult(rolledBack.page, statusCall.id, appliedTransaction());
      await rolledBack.page.waitForTimeout(40);
      assert.equal(await requestText(rolledBack.page), failed);
      await emitResult(rolledBack.page, approve.id, appliedBody);
      await rolledBack.page.waitForFunction((text) => (
        document.querySelector('#request-status')?.dataset.state === 'completed'
        && document.querySelector('#request-status')?.textContent === text
      ), en['patch.apply.applied'], { timeout: 3000 });
      assert.deepEqual((await completionSnapshot(rolledBack.page)).reloads, [{ type: 'project.reload', projectPath: '/tmp/demo-board' }]);
      const sent = await approveCallCount(rolledBack.page);
      await rolledBack.page.evaluate((preview) => window.__chatpcbTest.showPatch(preview), passedPreview);
      await rolledBack.page.locator('#approve-patch-button').dispatchEvent('click');
      assert.equal(await approveCallCount(rolledBack.page), sent);
      assert.deepEqual(rolledBack.pageErrors, []);
    } finally {
      await rolledBack.page.close();
    }

    const silentStatus = await openPanel(browser, port);
    try {
      await showReady(silentStatus.page, 30);
      await silentStatus.page.evaluate(() => { window.__chatpcbReconcileTimeoutMs = 200; });
      await installHost(silentStatus.page);
      await clickApply(silentStatus.page);
      await waitForCall(silentStatus.page, 'project.transaction.status');
      assert.equal(await requestText(silentStatus.page), en['patch.apply.checking']);
      await silentStatus.page.waitForFunction((text) => document.querySelector('#request-status')?.textContent === text, en['patch.apply.unconfirmed'], { timeout: 3000 });
      assert.equal(await silentStatus.page.locator('#request-status').getAttribute('data-state'), 'failed');
      assert.equal((await requestText(silentStatus.page)).includes('KiCad'), true);
      assert.deepEqual((await completionSnapshot(silentStatus.page)).reloads, []);
      const approve = (await approveCalls(silentStatus.page)).at(-1);
      await emitResult(silentStatus.page, approve.id, appliedBody);
      await silentStatus.page.waitForFunction((text) => (
        document.querySelector('#request-status')?.dataset.state === 'completed'
        && document.querySelector('#request-status')?.textContent === text
      ), en['patch.apply.applied'], { timeout: 3000 });
      assert.deepEqual((await completionSnapshot(silentStatus.page)).reloads, [{ type: 'project.reload', projectPath: '/tmp/demo-board' }]);
      const sent = await approveCallCount(silentStatus.page);
      await silentStatus.page.evaluate((preview) => window.__chatpcbTest.showPatch(preview), passedPreview);
      await silentStatus.page.locator('#approve-patch-button').dispatchEvent('click');
      assert.equal(await approveCallCount(silentStatus.page), sent);
      assert.deepEqual(silentStatus.pageErrors, []);
    } finally {
      await silentStatus.page.close();
    }

    const silentInspect = await openPanel(browser, port);
    try {
      await showReady(silentInspect.page, 30);
      await silentInspect.page.evaluate(() => { window.__chatpcbReconcileTimeoutMs = 350; });
      await installHost(silentInspect.page);
      await clickApply(silentInspect.page);
      const statusCall = await waitForCall(silentInspect.page, 'project.transaction.status');
      await emitResult(silentInspect.page, statusCall.id, { transactions: [] });
      const inspectCall = await waitForCall(silentInspect.page, 'project.inspect');
      assert.equal(await requestText(silentInspect.page), en['patch.apply.checking']);
      await silentInspect.page.waitForFunction((text) => document.querySelector('#request-status')?.textContent === text, en['patch.apply.unconfirmed'], { timeout: 3000 });
      await emitResult(silentInspect.page, inspectCall.id, {
        manifest: { freshness: { status: 'current' } },
        inspection: { projectDigest: 'digest-before' },
        evidenceDigest: { projectDigest: 'digest-before', matches: true }
      });
      await silentInspect.page.waitForTimeout(40);
      const text = await requestText(silentInspect.page);
      assert.equal(text, en['patch.apply.unconfirmed'], text);
      assert.equal(text.includes(en['patch.apply.failed.unknown']), false, text);
      assert.deepEqual((await completionSnapshot(silentInspect.page)).reloads, []);
      assert.deepEqual(silentInspect.pageErrors, []);
    } finally {
      await silentInspect.page.close();
    }
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    await browser.close();
  }
});

function countPhrase(count, one, other) {
  return count === 1 ? one : other.replaceAll('{count}', String(count));
}

test('ERC count copy is singular for 1 and plural for 0 and 2', async (t) => {
  const browser = await launchPanelBrowser(t);
  if (!browser) return;
  const { en } = await loadLocales();
  const server = await startServer();
  const port = server.address().port;
  const { page, pageErrors } = await openPanel(browser, port);

  try {
    const table = await page.evaluate(async () => {
      const counts = [0, 1, 2];
      const rows = {};
      for (const lang of ['en', 'ko']) {
        await window.chatpcbI18n.setLang(lang);
        rows[lang] = {
          errors: counts.map((count) => window.chatpcbI18n.t('erc.errors', { count })),
          blocked: counts.map((count) => window.chatpcbI18n.t('patch.apply.blocked-erc', { count })),
          current: counts.map((count) => window.chatpcbI18n.t('erc.current-file', { count })),
          validation: counts.flatMap((errors) => counts.map((warnings) => ({
            errors,
            warnings,
            text: window.chatpcbI18n.t('validation.counts', { errors, warnings })
          })))
        };
      }
      return rows;
    });

    for (const count of [0, 1, 2]) {
      assert.equal(table.en.errors[count], countPhrase(count, '1 error', '{count} errors'));
      assert.equal(table.en.blocked[count], countPhrase(count, 'Fix the 1 ERC error before applying.', 'Fix the {count} ERC errors before applying.'));
      assert.equal(
        table.en.current[count],
        countPhrase(count, 'The open schematic still has 1 ERC error. This patch passed ERC and can be applied.', 'The open schematic still has {count} ERC errors. This patch passed ERC and can be applied.')
      );
      assert.equal(table.ko.errors[count], `오류 ${count}개`);
      assert.equal(table.ko.blocked[count], `적용하려면 ERC 오류 ${count}개를 먼저 고쳐 주세요.`);
      assert.equal(table.ko.current[count], `현재 회로도에는 ERC 오류가 ${count}개 있어요. 이 패치는 ERC를 통과해서 적용할 수 있어요.`);
    }
    for (const errors of [0, 1, 2]) {
      for (const warnings of [0, 1, 2]) {
        const row = table.en.validation.find((item) => item.errors === errors && item.warnings === warnings);
        const errorWord = errors === 1 ? '1 error' : `${errors} errors`;
        const warningWord = warnings === 1 ? '1 warning' : `${warnings} warnings`;
        assert.equal(row.text, `${errorWord}, ${warningWord}`);
        const korean = table.ko.validation.find((item) => item.errors === errors && item.warnings === warnings);
        assert.equal(korean.text, `오류 ${errors}개, 경고 ${warnings}개`);
      }
    }

    await page.evaluate(() => window.chatpcbI18n.setLang('en'));
    const rendered = await page.evaluate(() => {
      window.__chatpcbTest.showPatch({
        validation: {
          ok: false,
          skipped: false,
          erc: { ok: false, errorCount: 1, violations: [{ message: 'Pin 1 is open' }] }
        },
        inspection: {
          manifest: { freshness: { status: 'current', reason: 'Evidence matches.' } },
          validation: { erc: { ok: false, errorCount: 1, violations: [{ message: 'Pin 1 is open' }] } }
        }
      });
      return {
        why: document.querySelector('#apply-why')?.textContent ?? '',
        erc: document.querySelector('#patch-erc')?.textContent ?? ''
      };
    });
    assert.equal(rendered.why, en['patch.apply.blocked-erc'].includes('{count}')
      ? 'Fix the 1 ERC error before applying.'
      : rendered.why);
    assert.equal(rendered.why, 'Fix the 1 ERC error before applying.');
    assert.equal(rendered.erc.includes('1 error'), true, rendered.erc);
    assert.equal(rendered.erc.includes('1 errors'), false, rendered.erc);

    const warningCard = await page.evaluate(() => {
      window.__chatpcbTest.showPatch({
        validation: {
          ok: false,
          errorCount: 0,
          warningCount: 1,
          erc: {
            ok: false,
            errorCount: 0,
            warningCount: 1,
            violations: [{ severity: 'warning', description: 'Isolated pin label' }]
          }
        },
        inspection: {
          manifest: { freshness: { status: 'current', reason: 'Evidence matches.' } },
          validation: {}
        }
      });
      const sentence = 'ERC found 1 item to review.';
      const card = document.querySelector('#patch-approval-card')?.innerText ?? '';
      return { count: card.split(sentence).length - 1, card };
    });
    assert.equal(warningCard.count, 1, warningCard.card);
    assert.deepEqual(pageErrors, []);
  } finally {
    await page.close();
    await new Promise((resolveClose) => server.close(resolveClose));
    await browser.close();
  }
});
