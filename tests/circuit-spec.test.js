import assert from 'node:assert/strict';
import test from 'node:test';

import { applyDiscreteLedSpec, normalizeCircuitSpec, parseDiscreteLedRequest } from '../src/runtime/circuit-spec.js';
import { classifyQuantities, promptDescribesAcSupply, tokenizeQuantities } from '../src/runtime/quantity-tokens.js';
import * as quantityTokens from '../src/runtime/quantity-tokens.js';
import { reviewCircuitReadiness } from '../src/workflow/review-project.js';

test('normalizes MCU peripheral prompt into a bounded CircuitSpec', () => {
  const spec = normalizeCircuitSpec(
    'Make an STM32 sensor board with USB-C power, 3.3V regulator, I2C sensor connector, UART debug header, reset button, and status LED.'
  );

  assert.equal(spec.kind, 'mcu-peripheral');
  assert.equal(spec.mcu.family, 'STM32');
  assert.deepEqual(spec.power.rails.map((rail) => rail.name), ['VBUS', '+3V3']);
  assert.ok(spec.interfaces.some((iface) => iface.kind === 'i2c'));
  assert.ok(spec.interfaces.some((iface) => iface.kind === 'uart'));
  assert.ok(spec.peripherals.some((peripheral) => peripheral.kind === 'reset-button'));
  assert.ok(spec.peripherals.some((peripheral) => peripheral.kind === 'status-led'));
  assert.ok(spec.simulationGoals.includes('3v3-rail-operating-point'));
});

test('uses conservative MCU defaults when prompt does not name a family', () => {
  const spec = normalizeCircuitSpec('Small sensor breakout with SPI and a power LED.');

  assert.equal(spec.mcu.family, 'Generic MCU');
  assert.ok(spec.interfaces.some((iface) => iface.kind === 'spi'));
  assert.ok(spec.peripherals.some((peripheral) => peripheral.kind === 'status-led'));
});

test('preserves ESP32-S3 variant when the prompt names it', () => {
  const spec = normalizeCircuitSpec('USB-C powered ESP32-S3 sensor board with SPI, USB, and GPIO header.');

  assert.equal(spec.mcu.family, 'ESP32-S3');
});

test('count markers are quantities and only small or fractional bare numbers stay ambiguous', () => {
  // pcs/pc/ea/개/×/x are counts from the quantity tokenizer, in either order.
  const counts = [
    ['LED 2 pcs', 2, 5, true, false, 300, '300Ω', null],
    ['LED 3 pcs', 3, 5, true, false, 300, '300Ω', null],
    ['LED 2pc', 2, 5, true, false, 300, '300Ω', null],
    ['LED 3ea', 3, 5, true, false, 300, '300Ω', null],
    ['LED 3 EA', 3, 5, true, false, 300, '300Ω', null],
    ['LED 3PCS', 3, 5, true, false, 300, '300Ω', null],
    ['3 pcs LED', 3, 5, true, false, 300, '300Ω', null],
    ['LED x3', 3, 5, true, false, 300, '300Ω', null],
    ['LED ×3', 3, 5, true, false, 300, '300Ω', null],
    ['LED 3x', 3, 5, true, false, 300, '300Ω', null],
    ['LED 3×', 3, 5, true, false, 300, '300Ω', null],
    ['LED x 3', 3, 5, true, false, 300, '300Ω', null],
    ['LED 3 x', 3, 5, true, false, 300, '300Ω', null],
    ['LED × 3', 3, 5, true, false, 300, '300Ω', null],
    ['x3 LED', 3, 5, true, false, 300, '300Ω', null],
    ['×3 LED', 3, 5, true, false, 300, '300Ω', null],
    ['3x LED', 3, 5, true, false, 300, '300Ω', null],
    ['3× LED', 3, 5, true, false, 300, '300Ω', null],
    ['2x 5V LED', 2, 5, false, false, 300, '300Ω', null],
    ['LED ×3 5V', 3, 5, false, false, 300, '300Ω', null],
    ['LED x3 5V', 3, 5, false, false, 300, '300Ω', null],
    ['LED 5V x2', 2, 5, false, false, 300, '300Ω', null],
    ['LED 5V x2 330Ω', 2, 5, false, true, 330, '330Ω', null],
    ['2 LEDs 5V Vf 3.2V', 2, 5, false, false, 180, '180Ω', 3.2],
    ['LED 3개 5V', 3, 5, false, false, 300, '300Ω', null],
    ['three LEDs on 5V', 3, 5, false, false, 300, '300Ω', null],
    ['세 개의 LED', 3, 5, true, false, 300, '300Ω', null],
    ['LED 세 개 5V', 3, 5, false, false, 300, '300Ω', null],
    ['LED 세개', 3, 5, true, false, 300, '300Ω', null],
    ['다섯 개의 LED', 5, 5, true, false, 300, '300Ω', null],
    // Bare E24 integers of at least 100 (330, 470) are series resistors.
    ['LED 330', 1, 5, true, true, 330, '330Ω', null],
    ['5V LED 330', 1, 5, false, true, 330, '330Ω', null],
    ['LED 5 V 330', 1, 5, false, true, 330, '330Ω', null],
    ['LED 5V 3 leds 470', 3, 5, false, true, 470, '470Ω', null],
    ['2 LEDs 5V 330', 2, 5, false, true, 330, '330Ω', null],
    ['LED 3개 470', 3, 5, true, true, 470, '470Ω', null],
    ['LED 5V x2 330', 2, 5, false, true, 330, '330Ω', null],
    ['LED 5V 3개 330', 3, 5, false, true, 330, '330Ω', null],
    ['LED two pcs', 2, 5, true, false, 300, '300Ω', null],
    ['two pcs LED', 2, 5, true, false, 300, '300Ω', null],
    ['LEDx3', 3, 5, true, false, 300, '300Ω', null],
    ['LED×3', 3, 5, true, false, 300, '300Ω', null],
    ['LED ２개 5V', 2, 5, false, false, 300, '300Ω', null],
    ['LED ３３０Ω 5V', 1, 5, false, true, 330, '330Ω', null]
  ];
  for (const [prompt, count, supply, assumed, explicit, ohms, resistor, vf] of counts) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.ok(parsed, prompt);
    assert.equal(parsed.refused, false, `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
    assert.equal(parsed.count, count, prompt);
    assert.equal(parsed.requestedCount, count, prompt);
    assert.equal(parsed.supplyVolts, supply, prompt);
    assert.equal(parsed.supplyAssumed, assumed, prompt);
    assert.equal(parsed.resistorExplicit, explicit, prompt);
    assert.equal(parsed.resistanceOhms, ohms, prompt);
    assert.equal(parsed.resistorValue, resistor, prompt);
    assert.equal(parsed.specifiedVf ?? null, vf, prompt);
    assert.equal(parsed.reviewWarnings.length, 0, `${prompt} ${JSON.stringify(parsed.reviewWarnings)}`);
    assert.equal(parsed.channels.length, count, prompt);
  }

  for (const [prompt, raw, value] of [
    ['LED 2 pcs', '2 pcs', 2],
    ['3 pcs', '3 pcs', 3],
    ['3ea', '3ea', 3],
    ['3 pc', '3 pc', 3],
    ['x3', 'x3', 3],
    ['×3', '×3', 3],
    ['3x', '3x', 3],
    ['3×', '3×', 3],
    ['LED ×3 5V', '×3', 3]
  ]) {
    const { tokens } = tokenizeQuantities(prompt);
    const countsOnly = tokens.filter((token) => token.kind === 'count');
    assert.equal(countsOnly.length, 1, `${prompt} ${JSON.stringify(tokens)}`);
    assert.equal(countsOnly[0].raw, raw, prompt);
    assert.equal(countsOnly[0].value, value, prompt);
    assert.equal(countsOnly[0].unit, 'count', prompt);
    assert.equal(countsOnly[0].validCount, true, prompt);
    assert.equal(prompt.slice(countsOnly[0].start, countsOnly[0].end), raw, prompt);
    assert.equal(tokens.some((token) => token.kind === 'resistance' || token.kind === 'ambiguous'), false, prompt);
  }

  // Integers below 10, and any fractional bare number, stay ambiguous.
  const ambiguous = [
    ['LED 2 5V', '2'],
    ['LED 5V 3.2', '3.2'],
    ['LED forward voltage 3.2', '3.2'],
    ['3.2 LED on 5V', '3.2'],
    ['3,2 LED on 5V', '3'],
    ['2.5 LED on 5V', '2.5'],
    ['LED 5V 2개 2', '2'],
    ['LED 9', '9'],
    ['LED 1', '1'],
    ['LED 4', '4'],
    ['LED 5V 10.5', '10.5']
  ];
  for (const [prompt, raw] of ambiguous) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.ok(parsed, prompt);
    assert.equal(parsed.refused, true, `${prompt} drafted ${parsed.resistorValue}`);
    assert.equal(parsed.count, 0, prompt);
    assert.equal(parsed.resistanceOhms, null, prompt);
    assert.equal(parsed.resistorValue, null, prompt);
    assert.equal(parsed.resistorExplicit, false, prompt);
    assert.equal(parsed.channels.length, 0, prompt);
    assert.equal(parsed.reviewWarnings.length, 0, prompt);
    assert.equal(parsed.reviewBlockers.length, 1, prompt);
    const blocker = parsed.reviewBlockers[0];
    const shown = escapeRegExp(raw);
    assert.equal(blocker.code, 'discrete-led-ambiguous-number', `${prompt} ${blocker.code} ${blocker.en}`);
    assert.match(blocker.en, new RegExp(`^Is ${shown} a resistor in ohms, an LED count, or something else\\?`), blocker.en);
    assert.match(blocker.en, /LED count/i, blocker.en);
    assert.match(blocker.en, /330Ω/, blocker.en);
    assert.match(blocker.en, /3 LEDs/, blocker.en);
    assert.equal(blocker.en.includes('Refusing to draft'), false, blocker.en);
    assert.match(blocker.ko, new RegExp(`^${shown}(?:은|는) 저항\\(Ω\\)인가요, LED 개수인가요\\?`), blocker.ko);
    assert.match(blocker.ko, /330Ω/, blocker.ko);
    assert.match(blocker.ko, /3개/, blocker.ko);
    assert.equal(blocker.ko.includes('ohm'), false, blocker.ko);
    assert.equal(blocker.ko.includes('생성하지 않았습니다'), false, blocker.ko);
    assert.equal(blocker.message, /[가-힣]/.test(prompt) ? blocker.ko : blocker.en, prompt);
    assert.equal(/below 68/i.test(blocker.en), false, blocker.en);
  }
  assert.equal(parseDiscreteLedRequest('5V 330'), null);

  const invalid = [
    ['LED 0개', '0'],
    ['LED -2개', '-2'],
    ['LED 2.5개', '2.5'],
    ['LED 2,5개', '2,5'],
    ['LED 0 pcs', '0'],
    ['LED -2 pcs', '-2'],
    ['LED 2.5 pcs', '2.5'],
    ['2.5 pcs LED', '2.5'],
    ['2.5 LEDs on 5V', '2.5'],
    ['2,5 LEDs on 5V', '2,5'],
    ['2,5 leds on 5V', '2,5'],
    ['two and a half LEDs', '2.5'],
    ['one and a half LEDs', '1.5'],
    ['two and a half LEDs on 5V', '2.5'],
    ['LED 0x', '0'],
    ['LED x0', '0'],
    ['0 LEDs', '0'],
    ['LED -2 LEDs', '-2']
  ];
  for (const [prompt, shown] of invalid) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.ok(parsed, prompt);
    assert.equal(parsed.refused, true, `${prompt} drafted count ${parsed.count} ${parsed.resistorValue}`);
    assert.equal(parsed.count, 0, prompt);
    assert.equal(parsed.resistanceOhms, null, prompt);
    assert.equal(parsed.resistorValue, null, prompt);
    assert.equal(parsed.resistorExplicit, false, prompt);
    assert.equal(parsed.reviewWarnings.length, 0, prompt);
    assert.equal(parsed.reviewBlockers.length, 1, prompt);
    const blocker = parsed.reviewBlockers[0];
    assert.equal(blocker.code, 'discrete-led-invalid-count', `${prompt} ${blocker.code} ${blocker.en}`);
    assert.match(blocker.en, new RegExp(`LED count ${shown.replace(/[.]/g, '\\.')} is not a positive whole number`), blocker.en);
    assert.match(blocker.en, /Zero, negative, and fractional counts are rejected/, blocker.en);
    assert.match(blocker.ko, new RegExp(`LED 개수 ${shown.replace(/[.]/g, '\\.')}`), blocker.ko);
    assert.match(blocker.ko, /양의 정수/, blocker.ko);
    assert.match(blocker.ko, /음수/, blocker.ko);
    assert.match(blocker.ko, /분수/, blocker.ko);
    assert.equal(blocker.message, /[가-힣]/.test(prompt) ? blocker.ko : blocker.en, prompt);
    const countToken = tokenizeQuantities(prompt).tokens.find((token) => token.kind === 'count');
    assert.ok(countToken, `${prompt} ${JSON.stringify(tokenizeQuantities(prompt).tokens)}`);
    assert.equal(countToken.validCount, false, prompt);
    assert.equal(countToken.countText, shown, prompt);
  }

  const resistors = [
    ['LED 5V 330Ω', 330, '330Ω'],
    ['LED 5V 330 ohm', 330, '330Ω'],
    ['LED 5V 330 ohms', 330, '330Ω'],
    ['LED 5V 저항 330', 330, '330Ω'],
    ['LED 5V 4k7', 4700, '4.7kΩ'],
    ['LED 330R on 5V', 330, '330Ω'],
    ['LED 330 resistor', 330, '330Ω'],
    ['LED resistor 330', 330, '330Ω']
  ];
  for (const [prompt, ohms, label] of resistors) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.equal(parsed.refused, false, `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
    assert.equal(parsed.resistorExplicit, true, prompt);
    assert.equal(parsed.resistanceOhms, ohms, prompt);
    assert.equal(parsed.resistorValue, label, prompt);
    assert.equal(parsed.count, 1, prompt);
  }

  for (const prompt of ['vf3.2 LED', 'vf3.2 LED 5V', 'vf 3.2 LED를 5V에 연결해줘', 'LED vf3.2 5V']) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.equal(parsed.refused, false, `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
    assert.equal(parsed.count, 1, prompt);
    assert.equal(parsed.specifiedVf, 3.2, prompt);
    assert.equal(parsed.resistorExplicit, false, prompt);
    assert.equal(parsed.resistorValue, '180Ω', prompt);
  }

  // An Ω/ohm token is never Vf. It is the series resistor and Vf stays at the
  // color default. "LED 5V Vf 330Ω" keeps 5V as the supply; it does not bind
  // 330Ω or steal 5V as the forward voltage.
  for (const [prompt, assumed] of [
    ['LED Vf 330Ω', true],
    ['LED vf330Ω', true],
    ['LED vf330Ω 5V', false],
    ['LED 5V Vf 330Ω', false],
    ['LED 5V vf330Ω', false],
    ['LED 5V Vf 330 ohm', false]
  ]) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.equal(parsed.refused, false, `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
    assert.equal(parsed.count, 1, prompt);
    assert.equal(parsed.specifiedVf ?? null, null, prompt);
    assert.equal(parsed.resistorExplicit, true, prompt);
    assert.equal(parsed.resistanceOhms, 330, prompt);
    assert.equal(parsed.resistorValue, '330Ω', prompt);
    assert.equal(parsed.supplyVolts, 5, prompt);
    assert.equal(parsed.supplyAssumed, assumed, prompt);
    const roles = classifyQuantities(prompt).tokens.map((token) => [token.raw, token.role]);
    assert.equal(roles.some(([, role]) => role === 'vf'), false, `${prompt} ${JSON.stringify(roles)}`);
    assert.equal(roles.some(([raw, role]) => role === 'resistor' && /330/.test(raw)), true, JSON.stringify(roles));
  }
});

