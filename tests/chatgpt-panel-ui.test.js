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
async function openChatGPTWaiting(t, { locale, startResult, expiresInMs, reopenFailure, reopenResultFailure, reopenThrow, signedIn, leaveProvider } = {}) {
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
  await page.addInitScript((config) => {
    window.__sent = [];
    window.__chatgptSignedIn = config.signedIn === true;
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
    signedIn: signedIn === true
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  const button = page.locator('.chatgpt-sign-in-btn');
  if (!leaveProvider) {
    await page.selectOption('#provider', 'chatgpt');
    if (!signedIn) await button.waitFor();
  }
  return { page, context, pageErrors, button };
}

const waiting = { state: 'waiting', attemptId: 'attempt-1', authUrl: 'https://auth.openai.com/api/accounts/authorize?client_id=dynamic_agent_client&x=1' };

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
