/* global CSSRule, document, getComputedStyle, window */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import test from 'node:test';

import { launchPanelBrowser } from '../scripts/lib/launch-panel-browser.js';

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

// Ubuntu CI has no Pretendard or Inter. Until the bundled face loads, DejaVu wraps
// the approval actions onto a second row and the card extends below the dock.
async function readBundledPretendard() {
  await document.fonts.load('14px Pretendard');
  await document.fonts.load('700 15px Pretendard');
  await document.fonts.ready;
  const rules = [];
  for (const sheet of document.styleSheets) {
    let cssRules;
    try {
      cssRules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of cssRules) {
      if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
      rules.push({
        family: rule.style.getPropertyValue('font-family').replaceAll('"', ''),
        src: rule.style.getPropertyValue('src'),
        display: rule.style.getPropertyValue('font-display')
      });
    }
  }
  const faces = [...document.fonts]
    .filter((face) => face.family.replaceAll('"', '') === 'Pretendard')
    .map((face) => ({ status: face.status, display: face.display }));
  return { rules, faces };
}

test('Apply stays enabled when the candidate ERC passes and the open file still fails ERC', async (t) => {
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
    const page = await browser.newPage({ viewport: { width: 420, height: 800 } });
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
    const result = await page.evaluate(() => {
      for (const socket of window.__sockets) socket.readyState = 1;
      window.__sent.length = 0;
      window.__chatpcbTest.showPatch({
        validation: {
          ok: true,
          skipped: false,
          erc: { errorCount: 0, warningCount: 0 }
        },
        candidateVerification: {
          erc: { ok: true, skipped: false, status: 'passed', erc: { errorCount: 0, warningCount: 0 } }
        },
        inspection: {
          manifest: { freshness: { status: 'current', reason: 'Evidence matches.' } },
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
          }
        }
      });
      const button = document.querySelector('#approve-patch-button');
      const why = document.querySelector('#apply-why');
      button.click();
      const sent = window.__sent.map((raw) => JSON.parse(raw)).map((event) => event.payload);
      const info = document.querySelector('#patch-erc-info');
      return {
        disabled: button.disabled,
        ariaDisabled: button.getAttribute('aria-disabled'),
        whyHidden: why.hidden,
        infoHidden: info ? info.hidden : null,
        infoRole: info ? info.getAttribute('role') : null,
        sent: sent.length
      };
    });
    assert.equal(result.disabled, false);
    assert.equal(result.ariaDisabled, null);
    assert.equal(result.whyHidden, true);
    assert.equal(result.sent, 1);
    assert.equal(result.infoHidden, false);
    assert.notEqual(result.infoRole, 'alert');
  } finally {
    await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});

test('en and ko panel locales have the same keys', async () => {
  const en = JSON.parse(await readFile(join(PANEL_ROOT, 'locales/en.json'), 'utf8'));
  const ko = JSON.parse(await readFile(join(PANEL_ROOT, 'locales/ko.json'), 'utf8'));
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ko).sort());
  assert.equal(en['request.idle'], 'Create a project to send a circuit request.');
  assert.equal(en['patch.ready'], 'Patch preview is ready for approval.');
  assert.equal(en['provider.pending'], 'Provider pending');
  assert.equal(en['connection.connecting'], 'Connecting');
  assert.equal(en['connection.connected'], 'Daemon connected');
  for (const key of ['request.idle', 'patch.ready', 'provider.pending', 'connection.connecting', 'connection.connected']) {
    assert.notEqual(ko[key], en[key], key);
    assert.match(ko[key], /[가-힣]/, key);
  }
  assert.equal(ko['workflow.caption.failed'], '생성에 실패했어요. 기술 상세를 확인하거나 다시 보내 주세요.');
  assert.equal(ko['request.idle'], '회로 요청을 보내려면 프로젝트를 만들어 주세요.');
  assert.equal(ko['request.project-busy'], '다른 작업이 이 프로젝트를 사용 중이에요. 잠시 후 다시 시도해 주세요.');
  assert.doesNotMatch(ko['workflow.caption.failed'], /Send|하세요/);
  assert.doesNotMatch(ko['request.idle'], /하세요/);
  assert.doesNotMatch(ko['request.project-busy'], /하세요/);
  const logo = await readFile(join(PANEL_ROOT, 'assets/chatgpt-logo-white.svg'));
  assert.equal(createHash('sha256').update(logo).digest('hex'), LOGO_SHA256);
});

