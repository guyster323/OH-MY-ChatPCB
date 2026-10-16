// Token source for the Soft panel. Values match concept C Soft v2.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const soft = {
  font: '"Pretendard", "SUIT", Inter, "Segoe UI", system-ui, sans-serif',
  mono: 'ui-monospace, Consolas, monospace',
  type: { xs: '12px', sm: '14px', md: '14px', lg: '16px' },
  lh: '1.45',
  space: [[2, 4], [3, 6], [4, 8], [5, 12]],
  radius: { sm: '10px', md: '14px', lg: '18px', pill: '999px' },
  target: '28px',
  shadow: {
    light: '0 2px 8px rgba(31,36,64,.06), 0 1px 2px rgba(31,36,64,.05)',
    dark: '0 2px 10px rgba(0,0,0,.35)'
  },
  light: {
    bg: '#f2f4fa',
    surface: '#ffffff',
    surface2: '#eef1f9',
    text: '#1f2440',
    muted: '#545b78',
    border: '#e0e4f1',
    borderStrong: '#7f86a4',
    accent: '#0b7566',
    onAccent: '#ffffff',
    accentText: '#09695b',
    accentSoft: '#e3f4f0',
    success: '#16703f',
    successBg: '#e6f5ec',
    danger: '#b4232f',
    dangerBg: '#fdeaec',
    warn: '#875400',
    warnBg: '#fdf1d9',
    focus: '#0b7566',
    locked: '#545b78',
    siwcBg: '#000',
    siwcFg: '#fff'
  },
  dark: {
    bg: '#13151e',
    surface: '#1b1e2a',
    surface2: '#252938',
    text: '#eef0f7',
    muted: '#a8aec5',
    border: '#2d3245',
    borderStrong: '#6d7495',
    accent: '#4fd1b5',
    onAccent: '#0a1d19',
    accentText: '#6fe0c6',
    accentSoft: '#143029',
    success: '#62d596',
    successBg: '#112619',
    danger: '#ff8f96',
    dangerBg: '#2d1519',
    warn: '#f0c062',
    warnBg: '#2a2111',
    focus: '#6fe0c6',
    locked: '#a8aec5',
    siwcBg: '#000',
    siwcFg: '#fff'
  }
};

function kebab(name) {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function rootLines() {
  return [
    `--font:${soft.font};`,
    `--mono:${soft.mono};`,
    ...Object.entries(soft.type).map(([name, value]) => `--fs-${name}:${value};`),
    `--lh:${soft.lh};`,
    ...soft.space.map(([step, size]) => `--sp-${step}:${size}px;`),
    ...Object.entries(soft.radius).map(([name, value]) => `--r-${name}:${value};`),
    `--target:${soft.target};`
  ];
}

function themeLines(mode) {
  return [
    `color-scheme:${mode};`,
    ...Object.entries(soft[mode]).map(([name, value]) => `--${kebab(name)}:${value};`),
    `--shadow:${soft.shadow[mode]};`
  ];
}

// The committed file indents declarations by two spaces and keeps a blank indented line before each closing brace.
function block(selector, lines) {
  return `${selector}{\n${lines.map((line) => `  ${line}`).join('\n')}\n  \n}`;
}

export function renderTokensCss() {
  const header = '/* Generated from redesign/build.mjs (concept C Soft v2). Do not hand-edit; regenerate. */\n';
  const media = `@media (prefers-color-scheme:dark){\n${block('  :root:not([data-theme=light])', themeLines('dark'))}\n\n}\n\n`;
  return `${header}${block(':root', rootLines())}\n\n${block(':root,[data-theme=light]', themeLines('light'))}\n${block('[data-theme=dark]', themeLines('dark'))}\n\n${media}`;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../apps/panel/styles/tokens.css');
  writeFileSync(out, renderTokensCss());
}
