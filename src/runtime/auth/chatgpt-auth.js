import { createHash, createPublicKey, createVerify, randomBytes, randomUUID } from 'node:crypto';
import { chmod, link, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import http from 'node:http';
import { homedir, userInfo } from 'node:os';
import { spawn } from 'node:child_process';

// Fallback when OpenID discovery is missing or rejected. These match
// https://auth.openai.com/.well-known/openid-configuration. JWKS is the issuer
// well-known URL: /api/accounts/.well-known/jwks.json is blocked with 403.
export const AUTH_ENDPOINT = 'https://auth.openai.com/api/accounts/authorize';
export const TOKEN_ENDPOINT = 'https://auth.openai.com/api/accounts/oauth/token';
export const JWKS_ENDPOINT = 'https://auth.openai.com/.well-known/jwks.json';
export const ISSUER = 'https://auth.openai.com';
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
// Long enough for a real ChatGPT login. timeoutMs and
// CHATPCB_CHATGPT_AUTH_TIMEOUT_MS override this when they are positive integers.
const AUTH_TIMEOUT_MS = 15 * 60 * 1000;
// After the attempt expires, the callback port stays open for as long as this
// process stays up, so a late browser redirect gets an expired page instead of
// a refused connection. The listener is detached from the event loop then: a
// one-shot CLI must be able to exit, while a daemon still answers on its own.
const AUTH_GRACE_MS = 10 * 60 * 1000;
const AUTH_TIMEOUT_ENV = 'CHATPCB_CHATGPT_AUTH_TIMEOUT_MS';
const AUTH_GRACE_ENV = 'CHATPCB_CHATGPT_AUTH_GRACE_MS';
const FETCH_TIMEOUT_MS = 10 * 1000;
const RESPONSES_TIMEOUT_MS = 120 * 1000;
const JWKS_CACHE_TTL_MS = 10 * 60 * 1000;
const OIDC_DISCOVERY_TTL_MS = 60 * 60 * 1000;
const OIDC_FAILURE_TTL_MS = 60 * 1000;
const TEST_CONFIG_CODE = 'CHATPCB_TEST_CONFIG_HOME';
const REQUIRED_OIDC_ENDPOINTS = ['authorization_endpoint', 'token_endpoint', 'jwks_uri'];
const jwksCache = new Map();
let oidcCache = null;
let oidcInflight = null;
let oidcGeneration = 0;
let oidcFailureLogged = false;
const CLIENT_ID_ENV = 'CHATPCB_CHATGPT_CLIENT_ID';
const MODEL_ENV = 'CHATPCB_CHATGPT_MODEL';
const RESPONSES_TIMEOUT_ENV = 'CHATPCB_CHATGPT_RESPONSES_TIMEOUT_MS';
const HOST_ID_FILE = 'chatgpt-host-id.txt';
// RFC 4122 UUIDv4 URN. The URN and the hex digits are case-insensitive.
const UUID_HOST_ID = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// RFC 9278: urn:ietf:params:oauth:jwk-thumbprint:<hash-alg>:<unpadded base64url>
const JWK_THUMBPRINT_HOST_ID = /^urn:ietf:params:oauth:jwk-thumbprint:[a-z0-9]+(?:-[a-z0-9]+)*:[A-Za-z0-9_-]+$/;
// did:key multibase base58btc (alphabet excludes 0, O, I, and l).
const DID_KEY_HOST_ID = /^did:key:z[1-9A-HJ-NP-Za-km-z]+$/;
// Bumped on sign-out, a completed sign-in, and when an issued client id is dropped.
// Late provider saves capture the value at call start and refuse to write after it changes.
let sessionGeneration = 0;
let credentialWrite = Promise.resolve();
// One refresh HTTP call per client id + refresh token while that call is in flight.
const inflightRefreshes = new Map();

/**
 * Resolve an optional ChatGPT client-id override, model override, and
 * Responses API timeout.
 *
 * Precedence for each value is: explicit option, then environment
 * (`CHATPCB_CHATGPT_CLIENT_ID`, `CHATPCB_CHATGPT_MODEL`,
 * `CHATPCB_CHATGPT_RESPONSES_TIMEOUT_MS`), then `chatgpt.json`
 * in the ChatPCB config directory (`clientId`, `model`, `responsesTimeoutMs`).
 * No client id is required. Sign-in uses OpenAI dynamic client registration
 * unless an override or a saved issued client id is present.
 * The Responses timeout defaults to 120 seconds.
 */
export async function resolveChatGPTSettings({ clientId, model, responsesTimeoutMs } = {}) {
  const file = await readChatGPTConfig();
  return {
    clientId: firstString(clientId, process.env[CLIENT_ID_ENV], file.clientId),
    model: firstString(model, process.env[MODEL_ENV], file.model),
    responsesTimeoutMs: firstTimeout(
      responsesTimeoutMs,
      process.env[RESPONSES_TIMEOUT_ENV],
      file.responsesTimeoutMs
    ) ?? RESPONSES_TIMEOUT_MS
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

function runningUnderNodeTest() {
  if (process.env.NODE_TEST_CONTEXT) return true;
  const args = [...process.execArgv, ...process.argv];
  return args.some((arg) => arg === '--test' || arg.startsWith('--test='));
}

function assertTestConfigNotInRealHome(dir) {
  if (!runningUnderNodeTest()) return;
  let realHome = '';
  try {
    realHome = userInfo().homedir;
  } catch {
    return;
  }
  if (!realHome) return;
  const resolvedDir = resolve(dir);
  const resolvedHome = resolve(realHome);
  const fromHome = relative(resolvedHome, resolvedDir);
  const insideHome = fromHome === '' || (fromHome !== '' && !fromHome.startsWith('..') && !isAbsolute(fromHome));
  if (!insideHome) return;
  const error = new Error(
    `Refusing ChatPCB config directory ${resolvedDir} because it is inside the real home ${resolvedHome} while running under node --test. Set XDG_CONFIG_HOME or HOME to a temporary directory.`
  );
  error.code = TEST_CONFIG_CODE;
  throw error;
}

function rethrowIfTestConfigGuard(error) {
  if (error?.code === TEST_CONFIG_CODE) throw error;
}

function getConfigDir() {
  const platform = process.platform;
  let dir;
  if (platform === 'win32') {
    dir = join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'chatpcb');
  } else if (platform === 'darwin') {
    dir = join(homedir(), 'Library', 'Application Support', 'chatpcb');
  } else {
    dir = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'chatpcb');
  }
  assertTestConfigNotInRealHome(dir);
  return dir;
}

function getCredentialsPath(clientId = 'default') {
  const safeName = String(clientId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(getConfigDir(), `chatgpt-credentials-${safeName}.json`);
}

function getHostIdPath() {
  return join(getConfigDir(), HOST_ID_FILE);
}

function uniqueTempPath(filePath) {
  return `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
}

async function ensureConfigDir() {
  const dir = getConfigDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // mkdir leaves an existing directory's mode alone, and umask can widen a
  // newly created one. Tighten the config directory itself, best-effort.
  if (process.platform !== 'win32') {
    await chmod(dir, 0o700).catch(() => {});
  }
  return dir;
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
 * OpenAI accepts three ext_agent_host_id forms: a hyphenated UUIDv4 URN,
 * an RFC 9278 JWK thumbprint URI, and a did:key base58btc identifier.
 * Legacy `host_<hex>` values, blanks, and surrounding whitespace are rejected.
 */
export function isValidHostId(value) {
  return typeof value === 'string'
    && (UUID_HOST_ID.test(value)
      || JWK_THUMBPRINT_HOST_ID.test(value)
      || DID_KEY_HOST_ID.test(value));
}

function newUuidHostId() {
  return `urn:uuid:${randomUUID()}`;
}

async function publishNewHostId(filePath) {
  const hostId = newUuidHostId();
  const tempPath = uniqueTempPath(filePath);
  await writeFile(tempPath, hostId, { mode: 0o600 });
  await chmod(tempPath, 0o600);
  try {
    await link(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    if (error.code === 'EEXIST') {
      const raced = await readTrimmedFile(filePath);
      if (isValidHostId(raced)) {
        await chmod(filePath, 0o600).catch(() => {});
        return canonicalHostId(raced);
      }
      if (raced) return replaceInvalidHostId(filePath);
    }
    throw error;
  }
  await unlink(tempPath).catch(() => {});
  await chmod(filePath, 0o600);
  return hostId;
}

async function replaceInvalidHostId(filePath) {
  const hostId = newUuidHostId();
  const tempPath = uniqueTempPath(filePath);
  try {
    await writeFile(tempPath, hostId, { mode: 0o600 });
    await chmod(tempPath, 0o600);
    const current = await readTrimmedFile(filePath);
    if (isValidHostId(current)) {
      await chmod(filePath, 0o600).catch(() => {});
      return canonicalHostId(current);
    }
    await rename(tempPath, filePath);
  } finally {
    await unlink(tempPath).catch(() => {});
  }
  await chmod(filePath, 0o600);
  await dropRegistrationsForNewHost(hostId);
  return hostId;
}

function canonicalHostId(value) {
  // OpenAI treats the urn:uuid prefix and hex digits as case-insensitive.
  if (typeof value === 'string' && UUID_HOST_ID.test(value)) return value.toLowerCase();
  return value;
}

async function storeCanonicalHostId(filePath, canonical) {
  const tempPath = uniqueTempPath(filePath);
  try {
    await writeFile(tempPath, canonical, { mode: 0o600 });
    await chmod(tempPath, 0o600);
    const current = await readTrimmedFile(filePath);
    if (canonicalHostId(current) !== canonical) {
      if (isValidHostId(current)) {
        await chmod(filePath, 0o600).catch(() => {});
        return canonicalHostId(current);
      }
      return replaceInvalidHostId(filePath);
    }
    if (current !== canonical) await rename(tempPath, filePath);
  } finally {
    await unlink(tempPath).catch(() => {});
  }
  await chmod(filePath, 0o600);
  return canonical;
}

/**
 * Stable opaque host id, generated once per machine and reused.
 * Generated ids are `urn:uuid:<UUIDv4>`. A stored id is kept only when
 * {@link isValidHostId} accepts it; anything else is replaced.
 * A valid `urn:uuid` is stored in lowercase. Replacing an invalid id
 * deletes saved registrations whose `ext_agent_host_id` is not the new id.
 * The file is owner-only (0600). The config directory is owner-only (0700).
 * A missing file is published with an atomic link so concurrent creators
 * never observe a partial write. An invalid file is replaced with an atomic
 * rename. Every atomic write uses its own temporary name.
 */
export async function getOrCreateHostId() {
  const filePath = getHostIdPath();
  await ensureConfigDir();
  const existing = await readTrimmedFile(filePath);
  if (isValidHostId(existing)) {
    const canonical = canonicalHostId(existing);
    if (canonical === existing) {
      await chmod(filePath, 0o600).catch(() => {});
      return existing;
    }
    return storeCanonicalHostId(filePath, canonical);
  }

  if (existing) return replaceInvalidHostId(filePath);

  try {
    const raw = await readFile(filePath, 'utf8');
    if (!raw.trim()) await unlink(filePath);
  } catch {
    // Absent, which is the expected first-run state.
  }

  return publishNewHostId(filePath);
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
  const sub = idTokenClaims(idToken)?.sub;
  return typeof sub === 'string' && sub ? sub : null;
}

// The ID token was signature-checked before it was stored. Later reads use
// these claims without another JWKS round trip, including while offline.
function idTokenClaims(idToken) {
  try {
    const part = String(idToken || '').split('.')[1];
    if (!part) return null;
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString());
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    return payload;
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
  } catch (error) {
    rethrowIfTestConfigGuard(error);
    return null;
  }
}

async function loadSavedRegistration() {
  try {
    return selectSavedRegistration(await readCredentialRecords());
  } catch (error) {
    rethrowIfTestConfigGuard(error);
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
 * Same ordering as selectSavedAccount, including a signed-out registration
 * that still has an issued client id and no access token. Sign-out keeps
 * that registration so the next sign-in reuses the client id. Records that
 * only stored dynamic_agent_client are not registrations.
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

export function currentSessionGeneration() {
  return sessionGeneration;
}

function bumpSessionGeneration() {
  sessionGeneration += 1;
}

function withCredentialWrite(fn) {
  const run = credentialWrite.then(fn, fn);
  credentialWrite = run.then(() => undefined, () => undefined);
  return run;
}

async function writeCredentialsFile(creds) {
  if (creds?.client_id === DYNAMIC_CLIENT_ID) {
    throw new Error('Refusing to save dynamic_agent_client as the ChatGPT client id');
  }
  const clientId = creds.client_id || 'default';
  const stored = {
    ...creds,
    last_used_at: typeof creds.last_used_at === 'number' ? creds.last_used_at : Date.now()
  };
  const path = getCredentialsPath(clientId);
  await ensureConfigDir();

  const tempPath = uniqueTempPath(path);
  try {
    await writeFile(tempPath, JSON.stringify(stored, null, 2), { mode: 0o600 });
    await chmod(tempPath, 0o600);
    await rename(tempPath, path);
  } finally {
    await unlink(tempPath).catch(() => {});
  }
  await chmod(path, 0o600);
  return stored;
}

/**
 * Put `previous` bytes back without truncating `credPath` first.
 * A failure while creating the temp file leaves the destination unchanged.
 * `fsImpl` overrides the file operations (tests inject a failing write).
 */
export async function restoreCredentialBytes(credPath, previous, fsImpl) {
  const write = fsImpl?.writeFile ?? writeFile;
  const changeMode = fsImpl?.chmod ?? chmod;
  const renameFile = fsImpl?.rename ?? rename;
  const remove = fsImpl?.unlink ?? unlink;
  if (previous == null) {
    await remove(credPath).catch(() => {});
    return;
  }
  const tempPath = uniqueTempPath(credPath);
  try {
    await write(tempPath, previous, { mode: 0o600 });
    await changeMode(tempPath, 0o600);
    await renameFile(tempPath, credPath);
  } finally {
    await remove(tempPath).catch(() => {});
  }
  await changeMode(credPath, 0o600);
}

export async function saveCredentials(creds) {
  return withCredentialWrite(() => writeCredentialsFile(creds));
}

/**
 * Persist a provider-side token update only while `generation` is still the
 * active session and the stored record still has one of `refreshTokens`.
 * Sign-out bumps the generation before it clears tokens, so a call that
 * started earlier cannot write tokens back. A stored record with no access
 * token is left unchanged.
 */
export async function saveCredentialsIfCurrent(creds, { generation, clientId, refreshTokens } = {}) {
  const allowed = new Set(
    (Array.isArray(refreshTokens) ? refreshTokens : []).filter((value) => typeof value === 'string')
  );
  return withCredentialWrite(async () => {
    if (generation !== sessionGeneration) return false;
    if (!clientId || creds?.client_id !== clientId) return false;
    const credPath = getCredentialsPath(clientId);
    let previous;
    try {
      previous = await readFile(credPath);
    } catch {
      return false;
    }
    let current;
    try {
      current = JSON.parse(previous.toString('utf8'));
    } catch {
      return false;
    }
    if (!current || current.client_id !== clientId || !current.access_token) return false;
    if (!allowed.has(current.refresh_token || '')) return false;
    if (generation !== sessionGeneration) return false;
    await writeCredentialsFile(creds);
    if (generation !== sessionGeneration) {
      await restoreCredentialBytes(credPath, previous);
      return false;
    }
    return true;
  });
}

async function unlinkAllCredentialFiles() {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) return;
  const files = await readdir(configDir);
  for (const file of files) {
    if (!isCredentialFile(file)) continue;
    await unlink(join(configDir, file)).catch(() => {});
  }
}

async function unlinkClientCredentials(clientId) {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) return;
  const canonical = getCredentialsPath(clientId);
  const files = await readdir(configDir);
  for (const file of files) {
    if (!isCredentialFile(file)) continue;
    const full = join(configDir, file);
    if (full === canonical) {
      await unlink(full).catch(() => {});
      continue;
    }
    try {
      const creds = JSON.parse(await readFile(full, 'utf8'));
      if (creds?.client_id === clientId) await unlink(full).catch(() => {});
    } catch {
      // Leave unreadable files for the other accounts alone.
    }
  }
}

async function dropIssuedClient(clientId) {
  if (!isReusableClientId(clientId)) return;
  bumpSessionGeneration();
  await withCredentialWrite(() => unlinkClientCredentials(clientId));
}

async function dropRegistrationsForNewHost(newHostId) {
  await withCredentialWrite(async () => {
    const configDir = getConfigDir();
    if (!existsSync(configDir)) return;
    let names;
    try {
      names = await readdir(configDir);
    } catch {
      return;
    }
    const staleClientIds = [];
    for (const name of names) {
      if (!isCredentialFile(name)) continue;
      try {
        const creds = JSON.parse(await readFile(join(configDir, name), 'utf8'));
        if (!isReusableClientId(creds?.client_id)) continue;
        if (creds.ext_agent_host_id === newHostId) continue;
        staleClientIds.push(creds.client_id);
      } catch {
        // Leave unreadable files for the other accounts alone.
      }
    }
    if (staleClientIds.length === 0) return;
    bumpSessionGeneration();
    for (const clientId of staleClientIds) {
      await unlinkClientCredentials(clientId);
    }
  });
}

/**
 * Registration kept across sign-out. The next sign-in reuses the issued
 * client id and host id, and does not send agent_name_hint. Tokens and
 * personal fields (email, name, account, subject) are removed, so the next
 * authorize request omits id_token_hint and login_hint.
 */
function retainRegistration(creds) {
  const retained = {
    client_id: creds.client_id
  };
  if (typeof creds.ext_agent_host_id === 'string' && creds.ext_agent_host_id) {
    retained.ext_agent_host_id = creds.ext_agent_host_id;
  }
  if (typeof creds.issuer === 'string' && creds.issuer) {
    retained.issuer = creds.issuer;
  }
  if (creds.saved_at != null && creds.saved_at !== '') retained.saved_at = creds.saved_at;
  if (typeof creds.last_used_at === 'number' && Number.isFinite(creds.last_used_at)) {
    retained.last_used_at = creds.last_used_at;
  }
  return retained;
}

async function clearStoredSession() {
  await withCredentialWrite(async () => {
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
      if (!creds || typeof creds !== 'object' || Array.isArray(creds) || !isReusableClientId(creds.client_id)) {
        await unlink(full).catch(() => {});
        continue;
      }
      await writeCredentialsFile(retainRegistration(creds));
      const canonical = getCredentialsPath(creds.client_id);
      if (full !== canonical) await unlink(full).catch(() => {});
    }
  });
}

export async function deleteCredentials() {
  return withCredentialWrite(unlinkAllCredentialFiles);
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
      // Keep this timer referenced: it is cleared in finally, and an unref'd timer
      // lets the process exit with the request still pending.
      timer = setTimeout(() => reject(timeoutError(label, ms)), ms);
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

async function oauthFailure(prefix, response) {
  const code = oauthErrorCode(await response.text().catch(() => ''));
  return {
    code,
    message: code ? `${prefix}: ${response.status} ${code}` : `${prefix}: ${response.status}`
  };
}

export function clearJwksCache() {
  jwksCache.clear();
}

export function clearOidcDiscoveryCache() {
  oidcGeneration += 1;
  oidcCache = null;
  oidcInflight = null;
  oidcFailureLogged = false;
}

// Tests seed this so a warm fallback does not add a discovery fetch. Production
// starts empty and discovers on the first authorize, token, refresh, or JWKS use.
export function useFallbackAuthEndpoints() {
  oidcGeneration += 1;
  oidcInflight = null;
  oidcFailureLogged = false;
  // A seeded fallback is a successful stand-in, so it keeps the long TTL.
  // Only a discovery attempt that failed or was rejected uses the short TTL.
  oidcCache = { fetchedAt: Date.now(), endpoints: fallbackAuthEndpoints(), fallback: false };
}

function fallbackAuthEndpoints() {
  return {
    authorization: AUTH_ENDPOINT,
    token: TOKEN_ENDPOINT,
    jwks: JWKS_ENDPOINT
  };
}

function currentAuthEndpoints(now = Date.now()) {
  if (!oidcCache) return null;
  const ttl = oidcCache.fallback === true ? OIDC_FAILURE_TTL_MS : OIDC_DISCOVERY_TTL_MS;
  const age = now - oidcCache.fetchedAt;
  if (age >= 0 && age < ttl) return oidcCache.endpoints;
  return null;
}

function isThenable(value) {
  return value != null && typeof value.then === 'function';
}

// A warm cache returns the endpoints object, not a promise. Callers must not
// await that object: a refresh shared by concurrent callers starts its HTTP
// request synchronously, and an extra await would drop that in-flight count.
function discoverAuthEndpoints({ timeoutMs } = {}) {
  const cached = currentAuthEndpoints();
  if (cached) return cached;
  if (!oidcInflight) {
    const generation = oidcGeneration;
    const pending = loadOidcEndpoints(generation, timeoutMs).finally(() => {
      if (oidcInflight === pending) oidcInflight = null;
    });
    oidcInflight = pending;
  }
  return oidcInflight;
}

async function withAuthEndpoints(options, fn) {
  const discovered = discoverAuthEndpoints(options);
  const endpoints = isThenable(discovered) ? await discovered : discovered;
  return fn(endpoints);
}

function isOidcEndpointField(field) {
  return field === 'jwks_uri' || field.endsWith('_endpoint');
}

function endpointRejectionReason(value, field) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    return `non-https endpoint (${field})`;
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    return `non-https endpoint (${field})`;
  }
  if (url.protocol !== 'https:') return `non-https endpoint (${field})`;
  if (url.hostname !== 'auth.openai.com') return `foreign host (${field})`;
  if (url.username !== '' || url.password !== '' || (url.port !== '' && url.port !== '443')) {
    return `non-https endpoint (${field})`;
  }
  return null;
}

function discoveryRejectionReason(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'invalid document';
  if (body.issuer !== ISSUER) return 'wrong issuer';
  for (const field of Object.keys(body)) {
    if (!isOidcEndpointField(field) || body[field] == null) continue;
    const reason = endpointRejectionReason(body[field], field);
    if (reason) return reason;
  }
  for (const field of REQUIRED_OIDC_ENDPOINTS) {
    const reason = endpointRejectionReason(body[field], field);
    if (reason) return reason;
  }
  return null;
}

function endpointsFromDiscovery(body) {
  if (discoveryRejectionReason(body)) return null;
  return {
    authorization: body.authorization_endpoint,
    token: body.token_endpoint,
    jwks: body.jwks_uri
  };
}

function rememberAuthEndpoints(generation, endpoints, { fallback = false } = {}) {
  if (generation !== oidcGeneration) return endpoints;
  oidcCache = { fetchedAt: Date.now(), endpoints, fallback };
  if (!fallback) oidcFailureLogged = false;
  return endpoints;
}

function discoveryFailureLabel(error) {
  if (error?.code === 'timeout') return 'timeout';
  if (typeof error?.code === 'string' && /^[A-Za-z0-9._-]{1,40}$/.test(error.code)) return error.code;
  return 'network';
}

function logDiscoveryFailure(reason) {
  if (oidcFailureLogged) return;
  oidcFailureLogged = true;
  logAuth(`ChatGPT OpenID discovery failed (${reason}); using fallback endpoints`);
}

function logDiscoveryRejection(reason) {
  if (oidcFailureLogged) return;
  oidcFailureLogged = true;
  logAuth(`ChatGPT OpenID discovery document rejected (${reason}); using fallback endpoints`);
}

async function loadOidcEndpoints(generation, timeoutMs) {
  try {
    const response = await fetchWithTimeout(
      `${ISSUER}/.well-known/openid-configuration`,
      {},
      timeoutMs,
      'OpenID discovery'
    );
    if (generation !== oidcGeneration) return fallbackAuthEndpoints();
    if (!response.ok) {
      logDiscoveryFailure(Number.isInteger(response.status) ? String(response.status) : 'http');
      return rememberAuthEndpoints(generation, fallbackAuthEndpoints(), { fallback: true });
    }
    let body;
    try {
      body = await response.json();
    } catch {
      logDiscoveryFailure('invalid-json');
      return rememberAuthEndpoints(generation, fallbackAuthEndpoints(), { fallback: true });
    }
    const rejection = discoveryRejectionReason(body);
    if (rejection) {
      logDiscoveryRejection(rejection);
      return rememberAuthEndpoints(generation, fallbackAuthEndpoints(), { fallback: true });
    }
    return rememberAuthEndpoints(generation, endpointsFromDiscovery(body));
  } catch (error) {
    if (generation !== oidcGeneration) return fallbackAuthEndpoints();
    logDiscoveryFailure(discoveryFailureLabel(error));
    return rememberAuthEndpoints(generation, fallbackAuthEndpoints(), { fallback: true });
  }
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
  const response = await withAuthEndpoints({ timeoutMs }, (endpoints) => (
    fetchWithTimeout(endpoints.jwks, { signal }, timeoutMs, 'JWKS fetch')
  ));
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

export function refreshAccessToken(refreshToken, clientId, { fetchTimeoutMs = FETCH_TIMEOUT_MS, signal } = {}) {
  if (!isReusableClientId(clientId)) {
    return Promise.reject(new Error('Cannot refresh ChatGPT tokens without an issued client id'));
  }
  const key = `${clientId}\0${refreshToken}`;
  const existing = inflightRefreshes.get(key);
  if (existing) return existing;

  // The first caller supplies the timeout and abort signal for the shared request.
  const promise = requestRefresh(refreshToken, clientId, { fetchTimeoutMs, signal }).finally(() => {
    if (inflightRefreshes.get(key) === promise) inflightRefreshes.delete(key);
  });
  inflightRefreshes.set(key, promise);
  return promise;
}

async function requestRefresh(refreshToken, clientId, { fetchTimeoutMs, signal }) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    resource: RESOURCE
  });

  const response = await withAuthEndpoints({ timeoutMs: fetchTimeoutMs }, (endpoints) => (
    fetchWithTimeout(endpoints.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal
    }, fetchTimeoutMs, 'Token refresh')
  ));

  if (!response.ok) {
    const failure = await oauthFailure('Token refresh failed', response);
    const error = new Error(failure.message);
    if (failure.code === 'invalid_client') {
      error.code = 'invalid_client';
      await dropIssuedClient(clientId);
    }
    throw error;
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
  graceMs,
  fetchTimeoutMs,
  onGraceClosed
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
  const authTimeoutMs = resolveAuthTimeoutMs(timeoutMs);
  const authGraceMs = resolveAuthGraceMs(graceMs);
  const requestTimeoutMs = Number.isFinite(fetchTimeoutMs) && fetchTimeoutMs > 0
    ? fetchTimeoutMs
    : FETCH_TIMEOUT_MS;

  let server = null;
  let actualPort = null;
  let timeoutHandle = null;
  let graceHandle = null;
  const openSockets = new Set();
  let expiresAtIso = null;
  let authUrl = null;
  let hostId = null;
  let settled = false;
  let terminal = false;
  let readySettled = false;
  // starting → waiting → expired (grace listener) → closed.
  let phase = 'starting';
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
    if (graceHandle) {
      clearTimeout(graceHandle);
      graceHandle = null;
    }
    phase = 'closed';
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

  const notifyGraceClosed = () => {
    if (typeof onGraceClosed !== 'function') return;
    try {
      onGraceClosed();
    } catch {
      // The manager may already have dropped this attempt.
    }
  };

  const unrefHandle = (handle) => {
    if (handle && typeof handle.unref === 'function') handle.unref();
  };

  const trackSocket = (socket) => {
    openSockets.add(socket);
    socket.once('close', () => openSockets.delete(socket));
    // A connection that arrives after expiry must not pin a CLI that is
    // already on its way out. The daemon's own handles keep the page reachable.
    if (phase === 'expired') unrefHandle(socket);
  };

  // The listening socket and any keep-alive connection would hold a one-shot
  // process until the grace period ends. Drop those refs. The socket stays
  // open, so a daemon still serves the expired page on its own handles.
  const detachGraceListener = () => {
    const listening = server;
    if (!listening || phase !== 'expired') return;
    listening.keepAliveTimeout = 1;
    unrefHandle(listening);
    for (const socket of openSockets) {
      if (!socket.destroyed) unrefHandle(socket);
    }
    if (typeof listening.closeIdleConnections === 'function') {
      try { listening.closeIdleConnections(); } catch { /* already closing */ }
    }
  };

  // Stop accepting a code, but keep the loopback socket open for a late redirect.
  const expireAttempt = () => {
    if (phase !== 'waiting') return;
    phase = 'expired';
    timeoutHandle = null;
    invalidate();
    const graceUntilIso = new Date(Date.now() + authGraceMs).toISOString();
    logAuth(`ChatGPT sign-in attempt expired at ${expiresAtIso}; callback port kept for late redirects until ${graceUntilIso}`);
    if (!terminal) {
      terminal = true;
      const error = { code: 'timeout', message: 'Sign-in timed out' };
      if (!readySettled) {
        readySettled = true;
        readyReject(error);
      }
      rejectAuth(error);
    }
    if (typeof onTimeout === 'function') {
      try { onTimeout(); } catch { /* the panel hook is best-effort */ }
    }
    if (phase !== 'expired') return;
    graceHandle = setTimeout(() => {
      graceHandle = null;
      if (phase !== 'expired') return;
      cleanup({ force: true }).finally(notifyGraceClosed);
    }, authGraceMs);
    // The close timer must not keep the process alive on its own, and neither
    // may the listening socket or an idle keep-alive connection.
    if (typeof graceHandle.unref === 'function') graceHandle.unref();
    detachGraceListener();
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

  async function saveIfStillActive(creds, serial) {
    return withCredentialWrite(async () => {
      if (!attemptStillCurrent(serial)) return false;
      const credPath = getCredentialsPath(creds.client_id || 'default');
      let previous = null;
      try {
        previous = await readFile(credPath);
      } catch {
        previous = null;
      }
      if (!attemptStillCurrent(serial)) return false;
      // A new sign-in retires provider calls that captured the previous generation.
      bumpSessionGeneration();
      await writeCredentialsFile(creds);
      if (!attemptStillCurrent(serial)) {
        await restoreCredentialBytes(credPath, previous);
        return false;
      }
      return true;
    });
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

    // A code that arrives after the attempt expired is never exchanged.
    // A closed listener can still be draining a keep-alive socket; a wrong
    // state must stay a mismatch and must not end a newer attempt.
    if (phase === 'expired') {
      logAuth('late ChatGPT callback received after expiry');
      try {
        res.writeHead(410, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(createExpiredPage());
      } catch {
        // The grace listener may already be closing.
      }
      return;
    }

    if (phase === 'starting') {
      endQuietly(res);
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
      if (error === 'invalid_client') {
        await dropIssuedClient(pendingClientId);
        const message = 'ChatGPT client is no longer valid. Sign in again.';
        try {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(createErrorPage(
            `Sign-in error: ${message}`,
            '로그인 오류: ChatGPT 클라이언트가 더 이상 유효하지 않습니다. 다시 로그인해 주세요.'
          ));
        } catch {
          // The listener may already be closing.
        }
        await finish({ code: 'invalid_client', message });
        return;
      }
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

      const endpoints = await withAuthEndpoints({ timeoutMs: requestTimeoutMs }, (value) => value);
      if (!attemptStillCurrent(serial)) {
        endQuietly(res);
        return;
      }
      const tokenResponse = await fetchWithTimeout(endpoints.token, {
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
        const failure = await oauthFailure('Token exchange failed', tokenResponse);
        const error = new Error(failure.message);
        if (failure.code === 'invalid_client') {
          error.code = 'invalid_client';
          await dropIssuedClient(issuedClientId);
        }
        throw error;
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
    testServer.on('connection', trackSocket);
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
      const endpoints = await withAuthEndpoints({ timeoutMs: requestTimeoutMs }, (value) => value);
      if (settled || terminal) return;
      authUrl = `${endpoints.authorization}?${authParams.toString()}`;
      expiresAtIso = new Date(Date.now() + authTimeoutMs).toISOString();
      phase = 'waiting';
      logAuth(`ChatGPT sign-in waiting on http://127.0.0.1:${actualPort}/auth/callback until ${expiresAtIso}`);
      timeoutHandle = setTimeout(() => {
        expireAttempt();
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
    get expiresAt() { return expiresAtIso; },
    isWaiting() { return phase === 'waiting'; },
    isGraceListening() { return phase === 'expired'; },
    whenReady,
    promise,
    invalidate,
    cancel: (code = 'cancelled') => {
      if (phase === 'closed') return Promise.resolve();
      if (phase === 'expired') {
        const closed = cleanup({ force: true });
        return (async () => {
          await whenCallbacksSettled();
          await closed;
          notifyGraceClosed();
        })();
      }
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

function createExpiredPage() {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Sign-in expired</title></head>
<body>
  <h1>This sign-in attempt expired</h1>
  <p>Nothing was saved. Go back to ChatPCB and press "Continue with ChatGPT" again.</p>
  <p>로그인 시도가 만료되었습니다. 저장된 내용은 없습니다. ChatPCB로 돌아가서 "Continue with ChatGPT"를 다시 누르세요.</p>
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
  graceMs,
  fetchTimeoutMs
} = {}) {
  const activeAuthAttempts = new Map();
  const graceFlows = new Set();
  let startQueue = Promise.resolve();
  // Always restart at the base port. A busy base port may use the next few
  // ports in the fixed range, then the base port again once it is free.
  const callbackPortStart = Number.isInteger(portStart) ? portStart : REDIRECT_URI_PORT_START;

  function waitingStatus(flow) {
    return {
      state: 'waiting',
      attemptId: flow.attemptId,
      authUrl: flow.authUrl,
      expiresAt: flow.expiresAt
    };
  }

  async function getAuthStatus() {
    for (const flow of activeAuthAttempts.values()) {
      if (flow.isWaiting()) return waitingStatus(flow);
    }
    for (const flow of graceFlows) {
      if (flow.isGraceListening()) {
        return {
          state: 'error',
          code: 'timeout',
          attemptId: flow.attemptId,
          expiresAt: flow.expiresAt
        };
      }
    }
    const creds = await loadCredentials();
    if (!creds || !creds.access_token) return { state: 'signed_out' };
    const plan = extractPlan(creds);
    return {
      state: 'signed_in',
      account: accountFromCredentials(creds),
      plan: plan || undefined
    };
  }

  async function closeActiveAttempts() {
    const flows = [...activeAuthAttempts.values()];
    activeAuthAttempts.clear();
    for (const flow of flows) flow.invalidate();
    await Promise.all(flows.map((flow) => Promise.resolve(flow.cancel('superseded')).catch(() => {})));
  }

  async function closeGraceFlows() {
    const flows = [...graceFlows];
    graceFlows.clear();
    await Promise.all(flows.map((flow) => Promise.resolve(flow.cancel('superseded')).catch(() => {})));
  }

  async function beginStart(args, emitFn) {
    await closeActiveAttempts();
    await closeGraceFlows();
    // Replacing an invalid host id drops registrations for the old host
    // before a client id is chosen for this attempt.
    await getOrCreateHostId();
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
      graceMs,
      fetchTimeoutMs,
      onGraceClosed: () => {
        graceFlows.delete(authFlow);
      },
      onBrowserOpen: ({ authUrl, error }) => {
        emitAuth(emitFn, {
          state: error ? 'error' : 'waiting',
          code: error || undefined,
          authUrl,
          attemptId: authFlow.attemptId,
          ...(error ? {} : { expiresAt: authFlow.expiresAt })
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
        graceFlows.delete(authFlow);
        emitAuth(emitFn, {
          state: 'signed_in',
          account: creds.account,
          plan: extractPlan(creds) || undefined,
          attemptId: authFlow.attemptId
        });
      },
      (error) => {
        activeAuthAttempts.delete(authFlow.attemptId);
        if (error?.code === 'timeout' && authFlow.isGraceListening()) graceFlows.add(authFlow);
        else graceFlows.delete(authFlow);
        if (!error || error.code === 'superseded') return;
        emitAuth(emitFn, {
          state: 'error',
          code: error.code || 'unknown',
          attemptId: authFlow.attemptId,
          ...(error?.code === 'timeout' ? { expiresAt: authFlow.expiresAt } : {})
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
      attemptId: authFlow.attemptId,
      expiresAt: authFlow.expiresAt
    };
  }

  function startAuth(args, emitFn) {
    const run = startQueue.then(() => beginStart(args, emitFn), () => beginStart(args, emitFn));
    startQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  async function reopenAuth(args) {
    const attemptId = args?.attemptId;
    if (!attemptId) return { error: 'attemptId is required' };
    const authFlow = activeAuthAttempts.get(attemptId);
    if (!authFlow) return { error: 'Auth attempt not found or expired' };
    const authUrl = authFlow.reopen();
    if (typeof authUrl !== 'string' || !authUrl.startsWith('https://')) {
      return { error: 'Auth attempt not found or expired' };
    }
    let browserResult;
    try {
      browserResult = await openSystemBrowser(authUrl, { spawnImpl });
    } catch (error) {
      const wrapped = new Error(error?.message || 'Could not open browser');
      wrapped.code = error?.code || 'open_failed';
      wrapped.authUrl = authUrl;
      throw wrapped;
    }
    if (!browserResult?.success) {
      const cause = browserResult?.error;
      return {
        ok: false,
        authUrl,
        attemptId,
        error: {
          code: 'open_failed',
          message: cause?.message || 'Could not open browser',
          authUrl
        }
      };
    }
    return { state: 'waiting', authUrl, attemptId };
  }

  async function cancelAuth(args) {
    const attemptId = args?.attemptId;
    if (!attemptId) return { error: 'attemptId is required' };
    const authFlow = activeAuthAttempts.get(attemptId);
    if (authFlow) {
      authFlow.invalidate();
      await authFlow.cancel('cancelled');
      activeAuthAttempts.delete(attemptId);
      graceFlows.delete(authFlow);
      return { state: 'signed_out' };
    }
    for (const flow of graceFlows) {
      if (flow.attemptId !== attemptId) continue;
      graceFlows.delete(flow);
      await flow.cancel('cancelled');
      return { state: 'signed_out' };
    }
    return { state: 'signed_out' };
  }

  async function cancelAll() {
    await closeActiveAttempts();
    await closeGraceFlows();
  }

  async function signOut() {
    // Synchronous so an in-flight provider save observes the new generation
    // before this function waits on network or disk. Tokens are cleared
    // after that bump; the issued client id stays for the next sign-in.
    bumpSessionGeneration();
    for (const flow of activeAuthAttempts.values()) flow.invalidate();
    for (const flow of graceFlows) flow.invalidate();
    await closeActiveAttempts();
    await closeGraceFlows();
    await clearStoredSession();
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
  const payload = idTokenClaims(creds?.id_token);
  if (!payload) return null;
  return payload.plan || payload['https://api.openai.com/plan'] || null;
}

export function accountFromCredentials(creds) {
  if (!creds || typeof creds !== 'object') return undefined;
  const claims = idTokenClaims(creds.id_token);
  const stored = creds.account && typeof creds.account === 'object' && !Array.isArray(creds.account)
    ? { ...creds.account }
    : {};
  if (!firstString(stored.email)) {
    const email = firstString(creds.email, claims?.email);
    if (email) stored.email = email;
  }
  if (!firstString(stored.name)) {
    const name = firstString(claims?.name);
    if (name) stored.name = name;
  }
  return Object.keys(stored).length > 0 ? stored : undefined;
}

async function readChatGPTConfig() {
  try {
    const raw = await readFile(join(getConfigDir(), 'chatgpt.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch (error) {
    rethrowIfTestConfigGuard(error);
    return {};
  }
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function firstTimeout(...values) {
  for (const value of values) {
    if (value == null || value === '') continue;
    const ms = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  return null;
}

function positiveInteger(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function resolveAuthTimeoutMs(timeoutMs) {
  return positiveInteger(timeoutMs)
    ?? positiveInteger(process.env[AUTH_TIMEOUT_ENV])
    ?? AUTH_TIMEOUT_MS;
}

function resolveAuthGraceMs(graceMs) {
  return positiveInteger(graceMs)
    ?? positiveInteger(process.env[AUTH_GRACE_ENV])
    ?? AUTH_GRACE_MS;
}

const SECRET_FIELD = 'access_token|refresh_token|id_token|code_verifier|client_secret|code';
const SECRET_JSON_KEYS = new RegExp(`"(${SECRET_FIELD})"(\\s*:\\s*)"((?:\\\\.|[^"\\\\])*)"`, 'g');
const SECRET_JSON_SINGLE_KEYS = new RegExp(`'(${SECRET_FIELD})'(\\s*:\\s*)'((?:\\\\.|[^'\\\\])*)'`, 'g');
// Form bodies and query strings. The value runs until `&` or whitespace.
// `code_verifier` is listed before `code` so the longer name wins.
const SECRET_FORM_FIELDS = new RegExp(`\\b(${SECRET_FIELD})=([^&\\s]*)`, 'g');
// URL-encoded `name%3Dvalue` (the encoded equals sign). Same value boundary.
const SECRET_FORM_ENCODED = new RegExp(`\\b(${SECRET_FIELD})(%3[Dd])([^&\\s]*)`, 'g');
// Unquoted `name: value`. A quote before the name is JSON and is handled above.
const SECRET_COLON_FIELDS = new RegExp(
  `(^|[^A-Za-z0-9_"'])(${SECRET_FIELD})(\\s*:\\s*)(?:"((?:\\\\.|[^"\\\\])*)"|'((?:\\\\.|[^'\\\\])*)'|([^&\\s"']*))`,
  'g'
);
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]{4,}/gi;
const API_KEY = /\bsk-[A-Za-z0-9_-]{8,}/g;
// Any rt_ token of length 1 or more. The word boundary keeps start_ intact.
const REFRESH_TOKEN = /\brt_[A-Za-z0-9._~+/=-]{1,}/g;
const SESSION_KEY = /\bsess-[A-Za-z0-9._~+/=-]{8,}/g;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){0,2}/g;
const EMAIL_ADDRESS = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// OAuth and OIDC error codes are not credentials. They often arrive under `code`.
const OAUTH_ERROR_CODES = new Set([
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'unauthorized_client',
  'unsupported_grant_type',
  'unsupported_response_type',
  'invalid_scope',
  'access_denied',
  'server_error',
  'temporarily_unavailable'
]);

function isVisibleErrorCode(key, value) {
  return key === 'code' && OAUTH_ERROR_CODES.has(value);
}

/**
 * Redact credentials in ChatGPT API errors and daemon logs.
 * Free-floating stand-ins shorter than 8 characters are left alone so a
 * value like "AT" cannot rewrite ordinary words. `rt_` tokens are the
 * exception: one or more characters after `rt_` are masked, and a word
 * boundary leaves words such as "start_" alone. Email local-parts keep
 * their first character.
 * Only secret-bearing keys are masked: access_token, refresh_token,
 * id_token, code_verifier, client_secret, and an authorization code.
 * That covers JSON, single quotes, `name=value`, URL-encoded `name%3Dvalue`,
 * and unquoted `name: value` (the value ends at `&` or whitespace).
 * Error fields stay visible, including "code":"invalid_client",
 * "error":"invalid_grant", and error_description. A sess- key is masked
 * when 8 or more token characters follow.
 */
export function maskSecrets(text, accessToken) {
  let masked = String(text ?? '');
  if (typeof accessToken === 'string' && accessToken.length >= 8) {
    masked = masked.split(accessToken).join('[REDACTED]');
  }
  SECRET_JSON_KEYS.lastIndex = 0;
  SECRET_JSON_SINGLE_KEYS.lastIndex = 0;
  SECRET_FORM_FIELDS.lastIndex = 0;
  SECRET_FORM_ENCODED.lastIndex = 0;
  SECRET_COLON_FIELDS.lastIndex = 0;
  BEARER_TOKEN.lastIndex = 0;
  API_KEY.lastIndex = 0;
  REFRESH_TOKEN.lastIndex = 0;
  SESSION_KEY.lastIndex = 0;
  JWT.lastIndex = 0;
  EMAIL_ADDRESS.lastIndex = 0;
  masked = masked.replace(SECRET_JSON_KEYS, (match, key, sep, value) => (
    isVisibleErrorCode(key, value) ? match : `"${key}"${sep}"[REDACTED]"`
  ));
  masked = masked.replace(SECRET_JSON_SINGLE_KEYS, (match, key, sep, value) => (
    isVisibleErrorCode(key, value) ? match : `'${key}'${sep}'[REDACTED]'`
  ));
  masked = masked.replace(SECRET_FORM_FIELDS, (match, key, value) => (
    isVisibleErrorCode(key, value) ? match : `${key}=[REDACTED]`
  ));
  masked = masked.replace(SECRET_FORM_ENCODED, (match, key, encodedEquals, value) => (
    isVisibleErrorCode(key, value) ? match : `${key}${encodedEquals}[REDACTED]`
  ));
  masked = masked.replace(SECRET_COLON_FIELDS, (match, prefix, key, sep, doubleQuoted, singleQuoted, bare) => {
    const value = doubleQuoted ?? singleQuoted ?? bare ?? '';
    if (isVisibleErrorCode(key, value)) return match;
    if (doubleQuoted !== undefined) return `${prefix}${key}${sep}"[REDACTED]"`;
    if (singleQuoted !== undefined) return `${prefix}${key}${sep}'[REDACTED]'`;
    return `${prefix}${key}${sep}[REDACTED]`;
  });
  masked = masked.replace(BEARER_TOKEN, 'Bearer [REDACTED]');
  masked = masked.replace(SESSION_KEY, '[REDACTED]');
  masked = masked.replace(JWT, '[REDACTED]');
  masked = masked.replace(API_KEY, '[REDACTED]');
  masked = masked.replace(REFRESH_TOKEN, '[REDACTED]');
  masked = masked.replace(EMAIL_ADDRESS, (address) => {
    const at = address.indexOf('@');
    return `${address[0]}***${address.slice(at)}`;
  });
  return masked;
}

function logAuth(message) {
  console.error(maskSecrets(message));
}
