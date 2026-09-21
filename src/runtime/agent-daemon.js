import http from 'node:http';
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { createEnvelope, parseEnvelope } from './envelope.js';
import { runProviderProcess } from './provider-process.js';
import { buildProviderPrompt, checkProviderAvailability, getProviderDefinition, listProviderDefinitions } from './provider-registry.js';
import { applySchematicPatch, createSchematicPatchPlan, disposeSchematicPatchPlan } from '../workflow/schematic-patch.js';
import { publicProposal } from '../workflow/native-proposal-source.js';
import { rollbackProjectTransaction } from '../workflow/project-transaction.js';
import { createPatchApprovalRegistry } from './patch-approval-registry.js';
import { createProjectMutexRegistry } from './project-mutex-registry.js';
import { createTransactionJournal } from './transaction-journal.js';
import { simulateProject } from '../workflow/simulate-project.js';
import { inspectProject } from '../workflow/inspect-project.js';
import { validateProject } from '../workflow/validate-project.js';
import { validateBoard } from '../workflow/validate-board.js';
import { assertSafeProjectDir, createNamedProject } from '../workflow/project-workspace.js';
import { normalizeCircuitSpec } from './circuit-spec.js';
import { continueCircuitConversation, conversationWantsGenerate, loadCircuitConversation } from './request-conversation.js';

const PROVIDER_ALLOWED_TOOLS = ['schematic.generate', 'project.create', 'schematic.patch', 'project.inspect', 'validate.erc', 'validate.drc', 'simulate.spice'];

function emitProgress(ctx, payload) {
  if (typeof ctx?.emit !== 'function') return;
  ctx.emit('agent.delta', {
    channel: 'progress',
    requestId: ctx.progressRequestId ?? payload.requestId ?? null,
    ...payload
  });
}

function progressCopy(prompt, ko, en) {
  return /[가-힣]/.test(prompt ?? '') ? ko : en;
}

function emitProviderEvent(ctx, event) {
  if (!event || typeof event !== 'object') return;
  if (event.type === 'agent.delta') {
    const text = typeof event.payload?.text === 'string' ? event.payload.text.trim() : '';
    if (!text) return;
    emitProgress(ctx, { stage: 'provider', sprite: 'cli', text });
    return;
  }
  if (event.type === 'tool.call') {
    const name = event.payload?.name ?? 'tool.call';
    emitProgress(ctx, { stage: 'tool', sprite: 'tool', text: name, toolName: name });
  }
}

