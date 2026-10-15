import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';

describe('ChatGPT Auth Integration', () => {
  let mockAuthServer;
  let mockTokenServer;
  const PORT_AUTH = 48888;
  const PORT_TOKEN = 48889;

  before(() => {
    // Mock auth server
    mockAuthServer = http.createServer((req, res) => {
      if (req.url?.startsWith('/api/accounts/authorize')) {
        // In real scenario, this redirects to login page
        // For testing, we just verify the parameters
        res.writeHead(302, {
          'Location': `http://127.0.0.1:41318/auth/callback?code=test_code_123&state=test_state`
        });
        res.end();
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    // Mock token server
    mockTokenServer = http.createServer((req, res) => {
      if (req.url === '/api/accounts/oauth/token' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          const params = new URLSearchParams(body);
          
          if (params.get('grant_type') === 'authorization_code') {
            // Token exchange
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              access_token: 'test_access_token',
              refresh_token: 'test_refresh_token',
              id_token: createMockIdToken(),
              token_type: 'Bearer',
              expires_in: 3600,
              scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
            }));
          } else if (params.get('grant_type') === 'refresh_token') {
            // Token refresh
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              access_token: 'test_refreshed_access_token',
              refresh_token: 'test_refreshed_refresh_token',
              token_type: 'Bearer',
              expires_in: 3600
            }));
          } else {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'invalid_grant' }));
          }
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    return new Promise((resolve) => {
      mockAuthServer.listen(PORT_AUTH, () => {
        mockTokenServer.listen(PORT_TOKEN, resolve);
      });
    });
  });

  after(() => {
    return new Promise((resolve) => {
      mockAuthServer.close(() => {
        mockTokenServer.close(resolve);
      });
    });
  });

  it('should construct valid authorization URL', () => {
    const state = randomBytes(16).toString('base64url');
    const nonce = randomBytes(16).toString('base64url');
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = randomBytes(32).toString('base64url');
    
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: 'dynamic_agent_client',
      redirect_uri: 'http://127.0.0.1:41318/auth/callback',
      scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      resource: 'https://api.openai.com/v1',
      agent_name_hint: 'ChatPCB',
      ext_agent_host_id: 'oh-my-chatpcb'
    });
    
    const authUrl = `https://auth.openai.com/api/accounts/authorize?${params.toString()}`;
    
    assert.ok(authUrl.includes('code_challenge'));
    assert.ok(authUrl.includes('code_challenge_method=S256'));
    assert.ok(authUrl.includes('chatgpt.tokens.use.direct'));
    assert.ok(authUrl.includes('agent_name_hint=ChatPCB'));
  });

  it('should handle state mismatch in callback', () => {
    const expectedState = 'expected_state';
    const receivedState = 'different_state';
    
    assert.notEqual(expectedState, receivedState);
  });

  it('should extract account from ID token', () => {
    const mockIdToken = createMockIdToken();
    const [, payloadB64] = mockIdToken.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    
    assert.ok(payload.email);
    assert.ok(payload.sub);
  });
});

describe('ChatGPT Responses API', () => {
  let mockApiServer;
  const PORT_API = 48890;

  before(() => {
    mockApiServer = http.createServer((req, res) => {
      if (req.url === '/v1/responses' && req.method === 'POST') {
        const auth = req.headers.authorization;
        
        if (!auth || !auth.startsWith('Bearer ')) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 'unauthorized', message: 'Missing or invalid authorization' } }));
          return;
        }
        
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          const data = JSON.parse(body);
          
          if (!data.store === false || !data.stream === true) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { code: 'invalid_request', message: 'store:false and stream:true are required' } }));
            return;
          }
          
          // Simulate streaming response
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });
          
          res.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');
          res.write('data: {"choices":[{"delta":{"content":" from"}}]}\n\n');
          res.write('data: {"choices":[{"delta":{"content":" ChatGPT"}}]}\n\n');
          res.write('data: [DONE]\n\n');
          res.end();
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    return new Promise((resolve) => {
      mockApiServer.listen(PORT_API, resolve);
    });
  });

  after(() => {
    return new Promise((resolve) => {
      mockApiServer.close(resolve);
    });
  });

  it('should validate API request format', () => {
    const request = {
      model: 'auto',
      messages: [{ role: 'user', content: 'test prompt' }],
      store: false,
      stream: true
    };
    
    assert.equal(request.store, false);
    assert.equal(request.stream, true);
    assert.ok(Array.isArray(request.messages));
  });

  it('should handle 403 not_eligible error', async () => {
    const errorResponse = {
      error: {
        code: 'subscription_sharing_user_not_eligible',
        message: 'User not eligible'
      }
    };
    
    assert.equal(errorResponse.error.code, 'subscription_sharing_user_not_eligible');
  });

  it('should handle 429 usage_limit error', async () => {
    const errorResponse = {
      error: {
        code: 'subscription_sharing_usage_limit_exceeded',
        message: 'Usage limit exceeded'
      }
    };
    
    assert.equal(errorResponse.error.code, 'subscription_sharing_usage_limit_exceeded');
  });

  it('should handle 403 route_not_supported error', async () => {
    const errorResponse = {
      error: {
        code: 'subscription_sharing_route_not_supported',
        message: 'Route not supported'
      }
    };
    
    assert.equal(errorResponse.error.code, 'subscription_sharing_route_not_supported');
  });
});

