import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { listSupportedProfiles, matchSupportedProfile } from './board-profiles.js';
import {
  applyProductDraft,
  canGenerateImmediately,
  detectProductRequest,
  examplesForField,
  extraUnsupportedKinds,
  fieldKey,
  generateKindFromDetection,
  openFields,
  recommendedAnswers
} from './product-catalog.js';
import {
  canRoleFromContext,
  mcuNeedFromContext,
  resolveSourcedParts,
  summarizeSourcing
} from './part-sourcing.js';

export const CONVERSATION_FILE = '.chatpcb-conversation.json';

function korean(text) {
  return /[가-힣]/.test(text ?? '');
}

function kindList(detection, prompt) {
  return detection.kinds.map((kind) => (korean(prompt) ? kind.labels.ko : kind.labels.en)).join(', ');
}

function filledFacts(detection) {
  const lines = [];
  for (const kind of detection.kinds) {
    for (const [fieldId, value] of Object.entries(detection.facts[kind.id] ?? {})) {
      lines.push(`${kind.id}.${fieldId}=${value}`);
    }
  }
  return lines;
}

function decorateLabel(example, ko) {
  const base = ko ? example.labelKo : example.labelEn;
  if (!example.recommended) return base;
  return ko ? `${base} (권장)` : `${base} (recommended)`;
}

function optionsForField(field, prompt, detection, answers) {
  const ko = korean(prompt);
  const examples = examplesForField(field, detection ?? detectProductRequest(prompt), answers ?? {}).map((example) => ({
    id: example.id,
    label: decorateLabel(example, ko),
    prompt: ko ? example.promptKo : example.promptEn,
    help: ko ? example.helpKo : example.helpEn,
    recommended: example.recommended === true
  }));
  return [
    ...examples,
    {
      id: `skip-${field.id}`,
      label: ko ? '이 항목은 나중에' : 'Skip for now',
      prompt: ko ? `${field.questionKo} 나중에.` : `Skip ${field.id} for now.`,
      help: ko
        ? '특징: 이번 항목을 비워 두고 다음으로 갑니다.\n장점: 잘 모를 때 흐름을 멈추지 않음.\n단점: 프로파일에 빈칸이 남아 초안이 더 추상적입니다.'
        : 'Leaves this field empty and continues.\nPros: you can proceed without guessing.\nCons: the draft stays less specific.'
    }
  ];
}

function pathOptions(prompt, detection) {
  const ko = korean(prompt);
  const closest = matchSupportedProfile({ sourcePrompt: prompt, mcu: { family: detection.primary?.id === 'mcu-board' ? 'ESP32-S3' : undefined } });
  const options = [
    {
      id: 'create-profile',
      label: ko ? '새 프로파일 초안 만들기' : 'Create a new profile draft',
      prompt: ko ? '새 프로파일을 만들자. 부족한 점을 하나씩 물어봐.' : 'Create a new profile. Ask the missing details one at a time.',
      help: ko
        ? '특징: 빠진 항목을 채팅으로 하나씩 기록합니다.\n장점: 전문가가 아니어도 후보를 고르며 구체화할 수 있음.\n단점: 바로 완성 회로가 나오지 않음.'
        : 'Walks missing fields one at a time.\nPros: you can choose from explained candidates.\nCons: does not finish the schematic immediately.'
    }
  ];
  if (detection.kinds.some((kind) => kind.id === 'mcu-board') || closest) {
    options.push({
      id: 'use-closest',
      label: ko ? '가까운 MCU 지원 프로파일 사용' : 'Use closest MCU supported profile',
      prompt: ko ? '가까운 지원 프로파일로 진행해.' : 'Continue with the closest supported profile.',
      help: ko
        ? '특징: 이미 있는 ESP32-S3/STM32 USB-C 센서 초안을 씁니다.\n장점: 가장 빨리 회로 파일이 나옴.\n단점: 디스플레이·CAN·배터리 등 요청 일부가 빠질 수 있음.'
        : 'Uses the existing ESP32-S3/STM32 USB-C sensor draft.\nPros: fastest schematic files.\nCons: display/CAN/battery parts of the request may be dropped.'
    });
  }
  if (detection.kinds.some((kind) => kind.generate)) {
    options.push({
      id: 'generate-now',
      label: ko ? '지금 아는 범위로 초안 만들기' : 'Generate a draft from what we know',
      prompt: ko ? '지금 아는 범위로 초안을 만들어.' : 'Generate a draft from the facts we already have.',
      help: ko
        ? '특징: 지금까지 고른 값만으로 스케폴드를 만듭니다.\n장점: 빈칸이 있어도 진행 가능.\n단점: 자리표시 부품이 많고 리뷰에서 Blocked가 날 수 있음.'
        : 'Builds a scaffold from known facts only.\nPros: you can proceed with blanks.\nCons: many placeholders; review may stay blocked.'
    });
  }
  return options;
}

