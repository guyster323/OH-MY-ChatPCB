const DAEMON_WS_URL = window.CHATPCB_DAEMON_WS_URL ?? 'ws://127.0.0.1:41317/ws';
const HOST_STATUS_TIMEOUT_MS = 2000;
const CONFLICT_POLL_MS = 1000;
const PROGRESS_COPY = {
  conversation: { title: '요청을 읽고 있어요', sprite: 'think' },
  provider: { title: 'CLI와 대화 중', sprite: 'cli' },
  tool: { title: 'CLI가 도구를 호출했어요', sprite: 'tool' },
  preview: { title: '회로 초안을 그리는 중', sprite: 'draft' },
  ready: { title: '적용을 기다리고 있어요', sprite: 'preview' },
  apply: { title: '스키매틱에 넣는 중', sprite: 'apply' },
  done: { title: '완료', sprite: 'done' },
  fail: { title: '이번엔 적용하지 못했어요', sprite: 'fail' }
};
const WORKFLOW_ORDER = [
  'circuit.concept', 'circuit.parts', 'circuit.draft', 'circuit.edit', 'circuit.review',
  'layout.concept', 'layout.place-major', 'layout.place-rest', 'layout.route', 'layout.edit', 'layout.review',
  'fab.gerber', 'fab.bom', 'fab.submit'
];
const WORKFLOW_COPY = {
  'circuit.concept': { wait: 'Circuit 컨셉을 채팅으로 보내 주세요.', run: '회로 컨셉을 읽고 있어요.' },
  'circuit.parts': { wait: '주요 부품을 고르거나 채팅으로 답하세요.', run: '주요 부품을 고르고 있어요.' },
  'circuit.draft': { wait: '회로 초안이 준비됐어요. 적용을 누르면 작성 단계가 끝납니다.', run: '회로 초안을 그리고 있어요.' },
  'circuit.edit': { wait: '고칠 회로 내용을 채팅으로 보내 주세요.', run: '회로를 수정하고 있어요.' },
  'circuit.review': { wait: '회로 리뷰를 확인하고 다음으로 넘어가세요.', run: '회로 리뷰를 돌리고 있어요.' },
  'layout.concept': { wait: '보드 크기, 형태, 층수를 알려 주세요.', run: '레이아웃 컨셉을 정리하고 있어요.' },
  'layout.place-major': { wait: '주요 부품 배치를 채팅으로 지시해 주세요.', run: '주요 부품을 배치하고 있어요.' },
  'layout.place-rest': { wait: '남은 부품 배치를 지시해 주세요.', run: '남은 부품을 배치하고 있어요.' },
  'layout.route': { wait: '배선 규칙을 알려 주세요.', run: '배선을 긋고 있어요.' },
  'layout.edit': { wait: '레이아웃에서 고칠 점을 보내 주세요.', run: '레이아웃을 수정하고 있어요.' },
  'layout.review': { wait: '레이아웃 리뷰를 확인하세요. 끝나면 제품화로 갑니다.', run: '레이아웃 리뷰를 돌리고 있어요.' },
  'fab.gerber': { wait: 'GERBER 등 JLCPCB 제출 산출물을 만들 차례입니다.', run: '제조 산출물을 만들고 있어요.' },
  'fab.bom': { wait: 'BOM·조립 파일을 확인할 차례입니다.', run: 'BOM을 정리하고 있어요.' },
  'fab.submit': { wait: 'JLCPCB 제출 패키지를 확인해 주세요.', run: '제출 패키지를 묶고 있어요.' }
};
const PROGRESS_TO_STEP = {
  conversation: 'circuit.concept',
  provider: 'circuit.parts',
  tool: 'circuit.parts',
  preview: 'circuit.draft',
  ready: 'circuit.draft',
  apply: 'circuit.draft'
};

const statusEl = document.querySelector('#connection-status');
const newProjectFormEl = document.querySelector('#new-project-form');
const workspaceRootEl = document.querySelector('#workspace-root');
const projectNameEl = document.querySelector('#project-name');
const activeProjectEl = document.querySelector('#active-project');
const activeProjectNameEl = document.querySelector('#active-project-name');
const activeProjectDirectoryEl = document.querySelector('#active-project-directory');
const formEl = document.querySelector('#composer');
const promptEl = document.querySelector('#prompt');
const sendButtonEl = formEl.querySelector('button[type="submit"]');
const providerEl = document.querySelector('#provider');
const providerStatusEl = document.querySelector('#provider-status');
const requestStatusEl = document.querySelector('#request-status');
const requestProgressEl = document.querySelector('#request-progress');
const requestTechnicalDetailsEl = document.querySelector('#request-technical-details');
const requestTechnicalDetailEl = document.querySelector('#request-technical-detail');
const conversationCardEl = document.querySelector('#conversation-card');
const conversationLogEl = document.querySelector('#conversation-log');
const conversationOptionsEl = document.querySelector('#conversation-options');
const projectSetupEl = document.querySelector('.project-setup');
const newProjectAgainEl = document.querySelector('#new-project-again');
const conflictCardEl = document.querySelector('#conflict-card');
const conflictDockBtnEl = document.querySelector('#conflict-dock-btn');
const recheckKiCadButtonEl = document.querySelector('#recheck-kicad-button');
const artifactListEl = document.querySelector('#artifact-list');
const reviewPanelEl = document.querySelector('#review-panel');
const reviewStatusEl = document.querySelector('#review-status');
const reviewBlockersEl = document.querySelector('#review-blockers');
const reviewWarningsEl = document.querySelector('#review-warnings');
const reviewNotesEl = document.querySelector('#review-notes');
const reviewFixesEl = document.querySelector('#review-fixes');
const validationStatusEl = document.querySelector('#validation-status');
const validationTimestampEl = document.querySelector('#validation-timestamp');
const inspectionCardEl = document.querySelector('#inspection-card');
const inspectionFreshnessEl = document.querySelector('#inspection-freshness');
const inspectionDigestEl = document.querySelector('#inspection-digest');
const inspectionArtifactCountEl = document.querySelector('#inspection-artifact-count');
const inspectionErcEl = document.querySelector('#inspection-erc');
const inspectionDrcEl = document.querySelector('#inspection-drc');
const patchApprovalCardEl = document.querySelector('#patch-approval-card');
const patchApprovalStatusEl = document.querySelector('#patch-approval-status');
const approvePatchButtonEl = document.querySelector('#approve-patch-button');
const cancelPatchButtonEl = document.querySelector('#cancel-patch-button');
const kiCadLinkCardEl = document.querySelector('#kicad-link-card');
const kiCadLinkEl = document.querySelector('#kicad-link');
const openKiCadButtonEl = document.querySelector('#open-kicad-button');
const kiCadFallbackEl = document.querySelector('#kicad-fallback');

