import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { KNOWN_CHATPCB_TOOLS, PROVIDER_ALLOWED_TOOLS, ToolName } from '../shared/constants.js';
import { createEnvelope, parseEnvelope } from './envelope.js';
import { runProviderProcess } from './provider-process.js';
import { buildProviderLaunchArgs, buildProviderPrompt, checkProviderAvailability, getProviderDefinition, grokMutatingToolNames, listProviderDefinitions, summarizeProjectInspection } from './provider-registry.js';
import { applySchematicPatch, createSchematicPatchPlan, disposeSchematicPatchPlan } from '../workflow/schematic-patch.js';
import { proposalSource, publicProposal } from '../workflow/native-proposal-source.js';
import { rollbackProjectTransaction } from '../workflow/project-transaction.js';
import { ercApprovalDecision, normalizeRecordedErc, recordedErcSource } from './erc-gate.js';
import { createPatchApprovalRegistry } from './patch-approval-registry.js';
import { createProjectMutexRegistry } from './project-mutex-registry.js';
import { createTransactionJournal } from './transaction-journal.js';
import { simulateProject } from '../workflow/simulate-project.js';
import { inspectProject } from '../workflow/inspect-project.js';
import { validateProject } from '../workflow/validate-project.js';
import { validateBoard } from '../workflow/validate-board.js';
import { assertSafeProjectDir, createNamedProject, readChatPcbManifest } from '../workflow/project-workspace.js';
import { normalizeCircuitSpec } from './circuit-spec.js';
import { continueCircuitConversation, conversationWantsGenerate, loadCircuitConversation, saveCircuitConversation, serializeCircuitConversation } from './request-conversation.js';

const knownChatPcbTools = new Set(KNOWN_CHATPCB_TOOLS);

function computeAllowedToolsForContext({ allowGenerate = false, allowCreate = false } = {}) {
  const tools = new Set(
    PROVIDER_ALLOWED_TOOLS.filter((name) => name !== ToolName.SCHEMATIC_GENERATE && name !== ToolName.PROJECT_CREATE)
  );
  if (allowGenerate) tools.add(ToolName.SCHEMATIC_GENERATE);
  if (allowCreate) tools.add(ToolName.PROJECT_CREATE);
  return tools;
}

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

const PROJECT_BUSY_KO = '다른 작업이 이 프로젝트를 사용 중이에요. 잠시 후 다시 시도해 주세요.';
const PROJECT_BUSY_EN = 'Another operation is using this project. Try again in a moment.';

function projectBusyClientMessage(prompt) {
  return progressCopy(prompt, PROJECT_BUSY_KO, PROJECT_BUSY_EN);
}

function projectBusyFailure(prompt) {
  return failure('PROJECT_BUSY', projectBusyClientMessage(prompt));
}

// Set only after this request has acquired the project mutex. Nested preview
// re-enters the same project; external apply/patch calls do not see the symbol.
const projectLockHeld = Symbol('projectLockHeld');
const RESTORE_STAGING_PREFIX = '.chatpcb-staging-';
const RESTORE_BACKUP_PREFIX = '.chatpcb-backup-';

function runWithProjectLock(ctx, projectDir, work) {
  if (ctx?.[projectLockHeld] === true) return work();
  if (!ctx?.projectMutexRegistry?.runExclusive) return work();
  return ctx.projectMutexRegistry.runExclusive({ projectDir }, work);
}

function resolveSnapshotFs(ctx) {
  const injected = ctx?.snapshotFs ?? {};
  return {
    cp: injected.cp ?? cp,
    rename: injected.rename ?? rename,
    rm: injected.rm ?? rm,
    mkdtemp: injected.mkdtemp ?? mkdtemp
  };
}