test('tolerance percents are consumed and do not become an ambiguous number', () => {
  const cases = [
    ['330Ω±5%', 330, '330Ω'],
    ['330Ω 5%', 330, '330Ω'],
    ['330Ω ±1%', 330, '330Ω'],
    ['330 ohm ±5%', 330, '330Ω'],
    ['4k7 5%', 4700, '4.7kΩ']
  ];
  for (const [fragment, ohms, label] of cases) {
    const { tokens } = tokenizeQuantities(fragment);
    assert.equal(tokens.some((token) => token.kind === 'ambiguous'), false, `${fragment} ${JSON.stringify(tokens)}`);
    const resistor = tokens.find((token) => token.kind === 'resistance');
    assert.ok(resistor, fragment);
    assert.equal(resistor.value, ohms, fragment);
    const percent = tokens.find((token) => token.unit === '%');
    assert.ok(percent, `${fragment} ${JSON.stringify(tokens)}`);
    assert.equal(percent.kind, 'tolerance', fragment);

    const prompt = fragment.startsWith('4k7') || fragment.startsWith('330')
      ? `LED 5V ${fragment}`
      : fragment;
    const parsed = parseDiscreteLedRequest(prompt);
    assert.ok(parsed, prompt);
    assert.equal(parsed.refused, false, `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
    assert.equal(parsed.reviewBlockers.some((item) => item.code === 'discrete-led-ambiguous-number'), false, prompt);
    assert.equal(parsed.resistorExplicit, true, prompt);
    assert.equal(parsed.resistanceOhms, ohms, prompt);
    assert.equal(parsed.resistorValue, label, prompt);
    assert.equal(parsed.count, 1, prompt);
    assert.equal(parsed.supplyVolts, 5, prompt);
  }
});

test('an R label is a resistor and a bare E24 value of at least 100 is a resistor', () => {
  const labeled = [
    ['R=2', 'R=2', 2],
    ['R 2', 'R 2', 2],
    ['R1=330', 'R1=330', 330],
    ['R1 330', 'R1 330', 330]
  ];
  for (const [fragment, raw, ohms] of labeled) {
    const { tokens } = tokenizeQuantities(fragment);
    assert.equal(tokens.some((token) => token.kind === 'ambiguous'), false, JSON.stringify(tokens));
    assert.equal(tokens.length, 1, JSON.stringify(tokens));
    assert.equal(tokens[0].kind, 'resistance', fragment);
    assert.equal(tokens[0].raw, raw, fragment);
    assert.equal(tokens[0].value, ohms, fragment);
    const parsed = parseDiscreteLedRequest(`LED 5V ${fragment}`);
    assert.equal(parsed.refused, false, `${fragment} ${JSON.stringify(parsed.reviewBlockers)}`);
    assert.equal(parsed.resistorExplicit, true, fragment);
    assert.equal(parsed.resistanceOhms, ohms, fragment);
    assert.equal(parsed.resistorValue, ohms >= 1000 ? `${ohms / 1000}kΩ` : `${ohms}Ω`, fragment);
    assert.equal(parsed.count, 1, fragment);
    assert.equal(parsed.supplyVolts, 5, fragment);
  }

  const bare = [
    ['LED 330', 1, true, 330, '330Ω'],
    ['5V LED 330', 1, false, 330, '330Ω'],
    ['LED 5V 3 leds 470', 3, false, 470, '470Ω'],
    ['2 LEDs 5V 330', 2, false, 330, '330Ω'],
    ['LED 3개 470', 3, true, 470, '470Ω'],
    ['LED 5V 20mA 470', 1, false, 470, '470Ω']
  ];
  for (const [prompt, count, assumed, ohms, label] of bare) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.equal(parsed.refused, false, `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
    assert.equal(parsed.count, count, prompt);
    assert.equal(parsed.supplyAssumed, assumed, prompt);
    assert.equal(parsed.resistorExplicit, true, prompt);
    assert.equal(parsed.resistanceOhms, ohms, prompt);
    assert.equal(parsed.resistorValue, label, prompt);
  }

  const ten = parseDiscreteLedRequest('LED 10');
  assert.equal(ten.refused, true, JSON.stringify(ten.reviewBlockers));
  assert.equal(ten.count, 0);
  assert.equal(ten.resistanceOhms, null);
  assert.equal(ten.resistorValue, null);
  assert.equal(ten.reviewBlockers[0].code, 'discrete-led-ambiguous-number');
  assert.match(ten.reviewBlockers[0].en, /^Is 10 a resistor in ohms, an LED count, or something else\?/);
  assert.match(ten.reviewBlockers[0].ko, /^10은 저항\(Ω\)인가요, LED 개수인가요\?/);

  const oneOhm = parseDiscreteLedRequest('LED 5V 1Ω');
  assert.equal(oneOhm.refused, false, JSON.stringify(oneOhm.reviewBlockers));
  assert.equal(oneOhm.resistanceOhms, 1);
  assert.equal(oneOhm.resistorValue, '1Ω');
});

test('bare resistors are E24 values of at least 100, and LED package codes are not counts or resistors', () => {
  const requiredPackages = ['2835', '3528', '5050', '3014', '5630', '0603', '0805', '1206', '2019', '3020', '3030', '5730', '0402', '1210'];
  const codes = quantityTokens.LED_PACKAGE_CODES;
  assert.ok(Array.isArray(codes), 'LED_PACKAGE_CODES is exported from quantity-tokens.js');
  assert.equal(new Set(codes).size, codes.length);
  for (const code of requiredPackages) {
    assert.equal(codes.includes(code), true, code);
  }
  assert.equal(typeof quantityTokens.isStandardE24Ohms, 'function');
  for (const ohms of [100, 110, 220, 330, 470, 910, 1000, 1200, 4700, 10000]) {
    assert.equal(quantityTokens.isStandardE24Ohms(ohms), true, String(ohms));
  }
  for (const ohms of [10, 12, 47, 91, 99, 123, 250, 333, 999, 1206, 1210, 2019, 2835, 5050]) {
    assert.equal(quantityTokens.isStandardE24Ohms(ohms), false, String(ohms));
  }

  const resistors = [
    ['LED 100', 100, '100Ω'],
    ['LED 220', 220, '220Ω'],
    ['LED 330', 330, '330Ω'],
    ['LED 470', 470, '470Ω'],
    ['LED 910', 910, '910Ω'],
    ['LED 1000', 1000, '1kΩ'],
    ['LED 1200', 1200, '1.2kΩ'],
    ['LED 4700', 4700, '4.7kΩ'],
    ['LED 10000', 10000, '10kΩ'],
    ['LED 5V 3 leds 470', 470, '470Ω'],
    ['LED resistor 47', 47, '47Ω'],
    ['LED 5V 저항 12', 12, '12Ω'],
    ['LED 47 ohm', 47, '47Ω'],
    ['LED 12R', 12, '12Ω'],
    ['LED 10Ω', 10, '10Ω'],
    ['LED 5V R=2', 2, '2Ω'],
    ['LED R1=330', 330, '330Ω']
  ];
  for (const [prompt, ohms, label] of resistors) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.equal(parsed.refused, false, `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
    assert.equal(parsed.resistorExplicit, true, prompt);
    assert.equal(parsed.resistanceOhms, ohms, prompt);
    assert.equal(parsed.resistorValue, label, prompt);
    assert.equal(parsed.package ?? null, null, prompt);
  }

  const ambiguous = [
    ['LED 10', '10'],
    ['LED 12', '12'],
    ['LED 24', '24'],
    ['LED 47', '47'],
    ['LED 91', '91'],
    ['LED 99', '99'],
    ['LED 12 5V', '12'],
    ['LED 5V 12', '12'],
    ['LED 100mA 12', '12'],
    ['LED 123', '123'],
    ['LED 250', '250'],
    ['LED 333', '333'],
    ['LED 999', '999']
  ];
  for (const [prompt, raw] of ambiguous) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.equal(parsed.refused, true, `${prompt} drafted ${parsed.resistorValue}`);
    assert.equal(parsed.count, 0, prompt);
    assert.equal(parsed.resistanceOhms, null, prompt);
    assert.equal(parsed.resistorValue, null, prompt);
    assert.equal(parsed.channels.length, 0, prompt);
    assert.notEqual(parsed.supplyVolts, Number(raw), prompt);
    assert.equal(parsed.reviewBlockers[0].code, 'discrete-led-ambiguous-number', prompt);
    assert.match(parsed.reviewBlockers[0].en, new RegExp(`^Is ${raw} a resistor in ohms, an LED count, or something else\\?`), parsed.reviewBlockers[0].en);
    assert.match(parsed.reviewBlockers[0].ko, new RegExp(`^${raw}(?:은|는) 저항\\(Ω\\)인가요`), parsed.reviewBlockers[0].ko);
    assert.equal(parsed.reviewBlockers[0].en.includes('Refusing to draft'), false, prompt);
    assert.equal(parsed.reviewBlockers[0].ko.includes('생성하지 않았습니다'), false, prompt);
  }

  for (const code of requiredPackages) {
    for (const prompt of [`${code} LED 5V`, `LED ${code} 5V`, `LED 5V ${code}`, `SMD ${code} LED`]) {
      const parsed = parseDiscreteLedRequest(prompt);
      assert.equal(parsed.refused, false, `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
      assert.equal(parsed.count, 1, prompt);
      assert.equal(parsed.requestedCount, 1, prompt);
      assert.equal(parsed.quantityCapped, false, prompt);
      assert.equal(parsed.package, code, prompt);
      assert.equal(parsed.resistorExplicit, false, prompt);
      assert.notEqual(parsed.resistanceOhms, Number(code), prompt);
      const spec = applyDiscreteLedSpec(normalizeCircuitSpec(prompt));
      assert.equal(spec.package, code, prompt);
      assert.equal(spec.discrete.package, code, prompt);
      const note = parsed.reviewNotes.find((item) => item.code === 'discrete-led-package');
      assert.ok(note, `${prompt} ${JSON.stringify(parsed.reviewNotes)}`);
      assert.match(note.en, new RegExp(`LED package ${code}`), note.en);
      assert.match(note.en, /not an LED count or a series resistor/, note.en);
      assert.match(note.ko, new RegExp(`LED 패키지 ${code}`), note.ko);
      assert.match(note.ko, /개수나 직렬 저항/, note.ko);
      assert.equal(note.message, note.en, prompt);
      const roles = classifyQuantities(prompt).tokens.map((token) => [token.raw, token.role]);
      assert.equal(roles.some(([raw, role]) => raw === code && role === 'package'), true, JSON.stringify(roles));
      assert.equal(roles.some(([, role]) => role === 'count'), false, `${prompt} ${JSON.stringify(roles)}`);
      assert.equal(roles.some(([, role]) => role === 'resistor'), false, `${prompt} ${JSON.stringify(roles)}`);
    }
  }

  const assumedPackage = parseDiscreteLedRequest('SMD 0603 LED');
  assert.equal(assumedPackage.supplyAssumed, true);
  assert.equal(assumedPackage.supplyVolts, 5);
  assert.equal(assumedPackage.resistorValue, '300Ω');
  assert.equal(assumedPackage.package, '0603');

  const twelveVoltPackage = parseDiscreteLedRequest('3528 LED 12V');
  assert.equal(twelveVoltPackage.count, 1);
  assert.equal(twelveVoltPackage.supplyVolts, 12);
  assert.equal(twelveVoltPackage.resistorValue, '1kΩ');
  assert.equal(twelveVoltPackage.package, '3528');

  for (const [prompt, count] of [['12 LED 5V', 8], ['10 LEDs', 8], ['24 LEDs', 8], ['1000 LEDs', 8]]) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.equal(parsed.refused, false, `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
    assert.equal(parsed.count, count, prompt);
    assert.equal(parsed.requestedCount > parsed.count, true, prompt);
    assert.equal(parsed.package ?? null, null, prompt);
    assert.equal(parsed.resistorExplicit, false, prompt);
  }
});

test('several resistor candidates, years, pins, and package codes ask or are consumed', () => {
  const several = [
    ['LED 330 and 4k7 on 5V', ['330Ω', '4.7kΩ']],
    ['LED 5V 330 470', ['330Ω', '470Ω']],
    ['LED 5V 330Ω 470Ω', ['330Ω', '470Ω']],
    ['엘이디 5V 330Ω 470Ω', ['330Ω', '470Ω']]
  ];
  for (const [prompt, labels] of several) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.equal(parsed.refused, true, `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
    assert.equal(parsed.count, 0, prompt);
    assert.equal(parsed.resistanceOhms, null, prompt);
    assert.equal(parsed.resistorValue, null, prompt);
    assert.equal(parsed.resistorExplicit, false, prompt);
    assert.equal(parsed.channels.length, 0, prompt);
    assert.equal(parsed.reviewBlockers.length, 1, prompt);
    const blocker = parsed.reviewBlockers[0];
    assert.equal(blocker.code, 'discrete-led-ambiguous-resistor', `${prompt} ${blocker.code} ${blocker.en}`);
    assert.match(blocker.en, /^Which resistor should the LED use,/, blocker.en);
    assert.match(blocker.ko, /중 어느 것을 LED 직렬 저항으로 쓸까요\?/, blocker.ko);
    for (const label of labels) {
      assert.match(blocker.en, new RegExp(escapeRegExp(label)), blocker.en);
      assert.match(blocker.ko, new RegExp(escapeRegExp(label)), blocker.ko);
    }
    assert.match(blocker.ko, /Ω과 /, blocker.ko);
    assert.equal(blocker.ko.includes('Ω와'), false, blocker.ko);
    assert.equal(blocker.en.includes('Refusing to draft'), false, blocker.en);
    assert.equal(blocker.ko.includes('생성하지 않았습니다'), false, blocker.ko);
    assert.equal(blocker.message, /[가-힣]/.test(prompt) ? blocker.ko : blocker.en, prompt);
  }

  const consumed = [
    ['LED 5V 2025년', '2025년', 'year', null],
    ['LED 5V in 2025', 'in 2025', 'year', null],
    ['LED 5V pin 13', 'pin 13', 'pin', null],
    ['LED 5V GPIO 13', 'GPIO 13', 'pin', null],
    ['LED 5V D13', 'D13', 'pin', null],
    ['LED 5V PA5', 'PA5', 'pin', null],
    ['LED 5V 0805', '0805', 'package', '0805'],
    ['LED 5V pin 330', 'pin 330', 'pin', null],
    ['LED 5V GPIO 220', 'GPIO 220', 'pin', null],
    ['LED 5V in 2200', 'in 2200', 'year', null],
    ['엘이디 5V 2025년', '2025년', 'year', null]
  ];
  for (const [prompt, raw, kind, packageCode] of consumed) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.equal(parsed.refused, false, `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
    assert.equal(parsed.resistorExplicit, false, prompt);
    assert.equal(parsed.resistanceOhms, 300, prompt);
    assert.equal(parsed.supplyVolts, 5, prompt);
    assert.equal(parsed.package ?? null, packageCode, prompt);
    const tokens = classifyQuantities(prompt).tokens;
    assert.equal(tokens.some((token) => token.kind === 'resistance' || token.kind === 'ambiguous'), false, `${prompt} ${JSON.stringify(tokens)}`);
    const consumedToken = tokens.find((token) => token.raw === raw);
    assert.ok(consumedToken, `${prompt} ${JSON.stringify(tokens.map((token) => token.raw))}`);
    if (kind === 'package') assert.equal(consumedToken.kind, 'package', prompt);
    else {
      assert.equal(consumedToken.kind, 'context', prompt);
      assert.equal(consumedToken.form, kind, prompt);
    }
    assert.notEqual(consumedToken.role, 'resistor', prompt);
  }

  for (const [prompt, raw, particle] of [['LED 12', '12', '는'], ['LED 24', '24', '는']]) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.equal(parsed.refused, true, `${prompt} drafted ${parsed.resistorValue} supply ${parsed.supplyVolts}`);
    assert.equal(parsed.reviewBlockers[0].code, 'discrete-led-ambiguous-number', prompt);
    assert.equal(parsed.resistanceOhms, null, prompt);
    assert.equal(parsed.resistorValue, null, prompt);
    assert.notEqual(parsed.supplyVolts, Number(raw), prompt);
    assert.match(parsed.reviewBlockers[0].en, new RegExp(`^Is ${raw} a resistor in ohms`), parsed.reviewBlockers[0].en);
    assert.match(parsed.reviewBlockers[0].ko, new RegExp(`^${raw}${particle} 저항\\(Ω\\)인가요`), parsed.reviewBlockers[0].ko);
  }
});

test('amp, milliamp, and microamp currents are normalized, and out-of-range currents are refused', () => {
  const recognized = [
    ['0.02A', 20, 'A'],
    ['0.02 A', 20, 'A'],
    ['20000uA', 20, 'uA'],
    ['20000 uA', 20, 'uA'],
    ['20uA', 0.02, 'uA'],
    ['20 uA', 0.02, 'uA'],
    ['20\u00B5A', 0.02, 'uA'],
    ['20 \u00B5A', 0.02, 'uA'],
    ['20\u03BCA', 0.02, 'uA'],
    ['20 \u03BCA', 0.02, 'uA']
  ];
  for (const [fragment, milliamps, unit] of recognized) {
    const { tokens } = tokenizeQuantities(fragment);
    const current = tokens.find((token) => token.kind === 'current');
    assert.ok(current, `${fragment} ${JSON.stringify(tokens)}`);
    assert.equal(current.value, milliamps, fragment);
    assert.equal(current.unit, unit, fragment);
    assert.equal(tokens.some((token) => token.kind === 'resistance' || token.kind === 'ambiguous'), false, JSON.stringify(tokens));
    const prompt = `LED 5V ${fragment}`;
    const parsed = parseDiscreteLedRequest(prompt);
    assert.equal(parsed.refused, false, `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
    assert.equal(parsed.requestedCurrentMa, milliamps, prompt);
    assert.equal(parsed.resistorExplicit, false, prompt);
    assert.equal(parsed.count, 1, prompt);
    if (milliamps === 20) {
      assert.equal(parsed.resistanceOhms, 150, prompt);
      assert.equal(parsed.resistorValue, '150Ω', prompt);
      assert.match(parsed.calculation.summary.en, /\(5V - 2V\) \/ 20mA = 150Ω/, prompt);
    } else {
      assert.equal(parsed.resistanceOhms, 150000, prompt);
      assert.equal(parsed.resistorValue, '150kΩ', prompt);
      assert.match(parsed.calculation.summary.en, /0\.02mA/, prompt);
      assert.equal(parsed.resistorValue === '20Ω', false, prompt);
    }
  }

  const refused = [
    ['LED 5V 0mA', '0mA', false],
    ['LED 5V 0 mA', '0mA', false],
    ['LED 5V -20mA', '-20mA', false],
    ['LED 5V -20 mA', '-20mA', false],
    ['LED 5V \u221220mA', '-20mA', false],
    ['LED 5V 0A', '0mA', false],
    ['LED 5V 0uA', '0mA', false],
    ['LED 5V 500mA', '500mA', false],
    ['LED 5V 500 mA', '500mA', false],
    ['LED 5V 0.5A', '0.5A (500mA)', false],
    ['LED 5V 101mA', '101mA', false],
    ['LED 500mA 330', '500mA', false],
    ['LED 0mA 330Ω', '0mA', false],
    ['엘이디 5V 500mA', '500mA', true],
    ['엘이디 5V 0mA', '0mA', true],
    ['엘이디 5V 0.5A', '500mA', true]
  ];
  for (const [prompt, shown, korean] of refused) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.equal(parsed.refused, true, `${prompt} drafted ${parsed.resistorValue}`);
    assert.equal(parsed.count, 0, prompt);
    assert.equal(parsed.resistanceOhms, null, prompt);
    assert.equal(parsed.resistorValue, null, prompt);
    assert.equal(parsed.channels.length, 0, prompt);
    assert.equal(parsed.reviewWarnings.length, 0, prompt);
    assert.equal(parsed.reviewBlockers.length, 1, prompt);
    const blocker = parsed.reviewBlockers[0];
    assert.equal(blocker.code, 'discrete-led-invalid-current', `${prompt} ${blocker.code} ${blocker.en}`);
    assert.match(blocker.en, /outside the supported range/, blocker.en);
    assert.match(blocker.en, /above 0mA and at most 100mA/, blocker.en);
    assert.match(blocker.en, /No LED, resistor, or power symbol was generated/, blocker.en);
    assert.match(blocker.en, new RegExp(shown.replace(/[().]/g, '\\$&')), blocker.en);
    assert.match(blocker.ko, /지원 범위/, blocker.ko);
    assert.match(blocker.ko, /0mA보다 크고 100mA 이하/, blocker.ko);
    assert.match(blocker.ko, /500mA|0mA|101mA/, blocker.ko);
    assert.equal(blocker.message, korean ? blocker.ko : blocker.en, prompt);
  }

  const hundred = parseDiscreteLedRequest('LED 5V 100mA');
  assert.equal(hundred.refused, false, JSON.stringify(hundred.reviewBlockers));
  assert.equal(hundred.requestedCurrentMa, 100);
  assert.equal(hundred.resistorValue, '30Ω');
  assert.equal(hundred.reviewWarnings.length, 1);
  assert.equal(hundred.reviewWarnings[0].code, 'discrete-led-headroom');
  assert.match(hundred.reviewWarnings[0].en, /requested current 100mA is above 30mA/);

  const thirty = parseDiscreteLedRequest('LED 5V 30mA');
  assert.equal(thirty.refused, false, JSON.stringify(thirty.reviewBlockers));
  assert.equal(thirty.requestedCurrentMa, 30);
  assert.equal(thirty.resistorValue, '100Ω');
  assert.equal(thirty.reviewWarnings.length, 0);

  const thirtyOne = parseDiscreteLedRequest('LED 5V 31mA');
  assert.equal(thirtyOne.refused, false, JSON.stringify(thirtyOne.reviewBlockers));
  assert.equal(thirtyOne.reviewWarnings[0].code, 'discrete-led-headroom');
  assert.match(thirtyOne.reviewWarnings[0].en, /requested current 31mA is above 30mA/);
  assert.match(thirtyOne.reviewWarnings[0].ko, /30mA를 넘/);

  const clashes = [
    ['LED 5V 20mA 330Ω', '330Ω', 330, '9.09mA', false],
    ['LED 5V 20mA 330', '330Ω', 330, '9.09mA', false],
    ['LED 5V 20mA 470', '470Ω', 470, '6.38mA', false],
    ['LED 5V 20mA 120Ω', '120Ω', 120, '25mA', false],
    ['엘이디 5V 20mA 330Ω', '330Ω', 330, '9.09mA', true]
  ];
  for (const [prompt, label, ohms, actual, korean] of clashes) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.equal(parsed.refused, false, `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
    assert.equal(parsed.resistorExplicit, true, prompt);
    assert.equal(parsed.resistanceOhms, ohms, prompt);
    assert.equal(parsed.resistorValue, label, prompt);
    assert.equal(parsed.count, 1, prompt);
    const warning = parsed.reviewWarnings.find((item) => item.code === 'discrete-led-current-mismatch');
    assert.ok(warning, `${prompt} ${JSON.stringify(parsed.reviewWarnings)}`);
    assert.match(warning.en, new RegExp(actual.replace('.', '\\.')), warning.en);
    assert.match(warning.en, /more than 20%/, warning.en);
    assert.match(warning.en, /stated current 20mA/, warning.en);
    assert.match(warning.ko, new RegExp(actual.replace('.', '\\.')), warning.ko);
    assert.match(warning.ko, /20%를 넘게/, warning.ko);
    assert.match(warning.ko, /지정한 전류 20mA와/, warning.ko);
    assert.equal(warning.message, korean ? warning.ko : warning.en, prompt);
  }

  for (const prompt of ['LED 5V 20mA 150Ω', 'LED 5V 20mA 150', 'LED 5V 20mA 180Ω', 'LED 5V 20mA 187.5Ω']) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.equal(parsed.refused, false, `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
    assert.equal(parsed.resistorExplicit, true, prompt);
    assert.equal(parsed.reviewWarnings.some((item) => item.code === 'discrete-led-current-mismatch'), false, `${prompt} ${JSON.stringify(parsed.reviewWarnings)}`);
  }
  const edge = parseDiscreteLedRequest('LED 5V 20mA 187.5Ω');
  assert.equal(edge.resistanceOhms, 187.5);
  assert.equal(edge.resistorValue, '187.5Ω');
});

