/* global document, window, MouseEvent, KeyboardEvent, FocusEvent, HTMLElement */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import test from 'node:test';
import * as espree from 'espree';

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

// Same durations as apps/panel/panel.js. The page clock is paused, so they
// fire only when a test advances time.
const APPROVE_TIMEOUT_MS = 30000;
const RECONCILE_TIMEOUT_MS = 30000;
const RECONNECT_DELAY_MS = 1500;
const CLOCK_EPOCH = Date.parse('2026-01-15T12:00:00.000Z');

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

const skippedPreview = {
  ...passedPreview,
  validation: { ok: true, skipped: true, executed: false },
  candidateVerification: { erc: { ok: true, skipped: true, executed: false } }
};

const removedPart = { ref: 'J2', value: 'Conn_01x04', libId: 'Connector:Conn_01x04' };

const PREVIEW_EXPIRED = {
  en: 'Connection was reset, so this preview expired. Create it again.',
  ko: '연결이 다시 설정돼 미리보기가 만료됐어요. 다시 만들어 주세요.'
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
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.clock.install({ time: CLOCK_EPOCH });
  await page.addInitScript(() => {
    window.__CHATPCB_TEST_MODE__ = true;
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
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1000);
  let closed = false;
  page.on('close', () => {
    if (closed) return;
    closed = true;
    context.close().catch(() => {});
  });
  return { page, pageErrors };
}

function advance(page, ms) {
  return page.clock.runFor(ms);
}

async function showReady(page, preview = passedPreview) {
  await page.evaluate((nextPreview) => {
    window.__sent.length = 0;
    window.__chatpcbTest.showPatch(nextPreview);
  }, preview);
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
  await emitPayload(page, id, { ok, result });
}

async function emitPayload(page, id, payload) {
  await page.evaluate(({ id: callId, payload: body }) => {
    const socket = window.__sockets.at(-1);
    socket.readyState = 1;
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({
        version: 1,
        id: `evt_${callId}`,
        type: 'tool.result',
        createdAt: new Date().toISOString(),
        payload: { id: callId, ...body }
      })
    }));
  }, { id, payload });
}

async function blurToBody(page) {
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active && active !== document.body && typeof active.blur === 'function') active.blur();
  });
}

async function sendProjectRequest(page, prompt) {
  const before = await page.evaluate(() => window.__sent.length);
  await page.locator('#prompt').fill(prompt);
  await page.locator('#composer button[type="submit"]').click();
  await page.waitForFunction((start) => window.__sent.some((raw, index) => (
    index >= start && JSON.parse(raw).payload?.name === 'project.request'
  )), before, { timeout: 3000 });
  return page.evaluate((start) => {
    const raw = window.__sent.find((entry, index) => (
      index >= start && JSON.parse(entry).payload?.name === 'project.request'
    ));
    return JSON.parse(raw).payload;
  }, before);
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

function activeElementId(page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (!active || active === document.body || active === document.documentElement) return 'BODY';
    return active.id || active.tagName;
  });
}

function dialogFocus(page, dialogId) {
  return page.evaluate((id) => {
    const dialog = document.querySelector(id);
    const active = document.activeElement;
    return {
      open: Boolean(dialog && dialog.hidden === false),
      inside: Boolean(dialog && active && dialog.contains(active)),
      activeId: active?.id || active?.tagName || ''
    };
  }, dialogId);
}

async function sentCalls(page, name) {
  return page.evaluate((tool) => window.__sent
    .map((raw) => JSON.parse(raw).payload)
    .filter((call) => call.name === tool), name);
}

async function waitForNthCall(page, name, index) {
  await page.waitForFunction(({ tool, index: needed }) => (
    window.__sent.map((raw) => JSON.parse(raw).payload).filter((call) => call.name === tool).length > needed
  ), { tool: name, index }, { timeout: 3000 });
  const calls = await sentCalls(page, name);
  return calls[index];
}

async function signInChatGPT(page) {
  const before = (await sentCalls(page, 'auth.chatgpt.status')).length;
  await page.selectOption('#provider', 'chatgpt');
  const authCall = await waitForNthCall(page, 'auth.chatgpt.status', before);
  await emitResult(page, authCall.id, {
    state: 'signed_in',
    account: { email: 'ada@example.com' },
    plan: 'plus'
  });
  await page.waitForSelector('#chatgpt-auth-title');
  // The signed-in card focuses its title after 100ms. Flush that before the dialog opens.
  await advance(page, 250);
}

async function installHeadingFocusSpy(page) {
  await page.evaluate(() => {
    const heading = document.querySelector('#request-result-heading');
    const focus = heading.focus.bind(heading);
    window.__resultHeadingFocusCalls = 0;
    heading.focus = (...args) => {
      window.__resultHeadingFocusCalls += 1;
      return focus(...args);
    };
  });
}

function headingFocusCalls(page) {
  return page.evaluate(() => window.__resultHeadingFocusCalls);
}

function removalResult(expiresAt) {
  return {
    ...passedPreview,
    patchId: 'patch_remove',
    requiresApproval: true,
    approved: false,
    applied: false,
    operation: 'generated',
    expiresAt,
    files: { project: 'fixtures/demo-board/board.kicad_pro' },
    removedComponents: [removedPart],
    reason: { code: 'EXISTING_COMPONENTS_REMOVED', removedComponents: [removedPart] },
    conversation: { messages: [] }
  };
}

async function showRemovalLead(page, lead) {
  await showReady(page);
  const call = await sendProjectRequest(page, 'Remove the I2C connector J2');
  const expiresAt = await page.evaluate(() => Date.now() + 600000);
  await emitResult(page, call.id, removalResult(expiresAt));
  const inspectCall = await waitForCall(page, 'project.inspect');
  await emitResult(page, inspectCall.id, {
    manifest: { freshness: { status: 'current', reason: 'Evidence matches.' } },
    validation: {},
    inspection: { projectDigest: 'digest-before' }
  });
  await page.waitForFunction((text) => {
    const dialog = document.querySelector('#apply-remove-components-confirm');
    return dialog && dialog.hidden === false && dialog.contains(document.activeElement)
      && document.querySelector('#request-status')?.textContent === text;
  }, lead, { timeout: 3000 });
}

async function showWithoutErcDialog(page) {
  await showReady(page, skippedPreview);
  await page.locator('#approve-patch-without-erc').click();
  await page.waitForFunction(() => {
    const dialog = document.querySelector('#apply-without-erc-confirm');
    return dialog && dialog.hidden === false && dialog.contains(document.activeElement);
  }, null, { timeout: 3000 });
}

async function showRemovalDialog(page) {
  await showReady(page, { ...passedPreview, removedComponents: [removedPart] });
  await page.waitForFunction(() => {
    const dialog = document.querySelector('#apply-remove-components-confirm');
    return dialog && dialog.hidden === false && dialog.contains(document.activeElement);
  }, null, { timeout: 3000 });
}

function clickWithoutFocus(page, selector) {
  return page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (!element) throw new Error(`missing ${sel}`);
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }, selector);
}

