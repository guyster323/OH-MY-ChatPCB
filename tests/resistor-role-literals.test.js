import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

// Role-detection words belong in resistor-vocabulary.js. Comments and
// identifiers are not literals. These strings are saved part data, net
// notes, or profile evidence, not a second detector.
const ALLOWED_ROLE_LITERALS = [
  ['src/kicad/project-generator.js', 'usb-c-cc-pulldowns'],
  ['src/kicad/project-generator.js', 'USB-C sink pulldown on CC1.'],
  ['src/kicad/project-generator.js', 'USB-C sink pulldown on CC2.'],
  ['src/kicad/project-generator.js', 'i2c-pullups'],
  ['src/kicad/project-generator.js', 'ChatPCB:I2C_PULLUP'],
  ['src/kicad/project-generator.js', 'I2C SCL pull-up resistor to +3V3.'],
  ['src/kicad/project-generator.js', 'I2C SDA pull-up resistor to +3V3.'],
  ['src/kicad/project-generator.js', '10k pull-up for TEMP${index} from VREF2.'],
  ['src/kicad/project-generator.js', 'I2C_PULLUP'],
  ['src/kicad/project-generator.js', '10k NTC temperature-sense node referenced to VREF2.'],
  ['src/kicad/project-generator.js', 'USB-C configuration channel sink pulldown net.'],
  ['src/runtime/board-profiles.js', 'CC pulldown compatibility'],
  ['src/runtime/board-profiles.js', 'usb-c-cc1-pulldown'],
  ['src/runtime/board-profiles.js', 'usb-c-cc2-pulldown'],
  ['src/runtime/board-profiles.js', 'i2c-scl-pullup'],
  ['src/runtime/board-profiles.js', 'i2c-sda-pullup'],
  ['src/runtime/board-profiles.js', 'Power, LED current, reset/boot, and I2C pull-up assumptions need simulation or calculation evidence.'],
  ['src/runtime/board-profiles.js', 'usb-c-cc-pulldowns'],
  ['src/runtime/board-profiles.js', 'i2c-pullups'],
  ['src/runtime/board-profiles.js', 'ntc-pullup-resistor'],
  ['src/runtime/board-profiles.js', 'usb-c-cc-pulldown-current'],
  ['src/runtime/board-profiles.js', '5.1k pulldown on each USB-C CC pin'],
  ['src/runtime/board-profiles.js', '0.98mA nominal current per asserted CC pulldown path.'],
  ['src/runtime/board-profiles.js', 'i2c-pullup-rise-time'],
  ['src/runtime/board-profiles.js', '4.7k pull-up'],
  ['src/runtime/board-profiles.js', 'ntc-temperature-sensing'],
  ['src/runtime/product-catalog.js', '특징: 아날로그 온도만.\n장점: 원가.\n단점: 습도 없음, 분압·보정이 필요.'],
  ['src/runtime/product-catalog.js', '특징: 통신으로만 연계.\n장점: 전원 도메인을 나눌 수 있음.\n단점: 버스 전압·종단·주소 계획이 필요.'],
  ['src/workflow/existing-project-edit.js', 'i2c-scl-pullup'],
  ['src/workflow/existing-project-edit.js', 'i2c-sda-pullup'],
  ['src/workflow/existing-project-edit.js', 'i2c-pullups'],
  ['src/workflow/existing-project-edit.js', 'ChatPCB:I2C_PULLUP'],
  ['src/workflow/existing-project-edit.js', 'I2C_PULLUP']
];

const ROLE_LITERAL = /pull-?ups?|pull-?downs?|풀업|풀다운|션트|센스|디바운스|분압|종단|debounces?|dividers?|terminations?|\bshunts?\b|\bsens(?:e|es|ing)\b/i;

function walkJs(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkJs(full));
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

function lineOf(source, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source[cursor] === '\n') line += 1;
  }
  return line;
}

function startsRegex(source, index) {
  let cursor = index - 1;
  while (cursor >= 0 && /\s/.test(source[cursor])) cursor -= 1;
  if (cursor < 0) return true;
  const ch = source[cursor];
  if ('([{:;,=~!&|?^<>+-*%'.includes(ch)) return true;
  let start = cursor;
  while (start >= 0 && /[A-Za-z]/.test(source[start])) start -= 1;
  const word = source.slice(start + 1, cursor + 1);
  return ['return', 'typeof', 'case', 'throw', 'void', 'delete', 'in', 'of', 'yield', 'await', 'else'].includes(word);
}

