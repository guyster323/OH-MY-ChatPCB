import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { generateMcuPeripheralProject } from '../src/workflow/generate-mcu-project.js';
import { FIXTURE_LIBS, restoreKicadLibraryEnv, setKicadLibraryEnv } from './helpers/kicad-library-env.js';

describe('README ESP32-S3 example', () => {
  test('Korean README ESP32-S3 gas sensor example renders without dropped symbols', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-readme-esp32-'));
    const previous = setKicadLibraryEnv({
      symbols: FIXTURE_LIBS.symbols,
      footprints: FIXTURE_LIBS.footprints
    });

    try {
      const result = await generateMcuPeripheralProject({
        projectDir: root,
        prompt: 'ESP32-S3와 가스 센서를 연결하고 3.3V 전원을 사용하는 회로를 만들어줘.'
      });

      const schematic = await readFile(result.files.schematic, 'utf8');
      const metadata = JSON.parse(await readFile(result.files.spec, 'utf8'));

      // Should select the supported ESP32-S3 profile
      assert.equal(metadata.boardProfile?.id, 'esp32-s3-usbc-sensor');

      // All schematic components should have their symbols rendered
      const componentRefs = metadata.schematic.components.map((c) => c.ref);
      assert.ok(componentRefs.length > 0, 'Should have schematic components');

      for (const component of metadata.schematic.components) {
        // Each component should appear in the schematic with its symbol
        const refPattern = new RegExp(`\\(property "Reference" "${component.ref}"`, 'g');
        const matches = schematic.match(refPattern);
        assert.ok(
          matches && matches.length >= 1,
          `Component ${component.ref} should appear in schematic (found ${matches?.length ?? 0} times)`
        );
      }

      // lib_symbols section should contain all required official symbols
      const libSymbolsMatch = schematic.match(/\(lib_symbols([\s\S]*?)\n  \)/);
      assert.ok(libSymbolsMatch, 'Should have lib_symbols section');
      const libSymbolsContent = libSymbolsMatch[1];

      // Required official symbols for the ESP32-S3 profile
      const requiredOfficialSymbols = [
        'Device:R',
        'Device:C',
        'Device:LED',
        'Switch:SW_Push',
        'Connector_Generic:Conn_01x04',
        'Connector_Generic:Conn_01x05',
        'Connector_Generic:Conn_01x06',
        'Connector:USB_C_Receptacle_USB2.0_16P',
        'Regulator_Switching:TPS62177DQC'
      ];

      for (const symbolId of requiredOfficialSymbols) {
        // KiCad caches library symbols in lib_symbols as (symbol "Library:Name" ...)
        const escapedId = symbolId.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
        const symbolPattern = new RegExp(`\\(symbol "${escapedId}"`);
        assert.ok(
          symbolPattern.test(libSymbolsContent),
          `lib_symbols should contain ${symbolId}`
        );
      }

      // Should not have dangling labels (labels without connected wires/pins)
      const labelCount = (schematic.match(/\(label "/g) || []).length;
      const wireCount = (schematic.match(/\(wire\b/g) || []).length;
      const junctionCount = (schematic.match(/\(junction /g) || []).length;
      
      assert.ok(labelCount > 0, 'Should have labels');
      assert.ok(wireCount > 0, 'Should have wires connecting labels');
      
      // Ratio check: if there are many labels but very few wires, symbols were likely dropped
      assert.ok(
        wireCount >= labelCount * 0.3,
        `Wire count (${wireCount}) should be reasonable relative to label count (${labelCount})`
      );
    } finally {
      restoreKicadLibraryEnv(previous);
      await rm(root, { force: true, recursive: true });
    }
  });

  test('Missing required symbol library fails fast with KICAD_LIBRARY_MISSING', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-missing-lib-'));
    const emptyLib = path.join(root, 'empty-lib');
    const previous = setKicadLibraryEnv({
      symbols: emptyLib,
      footprints: FIXTURE_LIBS.footprints
    });

    try {

      await assert.rejects(
        async () => {
          await generateMcuPeripheralProject({
            projectDir: path.join(root, 'project'),
            prompt: 'ESP32-S3와 가스 센서를 연결하고 3.3V 전원을 사용하는 회로를 만들어줘.'
          });
        },
        (error) => {
          assert.ok(
            error.message.includes('KICAD_LIBRARY_MISSING'),
            `Error should contain KICAD_LIBRARY_MISSING, got: ${error.message}`
          );
          assert.ok(
            error.message.includes('Device') || error.message.includes('Symbol'),
            'Error should mention the missing library'
          );
          return true;
        }
      );
    } finally {
      restoreKicadLibraryEnv(previous);
      await rm(root, { force: true, recursive: true });
    }
  });
});
