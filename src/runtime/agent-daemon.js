import http from 'node:http';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createEnvelope, parseEnvelope } from './envelope.js';
import { runProviderProcess } from './provider-process.js';
import { buildProviderPrompt, checkProviderAvailability, getProviderDefinition, listProviderDefinitions } from './provider-registry.js';
import { generateMcuPeripheralProject } from '../workflow/generate-mcu-project.js';
import { applySchematicPatch, createSchematicPatchPlan, disposeSchematicPatchPlan } from '../workflow/schematic-patch.js';
import { createPatchApprovalRegistry } from './patch-approval-registry.js';
import { simulateProject } from '../workflow/simulate-project.js';
import { inspectProject } from '../workflow/inspect-project.js';
import { validateProject } from '../workflow/validate-project.js';
import { validateBoard } from '../workflow/validate-board.js';
import { assertSafeProjectDir, createNamedProject } from '../workflow/project-workspace.js';
import { reviewCircuitReadiness } from '../workflow/review-project.js';

const PROVIDER_ALLOWED_TOOLS = ['schematic.generate', 'project.create', 'schematic.patch', 'project.inspect', 'validate.erc', 'validate.drc', 'simulate.spice'];

export async function dispatchToolCall(
  call,
  {
    checkProviderAvailabilityImpl = checkProviderAvailability,
    runProviderProcessImpl = runProviderProcess,
    inspectProjectImpl = inspectProject,
    validateProjectImpl = validateProject,
    validateBoardImpl = validateBoard,
    providerControllers = new Map(),
    patchApprovalRegistry = createPatchApprovalRegistry(),
    allowedWorkspaceRoot
  } = {}
) {
  if (!call || typeof call !== 'object') {
    return failure('INVALID_TOOL_CALL', 'Tool call must be an object.');
  }

  try {
    guardToolProjectDir(call, allowedWorkspaceRoot);
  } catch (error) {
    return failure(error.code ?? 'UNSAFE_PROJECT_DIR', error.message);
  }

  switch (call.name) {
    case 'project.create':
      return ok(await createNamedProject({ workspaceRoot: call.args?.workspaceRoot, projectName: call.args?.projectName }));

    case 'schematic.generate':
      return ok(
        await generateMcuPeripheralProject({
          projectDir: call.args?.projectDir,
          prompt: call.args?.prompt,
          projectName: call.args?.projectName
        })
      );

    case 'project.inspect':
      return ok(await inspectProjectImpl({ projectDir: call.args?.projectDir, kicadCliPath: call.args?.kicadCliPath }));

    case 'validate.erc':
      return ok(await validateProjectImpl({ projectDir: call.args?.projectDir, kicadCliPath: call.args?.kicadCliPath }));

    case 'validate.drc':
      return ok(await validateBoardImpl({ projectDir: call.args?.projectDir, kicadCliPath: call.args?.kicadCliPath }));

    case 'schematic.patch':
      return dispatchSchematicPatch(call.args ?? {}, { validateProjectImpl, patchApprovalRegistry });

    case 'provider.status':
      return ok(await checkProviderAvailabilityImpl({ provider: call.args?.provider ?? 'codex' }));

    case 'provider.list':
      return ok({ providers: listProviderDefinitions() });

    case 'provider.invoke':
      return ok(
        await invokeProvider(call, {
          runProviderProcessImpl,
          checkProviderAvailabilityImpl,
          inspectProjectImpl,
          validateProjectImpl,
          validateBoardImpl,
          providerControllers,
          patchApprovalRegistry,
          allowedWorkspaceRoot
        })
      );

    case 'project.request':
      return ok(
        await requestProject(call, {
          runProviderProcessImpl,
          checkProviderAvailabilityImpl,
          inspectProjectImpl,
          validateProjectImpl,
          validateBoardImpl,
          providerControllers,
          patchApprovalRegistry,
          allowedWorkspaceRoot
        })
      );

    case 'provider.cancel':
      return ok(cancelProvider(call.args, providerControllers));

    case 'simulate.spice':
      return ok(await simulateProject({ projectDir: call.args?.projectDir, ngspicePath: call.args?.ngspicePath }));

    default:
      return failure('UNKNOWN_TOOL', `Unknown ChatPCB tool: ${call.name}`);
  }
}

