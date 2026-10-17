import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import test from 'node:test';

import { MAX_PENDING_SOCKET_MESSAGES, startDaemon } from '../src/runtime/agent-daemon.js';
import { attachWebSocketFrameHandler, MAX_WEBSOCKET_MESSAGE_BYTES } from '../src/runtime/ws-frames.js';
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const unhandledRejections = [];
process.on('unhandledRejection', (reason) => {
  unhandledRejections.push(reason);
});

function wsTest(name, fn, timeout = 15000) {
  test(name, { timeout }, fn);
}

function envelope({ id, name = 'provider.list', args = {}, createdAt = '2026-01-01T00:00:00.000Z' }) {
  return {
    version: 1,
    id: `evt_${id}`,
    type: 'tool.call',
    createdAt,
    payload: { id, name, args }
  };
}

function sizedToolText(id, size) {
  const withPad = (pad) => JSON.stringify(envelope({
    id,
    createdAt: 'Z',
    args: { pad }
  }));
  const need = size - Buffer.byteLength(withPad(''));
  if (need < 0) {
    throw new Error(`Envelope shell for "${id}" is larger than ${size} bytes.`);
  }
  const text = withPad('x'.repeat(need));
  if (Buffer.byteLength(text) !== size) {
    throw new Error(`Sized envelope is ${Buffer.byteLength(text)} bytes, expected ${size}.`);
  }
  return text;
}

function encodeClientFrame(opcode, payload, { fin = true, masked = true, rsv1 = false, rsv2 = false, rsv3 = false } = {}) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const byte0 = (fin ? 0x80 : 0x00)
    | (rsv1 ? 0x40 : 0x00)
    | (rsv2 ? 0x20 : 0x00)
    | (rsv3 ? 0x10 : 0x00)
    | (opcode & 0x0f);
  const maskBit = masked ? 0x80 : 0x00;
  let header;
  if (data.length < 126) {
    header = Buffer.from([byte0, maskBit | data.length]);
  } else if (data.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = byte0;
    header[1] = maskBit | 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = byte0;
    header[1] = maskBit | 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  if (!masked) return Buffer.concat([header, data]);
  const mask = crypto.randomBytes(4);
  const maskedPayload = Buffer.alloc(data.length);
  for (let index = 0; index < data.length; index += 1) {
    maskedPayload[index] = data[index] ^ mask[index % 4];
  }
  return Buffer.concat([header, mask, maskedPayload]);
}

function encodeTextFrame(value, options) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return encodeClientFrame(0x1, Buffer.from(text), options);
}

function assertLengthEncoding(frame, payloadLength) {
  const marker = frame[1] & 0x7f;
  if (payloadLength < 126) {
    assert.equal(marker, payloadLength);
    return;
  }
  if (payloadLength <= 0xffff) {
    assert.equal(marker, 126);
    assert.equal(frame.readUInt16BE(2), payloadLength);
    return;
  }
  assert.equal(marker, 127);
  assert.equal(frame.readBigUInt64BE(2), BigInt(payloadLength));
}

function frameLayout(frame) {
  const marker = frame[1] & 0x7f;
  const extended = marker === 126 ? 2 : marker === 127 ? 8 : 0;
  const header = 2 + extended;
  const masked = (frame[1] & 0x80) !== 0;
  return {
    header,
    maskStart: header,
    payloadStart: header + (masked ? 4 : 0)
  };
}

function encodeCloseFrame(code, reason = '') {
  const text = Buffer.from(reason);
  const payload = Buffer.alloc(2 + text.length);
  payload.writeUInt16BE(code, 0);
  text.copy(payload, 2);
  return encodeClientFrame(0x8, payload);
}

function readServerFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const fin = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    let length = second & 0x7f;
    let header = 2;
    if (length === 126) {
      if (buffer.length - offset < 4) break;
      length = buffer.readUInt16BE(offset + 2);
      header = 4;
    } else if (length === 127) {
      if (buffer.length - offset < 10) break;
      const extended = buffer.readBigUInt64BE(offset + 2);
      if (extended > BigInt(MAX_WEBSOCKET_MESSAGE_BYTES + 1024)) {
        throw new Error(`Server frame length ${extended} is unexpected.`);
      }
      length = Number(extended);
      header = 10;
    }
    const masked = (second & 0x80) !== 0;
    const maskLength = masked ? 4 : 0;
    if (buffer.length - offset < header + maskLength + length) break;
    let cursor = offset + header;
    const mask = masked ? buffer.subarray(cursor, cursor + 4) : null;
    if (masked) cursor += 4;
    const payload = Buffer.alloc(length);
    for (let index = 0; index < length; index += 1) {
      payload[index] = buffer[cursor + index] ^ (mask ? mask[index % 4] : 0);
    }
    frames.push({ fin, opcode, payload });
    offset = cursor + length;
  }
  return { frames, rest: buffer.subarray(offset) };
}

