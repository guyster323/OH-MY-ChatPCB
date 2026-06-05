import http from 'node:http';
import { createHash } from 'node:crypto';

import { createEnvelope, parseEnvelope } from './envelope.js';
import { generateMcuPeripheralProject } from '../workflow/generate-mcu-project.js';
import { simulateProject } from '../workflow/simulate-project.js';
import { validateProject } from '../workflow/validate-project.js';

export async function dispatchToolCall(call) {
  if (!call || typeof call !== 'object') {
    return failure('INVALID_TOOL_CALL', 'Tool call must be an object.');
  }

  switch (call.name) {
    case 'schematic.generate':
    case 'project.create':
      return ok(
        await generateMcuPeripheralProject({
          projectDir: call.args?.projectDir,
          prompt: call.args?.prompt,
          projectName: call.args?.projectName
        })
      );

    case 'validate.erc':
      return ok(await validateProject({ projectDir: call.args?.projectDir, kicadCliPath: call.args?.kicadCliPath }));

    case 'simulate.spice':
      return ok(await simulateProject({ projectDir: call.args?.projectDir, ngspicePath: call.args?.ngspicePath }));

    default:
      return failure('UNKNOWN_TOOL', `Unknown ChatPCB tool: ${call.name}`);
  }
}

export async function startDaemon({ host = '127.0.0.1', port = 41317 } = {}) {
  const clients = new Set();

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
        sendJson(response, 200, await dispatchToolCall(body));
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
              ...(await dispatchToolCall(envelope.payload))
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

  await new Promise((resolve) => server.listen(port, host, resolve));

  return {
    host,
    port,
    url: `http://${host}:${server.address().port}`,
    server,
    close: () =>
      new Promise((resolve, reject) => {
        for (const client of clients) {
          client.destroy();
        }
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
  const header = data.length < 126 ? Buffer.from([0x81, data.length]) : Buffer.from([0x81, 126, data.length >> 8, data.length & 0xff]);
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
