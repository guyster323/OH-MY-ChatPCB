/* global document, window, EventTarget */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import test from 'node:test';

import { launchPanelBrowser } from './helpers/launch-panel-browser.js';
import { startDaemon } from '../src/runtime/agent-daemon.js';
import { createEnvelope } from '../src/runtime/envelope.js';
import { generateMcuPeripheralProject } from '../src/workflow/generate-mcu-project.js';
import { ercVerdictCases } from './fixtures/erc-verdict-cases.js';

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

const passingVerify = async () => ({
  erc: { ok: true, skipped: false, executed: true, erc: { errorCount: 0, warningCount: 0 } },
  drc: { ok: true, skipped: true }
});
const passingDrc = async () => ({ ok: true, skipped: false, executed: true, violations: [], unconnectedItems: [] });

function accepts(entry) {
  return entry.passed === true;
}

function overrideAccepts(entry) {
  return entry.skipped === true;
}

test('shared ERC module matches the case table', async () => {
  const loaded = await import('../apps/panel/erc-verdict.js').catch((error) => ({ error }));
  assert.equal(loaded.error, undefined, loaded.error?.message ?? 'erc-verdict.js failed to load');
  const { classifyRecordedErc } = loaded;
  assert.equal(typeof classifyRecordedErc, 'function');
  assert.equal(classifyRecordedErc(undefined).missing, true);

  for (const entry of ercVerdictCases) {
    const verdict = classifyRecordedErc(entry.erc);
    assert.equal(verdict.passed, entry.passed, entry.id);
    assert.equal(verdict.skipped, entry.skipped, entry.id);
    assert.equal(verdict.failed, entry.failed, entry.id);
    assert.equal(verdict.missing, entry.missing, entry.id);
    assert.equal(verdict.errorCount, entry.errorCount, entry.id);
    const flags = [verdict.passed, verdict.skipped, verdict.failed, verdict.missing].filter(Boolean);
    assert.equal(flags.length, 1, entry.id);
  }
});

test('daemon websocket accepts an ERC record iff the case table says passed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chatpcb-erc-shared-'));
  const stateRoot = await mkdtemp(join(tmpdir(), 'chatpcb-erc-shared-journal-'));
  const base = 'STM32 board with USB-C power, 3.3V regulator, I2C connector, UART header, reset button, boot button, and LED.';
  let validateProjectImpl = async () => null;
  const daemon = await startDaemon({
    port: 0,
    dispatchOptions: {
      transactionStateRoot: stateRoot,
      validateProjectImpl: () => validateProjectImpl(),
      validateBoardImpl: passingDrc,
      verifyAppliedProjectImpl: passingVerify
    }
  });

  try {
    const generated = await generateMcuPeripheralProject({
      projectDir: root,
      prompt: 'RP2040 board with USB-C power and I2C connector.'
    });
    const specPath = generated.files.spec;
    const socket = await openDaemonSocket(daemon);

    try {
      for (const entry of ercVerdictCases) {
        validateProjectImpl = async () => entry.erc;
        const before = await readFile(specPath, 'utf8');
        const preview = await socket.call({
          id: `preview-${entry.id}`,
          name: 'schematic.patch',
          args: { projectDir: root, prompt: `${base} ${entry.id}` }
        });
        assert.equal(preview.ok, true, `${entry.id} preview ${JSON.stringify(preview)}`);
        const approved = await socket.call({
          id: `approve-${entry.id}`,
          name: 'schematic.patch',
          args: {
            projectDir: root,
            approved: true,
            patchId: preview.result.patchId,
            passed: true,
            validation: { ok: true, status: 'passed', skipped: false, erc: { errorCount: 0 } }
          }
        });
        assert.equal(approved.ok, accepts(entry), `${entry.id} ${JSON.stringify(approved)}`);
        if (!accepts(entry)) {
          assert.equal(approved.error?.code, 'ERC_BLOCKED', entry.id);
          assert.equal(await readFile(specPath, 'utf8'), before, entry.id);
          const overridden = await socket.call({
            id: `override-${entry.id}`,
            name: 'schematic.patch',
            args: {
              projectDir: root,
              approved: true,
              patchId: preview.result.patchId,
              ercOverride: 'skipped',
              passed: true
            }
          });
          assert.equal(overridden.ok, overrideAccepts(entry), `${entry.id} override ${JSON.stringify(overridden)}`);
          if (!overrideAccepts(entry)) {
            assert.equal(overridden.error?.code, 'ERC_BLOCKED', entry.id);
            assert.equal(await readFile(specPath, 'utf8'), before, entry.id);
          }
        }
      }
    } finally {
      socket.close();
    }
  } finally {
    await daemon.close();
    await rm(root, { force: true, recursive: true });
    await rm(stateRoot, { force: true, recursive: true });
  }
});

