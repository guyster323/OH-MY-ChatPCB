import { createHash, createPublicKey, createVerify, randomBytes } from 'node:crypto';
import { access, chmod, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import http from 'node:http';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';

const AUTH_ENDPOINT = 'https://auth.openai.com/api/accounts/authorize';
const TOKEN_ENDPOINT = 'https://auth.openai.com/api/accounts/oauth/token';
const JWKS_ENDPOINT = 'https://auth.openai.com/api/accounts/.well-known/jwks.json';
const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const REDIRECT_URI_PORT_START = 41318;
const REDIRECT_URI_PORT_MAX_ATTEMPTS = 10;
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const CLIENT_ID_ENV = 'CHATPCB_CHATGPT_CLIENT_ID';
const MODEL_ENV = 'CHATPCB_CHATGPT_MODEL';

/**
 * Resolve the ChatGPT client id and optional model override.
 *
 * Precedence for each value is: explicit option, then environment
 * (`CHATPCB_CHATGPT_CLIENT_ID`, `CHATPCB_CHATGPT_MODEL`), then `chatgpt.json`
 * in the ChatPCB config directory (`clientId`, `model`). The client id also
 * falls back to `savedClientId` from the selected saved account.
 * A client id on the browser callback query is never consulted.
 */
export async function resolveChatGPTSettings({ clientId, model, savedClientId } = {}) {
  const file = await readChatGPTConfig();
  return {
    clientId: firstString(clientId, process.env[CLIENT_ID_ENV], file.clientId, savedClientId),
    model: firstString(model, process.env[MODEL_ENV], file.model)
  };
}

export function browserOpenCommand(url, platform = process.platform) {
  if (platform === 'darwin') return { command: 'open', args: [url] };
  if (platform === 'win32') return { command: 'rundll32', args: ['url.dll,FileProtocolHandler', url] };
  return { command: 'xdg-open', args: [url] };
}

export function openSystemBrowser(url, { platform = process.platform, spawnImpl = spawn } = {}) {
  const { command, args } = browserOpenCommand(url, platform);
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawnImpl(command, args, {
        stdio: 'ignore',
        detached: true,
        shell: false
      });
    } catch (error) {
      resolve({ success: false, error });
      return;
    }

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    proc.on('error', (error) => finish({ success: false, error }));
    proc.on('spawn', () => {
      if (typeof proc.unref === 'function') proc.unref();
      finish({ success: true });
    });
  });
}

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
  const safeName = String(clientId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(getConfigDir(), `chatgpt-credentials-${safeName}.json`);
}

function getHostIdPath() {
  return join(getConfigDir(), 'chatgpt-host-id.txt');
}

function isCredentialFile(name) {
  return name === 'chatgpt-credentials.json' || /^chatgpt-credentials-.+\.json$/.test(name);
}

