import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { generateMcuPeripheralProject } from '../src/workflow/generate-mcu-project.js';

test('ESP32-S3 supported sensor profile expands requested SWD into ESP32 debug nets and full interfaces', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-esp32-profile-'));

  try {
    const result = await generateMcuPeripheralProject({
      projectDir: root,
      prompt:
        'Release profile ESP32-S3 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED.'
    });

    const metadata = JSON.parse(await readFile(result.files.spec, 'utf8'));
    const nets = metadata.schematic.nets.map((net) => net.name);
    const refs = metadata.schematic.components.map((component) => component.ref);
    const mcu = metadata.schematic.components.find((component) => component.ref === 'U2');
    const componentValues = new Map(metadata.schematic.components.map((component) => [component.ref, component.value]));
    const schematic = await readFile(result.files.schematic, 'utf8');
    const symbolLibrary = await readFile(result.files.symbolLibrary, 'utf8');

    assert.equal(metadata.boardProfile.id, 'esp32-s3-usbc-sensor');
    assert.equal(metadata.mcu.package, 'ESP32-S3-WROOM-1-N8R2');
    assert.equal(mcu.footprint, 'RF_Module:ESP32-S3-WROOM-1');
    assert.ok(Array.isArray(metadata.boardProfile.releaseGates));
    assert.equal(metadata.boardProfile.releaseGates.find((gate) => gate.id === 'sourcing').status, 'pending');
    assert.equal(metadata.boardProfile.releaseGates.find((gate) => gate.id === 'layout-drc').status, 'pending');
    assertProductionEvidence(metadata, {
      mcuRef: 'U2',
      mcuValue: 'ESP32-S3-WROOM-1-N8R2',
      debugRole: 'esp32-usb-jtag-header'
    });
    assert.match(schematic, /\(lib_id "ChatPCB:ESP32_S3_WROOM_1"\)/);
    assert.doesNotMatch(schematic, /MCU_PLACEHOLDER/);
    assert.doesNotMatch(schematic, /\(lib_id "ChatPCB:(REGULATOR_3V3|RESET_BUTTON|BOOT_BUTTON|STATUS_LED|I2C_CONNECTOR|UART_HEADER|USB_C_CONNECTOR|SPI_HEADER|GPIO_HEADER|DEBUG_HEADER|DECOUPLING_CAP|CC_RESISTOR|LED_RESISTOR|I2C_PULLUP)"\)/);
    assert.match(schematic, /\(lib_id "power:PWR_FLAG"\)/);
    assert.match(schematic, /\(lib_id "Regulator_Linear:TC1262-33"\)/);
    assert.match(schematic, /\(lib_id "Device:R"\)/);
    assert.match(schematic, /\(lib_id "Device:C"\)/);
    assert.match(schematic, /\(lib_id "Device:LED"\)/);
    assert.match(schematic, /\(lib_id "Switch:SW_Push"\)/);
    assert.match(schematic, /\(lib_id "Connector:USB_C_Receptacle_USB2\.0_16P"\)/);
    assert.match(schematic, /\(lib_id "Connector_Generic:Conn_01x04"\)/);
    assert.match(schematic, /\(lib_id "Connector_Generic:Conn_01x05"\)/);
    assert.match(schematic, /\(lib_id "Connector_Generic:Conn_01x06"\)/);
    assert.match(schematic, /\(lib_id "Connector_Generic:Conn_02x05_Odd_Even"\)/);
    assert.match(schematic, /\(symbol "Device:R"/);
    assert.match(schematic, /\(property "Description" "Resistor"/);
    assert.match(schematic, /\(symbol "Device:C"/);
    assert.match(schematic, /\(property "Description" "Unpolarized capacitor"/);
    assert.match(schematic, /\(symbol "Regulator_Linear:TC1262-33"/);
    assert.match(schematic, /\(property "Description" "500mA Low Dropout CMOS Voltage Regulator, Fixed Output 3\.3V, TO-220\/SOT-223\/TO-263"/);
    assert.doesNotMatch(schematic, /\(symbol "Regulator_Linear:AMS1117-3\.3"/);
    assert.doesNotMatch(schematic, /\(extends "AP1117-15"\)/);
    assert.match(schematic, /\(wire\s+\(pts\s+\(xy 76\.20 96\.52\) \(xy 76\.20 101\.60\)\)[\s\S]*?\(label "GND"\s+\(at 76\.20 101\.60 90\)/);
    assert.match(schematic, /\(symbol "Connector:USB_C_Receptacle_USB2\.0_16P"/);
    assert.doesNotMatch(schematic, /\(symbol "Device:R"[\s\S]*?\(rectangle\s+\(start -7\.62 6\.35\)/);
    assert.match(symbolLibrary, /\(symbol "ESP32_S3_WROOM_1"/);
    assert.doesNotMatch(symbolLibrary, /\(symbol "REGULATOR_3V3"/);
    assert.doesNotMatch(symbolLibrary, /\(symbol "CC_RESISTOR"/);
    assert.doesNotMatch(symbolLibrary, /\(symbol "ESP32_S3_WROOM_1_N8R2"/);
    assert.equal(metadata.debug.requestedProtocol, 'swd');
    assert.equal(metadata.debug.implementedProtocol, 'esp32-usb-jtag');
    assert.deepEqual(metadata.debug.nets, ['USB_DP', 'USB_DN', 'MTMS', 'MTCK', 'MTDI', 'MTDO']);
    assert.ok(nets.includes('USB_DP'));
    assert.ok(nets.includes('USB_DN'));
    assert.ok(nets.includes('CC1'));
    assert.ok(nets.includes('CC2'));
    assert.ok(nets.includes('SCK'));
    assert.ok(nets.includes('MOSI'));
    assert.ok(nets.includes('MISO'));
    assert.ok(nets.includes('CS'));
    assert.ok(nets.includes('GPIO0'));
    assert.ok(nets.includes('MTMS'));
    assert.ok(nets.includes('MTCK'));
    assert.ok(!nets.includes('SWDIO'));
    assert.ok(!nets.includes('SWCLK'));
    assert.ok(refs.includes('C1'));
    assert.ok(refs.includes('C2'));
    assert.ok(refs.includes('R1'));
    assert.ok(refs.includes('R2'));
    assert.ok(refs.includes('R3'));
    assert.ok(refs.includes('R4'));
    assert.ok(refs.includes('R5'));
    assert.ok(refs.includes('#FLG1'));
    assert.ok(refs.includes('#FLG2'));
    assert.equal(componentValues.get('#FLG1'), 'PWR_FLAG');
    assert.equal(componentValues.get('#FLG2'), 'PWR_FLAG');
    assert.equal(componentValues.get('R3'), '1k');
    assert.equal(componentValues.get('R4'), '4.7k');
    assert.equal(componentValues.get('R5'), '4.7k');
    assert.ok(!result.review.findings.warnings.some((finding) => finding.code === 'profile-support-symbols'));
    assert.ok(result.review.findings.warnings.some((finding) => finding.code === 'profile-sourcing-review'));
    assert.ok(result.review.findings.warnings.some((finding) => finding.code === 'release-gates-incomplete'));
    assert.ok(!result.review.residualRisks.some((risk) => /production KiCad symbols/i.test(risk)));
    assert.ok(result.review.residualRisks.some((risk) => /U1 TC1262-33/i.test(risk)));
    assert.ok(result.review.residualRisks.some((risk) => /calculation-blocker: regulator-thermal-budget .*0\.85W/i.test(risk)));
    assert.ok(result.review.residualRisks.some((risk) => /calculation-warning: i2c-pullup-rise-time .*398ns/i.test(risk)));
    assert.ok(result.review.residualRisks.some((risk) => /layout DRC/i.test(risk)));
    assert.ok(result.review.findings.notes.some((finding) => /SWD request was mapped/i.test(finding.message)));
    assert.ok(!result.review.findings.blockers.some((finding) => finding.code === 'missing-swd'));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('STM32 supported sensor profile keeps the same board structure but implements SWD directly', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-stm32-profile-'));

  try {
    const result = await generateMcuPeripheralProject({
      projectDir: root,
      prompt:
        'Release profile STM32 USB-C 5V sensor board with 3.3V 500mA regulator, I2C sensor connector, UART debug header, SWD, USB, SPI, GPIO header, reset button, and status LED.'
    });

    const metadata = JSON.parse(await readFile(result.files.spec, 'utf8'));
    const nets = metadata.schematic.nets.map((net) => net.name);
    const refs = metadata.schematic.components.map((component) => component.ref);
    const componentValues = new Map(metadata.schematic.components.map((component) => [component.ref, component.value]));
    const schematic = await readFile(result.files.schematic, 'utf8');

    assert.equal(metadata.boardProfile.id, 'stm32-usbc-sensor');
    assert.equal(metadata.mcu.package, 'STM32G0B1CBT6');
    assert.ok(Array.isArray(metadata.boardProfile.releaseGates));
    assert.equal(metadata.boardProfile.releaseGates.find((gate) => gate.id === 'sourcing').status, 'pending');
    assert.equal(metadata.boardProfile.releaseGates.find((gate) => gate.id === 'layout-drc').status, 'pending');
    assertProductionEvidence(metadata, {
      mcuRef: 'U2',
      mcuValue: 'STM32G0B1CBT6',
      debugRole: 'swd-header'
    });
    assert.match(schematic, /\(lib_id "ChatPCB:STM32G0B1CBT6"\)/);
    assert.doesNotMatch(schematic, /MCU_PLACEHOLDER/);
    assert.doesNotMatch(schematic, /\(lib_id "ChatPCB:(REGULATOR_3V3|RESET_BUTTON|BOOT_BUTTON|STATUS_LED|I2C_CONNECTOR|UART_HEADER|USB_C_CONNECTOR|SPI_HEADER|GPIO_HEADER|DEBUG_HEADER|DECOUPLING_CAP|CC_RESISTOR|LED_RESISTOR|I2C_PULLUP)"\)/);
    assert.match(schematic, /\(lib_id "power:PWR_FLAG"\)/);
    assert.match(schematic, /\(lib_id "Regulator_Linear:TC1262-33"\)/);
    assert.match(schematic, /\(lib_id "Device:R"\)/);
    assert.match(schematic, /\(lib_id "Device:C"\)/);
    assert.match(schematic, /\(lib_id "Device:LED"\)/);
    assert.match(schematic, /\(lib_id "Switch:SW_Push"\)/);
    assert.match(schematic, /\(lib_id "Connector:USB_C_Receptacle_USB2\.0_16P"\)/);
    assert.match(schematic, /\(lib_id "Connector_Generic:Conn_01x04"\)/);
    assert.match(schematic, /\(lib_id "Connector_Generic:Conn_01x05"\)/);
    assert.match(schematic, /\(lib_id "Connector_Generic:Conn_01x06"\)/);
    assert.match(schematic, /\(lib_id "Connector_Generic:Conn_02x05_Odd_Even"\)/);
    assert.match(schematic, /\(symbol "Device:R"/);
    assert.match(schematic, /\(property "Description" "Resistor"/);
    assert.match(schematic, /\(symbol "Device:C"/);
    assert.match(schematic, /\(property "Description" "Unpolarized capacitor"/);
    assert.match(schematic, /\(symbol "Regulator_Linear:TC1262-33"/);
    assert.match(schematic, /\(property "Description" "500mA Low Dropout CMOS Voltage Regulator, Fixed Output 3\.3V, TO-220\/SOT-223\/TO-263"/);
    assert.doesNotMatch(schematic, /\(symbol "Regulator_Linear:AMS1117-3\.3"/);
    assert.doesNotMatch(schematic, /\(extends "AP1117-15"\)/);
    assert.match(schematic, /\(wire\s+\(pts\s+\(xy 76\.20 96\.52\) \(xy 76\.20 101\.60\)\)[\s\S]*?\(label "GND"\s+\(at 76\.20 101\.60 90\)/);
    assert.match(schematic, /\(symbol "Connector:USB_C_Receptacle_USB2\.0_16P"/);
    assert.doesNotMatch(schematic, /\(symbol "Device:R"[\s\S]*?\(rectangle\s+\(start -7\.62 6\.35\)/);
    assert.equal(metadata.debug.requestedProtocol, 'swd');
    assert.equal(metadata.debug.implementedProtocol, 'swd');
    assert.deepEqual(metadata.debug.nets, ['SWDIO', 'SWCLK', 'NRST']);
    assert.ok(nets.includes('USB_DP'));
    assert.ok(nets.includes('USB_DN'));
    assert.ok(nets.includes('SCK'));
    assert.ok(nets.includes('MOSI'));
    assert.ok(nets.includes('MISO'));
    assert.ok(nets.includes('CS'));
    assert.ok(nets.includes('GPIO0'));
    assert.ok(nets.includes('SWDIO'));
    assert.ok(nets.includes('SWCLK'));
    assert.ok(!nets.includes('MTMS'));
    assert.ok(refs.includes('R3'));
    assert.ok(refs.includes('R4'));
    assert.ok(refs.includes('R5'));
    assert.ok(refs.includes('#FLG1'));
    assert.ok(refs.includes('#FLG2'));
    assert.equal(componentValues.get('#FLG1'), 'PWR_FLAG');
    assert.equal(componentValues.get('#FLG2'), 'PWR_FLAG');
    assert.equal(componentValues.get('R3'), '1k');
    assert.equal(componentValues.get('R4'), '4.7k');
    assert.equal(componentValues.get('R5'), '4.7k');
    assert.ok(!result.review.findings.warnings.some((finding) => finding.code === 'profile-support-symbols'));
    assert.ok(result.review.findings.warnings.some((finding) => finding.code === 'profile-sourcing-review'));
    assert.ok(result.review.findings.warnings.some((finding) => finding.code === 'release-gates-incomplete'));
    assert.ok(!result.review.residualRisks.some((risk) => /production KiCad symbols/i.test(risk)));
    assert.ok(result.review.residualRisks.some((risk) => /U1 TC1262-33/i.test(risk)));
    assert.ok(result.review.residualRisks.some((risk) => /calculation-blocker: regulator-thermal-budget .*0\.85W/i.test(risk)));
    assert.ok(result.review.residualRisks.some((risk) => /calculation-warning: i2c-pullup-rise-time .*398ns/i.test(risk)));
    assert.ok(result.review.residualRisks.some((risk) => /layout DRC/i.test(risk)));
    assert.ok(result.review.findings.notes.some((finding) => /supported STM32 USB-C sensor profile/i.test(finding.message)));
    assert.ok(!result.review.findings.blockers.some((finding) => finding.code.startsWith('missing-')));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

function assertProductionEvidence(metadata, { mcuRef, mcuValue, debugRole }) {
  const parts = metadata.boardProfile.productionParts;
  assert.ok(Array.isArray(parts), 'supported profiles should publish production part evidence');

  const byRef = new Map(parts.map((part) => [part.ref, part]));
  assert.equal(byRef.get(mcuRef)?.value, mcuValue);
  assert.equal(byRef.get('U1')?.value, 'TC1262-33');
  assert.equal(byRef.get('U1')?.role, '3v3-regulator');
  assert.equal(byRef.get('J4')?.role, 'usb-c-connector');
  assert.equal(byRef.get('J7')?.role, debugRole);
  assert.equal(byRef.get('R1')?.value, '5.1k');
  assert.equal(byRef.get('R2')?.value, '5.1k');
  assert.equal(byRef.get('R4')?.value, '4.7k');
  assert.equal(byRef.get('R5')?.value, '4.7k');

  for (const part of parts) {
    assert.equal(part.releaseChecks.sourcing.status, 'pending', `${part.ref} should require sourcing evidence`);
    assert.equal(part.releaseChecks.datasheet.status, 'pending', `${part.ref} should require datasheet evidence`);
  }

  assert.deepEqual(
    metadata.boardProfile.releaseEvidence.requiredChecks,
    ['sourcing', 'datasheet', 'simulation', 'layoutDrc']
  );
  assert.equal(metadata.boardProfile.releaseEvidence.status, 'incomplete');

  const calculations = metadata.boardProfile.releaseEvidence.calculations;
  assert.ok(Array.isArray(calculations), 'supported profiles should publish calculation evidence');

  const byId = new Map(calculations.map((calculation) => [calculation.id, calculation]));
  assert.equal(byId.get('status-led-current')?.status, 'pass');
  assert.match(byId.get('status-led-current')?.result ?? '', /1\.3mA/);
  assert.equal(byId.get('usb-c-cc-pulldown-current')?.status, 'pass');
  assert.match(byId.get('usb-c-cc-pulldown-current')?.result ?? '', /0\.98mA/);
  assert.equal(byId.get('i2c-pullup-rise-time')?.status, 'warning');
  assert.match(byId.get('i2c-pullup-rise-time')?.result ?? '', /398ns/);
  assert.equal(byId.get('regulator-thermal-budget')?.status, 'blocker');
  assert.match(byId.get('regulator-thermal-budget')?.result ?? '', /0\.85W/);
}
