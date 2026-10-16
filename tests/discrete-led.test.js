import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { generateMcuPeripheralProject } from '../src/workflow/generate-mcu-project.js';
import { FIXTURE_LIBS, restoreKicadLibraryEnv, setKicadLibraryEnv } from './helpers/kicad-library-env.js';

async function generateLed(prompt) {
  const projectDir = await mkdtemp(path.join(tmpdir(), 'chatpcb-discrete-led-'));
  const previous = setKicadLibraryEnv({
    symbols: FIXTURE_LIBS.symbols,
    footprints: FIXTURE_LIBS.footprints
  });
  try {
    const result = await generateMcuPeripheralProject({
      projectDir,
      prompt,
      projectName: 'discrete_led'
    });
    const schematic = await readFile(result.files.schematic, 'utf8');
    const specText = await readFile(result.files.spec, 'utf8');
    const spice = await readFile(result.files.spice, 'utf8');
    return { ...result, schematic, specText, spice };
  } finally {
    restoreKicadLibraryEnv(previous);
    await rm(projectDir, { force: true, recursive: true });
  }
}

function components(result, libId) {
  return result.spec.schematic.components.filter((component) => component.libId === libId);
}

function manifestParts(result, libId) {
  return (result.spec.partManifest?.parts ?? []).filter((part) => part.libId === libId);
}

function noteText(result) {
  return (result.review.findings.notes ?? []).map((note) => note.message).join('\n');
}

test('canonical discrete LED prompt drafts an LED, 330 ohm resistor, 5V supply, and a part manifest', async () => {
  const result = await generateLed('LED 하나와 330옴 저항을 5V에 연결하는 간단한 회로 만들어줘');
  assert.equal(result.spec.kind, 'discrete-led');
  assert.equal(components(result, 'Device:LED').length, 1);
  assert.equal(components(result, 'Device:LED')[0].value, 'LED');
  assert.equal(components(result, 'Device:R').length, 1);
  assert.equal(components(result, 'Device:R')[0].value, '330Ω');
  assert.equal(components(result, 'power:+5V')[0].value, '+5V');
  assert.equal(components(result, 'Connector_Generic:Conn_01x02')[0].value, '+5V');
  assert.ok(result.spec.schematic.nets.some((net) => net.name === '+5V'));
  assert.ok(result.spec.partManifest.parts.length > 0);
  assert.equal(manifestParts(result, 'Device:LED').length, 1);
  assert.equal(manifestParts(result, 'Device:R')[0].value, '330Ω');
  assert.equal(manifestParts(result, 'power:+5V')[0].role, 'supply');
  assert.ok(!result.review.findings.blockers.some((finding) => finding.code === 'mcu-part-missing'));
  assert.ok(!result.spec.schematic.components.some((component) => component.libId === 'ChatPCB:MCU_PLACEHOLDER'));
  assert.match(result.schematic, /Device:LED/);
  assert.match(result.schematic, /330Ω/);
  assert.match(result.schematic, /power:\+5V/);
});

test('discrete LED quantity gives each LED its own series resistor and caps above 8', async () => {
  const threeKorean = await generateLed('LED 3개');
  assert.equal(components(threeKorean, 'Device:LED').length, 3);
  assert.equal(components(threeKorean, 'Device:R').length, 3);
  assert.equal(manifestParts(threeKorean, 'Device:LED').length, 3);
  assert.equal(manifestParts(threeKorean, 'Device:R').length, 3);
  assert.match(noteText(threeKorean), /calculated as \(5V - 2V\) \/ 10mA = 300Ω/);

  const threeEnglish = await generateLed('three LEDs');
  assert.equal(components(threeEnglish, 'Device:LED').length, 3);
  assert.equal(components(threeEnglish, 'Device:R').length, 3);

  const two = await generateLed('LED 2개와 저항');
  assert.equal(components(two, 'Device:LED').length, 2);
  assert.equal(components(two, 'Device:R').length, 2);
  assert.ok(components(two, 'Device:R').every((part) => part.value === '300Ω'));
  assert.match(noteText(two), /calculated as \(5V - 2V\) \/ 10mA = 300Ω/);

  const exactCap = await generateLed('eight LEDs');
  assert.equal(components(exactCap, 'Device:LED').length, 8);
  assert.equal(components(exactCap, 'Device:R').length, 8);
  assert.equal(exactCap.review.findings.notes.some((note) => note.code === 'discrete-led-quantity-capped'), false);

  const capped = await generateLed('LED 10개');
  assert.equal(components(capped, 'Device:LED').length, 8);
  assert.equal(components(capped, 'Device:R').length, 8);
  assert.match(noteText(capped), /Requested 10 LEDs; the discrete LED generator is capped at 8/);

  const twelve = await generateLed('twelve LEDs');
  assert.equal(components(twelve, 'Device:LED').length, 8);
  assert.match(noteText(twelve), /Requested 12 LEDs; the discrete LED generator is capped at 8/);
});

