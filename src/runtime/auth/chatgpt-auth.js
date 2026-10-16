import { createHash, createPublicKey, createVerify, randomBytes, randomUUID } from 'node:crypto';
import { chmod, link, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
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
const DIRECT_USE_SCOPE = 'chatgpt.tokens.use.direct';
const DYNAMIC_CLIENT_ID = 'dynamic_agent_client';
const AGENT_NAME_HINT = 'OH-MY-ChatPCB';
const ISSUED_CLIENT_ID = /^oaiapp_[A-Za-z0-9_-]+$/;
// Loopback callback ports for this app. Sign-in always starts at the base port
// and may use the next two only while that port is still busy.
const REDIRECT_URI_PORT_START = 41318;
const REDIRECT_URI_PORT_MAX_ATTEMPTS = 3;
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10 * 1000;
const JWKS_CACHE_TTL_MS = 10 * 60 * 1000;
const jwksCache = new Map();
const CLIENT_ID_ENV = 'CHATPCB_CHATGPT_CLIENT_ID';
const MODEL_ENV = 'CHATPCB_CHATGPT_MODEL';
const HOST_ID_FILE = 'chatgpt-host-id.txt';

/**
 * Resolve an optional ChatGPT client-id override and the model override.
 *
 * Precedence for each value is: explicit option, then environment
 * (`CHATPCB_CHATGPT_CLIENT_ID`, `CHATPCB_CHATGPT_MODEL`), then `chatgpt.json`
 * in the ChatPCB config directory (`clientId`, `model`).
 * No client id is required. Sign-in uses OpenAI dynamic client registration
 * unless an override or a saved issued client id is present.
 */
export async function resolveChatGPTSettings({ clientId, model } = {}) {
  const file = await readChatGPTConfig();
  return {
    clientId: firstString(clientId, process.env[CLIENT_ID_ENV], file.clientId),
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
  return join(getConfigDir(), HOST_ID_FILE);
}

function isCredentialFile(name) {
  return name === 'chatgpt-credentials.json' || /^chatgpt-credentials-.+\.json$/.test(name);
}

async function readTrimmedFile(path) {
  try {
    const value = (await readFile(path, 'utf8')).trim();
    return value || null;
  } catch {
    return null;
  }
}

/**
 * Stable opaque host id, generated once per machine and reused.
 * Format is `urn:uuid:<UUIDv4>`. The file is owner-only (0600) and published
 * with an atomic link so readers never observe a partial write.
 */
export async function getOrCreateHostId() {
  const path = getHostIdPath();
  const existing = await readTrimmedFile(path);
  if (existing) {
    await chmod(path, 0o600).catch(() => {});
    return existing;
  }

  await mkdir(dirname(path), { recursive: true });
  try {
    const raw = await readFile(path, 'utf8');
    if (!raw.trim()) await unlink(path);
  } catch {
    // Absent, which is the expected first-run state.
  }

  const hostId = `urn:uuid:${randomUUID()}`;
  const tempPath = `${path}.${process.pid}.tmp`;
  await writeFile(tempPath, hostId, { mode: 0o600 });
  await chmod(tempPath, 0o600);
  try {
    await link(tempPath, path);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    if (error.code === 'EEXIST') {
      const raced = await readTrimmedFile(path);
      if (raced) {
        await chmod(path, 0o600).catch(() => {});
        return raced;
      }
    }
    throw error;
  }
  await unlink(tempPath).catch(() => {});
  await chmod(path, 0o600);
  return hostId;
}

function isReusableClientId(value) {
  return typeof value === 'string' && value.trim() !== '' && value.trim() !== DYNAMIC_CLIENT_ID;
}

function isNewlyIssuedClientId(value) {
  return typeof value === 'string' && ISSUED_CLIENT_ID.test(value);
}

export function parseScopes(scope) {
  if (Array.isArray(scope)) {
    return scope.filter((item) => typeof item === 'string' && item.length > 0);
  }
  return String(scope || '').split(/\s+/).filter(Boolean);
}

export function hasChatGPTPlanScope(creds) {
  const scopes = new Set([
    ...parseScopes(creds?.scopes),
    ...parseScopes(creds?.scope)
  ]);
  return scopes.has(DIRECT_USE_SCOPE);
}

function subjectFromIdToken(idToken) {
  try {
    const part = String(idToken || '').split('.')[1];
    if (!part) return null;
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString());
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
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
async function readCredentialRecords() {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) return [];
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
  return loaded;
}

export async function loadCredentials() {
  try {
    return selectSavedAccount(await readCredentialRecords());
  } catch {
    return null;
  }
}

async function loadSavedRegistration() {
  try {
    return selectSavedRegistration(await readCredentialRecords());
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
    if (creds.client_id === DYNAMIC_CLIENT_ID) continue;
    usable.push(creds);
  }
  usable.sort(compareSavedAccounts);
  return usable[0] ?? null;
}

/**
 * Same ordering as selectSavedAccount, including signed-out registrations that
 * still have an issued client id. Records that only stored dynamic_agent_client
 * are not registrations.
 */
export function selectSavedRegistration(candidates) {
  const usable = [];
  for (const creds of candidates ?? []) {
    if (!creds || typeof creds !== 'object' || Array.isArray(creds)) continue;
    if (!isReusableClientId(creds.client_id)) continue;
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
  if (creds?.client_id === DYNAMIC_CLIENT_ID) {
    throw new Error('Refusing to save dynamic_agent_client as the ChatGPT client id');
  }
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

function combineSignals(signals) {
  const active = signals.filter(Boolean);
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  return AbortSignal.any(active);
}

function timeoutError(label, timeoutMs) {
  const error = new Error(`${label} timed out after ${timeoutMs}ms`);
  error.code = 'timeout';
  error.name = 'TimeoutError';
  return error;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS, label = 'Request') {
  const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : FETCH_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(ms);
  const signal = combineSignals([options.signal, timeoutSignal]);
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(timeoutError(label, ms)), ms);
      if (typeof timer.unref === 'function') timer.unref();
      fetch(url, { ...options, signal }).then(resolve, (error) => {
        if (timeoutSignal.aborted) {
          reject(timeoutError(label, ms));
          return;
        }
        reject(error);
      });
    });
  } finally {
    clearTimeout(timer);
  }
}