export async function dispatchToolCall(call, dispatchOptions = {}) {
  const {
    checkProviderAvailabilityImpl = checkProviderAvailability,
    runProviderProcessImpl = runProviderProcess,
    inspectProjectImpl = inspectProject,
    validateProjectImpl: validateProjectImplementation = validateProject,
    validateBoardImpl: validateBoardImplementation = validateBoard,
    providerControllers = new Map(),
    patchApprovalRegistry = createPatchApprovalRegistry(),
    projectMutexRegistry = createProjectMutexRegistry(),
    transactionJournal,
    reconciledProjects = new Set(),
    allowedWorkspaceRoot,
    kicadCliPath,
    ngspicePath,
    runCommandImpl,
    verifyAppliedProjectImpl
  } = dispatchOptions;
  // Only server configuration selects executables. Never bind tool-call args.
  const validateProjectImpl = (options) => validateProjectImplementation({ ...options, kicadCliPath });
  const validateBoardImpl = (options) => validateBoardImplementation({ ...options, kicadCliPath });
  const ctx = {
    ...dispatchOptions,
    checkProviderAvailabilityImpl,
    runProviderProcessImpl,
    inspectProjectImpl,
    validateProjectImpl,
    validateBoardImpl,
    providerControllers,
    patchApprovalRegistry,
    projectMutexRegistry,
    transactionJournal,
    reconciledProjects,
    allowedWorkspaceRoot,
    kicadCliPath,
    ngspicePath,
    runCommandImpl,
    verifyAppliedProjectImpl
  };

  if (!call || typeof call !== 'object') {
    return failure('INVALID_TOOL_CALL', 'Tool call must be an object.');
  }

  try {
    guardToolProjectDir(call, allowedWorkspaceRoot);
  } catch (error) {
    return failure(error.code ?? 'UNSAFE_PROJECT_DIR', error.message);
  }

  try {
  switch (call.name) {
    case 'project.create':
      return ok(await createNamedProject({
        workspaceRoot: allowedWorkspaceRoot ?? call.args?.workspaceRoot,
        projectName: call.args?.projectName
      }));

    case 'schematic.generate':
      return previewNativeChange({
        projectDir: call.args?.projectDir,
        prompt: call.args?.prompt,
        projectName: call.args?.projectName,
        context: call.args?.context ?? call.args?.selection
      }, ctx);

    case 'project.inspect':
      return okOrInspectionFailure(inspectProjectImpl({
        projectDir: call.args?.projectDir,
        kicadCliPath,
        ...(call.args?.selection !== undefined ? { selection: call.args.selection } : {}),
        ...(allowedWorkspaceRoot ? { allowedWorkspaceRoot } : {}),
        analyzerAdapters: call.args?.analyzerAdapters
      }));

    case 'validate.erc':
      return okOrInspectionFailure(dispatchCopiedValidation('erc', call, ctx));

    case 'validate.drc':
      return okOrInspectionFailure(dispatchCopiedValidation('drc', call, ctx));

    case 'schematic.patch':
      return dispatchSchematicPatch(call.args ?? {}, ctx);

    case 'provider.status':
      return ok(await checkProviderAvailabilityImpl({ provider: call.args?.provider ?? 'codex' }));

    case 'provider.list':
      return ok({ providers: listProviderDefinitions() });

    case 'provider.invoke':
      return ok(await invokeProvider(call, ctx));

    case 'project.request':
      try {
        return ok(await requestProject(call, ctx));
      } catch (error) {
        if (error?.code === 'PROJECT_BUSY') return failure('PROJECT_BUSY', error.message);
        return failure(error.code ?? 'PROVIDER_FAILED', error.message, { conversation: error.conversation });
      }

    case 'provider.cancel':
      return ok(cancelProvider(call.args, providerControllers));

    case 'simulate.spice': {
      const result = await simulateProject({
        projectDir: call.args?.projectDir,
        ngspicePath,
        ...(runCommandImpl ? { runCommandImpl } : {})
      });
      return ok(publicSimulateResult(result));
    }

    case 'project.transaction.status':
      return await dispatchTransactionStatus(call.args ?? {}, ctx);

    case 'project.transaction.rollback':
      return await dispatchTransactionRollback(call.args ?? {}, ctx);

    default:
      return failure('UNKNOWN_TOOL', `Unknown ChatPCB tool: ${call.name}`);
  }
  } catch (error) {
    if (error?.code === 'PROJECT_BUSY') return failure('PROJECT_BUSY', error.message);
    throw error;
  }
}

async function dispatchSchematicPatch(args, ctx) {
  const projectDir = args.projectDir;
  const {
    patchApprovalRegistry,
    projectMutexRegistry,
    transactionJournal,
    validateProjectImpl,
    validateBoardImpl,
    verifyAppliedProjectImpl
  } = ctx;

  if (args.cancel === true) {
    if (!args.patchId) return failure('PATCH_APPROVAL_REQUIRED', 'patchId is required to cancel a patch preview.');
    const approval = patchApprovalRegistry.consume({ patchId: args.patchId, projectDir });
    if (!approval.ok) return { ok: false, error: approval.reason };
    await disposeSchematicPatchPlan(approval.record.plan);
    return ok({ requiresApproval: false, approved: false, canceled: true, applied: false, files: {}, changedFiles: [], diff: '' });
  }

  if (args.approved !== true) {
    emitProgress(ctx, { stage: 'preview', sprite: 'draft', text: 'Preparing a schematic patch preview.' });
    return previewNativeChange({
      projectDir,
      prompt: args.prompt,
      projectName: args.projectName,
      context: args.context ?? args.selection
    }, ctx);
  }

  emitProgress(ctx, { stage: 'apply', sprite: 'apply', text: 'Applying the draft to the schematic.' });
  if (!args.patchId) return failure('PATCH_APPROVAL_REQUIRED', 'patchId is required to approve a patch preview.');
  const peeked = patchApprovalRegistry.peek({ patchId: args.patchId, projectDir });
  if (!peeked.ok) return { ok: false, error: peeked.reason };
  const plan = peeked.record.plan;
  try {
    await ensureReconciled(projectDir, ctx);
    return ok(sanitizeApplyResult(await applySchematicPatch({
      projectDir,
      prompt: args.prompt,
      projectName: args.projectName,
      approved: true,
      expectedPatchId: args.patchId,
      patchPlan: plan,
      validateProjectImpl,
      validateBoardImpl,
      verifyAppliedProjectImpl,
      approvalRegistry: patchApprovalRegistry,
      mutexRegistry: projectMutexRegistry,
      journal: transactionJournal
    })));
  } catch (error) {
    if (error?.code === 'PROJECT_BUSY') return failure('PROJECT_BUSY', error.message);
    throw error;
  } finally {
    const still = patchApprovalRegistry.peek({ patchId: args.patchId, projectDir });
    if (!still.ok) await disposeSchematicPatchPlan(plan);
  }
}

