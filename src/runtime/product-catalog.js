import { matchSupportedProfile } from './board-profiles.js';
import {
  canRoleFromContext,
  mcuNeedFromContext,
  partsToExamples,
  searchParts
} from './part-sourcing.js';

function example(id, labelKo, labelEn = labelKo, helpKo = '', helpEn = '', recommended = false) {
  if (typeof helpEn === 'boolean') {
    recommended = helpEn;
    helpEn = helpKo;
  }
  return {
    id,
    labelKo,
    labelEn,
    promptKo: labelKo,
    promptEn: labelEn,
    helpKo,
    helpEn: helpEn || helpKo,
    recommended
  };
}

function voltages(prompt) {
  return [...(prompt ?? '').matchAll(/(\d+(?:\.\d+)?)\s*(?:vdc|vac|v)\b/gi)].map((match) => Number(match[1]));
}

function wantsCan(prompt) {
  return /\bcan\b|캔\s*트랜시버|can\s*transceiver/i.test(prompt ?? '');
}

function canPhyExamples(ctx) {
  if (!wantsCan(ctx.prompt) && !/5v|isolat|절연/i.test(String(ctx.answers?.['wired-comms.deviceVoltage'] ?? ''))) {
    return [
      example('MAX485', 'MAX485 RS-485', 'MAX485 RS-485', '특징: RS-485 반이중.\n장점: 긴 거리 멀티드롭.\n단점: CAN이 아님.', true)
    ];
  }
  return partsToExamples(searchParts({ role: canRoleFromContext(ctx), limit: 3 }));
}

function powerTopologyExamples(ctx) {
  const prompt = ctx.prompt ?? '';
  if (/18650|1s\s*18650|battery pack|배터리\s*팩|건전지|aa\s*batter/i.test(prompt)) {
    return [
      example(
        'boost-buck',
        '벅부스트 — 18650이 3.3V 아래로 떨어짐',
        'Buck-boost — 18650 sags below 3.3V',
        '특징: 셀 3.0–4.2V에서 MCU 3.3V를 유지.\n장점: 방전 말기에도 보드가 안 꺼짐. 열이 LDO보다 적음.\n단점: 부품·리플·코일 배치가 LDO보다 까다로움.',
        true
      ),
      example(
        'switching',
        '스위칭 벅 — 셀이 항상 3.3V 이상일 때만',
        'Switching buck — only if the cell stays above 3.3V',
        '특징: 높은 VIN에서만 3.3V로 내림.\n장점: 효율.\n단점: 1S 18650은 곧 3.3V 아래로 가서 리셋됨.'
      ),
      example(
        'ldo',
        'LDO — 원가 (드롭아웃 주의)',
        'LDO — cost (watch dropout)',
        '특징: 선형 강압.\n장점: 싸고 조용함.\n단점: (VIN-VOUT)×전류가 열. 셀이 3.3V 근처면 동작 불가.'
      )
    ];
  }
  return [
    example(
      'switching',
      '스위칭(벅) — 효율 우선',
      'Switching buck — efficiency first',
      '특징: 드롭이 커도 발열이 적음.\n장점: USB 5V→3.3V, 넓은 VIN에서 효율.\n단점: 리플·EMI·부품 수가 LDO보다 많음.',
      true
    ),
    example(
      'ldo',
      'LDO — 원가·저노이즈',
      'LDO — cost and low noise',
      '특징: 선형 강압.\n장점: 싸고 조용함, 아날로그·RF 옆에 유리.\n단점: (VIN-VOUT)×전류가 전부 열. 드롭이 크면 비효율.'
    ),
    example(
      'mixed',
      '혼합 (전력단 스위칭 + 아날로그 LDO)',
      'Mixed (switching bulk + analog LDO)',
      '특징: 큰 전류는 벅, 민감한 레일은 LDO.\n장점: 효율과 노이즈를 나눔.\n단점: 레일·부품이 늘어남.'
    )
  ];
}

function sensorTypeExamples(ctx) {
  const prompt = ctx.prompt ?? '';
  if (/가스|gas|mq-|ndir|co2|voc/i.test(prompt)) {
    return [
      example('gas-digital', '디지털 가스 (농도 ppm, I2C/UART)', 'Digital gas (ppm, I2C/UART)', '특징: 보정된 디지털 가스 모듈.\n장점: MCU ADC 부담이 적고 스펙이 명확.\n단점: 아날로그 MQ보다 비쌈.', true),
      example('gas-analog-mq', '아날로그 MQ 계열', 'Analog MQ-class', '특징: 히터+아날로그 전압.\n장점: 저가 실험.\n단점: 보정·예열·전원 노이즈에 민감.')
    ];
  }
  if (/온습도|humidity|sht|bme|temp/i.test(prompt)) {
    return [
      example('th-i2c', '온습도 I2C (SHT/BME급)', 'Temp/humidity I2C (SHT/BME-class)', '특징: 온습도 디지털 센서.\n장점: 모듈이 많고 배선이 단순.\n단점: 결로·자기가열 배치를 봐야 함.', true),
      example('ntc', 'NTC 서미스터', 'NTC thermistor', '특징: 아날로그 온도만.\n장점: 원가.\n단점: 습도 없음, 분압·보정이 필요.')
    ];
  }
  if (/imu|가속도|gyro|imu/i.test(prompt)) {
    return [
      example('imu-i2c', '6/9축 IMU I2C', '6/9-axis IMU I2C', '특징: 가속·자이로 (자기 선택).\n장점: 모션 감지에 흔함.\n단점: 샘플링·노이즈·실장 방향이 중요.', true)
    ];
  }
  return [
    example('i2c-module', 'I2C 디지털 센서 모듈', 'I2C digital sensor module', '특징: 주소형 2선 모듈.\n장점: 커넥터 핀이 적음.\n단점: 주소 충돌·케이블 길이에 약함.', true),
    example('analog-0-3v3', '아날로그 0–3.3V', 'Analog 0–3.3V', '특징: ADC 입력.\n장점: 단순.\n단점: 노이즈·교정 부담.')
  ];
}

