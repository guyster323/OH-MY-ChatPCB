const SUPPORTED_INTERFACE_NETS = {
  i2c: ['SCL', 'SDA'],
  uart: ['TX', 'RX'],
  spi: ['SCK', 'MOSI', 'MISO', 'CS'],
  usb: ['CC1', 'CC2'],
  gpio: []
};

const INTERFACE_ALIASES = {
  usb: [
    ['D+', 'USB_DP'],
    ['D-', 'USB_DN']
  ],
  gpio: [['GPIO', 'GPIO0']]
};

export function reviewCircuitReadiness({ spec, validation } = {}) {
  if (!spec) {
    throw new Error('spec is required.');
  }

  const findings = {
    blockers: [],
    warnings: [],
    notes: []
  };
  const proposedFixes = [];
  const residualRisks = [];
  const requestedKinds = new Set((spec.interfaces ?? []).map((iface) => iface.kind));
  const generatedNets = new Set((spec.schematic?.nets ?? []).map((net) => net.name));
  const generatedComponents = spec.schematic?.components ?? [];

  if (spec.mcu?.package === 'unspecified') {
    addFinding(findings.blockers, 'mcu-part-missing', `Choose the exact ${spec.mcu.family} part or module before release.`);
  }

  if (generatedComponents.some((component) => component.libId === 'ChatPCB:MCU_PLACEHOLDER')) {
    addFinding(findings.warnings, 'fixture-symbols', 'The schematic still uses ChatPCB fixture symbols instead of production KiCad library symbols.');
  }

  if (spec.boardProfile?.releaseTarget === 'prototype-review') {
    addFinding(
      findings.warnings,
      'profile-sourcing-review',
      'The supported board profile has fixed schematic structure, but live JLCPCB sourcing and final layout review are still required before release.'
    );
  }

  if (/jlcpcb|order|manufactur/i.test(spec.sourcePrompt ?? '')) {
    addFinding(
      findings.blockers,
      'manufacturing-parts-missing',
      'JLCPCB release requires exact orderable parts, footprints, and sourcing assumptions.'
    );
  }

  for (const kind of requestedKinds) {
    const expectedNets = SUPPORTED_INTERFACE_NETS[kind] ?? [];
    const missingNets = expectedNets.filter((net) => !generatedNets.has(net));
    const missingAliases = (INTERFACE_ALIASES[kind] ?? [])
      .filter((aliases) => !aliases.some((net) => generatedNets.has(net)))
      .map((aliases) => aliases.join('/'));
    const allMissing = [...missingNets, ...missingAliases];
    if (allMissing.length > 0) {
      addFinding(
        findings.blockers,
        `missing-${kind}`,
        `${kind.toUpperCase()} was requested but generated nets are missing: ${allMissing.join(', ')}.`
      );
    }
  }

  if (spec.debug?.note) {
    addFinding(findings.notes, 'debug-profile', spec.debug.note);
  }

  if (spec.boardProfile?.id) {
    addFinding(findings.notes, 'board-profile', `Using supported ${spec.mcu.family} USB-C sensor profile: ${spec.boardProfile.id}.`);
  }

  if (
    /swd/i.test(spec.sourcePrompt ?? '') &&
    spec.debug?.implementedProtocol !== 'esp32-usb-jtag' &&
    !generatedNets.has('SWDIO') &&
    !generatedNets.has('SWCLK')
  ) {
    addFinding(findings.blockers, 'missing-swd', 'SWD was requested but no SWDIO/SWCLK debug connector wiring was generated.');
  }

  if (validation?.skipped) {
    addFinding(findings.warnings, 'validation-skipped', `Validation was skipped: ${validation.reason?.message ?? 'no reason provided'}.`);
  } else if (validation?.erc) {
    if (validation.erc.errorCount > 0) {
      addFinding(findings.blockers, 'erc-errors', `ERC reports ${validation.erc.errorCount} error(s).`);
    }

    if (validation.erc.warningCount > 0) {
      const types = Object.keys(validation.erc.byType ?? {});
      const warningText = types.length > 0 ? ` (${types.join(', ')})` : '';
      addFinding(findings.blockers, 'erc-warnings', `ERC reports ${validation.erc.warningCount} warning(s)${warningText}; release requires zero ERC warnings.`);
    }

    if ((validation.erc.byType?.footprint_link_issues ?? 0) > 0) {
      addFinding(findings.blockers, 'footprint-library-unresolved', 'Footprint library links are unresolved; footprints must resolve before JLCPCB release.');
    }
  } else {
    addFinding(findings.notes, 'validation-needed', 'Run ERC after reviewing or applying changes.');
  }

  if (findings.blockers.length > 0) {
    proposedFixes.push({
      id: 'refine-supported-board-prompt',
      title: 'Refine the supported board and preview a patch',
      summary: `Add exact ${spec.mcu.family} module/chip, regulator, USB-C connector, debug connector, GPIO/SPI/USB pinout, footprints, and JLCPCB sourcing assumptions, then use Preview to inspect the diff before Apply.`,
      approvalRequired: true,
      previewTool: 'schematic.patch'
    });
    residualRisks.push('This project is not release-ready until blockers are resolved and validation reruns cleanly.');
  }

  const status = statusFor(findings, validation);

  return {
    status,
    statusLabel: labelFor(status),
    findings,
    proposedFixes,
    residualRisks
  };
}

function addFinding(target, code, message) {
  if (!target.some((finding) => finding.code === code)) {
    target.push({ code, message });
  }
}

function statusFor(findings, validation) {
  if (findings.blockers.length > 0) {
    return 'blocked';
  }

  if (
    validation?.ok === true &&
    validation?.skipped !== true &&
    validation?.erc?.errorCount === 0 &&
    validation?.erc?.warningCount === 0 &&
    findings.warnings.length === 0
  ) {
    return 'ready-for-release';
  }

  return 'ready-for-prototype-review';
}

function labelFor(status) {
  switch (status) {
    case 'ready-for-release':
      return 'Ready for release';
    case 'ready-for-prototype-review':
      return 'Ready for prototype review';
    default:
      return 'Blocked';
  }
}
