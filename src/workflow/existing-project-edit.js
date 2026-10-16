import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { writeGeneratedProject } from './generate-mcu-project.js';

const FULL_DESIGN_MCU = /\b(stm32|esp32|rp2040|atmega|nrf52|adbms)\b/i;
const FULL_DESIGN_BOARD = /\b(board|usb|regulator|connector|header|sensor)\b|보드|커넥터|헤더|레귤레이터|센서/i;
const KEEP_REST = /keep everything|everything else unchanged|나머지는\s*그대로|그대로\s*두|기존.*(?:유지|그대로)|unchanged/i;
const DELETE_WORDS = /(삭제|제거|\bremove\b|\bdelete\b)/i;
const RESISTOR_AMOUNT = /(\d+(?:\.\d+)?)\s*(?:Ω|옴|ohms?)/iu;

function editError(message) {
  const error = new Error(message);
  error.code = 'PROVIDER_NO_PATCH';
  return error;
}

export function modifyRefusalMessage() {
  const en = 'The requested change could not be applied onto the existing design. Restate the full specification. The existing circuit was left unchanged.';
  const ko = '수정 사항을 적용할 수 없습니다. 전체 사양을 다시 적어 주세요. 기존 회로는 바꾸지 않았습니다.';
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

// The guard blocks a same-board edit that drops parts. It does not block a
// project that has no schematic yet, or a full description of a different MCU.
export function removalGuardApplies(prompt, beforeSpec) {
  if (!hasPriorSchematic(beforeSpec)) return false;
  if (!isFullDesignPrompt(prompt)) return true;
  const next = canonicalMcu(prompt);
  const current = canonicalMcu(beforeSpec?.mcu?.family) ?? canonicalMcu(beforeSpec?.sourcePrompt);
  return !(next && current && next !== current);
}

function hasPriorSchematic(spec) {
  return (spec?.schematic?.components ?? []).some((component) => component?.ref && component?.libId);
}

function canonicalMcu(text) {
  const match = String(text ?? '').match(FULL_DESIGN_MCU);
  return match ? match[1].toLowerCase() : null;
}

function isFullDesignPrompt(text) {
  return FULL_DESIGN_MCU.test(text) && FULL_DESIGN_BOARD.test(text) && !KEEP_REST.test(text);
}

function parseExistingProjectEdit(text) {
  const deletion = parseDeletion(text);
  if (deletion) return deletion;
  return parseResistorEdit(text);
}

function parseDeletion(text) {
  if (!DELETE_WORDS.test(text)) return null;
  const targets = [];
  if (/\bi2c\b|아이\s*2\s*씨|아이씨/i.test(text)) targets.push('i2c');
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

export function deletionAuthorized(prompt, removed) {
  if (!removed?.length) return true;
  const text = String(prompt ?? '');
  if (!DELETE_WORDS.test(text)) return false;
  return removed.every((component) => mentionsRemovedComponent(text, component));
}

function mentionsRemovedComponent(text, component) {
  const blob = `${component.ref ?? ''} ${component.value ?? ''} ${component.libId ?? ''}`;
  if (/i2c/i.test(blob) && /\bi2c\b|아이\s*2\s*씨|아이씨/i.test(text)) return true;
  const tokens = [component.ref, component.value, component.libId]
    .flatMap((token) => String(token ?? '').split(/[:_\s]+/))
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !/^(chatpcb|device|connector|generic)$/i.test(token));
  const haystack = text.toLowerCase();
  return tokens.some((token) => haystack.includes(token.toLowerCase()));
}

export function removalFinding(removed) {
  const listed = removed.map((component) => `${component.ref ?? '?'} ${component.libId ?? '?'}`).join(', ');
  const en = `Existing components were removed (${listed}). Apply stays closed unless the request explicitly deletes those parts.`;
  const ko = `기존 부품이 빠졌습니다 (${listed}). 요청에 해당 부품 삭제를 명시하지 않으면 적용할 수 없습니다.`;
  return {
    id: 'existing-components-removed',
    code: 'existing-components-removed',
    en,
    ko,
    message: `${en} ${ko}`
  };
}
