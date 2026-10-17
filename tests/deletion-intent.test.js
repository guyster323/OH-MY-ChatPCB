import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DELETION_INTENT_VOCABULARY,
  classifyDeletionIntents,
  classifyExistingProjectRequest
} from '../src/workflow/existing-project-edit.js';

const SPEC = { sourcePrompt: 'existing' };

// Clause binding: a removal verb applies only to the part in its own clause.
// Quoted spans are mentions, not commands (see stripQuotedMentions).
// "don't not remove" is two negation markers, so it stays a removal.
const CASES = [
  { prompt: 'I2C 삭제하지 마', mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: 'I2C 커넥터는 삭제하지 마세요', mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: 'I2C 지우지 마', mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: "don't remove I2C", mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: 'do not delete the I2C connector', mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: "keep I2C, don't remove it", mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: 'Don\u2019t remove the I2C connector', mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: 'shouldn\u2019t remove I2C', mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: "shouldn't remove I2C", mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: 'should not remove I2C', mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: 'do not ever remove I2C', mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: 'never remove I2C', mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: 'no need to remove I2C', mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: "don't, please, remove I2C", mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: 'do not under any circumstances remove I2C', mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: 'Do not, under any circumstances, remove I2C', mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: "Please don't\nremove I2C", mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: "DON'T REMOVE I2C", mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: "don't   remove   I2C", mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: "\uFF44\uFF4F\uFF4E'\uFF54 \uFF52\uFF45\uFF4D\uFF4F\uFF56\uFF45 I2C", mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: 'I2C 삭제 하지마', mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: 'I2C 삭제는 하지 말아 주세요', mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: 'I2C 삭제하면 안 돼', mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: 'I2C 삭제하면 안돼', mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: 'I2C 삭제 금지', mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: 'I2C 제거 말고', mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: 'I2C를 삭제하지 않도록', mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: 'I2C 삭제하지 않도록', mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: 'I2C 삭제 안 함', mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: 'I2C 삭제 안함', mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: '"remove I2C" is not what I want', mode: 'refuse', positive: [], negated: [] },
  { prompt: '"remove I2C" is what I do NOT want', mode: 'refuse', positive: [], negated: [] },
  { prompt: '\u201Cremove I2C\u201D is not what I want', mode: 'refuse', positive: [], negated: [] },
  { prompt: '\u2018remove I2C\u2019 is not what I want', mode: 'refuse', positive: [], negated: [] },
  { prompt: 'remove the LED but don\'t remove I2C', mode: 'refuse', positive: ['led'], negated: ['i2c'] },
  { prompt: "don't remove I2C, remove LED", mode: 'refuse', positive: ['led'], negated: ['i2c'] },
  { prompt: 'remove the LED and then don\'t remove I2C', mode: 'refuse', positive: ['led'], negated: ['i2c'] },
  { prompt: 'I2C 남기고 LED 저항 삭제', mode: 'refuse', positive: ['led-resistor'], negated: [] },
  { prompt: 'LED 삭제하고 I2C는 남겨', mode: 'refuse', positive: ['led'], negated: [] },
  { prompt: 'LED 삭제하고 나서 I2C는 유지', mode: 'refuse', positive: ['led'], negated: [] },
  { prompt: 'LED는 삭제하지만 I2C는 남겨', mode: 'refuse', positive: ['led'], negated: [] },
  { prompt: 'I2C 제거 말고 LED 삭제', mode: 'refuse', positive: ['led'], negated: ['i2c'] },
  { prompt: 'reset 버튼 삭제. I2C 커넥터는 유지하세요.', mode: 'refuse', positive: [], negated: [] },
  { prompt: 'I2C는 버리지 말고 LED 저항 680옴', mode: 'resistor:680', positive: [], negated: [] },
  { prompt: 'I2C 없애지 말고 LED 저항 680옴', mode: 'resistor:680', positive: [], negated: [] },
  { prompt: 'I2C 빼지 마. LED 저항 680옴', mode: 'resistor:680', positive: [], negated: [] },
  { prompt: "you shouldn't remove I2C; LED resistor 680 ohm", mode: 'resistor:680', positive: [], negated: ['i2c'] },
  { prompt: 'change LED resistor to 680 ohm without removing I2C', mode: 'resistor:680', positive: [], negated: [] },
  { prompt: 'keep I2C, set LED resistor 680 ohm', mode: 'resistor:680', positive: [], negated: [] },
  { prompt: 'I2C 제거 말고 LED 저항 680옴', mode: 'resistor:680', positive: [], negated: ['i2c'] },
  { prompt: "Change the status LED series resistor to 680 ohm. don't remove I2C.", mode: 'resistor:680', positive: [], negated: ['i2c'] },
  // One negation covers a coordinated "remove or change" / "삭제하거나 변경" phrase.
  { prompt: 'I2C는 삭제하거나 변경하지 마세요', mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: 'I2C는 삭제하거나 변경하지 마', mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: 'I2C는 삭제나 변경 하지 마', mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: "don't remove or change I2C", mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: "do not change or remove I2C", mode: 'refuse', positive: [], negated: ['i2c'] },
  { prompt: '기존 프로젝트에서 상태 LED D1의 전류 제한 저항 R3 값만 330Ω에서 680Ω으로 변경하는 편집을 미리보기로 준비하세요. I2C는 절대 삭제하거나 변경하지 마세요.', mode: 'resistor:680', positive: [], negated: ['i2c'] },
  // The destination value is the one at to / -> / 으로, otherwise the last value.
  { prompt: 'change R3 from 330Ω to 680Ω', mode: 'resistor:680', positive: [], negated: [] },
  { prompt: 'R3 330 ohm -> 680 ohm', mode: 'resistor:680', positive: [], negated: [] },
  { prompt: 'LED 저항 330옴에서 680옴으로', mode: 'resistor:680', positive: [], negated: [] },
  { prompt: '상태 LED 저항 R3(현재 330Ω)의 값만 680Ω으로 변경하세요', mode: 'resistor:680', positive: [], negated: [] },
  { prompt: 'set R3 330Ω 680Ω', mode: 'resistor:680', positive: [], negated: [] },
  { prompt: 'Delete the I2C connector', mode: 'delete:i2c', positive: ['i2c'], negated: [] },
  { prompt: 'Remove the I2C connector', mode: 'delete:i2c', positive: ['i2c'], negated: [] },
  { prompt: 'I2C 커넥터 삭제', mode: 'delete:i2c', positive: ['i2c'], negated: [] },
  // Even count of negation markers stays affirmative: "don't not remove" removes I2C.
  { prompt: "don't not remove I2C", mode: 'delete:i2c', positive: ['i2c'], negated: [] },
  { prompt: 'remove I2C', mode: 'delete:i2c', positive: ['i2c'], negated: [] },
  { prompt: 'Remove the I2C connector.', mode: 'delete:i2c', positive: ['i2c'], negated: [] },
  { prompt: 'delete the I2C header', mode: 'delete:i2c', positive: ['i2c'], negated: [] },
  { prompt: 'I2C 삭제해줘', mode: 'delete:i2c', positive: ['i2c'], negated: [] },
  { prompt: 'I2C 커넥터 제거', mode: 'delete:i2c', positive: ['i2c'], negated: [] },
  { prompt: "I don't need I2C, remove it", mode: 'delete:i2c', positive: ['i2c'], negated: [] },
  { prompt: 'I2C는 필요 없으니 삭제', mode: 'delete:i2c', positive: ['i2c'], negated: [] },
  { prompt: 'I2C 지워줘', mode: 'delete:i2c', positive: ['i2c'], negated: [] },
  { prompt: 'I2C 커넥터 지워', mode: 'delete:i2c', positive: ['i2c'], negated: [] }
];