function providerDisallowedMessage(prompt, disallowedCalls) {
  const names = [];
  for (const call of disallowedCalls ?? []) {
    if (typeof call?.name !== 'string' || call.name.length === 0 || names.includes(call.name)) continue;
    names.push(call.name);
  }
  const tools = names.join(', ');
  return progressCopy(
    prompt,
    `AI가 이 단계에서 쓸 수 없는 작업(${tools})을 시도해 요청을 마치지 못했어요. 파일은 바뀌지 않았어요. 다시 시도해 주세요.`,
    `The AI attempted an operation (${tools}) that is not allowed at this stage. No files were changed. Please try again.`
  );
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
  if (dispatchOptions[projectLockHeld] === true) ctx[projectLockHeld] = true;

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

    case 'provider.invoke': {
      const invocationId = call.args?.invocationId ?? call.id;
      try {
        return ok(await invokeProvider(call, ctx));
      } finally {
        releaseProviderInvocation(providerControllers, invocationId);
      }
    }

    case 'project.request':
      try {
        return ok(await requestProject(call, ctx));
      } catch (error) {
        if (error?.code === 'PROJECT_BUSY') return projectBusyFailure(call.args?.prompt);
        const extra = { conversation: error.conversation };
        if (error?.technicalDetail) extra.technicalDetail = error.technicalDetail;
        const failed = failure(error.code ?? 'PROVIDER_FAILED', error.message, extra);
        if (typeof error?.snapshotPath === 'string') failed.error.snapshotPath = error.snapshotPath;
        if (typeof error?.backupPath === 'string') failed.error.backupPath = error.backupPath;
        return failed;
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
    if (error?.code === 'PROJECT_BUSY') return projectBusyFailure(call?.args?.prompt);
    throw error;
  }
}

function recordedVerificationPatchIds(verification) {
  if (!verification || typeof verification !== 'object') return [];
  const erc = verification.erc && typeof verification.erc === 'object' ? verification.erc : null;
  return [verification.patchId, erc?.patchId];
}

// A patch id on the ERC evidence is a different patch. The plan's own patchId
// and proposalId are the approval identity, not a stale ERC binding.
function candidateErcBindingStale(record, patchId) {
  const ids = [
    ...recordedVerificationPatchIds(record?.plan?.candidateVerification),
    ...recordedVerificationPatchIds(record?.candidateVerification)
  ];
  return ids.some((id) => typeof id === 'string' && id.length > 0 && id !== patchId);
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

  if (!args.patchId) return failure('PATCH_APPROVAL_REQUIRED', 'patchId is required to approve a patch preview.');
  const peeked = patchApprovalRegistry.peek({ patchId: args.patchId, projectDir });
  if (!peeked.ok) return { ok: false, error: peeked.reason };
  const plan = peeked.record.plan;
  // The registry record is the only ERC the approval may trust. Client fields
  // such as passed, validation, or ercResult on the request are ignored.
  if (candidateErcBindingStale(peeked.record, args.patchId)) {
    console.warn('patch.apply.blocked-stale');
    return failure('ERC_BLOCKED', 'ERC_BLOCKED: patch.apply.blocked-stale');
  }
  const recorded = normalizeRecordedErc(recordedErcSource(peeked.record));
  const decision = ercApprovalDecision(recorded, args.ercOverride);
  if (!decision.allow) {
    if (decision.reason === 'missing') console.warn('patch.apply.blocked-missing');
    return failure('ERC_BLOCKED', decision.message);
  }

  emitProgress(ctx, { stage: 'apply', sprite: 'apply', text: 'Applying the draft to the schematic.' });
  try {
    await ensureReconciled(projectDir, ctx);
    const applied = sanitizeApplyResult(await applySchematicPatch({
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
      journal: transactionJournal,
      allowSkippedErc: decision.allowSkippedErc === true
    }));
    if (applied?.reason?.code === 'PROJECT_BUSY') return projectBusyFailure(args.prompt);
    return ok(applied);
  } catch (error) {
    if (error?.code === 'PROJECT_BUSY') return projectBusyFailure(args.prompt);
    throw error;
  } finally {
    const still = patchApprovalRegistry.peek({ patchId: args.patchId, projectDir });
    if (!still.ok) await disposeSchematicPatchPlan(plan);
  }
}

function recoverParsedProviderFailure(error) {
  if (error?.code !== 'UNKNOWN_TOOL' || !Array.isArray(error.parsedEvents)) return null;
  return {
    exitCode: Number.isInteger(error.providerExitCode) ? error.providerExitCode : 0,
    stderr: typeof error.providerStderr === 'string' ? error.providerStderr : '',
    events: error.parsedEvents
  };
}

