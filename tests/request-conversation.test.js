import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { detectProductRequest, generateKindFromDetection } from '../src/runtime/product-catalog.js';
import { normalizeCircuitSpec } from '../src/runtime/circuit-spec.js';
import {
  CONVERSATION_FILE,
  continueCircuitConversation,
  conversationWantsGenerate,
  replyToCircuitConversation,
  saveCircuitConversation,
  startCircuitConversation
} from '../src/runtime/request-conversation.js';
import { dispatchToolCall } from '../src/runtime/agent-daemon.js';
import { generateMcuPeripheralProject } from '../src/workflow/generate-mcu-project.js';

const USER_PROMPT = 'ESP32와 7인치 터치디스플레이, 18650기반 전원공급, CAN트랜시버를 갖는 회로를 작성해줘';
const PRO = { proMode: true };

function walkRecommended(conversation, spec, untilGap) {
  let current = conversation;
  for (let step = 0; step < 20; step += 1) {
    if (current.status !== 'awaiting-input') return current;
    if (current.currentGap === untilGap) return current;
    if (current.step === 'choose-path') {
      current = replyToCircuitConversation(current, '새 프로파일을 만들자. 부족한 점을 하나씩 물어봐.', spec);
      continue;
    }
    const pick = current.options?.find((option) => option.recommended) ?? current.options?.[0];
    if (!pick) return current;
    current = replyToCircuitConversation(current, pick.prompt, spec);
  }
  return current;
}

test('Pro off applies recommended choices and generates without an interview', () => {
  const spec = normalizeCircuitSpec(USER_PROMPT);
  const conversation = startCircuitConversation(USER_PROMPT, spec);

  assert.equal(conversation.status, 'generate');
  assert.match(conversation.assistantMessage, /권장 구성/);
  assert.match(conversation.assistantMessage, /적용/);
  assert.match(conversation.assistantMessage, /전원:/);
  assert.match(conversation.assistantMessage, /MCU:/);
  assert.match(conversation.assistantMessage, /벅부스트|스위칭/);
  assert.match(conversation.assistantMessage, /ESP32-S3-WROOM-1-N8R2/);
  assert.match(conversation.assistantMessage, /전원: .+ \/ .+/);
  assert.match(conversation.assistantMessage, /MCU: .+ \/ .+/);
  assert.ok(conversation.specRows.some((row) => row.label === '전원' && row.reason));
  assert.ok(conversation.specRows.some((row) => row.label === 'MCU' && row.reason));
  assert.equal(conversation.options.length, 0);
  assert.match(conversation.answers['power-architecture.railStrategy'], /벅부스트|18650/);
  assert.match(conversation.answers['mcu-board.mcuPart'], /ESP32-S3-WROOM-1-N8R2/);
  assert.match(conversation.answers['wired-comms.phy'], /TCAN334|SN65HVD230|CAN/i);
  assert.equal(conversation.generateKind, 'mcu');
  assert.match(conversation.answers['datasheet-companions.include'], /레퍼런스 연관 IC/);
  assert.match(conversation.answers['integration.neighbors'], /독립/);
});

test('Pro mode starts a chat clarification for unmatched boards', () => {
  const spec = normalizeCircuitSpec(USER_PROMPT);
  const conversation = startCircuitConversation(USER_PROMPT, spec, PRO);

  assert.equal(conversation.status, 'awaiting-input');
  assert.equal(conversation.missingProfile, true);
  assert.ok(conversation.unmatched.includes('hmi'));
  assert.ok(conversation.unmatched.includes('wired-comms'));
  assert.ok(conversation.unmatched.includes('energy-storage'));
  assert.match(conversation.assistantMessage, /완성된 지원 프로파일은 없습니다/);
  assert.equal(conversationWantsGenerate(conversation), false);
  assert.ok(conversation.options.some((option) => option.id === 'create-profile'));
  assert.ok(conversation.options.some((option) => option.id === 'generate-now'));
});

test('supported ESP32-S3 sensor prompt still generates immediately', () => {
  const prompt = 'ESP32-S3와 가스 센서를 연결하고 3.3V 전원을 사용하는 회로를 만들어줘.';
  const conversation = startCircuitConversation(prompt, normalizeCircuitSpec(prompt));
  assert.equal(conversation.status, 'generate');
  assert.equal(conversationWantsGenerate(conversation), true);
  assert.match(conversation.answers['power-architecture.railStrategy'], /스위칭/);
  assert.match(conversation.answers['sensors.type'], /gas|가스/i);
  assert.match(conversation.answers['sensors.bus'], /I2C/i);
  assert.match(conversation.answers['mcu-board.mcuPart'], /ESP32-S3-WROOM/);
});

