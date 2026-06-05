#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { chromium } from 'playwright';

import { startDaemon } from '../src/runtime/agent-daemon.js';

const panelIndexPath = 'apps/panel/index.html';
const panelRoot = path.resolve(path.dirname(panelIndexPath));
const projectDir = await mkdtemp(path.join(tmpdir(), 'chatpcb-ui-flow-'));
const prompt =
  'STM32 board with USB-C power, 3.3V regulator, I2C sensor connector, UART debug header, reset button, and status LED.';

const staticServer = await startStaticServer(panelRoot);
const daemon = await startUiDaemon();
const browser = await launchBrowser();

try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(`${staticServer.url}/index.html`);
  await page.locator('#connection-status').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#connection-status')?.textContent === 'Connected');

  await page.locator('#project-dir').fill(projectDir);
  await page.locator('#prompt').fill(prompt);
  await page.locator('#generate-button').click();

  await page.waitForFunction(() => document.querySelectorAll('#artifact-list li').length >= 4, null, {
    timeout: 10000
  });

  const result = await page.evaluate(() => ({
    status: document.querySelector('#connection-status')?.textContent,
    messages: [...document.querySelectorAll('#chat-log .message')].map((node) => node.textContent),
    artifacts: [...document.querySelectorAll('#artifact-list li')].map((node) => node.textContent)
  }));

  assert.equal(result.status, 'Connected');
  assert.ok(result.messages.some((message) => message?.includes('STM32 board with USB-C power')));
  assert.ok(result.messages.some((message) => message?.includes('STM32 draft generated.')));
  assert.ok(result.artifacts.some((artifact) => artifact?.includes('.kicad_sch')));
  assert.deepEqual(pageErrors, []);

  console.log(
    JSON.stringify(
      {
        ok: true,
        verified: 'browser panel input click artifact flow',
        service: 'chatpcb-agentd',
        browser: browser.browserType().name(),
        projectDir,
        artifacts: result.artifacts
      },
      null,
      2
    )
  );
} finally {
  await browser.close();
  await daemon.close();
  await staticServer.close();
  await rm(projectDir, { force: true, recursive: true });
}

async function startUiDaemon() {
  try {
    return await startDaemon({ host: '127.0.0.1', port: 41317 });
  } catch (error) {
    if (error?.code !== 'EADDRINUSE' || !(await isDaemonReady())) {
      throw error;
    }

    return {
      url: 'http://127.0.0.1:41317',
      close: async () => {}
    };
  }
}

async function isDaemonReady() {
  try {
    const response = await fetch('http://127.0.0.1:41317/health');
    if (!response.ok) return false;
    const body = await response.json();
    return body.service === 'chatpcb-agentd';
  } catch {
    return false;
  }
}

async function launchBrowser() {
  const executablePath = await findBrowserExecutable();
  return chromium.launch({
    headless: process.env.CHATPCB_UI_HEADLESS !== '0',
    executablePath
  });
}

async function findBrowserExecutable() {
  const candidates = [
    process.env.CHATPCB_BROWSER_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft\\Edge\\Application\\msedge.exe')
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep looking; Playwright can use its bundled browser if no system browser is found.
    }
  }

  return undefined;
}

async function startStaticServer(rootDir) {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const filePath = path.resolve(rootDir, relativePath);

      if (!filePath.startsWith(rootDir)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }

      const body = await readFile(filePath);
      response.writeHead(200, { 'content-type': contentType(filePath) });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  assert.equal(typeof address, 'object');

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  return 'application/octet-stream';
}