function oauthErrorCode(body) {
  const text = String(body || '').trim().slice(0, 2048);
  if (!text) return '';
  let raw = '';
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.error === 'string') raw = parsed.error;
  } catch {
    const match = /(?:^|[&\s])error=([^&\s]+)/.exec(text);
    if (match) {
      try {
        raw = decodeURIComponent(match[1].replace(/\+/g, ' '));
      } catch {
        raw = match[1];
      }
    }
  }
  return /^[A-Za-z0-9._-]{1,64}$/.test(raw) ? raw : '';
}

async function oauthFailureMessage(prefix, response) {
  const code = oauthErrorCode(await response.text().catch(() => ''));
  return code ? `${prefix}: ${response.status} ${code}` : `${prefix}: ${response.status}`;
}

export function clearJwksCache() {
  jwksCache.clear();
}

async function fetchJWKS({
  issuer = ISSUER,
  timeoutMs = FETCH_TIMEOUT_MS,
  signal,
  ttlMs = JWKS_CACHE_TTL_MS,
  now = Date.now(),
  force = false
} = {}) {
  const cached = jwksCache.get(issuer);
  if (!force && cached) {
    const age = now - cached.fetchedAt;
    if (age >= 0 && age < ttlMs) return cached.body;
  }
  const response = await fetchWithTimeout(JWKS_ENDPOINT, { signal }, timeoutMs, 'JWKS fetch');
  if (!response.ok) {
    throw new Error(`Failed to fetch JWKS: ${response.status}`);
  }
  const body = await response.json();
  jwksCache.set(issuer, { fetchedAt: now, body });
  return body;
}