function createClient(socket) {
  const client = {
    socket,
    buffer: Buffer.alloc(0),
    frames: [],
    upgradeHeaders: '',
    upgraded: false,
    ended: false,
    errors: []
  };
  socket.on('data', (chunk) => {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    if (!client.upgraded) {
      const splitAt = client.buffer.indexOf('\r\n\r\n');
      if (splitAt < 0) return;
      client.upgradeHeaders = client.buffer.subarray(0, splitAt).toString('utf8');
      client.buffer = client.buffer.subarray(splitAt + 4);
      client.upgraded = true;
    }
    const parsed = readServerFrames(client.buffer);
    client.frames.push(...parsed.frames);
    client.buffer = parsed.rest.length === 0 ? Buffer.alloc(0) : parsed.rest;
  });
  socket.on('end', () => {
    client.ended = true;
  });
  socket.on('close', () => {
    client.ended = true;
  });
  socket.on('error', (error) => {
    client.errors.push(error);
  });
  return client;
}

function waitFor(predicate, timeoutMs = 2000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      let matched;
      try {
        matched = Boolean(predicate());
      } catch (error) {
        reject(error);
        return;
      }
      if (matched) {
        resolve();
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        reject(new Error(`Timed out after ${timeoutMs}ms.`));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
}

function yieldToServer() {
  return new Promise((resolve) => {
    setImmediate(() => {
      setImmediate(resolve);
    });
  });
}

function writeBuffer(socket, buffer) {
  return new Promise((resolve, reject) => {
    socket.write(buffer, (error) => (error ? reject(error) : resolve()));
  });
}

async function writeParts(socket, parts) {
  for (let index = 0; index < parts.length; index += 1) {
    if (index > 0) await yieldToServer();
    await writeBuffer(socket, parts[index]);
  }
}

async function connect(port) {
  const key = crypto.randomBytes(16).toString('base64');
  const expectedAccept = crypto.createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');
  const socket = net.connect(port, '127.0.0.1');
  socket.setNoDelay(true);
  const client = createClient(socket);
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.once('connect', resolve);
  });
  await writeBuffer(socket, [
    'GET /ws HTTP/1.1',
    'Host: 127.0.0.1',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Key: ${key}`,
    'Sec-WebSocket-Version: 13',
    '',
    ''
  ].join('\r\n'));
  await waitFor(() => client.upgraded && client.frames.some((frame) => frame.opcode === 0x1));
  assert.match(client.upgradeHeaders, /^HTTP\/1\.1 101 /);
  assert.ok(client.upgradeHeaders.includes(`Sec-WebSocket-Accept: ${expectedAccept}`));
  const status = JSON.parse(client.frames.find((frame) => frame.opcode === 0x1).payload.toString('utf8'));
  assert.equal(status.type, 'system.status');
  assert.equal(status.payload.service, 'chatpcb-agentd');
  return client;
}

function toolResults(client) {
  const results = [];
  for (const frame of client.frames) {
    if (frame.opcode !== 0x1) continue;
    let message;
    try {
      message = JSON.parse(frame.payload.toString('utf8'));
    } catch {
      continue;
    }
    if (message.type === 'tool.result') results.push(message.payload);
  }
  return results;
}

function closeFrames(client) {
  return client.frames.filter((frame) => frame.opcode === 0x8);
}

async function expectOkIds(client, ids, timeoutMs = 2000) {
  await waitFor(() => toolResults(client).length >= ids.length, timeoutMs);
  const results = toolResults(client);
  assert.deepEqual(results.map((result) => result.id), ids, JSON.stringify(results));
  for (const result of results) {
    assert.equal(result.ok, true, JSON.stringify(result));
  }
  return results;
}

async function withDaemon(dispatchOptions, fn) {
  const rejectionsBefore = unhandledRejections.length;
  const daemon = await startDaemon({ port: 0, dispatchOptions });
  const clients = [];
  try {
    const open = async () => {
      const client = await connect(daemon.port);
      clients.push(client);
      return client;
    };
    await fn(daemon, open);
    assert.equal(
      unhandledRejections.length,
      rejectionsBefore,
      `Unhandled rejection: ${unhandledRejections.slice(rejectionsBefore).map((reason) => reason?.stack || reason?.message || String(reason)).join('\n')}`
    );
  } finally {
    for (const client of clients) {
      if (!client.socket.destroyed) client.socket.destroy();
    }
    await daemon.close();
  }
}

async function sendCalls(client, calls) {
  const frames = calls.map((call) => encodeTextFrame(envelope(call)));
  await writeBuffer(client.socket, Buffer.concat(frames));
}

async function assertStillServing(daemon, open, id) {
  const health = await fetch(`${daemon.url}/health`).then((response) => response.json());
  assert.equal(health.ok, true);
  const other = await open();
  await sendCalls(other, [{ id }]);
  await expectOkIds(other, [id]);
}

async function expectProtocolClose(daemon, open, frame, code, id, timeoutMs = 2000) {
  const client = await open();
  await writeBuffer(client.socket, frame);
  await waitFor(() => closeFrames(client).length > 0, timeoutMs);
  const close = closeFrames(client)[0];
  assert.ok(close.payload.length >= 2);
  assert.equal(close.payload.readUInt16BE(0), code);
  assert.equal(toolResults(client).length, 0);
  await assertStillServing(daemon, open, id);
  return close;
}

function encodeNonMinimalFrame(payloadLength, width) {
  const data = Buffer.alloc(payloadLength, 0x78);
  const mask = crypto.randomBytes(4);
  const maskedPayload = Buffer.alloc(payloadLength);
  for (let index = 0; index < payloadLength; index += 1) {
    maskedPayload[index] = data[index] ^ mask[index % 4];
  }
  const header = width === 16 ? Buffer.alloc(4) : Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 0x80 | (width === 16 ? 126 : 127);
  if (width === 16) header.writeUInt16BE(payloadLength, 2);
  else header.writeBigUInt64BE(BigInt(payloadLength), 2);
  return Buffer.concat([header, mask, maskedPayload]);
}

function fastDispatch() {
  return {
    checkProviderAvailabilityImpl: async ({ provider }) => ({
      provider,
      command: provider,
      available: true,
      status: 'available'
    }),
    inspectProjectImpl: async ({ projectDir }) => ({ projectDir, inspected: true })
  };
}

wsTest('two frames in one write both get tool results in order', async () => {
  await withDaemon(fastDispatch(), async (_daemon, open) => {
    const client = await open();
    await sendCalls(client, [
      { id: 'a' },
      { id: 'b' }
    ]);
    await expectOkIds(client, ['a', 'b']);
  });
});

wsTest('three frames in one write all get tool results in order', async () => {
  await withDaemon(fastDispatch(), async (_daemon, open) => {
    const client = await open();
    await sendCalls(client, [
      { id: 'a' },
      { id: 'b' },
      { id: 'c' }
    ]);
    await expectOkIds(client, ['a', 'b', 'c']);
  });
});

wsTest('two frames in separate writes both get tool results', async () => {
  await withDaemon(fastDispatch(), async (_daemon, open) => {
    const client = await open();
    await writeBuffer(client.socket, encodeTextFrame(envelope({ id: 'a' })));
    await yieldToServer();
    await writeBuffer(client.socket, encodeTextFrame(envelope({ id: 'b' })));
    await expectOkIds(client, ['a', 'b']);
  });
});

wsTest('a frame whose 2-byte header is split across writes is answered once', async () => {
  await withDaemon(fastDispatch(), async (_daemon, open) => {
    const client = await open();
    const frame = encodeTextFrame(envelope({ id: 'hdr' }));
    assert.ok(frame.length > 2);
    await writeParts(client.socket, [frame.subarray(0, 1), frame.subarray(1)]);
    await expectOkIds(client, ['hdr']);
  });
});

wsTest('a 16-bit length header split across writes is answered once', async () => {
  await withDaemon(fastDispatch(), async (_daemon, open) => {
    const client = await open();
    const text = sizedToolText('h', 126);
    const frame = encodeTextFrame(text);
    assertLengthEncoding(frame, 126);
    await writeParts(client.socket, [frame.subarray(0, 3), frame.subarray(3)]);
    await expectOkIds(client, ['h']);
  });
});

wsTest('a 64-bit length header split across writes is answered once', async () => {
  await withDaemon(fastDispatch(), async (_daemon, open) => {
    const client = await open();
    const text = sizedToolText('wide', 65536);
    const frame = encodeTextFrame(text);
    assertLengthEncoding(frame, 65536);
    await writeParts(client.socket, [frame.subarray(0, 6), frame.subarray(6)]);
    await expectOkIds(client, ['wide'], 4000);
  });
});

wsTest('a masking key split across writes is answered once', async () => {
  await withDaemon(fastDispatch(), async (_daemon, open) => {
    const client = await open();
    const frame = encodeTextFrame(sizedToolText('m', 125));
    const layout = frameLayout(frame);
    assert.equal(frame[1] & 0x80, 0x80);
    assert.equal(layout.maskStart, 2);
    await writeParts(client.socket, [
      frame.subarray(0, layout.maskStart + 2),
      frame.subarray(layout.maskStart + 2)
    ]);
    await expectOkIds(client, ['m']);
  });
});

wsTest('a payload split across writes is answered once', async () => {
  await withDaemon(fastDispatch(), async (_daemon, open) => {
    const client = await open();
    const frame = encodeTextFrame(envelope({ id: 'pay' }));
    const { payloadStart } = frameLayout(frame);
    assert.ok(frame.length > payloadStart + 4);
    await writeParts(client.socket, [
      frame.subarray(0, payloadStart + 3),
      frame.subarray(payloadStart + 3)
    ]);
    await expectOkIds(client, ['pay']);
  });
});

wsTest('one frame written a byte at a time is answered once', async () => {
  await withDaemon(fastDispatch(), async (_daemon, open) => {
    const client = await open();
    const frame = encodeTextFrame(envelope({ id: 'byte' }));
    const parts = [];
    for (let index = 0; index < frame.length; index += 1) {
      parts.push(frame.subarray(index, index + 1));
    }
    await writeParts(client.socket, parts);
    await expectOkIds(client, ['byte'], 4000);
  });
});

wsTest('three frames with the last one partial then completed stay in order', async () => {
  await withDaemon(fastDispatch(), async (_daemon, open) => {
    const client = await open();
    const first = encodeTextFrame(envelope({ id: 'a' }));
    const second = encodeTextFrame(envelope({ id: 'b' }));
    const third = encodeTextFrame(envelope({ id: 'c' }));
    const partial = 5;
    assert.ok(third.length > partial + 1);
    await writeBuffer(client.socket, Buffer.concat([first, second, third.subarray(0, partial)]));
    await yieldToServer();
    await waitFor(() => toolResults(client).length >= 2);
    assert.deepEqual(toolResults(client).map((result) => result.id), ['a', 'b']);
    await writeBuffer(client.socket, third.subarray(partial));
    await expectOkIds(client, ['a', 'b', 'c']);
  });
});

wsTest('a 125-byte payload uses the 7-bit length and is answered', async () => {
  await withDaemon(fastDispatch(), async (_daemon, open) => {
    const client = await open();
    const text = sizedToolText('a', 125);
    const frame = encodeTextFrame(text);
    assertLengthEncoding(frame, 125);
    await writeBuffer(client.socket, Buffer.concat([
      frame,
      encodeTextFrame(envelope({ id: 'after125' }))
    ]));
    await expectOkIds(client, ['a', 'after125']);
  });
});

wsTest('a 126-byte payload uses the 16-bit length and is answered', async () => {
  await withDaemon(fastDispatch(), async (_daemon, open) => {
    const client = await open();
    const frame = encodeTextFrame(sizedToolText('b', 126));
    assertLengthEncoding(frame, 126);
    await writeBuffer(client.socket, Buffer.concat([
      frame,
      encodeTextFrame(envelope({ id: 'after126' }))
    ]));
    await expectOkIds(client, ['b', 'after126']);
  });
});

wsTest('a 65535-byte payload uses the 16-bit length and is answered', async () => {
  await withDaemon(fastDispatch(), async (_daemon, open) => {
    const client = await open();
    const frame = encodeTextFrame(sizedToolText('n65535', 65535));
    assertLengthEncoding(frame, 65535);
    await writeBuffer(client.socket, Buffer.concat([
      frame,
      encodeTextFrame(envelope({ id: 'after65535' }))
    ]));
    await expectOkIds(client, ['n65535', 'after65535'], 4000);
  });
});

wsTest('a 65536-byte payload uses the 64-bit length and is answered', async () => {
  await withDaemon(fastDispatch(), async (_daemon, open) => {
    const client = await open();
    const frame = encodeTextFrame(sizedToolText('n65536', 65536));
    assertLengthEncoding(frame, 65536);
    await writeBuffer(client.socket, Buffer.concat([
      frame,
      encodeTextFrame(envelope({ id: 'after65536' }))
    ]));
    await expectOkIds(client, ['n65536', 'after65536'], 4000);
  });
});

wsTest('a 70000-byte 64-bit frame is handled without crashing and the daemon stays up', async () => {
  await withDaemon(fastDispatch(), async (daemon, open) => {
    const client = await open();
    const frame = encodeTextFrame(sizedToolText('big', 70000));
    assertLengthEncoding(frame, 70000);
    await writeBuffer(client.socket, frame);
    await expectOkIds(client, ['big'], 4000);
    await writeBuffer(client.socket, encodeTextFrame(envelope({ id: 'after70k' })));
    await expectOkIds(client, ['big', 'after70k']);
    const health = await fetch(`${daemon.url}/health`).then((response) => response.json());
    assert.equal(health.ok, true);
    const other = await open();
    await sendCalls(other, [{ id: 'alive' }]);
    await expectOkIds(other, ['alive']);
  });
});

wsTest('a 16-bit frame and a small frame in one chunk are both answered', async () => {
  await withDaemon(fastDispatch(), async (_daemon, open) => {
    const client = await open();
    await writeBuffer(client.socket, Buffer.concat([
      encodeTextFrame(sizedToolText('wide', 300)),
      encodeTextFrame(envelope({ id: 'small' }))
    ]));
    await expectOkIds(client, ['wide', 'small']);
  });
});

wsTest('a 70000-byte frame and a small frame in one chunk are both answered', async () => {
  await withDaemon(fastDispatch(), async (_daemon, open) => {
    const client = await open();
    await writeBuffer(client.socket, Buffer.concat([
      encodeTextFrame(sizedToolText('big', 70000)),
      encodeTextFrame(envelope({ id: 'small' }))
    ]));
    await expectOkIds(client, ['big', 'small'], 4000);
  });
});

wsTest('a frame over the max size closes with 1009 and other connections still work', async () => {
  await withDaemon(fastDispatch(), async (daemon, open) => {
    const client = await open();
    const declared = MAX_WEBSOCKET_MESSAGE_BYTES + 1;
    const header = Buffer.alloc(14);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(declared), 2);
    crypto.randomBytes(4).copy(header, 10);
    await writeBuffer(client.socket, Buffer.concat([header, Buffer.from([0x00])]));
    await waitFor(() => closeFrames(client).length > 0);
    const close = closeFrames(client)[0];
    assert.ok(close.payload.length >= 2);
    assert.equal(close.payload.readUInt16BE(0), 1009);
    const health = await fetch(`${daemon.url}/health`).then((response) => response.json());
    assert.equal(health.ok, true);
    const other = await open();
    await sendCalls(other, [{ id: 'still-up' }]);
    await expectOkIds(other, ['still-up']);
  });
});

wsTest('an unmasked client frame closes with 1002 and the daemon keeps serving', async () => {
  await withDaemon(fastDispatch(), async (daemon, open) => {
    const client = await open();
    await writeBuffer(client.socket, encodeTextFrame(envelope({ id: 'bare' }), { masked: false }));
    await waitFor(() => closeFrames(client).length > 0);
    assert.equal(closeFrames(client)[0].payload.readUInt16BE(0), 1002);
    assert.equal(toolResults(client).length, 0);
    const health = await fetch(`${daemon.url}/health`).then((response) => response.json());
    assert.equal(health.ok, true);
    const other = await open();
    await sendCalls(other, [{ id: 'after-unmasked' }]);
    await expectOkIds(other, ['after-unmasked']);
  });
});

wsTest('fragmented text plus continuation frames are reassembled', async () => {
  await withDaemon(fastDispatch(), async (_daemon, open) => {
    const client = await open();
    const text = JSON.stringify(envelope({ id: 'frag' }));
    const bytes = Buffer.from(text);
    assert.ok(bytes.length > 24);
    const parts = [bytes.subarray(0, 8), bytes.subarray(8, 17), bytes.subarray(17)];
    for (const part of parts) {
      assert.throws(() => JSON.parse(part.toString('utf8')));
    }
    await writeBuffer(client.socket, Buffer.concat([
      encodeClientFrame(0x1, parts[0], { fin: false }),
      encodeClientFrame(0x0, parts[1], { fin: false }),
      encodeClientFrame(0x0, parts[2], { fin: true })
    ]));
    await expectOkIds(client, ['frag']);
  });
});

wsTest('a ping is answered with a pong that carries the same payload', async () => {
  await withDaemon(fastDispatch(), async (_daemon, open) => {
    const client = await open();
    const payload = Buffer.from([0x00, 0x7f, 0x81, 0xff, 0x10, 0x20]);
    await writeBuffer(client.socket, encodeClientFrame(0x9, payload));
    await waitFor(() => client.frames.some((frame) => frame.opcode === 0xA));
    const pong = client.frames.find((frame) => frame.opcode === 0xA);
    assert.equal(pong.fin, true);
    assert.deepEqual(pong.payload, payload);
    await sendCalls(client, [{ id: 'after-ping' }]);
    await expectOkIds(client, ['after-ping']);
  });
});

wsTest('a client close is echoed and the daemon keeps serving', async () => {
  await withDaemon(fastDispatch(), async (daemon, open) => {
    const client = await open();
    await writeBuffer(client.socket, encodeCloseFrame(1000, 'bye'));
    await waitFor(() => closeFrames(client).length > 0);
    const close = closeFrames(client)[0];
    assert.equal(close.payload.readUInt16BE(0), 1000);
    assert.equal(close.payload.subarray(2).toString('utf8'), 'bye');
    const health = await fetch(`${daemon.url}/health`).then((response) => response.json());
    assert.equal(health.ok, true);
    const other = await open();
    await sendCalls(other, [{ id: 'after-close' }]);
    await expectOkIds(other, ['after-close']);
  });
});

wsTest('messages on one connection stay ordered while a handler is still running', async () => {
  const events = [];
  let releaseSlow;
  const slowGate = new Promise((resolve) => {
    releaseSlow = resolve;
  });
  await withDaemon({
    checkProviderAvailabilityImpl: async ({ provider }) => {
      events.push(`start:${provider}`);
      if (provider === 'slow') await slowGate;
      events.push(`end:${provider}`);
      return { provider, available: true, status: 'available' };
    }
  }, async (_daemon, open) => {
    const client = await open();
    const other = await open();
    await sendCalls(client, [
      { id: 'slow', name: 'provider.status', args: { provider: 'slow' } },
      { id: 'fast', name: 'provider.status', args: { provider: 'fast' } }
    ]);
    await waitFor(() => events.includes('start:slow'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(events, ['start:slow']);
    await sendCalls(other, [{ id: 'other' }]);
    await expectOkIds(other, ['other']);
    assert.deepEqual(events, ['start:slow']);
    releaseSlow();
    await expectOkIds(client, ['slow', 'fast']);
    assert.deepEqual(events, ['start:slow', 'end:slow', 'start:fast', 'end:fast']);
  });
});

wsTest('a throwing handler does not kill the connection or the daemon', async () => {
  let calls = 0;
  await withDaemon({
    checkProviderAvailabilityImpl: async () => {
      calls += 1;
      if (calls === 1) throw new Error('handler exploded');
      return { provider: 'codex', available: true, status: 'available' };
    }
  }, async (daemon, open) => {
    const client = await open();
    await sendCalls(client, [
      { id: 'boom', name: 'provider.status', args: { provider: 'codex' } },
      { id: 'next', name: 'provider.status', args: { provider: 'codex' } }
    ]);
    await waitFor(() => toolResults(client).length >= 2);
    const results = toolResults(client);
    assert.equal(results.length, 2);
    assert.equal(results[0].id, 'boom');
    assert.equal(results[0].ok, false);
    assert.equal(results[0].error.code, 'BAD_ENVELOPE');
    assert.match(results[0].error.message, /handler exploded/);
    assert.equal(results[1].id, 'next');
    assert.equal(results[1].ok, true);
    const health = await fetch(`${daemon.url}/health`).then((response) => response.json());
    assert.equal(health.ok, true);
    const other = await open();
    await sendCalls(other, [{ id: 'daemon-alive' }]);
    await expectOkIds(other, ['daemon-alive']);
  });
});

wsTest('a panel burst of provider.status, chatpcb.test.nonexistent-tool, and project.inspect returns three tool results', async () => {
  await withDaemon(fastDispatch(), async (_daemon, open) => {
    const client = await open();
    await sendCalls(client, [
      { id: 'status', name: 'provider.status', args: { provider: 'codex' } },
      { id: 'auth', name: 'chatpcb.test.nonexistent-tool', args: {} },
      { id: 'inspect', name: 'project.inspect', args: { projectDir: '/tmp/chatpcb-ws-panel' } }
    ]);
    await waitFor(() => toolResults(client).length >= 3);
    const results = toolResults(client);
    assert.deepEqual(results.map((result) => result.id), ['status', 'auth', 'inspect']);
    assert.equal(results[0].ok, true);
    assert.equal(results[0].result.status, 'available');
    assert.equal(results[1].ok, false);
    assert.equal(results[1].error.code, 'UNKNOWN_TOOL');
    assert.equal(results[2].ok, true);
    assert.equal(results[2].result.projectDir, '/tmp/chatpcb-ws-panel');
  });
});

wsTest('a fragmented message whose total exceeds the max closes with 1009 and the daemon keeps serving', async () => {
  await withDaemon(fastDispatch(), async (daemon, open) => {
    const client = await open();
    const fragmentBytes = 8 * 1024;
    const fragmentCount = Math.floor(MAX_WEBSOCKET_MESSAGE_BYTES / fragmentBytes) + 1;
    assert.ok(fragmentBytes < MAX_WEBSOCKET_MESSAGE_BYTES);
    assert.ok(fragmentBytes * fragmentCount > MAX_WEBSOCKET_MESSAGE_BYTES);
    const piece = Buffer.alloc(fragmentBytes, 0x61);
    let batch = [];
    for (let index = 0; index < fragmentCount; index += 1) {
      batch.push(encodeClientFrame(index === 0 ? 0x1 : 0x0, piece, {
        fin: index === fragmentCount - 1
      }));
      const last = index === fragmentCount - 1;
      if (batch.length === 32 || last) {
        try {
          await writeBuffer(client.socket, Buffer.concat(batch));
        } catch (error) {
          if (!['EPIPE', 'ECONNRESET', 'ERR_STREAM_DESTROYED'].includes(error.code)) throw error;
          break;
        }
        batch = [];
        if (closeFrames(client).length > 0 || client.ended) break;
      }
    }
    await waitFor(() => closeFrames(client).length > 0, 10000);
    assert.equal(closeFrames(client)[0].payload.readUInt16BE(0), 1009);
    assert.equal(toolResults(client).length, 0);
    await assertStillServing(daemon, open, 'after-fragment-cap');
  });
}, 30000);

wsTest('a fragmented ping closes with 1002 and the daemon keeps serving', async () => {
  await withDaemon(fastDispatch(), async (daemon, open) => {
    const client = await open();
    const payload = Buffer.from('frag-ping');
    await writeBuffer(client.socket, encodeClientFrame(0x9, payload, { fin: false }));
    await waitFor(() => closeFrames(client).length > 0);
    assert.equal(closeFrames(client)[0].payload.readUInt16BE(0), 1002);
    assert.equal(client.frames.some((frame) => frame.opcode === 0xA), false);
    await assertStillServing(daemon, open, 'after-frag-ping');
  });
});

wsTest('a 125-byte ping is ponged and a longer control payload closes with 1002', async () => {
  await withDaemon(fastDispatch(), async (daemon, open) => {
    const okClient = await open();
    const okPayload = Buffer.alloc(125, 0x58);
    await writeBuffer(okClient.socket, encodeClientFrame(0x9, okPayload));
    await waitFor(() => okClient.frames.some((frame) => frame.opcode === 0xA));
    const pong = okClient.frames.find((frame) => frame.opcode === 0xA);
    assert.equal(pong.fin, true);
    assert.deepEqual(pong.payload, okPayload);
    assert.equal(closeFrames(okClient).length, 0);

    await expectProtocolClose(
      daemon,
      open,
      encodeClientFrame(0x9, Buffer.alloc(126, 0x59)),
      1002,
      'after-long-ping'
    );
  });
});

wsTest('a stray continuation frame closes with 1002 and the daemon keeps serving', async () => {
  await withDaemon(fastDispatch(), async (daemon, open) => {
    const payload = Buffer.from(JSON.stringify(envelope({ id: 'stray' })));
    await expectProtocolClose(
      daemon,
      open,
      encodeClientFrame(0x0, payload, { fin: true }),
      1002,
      'after-stray'
    );
  });
});

wsTest('a new data frame during a fragmented message closes with 1002 and the daemon keeps serving', async () => {
  await withDaemon(fastDispatch(), async (daemon, open) => {
    const whole = Buffer.from(JSON.stringify(envelope({ id: 'second' })));
    await expectProtocolClose(
      daemon,
      open,
      Buffer.concat([
        encodeClientFrame(0x1, whole.subarray(0, 4), { fin: false }),
        encodeClientFrame(0x1, whole, { fin: true })
      ]),
      1002,
      'after-interrupt'
    );
    await expectProtocolClose(
      daemon,
      open,
      Buffer.concat([
        encodeClientFrame(0x1, Buffer.from('abc'), { fin: false }),
        encodeClientFrame(0x2, whole, { fin: true })
      ]),
      1002,
      'after-binary-interrupt'
    );
  });
});

wsTest('RSV1, RSV2, and RSV3 each close with 1002 and the daemon keeps serving', async () => {
  await withDaemon(fastDispatch(), async (daemon, open) => {
    const bits = [
      [{ rsv1: true }, 'rsv1'],
      [{ rsv2: true }, 'rsv2'],
      [{ rsv3: true }, 'rsv3'],
      [{ rsv1: true, rsv2: true, rsv3: true }, 'rsv-all']
    ];
    for (const [flags, id] of bits) {
      await expectProtocolClose(
        daemon,
        open,
        encodeTextFrame(envelope({ id }), flags),
        1002,
        `after-${id}`
      );
    }
  });
});

wsTest('reserved opcodes 3-7 and 0xB-0xF close with 1002 and the daemon keeps serving', async () => {
  await withDaemon(fastDispatch(), async (daemon, open) => {
    const opcodes = [0x3, 0x4, 0x5, 0x6, 0x7, 0xB, 0xC, 0xD, 0xE, 0xF];
    for (const opcode of opcodes) {
      const payload = Buffer.from(JSON.stringify(envelope({ id: `op${opcode.toString(16)}` })));
      await expectProtocolClose(
        daemon,
        open,
        encodeClientFrame(opcode, payload),
        1002,
        `after-op-${opcode.toString(16)}`
      );
    }
  });
});

wsTest('a non-minimal payload length closes with 1002 and the daemon keeps serving', async () => {
  await withDaemon(fastDispatch(), async (daemon, open) => {
    await expectProtocolClose(daemon, open, encodeNonMinimalFrame(125, 16), 1002, 'after-short-16');
    await expectProtocolClose(daemon, open, encodeNonMinimalFrame(65535, 64), 1002, 'after-short-64');
  });
});

wsTest('a ping between fragments is ponged and the text is still reassembled', async () => {
  await withDaemon(fastDispatch(), async (_daemon, open) => {
    const client = await open();
    const bytes = Buffer.from(JSON.stringify(envelope({ id: 'frag-ping' })));
    const mid = Math.floor(bytes.length / 2);
    assert.ok(mid > 1 && mid < bytes.length - 1);
    const pingPayload = Buffer.from([0x01, 0x02, 0x7f, 0x80]);
    await writeBuffer(client.socket, Buffer.concat([
      encodeClientFrame(0x1, bytes.subarray(0, mid), { fin: false }),
      encodeClientFrame(0x9, pingPayload),
      encodeClientFrame(0x0, bytes.subarray(mid), { fin: true })
    ]));
    await waitFor(() => client.frames.some((frame) => frame.opcode === 0xA));
    const pong = client.frames.find((frame) => frame.opcode === 0xA);
    assert.equal(pong.fin, true);
    assert.deepEqual(pong.payload, pingPayload);
    await expectOkIds(client, ['frag-ping']);
  });
});

wsTest('invalid close codes close with 1002, an empty close is kept, and a 1-byte close payload closes with 1002', async () => {
  await withDaemon(fastDispatch(), async (daemon, open) => {
    const invalidCodes = [0, 999, 1004, 1005, 1006, 1015, 1016, 2000, 2999, 5000];
    for (const code of invalidCodes) {
      await expectProtocolClose(
        daemon,
        open,
        encodeCloseFrame(code, 'nope'),
        1002,
        `after-close-${code}`
      );
    }

    const emptyClient = await open();
    await writeBuffer(emptyClient.socket, encodeClientFrame(0x8, Buffer.alloc(0)));
    await waitFor(() => closeFrames(emptyClient).length > 0);
    assert.equal(closeFrames(emptyClient)[0].payload.length, 0);
    await assertStillServing(daemon, open, 'after-empty-close');

    await expectProtocolClose(
      daemon,
      open,
      encodeClientFrame(0x8, Buffer.from([0x03])),
      1002,
      'after-one-byte-close'
    );

    const echoed = [
      [1000, ''],
      [1001, 'going'],
      [1014, 'gw'],
      [3000, 'lib'],
      [4999, 'priv']
    ];
    for (const [code, reason] of echoed) {
      const client = await open();
      await writeBuffer(client.socket, encodeCloseFrame(code, reason));
      await waitFor(() => closeFrames(client).length > 0);
      const close = closeFrames(client)[0];
      assert.equal(close.payload.readUInt16BE(0), code);
      assert.equal(close.payload.subarray(2).toString('utf8'), reason);
    }

    const badReason = Buffer.alloc(3);
    badReason.writeUInt16BE(1000, 0);
    badReason[2] = 0xff;
    await expectProtocolClose(daemon, open, encodeClientFrame(0x8, badReason), 1007, 'after-bad-reason');
    await assertStillServing(daemon, open, 'after-close-codes');
  });
});

wsTest('invalid UTF-8 text closes with 1007 and a split multibyte character still reassembles', async () => {
  await withDaemon(fastDispatch(), async (daemon, open) => {
    await expectProtocolClose(
      daemon,
      open,
      encodeClientFrame(0x1, Buffer.from([0xff, 0xfe])),
      1007,
      'after-bad-utf8'
    );
    await expectProtocolClose(
      daemon,
      open,
      Buffer.concat([
        encodeClientFrame(0x1, Buffer.from([0xc3]), { fin: false }),
        encodeClientFrame(0x0, Buffer.from([0x28]), { fin: true })
      ]),
      1007,
      'after-split-bad-utf8'
    );

    const client = await open();
    const text = JSON.stringify(envelope({ id: 'split-utf8', args: { label: '©' } }));
    const bytes = Buffer.from(text);
    const mark = bytes.indexOf(0xc2);
    assert.ok(mark > 0);
    assert.equal(bytes[mark + 1], 0xa9);
    await writeBuffer(client.socket, Buffer.concat([
      encodeClientFrame(0x1, bytes.subarray(0, mark + 1), { fin: false }),
      encodeClientFrame(0x0, bytes.subarray(mark + 1), { fin: true })
    ]));
    await expectOkIds(client, ['split-utf8']);
  });
});

wsTest('a binary message closes with 1003 and the daemon keeps serving', async () => {
  await withDaemon(fastDispatch(), async (daemon, open) => {
    const payload = Buffer.from(JSON.stringify(envelope({ id: 'bin' })));
    await expectProtocolClose(daemon, open, encodeClientFrame(0x2, payload), 1003, 'after-binary');
    await expectProtocolClose(
      daemon,
      open,
      encodeClientFrame(0x2, payload, { fin: false }),
      1003,
      'after-binary-fragment'
    );
  });
});

wsTest('a socket queue past the pending cap closes with 1013 and the daemon keeps serving', async () => {
  let releaseGate = () => {};
  const gate = new Promise((resolve) => {
    releaseGate = resolve;
  });
  let started = 0;
  let finished = 0;
  try {
    await withDaemon({
      checkProviderAvailabilityImpl: async () => {
        started += 1;
        await gate;
        finished += 1;
        return { provider: 'codex', available: true, status: 'available' };
      }
    }, async (daemon, open) => {
      try {
        const client = await open();
        const frames = [];
        for (let index = 0; index < MAX_PENDING_SOCKET_MESSAGES + 1; index += 1) {
          frames.push(encodeTextFrame(envelope({
            id: `q${index}`,
            name: 'provider.status',
            args: { provider: 'codex' }
          })));
        }
        await writeBuffer(client.socket, Buffer.concat(frames));
        await waitFor(() => closeFrames(client).length > 0 && started === 1);
        const close = closeFrames(client)[0];
        assert.equal(close.payload.readUInt16BE(0), 1013);
        assert.equal(close.payload.subarray(2).toString('utf8'), 'Pending message limit exceeded.');
        assert.equal(started, 1);
        await assertStillServing(daemon, open, 'after-queue-cap');
        releaseGate();
        await waitFor(() => finished === MAX_PENDING_SOCKET_MESSAGES);
        assert.equal(finished, MAX_PENDING_SOCKET_MESSAGES);
      } finally {
        releaseGate();
        await yieldToServer();
      }
    });
  } finally {
    releaseGate();
  }
});

test('many one-byte chunks of a large frame are assembled in linear time', { timeout: 20000 }, () => {
  const payload = Buffer.alloc(512 * 1024, 0x61);
  const frame = encodeClientFrame(0x1, payload);
  const received = [];
  const socket = new EventEmitter();
  socket.destroyed = false;
  socket.writableEnded = false;
  socket.write = () => true;
  socket.end = () => {
    socket.writableEnded = true;
  };
  socket.destroy = () => {
    socket.destroyed = true;
  };
  attachWebSocketFrameHandler(socket, {
    onMessage(_opcode, body) {
      received.push(body);
    }
  });
  const started = Date.now();
  for (let index = 0; index < frame.length; index += 1) {
    socket.emit('data', frame.subarray(index, index + 1));
  }
  const elapsed = Date.now() - started;
  assert.equal(socket.writableEnded, false);
  assert.equal(received.length, 1);
  assert.ok(received[0].equals(payload));
  assert.ok(elapsed < 2000, `assembling ${frame.length} one-byte chunks took ${elapsed}ms`);
});
