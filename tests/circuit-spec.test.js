import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeCircuitSpec, parseDiscreteLedRequest } from '../src/runtime/circuit-spec.js';

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
        && note.message === 'Unsupported: potentiometers are not supported by the discrete LED generator. The draft uses a fixed series resistor instead.'),
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
  assert.equal(adapter.refused, false);
  assert.equal(adapter.supplyVolts, 5);
  assert.equal(adapter.supplyNet, '+5V');

  const green = parseDiscreteLedRequest('green LED on 5V');
  assert.ok(green);
  assert.equal(green.supplyVolts, 5);
  assert.equal(green.resistorValue, '300Ω');
  assert.equal(green.color?.id, 'green');
});

test('normalizes USB data nets to KiCad-safe profile names', () => {
  const spec = normalizeCircuitSpec('USB-C sensor board with USB data.');
  const usb = spec.interfaces.find((iface) => iface.kind === 'usb');

  assert.deepEqual(usb.pins, ['VBUS', 'USB_DP', 'USB_DN', 'GND', 'CC1', 'CC2']);
});
