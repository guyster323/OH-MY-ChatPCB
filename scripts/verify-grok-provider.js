#!/usr/bin/env node
// Dispatch one real grok project.request and print the tool call plus any
// recorded design source. The project directory is under the system temp dir.
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { dispatchToolCall } from '../src/runtime/agent-daemon.js';

const PROMPT = 'STM32 board with USB-C power, 3.3V regulator, I2C sensor connector, UART debug header, reset button, and status LED.';

if (!process.env.CHATPCB_GROK_TIMEOUT_MS) {
  process.env.CHATPCB_GROK_TIMEOUT_MS = '420000';
}

const projectDir = await mkdtemp(path.join(tmpdir(), 'chatpcb-grok-verify-'));
const result = await dispatchToolCall({
  id: 'verify-grok-provider',
  name: 'project.request',
  args: {
    provider: 'grok',
    projectDir,
    prompt: PROMPT
  }
});

const events = result.result?.providerEvents ?? [];
const toolCalls = events
  .filter((event) => event.type === 'tool.call')
  .map((event) => ({
    id: event.payload?.id ?? null,
    name: event.payload?.name ?? null,
    args: event.payload?.args ?? null
  }));

let specName = null;
let spec = null;
try {
  const names = await readdir(projectDir);
  specName = names.find((name) => name.endsWith('.chatpcb.json')) ?? null;
  if (specName) {
    spec = JSON.parse(await readFile(path.join(projectDir, specName), 'utf8'));
  }
} catch {
  spec = null;
}

const designSource = designSourceFrom(result.result) ?? designSourceFrom(spec);
const sourceProvider = designSource && typeof designSource === 'object' ? designSource.provider ?? null : null;
const sourceVia = designSource && typeof designSource === 'object' ? designSource.via ?? null : null;
const sourceId = designSource && typeof designSource === 'object' ? designSource.id : designSource;

const report = {
  projectDir,
  ok: result.ok === true,
  error: result.ok ? null : {
    code: result.error?.code ?? null,
    message: result.error?.message ?? null
  },
  providerFallback: result.result?.providerFallback ?? null,
  operation: result.result?.operation ?? null,
  designSource,
  'source.provider': sourceProvider,
  'source.via': sourceVia,
  specFile: specName,
  toolCalls
};

console.log(JSON.stringify(report, null, 2));

const mutating = toolCalls.some((call) => call.name === 'schematic.generate' || call.name === 'schematic.patch');
const failed = report.ok !== true
  || report.providerFallback != null
  || !mutating
  || sourceId !== 'native'
  || sourceProvider == null
  || sourceVia !== 'provider';
process.exit(failed ? 1 : 0);

function designSourceFrom(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 8) return null;
  if (isDesignSource(value.source)) return value.source;
  if (isDesignSource(value)) return value;
  const nested = ['proposal', 'result', 'plan'];
  for (const key of nested) {
    const found = designSourceFrom(value[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function isDesignSource(value) {
  return Boolean(value && typeof value === 'object' && typeof value.id === 'string' && typeof value.version === 'string');
}
