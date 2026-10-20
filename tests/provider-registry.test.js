import './setup/isolate-home.mjs';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildProviderLaunchArgs,
  buildProviderPrompt,
  checkProviderAvailability,
  getProviderDefinition,
  listProviderDefinitions,
  PROMPT_FILE_PLACEHOLDER
} from '../src/runtime/provider-registry.js';

test('provider registry declares codex, claude, copilot, grok, and chatgpt adapters', () => {
  const providers = listProviderDefinitions();

  assert.deepEqual(
    providers.map((provider) => provider.id),
    ['codex', 'claude', 'copilot', 'grok', 'chatgpt']
  );
  assert.equal(getProviderDefinition('codex').command, 'codex');
  assert.equal(getProviderDefinition('claude').command, 'claude');
  assert.equal(getProviderDefinition('copilot').command, 'gh');
  assert.equal(getProviderDefinition('grok').command, 'grok');
  assert.equal(getProviderDefinition('chatgpt').command, null);
  assert.equal(getProviderDefinition('chatgpt').requiresAuth, true);
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

test('grok provider uses json schema output and a prompt-file placeholder', () => {
  const definition = getProviderDefinition('grok');

  assert.equal(definition.command, 'grok');
  assert.ok(definition.args.includes('--prompt-file'));
  assert.ok(definition.args.includes(PROMPT_FILE_PLACEHOLDER));
  assert.ok(definition.args.includes('--output-format'));
  assert.ok(definition.args.includes('json'));
  assert.equal(definition.args.includes('plain'), false);
  const schema = JSON.parse(definition.args[definition.args.indexOf('--json-schema') + 1]);
  assert.equal(schema.properties.type.type, 'string');
  assert.deepEqual(schema.properties.type.enum, ['tool.call']);
  assert.deepEqual(schema.properties.payload.properties.name.enum, ['schematic.generate']);
  assert.equal(schema.properties.payload.properties.args.type, 'object');
  assert.deepEqual(schema.properties.payload.properties.args.required, ['prompt']);
  assert.ok(definition.args.includes('--disable-web-search'));
  assert.ok(definition.args.includes('--permission-mode'));
  assert.ok(definition.args.includes('plan'));
  assert.equal(definition.usePromptFile, true);

  const prompt = buildProviderPrompt({
    provider: 'grok',
    userMessage: 'RP2040 board with USB-C power.',
    allowedTools: ['schematic.generate']
  });
  assert.match(prompt, /structured response/);
  assert.match(prompt, /tool\.call/);
  assert.match(prompt, /schematic\.generate/);
});

test('grok json schema enum is the mutating tool for that project context', () => {
  const definition = getProviderDefinition('grok');
  const projectDir = path.join(tmpdir(), 'chatpcb-project');

  const fresh = schemaFrom(buildProviderLaunchArgs(definition, {
    projectDir,
    allowGenerate: true,
    projectExists: false
  }));
  assert.deepEqual(fresh.properties.payload.properties.name.enum, ['schematic.generate']);
  assert.deepEqual(fresh.properties.payload.properties.args.required, ['prompt']);
  assert.equal(fresh.properties.payload.properties.args.properties.prompt.type, 'string');
  assert.equal(fresh.properties.payload.additionalProperties, false);
  assert.equal(fresh.properties.payload.properties.args.properties.approved, undefined);

  const existingByFlag = schemaFrom(buildProviderLaunchArgs(definition, {
    projectDir,
    allowGenerate: false
  }));
  assert.deepEqual(existingByFlag.properties.payload.properties.name.enum, ['schematic.patch']);
  assert.deepEqual(existingByFlag.properties.payload.properties.args.required, ['prompt']);
  assert.equal(existingByFlag.properties.payload.properties.args.properties.projectName.type, 'string');
  assert.equal(existingByFlag.properties.payload.properties.args.properties.approved, undefined);
  assert.equal(existingByFlag.properties.payload.properties.args.properties.cancel, undefined);
  assert.equal(existingByFlag.properties.payload.properties.args.properties.patchId, undefined);

  const existingBySpec = schemaFrom(buildProviderLaunchArgs(definition, {
    projectDir,
    projectExists: true
  }));
  assert.deepEqual(existingBySpec.properties.payload.properties.name.enum, ['schematic.patch']);

  const both = schemaFrom(buildProviderLaunchArgs(definition, {
    projectDir,
    mutatingTools: ['schematic.generate', 'schematic.patch']
  }));
  assert.deepEqual(
    both.properties.payload.anyOf.map((branch) => branch.properties.name.enum[0]),
    ['schematic.generate', 'schematic.patch']
  );

  const codex = buildProviderLaunchArgs(getProviderDefinition('codex', {}), {
    projectDir,
    projectExists: true,
    allowGenerate: false
  });
  assert.equal(codex.includes('--json-schema'), false);
  assert.equal(codex.includes('--cwd'), false);
  assert.deepEqual(codex, getProviderDefinition('codex', {}).args);
});

test('grok prompt for an existing project includes inspection context and forbids file exploration', () => {
  const prompt = buildProviderPrompt({
    provider: 'grok',
    userMessage: 'Add a status LED.',
    projectDir: path.join(tmpdir(), 'chatpcb-existing'),
    allowedTools: ['schematic.patch'],
    inspectionContext: {
      spec: {
        mcu: { family: 'RP2040' },
        sourcePrompt: 'RP2040 board with USB-C power and I2C connector.'
      },
      summary: { nets: ['SCL', 'SDA'] }
    }
  });

  assert.match(prompt, /schematic\.patch/);
  assert.match(prompt, /Do not explore, read, or modify project files/);
  assert.match(prompt, /Existing project inspection context/);
  assert.match(prompt, /RP2040 board with USB-C power and I2C connector/);
  assert.match(prompt, /SCL/);
  assert.match(prompt, /Add a status LED/);
  assert.equal(prompt.includes('project.inspect'), false);

  const claude = buildProviderPrompt({
    provider: 'claude',
    userMessage: 'Add a status LED.',
    allowedTools: ['schematic.patch', 'project.inspect'],
    inspectionContext: { spec: { mcu: { family: 'RP2040' } } }
  });
  assert.equal(claude.includes('Existing project inspection context'), false);
  assert.equal(claude.includes('Do not explore'), false);
  assert.match(claude, /JSON Lines/);
  assert.match(claude, /project\.inspect/);
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

test('provider registry timeouts default to 120000ms and grok defaults to at least 300000ms', () => {
  const listed = Object.fromEntries(listProviderDefinitions().map((provider) => [provider.id, provider.timeoutMs]));

  assert.equal(listed.codex, 120000);
  assert.equal(listed.claude, 120000);
  assert.equal(listed.copilot, 120000);
  assert.ok(listed.grok >= 300000);

  assert.equal(getProviderDefinition('codex', {}).timeoutMs, 120000);
  assert.equal(getProviderDefinition('claude', {}).timeoutMs, 120000);
  assert.equal(getProviderDefinition('copilot', {}).timeoutMs, 120000);
  assert.ok(getProviderDefinition('grok', {}).timeoutMs >= 300000);
});

test('provider timeout env overrides are validated and the per-provider value wins', () => {
  assert.equal(
    getProviderDefinition('claude', { CHATPCB_PROVIDER_TIMEOUT_MS: '150000' }).timeoutMs,
    150000
  );
  assert.equal(
    getProviderDefinition('grok', { CHATPCB_PROVIDER_TIMEOUT_MS: '150000' }).timeoutMs,
    150000
  );
  assert.equal(
    getProviderDefinition('grok', {
      CHATPCB_PROVIDER_TIMEOUT_MS: '180000',
      CHATPCB_GROK_TIMEOUT_MS: '420000'
    }).timeoutMs,
    420000
  );
  assert.equal(
    getProviderDefinition('codex', {
      CHATPCB_PROVIDER_TIMEOUT_MS: '180000',
      CHATPCB_GROK_TIMEOUT_MS: '420000',
      CHATPCB_CODEX_TIMEOUT_MS: ' 90000 '
    }).timeoutMs,
    90000
  );
  assert.equal(
    getProviderDefinition('grok', {
      CHATPCB_GROK_TIMEOUT_MS: '   ',
      CHATPCB_PROVIDER_TIMEOUT_MS: ''
    }).timeoutMs >= 300000,
    true
  );

  assert.throws(
    () => getProviderDefinition('grok', { CHATPCB_GROK_TIMEOUT_MS: 'soon', CHATPCB_PROVIDER_TIMEOUT_MS: '500000' }),
    /Invalid CHATPCB_GROK_TIMEOUT_MS/
  );
  assert.throws(
    () => getProviderDefinition('codex', { CHATPCB_PROVIDER_TIMEOUT_MS: '0' }),
    /Invalid CHATPCB_PROVIDER_TIMEOUT_MS/
  );
  assert.throws(
    () => getProviderDefinition('claude', { CHATPCB_CLAUDE_TIMEOUT_MS: '-5' }),
    /Invalid CHATPCB_CLAUDE_TIMEOUT_MS/
  );
  assert.throws(
    () => getProviderDefinition('copilot', { CHATPCB_COPILOT_TIMEOUT_MS: '1.5' }),
    /Invalid CHATPCB_COPILOT_TIMEOUT_MS/
  );
  assert.throws(
    () => getProviderDefinition('grok', { CHATPCB_GROK_TIMEOUT_MS: '2147483648' }),
    /Invalid CHATPCB_GROK_TIMEOUT_MS/
  );
});

test('grok launch args pass --cwd before the model and prompt file', () => {
  const definition = getProviderDefinition('grok', { CHATPCB_GROK_MODEL: 'grok-2-latest' });
  const projectDir = path.join(tmpdir(), 'chatpcb-project');
  const args = buildProviderLaunchArgs(definition, projectDir);

  assert.deepEqual(args.slice(0, 6), [
    '--cwd',
    projectDir,
    '--model',
    'grok-2-latest',
    '--prompt-file',
    PROMPT_FILE_PLACEHOLDER
  ]);
  assert.equal(buildProviderLaunchArgs(definition).includes('--cwd'), false);
  assert.equal(buildProviderLaunchArgs(getProviderDefinition('codex', {}), projectDir).includes('--cwd'), false);
});

test('provider detection resolves an executable on PATH without a login shell', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-provider-path-'));
  const bin = path.join(root, 'bin');
  const home = path.join(root, 'home');
  const executable = path.join(bin, commandFileName('grok'));

  try {
    await mkdir(home, { recursive: true });
    await writeExecutable(executable);

    const result = await checkProviderAvailability({
      provider: 'grok',
      env: isolatedProviderEnv(home, bin),
      platform: process.platform,
      cwd: root
    });

    assert.equal(result.available, true);
    assert.equal(result.status, 'available');
    assert.equal(result.resolvedPath, executable);
    assert.equal(result.command, executable);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('grok detection probes ~/.grok/bin under a temp HOME when PATH misses it', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-provider-home-'));
  const home = path.join(root, 'home');
  const emptyBin = path.join(root, 'empty-bin');
  const grokHomeBin = path.join(home, '.grok', 'bin', commandFileName('grok'));
  const localBin = path.join(home, '.local', 'bin', commandFileName('grok'));

  try {
    await mkdir(emptyBin, { recursive: true });
    await writeExecutable(grokHomeBin);
    await writeExecutable(localBin);

    const fromGrokHome = await checkProviderAvailability({
      provider: 'grok',
      env: isolatedProviderEnv(home, emptyBin),
      platform: process.platform,
      cwd: root
    });

    assert.equal(fromGrokHome.available, true);
    assert.equal(fromGrokHome.resolvedPath, grokHomeBin);
    assert.equal(fromGrokHome.command, grokHomeBin);

    await rm(path.dirname(grokHomeBin), { force: true, recursive: true });

    const fromLocalBin = await checkProviderAvailability({
      provider: 'grok',
      env: isolatedProviderEnv(home, emptyBin),
      platform: process.platform,
      cwd: root
    });

    assert.equal(fromLocalBin.resolvedPath, localBin);

    const codex = await checkProviderAvailability({
      provider: 'codex',
      env: isolatedProviderEnv(home, emptyBin),
      platform: process.platform,
      cwd: root
    });
    assert.equal(codex.available, false);
    assert.equal(codex.resolvedPath, null);
    assert.equal(codex.command, 'codex');
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('CHATPCB_GROK_PATH overrides PATH and home probes when it is an absolute executable', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-provider-override-'));
  const home = path.join(root, 'home');
  const bin = path.join(root, 'bin');
  const pathGrok = path.join(bin, commandFileName('grok'));
  const override = path.join(root, 'custom', commandFileName('grok'));

  try {
    await mkdir(home, { recursive: true });
    await writeExecutable(pathGrok);
    await writeExecutable(path.join(home, '.grok', 'bin', commandFileName('grok')));
    await writeExecutable(override);

    const selected = await checkProviderAvailability({
      provider: 'grok',
      env: isolatedProviderEnv(home, bin, { CHATPCB_GROK_PATH: override }),
      platform: process.platform,
      cwd: root
    });

    assert.equal(selected.available, true);
    assert.equal(selected.resolvedPath, override);
    assert.equal(selected.command, override);

    const missing = await checkProviderAvailability({
      provider: 'grok',
      env: isolatedProviderEnv(home, bin, { CHATPCB_GROK_PATH: path.join(root, 'missing-grok') }),
      platform: process.platform,
      cwd: root
    });
    assert.equal(missing.available, false);
    assert.equal(missing.resolvedPath, null);
    assert.equal(missing.status, 'missing');

    const relative = await checkProviderAvailability({
      provider: 'grok',
      env: isolatedProviderEnv(home, bin, { CHATPCB_GROK_PATH: commandFileName('grok') }),
      platform: process.platform,
      cwd: root
    });
    assert.equal(relative.available, false);
    assert.equal(relative.resolvedPath, null);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('CHATPCB_GROK_PATH rejects a non-executable file', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-provider-nonexec-'));
  const home = path.join(root, 'home');
  const bin = path.join(root, 'bin');
  const override = path.join(root, 'custom', 'grok');

  try {
    await mkdir(home, { recursive: true });
    await writeExecutable(path.join(bin, 'grok'));
    await mkdir(path.dirname(override), { recursive: true });
    await writeFile(override, '#!/bin/sh\nexit 0\n', { mode: 0o644 });

    const result = await checkProviderAvailability({
      provider: 'grok',
      env: isolatedProviderEnv(home, bin, { CHATPCB_GROK_PATH: override }),
      platform: process.platform,
      cwd: root
    });

    assert.equal(result.available, false);
    assert.equal(result.resolvedPath, null);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('provider detection reports a missing binary when PATH and grok home probes miss', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-provider-missing-'));
  const home = path.join(root, 'home');
  const emptyBin = path.join(root, 'empty-bin');

  try {
    await mkdir(home, { recursive: true });
    await mkdir(emptyBin, { recursive: true });

    const result = await checkProviderAvailability({
      provider: 'grok',
      env: isolatedProviderEnv(home, emptyBin),
      platform: process.platform,
      cwd: root
    });

    assert.equal(result.available, false);
    assert.equal(result.status, 'missing');
    assert.equal(result.resolvedPath, null);
    assert.equal(result.command, 'grok');
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('Windows provider lookup honors PATHEXT and searches PATH before grok home bins', async () => {
  const probed = [];
  const result = await checkProviderAvailability({
    provider: 'grok',
    platform: 'win32',
    env: {
      Path: 'C:\\tools',
      PATHEXT: '.EXE;.CMD',
      USERPROFILE: 'C:\\Users\\tester'
    },
    isExecutable: async (candidate) => {
      probed.push(candidate);
      return candidate === 'C:\\tools\\grok.CMD';
    }
  });

  assert.equal(result.available, true);
  assert.equal(result.resolvedPath, 'C:\\tools\\grok.CMD');
  assert.equal(result.command, result.resolvedPath);
  assert.deepEqual(probed, ['C:\\tools\\grok.EXE', 'C:\\tools\\grok.CMD']);

  const homeProbes = [];
  const fromHome = await checkProviderAvailability({
    provider: 'grok',
    platform: 'win32',
    env: {
      PATH: 'C:\\empty',
      PATHEXT: '.EXE',
      USERPROFILE: 'C:\\Users\\tester'
    },
    isExecutable: async (candidate) => {
      homeProbes.push(candidate);
      return candidate === 'C:\\Users\\tester\\.local\\bin\\grok.EXE';
    }
  });

  assert.equal(fromHome.resolvedPath, 'C:\\Users\\tester\\.local\\bin\\grok.EXE');
  assert.deepEqual(homeProbes, [
    'C:\\empty\\grok.EXE',
    'C:\\Users\\tester\\.grok\\bin\\grok.EXE',
    'C:\\Users\\tester\\.local\\bin\\grok.EXE'
  ]);
});

function schemaFrom(args) {
  return JSON.parse(args[args.indexOf('--json-schema') + 1]);
}

function commandFileName(command) {
  return process.platform === 'win32' ? `${command}.CMD` : command;
}

function isolatedProviderEnv(home, pathValue, extra = {}) {
  return {
    PATH: pathValue,
    HOME: home,
    USERPROFILE: home,
    ...(process.platform === 'win32' ? { PATHEXT: '.CMD;.EXE;.BAT;.COM' } : {}),
    ...extra
  };
}

async function writeExecutable(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await chmod(filePath, 0o755);
}

test('invalid timeout env falls back for provider list and status instead of throwing', async () => {
  const grokEnv = {
    PATH: '',
    HOME: path.join(tmpdir(), 'chatpcb-no-home'),
    USERPROFILE: path.join(tmpdir(), 'chatpcb-no-home'),
    CHATPCB_GROK_TIMEOUT_MS: 'soon',
    CHATPCB_PROVIDER_TIMEOUT_MS: '180000'
  };
  const listed = listProviderDefinitions(grokEnv);
  const grok = listed.find((provider) => provider.id === 'grok');
  const claude = listed.find((provider) => provider.id === 'claude');

  assert.ok(grok.timeoutMs >= 300000);
  assert.match(grok.warning, /Invalid CHATPCB_GROK_TIMEOUT_MS/);
  assert.equal(claude.timeoutMs, 180000);
  assert.equal(claude.warning, undefined);

  const status = await checkProviderAvailability({
    provider: 'grok',
    env: grokEnv,
    commandExistsImpl: async () => true
  });
  assert.equal(status.available, true);
  assert.equal(status.status, 'available');
  assert.ok(status.timeoutMs >= 300000);
  assert.match(status.warning, /Invalid CHATPCB_GROK_TIMEOUT_MS/);

  const globalEnv = {
    PATH: '',
    HOME: path.join(tmpdir(), 'chatpcb-no-home'),
    USERPROFILE: path.join(tmpdir(), 'chatpcb-no-home'),
    CHATPCB_CODEX_TIMEOUT_MS: '90000',
    CHATPCB_PROVIDER_TIMEOUT_MS: '0'
  };
  const providers = listProviderDefinitions(globalEnv);
  const codex = providers.find((provider) => provider.id === 'codex');
  const copilot = providers.find((provider) => provider.id === 'copilot');
  assert.equal(codex.timeoutMs, 90000);
  assert.equal(codex.warning, undefined);
  assert.equal(copilot.timeoutMs, 120000);
  assert.match(copilot.warning, /Invalid CHATPCB_PROVIDER_TIMEOUT_MS/);

  const missing = await checkProviderAvailability({
    provider: 'codex',
    env: {
      PATH: '',
      HOME: path.join(tmpdir(), 'chatpcb-no-home'),
      USERPROFILE: path.join(tmpdir(), 'chatpcb-no-home'),
      CHATPCB_PROVIDER_TIMEOUT_MS: '0'
    },
    platform: 'linux',
    cwd: tmpdir()
  });
  assert.equal(missing.available, false);
  assert.equal(missing.status, 'missing');
  assert.equal(missing.timeoutMs, 120000);
  assert.match(missing.warning, /Invalid CHATPCB_PROVIDER_TIMEOUT_MS/);

  const blank = listProviderDefinitions({
    CHATPCB_GROK_TIMEOUT_MS: '   ',
    CHATPCB_PROVIDER_TIMEOUT_MS: ''
  }).find((provider) => provider.id === 'grok');
  assert.ok(blank.timeoutMs >= 300000);
  assert.equal(blank.warning, undefined);

  assert.throws(
    () => getProviderDefinition('grok', grokEnv),
    /Invalid CHATPCB_GROK_TIMEOUT_MS/
  );
});
