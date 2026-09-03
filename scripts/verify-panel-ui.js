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
const zeroCountFailurePrompt = 'Simulate a zero-count validation failure.';
const skippedValidationPrompt = 'Simulate a skipped validation.';
const unavailableValidationPrompt = 'Simulate unavailable validation tooling.';
const delayedSwitchPrompt = 'Simulate a delayed request while switching projects.';
const previewPrompt = 'Simulate an approval-required patch preview.';
let validationMode = 'passed';
let providerRequestCount = 0;
let inspectionDigest = 'a'.repeat(64);

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
  await page.getByText('current', { exact: true }).waitFor();

  const inspection = await page.evaluate(() => ({
    freshness: document.querySelector('#inspection-freshness')?.textContent,
    digest: document.querySelector('#inspection-digest')?.textContent,
    artifacts: document.querySelector('#inspection-artifact-count')?.textContent,
    erc: document.querySelector('#inspection-erc')?.textContent,
    drc: document.querySelector('#inspection-drc')?.textContent
  }));
  assert.deepEqual(inspection, {
    freshness: 'current',
    digest: 'aaaaaaaaaaaa',
    artifacts: '6 artifacts',
    erc: 'ERC 0/0',
    drc: 'DRC 0/2'
  });

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

  await page.getByLabel('Circuit request').fill(previewPrompt);
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForFunction(() => document.querySelector('#patch-approval-status')?.textContent === 'Patch preview is ready for approval.');
  assert.equal(await page.getByRole('button', { name: 'Approve' }).isDisabled(), false);
  await page.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('status', { name: 'Request status' }).filter({ hasText: 'Completed' }).waitFor();

  await page.getByRole('button', { name: 'Open in KiCad' }).click();
  await page.getByText(/Open this \.kicad_pro file from KiCad/).waitFor();
  await assertStandaloneGuidanceNamesAFile(page);
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

  await page.getByLabel('Project name').fill('Zero validation board');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('status', { name: 'Active project' }).getByText('Zero validation board').waitFor();
  await page.getByLabel('Circuit request').fill(zeroCountFailurePrompt);
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForFunction(() => document.querySelector('#request-status')?.dataset.state === 'failed', null, { timeout: 2000 });
  const failedZeroCountValidation = await page.evaluate(() => ({
    state: document.querySelector('#validation-status')?.dataset.state,
    text: document.querySelector('#validation-status')?.textContent
  }));
  assert.equal(failedZeroCountValidation.state, 'failed');
  assert.match(failedZeroCountValidation.text ?? '', /ERC command failed before a report was produced/);
  assert.doesNotMatch(failedZeroCountValidation.text ?? '', /\[object Object\]/);

  await assertValidationState(page, skippedValidationPrompt, 'skipped', /ERC skipped: No schematic was available for ERC\./);
  await assertValidationState(page, unavailableValidationPrompt, 'unavailable', /ERC unavailable: KiCad CLI was not available\./);

  const silentHostPage = await browser.newPage();
  await silentHostPage.addInitScript((url) => {
    window.CHATPCB_DAEMON_WS_URL = url;
    window.hostMessages = [];
    window.chatpcbHost = {
      postMessage(message) {
        window.hostMessages.push(message);
      }
    };
  }, `ws://127.0.0.1:${daemon.port}/ws`);
  await silentHostPage.goto(`${staticServer.url}/index.html`);
  await silentHostPage.getByText('Connected', { exact: true }).waitFor();
  await silentHostPage.getByLabel('Workspace root').fill(workspaceRoot);
  await silentHostPage.getByLabel('Project name').fill('Silent host board');
  await silentHostPage.getByRole('button', { name: 'New project' }).click();
  await silentHostPage.getByRole('status', { name: 'Active project' }).waitFor();
  const providerRequestsBeforeSilentHost = providerRequestCount;
  await silentHostPage.getByLabel('Circuit request').fill(prompt);
  await silentHostPage.getByRole('button', { name: 'Send' }).click();
  await silentHostPage.waitForTimeout(750);
  const silentHostResult = await silentHostPage.evaluate(() => ({
    requestState: document.querySelector('#request-status')?.dataset.state,
    requestStatus: document.querySelector('#request-status')?.textContent,
    hostMessages: window.hostMessages
  }));
  assert.equal(providerRequestCount, providerRequestsBeforeSilentHost);
  assert.equal(silentHostResult.requestState, 'failed');
  assert.match(silentHostResult.requestStatus ?? '', /KiCad host.*unavailable|host.*not responding/i);
  assert.equal(silentHostResult.hostMessages.filter((message) => message.type === 'project.status').length, 1);

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
  await hostPage.getByRole('status', { name: 'Active project' }).getByText('Host status board').waitFor();

  const hostProjectPath = await hostPage.locator('#active-project-directory').textContent();
  await hostPage.evaluate((projectPath) => {
    window.postMessage({ type: 'project.status', projectPath, dirty: false, linkState: 'linked' }, '*');
  }, hostProjectPath);
  await hostPage.waitForFunction(() => document.querySelector('#kicad-link')?.dataset.state === 'linked', null, { timeout: 2000 });
  const linkedStatus = await hostPage.locator('#kicad-link').textContent();
  await hostPage.evaluate(() => {
    window.postMessage({ type: 'project.status', projectPath: 'C:\\stale-project', dirty: false, linkState: 'error' }, '*');
  });
  await hostPage.waitForTimeout(50);
  assert.equal(await hostPage.locator('#kicad-link').textContent(), linkedStatus);
  for (const linkState of ['unlinked', 'error']) {
    await hostPage.evaluate(({ projectPath, linkState }) => {
      window.postMessage({ type: 'project.status', projectPath, dirty: false, linkState }, '*');
    }, { projectPath: hostProjectPath, linkState });
    await hostPage.waitForFunction((expected) => document.querySelector('#kicad-link')?.dataset.state === expected, linkState, { timeout: 2000 });
  }

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

  await hostPage.evaluate((projectPath) => {
    window.postMessage({ type: 'project.reload', projectPath, linkState: 'unlinked', completed: false }, '*');
  }, hostProjectPath);
  await hostPage.waitForFunction(() => document.querySelector('#kicad-link')?.dataset.state === 'unlinked', null, { timeout: 2000 });
  await hostPage.evaluate((projectPath) => {
    window.postMessage({ type: 'project.reload', projectPath, linkState: 'error', completed: false }, '*');
  }, hostProjectPath);
  await hostPage.waitForFunction(() => document.querySelector('#kicad-link')?.dataset.state === 'error', null, { timeout: 2000 });

  await hostPage.evaluate(() => {
    const projectPath = document.querySelector('#active-project-directory').textContent;
    window.postMessage({ type: 'project.reload', projectPath, completed: true }, '*');
  });
  await hostPage.getByText(/reloaded: .*\.kicad_pro/).waitFor();
  inspectionDigest = 'b'.repeat(64);
  await hostPage.evaluate(() => {
    const projectPath = document.querySelector('#active-project-directory').textContent;
    window.postMessage({ type: 'project.reload', projectPath, completed: true }, '*');
  });
  await hostPage.getByText('stale', { exact: true }).waitFor();
  assert.equal(await hostPage.locator('#approve-patch-button').isDisabled(), true);
  assert.match(await hostPage.locator('#patch-approval-status').textContent() ?? '', /stale evidence/i);

  inspectionDigest = 'a'.repeat(64);
  await hostPage.evaluate(() => {
    const projectPath = document.querySelector('#active-project-directory').textContent;
    window.postMessage({ type: 'project.reload', projectPath, completed: true }, '*');
  });
  await hostPage.getByText('current', { exact: true }).waitFor();
  await hostPage.getByLabel('Circuit request').fill(previewPrompt);
  await hostPage.getByRole('button', { name: 'Send' }).click();
  await hostPage.waitForFunction(() => document.querySelector('#patch-approval-status')?.textContent === 'Patch preview is ready for approval.');
  assert.equal(await hostPage.locator('#approve-patch-button').isDisabled(), false);
  await hostPage.evaluate((projectPath) => {
    window.postMessage({ type: 'project.status', projectPath, dirty: true, linkState: 'conflict' }, '*');
  }, hostProjectPath);
  await hostPage.locator('#conflict-card').waitFor();
  assert.equal(await hostPage.locator('#approve-patch-button').isDisabled(), true);
  assert.match(await hostPage.locator('#patch-approval-status').textContent() ?? '', /cleared/i);

  await hostPage.getByLabel('Circuit request').fill(rollbackPrompt);
  await hostPage.getByRole('button', { name: 'Send' }).click();
  await hostPage.waitForFunction(() => document.querySelector('#patch-approval-status')?.textContent === 'Patch preview is ready for approval.');
  await hostPage.getByRole('button', { name: 'Approve' }).click();
  await hostPage.waitForFunction(() => document.querySelector('#request-status')?.dataset.state === 'failed');
  const reloadCountAfterRollback = await hostPage.evaluate(() => window.hostMessages.filter((message) => message.type === 'project.reload').length);
  assert.equal(reloadCountAfterRollback, reloadCount);

  await hostPage.evaluate((projectPath) => {
    window.postMessage({ type: 'project.status', projectPath, dirty: true, linkState: 'conflict' }, '*');
  }, hostProjectPath);
  await hostPage.locator('#conflict-card').waitFor();
  const projectOpenCountBeforeSwitch = await hostPage.evaluate(() => window.hostMessages.filter((message) => message.type === 'project.open').length);
  await hostPage.getByLabel('Project name').fill('Switched board');
  await hostPage.getByRole('button', { name: 'New project' }).click();
  await hostPage.getByRole('status', { name: 'Active project' }).getByText('Switched board').waitFor();
  const switchedProjectState = await hostPage.evaluate(() => ({
    artifacts: document.querySelectorAll('#artifact-list li').length,
    reviewHidden: document.querySelector('#review-panel')?.hidden,
    validationState: document.querySelector('#validation-status')?.dataset.state,
    validationText: document.querySelector('#validation-status')?.textContent,
    validationTimestamp: document.querySelector('#validation-timestamp')?.textContent,
    conflictHidden: document.querySelector('#conflict-card')?.hidden,
    kiCadCardHidden: document.querySelector('#kicad-link-card')?.hidden,
    kiCadLinkText: document.querySelector('#kicad-link')?.textContent,
    fallbackHidden: document.querySelector('#kicad-fallback')?.hidden
  }));
  assert.deepEqual(switchedProjectState, {
    artifacts: 0,
    reviewHidden: true,
    validationState: 'idle',
    validationText: 'Not run',
    validationTimestamp: '',
    conflictHidden: true,
    kiCadCardHidden: true,
    kiCadLinkText: '',
    fallbackHidden: true
  });
  await hostPage.locator('#open-kicad-button').evaluate((button) => button.click());
  await hostPage.waitForTimeout(50);
  assert.equal(
    await hostPage.evaluate(() => window.hostMessages.filter((message) => message.type === 'project.open').length),
    projectOpenCountBeforeSwitch
  );

  await hostPage.getByLabel('Circuit request').fill(delayedSwitchPrompt);
  await hostPage.getByRole('button', { name: 'Send' }).click();
  await hostPage.waitForTimeout(100);
  await hostPage.getByLabel('Project name').fill('Final board');
  await hostPage.getByRole('button', { name: 'New project' }).click();
  await hostPage.getByRole('status', { name: 'Active project' }).getByText('Final board').waitFor();
  await hostPage.waitForTimeout(500);
  assert.equal(await hostPage.locator('#artifact-list li').count(), 0);
  assert.equal(await hostPage.locator('#kicad-link-card').getAttribute('hidden'), '');

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

