import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { parseResistorOhms } from '../kicad/resistor-ohms.js';
import { writeGeneratedProject } from './generate-mcu-project.js';

const FULL_DESIGN_MCU = /\b(stm32|esp32|rp2040|atmega|nrf52|adbms)\b/i;
const FULL_DESIGN_BOARD = /\b(board|usb|regulator|connector|header|sensor)\b|보드|커넥터|헤더|레귤레이터|센서/i;
const KEEP_REST = /keep everything|everything else unchanged|나머지는\s*그대로|그대로\s*두|기존.*(?:유지|그대로)|unchanged/i;
const INVALID_OHM_TOKEN = String.raw`(?<![\p{L}\p{N}_])[A-Za-z]+\s*(?:Ω|옴|ohms?)(?![\p{L}\p{N}_])`;

// Coordinators are built before the table so the clause split can see them.
// "하거나" contains 고, but that 고 is not a new clause.
const DELETION_COORDINATORS = Object.freeze([
  Object.freeze({ id: 'or', lang: 'en', re: String.raw`\bor\b` }),
  Object.freeze({ id: 'and', lang: 'en', re: String.raw`\band\b` }),
  Object.freeze({ id: 'hageona', lang: 'ko', re: '하거나' }),
  Object.freeze({ id: 'geona', lang: 'ko', re: '거나' }),
  Object.freeze({ id: 'na', lang: 'ko', re: '나' }),
  Object.freeze({ id: 'ttoneun', lang: 'ko', re: '또는' }),
  Object.freeze({ id: 'dot', lang: 'ko', re: '·' })
]);

function goClauseSource(coordinators) {
  const tails = [];
  for (const item of coordinators) {
    if (item.lang !== 'ko') continue;
    const match = item.re.match(/고(.+)$/u);
    if (match) tails.push(escapeRegExp(match[1]));
  }
  const tail = tails.length > 0 ? `(?!${tails.join('|')})` : '';
  return String.raw`(?<=[가-힣])고(?!\s*나서)${tail}`;
}

// Every deletion-intent check reads this table. Clause split, verb binding,
// and negation do not keep a second word list.
// 말고 closes the left clause ("제거 말고" is not a removal of that part).
export const DELETION_INTENT_VOCABULARY = Object.freeze({
  positiveVerbs: Object.freeze([
    Object.freeze({ id: 'remove', lang: 'en', re: String.raw`\bremove\b` }),
    Object.freeze({ id: 'delete', lang: 'en', re: String.raw`\bdelete\b` }),
    Object.freeze({ id: 'drop', lang: 'en', re: String.raw`\bdrop\b` }),
    Object.freeze({ id: '삭제', lang: 'ko', re: '삭제' }),
    Object.freeze({ id: '제거', lang: 'ko', re: '제거' }),
    Object.freeze({ id: '지워', lang: 'ko', re: '지워' }),
    Object.freeze({ id: '지우', lang: 'ko', re: '지우' }),
    Object.freeze({ id: '빼', lang: 'ko', re: '(?<![가-힣])빼' })
  ]),
  // `n't` and `not` are separate so "don't not" counts as two markers.
  negationMarkers: Object.freeze([
    Object.freeze({ id: 'no-need-to', re: String.raw`\bno\s+need\s+to\b` }),
    Object.freeze({ id: 'need-to-not', re: String.raw`(?:\b(?:do|does)\s+not|n't)\s+need\s+to\b` }),
    Object.freeze({ id: 'never', re: String.raw`\bnever\b` }),
    Object.freeze({ id: "n't", re: String.raw`n't\b` }),
    Object.freeze({ id: 'dont', re: String.raw`\bdont\b` }),
    Object.freeze({ id: 'not', re: String.raw`\bnot\b` }),
    Object.freeze({ id: 'no', re: String.raw`\bno\b` })
  ]),
  // Korean verb-scope cues. A removal clause that contains one is not a delete.
  // 남기/남겨/유지 are part-scope keeps, not verb-scope, and live below.
  koreanBlockingCues: Object.freeze([
    Object.freeze({ id: '필요 없', re: '필요\\s*없' }),
    Object.freeze({ id: '면 안', re: '면\\s*안' }),
    Object.freeze({ id: '하지 마', re: '하지\\s*마' }),
    Object.freeze({ id: '지 마', re: '지\\s*마' }),
    Object.freeze({ id: '금지', re: '금지' }),
    Object.freeze({ id: '않', re: '(?<![가-힣])않' }),
    Object.freeze({ id: '안', re: '(?<![가-힣])안' }),
    Object.freeze({ id: '말', re: '(?<![가-힣])말' })
  ]),
  partScopeCues: Object.freeze([
    Object.freeze({ id: 'rather-than', re: String.raw`\brather\s+than\b` }),
    Object.freeze({ id: 'but-not', re: String.raw`\bbut\s+not\b` }),
    Object.freeze({ id: 'without', re: String.raw`\bwithout\b` }),
    Object.freeze({ id: 'instead', re: String.raw`\binstead\b` }),
    Object.freeze({ id: 'except', re: String.raw`\bexcept\b` }),
    Object.freeze({ id: 'keep', re: String.raw`\bkeep\b` }),
    Object.freeze({ id: '남겨', re: '남겨' }),
    Object.freeze({ id: '남기', re: '남기' }),
    Object.freeze({ id: '유지', re: '유지' })
  ]),
  // A later clause can take a removal back: "remove I2C. jk", "삭제 노노", "... NOT".
  correctionCues: Object.freeze([
    Object.freeze({ id: 'nono', re: String.raw`(?<![가-힣])노노(?![가-힣])` }),
    Object.freeze({
      id: 'nn',
      // NFKC turns compatibility jamo ㄴ into choseong ᄂ, so both forms count.
      re: String.raw`(?<![\u1100-\u11FF\u3131-\u318E])(?:\u3134\u3134|\u1102\u1102)(?![\u1100-\u11FF\u3131-\u318E])`
    }),
    Object.freeze({ id: 'jk', re: String.raw`\bjk\b` }),
    Object.freeze({ id: 'just-kidding', re: String.raw`\bjust\s+kidding\b` }),
    Object.freeze({ id: 'trailing-not', re: String.raw`(?:\.{3}|…)\s*not\b` })
  ]),
  // Mapped to ASCII ' after NFKC. U+00B4's NFKC form is a space plus U+0301.
  apostrophes: '\u2018\u2019\u201A\u201B\u2032\u2035\u02BC\u02BB\u0060\u00B4\uFF07\u02B9\u02CA\u02CB\uA78C\u055A\u0301',
  // Not removal verbs. They share one negation with a removal verb:
  // "do not change or remove", "삭제하거나 변경하지 마".
  coordinatedVerbs: Object.freeze([
    Object.freeze({ id: 'change', lang: 'en', re: String.raw`\bchange\b` }),
    Object.freeze({ id: 'modify', lang: 'en', re: String.raw`\bmodify\b` }),
    Object.freeze({ id: '변경', lang: 'ko', re: '변경' }),
    Object.freeze({ id: '수정', lang: 'ko', re: '수정' })
  ]),
  coordinators: DELETION_COORDINATORS,
  // Joins two removal targets into one list ("LED and I2C", "LED 또는 I2C",
  // "LED/I2C"). English joins are whole words, so "standard" and "command"
  // are not the conjunction "and". afterComma allows "LED, and I2C".
  targetListJoins: Object.freeze([
    Object.freeze({ id: 'comma', re: ',' }),
    Object.freeze({ id: 'and', re: String.raw`\band\b`, afterComma: true }),
    Object.freeze({ id: 'or', re: String.raw`\bor\b`, afterComma: true }),
    Object.freeze({ id: 'both', re: String.raw`\bboth\b` }),
    Object.freeze({ id: 'amp', re: '&' }),
    Object.freeze({ id: 'slash', re: '/' }),
    Object.freeze({ id: 'ttoneun', re: '또는', afterComma: true }),
    Object.freeze({ id: 'geurigo', re: '그리고', afterComma: true }),
    Object.freeze({ id: 'mit', re: '및', afterComma: true }),
    Object.freeze({ id: 'hago', re: String.raw`하고(?![가-힣])` }),
    Object.freeze({ id: 'irang', re: String.raw`이랑(?![가-힣])` }),
    Object.freeze({ id: 'rang', re: String.raw`랑(?![가-힣])` }),
    Object.freeze({ id: 'wa', re: String.raw`와(?![가-힣])` }),
    Object.freeze({ id: 'gwa', re: String.raw`과(?![가-힣])` })
  ]),
  targetListFillers: Object.freeze([
    Object.freeze({ id: 'the', re: String.raw`\bthe\b` }),
    Object.freeze({ id: 'a', re: String.raw`\ba\b` }),
    Object.freeze({ id: 'an', re: String.raw`\ban\b` }),
    Object.freeze({ id: 'both', re: String.raw`\bboth\b` })
  ]),
  // One Korean particle between a part and the join ("LED를 그리고 I2C").
  listParticles: '[은는이가을를]',
  // "삭제하고 I2C도": group 1 is the span before the also-particle 도.
  alsoAttachments: Object.freeze([
    Object.freeze({
      id: 'hago-do',
      re: String.raw`하고(?![가-힣])\s*([^.!?,]{0,24}?)도(?![가-힣])`
    })
  ]),
  // A resistor value or an edit verb on the other side of a comma is not a
  // second removal target ("remove I2C, LED resistor 680 ohm").
  valueCues: Object.freeze([
    Object.freeze({ id: 'ohm', re: String.raw`ohms?|Ω|옴` }),
    Object.freeze({ id: 'set', re: String.raw`\bset\b` }),
    Object.freeze({ id: 'update', re: String.raw`\bupdate\b` }),
    Object.freeze({ id: 'swap', re: '바꿔' })
  ]),
  // After a Korean verb stem. A particle (은/는/을/를) may sit in between.
  koreanNegationSuffix: String.raw`(?:\s*[은는을를])?\s*(?:하\s*지(?:\s*는)?\s*[마말]|하면\s*안|면\s*안|할\s*필요\s*없|금지|말고|하지\s*않도록|안\s*함|안\s*해도|지(?:\s*는)?\s*[마말]|마(?![가-힣]))`,
  clauseSeparators: Object.freeze([
    Object.freeze({ id: 'and-then', re: String.raw`\band\s+then\b`, negatesLeft: false }),
    Object.freeze({ id: 'and', re: String.raw`\band\b`, negatesLeft: false }),
    Object.freeze({ id: 'but', re: String.raw`\bbut\b`, negatesLeft: false }),
    Object.freeze({ id: 'semicolon', re: ';', negatesLeft: false }),
    Object.freeze({ id: 'go-naseo', re: String.raw`고\s*나서`, negatesLeft: false }),
    Object.freeze({ id: 'hago', re: '하고', negatesLeft: false }),
    Object.freeze({ id: 'jiman', re: '지만', negatesLeft: false }),
    Object.freeze({ id: 'malgo', re: '말고', negatesLeft: true }),
    Object.freeze({ id: 'go', re: goClauseSource(DELETION_COORDINATORS), negatesLeft: false }),
    Object.freeze({ id: 'sentence', re: String.raw`(?<!\d)\.(?!\d)|[!?]`, negatesLeft: false })
  ]),
  parentheticals: Object.freeze(['please', 'just', 'ever', 'really', 'actually', 'simply', 'kindly']),
  auxiliaries: Object.freeze(['do', 'does', 'did', 'should', 'would', 'could', 'must', 'can', 'will', 'shall']),
  subjects: Object.freeze(['i', 'you', 'we', 'they', 'he', 'she']),
  adverbPhrases: Object.freeze(['under any circumstances', 'under any circumstance']),
  targets: Object.freeze([
    Object.freeze({ id: 'i2c', re: String.raw`\bi2c\b|아이\s*2\s*씨|아이씨` }),
    Object.freeze({ id: 'led', re: String.raw`\bled\b|엘이디` }),
    Object.freeze({ id: 'resistor', re: String.raw`\bresistor\b|저항` }),
    Object.freeze({ id: 'pronoun', re: String.raw`\bit\b|그것|이거|그거` })
  ])
});