function readQuoted(source, start) {
  const quote = source[start];
  let cursor = start + 1;
  let text = '';
  while (cursor < source.length) {
    const ch = source[cursor];
    if (ch === '\\') {
      const next = source[cursor + 1] ?? '';
      const map = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"' };
      text += Object.hasOwn(map, next) ? map[next] : next;
      cursor += 2;
      continue;
    }
    if (ch === quote) return { text, end: cursor + 1 };
    text += ch;
    cursor += 1;
  }
  return { text, end: source.length };
}

function readTemplate(source, start) {
  let cursor = start + 1;
  let text = '';
  while (cursor < source.length) {
    const ch = source[cursor];
    if (ch === '\\') {
      text += ch + (source[cursor + 1] ?? '');
      cursor += 2;
      continue;
    }
    if (ch === '`') return { text, end: cursor + 1 };
    if (ch === '$' && source[cursor + 1] === '{') {
      text += '${';
      cursor += 2;
      let depth = 1;
      while (cursor < source.length && depth > 0) {
        const inner = source[cursor];
        if (inner === '{') depth += 1;
        else if (inner === '}') depth -= 1;
        if (depth > 0) text += inner;
        cursor += 1;
      }
      text += '}';
      continue;
    }
    text += ch;
    cursor += 1;
  }
  return { text, end: source.length };
}

function readRegex(source, start) {
  let cursor = start + 1;
  let klass = false;
  let pattern = '';
  while (cursor < source.length) {
    const ch = source[cursor];
    if (ch === '\\') {
      pattern += ch + (source[cursor + 1] ?? '');
      cursor += 2;
      continue;
    }
    if (ch === '[' && !klass) klass = true;
    else if (ch === ']' && klass) klass = false;
    else if (ch === '/' && !klass) {
      cursor += 1;
      while (cursor < source.length && /[a-z]/i.test(source[cursor])) cursor += 1;
      return { text: pattern, end: cursor };
    } else if (ch === '\n') return null;
    pattern += ch;
    cursor += 1;
  }
  return null;
}

function literalsIn(source) {
  const found = [];
  let cursor = 0;
  while (cursor < source.length) {
    const ch = source[cursor];
    const next = source[cursor + 1];
    if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', cursor);
      cursor = end < 0 ? source.length : end;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', cursor + 2);
      cursor = end < 0 ? source.length : end + 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const literal = readQuoted(source, cursor);
      found.push({ text: literal.text, index: cursor, kind: 'string' });
      cursor = literal.end;
      continue;
    }
    if (ch === '`') {
      const literal = readTemplate(source, cursor);
      found.push({ text: literal.text, index: cursor, kind: 'template' });
      cursor = literal.end;
      continue;
    }
    if (ch === '/' && startsRegex(source, cursor)) {
      const literal = readRegex(source, cursor);
      if (literal) {
        found.push({ text: literal.text, index: cursor, kind: 'regex' });
        cursor = literal.end;
        continue;
      }
    }
    cursor += 1;
  }
  return found;
}

test('role words stay inside resistor-vocabulary.js', () => {
  const srcRoot = path.resolve(import.meta.dirname, '../src');
  const allowed = new Set(ALLOWED_ROLE_LITERALS.map(([file, text]) => `${file}\n${text}`));
  const offenders = [];
  for (const file of walkJs(srcRoot)) {
    const relative = `src/${path.relative(srcRoot, file).split(path.sep).join('/')}`;
    if (relative === 'src/workflow/resistor-vocabulary.js') continue;
    const source = readFileSync(file, 'utf8');
    for (const literal of literalsIn(source)) {
      if (!ROLE_LITERAL.test(literal.text)) continue;
      const key = `${relative}\n${literal.text}`;
      if (allowed.has(key)) continue;
      offenders.push(`${relative}:${lineOf(source, literal.index)} ${literal.kind} ${JSON.stringify(literal.text)}`);
    }
  }
  assert.deepEqual(offenders, []);
});
