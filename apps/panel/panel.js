const DAEMON_WS_URL = window.CHATPCB_DAEMON_WS_URL ?? 'ws://127.0.0.1:41317/ws';

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
  if (!activeProject || !promptEl.value.trim()) return;

  const status = await requestHostProjectStatus();
  if (status?.dirty) {
    showConflict();
    return;
  }

  conflictCardEl.hidden = true;
  renderRequestStatus({ state: 'running', summary: 'Running request…' });
  const id = `project_request_${Date.now()}`;
  activeRequestId = id;
  pendingCalls.set(id, 'project.request');
  sendToolCall({
    id,
    name: 'project.request',
    args: { projectDir: activeProject.projectDir, prompt: promptEl.value.trim(), provider: providerEl.value }
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
  }
}

function handleEnvelope(envelope) {
  if (envelope.type !== 'tool.result') return;
  const id = envelope.payload.id;
  const callName = pendingCalls.get(id) ?? (activeRequestId ? 'project.request' : activeProjectCreateId ? 'project.create' : undefined);
  pendingCalls.delete(id);

  if (!envelope.payload.ok) {
    if (callName === 'project.create' || callName === 'project.request') {
      if (callName === 'project.create') pendingCalls.delete(activeProjectCreateId);
      if (callName === 'project.request') pendingCalls.delete(activeRequestId);
      activeRequestId = null;
      activeProjectCreateId = null;
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
    activeRequestId = null;
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
  activeProject = project;
  activeProjectNameEl.textContent = project.displayName;
  activeProjectDirectoryEl.textContent = project.projectDir;
  activeProjectEl.hidden = false;
  promptEl.disabled = false;
  sendButtonEl.disabled = false;
  projectNameEl.value = '';
  renderRequestStatus({ state: 'ready', summary: 'Project ready. Describe the circuit you want to create.' });
}

function renderProjectRequest(result) {
  renderReview(result.review);
  renderArtifacts(result.files);
  renderValidation({ ...result.validation, completedAt: new Date().toISOString() });
  renderRequestStatus({ state: result.rolledBack ? 'failed' : 'completed', summary: result.rolledBack ? 'Completed with validation issues; the previous project files were restored.' : `Completed: ${result.operation === 'patched' ? 'Updated project.' : 'Generated project.'}` });

  const projectFile = findProjectFile(result.files);
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

function renderValidation({ erc, skipped, reason, completedAt }) {
  validationStatusEl.dataset.state = skipped ? 'unavailable' : erc?.errorCount === 0 ? 'passed' : 'failed';
  validationStatusEl.textContent = skipped ? reason : `${erc?.errorCount ?? 0} errors, ${erc?.warningCount ?? 0} warnings`;
  validationTimestampEl.textContent = completedAt ?? '';
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
  kiCadFallbackEl.textContent = `Open the project from KiCad using this directory: ${projectFile}. The browser panel cannot reload KiCad.`;
  kiCadFallbackEl.hidden = false;
}

async function requestHostProjectStatus() {
  const host = window.chatpcbHost;
  const message = { type: 'project.status', projectPath: activeProject.projectDir };
  if (typeof host?.getProjectStatus === 'function') return host.getProjectStatus(message);
  postHostMessage(message);
  return null;
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
  if (message.type === 'project.status' && (message.dirty === true || message.unsavedChanges === true)) {
    showConflict();
    return;
  }
  if (message.type === 'project.reload' && message.completed === true) {
    renderKiCadLink({ linkState: 'reloaded', projectPath: findProjectFileFromList() ?? activeProject.projectDir });
  }
}

function showConflict() {
  conflictCardEl.hidden = false;
  renderKiCadLink({ linkState: 'conflict', projectPath: activeProject.projectDir, dirty: true });
}