function editError(message) {
  const error = new Error(message);
  error.code = 'PROVIDER_NO_PATCH';
  return error;
}

export function removalIntentUnclearMessage() {
  const en = 'Which part should I remove? Give its reference, like J2. Nothing was removed.';
  const ko = '어떤 부품을 뺄까요? 참조번호(예: J2)로 알려 주세요. 아무것도 빼지 않았어요.';
  return `${en}\n${ko}`;
}

export function resistorValueInvalidMessage() {
  const en = 'The resistor value is not valid. State a value such as 680Ω or 4.7kΩ. Nothing was changed.';
  const ko = '저항 값이 올바르지 않습니다. 680Ω 또는 4.7kΩ 같은 값을 적어 주세요. 아무것도 바꾸지 않았습니다.';
  return `${en}\n${ko}`;
}

export function modifyRefusalMessage() {
  const en = 'The requested change could not be applied onto the existing design. Describe the change more specifically (name the part or reference and the value), or start a new project for a full redesign. The existing circuit was left unchanged.';
  const ko = '수정 사항을 적용할 수 없습니다. 바꿀 부품이나 참조 이름과 값을 구체적으로 적어 주세요. 전체를 다시 설계하려면 새 프로젝트를 시작하세요. 기존 회로는 바꾸지 않았습니다.';
  return `${en}\n${ko}`;
}

// A prompt that names a new MCU board is a replacement design. A short edit is
// merged onto the saved spec so a resistor change cannot rebuild the board.
// userPrompt is the request text the client sent. When it differs from prompt,
// prompt is a rewritten tool argument. Removal and the resistor value both
// come from the client request. A number that appears only in the rewrite,
// including an example such as 330Ω, is not a value. With no separate
// userPrompt, classification is the single-prompt path. A client request that
// is not a removal or a value edit still regenerates when either text is a
// full board description, so a new project or a full regeneration keeps its preview.
export function classifyExistingProjectRequest(prompt, existingSpec, userPrompt) {
  if (!existingSpec || typeof existingSpec !== 'object') return { mode: 'regenerate' };
  const editText = String(prompt ?? '');
  const hasUser = typeof userPrompt === 'string' && userPrompt.trim().length > 0;
  const intentText = hasUser ? String(userPrompt) : editText;
  const separateIntent = hasUser && intentText.trim() !== editText.trim();
  if (!separateIntent) return classifyPrompt(editText);

  return classifySeparateIntent(editText, intentText);
}