test('create-profile path asks ESP32 radio spec before a chip list', () => {
  const spec = normalizeCircuitSpec(USER_PROMPT);
  const started = startCircuitConversation(USER_PROMPT, spec, PRO);
  const next = replyToCircuitConversation(started, '새 프로파일을 만들자. 부족한 점을 하나씩 물어봐.', spec);

  assert.equal(next.status, 'awaiting-input');
  assert.equal(next.currentGap, 'power-architecture.railStrategy');
  assert.match(next.nextQuestion, /스위칭|LDO|효율/);
  assert.ok(next.options.some((option) => /벅부스트/.test(option.label) && option.recommended));
  assert.equal(conversationWantsGenerate(next), false);

  const integration = walkRecommended(next, spec, 'integration.neighbors');
  assert.equal(integration.currentGap, 'integration.neighbors');
  assert.match(integration.nextQuestion, /연계|전원 공급|독립/);

  const radio = walkRecommended(integration, spec, 'mcu-board.radio');
  assert.equal(radio.currentGap, 'mcu-board.radio');
  assert.match(radio.nextQuestion, /무선|사양/);
  assert.ok(radio.options.every((option) => !/WROOM-1-N8R2/.test(option.label)));

  const mcuPart = walkRecommended(radio, spec, 'mcu-board.mcuPart');
  assert.equal(mcuPart.currentGap, 'mcu-board.mcuPart');
  assert.match(mcuPart.nextQuestion, /역제안|사양/);
  assert.ok(mcuPart.options.some((option) => /ESP32-S3-WROOM-1-N8R2/.test(option.label) && option.recommended));
  assert.ok(mcuPart.options.filter((option) => !option.id.startsWith('skip-')).length <= 2);
});

test('catalog examples carry hover help so non-experts can compare choices', () => {
  const spec = normalizeCircuitSpec(USER_PROMPT);
  const started = startCircuitConversation(USER_PROMPT, spec, PRO);
  const creating = replyToCircuitConversation(started, '새 프로파일을 만들자. 부족한 점을 하나씩 물어봐.', spec);
  const afterMcu = walkRecommended(creating, spec, 'hmi.panel');
  const helped = afterMcu.options.filter((option) => option.help);
  assert.ok(helped.length >= 3);
  assert.ok(helped.every((option) => /장점|단점|특징|pros|cons|trade/i.test(option.help)));
  assert.ok(afterMcu.options.find((option) => option.id.startsWith('skip-'))?.help);
});

test('CAN flow asks bus voltage first, marks a recommended choice, and never offers RS-485', () => {
  const spec = normalizeCircuitSpec(USER_PROMPT);
  let conversation = startCircuitConversation(USER_PROMPT, spec, PRO);
  conversation = walkRecommended(conversation, spec, 'wired-comms.deviceVoltage');

  assert.equal(conversation.currentGap, 'wired-comms.deviceVoltage');
  assert.match(conversation.nextQuestion, /3\.3V/);
  assert.ok(conversation.options.some((option) => /\(권장\)/.test(option.label)));
  assert.ok(conversation.options.every((option) => !/MAX485|RS-485/i.test(option.label)));

  conversation = replyToCircuitConversation(conversation, '5V CAN 장치', spec);
  assert.equal(conversation.currentGap, 'wired-comms.phy');
  assert.ok(conversation.options.every((option) => !/MAX485|RS-485/i.test(option.label)));
  assert.ok(conversation.options.some((option) => /TJA1051|5V/i.test(option.label)));
  assert.ok(conversation.options.some((option) => option.recommended || /\(권장\)/.test(option.label)));
  assert.ok(conversation.options.some((option) => /Mouser|\$|가격/.test(option.help ?? '')));
});

