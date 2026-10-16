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
async function openChatGPTWaiting(t, { locale, startResult }) {
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
  await page.addInitScript((start) => {
    window.__sent = [];
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
        let result = {};
        if (call.name === 'auth.chatgpt.status') result = { state: 'signed_out' };
        if (call.name === 'provider.status') result = { provider: call.args?.provider ?? 'codex', status: 'signed-out' };
        if (call.name === 'auth.chatgpt.start' || call.name === 'auth.chatgpt.reopen') result = start;
        queueMicrotask(() => this.emit('message', { data: JSON.stringify({ version: 1, id: `r_${call.id}`, type: 'tool.result', createdAt: new Date().toISOString(), payload: { id: call.id, ok: true, result } }) }));
      }
      close() {}
    }
    window.WebSocket = FakeSocket;
  }, startResult);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.selectOption('#provider', 'chatgpt');
  const button = page.locator('.chatgpt-sign-in-btn');
  await button.waitFor();
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
