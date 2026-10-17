/* global document, window */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize, resolve, sep } from 'node:path';
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

test('panel warns when Apply is locked for missing or stale candidate ERC', async (t) => {
  const browser = await launchPanelBrowser(t);
  if (!browser) return;

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

  try {
    const page = await browser.newPage();
    const warnings = [];
    page.on('console', (message) => {
      if (message.type() === 'warning') warnings.push(message.text());
    });
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
    await page.goto(`http://127.0.0.1:${port}/index.html?lang=en&chatpcbTest=1`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => window.chatpcbI18n.ready);
    warnings.length = 0;

    const show = (state) => page.evaluate((next) => {
      window.__chatpcbTest.showPatch(next);
      return document.querySelector('#apply-why')?.dataset.reason ?? '';
    }, state);

    const missingState = {
      patchId: 'patch-missing',
      validation: {},
      candidateVerification: null
    };
    assert.equal(await show(missingState), 'patch.apply.blocked-missing');
    assert.deepEqual(warnings, ['patch.apply.blocked-missing']);

    assert.equal(await show(missingState), 'patch.apply.blocked-missing');
    assert.deepEqual(warnings, ['patch.apply.blocked-missing']);

    const failedReason = await show({
      patchId: 'patch-failed',
      validation: {},
      candidateVerification: {
        erc: { ok: false, status: 'failed', errorCount: 2, erc: { errorCount: 2 } }
      }
    });
    assert.equal(failedReason, 'patch.apply.blocked-erc');
    assert.deepEqual(warnings, ['patch.apply.blocked-missing']);

    const skippedReason = await show({
      patchId: 'patch-skipped',
      validation: { ok: true, skipped: true, executed: false }
    });
    assert.equal(skippedReason, 'patch.apply.skipped');
    assert.deepEqual(warnings, ['patch.apply.blocked-missing']);

    const staleReason = await show({
      patchId: 'patch-new',
      validation: {},
      candidateVerification: {
        patchId: 'patch-old',
        erc: { ok: true, status: 'passed', errorCount: 0, erc: { errorCount: 0 } }
      }
    });
    assert.equal(staleReason, 'patch.apply.blocked-stale');
    assert.deepEqual(warnings, ['patch.apply.blocked-missing', 'patch.apply.blocked-stale']);

    assert.equal(await show({
      patchId: 'patch-new',
      validation: {},
      candidateVerification: {
        erc: { patchId: 'patch-old', ok: true, status: 'passed', errorCount: 0, erc: { errorCount: 0 } }
      }
    }), 'patch.apply.blocked-stale');
    assert.deepEqual(warnings, ['patch.apply.blocked-missing', 'patch.apply.blocked-stale']);

    assert.equal(await show(missingState), 'patch.apply.blocked-missing');
    assert.deepEqual(warnings, [
      'patch.apply.blocked-missing',
      'patch.apply.blocked-stale',
      'patch.apply.blocked-missing'
    ]);

    const passedReason = await show({
      patchId: 'patch-pass',
      validation: {},
      candidateVerification: {
        erc: { ok: true, status: 'passed', errorCount: 0, erc: { errorCount: 0 } }
      }
    });
    assert.equal(passedReason, '');
    assert.deepEqual(warnings, [
      'patch.apply.blocked-missing',
      'patch.apply.blocked-stale',
      'patch.apply.blocked-missing'
    ]);
  } finally {
    await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});
