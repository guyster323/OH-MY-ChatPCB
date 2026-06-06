import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createEnvelope } from './envelope.js';

const DEFAULT_ALLOWED_TOOL_NAMES = new Set(['schematic.generate', 'project.create', 'schematic.patch', 'validate.erc', 'simulate.spice']);

export function runProviderProcess({
  command,
  args = [],
  input = '',
  cwd = process.cwd(),
  env = {},
  timeoutMs = 120000,
  allowedToolNames = DEFAULT_ALLOWED_TOOL_NAMES,
  traceDir,
  signal
}) {
  if (!command) {
    throw new Error('Provider command is required.');
  }

  return new Promise((resolve, reject) => {
    const providerProcess = providerProcessCommand(command, args);
    const child = spawn(providerProcess.command, providerProcess.args, {
      cwd,
      env: { ...process.env, ...env },
      windowsVerbatimArguments: providerProcess.windowsVerbatimArguments === true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const events = [];
    const stderr = [];
    let stdoutBuffer = '';
    let settled = false;

    const allowedTools = new Set(allowedToolNames);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`Provider process timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortProvider);
      child.kill('SIGTERM');
      reject(error);
    };

    const abortProvider = () => fail(new Error('Provider process cancelled.'));
    if (signal?.aborted) {
      abortProvider();
      return;
    }
    signal?.addEventListener('abort', abortProvider, { once: true });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        try {
          addProviderLine(events, line, allowedTools);
        } catch (error) {
          fail(error);
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr.push(chunk);
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortProvider);
      reject(error);
    });

    child.on('close', async (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortProvider);
      if (stdoutBuffer.trim()) {
        try {
          addProviderLine(events, stdoutBuffer, allowedTools);
        } catch (error) {
          reject(error);
          return;
        }
      }
      const transcript = {
        exitCode,
        events,
        stderr: redactProviderText(stderr.join(''))
      };

      if (traceDir) {
        transcript.tracePath = await writeProviderTrace({
          traceDir,
          command,
          args,
          cwd,
          input,
          transcript
        });
      }

      resolve(transcript);
    });

    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

export function redactProviderText(value) {
  return value
    .replace(/\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)=([^\s]+)/gi, '$1=[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]');
}

function addProviderLine(events, line, allowedTools) {
  const trimmed = line.trim();
  if (!trimmed) return;

  const parsed = tryParseJson(trimmed);
  if (parsed) {
    if (parsed.type === 'item.completed' && parsed.item?.type === 'agent_message') {
      events.push(createEnvelope('agent.delta', { text: parsed.item.text ?? '' }));
      return;
    }

    if (['thread.started', 'turn.started', 'turn.completed'].includes(parsed.type)) {
      return;
    }

    if (parsed.type !== 'tool.call') {
      throw new Error('Providers may only emit tool.call JSON or normal assistant text.');
    }

    validateProviderToolCall(parsed.payload, allowedTools);
    events.push(createEnvelope('tool.call', parsed.payload));
    return;
  }

  events.push(createEnvelope('agent.delta', { text: line }));
}

async function writeProviderTrace({ traceDir, command, args, cwd, input, transcript }) {
  await mkdir(traceDir, { recursive: true });
  const tracePath = path.join(traceDir, `provider-trace-${Date.now()}-${randomUUID()}.json`);
  const body = {
    command,
    args: args.map((arg) => redactProviderText(String(arg))),
    cwd,
    input: redactProviderText(input),
    exitCode: transcript.exitCode,
    stderr: transcript.stderr,
    events: transcript.events.map(redactEnvelope)
  };

  await writeFile(tracePath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  return tracePath;
}

function redactEnvelope(envelope) {
  return {
    ...envelope,
    payload: redactValue(envelope.payload)
  };
}

function redactValue(value) {
  if (typeof value === 'string') {
    return redactProviderText(value);
  }

  if (Array.isArray(value)) {
    return value.map(redactValue);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redactValue(child)]));
  }

  return value;
}

function validateProviderToolCall(payload, allowedTools) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Provider tool.call payload must be an object.');
  }

  if (typeof payload.id !== 'string' || payload.id.length === 0) {
    throw new Error('Provider tool.call payload requires an id.');
  }

  if (typeof payload.name !== 'string' || !allowedTools.has(payload.name)) {
    throw new Error(`Unsupported provider tool call: ${payload.name}`);
  }

  if (payload.args !== undefined && (!payload.args || typeof payload.args !== 'object' || Array.isArray(payload.args))) {
    throw new Error('Provider tool.call args must be an object when present.');
  }
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function providerProcessCommand(command, args) {
  if (process.platform !== 'win32' || /\.exe$/i.test(command)) {
    return { command, args };
  }

  return {
    command: process.env.ComSpec ?? 'cmd.exe',
    args: ['/d', '/s', '/c', quoteWindowsCommand([command, ...args])],
    windowsVerbatimArguments: true
  };
}

function quoteWindowsCommand(parts) {
  return parts.map(quoteWindowsArg).join(' ');
}

function quoteWindowsArg(value) {
  const text = String(value);
  if (text.length === 0) return '""';
  if (!/[ \t"]/u.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}
