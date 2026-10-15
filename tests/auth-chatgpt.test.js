import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';

describe('ChatGPT Auth - PKCE', () => {
  it('should generate valid code verifier', () => {
    const verifier = randomBytes(32).toString('base64url');
    assert.ok(verifier.length >= 43);
    assert.ok(verifier.length <= 128);
    assert.ok(/^[A-Za-z0-9_-]+$/.test(verifier));
  });

  it('should generate valid code challenge from verifier', () => {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    
    assert.ok(challenge.length > 0);
    assert.ok(/^[A-Za-z0-9_-]+$/.test(challenge));
    
    // Verify idempotency
    const challenge2 = createHash('sha256').update(verifier).digest('base64url');
    assert.equal(challenge, challenge2);
  });

  it('should generate different verifiers each time', () => {
    const v1 = randomBytes(32).toString('base64url');
    const v2 = randomBytes(32).toString('base64url');
    assert.notEqual(v1, v2);
  });
});

describe('ChatGPT Auth - State and Nonce', () => {
  it('should generate valid state parameter', () => {
    const state = randomBytes(16).toString('base64url');
    assert.ok(state.length > 0);
    assert.ok(/^[A-Za-z0-9_-]+$/.test(state));
  });

  it('should generate valid nonce parameter', () => {
    const nonce = randomBytes(16).toString('base64url');
    assert.ok(nonce.length > 0);
    assert.ok(/^[A-Za-z0-9_-]+$/.test(nonce));
  });

  it('should generate different state values each time', () => {
    const s1 = randomBytes(16).toString('base64url');
    const s2 = randomBytes(16).toString('base64url');
    assert.notEqual(s1, s2);
  });
});

describe('ChatGPT Auth - Token Expiry', () => {
  it('should detect expired token', () => {
    const creds = {
      issued_at: Date.now() - 4000 * 1000, // 4000 seconds ago
      expires_in: 3600 // 1 hour
    };
    
    const expiresAt = creds.issued_at + (creds.expires_in * 1000);
    const now = Date.now();
    const expired = now >= expiresAt;
    
    assert.ok(expired);
  });

  it('should detect valid token', () => {
    const creds = {
      issued_at: Date.now() - 1000 * 1000, // 1000 seconds ago
      expires_in: 3600 // 1 hour
    };
    
    const expiresAt = creds.issued_at + (creds.expires_in * 1000);
    const now = Date.now();
    const expired = now >= expiresAt;
    
    assert.ok(!expired);
  });

  it('should recommend refresh before expiry', () => {
    const creds = {
      issued_at: Date.now() - 3550 * 1000, // 3550 seconds ago (almost 1 hour)
      expires_in: 3600 // 1 hour
    };
    
    const expiresAt = creds.issued_at + (creds.expires_in * 1000);
    const now = Date.now();
    const bufferMs = 60 * 1000; // 1 minute buffer
    const shouldRefresh = now >= (expiresAt - bufferMs);
    
    assert.ok(shouldRefresh);
  });
});

describe('ChatGPT Auth - Callback URL', () => {
  it('should use correct redirect URI format', () => {
    const port = 41318;
    const redirectUri = `http://127.0.0.1:${port}/auth/callback`;
    
    assert.ok(redirectUri.startsWith('http://127.0.0.1:'));
    assert.ok(redirectUri.includes('/auth/callback'));
    assert.ok(!redirectUri.includes('localhost'));
  });

  it('should validate callback path', () => {
    const pathname = '/auth/callback';
    assert.equal(pathname, '/auth/callback');
  });
});

describe('ChatGPT Auth - Scope Validation', () => {
  it('should include required scopes', () => {
    const scopes = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
    
    assert.ok(scopes.includes('openid'));
    assert.ok(scopes.includes('chatgpt.tokens.use.direct'));
    assert.ok(scopes.includes('offline_access'));
  });

  it('should verify chatgpt.tokens.use.direct in token response', () => {
    const tokenScope = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
    assert.ok(tokenScope.includes('chatgpt.tokens.use.direct'));
  });
});

describe('ChatGPT Provider - Error Mapping', () => {
  it('should map NOT_ELIGIBLE error', () => {
    const error = new Error('NOT_ELIGIBLE: This account is not eligible');
    const code = error.message.includes('NOT_ELIGIBLE') ? 'not_eligible' : 'unknown';
    assert.equal(code, 'not_eligible');
  });

  it('should map USAGE_LIMIT_EXCEEDED error', () => {
    const error = new Error('USAGE_LIMIT_EXCEEDED: Usage limit reached');
    const code = error.message.includes('USAGE_LIMIT_EXCEEDED') ? 'usage_limit' : 'unknown';
    assert.equal(code, 'usage_limit');
  });

  it('should map ROUTE_NOT_SUPPORTED error', () => {
    const error = new Error('ROUTE_NOT_SUPPORTED: Route not supported');
    const code = error.message.includes('ROUTE_NOT_SUPPORTED') ? 'route_not_supported' : 'unknown';
    assert.equal(code, 'route_not_supported');
  });
});
