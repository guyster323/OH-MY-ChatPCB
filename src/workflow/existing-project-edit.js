import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { classifyResistorValue } from '../kicad/resistor-ohms.js';
import { writeGeneratedProject } from './generate-mcu-project.js';

const FULL_DESIGN_MCU = /\b(stm32|esp32|rp2040|atmega|nrf52|adbms)\b/i;
const FULL_DESIGN_BOARD = /\b(board|usb|regulator|connector|header|sensor)\b|보드|커넥터|헤더|레귤레이터|센서/i;
const KEEP_REST = /keep everything|everything else unchanged|나머지는\s*그대로|그대로\s*두|기존.*(?:유지|그대로)|unchanged/i;
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
  // "never mind" is a retraction. The shorter negation "never" stays a negation marker.
  correctionCues: Object.freeze([
    Object.freeze({ id: 'nono', re: String.raw`(?<![가-힣])노노(?![가-힣])` }),
    Object.freeze({
      id: 'nn',
      // NFKC turns compatibility jamo ㄴ into choseong ᄂ, so both forms count.
      re: String.raw`(?<![\u1100-\u11FF\u3131-\u318E])(?:\u3134\u3134|\u1102\u1102)(?![\u1100-\u11FF\u3131-\u318E])`
    }),
    // "jk flip-flop" / "jk-flip" names a part. A bare "jk" is still a retraction.
    // Other "not" and "jk" hits stay fail-closed; that over-blocking is a follow-up.
    Object.freeze({ id: 'jk', re: String.raw`\bjk\b(?!\s*-?\s*flip\b)` }),
    Object.freeze({ id: 'just-kidding', re: String.raw`\bjust\s+kidding\b` }),
    Object.freeze({ id: 'trailing-not', re: String.raw`(?:\.{3}|…)\s*not\b` }),
    Object.freeze({ id: 'nvm', re: String.raw`\bnvm\b` }),
    Object.freeze({ id: 'nevermind', re: String.raw`\bnevermind\b` }),
    Object.freeze({ id: 'never-mind', re: String.raw`\bnever\s+mind\b` }),
    Object.freeze({ id: 'scratch-that', re: String.raw`\bscratch\s+that\b` }),
    Object.freeze({ id: 'cancel', re: String.raw`\bcancel\b` }),
    Object.freeze({ id: '취소', re: String.raw`(?<![가-힣])취소(?![가-힣])` }),
    Object.freeze({ id: '아니야', re: String.raw`(?<![가-힣])아니야(?![가-힣])` }),
    Object.freeze({ id: '아냐', re: String.raw`(?<![가-힣])아냐(?![가-힣])` }),
    Object.freeze({ id: '됐어', re: String.raw`(?<![가-힣])됐어(?![가-힣])` }),
    Object.freeze({
      id: 'lone-nieun',
      // A single ㄴ. The doubled form is the nn cue above; the lookahead keeps them apart.
      re: String.raw`(?<![\u1100-\u11FF\u3131-\u318E])(?:\u3134|\u1102)(?![\u1100-\u11FF\u3131-\u318E])`
    })
  ]),
  // Keep/negation whose object is only the rest is not a negation of the named part.
  restPhrases: Object.freeze([
    Object.freeze({ id: 'anything-else', re: String.raw`\banything\s+else\b` }),
    Object.freeze({ id: 'everything-else', re: String.raw`\beverything\s+else\b` }),
    Object.freeze({ id: 'nothing-else', re: String.raw`\bnothing\s+else\b` }),
    Object.freeze({ id: 'the-rest', re: String.raw`\bthe\s+rest\b` }),
    Object.freeze({ id: 'nameoji', re: '나머지' }),
    Object.freeze({ id: 'dareun-geon', re: String.raw`다른\s*건` })
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
    Object.freeze({ id: 'both', re: String.raw`\bboth\b` }),
    Object.freeze({ id: 'that', re: String.raw`\bthat\b` }),
    Object.freeze({ id: 'this', re: String.raw`\bthis\b` }),
    Object.freeze({ id: 'also', re: String.raw`\balso\b` })
  ]),
  // Nouns that name the same part ("the I2C connector", "상태 LED") and do not
  // split a list. "상태" is the status adjective in "상태 LED".
  targetListModifiers: Object.freeze([
    Object.freeze({ id: 'en-noun', re: String.raw`\b(?:connector|header|resistor|part|component)\b` }),
    Object.freeze({ id: 'ko-noun', re: '커넥터|헤더|저항|부품|상태' })
  ]),
  // One Korean particle between a part and the join ("LED를 그리고 I2C").
  // 와/과/랑 are list joins, not particles. 도 is the also-particle.
  listParticles: '[은는이가을를도]',
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
  ]),
  // A reference designator is [A-Za-z]{1,3}\d+. "I2C" is not I2: the boundary
  // fails between the digit and the following letter.
  referenceDesignator: String.raw`\b[A-Za-z]{1,3}\d+\b`
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

