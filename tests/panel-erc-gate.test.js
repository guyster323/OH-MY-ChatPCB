/* global NodeFilter, document, getComputedStyle, window */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import test from 'node:test';

import { launchPanelBrowser } from './helpers/launch-panel-browser.js';

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

const passedValidation = {
  ok: true,
  skipped: false,
  erc: { errorCount: 0, warningCount: 0 }
};

test('panel apply follows the recorded ERC result', async (t) => {
  const browser = await launchPanelBrowser(t);
  if (!browser) return;

  const en = JSON.parse(await readFile(join(PANEL_ROOT, 'locales/en.json'), 'utf8'));
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

    const passed = await showPatch(page, {
      validation: passedValidation,
      candidateVerification: {
        erc: { ok: true, skipped: false, status: 'passed', erc: { errorCount: 0, warningCount: 0 } }
      },
      inspection: {
        manifest: { freshness: { status: 'current', reason: 'Evidence matches.' } },
        validation: {}
      }
    }, 'apply');
    assert.equal(passed.disabled, false);
    assert.equal(passed.ariaDisabled, null);
    assert.equal(passed.overrideHidden, true);
    assert.equal(passed.whyHidden, true);
    assert.equal(passed.sent.length, 1);
    assert.equal(passed.sent[0].args.approved, true);
    assert.equal(passed.sent[0].args.patchId, 'patch_test');
    assert.equal(Object.hasOwn(passed.sent[0].args, 'ercOverride'), false);
    assert.equal(Object.hasOwn(passed.sent[0].args, 'passed'), false);

    const failed = await showPatch(page, {
      validation: {
        ok: false,
        skipped: false,
        passed: true,
        erc: {
          ok: false,
          errorCount: 2,
          violations: [{ message: 'Pin 3 of U2 (EN) is not connected' }]
        }
      }
    }, 'apply');
    assert.equal(failed.disabled, false);
    assert.equal(failed.ariaDisabled, 'true');
    assert.equal(failed.overrideHidden, true);
    assert.equal(failed.whyText, en['patch.apply.blocked-erc'].replace('{count}', '2'));
    assert.equal(failed.ercRole, 'alert');
    assert.deepEqual(failed.sent, []);

    const skipped = await showPatch(page, {
      validation: {
        ok: true,
        skipped: true,
        reason: { code: 'KICAD_CLI_UNAVAILABLE', message: 'KiCad CLI was not available.' }
      }
    }, 'apply');
    assert.equal(skipped.disabled, false);
    assert.equal(skipped.ariaDisabled, 'true');
    assert.equal(skipped.overrideHidden, false);
    assert.equal(skipped.overrideText, en['patch.apply.without-erc']);
    assert.equal(skipped.whyText, en['patch.apply.skipped']);
    assert.equal(skipped.confirmHidden, true);
    assert.equal(skipped.skippedNoticeCount, 1);
    assert.match(skipped.ercText, new RegExp(en['erc.skipped']));
    assert.equal(skipped.ercClass.includes('erc-pass'), false);
    assert.equal(skipped.ercClass.includes('erc-skip'), true);
    assert.equal(skipped.ercIcon, '⚠');
    assert.equal(skipped.ercColor, skipped.warnColor);
    assert.deepEqual(skipped.sent, []);

    const armed = await showPatch(page, {
      validation: { ok: true, skipped: true, executed: false }
    }, 'override');
    assert.deepEqual(armed.sent, []);
    assert.equal(armed.confirmHidden, false);
    assert.equal(armed.riskText, en['patch.apply.without-erc.risk']);

    const overridden = await showPatch(page, {
      validation: { ok: true, skipped: true, executed: false }
    }, 'confirm-override');
    assert.equal(overridden.sent.length, 1);
    assert.equal(overridden.sent[0].args.approved, true);
    assert.equal(overridden.sent[0].args.ercOverride, 'skipped');
    assert.equal(overridden.sent[0].args.patchId, 'patch_test');

    const cancelled = await showPatch(page, {
      validation: { ok: true, skipped: true, executed: false }
    }, 'cancel-override');
    assert.deepEqual(cancelled.sent, []);
    assert.equal(cancelled.confirmHidden, true);

    await showPatch(page, {
      validation: { ok: true, skipped: true, executed: false }
    });
    await page.locator('#approve-patch-without-erc').click();
    const opened = await readApplyWithoutErcConfirm(page);
    assert.equal(opened.hidden, false);
    assert.equal(opened.role, 'alertdialog');
    assert.equal(opened.describedBy, 'apply-without-erc-risk');
    assert.equal(opened.activeId, 'cancel-apply-without-erc');
    assert.equal(opened.confirmColor, opened.dangerColor);
    assert.notEqual(opened.confirmBg, opened.accentBg);
    assert.equal(opened.cancelBg, opened.accentBg);
    assert.deepEqual(opened.sent, []);
    await page.keyboard.press('Enter');
    const afterEnter = await readApplyWithoutErcConfirm(page);
    assert.deepEqual(afterEnter.sent, []);
    assert.equal(afterEnter.sent.some((payload) => payload?.args?.approved === true), false);

    await showPatch(page, {
      validation: { ok: true, skipped: true, executed: false }
    });
    await page.locator('#approve-patch-without-erc').click();
    assert.equal((await readApplyWithoutErcConfirm(page)).activeId, 'cancel-apply-without-erc');
    await page.keyboard.press('Escape');
    const afterEsc = await readApplyWithoutErcConfirm(page);
    assert.equal(afterEsc.hidden, true);
    assert.equal(afterEsc.activeId, 'approve-patch-without-erc');
    assert.deepEqual(afterEsc.sent, []);

    const missing = await showPatch(page, {
      validation: {},
      inspection: {
        manifest: { freshness: { status: 'current', reason: 'Evidence matches.' } },
        validation: {}
      }
    }, 'apply');
    assert.equal(missing.ariaDisabled, 'true');
    assert.equal(missing.disabled, false);
    assert.equal(missing.overrideHidden, true);
    assert.equal(missing.whyText, en['patch.apply.blocked-missing']);
    assert.deepEqual(missing.sent, []);

    const candidateFailed = await showPatch(page, {
      validation: passedValidation,
      candidateVerification: {
        erc: { ok: false, skipped: false, status: 'failed', erc: { errorCount: 2, warningCount: 0 } }
      }
    }, 'apply');
    assert.equal(candidateFailed.ariaDisabled, 'true');
    assert.equal(candidateFailed.overrideHidden, true);
    assert.deepEqual(candidateFailed.sent, []);

    const candidateMissing = await showPatch(page, {
      validation: {},
      candidateVerification: null
    }, 'apply');
    assert.equal(candidateMissing.ariaDisabled, 'true');
    assert.equal(candidateMissing.overrideHidden, true);
    assert.equal(candidateMissing.whyText, en['patch.apply.blocked-missing']);
    assert.deepEqual(candidateMissing.sent, []);

    const staleCandidate = await showPatch(page, {
      patchId: 'patch-new',
      validation: { ok: false, skipped: false, erc: { errorCount: 2 } },
      staleRequest: {
        patchId: 'patch-old',
        validation: passedValidation,
        candidateVerification: {
          erc: { ok: true, skipped: false, status: 'passed', erc: { errorCount: 0, warningCount: 0 } }
        }
      }
    }, 'apply');
    assert.equal(staleCandidate.ariaDisabled, 'true');
    assert.equal(staleCandidate.overrideHidden, true);
    assert.deepEqual(staleCandidate.sent, []);

    const faked = await showPatch(page, { validation: { passed: true } }, 'apply');
    assert.equal(faked.ariaDisabled, null);
    assert.equal(faked.disabled, false);
    assert.equal(faked.sent.length, 1);
    assert.equal(Object.hasOwn(faked.sent[0].args, 'passed'), false);
    assert.equal(Object.hasOwn(faked.sent[0].args, 'ercOverride'), false);

    const ko = JSON.parse(await readFile(join(PANEL_ROOT, 'locales/ko.json'), 'utf8'));
    const missingRecord = await showPatch(page, {
      validation: {},
      inspection: {
        manifest: {
          freshness: { status: 'missing', code: 'NO_MANIFEST', reason: 'No ChatPCB manifest exists.' }
        },
        validation: {}
      }
    });
    assert.equal(missingRecord.freshnessText, 'missing');
    assert.equal(missingRecord.freshnessTitle, en['inspection.freshness.no-manifest']);
    await page.evaluate(() => window.chatpcbI18n.setLang('ko'));
    const koFreshness = await page.evaluate(() => ({
      title: document.querySelector('#inspection-freshness').title,
      text: document.querySelector('#inspection-freshness').textContent
    }));
    assert.equal(koFreshness.text, 'missing');
    assert.equal(koFreshness.title, ko['inspection.freshness.no-manifest']);
    await page.evaluate(() => window.chatpcbI18n.setLang('en'));

    const matched = await showPatch(page, {
      validation: passedValidation,
      inspection: {
        manifest: { freshness: { status: 'current', reason: 'Evidence matches.' } },
        validation: {}
      }
    });
    assert.equal(matched.freshnessText, 'current');
    assert.equal(matched.freshnessTitle, en['inspection.freshness.match']);

    const mismatched = await showPatch(page, {
      validation: {},
      inspection: {
        manifest: {
          freshness: {
            status: 'stale',
            code: 'DIGEST_MISMATCH',
            reason: 'Evidence digest abc does not match saved project digest def.'
          }
        },
        validation: {}
      }
    });
    assert.equal(mismatched.freshnessText, 'stale');
    assert.equal(mismatched.freshnessTitle, en['inspection.freshness.mismatch']);
    assert.equal(mismatched.freshnessTitle.includes('abc'), false);
  } finally {
    await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});

