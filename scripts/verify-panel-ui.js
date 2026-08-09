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

const panelRoot = path.resolve('apps/panel');
const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-ui-flow-'));
const projectName = '가스 센서 보드 01';
const prompt = 'ESP32-S3와 가스 센서를 연결한 회로를 만들어줘';
const protocolFailurePrompt = 'Simulate a provider protocol failure.';
const rollbackPrompt = 'Simulate a validation rollback.';
let shouldFailValidation = false;

const staticServer = await startStaticServer(panelRoot);
const daemon = await startUiDaemon();
const browser = await launchBrowser();

try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript((url) => {
    window.CHATPCB_DAEMON_WS_URL = url;
  }, `ws://127.0.0.1:${daemon.port}/ws`);

  await page.goto(`${staticServer.url}/index.html`);
  await page.getByText('Connected', { exact: true }).waitFor();
  await expectSendDisabled(page);

  await page.getByLabel('Workspace root').fill(workspaceRoot);
  await page.getByLabel('Project name').fill(projectName);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('status', { name: 'Active project' }).waitFor();
  await page.getByRole('status', { name: 'Active project' }).getByText(projectName).waitFor();

  await page.getByLabel('Circuit request').fill(prompt);
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('status', { name: 'Request status' }).filter({ hasText: 'Completed' }).waitFor();

  const successfulRequest = await page.evaluate(() => ({
    hasGenerateButton: Boolean(document.querySelector('#generate-button')),
    artifacts: [...document.querySelectorAll('#artifact-list li')].map((node) => node.textContent),
    erc: document.querySelector('#validation-status')?.textContent,
    review: document.querySelector('#review-panel')?.textContent,
    fallback: document.querySelector('#kicad-fallback')?.textContent
  }));

  assert.equal(successfulRequest.hasGenerateButton, false);
  assert.ok(successfulRequest.artifacts.some((artifact) => artifact?.includes('.kicad_pro')));
  assert.match(successfulRequest.erc ?? '', /0 errors, 0 warnings/);
  assert.match(successfulRequest.review ?? '', /Review/);

  await page.getByRole('button', { name: 'Open in KiCad' }).click();
  await page.getByText(/Open the project from KiCad using this directory/).waitFor();
  assert.doesNotMatch(successfulRequest.fallback ?? '', /reloaded/i);

  await page.getByLabel('Circuit request').fill(protocolFailurePrompt);
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('status', { name: 'Request status' }).filter({ hasText: '요청을 처리하지 못했습니다' }).waitFor();

  const failure = await page.evaluate(() => ({
    summary: document.querySelector('#request-status')?.textContent,
    technicalDetail: document.querySelector('#request-technical-detail')?.textContent
  }));
  assert.doesNotMatch(failure.summary ?? '', /Providers may only emit/);
  assert.match(failure.technicalDetail ?? '', /Providers may only emit/);

  const hostPage = await browser.newPage();
  await hostPage.addInitScript((url) => {
    window.CHATPCB_DAEMON_WS_URL = url;
    window.hostMessages = [];
    window.hostDirty = false;
    window.chatpcbHost = {
      postMessage(message) {
        window.hostMessages.push(message);
        if (message.type === 'project.status') {
          setTimeout(() => window.postMessage({ type: 'project.status', projectPath: message.projectPath, dirty: window.hostDirty }, '*'), 25);
        }
      }
    };
  }, `ws://127.0.0.1:${daemon.port}/ws`);
  await hostPage.goto(`${staticServer.url}/index.html`);
  await hostPage.getByText('Connected', { exact: true }).waitFor();
  await hostPage.getByLabel('Workspace root').fill(workspaceRoot);
  await hostPage.getByLabel('Project name').fill('Host status board');
  await hostPage.getByRole('button', { name: 'New project' }).click();
  await hostPage.getByRole('status', { name: 'Active project' }).waitFor();

  await hostPage.evaluate(() => { window.hostDirty = true; });
  await hostPage.getByLabel('Circuit request').fill(prompt);
  await hostPage.getByRole('button', { name: 'Send' }).click();
  assert.equal(await hostPage.getByRole('button', { name: 'Send' }).isDisabled(), true);
  await hostPage.locator('#conflict-card').waitFor();
  await hostPage.waitForTimeout(75);
  assert.notEqual(await hostPage.locator('#request-status').getAttribute('data-state'), 'completed');

  await hostPage.evaluate(() => { window.hostDirty = false; });
  await hostPage.getByRole('button', { name: 'Send' }).click();
  await hostPage.getByRole('status', { name: 'Request status' }).filter({ hasText: 'Completed' }).waitFor();
  await hostPage.getByText(/reload-needed: .*\.kicad_pro/).waitFor();
  const reloadCount = await hostPage.evaluate(() => window.hostMessages.filter((message) => message.type === 'project.reload').length);
  assert.equal(reloadCount, 1);

  await hostPage.evaluate(() => {
    const projectPath = document.querySelector('#active-project-directory').textContent;
    window.postMessage({ type: 'project.reload', projectPath, completed: true }, '*');
  });
  await hostPage.getByText(/reloaded: .*\.kicad_pro/).waitFor();

  await hostPage.getByLabel('Circuit request').fill(rollbackPrompt);
  await hostPage.getByRole('button', { name: 'Send' }).click();
  await hostPage.waitForFunction(() => document.querySelector('#request-status')?.dataset.state === 'failed');
  const reloadCountAfterRollback = await hostPage.evaluate(() => window.hostMessages.filter((message) => message.type === 'project.reload').length);
  assert.equal(reloadCountAfterRollback, reloadCount);

  assert.deepEqual(pageErrors, []);

  console.log(JSON.stringify({ ok: true, verified: 'named project Send-only request and separate status cards', browser: browser.browserType().name() }, null, 2));
} finally {
  await browser.close();
  await daemon.close();
  await staticServer.close();
  await rm(workspaceRoot, { force: true, recursive: true });
}

async function expectSendDisabled(page) {
  assert.equal(await page.getByRole('button', { name: 'Send' }).isDisabled(), true);
}

async function startUiDaemon() {
  return startDaemon({
    host: '127.0.0.1',
    port: 0,
    dispatchOptions: {
      checkProviderAvailabilityImpl: async ({ provider }) => ({ provider, command: 'fake-provider', available: true, status: 'available' }),
      runProviderProcessImpl: fakeProviderTranscript,
      validateProjectImpl: async () => shouldFailValidation
        ? { ok: false, skipped: false, erc: { errorCount: 1, warningCount: 0, byType: { test: 1 } } }
        : { ok: true, skipped: false, erc: { errorCount: 0, warningCount: 0, byType: {} } }
    }
  });
}

async function fakeProviderTranscript({ input }) {
  if (input.includes(protocolFailurePrompt)) {
    throw new Error('Providers may only emit tool.call JSON or normal assistant text.');
  }
  shouldFailValidation = input.includes(rollbackPrompt);

  return {
    exitCode: 0,
    stderr: '',
    events: [
      createEnvelope('agent.delta', { text: 'Generating the gas sensor board.' }),
      createEnvelope('tool.call', {
        id: 'call_fake_provider_generate',
        name: 'schematic.generate',
        args: { prompt: 'ESP32-S3 board with USB-C power, I2C gas sensor connector, reset button, and status LED.' }
      })
    ]
  };
}

async function launchBrowser() {
  const executablePath = await findBrowserExecutable();
  return chromium.launch({ headless: process.env.CHATPCB_UI_HEADLESS !== '0', executablePath });
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
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))) };
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  return 'application/octet-stream';
}
