import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { KNOWN_CHATPCB_TOOLS, PROVIDER_ALLOWED_TOOLS } from '../shared/constants.js';
import { createEnvelope } from './envelope.js';
import { PROMPT_FILE_PLACEHOLDER } from './provider-registry.js';

const knownChatPcbTools = new Set(KNOWN_CHATPCB_TOOLS);
const DEFAULT_KILL_GRACE_MS = 2000;
// Detached children are their own process group, so SIGINT/SIGTERM/SIGHUP sent
// to this process does not reach them. Ids stay until the group itself is gone,
// which can be after the leader has exited. On Linux the leader's start time is
// kept so a reused pid is not signalled. Finished ids are dropped on the next
// spawn and on a timer, so a dead group is not held until another provider starts.
export const PROVIDER_GROUP_PRUNE_MS = 30000;
const activeProviderGroups = new Map();
let providerGroupPruneTimer = null;
let providerShutdownHandlersInstalled = false;

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
  allowedToolNames = PROVIDER_ALLOWED_TOOLS,
  traceDir,
  signal,
  onEvent,
  providerId,
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
      // Install on first spawn, not at import, so tests that only load this module keep default signals.
      installProviderShutdownHandlers();
      // POSIX detached puts the child in its own process group so the tree can be signalled together.
      const child = spawnImpl(providerProcess.command, providerProcess.args, {
        cwd,
        env: { ...process.env, ...env },
        windowsVerbatimArguments: providerProcess.windowsVerbatimArguments === true,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      trackProviderGroup(child);

      const allowedTools = new Set(allowedToolNames);
      const parser = createProviderOutputParser({ allowedTools, onEvent, providerId });
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
          attachUnknownToolTranscript(pendingError, events, exitCode, stderr);
          reject(pendingError);
          return;
        }

        try {
          parser.finish();
          if (parser.unknownToolErrors.length > 0) {
            const error = parser.unknownToolErrors[0];
            attachUnknownToolTranscript(error, events, exitCode, stderr);
            reject(error);
            return;
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
          attachUnknownToolTranscript(error, events, exitCode, stderr);
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

// Unknown names stay coded as UNKNOWN_TOOL, but the child is allowed to
// finish so a known call in the same output still reaches the daemon.
function rememberUnknownTool(events, unknownToolErrors, error) {
  if (error?.code !== 'UNKNOWN_TOOL') return false;
  unknownToolErrors.push(error);
  const payload = error.toolCall;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    events.push(createEnvelope('tool.call', payload));
  }
  return true;
}

function attachUnknownToolTranscript(error, events, exitCode, stderr) {
  if (error?.code !== 'UNKNOWN_TOOL' || Array.isArray(error.parsedEvents)) return;
  error.parsedEvents = events.slice();
  error.providerExitCode = exitCode ?? 0;
  error.providerStderr = redactProviderText(stderr.join(''));
}

function createProviderOutputParser({ allowedTools, onEvent, providerId }) {
  const events = [];
  const unknownToolErrors = [];
  const grokText = { value: '', sawEnd: false };
  // JSON-output mode is selected from the provider definition id. Sniffing stdout
  // buffered every provider until exit when its first line was not JSON.
  const jsonOutput = providerId === 'grok';
  let raw = '';
  let pending = '';
  let mode = 'unknown';

  const emitSince = (before) => {
    if (typeof onEvent !== 'function') return;
    for (const event of events.slice(before)) onEvent(event);
  };

  const captureLine = (line, options) => {
    const before = events.length;
    try {
      addProviderLine(events, line, allowedTools, options);
    } catch (error) {
      if (!rememberUnknownTool(events, unknownToolErrors, error)) throw error;
    }
    emitSince(before);
  };

  const consumeLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (!jsonOutput) {
      captureLine(line);
      return;
    }

    const parsed = tryParseJson(trimmed);
    if (mode === 'unknown') mode = parsed ? 'lines' : 'document';
    // A pretty-printed grok JSON document is not complete until the process closes.
    if (mode === 'document') return;
    if (!parsed) {
      throw providerOutputError('GROK_OUTPUT_UNPARSEABLE', 'Grok JSON output was cut off and could not be parsed.');
    }
    if (parsed.type === 'error') throw grokOutputError(parsed);
    if (parsed.type === 'end' && parsed.stopReason === 'error') throw grokStopError(parsed);
    if (isGrokResultEnvelope(parsed)) return;
    captureLine(line, { jsonOutput: true, grokText });
  };

  return {
    events,
    unknownToolErrors,
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
      if (!jsonOutput) return;

      const trimmed = raw.trim();
      const envelope = tryParseJson(trimmed);
      if (envelope && (isGrokResultEnvelope(envelope) || envelope.type === 'error' || envelope.stopReason === 'error')) {
        assertGrokResultOk(envelope);
        events.length = 0;
        unknownToolErrors.length = 0;
        try {
          absorbGrokResult(events, envelope, allowedTools);
        } catch (error) {
          if (!rememberUnknownTool(events, unknownToolErrors, error)) throw error;
        }
        emitSince(0);
        return;
      }
      if (mode === 'lines') {
        if (!grokText.sawEnd) {
          throw providerOutputError('GROK_OUTPUT_INCOMPLETE', 'Grok JSON output ended before a complete result.');
        }
        const before = events.length;
        try {
          flushGrokText(events, grokText, allowedTools);
        } catch (error) {
          if (!rememberUnknownTool(events, unknownToolErrors, error)) throw error;
        }
        emitSince(before);
        return;
      }
      if (!trimmed || envelope) {
        throw providerOutputError('GROK_OUTPUT_INCOMPLETE', 'Grok JSON output ended before a complete result.');
      }
      throw providerOutputError('GROK_OUTPUT_UNPARSEABLE', 'Grok JSON output was cut off and could not be parsed.');
    }
  };
}