function jwksKey(jwks, kid) {
  const keys = Array.isArray(jwks?.keys) ? jwks.keys : [];
  return keys.find((key) => key && key.kid === kid) || null;
}

function assertAudience(payload, expectedClientId) {
  const audiences = typeof payload.aud === 'string'
    ? [payload.aud]
    : Array.isArray(payload.aud)
      ? payload.aud.filter((value) => typeof value === 'string')
      : [];
  if (!audiences.includes(expectedClientId)) {
    throw new Error('Invalid audience');
  }
  const azpPresent = payload.azp !== undefined && payload.azp !== null;
  if (audiences.length > 1 && !azpPresent) {
    throw new Error('ID token azp is required when aud has multiple values');
  }
  if (azpPresent && payload.azp !== expectedClientId) {
    throw new Error('Invalid azp');
  }
}

export async function refreshAccessToken(refreshToken, clientId, { fetchTimeoutMs = FETCH_TIMEOUT_MS, signal } = {}) {
  if (!isReusableClientId(clientId)) {
    throw new Error('Cannot refresh ChatGPT tokens without an issued client id');
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    resource: RESOURCE
  });

  const response = await fetchWithTimeout(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal
  }, fetchTimeoutMs, 'Token refresh');

  if (!response.ok) {
    throw new Error(await oauthFailureMessage('Token refresh failed', response));
  }

  return await response.json();
}

export async function verifyIdToken(idToken, expectedNonce, expectedClientId, options = {}) {
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

  const jwksOptions = {
    issuer: ISSUER,
    timeoutMs: options.fetchTimeoutMs,
    signal: options.signal,
    ttlMs: options.jwksTtlMs,
    now: options.now
  };
  let jwks = await fetchJWKS(jwksOptions);
  let jwk = jwksKey(jwks, header.kid);
  if (!jwk) {
    jwks = await fetchJWKS({ ...jwksOptions, force: true });
    jwk = jwksKey(jwks, header.kid);
  }
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
  assertAudience(payload, expectedClientId);
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
    throw new Error('ID token is missing exp');
  }
  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error('ID token has expired');
  }

  return payload;
}

function chooseAuthClient(override, registration) {
  const overrideId = typeof override === 'string' ? override.trim() : '';
  if (overrideId === DYNAMIC_CLIENT_ID) {
    return { clientId: DYNAMIC_CLIENT_ID, mode: 'register' };
  }
  if (overrideId) {
    return { clientId: overrideId, mode: 'reauthorize', ...hintsFor(overrideId, registration) };
  }
  if (registration && isReusableClientId(registration.client_id)) {
    return {
      clientId: registration.client_id,
      mode: 'reauthorize',
      ...hintsFor(registration.client_id, registration)
    };
  }
  return { clientId: DYNAMIC_CLIENT_ID, mode: 'register' };
}

function hintsFor(clientId, registration) {
  if (!registration || registration.client_id !== clientId) return {};
  const email = firstString(registration.email) || '';
  const accountEmail = firstString(registration.account?.email) || '';
  const loginHint = email || (accountEmail.includes('@') ? accountEmail : '');
  const subject = firstString(registration.subject) || subjectFromIdToken(registration.id_token) || '';
  return {
    idTokenHint: firstString(registration.id_token) || undefined,
    loginHint: loginHint || undefined,
    expectedSubject: subject || undefined
  };
}

function registrationError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function resolveIssuedClientId(pendingClientId, registrationMode, callbackClientId) {
  if (registrationMode === 'register') {
    if (!isNewlyIssuedClientId(callbackClientId)) {
      return registrationError(
        'ChatGPT registration is incomplete: the callback did not return an issued client id',
        'registration_incomplete'
      );
    }
    return callbackClientId;
  }
  if (callbackClientId && callbackClientId !== pendingClientId) {
    return registrationError(
      'Callback client id does not match the selected account',
      'client_id_mismatch'
    );
  }
  if (!isReusableClientId(pendingClientId)) {
    return registrationError(
      'ChatGPT registration is incomplete: the callback did not return an issued client id',
      'registration_incomplete'
    );
  }
  return pendingClientId;
}