function sensorSpecExamples(ctx) {
  const type = String(ctx.answers?.['sensors.type'] ?? ctx.facts?.sensors?.type ?? ctx.prompt ?? '');
  if (/gas-digital|디지털 가스|ndir|ppm|^gas$/i.test(type)) {
    return [
      example('co2-400-5000ppm-i2c', 'CO2 400–5000ppm I2C', 'CO2 400–5000ppm I2C', '특징: 실내 공기질 범위.\n장점: 스펙이 명확해 프로파일에 남길 수 있음.\n단점: 센서 본체와 예열 전원이 큼.', true),
      example('voc-i2c', 'VOC I2C 인덱스', 'VOC I2C index', '특징: 상대 공기질.\n장점: 저가.\n단점: 절대 ppm이 아님.')
    ];
  }
  if (/gas-analog|mq/i.test(type)) {
    return [
      example('mq-analog-5v-heater', 'MQ 아날로그, 히터 5V', 'MQ analog, 5V heater', '특징: 히터 전원이 5V인 경우가 많음.\n장점: 저가.\n단점: 3.3V MCU와 전원 도메인이 다를 수 있음.', true)
    ];
  }
  if (/th-i2c|온습도|sht|bme/i.test(type)) {
    return [
      example('sht40-i2c', 'SHT40급, ±0.2°C, I2C', 'SHT40-class, ±0.2°C, I2C', '특징: 고정밀 온습도.\n장점: 스펙이 문서화됨.\n단점: 결로 환경은 별도 보호.', true),
      example('bme280-i2c', 'BME280급 온습도+기압', 'BME280-class T/H/P', '특징: 기압까지.\n장점: 한 칩으로 환경 측정.\n단점: 습도 장기 드리프트.')
    ];
  }
  return [
    example('3v3-i2c-100khz', '3.3V I2C 100kHz', '3.3V I2C 100kHz', '특징: 표준 저속 I2C.\n장점: 케이블·모듈 호환.\n단점: 고속 샘플에는 부족.', true),
    example('3v3-analog', '3.3V ADC, 10–12bit', '3.3V ADC, 10–12bit', '특징: MCU ADC.\n장점: 부품이 적음.\n단점: 노이즈·레퍼런스 설계가 필요.')
  ];
}

function datasheetCompanionExamples(ctx) {
  const prompt = ctx.prompt ?? '';
  const answers = ctx.answers ?? {};
  const blob = `${prompt}\n${Object.values(answers).join('\n')}`;
  const items = [];
  if (/adbms|ltc681|bms/i.test(blob)) {
    items.push('BMIC EEPROM (M24C64급)');
  }
  if (wantsCan(prompt) || /SN65HVD230|TJA1051|ISO1042/i.test(blob)) {
    items.push('CAN TVS+CMC (PESD1CAN / ACT45B급)');
  }
  if (/usb|esp32/i.test(blob)) {
    items.push('USB ESD (USBLC6-2급)');
  }
  if (/18650|tp4056/i.test(blob)) {
    items.push('1S 보호 FET (DW01+FS8205, TP4056 레퍼런스)');
  }
  if (/디스플레이|display|rgb|ili9488|ra8875/i.test(blob)) {
    items.push('백라이트 LED 드라이버');
  }
  const sourced = [];
  if (/adbms|ltc681|bms/i.test(blob)) {
    sourced.push(searchParts({ role: 'eeprom-i2c', limit: 1 })[0]);
  }
  if (wantsCan(prompt) || /SN65HVD230|TJA1051|ISO1042|TCAN/i.test(blob)) {
    sourced.push(searchParts({ role: 'can-tvs', limit: 1 })[0]);
  }
  if (/usb|esp32/i.test(blob)) {
    sourced.push(searchParts({ role: 'usb-esd', limit: 1 })[0]);
  }
  if (/18650|tp4056/i.test(blob)) {
    sourced.push(searchParts({ role: 'charger-1s', limit: 1 })[0]);
  }
  const sourcedText = sourced.filter(Boolean).map((item) => `${item.mpn} $${item.unitPriceUsd.toFixed(2)}`).join(', ');
  const included = sourcedText || (items.length ? items.join(', ') : '핵심 IC 주변 디커플링만');
  return [
    example(
      'include-ref',
      `레퍼런스 연관 IC 포함 (${included})`,
      `Include datasheet companions (${included})`,
      `특징: Mouser 검색으로 고른 typical-application 연관 IC.\n장점: 실사용·내성에 가깝고 단가·추가 BOM을 봤음.\n단점: 부품 수·면적이 늘어남.\n검색: ${sourcedText || '인덱스'}`,
      true
    ),
    example(
      'core-only',
      '핵심 부품만',
      'Core parts only',
      '특징: MCU/모니터/트랜시버만.\n장점: BOM이 단순.\n단점: 레퍼런스와 다르고 ESD·보호·설정 저장이 빠질 수 있음.'
    )
  ];
}