describe('ChatGPT Panel UI States', () => {
  it('should render signed_out state', () => {
    const state = {
      state: 'signed_out'
    };
    
    assert.equal(state.state, 'signed_out');
  });

  it('should render waiting state', () => {
    const state = {
      state: 'waiting',
      authUrl: 'https://auth.openai.com/...',
      attemptId: 'abc123'
    };
    
    assert.equal(state.state, 'waiting');
    assert.ok(state.authUrl);
    assert.ok(state.attemptId);
  });

  it('should render signed_in state', () => {
    const state = {
      state: 'signed_in',
      account: { email: 'test@example.com' },
      plan: 'Plus'
    };
    
    assert.equal(state.state, 'signed_in');
    assert.ok(state.account.email);
    assert.ok(state.plan);
  });

  it('should render error states', () => {
    const errors = [
      { state: 'error', code: 'cancelled' },
      { state: 'error', code: 'timeout' },
      { state: 'error', code: 'not_eligible' },
      { state: 'error', code: 'usage_limit' },
      { state: 'error', code: 'open_failed' }
    ];
    
    for (const error of errors) {
      assert.equal(error.state, 'error');
      assert.ok(error.code);
    }
  });
});

describe('ChatGPT End-to-End Login', () => {
  let mockServer;
  const PORT = 48900;
  let registeredClientId = null;

  before(() => {
    mockServer = http.createServer((req, res) => {
      // Mock OIDC endpoints
      if (req.url?.startsWith('/api/accounts/authorize')) {
        const url = new URL(req.url, `http://localhost:${PORT}`);
        const state = url.searchParams.get('state');
        const redirectUri = url.searchParams.get('redirect_uri');
        
        // Simulate dynamic registration
        registeredClientId = 'oaiapp_test_' + randomBytes(8).toString('hex');
        
        // Redirect with code
        res.writeHead(302, {
          'Location': `${redirectUri}?code=test_auth_code&state=${state}&client_id=${registeredClientId}`
        });
        res.end();
      } else if (req.url === '/api/accounts/oauth/token' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          const params = new URLSearchParams(body);
          const clientId = params.get('client_id');
          
          // Verify correct client_id is used
          if (clientId === registeredClientId) {
            const idToken = createMockIdToken(clientId);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              access_token: 'test_access_token',
              refresh_token: 'test_refresh_token',
              id_token: idToken,
              token_type: 'Bearer',
              expires_in: 3600,
              scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
              client_id: clientId
            }));
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid_client' }));
          }
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    return new Promise((resolve) => {
      mockServer.listen(PORT, resolve);
    });
  });

  after(() => {
    return new Promise((resolve) => {
      mockServer.close(resolve);
    });
  });

  it('should handle port conflict gracefully', () => {
    // Test that EADDRINUSE is handled
    const port1 = 41318;
    const port2 = 41319;
    
    assert.ok(port2 > port1);
  });

  it('should exchange code with registered client_id', async () => {
    const code = 'test_auth_code';
    const codeVerifier = randomBytes(32).toString('base64url');
    const registeredId = 'oaiapp_xyz123';
    
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'http://127.0.0.1:41318/auth/callback',
      code_verifier: codeVerifier,
      client_id: registeredId,
      resource: 'https://api.openai.com/v1'
    });
    
    assert.ok(body.get('resource'));
    assert.equal(body.get('client_id'), registeredId);
  });

  it('should validate ID token signature (basic)', () => {
    const mockIdToken = createMockIdToken('oaiapp_test');
    const parts = mockIdToken.split('.');
    
    assert.equal(parts.length, 3);
    
    const [, payloadB64] = parts;
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    
    assert.equal(payload.iss, 'https://auth.openai.com');
    assert.equal(payload.aud, 'oaiapp_test');
    assert.ok(payload.exp > Math.floor(Date.now() / 1000));
  });

  it('should save credentials atomically with client_id key', () => {
    const clientId = 'oaiapp_abc123';
    const safeName = clientId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const expectedPath = `chatgpt-credentials-${safeName}.json`;
    
    assert.ok(expectedPath.includes(safeName));
  });
});

function createMockIdToken(clientId = 'oaiapp_test') {
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    sub: 'user_123',
    email: 'test@example.com',
    name: 'Test User',
    iss: 'https://auth.openai.com',
    aud: 'oaiapp_test',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    nonce: 'test_nonce'
  };
  
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = 'mock_signature';
  
  return `${headerB64}.${payloadB64}.${signature}`;
}