let socket;
let activeProject = null;
let activeProjectCreateId = null;
let activeRequestId = null;
let activeRequestProjectDir = null;
let pendingHostStatus = null;
let conflictWatch = null;
let inspectionState = { projectDir: null, requestId: null, result: null };
let patchApprovalState = { patchId: null, expiresAt: null, timeout: null };
let lastRequestResult = null;
let lastProgressStage = null;
let lastProgressText = '';
let lastWorkflowActive = 'circuit.concept';
let workflowFlags = { circuitApplied: false, circuitReviewed: false, layoutReviewed: false };
const pendingCalls = new Map();
const workflowCaptionEl = document.querySelector('#workflow-caption');
const workflowCliEl = document.querySelector('#workflow-cli');

connect();
syncWorkflow();

newProjectFormEl.addEventListener('submit', (event) => {
  event.preventDefault();
  createProject();
});
newProjectAgainEl?.addEventListener('click', () => {
  if (projectSetupEl) projectSetupEl.hidden = false;
  projectNameEl?.focus();
});
formEl.addEventListener('submit', (event) => {
  event.preventDefault();
  sendProjectRequest();
});
providerEl.addEventListener('change', refreshProviderStatus);
openKiCadButtonEl.addEventListener('click', openInKiCad);
recheckKiCadButtonEl.addEventListener('click', () => refreshHostProjectStatus());
approvePatchButtonEl.addEventListener('click', approvePatch);
cancelPatchButtonEl.addEventListener('click', cancelPatch);
for (const button of document.querySelectorAll('.dock-btn[data-open]')) {
  button.addEventListener('click', () => {
    const dialog = document.getElementById(button.dataset.open);
    if (typeof dialog?.showModal === 'function') dialog.showModal();
  });
}
for (const button of document.querySelectorAll('.flow-btn')) {
  button.addEventListener('click', () => {
    const dialog = document.getElementById(button.dataset.open);
    if (typeof dialog?.showModal === 'function') dialog.showModal();
    const copy = WORKFLOW_COPY[button.dataset.step];
    if (copy && promptEl && !promptEl.disabled) promptEl.placeholder = copy.wait;
  });
}
window.addEventListener('message', (event) => handleHostMessage(event.data));
window.addEventListener('focus', () => refreshHostProjectStatus());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshHostProjectStatus();
});

function connect() {
  socket = new WebSocket(DAEMON_WS_URL);
  socket.addEventListener('open', () => {
    statusEl.textContent = 'Connected';
    clearPatchApproval();
    refreshProviderStatus();
    inspectActiveProject();
  });
  socket.addEventListener('message', (event) => handleEnvelope(JSON.parse(event.data)));
  socket.addEventListener('close', () => {
    statusEl.textContent = 'Disconnected';
    setTimeout(connect, 1500);
  });
  socket.addEventListener('error', () => {
    statusEl.textContent = 'Connection error';
  });
}

function createProject() {
  const workspaceRoot = workspaceRootEl.value.trim();
  const projectName = projectNameEl.value.trim();
  if (!workspaceRoot || !projectName) return;

  renderRequestStatus({ state: 'running', summary: 'Creating project…' });
  const id = `project_create_${Date.now()}`;
  activeProjectCreateId = id;
  pendingCalls.set(id, 'project.create');
  sendToolCall({ id, name: 'project.create', args: { workspaceRoot, projectName } });
}

async function sendProjectRequest() {
  if (!activeProject) {
    renderRequestStatus({ state: 'failed', summary: 'Create a project before sending a circuit request.' });
    return;
  }
  const prompt = promptEl.value.trim();
  if (!prompt) {
    renderRequestStatus({ state: 'failed', summary: 'Circuit request is required.' });
    return;
  }
  if (activeRequestId) return;

  const requestProject = activeProject;
  setRequestBusy(true);
  const status = await requestHostProjectStatus();
  if (activeProject !== requestProject) {
    setRequestBusy(false);
    return;
  }
  if (status?.unavailable) {
    renderRequestStatus({
      state: 'failed',
      summary: 'KiCad host is unavailable or not responding. Reopen the embedded panel or retry after KiCad is ready.'
    });
    setRequestBusy(false);
    return;
  }
  if (status?.dirty && status.linkState !== 'unlinked') {
    renderRequestStatus({
      state: 'failed',
      summary: 'KiCad changes need attention. Save or discard them in KiCad, then press Send again or I saved — recheck.'
    });
    showConflict();
    setRequestBusy(false);
    return;
  }

  hideConflict();
  lastProgressStage = 'conversation';
  lastProgressText = 'Send 했어요. 데몬과 CLI 응답을 기다립니다.';
  renderRequestStatus({ state: 'running', summary: 'Running request…' });
  clearProgress();
  appendProgress({ stage: 'conversation', text: lastProgressText });
  const id = `project_request_${Date.now()}`;
  activeRequestId = id;
  activeRequestProjectDir = requestProject.projectDir;
  pendingCalls.set(id, 'project.request');
  sendToolCall({
    id,
    name: 'project.request',
    args: {
      projectDir: requestProject.projectDir,
      prompt,
      provider: providerEl.value,
      proMode: document.querySelector('#pro-mode')?.checked === true
    }
  });
}