function addProviderLine(events, line, allowedTools, { jsonOutput = false, grokText = null } = {}) {
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

    if (parsed.type === 'tool.call') {
      validateProviderToolCall(parsed.payload, allowedTools);
      events.push(createEnvelope('tool.call', parsed.payload));
      return;
    }

    // Grok event types are recognized only for the grok provider. Another
    // provider's {type:"error"} line keeps the main rejection.
    if (jsonOutput && parsed.type === 'error') throw grokOutputError(parsed);

    if (jsonOutput && isGrokStreamEvent(parsed)) {
      if (parsed.type === 'end' && parsed.stopReason === 'error') throw grokStopError(parsed);
      if (parsed.type === 'end' && grokText) grokText.sawEnd = true;
      absorbGrokStreamEvent(events, parsed, allowedTools, grokText ?? { value: '' });
      return;
    }

    if (jsonOutput) {
      throw providerOutputError('GROK_OUTPUT_INCOMPLETE', 'Grok JSON output ended before a complete result.');
    }

    throw new Error('Providers may only emit tool.call JSON or normal assistant text.');
  }

  if (jsonOutput) {
    throw providerOutputError('GROK_OUTPUT_UNPARSEABLE', 'Grok JSON output was cut off and could not be parsed.');
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
  if (parsed.type === 'end') {
    flushGrokText(events, grokText, allowedTools);
  }
}

function providerOutputError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function grokFailureMessage(value) {
  if (typeof value?.message === 'string' && value.message.trim()) return value.message.trim();
  if (typeof value?.error === 'string' && value.error.trim()) return value.error.trim();
  if (value?.error && typeof value.error === 'object' && typeof value.error.message === 'string' && value.error.message.trim()) {
    return value.error.message.trim();
  }
  return '';
}

function grokOutputError(value) {
  return providerOutputError('GROK_OUTPUT_ERROR', grokFailureMessage(value) || 'Grok returned an error.');
}

function grokStopError(value) {
  return providerOutputError('GROK_STOP_ERROR', grokFailureMessage(value) || 'Grok stopped with an error.');
}

function assertGrokResultOk(envelope) {
  if (envelope?.stopReason === 'error') throw grokStopError(envelope);
  if (envelope?.type === 'error') throw grokOutputError(envelope);
  if (!isGrokResultEnvelope(envelope)) {
    throw providerOutputError('GROK_OUTPUT_INCOMPLETE', 'Grok JSON output ended before a complete result.');
  }
}

function flushGrokText(events, grokText, allowedTools) {
  if (!grokText.value) return;
  const text = grokText.value;
  grokText.value = '';
  parseProviderMessageText(events, text, allowedTools);
}

