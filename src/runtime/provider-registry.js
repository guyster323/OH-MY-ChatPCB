import { spawn } from 'node:child_process';

const PROVIDERS = [
  {
    id: 'codex',
    label: 'Codex CLI',
    command: 'codex',
    args: ['exec', '--json'],
    description: 'Uses an already-authenticated local Codex CLI session.'
  },
  {
    id: 'claude',
    label: 'Claude Code',
    command: 'claude',
    args: ['--print'],
    description: 'Uses an already-authenticated local Claude Code CLI session.'
  },
  {
    id: 'copilot',
    label: 'GitHub Copilot CLI',
    command: 'gh',
    args: ['copilot', 'suggest'],
    description: 'Uses an already-authenticated GitHub CLI Copilot extension.'
  }
];

export function listProviderDefinitions() {
  return PROVIDERS.map((provider) => ({ ...provider, args: [...provider.args] }));
}

export function getProviderDefinition(provider) {
  const match = PROVIDERS.find((candidate) => candidate.id === provider);
  if (!match) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  return { ...match, args: [...match.args] };
}

export async function checkProviderAvailability({ provider, commandExistsImpl = commandExists, env = process.env } = {}) {
  const definition = getProviderDefinition(provider);
  const probeEnv = { ...process.env, ...env };
  const available = await commandExistsImpl(definition.command, probeEnv);

  let hint = null;
  if (!available) {
    hint = getProviderInstallHint(provider);
  }

  return {
    provider: definition.id,
    command: definition.command,
    available,
    status: available ? 'available' : 'missing',
    hint
  };
}

const GENERIC_INSTALL_HINT = 'Provider CLI not found on PATH. Install and authenticate the CLI, then restart the daemon.';

export function getProviderInstallHint(provider) {
  const hints = {
    codex: 'Install: npm install -g @openai/codex, then: codex login --device-auth. Add global npm bin to PATH if needed (check with: npm prefix -g).',
    claude: 'Install: npm install -g @anthropic-ai/claude-code (or follow official instructions), then: claude login. Ensure the CLI is on PATH.',
    copilot: 'Install GitHub CLI so the gh executable is on the daemon PATH. The status check only looks for gh. Copilot requests also need: gh extension install github/gh-copilot, then gh auth login.'
  };
  return hints[provider] ?? GENERIC_INSTALL_HINT;
}

export function buildProviderPrompt({ provider, userMessage, projectDir, allowedTools = [] } = {}) {
  const definition = getProviderDefinition(provider);
  const toolList = allowedTools.length ? allowedTools.map((tool) => `- ${tool}`).join('\n') : '- no tools allowed';

  return [
    `You are running as the ${definition.label} adapter for ChatPCB.`,
    'Respond with normal assistant text for reasoning or status.',
    'When you need ChatPCB to act, emit exactly one JSON Lines object on its own line:',
    '{"type":"tool.call","payload":{"id":"call_<id>","name":"<tool>","args":{}}}',
    'Allowed tool names:',
    toolList,
    'Do not emit tool.result. The local daemon executes tools and returns results.',
    'Do not include API keys, tokens, or credentials in output.',
    '',
    'User request:',
    userMessage ?? '',
    '',
    projectDir ? `Project directory: ${projectDir}` : 'Project directory: not provided'
  ].join('\n');
}

function presenceProbe(command) {
  if (process.platform === 'win32') {
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-Command', `if (Get-Command -Name '${escapePowerShellSingleQuoted(command)}' -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }`]
    };
  }

  return {
    command: 'sh',
    args: ['-c', `command -v ${shellQuote(command)} >/dev/null 2>&1`]
  };
}

async function commandExists(command, env = process.env) {
  const probe = presenceProbe(command);

  return new Promise((resolve) => {
    const child = spawn(probe.command, probe.args, { stdio: 'ignore', env });
    child.on('error', () => resolve(false));
    child.on('close', (exitCode) => resolve(exitCode === 0));
  });
}

function escapePowerShellSingleQuoted(value) {
  return value.replace(/'/g, "''");
}

function shellQuote(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
