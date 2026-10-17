const DAEMON_WS_URL = window.CHATPCB_DAEMON_WS_URL ?? 'ws://127.0.0.1:41317/ws';
const HOST_STATUS_TIMEOUT_MS = 2000;
const CONFLICT_POLL_MS = 1000;
const CHATGPT_AUTH_POLL_MS = 2000;
const PROVIDER_STORAGE_KEY = 'chatpcb.provider';
const CHATGPT_SWITCH_OFFER_PREFIX = 'chatpcb.chatgpt-switch-offered';
const CHATGPT_SWITCH_OFFER_HASH_HEX = 16;
const DAEMON_TITLE_KEYS = {
  'connection.connecting': 'connection.daemon.connecting',
  'connection.connected': 'connection.daemon.open',
  'connection.disconnected': 'connection.daemon.closed',
  'connection.error': 'connection.daemon.error'
};
const PROGRESS_COPY = {
  conversation: { titleKey: 'progress.conversation', sprite: 'think' },
  provider: { titleKey: 'progress.provider', sprite: 'cli' },
  tool: { titleKey: 'progress.tool', sprite: 'tool' },
  preview: { titleKey: 'progress.preview', sprite: 'draft' },
  ready: { titleKey: 'progress.ready', sprite: 'preview' },
  apply: { titleKey: 'progress.apply', sprite: 'apply' },
  done: { titleKey: 'progress.done', sprite: 'done' },
  warn: { titleKey: 'progress.warn', sprite: 'preview' },
  fail: { titleKey: 'progress.fail', sprite: 'fail' }
};
const WORKFLOW_ORDER = [
  'circuit.concept', 'circuit.parts', 'circuit.draft', 'circuit.edit', 'circuit.review',
  'layout.concept', 'layout.place-major', 'layout.place-rest', 'layout.route', 'layout.edit', 'layout.review',
  'fab.gerber', 'fab.bom', 'fab.submit'
];
const SVG_NS = 'http://www.w3.org/2000/svg';
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
const patchApprovalTitleEl = document.querySelector('#patch-approval-title');
const patchApprovalSourceEl = document.querySelector('#patch-approval-source');
const patchApprovalPartsEl = document.querySelector('#patch-approval-parts');
const patchApprovalStatusEl = document.querySelector('#patch-approval-status');
const patchApprovalTechnicalDetailsEl = document.querySelector('#patch-approval-technical-details');
const patchApprovalTechnicalDetailEl = document.querySelector('#patch-approval-technical-detail');
const approvePatchButtonEl = document.querySelector('#approve-patch-button');
const applyRemoveConfirmEl = document.querySelector('#apply-remove-components-confirm');
const applyRemoveTitleEl = document.querySelector('#apply-remove-components-title');
const applyRemoveLeadEl = document.querySelector('#apply-remove-components-lead');
const applyRemovePartsEl = document.querySelector('#apply-remove-components-parts');
const cancelApplyRemoveButtonEl = document.querySelector('#cancel-apply-remove-components');
const confirmApplyRemoveButtonEl = document.querySelector('#confirm-apply-remove-components');
const approveWithoutErcButtonEl = document.querySelector('#approve-patch-without-erc');
const applyWithoutErcConfirmEl = document.querySelector('#apply-without-erc-confirm');
const confirmApplyWithoutErcButtonEl = document.querySelector('#confirm-apply-without-erc');
const cancelApplyWithoutErcButtonEl = document.querySelector('#cancel-apply-without-erc');
const cancelPatchButtonEl = document.querySelector('#cancel-patch-button');
const fixPatchButtonEl = document.querySelector('#fix-patch-button');
const applyWhyEl = document.querySelector('#apply-why');
const patchErcEl = document.querySelector('#patch-erc');
const kiCadLinkCardEl = document.querySelector('#kicad-link-card');
const kiCadLinkEl = document.querySelector('#kicad-link');
const openKiCadButtonEl = document.querySelector('#open-kicad-button');
const kiCadFallbackEl = document.querySelector('#kicad-fallback');
const chatgptAuthCardEl = document.querySelector('#chatgpt-auth-card');
const chatgptSwitchOfferEl = document.querySelector('#chatgpt-switch-offer');
const chatgptSwitchOfferTextEl = document.querySelector('#chatgpt-switch-offer-text');
const chatgptSwitchOfferAcceptEl = document.querySelector('#chatgpt-switch-offer-accept');
const chatgptSwitchOfferDismissEl = document.querySelector('#chatgpt-switch-offer-dismiss');
const authLiveRegionEl = document.querySelector('#auth-live-region');

let socket;
let activeProject = null;
let activeProjectCreateId = null;
let activeRequestId = null;
let activeRequestProjectDir = null;
let pendingHostStatus = null;
let conflictWatch = null;
let inspectionState = { projectDir: null, requestId: null, result: null };
let patchRejectionCode = null;
let chatGptUiEnabled = false;
let chatGptSignedIn = null;
let patchApprovalState = { patchId: null, expiresAt: null, timeout: null, removedComponents: null };
let chatgptAuthState = { state: 'signed_out', attemptId: null, authUrl: null };
let chatgptAuthKnown = false;
let chatgptAuthPoll = null;
let chatgptAuthExpiryTimer = null;
let i18nReady = false;
let switchOfferEpoch = 0;
let activeSwitchOfferStorageKey = null;
let activeSwitchIdentity = '';
let anonymousSwitchOfferRecorded = false;
const switchOfferRecordedKeys = new Set();
const pageOnlySwitchIdentities = new Set();
let lastRequestResult = null;
let lastProgressStage = null;
let lastProgressText = '';
let lastWorkflowActive = 'circuit.concept';
let workflowFlags = { circuitApplied: false, circuitReviewed: false, layoutReviewed: false };
let connectionStatusKey = 'connection.connecting';
let requestStatusKey = 'request.idle';
let lastProviderStatus = null;
let requestStatusVars = null;
const laneOpen = new Map();
const pendingCalls = new Map();
const workflowCaptionEl = document.querySelector('#workflow-caption');
const workflowCliEl = document.querySelector('#workflow-cli');

restoreProviderSelection();
connect();
setConnectionStatus(connectionStatusKey);
syncWorkflow();
applyHostQueries();
window.chatpcbI18n?.onChange(() => {
  i18nReady = true;
  setConnectionStatus(connectionStatusKey, statusEl?.dataset.state);
  syncWorkflow();
  renderPatchApproval();
  applyRemovalConfirmCopy();
  renderChatGPTAuth();
  if (requestStatusKey) requestStatusEl.textContent = t(requestStatusKey, requestStatusVars);
  if (lastProviderStatus) renderProviderStatus(lastProviderStatus);
  if (inspectionState.result) renderInspection(inspectionState.result);
});
window.chatpcbI18n?.ready?.then(() => {
  i18nReady = true;
  setConnectionStatus(connectionStatusKey, statusEl?.dataset.state);
  applyRemovalConfirmCopy();
  renderChatGPTAuth();
});

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
document.querySelector('#pro-mode')?.addEventListener('click', () => {
  const control = document.querySelector('#pro-mode');
  if (control?.getAttribute('role') !== 'switch') return;
  const checked = control.getAttribute('aria-checked') === 'true';
  control.setAttribute('aria-checked', checked ? 'false' : 'true');
});
providerEl.addEventListener('change', () => {
  rememberProvider(providerEl.value);
  refreshProviderStatus();
  updateChatGPTAuthVisibility();
  syncChatGPTSwitchOffer();
});
chatgptSwitchOfferAcceptEl?.addEventListener('click', acceptChatGPTSwitchOffer);
chatgptSwitchOfferDismissEl?.addEventListener('click', dismissChatGPTSwitchOffer);
openKiCadButtonEl.addEventListener('click', openInKiCad);
recheckKiCadButtonEl.addEventListener('click', () => refreshHostProjectStatus());
approvePatchButtonEl.addEventListener('click', approvePatch);
approveWithoutErcButtonEl?.addEventListener('click', revealApplyWithoutErcConfirm);
confirmApplyWithoutErcButtonEl?.addEventListener('click', approvePatchWithoutErc);
cancelApplyWithoutErcButtonEl?.addEventListener('click', cancelApplyWithoutErcConfirm);
cancelApplyRemoveButtonEl?.addEventListener('click', cancelRemovalConfirm);
confirmApplyRemoveButtonEl?.addEventListener('click', confirmRemovalApply);
cancelPatchButtonEl.addEventListener('click', cancelPatch);
fixPatchButtonEl?.addEventListener('click', askChatpcbToFixErc);
for (const button of document.querySelectorAll('.dock-btn[data-open]')) {
  button.addEventListener('click', () => {
    const dialog = document.getElementById(button.dataset.open);
    if (typeof dialog?.showModal === 'function') dialog.showModal();
    setToolsMenuOpen(false);
  });
}
document.querySelector('#tools-menu-button')?.addEventListener('click', () => {
  const button = document.querySelector('#tools-menu-button');
  setToolsMenuOpen(button?.getAttribute('aria-expanded') !== 'true');
});
document.addEventListener('click', (event) => {
  const menu = document.querySelector('#tools-menu');
  if (!menu || menu.hidden) return;
  if (event.target instanceof Element && event.target.closest('#tools-menu, #tools-menu-button')) return;
  setToolsMenuOpen(false);
});
document.addEventListener('keydown', (event) => {
  if (applyRemoveConfirmEl && !applyRemoveConfirmEl.hidden) {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelRemovalConfirm();
      return;
    }
    if (event.key !== 'Tab') return;
    const buttons = [cancelApplyRemoveButtonEl, confirmApplyRemoveButtonEl].filter((button) => button);
    if (buttons.length === 0) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement);
    const direction = event.shiftKey ? -1 : 1;
    const next = index < 0
      ? (event.shiftKey ? buttons[buttons.length - 1] : buttons[0])
      : buttons[(index + direction + buttons.length) % buttons.length];
    next.focus();
    return;
  }
  if (event.key !== 'Escape') return;
  if (applyWithoutErcConfirmEl && !applyWithoutErcConfirmEl.hidden) {
    event.preventDefault();
    cancelApplyWithoutErcConfirm();
    return;
  }
  if (chatgptAuthState.state === 'waiting') {
    event.preventDefault();
    cancelChatGPTSignIn();
    return;
  }
  const menu = document.querySelector('#tools-menu');
  if (!menu || menu.hidden) return;
  setToolsMenuOpen(false);
  document.querySelector('#tools-menu-button')?.focus();
});
for (const button of document.querySelectorAll('.flow-btn')) {
  button.addEventListener('click', () => {
    if (button.getAttribute('aria-disabled') === 'true' || button.dataset.state === 'locked') {
      const reason = document.getElementById(button.getAttribute('aria-describedby') || '');
      if (reason) {
        reason.hidden = false;
        reason.focus();
      }
      return;
    }
    const dialog = document.getElementById(button.dataset.open);
    if (typeof dialog?.showModal === 'function') dialog.showModal();
  });
}
for (const row of document.querySelectorAll('.lane-row')) {
  row.addEventListener('click', () => {
    const laneId = row.closest('.workflow-lane')?.dataset.lane;
    if (!laneId) return;
    if (row.getAttribute('aria-disabled') === 'true') {
      const reason = document.getElementById(row.getAttribute('aria-describedby') || '');
      if (reason) {
        reason.hidden = false;
        reason.focus();
      }
      return;
    }
    laneOpen.set(laneId, row.getAttribute('aria-expanded') !== 'true');
    syncWorkflow();
  });
}
window.addEventListener('message', (event) => handleHostMessage(event.data));
window.addEventListener('focus', () => refreshHostProjectStatus());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshHostProjectStatus();
});

function applyHostQueries() {
  const params = new URLSearchParams(location.search);
  const theme = params.get('theme');
  if ((theme === 'light' || theme === 'dark') && !document.documentElement.dataset.theme) {
    document.documentElement.dataset.theme = theme;
  }
  const auth = params.get('auth');
  if (auth === 'signedin' || auth === 'in' || auth === 'true') setChatGptAuthState({ signedIn: true });
  else if (auth === 'signedout' || auth === 'out' || auth === 'false') setChatGptAuthState({ signedIn: false });
}

function setChatGptShell(el, visible) {
  if (!el) return;
  const show = chatGptUiEnabled && visible;
  el.hidden = !show;
  if (show) el.removeAttribute('inert');
  else el.setAttribute('inert', '');
}

