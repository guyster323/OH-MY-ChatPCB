// One fail-closed vocabulary for resistor edits. Unit, role, edit-verb,
// question, permission, approximation, filler, and length words live here.
// A request is covered only when every content word is on this list.
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
  'with', 'and', 'or', 'its', 'my', 'our', 'please', 'only', 'just', 'value', 'values',
  'it', 'them', 'one', 'also', 'now', 'too', 'is', 'be', 'are', 'was', 'were', 'am',
  'not', 'no', 'do', 'does', 'did', 'this', 'that', 'these', 'those', 'else', 'everything',
  'unchanged', 'rest', 'up', 'down', 'as', 'so', 'if', 'then', 'than', 'into'
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
  '이랑', '하고', '및', '그리고', '또는', '좀', '다시', '주세요', '해줘', '해주', '줄래', '줄래요',
  '주실래요', '해줄래', '해주세요', '있어', '있나', '있을까요', '줄', '수', '할', '줘', '그냥', '값',
  '기존', '현재', '왜', '어떻게', '어떡', '뭐', '무엇', '몇', '할까', 'existing', 'currently',
  '용', '임', '입니다', '이다', '야', '이야'
]);

const DEMONSTRATIVES = new Set(['그', '저', '이', 'this', 'that', 'these', 'those']);

const ENGLISH_ROLES = new Set([
  'pull-up', 'pull-ups', 'pullup', 'pullups', 'pull-down', 'pull-downs', 'pulldown', 'pulldowns',
  'termination', 'terminations', 'debounce', 'divider', 'dividers', 'feedback',
  'gate', 'gates', 'base', 'bases', 'button', 'buttons', 'shunt', 'shunts',
  'sense', 'senses', 'sensing', 'reset', 'resets', 'boot', 'boots', 'bias', 'biases',
  'i2c', 'sda', 'scl'
]);

const KOREAN_ROLES = ['풀업', '풀다운', '종단', '디바운스', '분압', '피드백', '게이트', '베이스', '버튼', '션트', '센스', '리셋', '바이어스'];

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

const KEEP_CUES = ['그대로', '유지', '남겨', '남기', '빼고', '두고', '건드리지', 'unchanged', 'keep', 'without', 'leave', 'alone'];

const ADVICE_KO = ['왜', '뭐', '어떻게', '궁금', '할까', '바꿔야'];
const ADVICE_EN = new Set(['why', 'ask', 'know', 'what', 'how', 'wonder', 'which']);

const PERMIT_PHRASES = [
  '바꿔줄래', '바꿔 줄래', '바꿔주실래요', '바꿔 주실래요', '바꿔줄 수 있어', '바꿔 줄 수 있어',
  '바꿀 수 있어', '바꿀수 있어',
  '바꿔도 될까', '바꿔도 되나요', '바꿔도 돼', '해줄래', '할 수 있어', '할수 있어',
  '가능하면', '괜찮으면', 'is it ok to', 'can you', 'could you', 'would you',
  'can i', 'could i', 'may i', 'should be'
];

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