export const PRODUCT_KINDS = [
  {
    id: 'bms',
    priority: 10,
    generate: 'bms',
    match: /bms|battery\s*manag|셀\s*모니터|cell\s*monitor|\d+\s*s\b|adbms|ltc681|battery\s*stack/i,
    labels: { ko: 'BMS / 배터리 모니터', en: 'BMS / battery monitor' },
    fields: [
      {
        id: 'cellCount',
        required: true,
        questionKo: '몇 셀(S) 스택인가요?',
        questionEn: 'How many series cells (S) is the pack?',
        extract: (prompt) => prompt.match(/(\d+)\s*s\b/i)?.[0]?.toUpperCase() ?? null,
        examples: [
          example('16S', '16S', '16S', '특징: 16셀 직렬, 약 48–67V Li-ion 예제 범위.\n장점: 이 저장소의 ADBMS6830 예제와 맞음.\n단점: 고전압이라 절연·보호·레이아웃 검토가 큼.', true),
          example('12S', '12S', '12S', '특징: 12셀 직렬, 약 36–50V.\n장점: 산업용 48V 근처에 흔함.\n단점: 현재 BMS 예제는 16S 기준이라 회로를 다시 맞춰야 함.'),
          example('8S', '8S', '8S', '특징: 8셀 직렬, 전압이 비교적 낮음.\n장점: 다루기 쉽고 실험에 부담이 적음.\n단점: 16S 예제와 셀 수·밸런스 회로가 다름.')
        ]
      },
      {
        id: 'monitorIc',
        required: true,
        questionKo: '셀 모니터 IC는 무엇으로 할까요?',
        questionEn: 'Which cell-monitor IC should the profile use?',
        extract: (prompt) => prompt.match(/adbms[\s-]?6830/i)?.[0] ?? prompt.match(/ltc681[0-9]/i)?.[0] ?? null,
        examples: [
          example('ADBMS6830', 'ADBMS6830', 'ADBMS6830', '특징: Analog Devices 16채널 셀 모니터, isoSPI.\n장점: 이 프로젝트가 이미 스케폴드를 가지고 있음.\n단점: 패키지/핀맵 확정과 안전 설계는 별도.', true),
          example('LTC6813', 'LTC6813', 'LTC6813', '특징: ADI/LTC 계열 18셀급 모니터.\n장점: 산업에서 많이 쓰임.\n단점: 이 저장소의 기본 예제는 ADBMS6830이라 스케폴드가 다름.')
        ]
      },
      {
        id: 'chemistry',
        required: false,
        questionKo: '셀 케미스트리는 무엇인가요?',
        questionEn: 'What cell chemistry should we assume?',
        extract: (prompt) => (/lifepo4|lfp/i.test(prompt) ? 'LiFePO4' : /li-?ion|리튬/i.test(prompt) ? 'Li-ion' : null),
        examples: [
          example('Li-ion', 'Li-ion', 'Li-ion', '특징: 공칭 3.6–3.7V, 만충 4.2V급.\n장점: 에너지 밀도가 높음.\n단점: 과충전·열에 민감, 보호 설계가 중요.', true),
          example('LiFePO4', 'LiFePO4', 'LiFePO4', '특징: 공칭 3.2V, 만충 약 3.65V.\n장점: 열적 여유가 상대적으로 큼.\n단점: 같은 S 수에서 팩 전압이 Li-ion보다 낮음.')
        ]
      },
      {
        id: 'companions',
        proOnly: true,
        required: true,
        dependsOn: 'bms.monitorIc',
        questionKo: '데이터시트 레퍼런스 회로의 연관 IC를 붙일까요? ADBMS6830은 보통 EEPROM을 붙입니다.',
        questionEn: 'Add companion ICs from the datasheet reference circuit? ADBMS6830 designs often include EEPROM.',
        extract: () => null,
        examples: [
          example('eeprom', 'EEPROM 포함 (M24C64급)', 'Include EEPROM (M24C64-class)', '특징: 보정·ID·구성 데이터를 BMIC 옆에 둠.\n장점: ADI 레퍼런스와 같고 현장 설정이 가능.\n단점: I2C/SPI 핀과 부품이 추가됨.', true),
          example('no-eeprom', '모니터 IC만', 'Monitor IC only', '특징: EEPROM 없음.\n장점: BOM이 단순.\n단점: 레퍼런스와 다르고 보정 저장이 어려움.')
        ]
      }
    ]
  },
  {
    id: 'isolated-dcdc',
    priority: 9,
    generate: 'isolated-dcdc',
    match: /절연|isolated(?:\s+dc-?dc)?|iso-?dc(?:-?dc)?/i,
    labels: { ko: '절연 DC-DC 전원', en: 'isolated DC-DC converter' },
    fields: [
      {
        id: 'vin',
        required: true,
        questionKo: '입력 전압(범위)은 얼마인가요?',
        questionEn: 'What is the input voltage or range?',
        extract: (prompt) => {
          const values = voltages(prompt);
          if (values.length >= 1) return `${values[0]}VDC`;
          return prompt.match(/(\d+\s*-\s*\d+\s*v)/i)?.[1] ?? null;
        },
        examples: [
          example('30VDC', '30VDC', '30VDC', '특징: 고정 30V 입력.\n장점: 설계가 단순함.\n단점: 입력이 흔들리면 동작 범위를 못 커버함.'),
          example('9-36VDC', '9-36VDC', '9-36VDC', '특징: 넓은 입력 범위.\n장점: 산업 버스·배터리 변동에 강함.\n단점: 컨버터·필터가 더 커질 수 있음.'),
          example('24VDC', '24VDC', '24VDC', '특징: 산업 표준 24V.\n장점: 부품·전원 모듈을 구하기 쉬움.\n단점: 30V 계통과는 정격이 다름.')
        ]
      },
      {
        id: 'vout',
        required: true,
        questionKo: '출력 전압은 얼마인가요?',
        questionEn: 'What is the output voltage?',
        extract: (prompt) => {
          const values = voltages(prompt);
          if (values.length >= 2) return `${values[1]}VDC`;
          if (/to\s*(\d+(?:\.\d+)?)\s*v/i.test(prompt)) return `${prompt.match(/to\s*(\d+(?:\.\d+)?)\s*v/i)[1]}VDC`;
          return values[0] != null ? `${values[0]}VDC` : null;
        },
        examples: [
          example('30VDC', '30VDC', '30VDC', '특징: 30V 출력.\n장점: 요청한 30-to-30 제품과 맞음.\n단점: 부하·리플 사양은 아직 비어 있음.'),
          example('24VDC', '24VDC', '24VDC', '특징: 산업 24V 출력.\n장점: PLC·센서 전원에 흔함.\n단점: 30V 부하와는 맞지 않음.'),
          example('12VDC', '12VDC', '12VDC', '특징: 12V 출력.\n장점: 팬·릴레이·차량 보조에 흔함.\n단점: 고전압 부하에는 부족.'),
          example('5VDC', '5VDC', '5VDC', '특징: 5V 논리/USB 출력.\n장점: MCU·USB 기기에 바로 씀.\n단점: 전력 용량이 작아지기 쉬움.')
        ]
      },
      {
        id: 'isolation',
        required: true,
        questionKo: '절연 정격은 얼마인가요?',
        questionEn: 'What isolation rating is required?',
        extract: (prompt) => {
          const rated = prompt.match(/(\d+(?:\.\d+)?)\s*kv(?:ac|dc)?/i)
            ?? prompt.match(/(\d{3,})\s*v(?:ac|dc)?\s*(?:절연|isolation)/i);
          return rated ? rated[0] : null;
        },
        examples: [
          example('1500VDC', '1500VDC', '1500VDC', '특징: 1.5kV DC 절연 예제.\n장점: 모듈 제품에서 흔히 보는 기본 정격.\n단점: 강화 절연·의료/계통 요구에는 부족할 수 있음.', true),
          example('3kVAC', '3kVAC', '3kVAC', '특징: 3kV AC 내압 수준.\n장점: 더 높은 연면/공간거리 목표.\n단점: 트랜스포머·모듈이 커지고 비싸짐.'),
          example('reinforced', '강화 절연', 'reinforced isolation', '특징: 이중/강화 절연을 목표로 함.\n장점: 사람 접촉 회로에 더 안전함.\n단점: 인증·연면거리 요구가 큼. 초안만으로는 인증되지 않음.')
        ]
      },
      {
        id: 'powerW',
        required: false,
        questionKo: '출력 전력은 얼마인가요?',
        questionEn: 'What output power is required?',
        extract: (prompt) => prompt.match(/(\d+(?:\.\d+)?)\s*w\b/i)?.[0] ?? null,
        examples: [
          example('15W', '15W', '15W', '특징: 소전력.\n장점: 모듈이 작고 발열이 적음.\n단점: 모터·히터에는 부족.'),
          example('30W', '30W', '30W', '특징: 중소전력.\n장점: 제어·통신 보드 전원에 무난.\n단점: 연속 부하 마진은 열설계에 따름.'),
          example('60W', '60W', '60W', '특징: 중전력.\n장점: 여러 레일을 나누기 좋음.\n단점: 방열·자성체가 커짐.'),
          example('100W', '100W', '100W', '특징: 비교적 큰 전력.\n장점: 여유 있는 부하.\n단점: 효율·EMI·냉각 설계가 필수.')
        ]
      },
      {
        id: 'topology',
        required: false,
        questionKo: '변환 토폴로지/모듈 형태는 무엇인가요?',
        questionEn: 'What converter topology or module type?',
        extract: (prompt) => (/flyback/i.test(prompt) ? 'flyback' : /forward/i.test(prompt) ? 'forward' : /push-?pull/i.test(prompt) ? 'push-pull' : null),
        examples: [
          example('isolated-flyback-module', '절연 플라이백 모듈', 'isolated flyback module', '특징: 기성 절연 모듈을 쓰는 플라이백.\n장점: 설계가 빠르고 부품 수가 적음.\n단점: 효율·리플·커스텀 정격에 한계.', true),
          example('isolated-forward', '절연 포워드', 'isolated forward', '특징: 포워드 토폴로지.\n장점: 중전력에서 효율이 좋은 편.\n단점: 자성체·스너버 설계가 더 필요함.')
        ]
      }
    ]
  },
  {
    id: 'mcu-board',
    priority: 5,
    generate: 'mcu',
    match: /esp32|stm32|rp2040|nrf52|mcu|마이크로컨트롤러|마이크로 컨트롤러/i,
    labels: { ko: 'MCU 보드', en: 'MCU board' },
    fields: [
      {
        id: 'radio',
        proOnly: true,
        required: (ctx) => /esp32/i.test(ctx.prompt ?? ''),
        questionKo: '무선 연결이 필요합니까? (칩 목록이 아니라 필요한 사양부터 고릅니다)',
        questionEn: 'What wireless capability do you need? We will reverse-recommend a module from the spec.',
        extract: (prompt) => (/wifi|와이파이/i.test(prompt) && /ble|블루투스/i.test(prompt) ? 'wifi-ble'
          : /wifi|와이파이/i.test(prompt) ? 'wifi'
          : /ble|블루투스/i.test(prompt) ? 'ble' : null),
        examples: [
          example('wifi-ble', 'Wi-Fi + BLE', 'Wi-Fi + BLE', '특징: 무선 랜과 저전력 근거리 둘 다.\n장점: 폰·클라우드·센서 노드를 한 모듈로.\n단점: RF 배치·인증 면적이 필요.', true),
          example('wifi', 'Wi-Fi만', 'Wi-Fi only', '특징: 클라우드·OTA 중심.\n장점: BLE 스택을 빼면 단순.\n단점: 폰 앱 근거리 페어링은 별도.'),
          example('none', '무선 없음', 'No radio', '특징: 유선/산업 MCU 쪽으로 감.\n장점: RF 인증이 없음.\n단점: ESP32 계열의 장점을 거의 안 씀.')
        ]
      },
      {
        id: 'usb',
        proOnly: true,
        required: (ctx) => /esp32/i.test(ctx.prompt ?? ''),
        questionKo: 'USB는 어떻게 쓸 계획입니까?',
        questionEn: 'How will USB be used?',
        extract: (prompt) => (/usb-c|usb\b/i.test(prompt) ? 'native-usb' : null),
        examples: [
          example('native-usb', 'USB-C 네이티브 (USB-JTAG/CDC)', 'Native USB-C (USB-JTAG/CDC)', '특징: 칩이 USB 디바이스를 직접 제공.\n장점: 별도 USB-UART 브리지가 필요 없음.\n단점: USB-C CC·ESD 설계가 필요.', true),
          example('uart-bridge', 'UART만 (USB는 어댑터)', 'UART only (external USB adapter)', '특징: 디버그는 USB-UART 동글.\n장점: 보드가 단순.\n단점: 커넥터·브리지 BOM이 따로 생김.')
        ]
      },
      {
        id: 'memory',
        proOnly: true,
        required: (ctx) => /esp32/i.test(ctx.prompt ?? ''),
        questionKo: '디스플레이·버퍼 때문에 PSRAM이 필요합니까?',
        questionEn: 'Do you need PSRAM for display or buffers?',
        extract: (prompt) => (/디스플레이|display|psram|카메라|camera/i.test(prompt) ? 'psram' : null),
        examples: [
          example('psram', 'PSRAM 필요', 'PSRAM required', '특징: 프레임버퍼·큰 버퍼.\n장점: 7인치 RGB/카메라에 거의 필수.\n단점: 모듈이 비싸고 전원 노이즈에 민감할 수 있음.', true),
          example('no-psram', 'PSRAM 없음', 'No PSRAM', '특징: 내부 SRAM만.\n장점: 저가 모듈.\n단점: 큰 UI·이미지에 부족.')
        ]
      },
      {
        id: 'ioNeeds',
        proOnly: true,
        required: (ctx) => /esp32/i.test(ctx.prompt ?? ''),
        questionKo: 'MCU가 직접 담당할 주변 기능은 무엇입니까? (칩 목록이 아니라 사양입니다)',
        questionEn: 'Which peripherals must the MCU drive directly? Spec first, then we reverse-recommend a module.',
        extract: (prompt) => {
          const display = /디스플레이|display|카메라|camera|rgb/i.test(prompt);
          const can = wantsCan(prompt);
          if (display && can) return 'display-can';
          if (display) return 'display';
          if (can) return 'can-wireless';
          return null;
        },
        examplesFor: (ctx) => {
          const prompt = ctx.prompt ?? '';
          const display = /디스플레이|display|카메라|camera|rgb/i.test(prompt);
          const can = wantsCan(prompt);
          return [
            example('display-can', 'RGB/터치 디스플레이 + CAN', 'RGB/touch display + CAN', '특징: 병렬 픽셀 버스와 TWAI/CAN을 한 MCU가 맡음.\n장점: HMI와 차량/산업 버스를 한 칩으로.\n단점: 핀·PSRAM·전원 여유가 필요 → S3급.', display && can),
            example('display', '디스플레이/카메라 버스', 'Display/camera bus', '특징: RGB 또는 카메라 DVP.\n장점: UI·비전.\n단점: GPIO와 PSRAM이 많이 필요.', display && !can),
            example('can-wireless', 'CAN(TWAI) + 무선', 'CAN (TWAI) + radio', '특징: 유선 버스와 Wi-Fi/BLE.\n장점: 게이트웨이.\n단점: 큰 화면에는 부족할 수 있음.', can && !display),
            example('sensor-iot', 'I2C 센서 IoT', 'I2C sensor IoT', '특징: GPIO/I2C 위주.\n장점: 저가 모듈로 가능.\n단점: HMI·고속 버스는 나중에 막힘.', !display && !can)
          ];
        }
      },
      {
        id: 'mcuPart',
        proOnly: true,
        required: true,
        dependsOn: (ctx) => (/esp32/i.test(ctx.prompt ?? '') ? 'mcu-board.ioNeeds' : null),
        questionKo: '위 사양으로 역제안하면 이 모듈입니다. 이대로 할까요? (부품 목록이 아닙니다)',
        questionEn: 'Reverse-recommended from those specs. Use this module? This is not a chip dump.',
        extract: (prompt) => prompt.match(/ESP32-S3-WROOM[^\s,.]*/i)?.[0]
          ?? prompt.match(/ESP32-C3-WROOM[^\s,.]*/i)?.[0]
          ?? prompt.match(/ESP32-WROOM[^\s,.]*/i)?.[0]
          ?? prompt.match(/STM32G0[A-Z0-9]+/i)?.[0]
          ?? null,
        examplesFor: (ctx) => recommendMcuModules(ctx)
      }
    ]
  },
  {
    id: 'hmi',
    priority: 4,
    generate: null,
    match: /디스플레이|display|lcd|tft|hmi|터치\s*스크린|touch\s*screen/i,
    labels: { ko: '디스플레이 / HMI', en: 'display / HMI' },
    fields: [
      {
        id: 'panel',
        required: true,
        questionKo: '디스플레이 패널/컨트롤러는 무엇으로 프로파일에 넣을까요?',
        questionEn: 'Which display panel or controller should the profile record?',
        extract: (prompt) => prompt.match(/ili9488|ra8875|ssd1963|rgb|lvds|hdmi/i)?.[0] ?? null,
        examplesFor: (ctx) => {
          const seven = /7\s*인치|7-?inch/i.test(ctx.prompt ?? '');
          return [
            example('rgb-800x480-7in', '7인치 800x480 RGB 병렬', '7-inch 800x480 RGB parallel', '특징: MCU가 RGB 픽셀 버스를 직접 드라이브.\n장점: 7인치에서 화면이 부드러움.\n단점: GPIO가 많이 필요하고 배선이 김.', seven),
            example('ra8875-7in', 'RA8875 + 7인치 패널', 'RA8875 plus 7-inch panel', '특징: 디스플레이 컨트롤러가 패널을 대신 드라이브.\n장점: MCU 핀을 덜 씀.\n단점: 칩이 하나 더 생김.', !seven),
            example('ili9488-spi', 'ILI9488 SPI TFT', 'ILI9488 SPI TFT', '특징: SPI로만 연결.\n장점: 배선이 단순.\n단점: 7인치급은 느릴 수 있음.')
          ];
        }
      },
      {
        id: 'interface',
        required: false,
        questionKo: '디스플레이 인터페이스는 무엇인가요?',
        questionEn: 'What display interface should we record?',
        extract: (prompt) => (/lvds/i.test(prompt) ? 'LVDS' : /rgb|병렬/i.test(prompt) ? 'RGB' : /spi/i.test(prompt) ? 'SPI' : /hdmi/i.test(prompt) ? 'HDMI' : null),
        examples: [
          example('RGB', 'RGB', 'RGB', '특징: 병렬 RGB 픽셀 버스.\n장점: 큰 화면·높은 프레임에 유리.\n단점: 핀과 PCB 층수가 많이 필요.'),
          example('SPI', 'SPI', 'SPI', '특징: 클럭+데이터 몇 선.\n장점: 배선이 쉽고 MCU 예제가 많음.\n단점: 큰 화면은 느림.'),
          example('LVDS', 'LVDS', 'LVDS', '특징: 차동 고속 패널 인터페이스.\n장점: 노이즈에 강하고 케이블이 길어도 됨.\n단점: 전용 브리지 칩이 필요한 경우가 많음.')
        ]
      }
    ]
  },
  {
    id: 'wired-comms',
    priority: 3,
    generate: null,
    match: /\bcan\b|캔\s*트랜시버|can\s*transceiver|rs-?485|modbus|ethernet|isoSPI/i,
    labels: { ko: '유선 통신', en: 'wired communications' },
    fields: [
      {
        id: 'deviceVoltage',
        required: (ctx) => wantsCan(ctx.prompt),
        questionKo: 'MCU는 3.3V입니다. CAN으로 연결할 장치의 전압은 어떻게 됩니까?',
        questionEn: 'The MCU is 3.3V. What voltage is the CAN device?',
        extract: (prompt) => {
          if (!wantsCan(prompt)) return null;
          if (/절연|isolated|12\s*v|24\s*v/i.test(prompt)) return 'isolated';
          if (/5\s*v/i.test(prompt)) return '5V';
          return null;
        },
        examples: [
          example('can-3v3', '3.3V (MCU와 동일)', '3.3V (same as MCU)', '특징: CAN 장치도 3.3V 논리.\n장점: 레벨 변환이 필요 없음.\n단점: 5V 레거시 ECU와는 바로 못 붙임.', true),
          example('can-5v', '5V CAN 장치', '5V CAN device', '특징: 버스/장치는 5V, MCU는 3.3V.\n장점: 자동차·구형 ECU와 맞춤.\n단점: 3.3V MCU에서 5V 버스용 트랜시버 또는 레벨 변환이 필요.'),
          example('can-isolated', '절연 CAN (산업 12–24V 측)', 'Isolated CAN (industrial 12–24V side)', '특징: 디지털과 버스를 절연.\n장점: 노이즈·그라운드 루프에 강함.\n단점: 부품이 비싸고 보드가 커짐.')
        ]
      },
      {
        id: 'phy',
        required: true,
        dependsOn: (ctx) => (wantsCan(ctx.prompt) ? 'wired-comms.deviceVoltage' : null),
        questionKo: '그러면 어떤 트랜시버로 연결할까요?',
        questionEn: 'Which transceiver should connect that bus?',
        extract: (prompt) => prompt.match(/sn65hvd230|tja1051|iso1042|iso1050|max485|w5500/i)?.[0] ?? null,
        examplesFor: (ctx) => canPhyExamples(ctx)
      }
    ]
  },
  {
    id: 'energy-storage',
    priority: 3,
    generate: null,
    match: /18650|battery pack|배터리\s*팩|1s\s*18650|건전지|aa\s*batter/i,
    labels: { ko: '배터리 전원', en: 'battery power' },
    fields: [
      {
        id: 'pack',
        required: true,
        questionKo: '배터리 팩/충전 구성은 어떻게 할까요?',
        questionEn: 'How should the battery pack and charging be recorded?',
        extract: (prompt) => (/tp4056/i.test(prompt) ? 'TP4056' : /18650/i.test(prompt) ? '18650' : /건전지|aa\s*batter/i.test(prompt) ? 'AA' : null),
        examplesFor: (ctx) => {
          const aa = /건전지|aa\s*batter/i.test(ctx.prompt ?? '');
          return [
            example('tp4056-1s', '1S 18650 + TP4056 충전/보호', '1S 18650 with TP4056', '특징: 한 셀 충전 IC + 보호 FET 조합.\n장점: 저가 프로토타입에 흔하고 단순.\n단점: 다중 셀 BMS가 아님. 16S와는 별개.', !aa),
            example('1s-boost-5v', '1S 18650 + 5V 부스트', '1S 18650 plus 5V boost', '특징: 한 셀에서 5V를 만듦.\n장점: USB 기기 실험에 편리.\n단점: 효율·리플·저전압 차단을 따로 설계해야 함.'),
            example('aa-boost-3v3', 'AA 직렬 + 3.3V 벅/부스트', 'AA series plus 3.3V buck/boost', '특징: 알카라인 방전 곡선에 맞춰 3.3V를 만듦.\n장점: 충전 IC가 필요 없음.\n단점: 용량·전압 강하가 커서 스위칭이 사실상 필수.', aa)
          ];
        }
      }
    ]
  },
  {
    id: 'power-architecture',
    priority: 8,
    generate: null,
    interviewOnly: true,
    match: /전원|regulator|ldo|switching|buck|esp32|stm32|mcu|절연|bms|배터리|디스플레이/i,
    labels: { ko: '전원 토폴로지', en: 'power topology' },
    fields: [
      {
        id: 'railStrategy',
        proOnly: true,
        required: true,
        questionKo: '주 전원은 효율(스위칭)과 원가(LDO) 중 어디에 더 비중을 둘까요?',
        questionEn: 'Should the main rail prioritize switching efficiency or LDO cost?',
        extract: (prompt) => (/ldo|리니어/i.test(prompt) ? 'ldo' : /buck-?boost|벅부스트|부스트/i.test(prompt) ? 'boost-buck' : /switching|buck|스위칭|벅/i.test(prompt) ? 'switching' : null),
        examplesFor: (ctx) => powerTopologyExamples(ctx)
      }
    ]
  },
  {
    id: 'integration',
    priority: 7,
    generate: null,
    interviewOnly: true,
    match: /esp32|stm32|bms|절연|전원|센서|can|디스플레이|제품|보드/i,
    labels: { ko: '제품 연계', en: 'product integration' },
    fields: [
      {
        id: 'neighbors',
        proOnly: true,
        required: true,
        questionKo: '이 보드가 다른 제품과 어떻게 연계되나요? (전원 공급, 통신, 독립 동작)',
        questionEn: 'How does this board connect to other products (power, comms, standalone)?',
        extract: (prompt) => {
          if (/독립|standalone/i.test(prompt)) return 'standalone';
          if (/다른 장치.{0,12}전원\s*공급|supplies power to other/i.test(prompt)) return 'supplies-power';
          if (/다른 장치.{0,12}전원을 받|receives power from/i.test(prompt)) return 'receives-power';
          return null;
        },
        examples: [
          example('standalone', '독립 동작 (자체 전원)', 'Standalone (on-board power)', '특징: 다른 보드에 전원/버스를 의존하지 않음.\n장점: 가져가서 바로 켤 수 있음.\n단점: 충전기·컨버터를 이 보드가 다 짐.', true),
          example('supplies-power', '다른 장치에 전원을 공급', 'Supplies power to other devices', '특징: 이 보드가 소스.\n장점: 허브·마더 보드 역할.\n단점: 전류 예산·보호·커넥터 정의가 필요.'),
          example('receives-power', '다른 장치에서 전원을 받음', 'Receives power from another device', '특징: 업스트림 전원에 종속.\n장점: 온보드 컨버터를 줄일 수 있음.\n단점: 입력 범위·핫플러그·역접속을 맞춰야 함.'),
          example('can-peer', 'CAN/버스로 다른 ECU와 동료', 'CAN/bus peer with other ECUs', '특징: 통신으로만 연계.\n장점: 전원 도메인을 나눌 수 있음.\n단점: 버스 전압·종단·주소 계획이 필요.')
        ]
      }
    ]
  },
  {
    id: 'sensors',
    priority: 4,
    generate: null,
    interviewOnly: true,
    match: /sensor|센서|가스|온습도|imu|pressure|thermistor/i,
    labels: { ko: '센서', en: 'sensors' },
    fields: [
      {
        id: 'type',
        proOnly: true,
        required: true,
        questionKo: '센서는 어떤 종류·부품 계열로 할까요?',
        questionEn: 'What sensor type/part class should we record?',
        extract: (prompt) => {
          if (/scd4|ndir/i.test(prompt)) return 'gas-digital';
          if (/mq-\d/i.test(prompt)) return 'gas-analog-mq';
          if (/sht\d|bme\d/i.test(prompt)) return 'th';
          if (/mpu6050|bmi270|lsm6/i.test(prompt)) return 'imu';
          if (/ina2\d{2}/i.test(prompt)) return 'current';
          return null;
        },
        examplesFor: (ctx) => sensorTypeExamples(ctx)
      },
      {
        id: 'spec',
        proOnly: true,
        required: true,
        dependsOn: 'sensors.type',
        questionKo: '그 센서의 측정 스펙(범위·정밀도·버스)은 무엇으로 할까요?',
        questionEn: 'What measurement spec (range, accuracy, bus) should we record?',
        extract: () => null,
        examplesFor: (ctx) => sensorSpecExamples(ctx)
      },
      {
        id: 'bus',
        proOnly: true,
        required: true,
        dependsOn: 'sensors.spec',
        questionKo: '센서 통신 사양은 무엇으로 할까요?',
        questionEn: 'What sensor bus should we record?',
        extract: (prompt) => (/i2c|아이투씨/i.test(prompt) ? 'i2c' : /spi/i.test(prompt) ? 'spi' : /analog|아날로그/i.test(prompt) ? 'analog' : null),
        examples: [
          example('i2c', 'I2C 3.3V', 'I2C 3.3V', '특징: 주소형 2선.\n장점: 커넥터 핀이 적고 센서 모듈이 많음.\n단점: 케이블이 길면 노이즈에 약함.', true),
          example('spi', 'SPI', 'SPI', '특징: 고속 4선.\n장점: ADC·디스플레이급 대역.\n단점: 칩 셀렉트·배선이 늘어남.'),
          example('analog', '아날로그 0–3.3V', 'Analog 0–3.3V', '특징: ADC 입력.\n장점: 단순 가스/온도 모듈에 흔함.\n단점: 노이즈·교정 부담.')
        ]
      },
      {
        id: 'connector',
        proOnly: true,
        required: true,
        dependsOn: 'sensors.bus',
        questionKo: '센서 커넥터는 무엇으로 할까요?',
        questionEn: 'Which sensor connector should we record?',
        extract: (prompt) => (/qwiic|stemma/i.test(prompt) ? 'qwiic' : /jst/i.test(prompt) ? 'jst' : /2\.54|핀헤더|pin\s*header/i.test(prompt) ? '2.54' : null),
        examples: [
          example('2.54', '2.54mm 1x4 핀헤더', '2.54mm 1x4 header', '특징: 빵판·점퍼에 바로 꽂힘.\n장점: 프로토타입에 가장 흔함.\n단점: 진동·극성이 약함.', true),
          example('jst-gh', 'JST-GH', 'JST-GH', '특징: 잠금 소형 커넥터.\n장점: 드론·센서 보드에서 흔함.\n단점: 전용 하네스가 필요.'),
          example('qwiic', 'Qwiic/STEMMA QT', 'Qwiic/STEMMA QT', '특징: I2C 표준 4핀.\n장점: 모듈을 사슬로 잇기 쉬움.\n단점: I2C 전용.')
        ]
      }
    ]
  },
  {
    id: 'datasheet-companions',
    priority: 2,
    generate: null,
    interviewOnly: true,
    match: /esp32|stm32|bms|adbms|can|18650|디스플레이|display|isolated|센서|sensor/i,
    labels: { ko: '데이터시트 연관 IC', en: 'datasheet companion ICs' },
    fields: [
      {
        id: 'include',
        proOnly: true,
        required: true,
        questionKo: '데이터시트 레퍼런스 회로의 연관 IC를 붙일까요? (예: ADBMS6830+EEPROM)',
        questionEn: 'Add companion ICs from datasheet reference circuits? (e.g. ADBMS6830 + EEPROM)',
        extract: () => null,
        examplesFor: (ctx) => datasheetCompanionExamples(ctx)
      }
    ]
  }
];