function refreshProviderStatus() {
  const id = `provider_status_${Date.now()}`;
  pendingCalls.set(id, 'provider.status');
  sendToolCall({ id, name: 'provider.status', args: { provider: providerEl.value } });
}

function sendToolCall(payload) {
  const envelope = {
    version: 1,
    id: `evt_${crypto.randomUUID()}`,
    type: 'tool.call',
    createdAt: new Date().toISOString(),
    payload
  };
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(envelope));
  } else {
    pendingCalls.delete(payload.id);
    renderRequestStatus({ state: 'failed', summary: '요청을 처리하지 못했습니다. 다시 시도하거나 기술 상세를 확인하세요.', technicalDetail: 'chatpcb-agentd is not connected.' });
    if (payload.name === 'project.request') setRequestBusy(false);
  }
}

function handleEnvelope(envelope) {
  if (envelope.type === 'agent.delta') {
    handleProgressDelta(envelope.payload);
    return;
  }
  if (envelope.type !== 'tool.result') return;
  const id = envelope.payload.id;
  const callName = pendingCalls.get(id) ?? (activeRequestId ? 'project.request' : activeProjectCreateId ? 'project.create' : undefined);
  pendingCalls.delete(id);

  if (!envelope.payload.ok) {
    if (callName === 'schematic.generate') {
      setRequestBusy(false);
      appendProgress({ stage: 'fail', text: envelope.payload.error?.message ?? 'Tool call failed.' });
      renderRequestStatus({
        state: 'failed',
        summary: '요청을 처리하지 못했습니다. 다시 시도하거나 기술 상세를 확인하세요.',
        technicalDetail: envelope.payload.error?.message ?? 'Tool call failed.'
      });
      return;
    }
    if (callName === 'project.create' || callName === 'project.request') {
      if (callName === 'project.create') {
        pendingCalls.delete(activeProjectCreateId);
        activeProjectCreateId = null;
      }
      if (callName === 'project.request') {
        const requestProjectDir = activeRequestProjectDir;
        pendingCalls.delete(activeRequestId);
        activeRequestId = null;
        activeRequestProjectDir = null;
        setRequestBusy(false);
        if (requestProjectDir !== activeProject?.projectDir) return;
        const conversation = envelope.payload.conversation;
        if (conversation) {
          const generateReady = conversation.status === 'generate' || Boolean(conversation.specRows?.length);
          renderConversation({
            conversation,
            ...conversation,
            operation: generateReady ? 'generated' : 'clarify'
          });
          if (generateReady && !(conversation.options?.length)) {
            offerNativeDraft();
          }
        }
      }
      appendProgress({ stage: 'fail', text: envelope.payload.error?.message ?? 'Tool call failed.' });
      renderRequestStatus({
        state: 'failed',
        summary: '요청을 처리하지 못했습니다. 다시 시도하거나 기술 상세를 확인하세요.',
        technicalDetail: envelope.payload.error?.message ?? 'Tool call failed.'
      });
    }
    if (callName === 'project.inspect') {
      if (inspectionState.requestId === id) renderInspectionFailure();
      return;
    }
    if (callName === 'schematic.patch.approve' || callName === 'schematic.patch.cancel') {
      clearPatchApproval();
      renderRequestStatus({ state: 'failed', summary: 'Patch approval could not be completed.', technicalDetail: envelope.payload.error?.message ?? 'Patch tool call failed.' });
    }
    return;
  }

  if (callName === 'project.create') {
    activeProjectCreateId = null;
    activateProject(envelope.payload.result);
    return;
  }
  if (callName === 'project.request') {
    const requestProjectDir = activeRequestProjectDir;
    activeRequestId = null;
    activeRequestProjectDir = null;
    setRequestBusy(false);
    if (requestProjectDir !== activeProject?.projectDir) return;
    renderProjectRequest(envelope.payload.result);
    inspectActiveProject();
    return;
  }
  if (callName === 'schematic.generate') {
    setRequestBusy(false);
    const conversation = lastRequestResult?.conversation ?? lastRequestResult;
    renderProjectRequest({
      ...envelope.payload.result,
      conversation,
      operation: 'generated'
    });
    inspectActiveProject();
    return;
  }
  if (callName === 'project.inspect') {
    if (inspectionState.projectDir === activeProject?.projectDir && inspectionState.requestId === id) renderInspection(envelope.payload.result);
    return;
  }
  if (callName === 'schematic.patch.approve') {
    clearPatchApproval();
    renderProjectRequest(envelope.payload.result);
    inspectActiveProject();
    return;
  }
  if (callName === 'schematic.patch.cancel') return;
  if (callName === 'provider.status') {
    const provider = envelope.payload.result;
    providerStatusEl.textContent = `${provider.provider}: ${provider.status}`;
    providerStatusEl.dataset.status = provider.status;
  }
}

function activateProject(project) {
  resetProjectResults();
  activeProject = project;
  activeProjectNameEl.textContent = project.displayName;
  activeProjectDirectoryEl.textContent = project.projectDir;
  activeProjectEl.hidden = false;
  if (projectSetupEl) projectSetupEl.hidden = true;
  conversationCardEl.hidden = false;
  setRequestBusy(Boolean(activeRequestId));
  projectNameEl.value = '';
  renderRequestStatus({ state: 'ready', summary: 'Project ready. Describe the circuit you want to create.' });
  inspectActiveProject();
  syncWorkflow();
}

