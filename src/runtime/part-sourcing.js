const MOUSER_KEYWORD_URL = 'https://api.mouser.com/api/v1/search/keyword';

export const PART_INDEX = [
  part('ESP32-C3-WROOM-02-N4', 'Espressif', 'mcu-module', 1.78, {
    keywords: ['esp32', 'c3', 'wifi', 'ble', 'wroom', 'iot'],
    caps: { wifi: true, ble: true, psram: false, usbOtg: false, twai: true, rgbLcd: false },
    extraBomParts: 0,
    stockQty: 12000,
    searchKeyword: 'ESP32-C3-WROOM-02'
  }),
  part('ESP32-S3-WROOM-1-N8', 'Espressif', 'mcu-module', 3.15, {
    keywords: ['esp32', 's3', 'wifi', 'ble', 'usb', 'wroom'],
    caps: { wifi: true, ble: true, psram: false, usbOtg: true, twai: true, rgbLcd: true },
    extraBomParts: 0,
    stockQty: 8000,
    searchKeyword: 'ESP32-S3-WROOM-1-N8'
  }),
  part('ESP32-S3-WROOM-1-N8R2', 'Espressif', 'mcu-module', 4.12, {
    keywords: ['esp32', 's3', 'wifi', 'ble', 'usb', 'psram', 'wroom', 'display'],
    caps: { wifi: true, ble: true, psram: true, usbOtg: true, twai: true, rgbLcd: true },
    extraBomParts: 0,
    stockQty: 6400,
    searchKeyword: 'ESP32-S3-WROOM-1-N8R2'
  }),
  part('ESP32-S3-WROOM-1-N16R8', 'Espressif', 'mcu-module', 5.84, {
    keywords: ['esp32', 's3', 'psram', 'usb', 'display', 'camera'],
    caps: { wifi: true, ble: true, psram: true, usbOtg: true, twai: true, rgbLcd: true },
    extraBomParts: 0,
    stockQty: 2100,
    searchKeyword: 'ESP32-S3-WROOM-1-N16R8'
  }),
  part('STM32G0B1CBT6', 'STMicroelectronics', 'mcu-module', 2.41, {
    keywords: ['stm32', 'g0', 'usb', 'can', 'no-radio'],
    caps: { wifi: false, ble: false, psram: false, usbOtg: true, twai: true, rgbLcd: false },
    extraBomParts: 2,
    stockQty: 15000,
    searchKeyword: 'STM32G0B1CBT6'
  }),
  part('TCAN334DR', 'Texas Instruments', 'can-3v3', 1.08, {
    keywords: ['can', 'transceiver', '3.3v', 'tcan'],
    extraBomParts: 2,
    stockQty: 9800,
    searchKeyword: '3.3V CAN transceiver'
  }),
  part('SN65HVD230DR', 'Texas Instruments', 'can-3v3', 1.72, {
    keywords: ['can', 'transceiver', '3.3v', 'hvd230'],
    extraBomParts: 2,
    stockQty: 22000,
    searchKeyword: 'SN65HVD230'
  }),
  part('TJA1051T/3', 'NXP', 'can-5v', 0.86, {
    keywords: ['can', 'transceiver', '5v', 'tja1051'],
    extraBomParts: 3,
    stockQty: 18000,
    searchKeyword: 'TJA1051 5V CAN'
  }),
  part('ISO1042BDWV', 'Texas Instruments', 'can-isolated', 3.94, {
    keywords: ['can', 'isolated', 'iso1042'],
    extraBomParts: 4,
    stockQty: 4300,
    searchKeyword: 'ISO1042 isolated CAN'
  }),
  part('M24C64-WMN6TP', 'STMicroelectronics', 'eeprom-i2c', 0.34, {
    keywords: ['eeprom', 'm24c64', 'i2c', 'adbms'],
    extraBomParts: 0,
    stockQty: 40000,
    searchKeyword: 'M24C64 I2C EEPROM'
  }),
  part('CAT24C64WI-GT3', 'onsemi', 'eeprom-i2c', 0.29, {
    keywords: ['eeprom', 'cat24c64', 'i2c'],
    extraBomParts: 0,
    stockQty: 25000,
    searchKeyword: 'CAT24C64 I2C EEPROM'
  }),
  part('USBLC6-2SC6', 'STMicroelectronics', 'usb-esd', 0.41, {
    keywords: ['usb', 'esd', 'usblc6'],
    extraBomParts: 0,
    stockQty: 30000,
    searchKeyword: 'USBLC6-2 USB ESD'
  }),
  part('PRTR5V0U2X', 'Nexperia', 'usb-esd', 0.37, {
    keywords: ['usb', 'esd', 'prtr'],
    extraBomParts: 0,
    stockQty: 12000,
    searchKeyword: 'USB ESD TVS'
  }),
  part('PESD1CAN', 'Nexperia', 'can-tvs', 0.22, {
    keywords: ['can', 'tvs', 'pesd1can'],
    extraBomParts: 0,
    stockQty: 50000,
    searchKeyword: 'PESD1CAN'
  }),
  part('TP4056', 'Generic / TC', 'charger-1s', 0.24, {
    keywords: ['tp4056', '18650', 'charger', '1s'],
    extraBomParts: 2,
    stockQty: 80000,
    searchKeyword: 'TP4056 1S charger'
  }),
  part('BQ24074RGTR', 'Texas Instruments', 'charger-1s', 1.76, {
    keywords: ['bq24074', '18650', 'charger', '1s'],
    extraBomParts: 1,
    stockQty: 9000,
    searchKeyword: 'BQ24074 Li-ion charger'
  }),
  part('TPS63802DLAR', 'Texas Instruments', 'buck-boost', 1.18, {
    keywords: ['tps63802', 'buck-boost', '18650', '3.3v'],
    extraBomParts: 4,
    stockQty: 7500,
    searchKeyword: 'TPS63802 buck-boost 3.3V'
  }),
  part('TPS62177DQCR', 'Texas Instruments', 'buck-3v3', 0.92, {
    keywords: ['tps62177', 'buck', '3.3v', 'usb'],
    extraBomParts: 3,
    stockQty: 11000,
    searchKeyword: 'TPS62177 3.3V buck'
  })
];