function buildStoredCredentials({ issuedClientId, tokens, payload, hostId, scopes }) {
  const savedAt = Date.now();
  const email = typeof payload.email === 'string' ? payload.email : '';
  return {
    email,
    issuer: payload.iss,
    subject: payload.sub,
    client_id: issuedClientId,
    ext_agent_host_id: hostId,
    id_token: tokens.id_token,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_type: tokens.token_type || 'Bearer',
    expires_in: tokens.expires_in,
    scopes,
    saved_at: new Date(savedAt).toISOString(),
    scope: typeof tokens.scope === 'string' ? tokens.scope : scopes.join(' '),
    issued_at: savedAt,
    last_used_at: savedAt,
    account: {
      email: email || payload.sub,
      name: payload.name
    }
  };
}

function retainRegistration(creds) {
  const subject = firstString(creds.subject) || subjectFromIdToken(creds.id_token) || undefined;
  const email = firstString(creds.email, creds.account?.email) || undefined;
  return {
    email,
    issuer: creds.issuer || ISSUER,
    subject,
    client_id: creds.client_id,
    ext_agent_host_id: creds.ext_agent_host_id,
    token_type: creds.token_type,
    expires_in: creds.expires_in,
    scopes: creds.scopes,
    scope: creds.scope,
    saved_at: creds.saved_at,
    issued_at: creds.issued_at,
    last_used_at: creds.last_used_at,
    account: creds.account
  };
}

async function clearStoredSecrets() {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) return;
  const files = await readdir(configDir);
  for (const file of files) {
    if (!isCredentialFile(file)) continue;
    const full = join(configDir, file);
    let creds;
    try {
      creds = JSON.parse(await readFile(full, 'utf8'));
    } catch {
      await unlink(full).catch(() => {});
      continue;
    }
    if (!creds || typeof creds !== 'object' || !isReusableClientId(creds.client_id)) {
      await unlink(full).catch(() => {});
      continue;
    }
    await saveCredentials(retainRegistration(creds));
    const canonical = getCredentialsPath(creds.client_id);
    if (full !== canonical) await unlink(full).catch(() => {});
  }
}