function resetProjectResults() {
  if (pendingHostStatus) {
    clearTimeout(pendingHostStatus.timeout);
    const { resolve } = pendingHostStatus;
    pendingHostStatus = null;
    resolve({ cancelled: true });
  }
  artifactListEl.replaceChildren();
  reviewPanelEl.hidden = true;
  reviewStatusEl.textContent = 'Pending';
  delete reviewStatusEl.dataset.status;
  for (const list of [reviewBlockersEl, reviewWarningsEl, reviewNotesEl, reviewFixesEl]) list.replaceChildren();
  validationStatusEl.dataset.state = 'idle';
  validationStatusEl.textContent = 'Not run';
  validationTimestampEl.textContent = '';
  inspectionState = { projectDir: null, requestId: null, result: null };
  inspectionCardEl.hidden = true;
  renderInspection({});
  clearPatchApproval();
  hideConflict();
  conversationLogEl.replaceChildren();
  conversationOptionsEl.replaceChildren();
  clearProgress();
  kiCadLinkCardEl.hidden = true;
  kiCadLinkEl.dataset.state = 'available';
  kiCadLinkEl.textContent = '';
  kiCadFallbackEl.hidden = true;
  kiCadFallbackEl.textContent = '';
  lastRequestResult = null;
  lastProgressStage = null;
  lastProgressText = '';
  lastWorkflowActive = 'circuit.concept';
  workflowFlags = { circuitApplied: false, circuitReviewed: false, layoutReviewed: false };
  syncWorkflow();
}

function renderConversation(result) {
  lastRequestResult = result;
  conversationCardEl.hidden = false;
  conversationLogEl.replaceChildren();
  const specRows = result.specRows ?? result.conversation?.specRows;
  const specIntro = result.intro
    ?? result.conversation?.messages?.find((message) => message.intro)?.intro;
  const specFooter = result.footer
    ?? result.conversation?.messages?.find((message) => message.footer)?.footer;
  const messages = result.conversation?.messages ?? [
    ...(result.assistantMessage ? [{ role: 'assistant', text: result.assistantMessage, intro: specIntro, footer: specFooter, specRows }] : [])
  ];
  const lastAssistant = messages.findLastIndex((message) => message.role !== 'user');
  const hasMessageRows = messages.some((message) => Array.isArray(message.specRows) && message.specRows.length);
  for (const [index, message] of messages.entries()) {
    const item = document.createElement('li');
    item.dataset.role = message.role === 'user' ? 'user' : 'assistant';
    const rows = (Array.isArray(message.specRows) && message.specRows.length)
      ? message.specRows
      : (!hasMessageRows && index === lastAssistant ? specRows : null);
    if (message.role !== 'user' && Array.isArray(rows) && rows.length) {
      item.dataset.layout = 'spec';
      const introText = message.intro ?? specIntro;
      if (introText) {
        const intro = document.createElement('p');
        intro.className = 'spec-intro';
        intro.textContent = introText;
        item.append(intro);
      }
      const list = document.createElement('dl');
      list.className = 'spec-rows';
      for (const row of rows) {
        const term = document.createElement('dt');
        term.textContent = row.label;
        const detail = document.createElement('dd');
        const value = document.createElement('strong');
        value.textContent = row.value;
        detail.append(value);
        if (row.reason) {
          const reason = document.createElement('span');
          reason.className = 'spec-reason';
          reason.textContent = ` / ${row.reason}`;
          detail.append(reason);
        }
        list.append(term, detail);
      }
      item.append(list);
      const footerText = message.footer ?? specFooter;
      if (footerText) {
        const footer = document.createElement('p');
        footer.className = 'spec-footer';
        footer.textContent = footerText;
        item.append(footer);
      }
    } else {
      item.textContent = message.text;
    }
    conversationLogEl.append(item);
  }
  conversationOptionsEl.replaceChildren();
  for (const option of result.options ?? []) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = option.label;
    if (option.recommended) button.dataset.recommended = 'true';
    if (option.help) {
      button.title = option.help;
      button.dataset.help = option.help;
    }
    button.addEventListener('click', () => {
      promptEl.value = option.prompt;
      sendProjectRequest();
    });
    conversationOptionsEl.append(button);
  }
}

function renderProjectRequest(result) {
  renderConversation(result);
  if (result?.operation === 'clarify') {
    renderRequestStatus({
      state: 'ready',
      summary: result.nextQuestion ?? 'Reply in chat to continue. Missing capabilities are part of the product flow.'
    });
    return;
  }
  if (result?.requiresApproval && result.patchId) {
    setPatchApproval(result);
    appendProgress({ stage: 'ready', text: '미리보기가 끝났어요. 적용을 누르면 파일이 바뀝니다.' });
    renderRequestStatus({ state: 'ready', summary: '회로 초안이 준비됐어요. 스키매틱에 적용할까요?' });
    renderReview(result.review);
    renderArtifacts(result.files);
    renderValidation({ ...result.validation, completedAt: new Date().toISOString() });
    return;
  }
  renderReview(result.review);
  renderArtifacts(result.files);
  renderValidation({ ...result.validation, completedAt: new Date().toISOString() });
  const validationFailed = result.validation?.ok === false;
  const requestFailed = result.rolledBack || validationFailed;
  const summary = result.rolledBack
    ? 'ERC validation failed; the previous project files were restored.'
    : validationFailed
      ? 'ERC validation failed. Review the validation details before continuing.'
      : `Completed: ${result.operation === 'patched' ? 'Updated project.' : 'Generated project.'}`;
  if (!result.rolledBack) workflowFlags.circuitApplied = true;
  if (!requestFailed && result.review?.status && result.review.status !== 'blocked' && result.review.status !== 'needs-input') {
    workflowFlags.circuitReviewed = true;
  }
  renderRequestStatus({ state: requestFailed ? 'failed' : 'completed', summary });
  appendProgress({ stage: requestFailed ? 'fail' : 'done', text: summary });

  const projectFile = findProjectFile(result.files);
  const successfulUpdate = !result.rolledBack && result.validation?.ok !== false;
  if (!successfulUpdate) return;
  if (projectFile) {
    kiCadLinkCardEl.hidden = false;
    const hostAvailable = postHostMessage({ type: 'project.reload', projectPath: activeProject.projectDir });
    renderKiCadLink({ linkState: hostAvailable ? 'reload-needed' : 'available', projectPath: projectFile });
    if (!hostAvailable) {
      showKiCadFallback(projectFile);
    }
  }
}