export function removalRefNotFoundMessage(ref) {
  const en = `There is no part ${ref} in this project. Nothing was removed.`;
  const ko = `이 프로젝트에는 ${ref} 부품이 없어요. 아무것도 빼지 않았어요.`;
  return `${en}\n${ko}`;
}

// 1, 3, 6, 7, 8, 0 are read with a batchim (과). 2, 4, 5, 9 are open (와).
const REF_BATCHIM_DIGITS = new Set(['0', '1', '3', '6', '7', '8']);

function refParticle(ref) {
  return REF_BATCHIM_DIGITS.has(String(ref).slice(-1)) ? '과' : '와';
}

function englishRefChoice(refs) {
  if (refs.length <= 1) return refs.join('');
  if (refs.length === 2) return `${refs[0]} or ${refs[1]}`;
  return `${refs.slice(0, -1).join(', ')}, or ${refs.at(-1)}`;
}

function koreanRefChoice(refs) {
  let text = String(refs[0] ?? '');
  for (let index = 1; index < refs.length; index += 1) {
    text += `${refParticle(refs[index - 1])} ${refs[index]}`;
  }
  return text;
}

export function removalOneAtATimeMessage(refs) {
  const list = (refs ?? []).map((ref) => String(ref));
  const en = `I can remove one part at a time. Which one first: ${englishRefChoice(list)}? Nothing was removed.`;
  const ko = `한 번에 한 부품만 뺄 수 있어요. ${koreanRefChoice(list)} 중 어느 것부터 뺄까요? 아무것도 빼지 않았어요.`;
  return `${en}\n${ko}`;
}

export function removalRefUnsupportedMessage(ref) {
  const en = `There is no safe removal for ${ref} in this project. Nothing was removed.`;
  const ko = `이 프로젝트에서 ${ref} 부품만 안전하게 빼지는 못해요. 아무것도 빼지 않았어요.`;
  return `${en}\n${ko}`;
}

export function resistorValueInvalidMessage() {
  const en = 'The resistor value is not valid. State a value such as 680Ω or 4.7kΩ. Nothing was changed.';
  const ko = '저항 값이 올바르지 않아요. 680Ω 또는 4.7kΩ 같은 값을 적어 주세요. 아무것도 바꾸지 않았어요.';
  return `${en}\n${ko}`;
}

export function resistorMilliSuffixMessage() {
  const en = 'Use M for megaohms, e.g. 4M7. Nothing was changed.';
  const ko = '메가옴은 M을 써 주세요. 예: 4M7. 아무것도 바꾸지 않았어요.';
  return `${en}\n${ko}`;
}

export function resistorValueOutOfRangeMessage() {
  const en = 'The resistor value must be from 1Ω to 10MΩ. Nothing was changed.';
  const ko = '1Ω~10MΩ 사이 값으로 알려 주세요. 아무것도 바꾸지 않았어요.';
  return `${en}\n${ko}`;
}

export function modifyRefusalMessage() {
  const en = 'The requested change could not be applied onto the existing design. Describe the change more specifically (name the part or reference and the value), or start a new project for a full redesign. The existing circuit was left unchanged.';
  const ko = '수정 사항을 적용할 수 없어요. 바꿀 부품이나 참조 이름과 값을 구체적으로 적어 주세요. 전체를 다시 설계하려면 새 프로젝트를 시작하세요. 기존 회로는 바꾸지 않았어요.';
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
  if (!separateIntent) return classifyPrompt(editText, existingSpec);

  return classifySeparateIntent(editText, intentText, existingSpec);
}

function classifyPrompt(text, spec) {
  if (isFullDesignPrompt(text)) return { mode: 'regenerate' };
  return classifyEditText(text, spec);
}

function classifySeparateIntent(editText, intentText, spec) {
  const removal = removalDecision(intentText, spec);
  const decided = refusalForRemoval(removal);
  if (decided) return decided;
  const fromUser = nonRemovalEdit(intentText);
  if (fromUser?.kind === 'invalid') return invalidResistor(fromUser.reason);
  if (fromUser) return { mode: 'merge', edit: fromUser };
  if (removal.kind === 'unclear') return unclearRemoval();
  if (isFullDesignPrompt(intentText)) return { mode: 'regenerate', prompt: intentText };
  if (isFullDesignPrompt(editText)) return { mode: 'regenerate' };
  return { mode: 'refuse' };
}

