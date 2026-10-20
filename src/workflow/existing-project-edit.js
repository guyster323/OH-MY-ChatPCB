import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function compileRegExp(source, flags) {
  return new RegExp(source, flags);
}

import { classifyResistorValue, isLoneMilliResistorSuffix, isSpacedRkmValue, parseResistorOhms } from '../kicad/resistor-ohms.js';
import { normalizeMatchText } from '../runtime/match-text.js';
import { loneMilliCountsAsResistor } from '../runtime/quantity-tokens.js';
import { writeGeneratedProject } from './generate-mcu-project.js';
import {
  I2C_PART_ID,
  I2C_PART_PATTERN,
  approximateAfter,
  approximateBefore,
  assessRequestCoverage,
  hasMalformedRkm,
  RKM_FRACTION_SEPARATOR,
  isAdviceQuestion,
  isCounterFollow,
  isCounterLead,
  isDemonstrativeWord,
  isEditVerbWord,
  isFunctionWord,
  isKnownRoleWord,
  isLedAllowWord,
  isLedResistorSynonymPiece,
  LED_RESISTOR_SYNONYMS,
  matchesLedResistorModifiers,
  isModalOrParticleWord,
  isNegationOrAlternativeWord,
  isAmbiguousI2cPreservation,
  isDontDeleteClause,
  isKoreanRequestStem,
  decimalBeforeKeepFragments,
  keepClauseSpans,
  isPermittedEdit,
  isPoliteIfFiller,
  isReplacedSourceValue,
  tildeJoinsResistorRange,
  isUnboundMeasureAfter,
  libIdNamesResistor,
  specRoleNamesResistor,
  textHasKnownRole,
  textHasLengthObject,
  textHasUsbRole
} from './resistor-vocabulary.js';

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
    Object.freeze({ id: 'en-noun', re: String.raw`\b(?:connector|header|resistor|part|component|status)\b` }),
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
    Object.freeze({ id: I2C_PART_ID, re: I2C_PART_PATTERN }),
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

