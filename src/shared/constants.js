export const DEFAULT_DAEMON_PORT = 41317;

export const ProtocolMessageType = {
  SYSTEM_STATUS: 'system.status',
  TOOL_CALL: 'tool.call',
  TOOL_RESULT: 'tool.result',
  CHAT_MESSAGE: 'chat.message',
  AGENT_DELTA: 'agent.delta'
};

export const ToolName = {
  PROJECT_CREATE: 'project.create',
  PROJECT_INSPECT: 'project.inspect',
  PROJECT_REQUEST: 'project.request',
  SCHEMATIC_GENERATE: 'schematic.generate',
  SCHEMATIC_PATCH: 'schematic.patch',
  VALIDATE_ERC: 'validate.erc',
  VALIDATE_DRC: 'validate.drc',
  SIMULATE_SPICE: 'simulate.spice',
  PROVIDER_STATUS: 'provider.status',
  PROVIDER_LIST: 'provider.list',
  PROVIDER_INVOKE: 'provider.invoke',
  PROVIDER_CANCEL: 'provider.cancel'
};

export const PROVIDER_ALLOWED_TOOLS = [
  ToolName.SCHEMATIC_GENERATE,
  ToolName.PROJECT_CREATE,
  ToolName.SCHEMATIC_PATCH,
  ToolName.PROJECT_INSPECT,
  ToolName.VALIDATE_ERC,
  ToolName.VALIDATE_DRC,
  ToolName.SIMULATE_SPICE
];

// Every tool the daemon can dispatch. Provider output may name these even when
// they are outside PROVIDER_ALLOWED_TOOLS; the daemon decides DISALLOWED_TOOL.
export const KNOWN_CHATPCB_TOOLS = [
  ...Object.values(ToolName),
  'project.transaction.status',
  'project.transaction.rollback'
];