function providerDispatchContext(ctx, designSource) {
  const dispatchCtx = { ...ctx, designSource };
  if (ctx?.[projectLockHeld] === true) dispatchCtx[projectLockHeld] = true;
  return dispatchCtx;
}

async function invokeProvider(call, ctx) {
  const {
    runProviderProcessImpl,
    checkProviderAvailabilityImpl,
    getProviderDefinitionImpl = getProviderDefinition,
    providerControllers,
    allowGenerate: allowGenerateFlag,
    forceProjectDir = false,
    projectExists = false
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

  const definition = getProviderDefinitionImpl(provider);
  const availability = await checkProviderAvailabilityImpl({ provider });
  // Cancel can land during availability, after the previous attempt kept its controller.
  throwIfProviderCancelled(providerControllers, invocationId);
  if (!availability.available) {
    throw new Error(`${definition.label} is not available on this machine.`);
  }

  const launchContext = await providerLaunchContext({
    provider,
    projectDir,
    allowGenerate: allowGenerateFlag,
    projectExists,
    inspectionContext: ctx.inspectionContext,
    inspectResult: ctx.inspectResult
  });
  const allowGenerate = provider === 'grok' ? launchContext.allowGenerate !== false : allowGenerateFlag !== false;
  const contextAllowedTools = computeAllowedToolsForContext({
    allowGenerate,
    allowCreate: !forceProjectDir
  });
  const promptTools = provider === 'grok' ? grokMutatingToolNames(launchContext) : [...contextAllowedTools];
  const input = buildProviderPrompt({
    provider,
    userMessage: prompt,
    projectDir,
    allowedTools: promptTools,
    inspectionContext: launchContext.inspectionContext,
    projectExists: provider === 'grok' ? launchContext.projectExists === true : projectExists === true
  });

  let controller;
  try {
    throwIfProviderCancelled(providerControllers, invocationId);
    const existing = providerControllers.get(invocationId);
    // A reused id must not inherit an already-aborted controller from an earlier request.
    if (existing && !existing.signal.aborted) {
      controller = existing;
    } else {
      controller = new AbortController();
      providerControllers.set(invocationId, controller);
    }

    emitProgress(ctx, {
      stage: 'provider',
      sprite: 'cli',
      text: progressCopy(args.prompt, `${definition.label}와 대화 중.`, `Talking to ${definition.label}.`)
    });
    let alreadyStreamed = false;
    let transcript;
    try {
      transcript = await runProviderProcessImpl({
        command: availability.resolvedPath || availability.command || definition.command,
        args: buildProviderLaunchArgs(definition, launchContext),
        input,
        timeoutMs: definition.timeoutMs,
        allowedToolNames: PROVIDER_ALLOWED_TOOLS,
        signal: controller.signal,
        providerId: definition.id,
        usePromptFile: definition.usePromptFile === true,
        onEvent: (event) => {
          alreadyStreamed = true;
          emitProviderEvent(ctx, event);
        }
      });
    } catch (error) {
      // Unknown tool names reject the child transcript. Keep the parsed events
      // so a known tool from the same process still reaches DISALLOWED_TOOL.
      const recovered = recoverParsedProviderFailure(error);
      if (!recovered) throw error;
      transcript = recovered;
    }
    throwIfProviderRunAborted(providerControllers, invocationId, controller);
    if (!alreadyStreamed) {
      for (const event of transcript.events ?? []) emitProviderEvent(ctx, event);
    }

    if (transcript.exitCode !== 0) {
      throw new Error(`${definition.label} exited with code ${transcript.exitCode}.`);
    }

    const toolResults = [];
    const disallowedCalls = [];
    for (const event of transcript.events) {
      throwIfProviderRunAborted(providerControllers, invocationId, controller);
      if (event.type !== 'tool.call') continue;

      if (!knownChatPcbTools.has(event.payload.name)) {
        toolResults.push({
          id: event.payload.id,
          ...failure('UNKNOWN_TOOL', `Unknown ChatPCB tool: ${event.payload.name}`)
        });
        continue;
      }

      let disallowedReason = null;
      if (forceProjectDir && event.payload.name === 'project.create') {
        disallowedReason = 'project.create is not allowed when a project already exists';
      } else if (!allowGenerate && event.payload.name === 'schematic.generate') {
        disallowedReason = 'schematic.generate is not allowed for an existing project; use schematic.patch instead';
      } else if (!contextAllowedTools.has(event.payload.name)) {
        disallowedReason = `${event.payload.name} is not in the allowed tool list`;
      }

      if (disallowedReason) {
        disallowedCalls.push({ name: event.payload.name, reason: disallowedReason });
        toolResults.push({
          id: event.payload.id,
          ...failure('DISALLOWED_TOOL', disallowedReason)
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
        ...(await dispatchToolCall(toolCall, providerDispatchContext(
          ctx,
          proposalSource({ provider: definition.id, via: 'provider' })
        )))
      });
    }
    throwIfProviderRunAborted(providerControllers, invocationId, controller);

    return {
      providerInvocation: true,
      invocationId,
      provider,
      events: transcript.events,
      toolResults,
      disallowedCalls,
      stderr: transcript.stderr,
      tracePath: transcript.tracePath
    };
  } finally {
    // project.request keeps the controller until the whole request finishes so
    // cancel between attempts still finds it. Every other caller releases here.
    if (!ctx.retainProviderController && controller && providerControllers.get(invocationId) === controller) {
      providerControllers.delete(invocationId);
    }
  }
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
    ? await continueCircuitConversation({ projectDir, prompt, spec, proMode: args.proMode === true, persist: false })
    : existingConversation;
  if (shouldClarify && conversation && !conversationWantsGenerate(conversation)) {
    await saveCircuitConversation(projectDir, conversation);
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
  if (shouldClarify && conversation) {
    ctx.pendingConversationBytes = Buffer.from(serializeCircuitConversation(conversation));
  }

  const callerHolds = typeof ctx.projectMutexRegistry.callerHolds === 'function'
    ? await ctx.projectMutexRegistry.callerHolds({ projectDir })
    : false;
  return ctx.projectMutexRegistry.runExclusive({ projectDir, reentrant: true }, async () => {
    // Nested preview skips the lock only when this request acquired it.
    // A caller that already holds the project still sees PROJECT_BUSY from preview.
    if (!callerHolds) ctx[projectLockHeld] = true;
    let providerResult;
    let firstPreview;
    let retryAttempted = false;
    const invocationId = args.invocationId ?? call.id;
    const provisionalPlans = [];
    ctx.provisionalPlans = provisionalPlans;
    const providerCtx = {
      ...ctx,
      allowGenerate: !hasSpec,
      forceProjectDir: true,
      projectExists: hasSpec,
      retainProviderController: true
    };
    if (!callerHolds) providerCtx[projectLockHeld] = true;

    let snapshot = null;
    let keepSnapshot = false;
    const fsOps = resolveSnapshotFs(ctx);
    try {
      snapshot = hasSpec ? await snapshotProject(projectDir, fsOps) : null;
      throwIfProviderCancelled(ctx.providerControllers, invocationId);
      providerResult = await invokeProvider({
        ...call,
        args: { ...args, prompt: generatePrompt }
      }, providerCtx);

      throwIfProviderCancelled(ctx.providerControllers, invocationId);
      firstPreview = lastMutatingResult(providerResult.toolResults);

      if (providerResult.disallowedCalls?.length > 0 && !retryAttempted && !firstPreview) {
        throwIfProviderCancelled(ctx.providerControllers, invocationId);
        retryAttempted = true;
        const correctiveNote = hasSpec
          ? 'The project already exists. Use schematic.patch (not project.create or schematic.generate) to modify it.'
          : 'Use schematic.generate for new projects (not project.create inside project.request).';

        providerResult = await invokeProvider({
          ...call,
          args: { ...args, prompt: `${generatePrompt}\n\nNote: ${correctiveNote}` }
        }, providerCtx);
        throwIfProviderCancelled(ctx.providerControllers, invocationId);
      }

      throwIfProviderCancelled(ctx.providerControllers, invocationId);
      let preview = firstPreview ?? lastMutatingResult(providerResult.toolResults);
      let usedBuiltinDraft = false;
      if (!preview) {
        throwIfProviderCancelled(ctx.providerControllers, invocationId);
        usedBuiltinDraft = true;
        emitProgress(ctx, {
          stage: 'preview',
          sprite: 'draft',
          fallback: 'built-in-draft',
          reason: 'provider-returned-no-tool-call',
          text: progressCopy(
            prompt,
            '공급자가 도구 호출을 반환하지 않아 내장 초안을 사용합니다.',
            'The provider returned no tool call. Using the built-in draft.'
          )
        });
        const generated = await previewNativeChange({
          projectDir,
          prompt: generatePrompt,
          context: args.selection
        }, providerDispatchContext(ctx, proposalSource({ via: 'native-fallback' })));
        if (!generated.ok) {
          if (providerResult?.disallowedCalls?.length > 0 && retryAttempted) {
            const disallowedError = new Error(providerDisallowedMessage(prompt, providerResult.disallowedCalls));
            disallowedError.code = 'PROVIDER_DISALLOWED_TOOL';
            disallowedError.conversation = conversation;
            disallowedError.technicalDetail = providerResult.disallowedCalls.map((dc) => `${dc.name}: ${dc.reason}`).join('; ');
            throw disallowedError;
          }
          const error = new Error(generated.error.message);
          error.code = generated.error.code;
          throw error;
        }
        preview = generated.result;
      }

      throwIfProviderCancelled(ctx.providerControllers, invocationId);
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
        conversation,
        ...(usedBuiltinDraft ? { providerFallback: 'built-in-draft' } : {})
      };
    } catch (error) {
      // PROJECT_BUSY means another transaction holds the project and may be writing.
      let thrown = error;
      if (snapshot && error?.code !== 'PROJECT_BUSY') {
        try {
          await restoreProjectSnapshot(snapshot, projectDir, fsOps, { ctx, prompt });
        } catch (restoreError) {
          keepSnapshot = true;
          thrown = projectSnapshotRestoreError(error, restoreError, snapshot, conversation);
        }
      }
      try {
        await disposeProvisionalPlans(provisionalPlans, ctx.patchApprovalRegistry, projectDir);
      } catch (disposeError) {
        if (!thrown?.snapshotPath) throw disposeError;
      }
      if (shouldClarify && conversation) {
        try {
          await saveCircuitConversation(projectDir, conversation);
        } catch {
          // Keep the provider error. The conversation is still on the thrown object.
        }
      }
      if (thrown?.code === 'PROJECT_BUSY') throw thrown;
      if (thrown?.snapshotPath) throw thrown;
      const wrapped = thrown instanceof Error ? thrown : new Error(String(thrown?.message ?? thrown));
      wrapped.code = thrown?.code ?? wrapped.code ?? 'PROVIDER_FAILED';
      wrapped.conversation = conversation;
      if (thrown?.technicalDetail) wrapped.technicalDetail = thrown.technicalDetail;
      throw wrapped;
    } finally {
      if (snapshot?.root && !keepSnapshot) await fsOps.rm(snapshot.root, { force: true, recursive: true });
      releaseProviderInvocation(ctx.providerControllers, invocationId);
    }
  });
}

async function snapshotProject(projectDir, fsOps = resolveSnapshotFs()) {
  const root = await fsOps.mkdtemp(path.join(tmpdir(), 'chatpcb-project-snapshot-'));
  try {
    const copy = path.join(root, 'project');
    await fsOps.cp(projectDir, copy, { recursive: true });
    return { root, copy };
  } catch (error) {
    await fsOps.rm(root, { force: true, recursive: true });
    throw error;
  }
}

function projectSnapshotRestoreError(original, restoreError, snapshot, conversation) {
  const originalMessage = original instanceof Error ? original.message : String(original?.message ?? original);
  let restoreMessage = restoreError instanceof Error ? restoreError.message : String(restoreError?.message ?? restoreError);
  const backupPath = typeof restoreError?.backupPath === 'string' ? restoreError.backupPath : undefined;
  if (backupPath && !restoreMessage.includes(backupPath)) {
    restoreMessage = `${restoreMessage} Original project remains at ${backupPath}.`;
  }
  const error = new Error(
    `${originalMessage} Failed to restore the project snapshot: ${restoreMessage} Snapshot kept at ${snapshot.root}.`
  );
  error.code = original?.code ?? 'PROVIDER_FAILED';
  error.snapshotPath = snapshot.root;
  if (backupPath) error.backupPath = backupPath;
  error.conversation = conversation ?? original?.conversation;
  if (original?.technicalDetail) error.technicalDetail = original.technicalDetail;
  error.cause = restoreError;
  return error;
}

function restoreBackupCleanupWarning(prompt, backup, error) {
  const detail = error instanceof Error ? error.message : String(error?.message ?? error);
  const reason = detail ? ` (${detail})` : '';
  return progressCopy(
    prompt,
    `프로젝트는 복원됐지만 백업 폴더를 지우지 못했어요${reason}. 직접 삭제해 주세요: ${backup}`,
    `The project was restored, but the backup directory could not be removed${reason}. Delete it manually: ${backup}`
  );
}

// Progress delivery must not turn a finished restore into a failure.
function warnLeftoverRestoreBackup(ctx, prompt, backup, error) {
  const text = restoreBackupCleanupWarning(prompt, backup, error);
  try {
    emitProgress(ctx, { stage: 'warn', sprite: 'preview', text });
  } catch {
    // The restore already finished. A progress listener must not roll it back.
  }
}

// Copy onto a sibling, then swap directory names. A failed copy never deletes
// the live project. A failed rename puts the original directory back. Once both
// renames succeed, failing to delete the backup only warns and leaves the
// restored project in place.
async function restoreProjectSnapshot(snapshot, projectDir, fsOps = resolveSnapshotFs(), { ctx, prompt } = {}) {
  const resolved = path.resolve(projectDir);
  const parent = path.dirname(resolved);
  const base = path.basename(resolved);
  const token = randomUUID();
  const staging = path.join(parent, `${RESTORE_STAGING_PREFIX}${base}-${token}`);
  const backup = path.join(parent, `${RESTORE_BACKUP_PREFIX}${base}-${token}`);
  const moved = { project: false, staging: false };

  try {
    await fsOps.cp(snapshot.copy, staging, { recursive: true });
    await fsOps.rename(resolved, backup);
    moved.project = true;
    await fsOps.rename(staging, resolved);
    moved.staging = true;
  } catch (error) {
    try {
      await rollbackProjectRestore({ fsOps, projectDir: resolved, staging, backup, moved });
    } catch (rollbackError) {
      rollbackError.cause = error;
      throw rollbackError;
    }
    throw error;
  }

  try {
    await fsOps.rm(backup, { recursive: true, force: true });
  } catch (error) {
    warnLeftoverRestoreBackup(ctx, prompt, backup, error);
  }
}

function projectRestoreBackupError(error, backup) {
  const detail = error instanceof Error ? error.message : String(error?.message ?? error);
  const wrapped = new Error(`${detail} Original project remains at ${backup}.`, { cause: error });
  wrapped.backupPath = backup;
  if (error?.code) wrapped.code = error.code;
  return wrapped;
}

async function rollbackProjectRestore({ fsOps, projectDir, staging, backup, moved }) {
  if (moved.staging && moved.project) {
    try {
      await fsOps.rename(projectDir, staging);
    } catch (error) {
      throw projectRestoreBackupError(error, backup);
    }
    try {
      await fsOps.rename(backup, projectDir);
    } catch (error) {
      try {
        await fsOps.rename(staging, projectDir);
      } catch {
        // The pre-restore directory is still at `backup`.
      }
      throw projectRestoreBackupError(error, backup);
    }
    await fsOps.rm(staging, { recursive: true, force: true }).catch(() => {});
    return;
  }
  if (moved.project) {
    try {
      await fsOps.rename(backup, projectDir);
      moved.project = false;
    } catch (error) {
      throw projectRestoreBackupError(error, backup);
    }
  }
  await fsOps.rm(staging, { recursive: true, force: true }).catch(() => {});
}

async function disposeProvisionalPlans(plans, registry, projectDir) {
  for (const plan of plans) {
    const patchId = plan?.proposalId ?? plan?.patchId;
    if (registry && patchId && projectDir) {
      registry.consume({ patchId, projectDir });
    }
    await disposeSchematicPatchPlan(plan);
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

async function providerLaunchContext({
  provider,
  projectDir,
  allowGenerate,
  projectExists,
  inspectionContext,
  inspectResult
}) {
  if (provider !== 'grok') return { projectDir };

  let exists = projectExists === true;
  if (allowGenerate === false) exists = true;
  else if (typeof allowGenerate !== 'boolean' && projectExists !== true && projectExists !== false && projectDir) {
    try {
      exists = await projectHasSpec(projectDir);
    } catch {
      exists = false;
    }
  }
  const existing = allowGenerate === false || (allowGenerate !== true && exists);
  const context = {
    projectDir,
    allowGenerate: !existing,
    projectExists: existing
  };
  if (existing) {
    context.inspectionContext = inspectionContext ?? await loadGrokInspectionContext(projectDir, inspectResult);
  }
  return context;
}

async function loadGrokInspectionContext(projectDir, inspectResult) {
  let spec = null;
  if (projectDir) {
    try {
      spec = await readChatPcbManifest(projectDir);
    } catch {
      spec = null;
    }
  }
  return summarizeProjectInspection({ spec, inspection: inspectResult });
}

function guardToolProjectDir(call, allowedWorkspaceRoot) {
  const projectDir = call.args?.projectDir;
  if (typeof projectDir !== 'string' || projectDir.length === 0) {
    return;
  }

  assertSafeProjectDir(projectDir, { allowedWorkspaceRoot });
}

// provider.cancel removes the controller as soon as it aborts. The id stays
// cancelled until the request finishes, so a retry cannot open a fresh controller.
const cancelledProviderInvocations = new WeakMap();

function cancelledProviderIds(providerControllers) {
  if (!providerControllers) return null;
  let ids = cancelledProviderInvocations.get(providerControllers);
  if (!ids) {
    ids = new Set();
    cancelledProviderInvocations.set(providerControllers, ids);
  }
  return ids;
}

function providerInvocationWasCancelled(providerControllers, invocationId) {
  if (!invocationId || !providerControllers) return false;
  return cancelledProviderInvocations.get(providerControllers)?.has(invocationId) === true;
}

function throwIfProviderCancelled(providerControllers, invocationId) {
  if (providerInvocationWasCancelled(providerControllers, invocationId)) {
    throw providerCancelledError();
  }
}

function throwIfProviderRunAborted(providerControllers, invocationId, controller) {
  if (providerInvocationWasCancelled(providerControllers, invocationId) || controller?.signal.aborted) {
    throw providerCancelledError();
  }
}

function providerCancelledError() {
  return new Error('Provider process cancelled.');
}

function releaseProviderInvocation(providerControllers, invocationId) {
  if (!providerControllers || !invocationId) return;
  providerControllers.delete(invocationId);
  cancelledProviderInvocations.get(providerControllers)?.delete(invocationId);
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
  cancelledProviderIds(providerControllers).add(invocationId);
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
    plan = await runWithProjectLock(ctx, projectDir, () => createSchematicPatchPlan({
      projectDir,
      prompt,
      projectName,
      context,
      validateProjectImpl: ctx.validateProjectImpl,
      validateBoardImpl: ctx.validateBoardImpl,
      conversationBytes: ctx.pendingConversationBytes,
      source: ctx.designSource ?? proposalSource()
    }));
  } catch (error) {
    if (error?.code === 'PROJECT_BUSY') return projectBusyFailure(prompt);
    throw error;
  }

  if (Array.isArray(ctx.provisionalPlans)) ctx.provisionalPlans.push(plan);

  const registration = ctx.patchApprovalRegistry.register({
    patchId: plan.proposalId,
    proposalId: plan.proposalId,
    projectDir,
    plan,
    ...plan,
    ercResult: normalizeRecordedErc(plan.candidateVerification?.erc),
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
  const run = (work) => runWithProjectLock(ctx, projectDir, work);
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
    if (error?.code === 'PROJECT_BUSY') return projectBusyFailure();
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
    const rolled = await rollbackProjectTransaction({
      projectDir,
      transactionId: args.transactionId,
      mutexRegistry: ctx.projectMutexRegistry,
      journal: ctx.transactionJournal
    });
    if (rolled?.reason?.code === 'PROJECT_BUSY') return projectBusyFailure();
    return ok(rolled);
  } catch (error) {
    if (error?.code === 'PROJECT_BUSY') return projectBusyFailure();
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
  const rest = { ...result };
  delete rest.stdout;
  delete rest.stderr;
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
