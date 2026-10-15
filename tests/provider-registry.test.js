import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProviderPrompt,
  checkProviderAvailability,
  getProviderDefinition,
  listProviderDefinitions
} from '../src/runtime/provider-registry.js';

test('provider registry declares codex, claude, and copilot adapters', () => {
  const providers = listProviderDefinitions();

  assert.deepEqual(
    providers.map((provider) => provider.id),
    ['codex', 'claude', 'copilot']
  );
  assert.equal(getProviderDefinition('codex').command, 'codex');
  assert.equal(getProviderDefinition('claude').command, 'claude');
  assert.equal(getProviderDefinition('copilot').command, 'gh');
});

test('provider availability uses injectable command probing', async () => {
  const probed = [];

  const result = await checkProviderAvailability({
    provider: 'codex',
    commandExistsImpl: async (command) => {
      probed.push(command);
      return command === 'codex';
    }
  });

  assert.equal(result.available, true);
  assert.equal(result.command, 'codex');
  assert.deepEqual(probed, ['codex']);
});

test('provider availability includes install hint when missing', async () => {
  const result = await checkProviderAvailability({
    provider: 'codex',
    commandExistsImpl: async () => false
  });

  assert.equal(result.available, false);
  assert.equal(result.status, 'missing');
  assert.ok(result.hint, 'hint should be present when provider is missing');
  assert.match(result.hint, /npm install/i, 'hint should mention installation');
  assert.match(result.hint, /codex login/i, 'hint should mention authentication');
});

test('provider availability returns no hint when available', async () => {
  const result = await checkProviderAvailability({
    provider: 'codex',
    commandExistsImpl: async () => true
  });

  assert.equal(result.available, true);
  assert.equal(result.status, 'available');
  assert.equal(result.hint, null, 'hint should be null when provider is available');
});

test('provider prompt constrains local agents to allowed tool-call JSON', () => {
  const prompt = buildProviderPrompt({
    provider: 'claude',
    userMessage: 'Generate an STM32 board.',
    allowedTools: ['schematic.generate', 'validate.erc']
  });

  assert.match(prompt, /claude/i);
  assert.match(prompt, /Generate an STM32 board\./);
  assert.match(prompt, /schematic\.generate/);
  assert.match(prompt, /validate\.erc/);
  assert.match(prompt, /JSON Lines/);
  assert.match(prompt, /Do not emit tool\.result/);
});