test('fullwidth digits, glued counts, word pcs, and sub-ohm resistors', () => {
  const wideCount = tokenizeQuantities('LED ２개 5V');
  const count = wideCount.tokens.find((token) => token.kind === 'count');
  assert.ok(count, JSON.stringify(wideCount.tokens));
  assert.equal(count.value, 2);
  assert.equal(count.raw, '2개');
  const wideOhm = tokenizeQuantities('LED ３３０Ω 5V');
  const ohm = wideOhm.tokens.find((token) => token.kind === 'resistance');
  assert.ok(ohm, JSON.stringify(wideOhm.tokens));
  assert.equal(ohm.value, 330);
  assert.equal(ohm.raw, '330Ω');

  for (const [prompt, countValue, resistor, explicit] of [
    ['LEDx3', 3, '300Ω', false],
    ['LED×3', 3, '300Ω', false],
    ['LEDx3 5V', 3, '300Ω', false],
    ['LED×3 5V', 3, '300Ω', false],
    ['two pcs LED', 2, '300Ω', false],
    ['LED two pcs', 2, '300Ω', false],
    ['Two pcs LED 5V', 2, '300Ω', false],
    ['LED TWO PCS', 2, '300Ω', false]
  ]) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.ok(parsed, prompt);
    assert.equal(parsed.refused, false, `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
    assert.equal(parsed.count, countValue, prompt);
    assert.equal(parsed.resistorValue, resistor, prompt);
    assert.equal(parsed.resistorExplicit, explicit, prompt);
    assert.equal(parsed.supplyVolts, 5, prompt);
  }

  const tooSmall = [
    ['LED 5V 0R', /0R/, /0Ω은/],
    ['LED 5V 0Ω', /0Ω/, /0Ω은/],
    ['LED 5V 0 ohm', /0 ohm/, /0Ω은/],
    ['LED 5V 0.5Ω', /0\.5Ω/, /0\.5Ω은/],
    ['LED 5V R47', /R47/, /0\.47Ω은/],
    ['엘이디 0Ω', /0Ω/, /0Ω은/],
    ['엘이디 R47', /R47/, /0\.47Ω은/]
  ];
  for (const [prompt, english, korean] of tooSmall) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.ok(parsed, prompt);
    assert.equal(parsed.refused, true, `${prompt} drafted ${parsed.resistorValue}`);
    assert.equal(parsed.count, 0, prompt);
    assert.equal(parsed.resistanceOhms, null, prompt);
    assert.equal(parsed.resistorValue, null, prompt);
    assert.equal(parsed.channels.length, 0, prompt);
    assert.equal(parsed.reviewWarnings.length, 0, prompt);
    assert.equal(parsed.reviewBlockers.length, 1, prompt);
    const blocker = parsed.reviewBlockers[0];
    assert.equal(blocker.code, 'discrete-led-resistor-too-small', `${prompt} ${blocker.code} ${blocker.en}`);
    assert.match(blocker.en, /below 1Ω/i, blocker.en);
    assert.match(blocker.en, english, blocker.en);
    assert.match(blocker.ko, korean, blocker.ko);
    assert.match(blocker.ko, /1Ω/, blocker.ko);
    assert.equal(blocker.ko.includes('ohm'), false, blocker.ko);
    assert.equal(/R47/.test(blocker.ko), false, blocker.ko);
    assert.equal(blocker.message, /[가-힣]/.test(prompt) ? blocker.ko : blocker.en, prompt);
  }
});

test('korean particles follow the final consonant of the previous value', () => {
  // 0 is read 영 and 1 is read 일 (batchim) → 은. 2.5 ends in 5 (오) and 4 is 사 → 는.
  const zero = parseDiscreteLedRequest('LED 0개').reviewBlockers[0];
  assert.equal(zero.code, 'discrete-led-invalid-count');
  assert.match(zero.ko, /LED 개수 0은 양의 정수가 아닙니다/);
  assert.equal(zero.ko.includes('0는'), false);

  const fraction = parseDiscreteLedRequest('LED 2.5개').reviewBlockers[0];
  assert.equal(fraction.code, 'discrete-led-invalid-count');
  assert.match(fraction.ko, /LED 개수 2\.5는 양의 정수가 아닙니다/);
  assert.equal(fraction.ko.includes('2.5은'), false);

  const one = parseDiscreteLedRequest('LED 1').reviewBlockers[0];
  assert.equal(one.code, 'discrete-led-ambiguous-number');
  assert.match(one.en, /^Is 1 a resistor in ohms, an LED count, or something else\?/);
  assert.match(one.ko, /^1은 저항\(Ω\)인가요, LED 개수인가요\?/);
  assert.equal(one.ko.includes('1는'), false);
  assert.equal(one.en.includes('Refusing to draft'), false);

  const four = parseDiscreteLedRequest('LED 4').reviewBlockers[0];
  assert.equal(four.code, 'discrete-led-ambiguous-number');
  assert.match(four.en, /^Is 4 a resistor in ohms, an LED count, or something else\?/);
  assert.match(four.ko, /^4는 저항\(Ω\)인가요, LED 개수인가요\?/);
  assert.equal(four.ko.includes('4은'), false);

  // Ω is read 옴 (batchim) → 을. V is read 볼트 and A is 에이 (no batchim) → 가.
  const keptOhm = parseDiscreteLedRequest('LED 5V 330Ω');
  assert.match(keptOhm.reviewNotes.map((note) => note.ko).join('\n'), /330Ω을/);
  const supply = parseDiscreteLedRequest('red LED on 1.8V').reviewBlockers[0];
  assert.match(supply.ko, /1\.8V가/);
  assert.equal(supply.ko.includes('1.8V이'), false);
  const current = parseDiscreteLedRequest('엘이디 5V 50mA');
  assert.match(current.reviewWarnings[0].ko, /50mA가/);
  assert.equal(current.reviewWarnings[0].ko.includes('50mA이'), false);
});

test('RKM notation and suffixed multipliers are explicit series resistors', () => {
  const rkm = parseDiscreteLedRequest('3.3V LED 4k7');
  assert.ok(rkm);
  assert.equal(rkm.supplyVolts, 3.3);
  assert.equal(rkm.supplyNet, '+3V3');
  assert.equal(rkm.resistorExplicit, true);
  assert.equal(rkm.resistanceOhms, 4700);
  assert.equal(rkm.resistorValue, '4.7kΩ');

  const ohmsCode = parseDiscreteLedRequest('LED 1R5 on 5V');
  assert.ok(ohmsCode);
  assert.equal(ohmsCode.supplyVolts, 5);
  assert.equal(ohmsCode.resistorExplicit, true);
  assert.equal(ohmsCode.resistanceOhms, 1.5);
  assert.equal(ohmsCode.resistorValue, '1.5Ω');

  const mega = parseDiscreteLedRequest('LED 2M2 on 5V');
  assert.ok(mega);
  assert.equal(mega.resistorExplicit, true);
  assert.equal(mega.resistanceOhms, 2_200_000);
  assert.equal(mega.resistorValue, '2.2MΩ');

  const decimalKilo = parseDiscreteLedRequest('LED 4.7k on 5V');
  assert.ok(decimalKilo);
  assert.equal(decimalKilo.resistorExplicit, true);
  assert.equal(decimalKilo.resistanceOhms, 4700);
  assert.equal(decimalKilo.resistorValue, '4.7kΩ');

  const decimalKiloUnit = parseDiscreteLedRequest('LED 4.7kΩ on 5V');
  assert.ok(decimalKiloUnit);
  assert.equal(decimalKiloUnit.resistanceOhms, 4700);
  assert.equal(decimalKiloUnit.resistorValue, '4.7kΩ');

  const suffixR = parseDiscreteLedRequest('LED 330R on 5V');
  assert.equal(suffixR?.resistanceOhms, 330);
  assert.equal(suffixR?.resistorValue, '330Ω');

  const suffixKiloR = parseDiscreteLedRequest('LED 1kR on 5V');
  assert.equal(suffixKiloR?.resistanceOhms, 1000);
  assert.equal(suffixKiloR?.resistorValue, '1kΩ');

  const kilohertz = parseDiscreteLedRequest('LED 5V 1kHz');
  assert.ok(kilohertz);
  assert.equal(kilohertz.supplyVolts, 5);
  assert.equal(kilohertz.resistorExplicit, false);
  assert.equal(kilohertz.resistorValue, '300Ω');
});

test('a potentiometer value is not the LED series resistor', () => {
  for (const prompt of [
    '10k pot, LED, 5V',
    '10k potentiometer, LED, 5V',
    '가변저항 10k LED 5V',
    '10kΩ pot, LED, 5V',
    'pot 10k, LED, 5V'
  ]) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.ok(parsed, prompt);
    assert.equal(parsed.supplyVolts, 5, prompt);
    assert.equal(parsed.resistorExplicit, false, prompt);
    assert.equal(parsed.resistorValue, '300Ω', prompt);
    assert.equal(
      parsed.reviewNotes.some((note) => note.code === 'discrete-led-unsupported-pot'
        && note.en === 'Unsupported: potentiometers are not supported by the discrete LED generator. The draft uses a fixed series resistor instead.'
        && note.message === (/[가-힣]/.test(prompt) ? note.ko : note.en)),
      true,
      `${prompt} ${JSON.stringify(parsed.reviewNotes)}`
    );
  }

  const withSeries = parseDiscreteLedRequest('10k pot and 330 ohm LED on 5V');
  assert.ok(withSeries);
  assert.equal(withSeries.resistorExplicit, true);
  assert.equal(withSeries.resistanceOhms, 330);
  assert.equal(withSeries.resistorValue, '330Ω');
  assert.equal(withSeries.reviewNotes.some((note) => note.code === 'discrete-led-unsupported-pot'), true);
});

test('voltages, LED counts, and currents are not parsed as series resistors', () => {
  const count = parseDiscreteLedRequest('5V 3 LEDs');
  assert.ok(count);
  assert.equal(count.supplyVolts, 5);
  assert.equal(count.count, 3);
  assert.equal(count.resistorExplicit, false);
  assert.equal(count.resistorValue, '300Ω');

  const twelveCount = parseDiscreteLedRequest('12V 3 LEDs');
  assert.ok(twelveCount);
  assert.equal(twelveCount.supplyVolts, 12);
  assert.equal(twelveCount.count, 3);
  assert.equal(twelveCount.resistorExplicit, false);
  assert.equal(twelveCount.resistorValue, '1kΩ');

  const current = parseDiscreteLedRequest('LED 5V 20mA');
  assert.ok(current);
  assert.equal(current.supplyVolts, 5);
  assert.equal(current.resistorExplicit, false);
  assert.equal(current.resistanceOhms, 150);
  assert.equal(current.resistorValue, '150Ω');
  assert.match(current.calculation.summary.en, /\(5V - 2V\) \/ 20mA = 150Ω/);
  assert.equal(/10mA/.test(current.calculation.summary.en), false);

  const spacedCurrent = parseDiscreteLedRequest('LED 5V 20 mA');
  assert.ok(spacedCurrent);
  assert.equal(spacedCurrent.resistorExplicit, false);
  assert.equal(spacedCurrent.resistanceOhms, 150);
  assert.equal(spacedCurrent.resistorValue, '150Ω');

  for (const prompt of ['LED 5V 20mA 470', 'LED 5V 20 mA 470']) {
    const bareAfterCurrent = parseDiscreteLedRequest(prompt);
    assert.equal(bareAfterCurrent.refused, false, `${prompt} ${JSON.stringify(bareAfterCurrent.reviewBlockers)}`);
    assert.equal(bareAfterCurrent.reviewBlockers.length, 0, prompt);
    assert.equal(bareAfterCurrent.resistorExplicit, true, prompt);
    assert.equal(bareAfterCurrent.resistanceOhms, 470, prompt);
    assert.equal(bareAfterCurrent.resistorValue, '470Ω', prompt);
    assert.equal(bareAfterCurrent.count, 1, prompt);
  }

  const partNumber = parseDiscreteLedRequest('addressable WS2812 LED');
  assert.ok(partNumber);
  assert.equal(partNumber.resistorExplicit, false);
  assert.notEqual(partNumber.resistanceOhms, 2812);
  assert.equal(partNumber.resistorValue, '300Ω');

  const glued = parseDiscreteLedRequest('LED on 3V3');
  assert.ok(glued);
  assert.equal(glued.supplyVolts, 3.3);
  assert.equal(glued.supplyNet, '+3V3');
  assert.equal(glued.resistorExplicit, false);
  assert.equal(glued.resistorValue, '130Ω');

  const fiveVoltZero = parseDiscreteLedRequest('LED on 5v0');
  assert.ok(fiveVoltZero);
  assert.equal(fiveVoltZero.supplyVolts, 5);
  assert.equal(fiveVoltZero.supplyNet, '+5V');
  assert.equal(fiveVoltZero.resistorExplicit, false);
});

test('supply voltage prefers the rail and ignores LED forward voltage', () => {
  const vfOnSupply = parseDiscreteLedRequest('LED Vf 2V on 5V supply');
  assert.ok(vfOnSupply);
  assert.equal(vfOnSupply.supplyVolts, 5);
  assert.equal(vfOnSupply.supplyNet, '+5V');
  assert.equal(vfOnSupply.resistorExplicit, false);
  assert.equal(vfOnSupply.resistorValue, '300Ω');
  assert.equal(vfOnSupply.reviewNotes.some((note) => /not above/i.test(note.message)), false);

  const forward = parseDiscreteLedRequest('LED 2V forward, 12V supply');
  assert.ok(forward);
  assert.equal(forward.supplyVolts, 12);
  assert.equal(forward.supplyNet, '+12V');
  assert.equal(forward.resistorExplicit, false);
  assert.equal(forward.resistorValue, '1kΩ');

  const atRail = parseDiscreteLedRequest('LED 1.8V red at 9V');
  assert.ok(atRail);
  assert.equal(atRail.supplyVolts, 9);
  assert.equal(atRail.supplyNet, '+9V');
  assert.equal(atRail.color?.id, 'red');
  assert.equal(atRail.resistorExplicit, false);
  assert.equal(atRail.resistorValue, '750Ω');

  const korean = parseDiscreteLedRequest('LED 순방향 2V, 전원 5V');
  assert.ok(korean);
  assert.equal(korean.supplyVolts, 5);
  assert.equal(korean.supplyNet, '+5V');

  const battery = parseDiscreteLedRequest('LED Vf 2V, 배터리 9V');
  assert.ok(battery);
  assert.equal(battery.supplyVolts, 9);
  assert.equal(battery.supplyNet, '+9V');
  assert.equal(battery.supplyKind, 'battery');

  const onlyForward = parseDiscreteLedRequest('LED Vf 2V');
  assert.ok(onlyForward);
  assert.equal(onlyForward.supplyVolts, 5);
  assert.equal(onlyForward.supplyNet, '+5V');
  assert.equal(onlyForward.resistorValue, '300Ω');

  const mains = parseDiscreteLedRequest('LED on 220V/AC mains');
  assert.ok(mains);
  assert.equal(mains.refused, true);
  assert.equal(mains.supplyVolts, 220);

  const allowed = parseDiscreteLedRequest('LED on 24V');
  assert.ok(allowed);
  assert.equal(allowed.refused, false);
  assert.equal(allowed.supplyVolts, 24);
  assert.equal(allowed.supplyNet, '+24V');
});

test('existing discrete LED supply phrases stay on the named rail and resistor', () => {
  const ohms = parseDiscreteLedRequest('5V 330Ω LED');
  assert.ok(ohms);
  assert.equal(ohms.supplyVolts, 5);
  assert.equal(ohms.supplyNet, '+5V');
  assert.equal(ohms.resistorValue, '330Ω');
  assert.equal(ohms.resistanceOhms, 330);

  const koreanOhms = parseDiscreteLedRequest('5V 330옴 저항과 LED 연결');
  assert.ok(koreanOhms);
  assert.equal(koreanOhms.supplyVolts, 5);
  assert.equal(koreanOhms.resistorValue, '330Ω');

  const kilo = parseDiscreteLedRequest('12V 1k LED');
  assert.ok(kilo);
  assert.equal(kilo.supplyVolts, 12);
  assert.equal(kilo.supplyNet, '+12V');
  assert.equal(kilo.resistorValue, '1kΩ');
  assert.equal(kilo.resistanceOhms, 1000);

  const koreanKilo = parseDiscreteLedRequest('12V 1k 저항과 LED');
  assert.ok(koreanKilo);
  assert.equal(koreanKilo.supplyVolts, 12);
  assert.equal(koreanKilo.resistorValue, '1kΩ');

  const glued = parseDiscreteLedRequest('LED on 3V3');
  assert.ok(glued);
  assert.equal(glued.supplyVolts, 3.3);
  assert.equal(glued.supplyNet, '+3V3');

  const sentence = parseDiscreteLedRequest('red LED with a 330 ohm resistor on 5V');
  assert.ok(sentence);
  assert.equal(sentence.supplyVolts, 5);
  assert.equal(sentence.resistorValue, '330Ω');
  assert.equal(sentence.color?.id, 'red');

  const at = parseDiscreteLedRequest('LED and 330 ohm resistor at 12V');
  assert.ok(at);
  assert.equal(at.supplyVolts, 12);
  assert.equal(at.resistorValue, '330Ω');

  const battery = parseDiscreteLedRequest('LED on 9V battery');
  assert.ok(battery);
  assert.equal(battery.supplyVolts, 9);
  assert.equal(battery.supplyNet, '+9V');
  assert.equal(battery.supplyKind, 'battery');

  const high = parseDiscreteLedRequest('LED at 48V');
  assert.ok(high);
  assert.equal(high.refused, true);
  assert.equal(high.supplyVolts, 48);

  const adapter = parseDiscreteLedRequest('LED on a 5V AC adapter');
  assert.ok(adapter);
  assert.equal(adapter.refused, true);
  assert.equal(adapter.supplyNet, null);
  assert.equal(adapter.reviewBlockers[0]?.code, 'discrete-led-ac-supply');
  assert.match(adapter.reviewBlockers[0].message, /supply is AC/i);

  const green = parseDiscreteLedRequest('green LED on 5V');
  assert.ok(green);
  assert.equal(green.supplyVolts, 5);
  assert.equal(green.resistorValue, '300Ω');
  assert.equal(green.color?.id, 'green');
});

test('discrete LED supply voltage parsing is table-driven and fail-closed', () => {
  const accepted = [
    ['LED 5V', 5, '+5V'],
    ['LED 3.3V', 3.3, '+3V3'],
    ['LED on 3V3', 3.3, '+3V3'],
    ['LED on 5v0', 5, '+5V'],
    ['LED 12 V', 12, '+12V'],
    ['LED 5 V DC', 5, '+5V'],
    ['LED 12VDC', 12, '+12V'],
    ['LED 9V battery', 9, '+9V'],
    ['LED 7.4V', 7.4, '+7V4'],
    ['LED on +7V4', 7.4, '+7V4'],
    ['LED 7,4V', 7.4, '+7V4'],
    ['LED 3,3V', 3.3, '+3V3'],
    ['LED 3300mV', 3.3, '+3V3'],
    ['LED 3300 mV', 3.3, '+3V3'],
    ['LED 12 volts', 12, '+12V'],
    ['LED 24V', 24, '+24V'],
    ['LED on a 5V adapter', 5, '+5V']
  ];
  for (const [prompt, volts, net] of accepted) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.ok(parsed, prompt);
    assert.equal(parsed.refused, false, prompt);
    assert.equal(parsed.supplyVolts, volts, prompt);
    assert.equal(parsed.supplyNet, net, prompt);
    assert.equal(parsed.supplyAssumed, false, prompt);
    assert.equal(parsed.reviewBlockers.length, 0, `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
  }

  const refusedHigh = [
    ['LED 48 volts', 48],
    ['LED 12 volts is fine but 48 volts is not', 48],
    ['LED 120 volt AC', 120],
    ['LED 2kV', 2000],
    ['LED 5kV', 5000],
    ['LED 2 kV', 2000],
    ['LED at 24.5V', 24.5],
    ['LED lamp 100V', 100],
    ['LED on 220VAC', 220]
  ];
  for (const [prompt, volts] of refusedHigh) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.ok(parsed, prompt);
    assert.equal(parsed.refused, true, prompt);
    assert.equal(parsed.supplyVolts, volts, prompt);
    assert.equal(parsed.supplyNet, null, prompt);
    assert.equal(parsed.reviewBlockers[0]?.code, 'discrete-led-high-voltage', prompt);
    assert.match(parsed.reviewBlockers[0].message, /24V/, prompt);
  }

  const refusedInvalid = ['LED 0V', 'LED 0 volts', 'LED -5V', 'LED -3,3V', 'LED 5Vrms', 'LED on volts', 'LED 3,3,3V'];
  for (const prompt of refusedInvalid) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.ok(parsed, prompt);
    assert.equal(parsed.refused, true, prompt);
    assert.equal(parsed.supplyAssumed, false, prompt);
    assert.equal(parsed.supplyNet, null, prompt);
    assert.notEqual(parsed.supplyVolts, 5, prompt);
    assert.equal(parsed.reviewBlockers[0]?.code, 'discrete-led-invalid-voltage', `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
    assert.match(parsed.reviewBlockers[0].message, /voltage/i, prompt);
  }

  for (const prompt of ['LED', 'three LEDs', '빨간 LED']) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.ok(parsed, prompt);
    assert.equal(parsed.refused, false, prompt);
    assert.equal(parsed.supplyVolts, 5, prompt);
    assert.equal(parsed.supplyNet, '+5V', prompt);
    assert.equal(parsed.supplyAssumed, true, prompt);
    const note = parsed.reviewNotes.find((item) => item.code === 'discrete-led-supply-assumed');
    assert.ok(note, `${prompt} ${JSON.stringify(parsed.reviewNotes)}`);
    assert.match(note.en, /assumes 5V/);
    assert.match(note.ko, /5V로 가정/);
    assert.equal(note.message, /[가-힣]/.test(prompt) ? note.ko : note.en);
  }

  const explicit = parseDiscreteLedRequest('red LED on 5V');
  assert.equal(explicit.supplyAssumed, false);
  assert.equal(explicit.reviewNotes.some((note) => note.code === 'discrete-led-supply-assumed'), false);
});

test('low LED headroom warns once and a supply at or below Vf blocks the draft', () => {
  const white = parseDiscreteLedRequest('white LED on 3.3V');
  assert.ok(white);
  assert.equal(white.refused, false);
  assert.equal(white.resistorValue, '10Ω');
  assert.equal(white.reviewBlockers.length, 0);
  assert.equal(white.reviewWarnings.length, 1);
  assert.equal(white.reviewWarnings[0].code, 'discrete-led-headroom');
  assert.match(white.reviewWarnings[0].message, /0\.1V/);
  assert.match(white.reviewWarnings[0].message, /10Ω/);
  assert.match(white.reviewWarnings[0].message, /68Ω/);

  const blue = parseDiscreteLedRequest('blue LED on 3V');
  assert.ok(blue);
  assert.equal(blue.refused, true);
  assert.equal(blue.resistorValue, null);
  assert.equal(blue.supplyNet, null);
  assert.equal(blue.reviewWarnings.length, 0);
  assert.equal(blue.reviewBlockers.length, 1);
  assert.equal(blue.reviewBlockers[0].code, 'discrete-led-below-vf');
  assert.match(blue.reviewBlockers[0].en, /not above/i);
  assert.match(blue.reviewBlockers[0].message, /not above/i);
  assert.match(blue.reviewBlockers[0].ko, /파란/);
  assert.equal(blue.reviewBlockers[0].message.includes('Unsupported'), false);
  assert.equal(/placeholder/i.test(blue.reviewBlockers[0].message), false);
  assert.equal(blue.reviewNotes.some((note) => note.message === blue.reviewBlockers[0].message), false);

  const near = parseDiscreteLedRequest('red LED on 2.5V');
  assert.equal(near.resistorValue, '51Ω');
  assert.equal(near.reviewWarnings.length, 1);
  assert.match(near.reviewWarnings[0].message, /51Ω/);
  assert.match(near.reviewWarnings[0].message, /68Ω/);
  assert.equal(near.reviewBlockers.length, 0);

  const tinyExplicit = parseDiscreteLedRequest('red LED with a 10 ohm resistor on 5V');
  assert.equal(tinyExplicit.resistorValue, '10Ω');
  assert.equal(tinyExplicit.reviewWarnings.length, 1);
  assert.match(tinyExplicit.reviewWarnings[0].message, /10Ω/);
  assert.match(tinyExplicit.reviewWarnings[0].message, /68Ω/);
  assert.equal(/headroom is only/i.test(tinyExplicit.reviewWarnings[0].message), false);

  const comfortable = parseDiscreteLedRequest('white LED on 5V');
  assert.equal(comfortable.reviewWarnings.length, 0);
  assert.equal(comfortable.reviewBlockers.length, 0);
});

test('AC supply indications are refused for any voltage and DC wording still parses', () => {
  const refused = [
    ['LED 24 VAC', 24],
    ['LED 24 Vac', 24],
    ['LED 12V AC', 12],
    ['12V AC LED', 12],
    ['LED 24 V AC', 24],
    ['AC adapter 9VAC LED', 9],
    ['LED on an AC adapter 9VAC', 9],
    ['LED 9Vac', 9],
    ['LED 5VAC', 5],
    ['LED Vac', null],
    ['Vac LED', null],
    ['LED 교류', null],
    ['교류 LED', null],
    ['AC 전원 LED', null],
    ['LED AC 전원', null]
  ];
  for (const [prompt, volts] of refused) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.ok(parsed, prompt);
    assert.equal(parsed.refused, true, prompt);
    assert.equal(parsed.supplyNet, null, prompt);
    assert.equal(parsed.resistorValue, null, prompt);
    assert.equal(parsed.channels.length, 0, prompt);
    assert.equal(parsed.reviewBlockers.length, 1, `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
    assert.equal(parsed.reviewBlockers[0].code, 'discrete-led-ac-supply', prompt);
    assert.match(parsed.reviewBlockers[0].en, /supply is AC/i, prompt);
    assert.match(parsed.reviewBlockers[0].ko, /교류/, prompt);
    assert.equal(parsed.reviewBlockers[0].message, /[가-힣]/.test(prompt) ? parsed.reviewBlockers[0].ko : parsed.reviewBlockers[0].en, prompt);
    assert.equal(parsed.reviewBlockers[0].en.includes('Unsupported'), false, prompt);
    assert.equal(parsed.reviewBlockers[0].ko.includes('Unsupported'), false, prompt);
    if (volts == null) {
      assert.equal(parsed.supplyVolts, null, prompt);
    } else {
      assert.equal(parsed.supplyVolts, volts, prompt);
      assert.match(parsed.reviewBlockers[0].en, new RegExp(`${volts}V AC`), prompt);
    }
  }

  const accepted = [
    ['LED 5 V DC', 5, '+5V'],
    ['LED 12VDC', 12, '+12V'],
    ['LED 5VDC', 5, '+5V'],
    ['LED 24VDC', 24, '+24V'],
    ['DC LED 5V', 5, '+5V'],
    ['LED on a 5V adapter', 5, '+5V'],
    ['LED on 24V', 24, '+24V']
  ];
  for (const [prompt, volts, net] of accepted) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.ok(parsed, prompt);
    assert.equal(parsed.refused, false, `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
    assert.equal(parsed.supplyVolts, volts, prompt);
    assert.equal(parsed.supplyNet, net, prompt);
    assert.equal(parsed.reviewBlockers.length, 0, prompt);
  }
});

test('several different LED supply voltages are refused instead of picking the first', () => {
  const refused = [
    ['LED 5V and 12V', [5, 12]],
    ['LED 5V, 12V', [5, 12]],
    ['5V and 12V LEDs', [5, 12]],
    ['LED 3.3V or 5V', [3.3, 5]],
    ['LED on 9V and 12V', [9, 12]],
    ['LED 12V and 5V supply', [12, 5]]
  ];
  for (const [prompt, volts] of refused) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.ok(parsed, prompt);
    assert.equal(parsed.refused, true, prompt);
    assert.equal(parsed.supplyVolts, null, `${prompt} picked ${parsed.supplyVolts}`);
    assert.equal(parsed.supplyNet, null, prompt);
    assert.equal(parsed.resistorValue, null, prompt);
    assert.equal(parsed.reviewBlockers.length, 1, prompt);
    assert.equal(parsed.reviewBlockers[0].code, 'discrete-led-ambiguous-supply', prompt);
    assert.match(parsed.reviewBlockers[0].en, /which supply/i, prompt);
    assert.match(parsed.reviewBlockers[0].message, /which supply/i, prompt);
    assert.match(parsed.reviewBlockers[0].ko, /어떤 공급/, prompt);
    assert.equal(parsed.reviewBlockers[0].ko.includes(' and '), false, parsed.reviewBlockers[0].ko);
    for (const value of volts) {
      assert.match(parsed.reviewBlockers[0].message, new RegExp(`${String(value).replace('.', '\\.')}V`), prompt);
    }
  }

  const accepted = [
    ['LED 5V and 5V', 5, '+5V', false],
    ['LED 5V, 5 V', 5, '+5V', false],
    ['3.3V LED 3,3V', 3.3, '+3V3', false],
    ['LED 12V and 12 volts', 12, '+12V', false],
    ['LED Vf 2V on 5V supply', 5, '+5V', false],
    ['LED 2V forward, 12V supply', 12, '+12V', false],
    ['LED 1.8V red at 9V', 9, '+9V', false],
    ['LED 순방향 2V, 전원 5V', 5, '+5V', false],
    ['LED Vf 2V, 배터리 9V', 9, '+9V', false],
    ['LED Vf 2V', 5, '+5V', true]
  ];
  for (const [prompt, volts, net, assumed] of accepted) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.ok(parsed, prompt);
    assert.equal(parsed.refused, false, `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
    assert.equal(parsed.supplyVolts, volts, prompt);
    assert.equal(parsed.supplyNet, net, prompt);
    assert.equal(parsed.supplyAssumed, assumed, prompt);
    assert.equal(parsed.reviewBlockers.length, 0, prompt);
  }
  assert.equal(parseDiscreteLedRequest('LED Vf 2V on 5V supply').resistorValue, '300Ω');
  assert.equal(parseDiscreteLedRequest('LED 1.8V red at 9V').resistorValue, '750Ω');
  assert.equal(parseDiscreteLedRequest('LED 2V forward, 12V supply').resistorValue, '1kΩ');
});

