import path from 'node:path';

import { setSymbolLibraryCandidateOverrideForTests } from '../../src/kicad/project-generator.js';

export const FIXTURE_LIBS = {
  symbols: path.resolve(import.meta.dirname, '../fixtures/kicad-libraries/symbols'),
  footprints: path.resolve(import.meta.dirname, '../fixtures/kicad-libraries/footprints')
};

export function restoreProcessEnv(key, previous) {
  if (previous === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = previous;
  }
}

export function captureKicadLibraryEnv() {
  return {
    KICAD_SYMBOL_DIR: process.env.KICAD_SYMBOL_DIR,
    KICAD_FOOTPRINT_DIR: process.env.KICAD_FOOTPRINT_DIR
  };
}

export function restoreKicadLibraryEnv(previous) {
  restoreProcessEnv('KICAD_SYMBOL_DIR', previous.KICAD_SYMBOL_DIR);
  restoreProcessEnv('KICAD_FOOTPRINT_DIR', previous.KICAD_FOOTPRINT_DIR);
  if (Object.hasOwn(previous, 'symbolCandidates')) {
    setSymbolLibraryCandidateOverrideForTests(previous.symbolCandidates);
  }
}

export function setKicadLibraryEnv({ symbols, footprints, symbolCandidates } = {}) {
  const previous = captureKicadLibraryEnv();
  if (symbols !== undefined) {
    process.env.KICAD_SYMBOL_DIR = symbols;
  }
  if (footprints !== undefined) {
    process.env.KICAD_FOOTPRINT_DIR = footprints;
  }
  if (symbolCandidates !== undefined) {
    previous.symbolCandidates = setSymbolLibraryCandidateOverrideForTests(symbolCandidates);
  }
  return previous;
}