function modeOf(decision) {
  if (decision.mode !== 'merge') return decision.mode;
  if (decision.edit.kind === 'delete') return `delete:${decision.edit.targets.join('+')}`;
  if (decision.edit.kind === 'resistor') return `resistor:${decision.edit.ohms}`;
  return decision.mode;
}

function targets(intents, negated) {
  return intents.filter((item) => item.negated === negated && item.target).map((item) => item.target);
}

test('deletion intent binds each removal verb to the part in its clause', () => {
  for (const row of CASES) {
    const decision = classifyExistingProjectRequest(row.prompt, SPEC);
    const intents = classifyDeletionIntents(row.prompt);
    assert.equal(modeOf(decision), row.mode, row.prompt);
    assert.deepEqual(targets(intents, false), row.positive, row.prompt);
    assert.deepEqual(targets(intents, true), row.negated, row.prompt);
  }
});

test('removal intent follows the original prompt when the tool text was rewritten', () => {
  const kept = classifyExistingProjectRequest(
    'remove I2C',
    SPEC,
    '680옴으로 바꿔줘. I2C는 삭제하지 마'
  );
  assert.equal(modeOf(kept), 'resistor:680');

  const rewrittenKeep = classifyExistingProjectRequest(
    '기존 프로젝트에서 R3 값만 330Ω에서 680Ω으로 변경하세요. I2C는 삭제하거나 변경하지 마세요.',
    SPEC,
    '680옴으로 바꿔줘. I2C는 삭제하지 마'
  );
  assert.equal(modeOf(rewrittenKeep), 'resistor:680');
  assert.deepEqual(targets(classifyDeletionIntents('680옴으로 바꿔줘. I2C는 삭제하지 마'), false), []);

  for (const prompt of ['Delete the I2C connector', 'Remove the I2C connector', 'I2C 커넥터 삭제']) {
    const decision = classifyExistingProjectRequest('Delete J2 from the existing project.', SPEC, prompt);
    assert.equal(modeOf(decision), 'delete:i2c', prompt);
  }

  // A rewritten prompt that is not an edit still regenerates from the tool text.
  const toolBoard = 'RP2040 board with USB-C power, I2C connector, reset button, and status LED.';
  const regenerated = classifyExistingProjectRequest(toolBoard, SPEC, 'Add reset button and status LED.');
  assert.equal(regenerated.mode, 'regenerate');
  assert.equal(regenerated.prompt, undefined);

  const clientBoard = 'STM32 board with USB-C power, I2C connector, UART header, reset button, and LED.';
  const fromClient = classifyExistingProjectRequest('Add a status LED.', SPEC, clientBoard);
  assert.equal(fromClient.mode, 'regenerate');
  assert.equal(fromClient.prompt, clientBoard);

  // Removal still comes only from the client, even when the tool text is a full board.
  const removal = classifyExistingProjectRequest(
    'STM32 board with USB-C power and UART header.',
    SPEC,
    'Delete the I2C connector'
  );
  assert.equal(modeOf(removal), 'delete:i2c');
});