async function reconnectAndRefreshAuth(page) {
  const authBefore = (await sentCalls(page, 'auth.chatgpt.status')).length;
  const providerBefore = (await sentCalls(page, 'provider.status')).length;
  await page.evaluate(() => window.__sockets.at(-1).close());
  await advance(page, RECONNECT_DELAY_MS);
  const authCall = await waitForNthCall(page, 'auth.chatgpt.status', authBefore);
  const providerCall = await waitForNthCall(page, 'provider.status', providerBefore);
  const signedIn = { state: 'signed_in', account: { email: 'ada@example.com' }, plan: 'plus' };
  await emitResult(page, authCall.id, signedIn);
  await emitResult(page, providerCall.id, { provider: 'chatgpt', status: 'signed-in', account: signedIn.account, plan: 'plus' });
  await advance(page, 250);
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
      await showReady(lost.page);
      await clickApply(lost.page);
      assert.equal(await lost.page.locator('#approve-patch-button').isDisabled(), true);
      const first = (await approveCalls(lost.page)).length;
      await lost.page.locator('#approve-patch-button').dispatchEvent('click');
      assert.equal((await approveCalls(lost.page)).length, first);
      await advance(lost.page, APPROVE_TIMEOUT_MS);
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
      await showReady(absent.page);
      await clickApply(absent.page);
      await advance(absent.page, APPROVE_TIMEOUT_MS);
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
      await showReady(unknown.page);
      await clickApply(unknown.page);
      await advance(unknown.page, APPROVE_TIMEOUT_MS);
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
      await showReady(closed.page);
      await clickApply(closed.page);
      await closed.page.evaluate(() => window.__sockets.at(-1).close());
      await closed.page.waitForFunction((text) => document.querySelector('#request-status')?.textContent === text, en['patch.apply.checking'], { timeout: 3000 });
      await advance(closed.page, RECONNECT_DELAY_MS);
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
      await showReady(early.page);
      await clickApply(early.page);
      const approve = (await approveCalls(early.page)).at(-1);
      await emitResult(early.page, approve.id, { applied: true, operation: 'patched', validation: { ok: true } });
      await early.page.waitForFunction((text) => document.querySelector('#request-status')?.textContent === text, en['patch.apply.applied'], { timeout: 3000 });
      assert.equal(await requestText(early.page) === en['patch.apply.checking'], false);
      await advance(early.page, 80);
      assert.equal(await requestText(early.page), en['patch.apply.applied']);
      assert.deepEqual(early.pageErrors, []);
    } finally {
      await early.page.close();
    }

    const late = await openPanel(browser, port);
    try {
      await showReady(late.page);
      await clickApply(late.page);
      const approve = (await approveCalls(late.page)).at(-1);
      await advance(late.page, APPROVE_TIMEOUT_MS);
      const statusCall = await waitForCall(late.page, 'project.transaction.status');
      await emitResult(late.page, approve.id, { applied: false, reason: { code: 'PATCH_STALE' }, validation: { ok: true } });
      assert.equal(await requestText(late.page), en['patch.apply.checking']);
      await emitResult(late.page, statusCall.id, appliedTransaction());
      await late.page.waitForFunction((text) => document.querySelector('#request-status')?.textContent === text, en['patch.apply.applied'], { timeout: 3000 });
      await advance(late.page, 50);
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
      await showReady(direct.page);
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
      assert.deepEqual(directShot.reloads, [{ type: 'project.reload', projectPath: 'fixtures/demo-board' }]);
      assert.deepEqual(direct.pageErrors, []);
    } finally {
      await direct.page.close();
    }

    const reconciled = await openPanel(browser, port);
    try {
      await showReady(reconciled.page);
      await installHost(reconciled.page);
      await clickApply(reconciled.page);
      await advance(reconciled.page, APPROVE_TIMEOUT_MS);
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
      await advance(reconciled.page, 50);
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
      await showReady(missing.page);
      await installHost(missing.page);
      await clickApply(missing.page);
      const approve = (await approveCalls(missing.page)).at(-1);
      await advance(missing.page, APPROVE_TIMEOUT_MS);
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
      await advance(missing.page, 40);
      assert.equal(await requestText(missing.page), en['patch.apply.unconfirmed']);
      assert.deepEqual((await completionSnapshot(missing.page)).reloads, []);
      await emitResult(missing.page, approve.id, appliedBody);
      await missing.page.waitForFunction((text) => (
        document.querySelector('#request-status')?.dataset.state === 'completed'
        && document.querySelector('#request-status')?.textContent === text
      ), en['patch.apply.applied'], { timeout: 3000 });
      const corrected = await completionSnapshot(missing.page);
      assert.deepEqual(corrected.reloads, [{ type: 'project.reload', projectPath: 'fixtures/demo-board' }]);
      assert.equal(corrected.text, directShot.text);
      assert.equal(corrected.state, directShot.state);
      await emitResult(missing.page, approve.id, appliedBody);
      await advance(missing.page, 40);
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
      await showReady(rolledBack.page);
      await installHost(rolledBack.page);
      await clickApply(rolledBack.page);
      const approve = (await approveCalls(rolledBack.page)).at(-1);
      await advance(rolledBack.page, APPROVE_TIMEOUT_MS);
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
      await advance(rolledBack.page, 40);
      assert.equal(await requestText(rolledBack.page), failed);
      await emitResult(rolledBack.page, approve.id, appliedBody);
      await advance(rolledBack.page, 40);
      assert.equal(await requestText(rolledBack.page), failed);
      assert.equal(await rolledBack.page.locator('#request-status').getAttribute('data-state'), 'failed');
      assert.deepEqual((await completionSnapshot(rolledBack.page)).reloads, []);
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
      await showReady(silentStatus.page);
      await installHost(silentStatus.page);
      await clickApply(silentStatus.page);
      await advance(silentStatus.page, APPROVE_TIMEOUT_MS);
      await waitForCall(silentStatus.page, 'project.transaction.status');
      assert.equal(await requestText(silentStatus.page), en['patch.apply.checking']);
      await advance(silentStatus.page, RECONCILE_TIMEOUT_MS);
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
      assert.deepEqual((await completionSnapshot(silentStatus.page)).reloads, [{ type: 'project.reload', projectPath: 'fixtures/demo-board' }]);
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
      await showReady(silentInspect.page);
      await installHost(silentInspect.page);
      await clickApply(silentInspect.page);
      await advance(silentInspect.page, APPROVE_TIMEOUT_MS);
      const statusCall = await waitForCall(silentInspect.page, 'project.transaction.status');
      await emitResult(silentInspect.page, statusCall.id, { transactions: [] });
      const inspectCall = await waitForCall(silentInspect.page, 'project.inspect');
      assert.equal(await requestText(silentInspect.page), en['patch.apply.checking']);
      await advance(silentInspect.page, RECONCILE_TIMEOUT_MS);
      await silentInspect.page.waitForFunction((text) => document.querySelector('#request-status')?.textContent === text, en['patch.apply.unconfirmed'], { timeout: 3000 });
      await emitResult(silentInspect.page, inspectCall.id, {
        manifest: { freshness: { status: 'current' } },
        inspection: { projectDigest: 'digest-before' },
        evidenceDigest: { projectDigest: 'digest-before', matches: true }
      });
      await advance(silentInspect.page, 40);
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

async function settleEmptyTransactionInspect(page, body, ok) {
  await clickApply(page);
  await advance(page, APPROVE_TIMEOUT_MS);
  const statusCall = await waitForCall(page, 'project.transaction.status');
  await emitResult(page, statusCall.id, { transactions: [] });
  const inspectCall = await waitForCall(page, 'project.inspect');
  await emitResult(page, inspectCall.id, body, ok);
  return inspectCall;
}

test('inspect reconcile confirms only the after digest, in that order', async (t) => {
  const browser = await launchPanelBrowser(t);
  if (!browser) return;
  const { en } = await loadLocales();
  const server = await startServer();
  const port = server.address().port;
  const neither = {
    manifest: { freshness: { status: 'current' } },
    inspection: { projectDigest: 'digest-other' },
    evidenceDigest: { projectDigest: 'digest-other', matches: false }
  };
  const samePreview = { ...passedPreview, evidenceDigest: 'digest-same', afterDigest: 'digest-same' };

  try {
    const mismatched = await openPanel(browser, port);
    try {
      await showReady(mismatched.page);
      await installHost(mismatched.page);
      const inspectCall = await settleEmptyTransactionInspect(mismatched.page, neither, true);
      assert.equal(inspectCall.args.expectedDigest, 'digest-before');
      await mismatched.page.waitForFunction((text) => (
        document.querySelector('#request-status')?.dataset.state === 'failed'
        && document.querySelector('#request-status')?.textContent === text
      ), en['patch.apply.unconfirmed'], { timeout: 3000 });
      const text = await requestText(mismatched.page);
      assert.equal(text, en['patch.apply.unconfirmed'], text);
      assert.equal(text.includes(en['patch.apply.applied']), false, text);
      assert.equal(text.includes(en['patch.apply.failed.recheck']), false, text);
      assert.deepEqual((await completionSnapshot(mismatched.page)).reloads, []);
      assert.deepEqual(mismatched.pageErrors, []);
    } finally {
      await mismatched.page.close();
    }

    const rejected = await openPanel(browser, port);
    try {
      await showReady(rejected.page);
      await installHost(rejected.page);
      await settleEmptyTransactionInspect(rejected.page, {
        manifest: { freshness: { status: 'current' } },
        inspection: { projectDigest: 'digest-after' },
        evidenceDigest: { projectDigest: 'digest-after', matches: false }
      }, false);
      await rejected.page.waitForFunction((text) => (
        document.querySelector('#request-status')?.dataset.state === 'failed'
        && document.querySelector('#request-status')?.textContent === text
      ), en['patch.apply.unconfirmed'], { timeout: 3000 });
      const text = await requestText(rejected.page);
      assert.equal(text, en['patch.apply.unconfirmed'], text);
      assert.equal(text.includes(en['patch.apply.applied']), false, text);
      assert.deepEqual((await completionSnapshot(rejected.page)).reloads, []);
      assert.deepEqual(rejected.pageErrors, []);
    } finally {
      await rejected.page.close();
    }

    const unchanged = await openPanel(browser, port);
    try {
      await showReady(unchanged.page, samePreview);
      await installHost(unchanged.page);
      const inspectCall = await settleEmptyTransactionInspect(unchanged.page, {
        manifest: { freshness: { status: 'current' } },
        inspection: { projectDigest: 'digest-same' },
        evidenceDigest: { projectDigest: 'digest-same', matches: true }
      }, true);
      assert.equal(inspectCall.args.expectedDigest, 'digest-same');
      await unchanged.page.waitForFunction((text) => (
        document.querySelector('#request-status')?.dataset.state === 'failed'
        && document.querySelector('#request-status')?.textContent === text
      ), en['patch.apply.unconfirmed'], { timeout: 3000 });
      const text = await requestText(unchanged.page);
      assert.equal(text, en['patch.apply.unconfirmed'], text);
      assert.equal(text.includes(en['patch.apply.applied']), false, text);
      assert.equal(text.includes(en['patch.apply.failed.recheck']), false, text);
      assert.deepEqual((await completionSnapshot(unchanged.page)).reloads, []);
      assert.deepEqual(unchanged.pageErrors, []);
    } finally {
      await unchanged.page.close();
    }
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    await browser.close();
  }
});

function countPhrase(count, one, other) {
  return count === 1 ? one : other.replaceAll('{count}', String(count));
}

test('dropped approve and transaction.status replies time out to unconfirmed, and every final result focuses the heading', async (t) => {
  const browser = await launchPanelBrowser(t);
  if (!browser) return;
  const { en } = await loadLocales();
  const server = await startServer();
  const port = server.address().port;
  const appliedBody = { applied: true, operation: 'patched', validation: { ok: true }, patchId: 'patch_test' };
  const notAppliedText = `${en['patch.apply.failed.unknown']} ${en['patch.apply.failed.recheck']}`;

  try {
    const direct = await openPanel(browser, port);
    try {
      await showReady(direct.page);
      await direct.page.locator('#approve-patch-button').click();
      const approve = (await approveCalls(direct.page)).at(-1);
      await emitResult(direct.page, approve.id, appliedBody);
      await direct.page.waitForFunction((text) => (
        document.querySelector('#request-status')?.dataset.state === 'completed'
        && document.querySelector('#request-status')?.textContent === text
        && document.activeElement?.id === 'request-result-heading'
      ), en['patch.apply.applied'], { timeout: 3000 });
      assert.equal(await activeElementId(direct.page), 'request-result-heading');
      assert.deepEqual(direct.pageErrors, []);
    } finally {
      await direct.page.close();
    }

    const reconciled = await openPanel(browser, port);
    try {
      await showReady(reconciled.page);
      await clickApply(reconciled.page);
      await advance(reconciled.page, APPROVE_TIMEOUT_MS);
      const statusCall = await waitForCall(reconciled.page, 'project.transaction.status');
      assert.equal((await sentCalls(reconciled.page, 'project.inspect')).length, 0);
      await installHeadingFocusSpy(reconciled.page);
      await emitResult(reconciled.page, statusCall.id, appliedTransaction());
      await reconciled.page.waitForFunction(() => document.activeElement?.id === 'request-result-heading', null, { timeout: 3000 });
      assert.equal(await requestText(reconciled.page), en['patch.apply.applied']);
      assert.equal(await activeElementId(reconciled.page), 'request-result-heading');
      const reconcileFocusCalls = await headingFocusCalls(reconciled.page);
      assert.equal(reconcileFocusCalls, 1, `reconcile heading focus() was called ${reconcileFocusCalls} times`);
      assert.deepEqual(reconciled.pageErrors, []);
    } finally {
      await reconciled.page.close();
    }

    const notApplied = await openPanel(browser, port);
    try {
      await showReady(notApplied.page);
      await clickApply(notApplied.page);
      await advance(notApplied.page, APPROVE_TIMEOUT_MS);
      const statusCall = await waitForCall(notApplied.page, 'project.transaction.status');
      await emitResult(notApplied.page, statusCall.id, failedTransaction('rolled-back'));
      await notApplied.page.waitForFunction((text) => (
        document.querySelector('#request-status')?.dataset.state === 'failed'
        && document.querySelector('#request-status')?.textContent === text
        && document.activeElement?.id === 'request-result-heading'
      ), notAppliedText, { timeout: 3000 });
      const text = await requestText(notApplied.page);
      assert.equal(text.includes(en['patch.apply.unconfirmed']), false, text);
      assert.equal(await activeElementId(notApplied.page), 'request-result-heading');
      assert.deepEqual(notApplied.pageErrors, []);
    } finally {
      await notApplied.page.close();
    }

    const dropped = await openPanel(browser, port);
    try {
      await showReady(dropped.page);
      await clickApply(dropped.page);
      await advance(dropped.page, APPROVE_TIMEOUT_MS);
      const statusCall = await waitForCall(dropped.page, 'project.transaction.status');
      assert.equal(statusCall.name, 'project.transaction.status');
      assert.equal(await requestText(dropped.page), en['patch.apply.checking']);
      await advance(dropped.page, RECONCILE_TIMEOUT_MS);
      await dropped.page.waitForFunction((text) => (
        document.querySelector('#request-status')?.dataset.state === 'failed'
        && document.querySelector('#request-status')?.textContent === text
        && document.activeElement?.id === 'request-result-heading'
      ), en['patch.apply.unconfirmed'], { timeout: 3000 });
      const text = await requestText(dropped.page);
      assert.equal(text, en['patch.apply.unconfirmed'], text);
      assert.equal(text.includes('KiCad'), true, text);
      assert.equal(text.includes(en['patch.apply.checking']), false, text);
      assert.equal(text.includes(en['patch.apply.failed.unknown']), false, text);
      const inspects = await sentCalls(dropped.page, 'project.inspect');
      assert.equal(inspects.length, 0, 'a dropped status reply must not wait on inspect');
      assert.equal((await sentCalls(dropped.page, 'project.transaction.status')).length, 1);
      await advance(dropped.page, 120);
      assert.equal(await requestText(dropped.page), en['patch.apply.unconfirmed']);
      assert.equal(await activeElementId(dropped.page), 'request-result-heading');
      const sent = await approveCallCount(dropped.page);
      await dropped.page.evaluate((preview) => window.__chatpcbTest.showPatch(preview), passedPreview);
      await dropped.page.locator('#approve-patch-button').dispatchEvent('click');
      assert.equal(await approveCallCount(dropped.page), sent);
      assert.deepEqual(dropped.pageErrors, []);
    } finally {
      await dropped.page.close();
    }

    const reconnected = await openPanel(browser, port);
    try {
      await signInChatGPT(reconnected.page);
      await showReady(reconnected.page);
      await reconnected.page.locator('#approve-patch-button').click();
      const authBefore = (await sentCalls(reconnected.page, 'auth.chatgpt.status')).length;
      const providerBefore = (await sentCalls(reconnected.page, 'provider.status')).length;
      const statusBefore = (await sentCalls(reconnected.page, 'project.transaction.status')).length;
      await reconnected.page.evaluate(() => window.__sockets.at(-1).close());
      await reconnected.page.waitForFunction((text) => document.querySelector('#request-status')?.textContent === text, en['patch.apply.checking'], { timeout: 3000 });
      await advance(reconnected.page, RECONNECT_DELAY_MS);
      const authCall = await waitForNthCall(reconnected.page, 'auth.chatgpt.status', authBefore);
      const providerCall = await waitForNthCall(reconnected.page, 'provider.status', providerBefore);
      const signedIn = { state: 'signed_in', account: { email: 'ada@example.com' }, plan: 'plus' };
      await emitResult(reconnected.page, authCall.id, signedIn);
      await emitResult(reconnected.page, providerCall.id, { provider: 'chatgpt', status: 'signed-in', account: signedIn.account, plan: 'plus' });
      await advance(reconnected.page, 250);
      assert.equal(await requestText(reconnected.page), en['patch.apply.checking']);
      assert.notEqual(await activeElementId(reconnected.page), 'chatgpt-auth-title');
      const statusCall = await waitForNthCall(reconnected.page, 'project.transaction.status', statusBefore);
      await emitResult(reconnected.page, statusCall.id, appliedTransaction());
      await reconnected.page.waitForFunction((text) => (
        document.querySelector('#request-status')?.textContent === text
        && document.activeElement?.id === 'request-result-heading'
      ), en['patch.apply.applied'], { timeout: 3000 });
      await reconnected.page.evaluate(() => {
        window.__sockets.at(-1).dispatchEvent(new MessageEvent('message', {
          data: JSON.stringify({
            version: 1,
            id: 'auth_changed_while_result',
            type: 'auth.chatgpt.changed',
            createdAt: new Date().toISOString(),
            payload: { state: 'signed_in', account: { email: 'ada@example.com' }, plan: 'plus' }
          })
        }));
      });
      await advance(reconnected.page, 250);
      assert.equal(await requestText(reconnected.page), en['patch.apply.applied']);
      assert.equal(await activeElementId(reconnected.page), 'request-result-heading');
      assert.deepEqual(reconnected.pageErrors, []);
    } finally {
      await reconnected.page.close();
    }
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    await browser.close();
  }
});

test('a non-boolean applied flag reconciles and only a real false or rolled-back transaction is not applied', async (t) => {
  const browser = await launchPanelBrowser(t);
  if (!browser) return;
  const { en } = await loadLocales();
  const server = await startServer();
  const port = server.address().port;
  const notAppliedText = `${en['patch.apply.failed.unknown']} ${en['patch.apply.failed.recheck']}`;

  async function blockReapply(page) {
    const sent = await approveCallCount(page);
    await page.evaluate((preview) => window.__chatpcbTest.showPatch(preview), passedPreview);
    await page.locator('#approve-patch-button').dispatchEvent('click');
    assert.equal(await page.locator('#approve-patch-button').isDisabled(), true);
    assert.equal(await approveCallCount(page), sent);
  }

  try {
    const asString = await openPanel(browser, port);
    try {
      await showReady(asString.page);
      await installHost(asString.page);
      await clickApply(asString.page);
      const approve = (await approveCalls(asString.page)).at(-1);
      await emitResult(asString.page, approve.id, { applied: 'true', operation: 'patched', validation: { ok: true }, patchId: 'patch_test' });
      const statusCall = await waitForCall(asString.page, 'project.transaction.status');
      assert.notEqual(await requestText(asString.page), notAppliedText);
      assert.equal((await requestText(asString.page)).includes(en['patch.apply.failed.unknown']), false);
      await emitResult(asString.page, statusCall.id, appliedTransaction());
      await asString.page.waitForFunction((text) => (
        document.querySelector('#request-status')?.dataset.state === 'completed'
        && document.querySelector('#request-status')?.textContent === text
        && document.activeElement?.id === 'request-result-heading'
      ), en['patch.apply.applied'], { timeout: 3000 });
      assert.deepEqual((await completionSnapshot(asString.page)).reloads, [{ type: 'project.reload', projectPath: 'fixtures/demo-board' }]);
      await blockReapply(asString.page);
      assert.deepEqual(asString.pageErrors, []);
    } finally {
      await asString.page.close();
    }

    const missingField = await openPanel(browser, port);
    try {
      await showReady(missingField.page);
      await installHost(missingField.page);
      await clickApply(missingField.page);
      const approve = (await approveCalls(missingField.page)).at(-1);
      const missingApplied = { operation: 'patched', validation: { ok: true }, patchId: 'patch_test' };
      assert.equal(Object.hasOwn(missingApplied, 'applied'), false);
      await emitResult(missingField.page, approve.id, missingApplied);
      const statusCall = await waitForCall(missingField.page, 'project.transaction.status');
      const checking = await requestText(missingField.page);
      assert.equal(checking.includes(en['patch.apply.failed.missing']), false, checking);
      assert.equal(checking.includes(en['patch.apply.failed.recheck']), false, checking);
      assert.equal(checking.includes(en['patch.apply.unconfirmed']), false, checking);
      await emitResult(missingField.page, statusCall.id, appliedTransaction());
      await missingField.page.waitForFunction((text) => (
        document.querySelector('#request-status')?.dataset.state === 'completed'
        && document.querySelector('#request-status')?.textContent === text
        && document.activeElement?.id === 'request-result-heading'
      ), en['patch.apply.applied'], { timeout: 3000 });
      const shot = await completionSnapshot(missingField.page);
      assert.equal(shot.text, en['patch.apply.applied']);
      assert.equal(shot.reloads.length, 1, 'missing applied reconciles to one project.reload');
      assert.deepEqual(shot.reloads, [{ type: 'project.reload', projectPath: 'fixtures/demo-board' }]);
      assert.equal(await activeElementId(missingField.page), 'request-result-heading');
      await blockReapply(missingField.page);
      assert.deepEqual(missingField.pageErrors, []);
    } finally {
      await missingField.page.close();
    }

    const asNumber = await openPanel(browser, port);
    try {
      await showReady(asNumber.page);
      await installHost(asNumber.page);
      await clickApply(asNumber.page);
      const approve = (await approveCalls(asNumber.page)).at(-1);
      await emitResult(asNumber.page, approve.id, { applied: 1, validation: { ok: true }, patchId: 'patch_test' });
      await waitForCall(asNumber.page, 'project.transaction.status');
      assert.equal(await requestText(asNumber.page), en['patch.apply.checking']);
      await advance(asNumber.page, RECONCILE_TIMEOUT_MS);
      await asNumber.page.waitForFunction((text) => (
        document.querySelector('#request-status')?.dataset.state === 'failed'
        && document.querySelector('#request-status')?.textContent === text
        && document.activeElement?.id === 'request-result-heading'
      ), en['patch.apply.unconfirmed'], { timeout: 3000 });
      const text = await requestText(asNumber.page);
      assert.equal(text.includes(en['patch.apply.failed.unknown']), false, text);
      assert.equal(text.includes(en['patch.apply.failed.recheck']), false, text);
      assert.equal(text.includes('KiCad'), true, text);
      assert.deepEqual((await completionSnapshot(asNumber.page)).reloads, []);
      assert.equal(await activeElementId(asNumber.page), 'request-result-heading');
      await blockReapply(asNumber.page);
      assert.deepEqual(asNumber.pageErrors, []);
    } finally {
      await asNumber.page.close();
    }

    const explicitFalse = await openPanel(browser, port);
    try {
      await showReady(explicitFalse.page);
      await clickApply(explicitFalse.page);
      const approve = (await approveCalls(explicitFalse.page)).at(-1);
      await emitResult(explicitFalse.page, approve.id, { applied: false, validation: { ok: true }, patchId: 'patch_test' });
      await explicitFalse.page.waitForFunction((text) => document.querySelector('#request-status')?.textContent === text, notAppliedText, { timeout: 3000 });
      await advance(explicitFalse.page, 60);
      assert.equal((await sentCalls(explicitFalse.page, 'project.transaction.status')).length, 0);
      assert.equal(await requestText(explicitFalse.page), notAppliedText);
      assert.deepEqual(explicitFalse.pageErrors, []);
    } finally {
      await explicitFalse.page.close();
    }
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    await browser.close();
  }
});

test('a late non-boolean approve reply, or ok:false with applied:true, after reconcile timeout stays unconfirmed and sends no reload', async (t) => {
  const browser = await launchPanelBrowser(t);
  if (!browser) return;
  const { en } = await loadLocales();
  const server = await startServer();
  const port = server.address().port;
  const rows = [
    { name: 'string', applied: 'true' },
    { name: 'number', applied: 1 },
    { name: 'null', applied: null },
    { name: 'object', applied: {} },
    { name: 'missing' },
    { name: 'ok-false-applied-true', applied: true, ok: false }
  ];

  try {
    for (const row of rows) {
      const opened = await openPanel(browser, port);
      try {
        await showReady(opened.page);
        await installHost(opened.page);
        await clickApply(opened.page);
        const approve = (await approveCalls(opened.page)).at(-1);
        await advance(opened.page, APPROVE_TIMEOUT_MS);
        assert.equal(await requestText(opened.page), en['patch.apply.checking'], row.name);
        await advance(opened.page, RECONCILE_TIMEOUT_MS);
        await opened.page.waitForFunction((text) => (
          document.querySelector('#request-status')?.dataset.state === 'failed'
          && document.querySelector('#request-status')?.textContent === text
          && document.activeElement?.id === 'request-result-heading'
        ), en['patch.apply.unconfirmed'], { timeout: 3000 });
        assert.equal(await activeElementId(opened.page), 'request-result-heading', row.name);
        const lateBody = {
          operation: 'patched',
          validation: { ok: true },
          patchId: 'patch_test'
        };
        if (row.name !== 'missing') lateBody.applied = row.applied;
        await emitResult(opened.page, approve.id, lateBody, row.ok !== false);
        await advance(opened.page, 50);
        const shot = await completionSnapshot(opened.page);
        assert.equal(shot.text, en['patch.apply.unconfirmed'], row.name);
        assert.equal(shot.state, 'failed', row.name);
        assert.equal(shot.text.includes(en['patch.apply.applied']), false, row.name);
        assert.deepEqual(shot.reloads, [], row.name);
        assert.notEqual(shot.draft, 'done', row.name);
        assert.deepEqual(opened.pageErrors, [], row.name);
      } finally {
        await opened.page.close();
      }
    }
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    await browser.close();
  }
});

test('an applied result focuses the result heading once', async (t) => {
  const browser = await launchPanelBrowser(t);
  if (!browser) return;
  const { en } = await loadLocales();
  const server = await startServer();
  const port = server.address().port;
  const { page, pageErrors } = await openPanel(browser, port);

  try {
    await showReady(page);
    await page.evaluate(() => {
      const heading = document.querySelector('#request-result-heading');
      const focus = heading.focus.bind(heading);
      window.__resultHeadingFocusCalls = 0;
      heading.focus = (...args) => {
        window.__resultHeadingFocusCalls += 1;
        return focus(...args);
      };
    });
    await clickApply(page);
    const approve = (await approveCalls(page)).at(-1);
    await emitResult(page, approve.id, { applied: true, operation: 'patched', validation: { ok: true }, patchId: 'patch_test' });
    await page.waitForFunction((text) => (
      document.querySelector('#request-status')?.dataset.state === 'completed'
      && document.querySelector('#request-status')?.textContent === text
    ), en['patch.apply.applied'], { timeout: 3000 });
    await advance(page, 50);
    const calls = await page.evaluate(() => window.__resultHeadingFocusCalls);
    assert.equal(calls, 1, `result heading focus() was called ${calls} times`);
    assert.equal(await activeElementId(page), 'request-result-heading');
    assert.deepEqual(pageErrors, []);
  } finally {
    await page.close();
    await new Promise((resolveClose) => server.close(resolveClose));
    await browser.close();
  }
});

test('inspect reconcile with before==after and no transaction record stays unconfirmed', async (t) => {
  const browser = await launchPanelBrowser(t);
  if (!browser) return;
  const { en } = await loadLocales();
  const server = await startServer();
  const port = server.address().port;
  const samePreview = { ...passedPreview, evidenceDigest: 'digest-same', afterDigest: 'digest-same' };
  const { page, pageErrors } = await openPanel(browser, port);

  try {
    await showReady(page, samePreview);
    await installHost(page);
    const inspectCall = await settleEmptyTransactionInspect(page, {
      manifest: { freshness: { status: 'current' } },
      inspection: { projectDigest: 'digest-same' },
      evidenceDigest: { projectDigest: 'digest-same', matches: true }
    }, true);
    assert.equal(inspectCall.args.expectedDigest, 'digest-same');
    await page.waitForFunction((text) => (
      document.querySelector('#request-status')?.dataset.state === 'failed'
      && document.querySelector('#request-status')?.textContent === text
    ), en['patch.apply.unconfirmed'], { timeout: 3000 });
    const shot = await completionSnapshot(page);
    assert.equal(shot.text, en['patch.apply.unconfirmed'], shot.text);
    assert.equal(shot.state, 'failed');
    assert.equal(shot.text.includes(en['patch.apply.applied']), false, shot.text);
    assert.equal(shot.text.includes(en['patch.apply.failed.recheck']), false, shot.text);
    assert.deepEqual(shot.reloads, []);
    assert.deepEqual(pageErrors, []);
  } finally {
    await page.close();
    await new Promise((resolveClose) => server.close(resolveClose));
    await browser.close();
  }
});

test("late applied:true after a recorded rollback keeps 'not applied' and sends no reload", async (t) => {
  const browser = await launchPanelBrowser(t);
  if (!browser) return;
  const { en } = await loadLocales();
  const server = await startServer();
  const port = server.address().port;
  const notAppliedText = `${en['patch.apply.failed.unknown']} ${en['patch.apply.failed.recheck']}`;
  const { page, pageErrors } = await openPanel(browser, port);

  try {
    await showReady(page);
    await installHost(page);
    await clickApply(page);
    const approve = (await approveCalls(page)).at(-1);
    await advance(page, APPROVE_TIMEOUT_MS);
    const statusCall = await waitForCall(page, 'project.transaction.status');
    await emitResult(page, statusCall.id, failedTransaction('rolled-back'));
    await page.waitForFunction((text) => (
      document.querySelector('#request-status')?.dataset.state === 'failed'
      && document.querySelector('#request-status')?.textContent === text
    ), notAppliedText, { timeout: 3000 });
    assert.deepEqual((await completionSnapshot(page)).reloads, []);
    await emitResult(page, approve.id, { applied: true, operation: 'patched', validation: { ok: true }, patchId: 'patch_test' });
    await advance(page, 50);
    const shot = await completionSnapshot(page);
    assert.equal(shot.text, notAppliedText, shot.text);
    assert.equal(shot.state, 'failed');
    assert.equal(shot.text.includes(en['patch.apply.applied']), false, shot.text);
    assert.equal(shot.text.includes(en['patch.apply.unconfirmed']), false, shot.text);
    assert.deepEqual(shot.reloads, []);
    assert.deepEqual(pageErrors, []);
  } finally {
    await page.close();
    await new Promise((resolveClose) => server.close(resolveClose));
    await browser.close();
  }
});

test("late transaction status 'applied' after reconcile timeout upgrades to applied with one reload", async (t) => {
  const browser = await launchPanelBrowser(t);
  if (!browser) return;
  const { en } = await loadLocales();
  const server = await startServer();
  const port = server.address().port;
  const { page, pageErrors } = await openPanel(browser, port);

  try {
    await showReady(page);
    await installHost(page);
    await clickApply(page);
    await advance(page, APPROVE_TIMEOUT_MS);
    const statusCall = await waitForCall(page, 'project.transaction.status');
    assert.equal(await requestText(page), en['patch.apply.checking']);
    await advance(page, RECONCILE_TIMEOUT_MS);
    await page.waitForFunction((text) => (
      document.querySelector('#request-status')?.dataset.state === 'failed'
      && document.querySelector('#request-status')?.textContent === text
      && document.activeElement?.id === 'request-result-heading'
    ), en['patch.apply.unconfirmed'], { timeout: 3000 });
    assert.equal(await activeElementId(page), 'request-result-heading');
    assert.deepEqual((await completionSnapshot(page)).reloads, []);
    await installHeadingFocusSpy(page);
    await emitResult(page, statusCall.id, appliedTransaction());
    await page.waitForFunction((text) => (
      document.querySelector('#request-status')?.dataset.state === 'completed'
      && document.querySelector('#request-status')?.textContent === text
    ), en['patch.apply.applied'], { timeout: 3000 });
    const upgradeFocusCalls = await headingFocusCalls(page);
    assert.equal(upgradeFocusCalls, 1, `late upgrade heading focus() was called ${upgradeFocusCalls} times`);
    const shot = await completionSnapshot(page);
    assert.equal(shot.text, en['patch.apply.applied']);
    assert.equal(shot.state, 'completed');
    assert.equal(shot.reloads.length, 1, 'late status applied posts project.reload once');
    assert.deepEqual(shot.reloads, [{ type: 'project.reload', projectPath: 'fixtures/demo-board' }]);
    await emitResult(page, statusCall.id, appliedTransaction());
    await advance(page, 40);
    assert.equal((await completionSnapshot(page)).reloads.length, 1);
    assert.deepEqual(pageErrors, []);
  } finally {
    await page.close();
    await new Promise((resolveClose) => server.close(resolveClose));
    await browser.close();
  }
});

test('late transaction status after reconcile timeout does not upgrade an empty record, another patch, needs-inspection, rolled-back, or ok:false', async (t) => {
  const browser = await launchPanelBrowser(t);
  if (!browser) return;
  const { en } = await loadLocales();
  const server = await startServer();
  const port = server.address().port;
  const rows = [
    { name: 'empty', result: { transactions: [] } },
    { name: 'other-patch', result: appliedTransaction('patch_other') },
    { name: 'needs-inspection', result: failedTransaction('needs-inspection') },
    { name: 'rolled-back', result: failedTransaction('rolled-back') },
    { name: 'ok-false', ok: false, result: appliedTransaction('patch_test') }
  ];

  try {
    for (const row of rows) {
      const opened = await openPanel(browser, port);
      try {
        await showReady(opened.page);
        await installHost(opened.page);
        await clickApply(opened.page);
        await advance(opened.page, APPROVE_TIMEOUT_MS);
        const statusCall = await waitForCall(opened.page, 'project.transaction.status');
        assert.equal(await requestText(opened.page), en['patch.apply.checking'], row.name);
        await advance(opened.page, RECONCILE_TIMEOUT_MS);
        await opened.page.waitForFunction((text) => (
          document.querySelector('#request-status')?.dataset.state === 'failed'
          && document.querySelector('#request-status')?.textContent === text
        ), en['patch.apply.unconfirmed'], { timeout: 3000 });
        assert.deepEqual((await completionSnapshot(opened.page)).reloads, [], row.name);
        await emitResult(opened.page, statusCall.id, row.result, row.ok !== false);
        await advance(opened.page, 50);
        const shot = await completionSnapshot(opened.page);
        assert.equal(shot.text, en['patch.apply.unconfirmed'], row.name);
        assert.equal(shot.state, 'failed', row.name);
        assert.equal(shot.text.includes(en['patch.apply.applied']), false, row.name);
        assert.deepEqual(shot.reloads, [], row.name);
        assert.deepEqual(opened.pageErrors, [], row.name);
      } finally {
        await opened.page.close();
      }
    }
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    await browser.close();
  }
});

test('a late error keeps focus inside the removal confirm dialog', async (t) => {
  const browser = await launchPanelBrowser(t);
  if (!browser) return;
  const { en } = await loadLocales();
  const server = await startServer();
  const port = server.address().port;
  const removalPreview = {
    ...passedPreview,
    removedComponents: [{ ref: 'R1', value: '10k', libId: 'Device:R' }]
  };
  const { page, pageErrors } = await openPanel(browser, port);

  try {
    await showReady(page, removalPreview);
    await page.waitForFunction(() => {
      const dialog = document.querySelector('#apply-remove-components-confirm');
      return dialog && dialog.hidden === false && dialog.contains(document.activeElement);
    }, null, { timeout: 3000 });
    // A project.request closes this dialog because the apply gate treats it as busy.
    // project.create still settles a result and leaves the removal confirm open.
    const before = await page.evaluate(() => window.__sent.length);
    await page.evaluate(() => {
      document.querySelector('#project-name').value = 'Side quest';
      document.querySelector('#new-project-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await page.waitForFunction((start) => window.__sent.some((raw, index) => (
      index >= start && JSON.parse(raw).payload?.name === 'project.create'
    )), before, { timeout: 3000 });
    const call = await page.evaluate((start) => {
      const raw = window.__sent.find((entry, index) => (
        index >= start && JSON.parse(entry).payload?.name === 'project.create'
      ));
      return JSON.parse(raw).payload;
    }, before);
    await page.locator('#cancel-apply-remove-components').focus();
    const armed = await dialogFocus(page, '#apply-remove-components-confirm');
    assert.equal(armed.open, true, armed.activeId);
    assert.equal(armed.inside, true, armed.activeId);
    await emitPayload(page, call.id, { ok: false, error: { code: 'PROVIDER_FAILED', message: 'provider failed' } });
    await page.waitForFunction((text) => document.querySelector('#request-status')?.textContent === text, en['request.failed'], { timeout: 3000 });
    const focus = await dialogFocus(page, '#apply-remove-components-confirm');
    assert.equal(focus.open, true);
    assert.equal(focus.inside, true, focus.activeId);
    assert.notEqual(focus.activeId, 'request-result-heading');
    assert.deepEqual(pageErrors, []);
  } finally {
    await page.close();
    await new Promise((resolveClose) => server.close(resolveClose));
    await browser.close();
  }
});

test('a late error keeps focus inside the apply-without-ERC confirm dialog', async (t) => {
  const browser = await launchPanelBrowser(t);
  if (!browser) return;
  const { en } = await loadLocales();
  const server = await startServer();
  const port = server.address().port;
  const skippedPreview = {
    ...passedPreview,
    validation: { ok: true, skipped: true, executed: false },
    candidateVerification: { erc: { ok: true, skipped: true, executed: false } }
  };
  const { page, pageErrors } = await openPanel(browser, port);

  try {
    await showReady(page, skippedPreview);
    const call = await sendProjectRequest(page, 'what is R3?');
    await page.locator('#approve-patch-without-erc').click();
    await page.waitForFunction(() => {
      const dialog = document.querySelector('#apply-without-erc-confirm');
      return dialog && dialog.hidden === false && dialog.contains(document.activeElement);
    });
    await emitPayload(page, call.id, { ok: false, error: { code: 'PROVIDER_FAILED', message: 'provider failed' } });
    await page.waitForFunction((text) => document.querySelector('#request-status')?.textContent === text, en['request.failed'], { timeout: 3000 });
    const focus = await dialogFocus(page, '#apply-without-erc-confirm');
    assert.equal(focus.open, true);
    assert.equal(focus.inside, true, focus.activeId);
    assert.notEqual(focus.activeId, 'request-result-heading');
    assert.equal(await dialogFocus(page, '#apply-remove-components-confirm').then((shot) => shot.open), false);
    assert.deepEqual(pageErrors, []);
  } finally {
    await page.close();
    await new Promise((resolveClose) => server.close(resolveClose));
    await browser.close();
  }
});

test('ok:false approve reply with a result object but no applied field renders the rejection immediately and sends no transaction.status', async (t) => {
  const browser = await launchPanelBrowser(t);
  if (!browser) return;
  const { en } = await loadLocales();
  const server = await startServer();
  const port = server.address().port;
  const { page, pageErrors } = await openPanel(browser, port);

  try {
    await showReady(page);
    await installHost(page);
    await clickApply(page);
    const approve = (await approveCalls(page)).at(-1);
    await emitPayload(page, approve.id, { ok: false, result: { code: 'PATCH_STALE' } });
    await page.waitForFunction((texts) => {
      const text = document.querySelector('#request-status')?.textContent ?? '';
      return text === texts.rejected || text === texts.checking;
    }, { rejected: en['request.patch-failed'], checking: en['patch.apply.checking'] }, { timeout: 3000 });
    assert.equal(await requestText(page), en['request.patch-failed']);
    assert.equal(await page.locator('#request-status').getAttribute('data-state'), 'failed');
    assert.equal((await sentCalls(page, 'project.transaction.status')).length, 0);
    assert.equal((await requestText(page)).includes(en['patch.apply.checking']), false);
    assert.equal((await requestText(page)).includes(en['patch.apply.unconfirmed']), false);
    assert.deepEqual((await completionSnapshot(page)).reloads, []);
    assert.deepEqual(pageErrors, []);
  } finally {
    await page.close();
    await new Promise((resolveClose) => server.close(resolveClose));
    await browser.close();
  }
});

test('every request result focuses the result heading', async (t) => {
  const browser = await launchPanelBrowser(t);
  if (!browser) return;
  const { en, ko } = await loadLocales();
  const server = await startServer();
  const port = server.address().port;
  const preview = {
    requiresApproval: true,
    approved: false,
    applied: false,
    patchId: 'patch_preview',
    operation: 'generated',
    files: { project: 'fixtures/demo-board/board.kicad_pro' },
    validation: { ok: true, skipped: false, erc: { errorCount: 0, warningCount: 0 } },
    conversation: { messages: [] }
  };
  const clarify = {
    operation: 'clarify',
    applied: false,
    requiresApproval: false,
    conversation: { status: 'awaiting-input', messages: [{ role: 'assistant', text: 'Which MCU should this use?' }] },
    nextQuestion: 'Which MCU should this use?'
  };
  const rows = [
    { name: 'success', via: 'request', result: preview, text: en['request.preview-ready'], state: 'ready' },
    { name: 'success-applied', via: 'approve', result: { applied: true, operation: 'patched', validation: { ok: true }, patchId: 'patch_test' }, text: en['patch.apply.applied'], state: 'completed' },
    { name: 'error', via: 'request', ok: false, error: { code: 'PROVIDER_FAILED', message: 'provider failed' }, prompt: 'R3가 뭐야?', text: en['request.failed'], state: 'failed' },
    { name: 'error-ko', via: 'request', lang: 'ko', ok: false, error: { code: 'PROVIDER_FAILED', message: 'provider failed' }, prompt: 'LED 2개 추가해줘', text: ko['request.failed'], state: 'failed' },
    { name: 'clarify', via: 'request', result: clarify, text: clarify.nextQuestion, state: 'ready' },
    { name: 'rejection-PATCH_STALE', via: 'approve', result: { applied: false, validation: { ok: true }, reason: { code: 'PATCH_STALE' }, patchId: 'patch_test' }, text: en['patch.apply.failed.PATCH_STALE'], state: 'failed' },
    { name: 'rejection-PATCH_EXPIRED', via: 'approve', result: { applied: false, validation: { ok: true }, reason: { code: 'PATCH_EXPIRED' }, patchId: 'patch_test' }, text: en['patch.apply.failed.PATCH_EXPIRED'], state: 'failed' },
    { name: 'rejection-EXISTING_COMPONENTS_REMOVED', via: 'approve', result: { applied: false, validation: { ok: true }, reason: { code: 'EXISTING_COMPONENTS_REMOVED' }, patchId: 'patch_test' }, text: en['patch.apply.failed.EXISTING_COMPONENTS_REMOVED'], state: 'failed' },
    { name: 'rejection-unknown', via: 'approve', result: { applied: false, validation: { ok: true }, reason: { code: 'NO_SUCH_CODE' }, patchId: 'patch_test' }, text: en['patch.apply.failed.unknown'], state: 'failed' },
    { name: 'rejection-unverified', via: 'approve', result: { applied: false, validation: { ok: true }, reason: { code: 'PATCH_CANDIDATE_UNVERIFIED' }, patchId: 'patch_test' }, text: en['patch.unverified.body'], state: 'failed' }
  ];

  try {
    for (const row of rows) {
      const opened = await openPanel(browser, port);
      try {
        await showReady(opened.page);
        if (row.lang) await opened.page.evaluate((lang) => window.chatpcbI18n.setLang(lang), row.lang);
        let call;
        if (row.via === 'approve') {
          await clickApply(opened.page);
          call = (await approveCalls(opened.page)).at(-1);
        } else {
          call = await sendProjectRequest(opened.page, row.prompt || `case ${row.name}`);
        }
        await blurToBody(opened.page);
        assert.equal(await activeElementId(opened.page), 'BODY', `${row.name} starts on the body`);
        if (row.ok === false) await emitPayload(opened.page, call.id, { ok: false, error: row.error });
        else await emitResult(opened.page, call.id, row.result);
        await opened.page.waitForFunction((expected) => (
          document.querySelector('#request-status')?.dataset.state === expected.state
          && document.querySelector('#request-status')?.textContent?.includes(expected.text)
          && document.activeElement?.id === 'request-result-heading'
        ), { text: row.text, state: row.state }, { timeout: 3000 });
        const text = await requestText(opened.page);
        assert.equal(text.includes(row.text), true, `${row.name}: ${text}`);
        assert.equal(await opened.page.locator('#request-status').getAttribute('data-state'), row.state, row.name);
        assert.equal(await activeElementId(opened.page), 'request-result-heading', row.name);
        assert.deepEqual(opened.pageErrors, [], row.name);
      } finally {
        await opened.page.close();
      }
    }
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    await browser.close();
  }
});

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

test('approve reconcile and reconnect timers do not fire one millisecond early', async (t) => {
  const browser = await launchPanelBrowser(t);
  if (!browser) return;
  const { en } = await loadLocales();
  const server = await startServer();
  const port = server.address().port;

  try {
    const approve = await openPanel(browser, port);
    try {
      await showReady(approve.page);
      await clickApply(approve.page);
      await advance(approve.page, APPROVE_TIMEOUT_MS - 1);
      assert.equal(await requestText(approve.page), en['patch.apply.summary']);
      assert.equal((await sentCalls(approve.page, 'project.transaction.status')).length, 0);
      await advance(approve.page, 1);
      assert.equal(await requestText(approve.page), en['patch.apply.checking']);
      assert.equal((await sentCalls(approve.page, 'project.transaction.status')).length, 1);
      await advance(approve.page, RECONCILE_TIMEOUT_MS - 1);
      assert.equal(await requestText(approve.page), en['patch.apply.checking']);
      assert.equal(await approve.page.locator('#request-status').getAttribute('data-state'), 'running');
      await advance(approve.page, 1);
      await approve.page.waitForFunction((text) => (
        document.querySelector('#request-status')?.dataset.state === 'failed'
        && document.querySelector('#request-status')?.textContent === text
      ), en['patch.apply.unconfirmed'], { timeout: 3000 });
      assert.deepEqual(approve.pageErrors, []);
    } finally {
      await approve.page.close();
    }

    const reconnect = await openPanel(browser, port);
    try {
      const count = await reconnect.page.evaluate(() => window.__sockets.length);
      await reconnect.page.evaluate(() => window.__sockets.at(-1).close());
      await reconnect.page.waitForFunction((text) => document.querySelector('#connection-status')?.textContent === text, en['connection.disconnected'], { timeout: 3000 });
      await advance(reconnect.page, RECONNECT_DELAY_MS - 1);
      assert.equal(await reconnect.page.evaluate(() => window.__sockets.length), count);
      assert.equal(await reconnect.page.locator('#connection-status').innerText(), en['connection.disconnected']);
      await advance(reconnect.page, 1);
      await reconnect.page.waitForFunction((text) => document.querySelector('#connection-status')?.textContent === text, en['connection.connected'], { timeout: 3000 });
      assert.equal(await reconnect.page.evaluate(() => window.__sockets.length), count + 1);
      assert.deepEqual(reconnect.pageErrors, []);
    } finally {
      await reconnect.page.close();
    }
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    await browser.close();
  }
});

const FOCUS_METHODS = new Set(['focus', 'blur']);

function focusPropertyName(property) {
  if (!property) return null;
  if (property.type === 'Identifier') return property.name;
  if (property.type === 'Literal' && typeof property.value === 'string') return property.value;
  if (property.type === 'TemplateLiteral' && property.expressions.length === 0) {
    return property.quasis[0]?.value?.cooked ?? null;
  }
  return null;
}

function isFocusMember(node) {
  return node?.type === 'MemberExpression' && FOCUS_METHODS.has(focusPropertyName(node.property));
}

// Direct calls, optional calls, computed ['focus']/["focus"], .focus.call, and
// aliases (`const f = el.focus`, `{ focus }`, `{ focus: f }`) outside focusProgrammatically.
function focusBypasses(source) {
  const ast = espree.parse(source, { ecmaVersion: 'latest', sourceType: 'module', loc: true });
  const found = [];
  let helperFocusCalls = 0;
  let sawHelper = false;
  const visit = (node, inHelper) => {
    if (!node || typeof node.type !== 'string') return;
    const entersHelper = node.type === 'FunctionDeclaration' && node.id?.name === 'focusProgrammatically';
    if (entersHelper) sawHelper = true;
    const here = inHelper || entersHelper;
    if (!here && isFocusMember(node)) {
      found.push({ line: node.loc.start.line, kind: 'member' });
    }
    if (here && node.type === 'CallExpression' && isFocusMember(node.callee) && focusPropertyName(node.callee.property) === 'focus') {
      helperFocusCalls += 1;
    }
    if (node.type === 'ObjectPattern') {
      for (const prop of node.properties) {
        if (prop.type !== 'Property') continue;
        if (!FOCUS_METHODS.has(focusPropertyName(prop.key))) continue;
        found.push({ line: prop.loc.start.line, kind: 'pattern' });
      }
    }
    if (node.type === 'ImportSpecifier' && FOCUS_METHODS.has(node.imported?.name)) {
      found.push({ line: node.loc.start.line, kind: 'import' });
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'range') continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) visit(child, here);
      } else if (value && typeof value.type === 'string') visit(value, here);
    }
  };
  visit(ast, false);
  return { found, helperFocusCalls, sawHelper };
}

