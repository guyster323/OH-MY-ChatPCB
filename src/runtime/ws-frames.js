// Per-connection WebSocket framing for the daemon's raw TCP upgrade.
// Client frames are masked (RFC 6455). A declared length above the ceiling
// closes the socket before the body is buffered.

export const MAX_WEBSOCKET_MESSAGE_BYTES = 8 * 1024 * 1024;

const CONTROL_OPCODE = new Set([0x8, 0x9, 0xA]);

export function encodeServerFrame(opcode, payload = Buffer.alloc(0)) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const byte0 = 0x80 | (opcode & 0x0f);
  let header;
  if (data.length < 126) {
    header = Buffer.from([byte0, data.length]);
  } else if (data.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = byte0;
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = byte0;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  return Buffer.concat([header, data]);
}

export function attachWebSocketFrameHandler(socket, {
  onMessage,
  maxMessageBytes = MAX_WEBSOCKET_MESSAGE_BYTES
} = {}) {
  if (typeof onMessage !== 'function') {
    throw new Error('WebSocket frame handler requires onMessage.');
  }

  let pending = Buffer.alloc(0);
  let fragment = null;
  let closing = false;

  const shutdown = (code, reason, echoPayload) => {
    if (closing) return;
    closing = true;
    fragment = null;
    pending = Buffer.alloc(0);
    const body = echoPayload ?? encodeClosePayload(code, reason);
    try {
      if (!socket.destroyed) socket.end(encodeServerFrame(0x8, body));
    } catch (error) {
      console.error('ChatPCB websocket close failed:', error);
      if (!socket.destroyed) socket.destroy();
    }
  };

  const writeFrame = (opcode, payload) => {
    if (closing || socket.destroyed || socket.writableEnded) return;
    try {
      socket.write(encodeServerFrame(opcode, payload));
    } catch (error) {
      console.error('ChatPCB websocket send failed:', error);
    }
  };

  const deliver = (opcode, payload) => {
    try {
      onMessage(opcode, payload);
    } catch (error) {
      console.error('ChatPCB websocket handler failed:', error);
    }
  };

  socket.on('data', (chunk) => {
    if (closing || socket.destroyed) return;
    const incoming = Buffer.from(chunk);
    pending = pending.length === 0 ? incoming : Buffer.concat([pending, incoming]);

    for (;;) {
      const frame = tryReadClientFrame(pending, maxMessageBytes);
      if (!frame) return;
      if (frame.error) {
        shutdown(frame.code, frame.reason);
        return;
      }
      if (!frame.consumed) {
        shutdown(1002, 'Invalid frame.');
        return;
      }
      pending = frame.consumed >= pending.length ? Buffer.alloc(0) : pending.subarray(frame.consumed);
      if (!dispatchFrame(frame)) return;
    }
  });

  function dispatchFrame(frame) {
    const { opcode, fin, payload } = frame;

    if (opcode === 0x9) {
      writeFrame(0xA, payload);
      return true;
    }
    if (opcode === 0xA) return true;
    if (opcode === 0x8) {
      if (payload.length === 1) {
        shutdown(1002, 'Invalid close payload.');
        return false;
      }
      shutdown(1000, '', payload);
      return false;
    }
    return appendData(opcode, fin, payload);
  }

  function appendData(opcode, fin, payload) {
    if (opcode === 0x0) {
      if (!fragment) {
        shutdown(1002, 'Unexpected continuation frame.');
        return false;
      }
    } else if (fragment) {
      shutdown(1002, 'Data frame interrupted a fragmented message.');
      return false;
    } else if (!fin) {
      fragment = { opcode, chunks: [], size: 0 };
    }

    const active = fragment;
    if (active) {
      if (active.size + payload.length > maxMessageBytes) {
        shutdown(1009, 'Message exceeds maximum size.');
        return false;
      }
      active.chunks.push(payload);
      active.size += payload.length;
      if (!fin) return true;
      const messageOpcode = active.opcode;
      const message = Buffer.concat(active.chunks, active.size);
      fragment = null;
      deliver(messageOpcode, message);
      return true;
    }

    deliver(opcode, payload);
    return true;
  }
}

function tryReadClientFrame(buffer, maxMessageBytes) {
  if (buffer.length < 2) return null;

  const first = buffer[0];
  const second = buffer[1];
  if ((first & 0x70) !== 0) {
    return protocolError(1002, 'Reserved RSV bits are not supported.');
  }

  const fin = (first & 0x80) !== 0;
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let length = second & 0x7f;
  let offset = 2;

  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
    if (length < 126) return protocolError(1002, 'Non-minimal payload length.');
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    const extended = buffer.readBigUInt64BE(2);
    offset = 10;
    if (extended > BigInt(maxMessageBytes)) {
      return protocolError(1009, 'Message exceeds maximum size.');
    }
    if (extended <= 0xffffn) return protocolError(1002, 'Non-minimal payload length.');
    length = Number(extended);
  }

  if (length > maxMessageBytes) {
    return protocolError(1009, 'Message exceeds maximum size.');
  }

  if (CONTROL_OPCODE.has(opcode)) {
    if (!fin) return protocolError(1002, 'Control frames must not be fragmented.');
    if (length > 125) return protocolError(1002, 'Control frame payload must be 125 bytes or fewer.');
  } else if (opcode !== 0x0 && opcode !== 0x1 && opcode !== 0x2) {
    return protocolError(1002, 'Unsupported opcode.');
  }

  // Reject before the body arrives so an oversized or illegal header cannot pin memory.
  if (!masked) return protocolError(1002, 'Client frames must be masked.');
  if (buffer.length < offset + 4 + length) return null;

  const mask = buffer.subarray(offset, offset + 4);
  offset += 4;
  const payload = Buffer.alloc(length);
  for (let index = 0; index < length; index += 1) {
    payload[index] = buffer[offset + index] ^ mask[index % 4];
  }

  return {
    fin,
    opcode,
    payload,
    consumed: offset + length
  };
}

function protocolError(code, reason) {
  return { error: true, code, reason };
}

function encodeClosePayload(code, reason = '') {
  const text = Buffer.from(String(reason));
  const limit = Math.min(text.length, 123);
  const payload = Buffer.alloc(2 + limit);
  payload.writeUInt16BE(code, 0);
  text.copy(payload, 2, 0, limit);
  return payload;
}
