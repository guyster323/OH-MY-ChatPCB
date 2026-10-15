import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DAEMON_PORT, ProtocolMessageType, ToolName, PROVIDER_ALLOWED_TOOLS } from '../src/shared/constants.js';

test('DEFAULT_DAEMON_PORT is defined', () => {
  assert.equal(typeof DEFAULT_DAEMON_PORT, 'number');
  assert.equal(DEFAULT_DAEMON_PORT, 41317);
});

test('ProtocolMessageType constants are defined', () => {
  assert.equal(ProtocolMessageType.SYSTEM_STATUS, 'system.status');
  assert.equal(ProtocolMessageType.TOOL_CALL, 'tool.call');
  assert.equal(ProtocolMessageType.TOOL_RESULT, 'tool.result');
  assert.equal(ProtocolMessageType.CHAT_MESSAGE, 'chat.message');
  assert.equal(ProtocolMessageType.AGENT_DELTA, 'agent.delta');
});

test('ToolName constants are defined', () => {
  assert.equal(ToolName.PROJECT_CREATE, 'project.create');
  assert.equal(ToolName.PROJECT_INSPECT, 'project.inspect');
  assert.equal(ToolName.PROJECT_REQUEST, 'project.request');
  assert.equal(ToolName.SCHEMATIC_GENERATE, 'schematic.generate');
  assert.equal(ToolName.SCHEMATIC_PATCH, 'schematic.patch');
  assert.equal(ToolName.VALIDATE_ERC, 'validate.erc');
  assert.equal(ToolName.VALIDATE_DRC, 'validate.drc');
  assert.equal(ToolName.SIMULATE_SPICE, 'simulate.spice');
  assert.equal(ToolName.PROVIDER_STATUS, 'provider.status');
  assert.equal(ToolName.PROVIDER_LIST, 'provider.list');
  assert.equal(ToolName.PROVIDER_INVOKE, 'provider.invoke');
  assert.equal(ToolName.PROVIDER_CANCEL, 'provider.cancel');
});

test('PROVIDER_ALLOWED_TOOLS contains expected tools', () => {
  assert.ok(Array.isArray(PROVIDER_ALLOWED_TOOLS));
  assert.ok(PROVIDER_ALLOWED_TOOLS.includes(ToolName.SCHEMATIC_GENERATE));
  assert.ok(PROVIDER_ALLOWED_TOOLS.includes(ToolName.PROJECT_CREATE));
  assert.ok(PROVIDER_ALLOWED_TOOLS.includes(ToolName.SCHEMATIC_PATCH));
  assert.ok(PROVIDER_ALLOWED_TOOLS.includes(ToolName.PROJECT_INSPECT));
  assert.ok(PROVIDER_ALLOWED_TOOLS.includes(ToolName.VALIDATE_ERC));
  assert.ok(PROVIDER_ALLOWED_TOOLS.includes(ToolName.VALIDATE_DRC));
  assert.ok(PROVIDER_ALLOWED_TOOLS.includes(ToolName.SIMULATE_SPICE));
  assert.equal(PROVIDER_ALLOWED_TOOLS.length, 7);
});

test('protocol message types match expected string literals', () => {
  const expectedTypes = {
    'system.status': ProtocolMessageType.SYSTEM_STATUS,
    'tool.call': ProtocolMessageType.TOOL_CALL,
    'tool.result': ProtocolMessageType.TOOL_RESULT,
    'chat.message': ProtocolMessageType.CHAT_MESSAGE,
    'agent.delta': ProtocolMessageType.AGENT_DELTA
  };

  for (const [literal, constant] of Object.entries(expectedTypes)) {
    assert.equal(constant, literal, `Protocol type ${literal} should match constant`);
  }
});

test('tool names match expected string literals', () => {
  const expectedTools = {
    'project.create': ToolName.PROJECT_CREATE,
    'project.inspect': ToolName.PROJECT_INSPECT,
    'project.request': ToolName.PROJECT_REQUEST,
    'schematic.generate': ToolName.SCHEMATIC_GENERATE,
    'schematic.patch': ToolName.SCHEMATIC_PATCH,
    'validate.erc': ToolName.VALIDATE_ERC,
    'validate.drc': ToolName.VALIDATE_DRC,
    'simulate.spice': ToolName.SIMULATE_SPICE,
    'provider.status': ToolName.PROVIDER_STATUS,
    'provider.list': ToolName.PROVIDER_LIST,
    'provider.invoke': ToolName.PROVIDER_INVOKE,
    'provider.cancel': ToolName.PROVIDER_CANCEL
  };

  for (const [literal, constant] of Object.entries(expectedTools)) {
    assert.equal(constant, literal, `Tool name ${literal} should match constant`);
  }
});