function setChatGptAuthState(state = {}) {
  if (state?.signedIn === true || state?.signedIn === false) chatGptSignedIn = state.signedIn;
  const card = document.querySelector('#chatgpt-signin');
  const plan = document.querySelector('#chatgpt-plan');
  // Sign-in and plan stay out of the tab order until ChatGPT auth is wired up.
  setChatGptShell(card, chatGptSignedIn === false);
  setChatGptShell(plan, chatGptSignedIn === true);
}

function setConnectionStatus(key, state) {
  connectionStatusKey = key;
  if (statusEl) {
    statusEl.dataset.i18n = key;
    statusEl.dataset.role = 'daemon';
    statusEl.classList.add('daemon-connection');
    const label = t(key);
    if (label !== key) statusEl.textContent = label;
    const titleKey = DAEMON_TITLE_KEYS[key];
    const title = titleKey ? t(titleKey) : '';
    if (title && title !== titleKey) statusEl.title = title;
  }
  if (statusEl && state !== undefined) {
    if (state) statusEl.dataset.state = state;
    else delete statusEl.dataset.state;
  }
}

function connect() {
  socket = new WebSocket(DAEMON_WS_URL);
  window.__daemonSocket = socket;
  socket.addEventListener('open', () => {
    setConnectionStatus('connection.connected', 'ok');
    clearPatchApproval();
    refreshProviderStatus();
    refreshChatGPTAuthStatus();
    if (providerEl?.value !== 'chatgpt' && chatgptAuthCardEl) chatgptAuthCardEl.hidden = true;
    inspectActiveProject();
  });
  socket.addEventListener('message', (event) => handleEnvelope(JSON.parse(event.data)));
  socket.addEventListener('close', () => {
    setConnectionStatus('connection.disconnected', 'warn');
    setTimeout(connect, 1500);
  });
  socket.addEventListener('error', () => {
    setConnectionStatus('connection.error', 'warn');
  });
}

function createProject() {
  const workspaceRoot = workspaceRootEl.value.trim();
  const projectName = projectNameEl.value.trim();
  if (!workspaceRoot || !projectName) return;

  renderRequestStatus({ state: 'running', summaryKey: 'request.creating' });
  const id = `project_create_${Date.now()}`;
  activeProjectCreateId = id;
  pendingCalls.set(id, 'project.create');
  sendToolCall({ id, name: 'project.create', args: { workspaceRoot, projectName } });
}

async function sendProjectRequest() {
  if (!activeProject) {
    renderRequestStatus({ state: 'failed', summaryKey: 'request.need-project' });
    return;
  }
  const prompt = promptEl.value.trim();
  if (!prompt) {
    renderRequestStatus({ state: 'failed', summaryKey: 'request.prompt-required' });
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
    renderRequestStatus({ state: 'failed', summaryKey: 'request.kicad-unavailable' });
    setRequestBusy(false);
    return;
  }
  if (status?.dirty && status.linkState !== 'unlinked') {
    renderRequestStatus({ state: 'failed', summaryKey: 'request.kicad-dirty' });
    showConflict();
    setRequestBusy(false);
    return;
  }

  hideConflict();
  lastProgressStage = 'conversation';
  lastProgressText = t('progress.sent');
  renderRequestStatus({ state: 'running', summaryKey: 'request.running' });
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
      proMode: document.querySelector('#pro-mode')?.getAttribute('aria-checked') === 'true'
    }
  });
}

function refreshProviderStatus() {
  const id = `provider_status_${Date.now()}`;
  pendingCalls.set(id, 'provider.status');
  sendToolCall({ id, name: 'provider.status', args: { provider: providerEl.value } });
}

function refreshProviderStatusForAuth(previous, next) {
  if (next !== 'signed_in' && next !== 'signed_out') return;
  if (previous === next) return;
  refreshProviderStatus();
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
    renderRequestStatus({ state: 'failed', summaryKey: 'request.failed', technicalDetail: t('request.daemon-offline') });
    if (payload.name === 'project.request') setRequestBusy(false);
  }
}