async function getOrCreateHostId() {
  const path = getHostIdPath();
  try {
    await access(path);
    const hostId = await readFile(path, 'utf8');
    if (hostId.trim()) return hostId.trim();
  } catch {
    // File doesn't exist or is empty
  }

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

/**
 * Load the ChatGPT account to use.
 *
 * When more than one credential file exists, selection is deterministic:
 * 1. most recently used (`last_used_at`, otherwise `issued_at`), newest first
 * 2. email, ascending and case-insensitive
 * 3. `client_id`, ascending
 *
 * Sign-in and a completed Responses call set `last_used_at`.
 * Legacy `chatgpt-credentials.json` is included. Temporary write files are not.
 */
export async function loadCredentials() {
  try {
    const configDir = getConfigDir();
    if (!existsSync(configDir)) return null;
    const files = await readdir(configDir);
    const loaded = [];
    for (const name of files) {
      if (!isCredentialFile(name)) continue;
      try {
        loaded.push(JSON.parse(await readFile(join(configDir, name), 'utf8')));
      } catch {
        // Skip unreadable credential files so one bad file does not hide the rest.
      }
    }
    return selectSavedAccount(loaded);
  } catch {
    return null;
  }
}

/**
 * Same ordering as loadCredentials. Invalid records (no client_id or access_token) are dropped.
 */
export function selectSavedAccount(candidates) {
  const usable = [];
  for (const creds of candidates ?? []) {
    if (!creds || typeof creds !== 'object' || Array.isArray(creds)) continue;
    if (!creds.client_id || !creds.access_token) continue;
    usable.push(creds);
  }
  usable.sort(compareSavedAccounts);
  return usable[0] ?? null;
}

function accountEmail(creds) {
  return String(creds.account?.email || '').toLocaleLowerCase();
}

function accountUsedAt(creds) {
  const used = Number(creds.last_used_at);
  if (Number.isFinite(used) && used > 0) return used;
  const issued = Number(creds.issued_at);
  if (Number.isFinite(issued) && issued > 0) return issued;
  return 0;
}

function compareSavedAccounts(a, b) {
  const byUse = accountUsedAt(b) - accountUsedAt(a);
  if (byUse !== 0) return byUse;
  const byEmail = accountEmail(a).localeCompare(accountEmail(b));
  if (byEmail !== 0) return byEmail;
  return String(a.client_id).localeCompare(String(b.client_id));
}

export async function saveCredentials(creds) {
  const clientId = creds.client_id || 'default';
  const stored = {
    ...creds,
    last_used_at: typeof creds.last_used_at === 'number' ? creds.last_used_at : Date.now()
  };
  const path = getCredentialsPath(clientId);
  const dir = dirname(path);

  await mkdir(dir, { recursive: true });

  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, JSON.stringify(stored, null, 2), { mode: 0o600 });
  await chmod(tempPath, 0o600);
  await rename(tempPath, path);
  await chmod(path, 0o600);
  return stored;
}

