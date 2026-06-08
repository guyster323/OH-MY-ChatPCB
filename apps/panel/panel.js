const DAEMON_WS_URL = 'ws://127.0.0.1:41317/ws';

const statusEl = document.querySelector('#connection-status');
const logEl = document.querySelector('#chat-log');
const formEl = document.querySelector('#composer');
const promptEl = document.querySelector('#prompt');
const projectEl = document.querySelector('#project-dir');
const providerEl = document.querySelector('#provider');
const providerStatusEl = document.querySelector('#provider-status');
const artifactListEl = document.querySelector('#artifact-list');
const generateButtonEl = document.querySelector('#generate-button');
const previewPatchButtonEl = document.querySelector('#preview-patch-button');
const patchReviewEl = document.querySelector('#patch-review');
const patchDiffEl = document.querySelector('#patch-diff');
const approvePatchButtonEl = document.querySelector('#approve-patch-button');
const cancelPatchButtonEl = document.querySelector('#cancel-patch-button');
const cancelProviderButtonEl = document.querySelector('#cancel-provider-button');
const reviewPanelEl = document.querySelector('#review-panel');
const reviewStatusEl = document.querySelector('#review-status');
const reviewBlockersEl = document.querySelector('#review-blockers');
const reviewWarningsEl = document.querySelector('#review-warnings');
const reviewNotesEl = document.querySelector('#review-notes');
const reviewFixesEl = document.querySelector('#review-fixes');

let socket;
let pendingPatch = null;
let activeProviderInvocationId = null;

connect();

formEl.addEventListener('submit', (event) => {
  event.preventDefault();
  sendProviderChat();
});

generateButtonEl.addEventListener('click', () => sendGenerate());
previewPatchButtonEl.addEventListener('click', () => sendPatchPreview());
approvePatchButtonEl.addEventListener('click', () => sendPatchApproval());
cancelPatchButtonEl.addEventListener('click', () => sendPatchCancel());
cancelProviderButtonEl.addEventListener('click', () => sendProviderCancel());
providerEl.addEventListener('change', () => refreshProviderStatus());

function connect() {
  socket = new WebSocket(DAEMON_WS_URL);

  socket.addEventListener('open', () => {
    statusEl.textContent = 'Connected';
    appendMessage('system', 'chatpcb-agentd connected.');
    refreshProviderStatus();
  });

  socket.addEventListener('message', (event) => {
    const envelope = JSON.parse(event.data);
    handleEnvelope(envelope);
  });

  socket.addEventListener('close', () => {
    statusEl.textContent = 'Disconnected';
    setTimeout(connect, 1500);
  });

  socket.addEventListener('error', () => {
    statusEl.textContent = 'Connection error';
  });
}

function sendGenerate() {
  const prompt = promptEl.value.trim();
  const projectDir = projectEl.value.trim();
  if (!prompt || !projectDir) return;

  hidePatchReview();
  appendMessage('user', prompt);
  sendEnvelope('tool.call', {
    id: `call_${Date.now()}`,
    name: 'schematic.generate',
    args: {
      projectDir,
      prompt
    }
  });
}

function sendProviderChat() {
  const prompt = promptEl.value.trim();
  const projectDir = projectEl.value.trim();
  if (!prompt || !projectDir) return;

  hidePatchReview();
  appendMessage('user', prompt);
  const invocationId = `call_${Date.now()}`;
  activeProviderInvocationId = invocationId;
  setProviderBusy(true);
  sendEnvelope('tool.call', {
    id: invocationId,
    name: 'provider.invoke',
    args: {
      invocationId,
      provider: providerEl.value,
      projectDir,
      prompt
    }
  });
}

function sendProviderCancel() {
  if (!activeProviderInvocationId) return;

  sendEnvelope('tool.call', {
    id: `call_cancel_${Date.now()}`,
    name: 'provider.cancel',
    args: {
      id: activeProviderInvocationId
    }
  });
}

function sendPatchPreview() {
  const prompt = promptEl.value.trim();
  const projectDir = projectEl.value.trim();
  if (!prompt || !projectDir) return;

  pendingPatch = { projectDir, prompt };
  appendMessage('user', prompt);
  sendEnvelope('tool.call', {
    id: `call_${Date.now()}`,
    name: 'schematic.patch',
    args: {
      projectDir,
      prompt,
      approved: false
    }
  });
}

function sendPatchApproval() {
  if (!pendingPatch) return;

  sendEnvelope('tool.call', {
    id: `call_${Date.now()}`,
    name: 'schematic.patch',
    args: {
      ...pendingPatch,
      approved: true
    }
  });
}

function sendPatchCancel() {
  const projectDir = pendingPatch?.projectDir ?? projectEl.value.trim();
  pendingPatch = null;
  sendEnvelope('tool.call', {
    id: `call_${Date.now()}`,
    name: 'schematic.patch',
    args: {
      projectDir,
      cancel: true
    }
  });
}