function resistorTargetUnclearError(ohmsText) {
  const error = new Error(resistorTargetUnclearMessage(ohmsText));
  error.code = 'RESISTOR_TARGET_UNCLEAR';
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

// The example is the first offered ref, so "J2 and D1" asks for "remove J2".
function removalVerbExample(ref) {
  const shown = String(ref || 'J2');
  const en = `I can remove one part at a time. Say it like "remove ${shown}". Nothing was removed.`;
  const ko = `한 번에 한 부품만 뺄 수 있어요. "${shown} 빼"처럼 하나씩 말해 주세요. 아무것도 빼지 않았어요.`;
  return `${en}\n${ko}`;
}

export function removalOneAtATimeMessage(refs) {
  const list = (refs ?? []).map((ref) => String(ref)).filter((ref) => ref.length > 0);
  return removalVerbExample(list[0]);
}

export function removalNeedsVerbMessage(ref) {
  return removalVerbExample(ref);
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

// 0, 1, 3, 6, 7, 8 have a batchim. Ω is read 옴, so 330Ω takes 과.
const VALUE_BATCHIM_DIGITS = new Set(['0', '1', '3', '6', '7', '8']);
const VALUE_BATCHIM_LATIN = new Set(['l', 'm', 'n', 'r', 'z']);

function valueHasBatchim(value) {
  const text = String(value ?? '').trim();
  const last = text.at(-1) ?? '';
  if (!last) return false;
  const code = last.codePointAt(0);
  if (code >= 0xAC00 && code <= 0xD7A3) return (code - 0xAC00) % 28 !== 0;
  if (last >= '0' && last <= '9') return VALUE_BATCHIM_DIGITS.has(last);
  if (last === 'Ω' || last === 'Ω' || last === '%') return true;
  if (/[A-Za-z]/.test(last)) return VALUE_BATCHIM_LATIN.has(last.toLowerCase());
  return false;
}

function koreanOhmChoice(labels) {
  if (labels.length <= 1) return labels.join('');
  let text = String(labels[0] ?? '');
  for (let index = 1; index < labels.length; index += 1) {
    text += `${valueHasBatchim(labels[index - 1]) ? '과' : '와'} ${labels[index]}`;
  }
  return text;
}

function englishOhmChoice(labels) {
  if (labels.length <= 1) return labels.join('');
  if (labels.length === 2) return `${labels[0]} or ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, or ${labels.at(-1)}`;
}

export function resistorValueAmbiguousMessage(ref, labels) {
  const listed = englishOhmChoice(labels);
  const en = ref
    ? `Which value should ${ref} use: ${listed}? Nothing was changed.`
    : `Which value should the resistor use: ${listed}? Nothing was changed.`;
  const koTarget = ref ?? '저항';
  const ko = `${koTarget}에 ${koreanOhmChoice(labels)} 중 어느 값을 쓸까요? 아무것도 바꾸지 않았어요.`;
  return `${en}\n${ko}`;
}

// A negation never picks a value. Two ohm values, or a choice between them,
// still use resistorValueAmbiguousMessage, which names both.
export function resistorAmbiguousMessage() {
  const en = 'It isn\'t clear whether to make the change or leave it. Nothing was changed.';
  const ko = '바꾸라는 건지 바꾸지 말라는 건지 분명하지 않아요. 아무것도 바꾸지 않았어요.';
  return `${en}\n${ko}`;
}

export function resistorChangeAmbiguousMessage() {
  return resistorAmbiguousMessage();
}

export function resistorUnitlessMessage() {
  const en = 'Add a unit (Ω, k, M), e.g. 330Ω. Nothing was changed.';
  const ko = '단위(Ω, k, M)를 붙여 주세요. 예: 330Ω. 아무것도 바꾸지 않았어요.';
  return `${en}\n${ko}`;
}

// The digits the user typed, with Ω only in the question. 4700 stays 4700Ω.
export function resistorUnitRequiredMessage(number) {
  const shown = `${String(number ?? '').trim()}Ω`;
  const en = `Change it to ${shown}? Say it again with a unit, like "${shown}". Nothing was changed.`;
  const ko = `${shown}으로 바꿀까요? '${shown}'처럼 단위를 붙여서 다시 말해 주세요. 아무것도 바꾸지 않았어요.`;
  return `${en}\n${ko}`;
}

export function resistorTargetUnclearMessage(ohmsText) {
  const label = formatResistorLabel(ohmsText);
  const shown = /[ΩΩ옴]/.test(label) ? label : `${label}Ω`;
  const particle = valueHasBatchim(shown) ? '을' : '를';
  const exampleParticle = valueHasBatchim(label) ? '으로' : '로';
  const en = `Which resistor should use ${shown}? Say it like "LED resistor to ${label}". Nothing was changed.`;
  const ko = `${shown}${particle} 어느 저항에 쓸까요? "LED 저항 ${label}${exampleParticle}"처럼 말해 주세요. 아무것도 바꾸지 않았어요.`;
  return `${en}\n${ko}`;
}

export function resistorRefNotFoundMessage(ref, { ledHint = false } = {}) {
  const hintEn = ledHint
    ? ' Say "LED resistor" instead, like "LED resistor to 470Ω".'
    : '';
  const hintKo = ledHint
    ? ' "LED 저항 470Ω으로"처럼 \'LED 저항\'이라고 말해 주세요.'
    : '';
  const en = `There is no part ${ref} in this project.${hintEn} Nothing was changed.`;
  const ko = `이 프로젝트에는 ${ref} 부품이 없어요.${hintKo} 아무것도 바꾸지 않았어요.`;
  return `${en}\n${ko}`;
}

// The reference is read letter by letter, so the topic particle is always 는.
// The value particle follows the lossless label (330Ω이에요, 4.7k예요).
export function resistorValueUnchangedMessage(ref, label) {
  const shown = String(label);
  const ending = valueHasBatchim(shown) ? '이에요' : '예요';
  const en = `${ref} is already ${shown}. Nothing was changed.`;
  const ko = `${ref}는 이미 ${shown}${ending}. 바꾼 것은 없어요.`;
  return `${en}\n${ko}`;
}

// seriesRef is omitted when this project does not have an LED series resistor yet.
export function resistorRefUnsupportedMessage(seriesRef) {
  const ref = seriesRef ? String(seriesRef) : '';
  const en = ref
    ? `I can only change the LED resistor (${ref}) for now. Nothing was changed.`
    : 'I can only change the LED resistor for now. Nothing was changed.';
  const ko = ref
    ? `지금은 LED 저항(${ref})만 바꿀 수 있어요. 아무것도 바꾸지 않았어요.`
    : '지금은 LED 저항만 바꿀 수 있어요. 아무것도 바꾸지 않았어요.';
  return `${en}\n${ko}`;
}

export function resistorRefAmbiguousMessage(refs) {
  const list = (refs ?? []).map((ref) => String(ref)).filter((ref) => ref.length > 0);
  const en = `I can change one resistor at a time. Which one: ${englishOhmChoice(list)}? Nothing was changed.`;
  const ko = `한 번에 한 저항만 바꿀 수 있어요. ${koreanOhmChoice(list)} 중 어느 것을 바꿀까요? 아무것도 바꾸지 않았어요.`;
  return `${en}\n${ko}`;
}

export function mixedRemovalAndEditMessage() {
  const en = 'Please ask for one change at a time: the removal or the resistor value. Nothing was changed.';
  const ko = '한 번에 한 가지만 요청해 주세요. 부품 빼기와 저항 값 바꾸기 중 하나만요. 아무것도 바꾸지 않았어요.';
  return `${en}\n${ko}`;
}

export function modifyRefusalMessage() {
  const en = 'The requested change could not be applied onto the existing design. Describe the change more specifically (name the part or reference and the value), or start a new project for a full redesign. The existing circuit was left unchanged.';
  const ko = '수정 사항을 적용할 수 없어요. 바꿀 부품이나 참조 이름과 값을 구체적으로 적어 주세요. 전체를 다시 설계하려면 새 프로젝트를 시작하세요. 기존 회로는 바꾸지 않았어요.';
  return `${en}\n${ko}`;
}

const HANGUL = /[가-힣]/u;

// Guidance is `${english}\n${korean}`. A known locale keeps one half.
// A missing locale, an unknown tag, or any other message stays as written.
export function messageForLocale(message, locale) {
  if (typeof message !== 'string') return message;
  const lang = clientLanguage(locale);
  if (!lang) return message;
  const splitAt = message.indexOf('\n');
  if (splitAt <= 0 || message.indexOf('\n', splitAt + 1) !== -1) return message;
  const en = message.slice(0, splitAt);
  const ko = message.slice(splitAt + 1);
  if (!en || !ko || HANGUL.test(en) || !HANGUL.test(ko)) return message;
  return lang === 'ko' ? ko : en;
}

function clientLanguage(locale) {
  if (typeof locale !== 'string') return null;
  const primary = locale.trim().toLowerCase().replaceAll('_', '-').split('-')[0];
  return primary === 'en' || primary === 'ko' ? primary : null;
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
  const editText = normalizeMatchText(prompt);
  const hasUser = typeof userPrompt === 'string' && userPrompt.trim().length > 0;
  const intentText = hasUser ? normalizeMatchText(userPrompt) : editText;
  const separateIntent = hasUser && intentText.trim() !== editText.trim();
  if (!separateIntent) return classifyPrompt(editText, existingSpec);

  return classifySeparateIntent(editText, intentText, existingSpec);
}

function classifyPrompt(text, spec) {
  if (isFullDesignPrompt(text)) return { mode: 'regenerate' };
  return classifyEditText(text, spec);
}

function classifySeparateIntent(editText, intentText, spec) {
  // "Add a status LED" is not a resistor edit. A full board in either text still regenerates.
  if (isAdditionRequest(intentText) && !isFullDesignPrompt(intentText)) {
    if (isFullDesignPrompt(editText)) return { mode: 'regenerate' };
    return { mode: 'refuse' };
  }
  const valueOnly = valueOnlyDecision(intentText);
  if (valueOnly) return valueOnly;
  const bare = bareRefDecision(intentText, spec);
  if (bare) return bare;
  const grouping = groupingFromRefusal(intentText);
  if (grouping) return grouping;
  const removal = removalDecision(intentText, spec);
  const fromUser = nonRemovalEdit(intentText);
  if (isMixedRemovalAndEdit(removal, fromUser)) return mixedRemovalAndEdit();
  const decided = refusalForRemoval(removal);
  if (decided) return decided;
  const valuedKeep = valuedKeepRefusal(intentText, spec);
  if (valuedKeep?.mode) return valuedKeep;
  const keptBody = valuedKeep?.remainder ?? intentText;
  const keptUser = keptBody === intentText ? fromUser : nonRemovalEdit(keptBody);
  const finishedUser = finishResistor(keptBody, spec, keptUser);
  if (finishedUser) return finishedUser;
  if (removal.kind === 'unclear') return unclearRemoval();
  if (isFullDesignPrompt(intentText)) return { mode: 'regenerate', prompt: intentText };
  if (isFullDesignPrompt(editText)) return { mode: 'regenerate' };
  return { mode: 'refuse' };
}

// add / insert / 추가 / 넣어 always reach the provider. "additional" is not an add verb.
function isAdditionRequest(text) {
  return /\b(?:add|insert)\b|추가|넣어/iu.test(String(text ?? '').normalize('NFKC'));
}

function classifyEditText(text, spec) {
  if (isAdditionRequest(text)) return { mode: 'refuse' };
  const valueOnly = valueOnlyDecision(text);
  if (valueOnly) return valueOnly;
  const bare = bareRefDecision(text, spec);
  if (bare) return bare;
  const grouping = groupingFromRefusal(text);
  if (grouping) return grouping;
  const removal = removalDecision(text, spec);
  const resistor = nonRemovalEdit(text);
  if (isMixedRemovalAndEdit(removal, resistor)) return mixedRemovalAndEdit();
  const decided = refusalForRemoval(removal);
  if (decided) return decided;
  // Bind a value inside a keep clause before that clause is stripped. The ohms
  // name the kept part, so they must not land on R3. A valued keep is dropped
  // and the remainder is classified when one LED resistor and one value stay.
  const valuedKeep = valuedKeepRefusal(text, spec);
  if (valuedKeep?.mode) return valuedKeep;
  const keptBody = valuedKeep?.remainder ?? text;
  const keptResistor = keptBody === text ? resistor : nonRemovalEdit(keptBody);
  const finished = finishResistor(keptBody, spec, keptResistor);
  if (finished) return finished;
  const caught = coverageCatch(keptBody, spec);
  if (caught) return caught;
  if (removal.kind === 'unclear') return unclearRemoval();
  return { mode: 'refuse' };
}

// A positive removal beside a resistor value is one request with two changes.
// Applying either half would drop the other. A negated removal ("삭제하지 마")
// is not affirmative, so it is not this mixed refusal.
function isMixedRemovalAndEdit(removal, resistor) {
  if (!removal?.affirmative) return false;
  if (resistor?.kind === 'resistor') return true;
  return resistor?.kind === 'invalid' && resistor.valued === true;
}

function mixedRemovalAndEdit() {
  return {
    mode: 'refuse',
    code: 'MIXED_REMOVAL_AND_EDIT',
    message: mixedRemovalAndEditMessage()
  };
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

function coverageRefusal(text, spec, coverage, code) {
  if (code === 'RESISTOR_REF_UNSUPPORTED') {
    return {
      mode: 'refuse',
      code,
      message: resistorRefUnsupportedMessage(seriesResistorRef(spec))
    };
  }
  const ohmsText = coverage?.valueToken ? (parseResistorOhms(coverage.valueToken) ?? null) : null;
  return {
    mode: 'refuse',
    code: 'RESISTOR_TARGET_UNCLEAR',
    message: resistorTargetUnclearMessage(ohmsText)
  };
}

// A known role with no value, or an unknown role word beside a value, never
// reaches the provider. Questions and unbound k tokens still do.
function coverageCatch(text, spec) {
  if (isAdviceQuestion(text)) return null;
  if (isQuestionShaped(text) && !isPermittedEdit(text)) return null;
  // A removal sentence with no resistor value stays on the deletion path.
  // "지워줘" and "제거" are removal verbs. They are not a valueless role edit.
  if (!resistorEditCoverage(text, spec).hasBoundValue && findVerbs(text).length > 0) return null;
  const coverage = resistorEditCoverage(text, spec);
  if (coverage.approximate) return null;
  if (coverage.foreignRole && coverage.resistorMention && !coverage.hasBoundValue) {
    return coverageRefusal(text, spec, coverage, 'RESISTOR_REF_UNSUPPORTED');
  }
  if (coverage.unknownRoleValue && !coverage.hasBoundValue) {
    return coverageRefusal(text, spec, coverage, 'RESISTOR_TARGET_UNCLEAR');
  }
  if (coverage.unknownRoleValue && coverage.hasBoundValue && !/저항|抵抗|\bresistor\b|\bled/iu.test(text)) {
    return coverageRefusal(text, spec, coverage, 'RESISTOR_TARGET_UNCLEAR');
  }
  return null;
}

function valuedKeepFragmentDefers(fragment) {
  return /커패시터|콘덴서|캐패시터|capacitor|\bcaps?\b|케이블|cable|connector|커넥터/iu.test(fragment);
}

function valuedKeepCueTouches(text, cue, object) {
  if (cue.start < object.end && cue.end > object.start) return true;
  if (cue.end <= object.start && /^\s*$/u.test(text.slice(cue.end, object.start))) return true;
  return object.end <= cue.start && /^\s*$/u.test(text.slice(object.end, cue.start));
}

function bareGlueWord(token) {
  return token.replace(/^[("'`]+|[)"'`.;!?。！？,]+$/gu, '');
}

function choiceJoinerWord(token) {
  return /^(?:or|또는|아니면)$/iu.test(bareGlueWord(token));
}

// A decimal in 4.7k hides a before-cue from the span list. The fragment still
// begins with the choice word when that word joins the keep.
function decimalChoiceKeep(text) {
  return decimalBeforeKeepFragments(text).some((fragment) => {
    const word = fragment.match(/\S+/u);
    return word != null && choiceJoinerWord(word[0]);
  });
}

// "4.7k or so" approximates 4.7k. That "or" does not join a second choice.
function orSoApproximation(text, end) {
  return /^\s+so\b/iu.test(String(text ?? '').slice(end));
}

// "or", "또는", and "아니면" are a choice. A valued keep joined by one of them
// stays in the sentence. "or so" is an approximation, not that choice.
// null tells the caller not to strip that keep.
function choiceKeepJoiner(text, ranges) {
  for (const word of text.matchAll(/\S+/gu)) {
    const start = word.index;
    const end = start + word[0].length;
    if (!choiceJoinerWord(word[0])) continue;
    if (/^or$/iu.test(bareGlueWord(word[0])) && orSoApproximation(text, end)) continue;
    const joined = ranges.some(([spanStart, spanEnd]) => (
      (start < spanEnd && end > spanStart)
      || (spanEnd <= start && /^\s*$/u.test(text.slice(spanEnd, start)))
      || (end <= spanStart && /^\s*$/u.test(text.slice(end, spanStart)))
    ));
    if (joined) return true;
  }
  return false;
}

// "but" and "and" are not a clause break. They are only the glue beside a valued keep.
function valuedKeepGlueRanges(text, ranges) {
  if (choiceKeepJoiner(text, ranges)) return null;
  const extra = [];
  for (const word of text.matchAll(/\S+/gu)) {
    const start = word.index;
    const end = start + word[0].length;
    if (ranges.some(([spanStart, spanEnd]) => start < spanEnd && end > spanStart)) continue;
    const bare = bareGlueWord(word[0]);
    if (!/^(?:but|and|그리고|하고|및|이랑)$/iu.test(bare)) continue;
    const touches = ranges.some(([spanStart, spanEnd]) => (
      (spanEnd <= start && /^\s*$/u.test(text.slice(spanEnd, start)))
      || (end <= spanStart && /^\s*$/u.test(text.slice(end, spanStart)))
    ));
    if (touches) extra.push([start, end]);
  }
  return extra;
}

function ledResistorTargetCount(text) {
  return resistorNounKinds(text).filter((kind) => kind === 'led').length;
}

function distinctRemainderOhms(text) {
  const tokens = scanResistorTokens(text);
  markNonResistorQuantities(tokens, text);
  promoteCoordinatedBareValues(tokens, text);
  dropLeadingDesignators(tokens);
  const parsed = classifyResistorAttempts(tokens);
  return new Set(parsed.valid.map((amount) => amount.ohmsText)).size;
}

// "R3 at 2.2kΩ as-is" hides R3 behind the decimal. The span list still treats
// that dot as a boundary, so a keep of another ref is not stripped. A keep of
// the series ref, or of an LED-resistor synonym, is ambiguous instead.
function decimalKeepNamesEditTarget(text, spec) {
  const series = seriesResistorRef(spec);
  if (!series) return false;
  const seriesKey = String(series).toUpperCase();
  for (const fragment of decimalBeforeKeepFragments(text)) {
    const kept = new Set();
    addKeptIdentity(kept, fragment, series, 'keep');
    if (kept.has(seriesKey)) return true;
  }
  return false;
}

function ambiguousValuedKeep() {
  return {
    mode: 'refuse',
    code: 'RESISTOR_AMBIGUOUS',
    message: resistorAmbiguousMessage()
  };
}

// A valued keep names some other part. Drop that span and its ohms. One LED
// resistor and one value left is that edit. Nothing left stays ambiguous.
// Anything else refuses the same way as the whole-request keep.
// A keep of R3, or of an LED-resistor synonym, is read on the raw text.
// Stripping that clause first would leave a clean edit and change R3.
function valuedKeepRefusal(text, spec) {
  // A decimal value hides a before-cue from the span list. Refuse that keep
  // when it names this edit before the empty-span return.
  if (decimalKeepNamesEditTarget(text, spec)) return ambiguousValuedKeep();
  if (decimalChoiceKeep(text)) return ambiguousValuedKeep();
  const found = keepClauseSpans(text);
  const objects = found.objects.filter((object) => object.valued === true);
  if (objects.length === 0) return null;
  // A capacitor or cable keep keeps its own refusal. A resistor keep that
  // carries the ohms must not lend that value to R3.
  if (objects.every((object) => valuedKeepFragmentDefers(text.slice(object.start, object.end)))) return null;
  if (keepNamesEditTarget(text, spec)) return ambiguousValuedKeep();
  const dropping = objects.filter((object) => !valuedKeepFragmentDefers(text.slice(object.start, object.end)));
  // "keep R4 at 1k, LED resistor to 680Ω" keeps R4. The LED head after the
  // comma stays the edit. A keep of "it" still hides that head, so R4 left
  // outside the clause cannot borrow the ohms.
  const ranges = dropping.map((object) => {
    const identityEnd = keepIdentityEnd(text, object.start, object.end);
    const identity = text.slice(object.start, identityEnd);
    const otherPart = identityEnd < object.end
      && (resistorReferenceTokens(identity).length > 0 || textHasKnownRole(identity));
    return [object.start, otherPart ? identityEnd : object.end];
  });
  for (const cue of found.cues) {
    if (dropping.some((object) => valuedKeepCueTouches(text, cue, object))) ranges.push([cue.start, cue.end]);
  }
  const glue = valuedKeepGlueRanges(text, ranges);
  if (glue == null) return ambiguousValuedKeep();
  const remainder = blankCopy(text, [...ranges, ...glue]);
  const targets = ledResistorTargetCount(remainder);
  const values = distinctRemainderOhms(remainder);
  if (targets === 0 && values === 0) return ambiguousValuedKeep();
  if (targets === 1 && values === 1) return { remainder };
  return ambiguousValuedKeep();
}

// it/them/those/that and 그것/그거/이것. A keep cue may contain "it" ("the way it is");
// that cue is blanked with the kept role before this test.
const EDIT_ONLY_PRONOUN = /(?:\b(?:it|them|those|that)\b|그것|그거|이것)/iu;

function keepSpanRanges(found) {
  const ranges = [];
  for (const object of found.objects) ranges.push([object.start, object.end]);
  for (const cue of found.cues) ranges.push([cue.start, cue.end]);
  return ranges;
}

// A kept pull-up, CC resistor, or other R ref is not the LED series part.
function otherResistorRoleKept(text, spec) {
  const found = keepClauseSpans(text);
  if (found.objects.length === 0) return false;
  const series = String(seriesResistorRef(spec) ?? '').toUpperCase();
  for (const object of found.objects) {
    const fragment = text.slice(object.start, object.end);
    if (textHasKnownRole(fragment) || textHasUsbRole(fragment)) return true;
    if (resistorReferenceTokens(fragment).some((ref) => ref !== series)) return true;
  }
  return false;
}

function explicitResistorEditTarget(text) {
  return /저항|抵抗|\bresistors?\b|\bleds?\b|엘이디|엘예디|\bR\d+\b/iu.test(text);
}

// After a keep hides another resistor, "set them to 2.2k" has no noun left.
// That pronoun does not name R3. An explicit LED resistor in the edit still does.
function pronounOnlyEditAfterOtherKeep(text, spec) {
  if (!otherResistorRoleKept(text, spec)) return false;
  const remainder = blankCopy(text, keepSpanRanges(keepClauseSpans(text)));
  if (!clauseCarriesResistorValue(remainder)) return false;
  if (explicitResistorEditTarget(remainder)) return false;
  if (textHasKnownRole(remainder) || textHasUsbRole(remainder)) return false;
  if (resistorReferenceTokens(remainder).length > 0) return false;
  return EDIT_ONLY_PRONOUN.test(remainder);
}

function finishResistor(text, spec, resistor) {
  if (!resistor) return null;
  if (resistor.kind === 'resistor' && pronounOnlyEditAfterOtherKeep(text, spec)) {
    return ambiguousValuedKeep();
  }
  // A keep, don't-touch, or leave-alone object that is this edit's own target
  // is read here, before that object is stripped out of the sentence.
  if (resistor.kind === 'resistor' && keepNamesEditTarget(text, spec)) {
    return {
      mode: 'refuse',
      code: 'RESISTOR_AMBIGUOUS',
      message: resistorAmbiguousMessage()
    };
  }
  const coverage = resistorEditCoverage(text, spec);
  // A value belongs to the role in its own clause. Any non-LED role that has a
  // value refuses the whole request, so that ohms value cannot land on R3.
  // A negated keep ("두지 말고", "don't keep") stays visible and still counts.
  // A length clause is not that value: "USB 케이블 1m" asks which resistor.
  if (foreignRoleClauseHasValue(text) && !(resistor.kind === 'resistor' && coverage.lengthClause)) {
    return coverageRefusal(text, spec, coverage, 'RESISTOR_REF_UNSUPPORTED');
  }
  // Negation asks whether to change anything. A choice of values asks which
  // value. A valued foreign role above still wins. Milli, unitless, and two
  // named ohm values are not kind resistor, except a negation of that choice.
  if (coverage.negated && (resistor.kind === 'resistor' || resistor.reason === 'ambiguous')) {
    return {
      mode: 'refuse',
      code: 'RESISTOR_AMBIGUOUS',
      message: resistorAmbiguousMessage()
    };
  }
  if (coverage.alternative && resistor.reason === 'ambiguous') return invalidResistor(resistor);
  if (coverage.alternative && resistor.kind === 'resistor') {
    const label = resistor.label ? [resistor.label] : [];
    return {
      mode: 'refuse',
      code: 'RESISTOR_VALUE_AMBIGUOUS',
      message: resistorValueAmbiguousMessage(null, label)
    };
  }
  // A non-LED role is refused before the value is judged. 0.1Ω and 10mΩ on a
  // sense or shunt resistor are still "only the LED resistor", not a range error.
  // "current sense" is that role. It is not the LED current-limiting resistor.
  const masked = maskGuardObjects(text);
  const roleKind = foreignRoleKind(masked);
  // A known role is "only the LED resistor". An unknown word beside a value
  // asks which resistor, including "terminator 120Ω" and "NRST 10k".
  if (roleKind === 'unknown' && resistor.kind === 'resistor') {
    return coverageRefusal(text, spec, coverage, 'RESISTOR_TARGET_UNCLEAR');
  }
  if (roleKind === 'foreign' && !(resistor.kind === 'resistor' && coverage.lengthClause) && !coverage.keepNonResistor) {
    const foreign = foreignRoleDecision(text, spec, resistor);
    if (foreign) return foreign;
  }
  // A wrong ref is reported before we ask for a unit, so R1 470 stays unsupported.
  // Milli and other invalid values also win over a mixed-in length clause.
  // Two values with no transition ask which value. An unknown role that owns
  // one of them asks which resistor instead. Milli and malformed values still win.
  if (resistor.kind === 'invalid' && resistor.reason !== 'unit-required' && resistor.reason !== 'ambiguous') {
    return invalidResistor(resistor);
  }
  if (resistor.kind === 'invalid' && resistor.reason === 'ambiguous') {
    if (coverage.unknownRoleValue) return coverageRefusal(text, spec, coverage, 'RESISTOR_TARGET_UNCLEAR');
    if (coverage.foreignRole || foreignRoleClauseHasValue(text)) {
      return coverageRefusal(text, spec, coverage, 'RESISTOR_REF_UNSUPPORTED');
    }
    return invalidResistor(resistor);
  }
  // A keep of a capacitor, cable, or other non-resistor is leftover content.
  if (resistor.kind === 'resistor' && coverage.keepNonResistor) {
    return coverageRefusal(text, spec, coverage, 'RESISTOR_TARGET_UNCLEAR');
  }
  const gated = resistorRefDecision(text, spec, resistor);
  if (gated) return gated;
  const foreign = foreignRoleDecision(text, spec, resistor);
  if (foreign && !(resistor.kind === 'resistor' && coverage.lengthClause)) return foreign;
  if (resistor.kind === 'invalid') return invalidResistor(resistor);
  // "from 2.2k to 680Ω" applies only when the saved value is 2.2k.
  // A different saved value means the from-value names some other part.
  const mismatch = statedFromMismatch(text, spec);
  if (resistor.kind === 'resistor' && mismatch) {
    return {
      mode: 'refuse',
      code: 'RESISTOR_VALUE_AMBIGUOUS',
      message: resistorValueAmbiguousMessage(namedResistorRef(text), [
        formatResistorLabel(mismatch.source.ohmsText),
        formatResistorLabel(mismatch.destination.ohmsText)
      ])
    };
  }
  const unchanged = unchangedResistor(spec, resistor);
  if (unchanged) return unchanged;
  if (resistor.kind === 'resistor' && coverage.lengthClause) {
    return coverageRefusal(text, spec, coverage, 'RESISTOR_TARGET_UNCLEAR');
  }
  if (resistor.kind === 'resistor' && (coverage.foreignRole || unkeptForeignRole(text))) {
    return coverageRefusal(text, spec, coverage, 'RESISTOR_REF_UNSUPPORTED');
  }
  if (resistor.kind === 'resistor' && !coverage.covered) {
    return coverageRefusal(text, spec, coverage, 'RESISTOR_TARGET_UNCLEAR');
  }
  // An LED series edit needs the saved series resistor. A status-led peripheral
  // or a lone LED symbol is not that part, so the edit must not add one.
  if (!hasLedSeriesRole(spec) && resistor.kind === 'resistor') {
    return coverageRefusal(text, spec, coverage, 'RESISTOR_TARGET_UNCLEAR');
  }
  return { mode: 'merge', edit: { ...resistor, ref: seriesResistorRef(spec) } };
}

function invalidResistor(result) {
  const reason = typeof result === 'string' ? result : result?.reason;
  if (reason === 'ambiguous') {
    const labels = (result?.values ?? []).map((amount) => formatResistorLabel(amount.ohmsText));
    return {
      mode: 'refuse',
      code: 'RESISTOR_VALUE_AMBIGUOUS',
      message: resistorValueAmbiguousMessage(result?.ref ?? null, labels)
    };
  }
  const message = reason === 'range'
    ? resistorValueOutOfRangeMessage()
    : reason === 'milli'
      ? resistorMilliSuffixMessage()
      : reason === 'unit-required'
        ? resistorUnitRequiredMessage(result?.number)
        : reason === 'unitless'
          ? resistorUnitlessMessage()
          : resistorValueInvalidMessage();
  return {
    mode: 'refuse',
    code: reason === 'unit-required' ? 'RESISTOR_UNIT_REQUIRED' : 'RESISTOR_VALUE_INVALID',
    message
  };
}

const PRE_PROVIDER_REMOVAL_CODES = new Set([
  'MIXED_REMOVAL_AND_EDIT',
  'REMOVAL_INTENT_UNCLEAR',
  'REMOVAL_NEEDS_VERB',
  'REMOVAL_ONE_AT_A_TIME',
  'REMOVAL_REF_NOT_FOUND',
  'REMOVAL_REF_UNSUPPORTED'
]);
const RESISTOR_EDIT_VERB = /(?:\b(?:change|set|update|make|modify|to)\b|바꿔|변경|수정|(?<!기준)으로|(?<!으)로(?!부터|서|써)|を|に)/iu;
const OPEN_QUESTION = /[?？]|뭐|무엇|왜|어떻게|어떡|몇|괜찮|\b(?:why|what|how|which)\b/iu;

function hasResistorEditVerb(text) {
  return RESISTOR_EDIT_VERB.test(text);
}

function englishResistorMilli(text) {
  const spaced = /\bresistor\s+(\d+\s+m\d+)/iu.exec(text);
  if (spaced && isLoneMilliResistorSuffix(spaced[1])) return true;
  const match = /\bresistor\s+(\S+)/iu.exec(text);
  return match != null && isLoneMilliResistorSuffix(match[1]);
}

function hasResistorTargetText(text) {
  if (/저항|抵抗|\bresistor\b/iu.test(text)) return true;
  return resistorReferenceTokens(text).length > 0;
}

// The daemon calls this before the provider. Removal handling stays.
// A resistor refusal stops the provider only when the whole input is one
// value token, or a resistor target and an edit verb are both present.
// A unit question stops here too, including "R3 470".
// Ref-safety codes still stop here, except a question with no edit verb.
export function blocksBeforeProvider(text, decision) {
  if (decision?.mode !== 'refuse' || !decision.code) return false;
  if (PRE_PROVIDER_REMOVAL_CODES.has(decision.code)) return true;
  const normalized = normalizeMatchText(text).trim();
  if (valueOnlyDecision(normalized)) return true;
  if (OPEN_QUESTION.test(normalized) && !hasResistorEditVerb(normalized)) return false;
  if (decision.code === 'RESISTOR_VALUE_INVALID' && hasMalformedRkm(normalized)) return true;
  // "LED resistor 4m7" and "LED resistor 4 m7" name the value on the resistor
  // word. Korean marks that same object with 로 ("LED 저항 4m7로", "LED 저항 4 m7로").
  if (decision.code === 'RESISTOR_VALUE_INVALID' && englishResistorMilli(normalized)) return true;
  if (decision.code === 'RESISTOR_UNIT_REQUIRED') return true;
  if (decision.code === 'RESISTOR_VALUE_UNCHANGED' || decision.code === 'RESISTOR_TARGET_UNCLEAR') return true;
  if (decision.code === 'RESISTOR_AMBIGUOUS') return true;
  if (decision.code === 'RESISTOR_VALUE_AMBIGUOUS') return true;
  if (hasResistorTargetText(normalized) && hasResistorEditVerb(normalized)) return true;
  return decision.code.startsWith('RESISTOR_REF_');
}

// A covered allow-list edit is applied locally. Anything left over does not merge.
export function appliesBeforeProvider(text, decision, spec = null) {
  if (decision?.mode !== 'merge' || decision.edit?.kind !== 'resistor') return false;
  return resistorEditCoverage(text, spec).covered;
}

function nonRemovalEdit(text) {
  if (isFullDesignPrompt(text)) return null;
  return interpretResistor(text);
}

const VALUE_ONLY_TAIL = /(?:\s*(?:으로|로|요|please))$/iu;
const BARE_REF_TAIL = /(?:\s*(?:부터|먼저|first|please))+$/iu;
const BARE_REF_GAP = /^(?:[\s,/&]+|\s*(?:and|or|와|과|랑|하고|및|그리고)\s*)+$/iu;

function wholeResistorToken(text) {
  RESISTOR_TOKEN.lastIndex = 0;
  const match = RESISTOR_TOKEN.exec(text);
  const next = match ? RESISTOR_TOKEN.exec(text) : null;
  RESISTOR_TOKEN.lastIndex = 0;
  if (!match || next || match.index !== 0 || match[0].length !== text.length) return null;
  return match[0];
}

// The whole request is one resistor token, optionally with a particle. A valid
// value asks which resistor. It is not applied to R3. A bare number asks for a unit.
function valueOnlyDecision(text) {
  const normalized = normalizeMatchText(text).trim();
  if (!normalized) return null;
  const stripped = normalized.replace(VALUE_ONLY_TAIL, '').trim();
  if (!stripped) return null;
  const raw = wholeResistorToken(stripped);
  if (!raw) return null;
  if (/^[A-Za-z]{1,3}\d+$/.test(raw) || RESISTOR_PACKAGE.test(raw)) return null;
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    if (/^\d+\.\d{3}$/.test(raw)) return invalidResistor({ reason: 'invalid' });
    const result = classifyResistorValue(raw);
    if (result.ohmsText == null || !(Number(raw) > 0)) {
      return invalidResistor({ reason: result.reason === 'milli' ? 'milli' : (result.reason === 'invalid' ? 'invalid' : 'range') });
    }
    return invalidResistor({ reason: 'unitless' });
  }
  const result = classifyResistorValue(raw);
  if (result.ohmsText != null) {
    return {
      mode: 'refuse',
      code: 'RESISTOR_TARGET_UNCLEAR',
      message: resistorTargetUnclearMessage(result.ohmsText)
    };
  }
  return invalidResistor({ reason: result.reason });
}

function bareReferenceList(text) {
  let body = stripQuotedMentions(normalizeDeletionText(text)).trim();
  if (!body) return null;
  body = body.replace(BARE_REF_TAIL, '').trim();
  if (!body) return null;
  const designator = compileRegExp(DELETION_INTENT_VOCABULARY.referenceDesignator, 'giu');
  const refs = [];
  let last = 0;
  for (const match of body.matchAll(designator)) {
    const gap = body.slice(last, match.index);
    if (refs.length === 0) {
      if (gap.trim() !== '') return null;
    } else if (!BARE_REF_GAP.test(gap)) {
      return null;
    }
    refs.push(match[0]);
    last = match.index + match[0].length;
  }
  if (refs.length === 0 || body.slice(last).trim() !== '') return null;
  return refs;
}

// A previous clarification is not on the request, so a bare ref is not a removal.
function bareRefDecision(text, spec) {
  const refs = bareReferenceList(text);
  if (!refs) return null;
  const shown = refs.map((token) => displayRef(spec, token));
  if (shown.length >= 2) {
    return {
      mode: 'refuse',
      code: 'REMOVAL_ONE_AT_A_TIME',
      message: removalOneAtATimeMessage(shown)
    };
  }
  if (!refRecord(spec, refs[0])) {
    return {
      mode: 'refuse',
      code: 'REMOVAL_REF_NOT_FOUND',
      message: removalRefNotFoundMessage(shown[0])
    };
  }
  return {
    mode: 'refuse',
    code: 'REMOVAL_NEEDS_VERB',
    message: removalNeedsVerbMessage(shown[0])
  };
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
// Dashes fold to ASCII '-' and whitespace collapses with the other matchers.
// U+00B4 then decomposes to a space plus combining acute, and that residue is
// folded back to an apostrophe before the other apostrophe-like characters
// are mapped.
function normalizeDeletionText(text) {
  const apostrophes = [...DELETION_INTENT_VOCABULARY.apostrophes]
    .filter((ch) => ch !== '\u0301')
    .map((ch) => (/[-\\\]^]/.test(ch) ? `\\${ch}` : ch))
    .join('');
  // Match normalization runs first. U+00B4's NFKC form is a space plus
  // combining acute, and that residue is still folded back to an apostrophe.
  return normalizeMatchText(text)
    .replace(/([A-Za-z])[ \u00A0]\u0301([A-Za-z])/gu, "$1'$2")
    .replace(/([A-Za-z])\u0301([A-Za-z])/gu, "$1'$2")
    .replace(compileRegExp(`[${apostrophes}]`, 'gu'), "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"');
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
    ? compileRegExp(`(?:${source})\\s*$`, 'iu')
    : compileRegExp(`^(?:${source})`, 'iu');
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
    compileRegExp(`(?:${marker.re})$`, 'iu').test(word)
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
    const re = compileRegExp(sep.re, 'giu');
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
  const re = compileRegExp(verbs.map((verb) => `(?:${verb.re})`).join('|'), 'giu');
  const found = [];
  for (let match = re.exec(text); match; match = re.exec(text)) {
    if (match[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    const entry = verbs.find((verb) => compileRegExp(`^(?:${verb.re})$`, 'iu').test(match[0]));
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
    const re = compileRegExp(target.re, 'giu');
    for (let match = re.exec(text); match; match = re.exec(text)) {
      if (match[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      found.push({ id: target.id, index: match.index, length: match[0].length });
    }
  }
  const refRe = compileRegExp(DELETION_INTENT_VOCABULARY.referenceDesignator, 'giu');
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
  const led = compileRegExp(targetPattern('led'), 'iu').test(text);
  const resistor = compileRegExp(targetPattern('resistor'), 'iu').test(text);
  const i2c = compileRegExp(targetPattern(I2C_PART_ID), 'iu').test(text);
  if (led && resistor) return 'led-resistor';
  if (led) return 'led';
  if (i2c) return I2C_PART_ID;
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
    if (item.id === I2C_PART_ID || item.id === 'pronoun' || isRefTarget(item.id)) ranked.push(item);
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
  return compileRegExp(pattern, 'u').test(after);
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
  return cues.some((cue) => compileRegExp(cue.re, 'iu').test(text));
}

function hasVerbScopeCue(text) {
  return hasCue(text, verbScopeCues());
}

function isRestOnlyClause(text) {
  if (!hasCue(text, DELETION_INTENT_VOCABULARY.restPhrases)) return false;
  return !findMentions(text).some((item) => (
    item.id === I2C_PART_ID || item.id === 'led' || item.id === 'resistor' || isRefTarget(item.id)
  ));
}

// A verb-scope cue whose clause only names the rest ("anything else", "나머지")
// does not block the removal in the other clause. Other cues still do.
function hasBlockingVerbScopeCue(text) {
  const clauses = splitClauses(text);
  for (const cue of verbScopeCues()) {
    const re = compileRegExp(cue.re, 'giu');
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
    const re = compileRegExp(cue.re, 'giu');
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
    const re = compileRegExp(cue.re, 'giu');
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
    if (intent.target !== I2C_PART_ID && intent.target !== 'led' && intent.target !== 'led-resistor') continue;
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
  return target === I2C_PART_ID || target === 'led' || target === 'led-resistor' || isRefTarget(target);
}

function namedRemovalIds(target) {
  if (target === 'led-resistor') return ['led', 'resistor'];
  if (target === I2C_PART_ID || target === 'led' || target === 'resistor') return [target];
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
  return compileRegExp(
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
    .filter((item) => item.id === I2C_PART_ID || item.id === 'led' || item.id === 'resistor' || isRefTarget(item.id))
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
    const re = compileRegExp(entry.re, 'giu');
    for (const match of text.matchAll(re)) {
      const span = match[1] ?? '';
      // "I2C" contains a digit. Judge the words around the part, not the name.
      const residue = residueOutsideMentions(span);
      if (hasPartScopeCue(span) || hasVerbScopeCue(residue) || tailRejectsCoRemoval(residue)) continue;
      const after = clauseRemainder(text, match.index + match[0].length);
      if (hasPartScopeCue(after) || tailRejectsCoRemoval(after)) continue;
      for (const mention of findMentions(span)) {
        if (mention.id === I2C_PART_ID || mention.id === 'led' || mention.id === 'resistor' || isRefTarget(mention.id)) {
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
    rest = rest.replace(compileRegExp(source, 'giu'), ' ');
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
    if (hasUnexplainedResidue(clause.text)) {
      blockIntent(intent, 'corrected');
      // The verb itself was not negated. Residue such as "후" or a value in
      // the same clause blocked it, so a resistor edit must not proceed alone.
      intent.residue = true;
    }
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

// The editable series resistor is the saved part, not whichever R-ref was typed.
function isEditableLedSeriesResistor(spec, record) {
  if (!record) return false;
  const libId = String(record.libId ?? '');
  const value = String(record.value ?? '');
  const role = String(record.role || componentRole(spec, record.ref) || '');
  return libId === 'ChatPCB:LED_RESISTOR'
    || value === 'LED_RESISTOR'
    || role === 'status-led-resistor';
}

function seriesResistorRef(spec) {
  for (const component of schematicComponents(spec)) {
    if (component?.ref && isEditableLedSeriesResistor(spec, component)) return String(component.ref);
  }
  const parts = spec?.boardProfile?.productionParts;
  if (!Array.isArray(parts)) return null;
  const part = parts.find((item) => item?.role === 'status-led-resistor' && item?.ref);
  return part ? String(part.ref) : null;
}

// The series role is the saved series resistor. A status-led peripheral, even
// one that carries currentLimit, is not that part. The generator still draws
// D1 when the prompt says "No LED", and that symbol is not a resistor either.
function hasLedSeriesRole(spec) {
  return Boolean(seriesResistorRef(spec));
}

// A kept part is not an edit target. The object is the few words before
// 그대로/유지/남겨/unchanged, or after keep/without. A word that starts with a
// digit is a value, so the walk stops there and the value stays an edit.
const GUARD_BEFORE = /남겨|남기|유지|그대로|\bunchanged\b/iu;
const GUARD_AFTER = /\b(?:keep|without)\b/iu;
const GUARD_AFTER_STOP = /^(?:change|set|update|make|modify|to)$|(?:바꿔|변경|수정)/iu;
const OHM_VALUE_IN_CLAUSE = /\d+(?:\.\d+)?\s*(?:Ω|옴|ohms?\b|[rRkK]\b)|\d+(?:\.\d+)?\s*[kKmM]\d*\b|\d+\s*[rR]\d+/iu;

function maskGuardObjects(text) {
  const normalized = String(text ?? '').normalize('NFKC');
  const chars = normalized.split('');
  for (const clause of splitClauses(normalized)) maskClauseGuards(chars, normalized, clause);
  // "두고" splits on 고, so the whole keep phrase is masked on the raw text.
  // "건드리지 마" is not one of these; only "말고" closes that phrase.
  maskKoreanKeepClauses(chars, normalized);
  maskDontTouchRefs(chars, normalized);
  maskKeepVocabulary(chars, normalized);
  return chars.join('');
}

// "don't touch R4" keeps that reference. "don't touch the pull-ups" keeps that
// role. The LED edit in the other clause still applies. keepNamesEditTarget
// already read the object, including a don't-touch of this resistor.
function maskDontTouchRefs(chars, text) {
  const re = compileRegExp(String.raw`\b(?:don't|dont|do not|never)\s+touch\b`, 'giu');
  for (const match of text.matchAll(re)) {
    const from = match.index + match[0].length;
    const ref = /^\s*(?:(?:the|a|an)\s+)?(?:resistor\s+)?R\d+\b/iu.exec(text.slice(from));
    if (!ref) continue;
    blankRange(chars, from, from + ref[0].length);
  }
}

const KOREAN_KEEP_CLAUSE = /(?<![가-힣])(?:그대로\s*두고|건드리지\s*말고|유지하고|놔\s*두고|빼고)/gu;

function maskKoreanKeepClauses(chars, text) {
  for (const match of text.matchAll(KOREAN_KEEP_CLAUSE)) {
    const phraseStart = match.index;
    const phraseEnd = phraseStart + match[0].length;
    const before = text.slice(0, phraseStart);
    let boundary = -1;
    for (const mark of [',', '.', '?', '!', '\n', '。', '？', '！']) {
      boundary = Math.max(boundary, before.lastIndexOf(mark));
    }
    blankWordsBefore(chars, text, boundary < 0 ? 0 : boundary + 1, phraseStart, 6);
    blankRange(chars, phraseStart, phraseEnd);
  }
}

function maskClauseGuards(chars, text, clause) {
  const base = clause.start;
  const negated = clause.negatedBySeparator === true;
  for (const match of clause.text.matchAll(compileRegExp(GUARD_BEFORE.source, 'giu'))) {
    const after = clause.text.slice(match.index + match[0].length);
    // "그대로 두지 말고" and "유지하지 말고" cancel the keep. The role stays.
    if (koreanKeepCueNegated(after, negated)) continue;
    blankWordsBefore(chars, text, base, base + match.index);
  }
  for (const match of clause.text.matchAll(compileRegExp(GUARD_AFTER.source, 'giu'))) {
    // "don't keep" is not a keep. "without" still hides the object after it.
    if (/^keep$/iu.test(match[0]) && englishKeepIsNegated(clause.text, match.index)) continue;
    const cueEnd = base + match.index + match[0].length;
    blankWordsAfter(chars, text, cueEnd, base + clause.text.length);
  }
}

// "두지 말고" splits on 말고, so the left clause ends at 두지/하지.
// "두지 말" still inside the clause is the same negation.
function koreanKeepCueNegated(after, negatedBySeparator) {
  const body = String(after ?? '').trim();
  if (/^(?:두지|하지)\s*(?:말|마|않)/u.test(body)) return true;
  return negatedBySeparator === true && /^(?:두지|하지)$/u.test(body);
}

function englishKeepIsNegated(clauseText, matchIndex) {
  const prefix = String(clauseText ?? '').slice(0, matchIndex).trimEnd();
  return /(?:n't|\b(?:not|never|dont)\b)(?:\s+(?:please|just|you))?\s*$/iu.test(prefix);
}

function blankWordsBefore(chars, text, clauseStart, cueStart, limit = 2) {
  const words = [...text.slice(clauseStart, cueStart).matchAll(/\S+/gu)];
  const taken = [];
  for (let index = words.length - 1; index >= 0 && taken.length < limit; index -= 1) {
    if (/^\d/.test(words[index][0])) break;
    taken.push(words[index]);
  }
  if (taken.length === 0) return;
  blankRange(chars, clauseStart + taken[taken.length - 1].index, cueStart);
}

function blankWordsAfter(chars, text, cueEnd, clauseEnd) {
  const words = [...text.slice(cueEnd, clauseEnd).matchAll(/\S+/gu)];
  let end = cueEnd;
  let count = 0;
  for (const word of words) {
    if (count >= 6) break;
    if (/^\d/.test(word[0]) || GUARD_AFTER_STOP.test(word[0])) break;
    end = cueEnd + word.index + word[0].length;
    count += 1;
  }
  blankRange(chars, cueEnd, keepIdentityEnd(text, cueEnd, end));
}

function blankRange(chars, from, to) {
  const end = Math.min(to, chars.length);
  for (let index = Math.max(0, from); index < end; index += 1) chars[index] = ' ';
}

// keep, leave, and don't-touch blank the whole object. A value-owning tail
// ("R4, LED 저항 680Ω") stays visible, so that noun is the edit.
function maskKeepVocabulary(chars, text) {
  const found = keepClauseSpans(text);
  for (const cue of found.cues) blankRange(chars, cue.start, cue.end);
  for (const object of found.objects) {
    const end = keepIdentityEnd(text, object.start, object.end);
    if (object.mask === 'ref') blankKeptRefs(chars, text, object.start, end);
    else blankRange(chars, object.start, end);
  }
}

function blankKeptRefs(chars, text, start, end) {
  const slice = text.slice(start, end);
  for (const match of slice.matchAll(/\bR\d+\b/giu)) {
    blankRange(chars, start + match.index, start + match.index + match[0].length);
  }
}

function keepNamesEditTarget(text, spec) {
  // "keep D1" is the status LED when D1 is that diode. The keep span is the only
  // place that designator is read as the word LED.
  const raw = textWithSeriesLedAsWord(text, spec);
  const found = keepClauseSpans(raw);
  if (found.objects.length === 0) return false;
  const series = seriesResistorRef(spec);
  const kept = new Set();
  for (const object of found.objects) addKeptIdentity(kept, keepIdentityFragment(raw, object), series, 'keep');
  // A bare LED keep is the diode. A resistor noun, possessive, pronoun, or a
  // wider object ("LED circuit", "LEDs") keeps the series resistor instead.
  const ledBlocked = Boolean(series) && ledKeepCountsAsSeries(raw);
  if (ledBlocked) kept.add(String(series).toUpperCase());
  if (kept.size === 0) return false;
  // The cue word stays out of the edit remainder. "유지하고" must not sit on the LED noun.
  const edit = new Set();
  // "keep the current-limiting resistor, LED resistor 680Ω" keeps only the
  // first identity. The resistor after the comma stays visible as the edit.
  const ranges = found.objects.map((object) => [object.start, keepIdentityEnd(raw, object.start, object.end)]);
  for (const cue of found.cues) ranges.push([cue.start, cue.end]);
  const remainder = blankCopy(raw, ranges);
  addKeptIdentity(edit, remainder, series, 'edit');
  if (edit.size === 0 && bareSeriesRemainder(remainder, series)) edit.add(String(series).toUpperCase());
  if (ledBlocked && seriesEditRemainder(remainder, series)) edit.add(String(series).toUpperCase());
  for (const key of kept) {
    if (edit.has(key)) return true;
  }
  return false;
}

// The status LED's own D ref. Another diode (D2, a TVS) is not this part.
function seriesLedDesignator(spec) {
  const rows = [];
  if (Array.isArray(spec?.schematic?.components)) rows.push(...spec.schematic.components);
  if (Array.isArray(spec?.boardProfile?.productionParts)) rows.push(...spec.boardProfile.productionParts);
  for (const row of rows) {
    const ref = String(row?.ref ?? '');
    if (!/^D\d+$/i.test(ref)) continue;
    const libId = String(row?.libId ?? '');
    const value = String(row?.value ?? '');
    const role = String(row?.role || componentRole(spec, ref) || '');
    if (role === 'status-led' || libId === 'ChatPCB:STATUS_LED' || value === 'STATUS_LED') return ref.toUpperCase();
  }
  return null;
}

function textWithSeriesLedAsWord(text, spec) {
  const ledRef = seriesLedDesignator(spec);
  const raw = String(text ?? '');
  if (!ledRef) return raw;
  const found = keepClauseSpans(raw);
  if (found.objects.length === 0) return raw;
  const hits = [];
  const re = new RegExp(`\\b${ledRef}\\b`, 'giu');
  for (const object of found.objects) {
    const slice = raw.slice(object.start, object.end);
    for (const match of slice.matchAll(re)) {
      hits.push([object.start + match.index, object.start + match.index + match[0].length]);
    }
  }
  hits.sort((left, right) => left[0] - right[0]);
  let result = '';
  let cursor = 0;
  for (const [start, end] of hits) {
    if (start < cursor) continue;
    result += raw.slice(cursor, start) + 'LED';
    cursor = end;
  }
  return result + raw.slice(cursor);
}

export function resistorEditCoverage(text, spec = null) {
  return assessRequestCoverage(textWithSeriesLedAsWord(text, spec));
}

const LED_KEEP_SKIP = new Set([
  'the', 'a', 'an', 'status', '상태', 'as', 'is', 'as-is',
  'and', 'but', '&', 'or',
  '그리고', '하고', '및', '이랑', '랑',
  // "as is" walks back through the verb, so "keep the LED as is" is one object.
  'keep', 'hold', 'leave', 'without'
]);

function ledKeepTokens(piece) {
  return String(piece ?? '').split(/\s+/u).map((token) => {
    let word = token.replace(/^[("'`[\]]+|[)"'`[\],.;:!?]+$/gu, '');
    word = word.replace(/(?:으로|로|은|는|이|가|을|를|도|만|의)$/u, '');
    return word;
  }).filter((word) => word && !LED_KEEP_SKIP.has(word.toLowerCase()));
}

function isBareLedPiece(piece) {
  const tokens = ledKeepTokens(piece);
  if (tokens.length === 0) return false;
  return tokens.every((token) => /^(?:led|엘이디|엘예디)$/iu.test(token));
}

function pieceMentionsLed(piece) {
  return /\bleds?\b|엘이디|엘예디/iu.test(piece);
}

function pieceHasResistorNoun(piece) {
  return /(?:저항|抵抗|\bresistors?\b|\bresistance\b)/iu.test(piece);
}

function pieceHasPossessive(piece) {
  return /(?:'s\b|’s\b|\bits\b)/iu.test(piece);
}

function isSeparateOtherKeep(piece) {
  if (pieceMentionsLed(piece) || pieceHasResistorNoun(piece) || pieceHasPossessive(piece)) return false;
  if (/\bR\d+\b/iu.test(piece)) return true;
  return textHasKnownRole(piece);
}

// An LED keep is the diode only when the kept object is a bare LED / status LED
// and no clause from that keep through the edit names a resistor, a possessive, or "it".
// A keep of some other resistor ("I2C pull-up resistors") is not an LED keep.
// A resistor noun before the LED keep is that other edit ("I2C 저항 2.2k로. LED는 그대로").
function ledKeepCountsAsSeries(text) {
  const found = keepClauseSpans(text);
  let sawBare = false;
  let sawNoun = false;
  let bareAt = null;
  for (const object of found.objects) {
    const end = keepIdentityEnd(text, object.start, object.end);
    const fragment = text.slice(object.start, end);
    const pieces = splitKeepList(fragment);
    let searchFrom = 0;
    for (const piece of pieces) {
      const rel = fragment.indexOf(piece, searchFrom);
      const at = rel < 0 ? searchFrom : rel;
      const pieceAt = object.start + at;
      searchFrom = at + piece.length;
      const trimmed = piece.trim();
      if (!trimmed || isSeparateOtherKeep(trimmed)) continue;
      if (isBareLedPiece(trimmed)) {
        sawBare = true;
        if (bareAt === null || pieceAt < bareAt) bareAt = pieceAt;
        continue;
      }
      // "LED circuit", "LEDs", "LED's resistor", "LED and its resistor".
      if (pieceMentionsLed(trimmed)) return true;
      if (pieceHasResistorNoun(trimmed) || pieceHasPossessive(trimmed)) sawNoun = true;
    }
  }
  if (!sawBare) return false;
  if (sawNoun) return true;
  const spans = found.objects.map((object) => [object.start, object.end]);
  for (const cue of found.cues) spans.push([cue.start, cue.end]);
  spans.push(...ledResistorEditSpans(text));
  const residue = blankCopy(text, spans).slice(bareAt);
  return /(?:저항|抵抗|\bresistors?\b|\bresistance\b|'s\b|’s\b|\bits\b|\bit\b)/iu.test(residue);
}

function ledResistorSynonymBody(synonym) {
  const folded = String(synonym).toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  return folded.split(' ').filter(Boolean).map((part) => escapeRegExp(part)).join('[-\\s]+');
}

// Blank the edit phrase so its resistor noun is not leftover after an LED keep.
// The phrase is any LED_RESISTOR_SYNONYMS entry ("current-limiting", "series",
// "전류제한", "전류 제한") plus the resistor noun, unless the entry already names it.
function ledResistorEditSpans(text) {
  const spans = [];
  const alternatives = [];
  for (const synonym of LED_RESISTOR_SYNONYMS) {
    const folded = String(synonym).toLowerCase();
    const body = ledResistorSynonymBody(synonym);
    if (!body) continue;
    const namesResistor = /resistor|저항|抵抗/.test(folded);
    const tail = namesResistor ? '' : '(?:\\s+resistors?|\\s*저항|\\s*抵抗)';
    const ascii = /^[a-z0-9 -]+$/.test(folded.replace(/-/g, ' '));
    alternatives.push(ascii ? `(?<![a-z0-9])(?:the\\s+)?${body}${tail}` : `${body}${tail}`);
  }
  if (alternatives.length === 0) return spans;
  const pattern = compileRegExp(alternatives.join('|'), 'giu');
  for (const match of String(text).matchAll(pattern)) {
    if (match[0].length === 0) continue;
    spans.push([match.index, match.index + match[0].length]);
  }
  return spans;
}

function seriesEditRemainder(text, series) {
  if (bareSeriesRemainder(text, series)) return true;
  if (!clauseCarriesResistorValue(text)) return false;
  // "풀업 저항 10k" is the other resistor. A bare "저항" or "it" is this one.
  if (textHasKnownRole(text) || textHasUsbRole(text)) return false;
  if (resistorNounKinds(text).includes('foreign')) return false;
  if (resistorNounKinds(text).includes('led')) return true;
  return /(?:저항|抵抗|\bresistors?\b|\bresistance\b|\bit\b)/iu.test(text);
}

// A comma stays in the list ("don't touch R4, LED"). The last item is the edit
// when a value follows it directly ("I2C, LED resistor to 680Ω").
function keepIdentityEnd(text, start, end) {
  const full = text.slice(start, end);
  const identity = keepIdentityFragment(text, { start, end });
  if (identity !== full && full.startsWith(identity)) return start + identity.length;
  return end;
}

// "R4, LED" and "the LED and R4" are lists. "4,7" is one value, so a comma
// between digits stays. "and", "및", "랑" / "이랑", and "하고" split the same list.
const KEEP_LIST_MARK = /\band\b|(?:이랑|랑|하고|및)(?![가-힣])|[,，]/giu;

// `cut` is the separator before this piece. Dropping the tail slices there, so
// "and" / "하고" stay in the prefix. Rejoining with "," is a prefix only when
// every separator was a comma, and then "keep D1 and its resistor, LED 저항"
// hides the edit noun inside the keep.
function splitKeepListSpans(fragment) {
  const pieces = [];
  const source = String(fragment ?? '');
  let start = 0;
  let cut = 0;
  for (const match of source.matchAll(KEEP_LIST_MARK)) {
    const mark = match[0];
    if (mark === ',' || mark === '，') {
      const prev = source[match.index - 1] ?? '';
      const next = source[match.index + 1] ?? '';
      if (/\d/u.test(prev) && /\d/u.test(next)) continue;
    }
    pieces.push({ text: source.slice(start, match.index), start, cut });
    cut = match.index;
    start = match.index + mark.length;
  }
  pieces.push({ text: source.slice(start), start, cut });
  return pieces;
}

function splitKeepList(fragment) {
  return splitKeepListSpans(fragment).map((piece) => piece.text);
}

function keepIdentityFragment(text, object) {
  const fragment = text.slice(object.start, object.end);
  const pieces = splitKeepListSpans(fragment);
  if (pieces.length < 2 || !directValueFollows(text, object.end)) return fragment;
  let end = pieces.length;
  while (end > 1 && pieces[end - 1].text.trim() === '') end -= 1;
  if (end < 2 || !namesResistorHead(pieces[end - 1].text)) return fragment;
  return fragment.slice(0, pieces[end - 1].cut);
}

function directValueFollows(text, index) {
  const after = String(text ?? '').slice(index).replace(/^[\s,]+/u, '');
  if (/^(?:set|change|update|make|modify|바꿔|변경|수정)/iu.test(after)) return false;
  if (/^\d/u.test(after)) return true;
  return /^(?:to\b|으로|로(?!부터|서|써))/iu.test(after) && /\d/u.test(after);
}

function namesResistorHead(segment) {
  return /(?:저항|抵抗|\bresistors?\b|\bleds?\b|엘이디|엘예디)/iu.test(segment);
}

function addKeptIdentity(keys, fragment, series, side) {
  for (const ref of resistorReferenceTokens(fragment)) keys.add(ref.toUpperCase());
  if (series && namesSeriesLed(fragment, side)) keys.add(String(series).toUpperCase());
}

// A keep object is this resistor only with a resistor noun ("resistor" / "저항",
// including "LED resistor" and "LED 저항") or an R ref (added above).
// A bare LED or status LED is the diode, so that keep does not block the edit.
// "LED circuit", "LEDs", "its resistor", and a later "The resistor too" do.
// The edit remainder still treats a bare LED as the series resistor.
function namesSeriesLed(fragment, side = 'edit') {
  if (resistorNounKinds(fragment).includes('led')) return true;
  if (side === 'keep') return false;
  return /\bleds?\b|엘이디|엘예디/iu.test(fragment);
}

function bareSeriesRemainder(text, series) {
  if (!series) return false;
  if (resistorReferenceTokens(text).length > 0) return false;
  if (resistorNounKinds(text).length > 0) return false;
  if (textHasKnownRole(text) || textHasUsbRole(text)) return false;
  if (componentDesignators(text).some((ref) => !/^R\d+$/.test(ref))) return false;
  return clauseCarriesResistorValue(text) && hasResistorEditVerb(text);
}

function blankCopy(text, ranges) {
  const chars = text.split('');
  for (const [start, end] of ranges) blankRange(chars, start, end);
  return chars.join('');
}

// Resistor breaks are not the deletion breaks. A comma inside 4,7 or 1,000
// stays. "and then" is one break, so the later "to" is still the destination.
// 으로, 로, and "to" mark a value. They do not start a clause.
const RESISTOR_CLAUSE_SEPARATORS = Object.freeze([
  Object.freeze({ re: String.raw`\band\s+then\b` }),
  Object.freeze({ re: String.raw`\band\b` }),
  Object.freeze({ re: String.raw`\bthen\b` }),
  Object.freeze({ re: String.raw`(?<!\d)\.(?!\d)` }),
  Object.freeze({ re: String.raw`[;!?]` }),
  Object.freeze({ re: String.raw`(?<!\d),(?!\d)` }),
  Object.freeze({ re: '그리고' }),
  Object.freeze({ re: '면서' }),
  Object.freeze({ re: String.raw`하고(?![가-힣])` }),
  Object.freeze({ re: String.raw`이고(?![가-힣])` }),
  Object.freeze({ re: String.raw`이랑(?![가-힣])` }),
  Object.freeze({ re: '지만' }),
  Object.freeze({ re: '말고' }),
  Object.freeze({ re: String.raw`(?<=[가-힣])며(?![가-힣])` }),
  Object.freeze({ re: String.raw`(?<=[가-힣])고(?!\s*나서)(?![가-힣])` })
]);

// USB-C is a connector name. A bare USB role is not the LED resistor.
const USB_ROLE = /\bUSB(?!-)/iu;

function resistorClauseCuts(text) {
  const hits = [];
  for (const sep of RESISTOR_CLAUSE_SEPARATORS) {
    const re = compileRegExp(sep.re, 'giu');
    for (let match = re.exec(text); match; match = re.exec(text)) {
      if (match[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      hits.push({ index: match.index, length: match[0].length });
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

export function splitResistorClauses(text) {
  const pieces = [];
  let start = 0;
  for (const sep of resistorClauseCuts(text)) {
    pieces.push(text.slice(start, sep.index));
    start = sep.index + sep.length;
  }
  pieces.push(text.slice(start));
  return pieces.map((piece) => piece.trim()).filter((piece) => piece.length > 0);
}

function clauseCarriesResistorValue(clauseText) {
  if (textHasLengthObject(clauseText) && /\d+(?:\.\d+)?\s*m(?![A-Za-z])/iu.test(clauseText)) {
    const withoutLength = clauseText.replace(/\d+(?:\.\d+)?\s*m(?![A-Za-z])/giu, ' ');
    if (!OHM_VALUE_IN_CLAUSE.test(withoutLength)) return false;
  }
  if (/\d+(?:\.\d+)?\s*(?:cm|mm|km|ft|in)(?![A-Za-z])/iu.test(clauseText)) {
    const withoutLength = clauseText.replace(/\d+(?:\.\d+)?\s*(?:cm|mm|km|ft|in)(?![A-Za-z])/giu, ' ');
    if (!OHM_VALUE_IN_CLAUSE.test(withoutLength)) return false;
  }
  return OHM_VALUE_IN_CLAUSE.test(clauseText);
}

function clauseHasForeignRole(clauseText) {
  if (resistorNounKinds(clauseText).includes('foreign')) return true;
  if (textHasKnownRole(clauseText)) return true;
  return USB_ROLE.test(clauseText);
}

// An LED phrase or a resistor noun with no other role owns the clause.
// A later owned clause drops a pending role that never received a value.
function clauseHasOwnTarget(clauseText) {
  const kinds = resistorNounKinds(clauseText);
  if (kinds.length > 0 && !kinds.includes('foreign') && !kinds.includes('demonstrative')) return true;
  return /\bleds?\b|엘이디|엘예디|발광/iu.test(clauseText);
}

// Kept objects are already blank. A foreign clause that carries an ohm value
// refuses. A foreign clause with no value stays pending until an owned clause
// clears it. A later value with no role of its own still belongs to that pending role.
function foreignRoleClauseHasValue(text) {
  const masked = maskGuardObjects(text);
  let pendingForeign = false;
  for (const clauseText of splitResistorClauses(masked)) {
    if (isAmbiguousI2cPreservation(clauseText)) continue;
    const foreign = clauseHasForeignRole(clauseText);
    const valued = clauseCarriesResistorValue(clauseText);
    if (foreign && valued) return true;
    if (foreign) {
      pendingForeign = true;
      continue;
    }
    if (clauseHasOwnTarget(clauseText)) {
      pendingForeign = false;
      continue;
    }
    if (valued && pendingForeign) return true;
  }
  return false;
}

// A known role that survives keep-masking is still part of the request.
// "풀업용" and "for SDA" refuse. A don't-delete clause is not this role.
// "keep the pull-up" is masked before this walk.
function unkeptForeignRole(text) {
  const masked = maskGuardObjects(text);
  for (const clauseText of splitResistorClauses(masked)) {
    if (isAmbiguousI2cPreservation(clauseText)) continue;
    if (isDontDeleteClause(clauseText)) continue;
    if (textHasKnownRole(clauseText) || textHasUsbRole(clauseText)) return true;
  }
  return false;
}

// The LED series value is allowed for an LED phrase, the series ref, or a bare
// 저항/resistor/抵抗 when that is the only resistor role. Any other word in
// front of the noun is refused. Words kept with 그대로/keep do not count.
// One LED noun and one other noun ask which resistor.
const RESISTOR_NOUN = /저항|抵抗|\bresistor\b/giu;
const WORD_PARTICLE = /(?:이랑|으로|에서|에게|은|는|을|를|과|와|의|도|만|랑|이|가|요|에|로|の|を|が|は|に)$/u;

function foreignRoleDecision(text, spec, resistor) {
  const masked = maskGuardObjects(text);
  const kind = foreignRoleKind(masked);
  // Keeping the LED resistor drops that noun. A later value must not land on R3.
  if (ledResistorWasKept(text, masked) && kind !== 'foreign' && kind !== 'ambiguous' && resistor?.kind === 'resistor') {
    return {
      mode: 'refuse',
      code: 'RESISTOR_TARGET_UNCLEAR',
      message: resistorTargetUnclearMessage(resistor.ohmsText)
    };
  }
  if (!kind) return null;
  // "그 저항" and "that resistor" name no role. A saved ref still does.
  if (kind === 'demonstrative') {
    if (namesSeriesRef(text, spec) && !nounModifierIsForeign(masked)) return null;
    if (resistor?.kind !== 'resistor') return null;
    return {
      mode: 'refuse',
      code: 'RESISTOR_TARGET_UNCLEAR',
      message: resistorTargetUnclearMessage(resistor.ohmsText)
    };
  }
  // "R3 680Ω" names the series part even when the sentence has other words
  // and no LED phrase. A foreign word on the resistor noun still refuses.
  if (namesSeriesRef(text, spec) && kind !== 'ambiguous' && !nounModifierIsForeign(masked)) return null;
  if (kind === 'bare' && !hasOtherResistorRole(spec)) return null;
  // "저항 12만" has no ohm value. Keep the unit question. A real value asks which resistor.
  if (kind === 'bare' && resistor?.kind !== 'resistor') return null;
  if ((kind === 'ambiguous' || kind === 'bare') && resistor?.kind === 'resistor') {
    return {
      mode: 'refuse',
      code: 'RESISTOR_TARGET_UNCLEAR',
      message: resistorTargetUnclearMessage(resistor.ohmsText)
    };
  }
  return {
    mode: 'refuse',
    code: 'RESISTOR_REF_UNSUPPORTED',
    message: resistorRefUnsupportedMessage(seriesResistorRef(spec))
  };
}

function ledResistorWasKept(text, masked) {
  return resistorNounKinds(text).includes('led') && !resistorNounKinds(masked).includes('led');
}

function namesSeriesRef(text, spec) {
  const series = seriesResistorRef(spec);
  if (!series) return false;
  const refs = editTargetDesignators(text).filter((ref) => /^R\d+$/.test(ref));
  return refs.length === 1 && refs[0].toUpperCase() === series.toUpperCase();
}

function nounModifierIsForeign(text) {
  RESISTOR_NOUN.lastIndex = 0;
  const nouns = [...text.matchAll(RESISTOR_NOUN)];
  let previous = 0;
  for (const noun of nouns) {
    if (classifyModifiers(wordsNearNoun(text, noun, previous), text) === 'foreign') return true;
    previous = noun.index + noun[0].length;
  }
  return false;
}

function resistorNounKinds(text) {
  RESISTOR_NOUN.lastIndex = 0;
  const nouns = [...String(text ?? '').matchAll(RESISTOR_NOUN)];
  const kinds = [];
  let previous = 0;
  for (const noun of nouns) {
    kinds.push(classifyModifiers(wordsNearNoun(text, noun, previous), text));
    previous = noun.index + noun[0].length;
  }
  return kinds;
}

function foreignRoleKind(text) {
  const kinds = resistorNounKinds(text);
  if (kinds.length === 0) return bareNonLedSubject(text);
  if (kinds.includes('led') && (kinds.includes('foreign') || kinds.includes('demonstrative'))) return 'ambiguous';
  if (kinds.includes('foreign')) return 'foreign';
  if (kinds.includes('demonstrative')) return 'demonstrative';
  if (kinds.every((kind) => kind === 'bare')) return 'bare';
  return null;
}

// No resistor noun. A value clause that still names something else (pull-up,
// gate, I2C) is not the LED resistor. A clause with only the value and a verb
// stays an LED edit. A don't-delete of I2C is leftover content in coverage.
function bareNonLedSubject(text) {
  let unknown = false;
  for (const clause of splitClauses(text)) {
    if (!OHM_VALUE_IN_CLAUSE.test(clause.text)) continue;
    const words = [...clause.text.matchAll(/\S+/gu)].map((match) => match[0]);
    if (classifyModifiers(words, clause.text) !== 'foreign') continue;
    // pull-up, I2C, and USB are known roles. terminator, NRST, and BOOT0 are not.
    if (textHasKnownRole(clause.text) || textHasUsbRole(clause.text)) return 'foreign';
    unknown = true;
  }
  return unknown ? 'unknown' : null;
}

function wordsNearNoun(text, noun, previousEnd) {
  const before = text.slice(previousEnd, noun.index);
  let start = 0;
  for (const match of before.matchAll(/[.;!?,。！？]/gu)) start = match.index + match[0].length;
  const prefix = [...before.slice(start).matchAll(/\S+/gu)].map((match) => match[0]);
  return [...modifiersBefore(prefix, text), ...wordsAfterNoun(text, noun)];
}

// Modifiers sit against the noun. A place or time word ("프로젝트에서") ends
// the phrase, so earlier words are not part of the resistor name.
function modifiersBefore(words, text) {
  const picked = [];
  for (let index = words.length - 1; index >= 0; index -= 1) {
    const raw = words[index];
    if (isPhraseBoundary(raw) || isClauseBreak(raw)) break;
    if (isValueWord(raw) || isQuantityNoise(words, index)) continue;
    const stemmed = stemWord(raw);
    if (isDemonstrative(stemmed)) {
      picked.push(raw);
      continue;
    }
    if (!stemmed || isIgnorableWord(stemmed, text) || isDesignator(stemmed)) continue;
    picked.push(raw);
    if (!isLedPhraseWord(stemmed)) break;
  }
  return picked.reverse();
}

// "port 8080" and "3 개" are not resistor roles. A port word with no number still is.
function isQuantityNoise(words, index) {
  const stemmed = stemWord(words[index]);
  const prev = index > 0 ? words[index - 1] : '';
  const next = index + 1 < words.length ? words[index + 1] : '';
  if (/^(?:ports?|pins?|gpios?|포트|핀)$/iu.test(stemmed)) return isValueWord(prev) || isValueWord(next);
  if (/^(?:개|번)$/u.test(stemmed)) return isValueWord(prev);
  return false;
}

function isDemonstrative(word) {
  return isDemonstrativeWord(word);
}

function isClauseBreak(word) {
  return /^(?:말고|하고|지만|그리고|and|but|then)$/iu.test(stemWord(word));
}

function isPhraseBoundary(word) {
  return /(?:에서|부터|에게|으로서|로써)$/u.test(String(word ?? ''));
}

// "resistor for the LED" carries the LED after the noun. Stop at a value or at
// a word that belongs to the next resistor ("LED 저항이랑 I2C 저항").
function wordsAfterNoun(text, noun) {
  const after = text.slice(noun.index + noun[0].length);
  const end = after.search(/[.;!?,。！？]/u);
  const cut = end >= 0 ? after.slice(0, end) : after;
  const kept = [];
  for (const match of cut.matchAll(/\S+/gu)) {
    const word = match[0];
    if (isValueWord(word)) break;
    const stemmed = stemWord(word);
    if (/^(?:저항|抵抗|resistor)$/iu.test(stemmed)) break;
    // "저항이 680Ω" glues the subject particle 이 onto the noun. "이 저항" does not.
    if (match.index === 0 && /^(?:이|가|은|는|을|를)$/u.test(stemmed)) continue;
    if (isDemonstrative(stemmed)) {
      kept.push(word);
      continue;
    }
    if (!stemmed || isIgnorableWord(stemmed, text) || isDesignator(stemmed)) {
      kept.push(word);
      continue;
    }
    // "resistor for R2D2" names a model, same as "R2D2 LED resistor".
    if (isGluedModelCode(stemmed)) {
      kept.push(word);
      break;
    }
    if (!isLedPhraseWord(stemmed)) break;
    kept.push(word);
    if (kept.length >= 4) break;
  }
  return kept;
}

function classifyModifiers(words, text) {
  const content = [];
  let demonstrative = false;
  for (const raw of words) {
    if (isValueWord(raw) || isPhraseBoundary(raw)) continue;
    const stemmed = stemWord(raw);
    if (isDemonstrative(stemmed)) {
      demonstrative = true;
      continue;
    }
    if (!stemmed || isIgnorableWord(stemmed, text) || isDesignator(stemmed)) continue;
    content.push(stemmed);
  }
  if (content.length === 0) return demonstrative ? 'demonstrative' : 'bare';
  if (isAllowedLedContext(content)) return 'led';
  return 'foreign';
}

function isLedPhraseWord(word) {
  return isLedAllowWord(word) || isLedResistorSynonymPiece(word);
}

function isAllowedLedContext(content) {
  // Target and keep both use LED_RESISTOR_SYNONYMS. "current sense" stays a shunt.
  return matchesLedResistorModifiers(content);
}

function stemWord(word) {
  let text = String(word ?? '').replace(/^[("'`[?？=]+|[\])"'`,.:;?？=]+$/gu, '');
  if (!text) return '';
  if (isNegationOrAlternativeWord(text)) return text;
  text = text.replace(WORD_PARTICLE, (match, offset) => (offset === 0 ? match : ''));
  if (text.length > 1 && text.endsWith('들')) {
    const bare = text.slice(0, -1);
    if (/^(?:leds?|엘이디|엘예디)$/iu.test(bare)) return bare;
  }
  return text;
}

function isIgnorableWord(word, text) {
  if (isFunctionWord(word) || isEditVerbWord(word) || isModalOrParticleWord(word)) return true;
  if (isNegationOrAlternativeWord(word)) return true;
  if (isPoliteIfFiller(word, text)) return true;
  // "&" joins two spellings of one value ("1k & 1000Ω"), same as "and".
  if (/^[-–—<>→⇒~∼〜.=±%&]+$/u.test(word)) return true;
  if (/^괜찮/u.test(word) || /^가능/u.test(word)) return true;
  return isKoreanRequestStem(word);
}

function isDesignator(word) {
  return /^[A-Za-z]{1,3}\d+$/.test(word);
}

// R2D2 is a model code, not a reference. A real ref is letters then digits only.
// I2C matches the same shape and is a resistor role, so it stays off this path.
function isGluedModelCode(word) {
  if (textHasKnownRole(word)) return false;
  return /^[A-Za-z]{1,3}\d+[A-Za-z][A-Za-z0-9]*$/u.test(word);
}

function isValueWord(word) {
  const stemmed = stemWord(word);
  if (/^(?:Ω|옴|ohms?|meg)$/iu.test(stemmed)) return true;
  // I2C and R3 contain digits and are not values. 2.2k, 10Ω, and 0603 are.
  if (/^[±+]?\d/.test(stemmed)) return true;
  return /\d/.test(stemmed) && /[kKmMrRΩ옴%]$/u.test(stemmed);
}

function productionParts(spec) {
  const parts = spec?.boardProfile?.productionParts;
  return Array.isArray(parts) ? parts : [];
}

// Pull-ups, CC resistors, and any other saved resistor are a second role.
// A bare "저항" then asks which one instead of editing the LED resistor.
function hasOtherResistorRole(spec) {
  const series = String(seriesResistorRef(spec) ?? '').toUpperCase();
  const seen = new Set();
  for (const part of [...schematicComponents(spec), ...productionParts(spec)]) {
    const ref = String(part?.ref ?? '').toUpperCase();
    if (!ref || ref === series || seen.has(ref)) continue;
    if (!isOtherResistor(spec, part)) continue;
    seen.add(ref);
    return true;
  }
  return false;
}

function isOtherResistor(spec, part) {
  if (isEditableLedSeriesResistor(spec, part)) return false;
  const libId = String(part?.libId ?? '');
  const role = String(part?.role || componentRole(spec, part?.ref) || '');
  if (/^Device:R$/i.test(libId) || libIdNamesResistor(libId)) return true;
  return specRoleNamesResistor(role);
}

function isForeignResistorRole(text) {
  const kind = foreignRoleKind(text);
  return kind === 'foreign' || kind === 'ambiguous';
}

// Two unit values joined by from/to, 에서, or an arrow. The first is the stated
// current value. It has to be the saved series value. A unitless number tight
// against from, an arrow, or 에서 is that current value too.
function transitionValuePair(text) {
  const tokens = scanResistorTokens(text);
  markNonResistorQuantities(tokens, text);
  promoteCoordinatedBareValues(tokens, text);
  promoteUnitlessTransitionSource(tokens, text);
  dropLeadingDesignators(tokens);
  const amounts = classifyResistorAttempts(tokens).valid;
  if (amounts.length < 2) return null;
  const source = amounts[0];
  const destination = amounts[amounts.length - 1];
  const between = text.slice(source.end, destination.index);
  const head = text.slice(0, source.index);
  const arrow = /->|→|에서/.test(between);
  const fromTo = /\bfrom\b/i.test(head) && /\bto\b/i.test(between);
  if (!arrow && !fromTo) return null;
  return { source, destination };
}

// "from 220", "220 ->", and "220에서" name the current ohms without a unit.
function promoteUnitlessTransitionSource(tokens, text) {
  for (const token of tokens) {
    if (!isBareUnitlessToken(token) || !isCleanUnitless(token.raw.trim())) continue;
    const before = text.slice(0, token.index);
    const after = text.slice(token.end);
    const afterFrom = /\bfrom\s*$/iu.test(before);
    const beforeMarker = /^\s*(?:from\b|->|→|에서)/iu.test(after);
    if (!afterFrom && !beforeMarker) continue;
    token.attempt = true;
  }
}

// d{1,3}[.,]ddd: exactly three digits after one separator. "1.000" is 1Ω in
// one locale and 1000 in another. A from-value of that shape is ambiguous,
// so the destination is not applied. "1000", "1k", and "1.5k" are not this form.
const GROUPING_SEPARATOR_FROM = /^\d{1,3}[.,]\d{3}$/;

function continuesGroupedNumber(text, end) {
  return /^[.,]\d{3}/.test(String(text ?? '').slice(end));
}

function groupingSeparatorFromValue(text) {
  for (const token of scanResistorTokens(text)) {
    const raw = token.raw.trim();
    if (!GROUPING_SEPARATOR_FROM.test(raw)) continue;
    if (continuesGroupedNumber(text, token.end)) continue;
    const before = text.slice(0, token.index);
    const after = text.slice(token.end);
    const afterFrom = /\bfrom\s*$/iu.test(before);
    const beforeMarker = /^\s*(?:from\b|->|→|에서)/iu.test(after);
    if (!afterFrom && !beforeMarker) continue;
    return token;
  }
  return null;
}

function transitionDestinationLabel(text, fromEnd) {
  const after = text.slice(fromEnd);
  const marker = /->|→|에서|\bto\b/iu.exec(after);
  const slice = text.slice(fromEnd + (marker ? marker.index + marker[0].length : 0));
  for (const token of scanResistorTokens(slice)) {
    const raw = token.raw.trim();
    if (RESISTOR_PACKAGE.test(raw) || /^[A-Za-z]{1,3}\d+$/.test(raw)) continue;
    if (GROUPING_SEPARATOR_FROM.test(raw) && !continuesGroupedNumber(slice, token.end)) return raw;
    const parsed = parseResistorOhms(raw);
    if (parsed) return formatResistorLabel(parsed);
  }
  return null;
}

function groupingFromRefusal(text) {
  if (questionStopsResistorEdit(text)) return null;
  const source = groupingSeparatorFromValue(text);
  if (!source) return null;
  const labels = [source.raw.trim()];
  const destination = transitionDestinationLabel(text, source.end);
  if (destination) labels.push(destination);
  return {
    mode: 'refuse',
    code: 'RESISTOR_VALUE_AMBIGUOUS',
    message: resistorValueAmbiguousMessage(namedResistorRef(text), labels)
  };
}

function statedFromMismatch(text, spec) {
  const pair = transitionValuePair(text);
  if (!pair) return null;
  const current = currentSeriesOhms(spec);
  if (!current || pair.source.ohmsText === current.ohmsText) return null;
  return pair;
}

// The saved series value wins over the user's spelling. 330Ω, 330R, and 0.33k
// are one value. No series part, or a value that does not parse, is not "already".
function unchangedResistor(spec, resistor) {
  if (resistor?.kind !== 'resistor') return null;
  const current = currentSeriesOhms(spec);
  if (!current || current.ohmsText !== String(resistor.ohmsText)) return null;
  return {
    mode: 'refuse',
    code: 'RESISTOR_VALUE_UNCHANGED',
    message: resistorValueUnchangedMessage(current.ref, formatResistorLabel(current.ohmsText))
  };
}

function currentSeriesOhms(spec) {
  const ref = seriesResistorRef(spec);
  if (!ref) return null;
  const record = refRecord(spec, ref);
  const peripherals = Array.isArray(spec?.peripherals) ? spec.peripherals : [];
  const peripheral = peripherals.find((item) => item?.kind === 'status-led-resistor');
  const parts = Array.isArray(spec?.boardProfile?.productionParts) ? spec.boardProfile.productionParts : [];
  const part = parts.find((item) => String(item?.ref ?? '').toUpperCase() === ref.toUpperCase())
    ?? parts.find((item) => item?.role === 'status-led-resistor');
  for (const raw of [record?.value, peripheral?.value, part?.value]) {
    if (raw == null || String(raw).trim() === '') continue;
    const ohmsText = parseResistorOhms(String(raw));
    if (!ohmsText) continue;
    return { ref: record?.ref ? String(record.ref) : ref, ohmsText };
  }
  return null;
}

function designatorPattern() {
  return /\b[A-Za-z]{1,3}\d+\b/gu;
}

function componentDesignators(text) {
  const normalized = String(text ?? '').normalize('NFKC');
  const seen = new Set();
  const refs = [];
  for (const match of normalized.matchAll(designatorPattern())) {
    const ref = match[0].toUpperCase();
    if (seen.has(ref)) continue;
    seen.add(ref);
    refs.push(ref);
  }
  return refs;
}

// Keep phrases hide the part they name. One visible designator is the target.
function editTargetDesignators(text) {
  const normalized = String(text ?? '').normalize('NFKC');
  const refs = componentDesignators(normalized);
  const masked = maskGuardObjects(normalized);
  const visible = new Set();
  for (const match of masked.matchAll(designatorPattern())) visible.add(match[0].toUpperCase());
  if (refs.length < 2) {
    if (refs.length === 1 && !visible.has(refs[0])) return [];
    return refs;
  }
  const targets = refs.filter((ref) => visible.has(ref));
  // Every designator sits in a keep ("keep D1 and R4"). None of them is the edit.
  if (targets.length === 0 && refs.every((ref) => hiddenDesignatorIsKept(normalized, ref))) return [];
  if (targets.length === 0) return refs;
  return targets;
}

function hiddenDesignatorIsKept(text, ref) {
  const found = keepClauseSpans(text);
  const re = new RegExp(`\\b${ref}\\b`, 'iu');
  return found.objects.some((object) => {
    const end = keepIdentityEnd(text, object.start, object.end);
    return re.test(text.slice(object.start, end));
  });
}

function ambiguousResistorRefs(refs) {
  return {
    mode: 'refuse',
    code: 'RESISTOR_REF_AMBIGUOUS',
    message: resistorRefAmbiguousMessage(refs)
  };
}

function refusedDesignator(spec, token) {
  const record = refRecord(spec, token);
  if (!record) {
    const shown = displayRef(spec, token);
    const ledHint = shown.toUpperCase() === 'R3' && !seriesResistorRef(spec);
    return {
      mode: 'refuse',
      code: 'RESISTOR_REF_NOT_FOUND',
      message: resistorRefNotFoundMessage(shown, { ledHint })
    };
  }
  if (!isEditableLedSeriesResistor(spec, record)) {
    return {
      mode: 'refuse',
      code: 'RESISTOR_REF_UNSUPPORTED',
      message: resistorRefUnsupportedMessage(seriesResistorRef(spec))
    };
  }
  return null;
}

function resistorRefDecision(text, spec, resistor) {
  const refs = editTargetDesignators(text);
  const rRefs = refs.filter((ref) => /^R\d+$/.test(ref));
  const others = refs.filter((ref) => !/^R\d+$/.test(ref));
  if (rRefs.length >= 2) return ambiguousResistorRefs(rRefs);
  // "상태 LED D1의 저항 R3" names the LED and the resistor. The R-ref is the target.
  if (rRefs.length === 1) {
    const decided = refusedDesignator(spec, rRefs[0]);
    if (decided) return decided;
    return null;
  }
  // A unitless number still asks for a unit. A real value on C1, D1, or J2 does not.
  if (resistor?.kind !== 'resistor') return null;
  if (others.length > 1) return ambiguousResistorRefs(others);
  if (others.length !== 1) return null;
  const token = others[0];
  if (!refRecord(spec, token) && isForeignResistorRole(maskGuardObjects(text))) return null;
  return refusedDesignator(spec, token);
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
    return I2C_PART_ID;
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
  const re = compileRegExp(DELETION_INTENT_VOCABULARY.referenceDesignator, 'giu');
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

// The saved ref is the part. Keeping that same part, or writing a different
// role beside the ref, is not a removal. A keep of a different part is still
// the one clear candidate ("remove J2 but keep LED" is J2).
function resolvedRefConflicts(spec, text) {
  const kept = partsBlockedByKeep(text);
  const keptRefs = new Set();
  const roles = [];
  for (const id of kept) {
    if (isRefTarget(id)) keptRefs.add(id.slice(4));
  }
  for (const mention of findMentions(text)) {
    if (mention.id !== I2C_PART_ID && mention.id !== 'led') continue;
    if (kept.has(mention.id) || roles.includes(mention.id)) continue;
    roles.push(mention.id);
  }
  for (const token of designatorsInOrder(text)) {
    if (keptRefs.has(token)) continue;
    if (!machineryForRecord(spec, refRecord(spec, token))) continue;
    for (const id of kept) {
      if (sameMachinery(spec, token, id)) return true;
    }
    for (const role of roles) {
      if (!sameMachinery(spec, token, role)) return true;
    }
  }
  return false;
}

// "R3 빼고" keeps that resistor. The same 빼 on J2 or D1 is still a removal.
// A bare bus is not a resistor, so that 빼 stays a deletion.
function blockResistorKeepExcept(intents, text) {
  const raw = String(text ?? '');
  const spans = keepClauseSpans(raw);
  for (const intent of intents) {
    if (intent.verb !== '빼') continue;
    const cue = spans.cues.find((item) => (
      intent.sourceIndex >= item.start
      && intent.sourceIndex < item.end
      && raw.slice(item.start, item.end) === '빼고'
    ));
    if (!cue) continue;
    const object = spans.objects.find((item) => item.end === cue.start);
    if (!object || !isResistorKeepExcept(raw.slice(object.start, object.end))) continue;
    blockIntent(intent);
    intent.residue = false;
  }
}

function isResistorKeepExcept(fragment) {
  if (componentDesignators(fragment).some((ref) => !/^R\d+$/.test(ref))) return false;
  const namesResistor = /저항|抵抗|\bresistor\b/iu.test(fragment);
  const bareBus = compileRegExp(I2C_PART_PATTERN, 'iu').test(fragment)
    && !namesResistor
    && !textHasKnownRole(fragment);
  if (bareBus) return false;
  if (/\bR\d+\b/iu.test(fragment) || namesResistor) return true;
  if (/\bleds?\b|엘이디|엘예디/iu.test(fragment)) return true;
  return textHasKnownRole(fragment);
}

// Fail closed. A removal candidate exists only when one part is the clear
// object of a removal verb and no negation, keep, question, correction, list,
// or second candidate makes that reading unsafe. One existing reference is
// removed through the same native deletion as its named part.
function removalDecision(text, spec) {
  const normalized = stripQuotedMentions(normalizeDeletionText(text));
  const intents = classifyDeletionIntents(text);
  blockResistorKeepExcept(intents, normalized);
  applySentenceBlocks(intents, normalized);
  applyPartScope(intents, normalized);
  applyTrailingCorrection(intents, normalized);
  applyMultiTargetBlock(intents, normalized);
  applyListedRemovalBlock(intents, normalized);
  const affirmative = intents.some((intent) => (
    isTrackedTarget(intent.target) && (intent.polarity === 'positive' || intent.residue === true)
  ));
  const finish = (decision) => {
    decision.affirmative = affirmative;
    return decision;
  };
  if (intents.some((intent) => intent.question || intent.corrected)) return finish({ kind: 'unclear' });

  const refTokens = collectPositiveRefs(normalized, intents);
  if (refTokens.length >= 2) {
    return finish({ kind: 'one-at-a-time', refs: refTokens.map((token) => displayRef(spec, token)) });
  }
  if (refTokens.length === 1) {
    const named = new Set([...collectPositiveNamed(intents), ...joinedNamedBeside(normalized, intents)]);
    for (const id of named) {
      if (!sameMachinery(spec, refTokens[0], id)) return finish({ kind: 'unclear' });
    }
    if (resolvedRefConflicts(spec, normalized)) return finish({ kind: 'unclear' });
    return finish(resolveRefRemoval(spec, refTokens[0]));
  }

  const actionable = [];
  for (const intent of intents) {
    if (intent.polarity !== 'positive') continue;
    if (intent.target !== I2C_PART_ID && intent.target !== 'led') continue;
    if (!actionable.includes(intent.target)) actionable.push(intent.target);
  }
  if (actionable.length === 1 && !removalIsUnclear(intents, actionable)) {
    if (resolvedRefConflicts(spec, normalized)) return finish({ kind: 'unclear' });
    return finish({ kind: 'remove', targets: actionable });
  }
  if (removalIsUnclear(intents, actionable)) return finish({ kind: 'unclear' });
  return finish({ kind: 'none' });
}

// A candidate carries an ohm unit or an RKM/SI suffix. Package codes, wattage,
// voltage, current, percent, bare numbers, and reference designators are not
// candidates here. A bare number is never applied as ohms. The matched text
// is parsed only by parseResistorOhms.
// A leading sign stays inside the token. Dropping it would read +10Ω as 10Ω.
// The same is true of a comma: 4,7k must not be read as 7k.
// Hiragana and katakana are not part of a reference designator, so を470 stays
// a value. Latin letters and Hangul still block a match inside a word.
const RESISTOR_TOKEN = compileRegExp(String.raw`(?<![A-Za-z\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3\p{N}_.+,\u2212\u2013\u00B1-])(?:${[
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
  String.raw`\d+(?:\.\d+)?\s*[kKrRM]${RKM_FRACTION_SEPARATOR}\d+(?![\d%kKrRM])`,
  String.raw`\d+(?:\.\d+)?\s*meg(?![A-Za-z])`,
  String.raw`\d+(?:\.\d+)?\s*[rRkKmMuUnNpPfFgGtT](?![A-Za-z])`,
  String.raw`\d+(?:\.\d+)?[A-Za-z]{2,}`,
  String.raw`[A-Za-z]+(?:\s*(?:Ω|옴|ohms?))(?![A-Za-z])`,
  String.raw`[A-Za-z]+\d+`,
  String.raw`\d+,\d+`,
  String.raw`\d+(?:\.\d+)?`
].join('|')})`, 'gu');
const RESISTOR_PACKAGE = /^(?:01005|0201|0402|0603|0805|1206|1210|2010|2512)$/;
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
  if (isNonOhmUnitToken(raw)) return true;
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
    if (token.attempt || token.quantity || !/^\d+(?:\.\d+)?$/.test(token.raw) || RESISTOR_PACKAGE.test(token.raw)) continue;
    for (const other of ohmValues) {
      const left = token.index < other.index ? token : other;
      const right = token.index < other.index ? other : token;
      const gap = text.slice(left.end, right.index).trim();
      if (!RESISTOR_COORDINATOR.test(gap) && !/^[~∼〜]$/u.test(gap)) continue;
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

function namedResistorRef(text) {
  return resistorReferenceTokens(text)[0] ?? null;
}

// R-references are R plus digits. NFKC folds fullwidth letters, and case does not matter.
function resistorReferenceTokens(text) {
  const normalized = String(text ?? '').normalize('NFKC');
  const seen = new Set();
  const refs = [];
  for (const match of normalized.matchAll(/\bR\d+\b/giu)) {
    const ref = match[0].toUpperCase();
    if (seen.has(ref)) continue;
    seen.add(ref);
    refs.push(ref);
  }
  return refs;
}

// A role word plus a clear ohm value (10k, 120Ω), with no 저항/resistor word.
// Lone milli (4m7, 10mΩ) is not this: the value error stays on the resistor path.
const CLEAR_OHM = /\d+(?:\.\d+)?\s*(?:meg|[kKrR])(?:\s*(?:Ω|옴|ohms?))?(?![A-Za-z])|\d+(?:\.\d+)?\s*(?:Ω|옴|ohms?)|\d+\s*[kKrR]\d+/iu;

// A resistor edit is read only from this text. Candidates go through
// parseResistorOhms and then LED_SERIES_RESISTOR_RANGE. Two distinct values
// without a transition marker ask which value. A token the parser rejects is invalid.
// A question-shaped sentence is an edit only when it permits the change.
// why/ask/know/what/how/wonder and 왜/뭐/어떻게/궁금 outrank a permission form.
// "should I" stays a question even with "please". "should be" is an edit.
// "바꿔도 돼?" and "may I change ...?" do. "2.2k ok?" does not.
function isQuestionShaped(text) {
  if (/[?？]/u.test(text)) return true;
  if (/(?:뭐|무엇|왜|어떻게|어떡|몇|괜찮|가능|할까)/u.test(text)) return true;
  if (/바꿔야\s*해/u.test(text)) return true;
  if (/\b(?:should|why|what|how|which)\b/iu.test(text)) return true;
  return false;
}

function questionStopsResistorEdit(text, coverage = assessRequestCoverage(text)) {
  // Permission allows the edit only when the sentence is not an advice question.
  // "may I change …?" applies. "may I ask why …?" does not.
  if (coverage.permittedEdit) return false;
  if (coverage.adviceQuestion) return true;
  if (isPermittedEdit(text)) return false;
  return isQuestionShaped(text);
}

function interpretResistor(text) {
  const normalized = String(text ?? '').normalize('NFKC');
  // Question shape, a bare value choice, and "to 680Ω or 1k" share one scan.
  const coverage = assessRequestCoverage(normalized);
  if (questionStopsResistorEdit(normalized, coverage)) return null;
  const namedRefs = resistorReferenceTokens(normalized);
  const aboutLed = /led|저항|抵抗|resistor|\bstatus\b/i.test(normalized);
  const change = /change|set|update|modify|으로|바꿔|변경|수정|그대로|keep|->|→/i.test(normalized);
  const named = namedRefs[0] ?? null;
  const roleValue = textHasKnownRole(normalized) && CLEAR_OHM.test(normalized);
  // "680Ω 또는 1k" has no resistor word. The choice is still a value refusal.
  const valueChoice = coverage.alternative;
  // "1k & 1000Ω" is one value and has no edit verb. A bare "from 1k to 680Ω" stays out.
  if (!aboutLed && !change && !named && componentDesignators(normalized).length === 0 && !roleValue && !valueChoice && !coverage.duplicateOhm) return null;

  const tokens = scanResistorTokens(normalized);
  markNonResistorQuantities(tokens, normalized);
  promoteCoordinatedBareValues(tokens, normalized);
  dropLeadingDesignators(tokens);
  const parsed = classifyResistorAttempts(tokens);
  if (parsed.milli) return { kind: 'invalid', reason: 'milli', valued: true };
  if (parsed.malformed) return { kind: 'invalid', valued: true };
  if (parsed.outOfRange) return { kind: 'invalid', reason: 'range', valued: true };

  // "to 680Ω or 1k" must not keep 680 just because "to" saw it first.
  const chosen = coverage.alternative ? null : destinationAmount(normalized, parsed.valid);
  if (chosen) return resistorEdit(chosen);
  const distinct = new Set(parsed.valid.map((amount) => amount.ohmsText));
  if (distinct.size > 1) {
    const values = [];
    const seen = new Set();
    for (const amount of parsed.valid) {
      if (seen.has(amount.ohmsText)) continue;
      seen.add(amount.ohmsText);
      values.push(amount);
    }
    return {
      kind: 'invalid',
      reason: 'ambiguous',
      valued: true,
      values,
      ref: namedResistorRef(normalized)
    };
  }
  if (distinct.size === 1) return resistorEdit(parsed.valid[parsed.valid.length - 1]);

  const unitless = unitlessResistor(normalized, tokens);
  if (unitless) return unitless;

  const cleanBare = tokens.filter((token) => isBareUnitlessToken(token) && isCleanUnitless(token.raw.trim()));
  if (cleanBare.length > 0) return { kind: 'invalid', reason: 'unitless', valued: true };

  // Counts, years, packages, ports, and capacitor units are not a value,
  // even when the sentence has an edit verb. "1/4W로" still asks for a value.
  if (nonValueQuantityOnly(tokens)) return null;

  // 2개, 2019년형, 3.3V, and 1 Hz are not resistor edits. A real edit verb
  // with no resistor value, such as "1/4W로", still asks for a valid value.
  if (!hasResistorEditVerb(normalized) && explainedByOtherQuantity(tokens)) return null;

  const asked = namesResistorTarget(normalized, tokens) && hasResistorEditVerb(normalized);
  if (asked) return { kind: 'invalid' };
  return null;
}

// Ω-less k/K/R suffixes are values only when bound. Mega (1M, 4M7) is not this:
// M stays a multiplier. A token is a value on a resistor word, an R-ref, or a
// role word, or when to/으로/로 marks it as the edit object ("4.99k로 바꿔줘").
// rev/ver/model in front, or a following part/resolution noun, wins.
const SUFFIX_EXCLUDE_BEFORE = /(?:\brevisions?\b|\brevs?\b|\bversions?\b|\bvers?\b|\bmodels?\b|리비전|버전|모델)\s*$/iu;

const SUFFIX_CUE_BEFORE = /(?:저항|抵抗|\bresistors?\b|\bR\d+\b)(?:값|을|를|은|는|이|가)?(?:\s+values?)?\s*:?\s*$/iu;
const SUFFIX_CUE_AFTER = /^\s*(?:(?:leds?|엘이디|엘예디|발광(?:\s*다이오드)?|status|상태)\s+)*(?:저항|抵抗|\bresistors?\b)/iu;
const SUFFIX_EDIT_BEFORE = /(?:->|→|=|\bto\b)\s*$/iu;
const SUFFIX_EDIT_AFTER = /^\s*(?:으로|로(?!부터|서|써))/u;

// "680Ω-1k" is a range. A leading dash on 1k is not a signed value when an ohm
// value sits on the other side and the tail itself carries a multiplier or unit.
function dashJoinsResistorValues(text, raw, index) {
  if (!/^[-−–—－]/.test(raw)) return false;
  const body = raw.replace(/^[-−–—－]\s*/, '');
  if (!/(?:Ω|옴|ohms?|[kKrRM])/iu.test(body)) return false;
  return /(?:Ω|옴|ohms?|\d\s*[kKrRM])\s*$/iu.test(String(text ?? '').slice(0, index));
}

function isUnitlessKRSuffix(raw) {
  const text = String(raw ?? '').trim();
  if (/(?:Ω|옴|ohms?)/iu.test(text)) return false;
  return /^\d+[rRkK]\d+$/.test(text) || /^\d+(?:\.\d+)?\s*[rRkK]$/.test(text);
}

function approximateResistorValue(before, after) {
  return approximateBefore(before) || approximateAfter(after);
}

function unitlessSuffixCountsAsResistor(text, start, end) {
  const before = text.slice(0, start);
  const after = text.slice(end);
  if (SUFFIX_EXCLUDE_BEFORE.test(before)) return false;
  if (isUnboundMeasureAfter(after)) return false;
  if (!tildeJoinsResistorRange(before, text.slice(start, end)) && approximateResistorValue(before, after)) return false;
  if (SUFFIX_CUE_BEFORE.test(before) || SUFFIX_CUE_AFTER.test(after)) return true;
  if (suffixRoleWord(lastWord(before))) return true;
  // "4.99k로 바꿔줘" names no part. The marker still binds that token: it is the
  // edit object. "to rev 4k" and "4K display" already returned false above.
  if (SUFFIX_EDIT_BEFORE.test(before) || SUFFIX_EDIT_AFTER.test(after)) return true;
  // "680Ω or 1k", "680Ω/1k", and "680Ω 또는 1k" name both values.
  // A model, display, or pot after the token already returned false above.
  if (/(?:Ω|옴|ohms?|\d\s*[kKrR])\s*(?:\/|또는|아니면|혹은|\bor\b)\s*$/iu.test(before)) return true;
  if (/^\s*(?:\/|또는|아니면|혹은|\bor\b)\s*\d/iu.test(after)) return true;
  // "680Ω and 1k", "1k vs 680Ω", "1k~680Ω", and "680Ω, 1k 둘 중" name that suffix too.
  return hasSiblingOhmUnit(text, start, end);
}

function hasSiblingOhmUnit(text, start, end) {
  const re = /\d+(?:\.\d+)?\s*(?:Ω|옴|ohms?)|\d+(?:\.\d+)?\s*[kKrR](?![A-Za-z])/giu;
  for (const match of String(text ?? '').matchAll(re)) {
    const at = match.index ?? 0;
    if (at + match[0].length <= start || at >= end) return true;
  }
  return false;
}

function lastWord(text) {
  const match = String(text ?? '').match(/(\S+)\s*$/u);
  return match ? match[1] : '';
}

function suffixRoleWord(word) {
  const stemmed = String(word ?? '').replace(/(?:을|를|은|는|이|가)$/u, '');
  return isKnownRoleWord(stemmed) || isKnownRoleWord(word);
}

function markNonResistorQuantities(tokens, text) {
  for (const token of tokens) {
    const raw = token.raw.trim();
    if (isReplacedSourceValue(text, token.index)) {
      token.quantity = true;
      token.attempt = false;
      continue;
    }
    // An approximate ohm value is not applied, with or without a unit.
    const beforeToken = text.slice(0, token.index);
    if (!tildeJoinsResistorRange(beforeToken, token.raw) && approximateResistorValue(beforeToken, text.slice(token.end))) {
      token.quantity = true;
      token.attempt = false;
      continue;
    }
    if (/^\d+(?:st|nd|rd|th)$/i.test(raw)) {
      token.quantity = true;
      token.attempt = false;
      continue;
    }
    // 30cm, 50mm, 2ft, 6in, and 1km are length. A bare "m" stays on the milli path.
    if (/^\d+(?:\.\d+)?(?:cm|mm|km|ft|in)$/i.test(raw)) {
      token.quantity = true;
      token.attempt = false;
      continue;
    }
    // "1 m cable" beside a resistor is length. "1m resistor" and "to 4.7m" stay values.
    if (isLoneMilliResistorSuffix(raw) && !loneMilliCountsAsResistor(text, token.index, token.end)) {
      token.quantity = true;
      token.attempt = false;
      continue;
    }
    // "680Ω-1k" names two values. The dash after an ohm value is the range, not a sign on 1k.
    if (dashJoinsResistorValues(text, raw, token.index)) {
      token.quantity = true;
      token.attempt = false;
      continue;
    }
    // Unitless k/K/R (4k, 4K, 4k7, 2R2) is a value only when it is bound to the
    // resistor target. "rev 4k", "4K display", and "10k pot" are not.
    // "4k 7" / "4k.7" / "1R-5" / "2M-2" follow that same binding. A bound one is malformed.
    if ((isUnitlessKRSuffix(raw) || isSpacedRkmValue(raw)) && !unitlessSuffixCountsAsResistor(text, token.index, token.end)) {
      token.quantity = true;
      token.attempt = false;
      continue;
    }
    if (!isTiedToOtherQuantity(text, token)) continue;
    token.quantity = true;
    token.attempt = false;
  }
}

function isTiedToOtherQuantity(text, token) {
  const raw = token.raw.trim();
  if (/hz$/i.test(raw)) return true;
  const after = text.slice(token.end);
  if (/^Hz\b/i.test(after)) return true;
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return false;
  if (isCounterFollow(after)) return true;
  if (isCounterLead(text.slice(0, token.index))) return true;
  const before = text.slice(Math.max(0, token.index - 48), token.index);
  return /(?:\bports?\b|포트)/iu.test(before);
}

// Capacitance, inductance, frequency, voltage, and current. Not a bare 1u/10n,
// and not wattage: "1/4W로" is still an invalid resistor value.
function isNonOhmUnitToken(raw) {
  const text = String(raw ?? '').trim();
  if (/^\d+(?:\.\d+)?\s*[pnuµμkKmM]\s*[FfHh]$/u.test(text)) return true;
  if (/^\d+(?:\.\d+)?\s*[FH]$/u.test(text)) return true;
  if (/^\d+(?:\.\d+)?\s*(?:[kKmMgG])?\s*Hz$/iu.test(text)) return true;
  if (/^\d+(?:\.\d+)?\s*(?:[mµμuUnNkK])?\s*[Vv](?:DC|AC|dc|ac)?$/u.test(text)) return true;
  if (/^\d+(?:\.\d+)?\s*(?:[mµμuUnN])?\s*[Aa]$/u.test(text)) return true;
  return false;
}

function nonValueQuantityOnly(tokens) {
  const interesting = tokens.filter((token) => !/^[A-Za-z]{1,3}\d+$/.test(token.raw.trim()));
  if (interesting.length === 0) return false;
  if (interesting.some((token) => token.attempt)) return false;
  return interesting.every((token) => {
    const raw = token.raw.trim();
    return token.quantity
      || RESISTOR_PACKAGE.test(raw)
      || /^\d+(?:st|nd|rd|th)$/i.test(raw)
      || isNonOhmUnitToken(raw);
  });
}

function explainedByOtherQuantity(tokens) {
  if (tokens.some((token) => token.attempt)) return false;
  if (tokens.some((token) => isBareUnitlessToken(token))) return false;
  return tokens.some((token) => token.quantity || isElectricalOrPackage(token.raw));
}

function isElectricalOrPackage(raw) {
  const text = raw.trim();
  if (RESISTOR_PACKAGE.test(text)) return true;
  if (/hz$/i.test(text)) return true;
  if (/^\d+(?:\.\d+)?\s*[Vv](?:DC|AC|dc|ac)?$/.test(text)) return true;
  if (/^\d+(?:\.\d+)?\s*(?:[mµμuUnN])?[Aa]$/.test(text)) return true;
  if (/^\d+(?:\.\d+)?\s*[Ww]$/.test(text)) return true;
  if (/^\d+\s*\/\s*\d+\s*[Ww]$/.test(text)) return true;
  if (/^[±]?\s*\d+(?:\.\d+)?\s*%$/.test(text)) return true;
  return false;
}

// A bare number is never ohms. One clean number next to a resistor target
// asks for a unit. A sign, a comma, a lowercase m, or three digits after one
// dot stays refused. Package, wattage, voltage, current, percent, counts,
// and R-reference digits are not candidates. The range check is unchanged.
function namesResistorTarget(text, tokens) {
  if (/저항|抵抗|\bresistor\b/iu.test(text)) return true;
  return tokens.some((token) => /^[rR]\d$/.test(token.raw));
}

function isBareUnitlessToken(token) {
  if (token.attempt || token.quantity) return false;
  const raw = token.raw.trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return false;
  if (RESISTOR_PACKAGE.test(raw)) return false;
  if (/^0\d+$/.test(raw)) return false;
  return true;
}

function isCleanUnitless(raw) {
  if (/[+\-\u2212\u2013\uFF0D\u00B1]/.test(raw)) return false;
  if (raw.includes(',') || raw.includes('m')) return false;
  if (/^\d+\.\d{3}$/.test(raw)) return false;
  return /^\d+(?:\.\d+)?$/.test(raw);
}

function unitlessResistor(text, tokens) {
  if (!namesResistorTarget(text, tokens)) return null;
  const candidates = tokens.filter((token) => isBareUnitlessToken(token));
  if (candidates.length === 0) return null;
  if (candidates.length > 1) return { kind: 'invalid', reason: 'unitless', valued: true };
  const raw = candidates[0].raw.trim();
  if (!isCleanUnitless(raw)) return { kind: 'invalid', valued: true };
  const result = classifyResistorValue(raw);
  if (result.reason === 'range') return { kind: 'invalid', reason: 'range', valued: true };
  if (result.reason === 'milli') return { kind: 'invalid', reason: 'milli', valued: true };
  if (result.ohmsText == null) return { kind: 'invalid', valued: true };
  return { kind: 'invalid', reason: 'unit-required', valued: true, number: raw };
}

// Sub-1k keeps the Ω suffix (680Ω, 1.5Ω). Kilo and mega keep every digit of
// the canonical ohms string, so 4990 is 4.99k and 1050000 is 1.05M.
// 1005 must not become "1.005k" or "1k005": three digits after one dot, and
// more than one digit after an RKM letter, no longer parse. Plain ohms is
// the lossless form when the dotted multiplier would not re-parse.
function formatResistorLabel(ohmsText) {
  const text = String(ohmsText);
  const value = Number(text);
  const candidates = [];
  if (Number.isFinite(value) && value >= 1_000_000) {
    const scaled = scaleOhms(text, 6);
    candidates.push(`${scaled}M`, dottedMultiplier(scaled, 'M'));
  } else if (Number.isFinite(value) && value >= 1000) {
    const scaled = scaleOhms(text, 3);
    candidates.push(`${scaled}k`, dottedMultiplier(scaled, 'k'));
  }
  candidates.push(`${text}Ω`);
  for (const label of candidates) {
    if (label && parseResistorOhms(label) === text) return label;
  }
  return `${text}Ω`;
}

function dottedMultiplier(scaled, letter) {
  const dot = scaled.indexOf('.');
  if (dot < 0) return null;
  const fraction = scaled.slice(dot + 1);
  // 4.7k may also be written 4k7. 4.99k must not become 4k99.
  if (fraction.length !== 1) return null;
  return `${scaled.slice(0, dot)}${letter}${fraction}`;
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

function seriesEditRef(spec, edit) {
  const named = edit?.ref ? String(edit.ref) : '';
  if (named) return named;
  return seriesResistorRef(spec);
}

function componentIsSeriesTarget(spec, component, ref) {
  if (ref) return String(component?.ref ?? '') === ref;
  return isEditableLedSeriesResistor(spec, component);
}

function applyResistorToSpec(spec, edit) {
  const label = edit.label;
  const ohmsText = edit.ohmsText;
  const ref = seriesEditRef(spec, edit);
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
    if (componentIsSeriesTarget(spec, component, ref)) component.value = label;
  }
  if (Array.isArray(spec.boardProfile?.productionParts)) {
    spec.boardProfile = {
      ...spec.boardProfile,
      productionParts: spec.boardProfile.productionParts.map((part) => (
        componentIsSeriesTarget(spec, part, ref) || (!ref && part?.role === 'status-led-resistor')
          ? { ...part, value: label }
          : part
      ))
    };
  }
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
  if (!targets.includes(I2C_PART_ID)) return;
  spec.interfaces = (spec.interfaces ?? []).filter((iface) => iface?.kind !== I2C_PART_ID);
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
  const projectName = await projectBaseName(projectDir);
  if (edit.kind === 'resistor') {
    const ref = seriesEditRef(existingSpec, edit);
    // A resistor edit may change a series resistor that is already on the
    // schematic. It must not synthesize one, including when classification
    // returned merge without a target.
    if (!ref || !(await schematicHasReference(projectDir, projectName, ref))) {
      throw resistorTargetUnclearError(edit.ohmsText);
    }
  }
  const next = applyExistingProjectEdit(existingSpec, edit);
  if (edit.kind === 'delete') {
    return writeGeneratedProject({ projectDir, spec: next, projectName });
  }
  if (edit.kind === 'resistor') {
    return writeResistorEdit({
      projectDir,
      spec: next,
      label: edit.label,
      ohmsText: edit.ohmsText,
      ref: seriesEditRef(existingSpec, edit)
    });
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

async function writeResistorEdit({ projectDir, spec, label, ohmsText, ref }) {
  const target = ref || seriesEditRef(spec, { ref });
  if (!target) throw editError(modifyRefusalMessage());
  const projectName = await projectBaseName(projectDir);
  const files = projectFiles(projectDir, projectName);
  const schematicPath = files.schematic;
  const schematic = await readFile(schematicPath, 'utf8');
  const updatedSchematic = replaceReferenceValue(schematic, target, label);
  if (updatedSchematic === schematic) throw editError(modifyRefusalMessage());
  await writeFile(schematicPath, updatedSchematic, 'utf8');
  await writeOptionalValue(path.join(projectDir, `${projectName}.kicad_pcb`), (text) => replaceReferenceValue(text, target, label));
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
  const pattern = compileRegExp(`(\\(property "Reference" "${escapeRegExp(ref)}"[\\s\\S]*?\\(property "Value" ")([^"]*)(")`);
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
