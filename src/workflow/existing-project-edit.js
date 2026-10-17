import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { writeGeneratedProject } from './generate-mcu-project.js';

const FULL_DESIGN_MCU = /\b(stm32|esp32|rp2040|atmega|nrf52|adbms)\b/i;
const FULL_DESIGN_BOARD = /\b(board|usb|regulator|connector|header|sensor)\b|보드|커넥터|헤더|레귤레이터|센서/i;
const KEEP_REST = /keep everything|everything else unchanged|나머지는\s*그대로|그대로\s*두|기존.*(?:유지|그대로)|unchanged/i;
const RESISTOR_AMOUNT = /(\d+(?:\.\d+)?)\s*(?:Ω|옴|ohms?)/iu;

// Every deletion-intent check reads this table. Clause split, verb binding,
// and negation do not keep a second word list.
// 말고 closes the left clause ("제거 말고" is not a removal of that part).
export const DELETION_INTENT_VOCABULARY = Object.freeze({
  positiveVerbs: Object.freeze([
    Object.freeze({ id: 'remove', lang: 'en', re: String.raw`\bremove\b` }),
    Object.freeze({ id: 'delete', lang: 'en', re: String.raw`\bdelete\b` }),
    Object.freeze({ id: '삭제', lang: 'ko', re: '삭제' }),
    Object.freeze({ id: '제거', lang: 'ko', re: '제거' }),
    Object.freeze({ id: '지워', lang: 'ko', re: '지워' }),
    Object.freeze({ id: '지우', lang: 'ko', re: '지우' })
  ]),
  // `n't` and `not` are separate so "don't not" counts as two markers.
  negationMarkers: Object.freeze([
    Object.freeze({ id: 'no-need-to', re: String.raw`\bno\s+need\s+to\b` }),
    Object.freeze({ id: 'need-to-not', re: String.raw`(?:\b(?:do|does)\s+not|n't)\s+need\s+to\b` }),
    Object.freeze({ id: 'never', re: String.raw`\bnever\b` }),
    Object.freeze({ id: "n't", re: String.raw`n't\b` }),
    Object.freeze({ id: 'not', re: String.raw`\bnot\b` })
  ]),
  // After a Korean verb stem. A particle (은/는/을/를) may sit in between.
  koreanNegationSuffix: String.raw`(?:\s*[은는을를])?\s*(?:하\s*지(?:\s*는)?\s*[마말]|하면\s*안|금지|말고|하지\s*않도록|안\s*함|지(?:\s*는)?\s*[마말])`,
  clauseSeparators: Object.freeze([
    Object.freeze({ id: 'and-then', re: String.raw`\band\s+then\b`, negatesLeft: false }),
    Object.freeze({ id: 'but', re: String.raw`\bbut\b`, negatesLeft: false }),
    Object.freeze({ id: 'semicolon', re: ';', negatesLeft: false }),
    Object.freeze({ id: 'go-naseo', re: String.raw`고\s*나서`, negatesLeft: false }),
    Object.freeze({ id: 'hago', re: '하고', negatesLeft: false }),
    Object.freeze({ id: 'jiman', re: '지만', negatesLeft: false }),
    Object.freeze({ id: 'malgo', re: '말고', negatesLeft: true }),
    Object.freeze({ id: 'go', re: String.raw`(?<=[가-힣])고(?!\s*나서)`, negatesLeft: false }),
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

export function modifyRefusalMessage() {
  const en = 'The requested change could not be applied onto the existing design. Describe the change more specifically (name the part or reference and the value), or start a new project for a full redesign. The existing circuit was left unchanged.';
  const ko = '수정 사항을 적용할 수 없습니다. 바꿀 부품이나 참조 이름과 값을 구체적으로 적어 주세요. 전체를 다시 설계하려면 새 프로젝트를 시작하세요. 기존 회로는 바꾸지 않았습니다.';
  return `${en}\n${ko}`;
}

// A prompt that names a new MCU board is a replacement design. A short edit is
// merged onto the saved spec so a resistor change cannot rebuild the board.
export function classifyExistingProjectRequest(prompt, existingSpec) {
  if (!existingSpec || typeof existingSpec !== 'object') return { mode: 'regenerate' };
  const text = String(prompt ?? '');
  if (isFullDesignPrompt(text)) return { mode: 'regenerate' };
  const edit = parseExistingProjectEdit(text);
  if (edit) return { mode: 'merge', edit };
  return { mode: 'refuse' };
}

function isFullDesignPrompt(text) {
  return FULL_DESIGN_MCU.test(text) && FULL_DESIGN_BOARD.test(text) && !KEEP_REST.test(text);
}

function parseExistingProjectEdit(text) {
  const deletion = parseDeletion(text);
  if (deletion) return deletion;
  return parseResistorEdit(text);
}

// Quoted spans are mentions, not commands, and are dropped before verbs are
// matched. `"remove I2C" is not what I want` therefore has no removal verb.
// Double quotes always count. A balanced '...' pair counts when it is not a
// contraction such as don't or shouldn't.
function normalizeDeletionText(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
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

function longestMarker(edge, text) {
  let best = null;
  for (const marker of DELETION_INTENT_VOCABULARY.negationMarkers) {
    const match = matchEdge(edge, text, marker.re);
    if (!match || match[0].length === 0) continue;
    if (!best || match[0].length > best.length) {
      best = { length: match[0].length, index: match.index, end: match[0].length };
    }
  }
  return best;
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
  const bits = text.split(',');
  const groups = [];
  let pending = '';
  for (let index = 0; index < bits.length; index += 1) {
    const bit = bits[index];
    const last = index === bits.length - 1;
    if (!last && isParentheticalFragment(bit)) {
      pending = pending ? `${pending},${bit}` : bit;
      continue;
    }
    groups.push(pending ? `${pending},${bit}` : bit);
    pending = '';
  }
  if (pending) groups.push(pending);
  return groups.map((group) => group.trim()).filter((group) => group.length > 0);
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
    pieces.push({ text: text.slice(start, sep.index), negatedBySeparator: sep.negatesLeft });
    start = sep.index + sep.length;
  }
  pieces.push({ text: text.slice(start), negatedBySeparator: false });
  const clauses = [];
  for (const piece of pieces) {
    for (const part of splitCommaClauses(piece.text)) {
      clauses.push({ text: part, negatedBySeparator: piece.negatedBySeparator });
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
      found.push({ id: target.id, index: match.index });
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

function chooseTarget(windowText, verbOffset) {
  const mentions = findMentions(windowText);
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

function koreanSuffixNegates(after) {
  return new RegExp(`^${DELETION_INTENT_VOCABULARY.koreanNegationSuffix}`, 'u').test(after);
}

// An even count stays a removal. "don't not remove I2C" is two markers.
function englishNegationCount(prefix) {
  let rest = prefix;
  let count = 0;
  const phrases = [...DELETION_INTENT_VOCABULARY.adverbPhrases].sort((left, right) => right.length - left.length);
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
    const word = rest.match(/[A-Za-z]+(?:'[A-Za-z]+)?$/u);
    if (!word || !isSkippableWord(word[0])) break;
    rest = rest.slice(0, -word[0].length);
  }
  return count;
}

function verbIsNegated(window, negatedBySeparator) {
  if (window.verb.lang === 'ko') {
    const after = window.text.slice(window.verbOffset + window.verb.length);
    if (koreanSuffixNegates(after)) return true;
    return negatedBySeparator;
  }
  return englishNegationCount(window.text.slice(0, window.verbOffset)) % 2 === 1;
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
      const negated = verbIsNegated(window, clause.negatedBySeparator);
      let target = chooseTarget(window.text, window.verbOffset);
      if (target === 'pronoun') target = explicitPart(window.text) ?? previousExplicit;
      intents.push({ verb: window.verb.id, target, negated });
    }
    const mentioned = explicitPart(clause.text);
    if (mentioned) previousExplicit = mentioned;
  }
  return intents;
}

function parseDeletion(text) {
  const targets = [];
  for (const intent of classifyDeletionIntents(text)) {
    if (intent.negated || intent.target !== 'i2c' || targets.includes('i2c')) continue;
    targets.push('i2c');
  }
  if (targets.length === 0) return null;
  return { kind: 'delete', targets };
}

function parseResistorEdit(text) {
  const match = text.match(RESISTOR_AMOUNT);
  if (!match) return null;
  const ohms = Number(match[1]);
  if (!(ohms > 0)) return null;
  const aboutLed = /led|저항|resistor|\bstatus\b/i.test(text);
  const change = /change|set|update|modify|으로|바꿔|변경|수정|그대로|keep/i.test(text);
  if (!aboutLed && !change) return null;
  if (/pull-?up|풀업|\bcc\d\b/i.test(text) && !/led|상태|직렬/i.test(text)) return null;
  return { kind: 'resistor', ohms, label: formatResistorLabel(ohms) };
}

function formatResistorLabel(ohms) {
  if (ohms >= 1000 && ohms % 1000 === 0) return `${ohms / 1000}k`;
  return `${ohms}Ω`;
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
  const text = String(label ?? '').trim();
  const kilo = text.match(/^(\d+(?:\.\d+)?)\s*k/i);
  if (kilo) return String(Math.round(Number(kilo[1]) * 1000));
  const ohms = text.match(/^(\d+(?:\.\d+)?)/);
  return ohms ? String(Math.round(Number(ohms[1]))) : null;
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