function introMessage(prompt, spec, detection, open) {
  const ko = korean(prompt);
  const profiles = listSupportedProfiles().map((profile) => `${profile.id} (${profile.part})`).join(', ');
  const extras = extraUnsupportedKinds(detection, spec).map((kind) => (ko ? kind.labels.ko : kind.labels.en));
  const facts = filledFacts(detection);
  const missing = open.map((item) => (ko ? item.field.questionKo : item.field.questionEn));
  if (ko) {
    return [
      `요청을 ${kindList(detection, prompt)} 제품으로 해석했습니다.`,
      matchSupportedProfile(spec)
        ? `MCU 지원 프로파일은 일부만 맞습니다. 전체 지원 프로파일: ${profiles}.`
        : `지금 완성된 지원 프로파일은 없습니다. 있는 것: ${profiles}.`,
      extras.length ? `아직 생성기가 그리지 못하는 부분: ${extras.join(', ')}.` : '',
      facts.length ? `프롬프트에서 읽은 값: ${facts.join(', ')}.` : '',
      missing.length ? `채팅으로 이어서 구체화할 항목이 있습니다.` : '',
      '막지 않고 프로파일을 만들거나 초안을 고르면 됩니다.'
    ].filter(Boolean).join('\n');
  }
  return [
    `Interpreted this as: ${kindList(detection, prompt)}.`,
    matchSupportedProfile(spec)
      ? `An MCU profile matches only part of the request. Supported profiles: ${profiles}.`
      : `No complete supported profile. Available: ${profiles}.`,
    extras.length ? `Not drawn yet: ${extras.join(', ')}.` : '',
    facts.length ? `Extracted: ${facts.join(', ')}.` : '',
    'This is the product flow: create a profile draft or generate from what we know.'
  ].filter(Boolean).join('\n');
}

function askField(item, prompt, conversation) {
  const ko = korean(prompt);
  const detection = detectProductRequest(conversation?.sourcePrompt ?? prompt);
  return {
    nextQuestion: ko ? item.field.questionKo : item.field.questionEn,
    options: optionsForField(item.field, prompt, detection, conversation?.answers)
  };
}

function parseIntent(prompt, conversation) {
  if (/처음부터|restart|다시 시작/i.test(prompt)) return { type: 'restart' };
  const selected = (conversation?.options ?? []).find((item) => (
    item.prompt === prompt || item.id === prompt || item.label === prompt
  ));
  if (selected?.id === 'use-closest' || selected?.id === 'create-profile' || selected?.id === 'generate-now') {
    return { type: selected.id };
  }
  const pathStep = conversation?.step === 'choose-path' || conversation?.step === 'confirm-generate';
  if (pathStep && /가까운|지원 프로파일|use-closest|esp32-s3-usbc-sensor|stm32-usbc-sensor/i.test(prompt)) {
    return { type: 'use-closest' };
  }
  if (/새 프로파일|프로파일.*만들|create a new profile|구체화|부족한 점을 하나씩/i.test(prompt)) {
    return { type: 'create-profile' };
  }
  if (/지금 아는 범위로 초안|generate a draft from the facts we already have|generate anyway/i.test(prompt)) {
    return { type: 'generate-now' };
  }
  if (pathStep && /초안|지금 아는 범위|generate anyway|픽스처|draft from the facts/i.test(prompt)) {
    return { type: 'generate-now' };
  }
  return { type: 'answer', value: prompt.trim() };
}