async function dispatchSchematicPatch(args, { validateProjectImpl, patchApprovalRegistry }) {
  const projectDir = args.projectDir;
  if (args.cancel === true) {
    if (!args.patchId) return failure('PATCH_APPROVAL_REQUIRED', 'patchId is required to cancel a patch preview.');
    const approval = patchApprovalRegistry.consume({ patchId: args.patchId, projectDir });
    if (!approval.ok) return { ok: false, error: approval.reason };
    await disposeSchematicPatchPlan(approval.record.plan);
    return ok({ requiresApproval: false, approved: false, canceled: true, applied: false, files: {}, changedFiles: [], diff: '' });
  }

  if (args.approved !== true) {
    const plan = await createSchematicPatchPlan({
      projectDir,
      prompt: args.prompt,
      projectName: args.projectName,
      validateProjectImpl
    });
    const registration = patchApprovalRegistry.register({
      patchId: plan.patchId,
      projectDir,
      plan,
      dispose: () => disposeSchematicPatchPlan(plan)
    });
    const preview = await applySchematicPatch({ projectDir, approved: false, patchPlan: plan });
    return ok({ ...preview, expiresAt: registration.expiresAt });
  }

  if (!args.patchId) return failure('PATCH_APPROVAL_REQUIRED', 'patchId is required to approve a patch preview.');
  const approval = patchApprovalRegistry.consume({ patchId: args.patchId, projectDir });
  if (!approval.ok) return { ok: false, error: approval.reason };
  try {
    return ok(await applySchematicPatch({
      projectDir,
      prompt: args.prompt,
      projectName: args.projectName,
      approved: true,
      expectedPatchId: args.patchId,
      patchPlan: approval.record.plan,
      validateProjectImpl
    }));
  } finally {
    await disposeSchematicPatchPlan(approval.record.plan);
  }
}

async function invokeProvider(call, { runProviderProcessImpl, checkProviderAvailabilityImpl, inspectProjectImpl, validateProjectImpl, validateBoardImpl, providerControllers, patchApprovalRegistry, allowedWorkspaceRoot, allowGenerate = true, forceProjectDir = false }) {
  const args = call.args ?? {};
  const invocationId = args.invocationId ?? call.id;
  const provider = args.provider ?? 'codex';
  const projectDir = args.projectDir;
  const prompt = args.prompt;

  if (!prompt) {
    throw new Error('provider.invoke requires a prompt.');
  }

  if (!invocationId) {
    throw new Error('provider.invoke requires an invocation id.');
  }

  const definition = getProviderDefinition(provider);
  const availability = await checkProviderAvailabilityImpl({ provider });
  if (!availability.available) {
    throw new Error(`${definition.label} is not available on this machine.`);
  }

  const input = buildProviderPrompt({
    provider,
    userMessage: prompt,
    projectDir,
    allowedTools: PROVIDER_ALLOWED_TOOLS
  });
  const controller = new AbortController();
  providerControllers.set(invocationId, controller);
  let transcript;

  try {
    transcript = await runProviderProcessImpl({
      command: definition.command,
      args: definition.args,
      input,
      allowedToolNames: PROVIDER_ALLOWED_TOOLS,
      signal: controller.signal
    });
  } finally {
    providerControllers.delete(invocationId);
  }

  if (transcript.exitCode !== 0) {
    throw new Error(`${definition.label} exited with code ${transcript.exitCode}.`);
  }

  const toolResults = [];
  for (const event of transcript.events) {
    if (event.type !== 'tool.call') continue;

    if (forceProjectDir && event.payload.name === 'project.create') {
      throw new Error('project.create is not allowed inside project.request.');
    }
    if (!allowGenerate && event.payload.name === 'schematic.generate') {
      throw new Error('schematic.generate is not allowed for an existing project.request; request a schematic.patch preview instead.');
    }
    const toolCall = withProjectContext(event.payload, projectDir, forceProjectDir);
    toolResults.push({
      id: event.payload.id,
      ...(await dispatchToolCall(toolCall, {
        checkProviderAvailabilityImpl,
        runProviderProcessImpl,
        inspectProjectImpl,
        validateProjectImpl,
        validateBoardImpl,
        providerControllers,
        patchApprovalRegistry,
        allowedWorkspaceRoot
      }))
    });
  }

  return {
    providerInvocation: true,
    invocationId,
    provider,
    events: transcript.events,
    toolResults,
    stderr: transcript.stderr,
    tracePath: transcript.tracePath
  };
}

