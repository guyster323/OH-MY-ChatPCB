import { randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, chmod, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import http from 'node:http';
import { parse as parseUrl } from 'node:url';
import { homedir } from 'node:os';

const AUTH_ENDPOINT = 'https://auth.openai.com/api/accounts/authorize';
const TOKEN_ENDPOINT = 'https://auth.openai.com/api/accounts/oauth/token';
const JWKS_ENDPOINT = 'https://auth.openai.com/api/accounts/.well-known/jwks.json';
const RESOURCE = 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const REDIRECT_URI_PORT_START = 41318;
const REDIRECT_URI_PORT_MAX_ATTEMPTS = 10;
const AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function getConfigDir() {
  const platform = process.platform;
  if (platform === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'chatpcb');
  }
  if (platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'chatpcb');
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'chatpcb');
}

function getCredentialsPath(clientId = 'default') {
  // Use client_id as filename to support multiple accounts
  const safeName = clientId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(getConfigDir(), `chatgpt-credentials-${safeName}.json`);
}

function getHostIdPath() {
  return join(getConfigDir(), 'chatgpt-host-id.txt');
}

async function getOrCreateHostId() {
  const path = getHostIdPath();
  try {
    await access(path);
    const hostId = await readFile(path, 'utf-8');
    if (hostId.trim()) return hostId.trim();
  } catch {
    // File doesn't exist or is empty
  }
  
  // Generate new host ID
  const hostId = `host_${randomBytes(16).toString('hex')}`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, hostId, { mode: 0o600 });
  await chmod(path, 0o600);
  return hostId;
}

function generateCodeVerifier() {
  return randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

function generateState() {
  return randomBytes(16).toString('base64url');
}

function generateNonce() {
  return randomBytes(16).toString('base64url');
}

export async function loadCredentials() {
  try {
    // Try to load default credentials (backward compatibility)
    const defaultPath = join(getConfigDir(), 'chatgpt-credentials.json');
    if (existsSync(defaultPath)) {
      const raw = await readFile(defaultPath, 'utf-8');
      const creds = JSON.parse(raw);
      if (!creds.client_id || !creds.access_token) return null;
      return creds;
    }
    
    // Try to find any credentials file
    const configDir = getConfigDir();
    if (!existsSync(configDir)) return null;
    
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(configDir);
    const credFile = files.find(f => f.startsWith('chatgpt-credentials-'));
    
    if (credFile) {
      const raw = await readFile(join(configDir, credFile), 'utf-8');
      const creds = JSON.parse(raw);
      if (!creds.client_id || !creds.access_token) return null;
      return creds;
    }
    
    return null;
  } catch {
    return null;
  }
}

export async function saveCredentials(creds) {
  const clientId = creds.client_id || 'default';
  const path = getCredentialsPath(clientId);
  const dir = dirname(path);
  
  await mkdir(dir, { recursive: true });
  
  // Atomic write: write to temp file first
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, JSON.stringify(creds, null, 2), { mode: 0o600 });
  await chmod(tempPath, 0o600);
  
  // Rename to final path
  const { rename } = await import('node:fs/promises');
  await rename(tempPath, path);
  await chmod(path, 0o600);
}

export async function deleteCredentials() {
  try {
    const configDir = getConfigDir();
    if (!existsSync(configDir)) return;
    
    const { readdir, unlink } = await import('node:fs/promises');
    const files = await readdir(configDir);
    
    for (const file of files) {
      if (file.startsWith('chatgpt-credentials-') || file === 'chatgpt-credentials.json') {
        await unlink(join(configDir, file)).catch(() => {});
      }
    }
  } catch {
    // ignore
  }
}

