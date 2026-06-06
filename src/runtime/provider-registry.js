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

export async function checkProviderAvailability({ provider, commandExistsImpl = commandExists } = {}) {
  const definition = getProviderDefinition(provider);
  const available = await commandExistsImpl(definition.command);

  return {
    provider: definition.id,
    command: definition.command,
    available,
    status: available ? 'available' : 'missing'
  };
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

async function commandExists(command) {
  const probe =
    process.platform === 'win32'
      ? {
          command: 'powershell.exe',
          args: ['-NoProfile', '-Command', `if (Get-Command -Name '${escapePowerShellSingleQuoted(command)}' -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }`]
        }
      : {
          command: 'sh',
          args: ['-lc', `command -v ${shellQuote(command)} >/dev/null 2>&1`]
        };

  return new Promise((resolve) => {
    const child = spawn(probe.command, probe.args, { stdio: 'ignore' });
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