function handleEnvelope(envelope) {
  if (envelope.type === 'agent.delta') {
    handleProgressDelta(envelope.payload);
    return;
  }
  if (envelope.type === 'auth.chatgpt.changed') {
    handleChatGPTAuthChanged(envelope.payload);
    return;
  }
  if (envelope.type !== 'tool.result') return;
  const id = envelope.payload.id;
  const callName = pendingCalls.get(id) ?? (activeRequestId ? 'project.request' : activeProjectCreateId ? 'project.create' : undefined);
  pendingCalls.delete(id);

  if (callName === 'auth.chatgpt.reopen') {
    applyChatGPTReopenResult(envelope.payload);
    return;
  }

  if (!envelope.payload.ok && envelope.payload.error?.code === 'PROJECT_BUSY' && isProjectBusyCall(callName)) {
    showProjectBusy(callName, envelope.payload.error?.message);
    return;
  }

  if (!envelope.payload.ok) {
    if (callName === 'schematic.generate') {
      setRequestBusy(false);
      appendProgress({ stage: 'fail', text: envelope.payload.error?.message ?? t('request.tool-failed') });
      renderRequestStatus({
        state: 'failed',
        summaryKey: 'request.failed',
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
      const errorCode = envelope.payload.error?.code;
      const errorMessage = envelope.payload.error?.message ?? 'Tool call failed.';
      const technicalDetail = envelope.payload.technicalDetail ?? errorMessage;

      appendProgress({ stage: 'fail', text: errorMessage });

      if (errorCode === 'PROVIDER_DISALLOWED_TOOL') {
        renderRequestStatus({
          state: 'failed',
          summary: errorMessage,
          technicalDetail
        });
      } else {
        renderRequestStatus({
          state: 'failed',
          summaryKey: 'request.failed',
          technicalDetail
        });
      }
    }
    if (callName === 'project.inspect') {
      if (inspectionState.requestId === id) renderInspectionFailure();
      return;
    }
    if (callName === 'schematic.patch.approve' || callName === 'schematic.patch.cancel') {
      const code = envelope.payload.error?.code;
      if (callName === 'schematic.patch.approve' && notePatchRejection(code)) {
        renderRequestStatus({ state: 'failed', summaryKey: 'patch.unverified.body' });
        renderPatchApproval();
        return;
      }
      clearPatchApproval();
      renderRequestStatus({ state: 'failed', summaryKey: 'request.patch-failed', technicalDetail: envelope.payload.error?.message ?? t('request.patch-tool-failed') });
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
    const result = envelope.payload.result ?? {};
    if (result.applied === false && notePatchRejection(result.reason?.code)) {
      if (result.validation && lastRequestResult) {
        lastRequestResult = {
          ...lastRequestResult,
          validation: result.validation,
          candidateVerification: result.candidateVerification ?? lastRequestResult.candidateVerification ?? null
        };
      }
      renderRequestStatus({ state: 'failed', summaryKey: 'patch.unverified.body' });
      renderPatchApproval();
      return;
    }
    const removedRefs = (patchApprovalState.removedComponents ?? []).map((part) => part.ref);
    const succeeded = result.applied !== false;
    clearPatchApproval();
    renderProjectRequest({
      ...result,
      operation: result.operation || (succeeded ? 'patched' : result.operation),
      applied: result.applied === undefined ? true : result.applied,
      fromPatchApprove: succeeded,
      removedRefs: succeeded ? removedRefs : []
    });
    inspectActiveProject();
    return;
  }
  if (callName === 'schematic.patch.cancel') return;
  if (callName === 'provider.status') {
    const provider = envelope.payload.result;
    renderProviderStatus(provider);
    if (provider?.provider === 'chatgpt' && (provider.status === 'signed-in' || provider.status === 'signed-out')) {
      const next = provider.status === 'signed-in' ? 'signed_in' : 'signed_out';
      if (chatgptAuthState.state !== 'waiting') {
        chatgptAuthState = {
          ...chatgptAuthState,
          state: next,
          account: provider.account ?? chatgptAuthState.account,
          plan: provider.plan ?? chatgptAuthState.plan
        };
        chatgptAuthKnown = true;
        renderChatGPTAuth();
      }
    }
    return;
  }
  if (callName === 'auth.chatgpt.status') {
    applyChatGPTAuthStatus(envelope.payload.result || {});
    return;
  }
  if (callName === 'auth.chatgpt.start') {
    const result = envelope.payload.result || {};
    chatgptAuthState = {
      ...chatgptAuthState,
      state: result.state || 'waiting',
      attemptId: result.attemptId,
      authUrl: result.authUrl,
      expiresAt: result.expiresAt,
      code: undefined
    };
    chatgptAuthKnown = true;
    renderChatGPTAuth();
    if (chatgptAuthState.state === 'waiting') startChatGPTAuthPolling();
    else stopChatGPTAuthPolling();
    return;
  }
  if (callName === 'auth.chatgpt.cancel' || callName === 'auth.chatgpt.signOut') {
    stopChatGPTAuthPolling();
    chatgptAuthState = { state: 'signed_out' };
    chatgptAuthKnown = true;
    renderChatGPTAuth();
    if (callName === 'auth.chatgpt.signOut') {
      updateLiveRegion({ state: 'signed_out' });
      refreshProviderStatus();
    }
  }
}

function renderProviderStatus(provider) {
  if (!providerStatusEl || !provider) return;
  lastProviderStatus = provider;
  providerStatusEl.removeAttribute('data-i18n');
  const vars = {};
  if (provider.plan) vars.plan = provider.plan;
  if (provider.account?.email) vars.email = provider.account.email;
  const text = t(`provider.status.${provider.provider}.${provider.status}`, vars);
  if (text.startsWith('provider.status.')) {
    providerStatusEl.textContent = t('provider.status.fallback');
  } else if (provider.status === 'missing') {
    const next = t('provider.status.missing.next');
    providerStatusEl.textContent = next.startsWith('provider.status.') ? text : [text, next].join(' ');
  } else {
    providerStatusEl.textContent = text;
  }
  if (provider.status) providerStatusEl.dataset.status = provider.status;
  else delete providerStatusEl.dataset.status;
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
  renderRequestStatus({ state: 'ready', summaryKey: 'request.project-ready' });
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
  reviewStatusEl.dataset.i18n = 'review.pending';
  reviewStatusEl.textContent = t('review.pending');
  delete reviewStatusEl.dataset.status;
  for (const list of [reviewBlockersEl, reviewWarningsEl, reviewNotesEl, reviewFixesEl]) list.replaceChildren();
  validationStatusEl.dataset.state = 'idle';
  validationStatusEl.dataset.i18n = 'validation.idle';
  validationStatusEl.textContent = t('validation.idle');
  validationTimestampEl.replaceChildren();
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
  kiCadLinkEl.replaceChildren();
  kiCadFallbackEl.hidden = true;
  kiCadFallbackEl.replaceChildren();
  lastRequestResult = null;
  lastProgressStage = null;
  lastProgressText = '';
  lastWorkflowActive = 'circuit.concept';
  workflowFlags = { circuitApplied: false, circuitReviewed: false, layoutReviewed: false };
  syncWorkflow();
}

function scrollConversationToLatest() {
  if (!conversationLogEl) return;
  conversationLogEl.scrollTop = conversationLogEl.scrollHeight;
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
          reason.textContent = t('spec.reason', { reason: row.reason });
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
  // scrollIntoView would move the page and push the approval card below the fold.
  scrollConversationToLatest();
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
    renderRequestStatus(result.nextQuestion
      ? { state: 'ready', summary: result.nextQuestion }
      : { state: 'ready', summaryKey: 'request.clarify-fallback' });
    return;
  }
  // A removal preview is not an approval yet. Apply stays closed until the dialog confirms these refs.
  if (existingComponentsRemoved(result) && result.patchId) {
    setPatchApproval(result);
    appendProgress({ stage: 'warn', text: t('patch.remove.lead') });
    renderRequestStatus({ state: 'ready', summary: t('patch.remove.lead') });
    renderReview(result.review);
    renderArtifacts(result.files);
    renderValidation({ ...result.validation, completedAt: new Date().toISOString() });
    presentRemovalConfirm();
    return;
  }
  if (result?.requiresApproval && result.patchId) {
    setPatchApproval(result);
    appendProgress({ stage: 'ready', text: t('request.preview-done') });
    renderRequestStatus({ state: 'ready', summaryKey: 'request.preview-ready' });
    renderReview(result.review);
    renderArtifacts(result.files);
    renderValidation({ ...result.validation, completedAt: new Date().toISOString() });
    return;
  }
  renderReview(result.review);
  renderArtifacts(result.files);
  renderValidation({ ...result.validation, completedAt: new Date().toISOString() });
  // A skipped candidate keeps validation.ok false. Once the daemon applied it, the request succeeded.
  const validationFailed = result.applied !== true && result.validation?.ok === false;
  const requestFailed = result.rolledBack || validationFailed;
  const completedDetail = result.operation === 'patched' ? t('request.completed-updated') : t('request.completed-generated');
  const removedRefs = Array.isArray(result.removedRefs)
    ? result.removedRefs.filter((ref) => typeof ref === 'string' && ref.length > 0)
    : [];
  let summaryKey = 'request.completed';
  let summaryVars = { detail: completedDetail };
  if (!requestFailed && result.fromPatchApprove === true) {
    if (removedRefs.length > 0) {
      summaryKey = 'patch.apply.done';
      summaryVars = { refs: removedRefs.join(', ') };
    } else {
      summaryKey = 'patch.apply.applied';
      summaryVars = undefined;
    }
  }
  const summary = result.rolledBack
    ? t('request.rollback')
    : validationFailed
      ? t('request.validation-failed')
      : t(summaryKey, summaryVars);
  if (!result.rolledBack) workflowFlags.circuitApplied = true;
  if (!requestFailed && result.review?.status && result.review.status !== 'blocked' && result.review.status !== 'needs-input') {
    workflowFlags.circuitReviewed = true;
  }
  renderRequestStatus(result.rolledBack
    ? { state: 'failed', summaryKey: 'request.rollback' }
    : validationFailed
      ? { state: 'failed', summaryKey: 'request.validation-failed' }
      : { state: 'completed', summaryKey, summaryVars });
  appendProgress({ stage: requestFailed ? 'fail' : 'done', text: summary });

  const projectFile = findProjectFile(result.files);
  const successfulUpdate = result.applied === true || (!result.rolledBack && result.validation?.ok !== false);
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

const FRESHNESS_CODES = {
  NO_MANIFEST: 'no-manifest',
  LEGACY_SCHEMA: 'legacy',
  NO_DIGEST: 'no-digest',
  DIGEST_MISMATCH: 'mismatch',
  MATCH: 'match',
  INSPECTION_UNAVAILABLE: 'unavailable'
};

const FRESHNESS_REASONS = {
  'No ChatPCB manifest exists.': 'no-manifest',
  'Schema version 1 has no artifact-bound evidence.': 'legacy',
  'Schema version 2 has no project digest.': 'no-digest',
  'Evidence matches the saved project artifacts.': 'match',
  'Evidence matches.': 'match',
  'Inspection was unavailable.': 'unavailable',
  'Legacy evidence.': 'legacy',
  'Evidence no longer matches.': 'mismatch',
  'No manifest yet.': 'no-manifest'
};

function freshnessTitleKey(freshness) {
  const fromCode = FRESHNESS_CODES[freshness?.code];
  if (fromCode) return fromCode;
  const reason = typeof freshness?.reason === 'string' ? freshness.reason : '';
  if (FRESHNESS_REASONS[reason]) return FRESHNESS_REASONS[reason];
  if (reason.startsWith('Evidence digest ')) return 'mismatch';
  if (freshness?.status === 'stale') return 'mismatch';
  if (freshness?.status === 'current') return 'match';
  if (freshness?.status === 'legacy-unverified') return 'legacy';
  if (freshness?.status === 'missing') return 'no-manifest';
  return 'unknown';
}

function freshnessTitle(freshness) {
  const text = t(`inspection.freshness.${freshnessTitleKey(freshness)}`);
  return text.startsWith('inspection.freshness.') ? t('inspection.freshness.unknown') : text;
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
  inspectionDigestEl.removeAttribute('data-i18n');
  inspectionArtifactCountEl.removeAttribute('data-i18n');
  inspectionErcEl.removeAttribute('data-i18n');
  inspectionDrcEl.removeAttribute('data-i18n');
  inspectionFreshnessEl.title = freshnessTitle(freshness);
  inspectionDigestEl.textContent = typeof digest === 'string' ? digest.slice(0, 12) : t('inspection.empty');
  inspectionArtifactCountEl.textContent = t('inspection.artifacts', { count: Number.isInteger(artifactCount) ? artifactCount : 0 });
  inspectionErcEl.textContent = renderInspectionValidation('ERC', erc);
  inspectionDrcEl.textContent = renderInspectionValidation('DRC', drc);
  inspectionState.result = result;
  renderPatchApproval();
}

function renderInspectionFailure() {
  inspectionCardEl.hidden = false;
  renderInspection({ manifest: { freshness: { status: 'missing', code: 'INSPECTION_UNAVAILABLE', reason: 'Inspection was unavailable.' } } });
}

function renderInspectionValidation(label, result) {
  if (!result) return t('inspection.dash', { label });
  const reason = result.reason;
  const message = reason?.message ?? t('inspection.no-reason');
  if (result.skipped) {
    return t('inspection.erc-skipped', { label, code: reason?.code ?? 'UNKNOWN', message });
  }
  if (result.ok === false && reason) {
    return t('inspection.erc-failed', { label, code: reason.code ?? 'UNKNOWN', message: reason.message ?? t('inspection.no-reason') });
  }
  const summary = label === 'ERC' ? result.erc ?? result : result.drc ?? result;
  return label === 'ERC'
    ? t('inspection.erc-counts', { errors: summary.errorCount ?? 0, warnings: summary.warningCount ?? 0 })
    : t('inspection.drc-counts', { violations: summary.violationCount ?? 0, unconnected: summary.unconnectedCount ?? 0 });
}

function setPatchApproval(preview) {
  clearPatchApproval();
  patchApprovalState = {
    patchId: preview.patchId,
    expiresAt: preview.expiresAt,
    timeout: null,
    removedComponents: existingComponentsRemoved(preview)
  };
  if (patchApprovalCardEl) patchApprovalCardEl.hidden = false;
  const delay = Number(preview.expiresAt) - Date.now();
  if (Number.isFinite(delay) && delay > 0) {
    patchApprovalState.timeout = setTimeout(() => {
      clearPatchApproval('patch.expired');
    }, delay);
  }
  renderPatchApproval();
  renderDraftEvidence(preview);
}

function clearPatchApproval(messageKey = 'patch.idle') {
  if (patchApprovalState.timeout) clearTimeout(patchApprovalState.timeout);
  patchApprovalState = { patchId: null, expiresAt: null, timeout: null, removedComponents: null };
  patchRejectionCode = null;
  fixPatchButtonEl?.classList.remove('btn-primary');
  document.querySelector('#patch-erc-details')?.remove();
  if (patchApprovalStatusEl) patchApprovalStatusEl.hidden = false;
  setPatchTitle('patch.title');
  patchApprovalStatusEl.dataset.state = 'idle';
  setPatchStatus(messageKey);
  clearDraftEvidence();
  setPatchApprovalTechnicalDetail('');
  hideRemovalConfirm();
  if (applyRemovePartsEl) applyRemovePartsEl.replaceChildren();
  approvePatchButtonEl.disabled = true;
  approvePatchButtonEl.removeAttribute('aria-disabled');
  approvePatchButtonEl.removeAttribute('aria-describedby');
  if (approveWithoutErcButtonEl) {
    approveWithoutErcButtonEl.hidden = true;
    approveWithoutErcButtonEl.disabled = true;
  }
  hideApplyWithoutErcConfirm();
  cancelPatchButtonEl.disabled = true;
  if (applyWhyEl) {
    applyWhyEl.hidden = true;
    applyWhyEl.replaceChildren();
  }
  if (patchErcEl) {
    patchErcEl.hidden = true;
    patchErcEl.removeAttribute('role');
    patchErcEl.replaceChildren();
  }
  if (patchApprovalCardEl) patchApprovalCardEl.hidden = messageKey === 'patch.idle';
}

function setPatchStatus(key) {
  patchApprovalStatusEl.dataset.i18n = key;
  patchApprovalStatusEl.textContent = t(key);
}

function ercMessagesFrom(source) {
  if (!source || typeof source !== 'object') return [];
  const messages = [];
  for (const list of [source.errors, source.violations, source.messages]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (typeof item === 'string' && item.trim()) {
        messages.push(item.trim());
        continue;
      }
      if (!item || typeof item !== 'object') continue;
      if (item.severity && item.severity !== 'error') continue;
      const text = item.message || item.description || item.text;
      if (typeof text === 'string' && text.trim()) messages.push(text.trim());
    }
  }
  return messages;
}

function collectErcMessages(source) {
  if (!source || typeof source !== 'object') return [];
  const erc = source.erc && typeof source.erc === 'object' ? source.erc : null;
  const nested = erc?.erc && typeof erc.erc === 'object' ? erc.erc : null;
  const messages = [...ercMessagesFrom(nested), ...ercMessagesFrom(erc), ...ercMessagesFrom(source)];
  if (messages.length === 0) {
    const reason = source.reason?.message || erc?.reason?.message || nested?.reason?.message;
    if (typeof reason === 'string' && reason.trim()) messages.push(reason.trim());
  }
  return [...new Set(messages)];
}

function ercSourceHasSignal(source) {
  if (!source || typeof source !== 'object') return false;
  if (source.passed === true || source.skipped === true || source.ok === true || source.ok === false) return true;
  if (typeof source.status === 'string') return true;
  if (source.erc && typeof source.erc === 'object') return true;
  return Number(source.errorCount) > 0;
}

// Apply follows only the candidate patch: candidateVerification.erc, or the
// preview validation when that is the recorded candidate result. The open
// file's inspection ERC must not block a patch that fixes those errors.
// A result from a different patchId is ignored, so a stale pass cannot open Apply.
function candidateErcStale() {
  const expected = patchApprovalState.patchId;
  const result = lastRequestResult;
  if (!expected || !result || typeof result !== 'object') return false;
  const verification = result.candidateVerification;
  const erc = verification && typeof verification === 'object' ? verification.erc : null;
  return [result.patchId, verification?.patchId, erc?.patchId]
    .some((id) => typeof id === 'string' && id.length > 0 && id !== expected);
}

function candidateErcSource() {
  const result = lastRequestResult;
  if (!result || result.patchId !== patchApprovalState.patchId || candidateErcStale()) return null;
  const requestErc = result.candidateVerification?.erc;
  if (ercSourceHasSignal(requestErc)) return requestErc;
  const requestValidation = result.validation;
  if (ercSourceHasSignal(requestValidation)) return requestValidation;
  return null;
}

function applyBlockedReason(erc) {
  if (patchRejectionCode) return { key: 'patch.unverified.body', text: t('patch.unverified.body') };
  if (candidateErcStale()) return { key: 'patch.apply.blocked-stale', text: t('patch.apply.blocked-stale') };
  if (erc.failed) return { key: 'patch.apply.blocked-erc', text: t('patch.apply.blocked-erc', { count: erc.count }) };
  if (erc.skipped) return { key: 'patch.apply.skipped', text: t('patch.apply.skipped') };
  return { key: 'patch.apply.blocked-missing', text: t('patch.apply.blocked-missing') };
}

let warnedApplyBlockKey = null;

function warnApplyBlock(key) {
  const logged = key === 'patch.apply.blocked-stale' || key === 'patch.apply.blocked-missing';
  if (!logged) {
    warnedApplyBlockKey = null;
    return;
  }
  if (warnedApplyBlockKey === key) return;
  warnedApplyBlockKey = key;
  console.warn(key);
}

function inspectionErcSource() {
  const inspection = inspectionState.result?.validation;
  if (!inspection || typeof inspection !== 'object') return null;
  if (ercSourceHasSignal(inspection.erc)) return inspection.erc;
  if (ercSourceHasSignal(inspection)) return inspection;
  return null;
}

function classifyPanelErc(source) {
  const verdict = globalThis.chatpcbErcVerdict(source);
  const messages = verdict.failed || verdict.skipped ? collectErcMessages(source) : [];
  return {
    passed: verdict.passed === true,
    skipped: verdict.skipped === true,
    failed: verdict.failed === true,
    missing: verdict.missing === true,
    count: verdict.errorCount,
    messages
  };
}

function ercBlockState() {
  return classifyPanelErc(candidateErcSource());
}

function renderCurrentFileErc(candidate, active) {
  const info = document.querySelector('#patch-erc-info');
  if (!info) return;
  const current = classifyPanelErc(inspectionErcSource());
  const show = Boolean(active) && candidate?.passed === true && current.failed === true;
  info.hidden = !show;
  info.removeAttribute('role');
  if (!show) {
    info.replaceChildren();
    return;
  }
  const summary = document.createElement('p');
  summary.textContent = t('erc.current-file', { count: current.count });
  info.replaceChildren(summary);
  if (!current.messages.length) return;
  const list = document.createElement('ul');
  for (const message of current.messages) {
    const item = document.createElement('li');
    item.textContent = localizeDaemonText(message);
    list.append(item);
  }
  info.append(list);
}

function notePatchRejection(code) {
  if (code !== 'PATCH_CANDIDATE_UNVERIFIED' && code !== 'ERC_BLOCKED') return false;
  patchRejectionCode = code;
  return true;
}

function setPatchTitle(key) {
  if (!patchApprovalTitleEl) return;
  patchApprovalTitleEl.dataset.i18n = key;
  patchApprovalTitleEl.textContent = t(key);
}

function revealErcDetails() {
  const erc = ercBlockState();
  const message = erc.messages.length ? erc.messages.join('\n') : t('patch.unverified.body');
  renderValidation({
    ok: false,
    skipped: erc.skipped === true,
    erc: { errorCount: erc.count, warningCount: 0, ok: false },
    reason: { message }
  });
  const dialog = document.getElementById('erc-dialog');
  if (typeof dialog?.showModal === 'function' && !dialog.open) dialog.showModal();
}

function placeErcDetailsButton(parent) {
  if (!parent) return;
  let button = document.querySelector('#patch-erc-details');
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.id = 'patch-erc-details';
    button.className = 'erc-details';
    button.setAttribute('aria-controls', 'erc-dialog');
    button.addEventListener('click', revealErcDetails);
  }
  button.textContent = t('patch.erc-details');
  parent.append(button);
}

function renderErcBox(erc, active) {
  if (!patchErcEl) return;
  if (patchRejectionCode && !erc?.failed) {
    patchErcEl.hidden = true;
    patchErcEl.removeAttribute('role');
    patchErcEl.replaceChildren();
    return;
  }
  if (!active || !erc || (!erc.failed && !erc.passed && !erc.skipped)) {
    patchErcEl.hidden = true;
    patchErcEl.removeAttribute('role');
    patchErcEl.replaceChildren();
    return;
  }
  patchErcEl.hidden = false;
  patchErcEl.classList.toggle('erc-pass', erc.passed === true);
  patchErcEl.classList.toggle('erc-skip', erc.skipped === true);
  patchErcEl.replaceChildren();
  const head = document.createElement('div');
  head.className = 'erc-h';
  const title = document.createElement('span');
  title.textContent = t('erc.title');
  const summary = document.createElement('span');
  summary.textContent = erc.failed
    ? t('erc.errors', { count: erc.count })
    : erc.skipped
      ? t('erc.skipped')
      : t('erc.passed');
  head.append(title, summary);
  if (erc.failed) placeErcDetailsButton(head);
  patchErcEl.append(head);
  if (!erc.failed) {
    patchErcEl.removeAttribute('role');
    return;
  }
  patchErcEl.setAttribute('role', 'alert');
  const list = document.createElement('ul');
  const items = erc.messages.length ? erc.messages : [t('patch.apply.blocked-erc', { count: erc.count })];
  for (const message of items) {
    const item = document.createElement('li');
    item.textContent = localizeDaemonText(message);
    list.append(item);
  }
  patchErcEl.append(list);
}

function renderPatchApproval() {
  const freshness = inspectionState.result?.manifest?.freshness?.status;
  const approvedEvidence = freshness === 'current' || freshness === 'legacy-unverified' || freshness === 'missing';
  const unexpired = Number.isFinite(Number(patchApprovalState.expiresAt)) && Number(patchApprovalState.expiresAt) > Date.now();
  const active = Boolean(patchApprovalState.patchId) && unexpired;
  const erc = ercBlockState();
  const evidenceBlocked = !active || !approvedEvidence;
  const canApply = active && !evidenceBlocked && erc.passed === true && !patchRejectionCode;
  const canOverride = active && !evidenceBlocked && erc.skipped === true && !erc.failed && !erc.passed;
  approvePatchButtonEl.disabled = evidenceBlocked;
  cancelPatchButtonEl.disabled = !active;
  if (patchApprovalCardEl) patchApprovalCardEl.hidden = !active;
  if (approveWithoutErcButtonEl) {
    approveWithoutErcButtonEl.hidden = !canOverride;
    approveWithoutErcButtonEl.disabled = !canOverride;
  }
  hideApplyWithoutErcConfirm();
  if (active && !evidenceBlocked && !canApply) {
    const blocked = applyBlockedReason(erc);
    approvePatchButtonEl.setAttribute('aria-disabled', 'true');
    approvePatchButtonEl.setAttribute('aria-describedby', 'apply-why');
    if (applyWhyEl) {
      applyWhyEl.hidden = false;
      applyWhyEl.dataset.reason = blocked.key;
      applyWhyEl.textContent = blocked.text;
    }
    warnApplyBlock(blocked.key);
  } else {
    approvePatchButtonEl.removeAttribute('aria-disabled');
    approvePatchButtonEl.removeAttribute('aria-describedby');
    if (applyWhyEl) {
      applyWhyEl.hidden = true;
      applyWhyEl.removeAttribute('data-reason');
      applyWhyEl.replaceChildren();
    }
    warnApplyBlock(null);
  }
  renderErcBox(erc, active);
  renderCurrentFileErc(erc, active);
  const showDetails = Boolean(active) && (erc.failed || patchRejectionCode != null);
  if (showDetails && !document.querySelector('#patch-erc-details')) {
    placeErcDetailsButton(document.querySelector('.patch-approval-actions'));
  }
  if (!showDetails) document.querySelector('#patch-erc-details')?.remove();
  fixPatchButtonEl?.classList.toggle('btn-primary', showDetails && (erc.failed || patchRejectionCode != null));
  scrollConversationToLatest();
  setPatchApprovalTechnicalDetail('');
  if (freshness === 'stale' && patchApprovalState.patchId) {
    if (patchApprovalCardEl) patchApprovalCardEl.hidden = false;
    patchApprovalStatusEl.hidden = false;
    patchApprovalStatusEl.dataset.state = 'stale';
    setPatchTitle('patch.title');
    setPatchStatus('patch.stale');
    return;
  }
  if (!active) return;
  if (freshness === 'legacy-unverified') {
    patchApprovalStatusEl.hidden = false;
    patchApprovalStatusEl.dataset.state = 'warning';
    setPatchTitle('patch.title');
    setPatchStatus('patch.legacy');
    return;
  }
  if (freshness === 'missing' || !freshness) {
    patchApprovalStatusEl.hidden = false;
    patchApprovalStatusEl.dataset.state = 'warning';
    setPatchTitle('patch.title');
    showMissingManifestCopy();
    return;
  }
  if (patchRejectionCode) {
    patchApprovalStatusEl.hidden = false;
    patchApprovalStatusEl.dataset.state = 'blocked';
    setPatchTitle('patch.unverified.title');
    setPatchStatus('patch.unverified.body');
    return;
  }
  if (!erc.passed) {
    patchApprovalStatusEl.dataset.state = 'blocked';
    setPatchTitle('patch.title');
    if (erc.failed) {
      // The ERC alert and apply reason already say why. Do not call this ready.
      patchApprovalStatusEl.hidden = true;
      setPatchStatus('patch.blocked');
      return;
    }
    if (erc.skipped) {
      // apply-why already says ERC was skipped. Keep that sentence once.
      patchApprovalStatusEl.hidden = true;
      setPatchStatus('patch.apply.skipped');
      return;
    }
    patchApprovalStatusEl.hidden = false;
    setPatchStatus(candidateErcStale() ? 'patch.apply.blocked-stale' : 'patch.apply.blocked-missing');
    return;
  }
  patchApprovalStatusEl.hidden = false;
  patchApprovalStatusEl.dataset.state = 'ready';
  setPatchTitle('patch.title');
  setPatchStatus('patch.ready');
}

function askChatpcbToFixErc() {
  if (!promptEl) return;
  const erc = ercBlockState();
  const detail = erc.messages.length
    ? erc.messages.join('\n')
    : t('patch.apply.blocked-erc', { count: erc.count });
  promptEl.value = `${t('patch.fix')}\n${detail}`;
  if (!promptEl.disabled) promptEl.focus();
}

function confirmRemovalApply() {
  if (!applyRemoveConfirmEl || applyRemoveConfirmEl.hidden) return;
  if (patchApplyBusy()) return;
  if (!applyGateOpen()) {
    dismissRemovalConfirmForClosedGate();
    return;
  }
  const allowRemovedComponents = (patchApprovalState.removedComponents ?? []).map((part) => part.ref);
  if (allowRemovedComponents.length === 0) return;
  hideRemovalConfirm();
  appendProgress({ stage: 'apply', text: t('patch.apply.progress') });
  renderRequestStatus({ state: 'running', summaryKey: 'patch.apply.summary' });
  const id = `patch_approve_${Date.now()}`;
  pendingCalls.set(id, 'schematic.patch.approve');
  sendToolCall({
    id,
    name: 'schematic.patch',
    args: {
      projectDir: activeProject.projectDir,
      approved: true,
      patchId: patchApprovalState.patchId,
      allowRemovedComponents
    }
  });
}

function approvePatch() {
  if (!applyGateOpen()) return;
  if (patchApprovalState.removedComponents?.length) {
    presentRemovalConfirm();
    return;
  }
  if (approvePatchButtonEl.getAttribute('aria-disabled') === 'true' || ercBlockState().passed !== true) return;
  appendProgress({ stage: 'apply', text: t('patch.apply.progress') });
  renderRequestStatus({ state: 'running', summaryKey: 'patch.apply.summary' });
  const id = `patch_approve_${Date.now()}`;
  pendingCalls.set(id, 'schematic.patch.approve');
  sendToolCall({ id, name: 'schematic.patch', args: { projectDir: activeProject.projectDir, approved: true, patchId: patchApprovalState.patchId } });
}

function hideApplyWithoutErcConfirm() {
  if (applyWithoutErcConfirmEl) applyWithoutErcConfirmEl.hidden = true;
}

function revealApplyWithoutErcConfirm() {
  if (!activeProject || !approveWithoutErcButtonEl || approveWithoutErcButtonEl.hidden || approveWithoutErcButtonEl.disabled) return;
  if (!patchApprovalState.patchId || !applyWithoutErcConfirmEl) return;
  const erc = ercBlockState();
  if (erc.skipped !== true || erc.failed || erc.passed === true) return;
  applyWithoutErcConfirmEl.hidden = false;
  cancelApplyWithoutErcButtonEl?.focus();
}

function cancelApplyWithoutErcConfirm() {
  hideApplyWithoutErcConfirm();
  approveWithoutErcButtonEl?.focus();
}

function approvePatchWithoutErc() {
  if (!activeProject || !approveWithoutErcButtonEl || approveWithoutErcButtonEl.hidden || approveWithoutErcButtonEl.disabled) return;
  if (!applyWithoutErcConfirmEl || applyWithoutErcConfirmEl.hidden) return;
  if (!patchApprovalState.patchId) return;
  const erc = ercBlockState();
  if (erc.skipped !== true || erc.failed || erc.passed === true) return;
  hideApplyWithoutErcConfirm();
  appendProgress({ stage: 'apply', text: t('request.apply-progress') });
  renderRequestStatus({ state: 'running', summaryKey: 'request.applying' });
  const id = `patch_approve_${Date.now()}`;
  pendingCalls.set(id, 'schematic.patch.approve');
  sendToolCall({ id, name: 'schematic.patch', args: { projectDir: activeProject.projectDir, approved: true, patchId: patchApprovalState.patchId, ercOverride: 'skipped' } });
}

function cancelPatch() {
  if (!activeProject || cancelPatchButtonEl.disabled || !patchApprovalState.patchId) return;
  const id = `patch_cancel_${Date.now()}`;
  pendingCalls.set(id, 'schematic.patch.cancel');
  sendToolCall({ id, name: 'schematic.patch', args: { projectDir: activeProject.projectDir, cancel: true, patchId: patchApprovalState.patchId } });
  clearPatchApproval('patch.cancelled');
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

function t(key, vars) {
  const translate = window.chatpcbI18n?.t;
  return typeof translate === 'function' ? translate(key, vars) : key;
}

function renderStepIcon(svg, state) {
  if (!svg) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const visual = state === 'done'
    ? 'done'
    : (state === 'locked' ? 'locked' : (state === 'wait' || state === 'run' ? 'current' : 'todo'));
  if (visual === 'done') {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M2 6.5l2.5 2.5L10 3.5');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.8');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    return;
  }
  if (visual === 'locked') {
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', '2.5');
    rect.setAttribute('y', '5.5');
    rect.setAttribute('width', '7');
    rect.setAttribute('height', '5');
    rect.setAttribute('rx', '1');
    rect.setAttribute('fill', 'currentColor');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M4 5.5V4a2 2 0 014 0v1.5');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.4');
    svg.appendChild(rect);
    svg.appendChild(path);
    return;
  }
  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx', '6');
  circle.setAttribute('cy', '6');
  circle.setAttribute('r', '3.5');
  if (visual === 'current') {
    circle.setAttribute('fill', 'currentColor');
  } else {
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', 'currentColor');
    circle.setAttribute('stroke-width', '1.4');
  }
  svg.appendChild(circle);
}

