import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { PROVIDER_ALLOWED_TOOLS, ToolName } from '../shared/constants.js';

export const PROMPT_FILE_PLACEHOLDER = '__PROMPT_FILE__';

const DEFAULT_PROVIDER_TIMEOUT_MS = 120000;
const GROK_PROVIDER_TIMEOUT_MS = 300000;
const MAX_PROVIDER_TIMEOUT_MS = 2147483647;
const DEFAULT_WINDOWS_PATHEXT = ['.COM', '.EXE', '.BAT', '.CMD'];

// Proven with `grok --json-schema` in a temp directory: the json result's
// structuredOutput is the tool call. `--output-format plain` only returns prose.
//
// grok is a one-shot CLI per request. A multi-turn loop would need session resume,
// multiplies the 82–265s latency per turn, and can still finish without a mutating
// call. A schema enum is enforced by the structured-output decoder, so each request
// allows only the mutating tool for that context.
// Grok's schema allows one mutating tool. The names come from the shared allowlist.
const GROK_MUTATING_TOOLS = [ToolName.SCHEMATIC_GENERATE, ToolName.SCHEMATIC_PATCH].filter((name) => (
  PROVIDER_ALLOWED_TOOLS.includes(name)
));

export function grokMutatingToolNames(context = {}) {
  if (Array.isArray(context.mutatingTools) && context.mutatingTools.length > 0) {
    const names = context.mutatingTools.filter((name) => GROK_MUTATING_TOOLS.includes(name));
    if (names.length > 0) return names;
  }
  // Same rule as project.request: allowGenerate is false exactly when a spec already exists.
  const existing = context.allowGenerate === false || (context.allowGenerate !== true && context.projectExists === true);
  const selected = existing ? ToolName.SCHEMATIC_PATCH : ToolName.SCHEMATIC_GENERATE;
  return GROK_MUTATING_TOOLS.filter((name) => name === selected);
}

export function buildGrokToolCallSchema(context = {}) {
  const branches = grokMutatingToolNames(context).map((name) => grokPayloadSchema(name));
  // A single object is stricter than anyOf and is what grok's decoder enforces.
  // anyOf is only used when one context really allows more than one mutating tool.
  const payload = branches.length === 1 ? branches[0] : { anyOf: branches };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'payload'],
    properties: {
      type: { type: 'string', enum: ['tool.call'] },
      payload
    }
  };
}

function grokPayloadSchema(name) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'name', 'args'],
    properties: {
      id: { type: 'string' },
      name: { type: 'string', enum: [name] },
      args: grokArgsSchema(name)
    }
  };
}

function grokArgsSchema(name) {
  // previewNativeChange reads prompt and, for schematic.patch, optional projectName.
  // Approval controls (approved, cancel, patchId) are stripped in withProjectContext
  // and are not provider arguments.
  if (name === ToolName.SCHEMATIC_PATCH) {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['prompt'],
      properties: {
        prompt: { type: 'string' },
        projectName: { type: 'string' }
      }
    };
  }
  return {
    type: 'object',
    additionalProperties: false,
    required: ['prompt'],
    properties: {
      prompt: { type: 'string' }
    }
  };
}

const GROK_TOOL_CALL_SCHEMA = JSON.stringify(buildGrokToolCallSchema({}));

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

export function buildProviderLaunchArgs(definition, context) {
  const projectDir = typeof context === 'string' ? context : context?.projectDir;
  const launchContext = typeof context === 'string' || context == null ? { projectDir } : context;
  const args = [...(definition?.args ?? [])];
  if (definition?.id !== 'grok') return args;

  const schemaIndex = args.indexOf('--json-schema');
  if (schemaIndex !== -1) {
    args[schemaIndex + 1] = JSON.stringify(buildGrokToolCallSchema(launchContext));
  }
  if (typeof projectDir === 'string' && projectDir.length > 0) {
    args.unshift('--cwd', projectDir);
  }
  return args;
}

export function summarizeProjectInspection({ spec, inspection } = {}) {
  const summarizedSpec = summarizeSpec(spec);
  const summarizedInspection = summarizeInspection(inspection);
  if (!summarizedSpec && !summarizedInspection) return null;
  return {
    ...(summarizedSpec ?? {}),
    ...(summarizedInspection ? { inspection: summarizedInspection } : {})
  };
}

