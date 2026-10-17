import './setup/isolate-home.mjs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifyTokenExpiry, extractPlan } from '../src/runtime/auth/chatgpt-auth.js';
import { mapChatGPTErrorToCode } from '../src/runtime/providers/chatgpt-provider.js';

describe('ChatGPT Auth - Token Expiry', () => {
  it('should detect expired token via verifyTokenExpiry', () => {
    const creds = {
      issued_at: Date.now() - 4000 * 1000, // 4000 seconds ago
      expires_in: 3600 // 1 hour
    };
    
    const result = verifyTokenExpiry(creds);
    assert.ok(result.expired);
    assert.ok(result.shouldRefresh);
  });

  it('should detect valid token via verifyTokenExpiry', () => {
    const creds = {
      issued_at: Date.now() - 1000 * 1000, // 1000 seconds ago
      expires_in: 3600 // 1 hour
    };
    
    const result = verifyTokenExpiry(creds);
    assert.ok(!result.expired);
    assert.ok(!result.shouldRefresh);
  });

  it('should recommend refresh before expiry', () => {
    const creds = {
      issued_at: Date.now() - 3550 * 1000, // 3550 seconds ago (almost 1 hour)
      expires_in: 3600 // 1 hour
    };
    
    const result = verifyTokenExpiry(creds);
    assert.ok(!result.expired);
    assert.ok(result.shouldRefresh);
  });
});

describe('ChatGPT Auth - Plan Extraction', () => {
  it('should return null when no plan in ID token', () => {
    const creds = {
      id_token: createMockIdToken({ plan: null })
    };
    
    const plan = extractPlan(creds);
    assert.equal(plan, null);
  });

  it('should extract plan from ID token custom claim', () => {
    const creds = {
      id_token: createMockIdToken({ plan: 'Plus' })
    };
    
    const plan = extractPlan(creds);
    assert.equal(plan, 'Plus');
  });
});

describe('ChatGPT Provider - Error Mapping', () => {
  it('should map NOT_ELIGIBLE error', () => {
    const error = new Error('NOT_ELIGIBLE: This account is not eligible');
    error.code = 'not_eligible';
    const code = mapChatGPTErrorToCode(error);
    assert.equal(code, 'not_eligible');
  });

  it('should map USAGE_LIMIT_EXCEEDED error', () => {
    const error = new Error('USAGE_LIMIT_EXCEEDED: Usage limit reached');
    error.code = 'usage_limit';
    const code = mapChatGPTErrorToCode(error);
    assert.equal(code, 'usage_limit');
  });

  it('should map ROUTE_NOT_SUPPORTED error', () => {
    const error = new Error('ROUTE_NOT_SUPPORTED: Route not supported');
    error.code = 'route_not_supported';
    const code = mapChatGPTErrorToCode(error);
    assert.equal(code, 'route_not_supported');
  });

  it('should map usage_unavailable error', () => {
    const error = new Error('USAGE_UNAVAILABLE');
    error.code = 'usage_unavailable';
    const code = mapChatGPTErrorToCode(error);
    assert.equal(code, 'usage_unavailable');
  });
});

function createMockIdToken(claims = {}) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    sub: 'user_123',
    email: 'test@example.com',
    name: 'Test User',
    iss: 'https://auth.openai.com',
    aud: 'oaiapp_test',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    nonce: 'test_nonce',
    ...claims
  };
  
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = 'mock_signature';
  
  return `${headerB64}.${payloadB64}.${signature}`;
}
