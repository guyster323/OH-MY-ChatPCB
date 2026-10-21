// One fail-closed vocabulary for resistor edits. Unit, role, edit-verb,
// question, permission, approximation, filler, and length words live here.
// A request is covered only when every content word is on this list.
import { isResistorValueWithUnit } from '../kicad/resistor-ohms.js';
import { normalizeMatchText } from '../runtime/match-text.js';

function rx(source, flags) {
  return new RegExp(source, flags);
}

const LED_WORDS = new Set([
  'led', 'leds', 'status', 'series', 'current', 'limiting', 'current-limiting',
  '엘이디', '엘예디', '발광', '다이오드', '발광다이오드', '상태', '직렬', '전류', '제한', '전류제한'
]);

const RESISTOR_NOUNS = new Set(['resistor', 'resistors', '저항', '抵抗']);

const FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'of', 'for', 'to', 'from', 'into', 'onto', 'on', 'in', 'at', 'by',
  'with', 'and', 'its', 'my', 'our', 'please', 'only', 'just', 'value', 'values',
  'it', 'them', 'one', 'also', 'now', 'too', 'is', 'be', 'are', 'was', 'were', 'am',
  'this', 'that', 'these', 'those', 'else', 'everything',
  'unchanged', 'rest', 'as', 'so', 'then', 'than', 'into', 'instead'
]);

const EDIT_VERBS = new Set([
  'change', 'set', 'update', 'make', 'modify', 'changing', 'setting', 'use', 'using', 'replace'
]);

const MODAL_WORDS = new Set([
  'can', 'could', 'would', 'will', 'shall', 'may', 'should', 'why', 'how', 'what', 'which',
  'ok', 'okay', 'you', 'your', 'i', 'kindly', 'me', 'we'
]);

const PARTICLE_WORDS = new Set([
  '으로', '로', '을', '를', '가', '은', '는', '의', '도', '만', '와', '과', '랑', '요', '에', '에서',
  '이랑', '하고', '및', '그리고', '좀', '다시', '주세요', '해줘', '해주', '줄래', '줄래요',
  '주실래요', '해줄래', '해주세요', '있어', '있나', '있을까요', '줄', '수', '할', '줘', '그냥', '값',
  '기존', '현재', '왜', '어떻게', '어떡', '뭐', '무엇', '몇', '할까', 'existing', 'currently',
  '용', '임', '입니다', '이다', '야', '이야'
]);

const DEMONSTRATIVES = new Set(['그', '저', '이', 'this', 'that', 'these', 'those']);

export const ENGLISH_ROLES = new Set([
  'pull-up', 'pull-ups', 'pullup', 'pullups', 'pull-down', 'pull-downs', 'pulldown', 'pulldowns',
  'termination', 'terminations', 'debounce', 'divider', 'dividers', 'feedback',
  'gate', 'gates', 'base', 'bases', 'button', 'buttons', 'shunt', 'shunts',
  'sense', 'senses', 'sensing', 'reset', 'resets', 'boot', 'boots', 'bias', 'biases',
  'i2c', 'sda', 'scl'
]);

export const KOREAN_ROLES = ['풀업', '풀다운', '종단', '디바운스', '분압', '피드백', '게이트', '베이스', '버튼', '션트', '센스', '리셋', '바이어스'];

// The edit path imports these. A second copy there would be another I2C detector.
export const I2C_PART_ID = 'i2c';
export const I2C_PART_PATTERN = String.raw`\bi2c\b|아이\s*2\s*씨|아이씨`;

const UNBOUND_NOUNS = new Set([
  'display', 'displays', 'monitor', 'monitors', 'tv', 'tvs', 'pot', 'pots', 'board', 'boards',
  'model', 'models', 'screen', 'screens', 'camera', 'cameras', 'video', 'videos',
  'trimmer', 'trimmers', 'webcam', 'webcams', 'uhd', 'potentiometer', 'potentiometers',
  '화면', '모니터', '팟', '보드', '모델', '스크린', '카메라', '영상', '트리머'
]);

const LENGTH_EN = new Set(['cable', 'cables', 'wire', 'wires', 'length', 'lengths', 'lead', 'leads']);
const LENGTH_KO = ['케이블', '전선', '길이'];

const NOISE_WORDS = new Set([
  'port', 'ports', 'pin', 'pins', 'gpio', 'gpios', '포트', '핀',
  'next', 'beside', 'near', '옆', 'color', 'colour', 'rev', 'revision', 'version', 'ver',
  'package', 'packages', 'pkg'
]);

const NONRES_OBJECTS = new Set([
  'capacitor', 'capacitors', 'cap', 'caps', '커패시터', '콘덴서', '캐패시터',
  'board', 'boards', 'color', 'colour', 'regulator', 'connector', 'header', 'mcu', 'chip',
  '케이블', '전선', '색', '보드', '커넥터', '헤더'
]);

// One keep vocabulary. The edit path imports this set for leave/as-is/don't-touch
// and for the self-target check. signal cues are also filler; "be" is only the
// complement of "leave", and don't-touch is not filler (it would swallow negation).
// slot: before = object then phrase, after = phrase then object, leave = only
// after "leave", leave-verb = the verb, filler = stem with no span of its own.
export const KEEP_CUES = Object.freeze([
  Object.freeze({ text: 'the way it is', slot: 'before', mask: 'all', signal: true }),
  Object.freeze({ text: 'as is', slot: 'before', mask: 'all', signal: true }),
  Object.freeze({ text: 'as-is', slot: 'before', mask: 'all', signal: true }),
  Object.freeze({ text: 'untouched', slot: 'before', mask: 'all', signal: true }),
  Object.freeze({ text: 'unchanged', slot: 'before', mask: 'all', signal: true }),
  Object.freeze({ text: 'alone', slot: 'leave', mask: 'all', signal: true }),
  Object.freeze({ text: 'be', slot: 'leave', mask: 'all', signal: false }),
  // mask 'all' hides the role, the same way "keep the pull-ups" does. mask 'ref'
  // left "pull-ups" visible and the LED edit was refused as another resistor.
  Object.freeze({ text: "don't touch", slot: 'after', mask: 'all', signal: false }),
  Object.freeze({ text: 'don’t touch', slot: 'after', mask: 'all', signal: false }),
  Object.freeze({ text: 'dont touch', slot: 'after', mask: 'all', signal: false }),
  Object.freeze({ text: 'do not touch', slot: 'after', mask: 'all', signal: false }),
  Object.freeze({ text: 'never touch', slot: 'after', mask: 'all', signal: false }),
  Object.freeze({ text: 'keep', slot: 'after', mask: 'all', signal: true, negatable: true }),
  Object.freeze({ text: 'hold', slot: 'after', mask: 'all', signal: true }),
  Object.freeze({ text: 'without', slot: 'after', mask: 'all', signal: true }),
  Object.freeze({ text: 'leave', slot: 'leave-verb', mask: 'all', signal: true }),
  Object.freeze({ text: '그대로 두고', slot: 'before', mask: 'all', signal: true }),
  Object.freeze({ text: '그대로', slot: 'before', mask: 'all', signal: true }),
  Object.freeze({ text: '유지하고', slot: 'before', mask: 'all', signal: true }),
  Object.freeze({ text: '유지', slot: 'before', mask: 'all', signal: true }),
  Object.freeze({ text: '놔두고', slot: 'before', mask: 'all', signal: true }),
  Object.freeze({ text: '놔 두고', slot: 'before', mask: 'all', signal: true }),
  Object.freeze({ text: '손대지 말고', slot: 'before', mask: 'all', signal: true }),
  Object.freeze({ text: '손대지 마', slot: 'before', mask: 'all', signal: true }),
  Object.freeze({ text: '건드리지 말고', slot: 'before', mask: 'all', signal: true }),
  Object.freeze({ text: '건드리지 마', slot: 'before', mask: 'all', signal: true }),
  Object.freeze({ text: '건드리지마', slot: 'before', mask: 'all', signal: true }),
  Object.freeze({ text: '그냥 둬', slot: 'before', mask: 'all', signal: true }),
  Object.freeze({ text: '그냥 두고', slot: 'before', mask: 'all', signal: true }),
  Object.freeze({ text: '남겨', slot: 'before', mask: 'all', signal: true }),
  Object.freeze({ text: '남기', slot: 'before', mask: 'all', signal: true }),
  Object.freeze({ text: '빼고', slot: 'before', mask: 'all', signal: true }),
  Object.freeze({ text: '두고', slot: 'filler', mask: 'all', signal: true }),
  Object.freeze({ text: '건드리지', slot: 'filler', mask: 'all', signal: true }),
  Object.freeze({ text: '손대지', slot: 'filler', mask: 'all', signal: true }),
  Object.freeze({ text: '놔두', slot: 'filler', mask: 'all', signal: true })
]);

const KEEP_FILLER_TEXTS = KEEP_CUES
  .filter((cue) => cue.signal && !cue.text.includes(' ') && !cue.text.includes("'") && !cue.text.includes('’'))
  .map((cue) => cue.text);
const KEEP_SIGNAL_TEXTS = KEEP_CUES.filter((cue) => cue.signal).map((cue) => cue.text);

// Leave, untouched, and hold are rows in KEEP_CUES. Callers read these
// projections so deleting a row changes the verb scan, the signal regex, and
// the LED keep skip set together.
export function keepLeaveVerbTexts() {
  return KEEP_CUES.filter((cue) => cue.slot === 'leave-verb').map((cue) => cue.text);
}

function negatedKeepVerbTexts() {
  const leave = [];
  const rest = [];
  for (const cue of KEEP_CUES) {
    if (cue.slot === 'leave-verb') leave.push(cue.text);
    else if (cue.negatable === true) rest.push(cue.text);
  }
  return [...leave, ...rest];
}

export function ledKeepVerbSkipTexts() {
  return KEEP_CUES
    .filter((cue) => cue.signal === true && (cue.slot === 'after' || cue.slot === 'leave-verb') && /^[a-z]+$/i.test(cue.text))
    .map((cue) => cue.text.toLowerCase());
}

function englishSignalWordSource() {
  const words = KEEP_CUES
    .filter((cue) => cue.signal === true && /^[a-z]+$/i.test(cue.text))
    .map((cue) => cue.text.toLowerCase());
  return words.length > 0 ? `\\b(?:${words.join('|')})\\b` : null;
}

function isAsciiWordChar(ch) {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || ch === '_';
}

function keepSpansOverlap(spans, start, end) {
  return spans.some((span) => start < span[1] && end > span[0]);
}

// Multi-word cues allow flexible whitespace. Korean allows none ("그대로두고").
function matchCueAt(text, index, cueText) {
  const parts = cueText.split(' ');
  const lower = text.toLowerCase();
  let cursor = index;
  for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
    const part = parts[partIndex];
    const koreanPart = isHangulChar(part[0]);
    if (partIndex > 0) {
      let spaces = 0;
      while (cursor < text.length && /\s/u.test(text[cursor])) {
        cursor += 1;
        spaces += 1;
      }
      if (!koreanPart && spaces === 0) return -1;
    }
    const needle = koreanPart ? part : part.toLowerCase();
    const hay = koreanPart ? text : lower;
    if (hay.slice(cursor, cursor + needle.length) !== needle) return -1;
    if (partIndex === 0) {
      const before = cursor === 0 ? '' : text[cursor - 1];
      if (!koreanPart && isAsciiWordChar(before)) return -1;
      if (koreanPart && isHangulChar(before)) return -1;
    }
    cursor += needle.length;
    if (partIndex === parts.length - 1 && !koreanPart) {
      const after = cursor >= text.length ? '' : text[cursor];
      if (isAsciiWordChar(after)) return -1;
    }
  }
  return cursor;
}

function findCueHits(text, cueText) {
  const first = cueText.split(' ')[0];
  const korean = isHangulChar(first[0]);
  const hay = korean ? text : text.toLowerCase();
  const needle = korean ? first : first.toLowerCase();
  const hits = [];
  let from = 0;
  while (from < text.length) {
    const at = hay.indexOf(needle, from);
    if (at < 0) break;
    const end = matchCueAt(text, at, cueText);
    if (end > at) hits.push([at, end]);
    from = at + Math.max(1, needle.length);
  }
  return hits;
}

const KEEP_CLAUSE_MARKS = [',', '.', '?', '!', ';', '\n', '。', '？', '！'];

// "2.2kΩ" is one value. Callers that pass skipDecimal still see the words
// before that dot. The default keeps the dot as a boundary.
function isDecimalPoint(text, index) {
  return text[index] === '.'
    && /\d/u.test(text[index - 1] ?? '')
    && /\d/u.test(text[index + 1] ?? '');
}

function keepClauseOrigin(text, index, skipDecimal = false) {
  let boundary = -1;
  for (const mark of KEEP_CLAUSE_MARKS) {
    let from = index - 1;
    while (from >= 0) {
      const at = text.lastIndexOf(mark, from);
      if (at < 0) break;
      if (skipDecimal && mark === '.' && isDecimalPoint(text, at)) {
        from = at - 1;
        continue;
      }
      boundary = Math.max(boundary, at);
      break;
    }
  }
  return boundary < 0 ? 0 : boundary + 1;
}