async function requestProject(call, { runProviderProcessImpl, checkProviderAvailabilityImpl, inspectProjectImpl, validateProjectImpl, validateBoardImpl, providerControllers, patchApprovalRegistry, allowedWorkspaceRoot }) {
  const args = call.args ?? {};
  const projectDir = args.projectDir;
  const prompt = args.prompt;
  if (!projectDir) {
    throw new Error('project.request requires a project directory.');
  }
  if (!prompt) {
    throw new Error('project.request requires a prompt.');
  }

  const hasSpec = await projectHasSpec(projectDir);
  const snapshot = hasSpec ? await snapshotProject(projectDir) : null;

  try {
    const providerResult = await invokeProvider(call, {
      runProviderProcessImpl,
      checkProviderAvailabilityImpl,
      inspectProjectImpl,
      validateProjectImpl,
      validateBoardImpl,
      providerControllers,
      patchApprovalRegistry,
      allowedWorkspaceRoot,
      allowGenerate: !hasSpec,
      forceProjectDir: true
    });
    const applied = providerResult.toolResults.length
      ? lastMutatingResult(providerResult.toolResults)
      : hasSpec
        ? (await dispatchSchematicPatch({ projectDir, prompt }, { validateProjectImpl, patchApprovalRegistry })).result
        : await generateMcuPeripheralProject({ projectDir, prompt });
    if (applied.requiresApproval) {
      return {
        ...applied,
        operation: 'patched',
        providerEvents: providerResult.events
      };
    }
    const validation = await validateProjectImpl({ projectDir });
    const rolledBack = hasSpec && !validation.ok;
    if (rolledBack) {
      await restoreProjectSnapshot(snapshot, projectDir);
    }

    const spec = rolledBack ? await readProjectSpec(projectDir) : applied.spec ?? await readProjectSpec(projectDir);
    const review = reviewCircuitReadiness({ spec, validation });
    return {
      ...applied,
      operation: hasSpec ? 'patched' : 'generated',
      files: applied.files,
      review,
      validation,
      providerEvents: providerResult.events,
      ...(rolledBack ? { rolledBack: true } : {})
    };
  } catch (error) {
    if (snapshot) await restoreProjectSnapshot(snapshot, projectDir);
    throw error;
  } finally {
    if (snapshot) {
      await rm(snapshot.root, { force: true, recursive: true });
    }
  }
}

function lastMutatingResult(toolResults) {
  const result = toolResults.findLast((toolResult) => toolResult.ok && toolResult.result?.files)?.result;
  if (!result) {
    throw new Error('Provider transcript did not apply a schematic generation or patch.');
  }
  return result;
}

async function projectHasSpec(projectDir) {
  const entries = await readdir(path.resolve(projectDir), { withFileTypes: true });
  return entries.some((entry) => entry.isFile() && entry.name.endsWith('.chatpcb.json'));
}

async function readProjectSpec(projectDir) {
  const entries = await readdir(path.resolve(projectDir), { withFileTypes: true });
  const spec = entries.find((entry) => entry.isFile() && entry.name.endsWith('.chatpcb.json'));
  if (!spec) {
    throw new Error('Project specification is missing after the requested operation.');
  }
  return JSON.parse(await readFile(path.join(projectDir, spec.name), 'utf8'));
}

async function snapshotProject(projectDir) {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-project-snapshot-'));
  const copy = path.join(root, 'project');
  await cp(projectDir, copy, { recursive: true });
  return { root, copy };
}

async function restoreProjectSnapshot(snapshot, projectDir) {
  const currentEntries = await readdir(path.resolve(projectDir), { withFileTypes: true });

  for (const entry of currentEntries) {
    await rm(path.join(projectDir, entry.name), { force: true, recursive: true });
  }

  await cp(snapshot.copy, projectDir, { recursive: true });
}

function guardToolProjectDir(call, allowedWorkspaceRoot) {
  const projectDir = call.args?.projectDir;
  if (typeof projectDir !== 'string' || projectDir.length === 0) {
    return;
  }

  assertSafeProjectDir(projectDir, { allowedWorkspaceRoot });
}

function cancelProvider(args = {}, providerControllers) {
  const invocationId = args.id ?? args.invocationId;
  if (!invocationId) {
    throw new Error('provider.cancel requires an id.');
  }

  const controller = providerControllers.get(invocationId);
  if (!controller) {
    return {
      cancelled: false,
      id: invocationId,
      reason: 'not_found'
    };
  }

  controller.abort();
  providerControllers.delete(invocationId);
  return {
    cancelled: true,
    id: invocationId
  };
}

function withProjectContext(payload, projectDir, forceProjectDir = false) {
  const args = {
    ...(payload.args ?? {})
  };

  let name = payload.name;
  if (name === 'schematic.patch') {
    delete args.approved;
    delete args.cancel;
    delete args.patchId;
    delete args.expectedPatchId;
  }
  if (name === 'validate.erc' || name === 'validate.drc') {
    name = 'project.inspect';
  }

  if (projectDir && (forceProjectDir || !args.projectDir)) {
    args.projectDir = projectDir;
  }

  return {
    id: payload.id,
    name,
    args
  };
}

