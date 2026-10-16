import assert from 'node:assert/strict';
import test from 'node:test';

import { applyDiscreteLedSpec, normalizeCircuitSpec, parseDiscreteLedRequest } from '../src/runtime/circuit-spec.js';
import { classifyQuantities, promptDescribesAcSupply, tokenizeQuantities } from '../src/runtime/quantity-tokens.js';
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

test('bare number after an LED prompt is the series resistor in ohms', () => {
  const bare = parseDiscreteLedRequest('5V LED 330');
  assert.ok(bare);
  assert.equal(bare.supplyVolts, 5);
  assert.equal(bare.supplyNet, '+5V');
  assert.equal(bare.resistorExplicit, true);
  assert.equal(bare.resistanceOhms, 330);
  assert.equal(bare.resistorValue, '330Ω');

  const afterCount = parseDiscreteLedRequest('LED 5V 3 leds 470');
  assert.ok(afterCount);
  assert.equal(afterCount.supplyVolts, 5);
  assert.equal(afterCount.count, 3);
  assert.equal(afterCount.resistorExplicit, true);
  assert.equal(afterCount.resistanceOhms, 470);
  assert.equal(afterCount.resistorValue, '470Ω');

  const koreanCount = parseDiscreteLedRequest('LED 3개 470');
  assert.ok(koreanCount);
  assert.equal(koreanCount.count, 3);
  assert.equal(koreanCount.resistorExplicit, true);
  assert.equal(koreanCount.resistanceOhms, 470);

  const spacedVoltage = parseDiscreteLedRequest('LED 5 V 330');
  assert.ok(spacedVoltage);
  assert.equal(spacedVoltage.supplyVolts, 5);
  assert.equal(spacedVoltage.resistorExplicit, true);
  assert.equal(spacedVoltage.resistanceOhms, 330);

  assert.equal(parseDiscreteLedRequest('5V 330'), null);
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
  assert.equal(current.resistorValue, '300Ω');

  const spacedCurrent = parseDiscreteLedRequest('LED 5V 20 mA');
  assert.ok(spacedCurrent);
  assert.equal(spacedCurrent.resistorExplicit, false);
  assert.equal(spacedCurrent.resistorValue, '300Ω');

  const currentThenResistor = parseDiscreteLedRequest('LED 5V 20mA 470');
  assert.ok(currentThenResistor);
  assert.equal(currentThenResistor.resistorExplicit, true);
  assert.equal(currentThenResistor.resistanceOhms, 470);
  assert.equal(currentThenResistor.resistorValue, '470Ω');

  const spacedCurrentThenResistor = parseDiscreteLedRequest('LED 5V 20 mA 470');
  assert.ok(spacedCurrentThenResistor);
  assert.equal(spacedCurrentThenResistor.resistorExplicit, true);
  assert.equal(spacedCurrentThenResistor.resistanceOhms, 470);

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
    ['2.0～2.4V', [{ value: 2.4, unit: 'V', raw: '2.0～2.4V' }]],
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
    ['3 LEDs', [{ value: 3, unit: 'count', raw: '3 LEDs' }]],
    ['3개', [{ value: 3, unit: 'count', raw: '3개' }]],
    ['LED 5V 20mA 470', [
      { value: 5, unit: 'V', raw: '5V' },
      { value: 20, unit: 'mA', raw: '20mA' },
      { value: 470, unit: 'ohm', raw: '470' }
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
      assert.equal(prompt.slice(token.start, token.end), token.raw, prompt);
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
    ['10k pot, LED, 5V', [
      ['5V', 'voltage']
    ]],
    ['LED 330 and 4k7 on 5V', [
      ['330', 'resistor'],
      ['4k7', 'resistor'],
      ['5V', 'supply']
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
    ['LED Vf 2.0～2.4V 5V', 5, '+5V', 2.4, false, 270, '270Ω', '2.0～2.4V'],
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
    ['LED 5V 40mA', '300Ω', /requested current 40mA is above 30mA/, null, false],
    ['LED 5V 50 mA', '300Ω', /requested current 50mA is above 30mA/, null, false],
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
  assert.equal(quiet.resistorValue, '300Ω');
  assert.equal(quiet.resistorExplicit, false);
  assert.equal(quiet.reviewWarnings.length, 0);
  assert.equal(quiet.reviewBlockers.length, 0);
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

  const notVolts = [
    ['LED 5V 3.2', 3.2],
    ['LED forward voltage 3.2', 3.2]
  ];
  for (const [prompt, ohms] of notVolts) {
    const parsed = parseDiscreteLedRequest(prompt);
    assert.ok(parsed, prompt);
    assert.equal(parsed.refused, false, `${prompt} ${JSON.stringify(parsed.reviewBlockers)}`);
    assert.equal(parsed.specifiedVf, null, prompt);
    assert.equal(parsed.resistorExplicit, true, prompt);
    assert.equal(parsed.resistanceOhms, ohms, prompt);
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
    'vf 3,2 LED on 5V',
    '3.2 LED on 5V',
    '3,2 LED on 5V',
    '2.5 LEDs on 5V'
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
    ['LED 5V 3 leds 470', 3, null, '470Ω']
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
    assert.equal(blocker.code, 'discrete-led-ambiguous-range', `${prompt} ${blocker.code}`);
    assert.match(blocker.en, /which value is the supply/i, blocker.en);
    assert.match(blocker.en, /forward voltage \(Vf\)/i, blocker.en);
    assert.match(blocker.ko, /공급 전압/, blocker.ko);
    assert.match(blocker.ko, /순방향 전압/, blocker.ko);
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
