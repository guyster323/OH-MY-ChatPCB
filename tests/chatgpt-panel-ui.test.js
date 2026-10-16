import './setup/isolate-home.mjs';
import assert from 'node:assert/strict';
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
    if (config.switchOfferDone) localStorage.setItem('chatpcb.chatgpt-switch-offered', '1');
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
            result = { state: 'signed_in', account: { email: 'ada@ex.com', name: 'Ada' }, plan: 'plus' };
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
            ? { provider, status: 'signed-in', account: { email: 'ada@ex.com', name: 'Ada' }, plan: 'plus' }
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
          result = { projectDir: '/tmp/chatpcb-ui-project', displayName: call.args?.projectName || 'Board' };
        }
        if (config.approvalFlow && call.name === 'project.inspect') {
          result = {
            manifest: { freshness: { status: 'missing', reason: 'No manifest' } },
            inspection: { projectDigest: 'abcdef123456', artifactCount: 0 }
          };
        }
        if (config.approvalFlow && call.name === 'project.request') {
          result = {
            requiresApproval: true,
            approved: false,
            applied: false,
            patchId: 'sha256:preview',
            expiresAt: Date.now() + 120000,
            operation: 'generated',
            files: {},
            conversation: { messages: [] }
          };
          if (window.__draftSource) result.source = window.__draftSource;
          if (Array.isArray(window.__draftParts)) result.components = window.__draftParts;
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
    switchOfferDone: switchOfferDone === true,
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

test('sign-in button stays English with lang=en in ko and shows no logo placeholder', async (t) => {
  const opened = await openChatGPTWaiting(t, { locale: 'ko-KR', startResult: waiting });
  if (!opened) return;
  const { page, context, pageErrors, button } = opened;
  try {
    assert.equal((await button.innerText()).trim(), 'Continue with ChatGPT');
    assert.equal(await button.getAttribute('lang'), 'en');
    assert.equal(await page.locator('.chatgpt-logo-placeholder').count(), 0);
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
    await assertBrowserOpenError(page, { title: '브라우저를 열 수 없습니다. 아래 링크를 사용하세요.', pageErrors });
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
      return `이 로그인 링크는 ${time}에 만료됩니다.`;
    });
    assert.equal((await expiry.innerText()).trim(), expected);
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
    await page.waitForFunction(() => document.querySelector('#provider-status')?.textContent === 'chatgpt: signed-in');
    const signOut = page.locator('#chatgpt-auth-card button', { hasText: /Sign out|sign-out/ });
    await signOut.click();
    await page.waitForFunction(() => document.querySelector('#provider-status')?.textContent === 'chatgpt: signed-out');
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
    await page.waitForFunction(() => document.querySelector('#connection-status')?.textContent === 'Daemon connected');
    const duringDelay = await page.locator('#chatgpt-auth-card').innerText();
    assert.equal(duringDelay.includes('auth.chatgpt.'), false);
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
    assert.equal(await connection.getAttribute('data-state'), 'open');
    assert.equal(await connection.evaluate((node) => node.classList.contains('daemon-connection')), true);
    const before = await connection.innerText();
    assert.equal(before.includes('ChatGPT'), false);
    await page.waitForFunction(() => document.querySelector('#chatgpt-auth-title')?.textContent === 'ChatGPT에 연결됨');
    assert.notEqual(await page.locator('#chatgpt-auth-title').innerText(), before);
    assert.equal(await page.locator('#provider-status').innerText(), 'chatgpt: signed-in');
    const signOut = page.locator('#chatgpt-auth-card button', { hasText: /로그아웃|Sign out/ });
    await signOut.click();
    await page.waitForFunction(() => document.querySelector('#provider-status')?.textContent === 'chatgpt: signed-out');
    assert.equal(await connection.innerText(), '데몬 연결됨');
    assert.equal(await connection.getAttribute('data-state'), 'open');
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
  assert.equal(ko['approval.no-manifest'], '부품 목록은 스키매틱에 적용한 뒤 확인됩니다.');
  assert.equal(
    en['approval.no-manifest-detail'],
    'The patch is still matched to the current files before anything is written.'
  );
  assert.equal(
    ko['approval.no-manifest-detail'],
    '파일을 쓰기 전에 패치가 현재 파일과 일치하는지도 확인합니다.'
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
    await page.waitForFunction(() => document.querySelector('#provider-status')?.textContent === 'chatgpt: signed-out');
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
    await page.waitForFunction(() => document.querySelector('#provider-status')?.textContent === 'chatgpt: signed-in');
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
    await page.waitForFunction(() => document.querySelector('#provider-status')?.textContent === 'chatgpt: signed-out');
    const afterSignOut = await page.evaluate(() => window.__sent.filter((call) => call.name === 'provider.status').length);
    assert.ok(afterSignOut > afterSignIn);
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
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
    await page.waitForFunction(() => document.querySelector('#provider-status')?.textContent === 'grok: signed-out');
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
    assert.equal(await page.evaluate(() => localStorage.getItem('chatpcb.chatgpt-switch-offered')), '1');
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
    assert.equal(await page.evaluate(() => localStorage.getItem('chatpcb.chatgpt-switch-offered')), '1');
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
