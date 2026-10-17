import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DELETION_INTENT_VOCABULARY,
  classifyDeletionIntents,
  classifyExistingProjectRequest,
  removalIntentUnclearMessage
} from '../src/workflow/existing-project-edit.js';

const SPEC = { sourcePrompt: 'existing' };
const REMOVAL_UNCLEAR_MESSAGE = [
  'Which part should I remove? Give its reference, like J2. Nothing was removed.',
  '어떤 부품을 뺄까요? 참조번호(예: J2)로 알려 주세요. 아무것도 빼지 않았어요.'
].join('\n');

// Fail-closed contract. A row removes I2C only when it is a plain delete.
// Earlier expectations that changed when double negation, same-sentence
// negation, and two-target prompts stopped counting as a delete:
// - "don't not remove I2C" was delete:i2c (even marker count). Now refuse-clarify.
// - "I can't not remove I2C" follows that same double-negation rule.
// - "I don't need I2C, remove it" and "I2C는 필요 없으니 삭제" were delete:i2c.
//   The sentence that names I2C contains a negation cue, so they refuse-clarify.
//   "remove it" is the same part, so that intent is negated i2c.
// - "don't remove the LED, remove I2C" was an I2C removal candidate.
//   Two removal targets plus a negation now refuse-clarify. The LED intent is
//   negated and the I2C intent stays positive; the list rule asks instead of
//   choosing I2C.
// - "remove I2C? no, keep it" and "remove I2C. actually keep it" stay
//   refuse-clarify. The keep cue marks that I2C intent negated.
// - "I2C 빼지 마. LED 저항 680옴" stays a 680Ω edit. 빼 is a removal verb,
//   so the I2C intent is negated.
// - "LED 삭제하고 I2C는 남겨", "LED 삭제하고 나서 I2C는 유지", and
//   "LED는 삭제하지만 I2C는 남겨" were refusals. A single clean LED removal
//   with I2C only kept is removal-candidate:LED.
// - "LED 또는 I2C 삭제", "remove LED and I2C", "LED 삭제하고 I2C도", and the
//   other conjunction lists were one removal candidate. Two or more removal
//   targets in one list now ask which part. I2C is not chosen.
const CONTRACT = [
  { prompt: 'I2C 삭제하지 마', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'I2C 커넥터는 삭제하지 마세요', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'I2C 지우지 마', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: "don't remove I2C", outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'dont remove I2C', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'do not delete the I2C connector', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: "keep I2C, don't remove it", outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'Don\u2019t remove the I2C connector', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'shouldn\u2019t remove I2C', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: "shouldn't remove I2C", outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'should not remove I2C', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'do not ever remove I2C', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: "don't ever remove I2C", outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'never remove I2C', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'no need to remove I2C', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: "don't, please, remove I2C", outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'do not under any circumstances remove I2C', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'Do not, under any circumstances, remove I2C', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: "Please don't\nremove I2C", outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: "DON'T REMOVE I2C", outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: "don't   remove   I2C", outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: "\uFF44\uFF4F\uFF4E'\uFF54 \uFF52\uFF45\uFF4D\uFF4F\uFF56\uFF45 I2C", outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'I2C 삭제 하지마', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'I2C 삭제는 하지 말아 주세요', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'I2C 삭제하면 안 돼', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'I2C 삭제하면 안돼', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'I2C 제거 안 해도 돼', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'I2C 삭제 금지', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'I2C 제거 말고', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'I2C를 삭제하지 않도록', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'I2C 삭제하지 않도록', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'I2C 삭제 안 함', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'I2C 삭제 안함', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: '"remove I2C" is not what I want', outcome: 'refuse-clarify', ask: false, positive: [], negated: [] },
  { prompt: '"remove I2C" is what I do NOT want', outcome: 'refuse-clarify', ask: false, positive: [], negated: [] },
  { prompt: '\u201Cremove I2C\u201D is not what I want', outcome: 'refuse-clarify', ask: false, positive: [], negated: [] },
  { prompt: '\u2018remove I2C\u2019 is not what I want', outcome: 'refuse-clarify', ask: false, positive: [], negated: [] },
  { prompt: 'remove the LED but don\'t remove I2C', outcome: 'refuse-clarify', ask: true, positive: ['led'], negated: ['i2c'] },
  { prompt: "don't remove I2C, remove LED", outcome: 'refuse-clarify', ask: true, positive: ['led'], negated: ['i2c'] },
  { prompt: 'remove the LED and then don\'t remove I2C', outcome: 'refuse-clarify', ask: true, positive: ['led'], negated: ['i2c'] },
  { prompt: "don't remove the LED, remove I2C", outcome: 'refuse-clarify', ask: true, positive: ['i2c'], negated: ['led'] },
  { prompt: 'I2C 남기고 LED 저항 삭제', outcome: 'refuse-clarify', ask: true, positive: ["led-resistor"], negated: [] },
  { prompt: 'LED 삭제하고 I2C는 남겨', outcome: 'removal-candidate:LED', positive: ["led"], negated: [] },
  { prompt: 'LED 삭제하고 나서 I2C는 유지', outcome: 'removal-candidate:LED', positive: ["led"], negated: [] },
  { prompt: 'LED는 삭제하지만 I2C는 남겨', outcome: 'removal-candidate:LED', positive: ["led"], negated: [] },
  { prompt: 'I2C 제거 말고 LED 삭제', outcome: 'refuse-clarify', ask: true, positive: ['led'], negated: ['i2c'] },
  { prompt: 'I2C 삭제하지 말고 LED 삭제', outcome: 'refuse-clarify', ask: true, positive: ['led'], negated: ['i2c'] },
  { prompt: 'reset 버튼 삭제. I2C 커넥터는 유지하세요.', outcome: 'refuse-clarify', ask: false, positive: [], negated: [] },
  { prompt: 'I2C는 버리지 말고 LED 저항 680옴', outcome: 'edit-applied', ohms: 680, positive: [], negated: [] },
  { prompt: 'I2C 없애지 말고 LED 저항 680옴', outcome: 'edit-applied', ohms: 680, positive: [], negated: [] },
  { prompt: 'I2C 빼지 마. LED 저항 680옴', outcome: 'edit-applied', ohms: 680, positive: [], negated: ["i2c"] },
  { prompt: "you shouldn't remove I2C; LED resistor 680 ohm", outcome: 'edit-applied', ohms: 680, positive: [], negated: ["i2c"] },
  { prompt: 'change LED resistor to 680 ohm without removing I2C', outcome: 'edit-applied', ohms: 680, positive: [], negated: [] },
  { prompt: 'keep I2C, set LED resistor 680 ohm', outcome: 'edit-applied', ohms: 680, positive: [], negated: [] },
  { prompt: 'I2C 제거 말고 LED 저항 680옴', outcome: 'edit-applied', ohms: 680, positive: [], negated: ["i2c"] },
  { prompt: "Change the status LED series resistor to 680 ohm. don't remove I2C.", outcome: 'edit-applied', ohms: 680, positive: [], negated: ["i2c"] },
  { prompt: 'I2C는 삭제하거나 변경하지 마세요', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'I2C는 삭제하거나 변경하지 마', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'I2C는 삭제나 변경 하지 마', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: "don't remove or change I2C", outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: "do not change or remove I2C", outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: '기존 프로젝트에서 상태 LED D1의 전류 제한 저항 R3 값만 330Ω에서 680Ω으로 변경하는 편집을 미리보기로 준비하세요. I2C는 절대 삭제하거나 변경하지 마세요.', outcome: 'edit-applied', ohms: 680, positive: [], negated: ["i2c"] },
  { prompt: 'change R3 from 330Ω to 680Ω', outcome: 'edit-applied', ohms: 680, positive: [], negated: [] },
  { prompt: 'R3 330 ohm -> 680 ohm', outcome: 'edit-applied', ohms: 680, positive: [], negated: [] },
  { prompt: 'LED 저항 330옴에서 680옴으로', outcome: 'edit-applied', ohms: 680, positive: [], negated: [] },
  { prompt: '상태 LED 저항 R3(현재 330Ω)의 값만 680Ω으로 변경하세요', outcome: 'edit-applied', ohms: 680, positive: [], negated: [] },
  { prompt: 'set R3 330Ω 680Ω', outcome: 'edit-applied', ohms: 680, positive: [], negated: [] },
  { prompt: 'Delete the I2C connector', outcome: 'removal-candidate:i2c', positive: ["i2c"], negated: [] },
  { prompt: 'Remove the I2C connector', outcome: 'removal-candidate:i2c', positive: ["i2c"], negated: [] },
  { prompt: 'remove the I2C connector', outcome: 'removal-candidate:i2c', positive: ["i2c"], negated: [] },
  { prompt: 'I2C 커넥터 삭제', outcome: 'removal-candidate:i2c', positive: ["i2c"], negated: [] },
  // Double negation is not an affirmative delete. This row used to be delete:i2c.
  { prompt: "don't not remove I2C", outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: "I can't not remove I2C", outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'remove I2C', outcome: 'removal-candidate:i2c', positive: ["i2c"], negated: [] },
  { prompt: 'Remove the I2C connector.', outcome: 'removal-candidate:i2c', positive: ["i2c"], negated: [] },
  { prompt: 'delete the I2C header', outcome: 'removal-candidate:i2c', positive: ["i2c"], negated: [] },
  { prompt: 'I2C 삭제해줘', outcome: 'removal-candidate:i2c', positive: ["i2c"], negated: [] },
  { prompt: 'I2C 커넥터 제거', outcome: 'removal-candidate:i2c', positive: ["i2c"], negated: [] },
  { prompt: "I don't need I2C, remove it", outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'I2C는 필요 없으니 삭제', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'I2C 지워줘', outcome: 'removal-candidate:i2c', positive: ["i2c"], negated: [] },
  { prompt: 'I2C 커넥터 지워', outcome: 'removal-candidate:i2c', positive: ["i2c"], negated: [] },
  { prompt: 'don\u02BCt remove I2C', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'don`t remove I2C', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'don\u00B4t remove I2C', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'I2C를 삭제할 필요 없어', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'I2C 지우면 안 돼', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'keep I2C and remove the LED', outcome: 'removal-candidate:LED', positive: ["led"], negated: [] },
  { prompt: 'remove LED but keep I2C', outcome: 'removal-candidate:LED', positive: ["led"], negated: [] },
  { prompt: 'remove I2C but keep LED', outcome: 'removal-candidate:i2c', positive: ["i2c"], negated: [] },
  // "and" inside a word is not a conjunction ("standard", "bandgap", "command").
  { prompt: 'remove the standard LED', outcome: 'removal-candidate:LED', positive: ["led"], negated: [] },
  { prompt: 'delete the bandgap LED', outcome: 'removal-candidate:LED', positive: ["led"], negated: [] },
  { prompt: 'remove the command LED', outcome: 'removal-candidate:LED', positive: ["led"], negated: [] },
  // Two removal targets joined by a conjunction or list. Ask which part.
  { prompt: 'LED 또는 I2C 삭제', outcome: 'refuse-clarify', ask: true, positive: ['i2c'], negated: [] },
  { prompt: 'LED 그리고 I2C 삭제', outcome: 'refuse-clarify', ask: true, positive: ['i2c'], negated: [] },
  { prompt: 'LED 삭제하고 I2C도', outcome: 'refuse-clarify', ask: true, positive: ['led'], negated: [] },
  { prompt: 'remove LED and I2C', outcome: 'refuse-clarify', ask: true, positive: ['led'], negated: [] },
  { prompt: 'remove LED, I2C', outcome: 'refuse-clarify', ask: true, positive: ['led'], negated: [] },
  { prompt: 'remove both LED and I2C', outcome: 'refuse-clarify', ask: true, positive: ['led'], negated: [] },
  { prompt: 'remove LED or I2C', outcome: 'refuse-clarify', ask: true, positive: ['led'], negated: [] },
  { prompt: 'LED/I2C 삭제', outcome: 'refuse-clarify', ask: true, positive: ['i2c'], negated: [] },
  { prompt: 'LED랑 I2C 삭제', outcome: 'refuse-clarify', ask: true, positive: ['i2c'], negated: [] },
  { prompt: 'LED와 I2C 삭제', outcome: 'refuse-clarify', ask: true, positive: ['i2c'], negated: [] },
  { prompt: 'LED하고 I2C 삭제', outcome: 'refuse-clarify', ask: true, positive: ['i2c'], negated: [] },
  { prompt: 'LED 및 I2C 제거', outcome: 'refuse-clarify', ask: true, positive: ['i2c'], negated: [] },
  { prompt: 'remove LED & I2C', outcome: 'refuse-clarify', ask: true, positive: ['led'], negated: [] },
  { prompt: 'delete the LED and the I2C connector', outcome: 'refuse-clarify', ask: true, positive: ['led'], negated: [] },
  { prompt: 'remove not I2C but LED', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'remove I2C? no, keep it', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'remove I2C. actually keep it', outcome: 'refuse-clarify', ask: true, positive: [], negated: ["i2c"] },
  { prompt: 'I2C 삭제해도 돼?', outcome: 'refuse-clarify', ask: true, positive: ['i2c'], negated: [] },
  { prompt: 'should I remove I2C?', outcome: 'refuse-clarify', ask: true, positive: ['i2c'], negated: [] },

  // Format characters inside a negation word are still negations.
  { prompt: 'don\u200B\'t remove I2C', outcome: 'refuse-clarify', ask: true, positive: [], negated: ['i2c'] },
  { prompt: 'don\'\u200Dt remove I2C', outcome: 'refuse-clarify', ask: true, positive: [], negated: ['i2c'] },
  { prompt: 'n\u200Bot remove I2C', outcome: 'refuse-clarify', ask: true, positive: [], negated: ['i2c'] },
  { prompt: 'do n\u200Bot remove I2C', outcome: 'refuse-clarify', ask: true, positive: [], negated: ['i2c'] },
  { prompt: 'don\u200C\'t remove I2C', outcome: 'refuse-clarify', ask: true, positive: [], negated: ['i2c'] },
  { prompt: 'don\u2060\'t remove I2C', outcome: 'refuse-clarify', ask: true, positive: [], negated: ['i2c'] },
  { prompt: '\uFEFFdon\'t remove I2C', outcome: 'refuse-clarify', ask: true, positive: [], negated: ['i2c'] },
  { prompt: 'don\u00ADt remove I2C', outcome: 'refuse-clarify', ask: true, positive: [], negated: ['i2c'] },
  { prompt: '절대 삭제 마 I2C', outcome: 'refuse-clarify', ask: true, positive: [], negated: ['i2c'] },
  { prompt: "Don't touch I2C. Now remove it.", outcome: 'refuse-clarify', ask: true, positive: [], negated: ['i2c'] },
  { prompt: 'Do not touch I2C. Remove the I2C connector.', outcome: 'refuse-clarify', ask: true, positive: [], negated: ['i2c'] },
  { prompt: "Don't touch I2C. Remove the LED.", outcome: 'removal-candidate:LED', positive: ['led'], negated: [] },
  { prompt: 'I2C 건드리지 마. I2C 삭제해', outcome: 'refuse-clarify', ask: true, positive: [], negated: ['i2c'] },
  { prompt: 'I2C 삭제 노노', outcome: 'refuse-clarify', ask: true, positive: [], negated: ['i2c'] },
  { prompt: 'I2C삭제ㄴㄴ', outcome: 'refuse-clarify', ask: true, positive: [], negated: ['i2c'] },
  { prompt: 'remove I2C, just kidding', outcome: 'refuse-clarify', ask: true, positive: [], negated: ['i2c'] },
  { prompt: 'remove I2C. jk', outcome: 'refuse-clarify', ask: true, positive: [], negated: ['i2c'] },
  { prompt: 'remove I2C... NOT', outcome: 'refuse-clarify', ask: true, positive: [], negated: ['i2c'] },
  { prompt: "don't remove R1", outcome: 'refuse-clarify', ask: false, positive: [], negated: [] },
  { prompt: 'R1 삭제하지 마', outcome: 'refuse-clarify', ask: false, positive: [], negated: [] },
  { prompt: 'without deleting the LED', outcome: 'refuse-clarify', ask: false, positive: [], negated: [] },
  { prompt: 'keep everything, no removal', outcome: 'refuse-clarify', ask: false, positive: [], negated: [] },
  { prompt: 'remove R1', outcome: 'refuse-clarify', ask: false, positive: [], negated: [] },
  { prompt: 'don\u2018t remove I2C', outcome: 'refuse-clarify', ask: true, positive: [], negated: ['i2c'] },
  { prompt: 'I2C는 남겨둬', outcome: 'refuse-clarify', ask: false, positive: [], negated: [] },
  { prompt: "there's no need to delete the I2C connector", outcome: 'refuse-clarify', ask: true, positive: [], negated: ['i2c'] },
  { prompt: 'drop the I2C connector', outcome: 'removal-candidate:i2c', positive: ['i2c'], negated: [] },
  { prompt: 'I2C 빼줘', outcome: 'removal-candidate:i2c', positive: ['i2c'], negated: [] },

];

