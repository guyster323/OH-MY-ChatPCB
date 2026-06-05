import { spawn } from 'node:child_process';

import { createEnvelope } from './envelope.js';

export function runProviderProcess({ command, args = [], input = '', cwd = process.cwd(), env = {}, timeoutMs = 120000 }) {
  if (!command) {
    throw new Error('Provider command is required.');
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const events = [];
    const stderr = [];
    let stdoutBuffer = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`Provider process timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        addProviderLine(events, line);
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr.push(chunk);
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (stdoutBuffer.trim()) {
        addProviderLine(events, stdoutBuffer);
      }
      resolve({
        exitCode,
        events,
        stderr: stderr.join('')
      });
    });

    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

function addProviderLine(events, line) {
  const trimmed = line.trim();
  if (!trimmed) return;

  const parsed = tryParseJson(trimmed);
  if (parsed?.type === 'tool.call' || parsed?.type === 'tool.result') {
    events.push(createEnvelope(parsed.type, parsed.payload ?? {}));
    return;
  }

  events.push(createEnvelope('agent.delta', { text: line }));
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
