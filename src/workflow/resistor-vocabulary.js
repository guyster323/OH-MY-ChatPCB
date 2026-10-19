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

// "if" is not a function word. These phrases are the only place it is filler.
const POLITE_IF_PHRASES = ['if possible', 'if you can', 'if you could'];

// Negation and alternatives are rejection signals, not allow-list words.
// They are still filler for role detection, so "not" and "마" are not a second role.
const NEGATION_OR_ALTERNATIVE_WORDS = new Set([
  'not', 'no', 'never', "don't", 'dont', 'do', 'does', 'did', 'or',
  '마', '말', '말고', '또는', '아니면', '혹은', '않', '하지'
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
  return text.includes('바꿔') || text.includes('바꾸') || text.includes('바꿀')
    || text.includes('변경') || text.includes('수정') || text.includes('설정') || text.includes('부탁');
}

export const SHUNT_SENSE_WORDS = new Set([
  'sense', 'senses', 'sensing', 'current-sense', 'shunt', 'shunts', '션트', '센스'
]);

export function isShuntSenseWord(word) {
  return SHUNT_SENSE_WORDS.has(lower(word));
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
    adviceKo: ADVICE_KO,
    adviceEn: ADVICE_EN,
    permitPhrases: PERMIT_PHRASES,
    counterWords: COUNTER_WORDS,
    counterLeadWords: COUNTER_LEAD_WORDS,
    politeIfPhrases: POLITE_IF_PHRASES
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

export function textHasApproximation(text) {
  const raw = String(text ?? '');
  const withoutRanges = raw.replace(rx(VALUE_RANGE_SOURCE, 'giu'), ' ');
  if (rx("[~∼〜]").test(withoutRanges) || rx("(?:^|[\\s\\d])(?:약|대략|대충)", "u").test(raw)) return true;
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

// A bare digit after the multiplier ("4k 7", "1R 5", "2M 2") is the same refusal.
// "4k 5%" is not: the percent token is not a bare digit.
export function hasMalformedRkm(text) {
  return rx("(?:^|[^\\d.])(?:\\d+[kKrR]\\d{2,}|\\d+M\\d{2,}|\\d+(?:\\.\\d+)?\\s*[kKrRM]\\s+\\d+(?![\\d%]))(?!\\d)").test(String(text ?? ''));
}

function pushBreak(breaks, start, end) {
  if (end > start) breaks.push([start, end]);
}

function allowClausePieces(text) {
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
  if (!text || KEEP_CUES.some((cue) => text.includes(cue))) return text;
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
  const tokens = boundOhmTokens(text).filter((token) => !isReplacedSourceValue(text, token.index));
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

function isExplicitRRefDontTouch(clause) {
  return isDontTouchResistorClause(clause) && rx("\\bR\\d+\\b", "i").test(String(clause ?? ''));
}

function isResistorKeepClause(clause) {
  if (isAmbiguousI2cPreservation(clause)) return false;
  // "don't touch R4" keeps that ref. "don't touch the LED resistor" does not:
  // that sentence negates the edit.
  if (isExplicitRRefDontTouch(clause)) return true;
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

function recognizedWord(word, clause) {
  if (!word) return true;
  if (isNegationOrAlternativeWord(word)) return true;
  if (isPoliteIfFiller(word, clause)) return true;
  if (rx("^\\d").test(word) || rx("[Ω옴%]").test(word) || rx("^(?:ohm|ohms|meg)$", "i").test(word)) return true;
  if (isLedAllowWord(word) || isFunctionWord(word) || isEditVerbWord(word)) return true;
  if (isModalOrParticleWord(word) || isDemonstrativeWord(word)) return true;
  if (NOISE_WORDS.has(lower(word)) || NOISE_WORDS.has(word)) return true;
  if (rx("^R\\d+$", "i").test(word)) return true;
  if (isUnboundMeasureNoun(word) && rx("\\b(?:next|beside|near|옆)\\b", "iu").test(clause)) return true;
  if (isKoreanRequestStem(word)) return true;
  // Same stems as isIgnorableWord. They are filler here, and still a noun modifier there.
  if (rx("^괜찮", "u").test(word) || rx("^가능", "u").test(word)) return true;
  if (isApproximationWord(word)) return true;
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
  const english = rx("\\b(?:don't|dont|do not|does not|did not|never)\\s+touch\\b", "i").test(folded);
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

const NEGATION_SIGNALS = [
  String.raw`\b(?:do|does|did)\s+not\b`,
  String.raw`\b(?:don't|dont|not|no|never)\b`,
  String.raw`지\s*말고`,
  String.raw`하지\s*마`,
  String.raw`지\s*마(?![가-힣])`,
  String.raw`말고`,
  String.raw`않`
];

const ALTERNATIVE_SIGNALS = [
  String.raw`\bor\b`,
  String.raw`또는`,
  String.raw`아니면`,
  String.raw`혹은`,
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
// are removed first, including the separator that closed them.
function exemptSignalRanges(text) {
  const pieces = allowClausePieces(text);
  const exempt = [];
  for (const piece of pieces) {
    if (isExemptSignalClause(piece.text)) exempt.push([piece.start, piece.sepEnd]);
  }
  return exempt;
}

function hasSignalOutsideExempt(text, sources, exempt = exemptSignalRanges(text)) {
  return signalIndexes(text, sources).some((index) => !indexInRanges(index, exempt));
}

function hasNegation(text, exempt) {
  return hasSignalOutsideExempt(text, NEGATION_SIGNALS, exempt);
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
  return true;
}

function hasValueAlternative(text, exempt) {
  return hasSignalOutsideExempt(text, ALTERNATIVE_SIGNALS, exempt) || hasMultiValueChoice(text);
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