export function textHasApproximation(text) {
  const raw = String(text ?? '');
  if (rx("[~∼〜]").test(raw) || rx("(?:^|[\\s\\d])(?:약|대략|대충)", "u").test(raw)) return true;
  if (rx("(?:정도|쯤|가량|내외)", "u").test(raw)) return true;
  return rx("\\b(?:about|around|approximately|approx|roughly)\\b|-ish\\b", "i").test(raw);
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

// Uppercase K with more than one fraction digit is not an RKM code. 4K7 stays. 4K60 does not.
export function isRejectedUppercaseRkm(text) {
  const raw = String(text ?? '').trim().normalize('NFKC').replace(rx("(?:\\s*(?:Ω|옴|ohms?))$", "iu"), '').trim();
  const match = rx("^(\\d+)([rRkKmM])(\\d+)$").exec(raw);
  if (!match) return false;
  return match[2] === 'K' && match[3].length !== 1;
}

export function hasMalformedRkm(text) {
  return rx("(?:^|[^\\d.])(\\d+)K(\\d{2,})(?!\\d)").test(String(text ?? ''));
}

function pushBreak(breaks, start, end) {
  if (end > start) breaks.push([start, end]);
}

function splitAllowClauses(text) {
  const breaks = [];
  const lowerText = text.toLowerCase();
  for (const sep of [' and then ', ' and ', ' then ']) {
    let from = 0;
    while (from < lowerText.length) {
      const at = lowerText.indexOf(sep, from);
      if (at < 0) break;
      pushBreak(breaks, at, at + sep.length);
      from = at + sep.length;
    }
  }
  for (const sep of ['바꾸고', '그리고', '하면서', '하고', '이고', '이랑', '면서', '지만', '말고']) {
    let from = 0;
    while (from < text.length) {
      const at = text.indexOf(sep, from);
      if (at < 0) break;
      pushBreak(breaks, at, at + sep.length);
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
  const parts = [];
  let start = 0;
  for (const span of kept) {
    parts.push(text.slice(start, span[0]));
    start = span[1];
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
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
  if (!text || KEEP_CUES.some((cue) => text.includes(cue))) return text;
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
      const cleaned = stripParticle(bit.replace(rx("^[(\"'`[•·±<>→⇒~∼〜]+|[)\\]\"'`,.:;?？!！<>→⇒~∼〜]+$", "gu"), ''));
      // "->" loses the ">", leaving "-". A bare arrow is not a content word.
      if (!cleaned || rx("^[-–—<>→⇒~∼〜.]+$", "u").test(cleaned)) continue;
      words.push(cleaned);
    }
  }
  return words;
}

function hasKeepCue(clause) {
  const raw = String(clause ?? '');
  const folded = raw.toLowerCase();
  if (rx("\\b(?:keep|without|leave|alone|unchanged)\\b", "i").test(folded)) return true;
  return KEEP_CUES.some((cue) => raw.includes(cue));
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

// "from 330Ω to 680Ω" and "330옴에서 680옴으로" name the destination once.
// A second value with no transition marker stays a second value.
function logicalBoundTokens(text) {
  const tokens = boundOhmTokens(text);
  if (tokens.length <= 1) return tokens;
  if (rx("(?:\\bfrom\\b|\\bto\\b|에서|->|→)", "iu").test(text)) return [tokens[tokens.length - 1]];
  const spans = parentheticalCurrentSpans(text);
  if (spans.length > 0) {
    const outside = tokens.filter((token) => !spans.some(([start, end]) => token.index >= start && token.index < end));
    if (outside.length === 1 && outside.length < tokens.length) return outside;
  }
  return tokens;
}

function isLengthClause(clause) {
  if (!textHasLengthObject(clause) && !LENGTH_EN.has(lower(clause))) return false;
  return LENGTH_UNIT.test(clause) || textHasLengthObject(clause) && rx("\\d").test(clause);
}

function isNonResistorRef(word) {
  return rx("^[A-Za-z]{1,3}\\d+$").test(word) && !rx("^R\\d+$", "i").test(word);
}

function isKeepNonResistorClause(clause) {
  const raw = String(clause ?? '');
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

function isResistorKeepClause(clause) {
  if (!hasKeepCue(clause) || isNegatedKeep(clause)) return false;
  if (isKeepNonResistorClause(clause)) return false;
  const words = clauseWords(clause);
  return words.some((word) => /^R\d+$/i.test(word) || isKnownRoleWord(word) || RESISTOR_NOUNS.has(lower(word)) || LED_WORDS.has(lower(word)));
}

function isForeignRoleClause(clause) {
  if (isDontDelete(clause) || isResistorKeepClause(clause) || isKeepNonResistorClause(clause)) return false;
  if (isLengthClause(clause) && textHasUsbRole(clause)) return false;
  return textHasKnownRole(clause) || textHasUsbRole(clause);
}

function isGenericKeep(clause) {
  const folded = String(clause ?? '').toLowerCase();
  return folded.includes('everything') || folded.includes('unchanged') || clause.includes('나머지') || clause.includes('기존');
}

function recognizedWord(word, clause) {
  if (!word) return true;
  if (rx("^\\d").test(word) || rx("[Ω옴%]").test(word) || rx("^(?:ohm|ohms|meg)$", "i").test(word)) return true;
  if (isLedAllowWord(word) || isFunctionWord(word) || isEditVerbWord(word)) return true;
  if (isModalOrParticleWord(word) || isDemonstrativeWord(word)) return true;
  if (NOISE_WORDS.has(lower(word)) || NOISE_WORDS.has(word)) return true;
  if (rx("^R\\d+$", "i").test(word)) return true;
  if (isUnboundMeasureNoun(word) && rx("\\b(?:next|beside|near|옆)\\b", "iu").test(clause)) return true;
  if (word.includes('바꿔') || word.includes('바꾸') || word.includes('바꿀') || word.includes('변경') || word.includes('수정')) return true;
  // Same stems as isIgnorableWord. They are filler here, and still a noun modifier there.
  if (rx("^괜찮", "u").test(word) || rx("^가능", "u").test(word)) return true;
  if (word === '될까' || word === '되나요' || word === '되나' || word === '돼' || word === '됨' || word === '됩니다') return true;
  if (PARTICLE_WORDS.has(word) || KEEP_CUES.some((cue) => word.includes(cue) || lower(word) === cue)) return true;
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
  return words.filter((word) => !recognizedWord(word, clause) && !isKnownRoleWord(word) && !isUnboundMeasureNoun(word));
}

function unknownRoleValue(clause) {
  if (isForeignRoleClause(clause) || isLengthClause(clause) || isDontDelete(clause)) return false;
  if (isResistorKeepClause(clause) || isGenericKeep(clause)) return false;
  const bound = boundOhmTokens(clause);
  if (bound.length === 0) return false;
  const words = clauseWords(clause).filter((word) => !rx("^\\d").test(word));
  return words.some((word) => !recognizedWord(word, clause) && !isKnownRoleWord(word) && !isFunctionWord(word) && !isEditVerbWord(word));
}

// Whole-sentence allow list. covered is true only when nothing is left over.
export function assessRequestCoverage(text) {
  const normalized = normalizeMatchText(text).trim();
  const adviceQuestion = isAdviceQuestion(normalized);
  const permittedEdit = !adviceQuestion && isPermittedEdit(normalized);
  const approximate = textHasApproximation(normalized);
  const malformedRkm = hasMalformedRkm(normalized);
  const clauses = splitAllowClauses(normalized);
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
  const hasTarget = explicitTarget(normalized) || (!pronounTarget(normalized) && allBound.length === 1 && rx("(?:으로|로\\b|\\bto\\b|바꿔|변경|수정|\\b(?:change|set|make|use)\\b)", "iu").test(normalized));
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
    && !pronounTarget(normalized);
  return {
    covered,
    foreignRole,
    unknownLeftover,
    lengthClause,
    keepNonResistor,
    unknownRoleValue: unknownRole,
    adviceQuestion,
    permittedEdit,
    approximate,
    malformedRkm,
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