test('panel Apply is enabled iff the daemon would accept that ERC record', async (t) => {
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
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
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

    for (const entry of ercVerdictCases) {
      const view = await showCase(page, entry);
      assert.equal(view.applyEnabled, accepts(entry), entry.id);
      assert.equal(view.sentApply, accepts(entry), entry.id);
      assert.equal(view.overrideEnabled, overrideAccepts(entry), entry.id);
      if (view.sentApply) {
        assert.equal(view.sentOverride, false, entry.id);
        assert.equal(Object.hasOwn(view.args, 'passed'), false, entry.id);
        assert.equal(Object.hasOwn(view.args, 'ercOverride'), false, entry.id);
      }
    }
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});

function showCase(page, entry) {
  return page.evaluate((erc) => {
    window.__sent.length = 0;
    for (const socket of window.__sockets) socket.readyState = 1;
    window.__chatpcbTest.showPatch({
      validation: null,
      candidateVerification: erc == null ? null : { erc },
      inspection: {
        manifest: { freshness: { status: 'current', reason: 'Evidence matches.' } },
        validation: {}
      }
    });
    const button = document.querySelector('#approve-patch-button');
    const override = document.querySelector('#approve-patch-without-erc');
    const applyEnabled = button.disabled === false && button.getAttribute('aria-disabled') !== 'true';
    if (applyEnabled) button.click();
    const sent = window.__sent.map((raw) => JSON.parse(raw)).map((event) => event.payload);
    const approval = sent.find((payload) => payload?.args?.approved === true);
    return {
      applyEnabled,
      overrideEnabled: override.hidden === false && override.disabled === false,
      sentApply: Boolean(approval) && approval.args.ercOverride !== 'skipped',
      sentOverride: Boolean(approval) && approval.args.ercOverride === 'skipped',
      args: approval?.args ?? {}
    };
  }, entry.erc);
}

function openDaemonSocket(daemon) {
  const socket = new WebSocket(`${daemon.url.replace('http:', 'ws:')}/ws`);
  const pending = new Map();

  socket.addEventListener('message', (event) => {
    const envelope = JSON.parse(event.data);
    if (envelope.type !== 'tool.result' || !envelope.payload?.id) return;
    const waiter = pending.get(envelope.payload.id);
    if (!waiter) return;
    pending.delete(envelope.payload.id);
    waiter.resolve(envelope.payload);
  });

  return {
    call(payload) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(payload.id);
          reject(new Error(`websocket ${payload.id} timed out`));
        }, 60000);
        pending.set(payload.id, {
          resolve: (result) => {
            clearTimeout(timer);
            resolve(result);
          }
        });
        const send = () => socket.send(JSON.stringify(createEnvelope('tool.call', payload)));
        if (socket.readyState === WebSocket.OPEN) send();
        else socket.addEventListener('open', send, { once: true });
        socket.addEventListener('error', (error) => {
          clearTimeout(timer);
          pending.delete(payload.id);
          reject(error);
        }, { once: true });
      });
    },
    close() {
      socket.close();
    }
  };
}
