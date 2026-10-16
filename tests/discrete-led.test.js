import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveKicadCli } from '../src/kicad/kicad-cli.js';
import { findInstalledSymbolLibraryDirectory } from '../src/kicad/project-generator.js';
import { dispatchToolCall } from '../src/runtime/agent-daemon.js';
import { createPatchApprovalRegistry } from '../src/runtime/patch-approval-registry.js';
import { createProjectMutexRegistry } from '../src/runtime/project-mutex-registry.js';
import { createTransactionJournal } from '../src/runtime/transaction-journal.js';
import { generateMcuPeripheralProject } from '../src/workflow/generate-mcu-project.js';
import { validateProject } from '../src/workflow/validate-project.js';
import { FIXTURE_LIBS, restoreKicadLibraryEnv, restoreProcessEnv, setKicadLibraryEnv } from './helpers/kicad-library-env.js';

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

function noteText(result, field = 'message') {
  return (result.review.findings.notes ?? []).map((note) => note[field] ?? '').join('\n');
}

test('canonical discrete LED prompt drafts an LED, 330 ohm resistor, 5V supply, and a part manifest', async () => {
  const result = await generateLed('LED 하나와 330옴 저항을 5V에 연결하는 간단한 회로 만들어줘');
  assert.equal(result.spec.kind, 'discrete-led');
  assert.equal(components(result, 'Device:LED').length, 1);
  assert.equal(components(result, 'Device:LED')[0].value, 'LED');
  assert.equal(components(result, 'Device:R').length, 1);
  assert.equal(components(result, 'Device:R')[0].value, '330Ω');
  assert.equal(components(result, 'power:+5V')[0].value, '+5V');
  assert.equal(components(result, 'Connector_Generic:Conn_01x02')[0].value, 'Conn_01x02');
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
  assert.match(noteText(threeKorean, 'en'), /calculated as \(5V - 2V\) \/ 10mA = 300Ω/);
  assert.equal(noteText(threeKorean), noteText(threeKorean, 'ko'));

  const threeEnglish = await generateLed('three LEDs');
  assert.equal(components(threeEnglish, 'Device:LED').length, 3);
  assert.equal(components(threeEnglish, 'Device:R').length, 3);

  const two = await generateLed('LED 2개와 저항');
  assert.equal(components(two, 'Device:LED').length, 2);
  assert.equal(components(two, 'Device:R').length, 2);
  assert.ok(components(two, 'Device:R').every((part) => part.value === '300Ω'));
  assert.match(noteText(two, 'en'), /calculated as \(5V - 2V\) \/ 10mA = 300Ω/);
  assert.equal(noteText(two), noteText(two, 'ko'));

  const exactCap = await generateLed('eight LEDs');
  assert.equal(components(exactCap, 'Device:LED').length, 8);
  assert.equal(components(exactCap, 'Device:R').length, 8);
  assert.equal(exactCap.review.findings.notes.some((note) => note.code === 'discrete-led-quantity-capped'), false);

  const capped = await generateLed('LED 10개');
  assert.equal(components(capped, 'Device:LED').length, 8);
  assert.equal(components(capped, 'Device:R').length, 8);
  assert.match(noteText(capped, 'en'), /Requested 10 LEDs; the discrete LED generator is capped at 8/);
  assert.match(noteText(capped, 'ko'), /8개까지/);
  assert.equal(noteText(capped), noteText(capped, 'ko'));

  const twelve = await generateLed('twelve LEDs');
  assert.equal(components(twelve, 'Device:LED').length, 8);
  assert.match(noteText(twelve), /Requested 12 LEDs; the discrete LED generator is capped at 8/);
});

test('a fractional Vf glued to LED is one series LED, and explicit counts stay intact', async () => {
  const oneLed = [
    'vf3.2 LED를 5V에 연결해줘',
    '5V에 vf3.2 LED 연결',
    'vf3.2 LED on 5V supply',
    'vf 3.2 LED를 5V에 연결해줘',
    'LED vf3.2 5V',
    '5V supply vf3.2 LED'
  ];
  for (const prompt of oneLed) {
    const result = await generateLed(prompt);
    assert.equal(result.spec.discrete.refused, false, `${prompt} ${JSON.stringify(result.spec.discrete.reviewBlockers)}`);
    assert.equal(result.spec.discrete.count, 1, prompt);
    assert.equal(result.spec.discrete.specifiedVf, 3.2, prompt);
    assert.equal(result.spec.discrete.supplyVolts, 5, prompt);
    assert.equal(components(result, 'Device:LED').length, 1, prompt);
    assert.equal(components(result, 'Device:R').length, 1, prompt);
    assert.equal(components(result, 'Device:R')[0].value, '180Ω', prompt);
  }

  const two = await generateLed('2 LEDs 5V Vf 3.2V');
  assert.equal(two.spec.discrete.count, 2);
  assert.equal(components(two, 'Device:LED').length, 2);
  assert.equal(components(two, 'Device:R').length, 2);
  assert.ok(components(two, 'Device:R').every((part) => part.value === '180Ω'));

  const threeKorean = await generateLed('LED 3개 5V');
  assert.equal(threeKorean.spec.discrete.count, 3);
  assert.equal(components(threeKorean, 'Device:LED').length, 3);
  assert.equal(components(threeKorean, 'Device:R').length, 3);

  const threeEnglish = await generateLed('three LEDs on 5V');
  assert.equal(threeEnglish.spec.discrete.count, 3);
  assert.equal(components(threeEnglish, 'Device:LED').length, 3);
  assert.equal(components(threeEnglish, 'Device:R').length, 3);
});