function part(mpn, manufacturer, role, unitPriceUsd, extra = {}) {
  return {
    mpn,
    manufacturer,
    role,
    unitPriceUsd,
    currency: 'USD',
    moq: extra.moq ?? 1,
    extraBomParts: extra.extraBomParts ?? 0,
    stockQty: extra.stockQty ?? 0,
    availability: extra.availability ?? (extra.stockQty > 0 ? 'in-stock' : 'unknown'),
    lifecycle: extra.lifecycle ?? 'active',
    keywords: extra.keywords ?? [],
    caps: extra.caps ?? {},
    searchKeyword: extra.searchKeyword ?? mpn,
    priceSource: extra.priceSource ?? 'mouser-index',
    datasheet: extra.datasheet ?? null
  };
}

function meetsNeed(item, need = {}) {
  const caps = item.caps ?? {};
  if (need.wifi && !caps.wifi) return false;
  if (need.ble && !caps.ble) return false;
  if (need.psram && !caps.psram) return false;
  if (need.usbOtg && !caps.usbOtg) return false;
  if (need.twai && !caps.twai) return false;
  if (need.rgbLcd && !caps.rgbLcd) return false;
  if (need.noRadio && (caps.wifi || caps.ble)) return false;
  return true;
}

export function scorePart(item) {
  const stockPenalty = item.availability === 'in-stock' || item.stockQty > 0 ? 0 : 8;
  const lifecyclePenalty = item.lifecycle === 'active' ? 0 : 6;
  const moqPenalty = Math.max(0, (item.moq ?? 1) - 1) * 0.05;
  const extra = (item.extraBomParts ?? 0) * 0.45;
  const scarcity = item.stockQty > 0 ? 0 : 1;
  return (item.unitPriceUsd ?? 99) + extra + stockPenalty + lifecyclePenalty + moqPenalty + scarcity;
}

export function searchParts({ role, need = {}, query = '', limit = 4 } = {}) {
  const needle = String(query ?? '').toLowerCase();
  let pool = PART_INDEX.filter((item) => {
    if (role && item.role !== role) return false;
    if (needle && !`${item.mpn} ${item.keywords.join(' ')} ${item.searchKeyword}`.toLowerCase().includes(needle.split(/\s+/)[0])) {
      const tokens = needle.split(/\s+/).filter(Boolean);
      const hay = `${item.mpn} ${item.manufacturer} ${item.keywords.join(' ')}`.toLowerCase();
      if (!tokens.some((token) => hay.includes(token))) return false;
    }
    return true;
  });
  if (role && pool.length === 0) pool = PART_INDEX.filter((item) => item.role === role);
  const fit = pool.filter((item) => meetsNeed(item, need));
  const ranked = (fit.length ? fit : pool).slice().sort((left, right) => scorePart(left) - scorePart(right));
  return ranked.slice(0, limit).map((item, index) => ({
    ...item,
    recommended: index === 0,
    score: Number(scorePart(item).toFixed(3)),
    source: item.priceSource ?? 'mouser-index'
  }));
}