test('Soft panel meets the fold, contrast, and ChatGPT button criteria', async (t) => {
  const browser = await launchPanelBrowser(t);
  if (!browser) return;
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
        const bundledFont = await page.evaluate(readBundledPretendard);
        const face = bundledFont.rules.find((rule) => rule.family === 'Pretendard');
        assert.ok(face, `${theme}/${lang} Pretendard @font-face`);
        assert.equal(face.src, 'url("./fonts/PretendardVariable.woff2") format("woff2")', `${theme}/${lang} Pretendard src`);
        assert.equal(face.display, 'swap', `${theme}/${lang} Pretendard font-display`);
        assert.ok(
          bundledFont.faces.some((item) => item.status === 'loaded' && item.display === 'swap'),
          `${theme}/${lang} bundled Pretendard did not load ${JSON.stringify(bundledFont.faces)}`
        );
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
        assert.equal(copy.request, locale['request.preview-ready'], `${theme}/${lang} request status`);
        assert.notEqual(copy.request, locale['request.idle'], `${theme}/${lang} create-project status while a preview is open`);
        assert.equal(copy.provider, locale['provider.pending'], `${theme}/${lang} provider status`);
        assert.equal(copy.connection, locale['connection.connecting'], `${theme}/${lang} connecting`);
        assert.equal(copy.patch, locale['patch.blocked'], `${theme}/${lang} patch blocked while ERC fails`);
        assert.notEqual(copy.patch, locale['patch.ready'], `${theme}/${lang} ready while ERC blocks`);
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

        const renderedContrast = await page.evaluate(() => {
          const parseColor = (value) => {
            if (!value || value === 'transparent') return null;
            const match = String(value).match(/rgba?\(\s*([0-9.]+)[,\s]+([0-9.]+)[,\s]+([0-9.]+)(?:[,\s/]+([0-9.]+))?\s*\)/i);
            if (!match) return null;
            return {
              r: Number(match[1]),
              g: Number(match[2]),
              b: Number(match[3]),
              a: match[4] === undefined ? 1 : Number(match[4])
            };
          };
          const composite = (fg, bg) => {
            const alpha = fg.a + bg.a * (1 - fg.a);
            if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
            return {
              r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / alpha,
              g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / alpha,
              b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / alpha,
              a: alpha
            };
          };
          const channel = (c) => {
            const s = c / 255;
            return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          };
          const lum = (rgb) => 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
          const ratio = (a, b) => {
            const left = lum(a);
            const right = lum(b);
            return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
          };
          const painted = (el) => {
            const layers = [];
            let node = el;
            while (node) {
              const style = getComputedStyle(node);
              const bg = parseColor(style.backgroundColor);
              const opacity = Number(style.opacity);
              const factor = Number.isFinite(opacity) ? opacity : 1;
              if (bg && bg.a > 0) {
                const layer = { r: bg.r, g: bg.g, b: bg.b, a: bg.a * factor };
                layers.push(layer);
                if (layer.a >= 0.999) break;
              }
              node = node.parentElement;
            }
            let acc = { r: 0, g: 0, b: 0, a: 0 };
            for (let i = layers.length - 1; i >= 0; i -= 1) acc = composite(layers[i], acc);
            return acc;
          };
          const weightOf = (style) => {
            const raw = style.fontWeight;
            if (raw === 'bold' || raw === 'bolder') return 700;
            const value = Number.parseInt(raw, 10);
            return Number.isFinite(value) ? value : 400;
          };
          const picks = [
            ['body', document.body],
            ['muted', document.querySelector('#pro-mode-help')],
            ['button', document.querySelector('#fix-patch-button')],
            ['button', document.querySelector('#tools-menu-button')],
            ['step', document.querySelector('.workflow-lane[data-lane="circuit"] .flow-btn')],
            ['erc', document.querySelector('#patch-erc')]
          ];
          for (const el of document.querySelectorAll('.workflow-lane[data-lane="circuit"] .flow-btn')) {
            picks.push(['step', el]);
          }
          const failures = [];
          for (const [label, el] of picks) {
            if (!el) {
              failures.push(`${label} missing`);
              continue;
            }
            const style = getComputedStyle(el);
            const fg0 = parseColor(style.color);
            const bg = painted(el);
            if (!fg0 || bg.a < 0.99) {
              failures.push(`${label} unpainted`);
              continue;
            }
            const opacity = Number(style.opacity);
            const fg = composite({ ...fg0, a: fg0.a * (Number.isFinite(opacity) ? opacity : 1) }, bg);
            const size = Number.parseFloat(style.fontSize);
            const weight = weightOf(style);
            const large = size >= 24 || (size >= 18.66 && weight >= 700);
            const min = large ? 3 : 4.5;
            const value = ratio(fg, bg);
            if (value < min) failures.push(`${label} ${value.toFixed(2)} < ${min}`);
          }
          return failures;
        });
        assert.deepEqual(renderedContrast, [], `${theme}/${lang} rendered contrast: ${renderedContrast.join('; ')}`);

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

        const steps = await page.evaluate(() => {
          const labels = [...document.querySelectorAll('.step-label')].filter((el) => !el.closest('[hidden]')).map((el) => {
            const box = el.getBoundingClientRect();
            const button = el.closest('button');
            return {
              text: el.textContent.trim(),
              width: box.width,
              height: box.height,
              visibleText: button ? button.innerText.trim() : ''
            };
          });
          const locked = [...document.querySelectorAll('.flow-btn[aria-disabled="true"]')].map((button) => {
            const reason = document.getElementById(button.getAttribute('aria-describedby') || '');
            return {
              ariaDisabled: button.getAttribute('aria-disabled'),
              reason: reason ? reason.textContent.trim() : ''
            };
          });
          const reasons = ['lock-r-layout', 'lock-r-fab'].map((id) => {
            const el = document.getElementById(id);
            const box = el.getBoundingClientRect();
            return {
              hidden: el.hidden,
              inHidden: Boolean(el.closest('[hidden]')),
              text: el.textContent.trim(),
              height: box.height
            };
          });
          return { labels, locked, reasons };
        });
        assert.ok(steps.labels.length >= 5, `${theme}/${lang} visible step labels ${steps.labels.length}`);
        for (const label of steps.labels) {
          assert.ok(label.text.length > 0, `${theme}/${lang} blank step label`);
          assert.ok(label.width > 0 && label.height > 0, `${theme}/${lang} step label "${label.text}" has no box`);
          assert.ok(label.visibleText.includes(label.text), `${theme}/${lang} step "${label.text}" is only an accessible name`);
        }
        assert.ok(steps.locked.length >= 9, `${theme}/${lang} locked steps ${steps.locked.length}`);
        for (const button of steps.locked) {
          assert.equal(button.ariaDisabled, 'true', `${theme}/${lang} locked step aria-disabled`);
          assert.ok(button.reason.length > 0, `${theme}/${lang} locked step missing reason`);
        }
        for (const reason of steps.reasons) {
          assert.equal(reason.hidden, false, `${theme}/${lang} lock reason hidden`);
          assert.equal(reason.inHidden, false, `${theme}/${lang} lock reason inside hidden`);
          assert.ok(reason.text.length > 0, `${theme}/${lang} empty lock reason`);
          assert.ok(reason.height > 0, `${theme}/${lang} lock reason not visible`);
        }

        const fieldFit = await page.evaluate(() => {
          const field = document.querySelector('#prompt');
          const previous = field.value;
          const previousSpace = field.style.whiteSpace;
          field.style.whiteSpace = 'nowrap';
          field.value = field.placeholder;
          const result = {
            placeholder: field.placeholder,
            scrollWidth: field.scrollWidth,
            clientWidth: field.clientWidth
          };
          field.value = previous;
          field.style.whiteSpace = previousSpace;
          return result;
        });
        assert.equal(fieldFit.placeholder, locale['composer.placeholder'], `${theme}/${lang} placeholder`);
        assert.ok(fieldFit.scrollWidth <= fieldFit.clientWidth, `${theme}/${lang} placeholder truncated ${fieldFit.scrollWidth}>${fieldFit.clientWidth}`);

        const ask = await page.evaluate(() => {
          const container = document.querySelector('.ask-switch');
          const control = document.querySelector('#pro-mode');
          const label = control.querySelector('.ask-switch-label');
          const help = document.querySelector('#pro-mode-help');
          const style = getComputedStyle(help);
          const box = (el) => {
            const rect = el.getBoundingClientRect();
            return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height };
          };
          const labelBox = box(label);
          const helpBox = box(help);
          const containerBox = box(container);
          const overlaps = labelBox.left < helpBox.right
            && helpBox.left < labelBox.right
            && labelBox.top < helpBox.bottom
            && helpBox.top < labelBox.bottom;
          const inside = (inner, outer) => inner.left >= outer.left - 0.5
            && inner.right <= outer.right + 0.5
            && inner.top >= outer.top - 0.5
            && inner.bottom <= outer.bottom + 0.5;
          const clipped = (el) => el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight;
          return {
            role: control.getAttribute('role'),
            describedBy: control.getAttribute('aria-describedby'),
            label: label.textContent.trim(),
            help: help.textContent.trim(),
            hidden: help.hidden,
            display: style.display,
            visibility: style.visibility,
            width: helpBox.width,
            height: helpBox.height,
            labelWhiteSpace: getComputedStyle(label).whiteSpace,
            overlaps,
            labelInside: inside(labelBox, containerBox),
            helpInside: inside(helpBox, containerBox),
            labelClipped: clipped(label),
            helpClipped: clipped(help),
            labelScroll: [label.scrollWidth, label.clientWidth, label.scrollHeight, label.clientHeight],
            helpScroll: [help.scrollWidth, help.clientWidth, help.scrollHeight, help.clientHeight]
          };
        });
        assert.equal(ask.role, 'switch', `${theme}/${lang} choice control role`);
        assert.equal(ask.describedBy, 'pro-mode-help', `${theme}/${lang} choice control description`);
        assert.equal(ask.label, locale['pro.switch'], `${theme}/${lang} choice control label`);
        assert.equal(ask.help, locale['pro.switch-help'], `${theme}/${lang} choice control help`);
        assert.equal(ask.hidden, false, `${theme}/${lang} choice help hidden`);
        assert.notEqual(ask.display, 'none', `${theme}/${lang} choice help display`);
        assert.notEqual(ask.visibility, 'hidden', `${theme}/${lang} choice help visibility`);
        assert.ok(ask.width > 0 && ask.height > 0, `${theme}/${lang} choice help not visible`);
        assert.equal(ask.labelWhiteSpace, 'nowrap', `${theme}/${lang} choice label wraps`);
        assert.equal(ask.overlaps, false, `${theme}/${lang} choice label overlaps the description`);
        assert.equal(ask.labelInside, true, `${theme}/${lang} choice label outside the switch`);
        assert.equal(ask.helpInside, true, `${theme}/${lang} choice description outside the switch`);
        assert.equal(ask.labelClipped, false, `${theme}/${lang} choice label clipped ${ask.labelScroll.join(',')}`);
        assert.equal(ask.helpClipped, false, `${theme}/${lang} choice description clipped ${ask.helpScroll.join(',')}`);

        const tools = await page.evaluate(() => {
          const button = document.querySelector('#tools-menu-button');
          const menu = document.querySelector('#tools-menu');
          const items = [...menu.querySelectorAll('button')];
          return {
            expanded: button.getAttribute('aria-expanded'),
            controls: button.getAttribute('aria-controls'),
            popup: button.getAttribute('aria-haspopup'),
            menuRole: menu.getAttribute('role'),
            itemRoles: items.map((item) => item.getAttribute('role')),
            itemTags: items.map((item) => item.tagName)
          };
        });
        assert.equal(tools.expanded, 'false', `${theme}/${lang} tools disclosure starts closed`);
        assert.equal(tools.controls, 'tools-menu', `${theme}/${lang} tools disclosure controls`);
        assert.equal(tools.popup, null, `${theme}/${lang} tools disclosure popup`);
        assert.equal(tools.menuRole, null, `${theme}/${lang} tools disclosure role`);
        assert.ok(tools.itemTags.length >= 3, `${theme}/${lang} tools disclosure items`);
        assert.deepEqual(tools.itemRoles, tools.itemTags.map(() => null), `${theme}/${lang} tools items are plain buttons`);
        await page.locator('#tools-menu-button').click();
        assert.equal(await page.locator('#tools-menu-button').getAttribute('aria-expanded'), 'true', `${theme}/${lang} tools disclosure expanded`);
        assert.equal(await page.locator('#tools-menu').isVisible(), true, `${theme}/${lang} tools list visible`);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#tools-menu-button').getAttribute('aria-expanded'), 'false', `${theme}/${lang} tools disclosure closed`);
        assert.equal(await page.locator('#tools-menu').isHidden(), true, `${theme}/${lang} tools list hidden`);
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'tools-menu-button', `${theme}/${lang} tools focus returned`);

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

        const providerLine = await page.evaluate(async (nextLang) => {
          const socket = window.__sockets[0];
          const deliver = (status) => {
            const before = window.__sent.length;
            document.querySelector('#provider').dispatchEvent(new Event('change'));
            const sent = window.__sent.slice(before).map((raw) => JSON.parse(raw));
            const call = sent.map((event) => event.payload).find((payload) => payload?.name === 'provider.status');
            if (!call) return '';
            socket.dispatchEvent(new MessageEvent('message', {
              data: JSON.stringify({
                type: 'tool.result',
                payload: { id: call.id, ok: true, result: { provider: 'codex', status } }
              })
            }));
            return document.querySelector('#provider-status').textContent;
          };
          const missing = deliver('missing');
          const available = deliver('available');
          const otherLang = nextLang === 'ko' ? 'en' : 'ko';
          await window.chatpcbI18n.setLang(otherLang);
          const switched = document.querySelector('#provider-status').textContent;
          await window.chatpcbI18n.setLang(nextLang);
          return { missing, available, switched };
        }, lang);
        const missingHead = String(locale['provider.status.codex.missing'] ?? '').trimEnd();
        const missingTail = String(locale['provider.status.missing.next'] ?? '').trimStart();
        const missingCopy = /[.!?…。．]$/.test(missingHead) ? `${missingHead} ${missingTail}` : `${missingHead}. ${missingTail}`;
        assert.equal(providerLine.missing, missingCopy, `${theme}/${lang} provider missing`);
        if (lang === 'en') assert.match(providerLine.missing, /Install it and sign in, or choose another provider/);
        if (lang === 'ko') {
          assert.match(providerLine.missing, /설치하고 로그인해 주세요/);
          assert.match(providerLine.missing, /다른 공급자/);
        }
        assert.equal(providerLine.available, locale['provider.status.codex.available'], `${theme}/${lang} provider available`);
        assert.doesNotMatch(providerLine.missing, /codex:\s*missing/i, `${theme}/${lang} raw provider missing`);
        assert.doesNotMatch(providerLine.available, /codex:\s*available/i, `${theme}/${lang} raw provider available`);
        const otherLocale = lang === 'ko' ? en : ko;
        assert.equal(providerLine.switched, otherLocale['provider.status.codex.available'], `${theme}/${lang} provider status follows language`);
        if (lang === 'ko') {
          assert.match(providerLine.missing, /[가-힣]/, `${theme}/${lang} provider missing korean`);
          assert.match(providerLine.available, /[가-힣]/, `${theme}/${lang} provider available korean`);
        }

        const gated = await page.evaluate(() => {
          const card = document.querySelector('#chatgpt-signin');
          const plan = document.querySelector('#chatgpt-plan');
          const button = card.querySelector('button');
          const link = plan.querySelector('a');
          button.focus();
          link.focus();
          return {
            provider: document.querySelector('#provider').value,
            cardHidden: card.hidden,
            planHidden: plan.hidden,
            cardInert: card.inert,
            planInert: plan.inert,
            focusedButton: document.activeElement === button,
            focusedLink: document.activeElement === link,
            planLang: plan.lang,
            planText: plan.textContent
          };
        });
        assert.equal(gated.provider, 'codex', `${theme}/${lang} provider`);
        assert.equal(gated.cardHidden, true, `${theme}/${lang} ChatGPT sign-in hidden`);
        assert.equal(gated.planHidden, true, `${theme}/${lang} ChatGPT plan hidden`);
        assert.equal(gated.cardInert, true, `${theme}/${lang} ChatGPT sign-in inert`);
        assert.equal(gated.planInert, true, `${theme}/${lang} ChatGPT plan inert`);
        assert.equal(gated.focusedButton, false, `${theme}/${lang} ChatGPT button focusable`);
        assert.equal(gated.focusedLink, false, `${theme}/${lang} Manage usage focusable`);
        assert.equal(gated.planLang, 'en', `${theme}/${lang} plan lang`);
        assert.match(gated.planText, /Using ChatGPT plan/);
        assert.match(gated.planText, /Manage usage/);
        await page.evaluate(() => {
          window.__chatpcbTest.showChatGptUi();
          window.setChatGptAuthState({ signedIn: false });
        });
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
            whiteSpace: style.whiteSpace,
            labelWhiteSpace: getComputedStyle(el.querySelector('span')).whiteSpace,
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
        assert.equal(button.whiteSpace, 'nowrap', `${theme}/${lang} ChatGPT button nowrap`);
        assert.equal(button.labelWhiteSpace, 'nowrap', `${theme}/${lang} ChatGPT label nowrap`);
        assert.equal(button.text, 'Continue with ChatGPT', `${theme}/${lang} ChatGPT button text`);
        assert.equal(button.lang, 'en', `${theme}/${lang} ChatGPT button lang`);

        const latest = await page.evaluate(() => {
          const messages = [];
          for (let i = 0; i < 6; i += 1) {
            messages.push({ role: 'user', text: `Question ${i} about the USB-C power path and the status LED resistor.` });
            messages.push({ role: 'assistant', text: `Reply ${i}: keep the AMS1117 regulator and the 1 kΩ series resistor.` });
          }
          messages.push({ role: 'assistant', text: 'Latest reply stays in view.' });
          window.__chatpcbTest.showPatch({
            validation: {
              ok: false,
              erc: {
                ok: false,
                errorCount: 2,
                violations: [{ message: 'Pin 3 of U2 (EN) is not connected' }]
              }
            },
            conversation: { messages }
          });
          const log = document.querySelector('#conversation-log');
          const last = log.querySelector('li:last-child');
          const logBox = log.getBoundingClientRect();
          const box = last.getBoundingClientRect();
          const overlap = Math.min(box.bottom, logBox.bottom) - Math.max(box.top, logBox.top);
          return {
            role: last.dataset.role,
            text: last.textContent,
            scrollTop: log.scrollTop,
            clientHeight: log.clientHeight,
            overlap,
            inViewport: box.width > 0 && box.top < window.innerHeight && box.bottom > 0
          };
        });
        assert.equal(latest.role, 'assistant', `${theme}/${lang} latest role`);
        assert.equal(latest.text, 'Latest reply stays in view.', `${theme}/${lang} latest reply`);
        assert.ok(latest.scrollTop > 0, `${theme}/${lang} conversation did not scroll`);
        assert.ok(latest.clientHeight >= 96, `${theme}/${lang} conversation height ${latest.clientHeight}`);
        assert.ok(latest.overlap > 0, `${theme}/${lang} latest reply outside the log`);
        assert.equal(latest.inViewport, true, `${theme}/${lang} latest reply outside the viewport`);

        const passedErc = await page.evaluate(() => {
          window.__chatpcbTest.showPatch({
            validation: {
              ok: true,
              skipped: false,
              erc: { errorCount: 0, warningCount: 0 }
            },
            candidateVerification: {
              erc: { ok: true, skipped: false, status: 'passed', erc: { errorCount: 0, warningCount: 0 } }
            }
          });
          const apply = document.querySelector('#approve-patch-button');
          const why = document.querySelector('#apply-why');
          const status = document.querySelector('#patch-approval-status');
          return {
            disabled: apply.disabled,
            ariaDisabled: apply.getAttribute('aria-disabled'),
            whyHidden: why.hidden,
            statusHidden: status.hidden,
            status: status.textContent
          };
        });
        assert.equal(passedErc.disabled, false, `${theme}/${lang} apply disabled after ERC passes`);
        assert.equal(passedErc.ariaDisabled, null, `${theme}/${lang} apply aria-disabled after ERC passes`);
        assert.equal(passedErc.whyHidden, true, `${theme}/${lang} apply reason after ERC passes`);
        assert.equal(passedErc.statusHidden, false, `${theme}/${lang} patch status hidden after ERC passes`);
        assert.equal(passedErc.status, locale['patch.ready'], `${theme}/${lang} patch status after ERC passes`);

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