export async function refreshAccessToken(refreshToken, clientId) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Token refresh failed: ${response.status} ${text}`);
  }

  return await response.json();
}

async function fetchJWKS() {
  const response = await fetch(JWKS_ENDPOINT);
  if (!response.ok) {
    throw new Error(`Failed to fetch JWKS: ${response.status}`);
  }
  return await response.json();
}

async function verifyIdToken(idToken, expectedNonce, expectedClientId) {
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid ID token format');
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());

  // Verify nonce
  if (payload.nonce !== expectedNonce) {
    throw new Error('ID token nonce mismatch');
  }

  // Verify issuer
  if (payload.iss !== 'https://auth.openai.com') {
    throw new Error(`Invalid issuer: ${payload.iss}`);
  }

  // Verify audience
  if (payload.aud !== expectedClientId) {
    throw new Error(`Invalid audience: ${payload.aud}`);
  }

  // Verify expiration
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    throw new Error('ID token has expired');
  }

  // Note: Full signature verification with JWKS would require a JWT library
  // For production, use a proper JWT verification library like 'jose'
  // Here we do basic validation only
  
  return payload;
}

export function startAuthFlow({ onBrowserOpen, onError } = {}) {
  const state = generateState();
  const nonce = generateNonce();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  
  let server;
  let actualPort;
  let timeoutHandle;
  let resolveAuth;
  let rejectAuth;
  let registeredClientId = null;

  const promise = new Promise((resolve, reject) => {
    resolveAuth = resolve;
    rejectAuth = reject;
  });

  const cleanup = () => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (server) {
      server.close();
      server = null;
    }
  };

  const handleCallback = async (req, res) => {
    const url = parseUrl(req.url, true);
    
    if (url.pathname !== '/auth/callback') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const callbackState = url.query.state;
    const code = url.query.code;
    const error = url.query.error;
    const issuedClientId = url.query.client_id; // From dynamic registration

    if (error) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(createErrorPage('Sign-in was cancelled', '로그인이 취소되었습니다'));
      cleanup();
      rejectAuth({ code: 'cancelled', message: 'User cancelled sign-in' });
      return;
    }

    if (callbackState !== state) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(createErrorPage('Sign-in error: state mismatch', '로그인 오류: 상태 불일치'));
      cleanup();
      rejectAuth({ code: 'state_mismatch', message: 'State parameter mismatch' });
      return;
    }

    if (!code) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(createErrorPage('Sign-in error: no authorization code', '로그인 오류: 인증 코드 없음'));
      cleanup();
      rejectAuth({ code: 'no_code', message: 'No authorization code received' });
      return;
    }

    // Store the issued client_id if provided (dynamic registration)
    if (issuedClientId && issuedClientId.startsWith('oaiapp_')) {
      registeredClientId = issuedClientId;
    }

    try {
      // Exchange code for tokens
      const redirectUri = `http://127.0.0.1:${actualPort}/auth/callback`;
      const clientIdForExchange = registeredClientId || 'dynamic_agent_client';
      
      const tokenBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
        client_id: clientIdForExchange,
        resource: RESOURCE
      });

      const tokenResponse = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenBody.toString()
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text().catch(() => '');
        throw new Error(`Token exchange failed: ${tokenResponse.status} ${errorText}`);
      }

      const tokens = await tokenResponse.json();

      // Verify ID token
      if (!tokens.id_token) {
        throw new Error('No ID token received');
      }

      const finalClientId = tokens.client_id || registeredClientId || clientIdForExchange;
      const payload = await verifyIdToken(tokens.id_token, nonce, finalClientId);

      // Verify chatgpt.tokens.use.direct scope
      const scope = tokens.scope || '';
      if (!scope.includes('chatgpt.tokens.use.direct')) {
        throw new Error('chatgpt.tokens.use.direct permission not granted');
      }

      // Extract account info
      const account = {
        email: payload.email || payload.sub,
        name: payload.name
      };

      const creds = {
        client_id: finalClientId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        id_token: tokens.id_token,
        token_type: tokens.token_type || 'Bearer',
        expires_in: tokens.expires_in,
        issued_at: Date.now(),
        scope: tokens.scope,
        account
      };

      // Save credentials
      await saveCredentials(creds);

      // Only show success page after everything succeeded
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(createSuccessPage());
      
      cleanup();
      resolveAuth(creds);
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(createErrorPage('Sign-in error: ' + err.message, '로그인 오류: ' + err.message));
      cleanup();
      rejectAuth({ code: 'token_exchange_failed', message: err.message });
    }
  };

  const tryPort = async (port) => {
    return new Promise((resolve, reject) => {
      const testServer = http.createServer(handleCallback);
      
      testServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          resolve(false);
        } else {
          reject(err);
        }
      });

      testServer.listen(port, '127.0.0.1', () => {
        actualPort = port;
        server = testServer;
        resolve(true);
      });
    });
  };

  const startServer = async () => {
    // Try ports from REDIRECT_URI_PORT_START to REDIRECT_URI_PORT_START + MAX_ATTEMPTS
    for (let i = 0; i < REDIRECT_URI_PORT_MAX_ATTEMPTS; i++) {
      const port = REDIRECT_URI_PORT_START + i;
      const success = await tryPort(port);
      if (success) {
        return port;
      }
    }
    throw new Error('Could not find available port for callback server');
  };

  startServer().then(async (port) => {
    actualPort = port;
    const redirectUri = `http://127.0.0.1:${actualPort}/auth/callback`;
    const hostId = await getOrCreateHostId();
    
    const authParams = new URLSearchParams({
      response_type: 'code',
      client_id: 'dynamic_agent_client',
      redirect_uri: redirectUri,
      scope: SCOPES,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      resource: RESOURCE,
      agent_name_hint: 'ChatPCB',
      ext_agent_host_id: hostId
    });

    const authUrl = `${AUTH_ENDPOINT}?${authParams.toString()}`;

    timeoutHandle = setTimeout(() => {
      cleanup();
      rejectAuth({ code: 'timeout', message: 'Sign-in timed out after 5 minutes' });
    }, AUTH_TIMEOUT_MS);

    // Try to open browser
    import('node:child_process').then(({ exec }) => {
      let openCommand;
      const platform = process.platform;
      if (platform === 'darwin') openCommand = 'open';
      else if (platform === 'win32') openCommand = 'start';
      else openCommand = 'xdg-open';

      exec(`${openCommand} "${authUrl}"`, (error) => {
        if (error && onError) {
          onError({ code: 'open_failed', message: 'Could not open browser', authUrl });
        }
        if (onBrowserOpen) {
          onBrowserOpen({ authUrl, error: error ? 'open_failed' : null });
        }
      });
    });

    if (onBrowserOpen && !onError) {
      onBrowserOpen({ authUrl, error: null });
    }
  }).catch((error) => {
    cleanup();
    rejectAuth({ code: 'server_error', message: error.message });
  });

  const attemptId = randomBytes(8).toString('hex');

  return {
    attemptId,
    get authUrl() {
      return actualPort ? `${AUTH_ENDPOINT}?...` : null;
    },
    promise,
    cancel: () => {
      cleanup();
      rejectAuth({ code: 'cancelled', message: 'Sign-in cancelled by user' });
    },
    reopen: () => {
      // Return the auth URL if available
      return actualPort ? `${AUTH_ENDPOINT}?...` : null;
    }
  };
}