function classifyPrompt(text) {
  if (isFullDesignPrompt(text)) return { mode: 'regenerate' };
  return classifyEditText(text);
}

function classifySeparateIntent(editText, intentText) {
  const removal = removalDecision(intentText);
  if (removal.kind === 'remove') return removalEdit(removal);
  const fromUser = nonRemovalEdit(intentText);
  if (fromUser?.kind === 'invalid') return invalidResistor();
  if (fromUser) return { mode: 'merge', edit: fromUser };
  if (removal.kind === 'unclear') return unclearRemoval();
  if (isFullDesignPrompt(intentText)) return { mode: 'regenerate', prompt: intentText };
  if (isFullDesignPrompt(editText)) return { mode: 'regenerate' };
  return { mode: 'refuse' };
}

function classifyEditText(text) {
  const removal = removalDecision(text);
  if (removal.kind === 'remove') return removalEdit(removal);
  const resistor = nonRemovalEdit(text);
  if (resistor?.kind === 'invalid') return invalidResistor();
  if (resistor) return { mode: 'merge', edit: resistor };
  if (removal.kind === 'unclear') return unclearRemoval();
  return { mode: 'refuse' };
}

function removalEdit(removal) {
  return { mode: 'merge', edit: { kind: 'delete', targets: removal.targets } };
}

function unclearRemoval() {
  return {
    mode: 'refuse',
    code: 'REMOVAL_INTENT_UNCLEAR',
    message: removalIntentUnclearMessage()
  };
}

function invalidResistor() {
  return {
    mode: 'refuse',
    code: 'RESISTOR_VALUE_INVALID',
    message: resistorValueInvalidMessage()
  };
}

function nonRemovalEdit(text) {
  if (isFullDesignPrompt(text)) return null;
  return interpretResistor(text);
}

function isFullDesignPrompt(text) {
  return FULL_DESIGN_MCU.test(text) && FULL_DESIGN_BOARD.test(text) && !KEEP_REST.test(text);
}

// Quoted spans are mentions, not commands, and are dropped before verbs are
// matched. `"remove I2C" is not what I want` therefore has no removal verb.
// Double quotes always count. A balanced '...' pair counts when it is not a
// contraction such as don't or shouldn't.
// Format characters (Cf: ZWSP, ZWNJ, ZWJ, word joiner, BOM, soft hyphen) are
// removed before NFKC, so they cannot hide a negation. U+00B4 then decomposes
// to a space plus combining acute, and that residue is folded back to an
// apostrophe before the other apostrophe-like characters are mapped.
function normalizeDeletionText(text) {
  const apostrophes = [...DELETION_INTENT_VOCABULARY.apostrophes]
    .filter((ch) => ch !== '\u0301')
    .map((ch) => (/[-\\\]^]/.test(ch) ? `\\${ch}` : ch))
    .join('');
  return String(text ?? '')
    .replace(/\p{Cf}/gu, '')
    .normalize('NFKC')
    .replace(/([A-Za-z])[ \u00A0]\u0301([A-Za-z])/gu, "$1'$2")
    .replace(/([A-Za-z])\u0301([A-Za-z])/gu, "$1'$2")
    .replace(new RegExp(`[${apostrophes}]`, 'gu'), "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/\u00A0/g, ' ');
}