function recommendMcuModules(ctx) {
  return partsToExamples(searchParts({
    role: 'mcu-module',
    need: mcuNeedFromContext(ctx),
    query: /stm32/i.test(ctx.prompt ?? '') && !/esp32/i.test(ctx.prompt ?? '') ? 'STM32' : 'ESP32 WROOM',
    limit: 2
  }));
}

const CUSTOM_KIND = {
  id: 'custom',
  priority: 0,
  generate: 'scaffold',
  match: /.?/,
  labels: { ko: '기타 제품', en: 'custom product' },
  fields: [
    {
      id: 'productName',
      required: true,
      questionKo: '이 제품의 종류를 한 줄로 적어 주세요.',
      questionEn: 'Describe the product type in one line.',
      extract: () => null,
      examples: []
    },
    {
      id: 'ratings',
      required: true,
      questionKo: '핵심 정격(전압, 전류, 절연, 셀 수, 전력 등)을 적어 주세요.',
      questionEn: 'What are the key ratings (voltage, current, isolation, cells, power)?',
      extract: () => null,
      examples: []
    }
  ]
};

export function detectProductRequest(prompt) {
  const text = prompt ?? '';
  const kinds = PRODUCT_KINDS.filter((kind) => kind.match.test(text))
    .sort((left, right) => right.priority - left.priority);
  const resolved = kinds.length > 0 ? kinds : [{ ...CUSTOM_KIND }];
  const facts = {};
  for (const kind of resolved) {
    facts[kind.id] = {};
    for (const field of kind.fields) {
      const value = field.extract?.(text) ?? null;
      if (value) facts[kind.id][field.id] = value;
    }
  }
  return {
    prompt: text,
    kinds: resolved,
    primary: resolved[0],
    facts
  };
}