function readApplyWithoutErcConfirm(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('#apply-without-erc-confirm');
    const confirm = document.querySelector('#confirm-apply-without-erc');
    const cancel = document.querySelector('#cancel-apply-without-erc');
    const probe = document.createElement('span');
    probe.style.color = 'var(--danger)';
    probe.style.background = 'var(--accent)';
    document.body.append(probe);
    const probeStyle = getComputedStyle(probe);
    const dangerColor = probeStyle.color;
    const accentBg = probeStyle.backgroundColor;
    probe.remove();
    return {
      hidden: dialog.hidden,
      role: dialog.getAttribute('role'),
      describedBy: dialog.getAttribute('aria-describedby'),
      activeId: document.activeElement?.id ?? '',
      confirmColor: getComputedStyle(confirm).color,
      confirmBg: getComputedStyle(confirm).backgroundColor,
      cancelBg: getComputedStyle(cancel).backgroundColor,
      dangerColor,
      accentBg,
      sent: window.__sent.map((raw) => JSON.parse(raw)).map((event) => event.payload)
    };
  });
}

function showPatch(page, state, click) {
  return page.evaluate(({ state: next, click: which }) => {
    window.__sent.length = 0;
    for (const socket of window.__sockets) socket.readyState = 1;
    window.__chatpcbTest.showPatch(next);
    const button = document.querySelector('#approve-patch-button');
    const override = document.querySelector('#approve-patch-without-erc');
    const confirm = document.querySelector('#apply-without-erc-confirm');
    const why = document.querySelector('#apply-why');
    if (which === 'apply') button.click();
    if (which === 'override' || which === 'confirm-override' || which === 'cancel-override') override.click();
    if (which === 'confirm-override') document.querySelector('#confirm-apply-without-erc').click();
    if (which === 'cancel-override') document.querySelector('#cancel-apply-without-erc').click();
    const sent = window.__sent.map((raw) => JSON.parse(raw)).map((event) => event.payload);
    const countVisibleText = (root, needle) => {
      if (!root || !needle) return 0;
      let count = 0;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const parent = walker.currentNode.parentElement;
        if (!parent || parent.closest('[hidden]')) continue;
        if ((walker.currentNode.textContent || '').includes(needle)) count += 1;
      }
      return count;
    };
    return {
      ariaDisabled: button.getAttribute('aria-disabled'),
      disabled: button.disabled,
      whyHidden: why.hidden,
      whyText: why.textContent,
      skippedNoticeCount: countVisibleText(document.querySelector('#patch-approval-card'), window.t('patch.apply.skipped')),
      overrideHidden: override.hidden,
      overrideDisabled: override.disabled,
      overrideText: override.textContent,
      confirmHidden: confirm.hidden,
      riskText: document.querySelector('#apply-without-erc-risk').textContent,
      ercText: document.querySelector('#patch-erc').textContent,
      ercRole: document.querySelector('#patch-erc').getAttribute('role'),
      ercClass: document.querySelector('#patch-erc').className,
      ercIcon: String(getComputedStyle(document.querySelector('#patch-erc'), '::after').content || '').replace(/^["']|["']$/g, ''),
      ercColor: getComputedStyle(document.querySelector('#patch-erc')).color,
      warnColor: (() => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--warn)';
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      })(),
      freshnessText: document.querySelector('#inspection-freshness')?.textContent ?? '',
      freshnessTitle: document.querySelector('#inspection-freshness')?.title ?? '',
      sent
    };
  }, { state, click });
}
