import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mcuNeedFromContext,
  resolveSourcedParts,
  searchMouserKeyword,
  searchParts,
  scorePart
} from '../src/runtime/part-sourcing.js';

test('Mouser-index search picks the cheaper spec-fit ESP32 module, not a dump of every chip', () => {
  const iot = searchParts({ role: 'mcu-module', need: { wifi: true, ble: true, psram: false, usbOtg: false } });
  assert.equal(iot[0].recommended, true);
  assert.match(iot[0].mpn, /ESP32-C3-WROOM/);
  assert.ok(iot[0].unitPriceUsd < 3);
  assert.ok(iot.every((item) => item.role === 'mcu-module'));

  const hmi = searchParts({
    role: 'mcu-module',
    need: { wifi: true, psram: true, usbOtg: true, rgbLcd: true, twai: true }
  });
  assert.match(hmi[0].mpn, /ESP32-S3-WROOM-1-N8R2/);
  assert.ok(hmi[0].unitPriceUsd < searchParts({ role: 'mcu-module', need: { psram: true } }).find((item) => /N16R8/.test(item.mpn)).unitPriceUsd);
});

test('3.3V CAN search ranks by unit price and extra BOM, never RS-485', () => {
  const parts = searchParts({ role: 'can-3v3' });
  assert.equal(parts[0].recommended, true);
  assert.match(parts[0].mpn, /TCAN334/);
  assert.ok(parts[0].unitPriceUsd <= parts.at(-1).unitPriceUsd || parts[0].extraBomParts < parts.at(-1).extraBomParts);
  assert.ok(parts.every((item) => !/MAX485|RS-485/i.test(item.mpn)));
});

test('live Mouser results overwrite index prices when the API returns parts', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      SearchResults: {
        Parts: [
          {
            ManufacturerPartNumber: 'TCAN334DR',
            Manufacturer: 'Texas Instruments',
            Availability: '1234 In Stock',
            PriceBreaks: [{ Price: '0.91' }]
          }
        ]
      }
    })
  });
  const live = await searchMouserKeyword('3.3V CAN', { apiKey: 'test-key', fetchImpl });
  assert.equal(live.source, 'mouser');
  assert.equal(live.parts[0].mpn, 'TCAN334DR');
  assert.equal(live.parts[0].unitPriceUsd, 0.91);
  assert.ok(scorePart(live.parts[0]) < scorePart({ ...live.parts[0], unitPriceUsd: 4 }));
});

test('live Mouser ranking keeps spec-fit parts and does not prefer off-spec cheap hits', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      SearchResults: {
        Parts: [
          {
            ManufacturerPartNumber: 'CHEAP-NO-WIFI',
            Manufacturer: 'Generic',
            Availability: '99999 In Stock',
            PriceBreaks: [{ Price: '0.10' }]
          },
          {
            ManufacturerPartNumber: 'ESP32-S3-WROOM-1-N8R2',
            Manufacturer: 'Espressif',
            Availability: '6400 In Stock',
            PriceBreaks: [{ Price: '4.12' }]
          }
        ]
      }
    })
  });
  const result = await resolveSourcedParts({
    role: 'mcu-module',
    need: { wifi: true, psram: true, usbOtg: true, rgbLcd: true },
    query: 'ESP32-S3-WROOM-1-N8R2',
    apiKey: 'test-key',
    fetchImpl
  });
  assert.equal(result.parts[0].mpn, 'ESP32-S3-WROOM-1-N8R2');
  assert.ok(result.parts.every((item) => item.mpn !== 'CHEAP-NO-WIFI'));
});

test('MCU need from a display+CAN prompt requires PSRAM and TWAI', () => {
  const need = mcuNeedFromContext({
    prompt: 'ESP32와 7인치 터치디스플레이, CAN트랜시버',
    answers: { 'mcu-board.memory': 'psram', 'mcu-board.usb': 'native-usb' }
  });
  assert.equal(need.psram, true);
  assert.equal(need.twai, true);
  assert.equal(need.rgbLcd, true);
});
