import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeCircuitSpec } from '../src/runtime/circuit-spec.js';

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

test('normalizes USB data nets to KiCad-safe profile names', () => {
  const spec = normalizeCircuitSpec('USB-C sensor board with USB data.');
  const usb = spec.interfaces.find((iface) => iface.kind === 'usb');

  assert.deepEqual(usb.pins, ['VBUS', 'USB_DP', 'USB_DN', 'GND', 'CC1', 'CC2']);
});