function stripQuotedMentions(text) {
  const withoutDouble = text.replace(/"[^"]*"/g, ' ');
  return withoutDouble.replace(/(^|[\s([{])'([^']*)'(?=$|[\s)\].,;:!?])/g, '$1 ');
}

function isSkippableWord(word) {
  const lower = word.toLowerCase();
  const vocab = DELETION_INTENT_VOCABULARY;
  return vocab.parentheticals.includes(lower)
    || vocab.auxiliaries.includes(lower)
    || vocab.subjects.includes(lower);
}

function phraseSource(phrase) {
  return escapeRegExp(phrase).replace(/ /g, '\\s+');
}

function matchEdge(edge, text, source) {
  const re = edge === 'end'
    ? new RegExp(`(?:${source})\\s*$`, 'iu')
    : new RegExp(`^(?:${source})`, 'iu');
  return text.match(re);
}

function consumeEdge(edge, text, source) {
  const match = matchEdge(edge, text, source);
  if (!match || match[0].length === 0) return null;
  return edge === 'end' ? text.slice(0, match.index) : text.slice(match[0].length);
}

function longestEntry(edge, text, entries) {
  let best = null;
  for (const entry of entries) {
    const match = matchEdge(edge, text, entry.re);
    if (!match || match[0].length === 0) continue;
    if (!best || match[0].length > best.length) {
      best = { length: match[0].length, index: match.index, end: match[0].length };
    }
  }
  return best;
}

function longestMarker(edge, text) {
  return longestEntry(edge, text, DELETION_INTENT_VOCABULARY.negationMarkers);
}

function englishBridges() {
  const vocab = DELETION_INTENT_VOCABULARY;
  return [
    ...vocab.coordinators.filter((item) => item.lang === 'en'),
    ...vocab.coordinatedVerbs.filter((item) => item.lang === 'en')
  ];
}

// Markers between a negation and its verb ("don't, please, remove",
// "do not under any circumstances remove") stay in the same clause.
// A comma is a new clause only when the piece is not just that padding.
function wordCarriesNegation(word) {
  return DELETION_INTENT_VOCABULARY.negationMarkers.some((marker) => (
    new RegExp(`(?:${marker.re})$`, 'iu').test(word)
  ));
}

function isParentheticalFragment(segment) {
  if (findVerbs(segment).length > 0) return false;
  let rest = segment.trim();
  if (!rest) return true;
  const phrases = [...DELETION_INTENT_VOCABULARY.adverbPhrases].sort((left, right) => right.length - left.length);
  while (rest.length > 0) {
    rest = rest.replace(/^[\s,]+/u, '');
    if (!rest) return true;
    let ate = false;
    for (const phrase of phrases) {
      const next = consumeEdge('start', rest, phraseSource(phrase));
      if (next != null && next.length < rest.length) {
        rest = next;
        ate = true;
        break;
      }
    }
    if (ate) continue;
    const marker = longestMarker('start', rest);
    if (marker && marker.end > 0) {
      rest = rest.slice(marker.end);
      continue;
    }
    const word = rest.match(/^[A-Za-z]+(?:'[A-Za-z]+)?/u);
    if (!word) return false;
    if (!isSkippableWord(word[0]) && !wordCarriesNegation(word[0])) return false;
    rest = rest.slice(word[0].length);
  }
  return true;
}

function splitCommaClauses(text) {
  const bits = [];
  let cursor = 0;
  const parts = text.split(',');
  for (let index = 0; index < parts.length; index += 1) {
    bits.push({ text: parts[index], start: cursor });
    cursor += parts[index].length + 1;
  }
  const groups = [];
  let pending = null;
  for (let index = 0; index < bits.length; index += 1) {
    const bit = bits[index];
    const last = index === bits.length - 1;
    if (!last && isParentheticalFragment(bit.text)) {
      pending = pending
        ? { start: pending.start, text: `${pending.text},${bit.text}` }
        : { start: bit.start, text: bit.text };
      continue;
    }
    if (pending) {
      groups.push({ start: pending.start, text: `${pending.text},${bit.text}` });
      pending = null;
    } else {
      groups.push(bit);
    }
  }
  if (pending) groups.push(pending);
  return groups
    .map((group) => {
      const lead = group.text.length - group.text.trimStart().length;
      return { text: group.text.trim(), start: group.start + lead };
    })
    .filter((group) => group.text.length > 0);
}

function findSeparators(text) {
  const hits = [];
  for (const sep of DELETION_INTENT_VOCABULARY.clauseSeparators) {
    const re = new RegExp(sep.re, 'giu');
    for (let match = re.exec(text); match; match = re.exec(text)) {
      if (match[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      hits.push({
        index: match.index,
        length: match[0].length,
        negatesLeft: sep.negatesLeft
      });
    }
  }
  hits.sort((left, right) => left.index - right.index || right.length - left.length);
  const kept = [];
  let cursor = 0;
  for (const hit of hits) {
    if (hit.index < cursor) continue;
    kept.push(hit);
    cursor = hit.index + hit.length;
  }
  return kept;
}

function splitClauses(text) {
  const pieces = [];
  const separators = findSeparators(text);
  let start = 0;
  for (const sep of separators) {
    pieces.push({ text: text.slice(start, sep.index), start, negatedBySeparator: sep.negatesLeft });
    start = sep.index + sep.length;
  }
  pieces.push({ text: text.slice(start), start, negatedBySeparator: false });
  const clauses = [];
  for (const piece of pieces) {
    for (const part of splitCommaClauses(piece.text)) {
      clauses.push({
        text: part.text,
        start: piece.start + part.start,
        negatedBySeparator: piece.negatedBySeparator
      });
    }
  }
  return clauses;
}

function findVerbs(text) {
  const verbs = DELETION_INTENT_VOCABULARY.positiveVerbs;
  const re = new RegExp(verbs.map((verb) => `(?:${verb.re})`).join('|'), 'giu');
  const found = [];
  for (let match = re.exec(text); match; match = re.exec(text)) {
    if (match[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    const entry = verbs.find((verb) => new RegExp(`^(?:${verb.re})$`, 'iu').test(match[0]));
    if (!entry) continue;
    found.push({ id: entry.id, lang: entry.lang, index: match.index, length: match[0].length });
  }
  return found;
}

function targetPattern(id) {
  const target = DELETION_INTENT_VOCABULARY.targets.find((item) => item.id === id);
  return target.re;
}

function findMentions(text) {
  const found = [];
  for (const target of DELETION_INTENT_VOCABULARY.targets) {
    const re = new RegExp(target.re, 'giu');
    for (let match = re.exec(text); match; match = re.exec(text)) {
      if (match[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      found.push({ id: target.id, index: match.index, length: match[0].length });
    }
  }
  return found;
}

function closestMention(mentions, verbOffset) {
  return mentions.reduce((best, item) => (
    Math.abs(item.index - verbOffset) < Math.abs(best.index - verbOffset) ? item : best
  ));
}

function explicitPart(text) {
  const led = new RegExp(targetPattern('led'), 'iu').test(text);
  const resistor = new RegExp(targetPattern('resistor'), 'iu').test(text);
  const i2c = new RegExp(targetPattern('i2c'), 'iu').test(text);
  if (led && resistor) return 'led-resistor';
  if (led) return 'led';
  if (i2c) return 'i2c';
  return null;
}

function chooseTarget(windowText, verbOffset, verb) {
  let mentions = findMentions(windowText);
  // English removal objects follow the verb. "keep I2C and remove the LED"
  // must not bind remove to the earlier I2C.
  if (verb?.lang === 'en') {
    const verbEnd = verbOffset + verb.length;
    const after = mentions.filter((item) => item.index >= verbEnd);
    if (after.length > 0) mentions = after;
  }
  const leds = mentions.filter((item) => item.id === 'led');
  const resistors = mentions.filter((item) => item.id === 'resistor');
  const ranked = [];
  if (leds.length > 0 && resistors.length > 0) {
    ranked.push({ id: 'led-resistor', index: closestMention(leds.concat(resistors), verbOffset).index });
  } else if (leds.length > 0) {
    ranked.push({ id: 'led', index: closestMention(leds, verbOffset).index });
  }
  for (const item of mentions) {
    if (item.id === 'i2c' || item.id === 'pronoun') ranked.push(item);
  }
  if (ranked.length === 0) return null;
  ranked.sort((left, right) => Math.abs(left.index - verbOffset) - Math.abs(right.index - verbOffset));
  return ranked[0].id;
}

function verbWindow(text, verbs, index) {
  const verb = verbs[index];
  const start = index === 0 ? 0 : verbs[index - 1].index + verbs[index - 1].length;
  const end = index + 1 < verbs.length ? verbs[index + 1].index : text.length;
  return {
    text: text.slice(start, end),
    verbOffset: verb.index - start,
    verb
  };
}

function koreanCoordinationSource() {
  const vocab = DELETION_INTENT_VOCABULARY;
  const coords = vocab.coordinators
    .filter((item) => item.lang === 'ko')
    .map((item) => item.re)
    .sort((left, right) => right.length - left.length);
  const verbs = vocab.coordinatedVerbs
    .filter((item) => item.lang === 'ko')
    .map((item) => item.re);
  if (coords.length === 0 || verbs.length === 0) return '';
  return `(?:\\s*[은는을를])?(?:\\s*(?:${coords.join('|')})\\s*(?:${verbs.join('|')}))?`;
}

function koreanSuffixNegates(after) {
  const pattern = `^${koreanCoordinationSource()}${DELETION_INTENT_VOCABULARY.koreanNegationSuffix}`;
  return new RegExp(pattern, 'u').test(after);
}

// Any negation in front of the verb blocks it. A second marker ("don't not")
// stays blocked instead of flipping back to a removal.
function englishNegationCount(prefix) {
  let rest = prefix;
  let count = 0;
  const phrases = [...DELETION_INTENT_VOCABULARY.adverbPhrases].sort((left, right) => right.length - left.length);
  const bridges = englishBridges();
  while (rest.length > 0) {
    const trimmed = rest.replace(/[\s,]+$/u, '');
    if (!trimmed) break;
    rest = trimmed;
    let ate = false;
    for (const phrase of phrases) {
      const next = consumeEdge('end', rest, phraseSource(phrase));
      if (next != null) {
        rest = next;
        ate = true;
        break;
      }
    }
    if (ate) continue;
    const marker = longestMarker('end', rest);
    if (marker) {
      rest = rest.slice(0, marker.index);
      count += 1;
      continue;
    }
    // "do not change or remove" — change/or sit between the negation and the verb.
    const bridge = longestEntry('end', rest, bridges);
    if (bridge) {
      rest = rest.slice(0, bridge.index);
      continue;
    }
    const word = rest.match(/[A-Za-z]+(?:'[A-Za-z]+)?$/u);
    if (!word || !isSkippableWord(word[0])) break;
    rest = rest.slice(0, -word[0].length);
  }
  return count;
}

function verbPolarity(window, negatedBySeparator) {
  if (negatedBySeparator) return 'blocked';
  if (window.verb.lang === 'ko') {
    const after = window.text.slice(window.verbOffset + window.verb.length);
    if (koreanSuffixNegates(after)) return 'blocked';
  } else if (englishNegationCount(window.text.slice(0, window.verbOffset)) > 0) {
    return 'blocked';
  }
  if (hasVerbScopeCue(window.text)) return 'blocked';
  return 'positive';
}

export function classifyDeletionIntents(text) {
  const normalized = stripQuotedMentions(normalizeDeletionText(text));
  const intents = [];
  let previousExplicit = null;
  for (const clause of splitClauses(normalized)) {
    const verbs = findVerbs(clause.text);
    if (verbs.length === 0) {
      const mentioned = explicitPart(clause.text);
      if (mentioned) previousExplicit = mentioned;
      continue;
    }
    for (let index = 0; index < verbs.length; index += 1) {
      const window = verbWindow(clause.text, verbs, index);
      const polarity = verbPolarity(window, clause.negatedBySeparator);
      let target = chooseTarget(window.text, window.verbOffset, window.verb);
      if (target === 'pronoun') target = explicitPart(window.text) ?? previousExplicit;
      intents.push({
        verb: window.verb.id,
        target,
        negated: polarity !== 'positive',
        polarity,
        sourceIndex: clause.start + window.verb.index
      });
    }
    const mentioned = explicitPart(clause.text);
    if (mentioned) previousExplicit = mentioned;
  }
  applySameTargetGuard(intents, normalized);
  applyCorrectionCues(intents, normalized);
  return intents;
}

function verbScopeCues() {
  return [
    ...DELETION_INTENT_VOCABULARY.negationMarkers,
    ...DELETION_INTENT_VOCABULARY.koreanBlockingCues,
    ...DELETION_INTENT_VOCABULARY.correctionCues
  ];
}

function hasCue(text, cues) {
  return cues.some((cue) => new RegExp(cue.re, 'iu').test(text));
}

function hasVerbScopeCue(text) {
  return hasCue(text, verbScopeCues());
}

function hasPartScopeCue(text) {
  return hasCue(text, DELETION_INTENT_VOCABULARY.partScopeCues);
}

function blockIntent(intent, flag) {
  intent.polarity = 'blocked';
  intent.negated = true;
  if (flag) intent[flag] = true;
}

function splitSentencesWithIndex(text) {
  const re = /(?<!\d)\.(?!\d)|[!?]/gu;
  const sentences = [];
  let start = 0;
  for (const match of text.matchAll(re)) {
    const end = match.index + match[0].length;
    sentences.push({
      text: text.slice(start, end),
      start,
      end,
      question: match[0] === '?'
    });
    start = end;
  }
  if (start < text.length && text.slice(start).trim()) {
    sentences.push({ text: text.slice(start), start, end: text.length, question: false });
  }
  return sentences;
}

function sentenceMentions(text, target) {
  const mentions = findMentions(text);
  if (mentions.some((item) => item.id === target)) return true;
  if (target === 'led-resistor') {
    return mentions.some((item) => item.id === 'led') && mentions.some((item) => item.id === 'resistor');
  }
  return false;
}

function applySentenceBlocks(intents, normalized) {
  const sentences = splitSentencesWithIndex(normalized);
  for (const intent of intents) {
    if (intent.polarity !== 'positive' || !intent.target) continue;
    const sentence = sentences.find((item) => intent.sourceIndex >= item.start && intent.sourceIndex < item.end);
    if (!sentence) continue;
    if (sentence.question) {
      blockIntent(intent, 'question');
      continue;
    }
    if (hasVerbScopeCue(sentence.text) && sentenceMentions(sentence.text, intent.target)) {
      blockIntent(intent);
    }
  }
}

function nearestMention(mentions, index, length) {
  const center = index + length / 2;
  return mentions.reduce((best, item) => {
    if (!best) return item;
    return Math.abs(item.index - center) < Math.abs(best.index - center) ? item : best;
  }, null);
}

function resolveMentionId(mentions, mention) {
  if (!mention) return null;
  if (mention.id !== 'pronoun') return mention.id;
  const prior = mentions.filter((item) => item.id !== 'pronoun' && item.index < mention.index).at(-1);
  return prior ? prior.id : null;
}

function partsBlockedByKeep(text) {
  const mentions = findMentions(text);
  const blocked = new Set();
  for (const cue of DELETION_INTENT_VOCABULARY.partScopeCues) {
    const re = new RegExp(cue.re, 'giu');
    for (const match of text.matchAll(re)) {
      const nearest = nearestMention(mentions, match.index, match[0].length);
      const id = resolveMentionId(mentions, nearest);
      if (id) blocked.add(id);
    }
  }
  return blocked;
}

function applyPartScope(intents, normalized) {
  const blocked = partsBlockedByKeep(normalized);
  for (const intent of intents) {
    if (intent.polarity === 'positive' && blocked.has(intent.target)) {
      blockIntent(intent, 'corrected');
    }
  }
}

// Bare 안/말/않 are left out. "제거 말고 LED" must not guard the LED.
const SAME_TARGET_SYLLABLE_CUES = new Set(['안', '말', '않']);

function sameTargetGuardCues() {
  return [
    ...DELETION_INTENT_VOCABULARY.negationMarkers,
    ...DELETION_INTENT_VOCABULARY.partScopeCues,
    ...DELETION_INTENT_VOCABULARY.koreanBlockingCues.filter((cue) => !SAME_TARGET_SYLLABLE_CUES.has(cue.id))
  ];
}

function nearestMentionByCenter(mentions, index, length) {
  const center = index + length / 2;
  return mentions.reduce((best, item) => {
    if (!best) return item;
    const itemCenter = item.index + item.length / 2;
    const bestCenter = best.index + best.length / 2;
    return Math.abs(itemCenter - center) < Math.abs(bestCenter - center) ? item : best;
  }, null);
}

function guardedPartIds(text) {
  const mentions = findMentions(text);
  const clauses = splitClauses(text);
  const guarded = new Set();
  for (const cue of sameTargetGuardCues()) {
    const re = new RegExp(cue.re, 'giu');
    for (const match of text.matchAll(re)) {
      const clause = clauses.find((item) => (
        match.index >= item.start && match.index < item.start + item.text.length
      ));
      const pool = clause
        ? mentions.filter((item) => item.index >= clause.start && item.index < clause.start + clause.text.length)
        : [];
      if (pool.length === 0) continue;
      const id = resolveMentionId(mentions, nearestMentionByCenter(pool, match.index, match[0].length));
      if (id) guarded.add(id);
    }
  }
  return guarded;
}

// A negation or keep anywhere in the request binds the nearest part.
// "Don't touch I2C. Now remove it" is not a delete. The same cue does not
// block a different part ("Don't touch I2C. Remove the LED").
function applySameTargetGuard(intents, text) {
  const guarded = guardedPartIds(text);
  if (guarded.size === 0) return;
  for (const intent of intents) {
    if (intent.polarity !== 'positive') continue;
    if (removalPartIds(intent.target).some((id) => guarded.has(id))) blockIntent(intent, 'guarded');
  }
}

// "jk", "노노", and "... NOT" cancel every removal, including one in an earlier clause.
function applyCorrectionCues(intents, text) {
  if (!hasCue(text, DELETION_INTENT_VOCABULARY.correctionCues)) return;
  for (const intent of intents) {
    if (intent.polarity === 'positive') blockIntent(intent, 'corrected');
  }
}

function isCorrectionSentence(text) {
  return /^\s*(?:no|nope|nah|wait|actually|sorry|아니|아니요|아닙니다)\b/iu.test(text);
}

function applyTrailingCorrection(intents, normalized) {
  const sentences = splitSentencesWithIndex(normalized);
  for (const intent of intents) {
    if (intent.polarity !== 'positive') continue;
    const later = sentences.filter((item) => item.start > intent.sourceIndex);
    if (later.some((item) => isCorrectionSentence(item.text))) blockIntent(intent, 'corrected');
  }
}

function applyMultiTargetBlock(intents, normalized) {
  const parts = [];
  for (const intent of intents) {
    if (intent.target !== 'i2c' && intent.target !== 'led' && intent.target !== 'led-resistor') continue;
    if (!parts.includes(intent.target)) parts.push(intent.target);
  }
  if (parts.length < 2) return;
  if (!hasVerbScopeCue(normalized) && !hasPartScopeCue(normalized)) return;
  for (const intent of intents) {
    if (intent.polarity === 'positive') blockIntent(intent, 'multi');
  }
}

function removalPartIds(target) {
  if (target === 'led-resistor') return ['led', 'resistor'];
  if (target === 'i2c' || target === 'led' || target === 'resistor') return [target];
  return [];
}

function listGapPattern() {
  const vocab = DELETION_INTENT_VOCABULARY;
  const byLength = (left, right) => right.re.length - left.re.length;
  const words = vocab.targetListJoins
    .filter((item) => item.id !== 'comma')
    .sort(byLength)
    .map((item) => item.re);
  const afterComma = vocab.targetListJoins
    .filter((item) => item.afterComma)
    .sort(byLength)
    .map((item) => item.re);
  const fillers = vocab.targetListFillers.map((item) => item.re);
  return new RegExp(
    `^(?:${vocab.listParticles}\\s*)?(?:,\\s*(?:${afterComma.join('|')})?|(?:${words.join('|')}))(?:\\s+(?:${fillers.join('|')}))*\\s*$`,
    'iu'
  );
}

function clauseRemainder(text, endIndex) {
  const rest = text.slice(endIndex);
  const match = rest.match(/,|(?<!\d)\.(?!\d)|[!?]/u);
  return match ? rest.slice(0, match.index) : rest;
}

// Digits, ohm units, keep cues, and edit verbs mean the other mention is not
// a second removal object. "connector" and a removal verb still are.
function tailRejectsCoRemoval(tail) {
  if (/\d/u.test(tail)) return true;
  if (hasPartScopeCue(tail)) return true;
  if (hasCue(tail, DELETION_INTENT_VOCABULARY.coordinatedVerbs)) return true;
  if (hasCue(tail, DELETION_INTENT_VOCABULARY.valueCues)) return true;
  return false;
}

function sortedPartMentions(text) {
  return findMentions(text)
    .filter((item) => item.id === 'i2c' || item.id === 'led' || item.id === 'resistor')
    .sort((left, right) => left.index - right.index || right.length - left.length);
}

function listJoinedPartIds(text) {
  const mentions = sortedPartMentions(text);
  const gap = listGapPattern();
  const joined = new Set();
  for (let leftIndex = 0; leftIndex < mentions.length; leftIndex += 1) {
    const left = mentions[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < mentions.length; rightIndex += 1) {
      const right = mentions[rightIndex];
      if (right.index < left.index + left.length || left.id === right.id) continue;
      const between = text.slice(left.index + left.length, right.index);
      if (!gap.test(between.trim())) continue;
      if (tailRejectsCoRemoval(clauseRemainder(text, right.index + right.length))) continue;
      joined.add(left.id);
      joined.add(right.id);
    }
  }
  return joined;
}

function residueOutsideMentions(text) {
  const mentions = findMentions(text).sort((left, right) => left.index - right.index);
  let rest = '';
  let cursor = 0;
  for (const mention of mentions) {
    if (mention.index < cursor) continue;
    rest += text.slice(cursor, mention.index);
    cursor = mention.index + (mention.length ?? 0);
  }
  return rest + text.slice(cursor);
}

function alsoAttachedPartIds(text) {
  const ids = new Set();
  for (const entry of DELETION_INTENT_VOCABULARY.alsoAttachments) {
    const re = new RegExp(entry.re, 'giu');
    for (const match of text.matchAll(re)) {
      const span = match[1] ?? '';
      // "I2C" contains a digit. Judge the words around the part, not the name.
      const residue = residueOutsideMentions(span);
      if (hasPartScopeCue(span) || hasVerbScopeCue(residue) || tailRejectsCoRemoval(residue)) continue;
      const after = clauseRemainder(text, match.index + match[0].length);
      if (hasPartScopeCue(after) || tailRejectsCoRemoval(after)) continue;
      for (const mention of findMentions(span)) {
        if (mention.id === 'i2c' || mention.id === 'led' || mention.id === 'resistor') ids.add(mention.id);
      }
    }
  }
  return ids;
}

// A list of two removal targets is not one candidate. A keep on the other
// side ("remove I2C but keep LED", "LED 삭제하고 I2C는 남겨") is not a list.
// A resistor value on the other side of a comma is not a second removal
// ("remove I2C, LED resistor 680 ohm" stays an I2C removal).
function applyListedRemovalBlock(intents, text) {
  const positive = [];
  const positiveIds = new Set();
  for (const intent of intents) {
    if (intent.polarity !== 'positive') continue;
    positive.push(intent);
    for (const id of removalPartIds(intent.target)) positiveIds.add(id);
  }
  if (positiveIds.size === 0) return;
  const joined = listJoinedPartIds(text);
  let listed = false;
  if (joined.size >= 2) {
    for (const id of positiveIds) {
      if (joined.has(id)) listed = true;
    }
  }
  let also = false;
  for (const id of alsoAttachedPartIds(text)) {
    if (!positiveIds.has(id)) also = true;
  }
  if (!listed && !also) return;
  for (const intent of positive) blockIntent(intent, 'multi');
}

function removalIsUnclear(intents, actionable) {
  if (actionable.length > 1) return true;
  if (intents.some((intent) => intent.question || intent.corrected || intent.multi)) return true;
  const known = intents.some((intent) => (
    intent.target === 'i2c' || intent.target === 'led' || intent.target === 'led-resistor'
  ));
  if (!known) return false;
  return actionable.length !== 1;
}

// Fail closed. A removal candidate exists only when one part is the clear
// object of a removal verb and no negation, keep, question, correction, list,
// or second candidate makes that reading unsafe.
function removalDecision(text) {
  const normalized = stripQuotedMentions(normalizeDeletionText(text));
  const intents = classifyDeletionIntents(text);
  applySentenceBlocks(intents, normalized);
  applyPartScope(intents, normalized);
  applyTrailingCorrection(intents, normalized);
  applyMultiTargetBlock(intents, normalized);
  applyListedRemovalBlock(intents, normalized);
  const actionable = [];
  for (const intent of intents) {
    if (intent.polarity !== 'positive') continue;
    if (intent.target !== 'i2c' && intent.target !== 'led') continue;
    if (!actionable.includes(intent.target)) actionable.push(intent.target);
  }
  if (actionable.length === 1 && !removalIsUnclear(intents, actionable)) {
    return { kind: 'remove', targets: actionable };
  }
  if (removalIsUnclear(intents, actionable)) return { kind: 'unclear' };
  return { kind: 'none' };
}

const RESISTOR_SIGN = /[+\-\u2212\u00B1]/u;
const FOREIGN_GLUED_UNIT = /^(?:ma|ua|µa|na|mv|kv|vdc|vac|hz|khz|mhz|[vawfh])$/iu;
const SPACED_FOREIGN_UNIT = /^\s+(?:mA|uA|µA|nA|mV|kV|VDC|VAC|Hz|kHz|MHz|[VAWFH])\b/iu;
const SPACED_RESISTOR_UNIT = /^\s+(?:kΩ|k옴|ohms?|meg|Ω|옴|[rRkKmM])(?![A-Za-z])/iu;

// The whole token, including a sign, thousands separators, and the unit, is
// handed to parseResistorOhms. A prefix the parser would accept ("1" from
// "1,000", "10" from "-10") is not a value. A token the parser rejects fails
// the edit. Percent and current or voltage units are not resistors.
function scanResistorTokens(text) {
  const normalized = String(text ?? '').normalize('NFKC');
  const valid = [];
  const invalid = [];
  const spans = [];
  const startRe = /(?<![\p{L}\p{N}_.,])\d/gu;
  let found = startRe.exec(normalized);
  while (found) {
    const token = readResistorToken(normalized, found.index);
    if (token.kind === 'valid') {
      valid.push({ ohms: token.ohms, index: token.index, end: token.end });
      spans.push(token);
    } else if (token.kind === 'invalid') {
      invalid.push(token.raw);
      spans.push(token);
    }
    startRe.lastIndex = token.end > found.index ? token.end : found.index + 1;
    found = startRe.exec(normalized);
  }
  for (const match of normalized.matchAll(new RegExp(INVALID_OHM_TOKEN, 'giu'))) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const covered = spans.some((span) => start < span.end && end > span.index);
    if (!covered) invalid.push(match[0]);
  }
  return { normalized, valid, invalid };
}

function readResistorToken(text, digitIndex) {
  let index = digitIndex;
  if (digitIndex > 0 && RESISTOR_SIGN.test(text[digitIndex - 1])) {
    const before = digitIndex > 1 ? text[digitIndex - 2] : '';
    if (!before || !/[\p{L}\p{N}]/u.test(before)) index = digitIndex - 1;
  }
  let end = digitIndex;
  while (end < text.length && /\d/u.test(text[end])) {
    end += 1;
    if (end + 1 < text.length && /[.,]/u.test(text[end]) && /\d/u.test(text[end + 1])) end += 1;
  }
  const percent = /^\s*%/u.exec(text.slice(end));
  if (percent) return { kind: 'skip', end: end + percent[0].length };

  let glued = '';
  while (end < text.length && /[A-Za-zΩ옴]/u.test(text[end])) {
    glued += text[end];
    end += 1;
  }
  if (/^[rRkKmM]$/u.test(glued) && end < text.length && /\d/u.test(text[end])) {
    while (end < text.length && /\d/u.test(text[end])) end += 1;
    while (end < text.length && /[A-Za-zΩ옴]/u.test(text[end])) {
      glued += text[end];
      end += 1;
    }
  }
  if (glued && FOREIGN_GLUED_UNIT.test(glued)) return { kind: 'skip', end };

  let tokenEnd = end;
  if (!glued) {
    const rest = text.slice(end);
    const foreign = SPACED_FOREIGN_UNIT.exec(rest);
    if (foreign) return { kind: 'skip', end: end + foreign[0].length };
    const unit = SPACED_RESISTOR_UNIT.exec(rest);
    if (unit) tokenEnd = end + unit[0].length;
  }
  const raw = text.slice(index, tokenEnd);
  const parsed = parseResistorOhms(raw);
  const ohms = parsed == null ? null : Number(parsed);
  if (ohms > 0) return { kind: 'valid', index, end: tokenEnd, ohms };
  return { kind: 'invalid', index, end: tokenEnd, raw };
}

// Destination sits after "to" / "->" and before "으로" / "로".
// With no marker, the last amount is the new value.
function destinationOhms(text, amounts) {
  if (amounts.length === 0) return null;
  let chosen = null;
  const consider = (markerIndex, amount) => {
    if (!amount) return;
    if (!chosen || markerIndex >= chosen.markerIndex) chosen = { markerIndex, ohms: amount.ohms };
  };
  for (const marker of text.matchAll(/->|→|\bto\b/giu)) {
    const at = marker.index + marker[0].length;
    consider(marker.index, amounts.find((amount) => amount.index >= at));
  }
  // 로부터 / 로서 / 로써 are sources ("from"), not destinations.
  for (const marker of text.matchAll(/으로|로(?!부터|서|써)/gu)) {
    const previous = amounts.findLast((amount) => amount.end <= marker.index);
    if (!previous) continue;
    if (text.slice(previous.end, marker.index).trim() !== '') continue;
    consider(marker.index, previous);
  }
  if (chosen) return chosen.ohms;
  return amounts[amounts.length - 1].ohms;
}

// A resistor edit is read only from this text. An unparseable value, or a
// change that names the LED resistor and gives no value, is invalid. Example
// numbers in some other sentence are not a fallback.
function interpretResistor(text) {
  const scanned = scanResistorTokens(text);
  const normalized = scanned.normalized;
  const pullupOnly = /pull-?up|풀업|\bcc\d\b/i.test(normalized) && !/led|상태|직렬/i.test(normalized);
  if (pullupOnly) return null;
  const aboutLed = /led|저항|resistor|\bstatus\b/i.test(normalized);
  const change = /change|set|update|modify|으로|바꿔|변경|수정|그대로|keep|->|→/i.test(normalized);
  if (!aboutLed && !change) return null;
  if (scanned.invalid.length > 0) return { kind: 'invalid' };
  const ohms = destinationOhms(normalized, scanned.valid);
  if (ohms != null) return { kind: 'resistor', ohms, label: formatResistorLabel(ohms) };
  const asked = aboutLed && /(?:으로|로(?!부터|서|써)|->|→|\bto\b|바꿔|변경)/u.test(normalized);
  if (asked) return { kind: 'invalid' };
  return null;
}

// Same kilo and mega breakpoints as formatOhms in circuit-spec.js.
// Ω stays on values below 1k, matching schematic fields such as 1k and 680Ω.
function formatResistorLabel(ohms) {
  if (!(ohms >= 1000)) return `${ohms}Ω`;
  const nearest = Math.round(ohms);
  const value = Math.abs(ohms - nearest) < 1e-6 ? nearest : ohms;
  const mega = value >= 1_000_000;
  const scaled = mega ? value / 1_000_000 : value / 1000;
  return `${Math.round(scaled * 10) / 10}${mega ? 'M' : 'k'}`;
}

export function applyExistingProjectEdit(spec, edit) {
  const next = structuredClone(spec);
  const sourcePrompt = Object.prototype.hasOwnProperty.call(spec, 'sourcePrompt') ? spec.sourcePrompt : next.sourcePrompt;
  if (edit.kind === 'resistor') applyResistorToSpec(next, edit.label);
  if (edit.kind === 'delete') applyDeletionToSpec(next, edit.targets ?? []);
  next.sourcePrompt = sourcePrompt;
  return next;
}

function applyResistorToSpec(spec, label) {
  const peripherals = Array.isArray(spec.peripherals) ? spec.peripherals : [];
  let foundResistor = false;
  spec.peripherals = peripherals.map((peripheral) => {
    if (peripheral?.kind === 'status-led-resistor') {
      foundResistor = true;
      return { ...peripheral, value: label };
    }
    if (peripheral?.kind === 'status-led' && peripheral.currentLimit) {
      return { ...peripheral, currentLimit: label };
    }
    return peripheral;
  });
  if (!foundResistor) spec.peripherals.push({ kind: 'status-led-resistor', value: label });
  for (const component of spec.schematic?.components ?? []) {
    if (isStatusLedResistor(component)) component.value = label;
  }
  if (Array.isArray(spec.boardProfile?.productionParts)) {
    spec.boardProfile = {
      ...spec.boardProfile,
      productionParts: spec.boardProfile.productionParts.map((part) => (
        part?.role === 'status-led-resistor' ? { ...part, value: label } : part
      ))
    };
  }
}

function isStatusLedResistor(component) {
  if (component?.libId === 'ChatPCB:LED_RESISTOR') return true;
  return component?.ref === 'R3';
}

function applyDeletionToSpec(spec, targets) {
  if (targets.includes('led')) {
    spec.omitStatusLed = true;
    spec.peripherals = (spec.peripherals ?? []).filter((peripheral) => (
      peripheral?.kind !== 'status-led' && peripheral?.kind !== 'status-led-resistor'
    ));
    if (Array.isArray(spec.boardProfile?.productionParts)) {
      spec.boardProfile = {
        ...spec.boardProfile,
        productionParts: spec.boardProfile.productionParts.filter((part) => (
          part?.role !== 'status-led' && part?.role !== 'status-led-resistor'
        ))
      };
    }
  }
  if (!targets.includes('i2c')) return;
  spec.interfaces = (spec.interfaces ?? []).filter((iface) => iface?.kind !== 'i2c');
  spec.peripherals = (spec.peripherals ?? []).filter((peripheral) => peripheral?.kind !== 'i2c-pullups');
  if (Array.isArray(spec.boardProfile?.productionParts)) {
    spec.boardProfile = {
      ...spec.boardProfile,
      productionParts: spec.boardProfile.productionParts.filter((part) => (
        part?.role !== 'i2c-sensor-header'
        && part?.role !== 'i2c-scl-pullup'
        && part?.role !== 'i2c-sda-pullup'
      ))
    };
  }
}

export async function applyMergedProjectEdit({ projectDir, existingSpec, edit }) {
  const next = applyExistingProjectEdit(existingSpec, edit);
  const projectName = await projectBaseName(projectDir);
  if (edit.kind === 'delete') {
    return writeGeneratedProject({ projectDir, spec: next, projectName });
  }
  if (edit.kind === 'resistor') {
    if (await schematicHasReference(projectDir, projectName, 'R3')) {
      return writeResistorEdit({ projectDir, spec: next, label: edit.label });
    }
    // Fixture boards draw the LED without a series resistor until this edit asks for one.
    return writeGeneratedProject({ projectDir, spec: next, projectName });
  }
  throw editError(modifyRefusalMessage());
}

async function schematicHasReference(projectDir, projectName, ref) {
  try {
    const text = await readFile(path.join(projectDir, `${projectName}.kicad_sch`), 'utf8');
    return text.includes(`(property "Reference" "${ref}"`);
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function projectBaseName(projectDir) {
  const names = await readdir(projectDir);
  const specName = names.find((name) => name.endsWith('.chatpcb.json'));
  if (!specName) throw editError(modifyRefusalMessage());
  return specName.slice(0, -'.chatpcb.json'.length);
}

async function writeResistorEdit({ projectDir, spec, label }) {
  const projectName = await projectBaseName(projectDir);
  const files = projectFiles(projectDir, projectName);
  const schematicPath = files.schematic;
  const schematic = await readFile(schematicPath, 'utf8');
  const updatedSchematic = replaceReferenceValue(schematic, 'R3', label);
  if (updatedSchematic === schematic) throw editError(modifyRefusalMessage());
  await writeFile(schematicPath, updatedSchematic, 'utf8');
  await writeOptionalValue(path.join(projectDir, `${projectName}.kicad_pcb`), (text) => replaceReferenceValue(text, 'R3', label));
  const ohms = spiceOhms(label);
  if (ohms) {
    await writeOptionalValue(files.spice, (text) => text.replace(
      /^(RLED\s+\S+\s+\S+\s+)\d+(?:\.\d+)?/m,
      `$1${ohms}`
    ));
  }
  await writeFile(files.spec, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
  return {
    spec,
    files,
    review: null
  };
}

function projectFiles(projectDir, projectName) {
  return {
    project: path.join(projectDir, `${projectName}.kicad_pro`),
    schematic: path.join(projectDir, `${projectName}.kicad_sch`),
    symbolLibrary: path.join(projectDir, 'chatpcb.kicad_sym'),
    symbolTable: path.join(projectDir, 'sym-lib-table'),
    spice: path.join(projectDir, `${projectName}_simulation.cir`),
    spec: path.join(projectDir, `${projectName}.chatpcb.json`)
  };
}

async function writeOptionalValue(filePath, update) {
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  const next = update(text);
  if (next !== text) await writeFile(filePath, next, 'utf8');
}

function replaceReferenceValue(text, ref, value) {
  const pattern = new RegExp(`(\\(property "Reference" "${escapeRegExp(ref)}"[\\s\\S]*?\\(property "Value" ")([^"]*)(")`);
  return text.replace(pattern, `$1${value}$3`);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function spiceOhms(label) {
  const parsed = parseResistorOhms(label);
  if (parsed == null) return null;
  const ohms = Number(parsed);
  if (!(ohms > 0)) return null;
  return String(ohms);
}

export function removedComponents(beforeSpec, afterSpec) {
  const afterRefs = new Set(
    (afterSpec?.schematic?.components ?? []).map((component) => component?.ref).filter(Boolean)
  );
  const removed = [];
  const seen = new Set();
  for (const component of beforeSpec?.schematic?.components ?? []) {
    const ref = component?.ref;
    // A value edit or a profile symbol swap keeps the ref. A missing ref is a removal.
    if (!ref || !component?.libId || afterRefs.has(ref) || seen.has(ref)) continue;
    seen.add(ref);
    removed.push({
      ref,
      libId: component.libId ?? null,
      value: component.value ?? null
    });
  }
  return removed;
}

function listedComponent(component) {
  return [component.ref, component.libId, component.value]
    .filter((part) => part != null && part !== '')
    .join(' ');
}

export function removalFinding(removed) {
  const removedComponents = removed.map((component) => ({
    ref: component.ref,
    libId: component.libId ?? null,
    value: component.value ?? null
  }));
  const listed = removedComponents.map(listedComponent).join(', ');
  const en = `Existing components were removed (${listed}). Apply stays closed until the client confirms this exact set.`;
  const ko = `기존 부품이 빠졌습니다 (${listed}). 클라이언트가 이 목록을 그대로 확인하기 전에는 적용할 수 없습니다.`;
  return {
    id: 'existing-components-removed',
    code: 'existing-components-removed',
    en,
    ko,
    message: `${en} ${ko}`,
    removedComponents
  };
}