function inspectActiveProject() {
  if (!activeProject?.projectDir) return;
  const projectDir = activeProject.projectDir;
  const id = `project_inspect_${Date.now()}_${crypto.randomUUID()}`;
  inspectionState = { projectDir, requestId: id, result: null };
  inspectionCardEl.hidden = false;
  renderInspection({});
  pendingCalls.set(id, 'project.inspect');
  sendToolCall({ id, name: 'project.inspect', args: { projectDir } });
}

function renderInspection(result = {}) {
  const freshness = result.manifest?.freshness ?? {};
  const status = ['current', 'stale', 'legacy-unverified', 'missing'].includes(freshness.status)
    ? freshness.status
    : 'missing';
  const digest = result.inspection?.projectDigest;
  const artifactCount = result.inspection?.artifactCount;
  const erc = result.validation?.erc;
  const drc = result.validation?.drc;
  inspectionFreshnessEl.dataset.state = status;
  inspectionFreshnessEl.textContent = status;
  inspectionFreshnessEl.title = freshness.reason ?? '';
  inspectionDigestEl.textContent = typeof digest === 'string' ? digest.slice(0, 12) : '—';
  inspectionArtifactCountEl.textContent = `${Number.isInteger(artifactCount) ? artifactCount : 0} artifacts`;
  inspectionErcEl.textContent = renderInspectionValidation('ERC', erc);
  inspectionDrcEl.textContent = renderInspectionValidation('DRC', drc);
  inspectionState.result = result;
  renderPatchApproval();
}

function renderInspectionFailure() {
  inspectionCardEl.hidden = false;
  renderInspection({ manifest: { freshness: { status: 'missing', reason: 'Inspection was unavailable.' } } });
}

function renderInspectionValidation(label, result) {
  if (!result) return `${label} —`;
  const reason = result.reason;
  if (result.skipped) return `${label} skipped [${reason?.code ?? 'UNKNOWN'}]: ${reason?.message ?? 'No reason was provided.'}`;
  if (result.ok === false && reason) return `${label} failed [${reason.code ?? 'UNKNOWN'}]: ${reason.message ?? 'No reason was provided.'}`;
  const summary = label === 'ERC' ? result.erc ?? result : result.drc ?? result;
  return label === 'ERC'
    ? `ERC ${summary.errorCount ?? 0}/${summary.warningCount ?? 0}`
    : `DRC ${summary.violationCount ?? 0}/${summary.unconnectedCount ?? 0}`;
}

function setPatchApproval(preview) {
  clearPatchApproval();
  patchApprovalState = { patchId: preview.patchId, expiresAt: preview.expiresAt, timeout: null };
  if (patchApprovalCardEl) patchApprovalCardEl.hidden = false;
  const delay = Number(preview.expiresAt) - Date.now();
  if (Number.isFinite(delay) && delay > 0) {
    patchApprovalState.timeout = setTimeout(() => {
      clearPatchApproval('Patch preview expired.');
    }, delay);
  }
  renderPatchApproval();
}

function clearPatchApproval(message = 'No patch preview active.') {
  if (patchApprovalState.timeout) clearTimeout(patchApprovalState.timeout);
  patchApprovalState = { patchId: null, expiresAt: null, timeout: null };
  patchApprovalStatusEl.dataset.state = 'idle';
  patchApprovalStatusEl.textContent = message;
  approvePatchButtonEl.disabled = true;
  cancelPatchButtonEl.disabled = true;
  if (patchApprovalCardEl) patchApprovalCardEl.hidden = message === 'No patch preview active.';
}

function renderPatchApproval() {
  const freshness = inspectionState.result?.manifest?.freshness?.status;
  const approvedEvidence = freshness === 'current' || freshness === 'legacy-unverified' || freshness === 'missing';
  const unexpired = Number.isFinite(Number(patchApprovalState.expiresAt)) && Number(patchApprovalState.expiresAt) > Date.now();
  const active = Boolean(patchApprovalState.patchId) && unexpired;
  approvePatchButtonEl.disabled = !active || !approvedEvidence;
  cancelPatchButtonEl.disabled = !active;
  if (patchApprovalCardEl) patchApprovalCardEl.hidden = !active;
  if (freshness === 'stale' && patchApprovalState.patchId) {
    if (patchApprovalCardEl) patchApprovalCardEl.hidden = false;
    patchApprovalStatusEl.dataset.state = 'stale';
    patchApprovalStatusEl.textContent = 'Approval unavailable: stale evidence. Inspect the project again before approving.';
    return;
  }
  if (!active) return;
  if (freshness === 'legacy-unverified') {
    patchApprovalStatusEl.dataset.state = 'warning';
    patchApprovalStatusEl.textContent = 'Approval allowed with legacy-unverified evidence; exact patch hashes will still be verified.';
    return;
  }
  if (freshness === 'missing' || !freshness) {
    patchApprovalStatusEl.dataset.state = 'warning';
    patchApprovalStatusEl.textContent = 'Approval allowed with no manifest evidence; exact patch hashes will still be verified.';
    return;
  }
  patchApprovalStatusEl.dataset.state = 'ready';
  patchApprovalStatusEl.textContent = 'Patch preview is ready for approval.';
}

function approvePatch() {
  if (!activeProject || approvePatchButtonEl.disabled || !patchApprovalState.patchId) return;
  appendProgress({ stage: 'apply', text: '스키매틱에 넣는 중…' });
  renderRequestStatus({ state: 'running', summary: 'Applying the circuit draft…' });
  const id = `patch_approve_${Date.now()}`;
  pendingCalls.set(id, 'schematic.patch.approve');
  sendToolCall({ id, name: 'schematic.patch', args: { projectDir: activeProject.projectDir, approved: true, patchId: patchApprovalState.patchId } });
}

function cancelPatch() {
  if (!activeProject || cancelPatchButtonEl.disabled || !patchApprovalState.patchId) return;
  const id = `patch_cancel_${Date.now()}`;
  pendingCalls.set(id, 'schematic.patch.cancel');
  sendToolCall({ id, name: 'schematic.patch', args: { projectDir: activeProject.projectDir, cancel: true, patchId: patchApprovalState.patchId } });
  clearPatchApproval('Patch preview cancelled.');
}