function outcomeOf(decision) {
  if (decision.mode === 'refuse') return 'refuse-clarify';
  if (decision.mode !== 'merge') return decision.mode;
  if (decision.edit.kind === 'delete') {
    const target = decision.edit.targets?.[0];
    if (target === 'led') return 'removal-candidate:LED';
    return `removal-candidate:${target}`;
  }
  if (decision.edit.kind === 'resistor') return 'edit-applied';
  return decision.mode;
}

function removesI2c(decision) {
  return decision.mode === 'merge'
    && decision.edit?.kind === 'delete'
    && (decision.edit.targets ?? []).includes('i2c');
}

function boundTargets(prompt, negated) {
  return classifyDeletionIntents(prompt)
    .filter((item) => item.negated === negated && item.target)
    .map((item) => item.target);
}

test('deletion intent contract is fail-closed', () => {
  const ask = removalIntentUnclearMessage();
  assert.equal(ask, REMOVAL_UNCLEAR_MESSAGE);

  for (const row of CONTRACT) {
    const decision = classifyExistingProjectRequest(row.prompt, SPEC);
    assert.equal(outcomeOf(decision), row.outcome, row.prompt);
    assert.deepEqual(boundTargets(row.prompt, false), row.positive, `${row.prompt} positive`);
    assert.deepEqual(boundTargets(row.prompt, true), row.negated, `${row.prompt} negated`);
    assert.equal(removesI2c(decision), row.outcome === 'removal-candidate:i2c', row.prompt);
    if (row.outcome === 'edit-applied') {
      assert.equal(decision.edit.kind, 'resistor', row.prompt);
      assert.equal(decision.edit.ohms, row.ohms, row.prompt);
      assert.equal((decision.edit.targets ?? []).includes('i2c'), false, row.prompt);
    }
    if (row.outcome === 'removal-candidate:LED') {
      assert.deepEqual(decision.edit.targets, ['led'], row.prompt);
    }
    if (row.outcome === 'removal-candidate:i2c') {
      assert.deepEqual(decision.edit.targets, ['i2c'], row.prompt);
    }
    if (row.outcome === 'refuse-clarify' && row.ask) {
      assert.equal(decision.code, 'REMOVAL_INTENT_UNCLEAR', row.prompt);
      assert.equal(decision.message, REMOVAL_UNCLEAR_MESSAGE, row.prompt);
    }
    if (row.outcome === 'refuse-clarify' && !row.ask) {
      assert.equal(decision.code, undefined, row.prompt);
    }
  }
});