function summarizeSpec(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null;
  const components = (spec.schematic?.components ?? []).map((component) => ({
    ref: component?.ref ?? null,
    value: component?.value ?? null,
    libId: component?.libId ?? null
  }));
  const nets = (spec.schematic?.nets ?? []).map((net) => net?.name).filter((name) => typeof name === 'string');
  return {
    spec: {
      kind: spec.kind ?? null,
      title: spec.title ?? null,
      sourcePrompt: spec.sourcePrompt ?? null,
      mcu: spec.mcu ?? null,
      power: spec.power ?? null,
      interfaces: spec.interfaces ?? [],
      peripherals: spec.peripherals ?? [],
      boardProfile: spec.boardProfile
        ? { id: spec.boardProfile.id ?? null, kind: spec.boardProfile.kind ?? null }
        : null
    },
    summary: {
      componentCount: components.length,
      components,
      netCount: nets.length,
      nets
    }
  };
}

function summarizeInspection(inspection) {
  if (!inspection || typeof inspection !== 'object') return null;
  const facts = inspection.inspection?.facts ?? inspection.facts ?? [];
  const findings = inspection.findings ?? inspection.inspection?.findings ?? [];
  const summaries = (Array.isArray(facts) ? facts : [])
    .filter((fact) => typeof fact?.category === 'string' && fact.category.endsWith('.summary'))
    .map((fact) => ({ category: fact.category, value: fact.value }));
  const components = (Array.isArray(facts) ? facts : [])
    .filter((fact) => fact?.category === 'schematic.component')
    .map((fact) => ({
      ref: fact.value?.reference ?? null,
      value: fact.value?.value ?? null,
      libId: fact.value?.libId ?? null
    }));
  const nets = (Array.isArray(facts) ? facts : [])
    .filter((fact) => fact?.category === 'schematic.net')
    .map((fact) => fact.value?.name)
    .filter((name) => typeof name === 'string');
  const findingLines = (Array.isArray(findings) ? findings : []).slice(0, 20).map((finding) => ({
    id: finding?.id ?? null,
    severity: finding?.severity ?? null,
    message: finding?.message ?? null
  }));
  if (summaries.length === 0 && components.length === 0 && nets.length === 0 && findingLines.length === 0 && !inspection.inspection && !inspection.manifest) {
    return null;
  }
  return {
    projectDigest: inspection.inspection?.projectDigest ?? null,
    artifactCount: inspection.inspection?.artifactCount ?? null,
    manifest: inspection.manifest ?? null,
    summaries,
    components,
    nets,
    findings: findingLines
  };
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

export function buildProviderPrompt({
  provider,
  userMessage,
  projectDir,
  allowedTools = [],
  inspectionContext,
  projectExists = false
} = {}) {
  const definition = getProviderDefinition(provider);
  const toolList = allowedTools.length ? allowedTools.map((tool) => `- ${tool}`).join('\n') : '- no tools allowed';

  const toolCallShape = '{"type":"tool.call","payload":{"id":"call_<id>","name":"<tool>","args":{}}}';
  const instructions = provider === 'grok'
    ? [
      `You are running as the ${definition.label} adapter for ChatPCB.`,
      'Choose one allowed ChatPCB tool and return it as the structured response:',
      toolCallShape,
      'Set type to tool.call. Put the circuit request in args.prompt.',
      allowedTools.includes(ToolName.SCHEMATIC_PATCH)
        ? 'args.prompt must be a complete circuit description that keeps the existing design and applies the user request. projectName is optional.'
        : 'args.prompt must describe the circuit to generate.',
      'Do not emit tool.result. The local daemon executes tools and returns results.',
      'Do not explore, read, or modify project files.',
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

  const lines = [
    ...instructions,
    'Allowed tool names:',
    toolList
  ];

  if (projectExists) {
    lines.push('Note: The project already exists. Use schematic.patch to modify it, not project.create or schematic.generate.');
  }

  lines.push(
    '',
    'User request:',
    userMessage ?? '',
    '',
    projectDir ? `Project directory: ${projectDir}` : 'Project directory: not provided'
  );

  if (provider === 'grok' && inspectionContext) {
    lines.push(
      '',
      'Existing project inspection context (already collected by the daemon; do not explore files):',
      JSON.stringify(inspectionContext, null, 2)
    );
  }

  return lines.join('\n');
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