function workflowIndex(id) {
  const index = WORKFLOW_ORDER.indexOf(id);
  return index < 0 ? 0 : index;
}

function deriveWorkflow() {
  const running = requestStatusEl?.dataset.state === 'running';
  const conversation = lastRequestResult?.conversation ?? lastRequestResult;
  const step = conversation?.step;
  const status = conversation?.status;
  const operation = lastRequestResult?.operation;
  const reviewStatus = reviewStatusEl?.dataset.status;
  const validationFailed = lastRequestResult?.validation?.ok === false || lastRequestResult?.rolledBack === true;
  const patchReady = Boolean(patchApprovalState.patchId);
  let active = 'circuit.concept';
  const done = new Set();

  if (!activeProject) {
    return { active, done, mode: 'idle' };
  }

  if (operation === 'clarify' || status === 'awaiting-input') {
    if (step === 'collect-gaps' || step === 'confirm-generate') {
      done.add('circuit.concept');
      active = step === 'confirm-generate' ? 'circuit.draft' : 'circuit.parts';
    } else {
      active = 'circuit.concept';
    }
  } else if (patchReady && !workflowFlags.circuitApplied) {
    done.add('circuit.concept');
    done.add('circuit.parts');
    active = 'circuit.draft';
  } else if (workflowFlags.circuitApplied) {
    done.add('circuit.concept');
    done.add('circuit.parts');
    done.add('circuit.draft');
    if (operation === 'patched' && (running || patchReady)) {
      active = 'circuit.edit';
    } else if (validationFailed || reviewStatus === 'blocked' || !workflowFlags.circuitReviewed) {
      if (operation === 'patched') done.add('circuit.edit');
      active = 'circuit.review';
    } else {
      done.add('circuit.edit');
      done.add('circuit.review');
      active = workflowFlags.layoutReviewed ? 'fab.gerber' : 'layout.concept';
    }
  } else if (status === 'generate' || conversation?.specRows?.length) {
    done.add('circuit.concept');
    done.add('circuit.parts');
    active = 'circuit.draft';
  }

  if (running && lastProgressStage && PROGRESS_TO_STEP[lastProgressStage]) {
    active = PROGRESS_TO_STEP[lastProgressStage];
  }

  let mode = running ? 'run' : (activeProject ? 'wait' : 'idle');
  const failed = requestStatusEl?.dataset.state === 'failed';
  if (failed && lastWorkflowActive && active === 'circuit.concept') {
    active = lastWorkflowActive;
    mode = 'wait';
  }
  lastWorkflowActive = active;
  return { active, done, mode };
}

function syncWorkflow() {
  const { active, done, mode } = deriveWorkflow();
  const activeIndex = workflowIndex(active);
  const layoutReviewIndex = workflowIndex('layout.review');
  const layoutUnlocked = done.has('circuit.review') || activeIndex >= workflowIndex('layout.concept');
  const fabUnlocked = done.has('layout.review') || workflowFlags.layoutReviewed;

  for (const button of document.querySelectorAll('.flow-btn[data-step]')) {
    const id = button.dataset.step;
    const index = workflowIndex(id);
    const lane = id.split('.')[0];
    let state = 'idle';
    if (lane === 'fab' && !fabUnlocked) state = 'locked';
    else if (lane === 'layout' && !layoutUnlocked) state = 'locked';
    else if (done.has(id) && id !== active) state = 'done';
    else if (id === active) state = mode === 'run' ? 'run' : (mode === 'idle' ? 'idle' : 'wait');
    else if (index < activeIndex) state = 'done';
    else state = 'idle';
    button.dataset.state = state;
  }

  for (const lane of document.querySelectorAll('.workflow-lane')) {
    lane.dataset.active = String(active.startsWith(`${lane.dataset.lane}.`));
  }

  const copy = WORKFLOW_COPY[active];
  if (workflowCaptionEl && copy) {
    workflowCaptionEl.textContent = requestStatusEl?.dataset.state === 'failed'
      ? '생성에 실패했습니다. 기술 상세를 확인하거나 다시 Send 하세요.'
      : (mode === 'run' ? copy.run : (mode === 'idle' ? '프로젝트를 만들면 Circuit 컨셉부터 시작합니다.' : copy.wait));
  }
  if (promptEl && copy && mode === 'wait' && !promptEl.disabled) {
    promptEl.placeholder = copy.wait;
  }
  if (workflowCliEl) {
    const showCli = mode === 'run' && lastProgressText;
    workflowCliEl.hidden = !showCli;
    workflowCliEl.textContent = showCli ? lastProgressText : '';
  }
}

function renderRequestStatus({ state, summary, technicalDetail = '' }) {
  requestStatusEl.dataset.state = state;
  requestStatusEl.textContent = summary;
  requestTechnicalDetailEl.textContent = technicalDetail;
  requestTechnicalDetailsEl.hidden = technicalDetail.length === 0;
  syncWorkflow();
}

function handleProgressDelta(payload = {}) {
  if (payload.requestId && activeRequestId && payload.requestId !== activeRequestId) return;
  if (payload.conversation) {
    const conversation = payload.conversation;
    const generateReady = conversation.status === 'generate' || Boolean(conversation.specRows?.length);
    renderConversation({
      conversation,
      ...conversation,
      operation: generateReady ? 'generated' : 'clarify'
    });
  }
  const text = typeof payload.text === 'string' ? payload.text.trim() : '';
  const stage = payload.stage
    || (payload.toolName ? 'tool' : (payload.channel === 'progress' || text ? 'provider' : null));
  if (!stage && !text) return;
  appendProgress({
    stage: stage ?? 'provider',
    sprite: payload.sprite,
    text,
    toolName: payload.toolName
  });
}

