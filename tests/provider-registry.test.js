import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProviderPrompt,
  checkProviderAvailability,
  getProviderDefinition,
  listProviderDefinitions
} from '../src/runtime/provider-registry.js';

test('provider registry declares codex, claude, copilot, and grok adapters', () => {
  const providers = listProviderDefinitions();

  assert.deepEqual(
    providers.map((provider) => provider.id),
    ['codex', 'claude', 'copilot', 'grok']
  );
  assert.equal(getProviderDefinition('codex').command, 'codex');
  assert.equal(getProviderDefinition('claude').command, 'claude');
  assert.equal(getProviderDefinition('copilot').command, 'gh');
  assert.equal(getProviderDefinition('grok').command, 'grok');
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

test('grok provider uses plain output format and prompt-file with temp placeholder', () => {
  const definition = getProviderDefinition('grok');

  assert.equal(definition.command, 'grok');
  assert.ok(definition.args.includes('--prompt-file'));
  assert.ok(definition.args.includes('<temp>'));
  assert.ok(definition.args.includes('--output-format'));
  assert.ok(definition.args.includes('plain'));
  assert.ok(definition.args.includes('--disable-web-search'));
  assert.ok(definition.args.includes('--permission-mode'));
  assert.ok(definition.args.includes('plan'));
  assert.equal(definition.usePromptFile, true);
});

test('grok provider supports CHATPCB_GROK_MODEL environment variable', () => {
  const originalModel = process.env.CHATPCB_GROK_MODEL;

  try {
    process.env.CHATPCB_GROK_MODEL = 'grok-2-latest';
    const definition = getProviderDefinition('grok');

    assert.ok(definition.args.includes('--model'));
    assert.ok(definition.args.includes('grok-2-latest'));

    const modelIndex = definition.args.indexOf('--model');
    const promptFileIndex = definition.args.indexOf('--prompt-file');
    assert.ok(modelIndex < promptFileIndex, 'model flag should come before prompt-file');
  } finally {
    if (originalModel === undefined) {
      delete process.env.CHATPCB_GROK_MODEL;
    } else {
      process.env.CHATPCB_GROK_MODEL = originalModel;
    }
  }
});