async function assertStandaloneGuidanceNamesAFile(page) {
  const guidance = await page.locator('#kicad-fallback').textContent();
  assert.match(guidance ?? '', /\.kicad_pro file/i);
  assert.doesNotMatch(guidance ?? '', /using this directory/i);
}

async function assertValidationState(page, request, expectedState, expectedText) {
  await page.getByLabel('Circuit request').fill(request);
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForFunction(() => document.querySelector('#request-status')?.dataset.state !== 'running');
  const requestStatus = await page.locator('#request-status').textContent();
  if (requestStatus === 'Patch preview is ready for approval.') {
    await page.waitForFunction(() => document.querySelector('#patch-approval-status')?.textContent === 'Patch preview is ready for approval.');
    await page.getByRole('button', { name: 'Approve' }).click();
  }
  await page.waitForFunction((state) => document.querySelector('#validation-status')?.dataset.state === state, expectedState);
  assert.match(await page.locator('#validation-status').textContent() ?? '', expectedText);
}

async function startUiDaemon() {
  return startDaemon({
    host: '127.0.0.1',
    port: 0,
    dispatchOptions: {
      checkProviderAvailabilityImpl: async ({ provider }) => ({ provider, command: 'fake-provider', available: true, status: 'available' }),
      runProviderProcessImpl: fakeProviderTranscript,
      validateProjectImpl: async () => {
        if (validationMode === 'errors') {
          return { ok: false, skipped: false, erc: { errorCount: 1, warningCount: 0, byType: { test: 1 } } };
        }
        if (validationMode === 'zero-failed') {
          return {
            ok: false,
            skipped: false,
            reason: { code: 'ERC_COMMAND_FAILED', message: 'ERC command failed before a report was produced.' },
            erc: { errorCount: 0, warningCount: 0, byType: {} }
          };
        }
        if (validationMode === 'skipped') {
          return { ok: true, skipped: true, reason: { code: 'NO_SCHEMATIC', message: 'No schematic was available for ERC.' } };
        }
        if (validationMode === 'unavailable') {
          return { ok: true, skipped: true, reason: { code: 'KICAD_CLI_UNAVAILABLE', message: 'KiCad CLI was not available.' } };
        }
        return { ok: true, skipped: false, erc: { errorCount: 0, warningCount: 0, byType: {} } };
      },
      inspectProjectImpl: async () => ({
        inspection: { projectDigest: inspectionDigest, artifactCount: 6 },
        manifest: {
          schemaVersion: 2,
          freshness: inspectionDigest.startsWith('a')
            ? { status: 'current', reason: 'Evidence matches.' }
            : { status: 'stale', reason: 'Evidence no longer matches.' }
        },
        validation: {
          erc: { ok: true, erc: { errorCount: 0, warningCount: 0 } },
          drc: { ok: false, drc: { violationCount: 0, unconnectedCount: 2 } }
        }
      })
    }
  });
}

async function fakeProviderTranscript({ input }) {
  if (input.includes(protocolFailurePrompt)) {
    throw new Error('Providers may only emit tool.call JSON or normal assistant text.');
  }
  providerRequestCount += 1;
  validationMode = input.includes(rollbackPrompt)
    ? 'errors'
    : input.includes(zeroCountFailurePrompt)
      ? 'zero-failed'
      : input.includes(skippedValidationPrompt)
        ? 'skipped'
        : input.includes(unavailableValidationPrompt)
          ? 'unavailable'
      : 'passed';
  if (input.includes(delayedSwitchPrompt)) {
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  if (input.includes(previewPrompt) || input.includes(rollbackPrompt) || input.includes(skippedValidationPrompt) || input.includes(unavailableValidationPrompt)) {
    return { exitCode: 0, stderr: '', events: [createEnvelope('agent.delta', { text: 'Preparing a patch preview.' })] };
  }

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