function appendProgress(payload = {}) {
  if (!requestProgressEl) return;
  const stage = payload.stage ?? 'provider';
  const copy = PROGRESS_COPY[stage] ?? PROGRESS_COPY.provider;
  requestProgressEl.hidden = false;
  const item = document.createElement('li');
  item.dataset.stage = stage;
  item.dataset.role = 'progress';
  const img = document.createElement('img');
  img.className = 'progress-sprite';
  img.src = `./sprites/${payload.sprite || copy.sprite}.png`;
  img.alt = '';
  img.width = 32;
  img.height = 32;
  const body = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = copy.title;
  body.append(title);
  if (payload.text) {
    const text = document.createElement('p');
    text.textContent = payload.text;
    body.append(text);
  }
  item.append(img, body);
  requestProgressEl.append(item);
  while (requestProgressEl.children.length > 3) {
    requestProgressEl.firstElementChild.remove();
  }
  item.scrollIntoView({ block: 'nearest' });
  lastProgressStage = stage;
  lastProgressText = payload.text || copy.title;
  syncWorkflow();
}

function offerNativeDraft() {
  conversationOptionsEl.replaceChildren();
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '이 구성으로 초안 만들기';
  button.dataset.recommended = 'true';
  button.addEventListener('click', requestNativeDraft);
  conversationOptionsEl.append(button);
}

function requestNativeDraft() {
  if (!activeProject) return;
  setRequestBusy(true);
  conversationOptionsEl.replaceChildren();
  renderRequestStatus({ state: 'running', summary: 'Running request…' });
  appendProgress({ stage: 'preview', text: '로컬에서 회로 초안을 그리는 중.' });
  const id = `schematic_generate_${Date.now()}`;
  pendingCalls.set(id, 'schematic.generate');
  sendToolCall({
    id,
    name: 'schematic.generate',
    args: {
      projectDir: activeProject.projectDir,
      prompt: lastRequestResult?.generatePrompt ?? lastRequestResult?.sourcePrompt ?? promptEl.value
    }
  });
}

function clearProgress() {
  if (!requestProgressEl) return;
  requestProgressEl.replaceChildren();
  requestProgressEl.hidden = true;
}

function renderValidation({ ok, erc, skipped, reason, completedAt, exitCode, stderr, formatUpgrade } = {}) {
  const resolvedReason = reason ?? erc?.reason;
  const skippedFlag = skipped === true || erc?.skipped === true;
  const reasonText = validationReason({ reason: resolvedReason, exitCode, stderr, formatUpgrade });
  const counts = `${erc?.errorCount ?? 0} errors, ${erc?.warningCount ?? 0} warnings`;

  if (skippedFlag) {
    const unavailable = resolvedReason?.code === 'KICAD_CLI_UNAVAILABLE';
    validationStatusEl.dataset.state = unavailable ? 'unavailable' : 'skipped';
    validationStatusEl.textContent = `${unavailable ? 'ERC unavailable' : 'ERC skipped'}: ${reasonText}`;
  } else if (ok === false) {
    validationStatusEl.dataset.state = 'failed';
    validationStatusEl.textContent = `ERC failed: ${reasonText} (${counts} reported)`;
  } else if (!erc) {
    validationStatusEl.dataset.state = 'unavailable';
    validationStatusEl.textContent = `ERC unavailable: ${reasonText}`;
  } else {
    validationStatusEl.dataset.state = erc.errorCount === 0 ? 'passed' : 'failed';
    validationStatusEl.textContent = counts;
  }
  validationTimestampEl.textContent = completedAt ?? '';
}

function validationReason({ reason, exitCode, stderr, formatUpgrade }) {
  if (typeof reason === 'string' && reason.trim()) return reason.trim();
  if (typeof reason?.message === 'string' && reason.message.trim()) return reason.message.trim();
  if (typeof stderr === 'string' && stderr.trim()) return stderr.trim();
  if (typeof formatUpgrade?.stderr === 'string' && formatUpgrade.stderr.trim()) return formatUpgrade.stderr.trim();
  if (Number.isInteger(exitCode) && exitCode !== 0) return `KiCad ERC exited with code ${exitCode}.`;
  if (formatUpgrade?.ok === false) return `KiCad schematic format upgrade exited with code ${formatUpgrade.exitCode ?? 'unknown'}.`;
  if (typeof reason?.code === 'string' && reason.code) return reason.code.replaceAll('_', ' ').toLowerCase();
  return 'ERC validation did not complete successfully.';
}

function renderKiCadLink({ linkState, projectPath, dirty = false }) {
  kiCadLinkEl.dataset.state = linkState;
  kiCadLinkEl.textContent = dirty ? `Unsaved KiCad changes: ${projectPath}` : `${linkState}: ${projectPath}`;
}

function renderArtifacts(files = {}) {
  artifactListEl.replaceChildren();
  for (const [kind, file] of Object.entries(files)) {
    const item = document.createElement('li');
    item.textContent = `${kind}: ${file}`;
    artifactListEl.append(item);
  }
}

function renderReview(review) {
  if (!review) return;
  reviewPanelEl.hidden = false;
  reviewStatusEl.textContent = reviewStatusText(review);
  reviewStatusEl.dataset.status = review.status;
  renderFindingList(reviewBlockersEl, review.findings?.blockers);
  renderFindingList(reviewWarningsEl, review.findings?.warnings);
  renderFindingList(reviewNotesEl, review.findings?.notes);
  renderFixList(reviewFixesEl, review.proposedFixes);
}

function reviewStatusText(review) {
  if (review.statusLabel) return review.statusLabel;
  if (review.status === 'ready-for-release') return 'Ready for release';
  if (review.status === 'ready-for-prototype-review') return 'Ready for prototype review';
  return 'Blocked';
}

function renderFindingList(listEl, findings = []) {
  listEl.replaceChildren();
  for (const finding of findings) {
    const item = document.createElement('li');
    item.textContent = finding.message ?? String(finding);
    listEl.append(item);
  }
  if (findings.length === 0) listEl.append(Object.assign(document.createElement('li'), { textContent: 'None' }));
}