test('a supply that is not above the LED forward voltage is refused without a placeholder', () => {
  const cases = [
    ['LED on 0.5V', 0.5, /red/i, /빨간/, /2V/],
    ['red LED on 1.8V', 1.8, /red/i, /빨간/, /2V/],
    ['빨간 LED 1.8V', 1.8, /red/i, /빨간/, /2V/],
    ['blue LED on 3V', 3, /blue/i, /파란/, /3V/],
    ['white LED on 3V', 3, /white/i, /하얀/, /3\.2V/],
    ['red LED with a 470 ohm resistor on 1.8V', 1.8, /red/i, /빨간/, /2V/],
    ['red and blue LEDs on 2.5V', 2.5, /blue/i, /파란/, /3V/]
  ];
  for (const [prompt, volts, enColor, koColor, vf] of cases) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.ok(parsed, prompt);
    assert.equal(parsed.refused, true, `${prompt} resistor ${parsed.resistorValue}`);
    assert.equal(parsed.supplyVolts, volts, prompt);
    assert.equal(parsed.supplyNet, null, prompt);
    assert.equal(parsed.resistorValue, null, prompt);
    assert.equal(parsed.resistanceOhms, null, prompt);
    assert.deepEqual(parsed.channels, [], prompt);
    assert.equal(parsed.reviewWarnings.length, 0, prompt);
    assert.equal(parsed.reviewBlockers.length, 1, prompt);
    assert.equal(parsed.reviewBlockers[0].code, 'discrete-led-below-vf', prompt);
    const blocker = parsed.reviewBlockers[0];
    const message = blocker.message;
    assert.match(blocker.en, /not above/i, prompt);
    assert.match(blocker.en, enColor, prompt);
    assert.match(blocker.en, vf, prompt);
    assert.match(blocker.ko, koColor, prompt);
    assert.match(blocker.ko, /공급 전압/, prompt);
    assert.match(blocker.ko, vf, prompt);
    assert.equal(message, /[가-힣]/.test(prompt) ? blocker.ko : blocker.en, prompt);
    assert.equal(/placeholder/i.test(blocker.en), false, blocker.en);
    assert.equal(blocker.en.includes('Unsupported'), false, blocker.en);
    assert.equal(blocker.en.includes('1kΩ'), false, blocker.en);
    assert.equal(parsed.reviewNotes.some((note) => note.message === message), false, prompt);
    if (prompt === 'red LED on 1.8V') {
      assert.match(blocker.en, /supply 1\.8V is not above LED Vf 2V/);
      assert.equal(blocker.en.includes('supply 2V is not above LED Vf 1.8V'), false);
      assert.match(blocker.ko, /공급 전압 1\.8V가 빨간 LED의 일반적인 순방향 전압 2V보다/);
      assert.equal(blocker.ko.includes('공급 전압 2V'), false);
    }
  }
});