export function generateKindFromDetection(detection) {
  const drawable = detection?.kinds?.find((kind) => (
    kind.generate && !kind.interviewOnly && kind.generate !== 'isolated-dcdc'
  )) ?? detection?.kinds?.find((kind) => kind.generate && !kind.interviewOnly);
  return drawable?.generate ?? 'scaffold';
}

export function fieldKey(kindId, fieldId) {
  return `${kindId}.${fieldId}`;
}

function fieldContext(detection, answers = {}) {
  return { prompt: detection.prompt, facts: detection.facts, answers };
}

function nestedFact(detection, key) {
  const [kindId, fieldId] = String(key).split('.');
  return detection.facts?.[kindId]?.[fieldId];
}

export function examplesForField(field, detection, answers = {}) {
  const ctx = fieldContext(detection, answers);
  if (typeof field.examplesFor === 'function') return field.examplesFor(ctx) ?? [];
  return field.examples ?? [];
}

export function openFields(detection, answers = {}, { proMode = false } = {}) {
  const open = [];
  const ctx = fieldContext(detection, answers);
  for (const kind of detection.kinds) {
    for (const field of kind.fields) {
      if (!proMode && (field.proOnly || kind.interviewOnly)) continue;
      const required = typeof field.required === 'function' ? field.required(ctx) : field.required;
      if (!required) continue;
      const dep = typeof field.dependsOn === 'function' ? field.dependsOn(ctx) : field.dependsOn;
      if (dep && !answers[dep] && !nestedFact(detection, dep)) continue;
      const key = fieldKey(kind.id, field.id);
      if (answers[key]) continue;
      if (detection.facts?.[kind.id]?.[field.id]) continue;
      open.push({ kind, field, key });
    }
  }
  return open;
}