function classifyEditText(text, spec) {
  const removal = removalDecision(text, spec);
  const decided = refusalForRemoval(removal);
  if (decided) return decided;
  const resistor = nonRemovalEdit(text);
  if (resistor?.kind === 'invalid') return invalidResistor(resistor.reason);
  if (resistor) return { mode: 'merge', edit: resistor };
  if (removal.kind === 'unclear') return unclearRemoval();
  return { mode: 'refuse' };
}

function refusalForRemoval(removal) {
  if (removal.kind === 'remove') return removalEdit(removal);
  if (removal.kind === 'ref-not-found') {
    return { mode: 'refuse', code: 'REMOVAL_REF_NOT_FOUND', message: removalRefNotFoundMessage(removal.ref) };
  }
  if (removal.kind === 'one-at-a-time') {
    return { mode: 'refuse', code: 'REMOVAL_ONE_AT_A_TIME', message: removalOneAtATimeMessage(removal.refs) };
  }
  if (removal.kind === 'ref-unsupported') {
    return { mode: 'refuse', code: 'REMOVAL_REF_UNSUPPORTED', message: removalRefUnsupportedMessage(removal.ref) };
  }
  return null;
}

function removalEdit(removal) {
  const edit = { kind: 'delete', targets: removal.targets };
  if (removal.refs?.length) edit.refs = removal.refs;
  return { mode: 'merge', edit };
}

function unclearRemoval() {
  return {
    mode: 'refuse',
    code: 'REMOVAL_INTENT_UNCLEAR',
    message: removalIntentUnclearMessage()
  };
}