test('dangerously small explicit LED resistors reuse the single headroom warning', () => {
  const cases = [
    ['LED 1R5 3V', '1.5Ω', false],
    ['LED 1R5 on 5V', '1.5Ω', false],
    ['red LED 10Ω on 5V', '10Ω', false],
    ['red LED with a 10 ohm resistor on 5V', '10Ω', false],
    ['red LED 1R5 on 2.5V', '1.5Ω', true]
  ];
  for (const [prompt, resistor, headroom] of cases) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.ok(parsed, prompt);
    assert.equal(parsed.refused, false, prompt);
    assert.equal(parsed.resistorValue, resistor, prompt);
    assert.equal(parsed.reviewBlockers.length, 0, prompt);
    assert.equal(parsed.reviewWarnings.length, 1, `${prompt} ${JSON.stringify(parsed.reviewWarnings)}`);
    assert.equal(parsed.reviewWarnings[0].code, 'discrete-led-headroom', prompt);
    assert.ok(parsed.reviewWarnings[0].message.includes(resistor), parsed.reviewWarnings[0].message);
    assert.match(parsed.reviewWarnings[0].message, /68Ω/, prompt);
    if (headroom) {
      assert.match(parsed.reviewWarnings[0].message, /headroom is only/i, prompt);
    } else {
      assert.equal(/headroom is only/i.test(parsed.reviewWarnings[0].message), false, prompt);
    }
  }

  const boundary = parseDiscreteLedRequest('LED 68Ω on 5V');
  assert.equal(boundary.resistorValue, '68Ω');
  assert.equal(boundary.reviewBlockers.length, 0);
  assert.equal(boundary.reviewWarnings.length, 1);
  assert.equal(boundary.reviewWarnings[0].code, 'discrete-led-headroom');
  assert.match(boundary.reviewWarnings[0].message, /about 44mA, above 30mA/);
  assert.match(boundary.reviewWarnings[0].ko, /30mA를 넘/);
  assert.equal(boundary.reviewWarnings[0].message, boundary.reviewWarnings[0].en);
  assert.equal(/below 68Ω/i.test(boundary.reviewWarnings[0].message), false);
  assert.equal(/headroom is only/i.test(boundary.reviewWarnings[0].message), false);
});

test('quantity cap and RGB substitution notes include Korean', () => {
  const capped = parseDiscreteLedRequest('LED 10개');
  const capNote = capped.reviewNotes.find((note) => note.code === 'discrete-led-quantity-capped');
  assert.match(capNote.en, /capped at 8/);
  assert.match(capNote.ko, /8개까지/);
  assert.equal(capNote.message, capNote.ko);

  const rgb = parseDiscreteLedRequest('RGB LED를 5V에 연결해줘');
  const rgbNote = rgb.reviewNotes.find((note) => note.code === 'discrete-led-unsupported-rgb');
  assert.match(rgbNote.en, /simple indicator LED/);
  assert.match(rgbNote.ko, /단일/);
  assert.match(rgbNote.ko, /WS2812|어드레서블/);
  assert.equal(rgbNote.message, rgbNote.ko);

  const ws = parseDiscreteLedRequest('addressable WS2812 LED');
  const wsNote = ws.reviewNotes.find((note) => note.code === 'discrete-led-unsupported-rgb');
  assert.match(wsNote.ko, /WS2812|어드레서블/);
  assert.match(wsNote.en, /simple indicator LED/);
  assert.equal(wsNote.message, wsNote.en);
});

