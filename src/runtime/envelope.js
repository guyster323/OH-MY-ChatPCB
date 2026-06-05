import { randomUUID } from 'node:crypto';

const TYPE_PATTERN = /^(chat\.message|agent\.delta|tool\.call|tool\.result|project\.diff|system\.status)$/;

export function createEnvelope(type, payload = {}, options = {}) {
  validateType(type);

  return {
    version: 1,
    id: options.id ?? `evt_${randomUUID()}`,
    type,
    createdAt: options.createdAt ?? new Date().toISOString(),
    payload
  };
}

export function parseEnvelope(raw) {
  const envelope = typeof raw === 'string' ? JSON.parse(raw) : raw;

  if (!envelope || typeof envelope !== 'object') {
    throw new Error('Envelope must be an object.');
  }

  if (envelope.version !== 1) {
    throw new Error('Envelope version must be 1.');
  }

  validateType(envelope.type);

  if (typeof envelope.id !== 'string' || !envelope.id.startsWith('evt_')) {
    throw new Error('Envelope id must start with evt_.');
  }

  if (typeof envelope.createdAt !== 'string' || !envelope.createdAt.endsWith('Z')) {
    throw new Error('Envelope createdAt must be an ISO timestamp.');
  }

  if (!envelope.payload || typeof envelope.payload !== 'object' || Array.isArray(envelope.payload)) {
    throw new Error('Envelope payload must be an object.');
  }

  return envelope;
}

function validateType(type) {
  if (typeof type !== 'string' || !TYPE_PATTERN.test(type)) {
    throw new Error(`Invalid envelope type: ${type}`);
  }
}