test('panel programmatic focus goes through confirmDialogOwnsFocus', async () => {
  const panel = await readFile(new URL('../apps/panel/panel.js', import.meta.url), 'utf8');
  const bypass = focusBypasses(panel);
  assert.equal(bypass.sawHelper, true, 'focusProgrammatically is missing');
  assert.equal(bypass.helperFocusCalls, 1, `focus calls inside the helper: ${bypass.helperFocusCalls}`);
  assert.deepEqual(bypass.found, [], bypass.found.map((item) => `${item.kind}@${item.line}`).join(', '));
  assert.match(panel, /function confirmDialogOwnsFocus\(\)/);
  const helperStart = panel.indexOf('function focusProgrammatically(');
  const helperEnd = panel.indexOf('\nfunction ', helperStart + 1);
  const helper = panel.slice(helperStart, helperEnd === -1 ? panel.length : helperEnd);
  assert.match(helper, /confirmDialogOwnsFocus\(\)/);
  const calls = panel.match(/focusProgrammatically\(/g) ?? [];
  assert.ok(calls.length >= 15, `focusProgrammatically calls: ${calls.length}`);

  const allowed = 'function focusProgrammatically(element){ if (typeof element.focus !== "function") return; element.focus(); }\n';
  const samples = [
    'el?.focus?.();',
    'el?.focus();',
    "el['focus']();",
    'el["focus"]();',
    'const f = el.focus; f.call(el);',
    'el.focus.call(el);',
    'const { focus } = el; focus.call(el);',
    'const { focus: focusAlias } = el;',
    "const { ['focus']: computedFocus } = el;",
    'const { "focus": quotedFocus } = el;',
    "el['blur']();",
    'const { blur } = el;'
  ];
  assert.deepEqual(focusBypasses(allowed).found, []);
  for (const sample of samples) {
    const hit = focusBypasses(`${allowed}${sample}`);
    assert.ok(hit.found.length > 0, `${sample} was not caught`);
  }
});

test('reconnect while a confirm dialog is open expires the preview and focuses the result heading', async (t) => {
  const browser = await launchPanelBrowser(t);
  if (!browser) return;
  const { en, ko } = await loadLocales();
  const server = await startServer();
  const port = server.address().port;
  const rows = [
    { name: 'removal-en', lang: 'en', kind: 'removal', lead: en['patch.remove.lead'], expired: PREVIEW_EXPIRED.en },
    { name: 'removal-ko', lang: 'ko', kind: 'removal', lead: ko['patch.remove.lead'], expired: PREVIEW_EXPIRED.ko },
    { name: 'without-erc-en', lang: 'en', kind: 'without-erc', lead: en['patch.remove.lead'], expired: PREVIEW_EXPIRED.en },
    { name: 'without-erc-ko', lang: 'ko', kind: 'without-erc', lead: ko['patch.remove.lead'], expired: PREVIEW_EXPIRED.ko }
  ];
  const failures = [];

  try {
    for (const row of rows) {
      const opened = await openPanel(browser, port, row.lang);
      try {
        await signInChatGPT(opened.page);
        if (row.kind === 'removal') await showRemovalLead(opened.page, row.lead);
        else await showWithoutErcDialog(opened.page);
        const before = await dialogFocus(opened.page, row.kind === 'removal' ? '#apply-remove-components-confirm' : '#apply-without-erc-confirm');
        assert.equal(before.open, true, row.name);
        assert.equal(before.inside, true, `${row.name} ${before.activeId}`);
        await reconnectAndRefreshAuth(opened.page);
        const heading = await requestText(opened.page);
        const progress = await opened.page.locator('#request-progress').innerText();
        const removal = await dialogFocus(opened.page, '#apply-remove-components-confirm');
        const without = await dialogFocus(opened.page, '#apply-without-erc-confirm');
        const active = await activeElementId(opened.page);
        const state = await opened.page.locator('#request-status').getAttribute('data-state');
        const caption = await opened.page.locator('#workflow-caption').innerText();
        const cardHidden = await opened.page.locator('#patch-approval-card').isHidden();
        assert.equal(removal.open, false, row.name);
        assert.equal(without.open, false, row.name);
        assert.equal(heading, row.expired, `${row.name} heading: ${heading}`);
        assert.equal(heading.includes(row.lead), false, `${row.name} lead stayed in heading: ${heading}`);
        assert.equal(progress.includes(row.lead), false, `${row.name} lead stayed in progress: ${progress}`);
        assert.equal(caption, row.expired, `${row.name} caption: ${caption}`);
        assert.equal(state, 'failed', row.name);
        assert.equal(active, 'request-result-heading', `${row.name} focused ${active}`);
        assert.notEqual(active, 'chatgpt-auth-title', row.name);
        assert.equal(cardHidden, true, row.name);
        assert.equal(await opened.page.locator('#approve-patch-button').isDisabled(), true, row.name);
        if (row.lang === 'en') assert.equal(en['request.preview-expired'], PREVIEW_EXPIRED.en);
        else assert.equal(ko['request.preview-expired'], PREVIEW_EXPIRED.ko);
        assert.deepEqual(opened.pageErrors, [], row.name);
      } catch (error) {
        failures.push(`${row.name}: ${error.message}`);
      } finally {
        await opened.page.close();
      }
    }
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    await browser.close();
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('auth.chatgpt.changed while a confirm dialog is open keeps focus inside the dialog', async (t) => {
  const browser = await launchPanelBrowser(t);
  if (!browser) return;
  const server = await startServer();
  const port = server.address().port;
  const rows = [
    { name: 'removal-en', lang: 'en', kind: 'removal' },
    { name: 'removal-ko', lang: 'ko', kind: 'removal' },
    { name: 'without-erc-en', lang: 'en', kind: 'without-erc' },
    { name: 'without-erc-ko', lang: 'ko', kind: 'without-erc' }
  ];
  const failures = [];

  try {
    for (const row of rows) {
      const opened = await openPanel(browser, port, row.lang);
      try {
        await signInChatGPT(opened.page);
        const dialogId = row.kind === 'removal' ? '#apply-remove-components-confirm' : '#apply-without-erc-confirm';
        if (row.kind === 'removal') await showRemovalDialog(opened.page);
        else await showWithoutErcDialog(opened.page);
        const before = await dialogFocus(opened.page, dialogId);
        assert.equal(before.open, true, row.name);
        assert.equal(before.inside, true, `${row.name} ${before.activeId}`);
        await opened.page.evaluate(() => {
          window.__sockets.at(-1).dispatchEvent(new MessageEvent('message', {
            data: JSON.stringify({
              version: 1,
              id: 'auth_changed_dialog',
              type: 'auth.chatgpt.changed',
              createdAt: new Date().toISOString(),
              payload: { state: 'signed_in', account: { email: 'ada@example.com' }, plan: 'plus' }
            })
          }));
        });
        await advance(opened.page, 250);
        const after = await dialogFocus(opened.page, dialogId);
        assert.equal(after.open, true, row.name);
        assert.equal(after.inside, true, `${row.name} focused ${after.activeId}`);
        assert.notEqual(after.activeId, 'chatgpt-auth-title', row.name);
        assert.notEqual(after.activeId, 'request-result-heading', row.name);
        assert.deepEqual(opened.pageErrors, [], row.name);
      } catch (error) {
        failures.push(`${row.name}: ${error.message}`);
      } finally {
        await opened.page.close();
      }
    }
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    await browser.close();
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('an open confirm dialog keeps every other programmatic focus inside', async (t) => {
  const browser = await launchPanelBrowser(t);
  if (!browser) return;
  const { en } = await loadLocales();
  const server = await startServer();
  const port = server.address().port;
  const rows = [
    {
      name: 'new-project',
      dialogs: ['removal', 'without-erc'],
      run: (page) => clickWithoutFocus(page, '#new-project-again')
    },
    {
      name: 'tab-trap',
      dialogs: ['removal'],
      run: async (page) => {
        await page.evaluate(() => {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
        });
        assert.equal(await activeElementId(page), 'confirm-apply-remove-components');
      }
    },
    {
      name: 'locked-flow',
      dialogs: ['removal', 'without-erc'],
      run: (page) => clickWithoutFocus(page, '.workflow-lane[data-lane="layout"] .flow-btn[aria-disabled="true"]')
    },
    {
      name: 'locked-lane',
      dialogs: ['removal', 'without-erc'],
      run: (page) => clickWithoutFocus(page, '.workflow-lane[data-lane="fab"] .lane-row[aria-disabled="true"]')
    },
    {
      name: 'fix-erc',
      dialogs: ['removal', 'without-erc'],
      run: (page) => clickWithoutFocus(page, '#fix-patch-button')
    },
    {
      name: 'focus-apply',
      dialogs: ['removal', 'without-erc'],
      run: (page) => page.evaluate(() => window.__chatpcbTest.focusApply())
    },
    {
      name: 'sync-blur',
      dialogs: ['removal', 'without-erc'],
      run: async (page) => {
        const result = await page.evaluate(() => {
          const dialog = [...document.querySelectorAll('[role="alertdialog"]')].find((el) => el.hidden === false);
          const button = document.activeElement;
          if (!dialog?.contains(button)) throw new Error(`sync-blur started on ${button?.id || 'BODY'}`);
          let focusInId = '';
          const onFocusIn = (event) => {
            if (dialog.contains(event.target)) focusInId = event.target.id || event.target.tagName;
          };
          document.addEventListener('focusin', onFocusIn, true);
          button.blur();
          const active = document.activeElement;
          const syncId = !active || active === document.body ? 'BODY' : (active.id || active.tagName);
          const syncInside = Boolean(dialog.contains(active) && active.disabled !== true);
          return new Promise((resolve) => {
            queueMicrotask(() => {
              document.removeEventListener('focusin', onFocusIn, true);
              resolve({ syncId, syncInside, focusInId });
            });
          });
        });
        assert.equal(result.syncInside, true, `sync-blur focused ${result.syncId}`);
        assert.notEqual(result.focusInId, '', 'sync-blur did not observe focusin');
      }
    },
    {
      name: 'removed-button',
      dialogs: ['removal', 'without-erc'],
      run: async (page) => {
        const result = await page.evaluate(() => new Promise((resolve, reject) => {
          const dialog = [...document.querySelectorAll('[role="alertdialog"]')].find((el) => el.hidden === false);
          const button = document.activeElement;
          if (!dialog?.contains(button)) {
            reject(new Error(`removed-button started on ${button?.id || 'BODY'}`));
            return;
          }
          const parent = button.parentNode;
          const next = button.nextSibling;
          let focusInId = '';
          const onFocusIn = (event) => {
            if (event.target !== button && dialog.contains(event.target) && event.target.disabled !== true) {
              focusInId = event.target.id || event.target.tagName;
            }
          };
          document.addEventListener('focusin', onFocusIn, true);
          button.remove();
          queueMicrotask(() => {
            document.removeEventListener('focusin', onFocusIn, true);
            const active = document.activeElement;
            const id = !active || active === document.body ? 'BODY' : (active.id || active.tagName);
            const enabledInside = Boolean(dialog.contains(active) && active.disabled !== true);
            if (next) parent.insertBefore(button, next);
            else parent.append(button);
            resolve({ id, enabledInside, focusInId });
          });
        }));
        assert.equal(result.enabledInside, true, `removed-button focused ${result.id}`);
        assert.notEqual(result.focusInId, '', 'removed-button did not observe focusin');
      }
    },
    {
      name: 'reentrant-focusout',
      dialogs: ['removal', 'without-erc'],
      run: async (page) => {
        const result = await page.evaluate(() => {
          const dialog = [...document.querySelectorAll('[role="alertdialog"]')].find((el) => el.hidden === false);
          const button = document.activeElement;
          if (!dialog?.contains(button)) throw new Error(`reentrant-focusout started on ${button?.id || 'BODY'}`);
          const original = HTMLElement.prototype.focus;
          let depth = 0;
          HTMLElement.prototype.focus = function focusWithNestedFocusout(...args) {
            if (depth > 8) throw new Error('confirm focus reentered');
            depth += 1;
            try {
              const openDialog = this.closest?.('[role="alertdialog"]');
              if (openDialog && openDialog.hidden === false) {
                document.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
              }
              return original.apply(this, args);
            } finally {
              depth -= 1;
            }
          };
          let focusInId = '';
          const onFocusIn = (event) => {
            if (dialog.contains(event.target) && event.target.disabled !== true) focusInId = event.target.id || '';
          };
          document.addEventListener('focusin', onFocusIn, true);
          button.blur();
          const active = document.activeElement;
          const syncId = !active || active === document.body ? 'BODY' : (active.id || active.tagName);
          HTMLElement.prototype.focus = original;
          document.removeEventListener('focusin', onFocusIn, true);
          return {
            syncId,
            syncInside: Boolean(dialog.contains(active) && active.disabled !== true),
            focusInId,
            depth
          };
        });
        assert.equal(result.syncInside, true, `reentrant-focusout focused ${result.syncId}`);
        assert.equal(result.depth, 0, 'reentrant-focusout left the focus wrapper on the stack');
        assert.notEqual(result.focusInId, '', 'reentrant-focusout did not observe focusin');
      }
    },
    {
      name: 'result-heading',
      dialogs: ['removal', 'without-erc'],
      run: async (page) => {
        const before = await page.evaluate(() => window.__sent.length);
        await page.evaluate(() => {
          document.querySelector('#project-name').value = 'Side quest';
          document.querySelector('#new-project-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });
        await page.waitForFunction((start) => window.__sent.some((raw, index) => (
          index >= start && JSON.parse(raw).payload?.name === 'project.create'
        )), before, { timeout: 3000 });
        const call = await page.evaluate((start) => {
          const raw = window.__sent.find((entry, index) => (
            index >= start && JSON.parse(entry).payload?.name === 'project.create'
          ));
          return JSON.parse(raw).payload;
        }, before);
        await emitPayload(page, call.id, { ok: false, error: { code: 'PROVIDER_FAILED', message: 'provider failed' } });
        await page.waitForFunction((text) => document.querySelector('#request-status')?.textContent === text, en['request.failed'], { timeout: 3000 });
      }
    },
    {
      name: 'provider-select',
      dialogs: ['removal', 'without-erc'],
      run: async (page) => {
        const before = (await sentCalls(page, 'auth.chatgpt.status')).length;
        await page.evaluate(() => {
          const provider = document.querySelector('#provider');
          provider.value = 'chatgpt';
          provider.dispatchEvent(new Event('change'));
        });
        const authCall = await waitForNthCall(page, 'auth.chatgpt.status', before);
        await emitResult(page, authCall.id, { state: 'error', code: 'usage_limit' });
        await advance(page, 250);
        await page.evaluate((label) => {
          const button = [...document.querySelectorAll('#chatgpt-auth-card button')].find((el) => el.textContent === label);
          if (!button) throw new Error('missing provider button');
          button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }, en['auth.chatgpt.switch-provider']);
      }
    }
  ];
  const failures = [];

  try {
    for (const row of rows) {
      for (const kind of row.dialogs) {
        const name = `${row.name}/${kind}`;
        const opened = await openPanel(browser, port);
        try {
          const dialogId = kind === 'removal' ? '#apply-remove-components-confirm' : '#apply-without-erc-confirm';
          if (kind === 'removal') await showRemovalDialog(opened.page);
          else await showWithoutErcDialog(opened.page);
          const before = await dialogFocus(opened.page, dialogId);
          assert.equal(before.open, true, name);
          assert.equal(before.inside, true, `${name} ${before.activeId}`);
          await row.run(opened.page);
          const after = await dialogFocus(opened.page, dialogId);
          assert.equal(after.open, true, name);
          assert.equal(after.inside, true, `${name} focused ${after.activeId}`);
          assert.notEqual(after.activeId, 'chatgpt-auth-title', name);
          assert.notEqual(after.activeId, 'request-result-heading', name);
          assert.notEqual(after.activeId, 'patch-approval-status', name);
          assert.deepEqual(opened.pageErrors, [], name);
        } catch (error) {
          failures.push(`${name}: ${error.message}`);
        } finally {
          await opened.page.close();
        }
      }
    }
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    await browser.close();
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('a focused confirm button that becomes disabled and then blurs to body (deferred Chromium fixup) returns focus inside the open dialog', async (t) => {
  const browser = await launchPanelBrowser(t);
  if (!browser) return;
  const server = await startServer();
  const port = server.address().port;
  const rows = [
    { name: 'removal-confirm', kind: 'removal', button: '#confirm-apply-remove-components' },
    { name: 'removal-cancel', kind: 'removal', button: '#cancel-apply-remove-components' },
    { name: 'without-erc-confirm', kind: 'without-erc', button: '#confirm-apply-without-erc' },
    { name: 'without-erc-cancel', kind: 'without-erc', button: '#cancel-apply-without-erc' }
  ];
  const failures = [];

  try {
    for (const row of rows) {
      const opened = await openPanel(browser, port);
      try {
        const dialogId = row.kind === 'removal' ? '#apply-remove-components-confirm' : '#apply-without-erc-confirm';
        if (row.kind === 'removal') await showRemovalDialog(opened.page);
        else await showWithoutErcDialog(opened.page);
        const before = await dialogFocus(opened.page, dialogId);
        assert.equal(before.open, true, row.name);
        assert.equal(before.inside, true, `${row.name} ${before.activeId}`);
        const result = await opened.page.evaluate(async ({ dialogId: id, buttonId }) => {
          const dialog = document.querySelector(id);
          const button = document.querySelector(buttonId);
          const idOf = (active) => {
            if (!active || active === document.body || active === document.documentElement) return 'BODY';
            return active.id || active.tagName;
          };
          if (!dialog || dialog.hidden || !button) return { focusInId: '', activeId: 'MISSING', inside: false };
          let armed = false;
          let onFocusIn = () => {};
          const focusIn = new Promise((resolve) => {
            onFocusIn = (event) => {
              if (!armed) return;
              if (event.target === button || event.target.disabled === true) return;
              if (!dialog.contains(event.target)) return;
              document.removeEventListener('focusin', onFocusIn, true);
              resolve(event.target.id || event.target.tagName);
            };
            document.addEventListener('focusin', onFocusIn, true);
          });
          button.focus();
          if (document.activeElement !== button) {
            document.removeEventListener('focusin', onFocusIn, true);
            return { focusInId: '', activeId: idOf(document.activeElement), inside: false };
          }
          armed = true;
          button.disabled = true;
          button.blur();
          const focusInId = await Promise.race([
            focusIn,
            Promise.resolve().then(() => '')
          ]);
          const active = document.activeElement;
          return {
            focusInId,
            activeId: idOf(active),
            inside: Boolean(dialog.hidden === false && dialog.contains(active) && active.disabled !== true)
          };
        }, { dialogId, buttonId: row.button });
        assert.equal(result.inside, true, `${row.name} focused ${result.activeId}`);
        assert.notEqual(result.focusInId, '', `${row.name} did not observe focusin`);
        assert.notEqual(result.activeId, 'BODY', `${row.name} focused ${result.activeId}`);
        const after = await dialogFocus(opened.page, dialogId);
        assert.equal(after.open, true, row.name);
        assert.equal(after.inside, true, `${row.name} focused ${after.activeId}`);
      } catch (error) {
        failures.push(`${row.name}: ${error.message}`);
      } finally {
        await opened.page.close();
      }
    }
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    await browser.close();
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

const REMOVAL_DESCRIBED_BY = ['apply-remove-components-lead', 'apply-remove-components-parts'];

function bodySnapshot(page) {
  return page.locator('body').ariaSnapshot();
}

function addedInert(page) {
  return page.evaluate(() => [...document.querySelectorAll('[inert]')]
    .filter((el) => el.id !== 'chatgpt-signin' && el.id !== 'chatgpt-plan')
    .map((el) => el.id || el.tagName.toLowerCase()));
}

function describedNodes(page, selector) {
  return page.locator(selector).evaluate((dialog) => {
    const ids = (dialog.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    return ids.map((id) => {
      const node = document.getElementById(id);
      return {
        id,
        text: node?.textContent ?? '',
        inside: Boolean(node && dialog.contains(node))
      };
    });
  });
}

function assertDialogOnlySnapshot(snapshot, { title, lead, partRef, background }) {
  assert.equal(snapshot.includes(`alertdialog "${title}"`), true, snapshot);
  assert.equal(snapshot.includes(lead), true, snapshot);
  if (partRef) assert.equal(snapshot.includes(partRef), true, snapshot);
  for (const marker of background) {
    assert.equal(snapshot.includes(marker), false, `background still exposed (${marker})\n${snapshot}`);
  }
}

function assertBackgroundSnapshot(snapshot, { background }) {
  assert.equal(snapshot.includes('alertdialog'), false, snapshot);
  for (const marker of background) {
    assert.equal(snapshot.includes(marker), true, `background missing (${marker})\n${snapshot}`);
  }
}

async function approveFromConfirm(page) {
  const before = await page.evaluate(() => window.__sent.length);
  await page.locator('#confirm-apply-remove-components').click();
  await page.waitForFunction((start) => window.__sent.slice(start).some((raw) => {
    const call = JSON.parse(raw).payload;
    return call.name === 'schematic.patch' && call.args?.approved === true;
  }), before, { timeout: 3000 });
  return page.evaluate((start) => {
    const raw = window.__sent.slice(start).find((entry) => {
      const call = JSON.parse(entry).payload;
      return call.name === 'schematic.patch' && call.args?.approved === true;
    });
    return JSON.parse(raw).payload;
  }, before);
}

test('clicking #provider while the removal dialog is open does not move focus out, and #provider can be focused after the dialog closes', async (t) => {
  const browser = await launchPanelBrowser(t);
  if (!browser) return;
  const server = await startServer();
  const port = server.address().port;
  try {
    const opened = await openPanel(browser, port);
    try {
      await showRemovalDialog(opened.page);
      const page = opened.page;
      const dialog = page.locator('#apply-remove-components-confirm');
      assert.equal(await dialog.getAttribute('aria-modal'), 'true');
      const before = await dialogFocus(page, '#apply-remove-components-confirm');
      assert.equal(before.open, true);
      assert.equal(before.inside, true, before.activeId);
      const hit = await page.evaluate(() => {
        const provider = document.querySelector('#provider');
        const dialogEl = document.querySelector('#apply-remove-components-confirm');
        const ancestor = provider.closest('[inert]');
        const rect = provider.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const target = document.elementFromPoint(x, y);
        return {
          ancestor: ancestor ? (ancestor.id || ancestor.tagName.toLowerCase()) : '',
          dialogInert: dialogEl.hasAttribute('inert'),
          x,
          y,
          width: rect.width,
          height: rect.height,
          hit: target?.id || target?.tagName?.toLowerCase() || 'none',
          providerHit: Boolean(target && (target === provider || provider.contains(target)))
        };
      });
      assert.notEqual(hit.ancestor, '', 'removal dialog did not make the provider background inert');
      assert.equal(hit.dialogInert, false);
      assert.equal(hit.width > 0 && hit.height > 0, true, 'provider has no box');
      assert.equal(hit.providerHit, false, `click target was ${hit.hit}`);
      await page.evaluate(() => {
        window.__providerClick = { trail: [] };
        document.addEventListener('focusin', (event) => {
          window.__providerClick.trail.push(event.target?.id || event.target?.tagName || 'none');
        }, true);
      });
      await page.mouse.click(hit.x, hit.y);
      const clicked = await page.evaluate(() => {
        const provider = document.querySelector('#provider');
        provider.focus();
        const dialogEl = document.querySelector('#apply-remove-components-confirm');
        const active = document.activeElement;
        const activeId = !active || active === document.body || active === document.documentElement
          ? 'BODY'
          : (active.id || active.tagName);
        return {
          trail: window.__providerClick.trail,
          activeId,
          inside: Boolean(dialogEl.hidden === false && dialogEl.contains(active))
        };
      });
      assert.equal(clicked.trail.includes('provider'), false, `focus moved to provider: ${clicked.trail.join(',')}`);
      assert.equal(clicked.inside, true, clicked.activeId);
      assert.notEqual(clicked.activeId, 'provider');
      await page.locator('#cancel-apply-remove-components').click();
      await page.waitForFunction(() => document.querySelector('#apply-remove-components-confirm')?.hidden === true);
      assert.equal(await dialog.getAttribute('aria-modal'), null);
      assert.deepEqual(await addedInert(page), []);
      await page.locator('#provider').focus();
      assert.equal(await activeElementId(page), 'provider');
      assert.deepEqual(opened.pageErrors, []);
    } finally {
      await opened.page.close();
    }
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    await browser.close();
  }
});

test('removal confirm dialog exposes only itself and restores the background on every close', async (t) => {
  const browser = await launchPanelBrowser(t);
  if (!browser) return;
  const { en, ko } = await loadLocales();
  const server = await startServer();
  const port = server.address().port;
  const rows = [
    { name: 'removal-cancel-en', lang: 'en', kind: 'removal', close: 'cancel' },
    { name: 'removal-escape-ko', lang: 'ko', kind: 'removal', close: 'escape' },
    { name: 'removal-reconnect-en', lang: 'en', kind: 'removal', close: 'reconnect' },
    { name: 'removal-reconnect-ko', lang: 'ko', kind: 'removal', close: 'reconnect' },
    { name: 'removal-done-en', lang: 'en', kind: 'removal', close: 'confirm-done' },
    { name: 'removal-error-ko', lang: 'ko', kind: 'removal', close: 'error' },
    { name: 'without-erc-cancel-en', lang: 'en', kind: 'without-erc', close: 'cancel' },
    { name: 'without-erc-escape-ko', lang: 'ko', kind: 'without-erc', close: 'escape' }
  ];
  const failures = [];

  try {
    for (const row of rows) {
      const copy = row.lang === 'ko' ? ko : en;
      const opened = await openPanel(browser, port, row.lang);
      const dialogId = row.kind === 'removal' ? '#apply-remove-components-confirm' : '#apply-without-erc-confirm';
      const shell = [
        'heading "ChatPCB"',
        `combobox "${copy['provider.label']}"`,
        `heading "${copy['workflow.title']}"`,
        `textbox "${copy['composer.label']}"`
      ];
      const hiddenWhileOpen = [...shell, copy['patch.title']];
      try {
        if (row.close === 'reconnect') await signInChatGPT(opened.page);
        if (row.kind === 'removal') await showRemovalDialog(opened.page);
        else await showWithoutErcDialog(opened.page);
        const dialog = opened.page.locator(dialogId);
        assert.equal(await dialog.getAttribute('role'), 'alertdialog', row.name);
        assert.equal(await dialog.getAttribute('aria-modal'), 'true', row.name);
        const described = await describedNodes(opened.page, dialogId);
        if (row.kind === 'removal') {
          assert.deepEqual(described.map((item) => item.id), REMOVAL_DESCRIBED_BY, row.name);
          assert.equal(described[0].text, copy['patch.remove.lead'], row.name);
          assert.equal(described[0].inside, true, row.name);
          assert.equal(described[1].text.includes(removedPart.ref), true, described[1].text);
          assert.equal(described[1].text.includes(removedPart.value), true, described[1].text);
          assert.equal(described[1].text.includes(removedPart.libId), true, described[1].text);
          assert.equal(described[1].inside, true, row.name);
        } else {
          assert.deepEqual(described.map((item) => item.id), ['apply-without-erc-risk'], row.name);
          assert.equal(described[0].text, copy['patch.apply.without-erc.risk'], row.name);
        }
        const title = row.kind === 'removal'
          ? copy['patch.remove.title']
          : await dialog.getAttribute('aria-label');
        const lead = row.kind === 'removal'
          ? copy['patch.remove.lead']
          : copy['patch.apply.without-erc.risk'];
        assertDialogOnlySnapshot(await bodySnapshot(opened.page), {
          title,
          lead,
          partRef: row.kind === 'removal' ? removedPart.ref : '',
          background: hiddenWhileOpen
        });
        assert.equal((await addedInert(opened.page)).length > 0, true, `${row.name} background was not inert`);
        assert.equal(await dialog.getAttribute('inert'), null, row.name);

        if (row.close === 'cancel') {
          const cancelId = row.kind === 'removal' ? '#cancel-apply-remove-components' : '#cancel-apply-without-erc';
          await opened.page.locator(cancelId).click();
        } else if (row.close === 'escape') {
          await opened.page.keyboard.press('Escape');
        } else if (row.close === 'reconnect') {
          await reconnectAndRefreshAuth(opened.page);
        } else if (row.close === 'confirm-done') {
          const approve = await approveFromConfirm(opened.page);
          await emitResult(opened.page, approve.id, {
            applied: true,
            operation: 'patched',
            validation: { ok: true },
            patchId: 'patch_test'
          });
          const done = copy['patch.apply.done'].replaceAll('{refs}', removedPart.ref);
          await opened.page.waitForFunction((text) => document.querySelector('#request-status')?.textContent === text, done, { timeout: 3000 });
        } else if (row.close === 'error') {
          const approve = await approveFromConfirm(opened.page);
          await emitPayload(opened.page, approve.id, { ok: false, error: { code: 'APPLY_REJECTED', message: 'apply rejected' } });
          await opened.page.waitForFunction((text) => (
            document.querySelector('#request-status')?.dataset.state === 'failed'
            && document.querySelector('#request-status')?.textContent === text
          ), copy['request.patch-failed'], { timeout: 3000 });
        }
        await opened.page.waitForFunction((id) => document.querySelector(id)?.hidden === true, dialogId, { timeout: 3000 });
        assert.equal(await dialog.getAttribute('aria-modal'), null, `${row.name} aria-modal left behind`);
        assert.equal(await opened.page.locator('#patch-approval-card').getAttribute('aria-labelledby'), 'patch-approval-title', `${row.name} card label`);
        assert.deepEqual(await addedInert(opened.page), [], `${row.name} inert left on ${JSON.stringify(await addedInert(opened.page))}`);
        assertBackgroundSnapshot(await bodySnapshot(opened.page), { background: shell });
        assert.deepEqual(opened.pageErrors, [], row.name);
      } catch (error) {
        failures.push(`${row.name}: ${error.message}`);
      } finally {
        await opened.page.close();
      }
    }
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    await browser.close();
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});