function workflowStateKey(state) {
  if (state === 'done') return 'done';
  if (state === 'locked') return 'locked';
  if (state === 'wait' || state === 'run') return 'current';
  return 'pending';
}

function laneSummary(buttons, current) {
  const total = buttons.length;
  const doneCount = buttons.filter((button) => button.dataset.state === 'done').length;
  let stateLabel = t('workflow.state.pending');
  if (doneCount === 0 && !current) stateLabel = t('workflow.not-started');
  else if (total > 0 && doneCount === total) stateLabel = t('workflow.state.done');
  else if (current) stateLabel = t('workflow.state.current');
  return t('workflow.summary', { done: doneCount, total, state: stateLabel });
}

function syncWorkflow() {
  const { active, done, mode } = deriveWorkflow();
  const activeIndex = workflowIndex(active);
  const layoutUnlocked = done.has('circuit.review') || activeIndex >= workflowIndex('layout.concept');
  const fabUnlocked = done.has('layout.review') || workflowFlags.layoutReviewed;

  for (const button of document.querySelectorAll('.flow-btn[data-step]')) {
    const id = button.dataset.step;
    const index = workflowIndex(id);
    const lane = id.split('.')[0];
    let state;
    if (lane === 'fab' && !fabUnlocked) state = 'locked';
    else if (lane === 'layout' && !layoutUnlocked) state = 'locked';
    else if (done.has(id) && id !== active) state = 'done';
    else if (id === active) state = mode === 'run' ? 'run' : (mode === 'idle' ? 'idle' : 'wait');
    else if (index < activeIndex) state = 'done';
    else state = 'idle';
    button.dataset.state = state;
    button.dataset.s = state === 'done'
      ? 'done'
      : (state === 'locked' ? 'locked' : (state === 'wait' || state === 'run' ? 'current' : 'todo'));
    const stepLabel = t(`workflow.step.${id}`);
    const laneLabel = t(`workflow.lane.${lane}`);
    const stateLabel = t(`workflow.state.${workflowStateKey(state)}`);
    const labelEl = button.querySelector('.step-label');
    if (labelEl) labelEl.textContent = stepLabel;
    button.setAttribute('aria-label', t('workflow.step.aria', { lane: laneLabel, step: stepLabel, state: stateLabel }));
    if (state === 'wait' || state === 'run') button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
    renderStepIcon(button.querySelector('.step-icon'), state);
  }

  for (const lane of document.querySelectorAll('.workflow-lane')) {
    const laneId = lane.dataset.lane;
    const current = Boolean(laneId && active.startsWith(`${laneId}.`));
    lane.dataset.active = String(current);
    if (current) laneOpen.delete(laneId);
    const laneLabel = laneId ? t(`workflow.lane.${laneId}`) : '';
    for (const el of lane.querySelectorAll('.lane-h, .lane-name')) el.textContent = laneLabel;
    const buttons = [...lane.querySelectorAll('.flow-btn[data-step]')];
    const lockedButtons = buttons.filter((button) => button.dataset.state === 'locked');
    const allLocked = buttons.length > 0 && lockedButtons.length === buttons.length;
    const reason = laneId ? document.getElementById(`lock-r-${laneId}`) : null;
    const row = lane.querySelector('.lane-row');
    const body = lane.querySelector('.lane-c');
    const summary = row?.querySelector('.lane-sum');
    const doneCount = buttons.filter((button) => button.dataset.state === 'done').length;
    if (lockedButtons.length && reason) {
      const reasonKey = laneId === 'fab' ? 'workflow.locked.fab' : 'workflow.locked.layout';
      reason.hidden = false;
      reason.textContent = t(reasonKey);
      for (const button of lockedButtons) {
        button.setAttribute('aria-disabled', 'true');
        button.setAttribute('aria-describedby', reason.id);
      }
      for (const button of buttons) {
        if (button.dataset.state === 'locked') continue;
        button.removeAttribute('aria-disabled');
        button.removeAttribute('aria-describedby');
      }
    } else {
      if (reason) {
        reason.hidden = true;
        reason.replaceChildren();
      }
      for (const button of buttons) {
        button.removeAttribute('aria-disabled');
        button.removeAttribute('aria-describedby');
      }
    }
    if (allLocked && reason) {
      lane.setAttribute('aria-disabled', 'true');
      lane.setAttribute('aria-describedby', reason.id);
    } else {
      lane.removeAttribute('aria-disabled');
      lane.removeAttribute('aria-describedby');
    }
    const expanded = !allLocked && (current || laneOpen.get(laneId) === true);
    if (summary) {
      summary.hidden = allLocked;
      if (!allLocked) summary.textContent = laneSummary(buttons, current);
    }
    if (row) {
      if (allLocked && reason) {
        row.setAttribute('aria-disabled', 'true');
        row.setAttribute('aria-describedby', reason.id);
      } else {
        row.removeAttribute('aria-disabled');
        row.removeAttribute('aria-describedby');
      }
      row.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      row.hidden = expanded && current;
      const iconState = allLocked ? 'locked' : (doneCount === buttons.length && buttons.length ? 'done' : (current ? 'wait' : 'idle'));
      renderStepIcon(row.querySelector('.lane-icon'), iconState);
    }
    if (body) body.hidden = !expanded;
    const heading = lane.querySelector('.lane-h');
    if (heading) heading.hidden = Boolean(row && !row.hidden);
  }

  const progressEl = document.querySelector('#workflow-progress');
  if (progressEl && active) {
    const stepIndex = WORKFLOW_ORDER.indexOf(active);
    const lane = active.split('.')[0];
    progressEl.textContent = t('workflow.progress', {
      n: stepIndex < 0 ? 1 : stepIndex + 1,
      total: WORKFLOW_ORDER.length,
      label: `${t(`workflow.lane.${lane}`)} ${t(`workflow.step.${active}`)}`
    });
  }

  const copyWait = t(`workflow.copy.${active}.wait`);
  const copyRun = t(`workflow.copy.${active}.run`);
  if (workflowCaptionEl && active) {
    workflowCaptionEl.textContent = requestStatusEl?.dataset.state === 'failed'
      ? t('workflow.caption.failed')
      : (mode === 'run' ? copyRun : (mode === 'idle' ? t('workflow.caption.idle') : copyWait));
  }
  if (workflowCliEl) {
    const showCli = mode === 'run' && lastProgressText;
    workflowCliEl.hidden = !showCli;
    workflowCliEl.textContent = showCli ? lastProgressText : '';
  }
  scrollConversationToLatest();
}