test('a specified forward voltage is used for the resistor and is never the supply', () => {
  const cases = [
    ['LED Vf 3V on 5V supply', 5, '+5V', false, '200Ω', '3'],
    ['LED Vf=2.1V on 3.3V', 3.3, '+3V3', false, '120Ω', '2.1'],
    ['LED 순방향 전압 3V, 전원 5V', 5, '+5V', false, '200Ω', '3'],
    ['LED Vf 3V', 5, '+5V', true, '200Ω', '3'],
    ['red LED Vf 3V on 5V', 5, '+5V', false, '200Ω', '3']
  ];
  for (const [prompt, volts, net, assumed, resistor, vf] of cases) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.ok(parsed, prompt);
    assert.equal(parsed.refused, false, `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
    assert.equal(parsed.supplyVolts, volts, prompt);
    assert.equal(parsed.supplyNet, net, prompt);
    assert.equal(parsed.supplyAssumed, assumed, prompt);
    assert.notEqual(parsed.supplyVolts, Number(vf), prompt);
    assert.equal(parsed.resistorValue, resistor, prompt);
    assert.equal(parsed.channels[0].vf, Number(vf), prompt);
    const english = parsed.reviewNotes.map((item) => item.en).join('\n');
    const korean = parsed.reviewNotes.map((item) => item.ko).join('\n');
    assert.match(english, new RegExp(`specified forward voltage of ${vf.replace('.', '\\.')}V`), prompt);
    assert.match(korean, new RegExp(`지정한 순방향 전압 ${vf.replace('.', '\\.')}V`), prompt);
    const active = parsed.reviewNotes.map((item) => item.message).join('\n');
    assert.equal(active, /[가-힣]/.test(prompt) ? korean : english, prompt);
  }

  const onlyForward = parseDiscreteLedRequest('LED Vf 12V');
  assert.equal(onlyForward.refused, true);
  assert.equal(onlyForward.supplyVolts, null);
  assert.notEqual(onlyForward.supplyVolts, 12);
  assert.equal(onlyForward.reviewBlockers[0].code, 'discrete-led-implausible-vf');
  assert.match(onlyForward.reviewBlockers[0].en, /forward voltage 12V is implausible/);
  assert.match(onlyForward.reviewBlockers[0].en, /0\.5V to 5V/);
  assert.match(onlyForward.reviewBlockers[0].ko, /순방향 전압 12V/);
  assert.equal(/not above/i.test(onlyForward.reviewBlockers[0].en), false);
  assert.equal(onlyForward.reviewBlockers[0].message, onlyForward.reviewBlockers[0].en);

  const highForward = parseDiscreteLedRequest('LED Vf 48V on 5V supply');
  assert.equal(highForward.refused, true);
  assert.equal(highForward.reviewBlockers[0].code, 'discrete-led-implausible-vf');
  assert.match(highForward.reviewBlockers[0].en, /forward voltage 48V is implausible/);
  assert.equal(/not above/i.test(highForward.reviewBlockers[0].en), false);
  assert.equal(/supply voltage/i.test(highForward.reviewBlockers[0].en), false);
  assert.equal(highForward.reviewBlockers[0].message, highForward.reviewBlockers[0].en);
});

test('a specified forward voltage drives the headroom check', () => {
  const eased = parseDiscreteLedRequest('white LED Vf 2V on 3.3V');
  assert.equal(eased.refused, false);
  assert.equal(eased.supplyVolts, 3.3);
  assert.equal(eased.resistorValue, '130Ω');
  assert.equal(eased.reviewWarnings.length, 0);
  assert.equal(eased.reviewBlockers.length, 0);

  const stillTight = parseDiscreteLedRequest('white LED on 3.3V');
  assert.equal(stillTight.reviewWarnings.length, 1);
  assert.match(stillTight.reviewWarnings[0].message, /0\.1V/);

  const unblocked = parseDiscreteLedRequest('blue LED Vf 2V on 3V');
  assert.equal(unblocked.refused, false);
  assert.equal(unblocked.resistorValue, '100Ω');
  assert.equal(unblocked.reviewBlockers.length, 0);

  const stillBlocked = parseDiscreteLedRequest('blue LED on 3V');
  assert.equal(stillBlocked.refused, true);
  assert.equal(stillBlocked.reviewBlockers[0].code, 'discrete-led-below-vf');

  const specifiedBlock = parseDiscreteLedRequest('red LED Vf 5V on 5V supply');
  assert.equal(specifiedBlock.supplyVolts, 5);
  assert.equal(specifiedBlock.refused, true);
  assert.equal(specifiedBlock.reviewBlockers[0].code, 'discrete-led-below-vf');
  assert.match(specifiedBlock.reviewBlockers[0].en, /specified forward voltage of 5V/);
  assert.match(specifiedBlock.reviewBlockers[0].ko, /지정한 순방향 전압 5V/);
  assert.match(specifiedBlock.reviewBlockers[0].en, /supply 5V is not above the specified forward voltage of 5V/);
  assert.equal(/typical red/i.test(specifiedBlock.reviewBlockers[0].en), false);
  assert.equal(specifiedBlock.reviewBlockers[0].message, specifiedBlock.reviewBlockers[0].en);
});

test('headroom, below-Vf, high-voltage, AC, and multiple-supply messages include Korean', () => {
  const headroom = parseDiscreteLedRequest('white LED on 3.3V');
  assert.match(headroom.reviewWarnings[0].ko, /여유 전압이 0\.1V뿐입니다\./);
  assert.match(headroom.reviewWarnings[0].ko, /직렬 저항/);
  assert.match(headroom.reviewWarnings[0].en, /headroom is only 0\.1V/);
  assert.equal(headroom.reviewWarnings[0].message, headroom.reviewWarnings[0].en);
  assert.equal(headroom.reviewWarnings[0].message.includes(headroom.reviewWarnings[0].ko), false);

  const below = parseDiscreteLedRequest('blue LED on 3V');
  assert.match(below.reviewBlockers[0].ko, /순방향/);
  assert.match(below.reviewBlockers[0].ko, /파란/);
  assert.match(below.reviewBlockers[0].en, /not above/i);
  assert.match(below.reviewBlockers[0].en, /supply 3V is not above LED Vf 3V/);
  assert.equal(below.reviewBlockers[0].message, below.reviewBlockers[0].en);

  const high = parseDiscreteLedRequest('LED at 48V');
  assert.match(high.reviewBlockers[0].ko, /고전압/);
  assert.match(high.reviewBlockers[0].en, /24V/);
  assert.equal(high.reviewBlockers[0].message, high.reviewBlockers[0].en);

  const ac = parseDiscreteLedRequest('LED 24 VAC');
  assert.match(ac.reviewBlockers[0].ko, /교류/);
  assert.match(ac.reviewBlockers[0].en, /supply is AC/i);
  assert.equal(ac.reviewBlockers[0].message, ac.reviewBlockers[0].en);

  const several = parseDiscreteLedRequest('LED 5V and 12V');
  assert.match(several.reviewBlockers[0].ko, /어떤 공급/);
  assert.match(several.reviewBlockers[0].ko, /5V와 12V/);
  assert.equal(several.reviewBlockers[0].ko.includes(' and '), false);
  assert.match(several.reviewBlockers[0].en, /which supply/i);
  assert.match(several.reviewBlockers[0].en, /5V and 12V/);
  assert.equal(several.reviewBlockers[0].message, several.reviewBlockers[0].en);
});

test('identical blocker, note, and warning sentences appear once in the review', () => {
  const prompts = ['blue LED on 3V', 'LED at 48V', 'LED 24 VAC', 'LED 5V and 12V', 'white LED on 3.3V'];
  for (const prompt of prompts) {
    const spec = applyDiscreteLedSpec(normalizeCircuitSpec(prompt));
    const review = reviewCircuitReadiness({ spec });
    const messages = [
      ...review.findings.blockers,
      ...review.findings.warnings,
      ...review.findings.notes
    ].map((finding) => finding.message);
    assert.equal(new Set(messages).size, messages.length, `${prompt} ${JSON.stringify(messages)}`);
  }
});

test('quantity tokenizer tags voltages, ranges, RKM, current, and counts', () => {
  const cases = [
    ['3.0-3.4V', [{ value: 3.4, unit: 'V', raw: '3.0-3.4V' }]],
    ['3.0–3.4V', [{ value: 3.4, unit: 'V', raw: '3.0–3.4V' }]],
    ['3.0—3.4V', [{ value: 3.4, unit: 'V', raw: '3.0—3.4V' }]],
    ['2.0～2.4V', [{ value: 2.4, unit: 'V', raw: '2.0~2.4V' }]],
    ['2.0〜2.4V', [{ value: 2.4, unit: 'V', raw: '2.0〜2.4V' }]],
    ['2.0~2.4V', [{ value: 2.4, unit: 'V', raw: '2.0~2.4V' }]],
    ['2.0 to 2.4 V', [{ value: 2.4, unit: 'V', raw: '2.0 to 2.4 V' }]],
    ['vf3.2v', [{ value: 3.2, unit: 'V', raw: '3.2v' }]],
    ['VF3.2V', [{ value: 3.2, unit: 'V', raw: '3.2V' }]],
    ['Vf3.2v', [{ value: 3.2, unit: 'V', raw: '3.2v' }]],
    ['Vf=3.2', [{ value: 3.2, unit: 'V', raw: '3.2' }]],
    ['Vf 3.2', [{ value: 3.2, unit: 'V', raw: '3.2' }]],
    ['2,0-2,4V', [{ value: 2.4, unit: 'V', raw: '2,0-2,4V' }]],
    ['3300mV', [{ value: 3.3, unit: 'mV', raw: '3300mV' }]],
    ['3300 mV', [{ value: 3.3, unit: 'mV', raw: '3300 mV' }]],
    ['2kV', [{ value: 2000, unit: 'kV', raw: '2kV' }]],
    ['2 kV', [{ value: 2000, unit: 'kV', raw: '2 kV' }]],
    ['7,4V', [{ value: 7.4, unit: 'V', raw: '7,4V' }]],
    ['3V3', [{ value: 3.3, unit: 'V', raw: '3V3' }]],
    ['5v0', [{ value: 5, unit: 'V', raw: '5v0' }]],
    ['12VAC', [{ value: 12, unit: 'VAC', raw: '12VAC' }]],
    ['12VDC', [{ value: 12, unit: 'VDC', raw: '12VDC' }]],
    ['24 VAC', [{ value: 24, unit: 'VAC', raw: '24 VAC' }]],
    ['4k7', [{ value: 4700, unit: 'ohm', raw: '4k7' }]],
    ['1R5', [{ value: 1.5, unit: 'ohm', raw: '1R5' }]],
    ['2M2', [{ value: 2_200_000, unit: 'ohm', raw: '2M2' }]],
    ['4.7k', [{ value: 4700, unit: 'ohm', raw: '4.7k' }]],
    ['330R', [{ value: 330, unit: 'ohm', raw: '330R' }]],
    ['1kR', [{ value: 1000, unit: 'ohm', raw: '1kR' }]],
    ['3 k', [{ value: 3000, unit: 'ohm', raw: '3 k' }]],
    ['20mA', [{ value: 20, unit: 'mA', raw: '20mA' }]],
    ['20 mA', [{ value: 20, unit: 'mA', raw: '20 mA' }]],
    ['20밀리암페어', [{ value: 20, unit: 'mA', raw: '20밀리암페어' }]],
    ['20 밀리암페어', [{ value: 20, unit: 'mA', raw: '20 밀리암페어' }]],
    ['20밀리 암페어', [{ value: 20, unit: 'mA', raw: '20밀리 암페어' }]],
    ['3 LEDs', [{ value: 3, unit: 'count', raw: '3 LEDs' }]],
    ['3개', [{ value: 3, unit: 'count', raw: '3개' }]],
    ['2 pcs', [{ value: 2, unit: 'count', raw: '2 pcs' }]],
    ['3ea', [{ value: 3, unit: 'count', raw: '3ea' }]],
    ['3 pc', [{ value: 3, unit: 'count', raw: '3 pc' }]],
    ['x3', [{ value: 3, unit: 'count', raw: 'x3' }]],
    ['×3', [{ value: 3, unit: 'count', raw: '×3' }]],
    ['3x', [{ value: 3, unit: 'count', raw: '3x' }]],
    ['3×', [{ value: 3, unit: 'count', raw: '3×' }]],
    ['LED 2.5개', [{ value: 2.5, unit: 'count', raw: '2.5개' }]],
    ['LED 2,5개', [{ value: 2.5, unit: 'count', raw: '2,5개' }]],
    ['LED -2개', [{ value: -2, unit: 'count', raw: '-2개' }]],
    ['LED 0 pcs', [{ value: 0, unit: 'count', raw: '0 pcs' }]],
    ['LED Vf 0', [{ value: 0, unit: 'V', raw: '0' }]],
    ['vf330Ω', [{ value: 330, unit: 'ohm', raw: '330Ω' }]],
    ['LED 5V 20mA 470', [
      { value: 5, unit: 'V', raw: '5V' },
      { value: 20, unit: 'mA', raw: '20mA' },
      { value: 470, unit: 'ohm', raw: '470' }
    ]],
    ['330Ω±5%', [
      { value: 330, unit: 'ohm', raw: '330Ω' },
      { value: 5, unit: '%', raw: '±5%' }
    ]],
    ['330Ω 5%', [
      { value: 330, unit: 'ohm', raw: '330Ω' },
      { value: 5, unit: '%', raw: '5%' }
    ]],
    ['330Ω ±1%', [
      { value: 330, unit: 'ohm', raw: '330Ω' },
      { value: 1, unit: '%', raw: '±1%' }
    ]],
    ['330 ohm ±5%', [
      { value: 330, unit: 'ohm', raw: '330 ohm' },
      { value: 5, unit: '%', raw: '±5%' }
    ]],
    ['4k7 5%', [
      { value: 4700, unit: 'ohm', raw: '4k7' },
      { value: 5, unit: '%', raw: '5%' }
    ]],
    ['R=2', [{ value: 2, unit: 'ohm', raw: 'R=2' }]],
    ['R 2', [{ value: 2, unit: 'ohm', raw: 'R 2' }]],
    ['R1=330', [{ value: 330, unit: 'ohm', raw: 'R1=330' }]],
    ['R1 330', [{ value: 330, unit: 'ohm', raw: 'R1 330' }]],
    ['R47', [{ value: 0.47, unit: 'ohm', raw: 'R47' }]],
    ['0R', [{ value: 0, unit: 'ohm', raw: '0R' }]],
    ['0Ω', [{ value: 0, unit: 'ohm', raw: '0Ω' }]],
    ['0 ohm', [{ value: 0, unit: 'ohm', raw: '0 ohm' }]],
    ['0.5Ω', [{ value: 0.5, unit: 'ohm', raw: '0.5Ω' }]],
    ['LEDx3', [{ value: 3, unit: 'count', raw: 'LEDx3' }]],
    ['LED×3', [{ value: 3, unit: 'count', raw: 'LED×3' }]],
    ['two pcs', [{ value: 2, unit: 'count', raw: 'two pcs' }]],
    ['LED two pcs', [{ value: 2, unit: 'count', raw: 'two pcs' }]],
    ['three LEDs', [{ value: 3, unit: 'count', raw: 'three LEDs' }]],
    ['three red LEDs', [{ value: 3, unit: 'count', raw: 'three red LEDs' }]],
    ['three red and green LEDs', [{ value: 3, unit: 'count', raw: 'three red and green LEDs' }]],
    ['eight LEDs', [{ value: 8, unit: 'count', raw: 'eight LEDs' }]],
    ['twelve LEDs', [{ value: 12, unit: 'count', raw: 'twelve LEDs' }]],
    ['세 개의 LED', [{ value: 3, unit: 'count', raw: '세 개' }]],
    ['LED 세 개', [{ value: 3, unit: 'count', raw: '세 개' }]],
    ['LED 세개', [{ value: 3, unit: 'count', raw: '세개' }]],
    ['다섯 개의 LED', [{ value: 5, unit: 'count', raw: '다섯 개' }]],
    ['2.5 LEDs', [{ value: 2.5, unit: 'count', raw: '2.5 LEDs' }]],
    ['two and a half LEDs', [{ value: 2.5, unit: 'count', raw: 'two and a half LEDs' }]],
    ['-20mA', [{ value: -20, unit: 'mA', raw: '-20mA' }]],
    ['0mA', [{ value: 0, unit: 'mA', raw: '0mA' }]],
    ['2,5 LEDs', [{ value: 2.5, unit: 'count', raw: '2,5 LEDs' }]],
    ['2.5 pcs LED', [{ value: 2.5, unit: 'count', raw: '2.5 pcs' }]],
    ['LED ２개 5V', [
      { value: 2, unit: 'count', raw: '2개' },
      { value: 5, unit: 'V', raw: '5V' }
    ]],
    ['LED ３３０Ω 5V', [
      { value: 330, unit: 'ohm', raw: '330Ω' },
      { value: 5, unit: 'V', raw: '5V' }
    ]]
  ];
  for (const [prompt, expected] of cases) {
    const { tokens, unparseable } = tokenizeQuantities(prompt);
    assert.equal(unparseable, false, prompt);
    assert.equal(tokens.length, expected.length, `${prompt} ${JSON.stringify(tokens)}`);
    expected.forEach((item, index) => {
      const token = tokens[index];
      assert.equal(token.value, item.value, `${prompt} [${index}]`);
      assert.equal(token.unit, item.unit, `${prompt} [${index}] ${token.raw}`);
      assert.equal(token.raw, item.raw, prompt);
      assert.equal(prompt.normalize('NFKC').slice(token.start, token.end), token.raw, prompt);
      assert.equal(typeof token.start, 'number', prompt);
      assert.ok(token.end > token.start, prompt);
    });
  }

  for (const [prompt, min, max] of [
    ['Vf 3.0-3.4V', 3, 3.4],
    ['3.0–3.4V', 3, 3.4],
    ['3.0—3.4V', 3, 3.4],
    ['2.0～2.4V', 2, 2.4],
    ['2.0〜2.4V', 2, 2.4]
  ]) {
    const token = tokenizeQuantities(prompt).tokens[0];
    assert.deepEqual(token.range, { min, max }, prompt);
    assert.equal(token.value, max, prompt);
  }
  assert.equal(tokenizeQuantities('LED 5Vrms').unparseable, true);
  assert.equal(tokenizeQuantities('LED 3,3,3V').unparseable, true);
  assert.equal(tokenizeQuantities('LED on volts').unparseable, true);
  assert.equal(tokenizeQuantities('12V AC').tokens[0].ac, true);
  assert.equal(tokenizeQuantities('5 V DC').tokens[0].dc, true);
  assert.equal(tokenizeQuantities('12VDC').tokens[0].dc, true);
  assert.equal(tokenizeQuantities('12VDC').tokens[0].ac, false);
});

test('quantity classification is order-independent inside a small window', () => {
  const cases = [
    ['LED Vf 3.0-3.4V at 5V', [
      ['3.0-3.4V', 'vf'],
      ['5V', 'supply']
    ]],
    ['LED Vf 2.0~2.4V 5V', [
      ['2.0~2.4V', 'vf'],
      ['5V', 'voltage']
    ]],
    ['5V Vf 3.2V', [
      ['5V', 'voltage'],
      ['3.2V', 'vf']
    ]],
    ['Vf 3.2V 5V', [
      ['3.2V', 'vf'],
      ['5V', 'voltage']
    ]],
    ['5V 순방향 전압 2V', [
      ['5V', 'voltage'],
      ['2V', 'vf']
    ]],
    ['순방향 전압 2V, 전원 5V', [
      ['2V', 'vf'],
      ['5V', 'supply']
    ]],
    ['white LED on 5V, Vf 3.2V', [
      ['5V', 'supply'],
      ['3.2V', 'vf']
    ]],
    ['LED 2V forward, 12V supply', [
      ['2V', 'vf'],
      ['12V', 'supply']
    ]],
    ['LED 5V forward voltage 3.2V', [
      ['5V', 'voltage'],
      ['3.2V', 'vf']
    ]],
    ['LED 5V forward voltage of 3.2V', [
      ['5V', 'voltage'],
      ['3.2V', 'vf']
    ]],
    ['LED 5V Vf 3.2V', [
      ['5V', 'voltage'],
      ['3.2V', 'vf']
    ]],
    ['LED 5V Vf=3.2V', [
      ['5V', 'voltage'],
      ['3.2V', 'vf']
    ]],
    ['LED 5V Vf=3.2', [
      ['5V', 'voltage'],
      ['3.2', 'vf']
    ]],
    ['LED 5V Vf 3.2', [
      ['5V', 'voltage'],
      ['3.2', 'vf']
    ]],
    ['LED 5V vf3.2v', [
      ['5V', 'voltage'],
      ['3.2v', 'vf']
    ]],
    ['LED 5V VF3.2V', [
      ['5V', 'voltage'],
      ['3.2V', 'vf']
    ]],
    ['LED Vf=3.2', [
      ['3.2', 'vf']
    ]],
    ['LED 5V 순방향 전압 2.2V', [
      ['5V', 'voltage'],
      ['2.2V', 'vf']
    ]],
    ['LED 1.8V red at 9V', [
      ['1.8V', 'voltage'],
      ['9V', 'supply']
    ]],
    ['LED Vf 2V on 5V supply', [
      ['2V', 'vf'],
      ['5V', 'supply']
    ]],
    ['LED 1R5 on 5V', [
      ['1R5', 'resistor'],
      ['5V', 'supply']
    ]],
    ['LED 4k7', [
      ['4k7', 'resistor']
    ]],
    ['LED 5V 20mA 470', [
      ['5V', 'voltage'],
      ['20mA', 'current'],
      ['470', 'resistor']
    ]],
    ['5V 3 LEDs', [
      ['5V', 'voltage'],
      ['3 LEDs', 'count']
    ]],
    ['LED 2 pcs', [
      ['2 pcs', 'count']
    ]],
    ['LED ×3 5V', [
      ['×3', 'count'],
      ['5V', 'voltage']
    ]],
    ['LED x3', [
      ['x3', 'count']
    ]],
    ['LED Vf 0', [
      ['0', 'vf']
    ]],
    ['LED Vf 330Ω', [
      ['330Ω', 'resistor']
    ]],
    ['LED 5V Vf 330Ω', [
      ['5V', 'voltage'],
      ['330Ω', 'resistor']
    ]],
    ['LED vf330Ω 5V', [
      ['330Ω', 'resistor'],
      ['5V', 'voltage']
    ]],
    ['10k pot, LED, 5V', [
      ['5V', 'voltage']
    ]],
    ['LED 330 and 4k7 on 5V', [
      ['330', 'resistor'],
      ['4k7', 'resistor'],
      ['5V', 'supply']
    ]],
    ['LED 5V 330Ω±5%', [
      ['5V', 'voltage'],
      ['330Ω', 'resistor']
    ]],
    ['LED 5V R=2', [
      ['5V', 'voltage'],
      ['R=2', 'resistor']
    ]],
    ['LED R1=330', [
      ['R1=330', 'resistor']
    ]],
    ['LEDx3', [
      ['LEDx3', 'count']
    ]],
    ['LED×3', [
      ['LED×3', 'count']
    ]],
    ['LED two pcs', [
      ['two pcs', 'count']
    ]],
    ['two pcs LED', [
      ['two pcs', 'count']
    ]],
    ['three LEDs on 5V', [
      ['three LEDs', 'count'],
      ['5V', 'supply']
    ]],
    ['three red and green LEDs', [
      ['three red and green LEDs', 'count']
    ]],
    ['세 개의 LED', [
      ['세 개', 'count']
    ]],
    ['LED 세 개 5V', [
      ['세 개', 'count'],
      ['5V', 'voltage']
    ]],
    ['2.5 LEDs on 5V', [
      ['2.5 LEDs', 'count'],
      ['5V', 'supply']
    ]],
    ['2,5 LEDs on 5V', [
      ['2,5 LEDs', 'count'],
      ['5V', 'supply']
    ]],
    ['LED 5V 20mA', [
      ['5V', 'voltage'],
      ['20mA', 'current']
    ]],
    ['LED 5V Vf 2V 15 mA', [
      ['5V', 'voltage'],
      ['2V', 'vf'],
      ['15 mA', 'current']
    ]],
    ['LED 5V 20밀리암페어', [
      ['5V', 'voltage'],
      ['20밀리암페어', 'current']
    ]]
  ];
  for (const [prompt, expected] of cases) {
    const { tokens } = classifyQuantities(prompt);
    const roles = tokens
      .filter((token) => token.role)
      .map((token) => [token.raw, token.role]);
    assert.deepEqual(roles, expected, `${prompt} ${JSON.stringify(roles)}`);
  }

  const swapped = classifyQuantities('5V 순방향 전압 2V').tokens;
  assert.equal(swapped.find((token) => token.raw === '2V').role, 'vf');
  assert.notEqual(swapped.find((token) => token.raw === '5V').role, 'vf');
  assert.equal(promptDescribesAcSupply('LED on DC/AC converter 5V output', classifyQuantities('LED on DC/AC converter 5V output').tokens), false);
  assert.equal(promptDescribesAcSupply('AC adapter outputting 12VDC', classifyQuantities('AC adapter outputting 12VDC').tokens), false);
  assert.equal(promptDescribesAcSupply('LED 12VAC', classifyQuantities('LED 12VAC').tokens), true);
  assert.equal(promptDescribesAcSupply('AC 전원 LED', classifyQuantities('AC 전원 LED').tokens), true);
  assert.equal(promptDescribesAcSupply('LED AC supply', classifyQuantities('LED AC supply').tokens), true);
});

test('a forward-voltage range is not a resistor and uses its maximum', () => {
  const cases = [
    ['LED Vf 3.0-3.4V at 5V', 5, '+5V', 3.4, false, 160, '160Ω', '3.0-3.4V'],
    ['LED Vf 3.0–3.4V at 5V', 5, '+5V', 3.4, false, 160, '160Ω', '3.0–3.4V'],
    ['LED Vf 3.0—3.4V at 5V', 5, '+5V', 3.4, false, 160, '160Ω', '3.0—3.4V'],
    ['LED Vf 2.0～2.4V 5V', 5, '+5V', 2.4, false, 270, '270Ω', '2.0~2.4V'],
    ['LED Vf 2.0〜2.4V 5V', 5, '+5V', 2.4, false, 270, '270Ω', '2.0〜2.4V'],
    ['LED Vf 2.0~2.4V 5V', 5, '+5V', 2.4, false, 270, '270Ω', '2.0~2.4V'],
    ['LED Vf 2.0 to 2.4 V at 5V', 5, '+5V', 2.4, false, 270, '270Ω', '2.0 to 2.4 V'],
    ['blue LED Vf 3.0-3.4V on 5V', 5, '+5V', 3.4, false, 160, '160Ω', '3.0-3.4V']
  ];
  for (const [prompt, volts, net, vf, explicit, ohms, resistor, raw] of cases) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.ok(parsed, prompt);
    assert.equal(parsed.refused, false, `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
    assert.equal(parsed.supplyVolts, volts, prompt);
    assert.equal(parsed.supplyNet, net, prompt);
    assert.equal(parsed.specifiedVf, vf, prompt);
    assert.equal(parsed.channels[0].vf, vf, prompt);
    assert.equal(parsed.resistorExplicit, explicit, prompt);
    assert.notEqual(parsed.resistanceOhms, Math.floor(vf), prompt);
    assert.equal(parsed.resistanceOhms, ohms, prompt);
    assert.equal(parsed.resistorValue, resistor, prompt);
    const english = parsed.reviewNotes.map((item) => item.en).join('\n');
    const korean = parsed.reviewNotes.map((item) => item.ko).join('\n');
    assert.match(english, /uses the maximum/, prompt);
    assert.match(english, /conservative/, prompt);
    assert.match(korean, /상한/, prompt);
    assert.match(korean, /보수적/, prompt);
    assert.match(english, new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), prompt);
    assert.equal(korean.includes(' to '), false, korean);
    assert.equal(parsed.reviewNotes.filter((item) => item.code === 'discrete-led-vf-range').length, 1, prompt);
  }
});