function renderFixList(listEl, fixes = []) {
  listEl.replaceChildren();
  for (const fix of fixes) {
    const item = document.createElement('li');
    item.textContent = `${fix.title}: ${fix.summary}`;
    listEl.append(item);
  }
  if (fixes.length === 0) listEl.append(Object.assign(document.createElement('li'), { textContent: 'No fixes proposed' }));
}

function findProjectFile(files = {}) {
  return Object.values(files).find((file) => String(file).endsWith('.kicad_pro'));
}

function openInKiCad() {
  const projectFile = findProjectFileFromList();
  if (!projectFile) return;
  if (postHostMessage({ type: 'project.open', projectPath: projectFile })) {
    kiCadFallbackEl.hidden = true;
    return;
  }
  showKiCadFallback(projectFile);
}

function findProjectFileFromList() {
  return [...artifactListEl.querySelectorAll('li')].map((item) => item.textContent?.replace(/^project:\s*/, '')).find((file) => file?.endsWith('.kicad_pro'));
}

function showKiCadFallback(projectFile) {
  kiCadFallbackEl.textContent = `Open this .kicad_pro file from KiCad: ${projectFile}. The browser panel cannot reload KiCad.`;
  kiCadFallbackEl.hidden = false;
}

async function requestHostProjectStatus() {
  if (!activeProject) return null;
  if (pendingHostStatus?.promise) return pendingHostStatus.promise;

  const host = window.chatpcbHost;
  const message = { type: 'project.status', projectPath: activeProject.projectDir };
  if (typeof host?.getProjectStatus === 'function') {
    try {
      return await awaitStatus(host.getProjectStatus(message)) ?? { unavailable: true };
    } catch {
      return { unavailable: true };
    }
  }
  if (typeof host?.postMessage !== 'function' && typeof host?.send !== 'function') return null;

  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  const timeout = setTimeout(() => {
    if (pendingHostStatus?.promise !== promise) return;
    pendingHostStatus = null;
    resolvePromise({ unavailable: true });
  }, HOST_STATUS_TIMEOUT_MS);
  pendingHostStatus = { projectPath: message.projectPath, resolve: resolvePromise, timeout, promise };
  postHostMessage(message);
  return promise;
}

function refreshHostProjectStatus() {
  if (!activeProject) return;
  requestHostProjectStatus();
}

function hostPathMatchesActive(projectPath) {
  if (!activeProject?.projectDir || typeof projectPath !== 'string' || projectPath.length === 0) return false;
  const requested = normalizeHostPath(projectPath);
  const active = normalizeHostPath(activeProject.projectDir);
  if (requested === active) return true;
  return requested.startsWith(`${active}/`) && /\.kicad_pro$/i.test(requested);
}

function normalizeHostPath(value) {
  return value.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
}

function postHostMessage(message) {
  const host = window.chatpcbHost;
  if (typeof host?.postMessage === 'function') {
    host.postMessage(message);
    return true;
  }
  if (typeof host?.send === 'function') {
    host.send(message);
    return true;
  }
  return false;
}

function handleHostMessage(message) {
  if (!message || typeof message !== 'object' || !hostPathMatchesActive(message.projectPath)) return;
  if (message.type === 'project.status') {
    const dirty = message.dirty === true || message.unsavedChanges === true;
    if (message.linkState === 'unlinked') {
      hideConflict();
      renderKiCadLink({ linkState: 'unlinked', projectPath: findProjectFileFromList() ?? activeProject.projectDir });
    } else if (dirty || message.linkState === 'conflict') {
      clearPatchApproval('Patch preview cleared because KiCad has unsaved changes; this is a dirty-project conflict, not stale evidence.');
      showConflict();
    } else {
      hideConflict();
      if (typeof message.linkState === 'string') {
        renderKiCadLink({ linkState: message.linkState, projectPath: findProjectFileFromList() ?? activeProject.projectDir });
      }
    }
    if (pendingHostStatus && hostPathMatchesActive(pendingHostStatus.projectPath)) {
      clearTimeout(pendingHostStatus.timeout);
      const { resolve } = pendingHostStatus;
      pendingHostStatus = null;
      resolve({ dirty, linkState: message.linkState });
    }
    return;
  }
  if (message.type === 'project.reload') {
    if (message.linkState === 'conflict') {
      clearPatchApproval('Patch preview cleared because KiCad has unsaved changes; this is a dirty-project conflict, not stale evidence.');
      showConflict();
      return;
    }
    const linkState = typeof message.linkState === 'string'
      ? message.linkState
      : message.completed === true
        ? 'reloaded'
        : 'error';
    renderKiCadLink({ linkState, projectPath: findProjectFileFromList() ?? activeProject.projectDir });
    if (message.completed === true) inspectActiveProject();
  }
}

function showConflict() {
  conflictCardEl.hidden = false;
  if (conflictDockBtnEl) conflictDockBtnEl.hidden = false;
  document.getElementById('conflict-dialog')?.showModal?.();
  renderKiCadLink({ linkState: 'conflict', projectPath: activeProject.projectDir, dirty: true });
  startConflictWatch();
}

function hideConflict() {
  conflictCardEl.hidden = true;
  if (conflictDockBtnEl) conflictDockBtnEl.hidden = true;
  document.getElementById('conflict-dialog')?.close?.();
  stopConflictWatch();
}

function startConflictWatch() {
  if (conflictWatch) return;
  conflictWatch = setInterval(() => {
    if (!activeProject || conflictCardEl.hidden) {
      stopConflictWatch();
      return;
    }
    refreshHostProjectStatus();
  }, CONFLICT_POLL_MS);
}

function stopConflictWatch() {
  if (!conflictWatch) return;
  clearInterval(conflictWatch);
  conflictWatch = null;
}

function setRequestBusy(isBusy) {
  sendButtonEl.disabled = isBusy || !activeProject;
  promptEl.disabled = isBusy || !activeProject;
}

async function awaitStatus(statusPromise) {
  let timeout;
  try {
    return await Promise.race([
      Promise.resolve(statusPromise).catch(() => null),
      new Promise((resolve) => { timeout = setTimeout(() => resolve(null), HOST_STATUS_TIMEOUT_MS); })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
