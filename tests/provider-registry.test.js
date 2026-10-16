import assert from 'node:assert/strict';
import test from 'node:test';

import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import {
  buildProviderPrompt,
  checkProviderAvailability,
  getProviderDefinition,
  getProviderInstallHint,
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

test('all providers have install hints when missing', async () => {
  const providers = listProviderDefinitions().map((provider) => provider.id);
  assert.deepEqual(providers, ['codex', 'claude', 'copilot']);

  for (const provider of providers) {
    const definition = getProviderDefinition(provider);
    assert.equal(definition.id, provider, `${provider} must exist in the registry`);
    const result = await checkProviderAvailability({
      provider,
      commandExistsImpl: async () => false
    });

    assert.equal(result.status, 'missing', `${provider} should be missing`);
    assert.equal(typeof result.hint, 'string', `${provider} should have a hint`);
    assert.ok(result.hint.length > 0, `${provider} should have a hint`);
    assert.match(result.hint, /install/i, `${provider} hint should mention installation`);
    assert.equal(result.hint, getProviderInstallHint(provider));
    assert.notEqual(result.hint, getProviderInstallHint('not-a-provider'));
  }

  assert.match(getProviderInstallHint('copilot'), /\bgh\b/);
  assert.doesNotMatch(getProviderInstallHint('copilot'), /grok/i);
});

test('provider status uses the daemon PATH, not a login-shell profile', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-provider-path-'));
  const binDir = path.join(root, 'bin');
  const home = path.join(root, 'home');
  await mkdir(binDir);
  await mkdir(home);
  const commandPath = path.join(binDir, 'codex');
  await writeFile(commandPath, '#!/bin/sh\nexit 0\n', 'utf8');
  await chmod(commandPath, 0o755);
  const profile = `export PATH="${binDir}:$PATH"\n`;
  await writeFile(path.join(home, '.profile'), profile, 'utf8');
  await writeFile(path.join(home, '.bash_profile'), profile, 'utf8');
  await writeFile(path.join(home, '.bashrc'), profile, 'utf8');

  const hiddenEnv = {
    PATH: '/usr/bin:/bin',
    HOME: home,
    BASH_ENV: '',
    ENV: ''
  };
  const visibleEnv = { ...hiddenEnv, PATH: `${binDir}:/usr/bin:/bin` };

  try {
    const hidden = await checkProviderAvailability({ provider: 'codex', env: hiddenEnv });
    const hiddenSpawn = await spawnOutcome('codex', { ...process.env, ...hiddenEnv });
    assert.equal(hidden.available, false);
    assert.equal(hidden.status, 'missing');
    assert.match(hidden.hint, /npm install -g @openai\/codex/);
    assert.equal(hiddenSpawn.error, 'ENOENT');

    const visible = await checkProviderAvailability({ provider: 'codex', env: visibleEnv });
    const visibleSpawn = await spawnOutcome('codex', { ...process.env, ...visibleEnv });
    assert.equal(visible.available, true);
    assert.equal(visible.status, 'available');
    assert.equal(visible.hint, null);
    assert.equal(visibleSpawn.code, 0);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('README provider setup matches the executable-only availability check', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const section = readme.slice(readme.indexOf('## Provider setup'), readme.indexOf('## Browser UI verification'));

  assert.ok(section.startsWith('## Provider setup'));
  assert.equal(section.includes('```powershell'), false);
  assert.match(section, /```bash/);
  assert.doesNotMatch(section, /grok/i);
  assert.doesNotMatch(readme, /npm bin -g/);
  assert.match(readme, /npm prefix -g/);
  assert.match(readme, /Node\.js 22 or later/);
  assert.match(section, /daemon's PATH/);
  assert.match(section, /`gh` executable/);
  assert.match(section, /does not run `gh extension list`/);
  assert.match(section, /`copilot: available` means `gh` was found/);
  assert.match(section, /`copilot: missing` means `gh` was not found/);
});

function spawnOutcome(command, env) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const child = spawn(command, [], { env, stdio: 'ignore' });
    child.on('error', (error) => finish({ error: error.code ?? error.message }));
    child.on('close', (code) => finish({ code }));
  });
}

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