function snapshot(detection, spec, prompt) {
  return {
    version: 1,
    sourcePrompt: prompt,
    family: spec.mcu?.family,
    primaryKind: detection.primary.id,
    kinds: detection.kinds.map((kind) => kind.id),
    facts: detection.facts,
    unmatched: extraUnsupportedKinds(detection, spec).map((kind) => kind.id),
    missingProfile: !matchSupportedProfile(spec),
    answers: {},
    messages: []
  };
}

const ANSWER_LABELS = {
  'power-architecture.railStrategy': { ko: '전원 토폴로지', en: 'Power topology' },
  'integration.neighbors': { ko: '제품 연계', en: 'Product integration' },
  'mcu-board.radio': { ko: '무선 사양', en: 'Radio spec' },
  'mcu-board.usb': { ko: 'USB 사양', en: 'USB spec' },
  'mcu-board.memory': { ko: '메모리 사양', en: 'Memory spec' },
  'mcu-board.ioNeeds': { ko: 'MCU 주변 사양', en: 'MCU I/O spec' },
  'mcu-board.mcuPart': { ko: '역제안 MCU', en: 'Reverse-recommended MCU' },
  'sensors.type': { ko: '센서 종류', en: 'Sensor type' },
  'sensors.spec': { ko: '센서 스펙', en: 'Sensor spec' },
  'sensors.bus': { ko: '센서 통신', en: 'Sensor bus' },
  'sensors.connector': { ko: '센서 커넥터', en: 'Sensor connector' },
  'wired-comms.deviceVoltage': { ko: '버스 전압', en: 'Bus voltage' },
  'wired-comms.phy': { ko: '트랜시버', en: 'Transceiver' },
  'energy-storage.pack': { ko: '배터리', en: 'Battery' },
  'bms.companions': { ko: 'BMIC 연관 IC', en: 'BMIC companions' },
  'datasheet-companions.include': { ko: '데이터시트 연관 IC', en: 'Datasheet companions' },
  'hmi.panel': { ko: '디스플레이', en: 'Display' },
  'isolated-dcdc.isolation': { ko: '절연 정격', en: 'Isolation' },
  'isolated-dcdc.topology': { ko: '변환 토폴로지', en: 'Converter topology' }
};

function summarizeAnswers(answers, ko) {
  return Object.entries(answers)
    .filter(([, value]) => value && value !== 'deferred')
    .map(([key, value]) => {
      const label = ANSWER_LABELS[key];
      const name = label ? (ko ? label.ko : label.en) : key;
      return `- ${name}: ${value}`;
    })
    .join('\n');
}

function recommendedConversation(detection, spec, prompt) {
  const answers = recommendedAnswers(detection);
  const ko = korean(prompt);
  const lines = summarizeAnswers(answers, ko);
  const assistantMessage = ko
    ? `Pro 모드가 꺼져 있어 권장 구성으로 진행합니다.\n${lines}`
    : `Pro mode is off; continuing with recommended defaults.\n${lines}`;
  const facts = Object.entries(answers).map(([key, value]) => `${key}=${value}`).join('\n');
  return {
    ...snapshot(detection, spec, prompt),
    proMode: false,
    answers,
    status: 'generate',
    step: 'generate',
    forceProfileId: matchSupportedProfile(spec)?.id ?? null,
    generateKind: generateKindFromDetection(detection),
    generatePrompt: `${prompt}\n${facts}`,
    assistantMessage,
    nextQuestion: null,
    options: [],
    messages: [
      { role: 'user', text: prompt },
      { role: 'assistant', text: assistantMessage }
    ]
  };
}