function invalidResistor(reason) {
  const message = reason === 'range'
    ? resistorValueOutOfRangeMessage()
    : reason === 'milli'
      ? resistorMilliSuffixMessage()
      : resistorValueInvalidMessage();
  return {
    mode: 'refuse',
    code: 'RESISTOR_VALUE_INVALID',
    message
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
// Format characters (Cf) are removed before NFKC, so they cannot hide a
// negation or a retraction. Cf includes bidi controls U+202A–U+202E and
// U+2066–U+2069, plus ZWSP, ZWNJ, ZWJ, word joiner, BOM, and soft hyphen.
// U+00B4 then decomposes to a space plus combining acute, and that residue is
// folded back to an apostrophe before the other apostrophe-like characters
// are mapped.
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
  const refRe = new RegExp(DELETION_INTENT_VOCABULARY.referenceDesignator, 'giu');
  for (const match of text.matchAll(refRe)) {
    if (match[0].length === 0) continue;
    const token = match[0].toUpperCase();
    found.push({ id: `ref:${token}`, index: match.index, length: match[0].length });
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
    if (item.id === 'i2c' || item.id === 'pronoun' || isRefTarget(item.id)) ranked.push(item);
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
  applyUnexplainedResidue(intents, normalized);
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

function isRestOnlyClause(text) {
  if (!hasCue(text, DELETION_INTENT_VOCABULARY.restPhrases)) return false;
  return !findMentions(text).some((item) => (
    item.id === 'i2c' || item.id === 'led' || item.id === 'resistor' || isRefTarget(item.id)
  ));
}

// A verb-scope cue whose clause only names the rest ("anything else", "나머지")
// does not block the removal in the other clause. Other cues still do.
function hasBlockingVerbScopeCue(text) {
  const clauses = splitClauses(text);
  for (const cue of verbScopeCues()) {
    const re = new RegExp(cue.re, 'giu');
    for (const match of text.matchAll(re)) {
      if (match[0].length === 0) continue;
      const clause = clauses.find((item) => (
        match.index >= item.start && match.index < item.start + item.text.length
      ));
      if (!clause || !isRestOnlyClause(clause.text)) return true;
    }
  }
  return false;
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
    if (hasBlockingVerbScopeCue(sentence.text) && sentenceMentions(sentence.text, intent.target)) {
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
  const clauses = splitClauses(text);
  const blocked = new Set();
  for (const cue of DELETION_INTENT_VOCABULARY.partScopeCues) {
    const re = new RegExp(cue.re, 'giu');
    for (const match of text.matchAll(re)) {
      const clause = clauses.find((item) => (
        match.index >= item.start && match.index < item.start + item.text.length
      ));
      // "keep everything else" / "나머지는 유지" does not name the removed part.
      if (clause && isRestOnlyClause(clause.text)) continue;
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

function isRefTarget(target) {
  return typeof target === 'string' && target.startsWith('ref:');
}

function isTrackedTarget(target) {
  return target === 'i2c' || target === 'led' || target === 'led-resistor' || isRefTarget(target);
}

function namedRemovalIds(target) {
  if (target === 'led-resistor') return ['led', 'resistor'];
  if (target === 'i2c' || target === 'led' || target === 'resistor') return [target];
  return [];
}

function removalPartIds(target) {
  if (isRefTarget(target)) return [target];
  return namedRemovalIds(target);
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
  const skip = [
    ...vocab.targetListFillers.map((item) => item.re),
    ...vocab.targetListModifiers.map((item) => item.re),
    vocab.listParticles
  ].join('|');
  // A modifier may sit on either side of the join ("connector and the",
  // "커넥터와", "and also the") without breaking the list.
  return new RegExp(
    `^(?:(?:${skip})\\s*)*(?:,\\s*(?:${afterComma.join('|')})?|(?:${words.join('|')}))(?:\\s*(?:${skip}))*\\s*$`,
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
    .filter((item) => item.id === 'i2c' || item.id === 'led' || item.id === 'resistor' || isRefTarget(item.id))
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
        if (mention.id === 'i2c' || mention.id === 'led' || mention.id === 'resistor' || isRefTarget(mention.id)) {
          ids.add(mention.id);
        }
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
    // Designators are not named parts. Two refs stay a one-at-a-time refusal
    // instead of this list block flipping them to a generic unclear ask.
    for (const id of namedRemovalIds(intent.target)) positiveIds.add(id);
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
  const known = intents.some((intent) => isTrackedTarget(intent.target));
  if (!known) return false;
  return actionable.length !== 1;
}

// Words that may sit next to a removal target without being a second request.
// Bare coordinator 나 is omitted: it is a single syllable and would hide real text.
function residueBlankSources() {
  const vocab = DELETION_INTENT_VOCABULARY;
  const sources = [
    ...vocab.positiveVerbs.map((item) => item.re),
    ...vocab.targets.map((item) => item.re),
    vocab.referenceDesignator,
    ...vocab.targetListFillers.map((item) => item.re),
    ...vocab.targetListModifiers.map((item) => item.re),
    ...vocab.targetListJoins.map((item) => item.re),
    ...vocab.coordinators.filter((item) => item.id !== 'na').map((item) => item.re),
    ...vocab.correctionCues.map((item) => item.re),
    ...vocab.negationMarkers.map((item) => item.re),
    ...vocab.restPhrases.map((item) => item.re),
    String.raw`\b(?:connector|header|standard|bandgap|command)\b`,
    '커넥터|헤더',
    // 하지만 splits on 지만 and leaves the connective 하. 해도/돼 is "may I".
    String.raw`해\s*주세요|해\s*줘|주세요|(?<![가-힣])해도(?![가-힣])|(?<![가-힣])줘(?![가-힣])|(?<![가-힣])자(?![가-힣])|(?<![가-힣])돼(?![가-힣])|(?<![가-힣])하(?![가-힣])`,
    String.raw`(?<![가-힣])[은는이가을를도](?![가-힣])`
  ];
  for (const word of [...vocab.parentheticals, ...vocab.auxiliaries, ...vocab.subjects]) {
    sources.push(String.raw`\b${escapeRegExp(word)}\b`);
  }
  return sources;
}

function hasUnexplainedResidue(clauseText) {
  let rest = clauseText;
  for (const source of residueBlankSources()) {
    rest = rest.replace(new RegExp(source, 'giu'), ' ');
  }
  return /[\p{L}\p{N}]/u.test(rest);
}

// Unknown trailing text in the removal clause ("remove I2C" plus reversed "don't")
// takes the removal back. A clause with no tracked part is left alone, so
// "reset 버튼 삭제" stays a plain refusal.
function applyUnexplainedResidue(intents, text) {
  const clauses = splitClauses(text);
  for (const intent of intents) {
    if (intent.polarity !== 'positive' || !isTrackedTarget(intent.target)) continue;
    const clause = clauses.find((item) => (
      intent.sourceIndex >= item.start && intent.sourceIndex < item.start + item.text.length
    ));
    if (!clause || findVerbs(clause.text).length === 0) continue;
    if (hasUnexplainedResidue(clause.text)) blockIntent(intent, 'corrected');
  }
}

function schematicComponents(spec) {
  const components = spec?.schematic?.components;
  return Array.isArray(components) ? components : [];
}

function refRecord(spec, token) {
  const key = String(token ?? '').toUpperCase();
  if (!key) return null;
  return schematicComponents(spec).find((component) => (
    String(component?.ref ?? '').toUpperCase() === key
  )) ?? null;
}

function displayRef(spec, token) {
  const record = refRecord(spec, token);
  if (record?.ref) return String(record.ref);
  return String(token).toUpperCase();
}

function componentRole(spec, ref) {
  const parts = spec?.boardProfile?.productionParts;
  if (!Array.isArray(parts)) return '';
  const key = String(ref ?? '').toUpperCase();
  const part = parts.find((item) => String(item?.ref ?? '').toUpperCase() === key);
  return String(part?.role ?? '');
}

const DEDICATED_REMOVAL_ROLES = new Set([
  'status-led-resistor',
  'i2c-scl-pullup',
  'i2c-sda-pullup'
]);

// Identity comes from the saved component, never from the letters of the ref.
// A dedicated series resistor or pull-up is not removed on its own.
function machineryForRecord(spec, record) {
  const libId = String(record?.libId ?? '');
  const value = String(record?.value ?? '');
  const role = componentRole(spec, record?.ref);
  if (
    libId === 'ChatPCB:LED_RESISTOR'
    || value === 'LED_RESISTOR'
    || libId === 'ChatPCB:I2C_PULLUP'
    || value === 'I2C_PULLUP'
    || DEDICATED_REMOVAL_ROLES.has(role)
  ) {
    return null;
  }
  if (libId === 'ChatPCB:I2C_CONNECTOR' || value === 'I2C_CONNECTOR' || role === 'i2c-sensor-header') {
    return 'i2c';
  }
  if (libId === 'ChatPCB:STATUS_LED' || value === 'STATUS_LED' || role === 'status-led') {
    return 'led';
  }
  return null;
}

function sameMachinery(spec, token, namedId) {
  const record = refRecord(spec, token);
  if (!record) return false;
  const target = machineryForRecord(spec, record);
  if (!target) return false;
  if (namedId === target) return true;
  return target === 'led' && namedId === 'led-resistor';
}

function resolveRefRemoval(spec, token) {
  const record = refRecord(spec, token);
  if (!record) return { kind: 'ref-not-found', ref: String(token).toUpperCase() };
  const ref = record.ref ? String(record.ref) : String(token).toUpperCase();
  const target = machineryForRecord(spec, record);
  if (!target) return { kind: 'ref-unsupported', ref };
  return { kind: 'remove', targets: [target], refs: [ref] };
}

function designatorsInOrder(text) {
  const re = new RegExp(DELETION_INTENT_VOCABULARY.referenceDesignator, 'giu');
  return [...text.matchAll(re)].map((match) => match[0].toUpperCase());
}

function collectPositiveNamed(intents) {
  const named = [];
  for (const intent of intents) {
    if (intent.polarity !== 'positive') continue;
    for (const id of namedRemovalIds(intent.target)) {
      if (!named.includes(id)) named.push(id);
    }
  }
  return named;
}

function joinedIdsForPositive(text, intents) {
  const joined = listJoinedPartIds(text);
  if (joined.size < 2) return joined;
  const positiveKeys = new Set();
  for (const intent of intents) {
    if (intent.polarity !== 'positive' || !intent.target) continue;
    if (isRefTarget(intent.target)) positiveKeys.add(intent.target);
    for (const id of namedRemovalIds(intent.target)) positiveKeys.add(id);
  }
  if (![...positiveKeys].some((id) => joined.has(id))) return new Set();
  return joined;
}

function collectPositiveRefs(text, intents) {
  const wanted = new Set();
  for (const intent of intents) {
    if (intent.polarity !== 'positive' || !isRefTarget(intent.target)) continue;
    wanted.add(intent.target.slice(4).toUpperCase());
  }
  for (const id of joinedIdsForPositive(text, intents)) {
    if (isRefTarget(id)) wanted.add(id.slice(4).toUpperCase());
  }
  const seen = new Set();
  const ordered = [];
  for (const token of designatorsInOrder(text)) {
    if (!wanted.has(token) || seen.has(token)) continue;
    seen.add(token);
    ordered.push(token);
  }
  return ordered;
}

function joinedNamedBeside(text, intents) {
  return [...joinedIdsForPositive(text, intents)].filter((id) => !isRefTarget(id));
}

// Fail closed. A removal candidate exists only when one part is the clear
// object of a removal verb and no negation, keep, question, correction, list,
// or second candidate makes that reading unsafe. One existing reference is
// removed through the same native deletion as its named part.
function removalDecision(text, spec) {
  const normalized = stripQuotedMentions(normalizeDeletionText(text));
  const intents = classifyDeletionIntents(text);
  applySentenceBlocks(intents, normalized);
  applyPartScope(intents, normalized);
  applyTrailingCorrection(intents, normalized);
  applyMultiTargetBlock(intents, normalized);
  applyListedRemovalBlock(intents, normalized);
  if (intents.some((intent) => intent.question || intent.corrected)) return { kind: 'unclear' };

  const refTokens = collectPositiveRefs(normalized, intents);
  if (refTokens.length >= 2) {
    return { kind: 'one-at-a-time', refs: refTokens.map((token) => displayRef(spec, token)) };
  }
  if (refTokens.length === 1) {
    const named = new Set([...collectPositiveNamed(intents), ...joinedNamedBeside(normalized, intents)]);
    for (const id of named) {
      if (!sameMachinery(spec, refTokens[0], id)) return { kind: 'unclear' };
    }
    return resolveRefRemoval(spec, refTokens[0]);
  }

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

// A candidate carries an ohm unit or an RKM/SI suffix. Package codes, wattage,
// voltage, current, percent, bare numbers, and reference designators are not
// values. The matched text is parsed only by parseResistorOhms.
// A leading sign stays inside the token. Dropping it would read +10Ω as 10Ω.
// The same is true of a comma: 4,7k must not be read as 7k.
const RESISTOR_TOKEN = new RegExp(String.raw`(?<![\p{L}\p{N}_.+,\u2212\u2013\u00B1-])(?:${[
  String.raw`\d+\s*/\s*\d+\s*[Ww](?![A-Za-z])`,
  String.raw`[+\-\u2212\u2013\uFF0D\u00B1]\s*(?:\d+(?:\.\d+)?\s*(?:meg|[kKmMrR])?\s*(?:Ω|옴|ohms?)|\d+[rRkKmM]\d+|\d+(?:\.\d+)?\s*meg|\d+(?:\.\d+)?\s*[rRkKmMuUnNpPfFgGtT]|\d+(?:\.\d+)?(?!\s*%))(?![A-Za-z])`,
  String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?\s*(?:Ω|옴|ohms?)(?![A-Za-z])`,
  String.raw`\d{1,3}(?:,\d+)+(?:\.\d+)?\s*(?:meg|[rRkKmM])(?:\s*(?:Ω|옴|ohms?))?(?![A-Za-z])`,
  String.raw`\d+(?:\.\d+)?[eE][+-]?\d+`,
  String.raw`\d+(?:\.\d+){2,}[A-Za-z]*`,
  String.raw`\d+\.(?!\d)\s*[A-Za-z]+`,
  String.raw`[±]?\s*\d+(?:\.\d+)?\s*%`,
  String.raw`\d+(?:\.\d+)?\s*(?:[mµμuUnN])?[Aa](?![A-Za-z])`,
  String.raw`\d+(?:\.\d+)?\s*[Vv](?:DC|AC|dc|ac)?(?![A-Za-z])`,
  String.raw`\d+(?:\.\d+)?\s*[Ww](?![A-Za-z])`,
  String.raw`\d+(?:\.\d+)?\s*(?:meg|[kKmMrR])?\s*(?:Ω|옴|ohms?)(?![A-Za-z])`,
  String.raw`\d+[rRkKmM]\d+[A-Za-z]+`,
  String.raw`\d+[rRkKmM]\d+`,
  String.raw`\d+(?:\.\d+)?\s*meg(?![A-Za-z])`,
  String.raw`\d+(?:\.\d+)?\s*[rRkKmMuUnNpPfFgGtT](?![A-Za-z])`,
  String.raw`\d+(?:\.\d+)?[A-Za-z]{2,}`,
  String.raw`[A-Za-z]+(?:\s*(?:Ω|옴|ohms?))(?![A-Za-z])`,
  String.raw`[A-Za-z]+\d+`,
  String.raw`\d+(?:\.\d+)?`
].join('|')})`, 'gu');
const RESISTOR_PACKAGE = /^(?:0402|0603|0805|1206)$/;
const RESISTOR_COORDINATOR = /^(?:and|or|하고|와|과|및|그리고)$/iu;
const OHM_UNIT = /(?:Ω|옴|ohm)/iu;

function scanResistorTokens(text) {
  const tokens = [];
  RESISTOR_TOKEN.lastIndex = 0;
  for (const match of text.matchAll(RESISTOR_TOKEN)) {
    const raw = match[0];
    const ignored = isIgnoredResistorToken(raw);
    tokens.push({
      raw,
      index: match.index,
      end: match.index + raw.length,
      attempt: !ignored
    });
  }
  return tokens;
}

function isIgnoredResistorToken(raw) {
  if (/^[rR]\d{2,}$/.test(raw)) return false;
  if (/^[rR]\d$/.test(raw)) return true;
  if (/^[A-Za-z]+\d+$/.test(raw)) return true;
  if (RESISTOR_PACKAGE.test(raw)) return true;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return true;
  if (/^\d+\s*\/\s*\d+\s*[Ww]$/.test(raw)) return true;
  if (/^\d+(?:\.\d+)?\s*[Ww]$/.test(raw)) return true;
  if (/^\d+(?:\.\d+)?\s*(?:[mµμuUnN])?[Aa]$/.test(raw)) return true;
  if (/^\d+(?:\.\d+)?\s*[Vv](?:DC|AC|dc|ac)?$/.test(raw)) return true;
  if (/^[±]?\s*\d+(?:\.\d+)?\s*%$/.test(raw)) return true;
  return false;
}

// "330 and 470 ohm" names two values. A bare number joined only by and/or/하고
// to an ohm-unit value becomes a candidate. Package codes and "to" do not.
function promoteCoordinatedBareValues(tokens, text) {
  const ohmValues = tokens.filter((token) => token.attempt && OHM_UNIT.test(token.raw));
  for (const token of tokens) {
    if (token.attempt || !/^\d+(?:\.\d+)?$/.test(token.raw) || RESISTOR_PACKAGE.test(token.raw)) continue;
    for (const other of ohmValues) {
      const left = token.index < other.index ? token : other;
      const right = token.index < other.index ? other : token;
      if (!RESISTOR_COORDINATOR.test(text.slice(left.end, right.index).trim())) continue;
      token.attempt = true;
      break;
    }
  }
}

// R47 is a value. R12 in "R12 330Ω" is the reference that precedes that value.
function dropLeadingDesignators(tokens) {
  const attempts = tokens.filter((token) => token.attempt);
  for (const token of attempts) {
    if (!/^[rR]\d{2,}$/.test(token.raw)) continue;
    if (attempts.some((other) => other !== token && other.index > token.index)) token.attempt = false;
  }
}

function classifyResistorAttempts(tokens) {
  const valid = [];
  let malformed = false;
  let outOfRange = false;
  let milli = false;
  for (const token of tokens) {
    if (!token.attempt) continue;
    const result = classifyResistorValue(token.raw);
    if (result.reason === 'milli') {
      milli = true;
      continue;
    }
    if (result.reason === 'invalid') {
      malformed = true;
      continue;
    }
    if (result.reason === 'range') {
      outOfRange = true;
      continue;
    }
    valid.push({ ohms: result.ohms, ohmsText: result.ohmsText, index: token.index, end: token.end });
  }
  return { valid, malformed, outOfRange, milli };
}

// "to" / "->" take the next value. "으로" / "로" take the value glued to them.
// 로부터 / 로서 / 로써 are sources. No marker leaves the choice to the caller.
function destinationAmount(text, amounts) {
  let chosen = null;
  const consider = (markerIndex, amount) => {
    if (!amount) return;
    if (!chosen || markerIndex >= chosen.markerIndex) chosen = { markerIndex, amount };
  };
  for (const marker of text.matchAll(/->|→|\bto\b/giu)) {
    consider(marker.index, amounts.find((amount) => amount.index >= marker.index + marker[0].length));
  }
  for (const marker of text.matchAll(/으로|로(?!부터|서|써)/gu)) {
    const previous = amounts.findLast((amount) => amount.end <= marker.index);
    if (!previous) continue;
    if (text.slice(previous.end, marker.index).trim() !== '') continue;
    consider(marker.index, previous);
  }
  return chosen?.amount ?? null;
}

function resistorEdit(amount) {
  return {
    kind: 'resistor',
    ohms: amount.ohms,
    ohmsText: amount.ohmsText,
    label: formatResistorLabel(amount.ohmsText)
  };
}

// A resistor edit is read only from this text. Candidates go through
// parseResistorOhms and then LED_SERIES_RESISTOR_RANGE. Two distinct values
// without a transition marker, or a token the parser rejects, are invalid.
function interpretResistor(text) {
  const normalized = String(text ?? '').normalize('NFKC');
  const pullupOnly = /pull-?up|풀업|\bcc\d\b/i.test(normalized) && !/led|상태|직렬/i.test(normalized);
  if (pullupOnly) return null;
  const aboutLed = /led|저항|resistor|\bstatus\b/i.test(normalized);
  const change = /change|set|update|modify|으로|바꿔|변경|수정|그대로|keep|->|→/i.test(normalized);
  if (!aboutLed && !change) return null;

  const tokens = scanResistorTokens(normalized);
  promoteCoordinatedBareValues(tokens, normalized);
  dropLeadingDesignators(tokens);
  const parsed = classifyResistorAttempts(tokens);
  if (parsed.milli) return { kind: 'invalid', reason: 'milli' };
  if (parsed.malformed) return { kind: 'invalid' };
  if (parsed.outOfRange) return { kind: 'invalid', reason: 'range' };

  const chosen = destinationAmount(normalized, parsed.valid);
  if (chosen) return resistorEdit(chosen);
  const distinct = new Set(parsed.valid.map((amount) => amount.ohmsText));
  if (distinct.size > 1) return { kind: 'invalid' };
  if (distinct.size === 1) return resistorEdit(parsed.valid[parsed.valid.length - 1]);
  const asked = aboutLed && /(?:으로|로(?!부터|서|써)|->|→|\bto\b|바꿔|변경)/u.test(normalized);
  if (asked) return { kind: 'invalid' };
  return null;
}

// Sub-1k keeps the Ω suffix (680Ω, 1.5Ω). Kilo and mega keep every digit of
// the canonical ohms string, so 4990 is 4.99k and 1050000 is 1.05M.
function formatResistorLabel(ohmsText) {
  const text = String(ohmsText);
  const value = Number(text);
  if (value >= 1_000_000) return `${scaleOhms(text, 6)}M`;
  if (value >= 1000) return `${scaleOhms(text, 3)}k`;
  return `${text}Ω`;
}

function scaleOhms(text, places) {
  const [whole, frac = ''] = text.split('.');
  const digits = `${whole}${frac}`.replace(/^0+(?=\d)/, '') || '0';
  const pointFromRight = places + frac.length;
  const padded = digits.padStart(pointFromRight + 1, '0');
  const splitAt = padded.length - pointFromRight;
  const head = padded.slice(0, splitAt).replace(/^0+(?=\d)/, '') || '0';
  const tail = padded.slice(splitAt).replace(/0+$/, '');
  return tail ? `${head}.${tail}` : head;
}

export function applyExistingProjectEdit(spec, edit) {
  const next = structuredClone(spec);
  const sourcePrompt = Object.prototype.hasOwnProperty.call(spec, 'sourcePrompt') ? spec.sourcePrompt : next.sourcePrompt;
  if (edit.kind === 'resistor') applyResistorToSpec(next, edit);
  if (edit.kind === 'delete') applyDeletionToSpec(next, edit.targets ?? []);
  next.sourcePrompt = sourcePrompt;
  return next;
}

function applyResistorToSpec(spec, edit) {
  const label = edit.label;
  const ohmsText = edit.ohmsText;
  const peripherals = Array.isArray(spec.peripherals) ? spec.peripherals : [];
  let foundResistor = false;
  spec.peripherals = peripherals.map((peripheral) => {
    if (peripheral?.kind === 'status-led-resistor') {
      foundResistor = true;
      return { ...peripheral, value: ohmsText };
    }
    if (peripheral?.kind === 'status-led' && peripheral.currentLimit) {
      return { ...peripheral, currentLimit: label };
    }
    return peripheral;
  });
  if (!foundResistor) spec.peripherals.push({ kind: 'status-led-resistor', value: ohmsText });
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
      return writeResistorEdit({
        projectDir,
        spec: next,
        label: edit.label,
        ohmsText: edit.ohmsText
      });
    }
    // Fixture boards draw the LED without a series resistor until this edit asks for one.
    // Regeneration stores the exact ohms text, then the symbol and footprint values
    // are patched back to the lossless label.
    const generated = await writeGeneratedProject({ projectDir, spec: next, projectName });
    await presentResistorLabel(generated, edit.label);
    return generated;
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

async function presentResistorLabel(generated, label) {
  const schematic = await readFile(generated.files.schematic, 'utf8');
  const updatedSchematic = replaceReferenceValue(schematic, 'R3', label);
  if (updatedSchematic !== schematic) await writeFile(generated.files.schematic, updatedSchematic, 'utf8');
  if (generated.files.board) {
    await writeOptionalValue(generated.files.board, (text) => replaceReferenceValue(text, 'R3', label));
  }
  const spec = generated.spec;
  if (!spec || typeof spec !== 'object') return;
  for (const component of spec.schematic?.components ?? []) {
    if (isStatusLedResistor(component)) component.value = label;
  }
  if (Array.isArray(spec.boardProfile?.productionParts)) {
    spec.boardProfile.productionParts = spec.boardProfile.productionParts.map((part) => (
      part?.role === 'status-led-resistor' ? { ...part, value: label } : part
    ));
  }
  await writeFile(generated.files.spec, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
}

async function writeResistorEdit({ projectDir, spec, label, ohmsText }) {
  const projectName = await projectBaseName(projectDir);
  const files = projectFiles(projectDir, projectName);
  const schematicPath = files.schematic;
  const schematic = await readFile(schematicPath, 'utf8');
  const updatedSchematic = replaceReferenceValue(schematic, 'R3', label);
  if (updatedSchematic === schematic) throw editError(modifyRefusalMessage());
  await writeFile(schematicPath, updatedSchematic, 'utf8');
  await writeOptionalValue(path.join(projectDir, `${projectName}.kicad_pcb`), (text) => replaceReferenceValue(text, 'R3', label));
  if (ohmsText) {
    await writeOptionalValue(files.spice, (text) => text.replace(
      /^(RLED\s+\S+\s+\S+\s+)\d+(?:\.\d+)?/m,
      `$1${ohmsText}`
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
  const ko = `기존 부품이 빠졌어요 (${listed}). 클라이언트가 이 목록을 그대로 확인하기 전에는 적용할 수 없어요.`;
  return {
    id: 'existing-components-removed',
    code: 'existing-components-removed',
    en,
    ko,
    message: `${en} ${ko}`,
    removedComponents
  };
}