test('touch-display step offers part candidates, not only skip', () => {
  const spec = normalizeCircuitSpec(USER_PROMPT);
  const started = startCircuitConversation(USER_PROMPT, spec, PRO);
  const creating = replyToCircuitConversation(started, '새 프로파일을 만들자. 부족한 점을 하나씩 물어봐.', spec);
  const afterMcu = walkRecommended(creating, spec, 'hmi.panel');

  assert.equal(afterMcu.currentGap, 'hmi.panel');
  assert.match(afterMcu.nextQuestion, /디스플레이/);
  assert.ok(afterMcu.options.some((option) => option.id.startsWith('skip-')));
  assert.ok(afterMcu.options.some((option) => /ILI9488|RGB|RA8875|7인치/i.test(option.label)));
  assert.ok(afterMcu.options.length >= 3);
});

test('an MCU DC-DC request does not classify as isolated converter', () => {
  const prompt = 'ESP32 USB 5V to 3.3V DC-DC sensor board';
  const detection = detectProductRequest(prompt);
  assert.notEqual(detection.primary.id, 'isolated-dcdc');
  assert.equal(generateKindFromDetection(detection), 'mcu');
  const conversation = startCircuitConversation(prompt, normalizeCircuitSpec(prompt));
  assert.notEqual(conversation.primaryKind, 'isolated-dcdc');
  assert.equal(conversation.generateKind, 'mcu');
});