export function startCircuitConversation(prompt, spec, { proMode = false } = {}) {
  const detection = detectProductRequest(prompt);
  if (!proMode) {
    return recommendedConversation(detection, spec, prompt);
  }

  if (canGenerateImmediately(detection, spec) && openFields(detection, {}, { proMode: true }).length === 0) {
    return {
      ...snapshot(detection, spec, prompt),
      proMode: true,
      status: 'generate',
      step: 'generate',
      forceProfileId: matchSupportedProfile(spec)?.id ?? null,
      generatePrompt: prompt,
      generateKind: generateKindFromDetection(detection)
    };
  }

  const open = openFields(detection, {}, { proMode: true });
  const assistantMessage = introMessage(prompt, spec, detection, open);
  return {
    ...snapshot(detection, spec, prompt),
    proMode: true,
    status: 'awaiting-input',
    step: 'choose-path',
    assistantMessage,
    nextQuestion: korean(prompt) ? '아래에서 진행 방법을 고르거나 채팅으로 답하세요.' : 'Pick a path below or reply in chat.',
    options: pathOptions(prompt, detection),
    messages: [
      { role: 'user', text: prompt },
      { role: 'assistant', text: assistantMessage }
    ]
  };
}

function nextOpen(conversation, spec) {
  const detection = detectProductRequest(conversation.sourcePrompt);
  return openFields(detection, conversation.answers, { proMode: conversation.proMode === true });
}

function askNext(conversation, spec, messages) {
  const open = nextOpen(conversation, spec);
  if (open.length === 0) {
    return finishReady(conversation, messages);
  }
  const item = open[0];
  const asked = askField(item, conversation.sourcePrompt, conversation);
  return {
    ...conversation,
    status: 'awaiting-input',
    step: 'collect-gaps',
    currentGap: item.key,
    assistantMessage: asked.nextQuestion,
    nextQuestion: asked.nextQuestion,
    options: asked.options,
    messages: [...messages, { role: 'assistant', text: asked.nextQuestion }]
  };
}