test('deletion checks share one positive and negative vocabulary', () => {
  const positive = DELETION_INTENT_VOCABULARY.positiveVerbs.map((verb) => verb.id);
  assert.deepEqual(positive, ['remove', 'delete', '삭제', '제거', '지워', '지우']);
  const negative = DELETION_INTENT_VOCABULARY.negationMarkers.map((marker) => marker.id);
  assert.ok(negative.includes('never'));
  assert.ok(negative.includes('no-need-to'));
  assert.ok(negative.includes("n't"));
  assert.ok(negative.includes('not'));
  assert.match(DELETION_INTENT_VOCABULARY.koreanNegationSuffix, /금지/);
  assert.match(DELETION_INTENT_VOCABULARY.koreanNegationSuffix, /말고/);
  assert.match(DELETION_INTENT_VOCABULARY.koreanNegationSuffix, /않도록/);
  assert.equal(
    DELETION_INTENT_VOCABULARY.clauseSeparators.some((sep) => sep.id === 'malgo' && sep.negatesLeft),
    true
  );
  assert.ok(DELETION_INTENT_VOCABULARY.coordinators.some((item) => item.id === 'or'));
  assert.ok(DELETION_INTENT_VOCABULARY.coordinators.some((item) => item.id === 'hageona'));
  assert.ok(DELETION_INTENT_VOCABULARY.coordinators.some((item) => item.id === 'na'));
  assert.ok(DELETION_INTENT_VOCABULARY.coordinatedVerbs.some((item) => item.id === 'change'));
  assert.ok(DELETION_INTENT_VOCABULARY.coordinatedVerbs.some((item) => item.id === '변경'));
  for (const verb of DELETION_INTENT_VOCABULARY.positiveVerbs) {
    const sample = {
      remove: 'remove I2C',
      delete: 'delete I2C',
      삭제: 'I2C 삭제해줘',
      제거: 'I2C 커넥터 제거',
      지워: 'I2C 커넥터 지워',
      지우: 'I2C 지우자'
    }[verb.id];
    const decision = classifyExistingProjectRequest(sample, SPEC);
    assert.equal(decision.edit?.kind, 'delete', verb.id);
    assert.deepEqual(decision.edit?.targets, ['i2c'], verb.id);
  }
});
