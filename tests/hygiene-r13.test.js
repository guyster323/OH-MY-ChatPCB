import assert from 'node:assert/strict';
import test from 'node:test';

import { dispatchToolCall } from '../src/runtime/agent-daemon.js';
import {
  choiceJoinerRow,
  classifyExistingProjectRequest,
  isChoiceSideStop,
  ledKeepSkipWords
} from '../src/workflow/existing-project-edit.js';
import {
  assessRequestCoverage,
  CHOICE_JOINERS,
  choiceWordJoinerSources,
  KEEP_CUES,
  keepLeaveVerbTexts,
  ledKeepVerbSkipTexts
} from '../src/workflow/resistor-vocabulary.js';

function seriesSpec(value = '330Ω') {
  return {
    mcu: { family: 'STM32' },
    schematic: {
      components: [
        { ref: 'R3', libId: 'ChatPCB:LED_RESISTOR', value },
        { ref: 'R4', libId: 'ChatPCB:I2C_PULLUP', value: '4.7k' }
      ]
    },
    peripherals: [
      { kind: 'status-led' },
      { kind: 'status-led-resistor', value }
    ],
    boardProfile: {
      productionParts: [
        { ref: 'R3', role: 'status-led-resistor', value },
        { ref: 'R4', role: 'i2c-scl-pullup', value: '4.7k' }
      ]
    }
  };
}

function cueByText(text) {
  return KEEP_CUES.find((cue) => cue.text === text);
}

// Dropping leave, untouched, or hold from KEEP_CUES must fail this test.
// The consumers below are projections of that list, so a hardcoded copy drifts.
test('leave, untouched, and hold are read from KEEP_CUES', () => {
  assert.equal(cueByText('leave')?.slot, 'leave-verb');
  assert.equal(cueByText('untouched')?.slot, 'before');
  assert.equal(cueByText('untouched')?.signal, true);
  assert.equal(cueByText('hold')?.slot, 'after');
  assert.equal(cueByText('hold')?.signal, true);

  assert.deepEqual(
    keepLeaveVerbTexts(),
    KEEP_CUES.filter((cue) => cue.slot === 'leave-verb').map((cue) => cue.text)
  );
  assert.equal(keepLeaveVerbTexts().includes('leave'), true);

  const derivedSkips = ledKeepVerbSkipTexts();
  assert.deepEqual(
    derivedSkips,
    KEEP_CUES
      .filter((cue) => cue.signal === true && (cue.slot === 'after' || cue.slot === 'leave-verb') && /^[a-z]+$/i.test(cue.text))
      .map((cue) => cue.text.toLowerCase())
  );
  assert.equal(derivedSkips.includes('hold'), true);
  assert.equal(derivedSkips.includes('leave'), true);
  const skip = ledKeepSkipWords();
  for (const word of derivedSkips) {
    assert.equal(skip.has(word), true, word);
  }
  for (const word of ['keep', 'hold', 'leave', 'without']) {
    assert.equal(skip.has(word), derivedSkips.includes(word), word);
  }

  const spec = seriesSpec();
  const leaveOnly = classifyExistingProjectRequest('leave R4, LED resistor 680Ω', spec);
  assert.equal(leaveOnly.mode, 'merge', leaveOnly.code ?? '');
  assert.equal(leaveOnly.edit?.ref, 'R3');
  assert.equal(leaveOnly.edit?.ohms, 680);

  const untouched = classifyExistingProjectRequest('R3 untouched, set the LED resistor to 680Ω', spec);
  assert.equal(untouched.code, 'RESISTOR_AMBIGUOUS', untouched.code ?? untouched.mode);
  assert.equal(untouched.edit, undefined);

  const held = classifyExistingProjectRequest('hold the LED as is, set the LED resistor to 680Ω', spec);
  assert.equal(held.mode, 'merge', held.code ?? '');
  assert.equal(held.edit?.ref, 'R3');
  assert.equal(held.edit?.ohms, 680);
});