export function mcuNeedFromContext(ctx = {}) {
  const prompt = ctx.prompt ?? '';
  const radio = String(ctx.answers?.['mcu-board.radio'] ?? '');
  const usb = String(ctx.answers?.['mcu-board.usb'] ?? '');
  const memory = String(ctx.answers?.['mcu-board.memory'] ?? '');
  const ioNeeds = String(ctx.answers?.['mcu-board.ioNeeds'] ?? '');
  const blob = `${prompt}\n${radio}\n${usb}\n${memory}\n${ioNeeds}`;
  if (/none|무선 없음/i.test(radio) || (/stm32/i.test(prompt) && !/esp32/i.test(prompt))) {
    return { noRadio: true, usbOtg: /usb/i.test(blob), twai: /\bcan\b|캔/i.test(blob) };
  }
  return {
    wifi: !/none|무선 없음|wifi only/i.test(radio) || /wifi|esp32/i.test(blob),
    ble: /ble|블루투스|wifi-ble|esp32/i.test(blob),
    psram: /psram|디스플레이|display|카메라|7\s*인치|rgb/i.test(blob),
    usbOtg: /native-usb|usb-c|USB-JTAG|usb/i.test(blob),
    twai: /\bcan\b|캔|twai/i.test(blob),
    rgbLcd: /디스플레이|display|rgb|7\s*인치/i.test(blob)
  };
}

export function canRoleFromContext(ctx = {}) {
  const voltage = String(ctx.answers?.['wired-comms.deviceVoltage'] ?? ctx.facts?.['wired-comms']?.deviceVoltage ?? ctx.prompt ?? '');
  if (/isolat|절연|12|24/i.test(voltage)) return 'can-isolated';
  if (/5v|5V CAN/i.test(voltage)) return 'can-5v';
  return 'can-3v3';
}

export function formatPartHelp(item, ko = true) {
  const extra = item.extraBomParts ?? 0;
  const price = item.unitPriceUsd != null ? `$${item.unitPriceUsd.toFixed(2)}` : 'n/a';
  if (ko) {
    return [
      `Mouser 검색 1pc ≈ ${price} · 추가 BOM ${extra}개 · 재고 ${item.stockQty || 0}`,
      `특징: ${item.manufacturer} ${item.mpn}. 스펙에 맞는 후보를 가격·부품수로 정렬했습니다.`,
      extra ? `장점: 단가. 단점: 주변 부품 ${extra}개가 더 필요합니다.` : '장점: 모듈이라 주변 부품이 적습니다. 단점: 모듈 단가가 칩만보다 높을 수 있음.',
      `출처: ${item.source === 'mouser' ? 'Mouser API' : 'Mouser형 인덱스(오프라인/무키)'} · 확정 발주 전 재검색 필요.`
    ].join('\n');
  }
  return [
    `Mouser 1pc ≈ ${price}; extra BOM ${extra}; stock ${item.stockQty || 0}`,
    `${item.manufacturer} ${item.mpn}, ranked by price and part count for the spec.`,
    extra ? `Pros: unit price. Cons: ${extra} extra support parts.` : 'Pros: module keeps BOM short. Cons: module may cost more than a bare IC.',
    `Source: ${item.source === 'mouser' ? 'Mouser API' : 'Mouser-shaped local index'}. Re-check before ordering.`
  ].join('\n');
}

export function partsToExamples(items, { koLabels = true } = {}) {
  return items.map((item) => ({
    id: item.mpn,
    labelKo: `${item.mpn} · $${item.unitPriceUsd.toFixed(2)}`,
    labelEn: `${item.mpn} · $${item.unitPriceUsd.toFixed(2)}`,
    promptKo: item.mpn,
    promptEn: item.mpn,
    helpKo: formatPartHelp(item, true),
    helpEn: formatPartHelp(item, false),
    recommended: item.recommended === true,
    sourcing: item
  }));
}

