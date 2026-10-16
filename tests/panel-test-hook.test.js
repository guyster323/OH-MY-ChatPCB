/* global document, window */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';

import { dispatchToolCall } from '../src/runtime/agent-daemon.js';
import { createPatchApprovalRegistry } from '../src/runtime/patch-approval-registry.js';

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

test('panel test hook exists only in test mode and cannot pass ERC for the daemon', async (t) => {
  let browser;
  try {
    browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true });
  } catch (error) {
    t.skip(`Chromium unavailable: ${error.message}`);
    return;
  }

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
  const port = server.address().port;
  const projectDir = await mkdtemp(join(tmpdir(), 'chatpcb-hook-erc-'));
  const registry = createPatchApprovalRegistry();

  try {
    const plain = await browser.newPage();
    await plain.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
    assert.equal(await plain.evaluate(() => window.__chatpcbTest), undefined);
    await plain.goto(`http://127.0.0.1:${port}/index.html?chatpcbTest=1`, { waitUntil: 'domcontentloaded' });
    assert.equal(await plain.evaluate(() => window.__chatpcbTest), undefined);
    await plain.close();

    const flagged = await browser.newPage();
    await flagged.addInitScript(() => {
      window.__CHATPCB_TEST_MODE__ = true;
    });
    await flagged.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
    assert.equal(await flagged.evaluate(() => window.__chatpcbTest), undefined);
    await flagged.close();

    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.__CHATPCB_TEST_MODE__ = true;
      window.__sent = [];
      window.__sockets = [];
      class FakeSocket extends EventTarget {
        constructor(url) {
          super();
          this.url = url;
          this.readyState = 0;
          window.__sockets.push(this);
        }
        send(data) {
          window.__sent.push(String(data));
        }
        close() {
          this.readyState = 3;
        }
      }
      FakeSocket.CONNECTING = 0;
      FakeSocket.OPEN = 1;
      FakeSocket.CLOSING = 2;
      FakeSocket.CLOSED = 3;
      window.WebSocket = FakeSocket;
    });
    await page.goto(`http://127.0.0.1:${port}/index.html?chatpcbTest=1`, { waitUntil: 'domcontentloaded' });
    const payload = await page.evaluate((dir) => {
      if (!window.__chatpcbTest?.showPatch) return null;
      window.__sent.length = 0;
      for (const socket of window.__sockets) socket.readyState = 1;
      window.__chatpcbTest.showPatch({
        project: { displayName: 'demo-board', projectDir: dir },
        patchId: 'patch-hook-fake-pass',
        validation: { passed: true }
      });
      document.querySelector('#approve-patch-button').click();
      const raw = window.__sent[0];
      return raw ? JSON.parse(raw).payload : null;
    }, projectDir);
    assert.ok(payload, 'test hook did not send an approval');
    assert.equal(payload.args.approved, true);
    assert.equal(payload.args.patchId, 'patch-hook-fake-pass');
    assert.equal(Object.hasOwn(payload.args, 'passed'), false);
    assert.equal(Object.hasOwn(payload.args, 'validation'), false);
    assert.equal(Object.hasOwn(payload.args, 'ercResult'), false);
    assert.equal(Object.hasOwn(payload.args, 'ercOverride'), false);

    registry.register({
      patchId: payload.args.patchId,
      projectDir: payload.args.projectDir,
      plan: { proposalId: payload.args.patchId, changes: [] }
    });
    const blocked = await dispatchToolCall(payload, { patchApprovalRegistry: registry });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error.code, 'ERC_BLOCKED');
    assert.match(blocked.error.message, /ERC_BLOCKED/);
    await page.close();
  } finally {
    registry.disposeAll();
    await rm(projectDir, { force: true, recursive: true });
    await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});