test('a specified forward voltage beats the color default in either order', () => {
  const cases = [
    ['파란 LED 2개 5V Vf 3.2V', 5, false, 3.2, '180Ω', 2],
    ['blue LED 5V Vf 3.2V', 5, false, 3.2, '180Ω', 1],
    ['LED 2개 5V Vf 3.2V', 5, false, 3.2, '180Ω', 2],
    ['white LED on 5V, Vf 3.2V', 5, false, 3.2, '180Ω', 1],
    ['LED Vf=3.2V 5V', 5, false, 3.2, '180Ω', 1],
    ['LED Vf=3.2', 5, true, 3.2, '180Ω', 1],
    ['LED Vf 3.2', 5, true, 3.2, '180Ω', 1],
    ['LED 5V Vf=3.2', 5, false, 3.2, '180Ω', 1],
    ['LED 5V Vf 3.2', 5, false, 3.2, '180Ω', 1],
    ['LED 5V vf3.2v', 5, false, 3.2, '180Ω', 1],
    ['LED 5V VF3.2V', 5, false, 3.2, '180Ω', 1],
    ['LED 5V Vf3.2v', 5, false, 3.2, '180Ω', 1],
    ['blue LED 5V vf3.2v', 5, false, 3.2, '180Ω', 1],
    ['LED 5 V, Vf 2.2 V', 5, false, 2.2, '300Ω', 1],
    ['LED Vf 3200mV', 5, true, 3.2, '180Ω', 1],
    ['LED 5V 순방향 전압 2V', 5, false, 2, '300Ω', 1],
    ['LED 5V forward voltage 3.2V', 5, false, 3.2, '180Ω', 1],
    ['LED 5V forward voltage of 3.2V', 5, false, 3.2, '180Ω', 1],
    ['LED 5V Vf=3.2V', 5, false, 3.2, '180Ω', 1],
    ['LED 5V 순방향 전압 2.2V', 5, false, 2.2, '300Ω', 1],
    ['5V 순방향 전압 2V LED', 5, false, 2, '300Ω', 1],
    ['LED Vf 3.2V 5V', 5, false, 3.2, '180Ω', 1]
  ];
  for (const [prompt, volts, assumed, vf, resistor, count] of cases) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.ok(parsed, prompt);
    assert.equal(parsed.refused, false, `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
    assert.equal(parsed.supplyVolts, volts, prompt);
    assert.equal(parsed.supplyAssumed, assumed, prompt);
    assert.equal(parsed.specifiedVf, vf, prompt);
    assert.equal(parsed.channels[0].vf, vf, prompt);
    assert.equal(parsed.count, count, prompt);
    assert.equal(parsed.resistorValue, resistor, prompt);
    assert.equal(parsed.resistorExplicit, false, prompt);
    const english = parsed.reviewNotes.map((item) => item.en).join('\n');
    const korean = parsed.reviewNotes.map((item) => item.ko).join('\n');
    assert.match(english, new RegExp(`specified forward voltage of ${String(vf).replace('.', '\\.')}V`), prompt);
    assert.match(korean, new RegExp(`지정한 순방향 전압 ${String(vf).replace('.', '\\.')}V`), prompt);
    assert.equal(
      parsed.reviewNotes.map((item) => item.message).join('\n'),
      /[가-힣]/.test(prompt) ? korean : english,
      prompt
    );
  }

  const colorDefault = parseDiscreteLedRequest('LED 1.8V red at 9V');
  assert.equal(colorDefault.supplyVolts, 9);
  assert.equal(colorDefault.specifiedVf, null);
  assert.equal(colorDefault.channels[0].vf, 2);
  assert.equal(colorDefault.resistorValue, '750Ω');

  const kept = [
    ['5V LED 330', 330, '330Ω'],
    ['LED 3 k', 3000, '3kΩ'],
    ['LED 4k7 on 5V', 4700, '4.7kΩ'],
    ['LED 1R5 on 5V', 1.5, '1.5Ω'],
    ['LED 2M2 on 5V', 2_200_000, '2.2MΩ']
  ];
  for (const [prompt, ohms, label] of kept) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.equal(parsed.resistorExplicit, true, prompt);
    assert.equal(parsed.resistanceOhms, ohms, prompt);
    assert.equal(parsed.resistorValue, label, prompt);
  }
  const high = parseDiscreteLedRequest('LED 230V');
  assert.equal(high.refused, true);
  assert.equal(high.supplyVolts, 230);
  assert.equal(high.reviewBlockers[0].code, 'discrete-led-high-voltage');
});

test('AC is refused only when it describes the supply', () => {
  const accepted = [
    ['LED on DC/AC converter 5V output', 5, '+5V'],
    ['LED on AC/DC converter 5V output', 5, '+5V'],
    ['LED DC/AC converter 12V', 12, '+12V'],
    ['AC adapter outputting 12VDC LED', 12, '+12V'],
    ['LED on an AC adapter outputting 12VDC', 12, '+12V'],
    ['ACT LED 5V', 5, '+5V']
  ];
  for (const [prompt, volts, net] of accepted) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.ok(parsed, prompt);
    assert.equal(parsed.refused, false, `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
    assert.equal(parsed.supplyVolts, volts, prompt);
    assert.equal(parsed.supplyNet, net, prompt);
    assert.equal(parsed.reviewBlockers.some((item) => item.code === 'discrete-led-ac-supply'), false, prompt);
  }

  const refused = [
    ['LED 12VAC', 12],
    ['12VAC LED', 12],
    ['LED 12V AC', 12],
    ['LED AC 전원', null],
    ['AC 전원 LED', null],
    ['LED AC supply', null],
    ['AC supply LED', null],
    ['LED on a 5V AC adapter', 5]
  ];
  for (const [prompt, volts] of refused) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.ok(parsed, prompt);
    assert.equal(parsed.refused, true, prompt);
    assert.equal(parsed.reviewBlockers[0]?.code, 'discrete-led-ac-supply', `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
    assert.match(parsed.reviewBlockers[0].en, /supply is AC/i, prompt);
    assert.match(parsed.reviewBlockers[0].ko, /교류/, prompt);
    assert.equal(parsed.reviewBlockers[0].message, /[가-힣]/.test(prompt) ? parsed.reviewBlockers[0].ko : parsed.reviewBlockers[0].en, prompt);
    if (volts == null) assert.equal(parsed.supplyVolts, null, prompt);
    else assert.equal(parsed.supplyVolts, volts, prompt);
  }
});

test('LED current above 30mA reuses the headroom warning', () => {
  const cases = [
    ['red LED 1R5 on 5V', '1.5Ω', /about 2A, above 30mA/, /68Ω/, false],
    ['5V red LED 1R5', '1.5Ω', /about 2A, above 30mA/, /68Ω/, false],
    ['LED 1R5 3V', '1.5Ω', /about 667mA, above 30mA/, /68Ω/, false],
    ['LED 5V 40mA', '75Ω', /requested current 40mA is above 30mA/, null, false],
    ['LED 5V 50 mA', '62Ω', /requested current 50mA is above 30mA/, /68Ω/, false],
    ['LED 68Ω on 5V', '68Ω', /about 44mA, above 30mA/, null, false]
  ];
  for (const [prompt, resistor, current, tiny, headroom] of cases) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.ok(parsed, prompt);
    assert.equal(parsed.refused, false, prompt);
    assert.equal(parsed.resistorValue, resistor, prompt);
    assert.equal(parsed.reviewWarnings.length, 1, `${prompt} ${JSON.stringify(parsed.reviewWarnings)}`);
    assert.equal(parsed.reviewWarnings[0].code, 'discrete-led-headroom', prompt);
    assert.match(parsed.reviewWarnings[0].en, current, parsed.reviewWarnings[0].en);
    assert.match(parsed.reviewWarnings[0].message, current, parsed.reviewWarnings[0].message);
    assert.match(parsed.reviewWarnings[0].ko, /30mA를 넘/, prompt);
    assert.match(parsed.reviewWarnings[0].en, /Confirm the LED current/, prompt);
    if (tiny) assert.match(parsed.reviewWarnings[0].message, tiny, prompt);
    else assert.equal(/below 68Ω/i.test(parsed.reviewWarnings[0].message), false, prompt);
    if (headroom) assert.match(parsed.reviewWarnings[0].message, /headroom is only/i, prompt);
    else assert.equal(/headroom is only/i.test(parsed.reviewWarnings[0].message), false, prompt);
  }

  const quiet = parseDiscreteLedRequest('LED 5V 20mA');
  assert.equal(quiet.resistorValue, '150Ω');
  assert.equal(quiet.resistanceOhms, 150);
  assert.equal(quiet.resistorExplicit, false);
  assert.equal(quiet.requestedCurrentMa, 20);
  assert.match(quiet.calculation.summary.en, /\/ 20mA = 150Ω/);
  assert.equal(/10mA/.test(quiet.calculation.summary.en), false);
  assert.equal(quiet.reviewWarnings.length, 0);
  assert.equal(quiet.reviewBlockers.length, 0);

  const fifteen = parseDiscreteLedRequest('LED 5V Vf 2V 15 mA');
  assert.equal(fifteen.refused, false);
  assert.equal(fifteen.specifiedVf, 2);
  assert.equal(fifteen.requestedCurrentMa, 15);
  assert.equal(fifteen.resistanceOhms, 200);
  assert.equal(fifteen.resistorValue, '200Ω');
  assert.match(fifteen.calculation.summary.en, /\(5V - 2V\) \/ 15mA = 200Ω/);
  assert.match(fifteen.calculation.summary.en, /specified forward voltage of 2V/);
  assert.equal(fifteen.reviewWarnings.length, 0);

  const koreanCurrent = parseDiscreteLedRequest('LED 5V 20밀리암페어');
  assert.equal(koreanCurrent.refused, false, JSON.stringify(koreanCurrent.reviewBlockers));
  assert.equal(koreanCurrent.resistorExplicit, false);
  assert.equal(koreanCurrent.requestedCurrentMa, 20);
  assert.equal(koreanCurrent.resistanceOhms, 150);
  assert.equal(koreanCurrent.resistorValue, '150Ω');
  assert.match(koreanCurrent.calculation.summary.ko, /20mA/);
  assert.equal(/10mA/.test(koreanCurrent.calculation.summary.ko), false);
  const koreanNote = koreanCurrent.reviewNotes.find((note) => note.code === 'discrete-led');
  assert.equal(koreanNote.message, koreanNote.ko);

  const hotCurrent = parseDiscreteLedRequest('LED 5V 40mA');
  assert.equal(hotCurrent.refused, false);
  assert.equal(hotCurrent.resistanceOhms, 75);
  assert.equal(hotCurrent.resistorValue, '75Ω');
  assert.match(hotCurrent.calculation.summary.en, /\(5V - 2V\) \/ 40mA = 75Ω/);
  assert.equal(hotCurrent.reviewWarnings.length, 1);
  assert.match(hotCurrent.reviewWarnings[0].en, /requested current 40mA is above 30mA/);
  assert.match(hotCurrent.reviewWarnings[0].ko, /30mA를 넘/);
  assert.equal(hotCurrent.reviewWarnings[0].message, hotCurrent.reviewWarnings[0].en);

  const plainDraft = reviewCircuitReadiness({
    spec: applyDiscreteLedSpec(normalizeCircuitSpec('LED'))
  }).findings.warnings.find((item) => item.code === 'discrete-led-draft');
  assert.match(plainDraft.en, /assume 10mA/);

  const sizedDraft = reviewCircuitReadiness({
    spec: applyDiscreteLedSpec(normalizeCircuitSpec('LED 5V 20mA'))
  }).findings.warnings.find((item) => item.code === 'discrete-led-draft');
  assert.match(sizedDraft.en, /specified 20mA/);
  assert.equal(/assume 10mA/.test(sizedDraft.en), false);
  assert.match(sizedDraft.ko, /지정한 20mA/);
  assert.equal(sizedDraft.message, sizedDraft.en);

  const koreanDraft = reviewCircuitReadiness({
    spec: applyDiscreteLedSpec(normalizeCircuitSpec('LED 5V 20밀리암페어'))
  }).findings.warnings.find((item) => item.code === 'discrete-led-draft');
  assert.equal(koreanDraft.message, koreanDraft.ko);
  assert.match(koreanDraft.ko, /지정한 20mA/);
  assert.equal(/10mA와/.test(koreanDraft.ko), false);
});

test('every discrete LED message is one language and Korean has no English words', () => {
  const prompts = [
    'LED 5Vrms',
    'LED 0V',
    'LED -5V',
    'LED at 48V',
    'LED 24 VAC',
    'LED 교류',
    'LED 5V and 12V',
    'LED 5V, 9V, and 12V',
    'red LED on 1.8V',
    'LED Vf 4V on 3V',
    'red LED on 5V',
    'red LED with a 330 ohm resistor on 5V',
    'red and green LEDs on 5V',
    'LED 10개',
    'LED 2 5V',
    'LED 2.5개',
    '2.5 LEDs on 5V',
    '2,5 LEDs on 5V',
    '2.5 pcs LED',
    'LED 5V 20mA',
    'LED 5V Vf 2V 15 mA',
    'LED 5V 40mA',
    'LED 5V 20밀리암페어',
    '5050 LED 5V',
    '5050 엘이디 5V',
    'SMD 0603 LED',
    'LED 5V 0mA',
    'LED 5V -20mA',
    '엘이디 5V 0mA',
    'two and a half LEDs',
    'LED 330 and 4k7 on 5V',
    'LED 5V 330 470',
    'LED 5V 330Ω 470Ω',
    'LED 12',
    'LED 24',
    'LED 5V 2025년',
    'LED 5V pin 13',
    'LED 5V 0805',
    'LED 5V 500mA',
    '엘이디 5V 500mA',
    'LED 5V 20mA 330Ω',
    '엘이디 5V 20mA 330Ω',
    'LED 5V 20uA',
    'LED 0 pcs',
    'LED 0Ω',
    '엘이디 0Ω',
    'LED Vf 0',
    'LED',
    '빨간 LED',
    'RGB LED on 5V',
    'PWM LED on 5V',
    'LED strip 12V',
    '10k pot, LED, 5V',
    'three red and green LEDs',
    'LED Vf 3.0-3.4V at 5V',
    'LED Vf 2.0 to 2.4 V at 5V',
    'LED Vf=330',
    '엘이디 Vf=0.4',
    'LED 3.0\u20135V',
    '엘이디 3.0\u20135V',
    'white LED on 3.3V',
    '빨간 LED를 5V에 연결해줘',
    'LED 5V forward voltage 3.2V',
    'LED 5V 순방향 전압 2.2V',
    `LED ${'x'.repeat(4100)}`
  ];
  const seen = new Set();
  for (const prompt of prompts) {
    const spec = applyDiscreteLedSpec(normalizeCircuitSpec(prompt));
    assert.equal(spec.kind, 'discrete-led', prompt);
    const review = reviewCircuitReadiness({ spec });
    const findings = [
      ...(spec.discrete?.reviewBlockers ?? []),
      ...(spec.discrete?.reviewNotes ?? []),
      ...(spec.discrete?.reviewWarnings ?? []),
      ...review.findings.blockers,
      ...review.findings.warnings,
      ...review.findings.notes
    ];
    for (const finding of findings) {
      if (!String(finding.code).startsWith('discrete-led') && finding.code !== 'validation-needed') continue;
      seen.add(finding.code);
      assert.equal(typeof finding.en, 'string', `${prompt} ${finding.code}`);
      assert.equal(typeof finding.ko, 'string', `${prompt} ${finding.code} ${JSON.stringify(finding)}`);
      assert.match(finding.en, /\.$/, `${finding.code} ${finding.en}`);
      assert.match(finding.ko, /\.$/, `${finding.code} ${finding.ko}`);
      assert.deepEqual(strayKoreanAscii(finding.ko), [], `${finding.code} ${finding.ko}`);
      const korean = /[가-힣]/.test(prompt);
      assert.equal(finding.message, korean ? finding.ko : finding.en, `${prompt} ${finding.code}`);
      assert.equal(finding.message.includes(korean ? finding.en : finding.ko), false, `${prompt} ${finding.message}`);
    }
  }
  for (const code of [
    'discrete-led-invalid-voltage',
    'discrete-led-high-voltage',
    'discrete-led-ac-supply',
    'discrete-led-ambiguous-supply',
    'discrete-led-below-vf',
    'discrete-led-implausible-vf',
    'discrete-led-ambiguous-range',
    'discrete-led-ambiguous-number',
    'discrete-led-ambiguous-resistor',
    'discrete-led-invalid-count',
    'discrete-led-resistor-too-small',
    'discrete-led',
    'discrete-led-red',
    'discrete-led-green',
    'discrete-led-quantity-capped',
    'discrete-led-supply-assumed',
    'discrete-led-unsupported-rgb',
    'discrete-led-unsupported-pwm',
    'discrete-led-unsupported-strip',
    'discrete-led-unsupported-pot',
    'discrete-led-unsupported-mixed-color',
    'discrete-led-vf-range',
    'discrete-led-headroom',
    'discrete-led-draft',
    'discrete-led-prompt-too-long',
    'validation-needed'
  ]) {
    assert.equal(seen.has(code), true, `${code} missing from ${[...seen].sort().join(', ')}`);
  }

  const below = parseDiscreteLedRequest('red LED on 1.8V').reviewBlockers[0];
  assert.match(below.en, /supply 1\.8V is not above LED Vf 2V/);
  assert.equal(below.en.includes('supply 2V is not above LED Vf 1.8V'), false);
  assert.match(below.ko, /공급 전압 1\.8V가 빨간 LED의 일반적인 순방향 전압 2V보다/);
  const specified = parseDiscreteLedRequest('LED Vf 4V on 3V').reviewBlockers[0];
  assert.match(specified.en, /supply 3V is not above the specified forward voltage of 4V/);
  assert.match(specified.ko, /공급 전압 3V가 지정한 순방향 전압 4V보다/);
  assert.equal(specified.en.includes('supply 4V is not above'), false);

  const forward = parseDiscreteLedRequest('LED 5V forward voltage 3.2V');
  assert.equal(forward.refused, false);
  assert.equal(forward.supplyVolts, 5);
  assert.equal(forward.specifiedVf, 3.2);
  assert.equal(forward.resistorValue, '180Ω');
  const koreanForward = parseDiscreteLedRequest('LED 5V 순방향 전압 2.2V');
  assert.equal(koreanForward.refused, false);
  assert.equal(koreanForward.supplyVolts, 5);
  assert.equal(koreanForward.specifiedVf, 2.2);
  assert.equal(koreanForward.resistorValue, '300Ω');
});

test('unitless Vf is volts only when labeled Vf and between 0.5 and 5', () => {
  const volts = [
    ['LED Vf=0.5', 5, true, 0.5, '470Ω'],
    ['LED Vf=5 12V', 12, false, 5, '750Ω'],
    ['LED Vf=2 5V', 5, false, 2, '300Ω'],
    ['LED vf=3.2', 5, true, 3.2, '180Ω'],
    ['LED VF 3.2', 5, true, 3.2, '180Ω'],
    ['LED Vf:3.2', 5, true, 3.2, '180Ω'],
    ['red LED Vf=3.2 on 5V', 5, false, 3.2, '180Ω']
  ];
  for (const [prompt, supply, assumed, vf, resistor] of volts) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.ok(parsed, prompt);
    assert.equal(parsed.refused, false, `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
    assert.equal(parsed.supplyVolts, supply, prompt);
    assert.equal(parsed.supplyAssumed, assumed, prompt);
    assert.equal(parsed.specifiedVf, vf, prompt);
    assert.equal(parsed.resistorExplicit, false, prompt);
    assert.equal(parsed.resistorValue, resistor, prompt);
  }

  const atSupply = parseDiscreteLedRequest('LED Vf=5');
  assert.equal(atSupply.refused, true);
  assert.equal(atSupply.reviewBlockers[0].code, 'discrete-led-below-vf');
  assert.match(atSupply.reviewBlockers[0].en, /specified forward voltage of 5V/);
  assert.equal(atSupply.resistanceOhms, null);

  for (const prompt of ['LED 5V 3.2', 'LED forward voltage 3.2']) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.ok(parsed, prompt);
    assert.equal(parsed.refused, true, `${prompt} drafted ${parsed.resistorValue}`);
    assert.equal(parsed.specifiedVf ?? null, null, prompt);
    assert.equal(parsed.resistorExplicit, false, prompt);
    assert.equal(parsed.resistanceOhms, null, prompt);
    assert.equal(parsed.reviewBlockers[0].code, 'discrete-led-ambiguous-number', prompt);
  }

});