export async function deleteCredentials() {
  try {
    const configDir = getConfigDir();
    if (!existsSync(configDir)) return;

    const files = await readdir(configDir);
    for (const file of files) {
      if (isCredentialFile(file) || file === 'chatgpt-credentials.json') {
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

export async function verifyIdToken(idToken, expectedNonce, expectedClientId) {
  const parts = String(idToken ?? '').split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new Error('Invalid ID token format');
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  let header;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
  } catch {
    throw new Error('Invalid ID token header');
  }

  if (header.alg !== 'RS256') {
    throw new Error(`ID token alg must be RS256, got ${header.alg ?? 'none'}`);
  }
  if (typeof header.kid !== 'string' || header.kid.length === 0) {
    throw new Error('Unknown ID token kid');
  }

  const jwks = await fetchJWKS();
  const keys = Array.isArray(jwks?.keys) ? jwks.keys : [];
  const jwk = keys.find((key) => key && key.kid === header.kid);
  if (!jwk) {
    throw new Error(`Unknown ID token kid: ${header.kid}`);
  }

  const signingInput = `${headerB64}.${payloadB64}`;
  let signatureOk = false;
  try {
    const key = createPublicKey({ key: jwk, format: 'jwk' });
    const verifier = createVerify('RSA-SHA256');
    verifier.update(signingInput);
    verifier.end();
    signatureOk = verifier.verify(key, Buffer.from(signatureB64, 'base64url'));
  } catch (error) {
    throw new Error(`ID token signature verification failed: ${error.message}`);
  }
  if (!signatureOk) {
    throw new Error('ID token signature verification failed');
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
  } catch {
    throw new Error('Invalid ID token payload');
  }

  if (payload.nonce !== expectedNonce) {
    throw new Error('ID token nonce mismatch');
  }
  if (payload.iss !== ISSUER) {
    throw new Error(`Invalid issuer: ${payload.iss}`);
  }
  if (payload.aud !== expectedClientId) {
    throw new Error(`Invalid audience: ${payload.aud}`);
  }
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
    throw new Error('ID token is missing exp');
  }
  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error('ID token has expired');
  }

  return payload;
}

export function startAuthFlow({
  clientId,
  onBrowserOpen,
  onError,
  onTimeout,
  spawnImpl,
  portStart,
  portAttempts,
  timeoutMs
} = {}) {
  const configuredClientId = typeof clientId === 'string' ? clientId.trim() : '';
  const attemptId = randomBytes(8).toString('hex');

  if (!configuredClientId) {
    const error = {
      code: 'client_id_not_configured',
      message: 'ChatGPT client id is not configured. Set CHATPCB_CHATGPT_CLIENT_ID or chatgpt.json clientId.'
    };
    const promise = Promise.reject(error);
    promise.catch(() => {});
    return {
      attemptId,
      get authUrl() { return null; },
      whenReady: promise,
      promise,
      cancel: async () => {},
      reopen: () => null
    };
  }

  const state = generateState();
  const nonce = generateNonce();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const portBase = Number.isInteger(portStart) ? portStart : REDIRECT_URI_PORT_START;
  const attempts = Number.isInteger(portAttempts) ? portAttempts : REDIRECT_URI_PORT_MAX_ATTEMPTS;
  const authTimeoutMs = Number.isInteger(timeoutMs) ? timeoutMs : AUTH_TIMEOUT_MS;

  let server = null;
  let actualPort = null;
  let timeoutHandle = null;
  let authUrl = null;
  let settled = false;
  let readySettled = false;
  let resolveAuth;
  let rejectAuth;
  let readyResolve;
  let readyReject;

  const promise = new Promise((resolve, reject) => {
    resolveAuth = resolve;
    rejectAuth = reject;
  });
  promise.catch(() => {});

  const whenReady = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  whenReady.catch(() => {});

  const cleanup = ({ force = false } = {}) => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
    const closing = server;
    server = null;
    if (!closing) return Promise.resolve();
    if (!force) {
      closing.close();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 1000);
      if (typeof timer.unref === 'function') timer.unref();
      closing.close(() => {
        clearTimeout(timer);
        resolve();
      });
      if (typeof closing.closeAllConnections === 'function') {
        try { closing.closeAllConnections(); } catch { /* already closed */ }
      }
    });
  };

  const finish = (error, { force = false } = {}) => {
    if (settled) return Promise.resolve();
    settled = true;
    const closed = cleanup({ force });
    if (!readySettled) {
      readySettled = true;
      readyReject(error);
    }
    rejectAuth(error);
    return closed;
  };

  const succeed = (value) => {
    if (settled) return;
    settled = true;
    cleanup({ force: false });
    resolveAuth(value);
  };

  const handleCallback = async (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://127.0.0.1');
    } catch {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }

    if (url.pathname !== '/auth/callback') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const callbackState = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    // The callback query client_id is ignored. Token exchange uses the configured id.

    if (error) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(createErrorPage('Sign-in was cancelled', '로그인이 취소되었습니다'));
      await finish({ code: 'cancelled', message: 'User cancelled sign-in' });
      return;
    }

    if (callbackState !== state) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(createErrorPage('Sign-in error: state mismatch', '로그인 오류: 상태 불일치'));
      await finish({ code: 'state_mismatch', message: 'State parameter mismatch' });
      return;
    }

    if (!code) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(createErrorPage('Sign-in error: no authorization code', '로그인 오류: 인증 코드 없음'));
      await finish({ code: 'no_code', message: 'No authorization code received' });
      return;
    }

    try {
      const redirectUri = `http://127.0.0.1:${actualPort}/auth/callback`;
      const tokenBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
        client_id: configuredClientId,
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
      if (!tokens.id_token) {
        throw new Error('No ID token received');
      }

      const payload = await verifyIdToken(tokens.id_token, nonce, configuredClientId);
      const scope = tokens.scope || '';
      if (!scope.includes('chatgpt.tokens.use.direct')) {
        throw new Error('chatgpt.tokens.use.direct permission not granted');
      }

      const creds = {
        client_id: configuredClientId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        id_token: tokens.id_token,
        token_type: tokens.token_type || 'Bearer',
        expires_in: tokens.expires_in,
        issued_at: Date.now(),
        scope: tokens.scope,
        account: {
          email: payload.email || payload.sub,
          name: payload.name
        }
      };

      await saveCredentials(creds);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(createSuccessPage());
      succeed(creds);
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(createErrorPage(`Sign-in error: ${err.message}`, `로그인 오류: ${err.message}`));
      await finish({ code: 'token_exchange_failed', message: err.message });
    }
  };

  const tryPort = (port) => new Promise((resolve, reject) => {
    const testServer = http.createServer((req, res) => {
      handleCallback(req, res).catch((err) => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        }
        res.end('Sign-in error');
        finish({ code: 'server_error', message: err.message }).catch(() => {});
      });
    });
    let decided = false;
    const decide = (fn, value) => {
      if (decided) return;
      decided = true;
      fn(value);
    };

    testServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') decide(resolve, false);
      else decide(reject, err);
    });

    testServer.listen(port, '127.0.0.1', () => {
      actualPort = port;
      server = testServer;
      decide(resolve, true);
    });
  });

  const startServer = async () => {
    for (let i = 0; i < attempts; i += 1) {
      const port = portBase + i;
      const success = await tryPort(port);
      if (success) return port;
    }
    throw new Error('Could not find available port for callback server');
  };

  const cancelError = (code) => {
    if (code === 'superseded') {
      return { code, message: 'Sign-in replaced by a new attempt' };
    }
    if (code === 'cancelled') {
      return { code, message: 'Sign-in cancelled by user' };
    }
    return { code: code || 'cancelled', message: 'Sign-in cancelled by user' };
  };

  startServer().then(async (port) => {
    try {
      actualPort = port;
      const redirectUri = `http://127.0.0.1:${actualPort}/auth/callback`;
      const hostId = await getOrCreateHostId();
      const authParams = new URLSearchParams({
        response_type: 'code',
        client_id: configuredClientId,
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
      authUrl = `${AUTH_ENDPOINT}?${authParams.toString()}`;
      timeoutHandle = setTimeout(() => {
        if (typeof onTimeout === 'function') onTimeout();
        finish({ code: 'timeout', message: 'Sign-in timed out after 5 minutes' }, { force: true }).catch(() => {});
      }, authTimeoutMs);
      if (!readySettled) {
        readySettled = true;
        readyResolve(authUrl);
      }
    } catch (error) {
      await finish({ code: 'server_error', message: error.message }, { force: true });
      return;
    }

    try {
      const browserResult = await openSystemBrowser(authUrl, { spawnImpl });
      if (settled) return;
      if (!browserResult.success && onError) {
        onError({ code: 'open_failed', message: 'Could not open browser', authUrl });
      }
      if (onBrowserOpen) {
        onBrowserOpen({
          authUrl,
          error: browserResult.success ? null : 'open_failed'
        });
      }
    } catch (error) {
      if (settled) return;
      if (onError) onError({ code: 'open_failed', message: error.message, authUrl });
      if (onBrowserOpen) onBrowserOpen({ authUrl, error: 'open_failed' });
    }
  }).catch((error) => {
    finish({ code: 'server_error', message: error.message }, { force: true }).catch(() => {});
  });

  return {
    attemptId,
    get authUrl() { return authUrl; },
    whenReady,
    promise,
    cancel: (code = 'cancelled') => finish(cancelError(code), { force: true }),
    reopen: () => authUrl
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

function emitAuth(emitFn, payload) {
  if (typeof emitFn !== 'function') return;
  try {
    emitFn('auth.chatgpt.changed', payload);
  } catch {
    // The panel socket may already be gone.
  }
}

// One manager is created for the daemon lifetime and shared by every message.
export function createChatGPTAuthManager({
  clientId,
  spawnImpl,
  portStart,
  portAttempts,
  timeoutMs
} = {}) {
  const activeAuthAttempts = new Map();
  let startQueue = Promise.resolve();
  // The next sign-in starts after the previous callback port so a late redirect
  // from the closed listener cannot reach the new session.
  let nextPort = Number.isInteger(portStart) ? portStart : undefined;

  async function getAuthStatus() {
    const creds = await loadCredentials();
    if (!creds || !creds.access_token) return { state: 'signed_out' };
    const plan = extractPlan(creds);
    return {
      state: 'signed_in',
      account: creds.account,
      plan: plan || undefined
    };
  }

  async function closeActiveAttempts() {
    const flows = [...activeAuthAttempts.values()];
    activeAuthAttempts.clear();
    await Promise.all(flows.map((flow) => Promise.resolve(flow.cancel('superseded')).catch(() => {})));
  }

  async function beginStart(args, emitFn) {
    await closeActiveAttempts();
    const saved = await loadCredentials();
    const settings = await resolveChatGPTSettings({
      clientId: args?.clientId ?? clientId,
      savedClientId: saved?.client_id
    });
    if (!settings.clientId) {
      const error = new Error('ChatGPT client id is not configured. Set CHATPCB_CHATGPT_CLIENT_ID or chatgpt.json clientId.');
      error.code = 'client_id_not_configured';
      throw error;
    }

    const authFlow = startAuthFlow({
      clientId: settings.clientId,
      spawnImpl,
      portStart: nextPort,
      portAttempts,
      timeoutMs,
      onBrowserOpen: ({ authUrl, error }) => {
        emitAuth(emitFn, {
          state: error ? 'error' : 'waiting',
          code: error || undefined,
          authUrl,
          attemptId: authFlow.attemptId
        });
      },
      onError: ({ code, authUrl }) => {
        emitAuth(emitFn, { state: 'error', code, authUrl, attemptId: authFlow.attemptId });
      }
    });

    activeAuthAttempts.set(authFlow.attemptId, authFlow);
    authFlow.promise.then(
      (creds) => {
        activeAuthAttempts.delete(authFlow.attemptId);
        emitAuth(emitFn, {
          state: 'signed_in',
          account: creds.account,
          plan: extractPlan(creds) || undefined,
          attemptId: authFlow.attemptId
        });
      },
      (error) => {
        activeAuthAttempts.delete(authFlow.attemptId);
        if (!error || error.code === 'superseded') return;
        emitAuth(emitFn, {
          state: 'error',
          code: error.code || 'unknown',
          attemptId: authFlow.attemptId
        });
      }
    );

    let readyUrl;
    try {
      readyUrl = await authFlow.whenReady;
    } catch (error) {
      activeAuthAttempts.delete(authFlow.attemptId);
      const wrapped = new Error(error.message || 'Sign-in failed to start');
      wrapped.code = error.code || 'AUTH_START_FAILED';
      throw wrapped;
    }
    const usedPort = Number(new URL(new URL(readyUrl).searchParams.get('redirect_uri')).port);
    if (Number.isInteger(usedPort) && usedPort > 0) nextPort = usedPort + 1;

    return {
      state: 'waiting',
      authUrl: readyUrl,
      attemptId: authFlow.attemptId
    };
  }

  function startAuth(args, emitFn) {
    const run = startQueue.then(() => beginStart(args, emitFn), () => beginStart(args, emitFn));
    startQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  function reopenAuth(args) {
    const attemptId = args?.attemptId;
    if (!attemptId) return { error: 'attemptId is required' };
    const authFlow = activeAuthAttempts.get(attemptId);
    if (!authFlow) return { error: 'Auth attempt not found or expired' };
    const authUrl = authFlow.reopen();
    if (typeof authUrl !== 'string' || !authUrl.startsWith('https://')) {
      return { error: 'Auth attempt not found or expired' };
    }
    openSystemBrowser(authUrl, { spawnImpl }).catch(() => {});
    return { state: 'waiting', authUrl, attemptId };
  }

  async function cancelAuth(args) {
    const attemptId = args?.attemptId;
    if (!attemptId) return { error: 'attemptId is required' };
    const authFlow = activeAuthAttempts.get(attemptId);
    if (!authFlow) return { state: 'signed_out' };
    await authFlow.cancel('cancelled');
    activeAuthAttempts.delete(attemptId);
    return { state: 'signed_out' };
  }

  async function cancelAll() {
    await closeActiveAttempts();
  }

  async function signOut() {
    await closeActiveAttempts();
    await deleteCredentials();
    return { state: 'signed_out' };
  }

  return {
    getAuthStatus,
    startAuth,
    reopenAuth,
    cancelAuth,
    cancelAll,
    signOut
  };
}

export function verifyTokenExpiry(creds) {
  if (!creds || !creds.issued_at || !creds.expires_in) {
    return { expired: true, shouldRefresh: true };
  }

  const expiresAt = creds.issued_at + (creds.expires_in * 1000);
  const now = Date.now();
  const bufferMs = 60 * 1000;

  return {
    expired: now >= expiresAt,
    shouldRefresh: now >= (expiresAt - bufferMs),
    expiresAt
  };
}

export function extractPlan(creds) {
  if (!creds || !creds.id_token) return null;

  try {
    const [, payloadB64] = creds.id_token.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    return payload.plan || payload['https://api.openai.com/plan'] || null;
  } catch {
    return null;
  }
}

async function readChatGPTConfig() {
  try {
    const raw = await readFile(join(getConfigDir(), 'chatgpt.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}