export function startAuthFlow({
  clientId,
  mode,
  idTokenHint,
  loginHint,
  expectedSubject,
  onBrowserOpen,
  onError,
  onTimeout,
  spawnImpl,
  portStart,
  portAttempts,
  timeoutMs,
  fetchTimeoutMs
} = {}) {
  const requestedClientId = typeof clientId === 'string' ? clientId.trim() : '';
  const pendingClientId = requestedClientId || DYNAMIC_CLIENT_ID;
  const registrationMode = mode || (pendingClientId === DYNAMIC_CLIENT_ID ? 'register' : 'reauthorize');
  const attemptId = randomBytes(8).toString('hex');

  const state = generateState();
  const nonce = generateNonce();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const portBase = Number.isInteger(portStart) ? portStart : REDIRECT_URI_PORT_START;
  const attempts = Number.isInteger(portAttempts) ? portAttempts : REDIRECT_URI_PORT_MAX_ATTEMPTS;
  const authTimeoutMs = Number.isInteger(timeoutMs) ? timeoutMs : AUTH_TIMEOUT_MS;
  const requestTimeoutMs = Number.isFinite(fetchTimeoutMs) && fetchTimeoutMs > 0
    ? fetchTimeoutMs
    : FETCH_TIMEOUT_MS;

  let server = null;
  let actualPort = null;
  let timeoutHandle = null;
  let authUrl = null;
  let hostId = null;
  let settled = false;
  let terminal = false;
  let readySettled = false;
  let attemptSerial = 0;
  const exchangeAbort = new AbortController();
  const callbacks = new Set();
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

  // Bumps the attempt generation synchronously so a late token response cannot save.
  const invalidate = () => {
    attemptSerial += 1;
    if (!exchangeAbort.signal.aborted) exchangeAbort.abort();
    settled = true;
  };

  const attemptStillCurrent = (serial) => (
    serial === attemptSerial && !settled && !exchangeAbort.signal.aborted
  );

  const finish = (error, { force = false } = {}) => {
    invalidate();
    if (terminal) return Promise.resolve();
    terminal = true;
    const closed = cleanup({ force });
    if (!readySettled) {
      readySettled = true;
      readyReject(error);
    }
    rejectAuth(error);
    return closed;
  };

  const succeed = (value) => {
    if (settled || terminal) return;
    settled = true;
    terminal = true;
    cleanup({ force: false });
    resolveAuth(value);
  };

  function endQuietly(res) {
    if (!res || res.writableEnded || res.destroyed) return;
    try {
      if (!res.headersSent) res.writeHead(409, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Sign-in ended');
    } catch {
      // The callback listener is already closed.
    }
  }

  function trackCallback(task) {
    callbacks.add(task);
    task.finally(() => callbacks.delete(task));
    return task;
  }

  async function whenCallbacksSettled() {
    while (callbacks.size > 0) {
      const pending = [...callbacks];
      await Promise.all(pending.map((task) => task.catch(() => {})));
    }
  }

  async function restoreCredentialFile(credPath, previous) {
    if (previous == null) {
      await unlink(credPath).catch(() => {});
      return;
    }
    await writeFile(credPath, previous, { mode: 0o600 });
    await chmod(credPath, 0o600);
  }

  async function saveIfStillActive(creds, serial) {
    if (!attemptStillCurrent(serial)) return false;
    const credPath = getCredentialsPath(creds.client_id || 'default');
    let previous = null;
    try {
      previous = await readFile(credPath);
    } catch {
      previous = null;
    }
    if (!attemptStillCurrent(serial)) return false;
    await saveCredentials(creds);
    if (!attemptStillCurrent(serial)) {
      await restoreCredentialFile(credPath, previous);
      return false;
    }
    return true;
  }

  const handleCallback = (req, res) => trackCallback((async () => {
    const serial = attemptSerial;
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
    const callbackClientId = url.searchParams.get('client_id');

    // Any page can request this URL. A missing or wrong state must not end the login,
    // and error= is only handled after the state matches this attempt.
    if (callbackState !== state) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(createErrorPage('Sign-in error: state mismatch', '로그인 오류: 상태 불일치'));
      return;
    }

    if (!attemptStillCurrent(serial)) {
      endQuietly(res);
      return;
    }

    if (error) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(createErrorPage('Sign-in was cancelled', '로그인이 취소되었습니다'));
      const denied = error === 'access_denied';
      await finish({
        code: denied ? 'access_denied' : 'cancelled',
        message: denied ? 'Sign-in was denied' : 'User cancelled sign-in'
      });
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
      const issuedClientId = resolveIssuedClientId(pendingClientId, registrationMode, callbackClientId);
      if (issuedClientId instanceof Error) throw issuedClientId;
      const tokenBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
        client_id: issuedClientId,
        resource: RESOURCE
      });

      const tokenResponse = await fetchWithTimeout(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenBody.toString(),
        signal: exchangeAbort.signal
      }, requestTimeoutMs, 'Token exchange');

      if (!attemptStillCurrent(serial)) {
        endQuietly(res);
        return;
      }

      if (!tokenResponse.ok) {
        throw new Error(await oauthFailureMessage('Token exchange failed', tokenResponse));
      }

      let tokens;
      try {
        tokens = await tokenResponse.json();
      } catch {
        throw new Error(`Token exchange failed: ${tokenResponse.status}`);
      }
      if (!tokens.id_token) {
        throw new Error('No ID token received');
      }

      const payload = await verifyIdToken(tokens.id_token, nonce, issuedClientId, {
        fetchTimeoutMs: requestTimeoutMs,
        signal: exchangeAbort.signal
      });
      if (!attemptStillCurrent(serial)) {
        endQuietly(res);
        return;
      }
      if (expectedSubject && payload.sub !== expectedSubject) {
        throw registrationError(
          'ID token subject does not match the selected account',
          'subject_mismatch'
        );
      }
      // Exact scope token. A substring check would accept a longer lookalike scope.
      const scopes = parseScopes(tokens.scope);
      if (!scopes.includes(DIRECT_USE_SCOPE)) {
        throw registrationError(
          'chatgpt.tokens.use.direct permission not granted',
          'scope_not_granted'
        );
      }

      const creds = buildStoredCredentials({
        issuedClientId,
        tokens,
        payload,
        hostId,
        scopes
      });

      const saved = await saveIfStillActive(creds, serial);
      if (!saved) {
        endQuietly(res);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(createSuccessPage());
      succeed(creds);
    } catch (err) {
      if (!attemptStillCurrent(serial)) {
        endQuietly(res);
        return;
      }
      const message = typeof err?.message === 'string' ? err.message : 'Token exchange failed';
      try {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(createErrorPage(`Sign-in error: ${message}`, `로그인 오류: ${message}`));
      } catch {
        // The listener may already be closing.
      }
      await finish({ code: err.code || 'token_exchange_failed', message });
    }
  })());

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

  getOrCreateHostId().then(async (id) => {
    hostId = id;
    return startServer();
  }).then(async (port) => {
    try {
      actualPort = port;
      const redirectUri = `http://127.0.0.1:${actualPort}/auth/callback`;
      if (!redirectUri.startsWith('http://127.0.0.1:') || redirectUri.includes('localhost')) {
        throw new Error('Redirect URI must use 127.0.0.1');
      }
      const authParams = new URLSearchParams({
        response_type: 'code',
        client_id: pendingClientId,
        redirect_uri: redirectUri,
        scope: SCOPES,
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        resource: RESOURCE,
        ext_agent_host_id: hostId
      });
      if (registrationMode === 'register') {
        authParams.set('agent_name_hint', AGENT_NAME_HINT);
      } else {
        if (idTokenHint) authParams.set('id_token_hint', idTokenHint);
        if (loginHint) authParams.set('login_hint', loginHint);
      }
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
    invalidate,
    cancel: (code = 'cancelled') => {
      const closed = finish(cancelError(code), { force: true });
      return (async () => {
        await whenCallbacksSettled();
        await closed;
      })();
    },
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
  timeoutMs,
  fetchTimeoutMs
} = {}) {
  const activeAuthAttempts = new Map();
  let startQueue = Promise.resolve();
  // Always restart at the base port. A busy base port may use the next few
  // ports in the fixed range, then the base port again once it is free.
  const callbackPortStart = Number.isInteger(portStart) ? portStart : REDIRECT_URI_PORT_START;

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
    for (const flow of flows) flow.invalidate();
    await Promise.all(flows.map((flow) => Promise.resolve(flow.cancel('superseded')).catch(() => {})));
  }

  async function beginStart(args, emitFn) {
    await closeActiveAttempts();
    const active = await loadCredentials();
    const registration = active ?? await loadSavedRegistration();
    const settings = await resolveChatGPTSettings({
      clientId: args?.clientId ?? clientId
    });
    const chosen = chooseAuthClient(settings.clientId, registration);

    const authFlow = startAuthFlow({
      clientId: chosen.clientId,
      mode: chosen.mode,
      idTokenHint: chosen.idTokenHint,
      loginHint: chosen.loginHint,
      expectedSubject: chosen.expectedSubject,
      spawnImpl,
      portStart: callbackPortStart,
      portAttempts,
      timeoutMs,
      fetchTimeoutMs,
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
    authFlow.invalidate();
    await authFlow.cancel('cancelled');
    activeAuthAttempts.delete(attemptId);
    return { state: 'signed_out' };
  }

  async function cancelAll() {
    await closeActiveAttempts();
  }

  async function signOut() {
    for (const flow of activeAuthAttempts.values()) flow.invalidate();
    await closeActiveAttempts();
    await clearStoredSecrets();
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