function refreshProviderStatus() {
  sendEnvelope('tool.call', {
    id: `call_${Date.now()}`,
    name: 'provider.status',
    args: {
      provider: providerEl.value
    }
  });
}

function sendEnvelope(type, payload) {
  const envelope = {
    version: 1,
    id: `evt_${crypto.randomUUID()}`,
    type,
    createdAt: new Date().toISOString(),
    payload
  };

  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(envelope));
  } else {
    appendMessage('system', 'chatpcb-agentd is not connected.');
  }
}

function handleEnvelope(envelope) {
  if (envelope.type === 'system.status') {
    appendMessage('system', envelope.payload.service ?? 'daemon ready');
    return;
  }

  if (envelope.type === 'agent.delta') {
    appendMessage('assistant', envelope.payload.text ?? '');
    return;
  }

  if (envelope.type === 'tool.result') {
    if (!envelope.payload.ok) {
      appendMessage('system', envelope.payload.error?.message ?? 'Tool call failed.');
      if (envelope.payload.id === activeProviderInvocationId) {
        clearActiveProvider();
      }
      return;
    }

    handleToolResult(envelope.payload.result);
  }
}

function handleToolResult(result) {
  if (result.providerInvocation) {
    if (result.invocationId === activeProviderInvocationId) {
      clearActiveProvider();
    }

    for (const event of result.events ?? []) {
      if (event.type === 'agent.delta') {
        appendMessage('assistant', event.payload?.text ?? '');
      }
    }

    for (const toolResult of result.toolResults ?? []) {
      if (!toolResult.ok) {
        appendMessage('system', toolResult.error?.message ?? 'Provider tool call failed.');
      } else {
        handleToolResult(toolResult.result);
      }
    }
    return;
  }

  if (result.cancelled) {
    clearActiveProvider();
    appendMessage('assistant', 'Provider request cancelled.');
    return;
  }

  if (result.provider && typeof result.available === 'boolean') {
    providerStatusEl.textContent = `${result.provider}: ${result.status}`;
    providerStatusEl.dataset.status = result.status;
    return;
  }

  if (result.requiresApproval) {
    renderReview(result.review);
    patchDiffEl.textContent = result.diff || 'No file changes.';
    patchReviewEl.hidden = false;
    approvePatchButtonEl.disabled = result.changedFiles?.length === 0;
    appendMessage('assistant', `Patch preview ready for ${result.changedFiles?.length ?? 0} files.`);
    return;
  }

  if (result.canceled) {
    hidePatchReview();
    appendMessage('assistant', 'Patch canceled.');
    return;
  }

  if (result.rolledBack) {
    hidePatchReview();
    renderReview(result.review);
    renderArtifacts(result.files);
    appendMessage(
      'system',
      `Patch validation failed (${result.validation?.erc?.errorCount ?? 0} ERC errors). Changes were rolled back.`
    );
    return;
  }

  if (result.applied) {
    hidePatchReview();
    renderReview(result.review);
    renderArtifacts(result.files);
    appendMessage('assistant', `Patch applied. ${reviewStatusText(result.review)}. ERC ${result.validation?.ok ? 'passed' : 'did not pass'}.`);
    return;
  }

  renderReview(result.review);
  appendMessage('assistant', `${result.spec.mcu.family} draft generated.`);
  renderArtifacts(result.files);
}

function hidePatchReview() {
  pendingPatch = null;
  patchDiffEl.textContent = '';
  patchReviewEl.hidden = true;
  approvePatchButtonEl.disabled = false;
}

function clearActiveProvider() {
  activeProviderInvocationId = null;
  setProviderBusy(false);
}

function setProviderBusy(isBusy) {
  cancelProviderButtonEl.disabled = !isBusy;
  providerEl.disabled = isBusy;
}

function renderArtifacts(files) {
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
  if (!review) return 'Review pending';
  if (review.statusLabel) return review.statusLabel;

  switch (review.status) {
    case 'ready-for-release':
      return 'Ready for release';
    case 'ready-for-prototype-review':
      return 'Ready for prototype review';
    default:
      return 'Blocked';
  }
}

function renderFindingList(listEl, findings = []) {
  listEl.replaceChildren();

  for (const finding of findings) {
    const item = document.createElement('li');
    item.textContent = finding.message ?? String(finding);
    listEl.append(item);
  }

  if (findings.length === 0) {
    const item = document.createElement('li');
    item.textContent = 'None';
    listEl.append(item);
  }
}

function renderFixList(listEl, fixes = []) {
  listEl.replaceChildren();

  for (const fix of fixes) {
    const item = document.createElement('li');
    item.textContent = `${fix.title}: ${fix.summary}`;
    listEl.append(item);
  }

  if (fixes.length === 0) {
    const item = document.createElement('li');
    item.textContent = 'No fixes proposed';
    listEl.append(item);
  }
}

function appendMessage(kind, text) {
  const node = document.createElement('article');
  node.className = `message ${kind}`;
  node.textContent = text;
  logEl.append(node);
  logEl.scrollTop = logEl.scrollHeight;
}
