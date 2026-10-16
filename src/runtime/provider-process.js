import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createEnvelope } from './envelope.js';
import { PROMPT_FILE_PLACEHOLDER } from './provider-registry.js';

const DEFAULT_ALLOWED_TOOL_NAMES = new Set(['schematic.generate', 'project.create', 'schematic.patch', 'project.inspect', 'validate.erc', 'simulate.spice']);
const DEFAULT_KILL_GRACE_MS = 2000;

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
  killGraceMs = DEFAULT_KILL_GRACE_MS,
  reportDiagnostic = reportProviderDiagnostic,
  spawnImpl = spawn,
  writeFileImpl = writeFile
}) {
  if (!command) {
    throw new Error('Provider command is required.');
  }

  const cancelled = () => signal?.aborted === true;
  const cancelError = () => new Error('Provider process cancelled.');
  let tempPromptDir = null;
  let removeSetupAbort = () => {};

  if (signal) {
    const onSetupAbort = () => {};
    signal.addEventListener('abort', onSetupAbort);
    removeSetupAbort = () => signal.removeEventListener('abort', onSetupAbort);
  }

  try {
    if (cancelled()) throw cancelError();

    let finalArgs = args;

    if (usePromptFile) {
      tempPromptDir = await mkdtemp(path.join(tmpdir(), 'chatpcb-prompt-'));
      if (cancelled()) throw cancelError();
      const tempPromptFile = path.join(tempPromptDir, `prompt-${randomUUID()}.txt`);
      await writeFileImpl(tempPromptFile, input || '', { encoding: 'utf8', mode: 0o600 });
      finalArgs = args.map((arg) => (arg === PROMPT_FILE_PLACEHOLDER ? tempPromptFile : arg));
    }

    if (cancelled()) throw cancelError();
    removeSetupAbort();
    removeSetupAbort = () => {};
    if (cancelled()) throw cancelError();

    return await new Promise((resolve, reject) => {
      if (cancelled()) {
        reject(cancelError());
        return;
      }
      const providerProcess = providerProcessCommand(command, finalArgs);
      // POSIX detached puts the child in its own process group so the tree can be signalled together.
      const child = spawnImpl(providerProcess.command, providerProcess.args, {
        cwd,
        env: { ...process.env, ...env },
        windowsVerbatimArguments: providerProcess.windowsVerbatimArguments === true,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const allowedTools = new Set(allowedToolNames);
      const parser = createProviderOutputParser({ allowedTools, onEvent });
      const events = parser.events;
      const stderr = [];
      let settled = false;
      let pendingError = null;
      let terminationStarted = false;
      let terminatedAt = 0;
      let killTimer = null;
      let watchdog = null;
      let timer = null;

      const clearKillTimer = () => {
        if (killTimer) {
          clearTimeout(killTimer);
          killTimer = null;
        }
      };

      const finish = () => {
        if (settled) return false;
        settled = true;
        clearTimeout(timer);
        clearKillTimer();
        clearTimeout(watchdog);
        signal?.removeEventListener('abort', abortProvider);
        return true;
      };

      const terminate = () => {
        if (terminationStarted) return;
        terminationStarted = true;
        terminatedAt = Date.now();
        killTimer = terminateProviderProcess(child, {
          platform: process.platform,
          windowsShim: providerProcess.windowsShim === true,
          killGraceMs
        });
        watchdog = setTimeout(() => {
          if (finish()) reject(pendingError ?? new Error('Provider process did not exit.'));
        }, killGraceMs + 1000);
      };

      const requestStop = (error) => {
        if (settled || pendingError) return;
        pendingError = error;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abortProvider);
        terminate();
      };

      timer = setTimeout(() => {
        requestStop(new Error(`Provider process timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      const abortProvider = () => requestStop(new Error('Provider process cancelled.'));
      signal?.addEventListener('abort', abortProvider, { once: true });

      for (const stream of [child.stdin, child.stdout, child.stderr]) {
        stream?.on('error', () => {});
      }
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');

      child.stdout.on('data', (chunk) => {
        try {
          parser.pushChunk(chunk);
        } catch (error) {
          requestStop(error);
        }
      });

      child.stderr.on('data', (chunk) => {
        stderr.push(chunk);
      });

      child.on('error', (error) => {
        if (settled) return;
        if (!pendingError) pendingError = error;
        const spawnFailed = !child.pid || error?.code === 'ENOENT';
        if (spawnFailed && finish()) reject(pendingError);
      });

      child.on('exit', () => {
        // Keep the SIGKILL timer while a grandchild is still in the group.
        if (terminationStarted && !processGroupAlive(child.pid)) clearKillTimer();
      });

      child.on('close', async (exitCode) => {
        clearTimeout(watchdog);
        if (pendingError && processGroupAlive(child.pid)) {
          await waitForProcessGroupExit(child.pid, terminatedAt, killGraceMs);
        }
        clearKillTimer();
        if (!finish()) return;
        if (pendingError) {
          reject(pendingError);
          return;
        }

        try {
          parser.finish();
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
    removeSetupAbort();
    await removeTempPromptDir(tempPromptDir);
  }
}

export function redactProviderText(value) {
  return value
    .replace(/\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)=([^\s]+)/gi, '$1=[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]');
}

const GROK_STREAM_TYPES = new Set([
  'text',
  'thought',
  'tool_call',
  'tool_call_update',
  'usage',
  'plan',
  'available_commands',
  'end',
  'error',
  'max_turns_reached'
]);

function createProviderOutputParser({ allowedTools, onEvent }) {
  const events = [];
  const grokText = { value: '' };
  let raw = '';
  let pending = '';
  let mode = 'unknown';

  const emitSince = (before) => {
    if (typeof onEvent !== 'function') return;
    for (const event of events.slice(before)) onEvent(event);
  };

  const consumeLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const parsed = tryParseJson(trimmed);
    if (mode === 'unknown') mode = parsed ? 'lines' : 'document';
    if (mode === 'document') return;
    if (isGrokResultEnvelope(parsed)) return;
    const before = events.length;
    addProviderLine(events, line, allowedTools, grokText);
    emitSince(before);
  };

  return {
    events,
    pushChunk(chunk) {
      raw += chunk;
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) consumeLine(line);
    },
    finish() {
      if (pending.length > 0) {
        const tail = pending;
        pending = '';
        consumeLine(tail);
      }
      const envelope = tryParseJson(raw.trim());
      if (isGrokResultEnvelope(envelope)) {
        events.length = 0;
        absorbGrokResult(events, envelope, allowedTools);
        emitSince(0);
        return;
      }
      if (mode !== 'lines') {
        const before = events.length;
        for (const line of raw.split(/\r?\n/)) {
          if (!line.trim()) continue;
          addProviderLine(events, line, allowedTools, grokText);
        }
        emitSince(before);
      }
      const before = events.length;
      flushGrokText(events, grokText, allowedTools);
      emitSince(before);
    }
  };
}

function addProviderLine(events, line, allowedTools, grokText = { value: '' }) {
  const trimmed = line.trim();
  if (!trimmed) return;

  const parsed = tryParseJson(trimmed);
  if (parsed) {
    if (isGrokResultEnvelope(parsed)) return;

    if (parsed.type === 'item.completed' && parsed.item?.type === 'agent_message') {
      parseProviderMessageText(events, parsed.item.text ?? '', allowedTools);
      return;
    }

    if (parsed.type?.startsWith('item.') || ['thread.started', 'turn.started', 'turn.completed'].includes(parsed.type)) {
      return;
    }

    if (parsed.type === 'tool.call') {
      validateProviderToolCall(parsed.payload, allowedTools);
      events.push(createEnvelope('tool.call', parsed.payload));
      return;
    }

    if (isGrokStreamEvent(parsed)) {
      absorbGrokStreamEvent(events, parsed, allowedTools, grokText);
      return;
    }

    throw new Error('Providers may only emit tool.call JSON or normal assistant text.');
  }

  events.push(createEnvelope('agent.delta', { text: line }));
}

function isGrokStreamEvent(parsed) {
  if (!parsed || typeof parsed.type !== 'string') return false;
  if (GROK_STREAM_TYPES.has(parsed.type)) return true;
  return parsed.type.startsWith('auto_compact');
}

function isGrokResultEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.structuredOutput !== undefined || value.structured_output !== undefined) return true;
  return typeof value.text === 'string' && (typeof value.sessionId === 'string' || typeof value.stopReason === 'string');
}

function absorbGrokStreamEvent(events, parsed, allowedTools, grokText) {
  if (parsed.type === 'text') {
    grokText.value += typeof parsed.data === 'string' ? parsed.data : '';
    return;
  }
  if (parsed.type === 'end' || parsed.type === 'error') {
    flushGrokText(events, grokText, allowedTools);
  }
}

function flushGrokText(events, grokText, allowedTools) {
  if (!grokText.value) return;
  const text = grokText.value;
  grokText.value = '';
  parseProviderMessageText(events, text, allowedTools);
}

function absorbGrokResult(events, envelope, allowedTools) {
  const structured = envelope.structuredOutput ?? envelope.structured_output;
  if (structured && typeof structured === 'object' && !Array.isArray(structured) && structured.type === 'tool.call') {
    validateProviderToolCall(structured.payload, allowedTools);
    events.push(createEnvelope('tool.call', structured.payload));
    return;
  }
  if (typeof envelope.text === 'string' && envelope.text.trim()) {
    parseProviderMessageText(events, envelope.text, allowedTools);
  }
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

export function providerProcessCommand(command, args, platform = process.platform) {
  if (platform !== 'win32' || /\.exe$/i.test(command)) {
    return { command, args, windowsShim: false };
  }

  return {
    command: process.env.ComSpec ?? 'cmd.exe',
    args: ['/d', '/s', '/c', quoteWindowsCommand(command, args)],
    windowsVerbatimArguments: true,
    windowsShim: true
  };
}

export function buildProviderKillCommand({ platform = process.platform, pid, windowsShim = false } = {}) {
  if (platform === 'win32' && windowsShim) {
    return {
      command: 'taskkill',
      args: ['/PID', String(pid), '/T', '/F']
    };
  }

  if (platform === 'win32') {
    return { directSignal: 'SIGTERM' };
  }

  return {
    group: true,
    signal: 'SIGTERM',
    escalateSignal: 'SIGKILL'
  };
}

function terminateProviderProcess(child, { platform, windowsShim, killGraceMs }) {
  if (!child?.pid) return null;
  const spec = buildProviderKillCommand({
    platform,
    pid: child.pid,
    windowsShim
  });

  if (spec.command) {
    const killer = spawn(spec.command, spec.args, {
      stdio: 'ignore',
      windowsHide: true
    });
    killer.on('error', () => {
      try {
        child.kill();
      } catch {
        // The provider process has already exited.
      }
    });
    killer.unref();
    return null;
  }

  if (spec.group) {
    signalProcessGroup(child, spec.signal);
    return setTimeout(() => {
      signalProcessGroup(child, spec.escalateSignal);
    }, killGraceMs);
  }

  try {
    child.kill(spec.directSignal ?? 'SIGTERM');
  } catch {
    // The provider process has already exited.
  }
  return null;
}

function signalProcessGroup(child, signal) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code === 'ESRCH') return;
    try {
      child.kill(signal);
    } catch {
      // The provider process has already exited.
    }
  }
}

function processGroupAlive(pid) {
  if (!pid || process.platform === 'win32') return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

async function waitForProcessGroupExit(pid, terminatedAt, killGraceMs) {
  const remaining = Math.max(0, terminatedAt + killGraceMs - Date.now());
  if (remaining > 0) await delay(remaining);
  if (!processGroupAlive(pid)) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // ESRCH means the group is already gone. Any other error is retried by the poll below.
  }
  const deadline = Date.now() + 1000;
  while (processGroupAlive(pid) && Date.now() < deadline) {
    await delay(20);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// cmd.exe metacharacters. %% is not collapsed to % on `cmd /d /s /c`, so % is caret-escaped.
// Same set cross-spawn uses, including space and backtick.
const CMD_META_CHARS = /([()\][%!^"`<>&|;, *?])/g;

function quoteWindowsCommand(command, args) {
  // Batch shims re-parse arguments, so .cmd/.bat arguments are escaped twice.
  const doubleEscape = /\.(?:cmd|bat)$/i.test(command);
  const shellCommand = [
    escapeCmdCommand(command),
    ...args.map((arg) => escapeCmdArgument(arg, doubleEscape))
  ].join(' ');
  // /s strips one pair of surrounding quotes. The inner command keeps its own quotes.
  return `"${shellCommand}"`;
}

function escapeCmdCommand(command) {
  return String(command).replace(CMD_META_CHARS, '^$1');
}

function escapeCmdArgument(arg, doubleEscape) {
  let text = `${arg}`;
  // Match cross-spawn: double backslashes that sit before a quote or the end of the string.
  text = text.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
  text = text.replace(/(?=(\\+?)?)\1$/, '$1$1');
  text = `"${text}"`.replace(CMD_META_CHARS, '^$1');
  if (doubleEscape) text = text.replace(CMD_META_CHARS, '^$1');
  return text;
}