function createSuccessPage() {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Signed in</title></head>
<body>
  <h1>Successfully signed in</h1>
  <p>You can close this window and return to ChatPCB.</p>
  <p>브라우저를 닫고 ChatPCB로 돌아가세요.</p>
</body>
</html>`;
}

function createErrorPage(titleEn, titleKo) {
  const title = titleKo || titleEn;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body>
  <h1>${escapeHtml(titleEn)}</h1>
  ${titleKo ? `<p>${escapeHtml(titleKo)}</p>` : ''}
  <p>You can close this window and return to ChatPCB.</p>
  <p>브라우저를 닫고 ChatPCB로 돌아가세요.</p>
</body>
</html>`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

export function verifyTokenExpiry(creds) {
  if (!creds || !creds.issued_at || !creds.expires_in) {
    return { expired: true, shouldRefresh: true };
  }
  
  const expiresAt = creds.issued_at + (creds.expires_in * 1000);
  const now = Date.now();
  const bufferMs = 60 * 1000; // Refresh 1 minute before expiry
  
  return {
    expired: now >= expiresAt,
    shouldRefresh: now >= (expiresAt - bufferMs),
    expiresAt
  };
}

export function extractPlan(creds) {
  // Plan extraction from ID token or other source
  // This may not be available in the standard ID token
  if (!creds || !creds.id_token) return null;
  
  try {
    const [, payloadB64] = creds.id_token.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    // Check if plan info is in custom claims
    return payload.plan || payload['https://api.openai.com/plan'] || null;
  } catch {
    return null;
  }
}