test('discrete LED color sets the value and calculates the series resistor unless one was requested', async () => {
  const red = await generateLed('빨간 LED를 5V에 연결해줘');
  assert.equal(components(red, 'Device:LED')[0].value, 'LED Red');
  assert.equal(components(red, 'Device:LED')[0].description, 'LED Red');
  assert.equal(components(red, 'Device:R')[0].value, '300Ω');
  assert.match(noteText(red), /Series resistor 300Ω was calculated as \(5V - 2V\) \/ 10mA = 300Ω for a red LED \(typical Vf 2V\)/);
  assert.match(red.schematic, /LED Red/);

  const green = await generateLed('green LED on 5V');
  assert.equal(components(green, 'Device:LED')[0].value, 'LED Green');
  assert.equal(components(green, 'Device:R')[0].value, '300Ω');
  assert.match(noteText(green), /calculated as \(5V - 2\.2V\) \/ 10mA = 280Ω, rounded up to the next E24 value 300Ω for a green LED \(typical Vf 2\.2V\)/);

  const blue = await generateLed('blue LED on 5V');
  assert.equal(components(blue, 'Device:LED')[0].value, 'LED Blue');
  assert.match(noteText(blue), /typical Vf 3V/);
  assert.equal(components(blue, 'Device:R')[0].value, '200Ω');

  const white = await generateLed('white LED on 12V');
  assert.equal(components(white, 'Device:LED')[0].value, 'LED White');
  assert.match(noteText(white), /calculated as \(12V - 3\.2V\) \/ 10mA = 880Ω, rounded up to the next E24 value 910Ω/);
  assert.equal(components(white, 'Device:R')[0].value, '910Ω');

  const yellow = await generateLed('yellow LED');
  assert.equal(components(yellow, 'Device:LED')[0].value, 'LED Yellow');
  assert.match(noteText(yellow), /typical Vf 2\.1V/);

  const explicit = await generateLed('red LED with a 330 ohm resistor on 5V');
  assert.equal(components(explicit, 'Device:LED')[0].value, 'LED Red');
  assert.equal(components(explicit, 'Device:R')[0].value, '330Ω');
  assert.match(noteText(explicit), /keeps the requested series resistor 330Ω for LED Red/);
  assert.equal(/calculated as/i.test(noteText(explicit)), false);
});

test('unsupported discrete LED features are called out in the readiness review', async () => {
  const rgb = await generateLed('RGB LED를 5V에 연결해줘');
  assert.match(noteText(rgb), /Unsupported: RGB, addressable, and matrix LEDs are not supported/);
  assert.ok(components(rgb, 'Device:LED').length >= 1);

  const addressable = await generateLed('addressable WS2812 LED');
  assert.match(noteText(addressable), /Unsupported: RGB, addressable, and matrix LEDs are not supported/);

  const pwm = await generateLed('PWM으로 LED 밝기 조절');
  assert.match(noteText(pwm), /Unsupported: PWM, dimming, and brightness control are not supported/);

  const plain = await generateLed('red LED on 5V');
  assert.equal(/unsupported/i.test(noteText(plain)), false);
});

test('3.3V and 12V discrete LED supplies use KiCad power symbols and never +3.3V', async () => {
  const low = await generateLed('빨간 LED를 3.3V에 연결해줘');
  const lowOutput = [low.schematic, low.specText, low.spice, JSON.stringify(low.review), JSON.stringify(low.spec)].join('\n');
  assert.equal(lowOutput.includes('+3.3V'), false);
  assert.equal(low.spec.discrete.supplyNet, '+3V3');
  assert.equal(low.spec.power.rails[0].name, '+3V3');
  assert.equal(components(low, 'power:+3V3')[0].value, '+3V3');
  assert.equal(components(low, 'power:+3V3')[0].description, '+3V3');
  assert.equal(components(low, 'Connector_Generic:Conn_01x02')[0].value, '+3V3');
  assert.ok(low.spec.schematic.nets.some((net) => net.name === '+3V3'));
  assert.equal(low.spec.schematic.nets.some((net) => net.name === '+3.3V'), false);
  assert.equal(manifestParts(low, 'power:+3V3')[0].value, '+3V3');
  assert.equal(manifestParts(low, 'power:+3V3')[0].role, 'supply');
  assert.equal(manifestParts(low, 'Connector_Generic:Conn_01x02')[0].value, '+3V3');
  assert.match(low.schematic, /\(symbol "power:\+3V3"/);
  assert.match(low.schematic, /\(lib_id "power:\+3V3"\)/);
  assert.equal(components(low, 'Device:LED')[0].value, 'LED Red');
  assert.equal(components(low, 'Device:R')[0].value, '130Ω');
  assert.match(noteText(low), /calculated as \(3\.3V - 2V\) \/ 10mA = 130Ω/);

  const high = await generateLed('LED and 330 ohm resistor at 12V');
  assert.equal(high.spec.discrete.supplyNet, '+12V');
  assert.equal(components(high, 'power:+12V')[0].value, '+12V');
  assert.equal(components(high, 'Connector_Generic:Conn_01x02')[0].value, '+12V');
  assert.equal(components(high, 'Device:R')[0].value, '330Ω');
  assert.equal(manifestParts(high, 'power:+12V')[0].role, 'supply');
  assert.equal(manifestParts(high, 'power:+12V')[0].value, '+12V');
  assert.match(high.schematic, /\(symbol "power:\+12V"/);
  assert.ok(high.spec.schematic.nets.some((net) => net.name === '+12V'));

  const mcu = await generateLed('STM32 board with status LED and 3.3V regulator');
  assert.notEqual(mcu.spec.kind, 'discrete-led');
  assert.ok(mcu.spec.schematic.components.some((component) => /STM32|MCU/.test(component.libId)));
});
