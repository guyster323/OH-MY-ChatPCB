import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createEnvelope } from './envelope.js';
import { PROMPT_FILE_PLACEHOLDER } from './provider-registry.js';

const DEFAULT_ALLOWED_TOOL_NAMES = new Set(['schematic.generate', 'project.create', 'schematic.patch', 'project.inspect', 'validate.erc', 'simulate.spice']);

function reportProviderDiagnostic(message, error) {
  console.error(message, error);
}

async function removeTempPromptDir(directory) {
  if (!directory) return;
  try {
    await rm(directory, { force: true, recursive: true });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      reportProviderDiagnostic('Failed to clean up prompt directory:', error);
    }
  }
}

export async function runProviderProcess({
  command,
  args = [],
  input = '',
  cwd = process.cwd(),
  env = {},
  timeoutMs = 120000,
  allowedToolNames = DEFAULT_ALLOWED_TOOL_NAMES,
  traceDir,
  signal,
  onEvent,
  usePromptFile = false,
  reportDiagnostic = reportProviderDiagnostic
}) {
  if (!command) {
    throw new Error('Provider command is required.');
  }

  if (signal?.aborted) {
    throw new Error('Provider process cancelled.');
  }

  let tempPromptDir = null;

  try {
    let finalArgs = args;

    if (usePromptFile) {
      tempPromptDir = await mkdtemp(path.join(tmpdir(), 'chatpcb-prompt-'));
      const tempPromptFile = path.join(tempPromptDir, `prompt-${randomUUID()}.txt`);
      await writeFile(tempPromptFile, input || '', { encoding: 'utf8', mode: 0o600 });
      finalArgs = args.map((arg) => (arg === PROMPT_FILE_PLACEHOLDER ? tempPromptFile : arg));
    }

    return await new Promise((resolve, reject) => {
      const providerProcess = providerProcessCommand(command, finalArgs);
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

      const finish = () => {
        if (settled) return false;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abortProvider);
        return true;
      };

      const timer = setTimeout(() => {
        if (!finish()) return;
        child.kill('SIGTERM');
        reject(new Error(`Provider process timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      const fail = (error) => {
        if (!finish()) return;
        child.kill('SIGTERM');
        reject(error);
      };

      const abortProvider = () => fail(new Error('Provider process cancelled.'));
      signal?.addEventListener('abort', abortProvider, { once: true });

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');

      child.stdout.on('data', (chunk) => {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? '';
        for (const line of lines) {
          try {
            appendProviderLine(events, line, allowedTools, onEvent);
          } catch (error) {
            fail(error);
          }
        }
      });

      child.stderr.on('data', (chunk) => {
        stderr.push(chunk);
      });

      child.on('error', (error) => {
        if (!finish()) return;
        reject(error);
      });

      child.on('close', async (exitCode) => {
        if (!finish()) return;
        try {
          if (stdoutBuffer.trim()) {
            appendProviderLine(events, stdoutBuffer, allowedTools, onEvent);
          }
          const transcript = {
            exitCode,
            events,
            stderr: redactProviderText(stderr.join(''))
          };

          if (traceDir) {
            try {
              transcript.tracePath = await writeProviderTrace({
                traceDir,
                command,
                args: finalArgs,
                cwd,
                input,
                transcript
              });
            } catch (error) {
              try {
                reportDiagnostic('Failed to write provider trace:', error);
              } catch (reportError) {
                console.error('Failed to write provider trace:', error);
                console.error('Failed to report provider diagnostic:', reportError);
              }
            }
          }

          resolve(transcript);
        } catch (error) {
          reject(error);
        }
      });

      if (input && !usePromptFile) {
        child.stdin.write(input);
      }
      child.stdin.end();
    });
  } finally {
    await removeTempPromptDir(tempPromptDir);
  }
}

export function redactProviderText(value) {
  return value
    .replace(/\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)=([^\s]+)/gi, '$1=[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]');
}

function appendProviderLine(events, line, allowedTools, onEvent) {
  const before = events.length;
  addProviderLine(events, line, allowedTools);
  if (typeof onEvent === 'function') {
    for (const event of events.slice(before)) onEvent(event);
  }
}

function addProviderLine(events, line, allowedTools) {
  const trimmed = line.trim();
  if (!trimmed) return;

  const parsed = tryParseJson(trimmed);
  if (parsed) {
    if (parsed.type === 'item.completed' && parsed.item?.type === 'agent_message') {
      parseProviderMessageText(events, parsed.item.text ?? '', allowedTools);
      return;
    }

    if (parsed.type?.startsWith('item.') || ['thread.started', 'turn.started', 'turn.completed'].includes(parsed.type)) {
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

function parseProviderMessageText(events, text, allowedTools) {
  const assistantText = [];
  const toolCalls = [];

  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    const parsed = trimmed ? tryParseJson(trimmed) : null;

    if (!parsed && looksLikeEmbeddedToolCall(trimmed)) {
      throw new Error('Malformed embedded provider tool call.');
    }

    if (parsed?.type === 'tool.call') {
      validateProviderToolCall(parsed.payload, allowedTools);
      toolCalls.push(parsed.payload);
      continue;
    }

    if (trimmed) assistantText.push(line);
  }

  if (assistantText.length > 0) {
    events.push(createEnvelope('agent.delta', { text: assistantText.join('\n') }));
  }

  for (const payload of toolCalls) {
    events.push(createEnvelope('tool.call', payload));
  }
}

function looksLikeEmbeddedToolCall(value) {
  return value.startsWith('{') && /["']type["']\s*:\s*["']tool\.call["']/.test(value);
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