test('closest-profile generate still emits an MCU draft when isolated DC-DC also matched historically', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-closest-mcu-'));
  try {
    const conversation = {
      status: 'generate',
      primaryKind: 'isolated-dcdc',
      generateKind: 'mcu',
      forceProfileId: 'esp32-s3-usbc-sensor',
      generatePrompt: 'Release profile ESP32-S3 USB-C sensor board with 3.3V regulator. Original request: ESP32 USB-C sensor board',
      answers: {}
    };
    await saveCircuitConversation(root, conversation);
    const result = await generateMcuPeripheralProject({
      projectDir: root,
      prompt: conversation.generatePrompt
    });
    const schematic = await readFile(result.files.schematic, 'utf8');
    assert.doesNotMatch(schematic, /ISOLATED_DCDC/);
    assert.match(schematic, /ESP32-S3-WROOM|ESP32_S3_WROOM/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('isolated 30V DC-DC and 16S BMS requests use the product catalog instead of MCU-only gaps', () => {
  const dcdcPrompt = '30VDC to 30VDC isolated DC-DC converter, 30W';
  const dcdc = startCircuitConversation(dcdcPrompt, normalizeCircuitSpec(dcdcPrompt), PRO);
  assert.equal(dcdc.primaryKind, 'isolated-dcdc');
  assert.equal(dcdc.status, 'awaiting-input');
  assert.match(JSON.stringify(dcdc.facts), /30VDC/);

  const bmsPrompt = '16S BMS for a Li-ion pack';
  const bms = startCircuitConversation(bmsPrompt, normalizeCircuitSpec(bmsPrompt), PRO);
  assert.equal(bms.primaryKind, 'bms');
  assert.equal(bms.status, 'awaiting-input');
  const creating = replyToCircuitConversation(bms, 'Create a new profile. Ask the missing details one at a time.', normalizeCircuitSpec(bmsPrompt));
  assert.equal(creating.currentGap, 'bms.monitorIc');
  assert.ok(creating.options.some((option) => /ADBMS6830/i.test(option.label)));
  const afterIc = replyToCircuitConversation(creating, 'ADBMS6830', normalizeCircuitSpec(bmsPrompt));
  assert.equal(afterIc.currentGap, 'bms.companions');
  assert.match(afterIc.nextQuestion, /EEPROM|레퍼런스/);
});

test('Pro mode interviews sensor type/spec and datasheet companions', () => {
  const prompt = 'ESP32-S3와 가스 센서를 연결하고 3.3V 전원을 사용하는 회로를 만들어줘.';
  const spec = normalizeCircuitSpec(prompt);
  let conversation = startCircuitConversation(prompt, spec, PRO);
  conversation = walkRecommended(conversation, spec, 'sensors.type');
  assert.equal(conversation.currentGap, 'sensors.type');
  assert.match(conversation.nextQuestion, /센서/);
  assert.ok(conversation.options.some((option) => /가스|gas/i.test(option.label)));

  conversation = walkRecommended(conversation, spec, 'datasheet-companions.include');
  assert.equal(conversation.currentGap, 'datasheet-companions.include');
  assert.match(conversation.nextQuestion, /연관 IC|companion/i);
  assert.ok(conversation.options.some((option) => /EEPROM|ESD|레퍼런스/i.test(option.label)));
});

test('Pro-off recommended draft writes reverse-recommended MCU part into the spec', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-pro-off-'));
  try {
    const spec = normalizeCircuitSpec(USER_PROMPT);
    const conversation = startCircuitConversation(USER_PROMPT, spec);
    await saveCircuitConversation(root, conversation);
    const result = await generateMcuPeripheralProject({
      projectDir: root,
      prompt: conversation.generatePrompt ?? USER_PROMPT
    });
    assert.match(result.spec.mcu.package, /ESP32-S3-WROOM-1-N8R2/);
    assert.match(String(result.spec.power.topology), /벅부스트|18650/);
    assert.ok(result.spec.product.designNotes.some((note) => /Power topology|Datasheet companions|Reverse-recommended MCU/.test(note)));
    const schematic = await readFile(result.files.schematic, 'utf8');
    assert.match(schematic, /ESP32_S3_WROOM_1|ESP32-S3-WROOM/);
    assert.match(schematic, /CAN_TRANSCEIVER|TCAN334|SN65HVD230/);
    assert.match(schematic, /CHARGER_1S|TP4056|BQ24074/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('isolated DC-DC generate-now writes an isolated converter schematic scaffold', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-dcdc-'));
  try {
    const prompt = '30VDC to 30VDC isolated DC-DC converter';
    const spec = normalizeCircuitSpec(prompt);
    let conversation = startCircuitConversation(prompt, spec, PRO);
    conversation = replyToCircuitConversation(conversation, '1500VDC', spec);
    conversation = replyToCircuitConversation(conversation, '지금 아는 범위로 초안을 만들어.', spec);
    assert.equal(conversation.status, 'generate');
    await saveCircuitConversation(root, conversation);
    const result = await generateMcuPeripheralProject({ projectDir: root, prompt: conversation.generatePrompt ?? prompt });
    const schematic = await readFile(result.files.schematic, 'utf8');
    assert.match(schematic, /ISOLATED_DCDC/);
    assert.equal(result.spec.boardProfile.kind, 'isolated-dcdc');
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('choosing the closest profile marks the conversation ready to generate', () => {
  const spec = normalizeCircuitSpec(USER_PROMPT);
  const started = startCircuitConversation(USER_PROMPT, spec, PRO);
  const next = replyToCircuitConversation(
    started,
    '가까운 지원 프로파일 esp32-s3-usbc-sensor 로 진행해.',
    spec
  );

  assert.equal(next.status, 'generate');
  assert.equal(next.forceProfileId, 'esp32-s3-usbc-sensor');
  assert.match(next.generatePrompt, /Release profile/);
});

test('project.request returns a clarify operation for an unmatched board instead of a dummy schematic', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-clarify-'));
  try {
    const created = await dispatchToolCall({
      name: 'project.create',
      args: { workspaceRoot, projectName: '대화 보드 01' }
    });
    const result = await dispatchToolCall({
      id: 'call_clarify',
      name: 'project.request',
      args: {
        projectDir: created.result.projectDir,
        prompt: USER_PROMPT,
        proMode: true
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.result.operation, 'clarify');
    assert.equal(result.result.requiresApproval, false);
    assert.match(result.result.assistantMessage, /완성된 지원 프로파일은 없습니다/);
    assert.ok(result.result.options.length >= 2);
    const saved = JSON.parse(await readFile(path.join(created.result.projectDir, CONVERSATION_FILE), 'utf8'));
    assert.equal(saved.status, 'awaiting-input');
    const names = await readFile(path.join(created.result.projectDir, CONVERSATION_FILE), 'utf8');
    assert.match(names, /hmi/);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test('project.request continues the stored conversation on the next chat reply', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-clarify-next-'));
  try {
    const created = await dispatchToolCall({
      name: 'project.create',
      args: { workspaceRoot, projectName: '대화 보드 02' }
    });
    await dispatchToolCall({
      name: 'project.request',
      args: { projectDir: created.result.projectDir, prompt: USER_PROMPT, proMode: true }
    });
    const result = await continueCircuitConversation({
      projectDir: created.result.projectDir,
      prompt: '새 프로파일을 만들자. 부족한 점을 하나씩 물어봐.',
      spec: normalizeCircuitSpec(USER_PROMPT),
      proMode: true
    });
    assert.equal(result.currentGap, 'power-architecture.railStrategy');
    assert.match(result.assistantMessage, /스위칭|LDO|효율/);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});