export async function startDaemon({ host = '127.0.0.1', port = 41317, dispatchOptions = {} } = {}) {
  const clients = new Set();
  const providerControllers = dispatchOptions.providerControllers ?? new Map();
  const patchApprovalRegistry = dispatchOptions.patchApprovalRegistry ?? createPatchApprovalRegistry();
  const resolvedDispatchOptions = {
    ...dispatchOptions,
    providerControllers,
    patchApprovalRegistry,
    allowedWorkspaceRoot: dispatchOptions.allowedWorkspaceRoot ?? process.env.CHATPCB_WORKSPACE_ROOT
  };

  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/health') {
        sendJson(response, 200, {
          ok: true,
          service: 'chatpcb-agentd',
          websocket: '/ws'
        });
        return;
      }

      if (request.method === 'POST' && request.url === '/tool') {
        const body = await readJson(request);
        sendJson(response, 200, await dispatchToolCall(body, resolvedDispatchOptions));
        return;
      }

      sendJson(response, 404, failure('NOT_FOUND', `Unknown route: ${request.method} ${request.url}`));
    } catch (error) {
      sendJson(response, 500, failure('DAEMON_ERROR', error.message));
    }
  });

  server.on('upgrade', (request, socket) => {
    if (request.url !== '/ws') {
      socket.destroy();
      return;
    }

    acceptWebSocket(request, socket);
    clients.add(socket);
    sendWebSocketJson(socket, createEnvelope('system.status', { ok: true, service: 'chatpcb-agentd' }));

    socket.on('data', async (buffer) => {
      const text = decodeWebSocketText(buffer);
      if (!text) return;

      try {
        const envelope = parseEnvelope(text);
        if (envelope.type === 'tool.call') {
          sendWebSocketJson(
            socket,
            createEnvelope('tool.result', {
              id: envelope.payload.id,
              ...(await dispatchToolCall(envelope.payload, resolvedDispatchOptions))
            })
          );
        } else if (envelope.type === 'chat.message') {
          sendWebSocketJson(
            socket,
            createEnvelope('agent.delta', {
              text: 'ChatPCB daemon is online. Send a tool.call envelope to generate, validate, or simulate.'
            })
          );
        }
      } catch (error) {
        sendWebSocketJson(socket, createEnvelope('tool.result', failure('BAD_ENVELOPE', error.message)));
      }
    });

    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();

  return {
    host,
    port: address.port,
    url: `http://${host}:${address.port}`,
    server,
    close: () =>
      new Promise((resolve, reject) => {
        for (const client of clients) {
          client.destroy();
        }
        patchApprovalRegistry.disposeAll();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    clients
  };
}

function ok(result) {
  return { ok: true, result };
}

function failure(code, message) {
  return {
    ok: false,
    error: { code, message }
  };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': 'http://127.0.0.1'
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function acceptWebSocket(request, socket) {
  const key = request.headers['sec-websocket-key'];
  const accept = createWebSocketAccept(key);
  socket.write(
    [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      ''
    ].join('\r\n')
  );
}

function createWebSocketAccept(key) {
  return createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');
}

function sendWebSocketJson(socket, payload) {
  const text = JSON.stringify(payload);
  const data = Buffer.from(text);
  let header;

  if (data.length < 126) {
    header = Buffer.from([0x81, data.length]);
  } else if (data.length <= 0xffff) {
    header = Buffer.from([0x81, 126, data.length >> 8, data.length & 0xff]);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }

  socket.write(Buffer.concat([header, data]));
}

function decodeWebSocketText(buffer) {
  if (buffer.length < 2) return '';
  const opcode = buffer[0] & 0x0f;
  if (opcode === 0x8) return '';

  let offset = 2;
  let length = buffer[1] & 0x7f;
  if (length === 126) {
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    throw new Error('Large websocket frames are not supported by the ChatPCB v1 daemon.');
  }

  const masked = (buffer[1] & 0x80) !== 0;
  let mask;
  if (masked) {
    mask = buffer.subarray(offset, offset + 4);
    offset += 4;
  }

  const data = Buffer.from(buffer.subarray(offset, offset + length));
  if (masked) {
    for (let index = 0; index < data.length; index += 1) {
      data[index] ^= mask[index % 4];
    }
  }

  return data.toString('utf8');
}
