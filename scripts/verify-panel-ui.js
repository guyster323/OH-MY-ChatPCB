#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { chromium } from 'playwright';

import { startDaemon } from '../src/runtime/agent-daemon.js';
import { createEnvelope } from '../src/runtime/envelope.js';

const panelIndexPath = 'apps/panel/index.html';
const panelRoot = path.resolve(path.dirname(panelIndexPath));
const projectDir = await mkdtemp(path.join(tmpdir(), 'chatpcb-ui-flow-'));
const prompt =
  'STM32 board with USB-C power, 3.3V regulator, I2C sensor connector, UART debug header, reset button, and status LED.';
const patchPrompt = 'RP2040 board with USB-C power, I2C connector, reset button, and status LED.';
const providerPrompt = 'Use the selected provider to generate an STM32 board with USB-C power and status LED.';
const slowProviderPrompt = 'Start a slow provider request so the panel Stop button can cancel it.';

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

  await page.waitForFunction(() => document.querySelectorAll('#artifact-list li').length >= 6, null, {
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
  assert.ok(result.artifacts.some((artifact) => artifact?.includes('.kicad_sym')));
  assert.ok(result.artifacts.some((artifact) => artifact?.includes('sym-lib-table')));

  await page.locator('#prompt').fill(patchPrompt);
  await page.locator('#preview-patch-button').click();
  await page.locator('#patch-review').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#patch-diff')?.textContent?.includes('--- chatpcb_mcu_peripheral.chatpcb.json'));
  await page.locator('#cancel-patch-button').click();
  await page.locator('#patch-review').waitFor({ state: 'hidden' });

  await page.locator('#preview-patch-button').click();
  await page.locator('#patch-review').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#patch-diff')?.textContent?.includes('+++ chatpcb_mcu_peripheral.chatpcb.json'));
  await page.locator('#approve-patch-button').click();
  await page.waitForFunction(() => [...document.querySelectorAll('#chat-log .message')].some((node) => node.textContent?.includes('Patch applied. ERC passed.')), null, {
    timeout: 20000
  });
  await page.waitForFunction(() => document.querySelectorAll('#artifact-list li').length >= 6, null, {
    timeout: 10000
  });

  const patchResult = await page.evaluate(() => ({
    patchHidden: document.querySelector('#patch-review')?.hasAttribute('hidden'),
    messages: [...document.querySelectorAll('#chat-log .message')].map((node) => node.textContent),
    artifacts: [...document.querySelectorAll('#artifact-list li')].map((node) => node.textContent)
  }));

  assert.equal(patchResult.patchHidden, true);
  assert.ok(patchResult.messages.some((message) => message?.includes('Patch canceled.')));
  assert.ok(patchResult.messages.some((message) => message?.includes('Patch applied. ERC passed.')));
  assert.ok(patchResult.artifacts.some((artifact) => artifact?.includes('.kicad_sym')));

  await page.locator('#prompt').fill(slowProviderPrompt);
  await page.locator('#composer button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#cancel-provider-button')?.disabled === false, null, {
    timeout: 10000
  });
  await page.locator('#cancel-provider-button').click();
  await page.waitForFunction(
    () => [...document.querySelectorAll('#chat-log .message')].some((node) => node.textContent?.includes('Provider request cancelled.')),
    null,
    {
      timeout: 10000
    }
  );
  await page.waitForFunction(() => document.querySelector('#cancel-provider-button')?.disabled === true, null, {
    timeout: 10000
  });

  const cancelResult = await page.evaluate(() => ({
    cancelDisabled: document.querySelector('#cancel-provider-button')?.disabled,
    messages: [...document.querySelectorAll('#chat-log .message')].map((node) => node.textContent)
  }));

  assert.equal(cancelResult.cancelDisabled, true);
  assert.ok(cancelResult.messages.some((message) => message?.includes('Provider request cancelled.')));

  await page.locator('#prompt').fill(providerPrompt);
  await page.locator('#composer button[type="submit"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('#chat-log .message')].some((node) => node.textContent?.includes('Drafting from fake provider.')), null, {
    timeout: 10000
  });
  await page.waitForFunction(() => [...document.querySelectorAll('#chat-log .message')].filter((node) => node.textContent?.includes('STM32 draft generated.')).length >= 2, null, {
    timeout: 10000
  });

  const providerResult = await page.evaluate(() => ({
    messages: [...document.querySelectorAll('#chat-log .message')].map((node) => node.textContent),
    artifacts: [...document.querySelectorAll('#artifact-list li')].map((node) => node.textContent)
  }));

  assert.ok(providerResult.messages.some((message) => message?.includes('Drafting from fake provider.')));
  assert.ok(providerResult.messages.some((message) => message?.includes(providerPrompt)));
  assert.ok(providerResult.artifacts.some((artifact) => artifact?.includes('.kicad_sym')));
  assert.deepEqual(pageErrors, []);

  console.log(
    JSON.stringify(
      {
        ok: true,
        verified: 'browser panel generate preview cancel approve provider stop artifact flow',
        service: 'chatpcb-agentd',
        browser: browser.browserType().name(),
        projectDir,
        artifacts: providerResult.artifacts
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
  return startDaemon({
    host: '127.0.0.1',
    port: 41317,
    dispatchOptions: {
      checkProviderAvailabilityImpl: async ({ provider }) => ({
        provider,
        command: 'fake-provider',
        available: true,
        status: 'available'
      }),
      runProviderProcessImpl: fakeProviderTranscript
    }
  });
}

async function fakeProviderTranscript({ input, signal }) {
  if (input.includes(slowProviderPrompt)) {
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('Provider process cancelled.')));
    });
  }

  return {
    exitCode: 0,
    stderr: '',
    events: [
      createEnvelope('agent.delta', { text: 'Drafting from fake provider.' }),
      createEnvelope('tool.call', {
        id: 'call_fake_provider_generate',
        name: 'schematic.generate',
        args: {
          prompt
        }
      })
    ]
  };
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