function absorbGrokResult(events, envelope, allowedTools) {
  const before = events.length;
  const structured = envelope.structuredOutput ?? envelope.structured_output;
  if (structured && typeof structured === 'object' && !Array.isArray(structured) && structured.type === 'tool.call') {
    validateProviderToolCall(structured.payload, allowedTools);
    events.push(createEnvelope('tool.call', structured.payload));
    return;
  }
  if (typeof envelope.text === 'string' && envelope.text.trim()) {
    parseProviderMessageText(events, envelope.text, allowedTools);
  }
  if (events.length === before) {
    throw providerOutputError('GROK_OUTPUT_INCOMPLETE', 'Grok JSON output ended before a complete result.');
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

function unknownProviderToolError(payload) {
  const error = new Error(`Unsupported provider tool call: ${payload.name}`);
  error.code = 'UNKNOWN_TOOL';
  error.toolCall = payload;
  return error;
}

function validateProviderToolCall(payload, allowedTools) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Provider tool.call payload must be an object.');
  }

  if (typeof payload.id !== 'string' || payload.id.length === 0) {
    throw new Error('Provider tool.call payload requires an id.');
  }

  if (typeof payload.name !== 'string' || payload.name.length === 0) {
    throw new Error(`Unsupported provider tool call: ${payload.name}`);
  }

  if (!allowedTools.has(payload.name) && !knownChatPcbTools.has(payload.name)) {
    throw unknownProviderToolError(payload);
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

function trackProviderGroup(child) {
  const pid = child?.pid;
  if (!Number.isInteger(pid) || pid <= 0) return;
  pruneDeadProviderGroups();
  noteActiveProviderGroup(pid);
  child.once('exit', () => {
    // The leader can exit while grandchildren still share its process group.
    // Drop the id when the group is gone, or when this pid now belongs to someone else.
    if (!providerGroupStillOwned(pid)) releaseProviderGroup(pid);
  });
}

export function noteActiveProviderGroup(pid, startTime = readProcessStartTime(pid)) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  activeProviderGroups.set(pid, { startTime: startTime ?? null });
  ensureProviderGroupPruneTimer();
}

export function activeProviderGroupIds() {
  return [...activeProviderGroups.keys()];
}

export function providerGroupPruneScheduled() {
  return providerGroupPruneTimer !== null;
}

export function pruneDeadProviderGroups() {
  // Windows cannot probe a process group with kill(-pid, 0). Those pids are
  // removed when the leader exits, because processGroupAlive is always false there.
  if (process.platform !== 'win32') {
    for (const pid of [...activeProviderGroups.keys()]) {
      if (!providerGroupStillOwned(pid)) activeProviderGroups.delete(pid);
    }
  }
  stopProviderGroupPruneTimerIfEmpty();
}

function ensureProviderGroupPruneTimer() {
  if (providerGroupPruneTimer !== null || activeProviderGroups.size === 0) return;
  providerGroupPruneTimer = setInterval(() => {
    pruneDeadProviderGroups();
  }, PROVIDER_GROUP_PRUNE_MS);
  // A tracked group must not keep the CLI alive after the provider run has settled.
  providerGroupPruneTimer.unref();
}

function stopProviderGroupPruneTimerIfEmpty() {
  if (activeProviderGroups.size > 0 || providerGroupPruneTimer === null) return;
  clearInterval(providerGroupPruneTimer);
  providerGroupPruneTimer = null;
}

function releaseProviderGroup(pid) {
  activeProviderGroups.delete(pid);
  stopProviderGroupPruneTimerIfEmpty();
}

function installProviderShutdownHandlers() {
  if (providerShutdownHandlersInstalled) return;
  providerShutdownHandlersInstalled = true;

  const signals = ['SIGINT', 'SIGTERM'];
  if (process.platform !== 'win32') signals.push('SIGHUP');

  for (const signal of signals) {
    const onSignal = () => {
      // listenerCount still includes this function. Re-raising while another
      // listener remains delivers the signal again, so the host handler runs twice.
      // Re-raise only when this was the only listener so the default action still
      // terminates with the signal's exit status.
      const onlyListener = process.listenerCount(signal) === 1;
      try {
        killActiveProviderGroups();
      } finally {
        process.removeListener(signal, onSignal);
        if (onlyListener) process.kill(process.pid, signal);
      }
    };
    process.on(signal, onSignal);
  }

  process.on('exit', () => {
    killActiveProviderGroups();
  });
}

export function killActiveProviderGroups() {
  // Drop finished groups before signalling. A pgid kept after the leader exits
  // can be reused by an unrelated process-group leader.
  pruneDeadProviderGroups();
  for (const pid of [...activeProviderGroups.keys()]) {
    killProviderGroupNow(pid);
  }
  pruneDeadProviderGroups();
}

export function killProviderGroupNow(pid) {
  if (process.platform === 'win32') {
    // 'exit' can only run synchronous work. taskkill /T /F stops the whole tree.
    try {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true
      });
    } catch {
      // The provider process has already exited.
    }
    return;
  }

  if (!activeProviderGroups.has(pid) || !providerGroupStillOwned(pid)) {
    releaseProviderGroup(pid);
    return;
  }

  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    if (error?.code === 'ESRCH' || error?.code === 'EPERM') return;
    // The group is not signalable. Shutdown still has to finish.
  }
}

