#!/usr/bin/env node
import { startDaemon } from '../src/runtime/agent-daemon.js';
import { generateMcuPeripheralProject } from '../src/workflow/generate-mcu-project.js';
import { simulateProject } from '../src/workflow/simulate-project.js';
import { validateProject } from '../src/workflow/validate-project.js';

const command = process.argv[2];
const flags = parseFlags(process.argv.slice(3));

try {
  if (command === 'generate') {
    const result = await generateMcuPeripheralProject({
      projectDir: requireFlag(flags, 'project'),
      prompt: requireFlag(flags, 'prompt'),
      projectName: flags.name ?? 'chatpcb_mcu_peripheral'
    });
    printJson({ ok: true, result });
  } else if (command === 'validate') {
    const result = await validateProject({
      projectDir: requireFlag(flags, 'project'),
      kicadCliPath: flags.kicadCli
    });
    printJson({ ok: result.ok, result });
    process.exitCode = result.ok ? 0 : 2;
  } else if (command === 'simulate') {
    const result = await simulateProject({
      projectDir: requireFlag(flags, 'project'),
      ngspicePath: flags.ngspice
    });
    printJson({ ok: result.ok, result });
    process.exitCode = result.ok ? 0 : 2;
  } else if (command === 'daemon') {
    const server = await startDaemon({
      host: flags.host ?? '127.0.0.1',
      port: Number(flags.port ?? 41317)
    });
    console.log(JSON.stringify({ ok: true, url: server.url }));
  } else {
    printUsage();
    process.exitCode = command ? 2 : 0;
  }
} catch (error) {
  printJson({
    ok: false,
    error: {
      message: error.message,
      stack: flags.verbose ? error.stack : undefined
    }
  });
  process.exitCode = 1;
}

function parseFlags(argv) {
  const result = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${token}`);
    }

    const key = toCamelCase(token.slice(2));
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      result[key] = true;
    } else {
      result[key] = next;
      index += 1;
    }
  }

  return result;
}

function requireFlag(flags, name) {
  const value = flags[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required --${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} flag.`);
  }
  return value;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printUsage() {
  console.log(`Usage:
  chatpcb generate --project <dir> --prompt <text> [--name <project-name>]
  chatpcb validate --project <dir> [--kicad-cli <path>]
  chatpcb simulate --project <dir> [--ngspice <path>]
  chatpcb daemon [--host 127.0.0.1] [--port 41317]
`);
}
