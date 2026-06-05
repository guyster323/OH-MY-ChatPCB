const DAEMON_WS_URL = 'ws://127.0.0.1:41317/ws';

const statusEl = document.querySelector('#connection-status');
const logEl = document.querySelector('#chat-log');
const formEl = document.querySelector('#composer');
const promptEl = document.querySelector('#prompt');
const projectEl = document.querySelector('#project-dir');
const artifactListEl = document.querySelector('#artifact-list');
const generateButtonEl = document.querySelector('#generate-button');

let socket;

connect();

formEl.addEventListener('submit', (event) => {
  event.preventDefault();
  sendGenerate();
});

generateButtonEl.addEventListener('click', () => sendGenerate());

function connect() {
  socket = new WebSocket(DAEMON_WS_URL);

  socket.addEventListener('open', () => {
    statusEl.textContent = 'Connected';
    appendMessage('system', 'chatpcb-agentd connected.');
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
      return;
    }

    const result = envelope.payload.result;
    appendMessage('assistant', `${result.spec.mcu.family} draft generated.`);
    renderArtifacts(result.files);
  }
}

function renderArtifacts(files) {
  artifactListEl.replaceChildren();
  for (const [kind, file] of Object.entries(files)) {
    const item = document.createElement('li');
    item.textContent = `${kind}: ${file}`;
    artifactListEl.append(item);
  }
}

function appendMessage(kind, text) {
  const node = document.createElement('article');
  node.className = `message ${kind}`;
  node.textContent = text;
  logEl.append(node);
  logEl.scrollTop = logEl.scrollHeight;
}