function signalProcessGroup(child, signal) {
  if (!child?.pid) return;
  // A dropped id is not ours anymore. Falling back to liveness would signal a
  // recycled pid whose group happens to be alive.
  if (!activeProviderGroups.has(child.pid) || !providerGroupStillOwned(child.pid)) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    // EPERM: the id exists but no member can be signalled. Do not fall back
    // to the leader pid; macOS reports this for a zombie group, and that pid
    // may already belong to someone else.
    if (error?.code === 'ESRCH' || error?.code === 'EPERM') return;
    try {
      child.kill(signal);
    } catch {
      // The provider process has already exited.
    }
  }
}

// kill defaults to process.kill so tests can inject EPERM without a process group.
export function processGroupAlive(pid, { kill = process.kill, platform = process.platform } = {}) {
  if (!pid || platform === 'win32') return false;
  try {
    kill(-pid, 0);
    return true;
  } catch (error) {
    // ESRCH: the process group is gone.
    // EPERM: the group id still exists, but no member can be signalled. macOS
    // returns this when the group has only zombie or exited members that cannot
    // be reaped, and when a member has called setsid() and sits in another
    // session. A signal cannot reach a live child in that group.
    // Prune treats the id as finished. Keeping it would leak the tracking entry
    // (the timer never goes idle) and, once the pid is reused, could SIGKILL an
    // unrelated group. macOS has no start-time check to tell that group apart.
    // Any other probe error still counts as alive, so a transient failure does
    // not abandon a group that might still accept a signal.
    if (error?.code === 'ESRCH' || error?.code === 'EPERM') return false;
    return true;
  }
}

function providerGroupStillOwned(pid) {
  if (!processGroupAlive(pid)) return false;
  const recorded = activeProviderGroups.get(pid)?.startTime ?? null;
  // /proc was not available when the group was tracked. Liveness is the only check.
  if (recorded == null) return true;
  const current = readProcessStartTime(pid);
  // The leader has been reaped and grandchildren may still share the group, or
  // /proc cannot be read now. Either way, do not treat the live group as foreign.
  if (current == null) return true;
  return current === recorded;
}

function readProcessStartTime(pid) {
  if (process.platform !== 'linux' || !Number.isInteger(pid) || pid <= 0) return null;
  try {
    return parseProcStatStartTime(readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch {
    return null;
  }
}

// Field 22 of /proc/pid/stat is starttime (clock ticks since boot). comm is field 2,
// wrapped in parentheses, and may itself contain spaces and parentheses.
export function parseProcStatStartTime(stat) {
  const text = String(stat);
  const end = text.lastIndexOf(')');
  if (end < 0) return null;
  const startTime = text.slice(end + 1).trim().split(/\s+/)[19];
  if (!/^\d+$/.test(startTime ?? '')) return null;
  return startTime;
}

async function waitForProcessGroupExit(pid, terminatedAt, killGraceMs) {
  const remaining = Math.max(0, terminatedAt + killGraceMs - Date.now());
  if (remaining > 0) await delay(remaining);
  // Same ownership check as shutdown: a reused pid must not be signalled.
  if (!activeProviderGroups.has(pid) || !providerGroupStillOwned(pid)) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // ESRCH means the group is already gone. Any other error is retried by the poll below.
  }
  const deadline = Date.now() + 1000;
  while (activeProviderGroups.has(pid) && providerGroupStillOwned(pid) && Date.now() < deadline) {
    await delay(20);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// cmd.exe metacharacters. %% is not collapsed to % on `cmd /d /s /c`, so % is caret-escaped.
// Same set cross-spawn uses, including space and backtick.
const CMD_META_CHARS = /([()\][%!^"`<>&|;, *?])/g;
// Quote only these. A plain token such as "hello" must stay bare: a batch file's
// %1 keeps the quote characters, so always-quoting turns hello into "hello".
const WINDOWS_ARG_NEEDS_QUOTES = /[\s()[\]%!^"`<>&|;,*?]/;

export function quoteWindowsCommand(command, args) {
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
  const text = `${arg}`;
  if (text.length === 0) return '""';
  if (!WINDOWS_ARG_NEEDS_QUOTES.test(text)) return text;

  let escaped = text;
  // Match cross-spawn: double backslashes that sit before a quote or the end of the string.
  escaped = escaped.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
  escaped = escaped.replace(/(?=(\\+?)?)\1$/, '$1$1');
  escaped = `"${escaped}"`.replace(CMD_META_CHARS, '^$1');
  // A .cmd/.bat shim re-parses the command line, so one caret level is consumed
  // before the target (Node, for a grok shim) sees % and other metacharacters.
  if (doubleEscape) escaped = escaped.replace(CMD_META_CHARS, '^$1');
  return escaped;
}