export function extraUnsupportedKinds(detection, spec) {
  const profile = matchSupportedProfile(spec);
  return detection.kinds.filter((kind) => {
    if (kind.interviewOnly) return false;
    if (kind.generate === 'mcu' && (profile || detection.kinds.every((item) => item.id === 'mcu-board'))) return false;
    if (kind.generate === 'bms' && /adbms[\s-]?6830/i.test(detection.prompt)) return false;
    if (kind.generate === 'isolated-dcdc') return false;
    return kind.generate == null;
  });
}

export function canGenerateImmediately(detection, spec) {
  if (extraUnsupportedKinds(detection, spec).length > 0) return false;
  if (matchSupportedProfile(spec)) return true;
  if (/adbms[\s-]?6830/i.test(detection.prompt)) return true;
  if (detection.primary?.generate === 'isolated-dcdc') {
    return openFields(detection).length === 0;
  }
  if (detection.kinds.length === 1 && detection.primary?.id === 'mcu-board') return true;
  if (detection.primary?.id === 'custom') return true;
  return false;
}

export function recommendedAnswers(detection) {
  const answers = {};
  for (const [kindId, fields] of Object.entries(detection.facts ?? {})) {
    for (const [fieldId, value] of Object.entries(fields ?? {})) {
      answers[fieldKey(kindId, fieldId)] = value;
    }
  }
  for (let step = 0; step < 24; step += 1) {
    const open = openFields(detection, answers, { proMode: true });
    if (open.length === 0) break;
    const { field, key } = open[0];
    const examples = examplesForField(field, detection, answers);
    const pick = examples.find((item) => item.recommended) ?? examples[0];
    answers[key] = pick ? (pick.promptKo || pick.id) : 'deferred';
  }
  return answers;
}

