import assert from 'node:assert/strict';
import test from 'node:test';

import { reviewCircuitReadiness } from '../src/workflow/review-project.js';

test('does not report release-ready when production evidence is still pending despite clean ERC', () => {
  const review = reviewCircuitReadiness({
    spec: releaseCandidateSpec({
      releaseChecks: {
        sourcing: { status: 'pending', reason: 'JLCPCB/LCSC orderability has not been verified.' },
        datasheet: { status: 'complete', evidence: 'datasheet pin review recorded' }
      }
    }),
    validation: cleanValidation()
  });

  assert.equal(review.status, 'ready-for-prototype-review');
  assert.ok(review.findings.warnings.some((finding) => finding.code === 'release-evidence-incomplete'));
  assert.ok(review.residualRisks.some((risk) => /sourcing: Missing JLCPCB\/LCSC evidence/i.test(risk)));
});

test('reports release-ready only when ERC and all release evidence are complete', () => {
  const review = reviewCircuitReadiness({
    spec: releaseCandidateSpec({
      releaseChecks: {
        sourcing: { status: 'complete', evidence: 'JLCPCB/LCSC part C12345 verified' },
        datasheet: { status: 'complete', evidence: 'datasheet pin review recorded' },
        simulation: { status: 'complete', evidence: 'buck loss and rail budget calculation recorded' }
      }
    }),
    validation: cleanValidation()
  });

  assert.equal(review.status, 'ready-for-release');
  assert.deepEqual(review.findings.blockers, []);
  assert.deepEqual(review.findings.warnings, []);
});

function releaseCandidateSpec({ releaseChecks }) {
  return {
    kind: 'mcu-peripheral',
    title: 'Release candidate supported board',
    sourcePrompt: 'Release profile STM32 USB-C 5V sensor board',
    mcu: { family: 'STM32', package: 'STM32G0B1CBT6' },
    interfaces: [{ kind: 'usb' }],
    boardProfile: {
      id: 'stm32-usbc-sensor',
      releaseTarget: 'release-candidate',
      releaseGates: [
        { id: 'production-symbols', status: 'complete', reason: 'complete' },
        { id: 'sourcing', status: 'complete', reason: 'complete' },
        { id: 'datasheet-pin-review', status: 'complete', reason: 'complete' },
        { id: 'simulation', status: 'complete', reason: 'complete' },
        { id: 'layout-drc', status: 'complete', reason: 'complete' }
      ],
      productionParts: [
        {
          ref: 'U1',
          value: 'TPS62177DQC',
          releaseChecks
        }
      ],
      releaseEvidence: {
        status: 'complete',
        requiredChecks: ['sourcing', 'datasheet', 'simulation', 'layoutDrc'],
        calculations: [
          {
            id: 'regulator-thermal-budget',
            status: 'pass',
            result: '0.85W LDO loss avoided by the buck regulator topology.'
          }
        ]
      }
    },
    schematic: {
      components: [
        { ref: 'U1', value: 'TPS62177DQC', libId: 'Regulator_Switching:TPS62177DQC' },
        { ref: 'J4', value: 'USB_C_CONNECTOR', libId: 'Connector:USB_C_Receptacle_USB2.0_16P' }
      ],
      nets: [
        { name: 'VBUS' },
        { name: '+3V3' },
        { name: 'GND' },
        { name: 'USB_DP' },
        { name: 'USB_DN' },
        { name: 'CC1' },
        { name: 'CC2' }
      ]
    }
  };
}

function cleanValidation() {
  return {
    ok: true,
    skipped: false,
    erc: {
      errorCount: 0,
      warningCount: 0,
      byType: {}
    }
  };
}