test('discrete LED color sets the value and calculates the series resistor unless one was requested', async () => {
  const red = await generateLed('빨간 LED를 5V에 연결해줘');
  assert.equal(components(red, 'Device:LED')[0].value, 'LED Red');
  assert.equal(components(red, 'Device:LED')[0].description, 'LED Red');
  assert.equal(components(red, 'Device:R')[0].value, '300Ω');
  assert.match(noteText(red, 'en'), /Series resistor 300Ω was calculated as \(5V - 2V\) \/ 10mA = 300Ω for a red LED \(typical Vf 2V\)/);
  assert.match(noteText(red, 'ko'), /빨간 LED/);
  assert.equal(noteText(red), noteText(red, 'ko'));
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
  assert.match(noteText(rgb, 'en'), /Unsupported: RGB, addressable, and matrix LEDs are not supported/);
  assert.equal(noteText(rgb), noteText(rgb, 'ko'));
  assert.ok(components(rgb, 'Device:LED').length >= 1);

  const addressable = await generateLed('addressable WS2812 LED');
  assert.match(noteText(addressable), /Unsupported: RGB, addressable, and matrix LEDs are not supported/);

  const pwm = await generateLed('PWM으로 LED 밝기 조절');
  assert.match(noteText(pwm, 'en'), /Unsupported: PWM, dimming, and brightness control are not supported/);
  assert.match(noteText(pwm, 'ko'), /PWM/);
  assert.equal(noteText(pwm), noteText(pwm, 'ko'));

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
  assert.equal(components(low, 'Connector_Generic:Conn_01x02')[0].value, 'Conn_01x02');
  assert.ok(low.spec.schematic.nets.some((net) => net.name === '+3V3'));
  assert.equal(low.spec.schematic.nets.some((net) => net.name === '+3.3V'), false);
  assert.equal(manifestParts(low, 'power:+3V3')[0].value, '+3V3');
  assert.equal(manifestParts(low, 'power:+3V3')[0].role, 'supply');
  assert.equal(manifestParts(low, 'Connector_Generic:Conn_01x02')[0].value, 'Conn_01x02');
  assert.match(low.schematic, /\(symbol "power:\+3V3"/);
  assert.match(low.schematic, /\(lib_id "power:\+3V3"\)/);
  assert.equal(components(low, 'Device:LED')[0].value, 'LED Red');
  assert.equal(components(low, 'Device:R')[0].value, '130Ω');
  assert.match(noteText(low, 'en'), /calculated as \(3\.3V - 2V\) \/ 10mA = 130Ω/);
  assert.equal(noteText(low), noteText(low, 'ko'));

  const high = await generateLed('LED and 330 ohm resistor at 12V');
  assert.equal(high.spec.discrete.supplyNet, '+12V');
  assert.equal(components(high, 'power:+12V')[0].value, '+12V');
  assert.equal(components(high, 'Connector_Generic:Conn_01x02')[0].value, 'Conn_01x02');
  assert.equal(components(high, 'Device:R')[0].value, '330Ω');
  assert.equal(manifestParts(high, 'power:+12V')[0].role, 'supply');
  assert.equal(manifestParts(high, 'power:+12V')[0].value, '+12V');
  assert.match(high.schematic, /\(symbol "power:\+12V"/);
  assert.ok(high.spec.schematic.nets.some((net) => net.name === '+12V'));

  const mcu = await generateLed('STM32 board with status LED and 3.3V regulator');
  assert.notEqual(mcu.spec.kind, 'discrete-led');
  assert.ok(mcu.spec.schematic.components.some((component) => /STM32|MCU/.test(component.libId)));
});

test('supply text after a voltage is not parsed as a decimal fraction', async () => {
  const ohms = await generateLed('5V 330Ω LED');
  assert.equal(ohms.spec.discrete.supplyNet, '+5V');
  assert.equal(ohms.spec.discrete.supplyVolts, 5);
  assert.equal(components(ohms, 'Device:R')[0].value, '330Ω');
  assert.equal(components(ohms, 'power:+5V')[0].value, '+5V');

  const koreanOhms = await generateLed('5V 330옴 저항과 LED 연결');
  assert.equal(koreanOhms.spec.discrete.supplyNet, '+5V');
  assert.equal(components(koreanOhms, 'Device:R')[0].value, '330Ω');

  const kilo = await generateLed('12V 1k LED');
  assert.equal(kilo.spec.discrete.supplyNet, '+12V');
  assert.equal(kilo.spec.discrete.supplyVolts, 12);
  assert.equal(components(kilo, 'Device:R')[0].value, '1kΩ');
  assert.equal(components(kilo, 'power:+12V')[0].value, '+12V');

  const koreanKilo = await generateLed('12V 1k 저항과 LED');
  assert.equal(koreanKilo.spec.discrete.supplyNet, '+12V');
  assert.equal(components(koreanKilo, 'Device:R')[0].value, '1kΩ');

  const fiveCount = await generateLed('5V 3 LEDs');
  assert.equal(fiveCount.spec.discrete.supplyNet, '+5V');
  assert.equal(components(fiveCount, 'Device:LED').length, 3);
  assert.equal(components(fiveCount, 'Device:R').length, 3);
  assert.ok(components(fiveCount, 'Device:R').every((part) => part.value === '300Ω'));

  const twelveCount = await generateLed('12V 3 LEDs');
  assert.equal(twelveCount.spec.discrete.supplyNet, '+12V');
  assert.equal(components(twelveCount, 'Device:LED').length, 3);
  assert.equal(components(twelveCount, 'Device:R')[0].value, '1kΩ');

  const glued = await generateLed('LED on 3V3');
  assert.equal(glued.spec.discrete.supplyNet, '+3V3');
  assert.equal(glued.spec.discrete.supplyVolts, 3.3);
  assert.equal(components(glued, 'power:+3V3')[0].value, '+3V3');
});

test('red and green without a count drafts one LED per color', async () => {
  const english = await generateLed('red and green LEDs on 5V');
  assert.equal(components(english, 'Device:LED').length, 2);
  assert.deepEqual(components(english, 'Device:LED').map((part) => part.value), ['LED Red', 'LED Green']);
  assert.equal(components(english, 'Device:R').length, 2);
  assert.ok(components(english, 'Device:R').every((part) => part.value === '300Ω'));
  assert.equal(/multiple LED colors/i.test(noteText(english)), false);
  assert.match(noteText(english), /red LED/);
  assert.match(noteText(english), /green LED/);

  const korean = await generateLed('빨간색과 초록색 LED');
  assert.equal(components(korean, 'Device:LED').length, 2);
  assert.deepEqual(components(korean, 'Device:LED').map((part) => part.value), ['LED Red', 'LED Green']);

  const counted = await generateLed('three red and green LEDs');
  assert.equal(components(counted, 'Device:LED').length, 3);
  assert.ok(components(counted, 'Device:LED').every((part) => part.value === 'LED Red'));
  assert.match(noteText(counted), /multiple LED colors/);
});

test('LED strip requests stay a simple LED and record an unsupported note', async () => {
  const strip = await generateLed('LED strip 12V');
  assert.equal(strip.spec.kind, 'discrete-led');
  assert.equal(strip.spec.discrete.supplyNet, '+12V');
  assert.ok(components(strip, 'Device:LED').length >= 1);
  assert.match(noteText(strip), /Unsupported: LED strips are not supported/);

  const korean = await generateLed('12V LED 스트립');
  assert.match(noteText(korean, 'en'), /Unsupported: LED strips are not supported/);
  assert.match(noteText(korean, 'ko'), /스트립/);
  assert.equal(noteText(korean), noteText(korean, 'ko'));
  assert.ok(components(korean, 'Device:LED').length >= 1);
});

test('mains and supplies above 24V are refused instead of generating an LED circuit', async () => {
  for (const prompt of ['LED lamp 220V', 'LED on 220V/AC mains', '220VAC LED', 'LED at 48V', 'LED on 25V']) {
    const refused = await generateLed(prompt);
    assert.equal(refused.spec.kind, 'discrete-led', prompt);
    assert.equal(components(refused, 'Device:LED').length, 0, prompt);
    assert.equal(components(refused, 'Device:R').length, 0, prompt);
    assert.equal(refused.spec.schematic.components.some((part) => String(part.libId).startsWith('power:')), false, prompt);
    assert.equal(refused.schematic.includes('Device:LED'), false, prompt);
    assert.equal(/22k/.test(refused.schematic), false, prompt);
    assert.equal(/VSUP/.test(refused.spice), false, prompt);
    assert.ok(
      refused.review.findings.blockers.some((finding) => finding.code === 'discrete-led-high-voltage'),
      `${prompt} ${JSON.stringify(refused.review.findings.blockers)}`
    );
    assert.equal(refused.review.status, 'blocked', prompt);
    assert.notEqual(refused.review.status, 'ready-for-prototype-review', prompt);
    const messages = [
      ...refused.review.findings.blockers,
      ...refused.review.findings.warnings,
      ...refused.review.findings.notes
    ].map((finding) => finding.message);
    assert.equal(new Set(messages).size, messages.length, `${prompt} ${JSON.stringify(messages)}`);
    const blocker = refused.review.findings.blockers.find((finding) => finding.code === 'discrete-led-high-voltage');
    assert.equal(refused.schematic.split(blocker.message).length - 1, 1, prompt);
    assert.match(blocker.ko, /고전압/, prompt);
    assert.match(blocker.en, /24V/, prompt);
    assert.equal(blocker.message, blocker.en, prompt);
  }

  const allowed = await generateLed('LED on 24V');
  assert.equal(allowed.spec.kind, 'discrete-led');
  assert.equal(allowed.spec.discrete.supplyNet, '+24V');
  assert.equal(components(allowed, 'Device:LED').length, 1);
  assert.equal(allowed.review.findings.blockers.some((finding) => finding.code === 'discrete-led-high-voltage'), false);

  const adapter = await generateLed('LED on a 5V AC adapter');
  assert.equal(adapter.spec.discrete.supplyNet, null);
  assert.equal(components(adapter, 'Device:LED').length, 0);
  assert.equal(components(adapter, 'Device:R').length, 0);
  assert.ok(adapter.review.findings.blockers.some((finding) => finding.code === 'discrete-led-ac-supply'));
  assert.equal(adapter.review.status, 'blocked');
});

test('a 9V battery LED uses power:+9V and a battery connector', async () => {
  const battery = await generateLed('LED on 9V battery');
  assert.equal(battery.spec.kind, 'discrete-led');
  assert.equal(battery.spec.discrete.supplyNet, '+9V');
  assert.equal(battery.spec.discrete.supplyVolts, 9);
  assert.equal(components(battery, 'power:+9V')[0].value, '+9V');
  assert.equal(components(battery, 'Connector_Generic:Conn_01x02')[0].value, 'Conn_01x02');
  assert.match(components(battery, 'Connector_Generic:Conn_01x02')[0].description, /battery/i);
  assert.equal(components(battery, 'Device:R')[0].value, '750Ω');
  assert.ok(components(battery, 'power:PWR_FLAG').length >= 2);
  assert.match(battery.schematic, /\(lib_id "power:\+9V"\)/);
  assert.equal(battery.spec.schematic.components.some((part) => part.libId === 'ChatPCB:MCU_PLACEHOLDER'), false);

  const otherBoard = await generateLed('LED on 9V battery with a reset button');
  assert.notEqual(otherBoard.spec.kind, 'discrete-led');

  const monitor = await generateLed('battery monitor with an LED');
  assert.notEqual(monitor.spec.kind, 'discrete-led');
});

test('a nonstandard rail uses power:VCC when the library has no dedicated symbol', async () => {
  const result = await generateLed('LED on 7.4V');
  assert.equal(result.spec.discrete.supplyNet, '+7V4');
  assert.equal(result.spec.discrete.supplyVolts, 7.4);
  assert.equal(components(result, 'power:VCC').length, 1);
  assert.equal(components(result, 'power:VCC')[0].value, '+7V4');
  assert.equal(manifestParts(result, 'power:VCC')[0].role, 'supply');
  assert.equal(components(result, 'Connector_Generic:Conn_01x02')[0].value, 'Conn_01x02');
  assert.equal(components(result, 'Connector_Generic:Conn_01x02')[0].pinNets[1], '+7V4');
  assert.equal(result.schematic.includes('(label "+7V4")'), false);
  assert.equal(result.schematic.includes('power:+7.5V'), false);
  assert.match(result.schematic, /power:VCC/);
  assert.match(result.schematic, /\+7V4/);
  assert.ok(components(result, 'power:PWR_FLAG').length >= 2);
  assert.equal(result.review.findings.blockers.some((finding) => finding.code === 'discrete-led-high-voltage'), false);
});

test('red LED on 3V uses power:VCC for the +3V rail', async () => {
  const result = await generateLed('red LED on 3V');
  assert.equal(result.spec.discrete.refused, false);
  assert.equal(result.spec.discrete.supplyVolts, 3);
  assert.equal(result.spec.discrete.supplyNet, '+3V');
  assert.equal(components(result, 'Device:LED').length, 1);
  assert.equal(components(result, 'power:VCC').length, 1);
  assert.equal(components(result, 'power:VCC')[0].value, '+3V');
  assert.match(result.schematic, /power:VCC/);
  assert.match(result.schematic, /Device:LED/);
  assert.equal(result.schematic.includes('power:+3V0'), false);
  assert.equal(result.schematic.includes('(symbol "power:+3V"'), false);
  assert.ok(components(result, 'power:PWR_FLAG').length >= 2);

  const blue = await generateLed('blue LED on 3V');
  assert.equal(blue.spec.discrete.refused, true);
  assert.equal(components(blue, 'Device:LED').length, 0);
  assert.equal(components(blue, 'power:VCC').length, 0);
  assert.match(blue.review.findings.blockers.map((finding) => finding.en).join('\n'), /not above/i);
});

test('low LED headroom warns once and a supply at Vf is refused without a placeholder', async () => {
  const white = await generateLed('white LED on 3.3V');
  assert.equal(components(white, 'Device:R')[0].value, '10Ω');
  assert.equal(white.review.findings.warnings.filter((finding) => finding.code === 'discrete-led-headroom').length, 1);
  assert.match(white.schematic, /headroom is only 0\.1V/);
  assert.match(white.schematic, /below 68Ω/);
  assert.equal(white.review.status, 'ready-for-prototype-review');

  const blue = await generateLed('blue LED on 3V');
  assert.equal(components(blue, 'Device:LED').length, 0);
  assert.equal(components(blue, 'Device:R').length, 0);
  assert.equal(blue.spec.schematic.components.some((part) => String(part.libId).startsWith('power:')), false);
  assert.equal(/placeholder/i.test(blue.schematic), false);
  assert.equal(blue.schematic.includes('1kΩ'), false);
  assert.ok(blue.review.findings.blockers.some((finding) => finding.code === 'discrete-led-below-vf'));
  assert.match(blue.review.findings.blockers.map((finding) => finding.ko).join('\n'), /파란/);
  assert.match(blue.review.findings.blockers.map((finding) => finding.en).join('\n'), /supply 3V is not above LED Vf 3V/);
  assert.equal(blue.review.status, 'blocked');
  const blueMessages = [
    ...blue.review.findings.blockers,
    ...blue.review.findings.warnings,
    ...blue.review.findings.notes
  ].map((finding) => finding.message);
  assert.equal(new Set(blueMessages).size, blueMessages.length, JSON.stringify(blueMessages));
  const blueBlocker = blue.review.findings.blockers.find((finding) => finding.code === 'discrete-led-below-vf').message;
  assert.equal(blue.schematic.split(blueBlocker).length - 1, 1);
});

test('AC, ambiguous supplies, and below-Vf LED prompts generate no placeholder circuit', async () => {
  const cases = [
    ['LED 24 VAC', 'discrete-led-ac-supply'],
    ['LED 12V AC', 'discrete-led-ac-supply'],
    ['AC adapter 9VAC LED', 'discrete-led-ac-supply'],
    ['LED 교류', 'discrete-led-ac-supply'],
    ['AC 전원 LED', 'discrete-led-ac-supply'],
    ['LED 5V and 12V', 'discrete-led-ambiguous-supply'],
    ['red LED on 1.8V', 'discrete-led-below-vf'],
    ['LED on 0.5V', 'discrete-led-below-vf']
  ];
  for (const [prompt, code] of cases) {
    const refused = await generateLed(prompt);
    assert.equal(refused.spec.kind, 'discrete-led', prompt);
    assert.equal(refused.spec.discrete.refused, true, prompt);
    assert.equal(refused.spec.discrete.supplyNet, null, prompt);
    assert.equal(refused.spec.power.rails.length, 0, prompt);
    assert.equal(components(refused, 'Device:LED').length, 0, prompt);
    assert.equal(components(refused, 'Device:R').length, 0, prompt);
    assert.equal(refused.spec.schematic.components.some((part) => String(part.libId).startsWith('power:')), false, prompt);
    assert.equal(refused.schematic.includes('Device:LED'), false, prompt);
    assert.equal(/placeholder/i.test(refused.schematic), false, prompt);
    assert.equal(refused.schematic.includes('Unsupported'), false, prompt);
    assert.equal(/VSUP/.test(refused.spice), false, prompt);
    assert.ok(
      refused.review.findings.blockers.some((finding) => finding.code === code),
      `${prompt} ${JSON.stringify(refused.review.findings.blockers)}`
    );
    assert.equal(refused.review.status, 'blocked', prompt);
    const blocker = refused.review.findings.blockers.find((finding) => finding.code === code);
    if (code === 'discrete-led-ac-supply') assert.match(blocker.en, /supply is AC/i, prompt);
    if (code === 'discrete-led-ambiguous-supply') assert.match(blocker.en, /which supply/i, prompt);
    if (code === 'discrete-led-below-vf') {
      assert.match(blocker.en, /not above/i, prompt);
      assert.match(blocker.ko, /공급 전압/, prompt);
      if (prompt === 'red LED on 1.8V') {
        assert.match(blocker.en, /supply 1\.8V is not above LED Vf 2V/);
        assert.match(blocker.ko, /공급 전압 1\.8V가 빨간 LED의 일반적인 순방향 전압 2V보다/);
      }
    }
    assert.equal(blocker.message, /[가-힣]/.test(prompt) ? blocker.ko : blocker.en, prompt);
  }
});

test('a specified forward voltage replaces the color default for the resistor and headroom', async () => {
  const specified = await generateLed('LED Vf 3V on 5V supply');
  assert.equal(specified.spec.discrete.supplyVolts, 5);
  assert.equal(specified.spec.discrete.supplyNet, '+5V');
  assert.equal(components(specified, 'Device:R')[0].value, '200Ω');
  assert.match(noteText(specified), /specified forward voltage of 3V/);
  assert.match(noteText(specified, 'ko'), /지정한 순방향 전압 3V/);
  assert.equal(noteText(specified), noteText(specified, 'en'));
  assert.equal(noteText(specified).includes('typical Vf 2V'), false);

  const equals = await generateLed('red LED Vf=2.1V on 3.3V');
  assert.equal(equals.spec.discrete.supplyVolts, 3.3);
  assert.notEqual(equals.spec.discrete.supplyVolts, 2.1);
  assert.equal(components(equals, 'Device:LED')[0].value, 'LED Red');
  assert.equal(components(equals, 'Device:R')[0].value, '120Ω');
  assert.match(noteText(equals, 'ko'), /지정한 순방향 전압 2\.1V/);
  assert.match(noteText(equals, 'en'), /specified forward voltage of 2\.1V/);

  const korean = await generateLed('LED 순방향 전압 3V, 전원 5V');
  assert.equal(korean.spec.discrete.supplyVolts, 5);
  assert.equal(korean.spec.discrete.supplyNet, '+5V');
  assert.equal(components(korean, 'Device:R')[0].value, '200Ω');
  assert.match(noteText(korean), /지정한 순방향 전압 3V/);
  assert.match(noteText(korean, 'en'), /specified forward voltage of 3V/);
  assert.equal(noteText(korean), noteText(korean, 'ko'));

  const onlyForward = await generateLed('LED Vf 3V');
  assert.equal(onlyForward.spec.discrete.supplyVolts, 5);
  assert.equal(onlyForward.spec.discrete.supplyAssumed, true);
  assert.equal(components(onlyForward, 'Device:R')[0].value, '200Ω');

  const eased = await generateLed('white LED Vf 2V on 3.3V');
  assert.equal(components(eased, 'Device:R')[0].value, '130Ω');
  assert.equal(eased.review.findings.warnings.some((finding) => finding.code === 'discrete-led-headroom'), false);

  const unblocked = await generateLed('blue LED Vf 2V on 3V');
  assert.equal(unblocked.spec.discrete.refused, false);
  assert.equal(components(unblocked, 'Device:R')[0].value, '100Ω');
  assert.equal(unblocked.review.findings.blockers.some((finding) => finding.code === 'discrete-led-below-vf'), false);
});

test('user Vf, Vf ranges, and high LED current survive into the draft', async () => {
  const blue = await generateLed('blue LED 5V Vf 3.2V');
  assert.equal(blue.spec.discrete.specifiedVf, 3.2);
  assert.equal(blue.spec.discrete.supplyVolts, 5);
  assert.equal(components(blue, 'Device:R')[0].value, '180Ω');
  assert.match(noteText(blue), /specified forward voltage of 3\.2V/);
  assert.equal(noteText(blue).includes('typical Vf 3V'), false);

  const korean = await generateLed('파란 LED 2개 5V Vf 3.2V');
  assert.equal(korean.spec.discrete.count, 2);
  assert.equal(korean.spec.discrete.specifiedVf, 3.2);
  assert.equal(components(korean, 'Device:LED').length, 2);
  assert.ok(components(korean, 'Device:R').every((part) => part.value === '180Ω'));

  const forwardAfter = await generateLed('LED 5V 순방향 전압 2V');
  assert.equal(forwardAfter.spec.discrete.supplyVolts, 5);
  assert.equal(forwardAfter.spec.discrete.specifiedVf, 2);
  assert.equal(forwardAfter.spec.discrete.refused, false);
  assert.equal(components(forwardAfter, 'Device:R')[0].value, '300Ω');

  const range = await generateLed('LED Vf 3.0-3.4V at 5V');
  assert.equal(range.spec.discrete.resistorExplicit, false);
  assert.equal(range.spec.discrete.specifiedVf, 3.4);
  assert.equal(components(range, 'Device:R')[0].value, '160Ω');
  assert.match(noteText(range), /3\.0-3\.4V/);
  assert.match(noteText(range), /maximum 3\.4V/);
  assert.match(noteText(range, 'ko'), /상한 3\.4V/);
  assert.equal(noteText(range, 'ko').includes(' to '), false);
  assert.equal(range.schematic.includes('3Ω'), false);

  const converter = await generateLed('LED on DC/AC converter 5V output');
  assert.equal(converter.spec.discrete.refused, false);
  assert.equal(converter.spec.discrete.supplyVolts, 5);
  assert.equal(components(converter, 'Device:LED').length, 1);

  const adapter = await generateLed('AC adapter outputting 12VDC LED');
  assert.equal(adapter.spec.discrete.refused, false);
  assert.equal(adapter.spec.discrete.supplyVolts, 12);
  assert.equal(components(adapter, 'Device:R').length, 1);

  const hot = await generateLed('red LED 1R5 on 5V');
  assert.equal(components(hot, 'Device:R')[0].value, '1.5Ω');
  const warning = hot.review.findings.warnings.find((finding) => finding.code === 'discrete-led-headroom');
  assert.ok(warning, JSON.stringify(hot.review.findings.warnings));
  assert.match(warning.message, /about 2A, above 30mA/);
  assert.match(warning.ko, /30mA를 넘/);
  assert.equal(warning.message, warning.en);
  assert.match(hot.schematic, /above 30mA/);
});

test('explicit 1R5 and 10 ohm LED resistors warn once', async () => {
  for (const [prompt, resistor] of [['LED 1R5 3V', '1.5Ω'], ['red LED 10Ω on 5V', '10Ω']]) {
    const result = await generateLed(prompt);
    assert.equal(components(result, 'Device:R')[0].value, resistor, prompt);
    const warnings = result.review.findings.warnings.filter((finding) => finding.code === 'discrete-led-headroom');
    assert.equal(warnings.length, 1, `${prompt} ${JSON.stringify(result.review.findings.warnings)}`);
    assert.ok(warnings[0].message.includes(resistor), warnings[0].message);
    assert.match(warnings[0].message, /68Ω/, prompt);
    assert.equal(result.review.findings.blockers.length, 0, prompt);
    assert.equal(result.review.status, 'ready-for-prototype-review', prompt);
  }
});

test('discrete LED power nets use PWR_FLAG and do not repeat the power name as a local label', async () => {
  const result = await generateLed('LED 하나와 330옴 저항을 5V에 연결하는 간단한 회로 만들어줘');
  assert.ok(components(result, 'power:PWR_FLAG').length >= 2);
  assert.ok(components(result, 'power:+5V').length >= 1);
  assert.ok(components(result, 'power:GND').length >= 1);
  assert.equal(result.schematic.includes('(label "+5V")'), false);
  assert.equal(result.schematic.includes('(label "GND")'), false);
  assert.match(result.schematic, /\(label "LED"/);
  assert.match(result.schematic, /\(lib_id "power:PWR_FLAG"\)/);

  const low = await generateLed('three red LEDs on 3.3V');
  assert.equal(low.schematic.includes('(label "+3V3")'), false);
  assert.equal(low.schematic.includes('(label "GND")'), false);
  assert.ok(components(low, 'power:PWR_FLAG').length >= 2);

  const high = await generateLed('white LED on 12V');
  assert.equal(high.schematic.includes('(label "+12V")'), false);
  assert.equal(high.schematic.includes('(label "GND")'), false);
});

test('fixture power symbols match KiCad power_in pins and include +9V', async () => {
  const source = await readFile(path.resolve(import.meta.dirname, 'fixtures/kicad-libraries/symbols/power.kicad_sym'), 'utf8');
  for (const name of ['+5V', '+3V3', '+12V', '+9V', 'GND', 'VCC']) {
    const block = topLevelPowerSymbol(source, name);
    assert.match(block, /\(power global\)/, name);
    assert.match(block, /\(pin power_in /, name);
    assert.doesNotMatch(block, /\(pin power_out /, name);
  }
  const flag = topLevelPowerSymbol(source, 'PWR_FLAG');
  assert.match(flag, /\(power global\)/);
  assert.match(flag, /\(pin power_out /);
});

test('README documents discrete LED limits', async () => {
  const readme = await readFile(path.resolve(import.meta.dirname, '../README.md'), 'utf8');
  assert.match(readme, /8 LEDs/);
  assert.match(readme, /10mA/);
  assert.match(readme, /red, yellow, green, blue, and white/i);
  assert.match(readme, /\+3V3/);
  assert.match(readme, /\+5V/);
  assert.match(readme, /\+9V/);
  assert.match(readme, /\+12V/);
  assert.match(readme, /24V/);
  assert.match(readme, /GND/);
});

function realDiscreteLedSkipReason() {
  if (process.env.CHATPCB_KICAD_CLI_DISABLE) return 'CHATPCB_KICAD_CLI_DISABLE is set';
  if (!resolveKicadCli().path) return 'kicad-cli is not available';
  if (!findInstalledSymbolLibraryDirectory()) return 'real KiCad symbol library is not available';
  return false;
}

function useRealSymbolLibrary() {
  const symbols = findInstalledSymbolLibraryDirectory();
  const previous = {
    KICAD_SYMBOL_DIR: process.env.KICAD_SYMBOL_DIR,
    KICAD10_SYMBOL_DIR: process.env.KICAD10_SYMBOL_DIR
  };
  process.env.KICAD_SYMBOL_DIR = symbols;
  process.env.KICAD10_SYMBOL_DIR = symbols;
  return () => {
    restoreProcessEnv('KICAD_SYMBOL_DIR', previous.KICAD_SYMBOL_DIR);
    restoreProcessEnv('KICAD10_SYMBOL_DIR', previous.KICAD10_SYMBOL_DIR);
  };
}

test('real KiCad ERC of a discrete LED schematic reports zero errors', { skip: realDiscreteLedSkipReason(), timeout: 180_000 }, async () => {
  const prompts = [
    'LED 하나와 330옴 저항을 5V에 연결하는 간단한 회로 만들어줘',
    'three red LEDs on 3.3V',
    'white LED on 12V',
    'LED on 9V battery',
    'LED on 24V',
    'blue LED on 3V',
    'red LED on 3V',
    'LED on 7.4V'
  ];
  const restore = useRealSymbolLibrary();
  try {
    for (const prompt of prompts) {
      const projectDir = await mkdtemp(path.join(tmpdir(), 'chatpcb-led-erc-'));
      try {
        const generated = await generateMcuPeripheralProject({
          projectDir,
          prompt,
          projectName: 'discrete_led'
        });
        const validation = await validateProject({
          projectDir,
          schematicPath: generated.files.schematic
        });
        assert.equal(validation.skipped, false, prompt);
        assert.equal(validation.erc.errorCount, 0, `${prompt} ${JSON.stringify(validation.erc)}`);
        assert.equal(validation.erc.warningCount, 0, `${prompt} ${JSON.stringify(validation.erc)}`);
        assert.equal(validation.erc.byType?.power_pin_not_driven ?? 0, 0, prompt);
        assert.equal(validation.erc.byType?.same_local_global_label ?? 0, 0, prompt);
        assert.equal(validation.ok, true, prompt);
        const schematicText = await readFile(generated.files.schematic, 'utf8');
        if (prompt === 'LED on 24V') {
          assert.match(schematicText, /power:\+24V/, prompt);
        }
        if (prompt === 'LED on 7.4V') {
          assert.match(schematicText, /power:VCC/, prompt);
          assert.match(schematicText, /\+7V4/, prompt);
          assert.equal(schematicText.includes('power:+7.5V'), false, prompt);
          assert.equal(schematicText.includes('(label "+7V4")'), false, prompt);
        }
        if (prompt === 'blue LED on 3V') {
          assert.equal(schematicText.includes('Device:LED'), false, prompt);
          assert.equal(schematicText.includes('power:VCC'), false, prompt);
          assert.equal(/placeholder/i.test(schematicText), false, prompt);
          assert.match(schematicText, /not above/i, prompt);
        }
        if (prompt === 'red LED on 3V') {
          assert.match(schematicText, /power:VCC/, prompt);
          assert.match(schematicText, /Device:LED/, prompt);
          assert.equal(schematicText.includes('power:+3V0'), false, prompt);
          assert.equal(schematicText.includes('(symbol "power:+3V"'), false, prompt);
        }
      } finally {
        await rm(projectDir, { force: true, recursive: true });
      }
    }
  } finally {
    restore();
  }
});

test('approving a discrete LED preview applies the schematic after real ERC', { skip: realDiscreteLedSkipReason(), timeout: 180_000 }, async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'chatpcb-led-apply-'));
  const stateRoot = await mkdtemp(path.join(tmpdir(), 'chatpcb-led-journal-'));
  const registry = createPatchApprovalRegistry();
  const services = {
    stateRoot,
    patchApprovalRegistry: registry,
    projectMutexRegistry: createProjectMutexRegistry(),
    transactionJournal: createTransactionJournal({ stateRoot }),
    verifyAppliedProjectImpl: null
  };
  const restore = useRealSymbolLibrary();
  try {
    const created = await dispatchToolCall({
      name: 'project.create',
      args: { workspaceRoot: workspace, projectName: 'Discrete LED' }
    }, services);
    assert.equal(created.ok, true, created.error?.message);
    const projectDir = created.result.projectDir;
    const preview = await dispatchToolCall({
      name: 'schematic.generate',
      args: {
        projectDir,
        prompt: 'LED 하나와 330옴 저항을 5V에 연결하는 간단한 회로 만들어줘'
      }
    }, services);
    assert.equal(preview.ok, true, preview.error?.message);
    assert.equal(preview.result.applied, false);
    assert.equal(
      preview.result.candidateVerification?.erc?.status,
      'passed',
      JSON.stringify(preview.result.candidateVerification ?? preview.result.review)
    );
    const approved = await dispatchToolCall({
      name: 'schematic.patch',
      args: { projectDir, approved: true, patchId: preview.result.patchId }
    }, services);
    assert.equal(approved.ok, true, approved.error?.message);
    assert.equal(approved.result.applied, true, JSON.stringify(approved.result.reason ?? approved.result));
    assert.notEqual(approved.result.reason?.code, 'PATCH_CANDIDATE_UNVERIFIED');
    const names = await readdir(projectDir);
    const schematicName = names.find((name) => name.endsWith('.kicad_sch'));
    assert.ok(schematicName, `schematic was not written: ${names.join(', ')}`);
    const schematic = await readFile(path.join(projectDir, schematicName), 'utf8');
    assert.match(schematic, /Device:LED/);
    assert.match(schematic, /330Ω/);
  } finally {
    restore();
    registry.disposeAll();
    await rm(workspace, { force: true, recursive: true });
    await rm(stateRoot, { force: true, recursive: true });
  }
});

function topLevelPowerSymbol(source, name) {
  const marker = `(symbol "${name}"`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing power symbol ${name}`);
  const next = source.indexOf('\n  (symbol "', start + marker.length);
  return source.slice(start, next === -1 ? source.length : next);
}