export function applyProductDraft(spec, conversation) {
  if (!conversation) return spec;
  const answers = { ...(conversation.facts ?? {}), ...flattenAnswers(conversation) };
  const mcuGenerate = conversation.generateKind === 'mcu' || Boolean(conversation.forceProfileId);
  const kindId = mcuGenerate
    ? 'mcu-board'
    : (conversation.generateKind === 'isolated-dcdc' || conversation.generateKind === 'bms'
      ? conversation.generateKind
      : (conversation.primaryKind ?? spec.product?.primary));
  const product = {
    ...(spec.product ?? {}),
    primary: kindId,
    answers,
    kinds: conversation.kinds,
    designNotes: designNotesFromAnswers(answers)
  };
  if (kindId === 'isolated-dcdc' && !mcuGenerate) {
    return {
      ...spec,
      kind: 'isolated-dcdc',
      product,
      boardProfile: {
        id: 'draft-isolated-dcdc',
        kind: 'isolated-dcdc',
        pcbDraft: false,
        releaseTarget: 'example-review',
        ratings: {
          vin: answers['isolated-dcdc.vin'] ?? conversation.facts?.['isolated-dcdc']?.vin,
          vout: answers['isolated-dcdc.vout'] ?? conversation.facts?.['isolated-dcdc']?.vout,
          isolation: answers['isolated-dcdc.isolation'] ?? conversation.facts?.['isolated-dcdc']?.isolation,
          powerW: answers['isolated-dcdc.powerW'],
          topology: answers['isolated-dcdc.topology']
        }
      }
    };
  }
  return applyMcuAndPowerFromAnswers({
    ...spec,
    product: {
      ...product,
      sourcing: conversation.sourcing ?? product.sourcing
    },
    power: {
      ...(spec.power ?? {}),
      topology: answers['power-architecture.railStrategy'] ?? spec.power?.topology,
      integration: answers['integration.neighbors'] ?? spec.power?.integration
    }
  }, answers);
}