function keepTokenBare(word) {
  return String(word ?? '').replace(/^[("'` ,]+|[)"'` ,.;!?。！？]+$/gu, '');
}

function bareKeepToken(raw) {
  const text = String(raw ?? '');
  const stop = keepStopIndex(text);
  return keepTokenBare(stop > 0 ? text.slice(0, stop) : text);
}

// A value word inside the keep clause belongs to that clause. A bare number
// (a count, a year, a package) is not a value here. "at" is only the glue.
// A number and the unit after it are one value, attached or spaced.
function isKeepValueWord(token) {
  const stem = keepTokenBare(token)
    .replace(/(?:으로|로|은|는|이|가|을|를|도|만)$/u, '')
    .trim();
  if (!/^\d/u.test(stem)) return false;
  return isResistorValueWithUnit(stem);
}

// 1 when token is already a value. 2 when the next word is its unit.
function keepValueWidth(token, nextToken) {
  if (isKeepValueWord(token)) return 1;
  if (nextToken && isKeepValueWord(`${token} ${nextToken}`)) return 2;
  return 0;
}

function spanCarriesKeepValue(text, start, end) {
  const words = String(text ?? '').slice(start, end).match(/\S+/gu) ?? [];
  for (let index = 0; index < words.length; index += 1) {
    const token = bareKeepToken(words[index]);
    const next = words[index + 1] ? bareKeepToken(words[index + 1]) : '';
    if (keepValueWidth(token, next) > 0 || isUnitlessKeepValue(token)) return true;
  }
  return false;
}

// A decimal point inside 2.2k is not the end of the clause.
function keepStopIndex(raw) {
  const text = String(raw ?? '');
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (ch === '.' && /\d/u.test(text[index - 1] ?? '') && /\d/u.test(text[index + 1] ?? '')) continue;
    if (/[.;!?。！？]/u.test(ch)) return index;
  }
  return -1;
}

function keepNamesResistorHead(token) {
  return /(?:저항|抵抗|resistors?|leds?|엘이디|엘예디)/iu.test(String(token ?? ''));
}

const KEEP_LIST_STOP_EN = new Set(['change', 'set', 'update', 'make', 'modify', 'to']);

export function isKeepListStop(token) {
  const bare = keepTokenBare(token).toLowerCase();
  if (!bare) return false;
  if (KEEP_LIST_STOP_EN.has(bare)) return true;
  return bare.includes('바꿔') || bare.includes('변경') || bare.includes('수정');
}

export function isKeepListCoord(token) {
  const bare = keepTokenBare(token).toLowerCase();
  return bare === 'and' || bare === 'but' || bare === '그리고' || bare === '하고' || bare === '및' || bare === '이랑';
}

function englishKeepVerbNegated(text, verbIndex) {
  let prefix = text.slice(0, verbIndex).trimEnd().toLowerCase();
  for (let guard = 0; guard < 4; guard += 1) {
    const trailer = [' please', ' just', ' you'].find((item) => prefix.endsWith(item));
    if (!trailer) break;
    prefix = prefix.slice(0, -trailer.length).trimEnd();
  }
  if (prefix.endsWith("n't") || prefix.endsWith('n’t')) return true;
  return ['not', 'never', 'dont', "don't", 'don’t'].some((word) => prefix === word || prefix.endsWith(` ${word}`));
}

function koreanKeepCueNegated(after) {
  const body = String(after ?? '').trim();
  if (!body.startsWith('두지') && !body.startsWith('하지')) return false;
  const rest = body.slice(2).trimStart();
  return rest.startsWith('말') || rest.startsWith('마') || rest.startsWith('않');
}

function negatedKeepVerbBefore(text, phraseStart) {
  const origin = keepClauseOrigin(text, phraseStart);
  const head = text.slice(origin, phraseStart);
  const lower = head.toLowerCase();
  let verbAt = -1;
  for (const verb of negatedKeepVerbTexts()) {
    let from = 0;
    while (from < lower.length) {
      const at = lower.indexOf(verb, from);
      if (at < 0) break;
      const before = at === 0 ? '' : head[at - 1];
      const after = head[at + verb.length] ?? '';
      if (!isAsciiWordChar(before) && !isAsciiWordChar(after)) verbAt = origin + at;
      from = at + verb.length;
    }
  }
  return verbAt >= 0 && englishKeepVerbNegated(text, verbAt);
}

function keepParticleStem(token) {
  return keepTokenBare(token).replace(/(?:으로|로|은|는|이|가|을|를|도|만)$/u, '').trim();
}

// Any bare integer in the keep is the kept number. The joiner may be a space,
// ":", "=", "is", "값", "값은", or "at" ("R3: 1000", "R3 is 1000").
function isUnitlessKeepValue(token) {
  return /^\d+$/u.test(keepParticleStem(token));
}

// taken is right-to-left, so a spaced unit sits before its number in this array.
function takenValueIndexes(taken) {
  const bare = taken.map((word) => bareKeepToken(word[0]));
  const valueAt = new Set();
  for (let index = 0; index < bare.length; index += 1) {
    if (isKeepValueWord(bare[index])) valueAt.add(index);
    if (isUnitlessKeepValue(bare[index])) valueAt.add(index);
    if (index + 1 < bare.length && (isKeepValueWord(`${bare[index]} ${bare[index + 1]}`) || isKeepValueWord(`${bare[index + 1]} ${bare[index]}`))) {
      valueAt.add(index);
      valueAt.add(index + 1);
    }
  }
  return valueAt;
}

function keepObjectBefore(text, cueStart, skipDecimal = false) {
  let origin = keepClauseOrigin(text, cueStart, skipDecimal);
  // "R3 is 1000, unchanged": the cue sits alone after the comma. The number
  // and the name are in the previous segment.
  if (!/\S/u.test(text.slice(origin, cueStart)) && origin > 0 && (text[origin - 1] === ',' || text[origin - 1] === '，')) {
    origin = keepClauseOrigin(text, origin - 1, skipDecimal);
  }
  const words = [...text.slice(origin, cueStart).matchAll(/\S+/gu)];
  const taken = [];
  let tookObject = false;
  for (let index = words.length - 1; index >= 0 && taken.length < 8; index -= 1) {
    const token = bareKeepToken(words[index][0]);
    const prev = index > 0 ? bareKeepToken(words[index - 1][0]) : '';
    const spaced = Boolean(prev) && !isKeepValueWord(token) && isKeepValueWord(`${prev} ${token}`);
    const unitless = isUnitlessKeepValue(token);
    const value = isKeepValueWord(token) || spaced || unitless;
    const nearest = taken.length > 0 ? bareKeepToken(taken[taken.length - 1][0]) : '';
    const atGlue = token.toLowerCase() === 'at' && (takenValueIndexes(taken).size > 0 || /^\d+$/u.test(keepParticleStem(nearest)));
    // "R4는 680Ω으로 유지": the value sits between the ref and the cue.
    // "680Ω R4 unchanged": the value is left of the ref, so it stays an edit.
    // "R3 1000 그대로" / "R3 at 1000 unchanged": the unitless integer is the keep value.
    if (value || atGlue) {
      if (tookObject) break;
      taken.push(words[index]);
      if (spaced) {
        taken.push(words[index - 1]);
        index -= 1;
      }
      continue;
    }
    if (/^\d/u.test(token) || isKeepListStop(token)) break;
    taken.push(words[index]);
    tookObject = true;
  }
  const valueAt = takenValueIndexes(taken);
  if (!taken.some((word, at) => !valueAt.has(at) && bareKeepToken(word[0]).toLowerCase() !== 'at')) return null;
  return [origin + taken[taken.length - 1].index, cueStart];
}

// A comma stays inside the keep list ("don't touch R4, LED"). A period or an
// edit verb ends it. A value before that end is part of the keep ("keep R4 at
// 680Ω"). The ohms after "set" or "to" stay an edit.
function keepObjectAfter(text, cueEnd) {
  const words = [...text.slice(cueEnd).matchAll(/\S+/gu)];
  let end = cueEnd;
  let count = 0;
  let afterComma = false;
  let commaThenHead = false;
  for (let index = 0; index < words.length; index += 1) {
    if (count >= 6) break;
    const word = words[index];
    const raw = word[0];
    const stopPunct = keepStopIndex(raw);
    const token = bareKeepToken(raw);
    if (stopPunct === 0 || isKeepListStop(token)) break;
    const next = stopPunct > 0 ? null : words[index + 1];
    const width = keepValueWidth(token, next ? bareKeepToken(next[0]) : '');
    // "R4, LED 저항 680Ω" keeps R4. The ohms belong to the LED head.
    // "keep R4 at 680 ohms" / "hold R4 at 680 ohms" / "leave R4 at 680 ohms":
    // the number and the unit are one value, so both stay inside the keep.
    if (width > 0) {
      if (commaThenHead) break;
    } else if (/^\d/u.test(token)) {
      break;
    }
    if (width === 0 && afterComma && keepNamesResistorHead(token)) commaThenHead = true;
    if (width === 2) {
      const nextRaw = next[0];
      const nextPunct = keepStopIndex(nextRaw);
      end = cueEnd + next.index + (nextPunct > 0 ? nextPunct : nextRaw.length);
      if (nextRaw.includes(',') || nextRaw.includes('，')) afterComma = true;
      index += 1;
      if (nextPunct > 0) break;
      continue;
    }
    end = cueEnd + word.index + (stopPunct > 0 ? stopPunct : raw.length);
    if (token && !isKeepListCoord(token) && width === 0) count += 1;
    if (stopPunct > 0) break;
    if (raw.includes(',') || raw.includes('，')) afterComma = true;
  }
  return end > cueEnd ? [cueEnd, end] : null;
}

function leaveComplementObject(text, verbEnd) {
  const rest = text.slice(verbEnd);
  const breakAt = rest.search(/[.;!?,。！？\n]/u);
  const window = breakAt < 0 ? rest : rest.slice(0, breakAt);
  const complements = KEEP_CUES
    .filter((cue) => cue.slot === 'leave' || (cue.slot === 'before' && !isHangulChar(cue.text[0])))
    .slice()
    .sort((left, right) => right.text.length - left.text.length);
  let best = null;
  for (const cue of complements) {
    for (const [at, end] of findCueHits(window, cue.text)) {
      if (window.slice(0, at).trim() === '') continue;
      if (!best || at < best.at || (at === best.at && end > best.end)) best = { at, end, cue };
    }
  }
  if (!best) return null;
  const lead = /^\s*/u.exec(window)[0].length;
  if (best.at <= lead) return null;
  return {
    object: [verbEnd + lead, verbEnd + best.at],
    cue: [verbEnd + best.at, verbEnd + best.end]
  };
}

// Crossing a decimal ("2.2kΩ") is the numbered keep. It applies only when the
// object is an R ref or an LED_RESISTOR_SYNONYMS phrase. A bare 저항 qualified
// by another part ("커패시터 저항") is not that phrase, so the dot stays a boundary.
function numberedDecimalKeepObject(text, cueStart) {
  const object = keepObjectBefore(text, cueStart, true);
  if (!object) return null;
  const fragment = text.slice(object[0], object[1]);
  if (/\bR\d+\b/iu.test(fragment) || textHasLedResistorSynonym(fragment)) return object;
  return null;
}

// A before-cue whose object sits left of a decimal value ("R3 at 2.2kΩ as-is")
// is invisible to keepClauseSpans, because that dot is still a boundary there.
// The fragment is only for "does this name the edit target?". It is not stripped.
export function decimalBeforeKeepFragments(text) {
  const raw = String(text ?? '');
  const fragments = [];
  const occupied = [];
  const phrases = KEEP_CUES
    .filter((cue) => cue.slot === 'before')
    .slice()
    .sort((left, right) => right.text.length - left.text.length);
  for (const cue of phrases) {
    for (const [start, end] of findCueHits(raw, cue.text)) {
      if (keepSpansOverlap(occupied, start, end)) continue;
      if (koreanKeepCueNegated(raw.slice(end)) || negatedKeepVerbBefore(raw, start)) continue;
      if (keepObjectBefore(raw, start)) {
        occupied.push([start, end]);
        continue;
      }
      const object = keepObjectBefore(raw, start, true);
      if (!object) continue;
      occupied.push([start, end]);
      fragments.push(raw.slice(object[0], object[1]));
    }
  }
  return fragments;
}

// Objects are the kept part. Cues are the phrase itself, blanked out of the
// edit remainder so "유지하고" does not sit on the LED noun.
export function keepClauseSpans(text) {
  const raw = String(text ?? '');
  const objects = [];
  const cues = [];
  const occupied = [];
  const take = (object, mask, ...cueSpans) => {
    if (!object) return false;
    objects.push({
      start: object[0],
      end: object[1],
      mask,
      valued: spanCarriesKeepValue(raw, object[0], object[1])
    });
    for (const span of cueSpans) {
      if (!span) continue;
      cues.push({ start: span[0], end: span[1] });
      occupied.push(span);
    }
    return true;
  };
  for (const verb of keepLeaveVerbTexts()) {
    for (const [start, end] of findCueHits(raw, verb)) {
      if (englishKeepVerbNegated(raw, start)) continue;
      if (keepSpansOverlap(occupied, start, end)) continue;
      const found = leaveComplementObject(raw, end);
      if (found) {
        if (keepSpansOverlap(occupied, found.cue[0], found.cue[1])) continue;
        take(found.object, 'all', [start, end], found.cue);
        continue;
      }
      // "leave the pull-up at 2.2k" has no alone/as-is complement. "leave R1,
      // set the LED resistor" is still a keep of R1.
      const object = keepObjectAfter(raw, end);
      if (!object) continue;
      take(object, 'all', [start, end]);
    }
  }
  const phrases = KEEP_CUES
    .filter((cue) => cue.slot === 'before' || cue.slot === 'after')
    .slice()
    .sort((left, right) => right.text.length - left.text.length);
  for (const cue of phrases) {
    for (const [start, end] of findCueHits(raw, cue.text)) {
      if (keepSpansOverlap(occupied, start, end)) continue;
      if (cue.slot === 'before') {
        if (koreanKeepCueNegated(raw.slice(end)) || negatedKeepVerbBefore(raw, start)) continue;
        // A decimal in 2.2kΩ is not a clause break when the object is R3, R4,
        // or an LED_RESISTOR_SYNONYMS phrase. "커패시터 저항 4.7k" is not.
        const object = keepObjectBefore(raw, start) || numberedDecimalKeepObject(raw, start);
        if (!take(object, cue.mask, [start, end])) continue;
        continue;
      }
      if (cue.negatable === true && englishKeepVerbNegated(raw, start)) continue;
      take(keepObjectAfter(raw, end), cue.mask, [start, end]);
    }
  }
  return { objects, cues };
}

const ADVICE_KO = ['왜', '뭐', '어떻게', '궁금', '할까', '바꿔야'];
const ADVICE_EN = new Set(['why', 'ask', 'know', 'what', 'how', 'wonder', 'which']);

const PERMIT_PHRASES = [
  '바꿔줄래', '바꿔 줄래', '바꿔주실래요', '바꿔 주실래요', '바꿔줄 수 있어', '바꿔 줄 수 있어',
  '바꿀 수 있어', '바꿀수 있어',
  '바꿔도 될까', '바꿔도 되나요', '바꿔도 돼', '해줄래', '할 수 있어', '할수 있어',
  '가능하면', '괜찮으면', 'is it ok to', 'can you', 'could you', 'would you',
  'can i', 'could i', 'may i', 'should be'
];

// "if" is not a function word. These phrases are the only place it is filler.
const POLITE_IF_PHRASES = ['if possible', 'if you can', 'if you could'];

// Comparison and discourse asides. They are not a resistor name. A word is
// filler only when every copy of it sits inside one of these phrases, so a
// real "기준 저항" or "골든 저항" in the same sentence stays a modifier.
// 어쨌든 / 어떻든 count only beside an LED-resistor synonym. 언제든 and 뭐든
// are not in this list. Bare 든 is still the choice ending, not these phrases.
const ASIDE_PHRASES = Object.freeze([
  Object.freeze({ source: String.raw`(?<![가-힣])어쨌든(?![가-힣])`, needsLed: true }),
  Object.freeze({ source: String.raw`(?<![가-힣])어떻든(?![가-힣])`, needsLed: true }),
  Object.freeze({ source: String.raw`(?<![가-힣])(?:골든\s+)?샘플처럼(?![가-힣])`, needsLed: false }),
  Object.freeze({ source: String.raw`(?<![가-힣])(?:골든\s+)?샘플과\s+같게(?![가-힣])`, needsLed: false }),
  Object.freeze({ source: String.raw`(?<![가-힣])골든\s+보드\s+기준으로(?![가-힣])`, needsLed: false })
]);

function asideTokenStem(token) {
  const cleaned = String(token ?? '').replace(rx("^[(\"'`[•·±<>→⇒~∼〜=]+|[)\\]\"'`,.:;?？!！<>→⇒~∼〜=]+$", "gu"), '');
  return stripParticle(cleaned);
}

function asideSpans(text) {
  const raw = String(text ?? '');
  const led = textHasLedResistorSynonym(raw);
  const spans = [];
  for (const phrase of ASIDE_PHRASES) {
    if (phrase.needsLed && !led) continue;
    for (const match of raw.matchAll(rx(phrase.source, 'gu'))) {
      const start = match.index ?? 0;
      spans.push([start, start + match[0].length]);
    }
  }
  return spans;
}

export function isAsideFiller(word, text) {
  if (isGeonaHedgeFiller(word, text)) return true;
  const key = String(word ?? '');
  if (!key) return false;
  const raw = String(text ?? '');
  const spans = asideSpans(raw);
  if (spans.length === 0) return false;
  let saw = false;
  for (const match of raw.matchAll(rx("\\S+", "gu"))) {
    if (asideTokenStem(match[0]) !== key) continue;
    saw = true;
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const inside = spans.some(([from, to]) => start < to && end > from);
    if (!inside) return false;
  }
  return saw;
}

// Predicate-final syllables -거나 already sits on (하 in 하거나, 꾸 in 바꾸거나,
// 두 in 두거나). Bare 든 is that same ending only after one of these, or when
// 말든 follows. Lexical 든 (어쨌든, 얼마든, 골든, 무엇이든, 뭐든) is not a stem.
const VERB_STEM_BEFORE_DEUN = [
  '하', '꾸', '두', '쓰', '말', '밝', '리', '시', '가', '오', '보', '주', '되',
  '먹', '살', '추', '들', '있', '없', '좋', '워', '와', '어', '아', '여', '해',
  '돼', '우', '으', '꿀', '둡', '받', '신', '같', '알', '울', '열', '놓', '넣',
  '싶', '읽', '앉', '걸', '켜', '끄'
].join('');

// One choice-joiner list. Clause split, valued-keep checks, alternative
// signals, and the value-suffix join all read these rows. "and", "나", and "·"
// coordinate a clause and are not a choice. "하거나" contains 고, but that 고
// is not a new clause. An ending matches (?:거나|든지|든가|던지|든) plus
// CHOICE_ENDING_POLITE on one word. scanRe is that plain suffix. deun sets
// plainSuffix: false because its re is a lookaround, so a hedge scan does
// not treat every 든 as a second choice. Bare 든 counts only after
// VERB_STEM_BEFORE_DEUN, or before 말든.
// "or so" is an approximation, not a choice.
// "-거나 하-" is a hedge ("or something"), not a choice, only when the
// predicate right before -거나 is an allowed shape and nothing after the
// 하다 form is a second alternative. Anything else stays a choice
// ("금지하거나", "취소하거나", "노노 하거나"). Allowed: a positive edit stem
// from KOREAN_REQUEST_STEMS and EXACT_EDIT_STEMS (바꾸/바꿔/바꿀, 변경하,
// 수정하, 설정하, 맞추/맞춰, with 주/주시 glued or spaced). The predicate is
// that stem, not a longer word that contains it ("바꾸필요없"). Also an LED
// state stem (밝, 어둡, 약하, 강하, 눈부시, 거슬리), the leave stem of
// KEEP_CUES ("두고"/"둬" → 두거나, Q3), or a free-standing 거나. Nothing in
// front of that 거나 is 거나하다 ("거나 한", "거나한"). A word in front is a
// hedge only when that word is an allowed stem ("바꿔 거나", "밝 거나").
// "노노 거나", "금지 거나", and "취소 거나" are not.
// An adjective takes the same ending ("약하거나 해서", "밝거나 하면"): the
// stem is not a second value, and 약 there is not the adverb "about".
// A negation marker anywhere in the sentence drops the hedge, including one
// after -거나 ("바꾸거나 하지 마", "하지는 마", "하면 안 돼", "바꾸진 않거나",
// "안바꾸거나", "손대지 않거나", "밝지 않거나"). The "건 아니고" closer is
// the 거나하다 idiom, not that marker. The stem glued to -거나 is never a
// hedge when that stem is itself a negation (말거나, 않거나, 못하거나,
// 없거나, 마시거나, 않으시거나), whatever word is in front of it
// ("바꿔 버리지를 말거나", "바꿔 버리지 말거나").
// The polite closer after the 하다 form is one evaluative shape
// (좋겠어요, 감사하겠어요), not a listed sentence.
// isGeonaHedgeJoiner reads both.
// idiomWith is the "regardless" partner. X든/X든지/X거나 plus that partner is
// a choice when the verb is an edit verb, when 오다 follows an edit/do
// connective, or when the pair sits on a resistor value in this clause
// (value+(으)로, or a target earlier in the clause and a value on either
// side of the pair). "바꾸고 하든 말든" stays the idiom: -고 is another
// clause, so a value only in the previous clause does not count.
// Polite tail on a choice ending: 바꾸거나요, 바꾸거나도, 바꾸거나나.
export const CHOICE_ENDING_POLITE = String.raw`(?:요|도|나)?`;

function choiceJoiner(row) {
  const next = { ...row };
  if (row.place === 'ending' && row.plainSuffix !== false) {
    next.scanRe = `${row.re}${CHOICE_ENDING_POLITE}`;
  }
  return Object.freeze(next);
}

export const CHOICE_JOINERS = Object.freeze([
  choiceJoiner({ id: 'or', lang: 'en', text: 'or', re: String.raw`\bor\b`, place: 'word', notBefore: String.raw`\s+so\b` }),
  choiceJoiner({ id: 'ttoneun', lang: 'ko', text: '또는', re: '또는', place: 'word' }),
  choiceJoiner({ id: 'animyeon', lang: 'ko', text: '아니면', re: '아니면', place: 'word' }),
  choiceJoiner({ id: 'hogeun', lang: 'ko', text: '혹은', re: '혹은', place: 'word' }),
  choiceJoiner({ id: 'hageona', lang: 'ko', text: '하거나', re: '하거나', place: 'word' }),
  choiceJoiner({ id: 'geona', lang: 'ko', text: '거나', re: '거나', place: 'ending', idiomWith: '말거나' }),
  choiceJoiner({ id: 'deunji', lang: 'ko', text: '든지', re: '든지', place: 'ending', idiomWith: '말든지' }),
  choiceJoiner({ id: 'deunga', lang: 'ko', text: '든가', re: '든가', place: 'ending' }),
  choiceJoiner({ id: 'deonji', lang: 'ko', text: '던지', re: '던지', place: 'ending' }),
  choiceJoiner({
    id: 'deun',
    lang: 'ko',
    text: '든',
    re: `(?<=[${VERB_STEM_BEFORE_DEUN}])든|든(?=\\s*말든)`,
    place: 'ending',
    plainSuffix: false,
    idiomWith: '말든'
  })
]);

export function choiceJoinerRow(id) {
  const row = CHOICE_JOINERS.find((item) => item.id === id);
  if (!row) throw new Error(`Unknown choice joiner id: ${id}`);
  return row;
}

function idiomPairRows() {
  return CHOICE_JOINERS
    .filter((item) => item.idiomWith)
    .slice()
    .sort((left, right) => right.idiomWith.length - left.idiomWith.length || right.text.length - left.text.length);
}

function bareChoiceToken(token) {
  return String(token ?? '').replace(/^[("'`]+|[)"'`.;!?。！？,]+$/gu, '');
}

function stripChoicePolite(text) {
  if (!/(?:요|도|나)$/u.test(text)) return text;
  const cut = text.slice(0, -1);
  const keeps = idiomPairRows().some((row) => (
    cut === row.idiomWith || cut.endsWith(row.text) || cut.endsWith(row.idiomWith)
  ));
  return keeps ? cut : text;
}

function previousChoiceWord(text, index) {
  const match = /(\S+)\s*$/u.exec(String(text ?? '').slice(0, index));
  if (!match) return null;
  return { text: match[1], start: match.index };
}

function nextChoiceWord(text, index) {
  const match = /^\s*(\S+)/u.exec(String(text ?? '').slice(index));
  return match ? match[1] : '';
}

function hangulParts(ch) {
  const code = ch.codePointAt(0);
  if (code < 0xAC00 || code > 0xD7A3) return null;
  const n = code - 0xAC00;
  return { onset: Math.floor(n / 588), vowel: Math.floor((n % 588) / 28), coda: n % 28 };
}

function hangulSyllable(onset, vowel, coda) {
  return String.fromCodePoint(0xAC00 + ((onset * 21) + vowel) * 28 + coda);
}

// 아/어 connective back to the dictionary stem. 바꿔 → 바꾸, 해 → 하, 맞춰 → 맞추.
// 바꾸고 stays empty: -고 is a clause link, and 오다 does not attach there.
function araEoStem(word) {
  const text = String(word ?? '');
  if (!text) return null;
  if (text === '해' || text === '하여') return '하';
  if (text.endsWith('하여') && text.length > 2) return `${text.slice(0, -2)}하`;
  if (text.endsWith('해') && text.length > 1) return `${text.slice(0, -1)}하`;
  const last = text[text.length - 1];
  const parts = hangulParts(last);
  if (!parts || parts.coda !== 0) return null;
  const head = text.slice(0, -1);
  if (parts.vowel === 14) return head + hangulSyllable(parts.onset, 13, 0);
  if (last === '아' || last === '어') return head || null;
  return null;
}

// One Korean request-stem list. isKoreanRequestStem matches a word that
// contains a stem. The -거나 hedge requires the predicate to be that stem.
const KOREAN_REQUEST_STEMS = Object.freeze(['바꿔', '바꾸', '바꿀', '변경', '수정', '설정', '부탁']);

// 맞추 is an edit verb and not a request stem. "하" alone is on neither list.
const EXACT_EDIT_STEMS = Object.freeze(['맞추', '맞춰']);

// isEditVerbWord is the English set. Korean edit stems are the same list the
// request stem already names, plus 맞추. "하" alone is not on it.
function isChoiceEditVerb(stem) {
  const text = String(stem ?? '');
  if (!text || text.includes('부탁')) return false;
  if (isEditVerbWord(text)) return true;
  if (EXACT_EDIT_STEMS.includes(text)) return true;
  if (!isKoreanRequestStem(text)) return false;
  if (/(?:고|며|지만|면|서)$/u.test(text)) return false;
  return true;
}

function isEditOrDoConnective(word) {
  const stem = araEoStem(bareChoiceToken(word));
  if (!stem) return false;
  if (stem === '하') return true;
  if (stem.endsWith('하')) return isChoiceEditVerb(stem.slice(0, -1));
  return isChoiceEditVerb(stem);
}

// 오다 after 바꿔/해/맞춰 is still the edit. 오든 after 바꾸고 is the idiom.
function verbBeforePairIsChoice(text, verb, verbAt) {
  if (isChoiceEditVerb(verb)) return true;
  if (!verb.endsWith('오')) return false;
  const head = verb.slice(0, -1);
  if (head) return isEditOrDoConnective(head);
  const prev = previousChoiceWord(text, verbAt);
  return prev != null && isEditOrDoConnective(prev.text);
}

// The 고 of "-거나 하-" ("거나 하고", "거나하고") is the hedge auxiliary,
// not a clause break. The edit separators derive from this one lookbehind.
export const GEONA_HADA_GO_LOOKBEHIND = String.raw`(?<!거나\s*하)`;

// One -고 / 말고 clause boundary. 하거나's 고 is not a break, and 고 나서 is
// one connective. existing-project-edit.js imports this so the keep-list
// check cannot grow a second copy.
export const GO_MALGO_CLAUSE_BOUNDARIES = Object.freeze([
  // 거나 하고's 고 is the hedge auxiliary, not a new clause. 하거나's 고 is
  // still excluded by (?!거나), and 고 나서 stays one connective.
  Object.freeze({ id: 'go', re: `(?<=[가-힣])${GEONA_HADA_GO_LOOKBEHIND}${String.raw`고(?!\s*나서)(?!거나)`}` }),
  Object.freeze({ id: 'malgo', re: String.raw`말고` })
]);

export function goMalgoClauseSpans(text) {
  const raw = String(text ?? '');
  const spans = [];
  for (const row of GO_MALGO_CLAUSE_BOUNDARIES) {
    for (const match of raw.matchAll(rx(row.re, 'gu'))) {
      const at = match.index ?? 0;
      spans.push([at, at + match[0].length]);
    }
  }
  return spans;
}

// Punctuation, and, and the shared -고 / 말고 breaks. 하거나's 고 is not a
// break. The edit path uses the same breaks so the pair and the ohms share
// a clause.
function idiomClauseBreaks(text) {
  const raw = String(text ?? '');
  const breaks = [];
  const add = (at, length) => {
    breaks.push([at, at + length]);
  };
  for (let at = 0; at < raw.length; at += 1) {
    const ch = raw[at];
    const punctuation = ch === ',' || ch === '，' || ch === ';' || ch === '\n'
      || ch === '。' || ch === '？' || ch === '！' || ch === '?' || ch === '!';
    const dot = ch === '.' && !(/\d/u.test(raw[at - 1] ?? '') && /\d/u.test(raw[at + 1] ?? ''));
    if (punctuation || dot) add(at, 1);
  }
  for (const match of raw.matchAll(/\band\b/giu)) add(match.index ?? 0, match[0].length);
  for (const [from, to] of goMalgoClauseSpans(raw)) add(from, to - from);
  return breaks;
}

function idiomClauseBounds(text, index) {
  const raw = String(text ?? '');
  let start = 0;
  let end = raw.length;
  for (const [from, to] of idiomClauseBreaks(raw)) {
    if (to <= index && to > start) start = to;
    if (from >= index && from < end) end = from;
  }
  return [start, end];
}

function idiomClauseHasTarget(fragment) {
  if (textHasLedResistorSynonym(fragment)) return true;
  if (/\bR\d+\b/iu.test(fragment)) return true;
  return /(?:저항|抵抗|\bresistors?\b)/iu.test(fragment);
}

const IDIOM_OHM_BODY = String.raw`\d+(?:\.\d+)?\s*(?:Ω|옴|ohms?\b|[rRkK](?![A-Za-z]))|\d+(?:\.\d+)?\s*[kKmM]\d*(?![A-Za-z])|\d+\s*[rR]\d+(?![A-Za-z])`;

function idiomGapIsConnective(gap) {
  const words = String(gap ?? '').split(/\s+/u).filter(Boolean);
  return words.every((word) => isEditOrDoConnective(bareChoiceToken(word)));
}

// value+(으)로 may keep an edit/do connective between itself and the verb
// ("680Ω으로 해 가든"). A target earlier in the same clause counts with a
// value on either side of the pair ("LED 저항 680Ω 하든", "LED 저항은 하든
// 말든 680Ω으로"). A value only in the previous -고 clause does not.
function idiomPairSitsOnValue(text, verbAt) {
  const raw = String(text ?? '');
  const [clauseFrom, clauseTo] = idiomClauseBounds(raw, verbAt);
  const before = raw.slice(clauseFrom, verbAt);
  const particle = new RegExp(String.raw`(?:${IDIOM_OHM_BODY})(?:\s*(?:Ω|옴))?\s*(?:으로|로)`, 'giu');
  let last = null;
  for (const match of before.matchAll(particle)) last = match;
  if (last && idiomGapIsConnective(before.slice(last.index + last[0].length))) return true;
  if (!idiomClauseHasTarget(before)) return false;
  if (new RegExp(IDIOM_OHM_BODY, 'iu').test(before)) return true;
  return new RegExp(IDIOM_OHM_BODY, 'iu').test(raw.slice(verbAt, clauseTo));
}

// null when this span is not one half of an X든 + 말든 pair. The caller treats
// that the same as a real choice, which is what a bare 든 ending already is.
function pairedIdiomVerb(text, start, end) {
  const raw = String(text ?? '');
  const slice = raw.slice(start, end);
  const bare = bareChoiceToken(slice);
  if (!bare) return null;
  const lead = slice.indexOf(bare);
  const bareStart = start + (lead < 0 ? 0 : lead);
  const core = stripChoicePolite(bare);
  const rows = idiomPairRows();
  for (const row of rows) {
    if (core !== row.idiomWith) continue;
    const prev = previousChoiceWord(raw, start);
    if (!prev) return null;
    const prevBare = bareChoiceToken(prev.text);
    const prevCore = stripChoicePolite(prevBare);
    if (!prevCore.endsWith(row.text) || prevCore.length === row.text.length) return null;
    const verb = prevCore.slice(0, -row.text.length);
    const verbAt = prev.start + Math.max(0, prev.text.indexOf(prevBare)) + Math.max(0, prevBare.indexOf(verb));
    return { verb, verbAt };
  }
  for (const row of rows) {
    let host = core;
    let sawPartner = false;
    if (core.endsWith(row.idiomWith) && core.length > row.idiomWith.length) {
      host = stripChoicePolite(core.slice(0, -row.idiomWith.length));
      sawPartner = true;
    } else {
      const next = nextChoiceWord(raw, end);
      if (next && stripChoicePolite(bareChoiceToken(next)) === row.idiomWith) sawPartner = true;
    }
    if (!sawPartner || !host.endsWith(row.text) || host.length === row.text.length) continue;
    const verb = host.slice(0, -row.text.length);
    const verbAt = bareStart + Math.max(0, bare.indexOf(verb));
    return { verb, verbAt };
  }
  return null;
}

// 'edit' is the 8bd7c6b choice. 'value' is the same pair sitting on the ohms,
// for any verb. 'idiom' applies. 'no' is not a pair.
function idiomPairClass(text, start, end) {
  const pair = pairedIdiomVerb(text, start, end);
  if (!pair) return 'no';
  if (verbBeforePairIsChoice(text, pair.verb, pair.verbAt)) return 'edit';
  if (idiomPairSitsOnValue(text, pair.verbAt)) return 'value';
  return 'idiom';
}

// The pair is the idiom "regardless" unless it is a real edit choice or it
// sits on the resistor value. Both halves return true so a partner such as
// 말든 is not a second choice.
export function choiceJoinerIsIdiom(text, start, end) {
  return idiomPairClass(text, start, end) === 'idiom';
}

// The pair sits on the ohms, so a keep in an earlier clause still joins it.
// An edit verb does too ("680Ω으로 바꾸든 말든", "바꿔 오든 말든"). A pair
// after -고 is not on the ohms and keeps the old geometry.
export function choiceJoinerBindsValue(text, start, end) {
  const pair = pairedIdiomVerb(text, start, end);
  if (!pair || idiomPairClass(text, start, end) === 'idiom') return false;
  return idiomPairSitsOnValue(text, pair.verbAt);
}

export function choiceWordJoinerSources({ exceptApprox = false } = {}) {
  return CHOICE_JOINERS.filter((item) => item.place === 'word').map((item) => (
    exceptApprox && item.notBefore ? `(?:${item.re})(?!${item.notBefore})` : item.re
  ));
}

// Negation and alternatives are rejection signals, not allow-list words.
// They are still filler for role detection, so "not" and "마" are not a second role.
const NEGATION_OR_ALTERNATIVE_WORDS = new Set([
  'not', 'no', 'never', "don't", 'dont', 'do', 'does', 'did',
  '마', '말', '말고', '않', '하지',
  ...CHOICE_JOINERS.filter((item) => item.place === 'word').map((item) => item.text)
]);

export function isNegationOrAlternativeWord(word) {
  const key = lower(word);
  return NEGATION_OR_ALTERNATIVE_WORDS.has(key) || NEGATION_OR_ALTERNATIVE_WORDS.has(word);
}

export function textHasPoliteIf(text) {
  const folded = String(text ?? '').toLowerCase();
  return rx("\\bif possible\\b|\\bif you can\\b|\\bif you could\\b").test(folded);
}

// "if" and "possible" are filler only inside the polite phrases above.
export function isPoliteIfFiller(word, clause) {
  if (!textHasPoliteIf(clause)) return false;
  const key = lower(word);
  return key === 'if' || key === 'possible';
}

export function isKoreanRequestStem(word) {
  const text = String(word ?? '');
  return KOREAN_REQUEST_STEMS.some((stem) => text.includes(stem));
}

export const SHUNT_SENSE_WORDS = new Set([
  'sense', 'senses', 'sensing', 'current-sense', 'shunt', 'shunts', '션트', '센스'
]);

export function isShuntSenseWord(word) {
  return SHUNT_SENSE_WORDS.has(lower(word));
}

// One LED-resistor phrase list. Target classification and keep classification
// both read this set. A second copy drops a hyphen or a Korean spacing.
// "current limiter", "indicator resistor", and "the series one" name that part
// on their own. "{led}" rows are the same set with the status LED ref filled in.
export const LED_RESISTOR_SYNONYMS = Object.freeze([
  'current-limiting',
  'current limiting',
  'current-limit',
  'current limiter',
  'current limiters',
  'indicator resistor',
  'series',
  'series one',
  'the series one',
  'LED series',
  'status LED resistor',
  '직렬',
  'LED 직렬',
  '전류제한',
  '전류 제한',
  '전류 제한용',
  '전류제한용',
  '전류 제한기',
  '전류제한기',
  '표시등 저항',
  '리미터',
  'led',
  'leds',
  'status',
  '엘이디',
  '엘예디',
  '상태',
  '상태 LED 저항',
  '발광다이오드',
  "{led}'s resistor",
  'the {led} resistor',
  '{led} resistor',
  '{led} 저항'
]);

function synonymFold(text) {
  return lower(text).replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

function synonymCompact(text) {
  return lower(text).replace(/[-\s]+/g, '');
}

function escapeSynonymBody(folded) {
  return folded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
}

// Optional space between Hangul syllables, so "발광다이오드" also matches
// "발광 다이오드". A space still cannot split a particle off a longer word:
// the tail check rejects "전류 제한 기" inside "전류 제한 기능".
function flexKoreanAlias(folded) {
  const chars = [...folded];
  let out = '';
  for (let index = 0; index < chars.length; index += 1) {
    const ch = chars[index];
    if (/\s/u.test(ch)) {
      out += '\\s*';
      continue;
    }
    if (index > 0 && isHangulChar(chars[index - 1]) && isHangulChar(ch)) out += '\\s*';
    out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return out;
}

// "{led}" waits for the status LED ref. The other rows are ready to match.
const LED_RESISTOR_SYNONYM_MATCHERS = LED_RESISTOR_SYNONYMS.filter((synonym) => !synonym.includes('{led}')).map((synonym) => {
  const folded = synonymFold(synonym);
  const packed = synonymCompact(synonym);
  const ascii = /^[a-z0-9 ]+$/.test(folded);
  const body = escapeSynonymBody(folded);
  return {
    folded,
    packed,
    ascii,
    words: folded.split(' ').filter(Boolean),
    // Spaces inside a Korean alias are optional ("전류 제한기" / "전류제한기",
    // "발광다이오드" / "발광 다이오드"). They are not a free pass through the
    // next word ("제한 기능").
    koreanRe: ascii ? null : new RegExp(flexKoreanAlias(folded), 'gu'),
    re: ascii ? new RegExp(`(?:^|[^a-z0-9])${body}(?:[^a-z0-9]|$)`) : null,
    // Noun rows name the part. Modifier rows need 저항/저항기 after them.
    noun: synonymRowIsNoun(folded)
  };
});

const LED_REF_SYNONYM_TEMPLATES = LED_RESISTOR_SYNONYMS.filter((synonym) => synonym.includes('{led}'));

function ledRefToken(ledRef) {
  const ref = String(ledRef ?? '').trim();
  if (!/^[A-Za-z]{1,3}\d+$/u.test(ref)) return null;
  return ref;
}

function ledRefSynonymMatchers(ledRef) {
  const ref = ledRefToken(ledRef);
  if (!ref) return [];
  return LED_REF_SYNONYM_TEMPLATES.map((synonym) => {
    const folded = synonymFold(synonym.replaceAll('{led}', ref));
    const packed = synonymCompact(folded);
    const body = escapeSynonymBody(folded);
    return {
      folded,
      packed,
      ascii: true,
      words: folded.split(' ').filter(Boolean),
      re: new RegExp(`(?:^|[^a-z0-9])${body}(?:[^a-z0-9]|$)`, 'iu')
    };
  });
}

// A modifier phrase ("current limiting", "current limit", "series") still needs
// the resistor noun. A bare name is the part by itself: "current limiter",
// "current limiters", "the series one", "전류 제한기". "limit" stays the
// modifier inside "current-limit". A one-word part name ("전류제한기", "리미터")
// is bare too. LED words and "전류제한용" stay modifiers.
function synonymIsBareName(folded) {
  const words = folded.split(' ').filter(Boolean);
  if (words.some((word) => RESISTOR_NOUNS.has(word))) return false;
  if (words.length < 2) {
    const only = words[0] ?? '';
    if (!only || LED_WORDS.has(only) || FUNCTION_WORDS.has(only) || only === 'limit') return false;
    if (only.endsWith('용')) return false;
    return true;
  }
  const hasOutside = words.some((word) => !LED_WORDS.has(word) && !FUNCTION_WORDS.has(word) && word !== 'limit');
  const hasFunctionWithLed = words.some((word) => FUNCTION_WORDS.has(word)) && words.some((word) => LED_WORDS.has(word));
  return hasOutside || hasFunctionWithLed;
}

// Derived from the synonym row, not a second list of Korean spellings.
// A resistor noun already in the row ("표시등 저항", "상태 LED 저항") is the
// part. So is a bare name ("전류 제한기", "리미터"). A 용 row stays a modifier
// ("전류 제한용"), matching the one-word rule above.
function synonymRowIsNoun(folded) {
  const words = folded.split(' ').filter(Boolean);
  if (words.some((word) => RESISTOR_NOUNS.has(word) || word === '저항기')) return true;
  if (words.some((word) => word.endsWith('용'))) return false;
  return synonymIsBareName(folded);
}

export function ledResistorSynonymIsNoun(synonym) {
  return synonymRowIsNoun(synonymFold(synonym));
}

// PARTICLE_SUFFIXES plus the subject particles 이/가. Longest first, so
// "으로" wins over "로" and "이랑" wins over "이".
let aliasTailParticles = null;
function koreanAliasTailParticles() {
  if (!aliasTailParticles) {
    aliasTailParticles = [...new Set([...PARTICLE_SUFFIXES, '이', '가'])].sort((left, right) => right.length - left.length);
  }
  return aliasTailParticles;
}

// A Korean alias is one word. Hangul glued on the left is a different word
// ("과전류제한기", "밀리미터"). The tail lengthens the word only when the next
// Hangul is a noun continuation ("전류 제한기능", "전류 제한 기능": the noun
// 기능, or the leftover syllable 능 once 기 was read from 기능; "전류 제한기판"
// is 기판 the same way, leftover 판). Particles and postpositions are not that
// continuation, so they are not an allowlist: 하고, 나, 에는, 처럼, and the
// rest pass because they do not start a new noun. A closed particle list is
// what made 에는 and 까지 fail. It cannot name every stacked ending, and it
// rejects real postpositions that were never added.
const ALIAS_NOUN_CONTINUATIONS = ['기능', '기판', '능', '판'];

// Time and discourse adverbs sit in front of the part. They are not qualifiers
// the way 전압 and USB are. "현재" is also a particle word.
const ALIAS_LEAD_ADVERBS = new Set(['지금', '현재', '원래']);

function isAliasLeadSeparator(ch) {
  return /[()（）[\]{}<>「」『』·•・/\\|&~～:：;；=+，,]/u.test(ch ?? '');
}

function koreanAliasTailOk(text, end) {
  let index = end;
  while (index < text.length && /\s/u.test(text[index])) index += 1;
  const rest = text.slice(index);
  if (!rest || !isHangulChar(rest[0])) return true;
  return !ALIAS_NOUN_CONTINUATIONS.some((noun) => rest.startsWith(noun));
}

function aliasPredecessor(word) {
  const raw = String(word ?? '').replace(/^[("'`,.:;!?[\]{}]+|[)"'`,.:;!?[\]{}]+$/gu, '');
  if (!raw) return true;
  const key = lower(raw);
  if (ALIAS_LEAD_ADVERBS.has(raw) || ALIAS_LEAD_ADVERBS.has(key)) return true;
  if (isLedAllowWord(raw) || isLedAllowWord(key)) return true;
  if (isFunctionWord(raw) || isModalOrParticleWord(raw) || isDemonstrativeWord(raw)) return true;
  if (isNegationOrAlternativeWord(raw) || isEditVerbWord(raw) || isKoreanRequestStem(raw)) return true;
  if (/^[A-Za-z]{1,3}\d+$/u.test(raw)) return true;
  return false;
}

// The word that touches the alias. ( · / and the same family are separators,
// so "R4(전류 제한기)" and "R4/전류 제한기" still see R4. A ref plus Hangul is
// that ref with an ending ("R4나") unless the Hangul is itself a qualifier
// ("전압") or a role ("풀업").
function aliasLeadWord(text, start) {
  const head = String(text ?? '').slice(0, start);
  let index = head.length;
  while (index > 0 && /\s/u.test(head[index - 1])) index -= 1;
  while (index > 0 && isAliasLeadSeparator(head[index - 1])) index -= 1;
  if (index <= 0) return '';
  const wordEnd = index;
  while (index > 0 && !/\s/u.test(head[index - 1]) && !isAliasLeadSeparator(head[index - 1])) index -= 1;
  return head.slice(index, wordEnd);
}

function hangulOnDesignatorIsQualifier(hangul) {
  if (hangul === '전압') return true;
  return KOREAN_ROLES.some((role) => hangul.includes(role));
}

function designatorLeadStem(word) {
  const match = /^([A-Za-z]{1,3}\d+)([가-힣]+)$/u.exec(word);
  if (!match) return word;
  if (hangulOnDesignatorIsQualifier(match[2])) return word;
  return match[1];
}

function precedingQualifierBlocks(text, start) {
  const raw = designatorLeadStem(aliasLeadWord(text, start));
  if (!raw) return false;
  if (aliasPredecessor(raw)) return false;
  for (const particle of koreanAliasTailParticles()) {
    if (raw.endsWith(particle) && raw.length > particle.length) {
      return !aliasPredecessor(designatorLeadStem(raw.slice(0, -particle.length)));
    }
  }
  return true;
}

function koreanAliasBounded(text, start, end) {
  const before = text[start - 1] ?? '';
  if (isHangulChar(before) || isAsciiWordChar(before)) return false;
  if (!koreanAliasTailOk(text, end)) return false;
  return !precedingQualifierBlocks(text, start);
}

function koreanAliasHits(text, item) {
  const re = item.koreanRe;
  if (!re) return false;
  re.lastIndex = 0;
  for (const match of text.matchAll(re)) {
    const at = match.index ?? 0;
    if (koreanAliasBounded(text, at, at + match[0].length)) return true;
  }
  return false;
}

function matcherHits(item, joined) {
  if (item.ascii) return item.re.test(joined);
  return koreanAliasHits(joined, item);
}

function stripYong(word) {
  const key = lower(word);
  return key.length > 1 && key.endsWith('용') ? key.slice(0, -1) : key;
}

function synonymMatchers(ledRef) {
  const extra = ledRefSynonymMatchers(ledRef);
  return extra.length === 0 ? LED_RESISTOR_SYNONYM_MATCHERS : LED_RESISTOR_SYNONYM_MATCHERS.concat(extra);
}

export function textHasLedResistorSynonym(text, ledRef = null) {
  const joined = synonymFold(text);
  return synonymMatchers(ledRef).some((item) => matcherHits(item, joined));
}

// 저항, 저항기, or R anywhere in the same noun phrase: after the modifier and
// before the 은/는/을/를 that ends the keep ("직렬로 연결된 저항은", "직렬 R은").
// Another noun there ("직렬 연결은", "전류 제한 설정은") does not count.
// "하는" also ends in 는, so the particle is the last word-final one.
function keepPhraseBeforeParticle(text) {
  let end = text.length;
  for (let index = text.length - 1; index >= 0; index -= 1) {
    const ch = text[index];
    if (ch !== '은' && ch !== '는' && ch !== '을' && ch !== '를') continue;
    const next = text[index + 1] ?? '';
    if (next && isHangulChar(next)) continue;
    end = index;
    break;
  }
  return text.slice(0, end);
}

function phraseHasResistorNoun(phrase) {
  if (phrase.includes('저항기') || phrase.includes('저항')) return true;
  return /(?:^|[^A-Za-z0-9])[Rr](?![A-Za-z0-9])/u.test(phrase);
}

function resistorNounFollowsAlias(text, end) {
  return phraseHasResistorNoun(keepPhraseBeforeParticle(text.slice(end)));
}

function koreanModifierFollowedByResistor(text, item) {
  const re = item.koreanRe;
  if (!re) return false;
  re.lastIndex = 0;
  for (const match of text.matchAll(re)) {
    const at = match.index ?? 0;
    const end = at + match[0].length;
    if (!koreanAliasBounded(text, at, end)) continue;
    if (resistorNounFollowsAlias(text, end)) return true;
  }
  return false;
}

// Korean noun rows name the LED resistor. A modifier row ("직렬", "전류 제한")
// does when 저항, 저항기, or R sits in that noun phrase, before the topic or
// object particle. English modifiers stay off this path.
export function textHasKoreanLedResistorAlias(text) {
  const joined = synonymFold(text);
  return LED_RESISTOR_SYNONYM_MATCHERS.some((item) => {
    if (item.ascii) return false;
    if (item.noun) return matcherHits(item, joined);
    return koreanModifierFollowedByResistor(joined, item);
  });
}

// "current limiter" and "the series one" name the series resistor with no
// resistor noun. "current limit" and "series" stay modifiers. A Korean 용 row
// is a modifier too, so it does not count here even when the bare-name words
// would otherwise match ("전류 제한용").
export function textHasBareLedResistorName(text) {
  const joined = synonymFold(text);
  return LED_RESISTOR_SYNONYM_MATCHERS.some((item) => (
    synonymIsBareName(item.folded)
    && (item.ascii || item.noun)
    && matcherHits(item, joined)
  ));
}

function ledRefReplacement(template) {
  return template.includes('저항') ? 'LED 저항' : 'the LED resistor';
}

// The {led} rows of LED_RESISTOR_SYNONYMS, written as the canonical LED phrase
// so target and keep classification read one set.
export function expandLedRefResistorAliases(text, ledRef) {
  const ref = ledRefToken(ledRef);
  const raw = String(text ?? '');
  if (!ref) return raw;
  const templates = LED_REF_SYNONYM_TEMPLATES.slice().sort((left, right) => right.length - left.length);
  let next = raw;
  for (const template of templates) {
    const source = template.replaceAll('{led}', ref);
    let body = escapeSynonymBody(source).replace(/'/g, "['’]");
    if (template.includes('저항')) body = body.replace('\\s+', '\\s*');
    next = next.replace(new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, 'giu'), ledRefReplacement(template));
  }
  return next;
}

// "the series one" puts the article and "one" on the synonym word list.
// They are glue, not fragments. Counting them rejects a plain edit that also
// names a current or a voltage ("set the LED resistor to 680Ω for 20mA").
function excludedSynonymFragment(word) {
  const key = lower(word);
  if (key === 'one') return true;
  return FUNCTION_WORDS.has(key) && (key === 'a' || key === 'an' || key === 'the');
}

// A token of the shared set, including "limit" inside "current-limit" and "제한용".
export function isLedResistorSynonymPiece(word) {
  if (excludedSynonymFragment(word)) return false;
  const key = lower(word);
  const stripped = stripYong(key);
  const folded = synonymFold(stripped);
  const packed = synonymCompact(key);
  const strippedPacked = synonymCompact(stripped);
  return LED_RESISTOR_SYNONYM_MATCHERS.some((item) => (
    item.words.includes(folded)
    || item.folded === synonymFold(key)
    || item.packed === packed
    || item.packed === strippedPacked
  ));
}

function modifierFitsSynonym(word, item) {
  const bits = synonymFold(stripYong(word)).split(' ').filter(Boolean);
  if (bits.length === 0) return false;
  return bits.every((bit) => item.words.includes(bit) || isLedAllowWord(bit));
}

// Modifiers name the LED series resistor when they are one phrase from
// LED_RESISTOR_SYNONYMS. "current sense" stays a shunt. Extra words that are
// not part of that phrase and not LED allow-words refuse the phrase.
function synonymHeadWords(item) {
  return item.words.filter((word) => !RESISTOR_NOUNS.has(word) && !FUNCTION_WORDS.has(word));
}

export function matchesLedResistorModifiers(content) {
  const words = Array.isArray(content) ? content.map((word) => lower(word)).filter(Boolean) : [];
  if (words.length === 0) return false;
  if (words.some((word) => isShuntSenseWord(word))) return false;
  const joined = synonymFold(words.join(' '));
  return LED_RESISTOR_SYNONYM_MATCHERS.some((item) => {
    const hit = matcherHits(item, joined);
    if (hit && words.every((word) => modifierFitsSynonym(word, item))) return true;
    // "indicator resistor" is the phrase. The noun is separate, so the head
    // "indicator" is the modifier in front of 저항/resistor.
    const heads = synonymHeadWords(item);
    if (heads.length === 0 || heads.length !== words.length) return false;
    if (!heads.every((word, index) => word === synonymFold(words[index]))) return false;
    return words.every((word) => modifierFitsSynonym(word, item));
  });
}

export function specRoleNamesResistor(role) {
  return rx("resistor|pull-?up|pull-?down|pulldown|pullup", "i").test(String(role ?? ''));
}

export function libIdNamesResistor(libId) {
  return rx("PULLUP|PULLDOWN|RESISTOR", "i").test(String(libId ?? ''));
}

// "to 680Ω instead of 1k" names 680. The value after "instead of" is the old one.
export function isReplacedSourceValue(text, index) {
  return rx("\\binstead\\s+of\\s*$", "i").test(String(text ?? '').slice(0, index));
}

export function vocabularyAllowLists() {
  return {
    ledWords: LED_WORDS,
    resistorNouns: RESISTOR_NOUNS,
    functionWords: FUNCTION_WORDS,
    editVerbs: EDIT_VERBS,
    modalWords: MODAL_WORDS,
    particleWords: PARTICLE_WORDS,
    demonstratives: DEMONSTRATIVES,
    englishRoles: ENGLISH_ROLES,
    koreanRoles: KOREAN_ROLES,
    unboundNouns: UNBOUND_NOUNS,
    lengthEn: LENGTH_EN,
    lengthKo: LENGTH_KO,
    noiseWords: NOISE_WORDS,
    nonresObjects: NONRES_OBJECTS,
    keepCues: KEEP_CUES,
    ledResistorSynonyms: LED_RESISTOR_SYNONYMS,
    adviceKo: ADVICE_KO,
    adviceEn: ADVICE_EN,
    permitPhrases: PERMIT_PHRASES,
    counterWords: COUNTER_WORDS,
    counterLeadWords: COUNTER_LEAD_WORDS,
    politeIfPhrases: POLITE_IF_PHRASES,
    asidePhrases: ASIDE_PHRASES.map((phrase) => phrase.source)
  };
}

const COUNTER_WORDS = [
  '년형', '개만', 'pieces', 'piece', 'models', 'model', 'years', 'year', 'times', 'time',
  'pins', 'pin', 'khz', 'mhz', 'ghz', 'pcs', 'leds', 'led',
  'nf', 'uf', 'µf', 'μf', 'pf', 'mf', 'uh', 'µh', 'μh', 'mh', 'nh',
  'ma', 'ua', 'µa', 'μa', 'mw', 'kv', 'mv', 'hz',
  '포트', '만', '천', '억', 'rev', '개', '년', '형', '핀', '번', 'ea', 'pc'
];

const COUNTER_LEAD_WORDS = new Set([
  'pin', 'pins', 'gpio', 'gpios', 'port', 'ports', 'rev', 'revision', 'revisions',
  'model', 'models', 'year', 'years', '핀', '포트'
]);

function lower(word) {
  return String(word ?? '').toLowerCase();
}

function isHangulChar(ch) {
  if (!ch) return false;
  const code = ch.codePointAt(0);
  return code >= 0xAC00 && code <= 0xD7A3;
}

function hasStandalone(text, word) {
  let from = 0;
  while (from <= text.length) {
    const at = text.indexOf(word, from);
    if (at < 0) return false;
    const before = text[at - 1] ?? '';
    const after = text[at + word.length] ?? '';
    if (!isHangulChar(before) && !isHangulChar(after)) return true;
    from = at + word.length;
  }
  return false;
}

export function isLedAllowWord(word) {
  const key = lower(word);
  return LED_WORDS.has(key) || RESISTOR_NOUNS.has(key);
}

export function isFunctionWord(word) {
  return FUNCTION_WORDS.has(lower(word));
}

export function isEditVerbWord(word) {
  return EDIT_VERBS.has(lower(word));
}

export function isDemonstrativeWord(word) {
  return DEMONSTRATIVES.has(lower(word)) || DEMONSTRATIVES.has(word);
}

export function isModalOrParticleWord(word) {
  const key = lower(word);
  return MODAL_WORDS.has(key) || PARTICLE_WORDS.has(word) || PARTICLE_WORDS.has(key);
}

function englishRoleToken(token) {
  if (ENGLISH_ROLES.has(token)) return true;
  return rx("^cc\\d*$").test(token);
}

export function isKnownRoleWord(word) {
  const raw = String(word ?? '');
  const key = lower(raw).replace(rx("[-\\s]+", "g"), '');
  if (ENGLISH_ROLES.has(lower(raw)) || ENGLISH_ROLES.has(key)) return true;
  if (rx("^cc\\d*$", "i").test(raw)) return true;
  return KOREAN_ROLES.some((role) => raw.includes(role));
}

export function textHasKnownRole(text) {
  const raw = String(text ?? '');
  if (KOREAN_ROLES.some((role) => raw.includes(role))) return true;
  const tokens = lower(raw).split(rx("[^a-z0-9+]+")).filter(Boolean);
  for (let index = 0; index < tokens.length; index += 1) {
    if (englishRoleToken(tokens[index])) return true;
    if (tokens[index] === 'pull' && rx("^(?:up|ups|down|downs)$").test(tokens[index + 1] ?? '')) return true;
    if (tokens[index] === 'current' && tokens[index + 1] === 'sense') return true;
  }
  return false;
}

export function textHasUsbRole(text) {
  const raw = String(text ?? '');
  const upper = raw.toUpperCase();
  let from = 0;
  while (from < upper.length) {
    const at = upper.indexOf('USB', from);
    if (at < 0) return false;
    const beforeOk = at === 0 || !rx("[A-Za-z]").test(raw[at - 1]);
    const after = raw[at + 3] ?? '';
    if (beforeOk && after !== '-') return true;
    from = at + 3;
  }
  return false;
}

export function textHasForeignMilliRole(text) {
  return textHasKnownRole(text);
}

export function isLengthObjectWord(word) {
  const raw = String(word ?? '');
  if (LENGTH_EN.has(lower(raw))) return true;
  if (LENGTH_KO.some((item) => raw.includes(item))) return true;
  return raw === '선';
}

export function textHasLengthObject(text) {
  const raw = String(text ?? '');
  if (LENGTH_KO.some((word) => raw.includes(word))) return true;
  if (hasStandalone(raw, '선')) return true;
  const tokens = lower(raw).split(rx("[^a-z]+")).filter(Boolean);
  return tokens.some((token) => LENGTH_EN.has(token));
}

export function isUnboundMeasureNoun(word) {
  const raw = String(word ?? '').replace(rx("용$", "u"), '');
  return UNBOUND_NOUNS.has(lower(raw)) || UNBOUND_NOUNS.has(raw);
}

export function isUnboundMeasureAfter(after) {
  const match = rx("^\\s*(\\S+)", "u").exec(String(after ?? ''));
  if (!match) return false;
  const word = match[1].replace(rx("^[(\"'`[]+|[)\\]\"'`,.:;?？]+$", "gu"), '');
  return isUnboundMeasureNoun(word);
}

export function isCounterFollow(after) {
  const text = String(after ?? '').trimStart();
  if (!text) return false;
  const folded = text.toLowerCase();
  for (const word of COUNTER_WORDS) {
    if (!folded.startsWith(word)) continue;
    const next = text[word.length] ?? '';
    if (!rx("[A-Za-z0-9]").test(next)) return true;
  }
  const head = text[0];
  if ('VvAaWw%×xX'.includes(head) && !rx("[A-Za-z0-9]").test(text[1] ?? '')) return true;
  return false;
}

export function isCounterLead(before) {
  const text = String(before ?? '').trimEnd();
  if (!text) return false;
  const match = rx("(\\S+)\\s*$", "u").exec(text);
  if (!match) return false;
  const word = lower(match[1]).replace(rx("[^a-z0-9가-힣]", "gi"), '');
  if (COUNTER_LEAD_WORDS.has(word) || word === '핀' || word === '포트') return true;
  return word === 'revision' || word === 'revisions';
}

export function isAdviceQuestion(text) {
  const raw = String(text ?? '');
  const folded = raw.toLowerCase();
  if (rx("\\bshould\\s+i\\b", "i").test(folded)) return true;
  if (ADVICE_KO.some((word) => raw.includes(word))) return true;
  const tokens = folded.split(rx("[^a-z]+")).filter(Boolean);
  return tokens.some((token) => ADVICE_EN.has(token));
}

export function isPermittedEdit(text) {
  const folded = String(text ?? '').toLowerCase();
  if (PERMIT_PHRASES.some((phrase) => folded.includes(phrase))) return true;
  if (!folded.includes('please')) return false;
  return rx("\\b(?:change|set|make|use|update|replace)\\b|바꿔|변경|수정").test(folded);
}

// "470~680Ω" and "1k~680Ω" name two values. The unit may sit only on the last
// number. A leading "~680Ω" stays an approximation.
const VALUE_RANGE_SOURCE = String.raw`\d+(?:\.\d+)?\s*[kKmMrR]?(?:\s*(?:Ω|옴|ohms?))?\s*[~∼〜]\s*\d+(?:\.\d+)?\s*(?:[kKmMrR](?:\s*(?:Ω|옴|ohms?))?|Ω|옴|ohms?)`;

// 약/대략/대충 inside an adjective -거나 hedge are the predicate ("약하거나
// 해서"), not the free adverb in "약 680Ω". The hedge span is blanked only
// for that adverb. A tilde, 정도, or "about" elsewhere still approximates.
function blankGeonaHedges(text) {
  const raw = String(text ?? '');
  const spans = geonaHedgeSpans(raw).slice().sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  if (spans.length === 0) return raw;
  let out = '';
  let cursor = 0;
  for (const [from, to] of spans) {
    const start = Math.max(from, cursor);
    if (to <= start) continue;
    out += raw.slice(cursor, start);
    out += ' '.repeat(to - start);
    cursor = to;
  }
  return out + raw.slice(cursor);
}

export function textHasApproximation(text) {
  const raw = String(text ?? '');
  const withoutRanges = raw.replace(rx(VALUE_RANGE_SOURCE, 'giu'), ' ');
  const withoutHedge = blankGeonaHedges(raw);
  if (rx("[~∼〜]").test(withoutRanges) || rx("(?:^|[\\s\\d])(?:약|대략|대충)", "u").test(withoutHedge)) return true;
  if (rx("(?:정도|쯤|가량|내외)", "u").test(raw)) return true;
  return rx("\\b(?:about|around|approximately|approx|roughly)\\b|-ish\\b", "i").test(raw);
}

// The tilde in "470~680Ω" is the range, not "about 680Ω".
export function tildeJoinsResistorRange(before, raw) {
  const head = rx("\\d(?:\\.\\d+)?\\s*[kKmMrR]?(?:\\s*(?:Ω|옴|ohms?))?\\s*[~∼〜]\\s*$", "iu");
  const tail = rx("^\\d+(?:\\.\\d+)?\\s*(?:[kKmMrR](?:\\s*(?:Ω|옴|ohms?))?|Ω|옴|ohms?)", "iu");
  return head.test(String(before ?? '')) && tail.test(String(raw ?? '').trim());
}

export function approximateBefore(before) {
  const raw = String(before ?? '');
  if (rx("(?:~|∼|〜)\\s*$").test(raw)) return true;
  if (rx("(?:^|[\\s\\d])(?:약|대략|대충)\\s*$", "u").test(raw)) return true;
  return rx("\\b(?:about|around|approximately|approx|roughly)\\s*$", "i").test(raw);
}

export function approximateAfter(after) {
  const raw = String(after ?? '');
  if (rx("^\\s*(?:정도|쯤|가량|내외)", "u").test(raw)) return true;
  return rx("^\\s*-ish\\b", "i").test(raw);
}

// One digit after k/K, R/r, or uppercase M is RKM. Two or more are not.
// Lowercase m is milli (4m7, 2m2), not this rule. 4k7 and 2M2 stay. 4k75 and 2M20 do not.
export function isRejectedUppercaseRkm(text) {
  const raw = String(text ?? '').trim().normalize('NFKC').replace(rx("(?:\\s*(?:Ω|옴|ohms?))$", "iu"), '').trim();
  const match = rx("^(\\d+)([rRkKmM])(\\d+)$").exec(raw);
  if (!match || match[2] === 'm') return false;
  return match[3].length !== 1;
}

// One separator between an RKM multiplier (k/K, R/r, uppercase M) and a digit.
// Space may repeat. Also ".", ",", "-", en dash, em dash, "/", "_", and "·".
// "4k 7", "4k.7", "4k,7", "4k-7", "4k/7", "4k_7", "1R-5", "2M-2".
// "4k7" has no separator. "4k 5%" is a tolerance. "1k-2k" keeps the second multiplier.
export const RKM_FRACTION_SEPARATOR = String.raw`[.,\u2013\u2014/_\u00B7\s\-]+`;

// A bare digit after the multiplier ("4k 7", "4k.7", "1R-5", "2M-2") is the same refusal.
// "4k 5%" is not: the percent token is not a bare digit.
export function hasMalformedRkm(text) {
  return rx(`(?:^|[^\\d.])(?:\\d+[kKrR]\\d{2,}|\\d+M\\d{2,}|\\d+(?:\\.\\d+)?\\s*[kKrRM]${RKM_FRACTION_SEPARATOR}\\d+(?![\\d%kKrRM]))(?!\\d)`).test(String(text ?? ''));
}

function pushBreak(breaks, start, end) {
  if (end > start) breaks.push([start, end]);
}

const KEEP_LIST_CLAUSE_SEPS = new Set([' and ', ' & ', '하고', '이랑', '이고']);

function separatorInsideKeepList(objects, start, end) {
  return objects.some((object) => start >= object.start && end < object.end);
}

function allowClausePieces(text) {
  const breaks = [];
  const keepObjects = keepClauseSpans(text).objects;
  const lowerText = text.toLowerCase();
  for (const sep of [' and then ', ' and ', ' & ', ' then ']) {
    let from = 0;
    while (from < lowerText.length) {
      const at = lowerText.indexOf(sep, from);
      if (at < 0) break;
      const insideList = KEEP_LIST_CLAUSE_SEPS.has(sep) && separatorInsideKeepList(keepObjects, at, at + sep.length);
      if (!insideList) pushBreak(breaks, at, at + sep.length);
      from = at + sep.length;
    }
  }
  for (const sep of ['바꾸고', '그리고', '하면서', '하고', '이고', '이랑', '면서', '지만', '말고']) {
    let from = 0;
    while (from < text.length) {
      const at = text.indexOf(sep, from);
      if (at < 0) break;
      const insideList = KEEP_LIST_CLAUSE_SEPS.has(sep) && separatorInsideKeepList(keepObjects, at, at + sep.length);
      // "밝거나 하고" is the -거나 하- hedge. That 하고 does not start a clause.
      const hedgeHada = sep === '하고' && geonaHedgeHadaAt(text, at);
      if (!insideList && !hedgeHada) pushBreak(breaks, at, at + sep.length);
      from = at + sep.length;
    }
  }
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (ch === ',' || ch === '，' || ch === '.') {
      const prev = text[index - 1] ?? '';
      const next = text[index + 1] ?? '';
      if (rx("\\d").test(prev) && rx("\\d").test(next)) continue;
      pushBreak(breaks, index, index + 1);
    } else if (';!?？！。\n•·'.includes(ch)) {
      pushBreak(breaks, index, index + 1);
    }
  }
  breaks.sort((left, right) => left[0] - right[0] || right[1] - left[1]);
  const kept = [];
  let cursor = 0;
  for (const span of breaks) {
    if (span[0] < cursor) continue;
    kept.push(span);
    cursor = span[1];
  }
  const pieces = [];
  let start = 0;
  for (const span of kept) {
    const raw = text.slice(start, span[0]);
    if (raw.trim().length > 0) {
      pieces.push({ text: raw.trim(), start, end: span[0], sepEnd: span[1] });
    }
    start = span[1];
  }
  const tail = text.slice(start);
  if (tail.trim().length > 0) {
    pieces.push({ text: tail.trim(), start, end: text.length, sepEnd: text.length });
  }
  return pieces;
}

function splitAllowClauses(text) {
  return allowClausePieces(text).map((piece) => piece.text);
}

export function clauseAround(text, start, end) {
  const raw = String(text ?? '');
  const marks = [];
  const lowerText = raw.toLowerCase();
  for (const sep of [' and ', ' 그리고']) {
    const needle = sep.trim();
    let from = 0;
    while (from < lowerText.length) {
      const at = lowerText.indexOf(needle, from);
      if (at < 0) break;
      const before = raw[at - 1] ?? ' ';
      const after = raw[at + needle.length] ?? ' ';
      if ((before === ' ' || before === '\n') && (after === ' ' || after === '\n' || after === ',' || after === '.')) marks.push(at);
      from = at + needle.length;
    }
  }
  for (let index = 0; index < raw.length; index += 1) {
    const ch = raw[index];
    if (ch === '，') marks.push(index);
    if (ch === ',') {
      const prev = raw[index - 1] ?? '';
      const next = raw[index + 1] ?? '';
      if (!(rx("\\d").test(prev) && rx("\\d").test(next))) marks.push(index);
    }
  }
  let from = 0;
  let to = raw.length;
  for (const at of marks.sort((left, right) => left - right)) {
    if (at + 1 <= start) from = Math.max(from, at + 1);
    else if (at >= end && at < to) to = at;
  }
  return raw.slice(from, to);
}

const PARTICLE_SUFFIXES = ['이랑', '으로', '에서', '에게', '은', '는', '을', '를', '과', '와', '의', '도', '만', '랑', '요', '에', '로', '값'];

function stripParticle(word) {
  let text = String(word ?? '');
  if (!text || KEEP_FILLER_TEXTS.some((cue) => text.includes(cue))) return text;
  // "또는" and "혹은" end in a particle character. They stay alternative signals.
  if (isNegationOrAlternativeWord(text)) return text;
  // "주세요" is a whole particle. Stripping 요 would leave the unknown "주세".
  if (PARTICLE_WORDS.has(text) || PARTICLE_WORDS.has(lower(text))) return text;
  for (const particle of PARTICLE_SUFFIXES) {
    if (text.endsWith(particle) && text.length > particle.length) {
      text = text.slice(0, -particle.length);
      break;
    }
  }
  if (text.length > 1 && text.endsWith('들')) {
    const bare = text.slice(0, -1);
    if (['led', 'leds', '엘이디', '엘예디'].includes(bare.toLowerCase())) text = bare;
  }
  return text;
}

function clauseWords(clause) {
  const words = [];
  for (const match of String(clause ?? '').matchAll(rx("\\S+", "gu"))) {
    // "R3(현재" is the reference plus the current-value marker, not one unknown word.
    for (const bit of match[0].split(rx("[()（）]+", "u"))) {
      const cleaned = stripParticle(bit.replace(rx("^[(\"'`[•·±<>→⇒~∼〜=]+|[)\\]\"'`,.:;?？!！<>→⇒~∼〜=]+$", "gu"), ''));
      // "->" loses the ">", leaving "-". A bare arrow or "=" is not a content word.
      if (!cleaned || rx("^[-–—<>→⇒~∼〜.=]+$", "u").test(cleaned)) continue;
      words.push(cleaned);
    }
  }
  return words;
}

function hasKeepCue(clause) {
  const raw = String(clause ?? '');
  const folded = raw.toLowerCase();
  const source = englishSignalWordSource();
  if (source && rx(source, 'i').test(folded)) return true;
  return KEEP_SIGNAL_TEXTS.some((cue) => raw.includes(cue));
}

function isNegatedKeep(clause) {
  const raw = String(clause ?? '');
  // "두지 말고" splits on 말고, so the left piece ends at 두지 or 하지.
  if (rx("(?:두지|하지)\\s*(?:말|마|않)", "u").test(raw)) return true;
  if (rx("(?:두지|하지)\\s*$", "u").test(raw)) return true;
  return rx("(?:n't|\\b(?:not|never|dont|don't)\\b)[^.]*\\bkeep\\b", "i").test(raw);
}

export function isDontDeleteClause(clause) {
  const raw = String(clause ?? '');
  // "버리지 말고" / "제거 말고" split on 말고, so the left piece keeps the verb.
  if (rx("삭제\\s*하지\\s*마|삭제하지\\s*마|지우지\\s*마|버리지|없애지|빼지").test(raw)) return true;
  if (rx("제거|삭제|없애|버리").test(raw) && rx("말|마|않|금지|안").test(raw)) return true;
  // "제거 말고" splits on 말고, leaving "I2C 제거". I2C contains a digit, so a value check cannot use \d.
  if (rx("(?:제거|삭제)\\s*$").test(raw.trim())) return true;
  if (rx("\\b(?:don't|do not|dont|shouldn't|should not)\\s+(?:remove|delete)\\b", "i").test(raw)) return true;
  if (rx("\\bwithout\\s+removing\\b", "i").test(raw)) return true;
  return false;
}

function isDontDelete(clause) {
  return isDontDeleteClause(clause);
}

function mentionsResistor(text) {
  return rx("저항|抵抗|\\bresistor\\b|\\bleds?\\b|엘이디|엘예디|발광|전류\\s*제한|current[-\\s]+limiting", "iu").test(text);
}

function explicitTarget(text) {
  return rx("저항|抵抗|\\bresistor\\b|\\bleds?\\b|엘이디|엘예디|발광|\\bR\\d+\\b", "iu").test(text);
}

function pronounTarget(text) {
  if (explicitTarget(text)) return false;
  return rx("\\bit\\b|그거|그것", "iu").test(text);
}

const OHM_TOKEN = rx("(\\d+[rRkKmM]\\d+|\\d+(?:\\.\\d+)?\\s*meg(?![A-Za-z])|\\d+(?:\\.\\d+)?\\s*(?:Ω|옴|ohms?)|\\d+(?:\\.\\d+)?\\s*[kKmMrR](?![A-Za-z]))", "giu");
const LENGTH_UNIT = rx("(\\d+(?:\\.\\d+)?\\s*(?:cm|mm|km|ft|in)|\\d+(?:\\.\\d+)?\\s*m(?![A-Za-z]))", "iu");

function ohmTokens(clause) {
  return [...String(clause ?? '').matchAll(OHM_TOKEN)].map((match) => ({
    raw: match[0],
    index: match.index ?? 0
  }));
}

function tokenIsUnbound(clause, token) {
  const after = clause.slice(token.index + token.raw.length);
  const before = clause.slice(0, token.index);
  if (isUnboundMeasureAfter(after)) return true;
  if (rx("(?:\\brevs?\\b|\\bversions?\\b|\\bmodels?\\b|리비전|버전|모델)\\s*$", "iu").test(before)) return true;
  return false;
}

function boundOhmTokens(clause) {
  return ohmTokens(clause).filter((token) => !tokenIsUnbound(clause, token) && !isRejectedUppercaseRkm(token.raw));
}

// "(현재 330Ω)" names the value already on the board. It is not a second edit.
function parentheticalCurrentSpans(text) {
  const spans = [];
  for (const match of String(text ?? '').matchAll(rx("\\(([^)]*)\\)|（([^）]*)）", "gu"))) {
    const inner = match[1] ?? match[2] ?? '';
    if (rx("(?:현재|기존|currently|existing|current\\s+value|\\bnow\\b)", "iu").test(inner)) {
      spans.push([match.index, match.index + match[0].length]);
    }
  }
  return spans;
}

// "4k7" and "4.7k" are one resistance. A choice needs two different ohms.
function ohmNumber(whole, fraction, multiplier) {
  const scale = 10 ** fraction.length;
  return (Number(whole) * scale + Number(fraction || 0)) * multiplier / scale;
}

function ohmKey(raw) {
  let text = String(raw ?? '').trim().normalize('NFKC').replace(rx("(?:\\s*(?:Ω|옴|ohms?))$", "iu"), '').trim();
  if (!text) return null;
  const rkm = rx("^(\\d+)([rRkK])(\\d)$").exec(text) || rx("^(\\d+)(M)(\\d)$").exec(text);
  let ohms;
  if (rkm) {
    const letter = rkm[2];
    const multiplier = letter === 'M' ? 1e6 : letter.toLowerCase() === 'k' ? 1e3 : 1;
    ohms = ohmNumber(rkm[1], rkm[3], multiplier);
  } else {
    const suffixed = rx("^(\\d+(?:\\.\\d+)?)(?:\\s*(meg|MEG|Meg|[kKrR]|M))?$").exec(text);
    if (!suffixed) return null;
    const suffix = suffixed[2] ?? '';
    const multiplier = suffix === 'meg' || suffix === 'MEG' || suffix === 'Meg' || suffix === 'M'
      ? 1e6
      : suffix.toLowerCase() === 'k'
        ? 1e3
        : (suffix === '' || suffix.toLowerCase() === 'r')
          ? 1
          : null;
    if (multiplier == null) return null;
    const [whole, fraction = ''] = suffixed[1].split('.');
    ohms = ohmNumber(whole, fraction, multiplier);
  }
  if (!Number.isFinite(ohms) || ohms <= 0) return null;
  const rounded = Math.round(ohms);
  if (Math.abs(ohms - rounded) <= 1e-9 * Math.max(1, Math.abs(ohms))) return String(rounded);
  return Number(ohms.toPrecision(12)).toFixed(12).replace(/0+$/, '').replace(/\.$/, '');
}

function sameOhmTokens(tokens) {
  if (tokens.length < 2) return false;
  const keys = tokens.map((token) => ohmKey(token.raw));
  if (keys.some((key) => key == null)) return false;
  return keys.every((key) => key === keys[0]);
}

// "from 330Ω to 680Ω" and "330옴에서 680옴으로" name the destination once.
// A second value with no transition marker stays a second value.
// "4k7 and 4.7k" is one value written twice.
// A valued keep owns its ohms. That token is not a second edit value, so
// "set the LED resistor to 680Ω but keep R4 at 4.7k" still has one bound value.
function valuedResistorKeepRanges(text) {
  const raw = String(text ?? '');
  return keepClauseSpans(raw).objects
    .filter((object) => object.valued === true)
    .filter((object) => !/커패시터|콘덴서|캐패시터|capacitor|\bcaps?\b|케이블|cable|connector|커넥터/iu.test(raw.slice(object.start, object.end)))
    .map((object) => [object.start, object.end]);
}

function logicalBoundTokens(text) {
  const hidden = valuedResistorKeepRanges(text);
  const tokens = boundOhmTokens(text).filter((token) => (
    !isReplacedSourceValue(text, token.index)
    && !hidden.some(([start, end]) => token.index >= start && token.index < end)
  ));
  if (tokens.length <= 1) return tokens;
  if (rx("(?:\\bfrom\\b|\\bto\\b|에서|->|→)", "iu").test(text)) return [tokens[tokens.length - 1]];
  const spans = parentheticalCurrentSpans(text);
  if (spans.length > 0) {
    const outside = tokens.filter((token) => !spans.some(([start, end]) => token.index >= start && token.index < end));
    if (outside.length === 1 && outside.length < tokens.length) return outside;
  }
  if (sameOhmTokens(tokens)) return [tokens[tokens.length - 1]];
  return tokens;
}

function isLengthClause(clause) {
  if (!textHasLengthObject(clause) && !LENGTH_EN.has(lower(clause))) return false;
  return LENGTH_UNIT.test(clause) || textHasLengthObject(clause) && rx("\\d").test(clause);
}

function isNonResistorRef(word) {
  return rx("^[A-Za-z]{1,3}\\d+$").test(word) && !rx("^R\\d+$", "i").test(word);
}

// A keep, don't-delete, or don't-touch whose object is bare I2C names either
// the connector or the pull-ups. That object is not a resistor keep.
function preserveAfterMatches(text) {
  const re = rx("\\bwithout\\s+removing\\b|\\bdo\\s+not\\s+(?:remove|delete|touch)\\b|\\bdon't\\s+(?:remove|delete|touch)\\b|\\bdont\\s+(?:remove|delete|touch)\\b|\\bnever\\s+touch\\b|\\bkeep\\b|\\bleave\\b", "gi");
  return [...String(text ?? '').matchAll(re)];
}

function preserveBeforeMatches(text) {
  const re = rx("놔\\s*두고|그대로|지우지|삭제\\s*하지|건드리지|유지하고|빼고|남겨|남기|두고|유지|제거", "g");
  return [...String(text ?? '').matchAll(re)];
}

function bareWord(word) {
  return String(word ?? '').replace(rx("^[\"'`.,;:!?()\\[\\]<>→⇒~∼〜=]+|[\"'`.,;:!?()\\[\\]<>→⇒~∼〜=]+$", "gu"), '');
}

function objectAfter(text, from) {
  const words = [...String(text ?? '').slice(from).matchAll(rx("\\S+", "gu"))];
  const kept = [];
  const stop = rx("^(?:alone|unchanged|please|and|then|set|change|make|update)$", "i");
  for (const word of words) {
    if (kept.length >= 6) break;
    const bare = bareWord(word[0]);
    if (!bare) continue;
    if (rx("^\\d").test(bare) || stop.test(bare)) break;
    kept.push(bare);
  }
  return kept.join(' ');
}

function objectBefore(text, cueStart) {
  const words = [...String(text ?? '').slice(0, cueStart).matchAll(rx("\\S+", "gu"))];
  const kept = [];
  const stop = rx("^(?:set|change|make|update)$", "i");
  for (let index = words.length - 1; index >= 0 && kept.length < 6; index -= 1) {
    const bare = bareWord(words[index][0]);
    if (!bare) continue;
    if (rx("^\\d").test(bare) || rx("[Ω옴]").test(bare) || isKoreanRequestStem(bare) || stop.test(bare)) break;
    kept.push(bare);
  }
  return kept.reverse().join(' ');
}

function objectNamesBareI2c(object) {
  const raw = String(object ?? '');
  if (!rx("\\bi2c\\b", "i").test(raw)) return false;
  if (rx("\\bR\\d+\\b", "i").test(raw)) return false;
  if (rx("저항|抵抗|resistors?", "iu").test(raw)) return false;
  const withoutBus = raw.replace(rx("\\bi2c\\b", "gi"), ' ');
  return !textHasKnownRole(withoutBus);
}

export function isAmbiguousI2cPreservation(text) {
  const raw = String(text ?? '');
  if (!raw) return false;
  for (const match of preserveAfterMatches(raw)) {
    if (objectNamesBareI2c(objectAfter(raw, match.index + match[0].length))) return true;
  }
  for (const match of preserveBeforeMatches(raw)) {
    if (objectNamesBareI2c(objectBefore(raw, match.index))) return true;
  }
  return false;
}

function isKeepNonResistorClause(clause) {
  const raw = String(clause ?? '');
  if (isAmbiguousI2cPreservation(raw)) return true;
  if (rx("건드리지\\s*마", "u").test(raw) && !rx("\\bR\\d+\\b", "i").test(raw)) {
    const words = clauseWords(raw);
    if (words.some((word) => isNonResistorRef(word) || NONRES_OBJECTS.has(lower(word)) || NONRES_OBJECTS.has(word) || isLengthObjectWord(word))) return true;
  }
  if (!hasKeepCue(raw) || isNegatedKeep(raw) || isDontDelete(raw)) return false;
  const words = clauseWords(raw);
  const nonRes = words.some((word) => isNonResistorRef(word) || NONRES_OBJECTS.has(lower(word)) || NONRES_OBJECTS.has(word) || isLengthObjectWord(word));
  const resistorObject = words.some((word) => /^R\d+$/i.test(word) || isKnownRoleWord(word) || RESISTOR_NOUNS.has(lower(word)) || RESISTOR_NOUNS.has(word));
  if (textHasLengthObject(raw) && hasKeepCue(raw)) return true;
  return nonRes && !resistorObject;
}

// "손대지 말고" is the keep phrase. The filler "손대지" plus a negation on
// -거나 ("손대지 말거나") is not: swallowing the clause would land the ohms on R3.
function dontTouchFillerNegatedGeona(clause) {
  const raw = String(clause ?? '');
  const fillers = KEEP_CUES.filter((cue) => cue.slot === 'filler' && /(?:손대|건드리지)/u.test(cue.text));
  if (!fillers.some((cue) => raw.includes(cue.text))) return false;
  return editVerbNegationSpans(raw).length > 0;
}

function isResistorKeepClause(clause) {
  if (isAmbiguousI2cPreservation(clause)) return false;
  // "don't touch R4" keeps that ref. "don't touch the pull-ups" keeps that role,
  // the same way "keep the pull-ups" does. "don't touch the LED resistor" has
  // no role word, so it stays a negation of the edit.
  if (dontTouchFillerNegatedGeona(clause)) return false;
  if (isDontTouchResistorClause(clause)) return true;
  if (!hasKeepCue(clause) || isNegatedKeep(clause)) return false;
  if (isKeepNonResistorClause(clause)) return false;
  const words = clauseWords(clause);
  return words.some((word) => /^R\d+$/i.test(word) || isKnownRoleWord(word) || RESISTOR_NOUNS.has(lower(word)) || LED_WORDS.has(lower(word)));
}

function isForeignRoleClause(clause) {
  if (isAmbiguousI2cPreservation(clause)) return false;
  if (isDontDelete(clause) || isResistorKeepClause(clause) || isKeepNonResistorClause(clause)) return false;
  if (isLengthClause(clause) && textHasUsbRole(clause)) return false;
  return textHasKnownRole(clause) || textHasUsbRole(clause);
}

function isGenericKeep(clause) {
  const folded = String(clause ?? '').toLowerCase();
  return folded.includes('everything') || folded.includes('unchanged') || clause.includes('나머지') || clause.includes('기존');
}

function isApproximationWord(word) {
  const key = lower(word);
  if (key === 'about' || key === 'around' || key === 'approximately' || key === 'approx' || key === 'roughly') return true;
  if (key === '-ish' || key === 'ish') return true;
  return word === '약' || word === '대략' || word === '대충' || word === '정도' || word === '쯤' || word === '가량' || word === '내외';
}

function isModifierGlue(word) {
  return isFunctionWord(word) || isEditVerbWord(word) || isModalOrParticleWord(word) || isDemonstrativeWord(word);
}

// Synonym fragments name the LED resistor only when they sit in the modifier
// phrase directly before the resistor noun. "current limit" there is the part.
// The same words after the value are a different claim.
function modifierPieceIndexes(clause) {
  const words = clauseWords(clause);
  const indexes = new Set();
  for (let nounAt = 0; nounAt < words.length; nounAt += 1) {
    if (!RESISTOR_NOUNS.has(lower(words[nounAt]))) continue;
    for (let index = nounAt - 1; index >= 0; index -= 1) {
      const word = words[index];
      if (isModifierGlue(word)) continue;
      if (!isLedResistorSynonymPiece(word) || RESISTOR_NOUNS.has(lower(word))) break;
      indexes.add(index);
    }
  }
  return indexes;
}

function clauseHasLooseSynonymFragment(clause) {
  const words = clauseWords(clause);
  const inside = modifierPieceIndexes(clause);
  return words.some((word, index) => (
    !excludedSynonymFragment(word)
    && isLedResistorSynonymPiece(word)
    && !RESISTOR_NOUNS.has(lower(word))
    && !inside.has(index)
  ));
}

// mA, A, V, mV, W, Hz, and the same units with a prefix. Ohms stay values.
function isNonOhmMeasurement(word) {
  const text = String(word ?? '').trim();
  if (rx("^\\d+(?:\\.\\d+)?(?:[mµμunpkKMGT])?(?:hz|v|a|w)(?:dc|ac)?$", "i").test(text)) return true;
  return rx("^\\d+/\\d+[wW]$").test(text);
}

// A bare name ("current limiter", "the series one") is the part, so its words
// are covered with no resistor noun. A modifier ("current limit", "current-limit")
// is covered only directly before the resistor noun.
function wordSitsInMatchedSynonym(word, clause) {
  const key = synonymFold(word);
  if (!key) return false;
  const joined = synonymFold(clause);
  return LED_RESISTOR_SYNONYM_MATCHERS.some((item) => (
    synonymIsBareName(item.folded)
    && (item.words.includes(key) || item.folded === key)
    && matcherHits(item, joined)
  ));
}

function recognizedWord(word, clause, index = -1) {
  if (!word) return true;
  if (isNegationOrAlternativeWord(word)) return true;
  if (isPoliteIfFiller(word, clause)) return true;
  if (isAsideFiller(word, clause)) return true;
  // A non-ohm measurement beside a synonym fragment that is not the modifier
  // is leftover. "at 3.3V" and "20mA" on the resistor phrase stay values.
  if (isNonOhmMeasurement(word) && clauseHasLooseSynonymFragment(clause)) return false;
  if (rx("^\\d").test(word) || rx("[Ω옴%]").test(word) || rx("^(?:ohm|ohms|meg)$", "i").test(word)) return true;
  if (isLedAllowWord(word) || isFunctionWord(word) || isEditVerbWord(word)) return true;
  if (wordSitsInMatchedSynonym(word, clause)) return true;
  if (index >= 0 && isLedResistorSynonymPiece(word) && modifierPieceIndexes(clause).has(index)) return true;
  if (isModalOrParticleWord(word) || isDemonstrativeWord(word)) return true;
  if (NOISE_WORDS.has(lower(word)) || NOISE_WORDS.has(word)) return true;
  if (rx("^R\\d+$", "i").test(word)) return true;
  if (isUnboundMeasureNoun(word) && rx("\\b(?:next|beside|near|옆)\\b", "iu").test(clause)) return true;
  if (isKoreanRequestStem(word)) return true;
  // Same stems as isIgnorableWord. They are filler here, and still a noun modifier there.
  if (rx("^괜찮", "u").test(word) || rx("^가능", "u").test(word)) return true;
  if (isApproximationWord(word)) return true;
  if (word === '될까' || word === '되나요' || word === '되나' || word === '돼' || word === '됨' || word === '됩니다') return true;
  if (PARTICLE_WORDS.has(word) || KEEP_SIGNAL_TEXTS.some((cue) => word.includes(cue) || lower(word) === cue)) return true;
  return false;
}

// Drop a don't-delete clause only when it names a resistor, a resistor role,
// or an R ref. A bus, connector, cable, or other ref (I2C, J2, U1, USB, C1)
// stays a content word in either language.
function dontDeleteNamesResistor(clause) {
  const raw = String(clause ?? '');
  if (rx("\\bR\\d+\\b", "i").test(raw)) return true;
  if (rx("저항|抵抗|\\bresistors?\\b", "iu").test(raw)) return true;
  if (rx("\\bleds?\\b|엘이디|엘예디|발광|전류\\s*제한|current[-\\s]+limiting", "iu").test(raw)) return true;
  const withoutBus = raw.replace(rx("\\b(?:i2c|sda|scl)\\b", "gi"), ' ');
  return textHasKnownRole(withoutBus);
}

function leftoverWords(clause) {
  if (isGenericKeep(clause) || isResistorKeepClause(clause) || isKeepNonResistorClause(clause)) return [];
  if (isDontDelete(clause) && dontDeleteNamesResistor(clause)) return [];
  if (isLengthClause(clause) || isForeignRoleClause(clause)) return [];
  const words = clauseWords(clause);
  return words.filter((word, index) => !recognizedWord(word, clause, index) && !isKnownRoleWord(word) && !isUnboundMeasureNoun(word));
}

// A don't-delete left piece loses 마 when 말고 is the separator. "바꾸지" is an
// edit negation, not a deletion, so it stays a rejection signal.
function isSplitDontDelete(clause) {
  const raw = String(clause ?? '').trim();
  if (rx("(?:삭제|제거|지우|버리|없애|빼)지\\s*$", "u").test(raw)) return true;
  return rx("(?:삭제|제거)\\s*하지\\s*$", "u").test(raw);
}

// Don't-touch is exempt only when the object is an R ref or a resistor role.
// "don't touch the LED resistor" negates the edit, so it is not exempt.
function isDontTouchResistorClause(clause) {
  const raw = String(clause ?? '');
  const folded = raw.toLowerCase();
  const english = rx("\\b(?:don't|dont|do not|does not|did not|never)\\s+touch\\b", "i").test(folded)
    || KEEP_CUES.some((cue) => (
      cue.slot === 'after' && cue.text.includes('touch') && folded.includes(cue.text.toLowerCase())
    ));
  const korean = raw.includes('건드리지');
  if (!english && !korean) return false;
  if (rx("\\bR\\d+\\b", "i").test(raw)) return true;
  return textHasKnownRole(raw);
}

function isExemptSignalClause(clause) {
  if (isResistorKeepClause(clause) || isKeepNonResistorClause(clause)) return true;
  if (isDontDelete(clause) || isSplitDontDelete(clause)) return true;
  if (rx("\\b(?:does|did)\\s+not\\s+(?:remove|delete)\\b", "i").test(clause)) return true;
  return isDontTouchResistorClause(clause);
}

// 지, 지는, 지도, 지만, and the contraction 진, between a stem and the
// prohibitive 마 ("하지는 마", "하진 마"). The same ending blocks a positive
// edit stem ("바꾸진"). A negated -거나 does not peel it: the stem on -거나
// is the negation, so a particle on the word in front is not listed here.
// 요 is polite, not this ending.
export const NEGATION_JI_SUFFIX = String.raw`(?:지(?:는|도|만)?|진)`;

const NEGATION_JI_SUFFIX_END = rx(`${NEGATION_JI_SUFFIX}$`, 'u');

const NEGATION_SIGNALS = [
  String.raw`\b(?:do|does|did)\s+not\b`,
  String.raw`\b(?:don't|dont|not|no|never)\b`,
  String.raw`지\s*말고`,
  String.raw`하지\s*마`,
  // 는/도/만 sit between 지 and the prohibitive ("하지는 마"). 진 is 하지는.
  // 요 is the polite ending in the raw sentence ("하지요 마").
  String.raw`(?:${NEGATION_JI_SUFFIX}|지요)\s*마(?![가-힣])`,
  String.raw`말고`,
  String.raw`않`
];

const ALTERNATIVE_SIGNALS = [
  // "or so" approximates the ohms before it. It is not a second value.
  // The exception is the or row's notBefore column.
  ...choiceWordJoinerSources({ exceptApprox: true }),
  String.raw`\d+(?:\.\d+)?\s*(?:Ω|옴|ohms?|[kKmMrR](?:\s*(?:Ω|옴|ohms?))?)\s*/\s*\d+(?:\.\d+)?\s*(?:[kKmMrR](?:\s*(?:Ω|옴|ohms?))?|Ω|옴|ohms?)`
];

function signalIndexes(text, sources) {
  const indexes = [];
  for (const source of sources) {
    for (const match of text.matchAll(rx(source, 'giu'))) indexes.push(match.index);
  }
  return indexes;
}

function indexInRanges(index, ranges) {
  return ranges.some((range) => index >= range[0] && index < range[1]);
}

// Negation and alternatives reject the whole request. A resistor keep,
// a don't-touch of an R ref or resistor role, and any don't-delete clause
// are removed first, including the separator that closed them. A -거나 hedge
// is the same kind of aside. A negation marker in the clause on that -거나
// (않, 말, 마/마시, 못, 안, 싫, 아니) is not a hedge, so the marker stays
// a rejection. Bare 없 is not a marker (없애, 없으면).
function exemptSignalRanges(text) {
  const pieces = allowClausePieces(text);
  const exempt = [];
  // A keep clause must not hide a negated -거나. "손대지 않거나" is that case:
  // 손대지 is a keep stem, and without this the 않 would be exempt and the
  // ohms would still land on R3.
  const negatedGeona = editVerbNegationSpans(text);
  for (const piece of pieces) {
    if (!isExemptSignalClause(piece.text)) continue;
    const hidesNegatedGeona = negatedGeona.some(([from, to]) => from < piece.sepEnd && to > piece.start);
    if (hidesNegatedGeona) continue;
    exempt.push([piece.start, piece.sepEnd]);
  }
  for (const span of geonaHedgeSpans(text)) exempt.push(span);
  return exempt;
}

// 하다 after -거나. One paradigm. word is the following-word hedge
// ("밝거나 해서"). adjective is word-initial 거나 plus the form ("거나하게").
// 하게 is only the adjective. The set is the paradigm, not the request sentences.
// Each row is [form, word, adjective].
const HADA_FORMS = Object.freeze([
  ['해', true, true], ['해서', true, true], ['하여', true, true], ['하고', true, true],
  ['하면', true, true], ['하니', true, true], ['하다', true, true], ['하지', true, true],
  ['하는', true, true], ['할', true, true], ['한', true, true], ['함', true, true],
  ['하게', false, true],
  ['해야', true, false], ['해도', true, false], ['해라', true, false], ['했다', true, false],
  ['했어', true, false], ['했네', true, false], ['했으면', true, false], ['했다면', true, false],
  ['하여서', true, false], ['하니까', true, false], ['하니깐', true, false], ['하지만', true, false],
  ['하며', true, false], ['하자', true, false], ['할게', true, false], ['합니다', true, false],
  ['하죠', true, false], ['한다면', true, false]
].map(([form, word, adjective]) => Object.freeze({ form, word, adjective })));

const HADA_HEDGE_FORMS = new Set(HADA_FORMS.filter((item) => item.word).map((item) => item.form));

const GEONA_ADJECTIVE_TAIL = HADA_FORMS
  .filter((item) => item.adjective)
  .map((item) => item.form)
  .sort((left, right) => right.length - left.length)
  .join('|');
const GEONA_ADJECTIVE = rx(`^${choiceJoinerRow('geona').re}(?:${GEONA_ADJECTIVE_TAIL})$`, 'u');
const GEONA_ENDING = rx(`${choiceJoinerRow('geona').scanRe}$`, 'u');

const DEGREE_ADVERBS = new Set([
  '너무', '아주', '매우', '정말', '진짜', '되게', '무척', '꽤', '약간',
  '상당히', '굉장히', '몹시', '심히', '유난히', '너무나도', '제법'
]);

const GEONA_NOMINALS = new Set(['건', '것은', '게', '거는', '건지']);

const NOT_THAT_FORMS = new Set([
  '아니고', '아니라', '아닌', '아님', '아니야', '아니다', '아닌데', '아니에요',
  '않음', '않다', '않은', '않아', '않아요', '않네', '않지'
]);

function bareHedgeToken(token) {
  return String(token ?? '').replace(/^[("'`]+|[)"'`.;!?。！？,]+$/gu, '');
}

function hedgeLookupForm(word) {
  let text = bareHedgeToken(word);
  if (text.endsWith('요') && text.length > 1) text = text.slice(0, -1);
  return text;
}

function endsWithGeona(word) {
  return GEONA_ENDING.test(hedgeLookupForm(word));
}

function isGeonahadaAdjective(word) {
  // Word-initial 거나 is the stem of 거나하다, not a choice ending.
  return GEONA_ADJECTIVE.test(hedgeLookupForm(word));
}

function isHadaHedgeForm(word) {
  const text = hedgeLookupForm(word);
  if (HADA_HEDGE_FORMS.has(text)) return true;
  if (text.length > 2 && /[은는도]$/u.test(text) && HADA_HEDGE_FORMS.has(text.slice(0, -1))) return true;
  return false;
}

function isDegreeAdverb(word) {
  return DEGREE_ADVERBS.has(hedgeLookupForm(word));
}

function isGeonaNominal(word) {
  return GEONA_NOMINALS.has(hedgeLookupForm(word));
}

function isNotThatWord(word) {
  const text = hedgeLookupForm(word);
  if (NOT_THAT_FORMS.has(text)) return true;
  if (text.endsWith('요') && NOT_THAT_FORMS.has(text.slice(0, -1))) return true;
  return false;
}

function isGoodEvaluative(word) {
  return rx('^좋(?:겠|을|아|다|습|네|지|음)', 'u').test(hedgeLookupForm(word));
}

// Polite closers after -거나 하-. 좋겠어요 and 감사하겠어요 share one shape:
// an evaluative stem, optional 하, optional honorific 시, then a polite or
// conjectural ending. The full sentence is not listed. An edit verb
// (바꾸겠어요) is not this closer.
const POLITE_CLOSER_ENDINGS = [
  '겠습니다', '겠어요', '겠네요', '겠어', '겠다', '겠네',
  '습니다', 'ㅂ니다', '네요', '지요', '해요', '하여',
  '습', '네', '지', '다', '음', '을', '아', '어', '해', '요', '죠'
];

function evaluativeCloserStem(word) {
  let text = hedgeLookupForm(word);
  const ending = POLITE_CLOSER_ENDINGS.find((item) => text.endsWith(item) && text.length > item.length);
  if (ending) text = text.slice(0, -ending.length);
  if (text.endsWith('시') && text.length > 1) text = text.slice(0, -1);
  if (text.endsWith('하') && text.length > 1) text = text.slice(0, -1);
  if (text === '고마워' || text === '고마와' || text === '고마웠') return '고마';
  return text;
}

function isPoliteCloser(word) {
  if (isGoodEvaluative(word)) return true;
  const stem = evaluativeCloserStem(word);
  return stem === '감사' || stem === '고맙' || stem === '고마';
}

function isHedgeSubject(word) {
  const form = asideTokenStem(bareHedgeToken(word));
  if (!form || rx('\\d', 'u').test(form)) return false;
  if (isDegreeAdverb(form) || isNegationOrAlternativeWord(form) || isFunctionWord(form)) return false;
  if (isEditVerbWord(form) || isKoreanRequestStem(form)) return false;
  if (/[가-힣]/u.test(form)) {
    if (isLedAllowWord(form) || RESISTOR_NOUNS.has(form)) return false;
    return true;
  }
  return rx('^[A-Za-z]+[이가]$', 'u').test(form);
}

function hedgeTokens(text) {
  return [...String(text ?? '').matchAll(rx('\\S+', 'gu'))].map((match) => ({
    raw: match[0],
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length
  }));
}

function extendHedgeBack(tokens, index) {
  let from = tokens[index].start;
  let back = index - 1;
  let sawDegree = false;
  let sawSubject = false;
  while (back >= 0 && (!sawDegree || !sawSubject)) {
    if (!sawDegree && isDegreeAdverb(tokens[back].raw)) {
      from = tokens[back].start;
      sawDegree = true;
      back -= 1;
      continue;
    }
    if (!sawSubject && isHedgeSubject(tokens[back].raw)) {
      from = tokens[back].start;
      sawSubject = true;
      back -= 1;
      continue;
    }
    break;
  }
  return from;
}

function extendHedgeForward(tokens, index, end) {
  let to = end;
  let cursor = index;
  if (cursor < tokens.length && isPoliteCloser(tokens[cursor].raw)) {
    to = tokens[cursor].end;
    cursor += 1;
  }
  const nominal = tokens[cursor];
  const afterNominal = tokens[cursor + 1];
  if (nominal && afterNominal && isGeonaNominal(nominal.raw) && isNotThatWord(afterNominal.raw)) {
    return afterNominal.end;
  }
  if (nominal && isNotThatWord(nominal.raw)) return nominal.end;
  return to;
}

// Where the clause sitting on this index begins. The separators are the same
// ones allowClausePieces splits on, plus -고. This does not call back into
// the hedge scan. A decimal or thousands separator between digits stays put.
function clauseStartBefore(text, index) {
  const raw = String(text ?? '');
  const boundary = rx(
    String.raw`\s(?:and then|and|&|then)\s|바꾸고|그리고|하면서|하고|이고|이랑|면서|지만|말고|(?<=[가-힣])고(?!\s*나서)(?!거나)|[,，.;!?？！。\n•·]`,
    'giu'
  );
  let start = 0;
  for (const match of raw.matchAll(boundary)) {
    const at = match.index ?? 0;
    if (at >= index) break;
    const end = at + match[0].length;
    if (end > index) continue;
    const mark = match[0];
    if ((mark === ',' || mark === '.' || mark === '，') && /\d/u.test(raw[at - 1] ?? '') && /\d/u.test(raw[at + 1] ?? '')) continue;
    start = end;
  }
  return start;
}

// 정말/만약/말씀 use the syllable 말 and are not the prohibitive.
function hasMalNegation(text) {
  return text.replace(/정말|만약|말씀/gu, ' ').includes('말');
}

// Fail closed. Any of these in the sentence on -거나 drops the hedge, whatever
// the verb, the spacing, or a particle (진/는/도/기는). The check is the whole
// sentence, including the words after -거나 ("바꾸거나 하지 마"). 안 is its own
// word or a prefix (안바꾸, 안되). 마(시) is the prohibitive, not 마다/마음.
// 없 is not matched as a bare syllable: 없애 and 없으면 are not this guard.
// "필요 없거나" is outside the hedge allowlist (the predicate is 없).
function clauseHasNegationMarker(clause) {
  const text = String(clause ?? '');
  if (/[않싫]/u.test(text) || text.includes('아니') || text.includes('못')) return true;
  if (hasMalNegation(text)) return true;
  if (text.includes('마시') || hasStandalone(text, '마') || /(?:^|[^가-힣])마거나/u.test(text) || /지\s*마/u.test(text)) return true;
  // 안되 stays a marker when it is glued on (바꾸면안되거나). 안 alone is a word or a prefix (안바꾸).
  if (text.includes('안되') || hasStandalone(text, '안') || /(?:^|[^가-힣])안[가-힣]/u.test(text)) return true;
  return false;
}

// "건 아니고" closes 거나하다. That 않/아니 is the idiom, not a refusal.
function withoutGeonaNotThat(text) {
  const nominals = [...GEONA_NOMINALS].sort((left, right) => right.length - left.length).join('|');
  const forms = [...NOT_THAT_FORMS].sort((left, right) => right.length - left.length).join('|');
  return String(text ?? '').replace(rx(`(?<![가-힣])(?:${nominals})\\s*(?:${forms})(?![가-힣])`, 'gu'), ' ');
}

function sentenceHasNegationMarker(text) {
  return clauseHasNegationMarker(withoutGeonaNotThat(text));
}

// The stem glued to -거나. clauseHasNegationMarker is the shared vocabulary
// (말, 않, 못, 마/마시, 싫, 아니, 안). Bare 없 is not a sentence marker
// (없애, 없으면); as this stem it is ("없거나", "없으시거나"). 았/었 is the
// past already used on 말았거나.
function geonaHeadIsNegation(head) {
  let text = String(head ?? '');
  if (!text) return false;
  if (clauseHasNegationMarker(text)) return true;
  if ((text.endsWith('았') || text.endsWith('었')) && text.length > 1) text = text.slice(0, -1);
  if (text.endsWith('으시') && text.length > 2) text = text.slice(0, -2);
  if (clauseHasNegationMarker(text)) return true;
  return text === '없';
}

// One LED state list. UAT 093/094/190 and the 어둡 row read these stems.
const LED_STATE_STEMS = new Set(['밝', '어둡', '약하', '강하', '눈부시', '거슬리']);

const GEONA_HONORIFIC_HELPERS = ['주시', '주', '시'];

// Q3 "그대로 두거나 하고" uses the leave verb already stored on KEEP_CUES.
function isAsIsLeaveStem(stem) {
  for (const cue of KEEP_CUES) {
    for (const bit of cue.text.split(' ')) {
      if (bit === '두고' && stem === '두') return true;
      if (bit === '둬' && (stem === '두' || stem === '둬')) return true;
    }
  }
  return false;
}

// The predicate is the edit stem itself: optional 아/어 (바꿔, 변경해), then
// one 하 (변경하). A longer word that only contains the stem is not it.
function isPositiveEditStem(stem) {
  let text = String(stem ?? '');
  if (!text || text.includes('부탁') || clauseHasNegationMarker(text) || NEGATION_JI_SUFFIX_END.test(text)) return false;
  const ara = araEoStem(text);
  if (ara && ara !== text) {
    if (clauseHasNegationMarker(ara)) return false;
    text = ara;
  }
  if (text.endsWith('하') && text.length > 1) text = text.slice(0, -1);
  if (!text) return false;
  if (EXACT_EDIT_STEMS.includes(text)) return true;
  return KOREAN_REQUEST_STEMS.some((known) => known !== '부탁' && text === known);
}

function isAllowedGeonaStem(stem) {
  if (!stem) return false;
  if (LED_STATE_STEMS.has(stem)) return true;
  if (isPositiveEditStem(stem)) return true;
  return isAsIsLeaveStem(stem);
}

// Null when this word is not a -거나 ending. '' when the word is exactly 거나
// (거나하다). Otherwise the syllables glued in front of -거나.
function geonaPredicateHead(word) {
  let text = hedgeLookupForm(word);
  if ((text.endsWith('도') || text.endsWith('나')) && text.length > 1 && text.slice(0, -1).endsWith('거나')) {
    text = text.slice(0, -1);
  }
  if (!text.endsWith('거나')) return null;
  return text.slice(0, -2);
}

// True when the predicate glued to this -거나 is an allowed hedge shape.
// previous is the token before it, for a spaced 주/주시 helper.
// A free-standing 거나 with no previous word is 거나하다. A previous word
// makes it a hedge only when that word is an allowed stem.
function isAllowedGeonaPredicate(word, previous) {
  const head = geonaPredicateHead(word);
  if (head == null) return false;
  // 말거나 / 않거나 / 없거나. The previous word cannot turn this into a hedge.
  if (geonaHeadIsNegation(head)) return false;
  if (isAllowedGeonaStem(head)) return true;
  if (head === '') return bareGeonaFollowsAllowedStem(previous);
  const prev = hedgeLookupForm(previous ?? '');
  for (const helper of GEONA_HONORIFIC_HELPERS) {
    if (head === helper && isAllowedGeonaStem(prev)) return true;
    if (head.length > helper.length && head.endsWith(helper) && isAllowedGeonaStem(head.slice(0, -helper.length))) {
      return true;
    }
  }
  return false;
}

function bareGeonaFollowsAllowedStem(previous) {
  const prev = hedgeLookupForm(previous ?? '');
  if (!prev) return true;
  return isAllowedGeonaStem(prev);
}

// "말거나" / "않거나" refuses the edit. The word in front does not matter
// ("버리지를 말거나", "버리진 말거나"). X거나 말거나 is the regardless idiom,
// and that partner is not this refusal ("바꾸고 오거나 말거나" still edits).
function negatedAuxiliaryGeona(text) {
  const raw = String(text ?? '');
  const tokens = hedgeTokens(raw);
  for (const token of tokens) {
    const bare = bareHedgeToken(token.raw);
    if (!endsWithGeona(bare)) continue;
    const head = geonaPredicateHead(bare) ?? '';
    if (!geonaHeadIsNegation(head)) continue;
    if (choiceJoinerIsIdiom(raw, token.start, token.end)) continue;
    return true;
  }
  return false;
}

// "삭제하거나 변경하지 마" shares one prohibitive with the removal verb.
// That -거나 is the don't-delete coordinator, not an edit negation. A span
// on it drops the don't-delete exemption, and the 거나 is then a choice.
const REMOVAL_COORDINATOR_STEMS = new Set(['삭제', '제거', '지우', '지워', '없애', '빼']);

function removalCoordinatorStem(word) {
  let stem = hedgeLookupForm(word);
  if (stem.endsWith('하') && stem.length > 1) stem = stem.slice(0, -1);
  return REMOVAL_COORDINATOR_STEMS.has(stem);
}

function isRemovalCoordinatorGeona(word, previous) {
  const head = geonaPredicateHead(bareHedgeToken(word));
  if (head == null) return false;
  if (head && removalCoordinatorStem(head)) return true;
  // "삭제 하거나": 하 is 하다, and the removal verb is the previous word.
  if (head !== '' && head !== '하') return false;
  return removalCoordinatorStem(previous ?? '');
}

// The -거나 whose sentence holds a negation marker. A negated state
// ("밝지 않거나", "안 켜지거나") is included. The marker may sit after -거나.
// A removal coordinator ("삭제하거나 변경하지 마") is not this span.
// Null when this word is not -거나 or the sentence has no marker.
function editVerbNegationRange(text, tokens, index) {
  const token = tokens[index];
  if (!token || !endsWithGeona(bareHedgeToken(token.raw))) return null;
  const previous = index > 0 ? tokens[index - 1].raw : '';
  if (isRemovalCoordinatorGeona(token.raw, previous)) return null;
  const from = clauseStartBefore(text, token.start);
  if (!sentenceHasNegationMarker(text.slice(from))) return null;
  return [token.start, token.end];
}

// Ranges of a negated -거나. A hedge span must not cover these.
export function editVerbNegationSpans(text) {
  const raw = String(text ?? '');
  const tokens = hedgeTokens(raw);
  const spans = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const range = editVerbNegationRange(raw, tokens, index);
    if (range) spans.push(range);
  }
  return spans;
}

function textHasNegatedEditGeona(text) {
  const raw = String(text ?? '');
  const tokens = hedgeTokens(raw);
  if (tokens.length === 0) return false;
  return editVerbNegationRange(raw, tokens, tokens.length - 1) != null;
}

// Spans of a non-choice -거나. Empty unless the sentence names a resistor,
// so "너무 밝거나 해서 680Ω으로" stays unknown. A keep or a second -거나 after
// the 하다 form is a real choice and is not in these spans' joiner check;
// the words are still filler so they are not a second role. A negated edit
// verb is not a span, so its negation is not filler and not exempt.
export function geonaHedgeSpans(text) {
  const raw = String(text ?? '');
  if (!explicitTarget(raw)) return [];
  // A marker anywhere, including after -거나, means this is not a hedge.
  if (sentenceHasNegationMarker(raw)) return [];
  const tokens = hedgeTokens(raw);
  const spans = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const bare = bareHedgeToken(tokens[index].raw);
    if (isGeonahadaAdjective(bare)) {
      spans.push([tokens[index].start, extendHedgeForward(tokens, index + 1, tokens[index].end)]);
      continue;
    }
    if (!endsWithGeona(bare)) continue;
    const next = tokens[index + 1];
    if (!next || !isHadaHedgeForm(next.raw)) continue;
    const prev = index > 0 ? tokens[index - 1].raw : '';
    if (!isAllowedGeonaPredicate(bare, prev)) continue;
    if (editVerbNegationRange(raw, tokens, index)) continue;
    const from = extendHedgeBack(tokens, index);
    spans.push([from, extendHedgeForward(tokens, index + 2, next.end)]);
  }
  return spans;
}

function geonaHedgeHadaAt(text, index) {
  const raw = String(text ?? '');
  const match = /(\S+)\s*$/u.exec(raw.slice(0, index));
  if (!match || !endsWithGeona(bareHedgeToken(match[1]))) return false;
  const prev = /(\S+)\s*$/u.exec(raw.slice(0, match.index));
  if (!isAllowedGeonaPredicate(match[1], prev ? prev[1] : '')) return false;
  return !textHasNegatedEditGeona(raw.slice(0, index));
}

function particleGlueStem(word) {
  if (/[이가]$/u.test(word) && word.length >= 2) return word.slice(0, -1);
  return word;
}

function sameHedgeWord(key, token) {
  const left = asideTokenStem(key);
  const right = asideTokenStem(token);
  if (left === right) return true;
  const stem = particleGlueStem(left);
  if (!stem || stem !== particleGlueStem(right)) return false;
  if (isLedAllowWord(stem) || RESISTOR_NOUNS.has(stem) || rx('^R\\d+$', 'i').test(stem)) return false;
  return true;
}

function isGeonaHedgeFiller(word, text) {
  const key = String(word ?? '');
  if (!key) return false;
  const raw = String(text ?? '');
  const spans = geonaHedgeSpans(raw);
  if (spans.length === 0) return false;
  let saw = false;
  for (const token of hedgeTokens(raw)) {
    if (!sameHedgeWord(key, bareHedgeToken(token.raw))) continue;
    saw = true;
    const inside = spans.some(([from, to]) => token.start < to && token.end > from);
    if (!inside) return false;
  }
  return saw;
}

function followingHasChoiceAlternative(following) {
  const rest = String(following ?? '').replace(/^\s*\S+\s*/u, '');
  for (const cue of KEEP_CUES) {
    if (cue.signal !== true || !cue.text) continue;
    if (/[가-힣]/u.test(cue.text)) {
      if (rest.includes(cue.text)) return true;
      continue;
    }
    const body = cue.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (rx(`(?:^|[^A-Za-z])${body}(?:[^A-Za-z]|$)`, 'i').test(rest)) return true;
  }
  for (const item of CHOICE_JOINERS) {
    if (item.place === 'word' && rest.includes(item.text)) return true;
  }
  const endings = CHOICE_JOINERS
    .filter((item) => item.place === 'ending' && item.plainSuffix !== false)
    .map((item) => item.re);
  if (endings.length === 0) return false;
  return rx(`(?:${endings.join('|')})${CHOICE_ENDING_POLITE}(?![가-힣])`, 'u').test(rest);
}

// True when this token is the hedge, not a choice joiner. A keep cue or
// another choice ending after the 하다 form is the second alternative, so
// the ending stays a choice ("바꾸거나 하면 R4는 그대로"). preceding is the
// text before the token. A negation marker in that clause ("바꾸지 않거나",
// "밝지 않거나") stays a choice.
export function isGeonaHedgeJoiner(token, following = '', preceding = '') {
  const context = `${bareHedgeToken(token)} ${String(following ?? '')}`;
  if (!explicitTarget(context)) return false;
  const bare = bareHedgeToken(token);
  if (isGeonahadaAdjective(bare)) return true;
  if (!endsWithGeona(bare)) return false;
  if (sentenceHasNegationMarker(`${String(preceding ?? '')}${token}${String(following ?? '')}`)) return false;
  const next = rx('^\\s*(\\S+)', 'u').exec(String(following ?? ''));
  if (!next || !isHadaHedgeForm(next[1])) return false;
  const prev = /(\S+)\s*$/u.exec(String(preceding ?? ''));
  if (!isAllowedGeonaPredicate(bare, prev ? prev[1] : '')) return false;
  return !followingHasChoiceAlternative(String(following ?? ''));
}

function hasSignalOutsideExempt(text, sources, exempt = exemptSignalRanges(text)) {
  return signalIndexes(text, sources).some((index) => !indexInRanges(index, exempt));
}

function hasNegation(text, exempt) {
  if (hasSignalOutsideExempt(text, NEGATION_SIGNALS, exempt)) return true;
  if (negatedAuxiliaryGeona(text)) return true;
  return negatedNonHedgeGeonaClause(text, exempt);
}

// 안 (spaced or glued to the verb), 못, and 말아 inside the clause of a -거나
// that is not a hedge ("안 바꿔 버리거나 해", "바꾸지 말아 버리거나 해").
// Scoped to that clause so 말든 and exempt don't-delete clauses are untouched.
const GEONA_CLAUSE_NEGATION = /(?:^|\s)(?:안|못)(?:\s|(?=[가-힣]))|말아|않|지\s*마/u;

function negatedNonHedgeGeonaClause(text, exempt) {
  // A bare 없/말/안/못/싫/아니 word, or 안 되, is a negation, not a hedge word, in any -거나 sentence.
  if (/거나/u.test(text) && /(?:^|\s)(?:(?:없|말|안|못|싫|아니)(?=\s|$)|안\s*되)/u.test(text)) return true;
  const hedges = geonaHedgeSpans(text);
  for (const match of text.matchAll(/\S*거나(?![가-힣])/gu)) {
    const at = match.index;
    if (indexInRanges(at, exempt) || indexInRanges(at, hedges)) continue;
    const clause = text.slice(clauseStartBefore(text, at), at + match[0].length);
    if (GEONA_CLAUSE_NEGATION.test(clause)) return true;
  }
  return false;
}

function clauseAt(pieces, index) {
  return pieces.find((piece) => index >= piece.start && index < piece.end) ?? null;
}

// "1k 둘 중 하나로" is the other half of one choice. "terminator to 120Ω" is not.
function isChoiceRemainder(clause) {
  return rx("둘\\s*중|하나|\\bvs\\b|\\beither\\b|\\|", "iu").test(String(clause ?? ''));
}

// A value in another role, a keep, a length, or a don't-delete clause is not
// a second choice for this resistor. "X 말고" names the value being replaced.
// An unknown role ("terminator to 120Ω", "680Ω / ADC 5.1k") stays which-resistor
// even when the same clause also names the LED. "vs", "|", "either", and "둘 중" do not.
function clauseDropsChoiceValue(piece, text) {
  if (!piece) return false;
  const clause = piece.text;
  if (isForeignRoleClause(clause) || isResistorKeepClause(clause) || isKeepNonResistorClause(clause)) return true;
  if (isLengthClause(clause) || isDontDelete(clause)) return true;
  if (unknownRoleValue(clause) && !isChoiceRemainder(clause)) return true;
  return text.slice(piece.end, piece.sepEnd).includes('말고');
}

// "from 330Ω to 680Ω" and "330옴에서 680옴으로" name one destination.
// "to 680Ω and 1k" does not: "to" there is the edit verb.
function isValueTransition(text, tokens) {
  if (tokens.length < 2) return false;
  const between = text.slice(tokens[0].end, tokens[tokens.length - 1].index);
  if (rx("->|→|에서").test(between)) return true;
  return rx("\\bfrom\\b", "i").test(text.slice(0, tokens[0].index)) && rx("\\bto\\b", "i").test(between);
}

// Two unit-bearing values, or a range whose unit is only on the last number,
// are the same choice as "680Ω or 1k".
function hasMultiValueChoice(text) {
  const pieces = allowClausePieces(text);
  const hidden = parentheticalCurrentSpans(text);
  const tokens = boundOhmTokens(text).filter((token) => {
    if (isReplacedSourceValue(text, token.index)) return false;
    if (hidden.some(([start, end]) => token.index >= start && token.index < end)) return false;
    return !clauseDropsChoiceValue(clauseAt(pieces, token.index), text);
  });
  let count = tokens.length;
  for (const match of text.matchAll(rx(VALUE_RANGE_SOURCE, 'giu'))) {
    const at = match.index ?? 0;
    if (hidden.some(([start, end]) => at >= start && at < end)) continue;
    if (clauseDropsChoiceValue(clauseAt(pieces, at), text)) continue;
    const head = rx("^\\d+(?:\\.\\d+)?").exec(match[0]);
    if (!head) continue;
    const headEnd = at + head[0].length;
    if (!tokens.some((token) => token.index >= at && token.index < headEnd)) count += 1;
  }
  if (count < 2 || isValueTransition(text, tokens)) return false;
  if (sameOhmTokens(tokens) && count === tokens.length) return false;
  return true;
}

// "R3 또는 R4 중 하나" names which resistor, same as "R3나 R4 중 하나".
// The joiner sits between the refs and there is one ohm value. "680Ω 또는
// 1k" and "680Ω 또는 1k 중 하나" stay a choice of values.
function choiceJoinerCoordinatesResistorTargets(text) {
  const raw = String(text ?? '');
  if (!/중\s*하나/u.test(raw)) return false;
  const refs = [...raw.matchAll(/\bR\d+\b/giu)];
  if (refs.length < 2) return false;
  if (hasMultiValueChoice(raw)) return false;
  const signals = signalIndexes(raw, ALTERNATIVE_SIGNALS);
  if (signals.length === 0) return false;
  const zoneStart = refs[0].index ?? 0;
  const last = refs[refs.length - 1];
  const zoneEnd = (last.index ?? 0) + last[0].length;
  return signals.every((index) => index >= zoneStart && index < zoneEnd);
}

function hasValueAlternative(text, exempt) {
  if (choiceJoinerCoordinatesResistorTargets(text)) return false;
  return hasSignalOutsideExempt(text, ALTERNATIVE_SIGNALS, exempt) || hasMultiValueChoice(text);
}

function unknownRoleValue(clause) {
  if (isForeignRoleClause(clause) || isLengthClause(clause) || isDontDelete(clause)) return false;
  if (isResistorKeepClause(clause) || isGenericKeep(clause)) return false;
  const bound = boundOhmTokens(clause);
  if (bound.length === 0) return false;
  const words = clauseWords(clause);
  return words.some((word, index) => {
    if (rx("^\\d").test(word)) return false;
    return !recognizedWord(word, clause, index) && !isKnownRoleWord(word) && !isFunctionWord(word) && !isEditVerbWord(word);
  });
}

// Whole-sentence allow list. covered is true only when nothing is left over.
export function assessRequestCoverage(text) {
  const normalized = normalizeMatchText(text).trim();
  const adviceQuestion = isAdviceQuestion(normalized);
  const permittedEdit = !adviceQuestion && isPermittedEdit(normalized);
  const approximate = textHasApproximation(normalized);
  const malformedRkm = hasMalformedRkm(normalized);
  const clauses = splitAllowClauses(normalized);
  // Keep and don't-delete clauses are exempt for both signals. Scan them once.
  const exempt = exemptSignalRanges(normalized);
  const negated = hasNegation(normalized, exempt);
  const alternative = hasValueAlternative(normalized, exempt);
  const negatedOrAlternative = negated || alternative;
  let foreignRole = false;
  let unknownLeftover = false;
  let lengthClause = false;
  let keepNonResistor = false;
  let unknownRole = false;
  let valueToken = null;
  const allBound = logicalBoundTokens(normalized);
  for (const token of allBound) {
    if (!valueToken) valueToken = token.raw;
  }
  for (const clause of clauses) {
    if (isLengthClause(clause)) lengthClause = true;
    if (isKeepNonResistorClause(clause)) keepNonResistor = true;
    if (isForeignRoleClause(clause)) foreignRole = true;
    if (unknownRoleValue(clause)) {
      unknownRole = true;
      const local = boundOhmTokens(clause)[0];
      if (local) valueToken = local.raw;
    }
    if (leftoverWords(clause).length > 0) unknownLeftover = true;
    if (isUnboundOnlyClause(clause) && allBound.length > 0 && boundOhmTokens(clause).length === 0) unknownLeftover = true;
  }
  const rawBound = boundOhmTokens(normalized).filter((token) => !isReplacedSourceValue(normalized, token.index));
  const duplicateOhm = sameOhmTokens(rawBound);
  // "2.2k -> 680Ω" is a transition with no resistor noun. "1k & 1000Ω" is one value.
  const hasTarget = explicitTarget(normalized) || (!pronounTarget(normalized) && allBound.length === 1 && (rx("(?:으로|로\\b|\\bto\\b|->|→|바꿔|변경|수정|\\b(?:change|set|make|use)\\b)", "iu").test(normalized) || duplicateOhm));
  const covered = hasTarget
    && allBound.length === 1
    && !foreignRole
    && !unknownLeftover
    && !lengthClause
    && !keepNonResistor
    && !unknownRole
    && !adviceQuestion
    && !approximate
    && !malformedRkm
    && !pronounTarget(normalized)
    && !negatedOrAlternative;
  return {
    covered,
    negated,
    alternative,
    negatedOrAlternative,
    foreignRole,
    unknownLeftover,
    lengthClause,
    keepNonResistor,
    unknownRoleValue: unknownRole,
    adviceQuestion,
    permittedEdit,
    approximate,
    malformedRkm,
    duplicateOhm,
    resistorMention: mentionsResistor(normalized),
    hasBoundValue: allBound.length > 0,
    valueToken
  };
}

function isUnboundOnlyClause(clause) {
  const tokens = ohmTokens(clause);
  if (tokens.length === 0) return false;
  if (tokens.some((token) => !tokenIsUnbound(clause, token))) return false;
  return tokens.some((token) => tokenIsUnbound(clause, token));
}