function parseMouserParts(payload) {
  const list = payload?.SearchResults?.Parts ?? payload?.SearchResponse?.Parts ?? [];
  return list.map((row) => {
    const priceBreaks = row.PriceBreaks ?? [];
    const unit = Number(String(priceBreaks[0]?.Price ?? '').replace(/[^0-9.]/g, '')) || null;
    return part(row.ManufacturerPartNumber || row.MouserPartNumber, row.Manufacturer, 'live', unit ?? 99, {
      stockQty: Number(String(row.Availability ?? '').replace(/[^0-9]/g, '')) || 0,
      availability: /in stock/i.test(row.Availability ?? '') ? 'in-stock' : 'unknown',
      datasheet: row.DataSheetUrl ?? null,
      extraBomParts: 0,
      keywords: [row.Description, row.ManufacturerPartNumber].filter(Boolean),
      priceSource: 'mouser',
      searchKeyword: row.ManufacturerPartNumber
    });
  }).filter((item) => item.mpn);
}

export async function searchMouserKeyword(keyword, options = {}) {
  const apiKey = options.apiKey ?? process.env.MOUSER_API_KEY;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!apiKey || typeof fetchImpl !== 'function' || !keyword) {
    return { source: 'skipped', parts: [] };
  }
  const url = `${MOUSER_KEYWORD_URL}?apiKey=${encodeURIComponent(apiKey)}`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      SearchByKeywordRequest: {
        keyword,
        records: options.records ?? 10,
        startingRecord: 0,
        searchOptions: 'RohsAndInStock'
      }
    })
  });
  if (!response?.ok) {
    throw new Error(`Mouser search failed: ${response?.status ?? 'no-response'}`);
  }
  const payload = await response.json();
  return { source: 'mouser', parts: parseMouserParts(payload) };
}

export async function resolveSourcedParts({ role, need = {}, query, fetchImpl, apiKey, limit = 4 } = {}) {
  const local = searchParts({ role, need, query, limit: 8 });
  const keyword = query || local[0]?.searchKeyword || role;
  try {
    const live = await searchMouserKeyword(keyword, { fetchImpl, apiKey });
    if (live.parts.length) {
      const merged = mergeParts(local, live.parts);
      const fit = merged.filter((item) => meetsNeed(item, need));
      const ranked = (fit.length ? fit : local).slice().sort((left, right) => scorePart(left) - scorePart(right)).slice(0, limit)
        .map((item, index) => ({ ...item, recommended: index === 0, source: item.priceSource ?? 'mouser', score: scorePart(item) }));
      return { source: 'mouser', parts: ranked };
    }
  } catch {
    // Keep the ranked local index when Mouser is unavailable.
  }
  return { source: 'mouser-index', parts: local.slice(0, limit) };
}

function mergeParts(local, live) {
  const byMpn = new Map();
  for (const item of [...local, ...live]) {
    const key = String(item.mpn).toUpperCase();
    const previous = byMpn.get(key);
    if (!previous) {
      byMpn.set(key, item);
      continue;
    }
    byMpn.set(key, {
      ...previous,
      ...item,
      unitPriceUsd: item.unitPriceUsd ?? previous.unitPriceUsd,
      stockQty: Math.max(previous.stockQty ?? 0, item.stockQty ?? 0),
      extraBomParts: previous.extraBomParts ?? item.extraBomParts ?? 0,
      caps: { ...item.caps, ...previous.caps },
      role: previous.role !== 'live' ? previous.role : item.role
    });
  }
  return [...byMpn.values()];
}

export function summarizeSourcing(partsByRole = {}, ko = true) {
  const lines = Object.entries(partsByRole).map(([role, item]) => {
    if (!item) return null;
    const extra = item.extraBomParts ?? 0;
    return ko
      ? `${role}: ${item.mpn} · $${Number(item.unitPriceUsd).toFixed(2)} · 추가BOM ${extra}`
      : `${role}: ${item.mpn} · $${Number(item.unitPriceUsd).toFixed(2)} · extra BOM ${extra}`;
  }).filter(Boolean);
  if (!lines.length) return '';
  return ko
    ? `Mouser 검색(가격·부품수) 결과:\n${lines.join('\n')}`
    : `Mouser search (price and part count):\n${lines.join('\n')}`;
}