export function includeBmsEeprom(spec) {
  const companions = String(spec?.product?.answers?.['bms.companions'] ?? spec?.product?.answers?.['datasheet-companions.include'] ?? '');
  if (!companions) return false;
  if (/no-eeprom|모니터 IC만|core-only|핵심 부품만/i.test(companions)) return false;
  return /eeprom|레퍼런스 연관/i.test(companions);
}

export function designNotesFromAnswers(answers = {}) {
  const notes = [];
  const push = (key, label) => {
    if (answers[key] && answers[key] !== 'deferred') notes.push(`${label}: ${answers[key]}`);
  };
  push('power-architecture.railStrategy', 'Power topology');
  push('integration.neighbors', 'Product integration');
  push('mcu-board.radio', 'Radio spec');
  push('mcu-board.usb', 'USB spec');
  push('mcu-board.memory', 'Memory spec');
  push('mcu-board.ioNeeds', 'MCU I/O spec');
  push('mcu-board.mcuPart', 'Reverse-recommended MCU');
  push('sensors.type', 'Sensor type');
  push('sensors.spec', 'Sensor spec');
  push('sensors.bus', 'Sensor bus');
  push('sensors.connector', 'Sensor connector');
  push('wired-comms.deviceVoltage', 'Bus voltage');
  push('wired-comms.phy', 'Transceiver');
  push('energy-storage.pack', 'Battery');
  push('bms.companions', 'BMIC companions');
  push('datasheet-companions.include', 'Datasheet companions');
  return notes;
}

function applyMcuAndPowerFromAnswers(spec, answers) {
  const partText = String(answers['mcu-board.mcuPart'] ?? '');
  const packageName = partText.match(/ESP32-S3-WROOM[^\s,]*/i)?.[0]
    ?? partText.match(/ESP32-C3-WROOM[^\s,]*/i)?.[0]
    ?? partText.match(/ESP32-WROOM[^\s,]*/i)?.[0]
    ?? partText.match(/STM32G0[A-Z0-9]+/i)?.[0]
    ?? null;
  if (!packageName) return spec;
  let family = spec.mcu?.family;
  if (/ESP32-S3/i.test(packageName)) family = 'ESP32-S3';
  else if (/ESP32-C3/i.test(packageName)) family = 'ESP32-C3';
  else if (/STM32/i.test(packageName)) family = 'STM32';
  else if (/ESP32/i.test(packageName)) family = 'ESP32';
  return {
    ...spec,
    mcu: {
      ...(spec.mcu ?? {}),
      family,
      package: packageName
    }
  };
}

function flattenAnswers(conversation) {
  const answers = { ...(conversation.answers ?? {}) };
  for (const [kindId, fields] of Object.entries(conversation.facts ?? {})) {
    for (const [fieldId, value] of Object.entries(fields ?? {})) {
      const key = fieldKey(kindId, fieldId);
      if (answers[key] == null) answers[key] = value;
    }
  }
  return answers;
}