test("'LED 저항 680Ω 하거나 1kΩ' is RESISTOR_VALUE_AMBIGUOUS", () => {
  const prompt = 'LED 저항 680Ω 하거나 1kΩ';
  const spec = seriesSpec();
  const decision = classifyExistingProjectRequest(prompt, spec);
  const wordSources = choiceWordJoinerSources({ exceptApprox: true });
  assert.equal(CHOICE_JOINERS.some((item) => item.place === 'word' && item.text === '하거나'), true);
  assert.deepEqual(
    wordSources,
    CHOICE_JOINERS.filter((item) => item.place === 'word').map((item) => (
      item.notBefore ? `(?:${item.re})(?!${item.notBefore})` : item.re
    ))
  );
  assert.equal(wordSources.some((source) => source.includes('하거나')), true);
  assert.equal(assessRequestCoverage(prompt).alternative, true);
  assert.equal(decision.mode, 'refuse');
  assert.equal(decision.code, 'RESISTOR_VALUE_AMBIGUOUS', decision.code ?? decision.mode);
  assert.equal(decision.edit, undefined);
});

test('dispatchToolCall ctx drops unknown option keys', async () => {
  let seen = null;
  const emit = () => {};
  const result = await dispatchToolCall(null, {
    zz: 1,
    classifyExistingProjectRequest: 'merge',
    emit,
    testOnly: {
      observeCtx(ctx) {
        seen = ctx;
      }
    }
  });
  assert.equal(result.ok, false);
  assert.ok(seen, 'observeCtx did not see the dispatch ctx');
  assert.equal(Object.hasOwn(seen, 'zz'), false);
  assert.equal(Object.hasOwn(seen, 'classifyExistingProjectRequest'), false);
  assert.equal(Object.hasOwn(seen, 'classifyRequest'), false);
  assert.equal(Object.hasOwn(seen, 'testOnly'), false);
  assert.equal(Object.hasOwn(seen, 'observeCtx'), false);
  assert.equal(seen.emit, emit);
});

// Same shape as the classifier seam outside node --test. Deleting
// NODE_TEST_CONTEXT must keep testOnly.observeCtx from running.
test('observeCtx is not called when NODE_TEST_CONTEXT is unset', async () => {
  const previousContext = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  let calls = 0;
  try {
    const result = await dispatchToolCall(null, {
      testOnly: {
        observeCtx() {
          calls += 1;
        }
      }
    });
    assert.equal(result.ok, false);
    assert.equal(calls, 0);
  } finally {
    if (previousContext === undefined) delete process.env.NODE_TEST_CONTEXT;
    else process.env.NODE_TEST_CONTEXT = previousContext;
  }
});

test('choiceJoinerRow throws on an unknown id', () => {
  assert.throws(() => choiceJoinerRow('no-such-joiner'), /Unknown choice joiner id: no-such-joiner/);
  assert.equal(choiceJoinerRow('deun').text, '든');
  assert.equal(choiceJoinerRow('or').text, 'or');
});

// Single-token keep cues and word joiners are the side-phrase stops. A copy
// of those words in the edit path would miss a row added to either list.
test('choice side stops are read from KEEP_CUES and CHOICE_JOINERS', () => {
  for (const cue of KEEP_CUES) {
    if (cue.signal !== true) continue;
    if (/[\s'’]/u.test(cue.text) || cue.text.includes('-')) continue;
    assert.equal(isChoiceSideStop(cue.text), true, cue.text);
  }
  for (const item of CHOICE_JOINERS) {
    if (item.place !== 'word') continue;
    assert.equal(isChoiceSideStop(item.text), true, item.id);
  }
  for (const word of ['set', 'change', 'update', 'modify', 'make', "don't", 'don’t', 'dont', 'do', 'not', 'touch', 'and', 'but', '바꿔', '변경', '수정', '말고', '하지', '두지']) {
    assert.equal(isChoiceSideStop(word), true, word);
  }
  const spec = seriesSpec();
  const listed = classifyExistingProjectRequest('R4 또는 R5는 그대로 두고 LED 저항 680Ω으로', spec);
  assert.equal(listed.mode, 'merge', listed.code ?? '');
  assert.equal(listed.edit?.ref, 'R3');
  assert.equal(listed.edit?.ohms, 680);
  const kept = classifyExistingProjectRequest('set the LED resistor to 680Ω or keep R4', spec);
  assert.equal(kept.code, 'RESISTOR_AMBIGUOUS', kept.mode);
  assert.equal(kept.edit, undefined);
});
