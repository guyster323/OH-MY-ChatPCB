// Per-connection WebSocket framing for the daemon's raw TCP upgrade.
// Client frames are masked (RFC 6455). A declared length above the ceiling
// closes the socket before the body is buffered.
//
// Inbound bytes stay in a chunk list. The handler copies a frame once, when
// the header says the body is complete. Concatenating on every socket read
// would copy an 8 MiB frame again for each small chunk.

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

  const incoming = createReceiveBuffer();
  let pendingTotal = 0;
  let fragment = null;
  let closing = false;

  const shutdown = (code, reason, echoPayload) => {
    if (closing) return;
    closing = true;
    fragment = null;
    pendingTotal = 0;
    incoming.clear();
    const body = echoPayload ?? encodeClosePayload(code, reason);
    try {
      if (!socket.destroyed && !socket.writableEnded) {
        socket.end(encodeServerFrame(0x8, body));
      }
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
    if (closing || socket.destroyed || socket.writableEnded) return;
    if (chunk.length === 0) return;
    incoming.push(Buffer.from(chunk));

    for (;;) {
      // The header is parsed once. Later chunks only compare the buffered
      // length with that total, so a large frame of tiny reads stays linear.
      if (pendingTotal > 0 && incoming.length < pendingTotal) return;
      const frame = tryReadClientFrame(incoming, maxMessageBytes);
      if (!frame) return;
      if (frame.pending) {
        pendingTotal = frame.pending;
        if (incoming.length < pendingTotal) return;
        continue;
      }
      pendingTotal = 0;
      if (frame.error) {
        shutdown(frame.code, frame.reason);
        return;
      }
      if (!frame.consumed) {
        shutdown(1002, 'Invalid frame.');
        return;
      }
      incoming.consume(frame.consumed);
      if (!dispatchFrame(frame)) return;
      if (closing || socket.destroyed || socket.writableEnded) return;
    }
  });

  function dispatchFrame(frame) {
    const { opcode, fin, payload } = frame;

    if (opcode === 0x9) {
      writeFrame(0xA, payload);
      return true;
    }
    if (opcode === 0xA) return true;
    if (opcode === 0x8) return handleClose(payload);
    return appendData(opcode, fin, payload);
  }

  function handleClose(payload) {
    if (payload.length === 1) {
      shutdown(1002, 'Invalid close payload.');
      return false;
    }
    if (payload.length >= 2) {
      const code = payload.readUInt16BE(0);
      // RFC 6455 §7.4.1: 1004/1005/1006/1015 must not appear on the wire,
      // codes below 1000 are unused, 1016-2999 are unassigned, and only
      // 3000-4999 are left for libraries and private use. Echoing an
      // illegal code is itself a protocol error, so answer with 1002.
      if (!isValidCloseCode(code)) {
        shutdown(1002, 'Invalid close code.');
        return false;
      }
      if (!isValidUtf8(payload.subarray(2))) {
        shutdown(1007, 'Invalid close reason.');
        return false;
      }
    }
    shutdown(1000, '', payload);
    return false;
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
    } else if (opcode === 0x2) {
      // The daemon speaks text envelopes only. Reject before any reassembly.
      shutdown(1003, 'Binary messages are not supported.');
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
      return deliverMessage(messageOpcode, message);
    }

    return deliverMessage(opcode, payload);
  }

  function deliverMessage(opcode, payload) {
    if (opcode === 0x1 && !isValidUtf8(payload)) {
      shutdown(1007, 'Invalid UTF-8.');
      return false;
    }
    deliver(opcode, payload);
    return !closing && !socket.destroyed && !socket.writableEnded;
  }

  return {
    close(code, reason) {
      shutdown(code, reason);
    }
  };
}

function createReceiveBuffer() {
  const chunks = [];
  let index = 0;
  let offset = 0;
  let length = 0;

  function locate(position) {
    let skip = position;
    let cursor = index;
    let start = offset;
    while (cursor < chunks.length) {
      const available = chunks[cursor].length - start;
      if (skip < available) return { cursor, start: start + skip };
      skip -= available;
      cursor += 1;
      start = 0;
    }
    return null;
  }

  function byteAt(position) {
    const found = locate(position);
    if (!found) throw new RangeError(`WebSocket buffer underrun at ${position}.`);
    return chunks[found.cursor][found.start];
  }

  return {
    get length() {
      return length;
    },
    push(chunk) {
      if (chunk.length === 0) return;
      chunks.push(chunk);
      length += chunk.length;
    },
    clear() {
      chunks.length = 0;
      index = 0;
      offset = 0;
      length = 0;
    },
    consume(count) {
      let remaining = count > length ? length : count;
      length -= remaining;
      while (remaining > 0) {
        const available = chunks[index].length - offset;
        if (remaining < available) {
          offset += remaining;
          break;
        }
        remaining -= available;
        index += 1;
        offset = 0;
      }
      if (length === 0) {
        chunks.length = 0;
        index = 0;
        offset = 0;
        return;
      }
      if (index > 32) {
        chunks.splice(0, index);
        index = 0;
      }
    },
    get(position) {
      return byteAt(position);
    },
    readUInt16BE(position) {
      return (byteAt(position) << 8) | byteAt(position + 1);
    },
    readBigUInt64BE(position) {
      let value = 0n;
      for (let byte = 0; byte < 8; byte += 1) {
        value = (value << 8n) | BigInt(byteAt(position + byte));
      }
      return value;
    },
    read(start, size, mask) {
      if (size === 0) return Buffer.alloc(0);
      const out = Buffer.alloc(size);
      let skip = start;
      let dest = 0;
      let cursor = index;
      let startAt = offset;
      while (dest < size) {
        const chunk = chunks[cursor];
        const available = chunk.length - startAt;
        if (skip >= available) {
          skip -= available;
          cursor += 1;
          startAt = 0;
          continue;
        }
        const begin = startAt + skip;
        const take = Math.min(available - skip, size - dest);
        if (mask) {
          for (let step = 0; step < take; step += 1) {
            out[dest + step] = chunk[begin + step] ^ mask[(dest + step) % 4];
          }
        } else {
          chunk.copy(out, dest, begin, begin + take);
        }
        dest += take;
        skip = 0;
        cursor += 1;
        startAt = 0;
      }
      return out;
    }
  };
}

function tryReadClientFrame(buffer, maxMessageBytes) {
  if (buffer.length < 2) return null;

  const first = buffer.get(0);
  const second = buffer.get(1);
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
  const total = offset + 4 + length;
  if (buffer.length < total) return { pending: total };

  const mask = buffer.read(offset, 4);
  const payload = buffer.read(offset + 4, length, mask);
  return {
    fin,
    opcode,
    payload,
    consumed: total
  };
}

// Status codes a peer is allowed to put in a Close frame (RFC 6455 §7.4).
function isValidCloseCode(code) {
  return (code >= 1000 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006)
    || (code >= 3000 && code <= 4999);
}

function isValidUtf8(payload) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(payload);
    return true;
  } catch {
    return false;
  }
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
