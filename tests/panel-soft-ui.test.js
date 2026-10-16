/* global document, getComputedStyle, window */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';

const LOGO_SHA256 = '568ce2e8701934856aaafc0ed1c3d0300f6c2ff384d0ae743dd1dea08570e12c';
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

const TEXT_PAIRS = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text', 'surface2'],
  ['muted', 'bg'],
  ['muted', 'surface'],
  ['muted', 'surface2'],
  ['on-accent', 'accent'],
  ['accent-text', 'surface'],
  ['accent-text', 'accent-soft'],
  ['success', 'success-bg'],
  ['danger', 'danger-bg'],
  ['warn', 'warn-bg'],
  ['danger', 'surface'],
  ['locked', 'surface2'],
  ['text', 'accent-soft'],
  ['accent-text', 'bg'],
  ['warn', 'bg']
];
const UI_PAIRS = [
  ['border-strong', 'surface'],
  ['border-strong', 'bg'],
  ['accent', 'surface'],
  ['focus', 'surface'],
  ['focus', 'bg'],
  ['success', 'surface'],
  ['danger', 'surface']
];

test('en and ko panel locales have the same keys', async () => {
  const en = JSON.parse(await readFile(join(PANEL_ROOT, 'locales/en.json'), 'utf8'));
  const ko = JSON.parse(await readFile(join(PANEL_ROOT, 'locales/ko.json'), 'utf8'));
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ko).sort());
  assert.equal(en['request.idle'], 'Create a project to send a circuit request.');
  assert.equal(en['patch.ready'], 'Patch preview is ready for approval.');
  assert.equal(en['provider.pending'], 'Provider pending');
  assert.equal(en['connection.connecting'], 'Connecting');
  assert.equal(en['connection.connected'], 'Connected');
  for (const key of ['request.idle', 'patch.ready', 'provider.pending', 'connection.connecting', 'connection.connected']) {
    assert.notEqual(ko[key], en[key], key);
    assert.match(ko[key], /[가-힣]/, key);
  }
  const logo = await readFile(join(PANEL_ROOT, 'assets/chatgpt-logo-white.svg'));
  assert.equal(createHash('sha256').update(logo).digest('hex'), LOGO_SHA256);
});

