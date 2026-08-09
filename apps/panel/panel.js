const DAEMON_WS_URL = window.CHATPCB_DAEMON_WS_URL ?? 'ws://127.0.0.1:41317/ws';
const HOST_STATUS_TIMEOUT_MS = 500;

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
const requestTechnicalDetailsEl = document.querySelector('#request-technical-details');
const requestTechnicalDetailEl = document.querySelector('#request-technical-detail');
const conflictCardEl = document.querySelector('#conflict-card');
const artifactListEl = document.querySelector('#artifact-list');
const reviewPanelEl = document.querySelector('#review-panel');
const reviewStatusEl = document.querySelector('#review-status');
const reviewBlockersEl = document.querySelector('#review-blockers');
const reviewWarningsEl = document.querySelector('#review-warnings');
const reviewNotesEl = document.querySelector('#review-notes');
const reviewFixesEl = document.querySelector('#review-fixes');
const validationStatusEl = document.querySelector('#validation-status');
const validationTimestampEl = document.querySelector('#validation-timestamp');
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
const pendingCalls = new Map();

connect();

newProjectFormEl.addEventListener('submit', (event) => {
  event.preventDefault();
  createProject();
});
formEl.addEventListener('submit', (event) => {
  event.preventDefault();
  sendProjectRequest();
});
providerEl.addEventListener('change', refreshProviderStatus);
openKiCadButtonEl.addEventListener('click', openInKiCad);
window.addEventListener('message', (event) => handleHostMessage(event.data));

function connect() {
  socket = new WebSocket(DAEMON_WS_URL);
  socket.addEventListener('open', () => {
    statusEl.textContent = 'Connected';
    refreshProviderStatus();
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
  if (!activeProject || !promptEl.value.trim() || activeRequestId || pendingHostStatus) return;

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
  if (status?.dirty) {
    showConflict();
    setRequestBusy(false);
    return;
  }

  conflictCardEl.hidden = true;
  renderRequestStatus({ state: 'running', summary: 'Running request…' });
  const id = `project_request_${Date.now()}`;
  activeRequestId = id;
  activeRequestProjectDir = requestProject.projectDir;
  pendingCalls.set(id, 'project.request');
  sendToolCall({
    id,
    name: 'project.request',
    args: { projectDir: requestProject.projectDir, prompt: promptEl.value.trim(), provider: providerEl.value }
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
  if (envelope.type !== 'tool.result') return;
  const id = envelope.payload.id;
  const callName = pendingCalls.get(id) ?? (activeRequestId ? 'project.request' : activeProjectCreateId ? 'project.create' : undefined);
  pendingCalls.delete(id);

  if (!envelope.payload.ok) {
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
      }
      renderRequestStatus({
        state: 'failed',
        summary: '요청을 처리하지 못했습니다. 다시 시도하거나 기술 상세를 확인하세요.',
        technicalDetail: envelope.payload.error?.message ?? 'Tool call failed.'
      });
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
    return;
  }
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
  setRequestBusy(Boolean(activeRequestId));
  projectNameEl.value = '';
  renderRequestStatus({ state: 'ready', summary: 'Project ready. Describe the circuit you want to create.' });
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
  conflictCardEl.hidden = true;
  kiCadLinkCardEl.hidden = true;
  kiCadLinkEl.dataset.state = 'available';
  kiCadLinkEl.textContent = '';
  kiCadFallbackEl.hidden = true;
  kiCadFallbackEl.textContent = '';
}

function renderProjectRequest(result) {
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
  renderRequestStatus({ state: requestFailed ? 'failed' : 'completed', summary });

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

function renderRequestStatus({ state, summary, technicalDetail = '' }) {
  requestStatusEl.dataset.state = state;
  requestStatusEl.textContent = summary;
  requestTechnicalDetailEl.textContent = technicalDetail;
  requestTechnicalDetailsEl.hidden = technicalDetail.length === 0;
}

function renderValidation({ ok, erc, skipped, reason, completedAt, exitCode, stderr, formatUpgrade } = {}) {
  const reasonText = validationReason({ reason, exitCode, stderr, formatUpgrade });
  const counts = `${erc?.errorCount ?? 0} errors, ${erc?.warningCount ?? 0} warnings`;

  if (skipped) {
    const unavailable = reason?.code === 'KICAD_CLI_UNAVAILABLE';
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

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (pendingHostStatus?.projectPath !== message.projectPath) return;
      pendingHostStatus = null;
      resolve({ unavailable: true });
    }, HOST_STATUS_TIMEOUT_MS);
    pendingHostStatus = { projectPath: message.projectPath, resolve, timeout };
    postHostMessage(message);
  });
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
  if (!message || typeof message !== 'object' || message.projectPath !== activeProject?.projectDir) return;
  if (message.type === 'project.status') {
    const dirty = message.dirty === true || message.unsavedChanges === true;
    if (dirty || message.linkState === 'conflict') {
      showConflict();
    } else {
      conflictCardEl.hidden = true;
      if (typeof message.linkState === 'string') {
        renderKiCadLink({ linkState: message.linkState, projectPath: findProjectFileFromList() ?? activeProject.projectDir });
      }
    }
    if (pendingHostStatus?.projectPath === message.projectPath) {
      clearTimeout(pendingHostStatus.timeout);
      const { resolve } = pendingHostStatus;
      pendingHostStatus = null;
      resolve({ dirty, linkState: message.linkState });
    }
    return;
  }
  if (message.type === 'project.reload') {
    if (message.linkState === 'conflict') {
      showConflict();
      return;
    }
    const linkState = typeof message.linkState === 'string'
      ? message.linkState
      : message.completed === true
        ? 'reloaded'
        : 'error';
    renderKiCadLink({ linkState, projectPath: findProjectFileFromList() ?? activeProject.projectDir });
  }
}

function showConflict() {
  conflictCardEl.hidden = false;
  renderKiCadLink({ linkState: 'conflict', projectPath: activeProject.projectDir, dirty: true });
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