function finishReady(conversation, messages) {
  const ko = korean(conversation.sourcePrompt);
  const recorded = Object.entries(conversation.answers ?? {})
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}: ${value}`);
  const assistantMessage = ko
    ? `프로파일 초안에 기록했습니다.\n${recorded.join('\n') || '(추가 기록 없음)'}\n생성기가 아직 못 그리는 블록은 초안 노트/리뷰에 남습니다. 초안 방법을 고르세요.`
    : `Recorded for the profile draft.\n${recorded.join('\n') || '(nothing extra recorded)'}\nBlocks we cannot draw yet stay in review notes. Choose how to generate.`;
  return {
    ...conversation,
    status: 'awaiting-input',
    step: 'confirm-generate',
    currentGap: null,
    assistantMessage,
    nextQuestion: ko ? '초안을 만들 방법을 고르세요.' : 'Choose how to generate a draft.',
    options: pathOptions(conversation.sourcePrompt, detectProductRequest(conversation.sourcePrompt)),
    messages: [...messages, { role: 'assistant', text: assistantMessage }]
  };
}

export function replyToCircuitConversation(conversation, prompt, spec) {
  const intent = parseIntent(prompt, conversation);
  const messages = [...(conversation.messages ?? []), { role: 'user', text: prompt }];
  const detection = detectProductRequest(conversation.sourcePrompt);

  if (/선택지|다시 보여|다시 물어/i.test(prompt) && conversation.currentGap) {
    const open = nextOpen(conversation, spec).find((item) => item.key === conversation.currentGap)
      ?? nextOpen(conversation, spec)[0];
    if (open) {
      const asked = askField(open, conversation.sourcePrompt, conversation);
      return {
        ...conversation,
        assistantMessage: asked.nextQuestion,
        nextQuestion: asked.nextQuestion,
        options: asked.options,
        messages: [...messages, { role: 'assistant', text: asked.nextQuestion }]
      };
    }
  }

  if (intent.type === 'restart') {
    const restarted = startCircuitConversation(conversation.sourcePrompt ?? prompt, spec, { proMode: conversation.proMode === true });
    restarted.messages = [...messages, { role: 'assistant', text: restarted.assistantMessage }];
    return restarted;
  }

  if (intent.type === 'use-closest') {
    const forceProfileId = matchSupportedProfile(spec)?.id
      ?? (detection.kinds.some((kind) => kind.id === 'mcu-board') ? 'esp32-s3-usbc-sensor' : null);
    const ko = korean(prompt);
    const assistantMessage = ko
      ? `가까운 지원 프로파일 ${forceProfileId ?? '(없음)'} 로 초안을 만듭니다. 프로파일에 없는 블록은 리뷰에 남습니다.`
      : `Generating with closest supported profile ${forceProfileId ?? '(none)'}. Unsupported blocks stay in review.`;
    return {
      ...conversation,
      status: 'generate',
      step: 'generate',
      forceProfileId,
      generateKind: 'mcu',
      generatePrompt: forceProfileId === 'stm32-usbc-sensor'
        ? `Release profile STM32 USB-C sensor board with 3.3V regulator. Original request: ${conversation.sourcePrompt}`
        : `Release profile ESP32-S3 USB-C sensor board with 3.3V regulator. Original request: ${conversation.sourcePrompt}`,
      assistantMessage,
      nextQuestion: null,
      options: [],
      messages: [...messages, { role: 'assistant', text: assistantMessage }]
    };
  }

  if (intent.type === 'generate-now') {
    const ko = korean(prompt);
    const generateKind = generateKindFromDetection(detection);
    const facts = Object.entries({ ...flattenFacts(conversation), ...conversation.answers })
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    const assistantMessage = ko
      ? '지금 아는 범위로 초안을 만듭니다. 못 그리는 블록은 프로파일 기록과 리뷰에 남고, 채팅으로 이어서 구체화할 수 있습니다.'
      : 'Generating a draft from known facts. Undrawn blocks stay in the profile record and can be refined in chat.';
    return {
      ...conversation,
      status: 'generate',
      step: 'generate',
      generateKind,
      generatePrompt: `${conversation.sourcePrompt}\n${facts}`,
      assistantMessage,
      nextQuestion: null,
      options: [],
      messages: [...messages, { role: 'assistant', text: assistantMessage }]
    };
  }

  if (intent.type === 'create-profile' || conversation.step === 'choose-path') {
    const answers = { ...(conversation.answers ?? {}) };
    const open = nextOpen({ ...conversation, answers }, spec);
    if (intent.type === 'answer' && open[0]) {
      answers[open[0].key] = /나중에|skip/i.test(intent.value) ? 'deferred' : intent.value;
    }
    return askNext({ ...conversation, answers, path: 'create-profile' }, spec, messages);
  }

  const answers = { ...(conversation.answers ?? {}) };
  if (conversation.currentGap) {
    answers[conversation.currentGap] = /나중에|skip/i.test(intent.value) ? 'deferred' : intent.value;
  }
  return askNext({ ...conversation, answers }, spec, messages);
}

function flattenFacts(conversation) {
  const answers = {};
  for (const [kindId, fields] of Object.entries(conversation.facts ?? {})) {
    for (const [fieldId, value] of Object.entries(fields ?? {})) {
      answers[fieldKey(kindId, fieldId)] = value;
    }
  }
  return answers;
}

export function conversationWantsGenerate(conversation) {
  return conversation?.status === 'generate';
}

export { applyProductDraft };

export async function loadCircuitConversation(projectDir) {
  try {
    const raw = await readFile(path.join(projectDir, CONVERSATION_FILE), 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function saveCircuitConversation(projectDir, conversation) {
  await writeFile(path.join(projectDir, CONVERSATION_FILE), `${JSON.stringify(conversation, null, 2)}\n`, 'utf8');
}

export async function enrichConversationSourcing(conversation) {
  if (!conversation || conversation.status !== 'generate') return conversation;
  const ctx = { prompt: conversation.sourcePrompt, answers: conversation.answers, facts: conversation.facts };
  const picks = {};
  const existingMcu = conversation.answers?.['mcu-board.mcuPart'];
  if (existingMcu || /esp32|stm32/i.test(conversation.sourcePrompt ?? '')) {
    const mcu = await resolveSourcedParts({
      role: 'mcu-module',
      need: mcuNeedFromContext(ctx),
      query: existingMcu
        || (/stm32/i.test(conversation.sourcePrompt ?? '') && !/esp32/i.test(conversation.sourcePrompt ?? '') ? 'STM32' : 'ESP32 WROOM')
    });
    if (mcu.parts[0]) {
      picks.mcu = existingMcu
        ? (mcu.parts.find((item) => item.mpn === existingMcu) ?? { ...mcu.parts[0], mpn: existingMcu })
        : mcu.parts[0];
      if (!existingMcu) {
        conversation.answers = { ...conversation.answers, 'mcu-board.mcuPart': picks.mcu.mpn };
      }
    }
  }
  const existingPhy = conversation.answers?.['wired-comms.phy'];
  if (existingPhy || /\bcan\b|캔/i.test(conversation.sourcePrompt ?? '')) {
    const can = await resolveSourcedParts({ role: canRoleFromContext(ctx), query: existingPhy });
    if (can.parts[0]) {
      picks.can = existingPhy
        ? (can.parts.find((item) => item.mpn === existingPhy) ?? { ...can.parts[0], mpn: existingPhy })
        : can.parts[0];
      if (!existingPhy) {
        conversation.answers = { ...conversation.answers, 'wired-comms.phy': picks.can.mpn };
      }
    }
  }
  if (/18650|건전지/i.test(conversation.sourcePrompt ?? '')) {
    const charger = await resolveSourcedParts({ role: 'charger-1s' });
    const converter = await resolveSourcedParts({ role: 'buck-boost' });
    if (charger.parts[0]) picks.charger = charger.parts[0];
    if (converter.parts[0]) picks.converter = converter.parts[0];
  }
  if (/usb|esp32/i.test(conversation.sourcePrompt ?? '')) {
    const esd = await resolveSourcedParts({ role: 'usb-esd' });
    if (esd.parts[0]) picks.usbEsd = esd.parts[0];
  }
  if (picks.can) {
    const tvs = await resolveSourcedParts({ role: 'can-tvs' });
    if (tvs.parts[0]) picks.canTvs = tvs.parts[0];
  }
  if (Object.keys(picks).length === 0) return conversation;
  const ko = korean(conversation.sourcePrompt);
  const note = summarizeSourcing(picks, ko);
  const messages = [...(conversation.messages ?? [])];
  if (note && !messages.some((message) => message.text === note)) {
    messages.push({ role: 'assistant', text: note });
  }
  return {
    ...conversation,
    sourcing: { source: picks.mcu?.source ?? picks.can?.source ?? 'mouser-index', parts: picks },
    assistantMessage: note ? `${conversation.assistantMessage ?? ''}\n${note}` : conversation.assistantMessage,
    messages,
    generatePrompt: `${conversation.generatePrompt ?? conversation.sourcePrompt}\n${Object.entries(conversation.answers ?? {}).map(([key, value]) => `${key}=${value}`).join('\n')}`
  };
}

export async function continueCircuitConversation({ projectDir, prompt, spec, proMode = false }) {
  const existing = await loadCircuitConversation(projectDir);
  let next;
  if (existing?.status === 'awaiting-input') {
    if (!proMode) {
      const detection = detectProductRequest(existing.sourcePrompt);
      next = recommendedConversation(detection, spec, existing.sourcePrompt);
      next.messages = [...(existing.messages ?? []), { role: 'assistant', text: next.assistantMessage }];
    } else {
      next = replyToCircuitConversation(existing, prompt, spec);
      next.proMode = true;
    }
  } else {
    next = startCircuitConversation(prompt, spec, { proMode });
  }
  next = await enrichConversationSourcing(next);
  await saveCircuitConversation(projectDir, next);
  return next;
}