// intentional fail-closed: asks instead of removing
const FAIL_CLOSED_ASKS = [
  { prompt: "I don't need I2C, remove it", positive: [], negated: ["i2c"] },
  { prompt: 'I2C는 필요 없으니 삭제', positive: [], negated: ["i2c"] },
  { prompt: "don't change the LED, remove I2C" }
];

test('intentional fail-closed: asks instead of removing', () => {
  for (const row of FAIL_CLOSED_ASKS) {
    const decision = classifyExistingProjectRequest(row.prompt, SPEC);
    assert.equal(outcomeOf(decision), 'refuse-clarify', row.prompt);
    assert.equal(decision.code, 'REMOVAL_INTENT_UNCLEAR', row.prompt);
    assert.equal(removesI2c(decision), false, row.prompt);
    assert.equal(decision.message, REMOVAL_UNCLEAR_MESSAGE, row.prompt);
  }
});

test('removal intent follows the original prompt when the tool text was rewritten', () => {
  const kept = classifyExistingProjectRequest(
    'remove I2C',
    SPEC,
    '680옴으로 바꿔줘. I2C는 삭제하지 마'
  );
  assert.equal(outcomeOf(kept), 'edit-applied');
  assert.equal(kept.edit.ohms, 680);

  const rewrittenKeep = classifyExistingProjectRequest(
    '기존 프로젝트에서 R3 값만 330Ω에서 680Ω으로 변경하세요. I2C는 삭제하거나 변경하지 마세요.',
    SPEC,
    '680옴으로 바꿔줘. I2C는 삭제하지 마'
  );
  assert.equal(outcomeOf(rewrittenKeep), 'edit-applied');
  assert.equal(rewrittenKeep.edit.ohms, 680);
  assert.deepEqual(
    classifyDeletionIntents('680옴으로 바꿔줘. I2C는 삭제하지 마')
      .filter((item) => item.negated === false && item.target)
      .map((item) => item.target),
    []
  );

  for (const prompt of ['Delete the I2C connector', 'Remove the I2C connector', 'I2C 커넥터 삭제']) {
    const decision = classifyExistingProjectRequest('Delete J2 from the existing project.', SPEC, prompt);
    assert.equal(outcomeOf(decision), 'removal-candidate:i2c', prompt);
  }

  const toolBoard = 'RP2040 board with USB-C power, I2C connector, reset button, and status LED.';
  const regenerated = classifyExistingProjectRequest(toolBoard, SPEC, 'Add reset button and status LED.');
  assert.equal(regenerated.mode, 'regenerate');
  assert.equal(regenerated.prompt, undefined);

  const clientBoard = 'STM32 board with USB-C power, I2C connector, UART header, reset button, and LED.';
  const fromClient = classifyExistingProjectRequest('Add a status LED.', SPEC, clientBoard);
  assert.equal(fromClient.mode, 'regenerate');
  assert.equal(fromClient.prompt, clientBoard);

  const removal = classifyExistingProjectRequest(
    'STM32 board with USB-C power and UART header.',
    SPEC,
    'Delete the I2C connector'
  );
  assert.equal(outcomeOf(removal), 'removal-candidate:i2c');
});