test('Soft panel meets the fold, contrast, and ChatGPT button criteria', async (t) => {
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: chromium.executablePath(),
      headless: true
    });
  } catch (error) {
    t.skip(`Chromium unavailable: ${error.message}`);
    return;
  }
  const en = JSON.parse(await readFile(join(PANEL_ROOT, 'locales/en.json'), 'utf8'));
  const ko = JSON.parse(await readFile(join(PANEL_ROOT, 'locales/ko.json'), 'utf8'));

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
  const shots = process.env.CHATPCB_SOFT_SHOTS;

  try {
    const context = await browser.newContext({ viewport: { width: 420, height: 800 } });
    await context.addInitScript(() => {
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

    for (const theme of ['light', 'dark']) {
      for (const lang of ['en', 'ko']) {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(String(error)));
        await page.goto(`http://127.0.0.1:${port}/index.html?theme=${theme}&lang=${lang}&auth=signedin&chatpcbTest=1`, {
          waitUntil: 'domcontentloaded'
        });
        await page.evaluate(() => window.chatpcbI18n.ready);
        await page.evaluate(() => {
          window.__chatpcbTest.showPatch({
            project: { displayName: 'demo-board', projectDir: '/tmp/demo-board' },
            validation: {
              ok: false,
              erc: {
                ok: false,
                errorCount: 2,
                violations: [
                  { message: 'Pin 3 of U2 (EN) is not connected' },
                  { message: 'Power input +3V3 is not driven' }
                ]
              }
            },
            conversation: {
              messages: [
                { role: 'user', text: 'A 5 V USB-C powered ESP32-C3 board with one status LED and a reset button.' },
                { role: 'assistant', text: 'Drafted the schematic: USB-C input, AMS1117-3.3 regulator, ESP32-C3-MINI-1, LED with 1 kΩ resistor, reset switch.' }
              ]
            }
          });
        });

        const copy = await page.evaluate(() => ({
          request: document.querySelector('#request-status').textContent,
          provider: document.querySelector('#provider-status').textContent,
          connection: document.querySelector('#connection-status').textContent,
          patch: document.querySelector('#patch-approval-status').textContent
        }));
        const locale = lang === 'ko' ? ko : en;
        assert.equal(copy.request, locale['request.idle'], `${theme}/${lang} request status`);
        assert.equal(copy.provider, locale['provider.pending'], `${theme}/${lang} provider status`);
        assert.equal(copy.connection, locale['connection.connecting'], `${theme}/${lang} connecting`);
        assert.equal(copy.patch, locale['patch.ready'], `${theme}/${lang} patch ready`);
        if (lang === 'ko') {
          assert.notEqual(copy.request, en['request.idle'], `${theme}/${lang} request still English`);
          assert.notEqual(copy.provider, en['provider.pending'], `${theme}/${lang} provider still English`);
          assert.notEqual(copy.connection, en['connection.connecting'], `${theme}/${lang} connecting still English`);
          assert.notEqual(copy.patch, en['patch.ready'], `${theme}/${lang} patch still English`);
          assert.match(copy.request, /[가-힣]/, `${theme}/${lang} request korean`);
          assert.match(copy.provider, /[가-힣]/, `${theme}/${lang} provider korean`);
          assert.match(copy.connection, /[가-힣]/, `${theme}/${lang} connecting korean`);
          assert.match(copy.patch, /[가-힣]/, `${theme}/${lang} patch korean`);
        }

        const layout = await page.evaluate(() => {
          const card = document.querySelector('#patch-approval-card').getBoundingClientRect();
          const why = document.querySelector('#apply-why').getBoundingClientRect();
          const apply = document.querySelector('#approve-patch-button').getBoundingClientRect();
          const dock = document.querySelector('#composer').getBoundingClientRect();
          const bottom = Math.max(card.bottom, why.bottom, apply.bottom);
          return {
            bottom,
            dockTop: dock.top,
            bodyFont: parseFloat(getComputedStyle(document.body).fontSize),
            messageFont: parseFloat(getComputedStyle(document.querySelector('#conversation-log li')).fontSize),
            lang: document.documentElement.lang,
            theme: document.documentElement.dataset.theme
          };
        });
        assert.equal(layout.lang, lang, `${theme}/${lang} html lang`);
        assert.equal(layout.theme, theme, `${theme}/${lang} data-theme`);
        assert.ok(layout.bottom <= layout.dockTop + 0.5, `${theme}/${lang} approval card ${layout.bottom} extends below dock ${layout.dockTop}`);
        assert.ok(layout.bodyFont >= 14, `${theme}/${lang} body font ${layout.bodyFont}`);
        assert.ok(layout.messageFont >= 14, `${theme}/${lang} message font ${layout.messageFont}`);

        const small = await page.evaluate(() => {
          const nodes = document.querySelectorAll('button, a[href], input, select, textarea, summary, [role="button"]');
          const found = [];
          for (const el of nodes) {
            if (el.closest('[hidden]')) continue;
            if (el.closest('.sr')) continue;
            const dialog = el.closest('dialog');
            if (dialog && !dialog.open) continue;
            const details = el.closest('details');
            if (details && !details.open && !el.closest('summary')) continue;
            const style = getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            const box = el.getBoundingClientRect();
            if (box.width < 24 || box.height < 24) {
              found.push({
                id: el.id,
                tag: el.tagName,
                text: (el.innerText || el.getAttribute('aria-label') || '').slice(0, 40),
                width: Math.round(box.width),
                height: Math.round(box.height)
              });
            }
          }
          return found;
        });
        assert.deepEqual(small, [], `${theme}/${lang} interactive targets below 24px: ${JSON.stringify(small)}`);

        const contrast = await page.evaluate(({ textPairs, uiPairs }) => {
          const style = getComputedStyle(document.documentElement);
          const read = (name) => style.getPropertyValue(`--${name}`).trim();
          const parse = (value) => {
            const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
            if (hex) {
              const raw = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
              return [0, 2, 4].map((index) => Number.parseInt(raw.slice(index, index + 2), 16));
            }
            const rgb = value.match(/rgba?\(([^)]+)\)/i);
            if (!rgb) return null;
            const parts = rgb[1].split(',').map((part) => Number.parseFloat(part));
            return parts.slice(0, 3);
          };
          const channel = (c) => {
            const s = c / 255;
            return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          };
          const lum = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
          const ratio = (a, b) => {
            const left = lum(a);
            const right = lum(b);
            const lighter = Math.max(left, right);
            const darker = Math.min(left, right);
            return (lighter + 0.05) / (darker + 0.05);
          };
          const failures = [];
          const check = (fg, bg, min) => {
            const foreground = parse(fg.startsWith('#') ? fg : read(fg));
            const background = parse(bg.startsWith('#') ? bg : read(bg));
            if (!foreground || !background) {
              failures.push(`${fg}/${bg} unparsed`);
              return;
            }
            const value = ratio(foreground, background);
            if (value < min) failures.push(`${fg}/${bg} ${value.toFixed(2)} < ${min}`);
          };
          for (const [fg, bg] of textPairs) check(fg, bg, 4.5);
          for (const [fg, bg] of uiPairs) check(fg, bg, 3);
          check('#ffffff', '#000000', 4.5);
          return failures;
        }, { textPairs: TEXT_PAIRS, uiPairs: UI_PAIRS });
        assert.deepEqual(contrast, [], `${theme}/${lang} contrast: ${contrast.join('; ')}`);

        const outline = await page.evaluate(() => {
          const button = document.querySelector('#approve-patch-button');
          button.focus({ focusVisible: true });
          return getComputedStyle(button).outlineWidth;
        });
        assert.equal(outline, '2px', `${theme}/${lang} focus ring`);

        const beforeStatus = await page.locator('#request-status').innerText();
        const gate = await page.evaluate(() => {
          const button = document.querySelector('#approve-patch-button');
          const why = document.querySelector('#apply-why');
          const before = window.__sent.length;
          button.click();
          return {
            ariaDisabled: button.getAttribute('aria-disabled'),
            disabled: button.disabled,
            whyHidden: why.hidden,
            whyText: why.textContent,
            expected: window.chatpcbI18n.t('patch.apply.blocked-erc', { count: 2 }),
            sent: window.__sent.slice(before),
            ercRole: document.querySelector('#patch-erc').getAttribute('role')
          };
        });
        assert.equal(gate.ariaDisabled, 'true', `${theme}/${lang} apply aria-disabled`);
        assert.equal(gate.disabled, false, `${theme}/${lang} apply stays focusable`);
        assert.equal(gate.whyHidden, false, `${theme}/${lang} apply reason hidden`);
        assert.equal(gate.whyText, gate.expected, `${theme}/${lang} apply reason`);
        assert.equal(gate.ercRole, 'alert', `${theme}/${lang} ERC alert`);
        assert.deepEqual(gate.sent, [], `${theme}/${lang} apply click sent ${gate.sent.join('\n')}`);
        assert.equal(await page.locator('#request-status').innerText(), beforeStatus, `${theme}/${lang} apply click changed request status`);

        const names = await page.locator('.flow-btn[data-step]').evaluateAll((els) => els.map((el) => ({
          step: el.dataset.step,
          name: el.getAttribute('aria-label'),
          current: el.getAttribute('aria-current')
        })));
        assert.equal(names.length, 14, `${theme}/${lang} step count`);
        for (const step of names) {
          assert.match(step.name, /^.+ · .+ — .+$/, `${theme}/${lang} ${step.step} name ${step.name}`);
        }
        assert.equal(names.filter((step) => step.current === 'step').length, 1, `${theme}/${lang} current step`);

        if (shots) {
          await mkdir(shots, { recursive: true });
          await page.screenshot({ path: join(shots, `soft-${theme}-${lang}.png`) });
        }

        await page.evaluate(() => window.chatpcbI18n.setLang('en'));
        const enReason = await page.locator('#lock-r-layout').innerText();
        assert.equal(await page.evaluate(() => document.documentElement.lang), 'en', `${theme}/${lang} lang en`);
        await page.evaluate(() => window.chatpcbI18n.setLang('ko'));
        const koReason = await page.locator('#lock-r-layout').innerText();
        assert.equal(await page.evaluate(() => document.documentElement.lang), 'ko', `${theme}/${lang} lang ko`);
        assert.notEqual(enReason, koReason, `${theme}/${lang} translated lock reason`);
        await page.evaluate(() => window.chatpcbI18n.setLang('en'));
        assert.equal(await page.evaluate(() => document.documentElement.lang), 'en', `${theme}/${lang} lang back to en`);
        await page.evaluate((next) => window.chatpcbI18n.setLang(next), lang);
        const connected = await page.evaluate(() => {
          const socket = window.__sockets[0];
          socket.readyState = 1;
          socket.dispatchEvent(new Event('open'));
          return document.querySelector('#connection-status').textContent;
        });
        assert.equal(connected, locale['connection.connected'], `${theme}/${lang} connected`);
        if (lang === 'ko') {
          assert.notEqual(connected, en['connection.connected'], `${theme}/${lang} connected still English`);
          assert.match(connected, /[가-힣]/, `${theme}/${lang} connected korean`);
        }

        await page.evaluate(() => window.setChatGptAuthState({ signedIn: false }));
        const button = await page.evaluate(() => {
          const el = document.querySelector('.siwc-btn');
          const style = getComputedStyle(el);
          return {
            hidden: document.querySelector('#chatgpt-signin').hidden,
            height: style.height,
            radius: style.borderRadius,
            background: style.backgroundColor,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            text: el.innerText.trim(),
            lang: el.lang
          };
        });
        assert.equal(button.hidden, false, `${theme}/${lang} sign-in card`);
        assert.equal(button.height, '45px', `${theme}/${lang} ChatGPT button height`);
        assert.equal(button.radius, '12px', `${theme}/${lang} ChatGPT button radius`);
        assert.equal(button.background, 'rgb(0, 0, 0)', `${theme}/${lang} ChatGPT button background`);
        assert.equal(button.fontSize, '15px', `${theme}/${lang} ChatGPT button font size`);
        assert.equal(button.fontWeight, '500', `${theme}/${lang} ChatGPT button weight`);
        assert.equal(button.text, 'Continue with ChatGPT', `${theme}/${lang} ChatGPT button text`);
        assert.equal(button.lang, 'en', `${theme}/${lang} ChatGPT button lang`);
        assert.deepEqual(errors, [], `${theme}/${lang} page errors ${errors.join('\n')}`);
        await page.close();
      }
    }
    await context.close();
  } finally {
    await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});
