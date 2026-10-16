import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export const PROMPT_FILE_PLACEHOLDER = '__PROMPT_FILE__';

const DEFAULT_PROVIDER_TIMEOUT_MS = 120000;
const GROK_PROVIDER_TIMEOUT_MS = 300000;
const MAX_PROVIDER_TIMEOUT_MS = 2147483647;
const DEFAULT_WINDOWS_PATHEXT = ['.COM', '.EXE', '.BAT', '.CMD'];

// Proven with `grok --json-schema` in a temp directory: the json result's
// structuredOutput is the tool call. `--output-format plain` only returns prose.
const GROK_TOOL_CALL_SCHEMA = JSON.stringify({
  type: 'object',
  additionalProperties: false,
  required: ['type', 'payload'],
  properties: {
    type: { type: 'string' },
    payload: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name', 'args'],
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        args: { type: 'object' }
      }
    }
  }
});

const PROVIDERS = [
  {
    id: 'codex',
    label: 'Codex CLI',
    command: 'codex',
    args: ['exec', '--json'],
    description: 'Uses an already-authenticated local Codex CLI session.',
    timeoutMs: DEFAULT_PROVIDER_TIMEOUT_MS
  },
  {
    id: 'claude',
    label: 'Claude Code',
    command: 'claude',
    args: ['--print'],
    description: 'Uses an already-authenticated local Claude Code CLI session.',
    timeoutMs: DEFAULT_PROVIDER_TIMEOUT_MS
  },
  {
    id: 'copilot',
    label: 'GitHub Copilot CLI',
    command: 'gh',
    args: ['copilot', 'suggest'],
    description: 'Uses an already-authenticated GitHub CLI Copilot extension.',
    timeoutMs: DEFAULT_PROVIDER_TIMEOUT_MS
  },
  {
    id: 'grok',
    label: 'Grok Build',
    command: 'grok',
    args: ['--prompt-file', PROMPT_FILE_PLACEHOLDER, '--output-format', 'json', '--json-schema', GROK_TOOL_CALL_SCHEMA, '--disable-web-search', '--permission-mode', 'plan'],
    description: 'Uses an already-authenticated local Grok Build CLI session (grok login or XAI_API_KEY).',
    usePromptFile: true,
    modelEnvVar: 'CHATPCB_GROK_MODEL',
    modelFlagName: '--model',
    modelFlagPosition: 'before-prompt-file',
    timeoutMs: GROK_PROVIDER_TIMEOUT_MS
  }
];

export function listProviderDefinitions(env = process.env) {
  return PROVIDERS.map((provider) => {
    const copy = { ...provider, args: [...provider.args] };
    applyResolvedTimeout(copy, env, false);
    return copy;
  });
}

export function getProviderDefinition(provider, env = process.env, { strictTimeout = true } = {}) {
  const match = PROVIDERS.find((candidate) => candidate.id === provider);
  if (!match) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  const definition = { ...match, args: [...match.args] };

  if (definition.modelEnvVar && definition.modelFlagName) {
    const modelValue = env[definition.modelEnvVar];
    if (modelValue) {
      const insertPosition =
        definition.modelFlagPosition === 'before-prompt-file'
          ? definition.args.indexOf('--prompt-file')
          : definition.args.length;

      if (insertPosition !== -1) {
        definition.args.splice(insertPosition, 0, definition.modelFlagName, modelValue);
      }
    }
  }

  applyResolvedTimeout(definition, env, strictTimeout);
  return definition;
}

export function buildProviderLaunchArgs(definition, projectDir) {
  const args = [...(definition?.args ?? [])];
  if (definition?.id === 'grok' && typeof projectDir === 'string' && projectDir.length > 0) {
    args.unshift('--cwd', projectDir);
  }
  return args;
}

export function resolveProviderTimeoutMs(providerId, defaultTimeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS, env = process.env) {
  const resolved = resolveProviderTimeout(providerId, defaultTimeoutMs, env);
  if (resolved.warning) throw new Error(resolved.warning);
  return resolved.timeoutMs;
}

function resolveProviderTimeout(providerId, defaultTimeoutMs, env) {
  const specificName = `CHATPCB_${String(providerId).toUpperCase()}_TIMEOUT_MS`;
  const specific = readTimeoutEnv(env, specificName);
  if (specific.warning) return { timeoutMs: defaultTimeoutMs, warning: specific.warning };
  if (specific.value !== undefined) return { timeoutMs: specific.value };

  const globalTimeout = readTimeoutEnv(env, 'CHATPCB_PROVIDER_TIMEOUT_MS');
  if (globalTimeout.warning) return { timeoutMs: defaultTimeoutMs, warning: globalTimeout.warning };
  if (globalTimeout.value !== undefined) return { timeoutMs: globalTimeout.value };

  return { timeoutMs: defaultTimeoutMs };
}

function applyResolvedTimeout(definition, env, strictTimeout) {
  const resolved = resolveProviderTimeout(definition.id, definition.timeoutMs, env);
  if (resolved.warning && strictTimeout) {
    throw new Error(resolved.warning);
  }
  definition.timeoutMs = resolved.timeoutMs;
  if (resolved.warning) definition.warning = resolved.warning;
}