function renderRequestStatus({ state, summary, summaryKey, summaryVars, technicalDetail = '' }) {
  requestStatusEl.dataset.state = state;
  requestStatusEl.removeAttribute('data-i18n');
  if (summaryKey) {
    requestStatusKey = summaryKey;
    requestStatusVars = summaryVars ?? null;
    requestStatusEl.textContent = t(summaryKey, summaryVars);
  } else {
    requestStatusKey = null;
    requestStatusEl.textContent = summary;
  }
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
  const titleText = t(copy.titleKey);
  title.dataset.i18n = copy.titleKey;
  title.textContent = titleText;
  body.append(title);
  const progressText = payload.text ? localizeDaemonText(payload.text) : '';
  if (progressText) {
    const text = document.createElement('p');
    text.textContent = progressText;
    body.append(text);
  }
  item.append(img, body);
  requestProgressEl.append(item);
  while (requestProgressEl.children.length > 3) {
    requestProgressEl.firstElementChild.remove();
  }
  item.scrollIntoView({ block: 'nearest' });
  lastProgressStage = stage;
  lastProgressText = progressText || titleText;
  syncWorkflow();
}

function offerNativeDraft() {
  conversationOptionsEl.replaceChildren();
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.i18n = 'draft.create';
  button.textContent = t('draft.create');
  button.dataset.recommended = 'true';
  button.addEventListener('click', requestNativeDraft);
  conversationOptionsEl.append(button);
}

