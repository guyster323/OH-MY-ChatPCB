import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { chromium } from 'playwright';

const panelRoot = path.resolve(import.meta.dirname, '../apps/panel');
const projectDir = '/tmp/chatpcb-panel-secret-project-path';
const englishBusy = 'Another operation is using this project. Try again in a moment.';
const koreanBusy = '다른 작업이 이 프로젝트를 사용 중이에요. 잠시 후 다시 시도하세요.';

test('panel shows PROJECT_BUSY for request, apply, and patch and stays retryable', async (t) => {
  const browser = await launchPanelBrowser();
  if (!browser) {
    t.skip('no browser available');
    return;
  }

  const calls = [];
  const daemon = await startMockDaemon((call) => {
    calls.push(call);
    return responseFor(call, calls);
  });
  const staticServer = await startStaticServer(panelRoot);
  const pageErrors = [];

  try {
    const page = await browser.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.addInitScript((url) => {
      window.CHATPCB_DAEMON_WS_URL = url;
    }, daemon.url);
    await page.goto(`${staticServer.url}/index.html`);
    await page.getByText('Connected', { exact: true }).waitFor();
    await page.evaluate(() => {
      window.__busyCycle = 0;
      window.__sawRunning = false;
      const status = document.querySelector('#request-status');
      new MutationObserver(() => {
        if (status.dataset.state === 'running') window.__sawRunning = true;
        if (window.__sawRunning && status.dataset.state === 'failed') {
          window.__busyCycle += 1;
          window.__sawRunning = false;
        }
      }).observe(status, { attributes: true, childList: true, subtree: true, characterData: true });
    });

    await page.getByLabel('Workspace root').fill('/tmp/chatpcb-panel-workspace');
    await page.getByLabel('Project name').fill('Busy Board');
    await page.locator('#new-project-form').getByRole('button', { name: 'New project' }).click();
    await page.getByRole('status', { name: 'Active project' }).getByText('Busy Board').waitFor();

    await sendPrompt(page, 'Add a status LED.');
    await waitForBusyCycle(page, 1);
    await assertBusyState(page, englishBusy);

    await page.getByRole('button', { name: 'Send' }).click();
    await waitForBusyCycle(page, 2);
    await assertBusyState(page, englishBusy);
    assert.equal(calls.filter((call) => call.name === 'project.request').length, 2);

    await sendPrompt(page, '상태 LED를 추가해 주세요.');
    await waitForBusyCycle(page, 3);
    await assertBusyState(page, koreanBusy);

    await sendPrompt(page, 'show draft');
    await page.getByRole('button', { name: '이 구성으로 초안 만들기' }).waitFor();

    await page.getByRole('button', { name: '이 구성으로 초안 만들기' }).click();
    await waitForBusyCycle(page, 4);
    await assertBusyState(page, englishBusy);
    await page.getByRole('button', { name: '이 구성으로 초안 만들기' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Send' }).isEnabled(), true);

    await page.getByRole('button', { name: '이 구성으로 초안 만들기' }).click();
    await page.getByText('회로 초안이 준비됐어요. 스키매틱에 적용할까요?').waitFor();
    await page.waitForFunction(() => {
      const button = document.querySelector('#approve-patch-button');
      return button && button.disabled === false;
    });

    await page.getByRole('button', { name: 'Approve' }).click();
    await waitForBusyCycle(page, 5);
    await assertBusyState(page, englishBusy);
    assert.equal(await page.getByRole('button', { name: 'Approve' }).isEnabled(), true);
    assert.equal(await page.locator('#patch-approval-card').isHidden(), false);

    await page.getByRole('button', { name: 'Approve' }).click();
    await waitForBusyCycle(page, 6);
    await assertBusyState(page, englishBusy);
    assert.equal(calls.filter((call) => call.name === 'schematic.patch' && call.args?.approved === true).length, 2);
    assert.equal(calls.filter((call) => call.name === 'schematic.generate').length, 2);
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser.close();
    await daemon.close();
    await staticServer.close();
  }
});

async function sendPrompt(page, prompt) {
  await page.getByLabel('Circuit request').fill(prompt);
  await page.getByRole('button', { name: 'Send' }).click();
}

async function waitForBusyCycle(page, cycle) {
  await page.waitForFunction((expected) => window.__busyCycle >= expected, cycle);
}

async function assertBusyState(page, message) {
  const status = page.locator('#request-status');
  await page.waitForFunction((expected) => document.querySelector('#request-status')?.textContent === expected, message);
  assert.equal(await status.getAttribute('data-state'), 'failed');
  assert.equal(await status.textContent(), message);
  assert.equal((await status.textContent()).includes(projectDir), false);
  assert.equal((await page.locator('#request-technical-detail').textContent())?.includes(projectDir) ?? false, false);
  assert.equal(await page.getByRole('button', { name: 'Send' }).isEnabled(), true);
  assert.equal(await page.getByLabel('Circuit request').isEnabled(), true);
}

function responseFor(call, calls) {
  const { name, args } = call;
  if (name === 'provider.status') {
    return { ok: true, result: { provider: args?.provider ?? 'codex', status: 'available' } };
  }
  if (name === 'project.create') {
    return { ok: true, result: { displayName: 'Busy Board', slug: 'Busy-Board', projectDir } };
  }
  if (name === 'project.inspect') {
    return {
      ok: true,
      result: {
        manifest: { freshness: { status: 'missing', reason: 'No manifest yet.' } },
        inspection: { projectDigest: 'a'.repeat(64), artifactCount: 0 },
        validation: {}
      }
    };
  }
  if (name === 'project.request') {
    if (args?.prompt === 'show draft') {
      return {
        ok: false,
        error: { code: 'PROVIDER_FAILED', message: 'draft now' },
        conversation: {
          status: 'generate',
          specRows: [{ label: 'MCU', value: 'ESP32' }],
          options: []
        }
      };
    }
    return { ok: false, error: { code: 'PROJECT_BUSY', message: busyMessage(args?.prompt) } };
  }
  if (name === 'schematic.generate') {
    const seen = calls.filter((item) => item.name === 'schematic.generate').length;
    if (seen === 1) return { ok: false, error: { code: 'PROJECT_BUSY', message: busyMessage(args?.prompt) } };
    return {
      ok: true,
      result: {
        requiresApproval: true,
        patchId: 'patch-1',
        expiresAt: Date.now() + 120000,
        files: {},
        review: { status: 'ready', findings: { blockers: [], warnings: [], notes: [] }, proposedFixes: [] },
        validation: { ok: true, skipped: false, erc: { errorCount: 0, warningCount: 0 } }
      }
    };
  }
  if (name === 'schematic.patch') {
    return { ok: false, error: { code: 'PROJECT_BUSY', message: englishBusy } };
  }
  return { ok: false, error: { code: 'UNKNOWN_TOOL', message: `Unexpected tool ${name}` } };
}

function busyMessage(prompt) {
  return /[가-힣]/.test(prompt ?? '') ? koreanBusy : englishBusy;
}

async function launchPanelBrowser() {
  const options = {
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  };
  const candidates = [process.env.CHATPCB_BROWSER_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].filter(Boolean);
  for (const executablePath of candidates) {
    try {
      return await chromium.launch({ ...options, executablePath });
    } catch {
      // Try the next installed browser.
    }
  }
  try {
    return await chromium.launch(options);
  } catch {
    return null;
  }
}

async function startMockDaemon(handler) {
  const server = createServer();
  server.on('upgrade', (request, socket) => {
    if (request.url !== '/ws') {
      socket.destroy();
      return;
    }
    const key = request.headers['sec-websocket-key'];
    const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      ''
    ].join('\r\n'));
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 2) {
        const opcode = buffer[0] & 0x0f;
        let length = buffer[1] & 0x7f;
        let offset = 2;
        if (length === 126) {
          if (buffer.length < 4) return;
          length = buffer.readUInt16BE(2);
          offset = 4;
        } else if (length === 127) {
          if (buffer.length < 10) return;
          length = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }
        const masked = (buffer[1] & 0x80) !== 0;
        if (buffer.length < offset + (masked ? 4 : 0) + length) return;
        const mask = masked ? buffer.subarray(offset, offset + 4) : null;
        if (masked) offset += 4;
        const data = Buffer.from(buffer.subarray(offset, offset + length));
        buffer = buffer.subarray(offset + length);
        if (mask) {
          for (let index = 0; index < data.length; index += 1) data[index] ^= mask[index % 4];
        }
        if (opcode === 0x8) {
          socket.end(encodeFrame(0x8, data));
          return;
        }
        if (opcode === 0x9) {
          socket.write(encodeFrame(0xA, data));
          continue;
        }
        if (opcode !== 0x1) continue;
        let envelope;
        try {
          envelope = JSON.parse(data.toString('utf8'));
        } catch {
          continue;
        }
        if (envelope.type !== 'tool.call') continue;
        const call = envelope.payload ?? {};
        const body = handler(call);
        socket.write(encodeFrame(0x1, JSON.stringify({
          version: 1,
          id: `evt_${randomUUID()}`,
          type: 'tool.result',
          createdAt: new Date().toISOString(),
          payload: { id: call.id, ...body }
        })));
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  return {
    url: `ws://127.0.0.1:${address.port}/ws`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

function encodeFrame(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let header;
  if (data.length < 126) {
    header = Buffer.from([0x80 | opcode, data.length]);
  } else if (data.length <= 0xffff) {
    header = Buffer.from([0x80 | opcode, 126, data.length >> 8, data.length & 0xff]);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  return Buffer.concat([header, data]);
}

async function startStaticServer(rootDir) {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      const relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
      const filePath = path.resolve(rootDir, relativePath);
      if (!filePath.startsWith(`${rootDir}${path.sep}`) && filePath !== rootDir) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }
      const body = await readFile(filePath);
      response.writeHead(200, { 'content-type': contentType(filePath), 'cache-control': 'no-store' });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

function contentType(filePath) {
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.png')) return 'image/png';
  return 'text/html; charset=utf-8';
}