export async function checkProviderAvailability({
  provider,
  commandExistsImpl,
  env = process.env,
  platform = process.platform,
  cwd = process.cwd(),
  home,
  isExecutable
} = {}) {
  const definition = getProviderDefinition(provider, env, { strictTimeout: false });

  if (commandExistsImpl) {
    const available = await commandExistsImpl(definition.command);
    return providerAvailability(definition, {
      command: definition.command,
      resolvedPath: null,
      available: Boolean(available),
      status: available ? 'available' : 'missing'
    });
  }

  const resolvedPath = await resolveProviderExecutable({
    command: definition.command,
    provider: definition.id,
    env,
    platform,
    cwd,
    home,
    isExecutable
  });

  return providerAvailability(definition, {
    command: resolvedPath ?? definition.command,
    resolvedPath,
    available: Boolean(resolvedPath),
    status: resolvedPath ? 'available' : 'missing'
  });
}

function providerAvailability(definition, fields) {
  return {
    provider: definition.id,
    ...fields,
    timeoutMs: definition.timeoutMs,
    ...(definition.warning ? { warning: definition.warning } : {})
  };
}

export function buildProviderPrompt({ provider, userMessage, projectDir, allowedTools = [] } = {}) {
  const definition = getProviderDefinition(provider);
  const toolList = allowedTools.length ? allowedTools.map((tool) => `- ${tool}`).join('\n') : '- no tools allowed';

  const toolCallShape = '{"type":"tool.call","payload":{"id":"call_<id>","name":"<tool>","args":{}}}';
  const instructions = provider === 'grok'
    ? [
      `You are running as the ${definition.label} adapter for ChatPCB.`,
      'Choose one allowed ChatPCB tool and return it as the structured response:',
      toolCallShape,
      'Set type to tool.call. Put the user request in args when that tool needs a prompt.',
      'Do not emit tool.result. The local daemon executes tools and returns results.',
      'Do not modify project files yourself.',
      'Do not include API keys, tokens, or credentials in output.'
    ]
    : [
      `You are running as the ${definition.label} adapter for ChatPCB.`,
      'Respond with normal assistant text for reasoning or status.',
      'When you need ChatPCB to act, emit exactly one JSON Lines object on its own line:',
      toolCallShape,
      'Do not emit tool.result. The local daemon executes tools and returns results.',
      'Do not include API keys, tokens, or credentials in output.'
    ];

  return [
    ...instructions,
    'Allowed tool names:',
    toolList,
    '',
    'User request:',
    userMessage ?? '',
    '',
    projectDir ? `Project directory: ${projectDir}` : 'Project directory: not provided'
  ].join('\n');
}

export async function resolveProviderExecutable({
  command,
  provider,
  env = process.env,
  platform = process.platform,
  cwd = process.cwd(),
  home,
  isExecutable = isExecutableFile
} = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const resolvedHome = home || resolveHomeDirectory(env, platform);

  if (provider === 'grok') {
    const override = env.CHATPCB_GROK_PATH;
    if (override !== undefined && String(override).trim() !== '') {
      const candidate = String(override).trim();
      if (!paths.isAbsolute(candidate)) return null;
      return (await isExecutable(candidate)) ? candidate : null;
    }
  }

  for (const entry of pathEntries(env, platform)) {
    const directory = paths.isAbsolute(entry) ? entry : paths.resolve(cwd, entry);
    const found = await findExecutableInDirectory(directory, command, platform, env, paths, isExecutable);
    if (found) return found;
  }

  if (provider === 'grok') {
    const extraDirectories = [
      paths.join(resolvedHome, '.grok', 'bin'),
      paths.join(resolvedHome, '.local', 'bin')
    ];
    for (const directory of extraDirectories) {
      const found = await findExecutableInDirectory(directory, 'grok', platform, env, paths, isExecutable);
      if (found) return found;
    }
  }

  return null;
}

function readTimeoutEnv(env, name) {
  if (!env || !Object.prototype.hasOwnProperty.call(env, name)) return {};
  const raw = env[name];
  if (raw === undefined || raw === null) return {};

  const text = String(raw).trim();
  if (text === '') return {};
  if (!/^\d+$/.test(text)) {
    return { warning: invalidTimeoutMessage(name) };
  }

  const value = Number(text);
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_PROVIDER_TIMEOUT_MS) {
    return { warning: invalidTimeoutMessage(name) };
  }

  return { value };
}

function invalidTimeoutMessage(name) {
  return `Invalid ${name}: expected a positive integer millisecond timeout no greater than ${MAX_PROVIDER_TIMEOUT_MS}.`;
}

function pathEntries(env, platform) {
  const raw = platform === 'win32'
    ? (env.PATH ?? env.Path ?? env.path ?? '')
    : (env.PATH ?? '');
  return String(raw).split(platform === 'win32' ? ';' : ':').filter((entry) => entry.length > 0);
}

function executableCandidates(command, platform, env) {
  if (platform !== 'win32') return [command];

  const extension = path.win32.extname(command);
  if (extension) return [command];

  return windowsPathExt(env).map((ext) => `${command}${ext}`);
}

function windowsPathExt(env) {
  const raw = env.PATHEXT ?? env.Pathext ?? env.pathext;
  if (raw === undefined || String(raw).trim() === '') return [...DEFAULT_WINDOWS_PATHEXT];

  const extensions = String(raw)
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (item.startsWith('.') ? item : `.${item}`));

  return extensions.length > 0 ? extensions : [...DEFAULT_WINDOWS_PATHEXT];
}

async function findExecutableInDirectory(directory, command, platform, env, paths, isExecutable) {
  for (const name of executableCandidates(command, platform, env)) {
    const candidate = paths.join(directory, name);
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

async function isExecutableFile(filePath) {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveHomeDirectory(env, platform) {
  if (platform === 'win32') {
    if (env.USERPROFILE) return env.USERPROFILE;
    if (env.HOME) return env.HOME;
  } else if (env.HOME) {
    return env.HOME;
  }

  return homedir();
}