function requestNativeDraft() {
  if (!activeProject) return;
  setRequestBusy(true);
  conversationOptionsEl.replaceChildren();
  renderRequestStatus({ state: 'running', summaryKey: 'request.running' });
  appendProgress({ stage: 'preview', text: t('request.draft-progress') });
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
  validationStatusEl.removeAttribute('data-i18n');
  const resolvedReason = reason ?? erc?.reason;
  const skippedFlag = skipped === true || erc?.skipped === true;
  const reasonText = validationReason({ reason: resolvedReason, exitCode, stderr, formatUpgrade });
  const counts = t('validation.counts', { errors: erc?.errorCount ?? 0, warnings: erc?.warningCount ?? 0 });

  if (skippedFlag) {
    const unavailable = resolvedReason?.code === 'KICAD_CLI_UNAVAILABLE';
    validationStatusEl.dataset.state = unavailable ? 'unavailable' : 'skipped';
    validationStatusEl.textContent = t(unavailable ? 'validation.unavailable' : 'validation.skipped', { reason: reasonText });
  } else if (ok === false) {
    validationStatusEl.dataset.state = 'failed';
    validationStatusEl.textContent = t('validation.failed', { reason: reasonText, counts });
  } else if (!erc) {
    validationStatusEl.dataset.state = 'unavailable';
    validationStatusEl.textContent = t('validation.unavailable', { reason: reasonText });
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
  if (Number.isInteger(exitCode) && exitCode !== 0) return t('validation.exit', { code: exitCode });
  if (formatUpgrade?.ok === false) return t('validation.upgrade', { code: formatUpgrade.exitCode ?? t('validation.unknown-code') });
  if (typeof reason?.code === 'string' && reason.code) return reason.code.replaceAll('_', ' ').toLowerCase();
  return t('validation.incomplete');
}

function renderKiCadLink({ linkState, projectPath, dirty = false }) {
  kiCadLinkEl.dataset.state = linkState;
  kiCadLinkEl.textContent = dirty
    ? t('kicad.unsaved', { path: projectPath })
    : t('kicad.link', { state: linkState, path: projectPath });
}

function renderArtifacts(files = {}) {
  artifactListEl.replaceChildren();
  for (const [kind, file] of Object.entries(files)) {
    const item = document.createElement('li');
    item.textContent = t('artifacts.item', { kind, file });
    artifactListEl.append(item);
  }
}

function renderReview(review) {
  if (!review) return;
  reviewPanelEl.hidden = false;
  reviewStatusEl.removeAttribute('data-i18n');
  reviewStatusEl.textContent = reviewStatusText(review);
  reviewStatusEl.dataset.status = review.status;
  renderFindingList(reviewBlockersEl, review.findings?.blockers);
  renderFindingList(reviewWarningsEl, review.findings?.warnings);
  renderFindingList(reviewNotesEl, review.findings?.notes);
  renderFixList(reviewFixesEl, review.proposedFixes);
}

function reviewStatusText(review) {
  if (review.statusLabel) return review.statusLabel;
  if (review.status === 'ready-for-release') return t('review.ready-release');
  if (review.status === 'ready-for-prototype-review') return t('review.ready-prototype');
  return t('review.blocked');
}

function findingText(finding) {
  if (typeof finding?.message === 'string') return finding.message;
  if (finding?.message && typeof finding.message === 'object') {
    return finding.message.en || finding.message.ko || '';
  }
  if (typeof finding?.en === 'string') return finding.en;
  return String(finding ?? '');
}

function renderFindingList(listEl, findings = []) {
  listEl.replaceChildren();
  for (const finding of findings) {
    const item = document.createElement('li');
    item.textContent = findingText(finding);
    listEl.append(item);
  }
  if (findings.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = t('review.none');
    listEl.append(empty);
  }
}

function renderFixList(listEl, fixes = []) {
  listEl.replaceChildren();
  for (const fix of fixes) {
    const item = document.createElement('li');
    item.textContent = t('review.fix', { title: fix.title, summary: fix.summary });
    listEl.append(item);
  }
  if (fixes.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = t('review.no-fixes');
    listEl.append(empty);
  }
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
  kiCadFallbackEl.textContent = t('kicad.fallback', { file: projectFile });
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
      clearPatchApproval('patch.dirty');
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
      clearPatchApproval('patch.dirty');
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

function setToolsMenuOpen(open) {
  const button = document.querySelector('#tools-menu-button');
  const menu = document.querySelector('#tools-menu');
  if (button) button.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (menu) menu.hidden = !open;
}

function syncToolsBadge() {
  const button = document.querySelector('#tools-menu-button');
  if (!button) return;
  button.classList.toggle('has-badge', Boolean(conflictDockBtnEl && !conflictDockBtnEl.hidden));
}

function showConflict() {
  conflictCardEl.hidden = false;
  if (conflictDockBtnEl) conflictDockBtnEl.hidden = false;
  syncToolsBadge();
  document.getElementById('conflict-dialog')?.showModal?.();
  renderKiCadLink({ linkState: 'conflict', projectPath: activeProject.projectDir, dirty: true });
  startConflictWatch();
}

function hideConflict() {
  conflictCardEl.hidden = true;
  if (conflictDockBtnEl) conflictDockBtnEl.hidden = true;
  syncToolsBadge();
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

function isProjectBusyCall(callName) {
  return callName === 'project.request'
    || callName === 'schematic.generate'
    || callName === 'schematic.patch'
    || callName === 'schematic.patch.approve'
    || callName === 'schematic.patch.cancel';
}

function showProjectBusy(callName, message) {
  const summary = typeof message === 'string' && message.trim()
    ? localizeDaemonText(message.trim())
    : t('request.project-busy');
  if (callName === 'project.request') {
    const requestProjectDir = activeRequestProjectDir;
    pendingCalls.delete(activeRequestId);
    activeRequestId = null;
    activeRequestProjectDir = null;
    setRequestBusy(false);
    if (requestProjectDir !== activeProject?.projectDir) return;
  } else if (callName === 'schematic.generate') {
    setRequestBusy(Boolean(activeRequestId));
    offerNativeDraft();
  } else if (callName === 'schematic.patch.approve' || callName === 'schematic.patch' || callName === 'schematic.patch.cancel') {
    // Keep the patch preview so Apply can be clicked again. A request that is still running keeps the composer locked.
    setRequestBusy(Boolean(activeRequestId));
    if (callName !== 'schematic.patch.cancel') renderPatchApproval();
  }
  appendProgress({ stage: 'fail', text: summary });
  renderRequestStatus({ state: 'failed', summary });
}

window.setChatGptAuthState = setChatGptAuthState;

// A query string is not enough: only the test server sets this flag before the page loads.
if (new URLSearchParams(location.search).get('chatpcbTest') === '1' && window.__CHATPCB_TEST_MODE__ === true) {
  window.__chatpcbTest = {
    showChatGptUi() {
      chatGptUiEnabled = true;
      setChatGptAuthState({});
    },
    showPatch(state = {}) {
      const project = state.project || { displayName: 'demo-board', projectDir: '/tmp/demo-board' };
      activeProject = project;
      activeProjectNameEl.textContent = project.displayName || '';
      activeProjectDirectoryEl.textContent = project.projectDir || '';
      if (activeProjectDirectoryEl) activeProjectDirectoryEl.title = project.projectDir || '';
      activeProjectEl.hidden = false;
      if (projectSetupEl) projectSetupEl.hidden = true;
      setRequestBusy(false);
      pendingCalls.clear();
      activeRequestId = null;
      activeRequestProjectDir = null;
      lastRequestResult = state.staleRequest ?? {
        operation: state.operation || 'generated',
        patchId: state.patchId ?? 'patch_test',
        validation: state.validation ?? null,
        candidateVerification: state.candidateVerification ?? null,
        conversation: state.conversation || null
      };
      if (state.conversation) renderConversation({ ...lastRequestResult, ...state.conversation });
      inspectionState = {
        projectDir: project.projectDir,
        requestId: 'test',
        result: state.inspection ?? {
          manifest: { freshness: { status: 'current', reason: 'Evidence matches.' } },
          validation: state.validation || null
        }
      };
      if (inspectionCardEl && state.inspection) renderInspection(inspectionState.result);
      patchRejectionCode = null;
      patchApprovalState = {
        patchId: state.patchId ?? 'patch_test',
        expiresAt: state.expiresAt ?? (Date.now() + 600000),
        timeout: null
      };
      if (patchApprovalCardEl) patchApprovalCardEl.hidden = false;
      renderPatchApproval();
      renderRequestStatus({ state: 'ready', summaryKey: 'request.preview-ready' });
    }
  };
}

function patchApprovalGate() {
  const freshness = inspectionState.result?.manifest?.freshness?.status;
  const approvedEvidence = freshness === 'current' || freshness === 'legacy-unverified' || freshness === 'missing';
  const unexpired = Number.isFinite(Number(patchApprovalState.expiresAt)) && Number(patchApprovalState.expiresAt) > Date.now();
  const active = Boolean(patchApprovalState.patchId) && unexpired;
  return { freshness, approvedEvidence, active };
}

function patchApplyBusy() {
  if (activeRequestId) return true;
  for (const name of pendingCalls.values()) {
    if (name === 'project.request'
      || name === 'schematic.generate'
      || name === 'schematic.patch'
      || name === 'schematic.patch.approve'
      || name === 'schematic.patch.cancel') return true;
  }
  return false;
}

// Same decision the Apply button uses, plus ERC and an in-flight apply.
// A removal confirm rechecks this so a stale, expired, or disabled preview cannot skip it.
function applyGateOpen() {
  const gate = patchApprovalGate();
  const evidenceOpen = Boolean(activeProject) && gate.active && gate.approvedEvidence;
  if (!evidenceOpen) {
    if (approvePatchButtonEl) approvePatchButtonEl.disabled = true;
    return false;
  }
  if (approvePatchButtonEl?.disabled) return false;
  if (approvePatchButtonEl?.getAttribute('aria-disabled') === 'true') return false;
  if (ercBlockState().passed !== true) return false;
  if (patchApplyBusy()) return false;
  return true;
}

function existingComponentsRemoved(preview) {
  if (!preview || preview.applied === true) return null;
  const blockers = preview.review?.findings?.blockers ?? [];
  const blocker = blockers.find((finding) => (
    finding?.code === 'existing-components-removed'
    || finding?.id === 'existing-components-removed'
    || finding?.code === 'EXISTING_COMPONENTS_REMOVED'
  ));
  if (preview.reason?.code !== 'EXISTING_COMPONENTS_REMOVED' && !blocker) return null;
  const listed = [preview.removedComponents, preview.reason?.removedComponents, blocker?.removedComponents]
    .find((value) => Array.isArray(value) && value.length > 0) ?? [];
  const parts = [];
  for (const part of listed) {
    if (!part || typeof part.ref !== 'string' || part.ref.length === 0) continue;
    parts.push({
      ref: part.ref,
      value: part.value ?? '',
      libId: part.libId ?? ''
    });
  }
  return parts.length > 0 ? parts : null;
}

function draftSourceLabel(source) {
  if (!source) return '';
  if (source.via === 'provider' && source.provider === 'chatgpt') return t('source.chatgpt');
  if (source.via === 'native-fallback') return t('source.native');
  return '';
}

function draftParts(preview) {
  return Array.isArray(preview?.components) ? preview.components : [];
}

function partLine(part) {
  return [part?.ref ?? '', part?.value ?? '', part?.libId ?? ''].join(' · ');
}

function renderDraftEvidence(preview) {
  if (!patchApprovalSourceEl || !patchApprovalPartsEl) return;
  const source = preview?.source ?? preview?.conversation?.lastSource ?? null;
  const label = draftSourceLabel(source);
  patchApprovalSourceEl.textContent = label;
  patchApprovalSourceEl.hidden = label.length === 0;
  const parts = draftParts(preview);
  patchApprovalPartsEl.replaceChildren();
  for (const part of parts) {
    const item = document.createElement('li');
    item.textContent = partLine(part);
    patchApprovalPartsEl.append(item);
  }
  patchApprovalPartsEl.hidden = parts.length === 0;
}

function clearDraftEvidence() {
  if (patchApprovalSourceEl) {
    patchApprovalSourceEl.textContent = '';
    patchApprovalSourceEl.hidden = true;
  }
  if (patchApprovalPartsEl) {
    patchApprovalPartsEl.replaceChildren();
    patchApprovalPartsEl.hidden = true;
  }
}

function setPatchApprovalTechnicalDetail(text) {
  if (!patchApprovalTechnicalDetailsEl || !patchApprovalTechnicalDetailEl) return;
  const detail = typeof text === 'string' ? text : '';
  patchApprovalTechnicalDetailEl.textContent = detail;
  patchApprovalTechnicalDetailsEl.hidden = detail.length === 0;
}

function showMissingManifestCopy() {
  const plain = t('approval.no-manifest');
  if (plain === 'approval.no-manifest') {
    setPatchStatus('patch.missing-evidence');
    return;
  }
  setPatchStatus('approval.no-manifest');
  const detail = t('approval.no-manifest-detail');
  if (detail !== 'approval.no-manifest-detail') setPatchApprovalTechnicalDetail(detail);
}

function applyRemovalConfirmCopy() {
  if (applyRemoveTitleEl) applyRemoveTitleEl.textContent = t('patch.remove.title');
  if (applyRemoveLeadEl) applyRemoveLeadEl.textContent = t('patch.remove.lead');
  if (cancelApplyRemoveButtonEl) cancelApplyRemoveButtonEl.textContent = t('patch.remove.cancel');
  if (confirmApplyRemoveButtonEl) confirmApplyRemoveButtonEl.textContent = t('patch.remove.confirm');
}

function hideRemovalConfirm() {
  if (applyRemoveConfirmEl) applyRemoveConfirmEl.hidden = true;
}

function presentRemovalConfirm() {
  if (patchApplyBusy()) return;
  if (!applyGateOpen()) return;
  const parts = patchApprovalState.removedComponents;
  if (!applyRemoveConfirmEl || !parts?.length) return;
  applyRemovalConfirmCopy();
  if (applyRemovePartsEl) {
    applyRemovePartsEl.replaceChildren();
    for (const part of parts) {
      const item = document.createElement('li');
      item.textContent = partLine(part);
      applyRemovePartsEl.append(item);
    }
  }
  applyRemoveConfirmEl.hidden = false;
  cancelApplyRemoveButtonEl?.focus();
}

function cancelRemovalConfirm() {
  if (!applyRemoveConfirmEl || applyRemoveConfirmEl.hidden) return;
  hideRemovalConfirm();
  focusApplyButton();
}

function applyGateClosedStatus() {
  const gate = patchApprovalGate();
  if (!patchApprovalState.patchId || !gate.active) return { key: 'patch.expired', state: 'expired' };
  if (gate.freshness === 'stale' || !gate.approvedEvidence) return { key: 'patch.stale', state: 'stale' };
  if (ercBlockState().passed !== true) {
    return { key: applyBlockedReason(ercBlockState()).key, state: 'blocked' };
  }
  return { key: 'patch.apply.blocked-disabled', state: 'blocked' };
}

function focusApplyButton() {
  const button = approvePatchButtonEl;
  if (!button) return;
  if (button.disabled) {
    button.disabled = false;
    button.setAttribute('aria-disabled', 'true');
  }
  button.focus();
}

function dismissRemovalConfirmForClosedGate() {
  hideRemovalConfirm();
  const reason = applyGateClosedStatus();
  if (patchApprovalCardEl && patchApprovalState.patchId) patchApprovalCardEl.hidden = false;
  if (patchApprovalStatusEl) {
    patchApprovalStatusEl.hidden = false;
    patchApprovalStatusEl.dataset.state = reason.state;
    setPatchStatus(reason.key);
  }
  focusApplyButton();
}

// Daemon progress and patch-card text arrive in English (or as a code). Known
// strings follow the UI language. Anything else stays as the daemon sent it.
const DAEMON_TEXT_TO_KEY = {
  'Preparing a schematic patch preview.': 'daemon.progress.preview-patch',
  'Applying the draft to the schematic.': 'daemon.progress.applying',
  'Reading the circuit request.': 'daemon.progress.reading',
  'Prepared the recommended configuration.': 'daemon.progress.prepared',
  'The provider returned no tool call. Using the built-in draft.': 'daemon.progress.builtin',
  'Circuit draft is ready. Apply it to change the schematic.': 'daemon.progress.ready',
  'Drawing a local schematic draft.': 'request.draft-progress',
  'Another operation is using this project. Try again in a moment.': 'request.project-busy',
  'ERC_BLOCKED: patch.apply.blocked-stale': 'patch.apply.blocked-stale',
  'ERC_BLOCKED: ERC did not pass for this patch.': 'daemon.erc.failed',
  'ERC_BLOCKED: ERC was skipped. Approve with ercOverride "skipped" to apply without ERC.': 'patch.apply.skipped',
  'ERC_BLOCKED: no ERC result is recorded for this patch.': 'patch.apply.blocked-missing',
  'Patch approval was not found.': 'daemon.patch.missing',
  'Patch approval has expired.': 'patch.expired',
  'Patch approval belongs to a different project.': 'patch.stale',
  PROJECT_BUSY: 'request.project-busy',
  ERC_BLOCKED: 'patch.blocked',
  PATCH_APPROVAL_EXPIRED: 'patch.expired',
  PATCH_APPROVAL_MISSING: 'daemon.patch.missing',
  PATCH_STALE: 'patch.stale',
  EXISTING_COMPONENTS_REMOVED: 'patch.remove.lead',
  PATCH_CANDIDATE_UNVERIFIED: 'patch.unverified.body'
};

function localizeDaemonText(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  const key = DAEMON_TEXT_TO_KEY[text];
  if (!key) return text;
  const translated = t(key);
  return translated === key ? text : translated;
}

function restoreProviderSelection() {
  const stored = readStoredProvider();
  if (!stored || !providerEl) return;
  const listed = [...providerEl.options].some((option) => option.value === stored);
  if (listed) providerEl.value = stored;
}

function readStoredProvider() {
  try {
    return localStorage.getItem(PROVIDER_STORAGE_KEY);
  } catch {
    return null;
  }
}

function rememberProvider(provider) {
  try {
    localStorage.setItem(PROVIDER_STORAGE_KEY, provider);
  } catch {
    // The select still works for this page when storage is blocked.
  }
}

function accountSwitchIdentity(account) {
  const sub = typeof account?.sub === 'string' ? account.sub.trim() : '';
  if (sub) return sub;
  const email = typeof account?.email === 'string' ? account.email.trim() : '';
  return email;
}

async function shortSha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  let hex = '';
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0');
  return hex.slice(0, CHATGPT_SWITCH_OFFER_HASH_HEX);
}

function readStoredSwitchOffer(key) {
  if (switchOfferRecordedKeys.has(key)) return true;
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function rememberChatGPTSwitchOffered() {
  if (activeSwitchOfferStorageKey) {
    switchOfferRecordedKeys.add(activeSwitchOfferStorageKey);
    try {
      localStorage.setItem(activeSwitchOfferStorageKey, '1');
    } catch {
      // The choice still sticks for this page when storage is blocked.
    }
  } else if (activeSwitchIdentity) {
    pageOnlySwitchIdentities.add(activeSwitchIdentity);
  } else {
    anonymousSwitchOfferRecorded = true;
  }
  if (chatgptSwitchOfferEl) {
    chatgptSwitchOfferEl.hidden = true;
    chatgptSwitchOfferEl.dataset.decision = 'hidden';
  }
}

async function syncChatGPTSwitchOffer() {
  if (!chatgptSwitchOfferEl || !providerEl || !i18nReady || !chatgptAuthKnown) return;
  const epoch = ++switchOfferEpoch;
  const signedIn = chatgptAuthState.state === 'signed_in';
  const identity = signedIn ? accountSwitchIdentity(chatgptAuthState.account) : '';
  if (identity !== activeSwitchIdentity) {
    chatgptSwitchOfferEl.hidden = true;
    chatgptSwitchOfferEl.dataset.decision = 'pending';
  }
  let storageKey = null;
  let already = false;
  if (identity) {
    try {
      storageKey = `${CHATGPT_SWITCH_OFFER_PREFIX}.${await shortSha256Hex(identity)}`;
    } catch {
      storageKey = null;
    }
    if (epoch !== switchOfferEpoch) return;
    already = storageKey ? readStoredSwitchOffer(storageKey) : pageOnlySwitchIdentities.has(identity);
  } else if (signedIn) {
    already = anonymousSwitchOfferRecorded;
  }
  if (epoch !== switchOfferEpoch) return;
  activeSwitchOfferStorageKey = storageKey;
  activeSwitchIdentity = identity;
  const show = signedIn && providerEl.value !== 'chatgpt' && !already;
  chatgptSwitchOfferEl.dataset.decision = show ? 'shown' : 'hidden';
  if (!show) {
    chatgptSwitchOfferEl.hidden = true;
    return;
  }
  if (chatgptSwitchOfferTextEl) chatgptSwitchOfferTextEl.textContent = t('auth.chatgpt.switch-offer.prompt');
  if (chatgptSwitchOfferAcceptEl) chatgptSwitchOfferAcceptEl.textContent = t('auth.chatgpt.switch-offer.accept');
  if (chatgptSwitchOfferDismissEl) chatgptSwitchOfferDismissEl.textContent = t('auth.chatgpt.switch-offer.dismiss');
  chatgptSwitchOfferEl.hidden = false;
}

function acceptChatGPTSwitchOffer() {
  rememberChatGPTSwitchOffered();
  if (!providerEl || providerEl.value === 'chatgpt') {
    syncChatGPTSwitchOffer();
    return;
  }
  providerEl.value = 'chatgpt';
  providerEl.dispatchEvent(new Event('change'));
}

function dismissChatGPTSwitchOffer() {
  rememberChatGPTSwitchOffered();
  syncChatGPTSwitchOffer();
}

function updateChatGPTAuthVisibility() {
  if (providerEl?.value === 'chatgpt') {
    refreshChatGPTAuthStatus();
    return;
  }
  if (chatgptAuthCardEl) chatgptAuthCardEl.hidden = true;
}

function refreshChatGPTAuthStatus() {
  const id = `auth_chatgpt_status_${Date.now()}`;
  pendingCalls.set(id, 'auth.chatgpt.status');
  sendToolCall({ id, name: 'auth.chatgpt.status', args: {} });
}

function stopChatGPTAuthPolling() {
  if (chatgptAuthPoll) {
    clearInterval(chatgptAuthPoll);
    chatgptAuthPoll = null;
  }
  if (chatgptAuthExpiryTimer) {
    clearTimeout(chatgptAuthExpiryTimer);
    chatgptAuthExpiryTimer = null;
  }
}

function chatGPTAuthExpiredLocally() {
  const expiresAt = Date.parse(chatgptAuthState.expiresAt);
  return Number.isFinite(expiresAt) && Date.now() >= expiresAt;
}

function showChatGPTAuthExpired() {
  stopChatGPTAuthPolling();
  if (chatgptAuthState.state === 'error' && chatgptAuthState.code === 'timeout') return;
  chatgptAuthState = {
    ...chatgptAuthState,
    state: 'error',
    code: 'timeout'
  };
  chatgptAuthKnown = true;
  renderChatGPTAuth();
  updateLiveRegion({ state: 'error', code: 'timeout' });
}

function startChatGPTAuthPolling() {
  stopChatGPTAuthPolling();
  if (chatgptAuthState.state !== 'waiting') return;
  const expiresAt = Date.parse(chatgptAuthState.expiresAt);
  if (!Number.isFinite(expiresAt)) return;
  const delay = expiresAt - Date.now();
  if (delay <= 0) {
    showChatGPTAuthExpired();
    return;
  }
  chatgptAuthExpiryTimer = setTimeout(() => {
    if (chatgptAuthState.state === 'waiting') showChatGPTAuthExpired();
  }, delay);
  chatgptAuthPoll = setInterval(() => {
    if (chatgptAuthState.state !== 'waiting') {
      stopChatGPTAuthPolling();
      return;
    }
    if (chatGPTAuthExpiredLocally()) {
      showChatGPTAuthExpired();
      return;
    }
    refreshChatGPTAuthStatus();
  }, CHATGPT_AUTH_POLL_MS);
}

function applyChatGPTAuthStatus(result) {
  chatgptAuthKnown = true;
  if (chatgptAuthState.state === 'error' && chatgptAuthState.code === 'timeout' && result.state === 'waiting') {
    syncChatGPTSwitchOffer();
    return;
  }
  if (result.state === 'waiting') {
    const previous = chatgptAuthState;
    chatgptAuthState = {
      ...chatgptAuthState,
      state: 'waiting',
      attemptId: result.attemptId ?? chatgptAuthState.attemptId,
      authUrl: result.authUrl ?? chatgptAuthState.authUrl,
      expiresAt: result.expiresAt ?? chatgptAuthState.expiresAt,
      code: undefined
    };
    const changed = previous.state !== 'waiting'
      || previous.expiresAt !== chatgptAuthState.expiresAt
      || previous.attemptId !== chatgptAuthState.attemptId
      || previous.authUrl !== chatgptAuthState.authUrl;
    if (changed) renderChatGPTAuth();
    else syncChatGPTSwitchOffer();
    if (chatgptAuthState.state === 'waiting' && !chatgptAuthPoll) startChatGPTAuthPolling();
    return;
  }
  if (chatgptAuthState.state === 'waiting' && (result.code === 'timeout' || chatGPTAuthExpiredLocally())) {
    showChatGPTAuthExpired();
    return;
  }
  const previousAuthState = chatgptAuthState.state;
  stopChatGPTAuthPolling();
  chatgptAuthState = {
    state: result.state || 'signed_out',
    account: result.account,
    plan: result.plan,
    code: result.code,
    attemptId: result.attemptId ?? null,
    authUrl: result.authUrl ?? null,
    expiresAt: result.expiresAt ?? null
  };
  renderChatGPTAuth();
  if (result.state === 'error' && result.code) updateLiveRegion({ state: 'error', code: result.code });
  refreshProviderStatusForAuth(previousAuthState, chatgptAuthState.state);
}

function handleChatGPTAuthChanged(payload) {
  const previousAuthState = chatgptAuthState.state;
  chatgptAuthState = { ...chatgptAuthState, ...payload };
  chatgptAuthKnown = true;
  if (chatgptAuthState.state === 'waiting') startChatGPTAuthPolling();
  else stopChatGPTAuthPolling();
  renderChatGPTAuth();
  updateLiveRegion(payload);
  refreshProviderStatusForAuth(previousAuthState, chatgptAuthState.state);
}

function formatChatGPTAuthExpiry(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const tag = window.chatpcbI18n?.getLang?.() === 'ko' ? 'ko-KR' : 'en-US';
  return new Intl.DateTimeFormat(tag, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function chatgptAuthUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  return parsed.href;
}

function chatgptAuthHref(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  return escapeHtml(parsed.href);
}

function chatGPTButton(className, label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function chatGPTAuthErrorCopy(code) {
  if (code === 'cancelled' || code === 'access_denied') {
    return { titleKey: 'auth.chatgpt.error.cancelled', bodyKey: '', actions: 'retry' };
  }
  if (code === 'timeout') {
    return { titleKey: 'auth.chatgpt.error.timeout', bodyKey: 'auth.chatgpt.error.timeout.body', actions: 'retry' };
  }
  if (code === 'open_failed') {
    return { titleKey: 'auth.chatgpt.error.open-failed', bodyKey: '', actions: 'retry', link: true };
  }
  if (code === 'not_eligible') {
    return {
      titleKey: 'auth.chatgpt.error.not-eligible.title',
      bodyKey: 'auth.chatgpt.error.not-eligible.body',
      actions: 'account'
    };
  }
  if (code === 'usage_limit') {
    return {
      titleKey: 'auth.chatgpt.error.usage-limit.title',
      bodyKey: 'auth.chatgpt.error.usage-limit.body',
      actions: 'provider'
    };
  }
  return { titleKey: 'auth.chatgpt.error.route', bodyKey: '', actions: 'retry' };
}

function appendChatGPTAuthActions(parent, actions) {
  const row = document.createElement('div');
  row.className = 'chatgpt-auth-actions';
  if (actions === 'account') {
    row.append(chatGPTButton('chatgpt-secondary-btn', t('auth.chatgpt.switch-account'), startChatGPTSignIn));
    row.append(chatGPTButton('chatgpt-secondary-btn', t('auth.chatgpt.switch-provider'), focusProviderSelect));
  } else if (actions === 'provider') {
    row.append(chatGPTButton('chatgpt-secondary-btn', t('auth.chatgpt.switch-provider'), focusProviderSelect));
  } else {
    row.append(chatGPTButton('chatgpt-secondary-btn', t('auth.chatgpt.retry'), startChatGPTSignIn));
  }
  parent.append(row);
}

function renderChatGPTAuth() {
  syncChatGPTSwitchOffer();
  if (!i18nReady || !chatgptAuthCardEl || !providerEl) return;
  const isChatGPT = providerEl.value === 'chatgpt';
  if (!isChatGPT) {
    chatgptAuthCardEl.hidden = true;
    if (!activeRequestId) setRequestBusy(false);
    return;
  }

  const state = chatgptAuthState.state;
  const code = chatgptAuthState.code;
  chatgptAuthCardEl.hidden = false;
  chatgptAuthCardEl.className = 'chatgpt-auth-card';
  chatgptAuthCardEl.replaceChildren();

  if (state === 'signed_out' || !state) {
    const title = document.createElement('h2');
    title.id = 'chatgpt-auth-title';
    title.textContent = t('auth.chatgpt.intro.title');
    const body = document.createElement('p');
    body.textContent = t('auth.chatgpt.intro.body');
    const button = chatGPTButton('chatgpt-sign-in-btn', t('auth.chatgpt.button'), startChatGPTSignIn);
    button.lang = 'en';
    chatgptAuthCardEl.append(title, body, button);
    setRequestBusy(true);
  } else if (state === 'waiting') {
    const title = document.createElement('h2');
    title.id = 'chatgpt-auth-title';
    title.tabIndex = -1;
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    spinner.setAttribute('aria-hidden', 'true');
    title.append(spinner, document.createTextNode(t('auth.chatgpt.waiting.title')));
    chatgptAuthCardEl.append(title);
    const expiryTime = formatChatGPTAuthExpiry(chatgptAuthState.expiresAt);
    if (expiryTime) {
      const expiry = document.createElement('p');
      expiry.id = 'chatgpt-auth-expiry';
      expiry.textContent = t('auth.chatgpt.waiting.expires', { time: expiryTime });
      chatgptAuthCardEl.append(expiry);
    }
    const href = chatgptAuthUrl(chatgptAuthState.authUrl);
    const row = document.createElement('p');
    const reopen = chatGPTButton('chatgpt-secondary-btn', t('auth.chatgpt.waiting.reopen'), reopenChatGPTSignIn);
    reopen.id = 'chatgpt-reopen-button';
    if (href) {
      const note = document.createElement('span');
      note.className = 'sr-only';
      note.textContent = t('auth.chatgpt.opens-browser');
      reopen.append(document.createTextNode(' '), note);
      const copy = chatGPTButton('chatgpt-secondary-btn', t('auth.chatgpt.waiting.copy'), copyChatGPTLink);
      row.append(reopen, document.createTextNode(' · '), copy);
    } else {
      reopen.disabled = true;
      reopen.setAttribute('aria-describedby', 'chatgpt-reopen-reason');
      const reason = document.createElement('span');
      reason.id = 'chatgpt-reopen-reason';
      reason.textContent = t('auth.chatgpt.waiting.reopen-unavailable');
      row.append(reopen, document.createTextNode(' '), reason);
    }
    chatgptAuthCardEl.append(row);
    const actions = document.createElement('div');
    actions.className = 'chatgpt-auth-actions';
    actions.append(chatGPTButton('chatgpt-secondary-btn', t('auth.chatgpt.cancel'), cancelChatGPTSignIn));
    chatgptAuthCardEl.append(actions);
    setRequestBusy(true);
  } else if (state === 'signed_in') {
    const account = chatgptAuthState.account || {};
    const email = typeof account.email === 'string' ? account.email : '';
    const plan = chatgptAuthState.plan ? String(chatgptAuthState.plan) : '';
    const title = document.createElement('h2');
    title.id = 'chatgpt-auth-title';
    title.tabIndex = -1;
    title.textContent = t('auth.chatgpt.signed-in.title');
    const accountLine = document.createElement('p');
    accountLine.setAttribute('translate', 'no');
    accountLine.textContent = plan
      ? t('auth.chatgpt.signed-in.account', { email, plan })
      : email;
    const usage = document.createElement('p');
    usage.textContent = t('auth.chatgpt.signed-in.usage');
    const actions = document.createElement('div');
    actions.className = 'chatgpt-auth-actions';
    actions.append(chatGPTButton('chatgpt-secondary-btn', t('auth.chatgpt.sign-out'), signOutChatGPT));
    chatgptAuthCardEl.append(title, accountLine, usage, actions);
    if (!activeRequestId) setRequestBusy(false);
  } else if (state === 'error') {
    chatgptAuthCardEl.className = 'chatgpt-auth-card error';
    const copy = chatGPTAuthErrorCopy(code);
    const title = document.createElement('h2');
    title.id = 'chatgpt-auth-title';
    title.tabIndex = -1;
    title.textContent = t(copy.titleKey);
    chatgptAuthCardEl.append(title);
    if (copy.link) {
      const safeHref = chatgptAuthHref(chatgptAuthState.authUrl);
      const href = chatgptAuthUrl(chatgptAuthState.authUrl);
      if (safeHref && href) {
        const paragraph = document.createElement('p');
        const link = document.createElement('a');
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = href;
        paragraph.append(link);
        chatgptAuthCardEl.append(paragraph);
      }
    } else if (copy.bodyKey) {
      const paragraph = document.createElement('p');
      paragraph.textContent = t(copy.bodyKey);
      chatgptAuthCardEl.append(paragraph);
    }
    appendChatGPTAuthActions(chatgptAuthCardEl, copy.actions);
    setRequestBusy(true);
  }

  const titleEl = chatgptAuthCardEl.querySelector('h2[tabindex="-1"]');
  if (titleEl && state !== 'signed_out') {
    setTimeout(() => {
      if (titleEl.isConnected) titleEl.focus();
    }, 100);
  }
}

function updateLiveRegion(payload) {
  if (!authLiveRegionEl || !payload) return;
  const state = payload.state;
  const code = payload.code;
  let message = '';
  if (state === 'waiting') {
    const time = formatChatGPTAuthExpiry(payload.expiresAt);
    message = time
      ? [t('auth.chatgpt.waiting.title'), t('auth.chatgpt.waiting.expires', { time })].join(' ')
      : t('auth.chatgpt.waiting.title');
  } else if (state === 'signed_in') {
    message = payload.plan
      ? [t('auth.chatgpt.signed-in.title'), String(payload.plan)].join(' ')
      : t('auth.chatgpt.signed-in.title');
  } else if (state === 'signed_out') {
    message = [t('auth.chatgpt.signed-out.title'), t('auth.chatgpt.signed-out.body')].join(' ');
  } else if (state === 'error' && code) {
    if (code === 'cancelled' || code === 'access_denied') message = t('auth.chatgpt.error.cancelled');
    else if (code === 'timeout') message = t('auth.chatgpt.error.timeout');
    else if (code === 'not_eligible') message = t('auth.chatgpt.error.not-eligible.title');
    else if (code === 'usage_limit') message = t('auth.chatgpt.error.usage-limit.title');
    else if (code === 'open_failed') message = t('auth.chatgpt.error.open-failed');
    else message = t('auth.chatgpt.error.route');
  }
  if (!message) return;
  authLiveRegionEl.textContent = '';
  setTimeout(() => {
    if (authLiveRegionEl) authLiveRegionEl.textContent = message;
  }, 50);
}

function startChatGPTSignIn() {
  const id = `auth_chatgpt_start_${Date.now()}`;
  pendingCalls.set(id, 'auth.chatgpt.start');
  const locale = window.chatpcbI18n?.getLang?.() || 'en';
  sendToolCall({ id, name: 'auth.chatgpt.start', args: { locale } });
}

function reopenChatGPTSignIn() {
  if (!chatgptAuthState.attemptId) return;
  const id = `auth_chatgpt_reopen_${Date.now()}`;
  pendingCalls.set(id, 'auth.chatgpt.reopen');
  try {
    sendToolCall({ id, name: 'auth.chatgpt.reopen', args: { attemptId: chatgptAuthState.attemptId } });
  } catch (error) {
    pendingCalls.delete(id);
    showChatGPTSignInError(error);
  }
}

function applyChatGPTReopenResult(payload) {
  try {
    const failure = reopenFailureFrom(payload);
    if (failure) {
      showChatGPTSignInError(failure.error, failure.authUrl);
      return;
    }
    const result = payload.result;
    chatgptAuthState = {
      ...chatgptAuthState,
      state: result.state || 'waiting',
      attemptId: result.attemptId,
      authUrl: result.authUrl
    };
    chatgptAuthKnown = true;
    renderChatGPTAuth();
  } catch (error) {
    showChatGPTSignInError(error);
  }
}

function reopenFailureFrom(payload) {
  if (!payload || payload.ok === false) {
    return { error: payload?.error, authUrl: payload?.authUrl || payload?.error?.authUrl };
  }
  const result = payload.result;
  if (result && result.ok === false) {
    return { error: result.error, authUrl: result.authUrl || result.error?.authUrl };
  }
  return null;
}

function showChatGPTSignInError(error, authUrl) {
  stopChatGPTAuthPolling();
  const code = chatGPTSignInErrorCode(error);
  chatgptAuthState = {
    ...chatgptAuthState,
    state: 'error',
    code,
    authUrl: authUrl || error?.authUrl || chatgptAuthState.authUrl
  };
  chatgptAuthKnown = true;
  renderChatGPTAuth();
  updateLiveRegion({ state: 'error', code });
}

function chatGPTSignInErrorCode(error) {
  const code = error && typeof error === 'object' ? error.code : undefined;
  if (code === 'cancelled' || code === 'access_denied' || code === 'timeout' || code === 'open_failed' || code === 'not_eligible' || code === 'usage_limit') {
    return code;
  }
  return 'open_failed';
}

function cancelChatGPTSignIn() {
  if (!chatgptAuthState.attemptId) return;
  const id = `auth_chatgpt_cancel_${Date.now()}`;
  pendingCalls.set(id, 'auth.chatgpt.cancel');
  sendToolCall({ id, name: 'auth.chatgpt.cancel', args: { attemptId: chatgptAuthState.attemptId } });
}

function signOutChatGPT() {
  const id = `auth_chatgpt_signout_${Date.now()}`;
  pendingCalls.set(id, 'auth.chatgpt.signOut');
  sendToolCall({ id, name: 'auth.chatgpt.signOut', args: {} });
}

function copyChatGPTLink() {
  if (!chatgptAuthState.authUrl || !navigator.clipboard?.writeText) return;
  navigator.clipboard.writeText(chatgptAuthState.authUrl).then(() => {
    if (!authLiveRegionEl) return;
    authLiveRegionEl.textContent = '';
    setTimeout(() => {
      if (authLiveRegionEl) authLiveRegionEl.textContent = t('auth.chatgpt.waiting.copied');
    }, 50);
  });
}

function focusProviderSelect() {
  providerEl?.focus();
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