test('an em dash separates a forward-voltage range and a Vf value the way an en dash does', () => {
  const range = parseDiscreteLedRequest('LED Vf 3.0\u20143.4V at 5V');
  assert.equal(range.refused, false, JSON.stringify(range.reviewBlockers));
  assert.equal(range.supplyVolts, 5);
  assert.equal(range.specifiedVf, 3.4);
  assert.equal(range.resistorValue, '160Ω');
  assert.equal(range.reviewNotes.some((note) => note.code === 'discrete-led-vf-range'), true);

  for (const prompt of ['LED Vf\u20143.2V 5V', 'LED Vf\u20133.2V 5V']) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.equal(parsed.refused, false, `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
    assert.equal(parsed.reviewBlockers.some((item) => item.code === 'discrete-led-ambiguous-supply'), false, prompt);
    assert.equal(parsed.supplyVolts, 5, prompt);
    assert.equal(parsed.specifiedVf, 3.2, prompt);
    assert.equal(parsed.resistorValue, '180Ω', prompt);
    const roles = classifyQuantities(prompt).tokens.map((token) => [token.raw, token.role]);
    assert.deepEqual(roles, [['3.2V', 'vf'], ['5V', 'voltage']], prompt);
  }
});

test('a fractional Vf before LED is one LED, while real counts still count', () => {
  const oneLed = [
    'vf3.2 LED를 5V에 연결해줘',
    '5V에 vf3.2 LED 연결',
    'vf3.2 LED on 5V supply',
    'vf 3.2 LED를 5V에 연결해줘',
    'LED vf3.2 5V',
    '5V supply vf3.2 LED',
    'LED vf 3.2 5V',
    '5V에 vf 3.2 LED 연결',
    'vf 3,2 LED on 5V'
  ];
  for (const prompt of oneLed) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.ok(parsed, prompt);
    assert.equal(parsed.refused, false, `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
    assert.equal(parsed.count, 1, prompt);
    assert.equal(parsed.requestedCount, 1, prompt);
    assert.equal(parsed.supplyVolts, 5, prompt);
    if (/vf/i.test(prompt)) {
      assert.equal(parsed.specifiedVf, 3.2, prompt);
      assert.equal(parsed.resistorValue, '180Ω', prompt);
      assert.equal(parsed.resistorExplicit, false, prompt);
    } else {
      assert.equal(parsed.specifiedVf, null, prompt);
      assert.equal(parsed.count, 1, prompt);
    }
  }

  const counted = [
    ['2 LEDs 5V Vf 3.2V', 2, 3.2, '180Ω'],
    ['LED 3개 5V', 3, null, '300Ω'],
    ['three LEDs on 5V', 3, null, '300Ω'],
    ['LED 5V 3 leds 470', 3, null, '470Ω'],
    ['LED 5V 3 leds 470Ω', 3, null, '470Ω']
  ];
  for (const [prompt, count, vf, resistor] of counted) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.ok(parsed, prompt);
    assert.equal(parsed.refused, false, `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
    assert.equal(parsed.count, count, prompt);
    assert.equal(parsed.requestedCount, count, prompt);
    assert.equal(parsed.specifiedVf, vf, prompt);
    assert.equal(parsed.resistorValue, resistor, prompt);
    assert.equal(parsed.supplyVolts, 5, prompt);
  }
});

test('every forward voltage outside 0.5V to 5V is implausible, including labeled units and non-positive values', () => {
  const cases = [
    ['LED Vf 0', '0'],
    ['LED Vf=0', '0'],
    ['LED Vf 0 5V', '0'],
    ['Vf 0 LED', '0'],
    ['엘이디 Vf 0', '0'],
    ['LED Vf 0V 5V', '0'],
    ['LED Vf -2V 5V', '-2'],
    ['LED Vf 10V', '10'],
    ['Vf 10V LED', '10'],
    ['LED Vf 6V', '6'],
    ['LED Vf 6V on 5V', '6'],
    ['LED Vf 0.3V', '0.3'],
    ['LED 5V Vf 0.3V', '0.3'],
    ['LED 12V Vf 6V', '6'],
    ['LED 24V Vf 10V', '10'],
    ['LED vf32', '32'],
    ['LED 5V vf32', '32'],
    ['LED Vf=0.4', '0.4'],
    ['LED Vf 0.49V', '0.49'],
    ['LED Vf 5.1V', '5.1'],
    ['엘이디 Vf 0V 5V', '0'],
    ['엘이디 Vf -2V 5V', '-2'],
    ['엘이디 Vf 10V', '10'],
    ['엘이디 Vf 6V를 5V에', '6'],
    ['엘이디 Vf 0.3V 5V', '0.3']
  ];
  for (const [prompt, shown] of cases) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.ok(parsed, prompt);
    assert.equal(parsed.refused, true, prompt);
    assert.equal(parsed.count, 0, prompt);
    assert.equal(parsed.resistanceOhms, null, prompt);
    assert.equal(parsed.resistorValue, null, prompt);
    assert.equal(parsed.specifiedVf ?? null, null, prompt);
    assert.equal(parsed.reviewBlockers.length, 1, prompt);
    const blocker = parsed.reviewBlockers[0];
    assert.equal(blocker.code, 'discrete-led-implausible-vf', `${prompt} ${blocker.code} ${blocker.en}`);
    assert.match(blocker.en, new RegExp(`forward voltage ${shown.replace(/[.]/g, '\\.')}V is implausible`), blocker.en);
    assert.match(blocker.en, /0\.5V to 5V/, blocker.en);
    assert.equal(/not above/i.test(blocker.en), false, blocker.en);
    assert.equal(/not positive/i.test(blocker.en), false, blocker.en);
    assert.equal(/supply voltage/i.test(blocker.en), false, blocker.en);
    assert.match(blocker.ko, new RegExp(`순방향 전압 ${shown.replace(/[.]/g, '\\.')}V`), blocker.ko);
    assert.match(blocker.ko, /0\.5V에서 5V/, blocker.ko);
    assert.equal(blocker.ko.includes('공급 전압'), false, blocker.ko);
    assert.equal(blocker.message, /[가-힣]/.test(prompt) ? blocker.ko : blocker.en, prompt);
  }

  const accepted = [
    ['LED Vf 0.5V on 5V', 0.5, 5, '470Ω'],
    ['LED Vf 5V on 12V', 5, 12, '750Ω'],
    ['LED Vf 3.2V 5V', 3.2, 5, '180Ω']
  ];
  for (const [prompt, vf, supply, resistor] of accepted) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.equal(parsed.refused, false, `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
    assert.equal(parsed.reviewBlockers.some((item) => item.code === 'discrete-led-implausible-vf'), false, prompt);
    assert.equal(parsed.reviewBlockers.some((item) => item.code === 'discrete-led-below-vf'), false, prompt);
    assert.equal(parsed.specifiedVf, vf, prompt);
    assert.equal(parsed.supplyVolts, supply, prompt);
    assert.equal(parsed.resistorValue, resistor, prompt);
    assert.equal(parsed.count, 1, prompt);
  }
});

test('unitless glued vf3.2 is a forward voltage and an out-of-range Vf is implausible', () => {
  for (const prompt of ['LED 5V vf3.2', 'LED 5V Vf3.2', 'LED 5V VF3.2']) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.equal(parsed.refused, false, `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
    assert.equal(parsed.reviewBlockers.some((item) => item.code === 'discrete-led-below-vf'), false, prompt);
    assert.equal(parsed.supplyVolts, 5, prompt);
    assert.equal(parsed.supplyAssumed, false, prompt);
    assert.equal(parsed.specifiedVf, 3.2, prompt);
    assert.equal(parsed.resistorExplicit, false, prompt);
    assert.equal(parsed.resistorValue, '180Ω', prompt);
  }

  const cases = [
    ['LED Vf=330', '330'],
    ['LED Vf=0.4', '0.4'],
    ['LED Vf=0.49', '0.49'],
    ['LED Vf=5.1', '5.1'],
    ['LED Vf=6', '6'],
    ['엘이디 Vf=330', '330']
  ];
  for (const [prompt, shown] of cases) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.equal(parsed.refused, true, prompt);
    assert.equal(parsed.reviewBlockers.length, 1, prompt);
    const blocker = parsed.reviewBlockers[0];
    assert.equal(blocker.code, 'discrete-led-implausible-vf', `${prompt} ${blocker.code} ${blocker.en}`);
    assert.match(blocker.en, new RegExp(`\\b${shown.replace('.', '\\.')}V\\b`), blocker.en);
    assert.match(blocker.en, /0\.5V to 5V/, blocker.en);
    assert.equal(/not above/i.test(blocker.en), false, blocker.en);
    assert.match(blocker.ko, new RegExp(`${shown.replace('.', '\\.')}V`), blocker.ko);
    assert.match(blocker.ko, /0\.5V에서 5V/, blocker.ko);
    assert.equal(blocker.message, /[가-힣]/.test(prompt) ? blocker.ko : blocker.en, prompt);
    assert.equal(parsed.resistanceOhms, null, prompt);
    assert.equal(parsed.resistorExplicit, false, prompt);
    assert.equal(parsed.specifiedVf ?? null, null, prompt);
  }
});

test('a voltage range with no Vf label asks which value is the supply', () => {
  for (const prompt of ['LED 3.0\u20135V', 'LED 3.0-5V', 'LED 3.0\u20145V', '엘이디 3.0\u20135V']) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.equal(parsed.refused, true, `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
    assert.notEqual(parsed.supplyVolts, 5, prompt);
    assert.equal(parsed.supplyVolts, null, prompt);
    assert.equal(parsed.resistanceOhms, null, prompt);
    assert.equal(parsed.reviewBlockers.length, 1, prompt);
    const blocker = parsed.reviewBlockers[0];
    const shown = prompt.match(/\d[\d.\u2013\u2014-]*V/)[0];
    assert.equal(blocker.code, 'discrete-led-ambiguous-range', `${prompt} ${blocker.code}`);
    assert.match(blocker.en, new RegExp(`^Which value is the supply and which is the LED Vf in ${escapeRegExp(shown)}\\?`), blocker.en);
    assert.match(blocker.en, /forward voltage \(Vf\)/i, blocker.en);
    assert.match(blocker.ko, /^어느 값이 공급 전압이고 어느 값이/, blocker.ko);
    assert.match(blocker.ko, /순방향 전압/, blocker.ko);
    assert.match(blocker.ko, new RegExp(escapeRegExp(shown)), blocker.ko);
    assert.equal(blocker.en.includes('Refusing to draft'), false, blocker.en);
    assert.equal(blocker.ko.includes('생성하지 않았습니다'), false, blocker.ko);
    assert.equal(/5V supply/i.test(blocker.en), false, blocker.en);
    assert.equal(blocker.message, /[가-힣]/.test(prompt) ? blocker.ko : blocker.en, prompt);
  }

  const labeled = parseDiscreteLedRequest('LED Vf 3.0\u20135V at 9V');
  assert.equal(labeled.refused, false, JSON.stringify(labeled.reviewBlockers));
  assert.equal(labeled.supplyVolts, 9);
  assert.equal(labeled.specifiedVf, 5);
});

test('a discrete LED prompt longer than 4000 characters is blocked without tokenizing', { timeout: 20000 }, () => {
  const base = 'LED on 5V';
  const under = `${base}${' '.repeat(4000 - base.length)}`;
  assert.equal(under.length, 4000);
  const accepted = parseDiscreteLedRequest(under);
  assert.equal(accepted.refused, false, JSON.stringify(accepted.reviewBlockers));
  assert.equal(accepted.supplyVolts, 5);
  assert.notEqual(accepted.reviewBlockers[0]?.code, 'discrete-led-prompt-too-long');

  const over = `${under} `;
  assert.equal(over.length, 4001);
  const blocked = parseDiscreteLedRequest(over);
  assert.equal(blocked.refused, true);
  assert.equal(blocked.reviewBlockers.length, 1);
  assert.equal(blocked.reviewBlockers[0].code, 'discrete-led-prompt-too-long');
  assert.match(blocked.reviewBlockers[0].en, /4000/);
  assert.match(blocked.reviewBlockers[0].ko, /4000/);
  assert.equal(blocked.reviewBlockers[0].message, blocked.reviewBlockers[0].en);
  assert.equal(blocked.resistanceOhms, null);
  assert.equal(blocked.supplyVolts, null);

  const korean = `엘이디 ${'가'.repeat(4000)}`;
  const koreanBlocked = parseDiscreteLedRequest(korean);
  assert.equal(koreanBlocked.reviewBlockers[0].code, 'discrete-led-prompt-too-long');
  assert.equal(koreanBlocked.reviewBlockers[0].message, koreanBlocked.reviewBlockers[0].ko);

  const notLed = `STM32 ${'x'.repeat(5000)}`;
  assert.equal(parseDiscreteLedRequest(notLed), null);

  const huge = `LED 5V ${'1'.repeat(100_000)}`;
  const started = performance.now();
  const hugeBlocked = parseDiscreteLedRequest(huge);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 500, `parse took ${elapsed}ms`);
  assert.equal(hugeBlocked.refused, true);
  assert.equal(hugeBlocked.reviewBlockers[0].code, 'discrete-led-prompt-too-long');
});

test('quantity tokenization stays fast on long digit runs below the prompt cap', { timeout: 20000 }, () => {
  const prompt = `LED 5V ${'1'.repeat(3900)}`;
  assert.ok(prompt.length < 4000);
  const started = performance.now();
  const result = tokenizeQuantities(prompt);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 25, `tokenize took ${elapsed}ms`);
  assert.equal(result.unparseable, false);
  assert.equal(result.tokens.some((token) => token.raw === '5V'), true);
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function strayKoreanAscii(text) {
  const allowed = new Set([
    'V', 'mV', 'kV', 'A', 'mA', 'LED', 'RGB', 'WS2812', 'WS2811', 'SK6812', 'APA102',
    'PWM', 'ERC', 'E24', 'KiCad', 'GND', 'VCC'
  ]);
  return (String(text).match(/[A-Za-z][A-Za-z0-9]*/g) ?? []).filter((word) => {
    if (allowed.has(word)) return false;
    return !(word.length === 1 && /[kKmMgGvVaArR]/.test(word));
  });
}

test('normalizes USB data nets to KiCad-safe profile names', () => {
  const spec = normalizeCircuitSpec('USB-C sensor board with USB data.');
  const usb = spec.interfaces.find((iface) => iface.kind === 'usb');

  assert.deepEqual(usb.pins, ['VBUS', 'USB_DP', 'USB_DN', 'GND', 'CC1', 'CC2']);
});
