import './setup/isolate-home.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import test from 'node:test';

import { chromium } from 'playwright';

const panelRoot = path.resolve('apps/panel');
let browserPromise = null;
let server = null;

function findBrowserExecutable() {
  return [
    process.env.CHATPCB_BROWSER_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean).find((candidate) => existsSync(candidate));
}

async function getBrowser() {
  browserPromise ??= chromium
    .launch({ headless: true, executablePath: findBrowserExecutable(), args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    .catch((error) => ({ unavailable: error }));
  const browser = await browserPromise;
  return browser.unavailable ? null : browser;
}

test.after(async () => {
  const browser = browserPromise ? await browserPromise : null;
  if (browser && !browser.unavailable) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function startStaticServer() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
  const instance = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const file = path.join(panelRoot, pathname === '/' ? 'index.html' : pathname);
    if (!file.startsWith(panelRoot)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => instance.listen(0, '127.0.0.1', resolve));
  return instance;
}

// Opens the real panel with a fake daemon socket. startResult is what auth.chatgpt.start returns.
// reopenFailure is an { ok: false, error } tool result. reopenResultFailure nests that object in result.
// reopenThrow makes the socket throw while sending auth.chatgpt.reopen.
async function openChatGPTWaiting(t, { locale, startResult, expiresInMs, reopenFailure, reopenResultFailure, reopenThrow, signedIn, leaveProvider, rememberChatGPT, storedProvider, switchOfferDone, watchRawKeys, delayLocales, approvalFlow } = {}) {
  const browser = await getBrowser();
  if (!browser) {
    t.skip('No Chromium browser available. Set CHATPCB_BROWSER_PATH or run npx playwright install chromium.');
    return null;
  }
  server ??= await startStaticServer();
  const context = await browser.newContext({ locale });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  let releaseLocales = null;
  if (delayLocales) {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    releaseLocales = release;
    await page.route('**/locales/*.json', async (route) => {
      await gate;
      await route.continue();
    });
  }
  await page.addInitScript((config) => {
    window.__sent = [];
    window.__chatgptSignedIn = config.signedIn === true;
    if (config.storedProvider) localStorage.setItem('chatpcb.provider', config.storedProvider);
    else if (config.rememberChatGPT) localStorage.setItem('chatpcb.provider', 'chatgpt');
    if (config.switchOfferKey) localStorage.setItem(config.switchOfferKey, '1');
    if (config.watchRawKeys) {
      window.__rawI18nSeen = [];
      const note = () => {
        const card = document.querySelector('#chatgpt-auth-card');
        const text = card?.textContent ?? '';
        if (text.includes('auth.chatgpt.')) window.__rawI18nSeen.push(text);
        const connection = document.querySelector('#connection-status');
        const connectionText = connection?.textContent ?? '';
        if (connectionText.includes('connection.daemon.')) window.__rawI18nSeen.push(connectionText);
      };
      new MutationObserver(note).observe(document, { subtree: true, childList: true, characterData: true });
    }
    function chatgptPlanFields() {
      if (Object.hasOwn(window, '__chatgptPlan')) {
        return window.__chatgptPlan ? { plan: window.__chatgptPlan } : {};
      }
      return { plan: 'plus' };
    }
    class FakeSocket {
      static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
      constructor() {
        this.readyState = 0;
        this.listeners = new Map();
        queueMicrotask(() => { this.readyState = 1; this.emit('open', {}); });
      }
      addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
      emit(type, event) { for (const fn of this.listeners.get(type) ?? []) fn(event); }
      send(raw) {
        const envelope = JSON.parse(raw);
        const call = envelope.payload;
        window.__sent.push(call);
        if (call.name === 'auth.chatgpt.reopen' && config.reopenThrow) {
          throw new Error(config.reopenThrow);
        }
        let ok = true;
        let result = {};
        let error;
        let authUrl;
        if (call.name === 'auth.chatgpt.start' && config.expiresInMs) {
          window.__authExpiresAt = new Date(Date.now() + config.expiresInMs).toISOString();
          result = { ...config.start, expiresAt: window.__authExpiresAt };
        } else if (call.name === 'auth.chatgpt.start') {
          result = config.start;
        }
        if (call.name === 'auth.chatgpt.signOut') {
          window.__chatgptSignedIn = false;
          result = { state: 'signed_out' };
        }
        if (call.name === 'auth.chatgpt.status') {
          if (window.__chatgptSignedIn) {
            result = { state: 'signed_in', account: { email: 'ada@ex.com', name: 'Ada' }, ...chatgptPlanFields() };
          } else {
            const started = window.__sent.some((entry) => entry.name === 'auth.chatgpt.start');
            result = started && window.__authExpiresAt
              ? { ...config.start, state: 'waiting', expiresAt: window.__authExpiresAt }
              : { state: 'signed_out' };
          }
        }
        if (call.name === 'provider.status') {
          const provider = call.args?.provider ?? 'codex';
          result = provider === 'chatgpt' && window.__chatgptSignedIn
            ? { provider, status: 'signed-in', account: { email: 'ada@ex.com', name: 'Ada' }, ...chatgptPlanFields() }
            : { provider, status: 'signed-out' };
        }
        if (call.name === 'auth.chatgpt.reopen') {
          if (config.reopenFailure) {
            ok = false;
            error = config.reopenFailure.error;
            authUrl = config.reopenFailure.authUrl;
            result = undefined;
          } else if (config.reopenResultFailure) {
            result = { ok: false, error: config.reopenResultFailure.error, authUrl: config.reopenResultFailure.authUrl };
          } else {
            result = config.start;
          }
        }
        if (config.approvalFlow && call.name === 'project.create') {
          result = {
            projectDir: '/tmp/chatpcb-ui-project',
            displayName: call.args?.projectName || 'Board',
            slug: 'Sensor-board'
          };
        }
        if (config.approvalFlow && call.name === 'project.inspect') {
          const status = typeof window.__inspectionFreshness === 'string' && window.__inspectionFreshness
            ? window.__inspectionFreshness
            : 'missing';
          const projectDigest = typeof window.__inspectionDigest === 'string' && window.__inspectionDigest
            ? window.__inspectionDigest
            : 'abcdef123456';
          const expectedDigest = call.args?.expectedDigest;
          result = {
            manifest: { freshness: { status, reason: status === 'missing' ? 'No manifest' : `Evidence is ${status}` } },
            inspection: { projectDigest, artifactCount: 0 }
          };
          if (typeof expectedDigest === 'string' && expectedDigest.length > 0) {
            result.evidenceDigest = { projectDigest, matches: expectedDigest === projectDigest };
          }
          if (window.__holdInspect === true) {
            const socket = this;
            const heldId = call.id;
            const heldResult = result;
            window.__heldInspect = {
              emit(extra) {
                const payload = { id: heldId, ok: true, result: extra || heldResult };
                queueMicrotask(() => socket.emit('message', { data: JSON.stringify({ version: 1, id: `r_${heldId}`, type: 'tool.result', createdAt: new Date().toISOString(), payload }) }));
              }
            };
            return;
          }
          const inspectDelay = Number(window.__inspectDelayMs);
          if (Number.isFinite(inspectDelay) && inspectDelay > 0) {
            const socket = this;
            const heldId = call.id;
            const heldResult = result;
            window.__inspectDelayMs = 0;
            setTimeout(() => {
              const payload = { id: heldId, ok: true, result: heldResult };
              socket.emit('message', { data: JSON.stringify({ version: 1, id: `r_${heldId}`, type: 'tool.result', createdAt: new Date().toISOString(), payload }) });
            }, inspectDelay);
            return;
          }
        }
        if (config.approvalFlow && call.name === 'project.request') {
          const buildRequest = () => {
            if (window.__requestResult && typeof window.__requestResult === 'object') return window.__requestResult;
            const expiresAt = Number.isFinite(window.__previewExpiresAt) ? window.__previewExpiresAt : Date.now() + 120000;
            const preview = {
              requiresApproval: true,
              approved: false,
              applied: false,
              patchId: 'sha256:preview',
              expiresAt,
              operation: 'generated',
              files: {},
              conversation: { messages: [] },
              candidateVerification: { erc: { ok: true, errorCount: 0 } }
            };
            if (typeof window.__previewProjectDigest === 'string' && window.__previewProjectDigest) {
              preview.projectDigest = window.__previewProjectDigest;
            }
            if (window.__draftSource) preview.source = window.__draftSource;
            if (Array.isArray(window.__draftParts)) preview.components = window.__draftParts;
            // Removal previews set requiresApproval false and carry removedComponents.
            if (window.__removalPreview && typeof window.__removalPreview === 'object') {
              Object.assign(preview, window.__removalPreview);
            }
            if (window.__candidateErc && typeof window.__candidateErc === 'object') {
              preview.candidateVerification = { erc: window.__candidateErc };
            }
            return preview;
          };
          if (window.__holdRequest === true) {
            const socket = this;
            const heldId = call.id;
            window.__heldRequest = {
              emit() {
                const payload = { id: heldId, ok: true, result: buildRequest() };
                queueMicrotask(() => socket.emit('message', { data: JSON.stringify({ version: 1, id: `r_${heldId}`, type: 'tool.result', createdAt: new Date().toISOString(), payload }) }));
              }
            };
            return;
          }
          result = buildRequest();
        }
        if (config.approvalFlow && call.name === 'schematic.patch' && call.args?.approved === true) {
          if (window.__holdPatchResult === true) {
            const socket = this;
            const heldId = call.id;
            window.__heldPatch = {
              emit(extra = {}) {
                const payload = { id: heldId, ok: true, result: extra };
                queueMicrotask(() => socket.emit('message', { data: JSON.stringify({ version: 1, id: `r_${heldId}`, type: 'tool.result', createdAt: new Date().toISOString(), payload }) }));
              }
            };
            return;
          }
          result = window.__patchApplyResult && typeof window.__patchApplyResult === 'object'
            ? window.__patchApplyResult
            : { applied: true, operation: 'patched', validation: { ok: true } };
        }
        const payload = { id: call.id, ok, result };
        if (error) payload.error = error;
        if (authUrl) payload.authUrl = authUrl;
        queueMicrotask(() => this.emit('message', { data: JSON.stringify({ version: 1, id: `r_${call.id}`, type: 'tool.result', createdAt: new Date().toISOString(), payload }) }));
      }
      close() {}
    }
    window.WebSocket = FakeSocket;
  }, {
    start: startResult,
    expiresInMs: expiresInMs ?? null,
    reopenFailure: reopenFailure ?? null,
    reopenResultFailure: reopenResultFailure ?? null,
    reopenThrow: reopenThrow ?? null,
    signedIn: signedIn === true,
    rememberChatGPT: rememberChatGPT === true,
    storedProvider: storedProvider || '',
    switchOfferKey: switchOfferDone ? switchOfferKey('ada@ex.com') : '',
    watchRawKeys: watchRawKeys === true,
    approvalFlow: approvalFlow === true
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  const button = page.locator('.chatgpt-sign-in-btn');
  if (!leaveProvider) {
    await page.selectOption('#provider', 'chatgpt');
    if (!signedIn) await button.waitFor();
  }
  return { page, context, pageErrors, button, releaseLocales };
}

const waiting = { state: 'waiting', attemptId: 'attempt-1', authUrl: 'https://auth.openai.com/api/accounts/authorize?client_id=dynamic_agent_client&x=1' };
const signedInAccount = { state: 'signed_in', account: { email: 'ada@ex.com', name: 'Ada' }, plan: 'plus' };
const SWITCH_OFFER_HASH_HEX = 16;

function switchOfferKey(identity) {
  const hash = createHash('sha256').update(identity).digest('hex').slice(0, SWITCH_OFFER_HASH_HEX);
  return `chatpcb.chatgpt-switch-offered.${hash}`;
}

async function emitChatGPTAuth(page, payload, id = 'auth_changed') {
  await page.evaluate(({ payload: next, id: eventId }) => {
    if (next.state === 'signed_in') window.__chatgptSignedIn = true;
    if (next.state === 'signed_out') window.__chatgptSignedIn = false;
    window.__daemonSocket.emit('message', {
      data: JSON.stringify({
        version: 1,
        id: eventId,
        type: 'auth.chatgpt.changed',
        createdAt: new Date().toISOString(),
        payload: next
      })
    });
  }, { payload, id });
}

async function waitForSwitchOfferDecision(page, decision) {
  await page.waitForFunction((expected) => {
    const offer = document.querySelector('#chatgpt-switch-offer');
    const statusSeen = window.__sent.some((call) => call.name === 'auth.chatgpt.status');
    return statusSeen && offer?.dataset.decision === expected;
  }, decision);
}

test('sign-in button stays English with lang=en and shows the official logo', async (t) => {
  const opened = await openChatGPTWaiting(t, { locale: 'ko-KR', startResult: waiting });
  if (!opened) return;
  const { page, context, pageErrors, button } = opened;
  try {
    await page.setViewportSize({ width: 420, height: 800 });
    assert.equal((await button.innerText()).trim(), 'Continue with ChatGPT');
    assert.equal(await button.getAttribute('lang'), 'en');
    const logo = button.locator('img');
    assert.equal(await logo.count(), 1);
    assert.match(await logo.getAttribute('src'), /assets\/chatgpt-logo-white\.svg$/);
    assert.equal(await logo.getAttribute('alt'), '');
    assert.equal(await logo.getAttribute('aria-hidden'), 'true');
    assert.equal(await logo.getAttribute('width'), '21');
    assert.equal(await logo.getAttribute('height'), '21');
    const metrics = await button.evaluate((node) => {
      const style = getComputedStyle(node);
      const image = node.querySelector('img');
      const imageStyle = image ? getComputedStyle(image) : null;
      return {
        height: style.height,
        width: style.width,
        maxWidth: style.maxWidth,
        padding: style.padding,
        gap: style.gap,
        radius: style.borderRadius,
        lineHeight: style.lineHeight,
        fontSize: style.fontSize,
        fontWeight: String(style.fontWeight),
        fontFamily: style.fontFamily,
        imageWidth: imageStyle?.width ?? '',
        imageHeight: imageStyle?.height ?? ''
      };
    });
    assert.equal(metrics.height, '45px');
    assert.equal(metrics.width, '242px');
    assert.equal(metrics.maxWidth, '100%');
    assert.equal(metrics.padding, '0px 20px');
    assert.equal(metrics.gap, '12px');
    assert.equal(metrics.radius, '12px');
    assert.equal(metrics.lineHeight, '18px');
    assert.equal(metrics.fontSize, '15px');
    assert.equal(metrics.fontWeight, '500');
    assert.equal(metrics.fontFamily.includes('SIWC'), false, metrics.fontFamily);
    assert.match(metrics.fontFamily, /Inter/);
    assert.match(metrics.fontFamily, /system-ui/);
    assert.equal(metrics.imageWidth, '21px');
    assert.equal(metrics.imageHeight, '21px');
    assert.equal((await page.locator('#chatgpt-auth-card').innerText()).includes('LOGO?'), false);
    assert.match(await page.locator('#chatgpt-auth-card').innerText(), /ChatGPT 요금제로 ChatPCB 사용하기/);
    assert.match(await page.locator('#chatgpt-auth-card').innerText(), /ChatPCB에는 비밀번호를 입력하지 마세요/);
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test('reopen is a button that asks the daemon to open the system browser', async (t) => {
  const opened = await openChatGPTWaiting(t, { locale: 'en-US', startResult: waiting });
  if (!opened) return;
  const { page, context, pageErrors, button } = opened;
  try {
    assert.match(await page.locator('#chatgpt-auth-card').innerText(), /You'll sign in using your system browser/);
    await button.click();
    const reopen = page.locator('#chatgpt-reopen-button');
    await reopen.waitFor();
    assert.match(await page.locator('#chatgpt-auth-card').innerText(), /Finish signing in using your browser/);
    assert.equal(await page.locator('#chatgpt-auth-card a[target="_blank"]').count(), 0);
    assert.equal(await reopen.isEnabled(), true);
    assert.equal(await reopen.getByText('(opens in your browser)').count(), 1);
    assert.match(await reopen.textContent(), /^Open sign-in page again/);
    await reopen.click();
    await page.waitForFunction(() => window.__sent.some((call) => call.name === 'auth.chatgpt.reopen'));
    const call = await page.evaluate(() => window.__sent.find((entry) => entry.name === 'auth.chatgpt.reopen'));
    assert.deepEqual(call.args, { attemptId: 'attempt-1' });
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test('reopen button is disabled with a reason when the sign-in URL is missing', async (t) => {
  const opened = await openChatGPTWaiting(t, { locale: 'ko-KR', startResult: { state: 'waiting', attemptId: 'attempt-2' } });
  if (!opened) return;
  const { page, context, pageErrors, button } = opened;
  try {
    await button.click();
    const reopen = page.locator('#chatgpt-reopen-button');
    await reopen.waitFor();
    assert.equal(await reopen.isDisabled(), true);
    assert.equal((await reopen.innerText()).trim(), '로그인 페이지 다시 열기');
    assert.equal(await reopen.getAttribute('aria-describedby'), 'chatgpt-reopen-reason');
    assert.match(await page.locator('#chatgpt-reopen-reason').innerText(), /로그인 페이지 주소를 사용할 수 없어요/);
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

const browserOpenError = { code: 'open_failed', message: 'Could not open browser' };

async function assertBrowserOpenError(page, { title, pageErrors }) {
  const card = page.locator('#chatgpt-auth-card');
  await card.locator('h2', { hasText: title }).waitFor();
  assert.equal(await card.evaluate((node) => node.className), 'chatgpt-auth-card error');
  const text = await card.innerText();
  assert.ok(text.includes(title), text);
  assert.match(text, /https:\/\/auth\.openai\.com\//);
  assert.equal(await card.locator('a[href^="https://auth.openai.com/"]').count(), 1);
  await page.waitForFunction((expected) => document.querySelector('#auth-live-region')?.textContent?.includes(expected), title);
  assert.deepEqual(pageErrors, []);
}

test('reopen shows the browser-open error when the daemon returns ok:false', async (t) => {
  const opened = await openChatGPTWaiting(t, {
    locale: 'en-US',
    startResult: waiting,
    reopenFailure: { error: browserOpenError, authUrl: waiting.authUrl }
  });
  if (!opened) return;
  const { page, context, pageErrors, button } = opened;
  try {
    await button.click();
    const reopen = page.locator('#chatgpt-reopen-button');
    await reopen.waitFor();
    await reopen.click();
    await assertBrowserOpenError(page, { title: "Couldn't open your browser. Use the link below.", pageErrors });
  } finally {
    await context.close();
  }
});

test('reopen shows the browser-open error when the result is ok:false', async (t) => {
  const opened = await openChatGPTWaiting(t, {
    locale: 'ko-KR',
    startResult: waiting,
    reopenResultFailure: { error: browserOpenError, authUrl: waiting.authUrl }
  });
  if (!opened) return;
  const { page, context, pageErrors, button } = opened;
  try {
    await button.click();
    const reopen = page.locator('#chatgpt-reopen-button');
    await reopen.waitFor();
    await reopen.click();
    await assertBrowserOpenError(page, { title: '브라우저를 열 수 없어요. 아래 링크를 사용하세요.', pageErrors });
  } finally {
    await context.close();
  }
});

test('waiting card shows when the sign-in link expires', async (t) => {
  const opened = await openChatGPTWaiting(t, {
    locale: 'ko-KR',
    startResult: waiting,
    expiresInMs: 60 * 60 * 1000
  });
  if (!opened) return;
  const { page, context, pageErrors, button } = opened;
  try {
    await button.click();
    const expiry = page.locator('#chatgpt-auth-expiry');
    await expiry.waitFor();
    const expected = await page.evaluate(() => {
      const time = new Intl.DateTimeFormat('ko-KR', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      }).format(new Date(window.__authExpiresAt));
      return `이 로그인 링크는 ${time}에 만료돼요.`;
    });
    assert.equal((await expiry.innerText()).trim(), expected);
    const live = page.locator('#chatgpt-auth-status');
    await page.waitForFunction((expiryText) => {
      const line = document.querySelector('#chatgpt-auth-status');
      return line?.getAttribute('role') === 'status'
        && line.getAttribute('aria-live') === 'polite'
        && (line.textContent ?? '').includes(expiryText);
    }, expected);
    assert.equal(await live.getAttribute('role'), 'status');
    assert.equal(await live.getAttribute('aria-live'), 'polite');
    assert.equal((await live.innerText()).includes('브라우저에서 로그인을 마쳐 주세요'), false);
    const titleInsideLive = await page.evaluate(() => {
      const title = document.querySelector('#chatgpt-auth-title');
      return Boolean(title?.closest('[aria-live], [role="status"], [role="alert"]'));
    });
    assert.equal(titleInsideLive, false);
    assert.match(await page.locator('#chatgpt-auth-card').innerText(), /브라우저에서 로그인을 마쳐 주세요/);
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test('expired sign-in shows a retry button and stops polling', async (t) => {
  const opened = await openChatGPTWaiting(t, {
    locale: 'en-US',
    startResult: waiting,
    expiresInMs: 4500
  });
  if (!opened) return;
  const { page, context, pageErrors, button } = opened;
  try {
    await button.click();
    const expiry = page.locator('#chatgpt-auth-expiry');
    await expiry.waitFor();
    const expected = await page.evaluate(() => {
      const time = new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      }).format(new Date(window.__authExpiresAt));
      return `This sign-in link expires at ${time}.`;
    });
    assert.equal((await expiry.innerText()).trim(), expected);
    await page.waitForFunction(
      () => window.__sent.filter((call) => call.name === 'auth.chatgpt.status').length >= 2,
      null,
      { timeout: 8000 }
    );
    const card = page.locator('#chatgpt-auth-card');
    await card.locator('h2', { hasText: 'Sign-in timed out' }).waitFor({ timeout: 8000 });
    const text = await card.innerText();
    assert.match(text, /Nothing was saved/);
    assert.match(text, /Try again/);
    const countAtExpiry = await page.evaluate(() => window.__sent.filter((call) => call.name === 'auth.chatgpt.status').length);
    await page.waitForTimeout(2500);
    const countAfter = await page.evaluate(() => window.__sent.filter((call) => call.name === 'auth.chatgpt.status').length);
    assert.equal(countAfter, countAtExpiry);
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test('sign-out refreshes the chatgpt signed-in provider label', async (t) => {
  const opened = await openChatGPTWaiting(t, { locale: 'en-US', startResult: waiting, signedIn: true });
  if (!opened) return;
  const { page, context, pageErrors } = opened;
  try {
    await page.waitForFunction(() => document.querySelector('#provider-status')?.textContent === 'ChatGPT: connected (Plus)');
    const signOut = page.locator('#chatgpt-auth-card button', { hasText: /Sign out|sign-out/ });
    await signOut.click();
    await page.waitForFunction(() => document.querySelector('#provider-status')?.textContent === 'ChatGPT: sign-in needed');
    const names = await page.evaluate(() => window.__sent.map((call) => call.name));
    const signOutAt = names.lastIndexOf('auth.chatgpt.signOut');
    const statusAt = names.lastIndexOf('provider.status');
    assert.ok(signOutAt >= 0);
    assert.ok(statusAt > signOutAt);
    assert.equal(names[statusAt] === 'provider.status', true);
    const statusCall = await page.evaluate(() => window.__sent.filter((call) => call.name === 'provider.status').at(-1));
    assert.equal(statusCall.args.provider, 'chatgpt');
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test('remembers the selected provider across reloads', async (t) => {
  const opened = await openChatGPTWaiting(t, { locale: 'en-US', startResult: waiting, leaveProvider: true });
  if (!opened) return;
  const { page, context, pageErrors } = opened;
  try {
    assert.equal(await page.locator('#provider').inputValue(), 'codex');
    await page.selectOption('#provider', 'chatgpt');
    assert.equal(await page.evaluate(() => localStorage.getItem('chatpcb.provider')), 'chatgpt');
    await page.reload();
    assert.equal(await page.locator('#provider').inputValue(), 'chatgpt');
    await page.waitForFunction(() => window.__sent.some((call) => call.name === 'provider.status'));
    const restored = await page.evaluate(() => window.__sent.find((call) => call.name === 'provider.status'));
    assert.equal(restored.args.provider, 'chatgpt');

    await page.selectOption('#provider', 'claude');
    assert.equal(await page.evaluate(() => localStorage.getItem('chatpcb.provider')), 'claude');
    await page.reload();
    assert.equal(await page.locator('#provider').inputValue(), 'claude');

    await page.evaluate(() => localStorage.setItem('chatpcb.provider', 'not-a-provider'));
    await page.reload();
    assert.equal(await page.locator('#provider').inputValue(), 'codex');
    await page.waitForFunction(() => window.__sent.some((call) => call.name === 'provider.status'));
    const fallback = await page.evaluate(() => window.__sent.find((call) => call.name === 'provider.status'));
    assert.equal(fallback.args.provider, 'codex');
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test('reopen shows the browser-open error when opening the browser throws', async (t) => {
  const opened = await openChatGPTWaiting(t, {
    locale: 'en-US',
    startResult: waiting,
    reopenThrow: 'Could not open browser'
  });
  if (!opened) return;
  const { page, context, pageErrors, button } = opened;
  try {
    await button.click();
    const reopen = page.locator('#chatgpt-reopen-button');
    await reopen.waitFor();
    await reopen.click();
    await assertBrowserOpenError(page, { title: "Couldn't open your browser. Use the link below.", pageErrors });
  } finally {
    await context.close();
  }
});

test('login card waits for locale text and never shows raw i18n keys', async (t) => {
  const opened = await openChatGPTWaiting(t, {
    locale: 'en-US',
    startResult: waiting,
    leaveProvider: true,
    rememberChatGPT: true,
    watchRawKeys: true,
    delayLocales: true
  });
  if (!opened) return;
  const { page, context, pageErrors, releaseLocales } = opened;
  try {
    await page.waitForFunction(() => {
      const text = document.querySelector('#connection-status')?.textContent ?? '';
      return text.length > 0 && !text.includes('connection.') && !text.includes('auth.chatgpt.');
    });
    const duringDelay = await page.locator('#chatgpt-auth-card').innerText();
    const connectionDuring = await page.locator('#connection-status').innerText();
    assert.equal(duringDelay.includes('auth.chatgpt.'), false);
    assert.equal(connectionDuring.includes('connection.'), false);
    assert.equal(connectionDuring.includes('auth.chatgpt.'), false);
    assert.equal(await page.evaluate(() => window.__rawI18nSeen.length), 0);
    releaseLocales();
    await page.waitForFunction(() => document.querySelector('#chatgpt-auth-title')?.textContent === 'Use ChatPCB with your ChatGPT plan');
    const afterLoad = await page.locator('#chatgpt-auth-card').innerText();
    assert.equal(afterLoad.includes('auth.chatgpt.'), false);
    assert.match(afterLoad, /You'll sign in using your system browser/);
    assert.equal(await page.evaluate(() => window.__rawI18nSeen.length), 0);
    assert.equal(await page.locator('#connection-status').innerText(), 'Daemon connected');
    assert.deepEqual(pageErrors, []);
  } finally {
    releaseLocales?.();
    await context.close();
  }
});

test('daemon connection label stays separate from ChatGPT sign-in status', async (t) => {
  const opened = await openChatGPTWaiting(t, { locale: 'ko-KR', startResult: waiting, signedIn: true });
  if (!opened) return;
  const { page, context, pageErrors } = opened;
  try {
    const connection = page.locator('#connection-status');
    await page.waitForFunction(() => document.querySelector('#connection-status')?.textContent === '데몬 연결됨');
    assert.equal(await connection.getAttribute('data-role'), 'daemon');
    assert.equal(await connection.getAttribute('data-state'), 'ok');
    assert.equal(await connection.evaluate((node) => node.classList.contains('daemon-connection')), true);
    const before = await connection.innerText();
    assert.equal(before.includes('ChatGPT'), false);
    await page.waitForFunction(() => document.querySelector('#chatgpt-auth-title')?.textContent === 'ChatGPT에 연결됨');
    assert.notEqual(await page.locator('#chatgpt-auth-title').innerText(), before);
    assert.equal(await page.locator('#provider-status').innerText(), 'ChatGPT: 연결됨 (Plus)');
    const signedInPlan = page.locator('#chatgpt-plan');
    assert.equal(await signedInPlan.isHidden(), false);
    assert.equal(await signedInPlan.getAttribute('inert'), null);
    assert.match(await signedInPlan.innerText(), /Using ChatGPT plan/);
    assert.match(await signedInPlan.innerText(), /Manage usage/);
    const signOut = page.locator('#chatgpt-auth-card button', { hasText: /로그아웃|Sign out/ });
    await signOut.click();
    await page.waitForFunction(() => document.querySelector('#provider-status')?.textContent === 'ChatGPT: 로그인 필요');
    assert.equal(await signedInPlan.isHidden(), true);
    assert.equal(await signedInPlan.getAttribute('inert'), '');
    assert.equal(await connection.innerText(), '데몬 연결됨');
    assert.equal(await connection.getAttribute('data-state'), 'ok');
    await page.locator('.chatgpt-sign-in-btn').click();
    await page.waitForFunction(() => (document.querySelector('#chatgpt-auth-title')?.textContent ?? '').includes('브라우저에서 로그인을 마쳐 주세요'));
    assert.equal(await connection.innerText(), '데몬 연결됨');
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test('English and Korean panel catalogs have the same keys and placeholders', async () => {
  const en = JSON.parse(await readFile(path.join(panelRoot, 'locales/en.json'), 'utf8'));
  const ko = JSON.parse(await readFile(path.join(panelRoot, 'locales/ko.json'), 'utf8'));
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ko).sort());
  const placeholders = (value) => [...String(value).matchAll(/\{[a-zA-Z0-9_-]+\}/g)].map((match) => match[0]).sort();
  for (const key of Object.keys(en)) {
    assert.deepEqual(placeholders(en[key]), placeholders(ko[key]), key);
  }
});

test('approval copy is plain language in English and Korean', async () => {
  const en = JSON.parse(await readFile(path.join(panelRoot, 'locales/en.json'), 'utf8'));
  const ko = JSON.parse(await readFile(path.join(panelRoot, 'locales/ko.json'), 'utf8'));
  assert.equal(en['approval.no-manifest'], 'Parts list will be checked after you apply to the schematic.');
  assert.equal(ko['approval.no-manifest'], '부품 목록은 스키매틱에 적용한 뒤 확인돼요.');
  assert.equal(
    en['approval.no-manifest-detail'],
    'The patch is still matched to the current files before anything is written.'
  );
  assert.equal(
    ko['approval.no-manifest-detail'],
    '파일을 쓰기 전에 패치가 현재 파일과 일치하는지도 확인해요.'
  );
  for (const copy of [en, ko]) {
    assert.equal(copy['approval.no-manifest'].includes('manifest'), false);
    assert.equal(copy['approval.no-manifest-detail'].includes('manifest'), false);
    assert.equal(copy['approval.no-manifest'].includes('part evidence'), false);
  }
});

test('missing manifest approval uses plain language on the card and in technical details', async (t) => {
  const opened = await openChatGPTWaiting(t, {
    locale: 'en-US',
    startResult: waiting,
    leaveProvider: true,
    approvalFlow: true
  });
  if (!opened) return;
  const { page, context, pageErrors } = opened;
  try {
    await page.waitForFunction(() => document.querySelector('#connection-status')?.textContent === 'Daemon connected');
    await page.locator('#project-name').fill('Sensor board');
    await page.locator('#new-project-form').getByRole('button', { name: 'New project' }).click();
    await page.getByRole('status', { name: 'Active project' }).waitFor();
    await page.locator('#prompt').fill('ESP32-S3 sensor board');
    await page.locator('#composer').getByRole('button', { name: 'Send' }).click();
    const status = page.locator('#patch-approval-status');
    await page.waitForFunction(() => (
      document.querySelector('#patch-approval-status')?.textContent
        === 'Parts list will be checked after you apply to the schematic.'
    ));
    assert.equal((await status.innerText()).includes('manifest'), false);
    assert.equal((await status.innerText()).includes('part evidence'), false);
    const detail = page.locator('#patch-approval-technical-detail');
    assert.equal(
      await detail.evaluate((node) => node.textContent),
      'The patch is still matched to the current files before anything is written.'
    );
    assert.equal((await detail.evaluate((node) => node.textContent)).includes('manifest'), false);
    assert.equal(await page.locator('#patch-approval-technical-details').isHidden(), false);
    assert.equal(await page.locator('#connection-status').innerText(), 'Daemon connected');
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test('draft card shows the generator source and profile parts', async (t) => {
  const opened = await openChatGPTWaiting(t, {
    locale: 'en-US',
    startResult: waiting,
    leaveProvider: true,
    approvalFlow: true
  });
  if (!opened) return;
  const { page, context, pageErrors } = opened;
  try {
    await page.waitForFunction(() => document.querySelector('#connection-status')?.textContent === 'Daemon connected');
    await page.evaluate(() => {
      window.__draftSource = { provider: 'chatgpt', via: 'provider' };
      window.__draftParts = [
        { ref: 'U1', value: 'TPS62177DQC', libId: 'Regulator_Switching:TPS62177DQC' },
        { ref: 'R4', value: '4.7k', libId: 'Device:R' }
      ];
    });
    await page.locator('#project-name').fill('Sensor board');
    await page.locator('#new-project-form').getByRole('button', { name: 'New project' }).click();
    await page.getByRole('status', { name: 'Active project' }).waitFor();
    await page.locator('#prompt').fill('ESP32-S3 sensor board with a 3.3V regulator');
    await page.locator('#composer').getByRole('button', { name: 'Send' }).click();
    await page.waitForFunction(() => document.querySelector('#patch-approval-source')?.textContent === 'Generated by ChatGPT');
    const partsText = await page.locator('#patch-approval-parts').innerText();
    assert.match(partsText, /TPS62177DQC/);
    assert.match(partsText, /4\.7k/);
    assert.equal(
      await page.locator('#patch-approval-status').innerText(),
      'Parts list will be checked after you apply to the schematic.'
    );
    await page.evaluate(() => {
      window.__draftSource = { provider: null, via: 'native-fallback' };
    });
    await page.locator('#prompt').fill('ESP32-S3 sensor board with a 3.3V regulator');
    await page.locator('#composer').getByRole('button', { name: 'Send' }).click();
    await page.waitForFunction(() => document.querySelector('#patch-approval-source')?.textContent === 'Built-in generator');
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test('sign-in completion refreshes the chatgpt provider label', async (t) => {
  const opened = await openChatGPTWaiting(t, { locale: 'en-US', startResult: waiting });
  if (!opened) return;
  const { page, context, pageErrors } = opened;
  try {
    await page.waitForFunction(() => document.querySelector('#provider-status')?.textContent === 'ChatGPT: sign-in needed');
    const before = await page.evaluate(() => window.__sent.filter((call) => call.name === 'provider.status').length);
    await page.evaluate(() => {
      window.__chatgptSignedIn = true;
      window.__daemonSocket.emit('message', {
        data: JSON.stringify({
          version: 1,
          id: 'auth_changed_in',
          type: 'auth.chatgpt.changed',
          createdAt: new Date().toISOString(),
          payload: { state: 'signed_in', account: { email: 'ada@ex.com', name: 'Ada' }, plan: 'plus' }
        })
      });
    });
    await page.waitForFunction(() => document.querySelector('#provider-status')?.textContent === 'ChatGPT: connected (Plus)');
    assert.equal(await page.evaluate(() => document.querySelector('#provider option[value="chatgpt"]')?.disabled === true), true);
    assert.equal(await page.evaluate(() => document.querySelector('#provider option[value="chatgpt"]')?.textContent), 'ChatGPT');
    const plan = page.locator('#chatgpt-plan');
    assert.equal(await plan.isHidden(), false);
    assert.equal(await plan.getAttribute('inert'), null);
    assert.match(await plan.innerText(), /Using ChatGPT plan/);
    assert.match(await plan.innerText(), /Manage usage/);
    const usage = page.locator('#chatgpt-auth-card span[lang="en"]');
    assert.equal((await usage.allInnerTexts()).includes('Usage'), true);
    const afterSignIn = await page.evaluate(() => window.__sent.filter((call) => call.name === 'provider.status').length);
    assert.ok(afterSignIn > before);
    await page.evaluate(() => {
      window.__chatgptSignedIn = false;
      window.__daemonSocket.emit('message', {
        data: JSON.stringify({
          version: 1,
          id: 'auth_changed_out',
          type: 'auth.chatgpt.changed',
          createdAt: new Date().toISOString(),
          payload: { state: 'signed_out' }
        })
      });
    });
    await page.waitForFunction(() => document.querySelector('#provider-status')?.textContent === 'ChatGPT: sign-in needed');
    assert.equal(await page.evaluate(() => document.querySelector('#provider option[value="chatgpt"]')?.disabled === true), false);
    assert.equal(await page.evaluate(() => document.querySelector('#provider option[value="chatgpt"]')?.textContent), 'ChatGPT (sign-in)');
    assert.equal(await plan.isHidden(), true);
    assert.equal(await plan.getAttribute('inert'), '');
    const afterSignOut = await page.evaluate(() => window.__sent.filter((call) => call.name === 'provider.status').length);
    assert.ok(afterSignOut > afterSignIn);
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test('signed-in ChatGPT omits parentheses when no plan is reported', async (t) => {
  const cases = [
    { locale: 'en-US', signedOut: 'ChatGPT: sign-in needed', connected: 'ChatGPT: connected' },
    { locale: 'ko-KR', signedOut: 'ChatGPT: 로그인 필요', connected: 'ChatGPT: 연결됨' }
  ];
  for (const item of cases) {
    const opened = await openChatGPTWaiting(t, { locale: item.locale, startResult: waiting });
    if (!opened) return;
    const { page, context, pageErrors } = opened;
    try {
      await page.waitForFunction((text) => document.querySelector('#provider-status')?.textContent === text, item.signedOut);
      await page.evaluate(() => {
        window.__chatgptPlan = '';
        window.__chatgptSignedIn = true;
        window.__daemonSocket.emit('message', {
          data: JSON.stringify({
            version: 1,
            id: 'auth_changed_no_plan',
            type: 'auth.chatgpt.changed',
            createdAt: new Date().toISOString(),
            payload: { state: 'signed_in', account: { email: 'ada@ex.com', name: 'Ada' } }
          })
        });
      });
      await page.waitForFunction((text) => document.querySelector('#provider-status')?.textContent === text, item.connected);
      const status = await page.locator('#provider-status').innerText();
      assert.equal(status.includes('()'), false, status);
      assert.equal(await page.evaluate(() => document.querySelector('#provider option[value="chatgpt"]')?.disabled === true), true);
      assert.equal(await page.evaluate(() => document.querySelector('#provider option[value="chatgpt"]')?.textContent), 'ChatGPT');
      assert.deepEqual(pageErrors, []);
    } finally {
      await context.close();
    }
  }
});

test('ChatGPT switch offer copy is in both locales', async () => {
  const en = JSON.parse(await readFile(path.join(panelRoot, 'locales/en.json'), 'utf8'));
  const ko = JSON.parse(await readFile(path.join(panelRoot, 'locales/ko.json'), 'utf8'));
  assert.equal(en['auth.chatgpt.switch-offer.prompt'], 'Switch to ChatGPT?');
  assert.equal(ko['auth.chatgpt.switch-offer.prompt'], 'ChatGPT로 전환할까요?');
  assert.equal(en['auth.chatgpt.switch-offer.accept'], 'Switch');
  assert.equal(ko['auth.chatgpt.switch-offer.accept'], '전환');
  assert.equal(en['auth.chatgpt.switch-offer.dismiss'], 'Not now');
  assert.equal(ko['auth.chatgpt.switch-offer.dismiss'], '나중에');
});

test('sign-in does not change the selected provider', async (t) => {
  const opened = await openChatGPTWaiting(t, { locale: 'en-US', startResult: waiting, leaveProvider: true });
  if (!opened) return;
  const { page, context, pageErrors } = opened;
  try {
    await page.selectOption('#provider', 'grok');
    await page.waitForFunction(() => document.querySelector('#provider-status')?.textContent === 'Provider status is unavailable.');
    const before = await page.evaluate(() => window.__sent.filter((call) => call.name === 'provider.status').length);
    await emitChatGPTAuth(page, signedInAccount, 'auth_changed_keep');
    await page.waitForFunction((start) => (
      window.__sent.filter((call) => call.name === 'provider.status').length > start
    ), before);
    assert.equal(await page.locator('#provider').inputValue(), 'grok');
    assert.equal(await page.evaluate(() => localStorage.getItem('chatpcb.provider')), 'grok');
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test('first sign-in offers a switch that selects and remembers ChatGPT', async (t) => {
  const opened = await openChatGPTWaiting(t, { locale: 'en-US', startResult: waiting, leaveProvider: true });
  if (!opened) return;
  const { page, context, pageErrors } = opened;
  try {
    await page.selectOption('#provider', 'grok');
    await emitChatGPTAuth(page, signedInAccount, 'auth_changed_offer');
    const offer = page.locator('#chatgpt-switch-offer');
    await page.waitForFunction(() => document.querySelector('#chatgpt-switch-offer-text')?.textContent === 'Switch to ChatGPT?');
    assert.equal(await offer.isHidden(), false);
    assert.equal((await page.locator('#chatgpt-switch-offer-accept').innerText()).trim(), 'Switch');
    assert.equal((await page.locator('#chatgpt-switch-offer-dismiss').innerText()).trim(), 'Not now');
    assert.equal(await page.locator('#provider').inputValue(), 'grok');
    await page.locator('#chatgpt-switch-offer-accept').click();
    assert.equal(await page.locator('#provider').inputValue(), 'chatgpt');
    assert.equal(await page.evaluate(() => localStorage.getItem('chatpcb.provider')), 'chatgpt');
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), switchOfferKey('ada@ex.com')), '1');
    assert.equal(await page.evaluate(() => localStorage.getItem('chatpcb.chatgpt-switch-offered')), null);
    assert.equal(await offer.isHidden(), true);
    await page.reload();
    assert.equal(await page.locator('#provider').inputValue(), 'chatgpt');
    await waitForSwitchOfferDecision(page, 'hidden');
    assert.equal(await page.locator('#chatgpt-switch-offer').isHidden(), true);
    assert.equal(await page.evaluate(() => localStorage.getItem('chatpcb.provider')), 'chatgpt');
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test('not now keeps the provider and the switch offer does not return', async (t) => {
  const opened = await openChatGPTWaiting(t, { locale: 'en-US', startResult: waiting, leaveProvider: true });
  if (!opened) return;
  const { page, context, pageErrors } = opened;
  try {
    await page.selectOption('#provider', 'grok');
    await emitChatGPTAuth(page, signedInAccount, 'auth_changed_dismiss');
    await page.waitForFunction(() => document.querySelector('#chatgpt-switch-offer-text')?.textContent === 'Switch to ChatGPT?');
    await page.locator('#chatgpt-switch-offer-dismiss').click();
    assert.equal(await page.locator('#provider').inputValue(), 'grok');
    assert.equal(await page.evaluate(() => localStorage.getItem('chatpcb.provider')), 'grok');
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), switchOfferKey('ada@ex.com')), '1');
    assert.equal(await page.evaluate(() => localStorage.getItem('chatpcb.chatgpt-switch-offered')), null);
    assert.equal(await page.locator('#chatgpt-switch-offer').isHidden(), true);
    await page.reload();
    await waitForSwitchOfferDecision(page, 'hidden');
    assert.equal(await page.locator('#provider').inputValue(), 'grok');
    assert.equal(await page.locator('#chatgpt-switch-offer').isHidden(), true);
    await emitChatGPTAuth(page, signedInAccount, 'auth_changed_again');
    assert.equal(await page.locator('#chatgpt-switch-offer').isHidden(), true);
    assert.equal(await page.locator('#chatgpt-switch-offer').getAttribute('data-decision'), 'hidden');
    assert.equal(await page.locator('#provider').inputValue(), 'grok');
    assert.equal(await page.evaluate(() => localStorage.getItem('chatpcb.provider')), 'grok');
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test('loading already signed in after the offer does not show it', async (t) => {
  const opened = await openChatGPTWaiting(t, {
    locale: 'en-US',
    startResult: waiting,
    leaveProvider: true,
    signedIn: true,
    storedProvider: 'claude',
    switchOfferDone: true
  });
  if (!opened) return;
  const { page, context, pageErrors } = opened;
  try {
    await waitForSwitchOfferDecision(page, 'hidden');
    assert.equal(await page.locator('#provider').inputValue(), 'claude');
    assert.equal(await page.evaluate(() => localStorage.getItem('chatpcb.provider')), 'claude');
    assert.equal(await page.locator('#chatgpt-switch-offer').isHidden(), true);
    assert.equal((await page.locator('#chatgpt-switch-offer-text').textContent()) ?? '', '');
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test('a different ChatGPT account is offered the switch once', async (t) => {
  const opened = await openChatGPTWaiting(t, { locale: 'en-US', startResult: waiting, leaveProvider: true });
  if (!opened) return;
  const { page, context, pageErrors } = opened;
  const ada = { state: 'signed_in', account: { email: 'ada@ex.com', name: 'Ada' }, plan: 'plus' };
  const bob = { state: 'signed_in', account: { email: 'bob@ex.com', name: 'Bob' }, plan: 'plus' };
  const cara = { state: 'signed_in', account: { sub: 'user_cara', email: 'ada@ex.com', name: 'Cara' }, plan: 'plus' };
  try {
    await page.selectOption('#provider', 'grok');
    await emitChatGPTAuth(page, ada, 'auth_changed_ada');
    await page.waitForFunction(() => {
      const offer = document.querySelector('#chatgpt-switch-offer');
      return offer?.dataset.decision === 'shown' && offer.hidden === false;
    });
    await page.locator('#chatgpt-switch-offer-dismiss').click();
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), switchOfferKey('ada@ex.com')), '1');
    assert.equal(await page.evaluate(() => localStorage.getItem('chatpcb.chatgpt-switch-offered')), null);
    assert.equal(await page.locator('#provider').inputValue(), 'grok');

    await emitChatGPTAuth(page, bob, 'auth_changed_bob');
    await page.waitForFunction(() => {
      const offer = document.querySelector('#chatgpt-switch-offer');
      return offer?.dataset.decision === 'shown' && offer.hidden === false;
    }, null, { timeout: 4000 });
    await page.locator('#chatgpt-switch-offer-dismiss').click();
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), switchOfferKey('bob@ex.com')), '1');
    await emitChatGPTAuth(page, ada, 'auth_changed_ada_again');
    await waitForSwitchOfferDecision(page, 'hidden');
    await emitChatGPTAuth(page, bob, 'auth_changed_bob_again');
    await waitForSwitchOfferDecision(page, 'hidden');
    assert.equal(await page.locator('#provider').inputValue(), 'grok');

    const beforeCara = await page.evaluate(() => Object.keys(localStorage));
    await emitChatGPTAuth(page, cara, 'auth_changed_cara');
    await page.waitForFunction(() => {
      const offer = document.querySelector('#chatgpt-switch-offer');
      return offer?.dataset.decision === 'shown' && offer.hidden === false;
    }, null, { timeout: 4000 });
    await page.locator('#chatgpt-switch-offer-dismiss').click();
    const added = await page.evaluate((previous) => (
      Object.keys(localStorage).filter((key) => !previous.includes(key))
    ), beforeCara);
    assert.deepEqual(added, [switchOfferKey('user_cara')]);
    await emitChatGPTAuth(page, cara, 'auth_changed_cara_again');
    await waitForSwitchOfferDecision(page, 'hidden');

    const stored = await page.evaluate(() => {
      const entries = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        entries.push([key, localStorage.getItem(key)]);
      }
      return entries;
    });
    const flat = JSON.stringify(stored);
    assert.equal(flat.includes('ada@ex.com'), false);
    assert.equal(flat.includes('bob@ex.com'), false);
    assert.equal(flat.includes('user_cara'), false);
    assert.equal(await page.locator('#provider').inputValue(), 'grok');
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

const REMOVED_PARTS = [
  { ref: 'J2', value: 'I2C_CONNECTOR', libId: 'ChatPCB:I2C_CONNECTOR' },
  { ref: 'R3', value: '1k', libId: 'Device:R' }
];

function removalConfirmCopy() {
  return Promise.all([
    readFile(path.join(panelRoot, 'locales/en.json'), 'utf8'),
    readFile(path.join(panelRoot, 'locales/ko.json'), 'utf8')
  ]).then(([en, ko]) => ({
    en: JSON.parse(en),
    ko: JSON.parse(ko)
  }));
}

async function openApprovalPanel(t, locale) {
  const opened = await openChatGPTWaiting(t, {
    locale,
    startResult: waiting,
    leaveProvider: true,
    approvalFlow: true
  });
  if (!opened) return null;
  const connected = locale.startsWith('ko') ? '데몬 연결됨' : 'Daemon connected';
  await opened.page.waitForFunction((label) => (
    document.querySelector('#connection-status')?.textContent === label
  ), connected);
  await opened.page.locator('#project-name').fill('Sensor board');
  await opened.page.locator('#new-project-form button[type="submit"]').click();
  await opened.page.locator('#active-project').waitFor();
  return opened;
}

async function sendRemovalPreview(page, parts = REMOVED_PARTS) {
  await page.evaluate((removed) => {
    window.__removalPreview = {
      requiresApproval: false,
      approved: false,
      applied: false,
      removedComponents: removed,
      reason: {
        code: 'EXISTING_COMPONENTS_REMOVED',
        removedComponents: removed
      }
    };
  }, parts);
  await page.locator('#prompt').fill('Remove the I2C connector from this board');
  await page.locator('#composer button[type="submit"]').click();
}

function approvedApplyCalls(page) {
  return page.evaluate(() => window.__sent.filter((call) => (
    call.name === 'schematic.patch' && call.args?.approved === true
  )));
}

async function describedRemovalText(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('#apply-remove-components-confirm');
    const ids = (dialog?.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    return ids.map((id) => document.getElementById(id)?.textContent ?? '').join('\n');
  });
}

test('removed-part confirm copy exists in English and Korean', async () => {
  const { en, ko } = await removalConfirmCopy();
  assert.equal(en['patch.remove.cancel'], "Don't apply");
  assert.equal(en['patch.remove.confirm'], 'Apply and remove these parts');
  assert.equal(en['patch.remove.title'], 'Remove existing parts?');
  assert.equal(en['patch.remove.lead'], 'This draft removes existing parts. Applying deletes them from the schematic.');
  assert.equal(ko['patch.remove.cancel'], '적용하지 않기');
  assert.equal(ko['patch.remove.confirm'], '이 부품을 빼고 적용');
  assert.equal(ko['patch.remove.title'], '기존 부품을 빼고 적용할까요?');
  assert.equal(ko['patch.remove.lead'], '이 초안은 기존 부품을 스키매틱에서 빼요. 적용하면 아래 부품이 삭제돼요.');
  assert.equal(en['patch.apply.progress'], 'Adding it to the schematic…');
  assert.equal(en['patch.apply.summary'], 'Applying the circuit draft…');
  assert.equal(ko['patch.apply.progress'], '스키매틱에 넣는 중…');
  assert.equal(ko['patch.apply.summary'], '회로 초안을 적용하는 중…');
  assert.equal(en['patch.apply.done'], 'Patch applied: removed {refs}');
  assert.equal(ko['patch.apply.done'], '패치를 적용했어요. 뺀 부품: {refs}');
  assert.equal(en['patch.apply.applied'], 'Patch applied.');
  assert.equal(ko['patch.apply.applied'], '패치를 적용했어요.');
  assert.equal(en['patch.apply.blocked-disabled'], 'This preview cannot be applied.');
  assert.equal(ko['patch.apply.blocked-disabled'], '이 미리보기는 적용할 수 없어요.');
  for (const key of [
    'patch.remove.cancel', 'patch.remove.confirm', 'patch.remove.title', 'patch.remove.lead',
    'patch.apply.progress', 'patch.apply.summary', 'patch.apply.done', 'patch.apply.applied',
    'patch.apply.blocked-disabled'
  ]) {
    assert.notEqual(ko[key], en[key], key);
  }
  const panel = await readFile(path.join(panelRoot, 'panel.js'), 'utf8');
  const confirmStart = panel.indexOf('function confirmRemovalApply');
  const confirmEnd = panel.indexOf('function approvePatch');
  const confirmBody = panel.slice(confirmStart, confirmEnd);
  assert.match(confirmBody, /t\('patch\.apply\.progress'\)/);
  assert.match(confirmBody, /summaryKey: 'patch\.apply\.summary'/);
  assert.equal(confirmBody.includes('스키매틱에 넣는 중…'), false);
  assert.equal(confirmBody.includes('Applying the circuit draft…'), false);
  const approveStart = panel.indexOf('function approvePatch(');
  const approveEnd = panel.indexOf('function hideApplyWithoutErcConfirm');
  const approveBody = panel.slice(approveStart, approveEnd);
  assert.match(approveBody, /t\('patch\.apply\.progress'\)/);
  assert.match(approveBody, /summaryKey: 'patch\.apply\.summary'/);
  assert.equal(approveBody.includes('Applying the circuit draft…'), false);
  assert.equal(approveBody.includes('스키매틱에 넣는 중…'), false);
});

test('applyGateOpen refuses an apply that is already in progress', async () => {
  const panel = await readFile(path.join(panelRoot, 'panel.js'), 'utf8');
  const start = panel.indexOf('function applyGateOpen(');
  const end = panel.indexOf('\nfunction ', start + 1);
  assert.ok(start >= 0 && end > start);
  const body = panel.slice(start, end).split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
  assert.match(body, /if\s*\(\s*patchApplyBusy\(\)\s*\)\s*return false;/);
});

test('EXISTING_COMPONENTS_REMOVED preview lists parts and cancel sends no apply', async (t) => {
  const opened = await openApprovalPanel(t, 'en-US');
  if (!opened) return;
  const { page, context, pageErrors } = opened;
  const { en } = await removalConfirmCopy();
  try {
    await page.locator('#prompt').fill('ESP32-S3 sensor board');
    await page.locator('#composer').getByRole('button', { name: 'Send' }).click();
    await page.waitForFunction(() => document.querySelector('#approve-patch-button')?.disabled === false);
    assert.equal(await page.locator('#apply-remove-components-confirm').isVisible(), false);
    await page.locator('#approve-patch-button').click();
    await page.waitForFunction(() => document.querySelector('#patch-approval-card')?.hidden === true);
    const plain = await approvedApplyCalls(page);
    assert.equal(plain.length, 1);
    assert.equal(Object.hasOwn(plain[0].args, 'allowRemovedComponents'), false);

    await sendRemovalPreview(page);
    const dialog = page.locator('#apply-remove-components-confirm');
    await page.waitForFunction(() => {
      const node = document.querySelector('#apply-remove-components-confirm');
      return node && node.hidden === false;
    });
    assert.equal(await dialog.isVisible(), true);
    assert.equal(await dialog.getAttribute('role'), 'alertdialog');
    const describedBy = await dialog.getAttribute('aria-describedby');
    assert.ok(describedBy);
    const describedText = await describedRemovalText(page);
    for (const part of REMOVED_PARTS) {
      assert.equal(describedText.includes(part.ref), true, describedText);
      assert.equal(describedText.includes(String(part.value)), true, describedText);
      assert.equal(describedText.includes(part.libId), true, describedText);
    }
    await page.waitForFunction(() => document.activeElement?.id === 'cancel-apply-remove-components');
    assert.equal(await page.locator('#cancel-apply-remove-components').innerText(), en['patch.remove.cancel']);
    assert.equal(await page.locator('#confirm-apply-remove-components').innerText(), en['patch.remove.confirm']);
    assert.equal(await page.locator('#cancel-apply-remove-components').evaluate((node) => node.classList.contains('btn-primary')), true);
    assert.equal(await page.locator('#confirm-apply-remove-components').evaluate((node) => node.classList.contains('btn-quiet-danger')), true);
    assert.equal(await page.locator('#cancel-apply-without-erc').evaluate((node) => node.classList.contains('btn-primary')), true);
    assert.equal(await page.locator('#confirm-apply-without-erc').evaluate((node) => node.classList.contains('btn-quiet-danger')), true);
    assert.equal(await page.locator('#apply-remove-components-lead').innerText(), en['patch.remove.lead']);
    assert.equal(await dialog.getAttribute('aria-labelledby'), 'apply-remove-components-title');
    assert.equal(await page.locator('#apply-remove-components-title').innerText(), en['patch.remove.title']);
    assert.equal(await dialog.getAttribute('aria-describedby'), 'apply-remove-components-parts');
    assert.equal(await dialog.getAttribute('aria-label'), null);
    await page.keyboard.press('Shift+Tab');
    await page.waitForFunction(() => document.activeElement?.id === 'confirm-apply-remove-components');
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => document.activeElement?.id === 'cancel-apply-remove-components');
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => document.activeElement?.id === 'confirm-apply-remove-components');
    assert.equal(await page.evaluate(() => (
      document.querySelector('#apply-remove-components-confirm')?.contains(document.activeElement) === true
    )), true);
    await page.keyboard.press('Shift+Tab');
    await page.waitForFunction(() => document.activeElement?.id === 'cancel-apply-remove-components');

    await page.keyboard.press('Escape');
    await page.waitForFunction(() => (
      document.querySelector('#apply-remove-components-confirm')?.hidden === true
      && document.activeElement?.id === 'approve-patch-button'
    ));
    assert.equal((await approvedApplyCalls(page)).length, 1);

    await page.locator('#approve-patch-button').click();
    await page.waitForFunction(() => {
      const node = document.querySelector('#apply-remove-components-confirm');
      return node && node.hidden === false && document.activeElement?.id === 'cancel-apply-remove-components';
    });
    assert.equal((await approvedApplyCalls(page)).length, 1);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => (
      document.querySelector('#apply-remove-components-confirm')?.hidden === true
      && document.activeElement?.id === 'approve-patch-button'
    ));
    assert.equal((await approvedApplyCalls(page)).length, 1);

    await page.locator('#approve-patch-button').click();
    await page.waitForFunction(() => {
      const node = document.querySelector('#apply-remove-components-confirm');
      return node && node.hidden === false && document.activeElement?.id === 'cancel-apply-remove-components';
    });
    await page.locator('#cancel-apply-remove-components').click();
    await page.waitForFunction(() => (
      document.querySelector('#apply-remove-components-confirm')?.hidden === true
      && document.activeElement?.id === 'approve-patch-button'
    ));
    assert.equal((await approvedApplyCalls(page)).length, 1);
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test('confirming removal keeps focus on the status heading for mouse and keyboard', async (t) => {
  for (const locale of ['en-US', 'ko-KR']) {
    for (const theme of ['light', 'dark']) {
      for (const input of ['mouse', 'keyboard']) {
        const opened = await openApprovalPanel(t, locale);
        if (!opened) return;
        const { page, context, pageErrors } = opened;
        try {
          await page.evaluate((next) => {
            document.documentElement.dataset.theme = next;
          }, theme);
          await sendRemovalPreview(page);
          await page.waitForFunction(() => {
            const node = document.querySelector('#apply-remove-components-confirm');
            return node && node.hidden === false && document.activeElement?.id === 'cancel-apply-remove-components';
          });
          await page.evaluate(() => {
            window.__requestFocusAnnounce = null;
            document.querySelector('#request-result-heading')?.addEventListener('focus', () => {
              const heading = document.activeElement;
              const live = document.querySelector('#request-status-live');
              window.__requestFocusAnnounce = {
                insideLive: Boolean(heading?.closest('[aria-live], [role="status"], [role="alert"]')),
                liveText: live?.textContent ?? ''
              };
            }, { once: true });
          });
          if (input === 'keyboard') {
            await page.keyboard.press('Tab');
            await page.waitForFunction(() => document.activeElement?.id === 'confirm-apply-remove-components');
            await page.keyboard.press('Enter');
          } else {
            await page.locator('#confirm-apply-remove-components').click();
          }
          await page.waitForFunction(() => {
            const status = document.querySelector('#request-status');
            const active = document.activeElement;
            if (!status || !active || active === document.body) return false;
            const nested = [...status.querySelectorAll('h1, h2, h3, h4')].find((node) => node.tabIndex === -1);
            const heading = nested || (status.matches('h1, h2, h3, h4') && status.tabIndex === -1 ? status : null);
            return Boolean(heading) && active === heading;
          }, null, { timeout: 3000 });
          const focus = await page.evaluate(() => {
            const status = document.querySelector('#request-status');
            const active = document.activeElement;
            const nested = [...(status?.querySelectorAll('h1, h2, h3, h4') ?? [])].find((node) => node.tabIndex === -1);
            const heading = nested || (status?.matches('h1, h2, h3, h4') && status.tabIndex === -1 ? status : null);
            const rect = heading?.getBoundingClientRect();
            return {
              theme: document.documentElement.dataset.theme,
              activeIsBody: active === document.body,
              focusedIsHeading: Boolean(heading) && active === heading,
              tabIndex: heading ? heading.tabIndex : null,
              visible: Boolean(rect && rect.width > 0 && rect.height > 0),
              text: heading?.textContent ?? ''
            };
          });
          assert.equal(focus.theme, theme, `${locale}/${theme}/${input}`);
          assert.equal(focus.activeIsBody, false, `${locale}/${theme}/${input}`);
          assert.equal(focus.focusedIsHeading, true, `${locale}/${theme}/${input}`);
          assert.equal(focus.tabIndex, -1, `${locale}/${theme}/${input}`);
          assert.equal(focus.visible, true, `${locale}/${theme}/${input}`);
          assert.equal(focus.text.length > 0, true, `${locale}/${theme}/${input}`);
          const announce = await page.evaluate(() => window.__requestFocusAnnounce);
          assert.equal(announce?.insideLive, false, `${locale}/${theme}/${input} heading is inside a live region`);
          assert.equal(announce?.liveText ?? '', '', `${locale}/${theme}/${input} live region repeated the focused heading`);
          const settled = await page.evaluate(() => {
            const heading = document.querySelector('#request-result-heading');
            const live = document.querySelector('#request-status-live');
            return {
              liveRole: live?.getAttribute('role') ?? '',
              liveText: live?.textContent ?? '',
              heading: heading?.textContent ?? ''
            };
          });
          assert.equal(settled.liveRole, 'status', `${locale}/${theme}/${input} live role`);
          assert.equal(settled.liveText, settled.heading, `${locale}/${theme}/${input} later status was not announced`);
          assert.deepEqual(pageErrors, []);
        } finally {
          await context.close();
        }
      }
    }
  }
});

test('confirming removed parts sends allowRemovedComponents with the exact refs', async (t) => {
  const opened = await openApprovalPanel(t, 'en-US');
  if (!opened) return;
  const { page, context, pageErrors } = opened;
  const { en } = await removalConfirmCopy();
  try {
    await sendRemovalPreview(page);
    await page.waitForFunction(() => {
      const node = document.querySelector('#apply-remove-components-confirm');
      return node && node.hidden === false && document.activeElement?.id === 'cancel-apply-remove-components';
    });
    await page.evaluate(() => {
      window.__applyRunning = [];
      const status = document.querySelector('#request-status');
      const note = () => {
        if (status?.dataset.state === 'running') window.__applyRunning.push(status.textContent);
      };
      new MutationObserver(note).observe(status, { attributes: true, childList: true, subtree: true, characterData: true });
    });
    await page.locator('#confirm-apply-remove-components').click();
    const calls = await approvedApplyCalls(page);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args.approved, true);
    assert.equal(calls[0].args.patchId, 'sha256:preview');
    assert.deepEqual(calls[0].args.allowRemovedComponents, REMOVED_PARTS.map((part) => part.ref));
    const running = await page.evaluate(() => window.__applyRunning);
    assert.equal(running.includes(en['patch.apply.summary']), true, JSON.stringify(running));
    const removalApply = page.locator('#request-progress li[data-stage="apply"]').last();
    assert.equal((await removalApply.locator('strong').innerText()).trim(), en['progress.apply']);
    assert.equal(await removalApply.locator('p').count(), 0);
    const done = en['patch.apply.done'].replaceAll('{refs}', REMOVED_PARTS.map((part) => part.ref).join(', '));
    await page.waitForFunction((text) => document.querySelector('#request-status')?.textContent === text, done);
    const progressText = await page.locator('#request-progress').innerText();
    assert.equal(progressText.includes('Generated project'), false, progressText);
    assert.equal(progressText.includes('Completed:'), false, progressText);
    assert.equal((await page.locator('#request-status').innerText()).includes('Generated project'), false);
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test('removed-part confirm dialog is localized in Korean', async (t) => {
  const opened = await openApprovalPanel(t, 'ko-KR');
  if (!opened) return;
  const { page, context, pageErrors } = opened;
  const { ko } = await removalConfirmCopy();
  try {
    await sendRemovalPreview(page);
    await page.waitForFunction((cancelText) => {
      const dialog = document.querySelector('#apply-remove-components-confirm');
      const cancel = document.querySelector('#cancel-apply-remove-components');
      return dialog && dialog.hidden === false && cancel?.textContent === cancelText && document.activeElement === cancel;
    }, ko['patch.remove.cancel']);
    assert.equal(await page.locator('#confirm-apply-remove-components').innerText(), ko['patch.remove.confirm']);
    assert.equal(await page.locator('#apply-remove-components-lead').innerText(), ko['patch.remove.lead']);
    assert.equal(await page.locator('#apply-remove-components-confirm').getAttribute('aria-labelledby'), 'apply-remove-components-title');
    assert.equal(await page.locator('#apply-remove-components-title').innerText(), ko['patch.remove.title']);
    assert.equal(await page.locator('#apply-remove-components-confirm').getAttribute('aria-describedby'), 'apply-remove-components-parts');
    assert.equal(await page.locator('#apply-remove-components-confirm').getAttribute('aria-label'), null);
    const describedText = await describedRemovalText(page);
    for (const part of REMOVED_PARTS) {
      assert.equal(describedText.includes(part.ref), true, describedText);
      assert.equal(describedText.includes(String(part.value)), true, describedText);
      assert.equal(describedText.includes(part.libId), true, describedText);
    }
    await page.locator('#cancel-apply-remove-components').click();
    await page.waitForFunction(() => (
      document.querySelector('#apply-remove-components-confirm')?.hidden === true
      && document.activeElement?.id === 'approve-patch-button'
    ));
    assert.deepEqual(await approvedApplyCalls(page), []);
    await page.locator('#approve-patch-button').click();
    await page.waitForFunction(() => document.querySelector('#apply-remove-components-confirm')?.hidden === false);
    await page.locator('#confirm-apply-remove-components').click();
    const done = ko['patch.apply.done'].replaceAll('{refs}', REMOVED_PARTS.map((part) => part.ref).join(', '));
    await page.waitForFunction((text) => document.querySelector('#request-status')?.textContent === text, done);
    assert.equal((await page.locator('#request-status').innerText()).includes('Generated project'), false);
    assert.equal((await page.locator('#request-status').innerText()).includes('Completed:'), false);
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

async function removalDialogHidden(page) {
  return page.locator('#apply-remove-components-confirm').evaluate((node) => node.hidden);
}

test('stale, expired, or disabled removal preview does not open confirm or send apply', async (t) => {
  const opened = await openApprovalPanel(t, 'en-US');
  if (!opened) return;
  const { page, context, pageErrors } = opened;
  const { en } = await removalConfirmCopy();
  try {
    await page.evaluate(() => { window.__inspectionFreshness = 'stale'; });
    await sendRemovalPreview(page);
    await page.waitForFunction((stale) => {
      const dialog = document.querySelector('#apply-remove-components-confirm');
      const button = document.querySelector('#approve-patch-button');
      const status = document.querySelector('#patch-approval-status');
      return dialog?.hidden === true
        && button?.disabled === true
        && status?.dataset.state === 'stale'
        && status?.textContent === stale;
    }, en['patch.stale']);
    assert.deepEqual(await approvedApplyCalls(page), []);
    assert.equal(await page.locator('#patch-approval-status').innerText(), en['patch.stale']);
    assert.deepEqual(await approvedApplyCalls(page), []);
    await page.locator('#approve-patch-button').dispatchEvent('click');
    assert.equal(await removalDialogHidden(page), true);
    assert.deepEqual(await approvedApplyCalls(page), []);

    await page.evaluate(() => {
      window.__inspectionFreshness = 'missing';
      window.__removalPreview = null;
      window.__previewExpiresAt = Date.now() + 120000;
    });
    await page.locator('#prompt').fill('ESP32-S3 sensor board');
    await page.locator('#composer').getByRole('button', { name: 'Send' }).click();
    await page.waitForFunction(() => (
      document.querySelector('#inspection-freshness')?.textContent === 'missing'
      && document.querySelector('#approve-patch-button')?.disabled === false
      && document.querySelector('#apply-remove-components-confirm')?.hidden === true
    ));

    await page.evaluate(() => { window.__previewExpiresAt = Date.now() - 1000; });
    await sendRemovalPreview(page);
    await page.waitForFunction(() => (
      document.querySelector('#approve-patch-button')?.disabled === true
      && document.querySelector('#patch-approval-card')?.hidden === true
    ));
    assert.equal(await removalDialogHidden(page), true);
    await page.locator('#approve-patch-button').dispatchEvent('click');
    assert.equal(await removalDialogHidden(page), true);
    assert.deepEqual(await approvedApplyCalls(page), []);

    await page.evaluate(() => { window.__previewExpiresAt = Date.now() + 120000; });
    await sendRemovalPreview(page);
    await page.waitForFunction(() => {
      const dialog = document.querySelector('#apply-remove-components-confirm');
      const button = document.querySelector('#approve-patch-button');
      return dialog && dialog.hidden === false && button?.disabled === false;
    });
    await page.locator('#cancel-apply-remove-components').click();
    await page.waitForFunction(() => document.querySelector('#apply-remove-components-confirm')?.hidden === true);
    await page.evaluate(() => { document.querySelector('#approve-patch-button').disabled = true; });
    await page.locator('#approve-patch-button').dispatchEvent('click');
    assert.equal(await removalDialogHidden(page), true);
    assert.deepEqual(await approvedApplyCalls(page), []);

    await page.evaluate(() => {
      const button = document.querySelector('#approve-patch-button');
      button.disabled = false;
      button.removeAttribute('aria-disabled');
    });
    await page.locator('#approve-patch-button').click();
    await page.waitForFunction(() => document.querySelector('#apply-remove-components-confirm')?.hidden === false);
    await page.evaluate(() => { document.querySelector('#approve-patch-button').disabled = true; });
    await page.waitForFunction(() => (
      document.querySelector('#apply-remove-components-confirm')?.hidden === true
      && document.activeElement?.id === 'patch-approval-status'
      && document.querySelector('#approve-patch-button')?.disabled === true
    ));
    assert.equal(await page.locator('#patch-approval-status').innerText(), en['patch.apply.blocked-disabled']);
    assert.deepEqual(await approvedApplyCalls(page), []);
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

async function sendPlainPreview(page, prompt) {
  await page.evaluate(() => { window.__removalPreview = null; });
  await page.locator('#prompt').fill(prompt);
  await page.locator('#composer button[type="submit"]').click();
}

async function emitDaemonProgress(page, text) {
  await page.evaluate((note) => {
    window.__daemonSocket.emit('message', {
      data: JSON.stringify({
        version: 1,
        id: `delta_${Date.now()}_${Math.random()}`,
        type: 'agent.delta',
        createdAt: new Date().toISOString(),
        payload: { text: note, stage: 'provider', channel: 'progress' }
      })
    });
  }, text);
}

test('normal Apply is blocked when stale, expired, disabled, or busy, and sends when open', async (t) => {
  const opened = await openApprovalPanel(t, 'en-US');
  if (!opened) return;
  const { page, context, pageErrors } = opened;
  const { en } = await removalConfirmCopy();
  try {
    await page.evaluate(() => { window.__inspectionFreshness = 'stale'; });
    await sendPlainPreview(page, 'ESP32-S3 sensor board');
    await page.waitForFunction((stale) => (
      document.querySelector('#approve-patch-button')?.disabled === true
      && document.querySelector('#patch-approval-status')?.textContent === stale
    ), en['patch.stale']);
    await page.locator('#approve-patch-button').dispatchEvent('click');
    assert.deepEqual(await approvedApplyCalls(page), []);

    await page.evaluate(() => {
      window.__inspectionFreshness = 'missing';
      window.__previewExpiresAt = Date.now() - 1000;
    });
    await sendPlainPreview(page, 'ESP32-S3 sensor board expired');
    await page.waitForFunction(() => (
      document.querySelector('#approve-patch-button')?.disabled === true
      && document.querySelector('#patch-approval-card')?.hidden === true
      && document.querySelector('#apply-remove-components-confirm')?.hidden === true
    ));
    await page.locator('#approve-patch-button').dispatchEvent('click');
    assert.equal(await removalDialogHidden(page), true);
    assert.deepEqual(await approvedApplyCalls(page), []);

    await page.evaluate(() => { window.__previewExpiresAt = Date.now() + 120000; });
    await sendPlainPreview(page, 'ESP32-S3 sensor board open');
    await page.waitForFunction(() => document.querySelector('#approve-patch-button')?.disabled === false);
    await page.evaluate(() => { document.querySelector('#approve-patch-button').disabled = true; });
    await page.locator('#approve-patch-button').dispatchEvent('click');
    assert.deepEqual(await approvedApplyCalls(page), []);

    await page.evaluate(() => {
      document.querySelector('#approve-patch-button').disabled = false;
      window.__holdPatchResult = true;
    });
    await page.locator('#approve-patch-button').click();
    await page.waitForFunction((summary) => document.querySelector('#request-status')?.textContent === summary, en['patch.apply.summary']);
    const calls = await approvedApplyCalls(page);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args.approved, true);
    assert.equal(Object.hasOwn(calls[0].args, 'allowRemovedComponents'), false);
    const applyItem = page.locator('#request-progress li[data-stage="apply"]').last();
    assert.equal((await applyItem.locator('strong').innerText()).trim(), en['progress.apply']);
    assert.equal(await applyItem.locator('p').count(), 0);
    await page.locator('#approve-patch-button').dispatchEvent('click');
    assert.equal((await approvedApplyCalls(page)).length, 1);

    await page.evaluate(() => { window.__heldPatch.emit({ applied: true, operation: 'patched', validation: { ok: true } }); });
    await page.waitForFunction((text) => document.querySelector('#request-status')?.textContent === text, en['patch.apply.applied']);
    const progressText = await page.locator('#request-progress').innerText();
    const statusText = await page.locator('#request-status').innerText();
    assert.equal(progressText.includes('Generated project'), false, progressText);
    assert.equal(progressText.includes('Completed:'), false, progressText);
    assert.equal(statusText.includes('Generated project'), false, statusText);
    assert.equal(statusText.includes('Completed:'), false, statusText);
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test('daemon apply replies fail closed and a closed gate dismisses the removal dialog', async (t) => {
  const opened = await openApprovalPanel(t, 'en-US');
  if (!opened) return;
  const { page, context, pageErrors } = opened;
  const { en, ko } = await removalConfirmCopy();
  const cases = [
    {
      id: 'PATCH_STALE',
      result: { applied: false, validation: { ok: true }, reason: { code: 'PATCH_STALE' } },
      text: en['patch.apply.failed.PATCH_STALE']
    },
    {
      id: 'EXISTING_COMPONENTS_REMOVED',
      result: { applied: false, validation: { ok: true }, reason: { code: 'EXISTING_COMPONENTS_REMOVED' } },
      text: en['patch.apply.failed.EXISTING_COMPONENTS_REMOVED'],
      uncertain: true
    },
    {
      id: 'PATCH_EXPIRED',
      result: { applied: false, validation: { ok: true }, reason: { code: 'PATCH_EXPIRED' } },
      text: en['patch.apply.failed.PATCH_EXPIRED']
    },
    {
      id: 'NO_SUCH_CODE',
      result: { applied: false, validation: { ok: true }, reason: { code: 'NO_SUCH_CODE' } },
      text: en['patch.apply.failed.unknown']
    },
    {
      id: 'missing-applied',
      result: { validation: { ok: true }, operation: 'patched' },
      text: en['patch.apply.failed.missing'],
      uncertain: true
    },
    {
      id: 'canceled',
      result: { canceled: true, applied: false },
      text: en['patch.apply.failed.unknown'],
      code: 'APPLY_REJECTED',
      uncertain: true
    },
    {
      id: 'applied-string',
      result: { applied: 'true', validation: { ok: true } },
      text: en['patch.apply.failed.unknown'],
      code: 'APPLY_REJECTED',
      uncertain: true
    },
    {
      id: 'applied-number',
      result: { applied: 1, validation: { ok: true } },
      text: en['patch.apply.failed.unknown'],
      code: 'APPLY_REJECTED',
      uncertain: true
    }
  ];
  const warnings = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  try {
    assert.equal(en['patch.apply.failed.recheck'], 'Preview the change again.');
    assert.equal(ko['patch.apply.failed.recheck'], '변경을 다시 미리보기 해 주세요.');
    assert.equal(en['patch.apply.failed.missing'], "Couldn't confirm whether it was applied.");
    assert.equal(ko['patch.apply.failed.missing'], '적용 여부를 확인하지 못했어요.');
    assert.equal(en['patch.apply.failed.unknown'].includes('{code}'), false);
    assert.equal(ko['patch.apply.failed.unknown'].includes('{code}'), false);
    assert.equal(await page.locator('#active-project').isVisible(), true);
    const created = await page.locator('#request-status').innerText();
    assert.equal(created.includes('Completed'), false);
    assert.equal(created.includes(en['patch.apply.failed.missing']), false);
    assert.equal(await page.locator('#request-status').getAttribute('data-state'), 'ready');

    await page.evaluate(() => {
      window.__hostMessages = [];
      window.chatpcbHost = {
        postMessage(message) { window.__hostMessages.push(message); },
        send(message) { window.__hostMessages.push(message); },
        getProjectStatus() { return { dirty: false, linkState: 'linked' }; }
      };
    });

    for (const item of cases) {
      await sendPlainPreview(page, `preview ${item.id}`);
      await page.waitForFunction(() => document.querySelector('#approve-patch-button')?.disabled === false);
      await page.evaluate((next) => { window.__patchApplyResult = next; }, item.result);
      await page.locator('#approve-patch-button').click();
      await page.waitForFunction((needle) => (
        document.querySelector('#request-status')?.dataset.state === 'failed'
        && document.querySelector('#request-status')?.textContent?.includes(needle)
      ), item.text);
      const status = await page.locator('#request-status').innerText();
      const reasonCode = item.code || item.result.reason?.code || 'APPLIED_MISSING';
      assert.equal(status.includes(item.text), true, status);
      assert.equal(status.includes(en['patch.apply.summary']), false, status);
      assert.equal(await page.locator('#workflow-caption').innerText(), "Couldn't apply the change");
      assert.notEqual(await page.locator('#workflow-caption').innerText(), en['workflow.caption.failed']);
      assert.equal(await page.locator('#composer button[type="submit"]').isDisabled(), false);
      assert.equal(status.includes(en['patch.apply.failed.recheck']), true, status);
      assert.equal(status.includes(reasonCode), false, status);
      assert.equal(status.includes(`(${reasonCode})`), false, status);
      assert.equal(await page.locator('#request-status').getAttribute('data-reason-code'), reasonCode);
      assert.equal(warnings.includes(reasonCode), true, warnings.join(' | '));
      assert.equal(status.includes('Completed'), false, status);
      assert.equal(status.includes('Generated project'), false, status);
      assert.notEqual(await page.locator('[data-step="circuit.draft"]').getAttribute('data-state'), 'done');
      const reloads = await page.evaluate(() => window.__hostMessages.filter((message) => message?.type === 'project.reload'));
      assert.deepEqual(reloads, []);
      if (item.uncertain) {
        const applies = (await approvedApplyCalls(page)).length;
        await page.waitForFunction(() => {
          const button = document.querySelector('#approve-patch-button');
          const card = document.querySelector('#patch-approval-card');
          return button?.disabled === true
            && button.getAttribute('aria-disabled') == null
            && card?.hidden === true;
        });
        await page.locator('#approve-patch-button').dispatchEvent('click');
        assert.equal((await approvedApplyCalls(page)).length, applies, `${item.id} must not reuse the approval`);
      }
    }

    await page.evaluate(() => { window.__patchApplyResult = null; });
    await page.evaluate((next) => { window.__requestResult = next; }, {
      applied: false,
      validation: { ok: true },
      operation: 'generated',
      reason: { code: 'PATCH_STALE' }
    });
    await page.locator('#prompt').fill('request rejected');
    await page.locator('#composer button[type="submit"]').click();
    await page.waitForFunction((needle) => (
      document.querySelector('#request-status')?.dataset.state === 'failed'
      && document.querySelector('#request-status')?.textContent?.includes(needle)
    ), en['patch.apply.failed.PATCH_STALE']);
    const requestStatus = await page.locator('#request-status').innerText();
    assert.equal(requestStatus.includes('Completed'), false, requestStatus);
    assert.equal(requestStatus.includes('Generated project'), false, requestStatus);
    assert.notEqual(await page.locator('[data-step="circuit.draft"]').getAttribute('data-state'), 'done');
    await page.evaluate(() => { window.__requestResult = null; });

    await sendRemovalPreview(page);
    await page.waitForFunction(() => document.querySelector('#apply-remove-components-confirm')?.hidden === false);
    await page.evaluate(() => { window.__holdRequest = true; });
    await page.locator('#prompt').fill('another removal while the dialog is open');
    await page.locator('#composer button[type="submit"]').click();
    await page.waitForFunction((busy) => (
      document.querySelector('#apply-remove-components-confirm')?.hidden === true
      && document.querySelector('#patch-approval-status')?.textContent === busy
    ), en['request.project-busy']);
    const busyFocus = await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName || '');
    assert.notEqual(busyFocus, 'patch-approval-status', busyFocus);
    assert.notEqual(busyFocus, 'BODY', busyFocus);
    await page.evaluate(() => {
      window.__holdRequest = false;
      window.__heldRequest.emit();
    });
    await page.waitForFunction(() => document.querySelector('#apply-remove-components-confirm')?.hidden === false);
    await page.locator('#cancel-apply-remove-components').click();
    await page.waitForFunction(() => document.querySelector('#apply-remove-components-confirm')?.hidden === true);
    const inspectsBeforeReload = await page.evaluate(() => window.__sent.filter((call) => call.name === 'project.inspect').length);
    await page.evaluate(() => {
      window.postMessage({ type: 'project.reload', completed: true, projectPath: '/tmp/chatpcb-ui-project' }, '*');
    });
    await page.waitForFunction((count) => (
      window.__sent.filter((call) => call.name === 'project.inspect').length > count
    ), inspectsBeforeReload);
    assert.equal(await removalDialogHidden(page), true);

    await sendRemovalPreview(page);
    await page.waitForFunction(() => document.querySelector('#apply-remove-components-confirm')?.hidden === false);
    await page.evaluate(() => { window.__inspectionDigest = 'ffffeeee1111'; });
    await page.evaluate(() => {
      window.postMessage({ type: 'project.reload', completed: true, projectPath: '/tmp/chatpcb-ui-project' }, '*');
    });
    await page.waitForFunction((stale) => (
      document.querySelector('#apply-remove-components-confirm')?.hidden === true
      && document.querySelector('#patch-approval-status')?.textContent === stale
    ), en['patch.stale']);
    const digestInspect = await page.evaluate(() => window.__sent.filter((call) => call.name === 'project.inspect').at(-1));
    assert.equal(digestInspect.args.expectedDigest, 'abcdef123456');
    await page.locator('#approve-patch-button').dispatchEvent('click');
    assert.equal(await removalDialogHidden(page), true);

    await page.evaluate(() => {
      window.__inspectionDigest = 'abcdef123456';
      window.__inspectionFreshness = 'missing';
      window.__removalPreview = null;
      window.__holdInspect = true;
    });
    await sendRemovalPreview(page);
    await page.waitForFunction(() => {
      const dialog = document.querySelector('#apply-remove-components-confirm');
      const button = document.querySelector('#approve-patch-button');
      return dialog?.hidden === true && (button?.disabled === true || button?.getAttribute('aria-disabled') === 'true');
    });
    const appliesBeforeClosedGate = (await approvedApplyCalls(page)).length;
    await page.locator('#approve-patch-button').dispatchEvent('click');
    assert.equal(await removalDialogHidden(page), true);
    assert.equal((await approvedApplyCalls(page)).length, appliesBeforeClosedGate);
    await page.evaluate(() => {
      window.__holdInspect = false;
      window.__heldInspect.emit();
    });
    await page.waitForFunction(() => document.querySelector('#apply-remove-components-confirm')?.hidden === false);

    assert.deepEqual(pageErrors, []);
    assert.equal(ko['patch.apply.failed.PATCH_STALE'].includes('했어요'), true);
  } finally {
    await context.close();
  }
});

test('closed apply gate moves focus to the approval status instead of body', async (t) => {
  const { en, ko } = await removalConfirmCopy();
  for (const locale of ['en-US', 'ko-KR']) {
    for (const theme of ['light', 'dark']) {
      const opened = await openApprovalPanel(t, locale);
      if (!opened) return;
      const { page, context, pageErrors } = opened;
      const copy = locale.startsWith('ko') ? ko : en;
      try {
        await page.evaluate((next) => {
          document.documentElement.dataset.theme = next;
        }, theme);
        await sendRemovalPreview(page);
        await page.waitForFunction(() => {
          const dialog = document.querySelector('#apply-remove-components-confirm');
          return dialog && dialog.hidden === false && document.activeElement?.id === 'cancel-apply-remove-components';
        });
        await page.evaluate(() => { window.__inspectionDigest = 'ffffeeee1111'; });
        await page.evaluate(() => {
          window.postMessage({ type: 'project.reload', completed: true, projectPath: '/tmp/chatpcb-ui-project' }, '*');
        });
        await page.waitForFunction((stale) => (
          document.querySelector('#apply-remove-components-confirm')?.hidden === true
          && document.querySelector('#patch-approval-status')?.textContent === stale
          && document.activeElement?.id === 'patch-approval-status'
        ), copy['patch.stale']);
        const focus = await page.evaluate(() => {
          const active = document.activeElement;
          const status = document.querySelector('#patch-approval-status');
          const button = document.querySelector('#approve-patch-button');
          return {
            activeId: active?.id || active?.tagName || '',
            activeIsBody: active === document.body,
            activeIsStatus: active === status,
            tabIndex: status?.tabIndex ?? null,
            insideLive: Boolean(status?.closest('[aria-live], [role="status"], [role="alert"]')),
            applyDisabled: button?.disabled === true
          };
        });
        assert.equal(focus.activeIsBody, false, `${locale}/${theme} focus is ${focus.activeId}`);
        assert.equal(focus.activeIsStatus, true, `${locale}/${theme} focus is ${focus.activeId}`);
        assert.equal(focus.tabIndex, -1, `${locale}/${theme} status tabindex`);
        assert.equal(focus.insideLive, false, `${locale}/${theme} status is inside a live region`);
        assert.equal(focus.applyDisabled, true, `${locale}/${theme} Apply stays disabled`);
        assert.deepEqual(pageErrors, []);
      } finally {
        await context.close();
      }
    }
  }
});

test('a delayed inspect keeps focus on the approval status', async (t) => {
  const { en, ko } = await removalConfirmCopy();
  for (const locale of ['en-US', 'ko-KR']) {
    for (const dialogOpen of [false, true]) {
      const opened = await openApprovalPanel(t, locale);
      if (!opened) return;
      const { page, context, pageErrors } = opened;
      const copy = locale.startsWith('ko') ? ko : en;
      try {
        if (dialogOpen) {
          await sendRemovalPreview(page);
          await page.waitForFunction(() => (
            document.querySelector('#apply-remove-components-confirm')?.hidden === false
          ));
        } else {
          await sendPlainPreview(page, 'ESP32-S3 sensor board focus');
          await page.waitForFunction(() => document.querySelector('#approve-patch-button')?.disabled === false);
          await page.locator('#approve-patch-button').focus();
        }
        const approvesBefore = (await approvedApplyCalls(page)).length;
        await page.evaluate(() => {
          window.__inspectionFreshness = 'stale';
          window.__inspectDelayMs = 500;
        });
        await page.evaluate(() => {
          window.postMessage({ type: 'project.reload', completed: true, projectPath: '/tmp/chatpcb-ui-project' }, '*');
        });
        await page.waitForFunction((stale) => (
          document.querySelector('#patch-approval-status')?.textContent === stale
          && document.activeElement?.id === 'patch-approval-status'
          && document.activeElement !== document.body
        ), copy['patch.stale']);
        const focus = await page.evaluate(() => {
          const button = document.querySelector('#approve-patch-button');
          return {
            activeId: document.activeElement?.id || document.activeElement?.tagName || '',
            activeIsBody: document.activeElement === document.body,
            dialogHidden: document.querySelector('#apply-remove-components-confirm')?.hidden === true,
            disabled: button?.disabled === true,
            ariaDisabled: button?.getAttribute('aria-disabled')
          };
        });
        assert.equal(focus.activeIsBody, false, `${locale} dialog=${dialogOpen} focus is ${focus.activeId}`);
        assert.equal(focus.activeId, 'patch-approval-status', `${locale} dialog=${dialogOpen}`);
        assert.equal(focus.dialogHidden, true, `${locale} dialog=${dialogOpen}`);
        assert.equal(focus.disabled, true, `${locale} dialog=${dialogOpen}`);
        assert.equal(focus.ariaDisabled, null, `${locale} dialog=${dialogOpen}`);
        await page.locator('#approve-patch-button').dispatchEvent('click');
        await page.evaluate(() => {
          const button = document.querySelector('#approve-patch-button');
          button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
          button.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
        });
        assert.equal((await approvedApplyCalls(page)).length, approvesBefore, `${locale} dialog=${dialogOpen}`);
        assert.deepEqual(pageErrors, []);
      } finally {
        await context.close();
      }
    }
  }
});

test('a delayed inspect says it is checking instead of saying the preview cannot be applied', async (t) => {
  const { en, ko } = await removalConfirmCopy();
  assert.equal(en['patch.inspect.checking'], 'Checking the project files…');
  assert.equal(ko['patch.inspect.checking'], '프로젝트 파일을 확인하고 있어요.');
  for (const locale of ['en-US', 'ko-KR']) {
    const opened = await openApprovalPanel(t, locale);
    if (!opened) return;
    const { page, context, pageErrors } = opened;
    const copy = locale.startsWith('ko') ? ko : en;
    try {
      await sendRemovalPreview(page);
      await page.waitForFunction(() => document.querySelector('#apply-remove-components-confirm')?.hidden === false);
      await page.evaluate(() => {
        window.__statusSamples = [];
        const status = document.querySelector('#patch-approval-status');
        const note = () => window.__statusSamples.push(status.textContent);
        note();
        new MutationObserver(note).observe(status, { childList: true, characterData: true, subtree: true });
        window.__inspectionFreshness = 'stale';
        window.__inspectDelayMs = 500;
      });
      await page.evaluate(() => {
        window.postMessage({ type: 'project.reload', completed: true, projectPath: '/tmp/chatpcb-ui-project' }, '*');
      });
      await page.waitForFunction((checking) => (
        document.querySelector('#patch-approval-status')?.textContent === checking
      ), copy['patch.inspect.checking'], { timeout: 3000 });
      const sawBlocked = await page.evaluate((blocked) => window.__statusSamples.includes(blocked), copy['patch.apply.blocked-disabled']);
      assert.equal(sawBlocked, false, `${locale} flashed the blocked preview`);
      await page.waitForFunction((stale) => document.querySelector('#patch-approval-status')?.textContent === stale, copy['patch.stale']);
      assert.deepEqual(pageErrors, []);
    } finally {
      await context.close();
    }
  }
});

test('preview project digest is the inspect baseline', async (t) => {
  const opened = await openApprovalPanel(t, 'en-US');
  if (!opened) return;
  const { page, context, pageErrors } = opened;
  const { en } = await removalConfirmCopy();
  try {
    const before = await page.evaluate(() => window.__sent.filter((call) => call.name === 'project.inspect').length);
    await page.evaluate(() => {
      window.__previewProjectDigest = 'previewdigest111';
      window.__inspectionDigest = 'inspectdigest222';
    });
    await sendPlainPreview(page, 'baseline digest');
    await page.waitForFunction((count) => (
      window.__sent.filter((call) => call.name === 'project.inspect').length > count
    ), before);
    const inspect = await page.evaluate((count) => (
      window.__sent.filter((call) => call.name === 'project.inspect')[count]
    ), before);
    assert.equal(inspect.args.expectedDigest, 'previewdigest111');
    await page.waitForFunction((stale) => (
      document.querySelector('#patch-approval-status')?.textContent === stale
    ), en['patch.stale']);
    assert.notEqual(inspect.args.expectedDigest, 'inspectdigest222');
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test('Korean apply failures use the same reason codes', async (t) => {
  const opened = await openApprovalPanel(t, 'ko-KR');
  if (!opened) return;
  const { page, context, pageErrors } = opened;
  const { ko } = await removalConfirmCopy();
  try {
    await sendPlainPreview(page, 'korean stale apply');
    await page.waitForFunction(() => document.querySelector('#approve-patch-button')?.disabled === false);
    await page.evaluate(() => {
      window.__patchApplyResult = { applied: false, validation: { ok: true }, reason: { code: 'PATCH_STALE' } };
    });
    await page.locator('#approve-patch-button').click();
    await page.waitForFunction((needle) => document.querySelector('#request-status')?.textContent?.includes(needle), ko['patch.apply.failed.PATCH_STALE']);
    const status = await page.locator('#request-status').innerText();
    assert.equal(status.includes(ko['patch.apply.failed.recheck']), true, status);
    assert.equal(status.includes('PATCH_STALE'), false, status);
    assert.equal(await page.locator('#workflow-caption').innerText(), '변경을 적용하지 못했어요');
    assert.notEqual(await page.locator('#workflow-caption').innerText(), ko['workflow.caption.failed']);
    assert.equal(await page.locator('#request-status').getAttribute('data-reason-code'), 'PATCH_STALE');
    assert.equal(status.includes('완료'), false, status);
    assert.equal(status.includes('프로젝트를 생성했어요'), false, status);
    assert.equal(await page.locator('#request-status').getAttribute('data-state'), 'failed');
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test('ERC summary avoids a zero error count when violations exist or the result is incomplete', async (t) => {
  const cases = [
    {
      locale: 'en-US',
      erc: { ok: false, errorCount: 0, warningCount: 1, violations: [{ severity: 'warning', description: 'Isolated pin label' }] },
      summary: 'ERC found 1 item to review.',
      once: true
    },
    {
      locale: 'en-US',
      erc: { ok: false, errorCount: 0, violations: [{ message: 'Pin 3 of U2 (EN) is not connected' }] },
      summary: 'ERC found 1 item to review.',
      once: false
    },
    {
      locale: 'en-US',
      erc: { ok: false, errorCount: 0, violations: [{ message: 'Pin 3 of U2 (EN) is not connected' }, { message: 'Pin 5 of U2 is not driven' }] },
      summary: 'ERC found 2 items to review.',
      once: false
    },
    {
      locale: 'ko-KR',
      erc: { ok: false, errorCount: 0, violations: [{ message: 'Pin 3 of U2 (EN) is not connected' }] },
      summary: 'ERC 결과에 확인할 항목 1개가 있어요.',
      once: false
    },
    {
      locale: 'ko-KR',
      erc: { ok: false, errorCount: 0, violations: [{ message: 'Pin 3 of U2 (EN) is not connected' }, { message: 'Pin 5 of U2 is not driven' }] },
      summary: 'ERC 결과에 확인할 항목 2개가 있어요.',
      once: false
    },
    {
      locale: 'en-US',
      erc: { ok: false, errorCount: 0 },
      summary: 'The ERC result is incomplete. Run ERC again.',
      once: true
    },
    {
      locale: 'ko-KR',
      erc: { ok: false, errorCount: 0 },
      summary: 'ERC 결과가 불완전해요. ERC를 다시 실행해 주세요.',
      once: true
    }
  ];
  for (const item of cases) {
    const opened = await openApprovalPanel(t, item.locale);
    if (!opened) return;
    const { page, context, pageErrors } = opened;
    try {
      await page.evaluate((erc) => {
        window.__candidateErc = erc;
      }, item.erc);
      await sendPlainPreview(page, 'ESP32-S3 sensor board erc');
      await page.waitForFunction(() => document.querySelector('#patch-erc')?.hidden === false);
      const shown = await page.evaluate(() => {
        const summary = document.querySelector('#patch-erc .erc-h span:nth-child(2)');
        const why = document.querySelector('#apply-why');
        const card = document.querySelector('#patch-approval-card')?.innerText ?? '';
        const button = document.querySelector('#approve-patch-button');
        return {
          summary: summary?.textContent ?? '',
          why: why?.textContent ?? '',
          whyHidden: why?.hidden === true,
          erc: document.querySelector('#patch-erc')?.innerText ?? '',
          cardCount: card.split(summary?.textContent ?? '\u0000').length - 1,
          describedBy: button?.getAttribute('aria-describedby') ?? ''
        };
      });
      assert.equal(shown.summary, item.summary, `${item.locale} summary ${shown.summary}`);
      if (item.once) {
        assert.equal(shown.why, '', `${item.locale} why repeated ${shown.why}`);
        assert.equal(shown.whyHidden, true, `${item.locale} why visible`);
        assert.equal(shown.cardCount, 1, `${item.locale} card repeated ${shown.cardCount} times`);
        assert.equal(shown.describedBy, 'patch-erc', `${item.locale} describedBy ${shown.describedBy}`);
      } else {
        assert.equal(shown.why, item.summary, `${item.locale} why ${shown.why}`);
        assert.equal(shown.describedBy, 'apply-why', `${item.locale} describedBy ${shown.describedBy}`);
      }
      assert.equal(/0 errors|오류 0|ERC 오류 0/.test(shown.summary), false, shown.summary);
      assert.equal(/0 errors|오류 0|ERC 오류 0/.test(shown.why), false, shown.why);
      assert.equal(/0 errors|오류 0|ERC 오류 0/.test(shown.erc), false, shown.erc);
      if (item.erc.violations?.some((entry) => entry.message)) assert.match(shown.erc, /Pin 3 of U2/);
      assert.deepEqual(pageErrors, []);
    } finally {
      await context.close();
    }
  }
});

const KNOWN_DAEMON_NOTE = 'Applying the draft to the schematic.';
const UNKNOWN_DAEMON_NOTE = 'untranslated daemon note 42';

test('daemon progress and patch card follow the panel language', async (t) => {
  const { en, ko } = await removalConfirmCopy();
  assert.equal(en['daemon.progress.applying'], KNOWN_DAEMON_NOTE);
  assert.notEqual(ko['daemon.progress.applying'], KNOWN_DAEMON_NOTE);
  assert.notEqual(ko['request.project-busy'], 'PROJECT_BUSY');
  assert.notEqual(ko['patch.stale'], 'PATCH_STALE');

  async function expectLocalizedSurface(locale, copy) {
    const opened = await openApprovalPanel(t, locale);
    if (!opened) return false;
    const { page, context, pageErrors } = opened;
    try {
      await sendPlainPreview(page, 'ESP32-S3 sensor board');
      await page.waitForFunction(({ ready, title, status }) => {
        const strong = document.querySelector('#request-progress li:last-child strong');
        return strong?.textContent === ready
          && document.querySelector('#patch-approval-title')?.textContent === title
          && document.querySelector('#patch-approval-status')?.textContent === status
          && document.querySelector('#patch-approval-status')?.hidden === false;
      }, {
        ready: copy['progress.ready'],
        title: copy['patch.title'],
        status: copy['approval.no-manifest']
      });
      if (locale === 'en-US') {
        const label = await page.locator('#request-progress li:last-child strong').innerText();
        const card = await page.locator('#patch-approval-card').innerText();
        assert.equal(/[\uAC00-\uD7A3]/.test(label), false, label);
        assert.equal(/[\uAC00-\uD7A3]/.test(card), false, card);
      }

      await emitDaemonProgress(page, KNOWN_DAEMON_NOTE);
      await emitDaemonProgress(page, 'PROJECT_BUSY');
      await emitDaemonProgress(page, UNKNOWN_DAEMON_NOTE);
      const expectedNotes = [
        copy['daemon.progress.applying'],
        copy['request.project-busy'],
        UNKNOWN_DAEMON_NOTE
      ];
      await page.waitForFunction((notes) => {
        const items = [...document.querySelectorAll('#request-progress p')].map((node) => node.textContent);
        return notes.every((note, index) => items[index] === note) && items.length === notes.length;
      }, expectedNotes);
      const notes = await page.locator('#request-progress p').allInnerTexts();
      assert.equal(notes.includes('PROJECT_BUSY'), false);
      if (locale === 'ko-KR') assert.equal(notes.includes(KNOWN_DAEMON_NOTE), false);

      await page.evaluate(() => {
        window.__candidateErc = {
          ok: false,
          errorCount: 3,
          errors: ['Applying the draft to the schematic.', 'PATCH_STALE', 'untranslated daemon note 42']
        };
      });
      await sendPlainPreview(page, 'ESP32-S3 sensor board erc');
      const expectedErc = [
        copy['daemon.progress.applying'],
        copy['patch.stale'],
        UNKNOWN_DAEMON_NOTE
      ];
      await page.waitForFunction((items) => {
        const shown = [...document.querySelectorAll('#patch-erc li')].map((node) => node.textContent);
        return items.every((item, index) => shown[index] === item) && shown.length === items.length;
      }, expectedErc);
      const ercText = await page.locator('#patch-erc').innerText();
      assert.equal(ercText.includes('PATCH_STALE'), false, ercText);
      if (locale === 'ko-KR') assert.equal(ercText.includes(KNOWN_DAEMON_NOTE), false, ercText);
      assert.equal(await page.locator('#patch-approval-title').innerText(), copy['patch.title']);
      assert.deepEqual(pageErrors, []);
      return true;
    } finally {
      await context.close();
    }
  }

  const english = await expectLocalizedSurface('en-US', en);
  if (!english) return;
  await expectLocalizedSurface('ko-KR', ko);
});