async function invokeProvider(call, ctx) {
  const {
    runProviderProcessImpl,
    checkProviderAvailabilityImpl,
    providerControllers,
    allowGenerate = true,
    forceProjectDir = false
  } = ctx;
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
    const streamed = [];
    emitProgress(ctx, {
      stage: 'provider',
      sprite: 'cli',
      text: progressCopy(args.prompt, `${definition.label}와 대화 중.`, `Talking to ${definition.label}.`)
    });
    transcript = await runProviderProcessImpl({
      command: definition.command,
      args: definition.args,
      input,
      allowedToolNames: PROVIDER_ALLOWED_TOOLS,
      signal: controller.signal,
      onEvent: (event) => {
        streamed.push(event);
        emitProviderEvent(ctx, event);
      }
    });
    if (streamed.length === 0) {
      for (const event of transcript.events ?? []) emitProviderEvent(ctx, event);
    }
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
    if (!PROVIDER_ALLOWED_TOOLS.includes(event.payload.name)) {
      toolResults.push({
        id: event.payload.id,
        ...failure('UNKNOWN_TOOL', `Unknown ChatPCB tool: ${event.payload.name}`)
      });
      continue;
    }
    const toolCall = withProjectContext(event.payload, projectDir, forceProjectDir, {
      analyzerAdapters: args.analyzerAdapters,
      selection: args.selection,
      prompt
    });
    toolResults.push({
      id: event.payload.id,
      ...(await dispatchToolCall(toolCall, ctx))
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

async function requestProject(call, ctx) {
  const args = call.args ?? {};
  const projectDir = args.projectDir;
  const prompt = args.prompt;
  if (!projectDir) {
    throw new Error('project.request requires a project directory.');
  }
  if (!prompt) {
    throw new Error('project.request requires a prompt.');
  }

  emitProgress(ctx, {
    stage: 'conversation',
    sprite: 'think',
    text: progressCopy(prompt, '요청을 읽고 있어요.', 'Reading the circuit request.')
  });
  const spec = normalizeCircuitSpec(prompt);
  const hasExistingSpec = await projectHasSpec(projectDir);
  const existingConversation = await loadCircuitConversation(projectDir).catch(() => null);
  const awaitingInput = existingConversation?.status === 'awaiting-input';
  const shouldClarify = awaitingInput || !hasExistingSpec;
  const conversation = shouldClarify
    ? await continueCircuitConversation({ projectDir, prompt, spec, proMode: args.proMode === true })
    : existingConversation;
  if (shouldClarify && conversation && !conversationWantsGenerate(conversation)) {
    return {
      operation: 'clarify',
      requiresApproval: false,
      applied: false,
      conversation,
      assistantMessage: conversation.assistantMessage,
      nextQuestion: conversation.nextQuestion,
      options: conversation.options ?? [],
      unmatched: conversation.unmatched ?? [],
      missingProfile: conversation.missingProfile === true,
      review: {
        status: 'needs-input',
        findings: {
          blockers: [],
          warnings: [],
          notes: (conversation.unmatched ?? []).map((id) => ({
            id: `unmatched-${id}`,
            message: `Requested capability is not in a supported profile yet: ${id}.`
          }))
        },
        proposedFixes: []
      }
    };
  }

  if (conversation?.specRows?.length) {
    emitProgress(ctx, {
      stage: 'conversation',
      sprite: 'think',
      text: progressCopy(prompt, '권장 구성을 정리했습니다.', 'Prepared the recommended configuration.'),
      conversation
    });
  }

  const hasSpec = await projectHasSpec(projectDir);
  const generatePrompt = hasSpec && !awaitingInput
    ? prompt
    : (conversation?.generatePrompt ?? prompt);
  try {
    const providerResult = await invokeProvider({
      ...call,
      args: { ...args, prompt: generatePrompt }
    }, {
      ...ctx,
      allowGenerate: !hasSpec,
      forceProjectDir: true
    });
    let preview = lastMutatingResult(providerResult.toolResults);
    if (!preview) {
      emitProgress(ctx, {
        stage: 'preview',
        sprite: 'draft',
        text: progressCopy(prompt, '로컬에서 회로 초안을 그리는 중.', 'Drawing a local schematic draft.')
      });
      const generated = await previewNativeChange({
        projectDir,
        prompt: generatePrompt,
        context: args.selection
      }, ctx);
      if (!generated.ok) {
        const error = new Error(generated.error.message);
        error.code = generated.error.code;
        throw error;
      }
      preview = generated.result;
    }

    if (preview?.requiresApproval) {
      emitProgress(ctx, {
        stage: 'ready',
        sprite: 'preview',
        text: progressCopy(prompt, '회로 초안이 준비됐어요. 적용을 누르면 파일이 바뀝니다.', 'Circuit draft is ready. Apply it to change the schematic.')
      });
    }
    return {
      ...preview,
      operation: hasSpec ? 'patched' : 'generated',
      providerEvents: providerResult.events,
      conversation
    };
  } catch (error) {
    if (error?.code === 'PROJECT_BUSY') throw error;
    const wrapped = error instanceof Error ? error : new Error(String(error?.message ?? error));
    wrapped.code = error?.code ?? wrapped.code ?? 'PROVIDER_FAILED';
    wrapped.conversation = conversation;
    throw wrapped;
  }
}

function lastMutatingResult(toolResults) {
  return toolResults.findLast((toolResult) => (
    toolResult.ok && (toolResult.result?.files || toolResult.result?.requiresApproval === true)
  ))?.result ?? null;
}

async function projectHasSpec(projectDir) {
  const entries = await readdir(path.resolve(projectDir), { withFileTypes: true });
  return entries.some((entry) => entry.isFile() && entry.name.endsWith('.chatpcb.json'));
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

function withProjectContext(payload, projectDir, forceProjectDir = false, { analyzerAdapters, selection, prompt } = {}) {
  const args = {
    ...(payload.args ?? {})
  };
  delete args.analyzerAdapters;
  delete args.kicadCliPath;
  delete args.ngspicePath;
  delete args.selection;
  delete args.context;
  delete args.requiredValidation;
  delete args.transactionId;
  delete args.proposalId;
  delete args.rollback;

  let name = payload.name;
  if (name === 'schematic.patch') {
    delete args.approved;
    delete args.cancel;
    delete args.patchId;
    delete args.expectedPatchId;
    if (selection !== undefined) args.context = selection;
  }
  if (name === 'schematic.generate' && selection !== undefined) {
    args.context = selection;
  }
  if (name === 'project.inspect' && selection !== undefined) {
    args.selection = selection;
  }
  if (name === 'validate.erc' || name === 'validate.drc') {
    name = 'project.inspect';
  }

  if (projectDir && (forceProjectDir || !args.projectDir)) {
    args.projectDir = projectDir;
  }
  if (forceProjectDir && typeof prompt === 'string' && prompt.trim() && (name === 'schematic.generate' || name === 'schematic.patch')) {
    if (typeof args.prompt !== 'string' || args.prompt.trim().length === 0) {
      args.prompt = prompt;
    }
  }
  if (name === 'project.inspect' && analyzerAdapters !== undefined) {
    args.analyzerAdapters = analyzerAdapters;
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
  const projectMutexRegistry = dispatchOptions.projectMutexRegistry ?? createProjectMutexRegistry();
  const transactionJournal = dispatchOptions.transactionJournal ?? createTransactionJournal({
    stateRoot: dispatchOptions.transactionStateRoot
  });
  const reconciledProjects = dispatchOptions.reconciledProjects ?? new Set();
  const resolvedDispatchOptions = {
    ...dispatchOptions,
    providerControllers,
    patchApprovalRegistry,
    projectMutexRegistry,
    transactionJournal,
    reconciledProjects,
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
          const callCtx = {
            ...resolvedDispatchOptions,
            progressRequestId: envelope.payload.id,
            emit: (type, payload) => sendWebSocketJson(socket, createEnvelope(type, payload))
          };
          sendWebSocketJson(
            socket,
            createEnvelope('tool.result', {
              id: envelope.payload.id,
              ...(await dispatchToolCall(envelope.payload, callCtx))
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

async function previewNativeChange({ projectDir, prompt, projectName, context }, ctx) {
  emitProgress(ctx, {
    stage: 'preview',
    sprite: 'draft',
    text: progressCopy(prompt, '로컬에서 회로 초안을 그리는 중.', 'Drawing a local schematic draft.')
  });
  let plan;
  try {
    plan = await ctx.projectMutexRegistry.runExclusive({ projectDir }, () => createSchematicPatchPlan({
      projectDir,
      prompt,
      projectName,
      context,
      validateProjectImpl: ctx.validateProjectImpl,
      validateBoardImpl: ctx.validateBoardImpl
    }));
  } catch (error) {
    if (error?.code === 'PROJECT_BUSY') return failure('PROJECT_BUSY', error.message);
    throw error;
  }

  const registration = ctx.patchApprovalRegistry.register({
    patchId: plan.proposalId,
    proposalId: plan.proposalId,
    projectDir,
    plan,
    ...plan,
    dispose: () => disposeSchematicPatchPlan(plan)
  });
  const preview = await applySchematicPatch({ projectDir, approved: false, patchPlan: plan });
  const published = publicProposal(plan);
  return ok({
    ...sanitizePreviewResult(preview),
    requiredValidation: published.requiredValidation,
    candidateVerification: sanitizeCandidateVerification(published.candidateVerification),
    expiresAt: registration.expiresAt
  });
}

async function dispatchCopiedValidation(kind, call, ctx) {
  const inspection = await ctx.inspectProjectImpl({
    projectDir: call.args?.projectDir,
    kicadCliPath: ctx.kicadCliPath,
    ...(ctx.allowedWorkspaceRoot ? { allowedWorkspaceRoot: ctx.allowedWorkspaceRoot } : {}),
    analyzerAdapters: call.args?.analyzerAdapters,
    validateProjectImpl: ctx.validateProjectImpl,
    validateBoardImpl: ctx.validateBoardImpl
  });
  if (inspection?.validation?.[kind]) return sanitizeValidation(inspection.validation[kind]);
  return sanitizeValidation(inspection);
}

async function ensureReconciled(projectDir, ctx) {
  if (!projectDir || !ctx.transactionJournal) return;
  const run = ctx.projectMutexRegistry?.runExclusive
    ? (work) => ctx.projectMutexRegistry.runExclusive({ projectDir }, work)
    : (work) => work();
  await run(async () => {
    const key = ctx.projectMutexRegistry?.canonicalKey
      ? await ctx.projectMutexRegistry.canonicalKey(projectDir)
      : path.resolve(projectDir);
    if (ctx.reconciledProjects.has(key)) return;
    await ctx.transactionJournal.reconcile({ projectDir });
    ctx.reconciledProjects.add(key);
  });
}

async function dispatchTransactionStatus(args, ctx) {
  if (!ctx.transactionJournal) {
    return failure('JOURNAL_NOT_FOUND', 'Transaction journal is not configured.');
  }
  const projectDir = args.projectDir;
  try {
    await ensureReconciled(projectDir, ctx);
    const records = await ctx.transactionJournal.list({ projectDir });
    return ok({
      projectDir: path.resolve(projectDir),
      transactions: records.map(publicTransaction)
    });
  } catch (error) {
    if (error?.code === 'PROJECT_BUSY') return failure('PROJECT_BUSY', error.message);
    throw error;
  }
}

async function dispatchTransactionRollback(args, ctx) {
  if (!ctx.transactionJournal) {
    return failure('JOURNAL_NOT_FOUND', 'Transaction journal is not configured.');
  }
  const projectDir = args.projectDir;
  try {
    await ensureReconciled(projectDir, ctx);
    return ok(await rollbackProjectTransaction({
      projectDir,
      transactionId: args.transactionId,
      mutexRegistry: ctx.projectMutexRegistry,
      journal: ctx.transactionJournal
    }));
  } catch (error) {
    if (error?.code === 'PROJECT_BUSY') return failure('PROJECT_BUSY', error.message);
    throw error;
  }
}

function publicTransaction(record) {
  return {
    transactionId: record.transactionId,
    status: record.status,
    beforeTransactionDigest: record.beforeTransactionDigest,
    afterTransactionDigest: record.afterTransactionDigest,
    proposal: record.proposal,
    verification: sanitizeVerification(record.verification),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    changes: (record.changes ?? []).map((change) => ({
      path: change.path,
      operation: change.operation,
      beforeHash: change.beforeHash
    }))
  };
}

function publicSimulateResult(result) {
  if (!result || typeof result !== 'object') return result;
  const { stdout, stderr, ...rest } = result;
  return rest;
}

function sanitizeStatus(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  const out = {};
  for (const key of ['ok', 'skipped', 'executed', 'status', 'required', 'errorCount']) {
    if (entry[key] !== undefined) out[key] = entry[key];
  }
  if (entry.erc && typeof entry.erc === 'object' && typeof entry.erc.errorCount === 'number') {
    out.erc = {
      errorCount: entry.erc.errorCount,
      warningCount: entry.erc.warningCount,
      byType: entry.erc.byType
    };
  }
  if (entry.drc && typeof entry.drc === 'object' && ('violationCount' in entry.drc || 'unconnectedCount' in entry.drc)) {
    out.drc = {
      violationCount: entry.drc.violationCount,
      unconnectedCount: entry.drc.unconnectedCount,
      byType: entry.drc.byType
    };
  }
  if (entry.reason && typeof entry.reason === 'object') {
    out.reason = {
      code: entry.reason.code,
      message: typeof entry.reason.message === 'string'
        ? entry.reason.message.replace(/[A-Za-z]:\\[^\s"]+/g, '<redacted-path>').replace(/\/(?:tmp|temp|var)[^\s"]*/gi, '<redacted-path>')
        : entry.reason.message
    };
  }
  return out;
}

function sanitizeCandidateVerification(verification) {
  if (!verification || typeof verification !== 'object') return verification;
  return {
    ...(verification.erc ? { erc: sanitizeStatus(verification.erc) } : {}),
    ...(verification.drc ? { drc: sanitizeStatus(verification.drc) } : {})
  };
}

function sanitizeValidation(validation) {
  return sanitizeStatus(validation);
}

function sanitizeVerification(verification) {
  if (!verification || typeof verification !== 'object') return verification;
  return sanitizeCandidateVerification(verification);
}

function sanitizePreviewResult(preview) {
  if (!preview || typeof preview !== 'object') return preview;
  return {
    ...preview,
    candidateVerification: sanitizeCandidateVerification(preview.candidateVerification),
    validation: sanitizeValidation(preview.validation)
  };
}

function sanitizeApplyResult(result) {
  if (!result || typeof result !== 'object') return result;
  return {
    ...result,
    validation: sanitizeValidation(result.validation),
    verification: sanitizeVerification(result.verification)
  };
}

function ok(result) {
  return { ok: true, result };
}

async function okOrInspectionFailure(work) {
  try {
    return ok(await work);
  } catch (error) {
    if (error.code === 'UNSAFE_INSPECTION_LINK' || error.code === 'UNSAFE_PROJECT_DIR') {
      return failure(error.code, error.message);
    }
    throw error;
  }
}

function failure(code, message, extra = {}) {
  return {
    ok: false,
    error: { code, message },
    ...extra
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
