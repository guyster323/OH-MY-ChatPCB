import { randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
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
const REDIRECT_URI_PORT = 41318;
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

function getCredentialsPath() {
  return join(getConfigDir(), 'chatgpt-credentials.json');
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
    const path = getCredentialsPath();
    if (!existsSync(path)) return null;
    const raw = await readFile(path, 'utf-8');
    const creds = JSON.parse(raw);
    if (!creds.client_id || !creds.access_token) return null;
    return creds;
  } catch {
    return null;
  }
}

export async function saveCredentials(creds) {
  const path = getCredentialsPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(creds, null, 2), { mode: 0o600 });
  await chmod(path, 0o600);
}

export async function deleteCredentials() {
  try {
    const path = getCredentialsPath();
    if (existsSync(path)) {
      const { unlink } = await import('node:fs/promises');
      await unlink(path);
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

export function startAuthFlow({ onBrowserOpen, onError } = {}) {
  const state = generateState();
  const nonce = generateNonce();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  
  let server;
  let timeoutHandle;
  let resolveAuth;
  let rejectAuth;

  const promise = new Promise((resolve, reject) => {
    resolveAuth = resolve;
    rejectAuth = reject;
  });

  const redirectUri = `http://127.0.0.1:${REDIRECT_URI_PORT}/auth/callback`;
  
  // Dynamic client registration will happen on first request
  // We use a placeholder client_id initially
  const initialClientId = 'dynamic_agent_client';

  const authParams = new URLSearchParams({
    response_type: 'code',
    client_id: initialClientId,
    redirect_uri: redirectUri,
    scope: SCOPES,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    resource: RESOURCE,
    agent_name_hint: 'ChatPCB',
    ext_agent_host_id: 'oh-my-chatpcb'
  });

  const authUrl = `${AUTH_ENDPOINT}?${authParams.toString()}`;

  const cleanup = () => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (server) {
      server.close();
      server = null;
    }
  };

  server = http.createServer(async (req, res) => {
    const url = parseUrl(req.url, true);
    
    if (url.pathname !== '/auth/callback') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const callbackState = url.query.state;
    const code = url.query.code;
    const error = url.query.error;

    // Send HTML response to browser
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    
    if (error) {
      res.end(`
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Sign-in cancelled</title></head>
<body>
  <h1>Sign-in was cancelled</h1>
  <p>You can close this window and return to ChatPCB.</p>
  <p>브라우저를 닫고 ChatPCB로 돌아가세요.</p>
</body>
</html>
      `);
      cleanup();
      rejectAuth({ code: 'cancelled', message: 'User cancelled sign-in' });
      return;
    }

    if (callbackState !== state) {
      res.end(`
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Sign-in error</title></head>
<body>
  <h1>Sign-in error: state mismatch</h1>
  <p>You can close this window and try again in ChatPCB.</p>
  <p>브라우저를 닫고 ChatPCB에서 다시 시도하세요.</p>
</body>
</html>
      `);
      cleanup();
      rejectAuth({ code: 'state_mismatch', message: 'State parameter mismatch' });
      return;
    }

    if (!code) {
      res.end(`
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Sign-in error</title></head>
<body>
  <h1>Sign-in error: no authorization code</h1>
  <p>You can close this window and try again in ChatPCB.</p>
  <p>브라우저를 닫고 ChatPCB에서 다시 시도하세요.</p>
</body>
</html>
      `);
      cleanup();
      rejectAuth({ code: 'no_code', message: 'No authorization code received' });
      return;
    }

    res.end(`
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Signed in</title></head>
<body>
  <h1>Successfully signed in</h1>
  <p>You can close this window and return to ChatPCB.</p>
  <p>브라우저를 닫고 ChatPCB로 돌아가세요.</p>
</body>
</html>
    `);

    cleanup();

    try {
      // Exchange code for tokens
      const tokenBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
        client_id: initialClientId
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

      // Decode and verify ID token
      const idToken = tokens.id_token;
      if (!idToken) {
        throw new Error('No ID token received');
      }

      const [headerB64, payloadB64] = idToken.split('.');
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());

      // Verify nonce
      if (payload.nonce !== nonce) {
        throw new Error('ID token nonce mismatch');
      }

      // Verify chatgpt.tokens.use.direct scope
      const scope = tokens.scope || '';
      if (!scope.includes('chatgpt.tokens.use.direct')) {
        throw new Error('chatgpt.tokens.use.direct permission not granted');
      }

      // Extract email and plan (if available)
      const account = {
        email: payload.email || payload.sub,
        name: payload.name
      };

      // The actual client_id may be in the response (for dynamic registration)
      // or we use the one from the ID token audience
      const clientId = tokens.client_id || payload.aud || initialClientId;

      resolveAuth({
        client_id: clientId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        id_token: tokens.id_token,
        token_type: tokens.token_type || 'Bearer',
        expires_in: tokens.expires_in,
        issued_at: Date.now(),
        scope: tokens.scope,
        account
      });
    } catch (err) {
      rejectAuth({ code: 'token_exchange_failed', message: err.message });
    }
  });

  server.listen(REDIRECT_URI_PORT, '127.0.0.1', () => {
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
  });

  const attemptId = randomBytes(8).toString('hex');

  return {
    attemptId,
    authUrl,
    promise,
    cancel: () => {
      cleanup();
      rejectAuth({ code: 'cancelled', message: 'Sign-in cancelled by user' });
    },
    reopen: () => {
      return authUrl;
    }
  };
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
  // For now, return 'Unknown' if we can't determine it
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