test('deletion checks share one positive and negative vocabulary', () => {
  const positive = DELETION_INTENT_VOCABULARY.positiveVerbs.map((verb) => verb.id);
  assert.deepEqual(positive, ['remove', 'delete', 'drop', '삭제', '제거', '지워', '지우', '빼']);
  const negative = DELETION_INTENT_VOCABULARY.negationMarkers.map((marker) => marker.id);
  assert.ok(negative.includes('never'));
  assert.ok(negative.includes('no-need-to'));
  assert.ok(negative.includes("n't"));
  assert.ok(negative.includes('dont'));
  assert.ok(negative.includes('not'));
  assert.ok(negative.includes('no'));
  const korean = DELETION_INTENT_VOCABULARY.koreanBlockingCues.map((cue) => cue.id);
  for (const id of ['안', '말', '금지', '필요 없', '남기', '남겨', '유지', '면 안', '지 마', '하지 마', '않']) {
    assert.ok(
      korean.includes(id) || DELETION_INTENT_VOCABULARY.partScopeCues.some((cue) => cue.id === id),
      id
    );
  }
  const parts = DELETION_INTENT_VOCABULARY.partScopeCues.map((cue) => cue.id);
  for (const id of ['keep', 'without', 'instead', 'rather-than', 'except', 'but-not']) {
    assert.ok(parts.includes(id), id);
  }
  for (const codePoint of [0x2019, 0x2018, 0x02BC, 0x0060, 0x00B4, 0xFF07, 0x2032]) {
    assert.ok(DELETION_INTENT_VOCABULARY.apostrophes.includes(String.fromCodePoint(codePoint)), codePoint.toString(16));
  }
  assert.match(DELETION_INTENT_VOCABULARY.koreanNegationSuffix, /금지/);
  assert.ok(DELETION_INTENT_VOCABULARY.koreanNegationSuffix.includes(String.raw`안\s*해도`));
  assert.match(DELETION_INTENT_VOCABULARY.koreanNegationSuffix, /말고/);
  assert.match(DELETION_INTENT_VOCABULARY.koreanNegationSuffix, /않도록/);
  assert.equal(
    DELETION_INTENT_VOCABULARY.clauseSeparators.some((sep) => sep.id === 'malgo' && sep.negatesLeft),
    true
  );
  assert.ok(DELETION_INTENT_VOCABULARY.coordinators.some((item) => item.id === 'or'));
  assert.ok(DELETION_INTENT_VOCABULARY.coordinators.some((item) => item.id === 'hageona'));
  assert.ok(DELETION_INTENT_VOCABULARY.coordinators.some((item) => item.id === 'na'));
  const joins = DELETION_INTENT_VOCABULARY.targetListJoins.map((item) => item.id);
  for (const id of ['and', 'or', 'both', 'amp', 'comma', 'slash', 'ttoneun', 'geurigo', 'hago', 'irang', 'rang', 'wa', 'gwa', 'mit']) {
    assert.ok(joins.includes(id), id);
  }
  assert.ok(DELETION_INTENT_VOCABULARY.alsoAttachments.some((item) => item.id === 'hago-do'));
  assert.ok(DELETION_INTENT_VOCABULARY.coordinatedVerbs.some((item) => item.id === 'change'));
  assert.ok(DELETION_INTENT_VOCABULARY.coordinatedVerbs.some((item) => item.id === '변경'));
  for (const verb of DELETION_INTENT_VOCABULARY.positiveVerbs) {
    const sample = {
      remove: 'remove I2C',
      delete: 'delete I2C',
      삭제: 'I2C 삭제해줘',
      제거: 'I2C 커넥터 제거',
      지워: 'I2C 커넥터 지워',
      지우: 'I2C 지우자',
      drop: 'drop the I2C connector',
      빼: 'I2C 빼줘'
    }[verb.id];
    const decision = classifyExistingProjectRequest(sample, SPEC);
    assert.equal(decision.edit?.kind, 'delete', verb.id);
    assert.deepEqual(decision.edit?.targets, ['i2c'], verb.id);
  }
});
