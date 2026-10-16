import assert from 'node:assert/strict';
import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import vm from 'node:vm';

import { dispatchToolCall, startDaemon } from '../src/runtime/agent-daemon.js';
import {
  AUTH_ENDPOINT,
  ISSUER,
  JWKS_ENDPOINT,
  TOKEN_ENDPOINT,
  clearJwksCache,
  clearOidcDiscoveryCache,
  createChatGPTAuthManager,
  getOrCreateHostId,
  isValidHostId,
  loadCredentials,
  maskSecrets,
  openSystemBrowser,
  restoreCredentialBytes,
  refreshAccessToken,
  resolveChatGPTSettings,
  saveCredentials,
  startAuthFlow,
  useFallbackAuthEndpoints,
  verifyIdToken
} from '../src/runtime/auth/chatgpt-auth.js';
import { createEnvelope } from '../src/runtime/envelope.js';
import { parseProviderMessage, validateProviderToolCall } from '../src/runtime/provider-process.js';
import { PROVIDER_ALLOWED_TOOLS } from '../src/runtime/provider-registry.js';
import { callChatGPTResponses } from '../src/runtime/providers/chatgpt-provider.js';
import { isolateHome } from './isolate-home.js';

const originalFetch = globalThis.fetch;
const originalEnv = {
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  CHATPCB_CHATGPT_MODEL: process.env.CHATPCB_CHATGPT_MODEL,
  CHATPCB_CHATGPT_CLIENT_ID: process.env.CHATPCB_CHATGPT_CLIENT_ID,
  CHATPCB_CHATGPT_RESPONSES_TIMEOUT_MS: process.env.CHATPCB_CHATGPT_RESPONSES_TIMEOUT_MS,
  CHATPCB_CHATGPT_AUTH_TIMEOUT_MS: process.env.CHATPCB_CHATGPT_AUTH_TIMEOUT_MS,
  CHATPCB_CHATGPT_AUTH_GRACE_MS: process.env.CHATPCB_CHATGPT_AUTH_GRACE_MS
};

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
jwk.kid = 'kid-1';
jwk.alg = 'RS256';
jwk.use = 'sig';

const ALLOWED_TOOLS = [...PROVIDER_ALLOWED_TOOLS];
const HOST_ID_V4 = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OPENID_CONFIGURATION_URL = 'https://auth.openai.com/.well-known/openid-configuration';
let portCursor = 28000;

function openIdDocument(overrides = {}) {
  return {
    issuer: 'https://auth.openai.com',
    authorization_endpoint: 'https://auth.openai.com/api/accounts/authorize',
    token_endpoint: 'https://auth.openai.com/api/accounts/oauth/token',
    revocation_endpoint: 'https://auth.openai.com/api/accounts/oauth/revoke',
    jwks_uri: 'https://auth.openai.com/.well-known/jwks.json',
    userinfo_endpoint: 'https://auth.openai.com/api/accounts/oauth/userinfo',
    ...overrides
  };
}

describe('ChatGPT integration', { concurrency: 1 }, () => {
  let homeIsolation = null;

  beforeEach(async () => {
    delete process.env.CHATPCB_CHATGPT_CLIENT_ID;
    delete process.env.CHATPCB_CHATGPT_AUTH_TIMEOUT_MS;
    delete process.env.CHATPCB_CHATGPT_AUTH_GRACE_MS;
    clearJwksCache();
    // Drop any discovery document from the previous test, then seed the fallback
    // so tests that do not exercise discovery keep their fetch counts and stay offline.
    clearOidcDiscoveryCache();
    useFallbackAuthEndpoints();
    homeIsolation = await isolateHome();
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    restoreEnv('XDG_CONFIG_HOME');
    restoreEnv('CHATPCB_CHATGPT_MODEL');
    restoreEnv('CHATPCB_CHATGPT_CLIENT_ID');
    restoreEnv('CHATPCB_CHATGPT_RESPONSES_TIMEOUT_MS');
    restoreEnv('CHATPCB_CHATGPT_AUTH_TIMEOUT_MS');
    restoreEnv('CHATPCB_CHATGPT_AUTH_GRACE_MS');
    if (homeIsolation) {
      await homeIsolation.restore();
      homeIsolation = null;
    }
  });

  it('keeps ChatGPT config writes in the temporary home', async () => {
    const id = await getOrCreateHostId();
    const hostPath = path.join(process.env.XDG_CONFIG_HOME, 'chatpcb', 'chatgpt-host-id.txt');
    assert.equal((await readFile(hostPath, 'utf8')).trim(), id);
    const realHome = userInfo().homedir;
    const fromHome = path.relative(path.resolve(realHome), path.resolve(hostPath));
    assert.equal(fromHome === '' || fromHome.startsWith('..') || path.isAbsolute(fromHome), true);
  });

  it('refuses a ChatPCB config directory inside the real home under node --test', async () => {
    const realHome = userInfo().homedir;
    const saved = {
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      APPDATA: process.env.APPDATA
    };
    try {
      process.env.HOME = realHome;
      process.env.USERPROFILE = realHome;
      delete process.env.XDG_CONFIG_HOME;
      delete process.env.APPDATA;
      await assert.rejects(loadCredentials(), (error) => {
        assert.equal(error.code, 'CHATPCB_TEST_CONFIG_HOME');
        assert.match(error.message, /real home/);
        assert.match(error.message, /node --test/);
        return true;
      });
      process.env.XDG_CONFIG_HOME = `${realHome}-chatpcb-sibling`;
      assert.equal(await loadCredentials(), null);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('accepts a JWKS-signed RS256 ID token', async () => {
    stubFetch(async (url) => {
      assert.match(String(url), /jwks/);
      return jsonResponse({ keys: [jwk] });
    });
    const payload = await verifyIdToken(signToken(claims()), 'nonce-1', 'oaiapp_TEST');
    assert.equal(payload.email, 'test@example.com');
    assert.equal(payload.iss, 'https://auth.openai.com');
  });

  it('rejects a forged ID token signature', async () => {
    stubFetch(async () => jsonResponse({ keys: [jwk] }));
    const [header, payload, signature] = signToken(claims()).split('.');
    const forged = `${header}.${payload}.${Buffer.from(`forged-${signature}`).toString('base64url')}`;
    await assert.rejects(verifyIdToken(forged, 'nonce-1', 'oaiapp_TEST'), /signature verification failed/);
  });

  it('rejects an ID token that is missing exp', async () => {
    stubFetch(async () => jsonResponse({ keys: [jwk] }));
    const { exp, ...rest } = claims();
    assert.ok(exp);
    await assert.rejects(verifyIdToken(signToken(rest), 'nonce-1', 'oaiapp_TEST'), /missing exp/);
  });

  it('rejects expired, wrong iss, aud, nonce, unknown kid, and non-RS256 alg', async () => {
    stubFetch(async () => jsonResponse({ keys: [jwk] }));
    const now = Math.floor(Date.now() / 1000);
    await assert.rejects(verifyIdToken(signToken(claims({ exp: now - 10 })), 'nonce-1', 'oaiapp_TEST'), /expired/);
    await assert.rejects(verifyIdToken(signToken(claims({ iss: 'https://evil.example' })), 'nonce-1', 'oaiapp_TEST'), /issuer/);
    await assert.rejects(verifyIdToken(signToken(claims({ aud: 'other-client' })), 'nonce-1', 'oaiapp_TEST'), /audience/);
    await assert.rejects(verifyIdToken(signToken(claims({ nonce: 'other' })), 'nonce-1', 'oaiapp_TEST'), /nonce/);
    await assert.rejects(
      verifyIdToken(signToken(claims(), { alg: 'RS256', typ: 'JWT', kid: 'missing-kid' }), 'nonce-1', 'oaiapp_TEST'),
      /Unknown ID token kid/
    );
    await assert.rejects(
      verifyIdToken(signToken(claims(), { alg: 'none', typ: 'JWT', kid: 'kid-1' }), 'nonce-1', 'oaiapp_TEST'),
      /RS256/
    );
  });

  it('uses an optional issued client id and keeps it when the callback omits client_id', async () => {
    await withConfig(async () => {
      const { spawnImpl } = fakeSpawn();
      const manager = createChatGPTAuthManager({
        clientId: 'oaiapp_TEST',
        spawnImpl,
        portStart: allocPort(),
        timeoutMs: 20000
      });
      const nonceRef = { nonce: null };
      const tokenCalls = [];
      stubFetch(tokenHandler({ tokenCalls, nonceRef, aud: 'oaiapp_TEST' }));

      try {
        const started = await manager.startAuth();
        const authUrl = new URL(started.authUrl);
        nonceRef.nonce = authUrl.searchParams.get('nonce');
        const state = authUrl.searchParams.get('state');
        assert.equal(authUrl.searchParams.get('client_id'), 'oaiapp_TEST');
        assert.equal(authUrl.searchParams.get('client_id') === 'dynamic_agent_client', false);
        assert.equal(authUrl.searchParams.has('agent_name_hint'), false);
        assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
        assert.equal(authUrl.searchParams.get('scope'), PLAN_SCOPE);
        assert.match(authUrl.searchParams.get('ext_agent_host_id'), HOST_ID_V4);
        assert.match(started.authUrl, /^https:\/\/auth\.openai\.com\//);

        const redirect = authUrl.searchParams.get('redirect_uri');
        assert.match(redirect, /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
        const page = await httpGet(`${redirect}?code=CODE&state=${state}`);
        assert.equal(page.status, 200);
        assert.match(page.body, /Successfully signed in/);
        assert.equal(tokenCalls.length, 1);
        const body = new URLSearchParams(tokenCalls[0]);
        assert.equal(body.get('client_id'), 'oaiapp_TEST');
        assert.equal(body.get('redirect_uri'), redirect);
        assert.equal(body.get('resource'), 'https://api.openai.com/v1');
        assert.equal(body.has('client_secret'), false);
        assert.equal(
          createHash('sha256').update(body.get('code_verifier')).digest('base64url'),
          authUrl.searchParams.get('code_challenge')
        );

        const saved = await loadCredentials();
        assert.equal(saved.client_id, 'oaiapp_TEST');
        assert.equal(saved.account.email, 'ada@ex.com');
      } finally {
        await manager.cancelAll();
      }
    });
  });

  it('registers a new account with dynamic_agent_client and reuses the issued client id', async () => {
    await withConfig(async (dir) => {
      const { spawnImpl } = fakeSpawn();
      const manager = createChatGPTAuthManager({
        spawnImpl,
        portStart: allocPort(),
        timeoutMs: 20000
      });
      const nonceRef = { nonce: null };
      const tokenCalls = [];
      stubFetch(tokenHandler({ tokenCalls, nonceRef, aud: 'oaiapp_ISSUED', sub: 'user_123', email: 'ada@ex.com' }));

      try {
        const started = await manager.startAuth();
        const authUrl = new URL(started.authUrl);
        nonceRef.nonce = authUrl.searchParams.get('nonce');
        const state = authUrl.searchParams.get('state');
        const hostId = authUrl.searchParams.get('ext_agent_host_id');
        assert.equal(authUrl.searchParams.get('client_id'), 'dynamic_agent_client');
        assert.equal(authUrl.searchParams.get('agent_name_hint'), 'OH-MY-ChatPCB');
        assert.match(hostId, HOST_ID_V4);
        assert.equal(authUrl.searchParams.get('response_type'), 'code');
        assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
        assert.equal(authUrl.searchParams.get('scope'), PLAN_SCOPE);
        assert.equal(authUrl.searchParams.get('resource'), 'https://api.openai.com/v1');
        const redirect = authUrl.searchParams.get('redirect_uri');
        assert.match(redirect, /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
        assert.equal(redirect.includes('localhost'), false);

        const page = await httpGet(`${redirect}?code=CODE&state=${state}&client_id=oaiapp_ISSUED`);
        assert.match(page.body, /Successfully signed in/);
        const body = new URLSearchParams(tokenCalls[0]);
        assert.equal(body.get('client_id'), 'oaiapp_ISSUED');
        assert.equal(body.get('client_id') === 'dynamic_agent_client', false);
        assert.equal(body.get('redirect_uri'), redirect);
        assert.equal(body.has('client_secret'), false);
        assert.equal(
          createHash('sha256').update(body.get('code_verifier')).digest('base64url'),
          authUrl.searchParams.get('code_challenge')
        );

        const saved = await loadCredentials();
        assert.equal(saved.client_id, 'oaiapp_ISSUED');
        assert.equal(saved.email, 'ada@ex.com');
        assert.equal(saved.issuer, 'https://auth.openai.com');
        assert.equal(saved.subject, 'user_123');
        assert.equal(saved.ext_agent_host_id, hostId);
        assert.equal(saved.access_token, 'AT');
        assert.equal(saved.refresh_token, 'RT');
        assert.equal(saved.token_type, 'Bearer');
        assert.ok(saved.scopes.includes('chatgpt.tokens.use.direct'));
        assert.match(saved.saved_at, /^\d{4}-\d{2}-\d{2}T/);
        const credPath = path.join(dir, 'chatpcb', 'chatgpt-credentials-oaiapp_ISSUED.json');
        const raw = await readFile(credPath, 'utf8');
        assert.equal(raw.includes('dynamic_agent_client'), false);
        assert.equal((await stat(credPath)).mode & 0o777, 0o600);

        const second = createChatGPTAuthManager({
          spawnImpl,
          portStart: allocPort(),
          timeoutMs: 20000
        });
        try {
          const again = await second.startAuth();
          const againUrl = new URL(again.authUrl);
          assert.equal(againUrl.searchParams.get('client_id'), 'oaiapp_ISSUED');
          assert.equal(againUrl.searchParams.has('agent_name_hint'), false);
          assert.equal(againUrl.searchParams.get('id_token_hint'), saved.id_token);
          assert.equal(againUrl.searchParams.get('login_hint'), 'ada@ex.com');
          assert.equal(againUrl.searchParams.get('ext_agent_host_id'), hostId);
          assert.notEqual(againUrl.searchParams.get('state'), state);
          assert.notEqual(againUrl.searchParams.get('nonce'), nonceRef.nonce);
          assert.notEqual(againUrl.searchParams.get('code_challenge'), authUrl.searchParams.get('code_challenge'));
        } finally {
          await second.cancelAll();
        }
      } finally {
        await manager.cancelAll();
      }
    });
  });

  it('treats a new registration without an issued client id as incomplete', async () => {
    await withConfig(async () => {
      const { spawnImpl } = fakeSpawn();
      const tokenCalls = [];
      stubFetch(async (url) => {
        tokenCalls.push(String(url));
        if (String(url).includes('jwks')) return jsonResponse({ keys: [jwk] });
        return new Response('no', { status: 404 });
      });
      const missing = createChatGPTAuthManager({ spawnImpl, portStart: allocPort(), timeoutMs: 20000 });
      const dynamic = createChatGPTAuthManager({ spawnImpl, portStart: allocPort(), timeoutMs: 20000 });
      try {
        const started = await missing.startAuth();
        const authUrl = new URL(started.authUrl);
        const redirect = authUrl.searchParams.get('redirect_uri');
        const state = authUrl.searchParams.get('state');
        const page = await httpGet(`${redirect}?code=CODE&state=${state}`);
        assert.match(page.body, /incomplete/i);
        assert.equal(tokenCalls.length, 0);
        assert.equal(await loadCredentials(), null);

        const startedDynamic = await dynamic.startAuth();
        const dynamicUrl = new URL(startedDynamic.authUrl);
        const dynamicPage = await httpGet(
          `${dynamicUrl.searchParams.get('redirect_uri')}?code=CODE&state=${dynamicUrl.searchParams.get('state')}&client_id=dynamic_agent_client`
        );
        assert.match(dynamicPage.body, /incomplete/i);
        assert.equal(tokenCalls.length, 0);
        assert.equal(await loadCredentials(), null);
      } finally {
        await missing.cancelAll();
        await dynamic.cancelAll();
      }
    });
  });

  it('generates one host id and reuses it across manager instances', async () => {
    await withConfig(async (dir) => {
      const { spawnImpl } = fakeSpawn();
      const first = createChatGPTAuthManager({ spawnImpl, portStart: allocPort(), timeoutMs: 20000 });
      const second = createChatGPTAuthManager({ spawnImpl, portStart: allocPort(), timeoutMs: 20000 });
      try {
        const started = await first.startAuth();
        const hostId = new URL(started.authUrl).searchParams.get('ext_agent_host_id');
        assert.match(hostId, HOST_ID_V4);
        await first.cancelAll();
        const again = await second.startAuth();
        assert.equal(new URL(again.authUrl).searchParams.get('ext_agent_host_id'), hostId);
        const hostPath = path.join(dir, 'chatpcb', 'chatgpt-host-id.txt');
        assert.equal((await readFile(hostPath, 'utf8')).trim(), hostId);
        assert.equal((await stat(hostPath)).mode & 0o777, 0o600);
      } finally {
        await first.cancelAll();
        await second.cancelAll();
      }
    });
  });

  it('creates the config directory mode 0o700 and tightens an existing directory on POSIX', async () => {
    await withConfig(async (dir) => {
      await saveCredentials(sampleCreds());
      const configDir = path.join(dir, 'chatpcb');
      const created = await stat(configDir);
      assert.equal(created.isDirectory(), true);
      if (process.platform !== 'win32') assert.equal(created.mode & 0o777, 0o700);
    });

    await withConfig(async (dir) => {
      const configDir = path.join(dir, 'chatpcb');
      await mkdir(configDir, { recursive: true });
      if (process.platform !== 'win32') {
        await chmod(configDir, 0o755);
        assert.equal((await stat(configDir)).mode & 0o777, 0o755);
      }
      await getOrCreateHostId();
      if (process.platform !== 'win32') assert.equal((await stat(configDir)).mode & 0o777, 0o700);

      if (process.platform !== 'win32') await chmod(configDir, 0o755);
      await saveCredentials(sampleCreds());
      if (process.platform !== 'win32') assert.equal((await stat(configDir)).mode & 0o777, 0o700);
    });
  });

  it('replaces a legacy host_ id with a stable urn:uuid', async () => {
    await withConfig(async (dir) => {
      const hostPath = path.join(dir, 'chatpcb', 'chatgpt-host-id.txt');
      await mkdir(path.dirname(hostPath), { recursive: true });
      await writeFile(hostPath, 'host_fa1d4d58b406ac26b8f63419552b90f4', { mode: 0o600 });

      const first = await getOrCreateHostId();
      assert.match(first, HOST_ID_V4);
      assert.notEqual(first, 'host_fa1d4d58b406ac26b8f63419552b90f4');
      assert.equal(await readFile(hostPath, 'utf8'), first);
      assert.equal((await stat(hostPath)).mode & 0o777, 0o600);
      const names = await readdir(path.dirname(hostPath));
      assert.equal(names.some((name) => name.endsWith('.tmp')), false);

      assert.equal(await getOrCreateHostId(), first);
      assert.equal(await readFile(hostPath, 'utf8'), first);
    });
  });

  it('normalizes an uppercase urn:uuid host id and persists the canonical form', async () => {
    const cases = [
      'URN:UUID:123E4567-E89B-42D3-A456-426614174000',
      'urn:uuid:123E4567-E89B-42D3-A456-426614174000'
    ];
    const canonical = 'urn:uuid:123e4567-e89b-42d3-a456-426614174000';
    for (const stored of cases) {
      await withConfig(async (dir) => {
        const hostPath = path.join(dir, 'chatpcb', 'chatgpt-host-id.txt');
        await mkdir(path.dirname(hostPath), { recursive: true });
        await writeFile(hostPath, `${stored}\n`, { mode: 0o644 });
        await saveCredentials({
          ...sampleCreds(),
          ext_agent_host_id: stored
        });

        assert.equal(await getOrCreateHostId(), canonical);
        assert.equal(await readFile(hostPath, 'utf8'), canonical);
        assert.equal((await stat(hostPath)).mode & 0o777, 0o600);
        const names = await readdir(path.dirname(hostPath));
        assert.equal(names.some((name) => name.endsWith('.tmp')), false);
        assert.equal((await loadCredentials()).client_id, 'oaiapp_TEST');
        assert.equal((await loadCredentials()).ext_agent_host_id, stored);

        assert.equal(await getOrCreateHostId(), canonical);
        assert.equal(await readFile(hostPath, 'utf8'), canonical);
      });
    }
  });

  it('drops registrations that do not match a regenerated host id', async () => {
    await withConfig(async (dir) => {
      const hostPath = path.join(dir, 'chatpcb', 'chatgpt-host-id.txt');
      await mkdir(path.dirname(hostPath), { recursive: true });
      const oldHost = 'host_fa1d4d58b406ac26b8f63419552b90f4';
      await writeFile(hostPath, oldHost, { mode: 0o600 });
      await saveCredentials({
        ...sampleCreds(),
        client_id: 'oaiapp_OLD',
        ext_agent_host_id: oldHost,
        account: { email: 'old@ex.com' },
        last_used_at: 30
      });
      await saveCredentials({
        ...sampleCreds(),
        client_id: 'oaiapp_OTHER',
        ext_agent_host_id: 'urn:uuid:123e4567-e89b-42d3-a456-426614174000',
        account: { email: 'other@ex.com' },
        last_used_at: 20
      });
      await saveCredentials({
        ...sampleCreds(),
        client_id: 'oaiapp_NONE',
        account: { email: 'none@ex.com' },
        last_used_at: 10
      });

      const { spawnImpl } = fakeSpawn();
      const manager = createChatGPTAuthManager({ spawnImpl, portStart: allocPort(), timeoutMs: 20000 });
      try {
        const started = await manager.startAuth();
        const authUrl = new URL(started.authUrl);
        const next = authUrl.searchParams.get('ext_agent_host_id');
        assert.match(next, HOST_ID_V4);
        assert.notEqual(next, oldHost);
        assert.equal(await readFile(hostPath, 'utf8'), next);
        assert.equal((await stat(hostPath)).mode & 0o777, 0o600);
        const names = await readdir(path.dirname(hostPath));
        assert.equal(names.some((name) => name.endsWith('.tmp')), false);
        assert.equal(await loadCredentials(), null);
        assert.deepEqual(await listCredentialFiles(dir), []);
        assert.equal(await getOrCreateHostId(), next);
        assert.equal(authUrl.searchParams.get('client_id'), 'dynamic_agent_client');
        assert.equal(authUrl.searchParams.get('agent_name_hint'), 'OH-MY-ChatPCB');
      } finally {
        await manager.cancelAll();
      }
    });
  });

  it('preserves a valid existing host id', async () => {
    const values = [
      'urn:uuid:123e4567-e89b-42d3-a456-426614174000',
      'urn:ietf:params:oauth:jwk-thumbprint:sha-256:NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs',
      'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
    ];
    for (const existing of values) {
      await withConfig(async (dir) => {
        const hostPath = path.join(dir, 'chatpcb', 'chatgpt-host-id.txt');
        await mkdir(path.dirname(hostPath), { recursive: true });
        await writeFile(hostPath, existing, 'utf8');
        assert.equal(await getOrCreateHostId(), existing);
        assert.equal(await readFile(hostPath, 'utf8'), existing);
        assert.equal(await getOrCreateHostId(), existing);
      });
    }
  });

  it('accepts only OpenAI host id formats', () => {
    const valid = [
      'urn:uuid:123e4567-e89b-42d3-a456-426614174000',
      'urn:uuid:123E4567-E89B-42D3-A456-426614174000',
      'URN:UUID:123e4567-e89b-42d3-a456-426614174000',
      'urn:ietf:params:oauth:jwk-thumbprint:sha-256:NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs',
      'urn:ietf:params:oauth:jwk-thumbprint:sha-384:dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
      'urn:ietf:params:oauth:jwk-thumbprint:sha-512:NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9XsNzbLsXh8uDCcd-6MNwXF4W_7noWX',
      'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
      'did:key:zDnaerx9CtbPJ1q36T5Ln5wYt3MQYeGRG5ehnPAmxcf5mDZpv'
    ];
    for (const value of valid) assert.equal(isValidHostId(value), true, value);

    const invalid = [
      '',
      ' ',
      '\n',
      '\t',
      'urn:uuid:123e4567-e89b-42d3-a456-426614174000 ',
      ' urn:uuid:123e4567-e89b-42d3-a456-426614174000',
      'urn:uuid:123e4567-e89b-42d3-a456-426614174000\n',
      'host_fa1d4d58b406ac26b8f63419552b90f4',
      'host_',
      'urn:uuid:fa1d4d58b406ac26b8f63419552b90f4',
      'urn:uuid:123e4567-e89b-12d3-a456-426614174000',
      'urn:uuid:123e4567-e89b-42d3-c456-426614174000',
      'urn:uuid:123e4567-e89b-42d3-a456-42661417400',
      'urn:uuid:123e4567e89b42d3a456426614174000',
      'urn:ietf:params:oauth:jwk-thumbprint:sha-256:',
      'urn:ietf:params:oauth:jwk-thumbprint::NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs',
      'urn:ietf:params:oauth:jwk-thumbprint:SHA-256:NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs',
      'urn:ietf:params:oauth:jwk-thumbprint:sha-256:not base64',
      'urn:ietf:params:oauth:jwk-thumbprint:sha-256:abc+/=',
      'did:key:z',
      'did:key:z0OIl',
      'did:key:u6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
      'did:web:example.com',
      null,
      undefined,
      42
    ];
    for (const value of invalid) assert.equal(isValidHostId(value), false, String(value));
  });

  it('rejects a callback client id that differs from the selected registration', async () => {
    await withConfig(async () => {
      await saveCredentials({
        ...sampleCreds(),
        client_id: 'oaiapp_SAVED',
        access_token: 'OLD',
        subject: 'user_123',
        email: 'ada@ex.com',
        id_token: 'retained-id-token',
        account: { email: 'ada@ex.com' }
      });
      const { spawnImpl } = fakeSpawn();
      const manager = createChatGPTAuthManager({ spawnImpl, portStart: allocPort(), timeoutMs: 20000 });
      const tokenCalls = [];
      stubFetch(async (url) => {
        tokenCalls.push(String(url));
        return new Response('no', { status: 404 });
      });
      try {
        const started = await manager.startAuth();
        const authUrl = new URL(started.authUrl);
        assert.equal(authUrl.searchParams.get('client_id'), 'oaiapp_SAVED');
        const redirect = authUrl.searchParams.get('redirect_uri');
        const state = authUrl.searchParams.get('state');
        const page = await httpGet(`${redirect}?code=CODE&state=${state}&client_id=oaiapp_OTHER`);
        assert.match(page.body, /does not match/);
        assert.equal(tokenCalls.some((url) => url.includes('/oauth/token')), false);
        assert.equal((await loadCredentials()).access_token, 'OLD');
        assert.equal((await loadCredentials()).client_id, 'oaiapp_SAVED');
      } finally {
        await manager.cancelAll();
      }
    });
  });

  it('rejects an ID token whose audience is not the issued client id', async () => {
    await withConfig(async () => {
      const { spawnImpl } = fakeSpawn();
      const manager = createChatGPTAuthManager({ spawnImpl, portStart: allocPort(), timeoutMs: 20000 });
      const nonceRef = { nonce: null };
      const tokenCalls = [];
      stubFetch(tokenHandler({ tokenCalls, nonceRef, aud: 'oaiapp_OTHER' }));
      try {
        const started = await manager.startAuth();
        const authUrl = new URL(started.authUrl);
        nonceRef.nonce = authUrl.searchParams.get('nonce');
        const redirect = authUrl.searchParams.get('redirect_uri');
        const page = await httpGet(`${redirect}?code=CODE&state=${authUrl.searchParams.get('state')}&client_id=oaiapp_ISSUED`);
        assert.match(page.body, /audience/i);
        assert.equal(new URLSearchParams(tokenCalls[0]).get('client_id'), 'oaiapp_ISSUED');
        assert.equal(await loadCredentials(), null);
      } finally {
        await manager.cancelAll();
      }
    });
  });

  it('rejects a token response that omits chatgpt.tokens.use.direct', async () => {
    await withConfig(async () => {
      const { spawnImpl } = fakeSpawn();
      const manager = createChatGPTAuthManager({ spawnImpl, portStart: allocPort(), timeoutMs: 20000 });
      const nonceRef = { nonce: null };
      const tokenCalls = [];
      stubFetch(tokenHandler({
        tokenCalls,
        nonceRef,
        aud: 'oaiapp_ISSUED',
        scope: 'openid profile email'
      }));
      try {
        const started = await manager.startAuth();
        const authUrl = new URL(started.authUrl);
        nonceRef.nonce = authUrl.searchParams.get('nonce');
        const page = await httpGet(
          `${authUrl.searchParams.get('redirect_uri')}?code=CODE&state=${authUrl.searchParams.get('state')}&client_id=oaiapp_ISSUED`
        );
        assert.match(page.body, /chatgpt\.tokens\.use\.direct/);
        assert.equal(await loadCredentials(), null);

        await saveCredentials({
          ...sampleCreds(),
          scope: 'openid profile email',
          scopes: ['openid', 'profile', 'email']
        });
        let called = false;
        stubFetch(async () => {
          called = true;
          return new Response('no', { status: 500 });
        });
        await assert.rejects(callChatGPTResponses({ prompt: 'hi' }), /chatgpt\.tokens\.use\.direct/);
        assert.equal(called, false);
      } finally {
        await manager.cancelAll();
      }
    });
  });

  it('rejects a returning account whose verified subject does not match', async () => {
    await withConfig(async () => {
      await saveCredentials({
        ...sampleCreds(),
        client_id: 'oaiapp_SAVED',
        access_token: 'OLD',
        subject: 'user_123',
        email: 'ada@ex.com',
        id_token: 'retained-id-token',
        account: { email: 'ada@ex.com' }
      });
      const { spawnImpl } = fakeSpawn();
      const manager = createChatGPTAuthManager({ spawnImpl, portStart: allocPort(), timeoutMs: 20000 });
      const nonceRef = { nonce: null };
      const tokenCalls = [];
      stubFetch(tokenHandler({ tokenCalls, nonceRef, aud: 'oaiapp_SAVED', sub: 'user_other', email: 'ada@ex.com' }));
      try {
        const started = await manager.startAuth();
        const authUrl = new URL(started.authUrl);
        nonceRef.nonce = authUrl.searchParams.get('nonce');
        assert.equal(authUrl.searchParams.get('id_token_hint'), 'retained-id-token');
        assert.equal(authUrl.searchParams.get('login_hint'), 'ada@ex.com');
        const page = await httpGet(`${authUrl.searchParams.get('redirect_uri')}?code=CODE&state=${authUrl.searchParams.get('state')}`);
        assert.match(page.body, /subject does not match/);
        assert.equal(tokenCalls.length, 1);
        assert.equal((await loadCredentials()).access_token, 'OLD');
      } finally {
        await manager.cancelAll();
      }
    });
  });

  it('stops on access_denied after validating state and does not exchange a code', async () => {
    await withConfig(async () => {
      const { spawnImpl } = fakeSpawn();
      const manager = createChatGPTAuthManager({ spawnImpl, portStart: allocPort(), timeoutMs: 20000 });
      const tokenCalls = [];
      stubFetch(async (url) => {
        tokenCalls.push(String(url));
        return new Response('no', { status: 404 });
      });
      try {
        const started = await manager.startAuth();
        const authUrl = new URL(started.authUrl);
        const redirect = authUrl.searchParams.get('redirect_uri');
        const state = authUrl.searchParams.get('state');
        const denied = await httpGet(`${redirect}?error=access_denied&state=${state}&code=SHOULD_NOT_EXCHANGE`);
        assert.match(denied.body, /cancelled/i);
        assert.equal(tokenCalls.length, 0);

        const mismatched = await manager.startAuth();
        const mismatchedUrl = new URL(mismatched.authUrl);
        const wrongState = await httpGet(
          `${mismatchedUrl.searchParams.get('redirect_uri')}?error=access_denied&state=not-the-state&code=SHOULD_NOT_EXCHANGE`
        );
        assert.match(wrongState.body, /state mismatch/);
        assert.equal(tokenCalls.length, 0);
      } finally {
        await manager.cancelAll();
      }
    });
  });

  it('keeps the issued client id after sign-out and still accepts an override', async () => {
    await withConfig(async (dir) => {
      const { spawnImpl } = fakeSpawn();
      const manager = createChatGPTAuthManager({ spawnImpl, portStart: allocPort(), timeoutMs: 20000 });
      const nonceRef = { nonce: null };
      const tokenCalls = [];
      stubFetch(tokenHandler({ tokenCalls, nonceRef, aud: 'oaiapp_ISSUED', email: 'ada@ex.com' }));
      try {
        const started = await manager.startAuth();
        const authUrl = new URL(started.authUrl);
        nonceRef.nonce = authUrl.searchParams.get('nonce');
        const redirect = authUrl.searchParams.get('redirect_uri');
        const hostId = authUrl.searchParams.get('ext_agent_host_id');
        await httpGet(`${redirect}?code=CODE&state=${authUrl.searchParams.get('state')}&client_id=oaiapp_ISSUED`);
        assert.equal((await loadCredentials()).client_id, 'oaiapp_ISSUED');

        await saveCredentials({
          client_id: 'oaiapp_OTHER',
          access_token: 'AT_OTHER',
          refresh_token: 'RT_OTHER',
          id_token: 'header.payload.sig',
          expires_in: 3600,
          issued_at: 1,
          scope: 'openid',
          scopes: ['openid'],
          token_type: 'Bearer',
          email: 'other@ex.com',
          subject: 'user_other',
          ext_agent_host_id: hostId,
          account: { email: 'other@ex.com' },
          last_used_at: 1
        });

        assert.equal((await manager.signOut()).state, 'signed_out');
        assert.equal(await loadCredentials(), null);
        assert.equal((await manager.getAuthStatus()).state, 'signed_out');
        const retained = JSON.parse(await readFile(path.join(dir, 'chatpcb', 'chatgpt-credentials-oaiapp_ISSUED.json'), 'utf8'));
        assert.equal(retained.client_id, 'oaiapp_ISSUED');
        assert.equal(retained.ext_agent_host_id, hostId);
        assert.equal(retained.issuer, 'https://auth.openai.com');
        assert.equal(typeof retained.saved_at, 'string');
        assert.equal(typeof retained.last_used_at, 'number');
        assert.deepEqual(Object.keys(retained).sort(), ['client_id', 'ext_agent_host_id', 'issuer', 'last_used_at', 'saved_at']);
        assertSessionCleared(retained);
        assert.equal(JSON.stringify(retained).includes('ada@ex.com'), false);
        assert.equal(JSON.stringify(retained).includes('user_123'), false);
        const other = JSON.parse(await readFile(path.join(dir, 'chatpcb', 'chatgpt-credentials-oaiapp_OTHER.json'), 'utf8'));
        assert.equal(other.client_id, 'oaiapp_OTHER');
        assert.equal(other.ext_agent_host_id, hostId);
        assert.equal(other.last_used_at, 1);
        assert.deepEqual(Object.keys(other).sort(), ['client_id', 'ext_agent_host_id', 'last_used_at']);
        assertSessionCleared(other);
        assert.equal(JSON.stringify(other).includes('other@ex.com'), false);

        const returned = await manager.startAuth();
        const returnedUrl = new URL(returned.authUrl);
        assert.equal(returnedUrl.searchParams.get('client_id'), 'oaiapp_ISSUED');
        assert.equal(returnedUrl.searchParams.has('agent_name_hint'), false);
        assert.equal(returnedUrl.searchParams.has('id_token_hint'), false);
        assert.equal(returnedUrl.searchParams.has('login_hint'), false);
        assert.equal(returned.authUrl.includes('ada@ex.com'), false);
        assert.equal(returned.authUrl.includes('other@ex.com'), false);
        assert.equal(returned.authUrl.includes('user_123'), false);
        assert.equal(returnedUrl.searchParams.get('ext_agent_host_id'), hostId);
        await manager.cancelAll();

        process.env.CHATPCB_CHATGPT_CLIENT_ID = 'oaiapp_FROM_ENV';
        const fromEnv = await manager.startAuth();
        const envUrl = new URL(fromEnv.authUrl);
        assert.equal(envUrl.searchParams.get('client_id'), 'oaiapp_FROM_ENV');
        assert.equal(envUrl.searchParams.has('agent_name_hint'), false);
        await manager.cancelAll();
        delete process.env.CHATPCB_CHATGPT_CLIENT_ID;

        await mkdir(path.join(dir, 'chatpcb'), { recursive: true });
        await writeFile(path.join(dir, 'chatpcb', 'chatgpt.json'), JSON.stringify({ clientId: 'oaiapp_FROM_FILE' }));
        const fromFile = await manager.startAuth();
        assert.equal(new URL(fromFile.authUrl).searchParams.get('client_id'), 'oaiapp_FROM_FILE');
        assert.equal(new URL(fromFile.authUrl).searchParams.has('agent_name_hint'), false);
      } finally {
        await manager.cancelAll();
      }
    });
  });

  it('cancel closes the callback listener and clears its timer', async () => {
    const { spawnImpl } = fakeSpawn();
    let timedOut = false;
    const portStart = allocPort();
    const flow = startAuthFlow({
      clientId: 'oaiapp_TEST',
      spawnImpl,
      portStart,
      timeoutMs: 80,
      onTimeout: () => { timedOut = true; }
    });
    try {
      const authUrl = await flow.whenReady;
      const port = redirectPort(authUrl);
      assert.equal((await httpGet(`http://127.0.0.1:${port}/health`)).status, 404);
      await flow.cancel();
      await delay(150);
      assert.equal(timedOut, false);
      assert.equal(await canListen(port), true);
      assert.equal((await httpGet(`http://127.0.0.1:${port}/health`)).status, 0);
    } finally {
      await flow.cancel();
    }
  });

  it('keeps the callback port after expiry and does not exchange a late code', async () => {
    await withConfig(async () => {
      const { spawnImpl } = fakeSpawn();
      const logs = spyConsoleError();
      const tokenCalls = [];
      stubFetch(async (url) => {
        tokenCalls.push(String(url));
        return jsonResponse({
          access_token: 'LATE',
          refresh_token: 'LATE',
          expires_in: 3600,
          id_token: 'late.not.used'
        });
      });
      const manager = createChatGPTAuthManager({
        clientId: 'oaiapp_TEST',
        spawnImpl,
        portStart: allocPort(),
        timeoutMs: 60
      });
      const events = [];
      try {
        const started = await manager.startAuth({}, (_type, payload) => events.push(payload));
        assert.match(started.expiresAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        const until = Date.parse(started.expiresAt) - Date.now();
        assert.ok(until > 0 && until <= 120, `expiresAt is not the short timeout: ${until}`);
        const waiting = await manager.getAuthStatus();
        assert.equal(waiting.state, 'waiting');
        assert.equal(waiting.expiresAt, started.expiresAt);
        assert.equal(waiting.attemptId, started.attemptId);

        const authUrl = new URL(started.authUrl);
        const state = authUrl.searchParams.get('state');
        const redirect = authUrl.searchParams.get('redirect_uri');
        const port = redirectPort(started.authUrl);
        await waitFor(() => events.some((event) => event.code === 'timeout'));
        const expiredStatus = await manager.getAuthStatus();
        assert.equal(expiredStatus.state, 'error');
        assert.equal(expiredStatus.code, 'timeout');
        assert.equal(expiredStatus.expiresAt, started.expiresAt);
        assert.ok((await manager.reopenAuth({ attemptId: started.attemptId })).error);

        const lateUrl = `${redirect}?code=CODE&state=${state}`;
        const first = await httpGet(lateUrl);
        const second = await httpGet(lateUrl);
        assert.equal(first.status, 410);
        assert.equal(second.status, 410);
        assert.match(first.body, /This sign-in attempt expired/);
        assert.match(first.body, /Nothing was saved/);
        assert.match(first.body, /Continue with ChatGPT/);
        assert.match(first.body, /로그인 시도가 만료되었습니다/);
        assert.match(first.body, /저장된 내용은 없습니다/);
        assert.match(first.body, /ChatPCB/);
        assert.equal(tokenCalls.length, 0);
        assert.equal(await loadCredentials(), null);

        const chatLogs = logs.lines.filter((line) => line.startsWith('ChatGPT sign-in') || line === 'late ChatGPT callback received after expiry');
        assert.ok(chatLogs.includes(`ChatGPT sign-in waiting on http://127.0.0.1:${port}/auth/callback until ${started.expiresAt}`));
        const expiredLog = chatLogs.find((line) => line.startsWith('ChatGPT sign-in attempt expired at '));
        assert.equal(typeof expiredLog, 'string');
        assert.equal(
          expiredLog.startsWith(`ChatGPT sign-in attempt expired at ${started.expiresAt}; callback port kept for late redirects until `),
          true
        );
        const graceUntil = Date.parse(expiredLog.split(' until ').at(-1));
        const graceSpan = graceUntil - Date.parse(started.expiresAt);
        assert.ok(graceSpan >= (10 * 60 * 1000) - 50 && graceSpan <= (10 * 60 * 1000) + 5000, `default grace was ${graceSpan}`);
        assert.equal(chatLogs.filter((line) => line === 'late ChatGPT callback received after expiry').length, 2);
        assert.equal(chatLogs.some((line) => line.includes(state) || line.includes('CODE') || line.includes('auth.openai.com') || line.includes('access_token')), false);
      } finally {
        logs.restore();
        await manager.cancelAll();
      }
    });
  });

  it('lets a one-shot process exit during grace while the expired page still answers', async () => {
    await withConfig(async () => {
      const { spawnImpl } = fakeSpawn();
      const flow = startAuthFlow({
        clientId: 'oaiapp_TEST',
        spawnImpl,
        portStart: allocPort(),
        timeoutMs: 50,
        graceMs: 60000
      });
      try {
        let rejection;
        try {
          await flow.promise;
        } catch (error) {
          rejection = error;
        }
        assert.equal(rejection?.code, 'timeout');
        const port = redirectPort(flow.authUrl);
        const page = await httpGet(`http://127.0.0.1:${port}/auth/callback?code=LATE&state=nope`);
        assert.equal(page.status, 410);
        assert.match(page.body, /This sign-in attempt expired/);
        assert.match(page.body, /Nothing was saved/);
        assert.equal(await canListen(port), false);
      } finally {
        await flow.cancel();
      }
    });

    await withConfig(async (dir) => {
      const portStart = allocPort();
      const scriptPath = path.join(dir, 'auth-grace-exit.mjs');
      const authModuleUrl = new URL('../src/runtime/auth/chatgpt-auth.js', import.meta.url).href;
      await writeFile(scriptPath, graceExitScript({ authModuleUrl, portStart }));
      const started = Date.now();
      const child = spawn(process.execPath, [scriptPath], {
        env: {
          ...process.env,
          CHATPCB_CHATGPT_AUTH_TIMEOUT_MS: '50',
          CHATPCB_CHATGPT_AUTH_GRACE_MS: '60000',
          XDG_CONFIG_HOME: dir
        },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      const result = await childClose(child, 4000);
      const elapsed = Date.now() - started;
      const output = `stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`;
      assert.equal(result.timedOut, false, `child still running after ${elapsed}ms (grace is 60000); ${output}`);
      assert.equal(result.code, 0, `exit ${result.code} signal ${result.signal}; ${output}`);
      assert.equal(stdout.trim(), 'RESULT expired', output);
      assert.ok(elapsed < 3000, `child exited in ${elapsed}ms; grace is 60000ms`);
    });
  });

  it('honors auth timeout and grace env overrides, with options winning', async () => {
    await withConfig(async () => {
      const { spawnImpl } = fakeSpawn();
      process.env.CHATPCB_CHATGPT_AUTH_TIMEOUT_MS = '150';
      process.env.CHATPCB_CHATGPT_AUTH_GRACE_MS = '500';
      const fromEnv = createChatGPTAuthManager({
        clientId: 'oaiapp_TEST',
        spawnImpl,
        portStart: allocPort()
      });
      const events = [];
      try {
        const started = await fromEnv.startAuth({}, (_type, payload) => events.push(payload));
        const until = Date.parse(started.expiresAt) - Date.now();
        assert.ok(until > 0 && until <= 250, `env timeout not applied: ${until}`);
        const port = redirectPort(started.authUrl);
        const redirect = new URL(started.authUrl).searchParams.get('redirect_uri');
        await waitFor(() => events.some((event) => event.code === 'timeout'));
        const page = await httpGet(`${redirect}?code=CODE&state=late`);
        assert.equal(page.status, 410);
        assert.match(page.body, /Nothing was saved/);
        assert.equal(await waitForPortFree(port, 2000), true);
        assert.equal((await httpGet(`${redirect}?code=CODE&state=late`)).status, 0);
      } finally {
        await fromEnv.cancelAll();
      }

      process.env.CHATPCB_CHATGPT_AUTH_TIMEOUT_MS = '50';
      process.env.CHATPCB_CHATGPT_AUTH_GRACE_MS = '80';
      const fromOptions = createChatGPTAuthManager({
        clientId: 'oaiapp_TEST',
        spawnImpl,
        portStart: allocPort(),
        timeoutMs: 15 * 60 * 1000,
        graceMs: 800
      });
      try {
        const started = await fromOptions.startAuth();
        const until = Date.parse(started.expiresAt) - Date.now();
        assert.ok(until > 14 * 60 * 1000, `timeoutMs option lost to env: ${until}`);
        await fromOptions.cancelAll();
      } finally {
        await fromOptions.cancelAll();
      }

      const short = createChatGPTAuthManager({
        clientId: 'oaiapp_TEST',
        spawnImpl,
        portStart: allocPort(),
        timeoutMs: 50,
        graceMs: 800
      });
      const shortEvents = [];
      try {
        const started = await short.startAuth({}, (_type, payload) => shortEvents.push(payload));
        const port = redirectPort(started.authUrl);
        const redirect = new URL(started.authUrl).searchParams.get('redirect_uri');
        await waitFor(() => shortEvents.some((event) => event.code === 'timeout'));
        assert.equal((await httpGet(`${redirect}?code=CODE&state=late`)).status, 410);
        await delay(200);
        assert.equal(await canListen(port), false);
        assert.equal((await httpGet(`${redirect}?code=CODE&state=late`)).status, 410);
      } finally {
        await short.cancelAll();
      }
    });
  });

  it('ignores non-positive auth timeout env values and waits 15 minutes', async () => {
    await withConfig(async () => {
      const { spawnImpl } = fakeSpawn();
      try {
        for (const bad of ['0', '-1', '1.5', 'nope', '', '15min']) {
          process.env.CHATPCB_CHATGPT_AUTH_TIMEOUT_MS = bad;
          process.env.CHATPCB_CHATGPT_AUTH_GRACE_MS = bad;
          const manager = createChatGPTAuthManager({
            clientId: 'oaiapp_TEST',
            spawnImpl,
            portStart: allocPort()
          });
          const started = await manager.startAuth();
          const until = Date.parse(started.expiresAt) - Date.now();
          assert.ok(until > 14 * 60 * 1000 && until <= (15 * 60 * 1000) + 1000, `${bad} -> ${until}`);
          await manager.cancelAll();
        }
      } finally {
        delete process.env.CHATPCB_CHATGPT_AUTH_TIMEOUT_MS;
        delete process.env.CHATPCB_CHATGPT_AUTH_GRACE_MS;
      }
    });
  });

  it('closes the grace listener when a new attempt starts, on cancel, and on sign-out', async () => {
    await withConfig(async () => {
      const { spawnImpl } = fakeSpawn();
      const tokenCalls = [];
      stubFetch(async (url) => {
        tokenCalls.push(String(url));
        return new Response('no', { status: 500 });
      });
      const manager = createChatGPTAuthManager({
        clientId: 'oaiapp_TEST',
        spawnImpl,
        portStart: allocPort(),
        timeoutMs: 50
      });
      try {
        const firstEvents = [];
        const first = await manager.startAuth({}, (_type, payload) => firstEvents.push(payload));
        const port1 = redirectPort(first.authUrl);
        const redirect1 = new URL(first.authUrl).searchParams.get('redirect_uri');
        const state1 = new URL(first.authUrl).searchParams.get('state');
        await waitFor(() => firstEvents.some((event) => event.code === 'timeout'));
        assert.equal((await httpGet(`${redirect1}?code=CODE&state=${state1}`)).status, 410);

        const second = await manager.startAuth();
        const port2 = redirectPort(second.authUrl);
        const after = await httpGet(`${redirect1}?code=CODE&state=${state1}`);
        if (port2 === port1) {
          assert.notEqual(after.status, 410);
          assert.match(after.body, /state mismatch/);
        } else {
          assert.equal(after.status, 0);
          assert.equal(await canListen(port1), true);
        }
        assert.equal((await httpGet(`http://127.0.0.1:${port2}/health`)).status, 404);
        assert.equal(tokenCalls.length, 0);
        await manager.cancelAll();

        const cancelEvents = [];
        const cancelled = await manager.startAuth({}, (_type, payload) => cancelEvents.push(payload));
        const cancelPort = redirectPort(cancelled.authUrl);
        const cancelRedirect = new URL(cancelled.authUrl).searchParams.get('redirect_uri');
        await waitFor(() => cancelEvents.some((event) => event.code === 'timeout'));
        assert.equal((await httpGet(`${cancelRedirect}?code=CODE&state=late`)).status, 410);
        assert.equal((await manager.cancelAuth({ attemptId: cancelled.attemptId })).state, 'signed_out');
        assert.equal(await canListen(cancelPort), true);
        assert.equal((await httpGet(`${cancelRedirect}?code=CODE&state=late`)).status, 0);

        const signEvents = [];
        const signed = await manager.startAuth({}, (_type, payload) => signEvents.push(payload));
        const signPort = redirectPort(signed.authUrl);
        const signRedirect = new URL(signed.authUrl).searchParams.get('redirect_uri');
        await waitFor(() => signEvents.some((event) => event.code === 'timeout'));
        assert.equal((await httpGet(`${signRedirect}?code=CODE&state=late`)).status, 410);
        assert.equal((await manager.signOut()).state, 'signed_out');
        assert.equal(await canListen(signPort), true);
        assert.equal((await httpGet(`${signRedirect}?code=CODE&state=late`)).status, 0);
        assert.equal(tokenCalls.length, 0);
        assert.equal(await loadCredentials(), null);
      } finally {
        await manager.cancelAll();
      }
    });
  });

  it('reopen returns the active session URL', async () => {
    const { calls, spawnImpl } = fakeSpawn();
    const manager = createChatGPTAuthManager({
      clientId: 'oaiapp_TEST',
      spawnImpl,
      portStart: allocPort(),
      timeoutMs: 20000
    });
    try {
      const started = await manager.startAuth();
      const reopened = await manager.reopenAuth({ attemptId: started.attemptId });
      assert.equal(reopened.state, 'waiting');
      assert.equal(reopened.authUrl, started.authUrl);
      assert.match(reopened.authUrl, /^https:\/\/auth\.openai\.com\/api\/accounts\/authorize\?/);
      assert.equal(reopened.authUrl.includes('auth.openai.com/api/accounts/authorize?...'), false);
      assert.equal(calls.at(-1).args.at(-1), started.authUrl);
    } finally {
      await manager.cancelAll();
    }
  });

  it('reopen reports a browser-open failure instead of dropping it', async () => {
    let opens = 0;
    const spawnImpl = () => {
      opens += 1;
      if (opens === 1) {
        const handlers = {};
        const proc = {
          on(event, fn) {
            handlers[event] = fn;
            return proc;
          },
          unref() {}
        };
        queueMicrotask(() => handlers.spawn?.());
        return proc;
      }
      if (opens === 2) throw new Error('spawn xdg-open ENOENT');
      return {
        on() {
          throw new Error('browser listener exploded');
        },
        unref() {}
      };
    };
    const manager = createChatGPTAuthManager({
      clientId: 'oaiapp_TEST',
      spawnImpl,
      portStart: allocPort(),
      timeoutMs: 20000
    });
    try {
      const started = await manager.startAuth();
      const returned = await manager.reopenAuth({ attemptId: started.attemptId });
      assert.equal(returned.ok, false);
      assert.equal(returned.error.code, 'open_failed');
      assert.match(returned.error.message, /xdg-open ENOENT/);

      const dispatched = await dispatchToolCall(
        { id: 'reopen-fail', name: 'auth.chatgpt.reopen', args: { attemptId: started.attemptId } },
        { chatgptAuthManager: manager }
      );
      assert.equal(dispatched.ok, false);
      assert.equal(dispatched.error.code, 'open_failed');
      assert.match(dispatched.error.message, /browser listener exploded/);
      assert.equal(dispatched.authUrl, started.authUrl);
    } finally {
      await manager.cancelAll();
    }
  });

  it('a second login closes the first listener', async () => {
    const { spawnImpl } = fakeSpawn();
    const manager = createChatGPTAuthManager({
      clientId: 'oaiapp_TEST',
      spawnImpl,
      portStart: allocPort(),
      timeoutMs: 20000
    });
    const firstEvents = [];
    try {
      const first = await manager.startAuth({}, (_type, payload) => firstEvents.push(payload));
      const second = await manager.startAuth();
      await delay(20);
      assert.equal(firstEvents.some((event) => event.state === 'error'), false);
      assert.notEqual(first.attemptId, second.attemptId);

      const state1 = new URL(first.authUrl).searchParams.get('state');
      const port1 = redirectPort(first.authUrl);
      const tokenCalls = [];
      stubFetch(async (url) => {
        tokenCalls.push(String(url));
        return new Response('no', { status: 404 });
      });
      const oldCallback = await httpGet(`http://127.0.0.1:${port1}/auth/callback?code=CODE&state=${state1}`);
      assert.equal(tokenCalls.length, 0);
      if (oldCallback.status !== 0) {
        assert.match(oldCallback.body, /state mismatch/);
      }
      assert.equal((await httpGet(`http://127.0.0.1:${redirectPort(second.authUrl)}/health`)).status, 404);
      assert.ok((await manager.reopenAuth({ attemptId: first.attemptId })).error);
      assert.equal((await manager.reopenAuth({ attemptId: second.attemptId })).authUrl, second.authUrl);
    } finally {
      await manager.cancelAll();
    }
  });

  it('keeps one auth manager for the daemon lifetime across websocket messages', async () => {
    const { spawnImpl } = fakeSpawn();
    const daemon = await startDaemon({
      port: 0,
      dispatchOptions: {
        chatgptClientId: 'oaiapp_TEST',
        browserSpawnImpl: spawnImpl,
        chatgptPortStart: allocPort(),
        chatgptAuthTimeoutMs: 20000
      }
    });
    const socket = await openDaemonSocket(daemon);
    try {
      const separate = await dispatchToolCall(
        { id: 'no-manager', name: 'auth.chatgpt.reopen', args: { attemptId: 'missing' } },
        {}
      );
      assert.equal(separate.ok, false);
      assert.equal(separate.error.code, 'NO_AUTH_SESSION');

      const started = await socket.call('auth.chatgpt.start', {}, 'ws-start');
      assert.equal(started.ok, true);
      assert.match(started.result.authUrl, /^https:\/\//);
      const reopened = await socket.call('auth.chatgpt.reopen', { attemptId: started.result.attemptId }, 'ws-reopen');
      assert.equal(reopened.ok, true);
      assert.equal(reopened.result.authUrl, started.result.authUrl);
      const cancelled = await socket.call('auth.chatgpt.cancel', { attemptId: started.result.attemptId }, 'ws-cancel');
      assert.equal(cancelled.ok, true);
      assert.equal(cancelled.result.state, 'signed_out');
      assert.equal(await canListen(redirectPort(started.result.authUrl)), true);
    } finally {
      socket.close();
      await daemon.close();
    }
  });

  it('shares one manager across separate dispatch contexts', async () => {
    const { spawnImpl } = fakeSpawn();
    const manager = createChatGPTAuthManager({
      clientId: 'oaiapp_TEST',
      spawnImpl,
      portStart: allocPort(),
      timeoutMs: 20000
    });
    const base = { chatgptAuthManager: manager };
    try {
      const started = await dispatchToolCall({ id: '1', name: 'auth.chatgpt.start', args: {} }, { ...base });
      const reopened = await dispatchToolCall(
        { id: '2', name: 'auth.chatgpt.reopen', args: { attemptId: started.result.attemptId } },
        { ...base }
      );
      assert.equal(started.ok, true);
      assert.equal(reopened.ok, true);
      assert.equal(reopened.result.authUrl, started.result.authUrl);
    } finally {
      await manager.cancelAll();
    }
  });

  it('selects a model from the account catalog and allows an override', async () => {
    await withConfig(async (dir) => {
      await saveCredentials(sampleCreds());
      const seen = [];
      stubFetch(async (url, init) => {
        const target = String(url);
        seen.push({ url: target, body: init?.body ? String(init.body) : '' });
        if (target.includes('/v1/models')) {
          return jsonResponse({
            models: [
              { slug: 'gpt-hidden', visibility: 'hidden' },
              { slug: 'gpt-x', visibility: 'list' },
              { slug: 'gpt-y', visibility: 'list' }
            ]
          });
        }
        if (target.includes('/v1/responses')) return completedStream('Hello');
        return new Response('no', { status: 404 });
      });

      const selected = await callChatGPTResponses({ prompt: 'ESP32 board' });
      assert.equal(selected.model, 'gpt-x');
      assert.equal(selected.text, 'Hello');
      const request = seen.find((call) => call.url.includes('/v1/responses'));
      assert.equal(JSON.parse(request.body).model, 'gpt-x');
      assert.equal(request.body.includes('chatgpt-4o-latest'), false);

      seen.length = 0;
      process.env.CHATPCB_CHATGPT_MODEL = 'gpt-y';
      const fromEnv = await callChatGPTResponses({ prompt: 'ESP32 board' });
      assert.equal(fromEnv.model, 'gpt-y');

      await mkdir(path.join(dir, 'chatpcb'), { recursive: true });
      await writeFile(path.join(dir, 'chatpcb', 'chatgpt.json'), JSON.stringify({ model: 'gpt-y' }));
      delete process.env.CHATPCB_CHATGPT_MODEL;
      const fromFile = await callChatGPTResponses({ prompt: 'ESP32 board' });
      assert.equal(fromFile.model, 'gpt-y');

      process.env.CHATPCB_CHATGPT_MODEL = 'gpt-y';
      const fromArg = await callChatGPTResponses({ prompt: 'ESP32 board', model: 'gpt-x' });
      assert.equal(fromArg.model, 'gpt-x');

      await assert.rejects(
        callChatGPTResponses({ prompt: 'ESP32 board', model: 'gpt-nope' }),
        /gpt-nope/
      );
      assert.equal(seen.some((call) => call.url.includes('/v1/responses') && String(call.body).includes('gpt-nope')), false);
    });
  });

  it('sends Responses input as user messages and omits unsupported fields', async () => {
    const unsupported = [
      'background',
      'conversation',
      'max_output_tokens',
      'max_tool_calls',
      'metadata',
      'moderation',
      'prompt',
      'prompt_cache_retention',
      'safety_identifier',
      'temperature',
      'top_logprobs',
      'top_p',
      'truncation',
      'user',
      'previous_response_id'
    ];
    await withConfig(async () => {
      await saveCredentials(sampleCreds());
      let body;
      stubFetch(async (url, init) => {
        const target = String(url);
        if (target.includes('/v1/models')) return jsonResponse({ models: [{ slug: 'gpt-x', visibility: 'list' }] });
        if (target.includes('/v1/responses')) {
          body = JSON.parse(init.body);
          return completedStream('ok');
        }
        return new Response('no', { status: 404 });
      });
      const result = await callChatGPTResponses({ prompt: 'ESP32 board' });
      assert.equal(result.completed, true);
      assert.equal(Array.isArray(body.input), true);
      assert.equal(body.input.length, 1);
      assert.equal(body.input[0].role, 'user');
      assert.equal(Object.hasOwn(body.input[0], 'type'), false);
      assert.equal(body.input.some((item) => item?.role === 'system'), false);
      assert.match(body.input[0].content, /ESP32 board/);
      assert.equal(body.store, false);
      assert.equal(body.stream, true);
      for (const key of unsupported) {
        assert.equal(Object.hasOwn(body, key), false, key);
      }
    });
  });

  it('includes a masked API error body for model and responses failures', async () => {
    await withConfig(async () => {
      const accessToken = 'test-access-token-DO-NOT-USE-0123456789';
      const jwt = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl';
      await saveCredentials({ ...sampleCreds(), access_token: accessToken });
      const logs = spyConsoleError();
      const apiLogs = () => logs.lines.filter((line) => line.includes('ChatGPT API error'));
      try {
        stubFetch(async (url) => {
          if (String(url).includes('/v1/models')) {
            return jsonResponse({
              error: {
                message: `no models Bearer ${jwt} ${accessToken}`,
                code: 'invalid_request'
              }
            }, 400);
          }
          return new Response('no', { status: 404 });
        });
        await assert.rejects(
          dispatchToolCall({
            id: 'model-400',
            name: 'provider.invoke',
            args: { provider: 'chatgpt', prompt: 'hi' }
          }),
          (err) => {
            assert.match(err.message, /^ChatGPT API error: 400 /);
            assert.match(err.message, /no models/);
            assert.equal(err.message.includes(accessToken), false);
            assert.equal(err.message.includes(jwt), false);
            assert.equal(err.message.includes('eyJ'), false);
            assert.equal(err.code, 'invalid_request');
            assert.equal(err.message.length <= 500, true);
            return true;
          }
        );
        assert.equal(apiLogs().some((line) => line.includes('no models')), true);
        assert.equal(apiLogs().some((line) => line.includes(accessToken) || line.includes('eyJ') || line.includes(jwt)), false);

        logs.lines.length = 0;
        const detail = `Input must be a list ${accessToken} Bearer ${jwt} ${'y'.repeat(700)}`;
        stubFetch(async (url) => {
          if (String(url).includes('/v1/models')) return jsonResponse({ models: [{ slug: 'gpt-x', visibility: 'list' }] });
          if (String(url).includes('/v1/responses')) return jsonResponse({ detail }, 400);
          return new Response('no', { status: 404 });
        });
        await assert.rejects(callChatGPTResponses({ prompt: 'hi' }), (err) => {
          assert.match(err.message, /^ChatGPT API error: 400 Input must be a list/);
          assert.equal(err.message.includes(accessToken), false);
          assert.equal(err.message.includes(jwt), false);
          assert.equal(err.message.includes('eyJ'), false);
          assert.match(err.message, /\[REDACTED\]/);
          assert.equal(err.message.length <= 500, true);
          return true;
        });
        await assert.rejects(
          dispatchToolCall({
            id: 'resp-400',
            name: 'provider.invoke',
            args: { provider: 'chatgpt', prompt: 'hi' }
          }),
          /ChatGPT API error: 400 Input must be a list/
        );
        const logged = apiLogs().join('\n');
        assert.match(logged, /ChatGPT API error: 400 Input must be a list/);
        assert.equal(logged.includes(accessToken), false);
        assert.equal(logged.includes(jwt), false);
        assert.equal(logged.includes('eyJ'), false);
      } finally {
        logs.restore();
      }
    });
  });

  it('masks each secret pattern and leaves normal text unchanged', () => {
    const refresh = 'rt_TESTTOKEN_DO_NOT_USE_0123456789';
    const apiKey = 'sk-TESTKEYDONOTUSE0123456789';
    const projectKey = 'sk-proj-TESTKEYDONOTUSE0123456789';
    const jwt = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl';
    const bearer = `Bearer ${'d'.repeat(24)}`;
    const email = 'jane@example.com';
    const shortEmail = 'j@example.com';
    const json = [
      '{"access_token":"plain-access","refresh_token":"plain-refresh",',
      '"id_token":"plain-id","code":"plain-code",',
      '"code_verifier":"plain verifier !","client_secret":"plain-secret",',
      '"note":"leave-this","code":1}'
    ].join('');
    const form = [
      'grant_type=authorization_code',
      'code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      'code_challenge_method=S256',
      'response_type=code',
      'access_token=form-access',
      'refresh_token=form-refresh',
      'id_token=form-id',
      'code=form-code',
      'code_verifier=form-verifier',
      'client_secret=form-secret',
      'client_id=keep-client'
    ].join('&');
    const formSpaced = 'before access_token=form-access-ws refresh_token=form-refresh-ws\nid_token=form-id-ws code=form-code-ws code_verifier=form-verifier-ws client_secret=form-secret-ws after';
    const single = [
      "{'access_token': 'sq-access', 'refresh_token': 'sq-refresh',",
      "'id_token': 'sq-id', 'code': 'sq-code',",
      "'code_verifier': 'sq verifier !', 'client_secret': 'sq-secret',",
      "'note': 'leave-this', 'code': 1}"
    ].join(' ');
    const session = 'sess-Ab3._~+/=-TESTTOKEN';
    const secrets = [
      refresh, apiKey, projectKey, jwt, bearer.slice('Bearer '.length),
      'plain-access', 'plain-refresh', 'plain-id', 'plain-code', 'plain verifier !', 'plain-secret',
      'form-access', 'form-refresh', 'form-id', 'form-code', 'form-verifier', 'form-secret',
      'form-access-ws', 'form-refresh-ws', 'form-id-ws', 'form-code-ws', 'form-verifier-ws', 'form-secret-ws',
      'sq-access', 'sq-refresh', 'sq-id', 'sq-code', 'sq verifier !', 'sq-secret',
      session, 'jane@example.com'
    ];

    const maskedRefresh = maskSecrets(`token ${refresh} end`);
    assert.equal(maskedRefresh.includes(refresh), false);
    assert.match(maskedRefresh, /token \[REDACTED\] end/);

    const maskedKey = maskSecrets(`key ${apiKey} end`);
    assert.equal(maskedKey.includes(apiKey), false);
    assert.match(maskedKey, /key \[REDACTED\] end/);

    const maskedProjectKey = maskSecrets(`key ${projectKey} end`);
    assert.equal(maskedProjectKey.includes(projectKey), false);
    assert.equal(maskedProjectKey.includes('sk-proj-'), false);
    assert.match(maskedProjectKey, /key \[REDACTED\] end/);

    const maskedJwt = maskSecrets(`jwt ${jwt} end`);
    assert.equal(maskedJwt.includes(jwt), false);
    assert.equal(maskedJwt.includes('eyJ'), false);
    assert.match(maskedJwt, /jwt \[REDACTED\] end/);

    const maskedBearer = maskSecrets(`auth ${bearer} end`);
    assert.equal(maskedBearer.includes(bearer.slice('Bearer '.length)), false);
    assert.match(maskedBearer, /auth Bearer \[REDACTED\] end/);

    assert.equal(maskSecrets(`mail ${email} and ${shortEmail} end`), 'mail j***@example.com and j***@example.com end');

    const maskedJson = maskSecrets(json);
    for (const secret of ['plain-access', 'plain-refresh', 'plain-id', 'plain-code', 'plain verifier !', 'plain-secret']) {
      assert.equal(maskedJson.includes(secret), false, secret);
    }
    assert.match(maskedJson, /"access_token":"\[REDACTED\]"/);
    assert.match(maskedJson, /"refresh_token":"\[REDACTED\]"/);
    assert.match(maskedJson, /"id_token":"\[REDACTED\]"/);
    assert.match(maskedJson, /"code":"\[REDACTED\]"/);
    assert.match(maskedJson, /"code_verifier":"\[REDACTED\]"/);
    assert.match(maskedJson, /"client_secret":"\[REDACTED\]"/);
    assert.match(maskedJson, /"note":"leave-this"/);
    assert.match(maskedJson, /"code":1/);

    const maskedForm = maskSecrets(form);
    for (const secret of ['form-access', 'form-refresh', 'form-id', 'form-code', 'form-verifier', 'form-secret']) {
      assert.equal(maskedForm.includes(secret), false, secret);
    }
    assert.equal(maskedForm, [
      'grant_type=authorization_code',
      'code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      'code_challenge_method=S256',
      'response_type=code',
      'access_token=[REDACTED]',
      'refresh_token=[REDACTED]',
      'id_token=[REDACTED]',
      'code=[REDACTED]',
      'code_verifier=[REDACTED]',
      'client_secret=[REDACTED]',
      'client_id=keep-client'
    ].join('&'));

    const maskedFormSpaced = maskSecrets(formSpaced);
    for (const secret of ['form-access-ws', 'form-refresh-ws', 'form-id-ws', 'form-code-ws', 'form-verifier-ws', 'form-secret-ws']) {
      assert.equal(maskedFormSpaced.includes(secret), false, secret);
    }
    assert.equal(
      maskedFormSpaced,
      'before access_token=[REDACTED] refresh_token=[REDACTED]\nid_token=[REDACTED] code=[REDACTED] code_verifier=[REDACTED] client_secret=[REDACTED] after'
    );

    const maskedSingle = maskSecrets(single);
    for (const secret of ['sq-access', 'sq-refresh', 'sq-id', 'sq-code', 'sq verifier !', 'sq-secret']) {
      assert.equal(maskedSingle.includes(secret), false, secret);
    }
    assert.match(maskedSingle, /'access_token': '\[REDACTED\]'/);
    assert.match(maskedSingle, /'refresh_token': '\[REDACTED\]'/);
    assert.match(maskedSingle, /'id_token': '\[REDACTED\]'/);
    assert.match(maskedSingle, /'code': '\[REDACTED\]'/);
    assert.match(maskedSingle, /'code_verifier': '\[REDACTED\]'/);
    assert.match(maskedSingle, /'client_secret': '\[REDACTED\]'/);
    assert.match(maskedSingle, /'note': 'leave-this'/);
    assert.match(maskedSingle, /'code': 1/);

    assert.equal(maskSecrets(`key ${session} end`), 'key [REDACTED] end');
    assert.equal(maskSecrets('prefix sess-12 suffix'), 'prefix sess-12 suffix');

    const plain = [
      'Route the 3V3 net with a 10k resistor. The code review passed.',
      'See sk-12, rt_ab, Bearer, eyJabc, sess-12, and sketch this board.',
      'code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM response_type=code client_id=oaiapp_TEST',
      'ChatGPT API error: 400 Input must be a list',
      'ChatGPT sign-in waiting on http://127.0.0.1:41318/auth/callback until 2026-10-16T00:00:00.000Z',
      'ChatGPT OpenID discovery failed (403); using fallback endpoints',
      'late ChatGPT callback received after expiry'
    ].join('\n');
    assert.equal(maskSecrets(plain), plain);
    assert.equal(maskSecrets(plain, 'AT'), plain);

    const combined = `${refresh} ${apiKey} ${projectKey} ${jwt} ${bearer} ${email} ${session} ${json} ${form} ${formSpaced} ${single}`;
    const once = maskSecrets(combined, 'test-access-token-DO-NOT-USE-0123456789');
    assert.equal(maskSecrets(once), once);
    for (const secret of secrets) assert.equal(once.includes(secret), false, secret);
  });

  it('leaves the original credential file intact when restore fails mid-write', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'chatpcb-restore-atomic-'));
    const credPath = path.join(dir, 'chatgpt-credentials-oaiapp_TEST.json');
    const original = Buffer.from('{"access_token":"original-secret-value","refresh_token":"rt_original"}\n');
    const previous = Buffer.from('{"access_token":"previous-secret-value","refresh_token":"rt_previous"}\n');
    const realWriteFile = writeFile;
    const temps = [];
    const assertTempPath = (target) => {
      const marker = `${credPath}.${process.pid}.`;
      assert.equal(target.startsWith(marker), true);
      assert.equal(target.endsWith('.tmp'), true);
      assert.match(target.slice(marker.length, -'.tmp'.length), /^[0-9a-f]{12}$/);
      assert.equal(target === credPath, false);
    };
    try {
      await realWriteFile(credPath, original, { mode: 0o600 });
      let injected = false;
      await assert.rejects(
        restoreCredentialBytes(credPath, previous, {
          async writeFile(target, data, options) {
            assertTempPath(target);
            assert.equal(options?.mode, 0o600);
            temps.push(target);
            injected = true;
            await realWriteFile(target, Buffer.from('PARTIAL!'), { mode: 0o600 });
            const error = new Error('injected write failure');
            error.code = 'EIO';
            throw error;
          }
        }),
        (err) => err?.code === 'EIO' && /injected write failure/.test(err.message)
      );
      assert.equal(injected, true);
      assert.equal(await readFile(credPath, 'utf8'), original.toString('utf8'));
      assert.equal((await stat(credPath)).size, original.length);
      assert.equal((await readFile(credPath, 'utf8')).includes('PARTIAL!'), false);
      assert.equal((await readFile(credPath, 'utf8')).includes('previous-secret-value'), false);
      assert.deepEqual(
        (await readdir(dir)).filter((name) => name !== path.basename(credPath)),
        []
      );

      await restoreCredentialBytes(credPath, previous, {
        async writeFile(target, data, options) {
          assertTempPath(target);
          assert.equal(options?.mode, 0o600);
          temps.push(target);
          await realWriteFile(target, data, options);
        }
      });
      assert.equal(temps.length, 2);
      assert.equal(temps[0] === temps[1], false);
      assert.equal(await readFile(credPath, 'utf8'), previous.toString('utf8'));
      if (process.platform !== 'win32') {
        assert.equal((await stat(credPath)).mode & 0o777, 0o600);
      }
      assert.deepEqual(
        (await readdir(dir)).filter((name) => name !== path.basename(credPath)),
        []
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('masks refresh tokens, api keys, emails, and json fields in api errors and daemon logs', async () => {
    await withConfig(async () => {
      const refresh = 'rt_TESTTOKEN_DO_NOT_USE_0123456789';
      const projectKey = 'sk-proj-TESTKEYDONOTUSE0123456789';
      const email = 'jane@example.com';
      await saveCredentials(sampleCreds());
      const logs = spyConsoleError();
      try {
        const detail = `failed ${refresh} ${projectKey} ${email} {"code":"plain-auth-code","client_secret":"plain-secret"}`;
        stubFetch(async (url) => {
          if (String(url).includes('/v1/models')) return jsonResponse({ detail }, 400);
          return new Response('no', { status: 404 });
        });
        await assert.rejects(
          dispatchToolCall({
            id: 'mask-400',
            name: 'provider.invoke',
            args: { provider: 'chatgpt', prompt: 'hi' }
          }),
          (err) => {
            assert.match(err.message, /^ChatGPT API error: 400 /);
            assert.equal(err.message.includes(refresh), false);
            assert.equal(err.message.includes(projectKey), false);
            assert.equal(err.message.includes('sk-proj-'), false);
            assert.equal(err.message.includes('jane@'), false);
            assert.equal(err.message.includes('plain-auth-code'), false);
            assert.equal(err.message.includes('plain-secret'), false);
            assert.match(err.message, /j\*\*\*@example\.com/);
            assert.match(err.message, /\[REDACTED\]/);
            return true;
          }
        );
        const logged = logs.lines.join('\n');
        assert.match(logged, /ChatGPT API error: 400 /);
        assert.equal(logged.includes(refresh), false);
        assert.equal(logged.includes(projectKey), false);
        assert.equal(logged.includes('jane@'), false);
        assert.equal(logged.includes('plain-auth-code'), false);
        assert.equal(logged.includes('plain-secret'), false);
      } finally {
        logs.restore();
      }
    });
  });

  it('throws on response.failed and does not return partial text', async () => {
    await withConfig(async () => {
      await saveCredentials(sampleCreds());
      let leaked = null;
      stubFetch(async (url) => {
        if (String(url).includes('/v1/models')) return jsonResponse({ models: [{ slug: 'gpt-x', visibility: 'list' }] });
        if (String(url).includes('/v1/responses')) {
          return sseResponse([
            'data: {"type":"response.output_text.delta","delta":"Hello "}',
            'data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded","message":"usage limit exceeded"}}}',
            ''
          ].join('\n'));
        }
        return new Response('no', { status: 404 });
      });
      await assert.rejects(
        callChatGPTResponses({
          prompt: 'ESP32 board',
          onChunk: (text) => { leaked = text; }
        }),
        /usage limit/i
      );
      assert.equal(leaked, null);

      await assert.rejects(
        dispatchToolCall({
          id: 'failed-invoke',
          name: 'provider.invoke',
          args: { provider: 'chatgpt', prompt: 'ESP32 board' }
        }),
        /usage limit/i
      );
    });
  });

  it('throws when the stream errors or ends without response.completed', async () => {
    await withConfig(async () => {
      await saveCredentials(sampleCreds());
      stubFetch(async (url) => {
        if (String(url).includes('/v1/models')) return jsonResponse({ models: [{ slug: 'gpt-x', visibility: 'list' }] });
        return sseResponse('data: {"type":"response.output_text.delta","delta":"partial"}\ndata: [DONE]\n');
      });
      await assert.rejects(callChatGPTResponses({ prompt: 'hi' }), /without response\.completed/);

      stubFetch(async (url) => {
        if (String(url).includes('/v1/models')) return jsonResponse({ models: [{ slug: 'gpt-x', visibility: 'list' }] });
        return sseResponse('data: {"type":"error","error":{"code":"server_error","message":"boom"}}\n');
      });
      await assert.rejects(callChatGPTResponses({ prompt: 'hi' }), /boom/);
    });
  });

  it('sends the shared tool prompt and parses allowed and disallowed tool calls', async () => {
    const patchEvents = parseProviderMessage(
      '{"type":"tool.call","payload":{"id":"call_patch","name":"schematic.patch","args":{"prompt":"add a pull-up"}}}',
      ALLOWED_TOOLS
    );
    assert.equal(patchEvents[0].type, 'tool.call');
    assert.equal(patchEvents[0].payload.name, 'schematic.patch');
    assert.throws(
      () => validateProviderToolCall({ id: 'call_bad', name: 'shell.exec', args: {} }, ALLOWED_TOOLS),
      /Unsupported provider tool call: shell\.exec/
    );
    const drcEvents = parseProviderMessage(
      '{"type":"tool.call","payload":{"id":"call_drc","name":"validate.drc","args":{}}}',
      ALLOWED_TOOLS
    );
    assert.equal(drcEvents[0].payload.name, 'validate.drc');

    await withConfig(async () => {
      await saveCredentials(sampleCreds());
      const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-chatgpt-gen-'));
      const seen = [];
      const toolLine = JSON.stringify({
        type: 'tool.call',
        payload: {
          id: 'call_sch',
          name: 'schematic.generate',
          args: { prompt: 'RP2040 board with USB-C power, I2C connector, reset button, and LED.' }
        }
      });
      stubFetch(async (url, init) => {
        const target = String(url);
        seen.push({ url: target, body: init?.body ? String(init.body) : '' });
        if (target.includes('/v1/models')) return jsonResponse({ models: [{ slug: 'gpt-x', visibility: 'list' }] });
        if (target.includes('/v1/responses')) return completedStream(`Drafting the schematic.\n${toolLine}`);
        return new Response('no', { status: 404 });
      });
      try {
        const result = await dispatchToolCall({
          id: 'tool-invoke',
          name: 'provider.invoke',
          args: { provider: 'chatgpt', prompt: 'ESP32 board', projectDir: root }
        });
        const request = JSON.parse(seen.find((call) => call.url.includes('/v1/responses')).body);
        assert.equal(Array.isArray(request.input), true);
        const promptText = request.input.map((item) => (item && typeof item.content === 'string' ? item.content : '')).join('\n');
        assert.match(promptText, /Allowed tool names/);
        assert.match(promptText, /schematic\.generate/);
        assert.match(promptText, /schematic\.patch/);
        assert.match(promptText, /validate\.drc/);
        assert.match(promptText, /ESP32 board/);
        assert.equal(request.model, 'gpt-x');
        assert.equal(result.ok, true);
        const toolEvent = result.result.events.find((event) => event.type === 'tool.call');
        assert.equal(toolEvent.payload.name, 'schematic.generate');
        assert.equal(result.result.toolResults[0].id, 'call_sch');
        assert.equal(result.result.toolResults[0].ok, true);

        stubFetch(async (url) => {
          if (String(url).includes('/v1/models')) return jsonResponse({ models: [{ slug: 'gpt-x', visibility: 'list' }] });
          return completedStream('{"type":"tool.call","payload":{"id":"call_bad","name":"shell.exec","args":{}}}');
        });
        await assert.rejects(
          dispatchToolCall({
            id: 'bad-tool',
            name: 'provider.invoke',
            args: { provider: 'chatgpt', prompt: 'ESP32 board', projectDir: root }
          }),
          /Unsupported provider tool call: shell\.exec/
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });

  it('sends only the shared function tools and executes a streamed schematic.generate call', async () => {
    const argumentsText = JSON.stringify({
      prompt: 'RP2040 board with USB-C power, I2C connector, reset button, and LED.'
    });
    await withChatGPTClient(async ({ root, seen }) => {
      stubFetch(chatGPTFetch(seen, () => functionCallStream({
        name: 'schematic_generate',
        callId: 'call_sch',
        itemId: 'fc_sch',
        argumentsText,
        text: 'Drafting the schematic.\n'
      })));
      const result = await invokeChatGPT(root, 'fn-invoke');
      const request = JSON.parse(seen.find((call) => call.url.includes('/v1/responses')).body);
      assert.equal(request.tool_choice, 'auto');
      assert.deepEqual(
        request.tools.map((tool) => tool.name),
        ALLOWED_TOOLS.map((name) => name.replaceAll('.', '_'))
      );
      for (const tool of request.tools) {
        assert.equal(tool.type, 'function');
        assert.equal(typeof tool.description, 'string');
        assert.ok(tool.description.length > 0);
        assert.equal(tool.parameters.type, 'object');
        assert.equal(tool.parameters.additionalProperties, false);
        assert.ok(Array.isArray(tool.parameters.required));
        assert.equal(tool.strict, true);
        assert.equal(tool.name.includes('.'), false);
      }
      const generate = request.tools.find((tool) => tool.name === 'schematic_generate');
      assert.equal(generate.parameters.properties.prompt.type, 'string');
      assert.ok(generate.parameters.required.includes('prompt'));
      assert.equal(request.tools.some((tool) => /shell|rollback|auth/i.test(tool.name)), false);

      assert.equal(result.ok, true);
      const toolEvents = result.result.events.filter((event) => event.type === 'tool.call');
      assert.equal(toolEvents.length, 1);
      assert.equal(toolEvents[0].payload.name, 'schematic.generate');
      assert.equal(toolEvents[0].payload.id, 'call_sch');
      assert.equal(toolEvents[0].payload.args.prompt, JSON.parse(argumentsText).prompt);
      const delta = result.result.events.find((event) => event.type === 'agent.delta');
      assert.match(delta.payload.text, /Drafting the schematic/);
      assert.equal(delta.payload.text.includes('tool.call'), false);
      assert.equal(result.result.toolResults.length, 1);
      assert.equal(result.result.toolResults[0].id, 'call_sch');
      assert.equal(result.result.toolResults[0].ok, true);
    });
  });

  it('executes a function call carried only by response.completed output', async () => {
    const argumentsText = JSON.stringify({ prompt: 'ESP32 sensor board' });
    await withChatGPTClient(async ({ root }) => {
      stubFetch(chatGPTFetch([], () => completedFunctionCallStream({
        name: 'schematic_generate',
        callId: 'call_done',
        itemId: 'fc_done',
        argumentsText
      })));
      const result = await invokeChatGPT(root, 'fn-completed');
      assert.equal(result.ok, true);
      const toolEvents = result.result.events.filter((event) => event.type === 'tool.call');
      assert.equal(toolEvents.length, 1);
      assert.equal(toolEvents[0].payload.name, 'schematic.generate');
      assert.equal(toolEvents[0].payload.id, 'call_done');
      assert.equal(toolEvents[0].payload.args.prompt, 'ESP32 sensor board');
      assert.equal(result.result.toolResults.length, 1);
      assert.equal(result.result.toolResults[0].ok, true);
    });
  });

  it('rejects a disallowed ChatGPT function call', async () => {
    await withChatGPTClient(async ({ root }) => {
      stubFetch(chatGPTFetch([], () => functionCallStream({
        name: 'shell.exec',
        callId: 'call_bad',
        itemId: 'fc_bad',
        argumentsText: '{}'
      })));
      await assert.rejects(invokeChatGPT(root, 'fn-disallowed'), /Unsupported provider tool call: shell\.exec/);
    });
  });

  it('rejects invalid JSON function call arguments', async () => {
    await withChatGPTClient(async ({ root }) => {
      stubFetch(chatGPTFetch([], () => functionCallStream({
        name: 'schematic_generate',
        callId: 'call_bad_json',
        itemId: 'fc_bad_json',
        argumentsText: '{"prompt":'
      })));
      await assert.rejects(
        invokeChatGPT(root, 'fn-bad-json'),
        /Invalid JSON arguments for ChatGPT tool call "schematic_generate"/
      );
    });
  });

  it('opens Windows URLs with rundll32 and a single argument', async () => {
    const { calls, spawnImpl } = fakeSpawn();
    const url = 'https://auth.openai.com/api/accounts/authorize?client_id=oaiapp_TEST&redirect_uri=http%3A%2F%2F127.0.0.1%3A9%2Fcb&state=abc';
    const opened = await openSystemBrowser(url, { platform: 'win32', spawnImpl });
    assert.equal(opened.success, true);
    assert.equal(calls[0].command, 'rundll32');
    assert.deepEqual(calls[0].args, ['url.dll,FileProtocolHandler', url]);
    assert.equal(calls[0].options.shell, false);
    assert.equal(calls[0].args.includes('/c'), false);
    assert.equal(calls[0].args.includes('start'), false);
    assert.equal(calls[0].command === 'cmd', false);
  });

  it('escapes https auth links and rejects non-https URLs', async () => {
    const { chatgptAuthHref } = loadPanelAuthHref();
    const href = chatgptAuthHref('https://auth.openai.com/a?x=1&y=2&q="><script>');
    assert.match(href, /^https:\/\/auth\.openai\.com\//);
    assert.match(href, /&amp;/);
    assert.equal(href.includes('"'), false);
    assert.equal(href.includes('<'), false);
    assert.equal(href.includes('>'), false);
    assert.equal(chatgptAuthHref('http://auth.openai.com/a'), null);
    assert.equal(chatgptAuthHref('javascript:alert(1)'), null);
    assert.equal(chatgptAuthHref('pending'), null);

    const panel = await readFile(new URL('../apps/panel/panel.js', import.meta.url), 'utf8');
    assert.match(panel, /chatgptAuthHref\(chatgptAuthState\.authUrl\)/);
    assert.equal(panel.includes('href="${chatgptAuthState.authUrl'), false);
    const en = JSON.parse(await readFile(new URL('../apps/panel/locales/en.json', import.meta.url), 'utf8'));
    const ko = JSON.parse(await readFile(new URL('../apps/panel/locales/ko.json', import.meta.url), 'utf8'));
    assert.equal(en['auth.chatgpt.button'], 'Continue with ChatGPT');
    assert.equal(ko['auth.chatgpt.button'], 'Continue with ChatGPT');
    assert.equal(en['auth.chatgpt.waiting.reopen'], 'Open sign-in page again');
    assert.equal(ko['auth.chatgpt.waiting.reopen'], '로그인 페이지 다시 열기');
    assert.equal(en['auth.chatgpt.opens-browser'], '(opens in your browser)');
    assert.equal(ko['auth.chatgpt.opens-browser'], '(브라우저에서 열림)');
    assert.equal(panel.includes('LOGO?'), false);
  });

  it('selects the most recently used account, then email', async () => {
    await withConfig(async (dir) => {
      const configDir = path.join(dir, 'chatpcb');
      await mkdir(configDir, { recursive: true });
      await writeCred(configDir, {
        client_id: 'zoe-old',
        access_token: 'a',
        account: { email: 'Zoe@ex.com' },
        last_used_at: 10,
        issued_at: 10
      });
      await writeCred(configDir, {
        client_id: 'amy-new',
        access_token: 'b',
        account: { email: 'amy@ex.com' },
        last_used_at: 50,
        issued_at: 1
      });
      await writeFile(path.join(configDir, 'chatgpt-credentials-sneak.json.tmp'), JSON.stringify({
        client_id: 'sneak',
        access_token: 'x',
        account: { email: 'a@ex.com' },
        last_used_at: 99999
      }));
      assert.equal((await loadCredentials()).client_id, 'amy-new');

      await writeCred(configDir, {
        client_id: 'zoe-tie',
        access_token: 'c',
        account: { email: 'zoe@ex.com' },
        last_used_at: 50,
        issued_at: 50
      });
      await writeCred(configDir, {
        client_id: 'amy-tie',
        access_token: 'd',
        account: { email: 'amy@ex.com' },
        last_used_at: 50,
        issued_at: 1
      });
      assert.equal((await loadCredentials()).account.email, 'amy@ex.com');

      await writeFile(path.join(configDir, 'chatgpt-credentials-issued-early.json'), JSON.stringify({
        client_id: 'issued-early',
        access_token: 'e',
        account: { email: 'early@ex.com' },
        issued_at: 5
      }));
      await writeFile(path.join(configDir, 'chatgpt-credentials-issued-late.json'), JSON.stringify({
        client_id: 'issued-late',
        access_token: 'f',
        account: { email: 'late@ex.com' },
        issued_at: 9
      }));
      for (const name of ['chatgpt-credentials-zoe-old.json', 'chatgpt-credentials-amy-new.json', 'chatgpt-credentials-zoe-tie.json', 'chatgpt-credentials-amy-tie.json']) {
        await rm(path.join(configDir, name), { force: true });
      }
      assert.equal((await loadCredentials()).client_id, 'issued-late');
    });
  });

  it('does not save credentials when sign-out wins an in-flight token exchange', async () => {
    await withDelayedTokenExchange(async ({ manager, gate }) => {
      const signingOut = manager.signOut();
      gate.resolve();
      assert.equal((await signingOut).state, 'signed_out');
    });
  });

  it('does not save credentials when cancel wins an in-flight token exchange', async () => {
    await withDelayedTokenExchange(async ({ manager, gate, started }) => {
      const cancelling = manager.cancelAuth({ attemptId: started.attemptId });
      gate.resolve();
      assert.equal((await cancelling).state, 'signed_out');
      assert.ok((await manager.reopenAuth({ attemptId: started.attemptId })).error);
    });
  });

  it('keeps the login open when an error callback has no state or the wrong state', async () => {
    await withConfig(async () => {
      const { spawnImpl } = fakeSpawn();
      const manager = createChatGPTAuthManager({
        clientId: 'oaiapp_TEST',
        spawnImpl,
        portStart: allocPort(),
        timeoutMs: 20000
      });
      const nonceRef = { nonce: null };
      const tokenCalls = [];
      stubFetch(tokenHandler({ tokenCalls, nonceRef, aud: 'oaiapp_TEST' }));
      try {
        const started = await manager.startAuth();
        const authUrl = new URL(started.authUrl);
        nonceRef.nonce = authUrl.searchParams.get('nonce');
        const redirect = authUrl.searchParams.get('redirect_uri');
        const state = authUrl.searchParams.get('state');

        const missing = await httpGet(`${redirect}?error=access_denied`);
        assert.equal(missing.status, 400);
        assert.match(missing.body, /state mismatch/);
        assert.equal((await manager.reopenAuth({ attemptId: started.attemptId })).authUrl, started.authUrl);

        const wrong = await httpGet(`${redirect}?error=access_denied&state=not-the-state&code=SHOULD_NOT_EXCHANGE`);
        assert.equal(wrong.status, 400);
        assert.match(wrong.body, /state mismatch/);
        assert.equal(tokenCalls.length, 0);
        assert.equal((await manager.reopenAuth({ attemptId: started.attemptId })).state, 'waiting');

        const page = await httpGet(`${redirect}?code=CODE&state=${state}`);
        assert.match(page.body, /Successfully signed in/);
        assert.equal((await loadCredentials()).client_id, 'oaiapp_TEST');
      } finally {
        await manager.cancelAll();
      }
    });
  });

  it('reuses the base callback port and stays inside the fallback range', async () => {
    await withConfig(async () => {
      const { spawnImpl } = fakeSpawn();
      const portStart = allocPort();
      const portAttempts = 3;
      const manager = createChatGPTAuthManager({
        clientId: 'oaiapp_TEST',
        spawnImpl,
        portStart,
        portAttempts,
        timeoutMs: 20000
      });
      const blocker = net.createServer();
      const ports = [];
      try {
        for (let i = 0; i < 4; i += 1) {
          const started = await manager.startAuth();
          const port = redirectPort(started.authUrl);
          ports.push(port);
          assert.ok(port >= portStart && port < portStart + portAttempts);
          const cancelled = await manager.cancelAuth({ attemptId: started.attemptId });
          assert.equal(cancelled.state, 'signed_out');
          assert.equal(await canListen(port), true);
        }
        assert.deepEqual(ports, [portStart, portStart, portStart, portStart]);

        await new Promise((resolve, reject) => {
          blocker.once('error', reject);
          blocker.listen(portStart, '127.0.0.1', resolve);
        });
        const bumped = await manager.startAuth();
        const bumpedPort = redirectPort(bumped.authUrl);
        assert.equal(bumpedPort, portStart + 1);
        assert.ok(bumpedPort < portStart + portAttempts);
        await manager.cancelAuth({ attemptId: bumped.attemptId });
        await closeServer(blocker);

        const reused = await manager.startAuth();
        assert.equal(redirectPort(reused.authUrl), portStart);
        await manager.cancelAuth({ attemptId: reused.attemptId });
      } finally {
        await closeServer(blocker);
        await manager.cancelAll();
      }
    });
  });

  it('uses callback ports 41318-41320 by default', async () => {
    await withConfig(async () => {
      const { spawnImpl } = fakeSpawn();
      const flow = startAuthFlow({
        clientId: 'oaiapp_TEST',
        spawnImpl,
        timeoutMs: 20000
      });
      try {
        const authUrl = await flow.whenReady;
        const port = redirectPort(authUrl);
        assert.ok(port >= 41318 && port <= 41320, `callback port ${port} is outside 41318-41320`);
        await flow.cancel();
        const again = startAuthFlow({
          clientId: 'oaiapp_TEST',
          spawnImpl,
          timeoutMs: 20000
        });
        try {
          const second = redirectPort(await again.whenReady);
          assert.ok(second >= 41318 && second <= 41320);
          assert.equal(second, port);
        } finally {
          await again.cancel();
        }
      } finally {
        await flow.cancel();
      }
    });
  });

  it('rejects a hanging JWKS fetch and token exchange with a timeout', { timeout: 5000 }, async () => {
    clearJwksCache();
    stubFetch(() => new Promise(() => {}));
    await assert.rejects(
      verifyIdToken(signToken(claims()), 'nonce-1', 'oaiapp_TEST', { fetchTimeoutMs: 40 }),
      /JWKS fetch timed out/
    );

    await withConfig(async () => {
      const { spawnImpl } = fakeSpawn();
      const flow = startAuthFlow({
        clientId: 'oaiapp_TEST',
        spawnImpl,
        portStart: allocPort(),
        timeoutMs: 20000,
        fetchTimeoutMs: 40
      });
      stubFetch((url) => {
        const target = String(url);
        if (target.includes('/oauth/token') || target.includes('jwks')) return new Promise(() => {});
        return new Response('no', { status: 404 });
      });
      try {
        const authUrl = new URL(await flow.whenReady);
        const failurePromise = flow.promise.then(() => null, (error) => error);
        const page = await httpGet(
          `${authUrl.searchParams.get('redirect_uri')}?code=CODE&state=${authUrl.searchParams.get('state')}`
        );
        const failure = await failurePromise;
        assert.match(page.body, /timed out/i);
        assert.match(failure.message, /Token exchange timed out/);
        assert.equal(failure.code, 'timeout');
      } finally {
        await flow.cancel();
      }
    });
  });

  it('caches JWKS by issuer and refetches once for an unknown kid', async () => {
    clearJwksCache();
    let fetches = 0;
    stubFetch(async (url) => {
      assert.match(String(url), /jwks\.json/);
      fetches += 1;
      return jsonResponse({ keys: [jwk] });
    });
    const token = signToken(claims());
    const t0 = 1_700_000_000_000;
    await verifyIdToken(token, 'nonce-1', 'oaiapp_TEST', { now: t0, jwksTtlMs: 1000 });
    await verifyIdToken(token, 'nonce-1', 'oaiapp_TEST', { now: t0 + 500, jwksTtlMs: 1000 });
    assert.equal(fetches, 1);

    await verifyIdToken(token, 'nonce-1', 'oaiapp_TEST', { now: t0 + 1000, jwksTtlMs: 1000 });
    assert.equal(fetches, 2);

    fetches = 0;
    clearJwksCache();
    await verifyIdToken(token, 'nonce-1', 'oaiapp_TEST', { now: t0, jwksTtlMs: 60_000 });
    assert.equal(fetches, 1);
    await assert.rejects(
      verifyIdToken(
        signToken(claims(), { alg: 'RS256', typ: 'JWT', kid: 'rotated-kid' }),
        'nonce-1',
        'oaiapp_TEST',
        { now: t0 + 10, jwksTtlMs: 60_000 }
      ),
      /Unknown ID token kid/
    );
    assert.equal(fetches, 2);
  });

  it('accepts aud as a string or array and checks azp against the issued client id', async () => {
    clearJwksCache();
    stubFetch(async () => jsonResponse({ keys: [jwk] }));
    const single = await verifyIdToken(
      signToken(claims({ aud: ['oaiapp_TEST'] })),
      'nonce-1',
      'oaiapp_TEST'
    );
    assert.equal(single.sub, 'user_123');

    const multiple = await verifyIdToken(
      signToken(claims({ aud: ['https://api.openai.com', 'oaiapp_TEST'], azp: 'oaiapp_TEST' })),
      'nonce-1',
      'oaiapp_TEST'
    );
    assert.equal(multiple.azp, 'oaiapp_TEST');

    const withAzp = await verifyIdToken(
      signToken(claims({ aud: 'oaiapp_TEST', azp: 'oaiapp_TEST' })),
      'nonce-1',
      'oaiapp_TEST'
    );
    assert.equal(withAzp.azp, 'oaiapp_TEST');

    await assert.rejects(
      verifyIdToken(
        signToken(claims({ aud: ['https://api.openai.com', 'oaiapp_TEST'] })),
        'nonce-1',
        'oaiapp_TEST'
      ),
      /azp/i
    );
    await assert.rejects(
      verifyIdToken(
        signToken(claims({ aud: ['oaiapp_TEST', 'https://api.openai.com'], azp: 'other-client' })),
        'nonce-1',
        'oaiapp_TEST'
      ),
      /azp/i
    );
    await assert.rejects(
      verifyIdToken(signToken(claims({ aud: 'oaiapp_TEST', azp: 'other-client' })), 'nonce-1', 'oaiapp_TEST'),
      /azp/i
    );
    await assert.rejects(
      verifyIdToken(signToken(claims({ aud: ['other-client', 'https://api.openai.com'] })), 'nonce-1', 'oaiapp_TEST'),
      /audience/i
    );
  });

  it('matches the required scope as an exact token, not a substring', async () => {
    await withConfig(async () => {
      const { spawnImpl } = fakeSpawn();
      const manager = createChatGPTAuthManager({
        clientId: 'oaiapp_TEST',
        spawnImpl,
        portStart: allocPort(),
        timeoutMs: 20000
      });
      const nonceRef = { nonce: null };
      const tokenCalls = [];
      stubFetch(tokenHandler({
        tokenCalls,
        nonceRef,
        aud: 'oaiapp_TEST',
        scope: 'openid chatgpt.tokens.use.director profile'
      }));
      try {
        const started = await manager.startAuth();
        const authUrl = new URL(started.authUrl);
        nonceRef.nonce = authUrl.searchParams.get('nonce');
        const rejected = await httpGet(
          `${authUrl.searchParams.get('redirect_uri')}?code=CODE&state=${authUrl.searchParams.get('state')}`
        );
        assert.match(rejected.body, /chatgpt\.tokens\.use\.direct/);
        assert.equal(await loadCredentials(), null);

        stubFetch(tokenHandler({
          tokenCalls,
          nonceRef,
          aud: 'oaiapp_TEST',
          scope: 'openid chatgpt.tokens.use.director chatgpt.tokens.use.direct profile'
        }));
        const again = await manager.startAuth();
        const againUrl = new URL(again.authUrl);
        nonceRef.nonce = againUrl.searchParams.get('nonce');
        const page = await httpGet(
          `${againUrl.searchParams.get('redirect_uri')}?code=CODE&state=${againUrl.searchParams.get('state')}`
        );
        assert.match(page.body, /Successfully signed in/);
        assert.ok((await loadCredentials()).scopes.includes('chatgpt.tokens.use.direct'));
      } finally {
        await manager.cancelAll();
      }
    });
  });

  it('reports token exchange and refresh failures with status and error code only', async () => {
    const secret = 'raw-body-token-9f3c1a7e';
    stubFetch(async () => new Response(JSON.stringify({
      error: 'invalid_grant',
      error_description: secret,
      access_token: secret,
      refresh_token: secret
    }), { status: 400, headers: { 'content-type': 'application/json' } }));
    await assert.rejects(refreshAccessToken('RT', 'oaiapp_TEST'), (err) => {
      assert.match(err.message, /Token refresh failed: 400 invalid_grant/);
      assert.equal(err.message.includes(secret), false);
      return true;
    });

    stubFetch(async () => new Response(`access_token=${secret}&refresh_token=${secret}`, { status: 401 }));
    await assert.rejects(refreshAccessToken('RT', 'oaiapp_TEST'), (err) => {
      assert.match(err.message, /^Token refresh failed: 401$/);
      assert.equal(err.message.includes(secret), false);
      return true;
    });

    await withConfig(async () => {
      const { spawnImpl } = fakeSpawn();
      const manager = createChatGPTAuthManager({
        clientId: 'oaiapp_TEST',
        spawnImpl,
        portStart: allocPort(),
        timeoutMs: 20000
      });
      stubFetch(async (url) => {
        if (String(url).includes('/oauth/token')) {
          return new Response(
            `error=invalid_grant&error_description=${secret}&access_token=${secret}`,
            { status: 400 }
          );
        }
        return new Response('no', { status: 404 });
      });
      try {
        const started = await manager.startAuth();
        const authUrl = new URL(started.authUrl);
        const page = await httpGet(
          `${authUrl.searchParams.get('redirect_uri')}?code=CODE&state=${authUrl.searchParams.get('state')}`
        );
        assert.match(page.body, /400/);
        assert.match(page.body, /invalid_grant/);
        assert.equal(page.body.includes(secret), false);
        assert.equal(await loadCredentials(), null);
      } finally {
        await manager.cancelAll();
      }
    });
  });

  it('does not restore credentials when sign-out finishes during a Responses call', async () => {
    await withConfig(async (dir) => {
      await saveCredentials(sampleCreds());
      const { spawnImpl } = fakeSpawn();
      const manager = createChatGPTAuthManager({ spawnImpl, portStart: allocPort(), timeoutMs: 20000 });
      const gate = deferred();
      let responsesStarted = false;
      stubFetch(async (url) => {
        const target = String(url);
        if (target.includes('/v1/models')) return jsonResponse({ models: [{ slug: 'gpt-x', visibility: 'list' }] });
        if (target.includes('/v1/responses')) {
          responsesStarted = true;
          await gate.promise;
          return completedStream('hi');
        }
        return new Response('no', { status: 404 });
      });
      const call = callChatGPTResponses({ prompt: 'x' });
      try {
        await waitFor(() => responsesStarted);
        assert.equal((await manager.signOut()).state, 'signed_out');
        gate.resolve();
        const result = await call;
        assert.equal(result.completed, true);
        assert.equal(result.text, 'hi');
        const retained = JSON.parse(await readFile(path.join(dir, 'chatpcb', 'chatgpt-credentials-oaiapp_TEST.json'), 'utf8'));
        assert.equal(retained.client_id, 'oaiapp_TEST');
        assert.equal(typeof retained.last_used_at, 'number');
        assert.deepEqual(Object.keys(retained).sort(), ['client_id', 'last_used_at']);
        assert.equal(JSON.stringify(retained).includes('ada@ex.com'), false);
        assertSessionCleared(retained);
        assert.equal(await loadCredentials(), null);
        assert.equal((await manager.getAuthStatus()).state, 'signed_out');
      } finally {
        gate.resolve();
        await manager.cancelAll();
      }
    });
  });

  it('does not restore credentials when sign-out finishes during token refresh', async () => {
    await withConfig(async (dir) => {
      await saveCredentials(expiredCreds());
      const { spawnImpl } = fakeSpawn();
      const manager = createChatGPTAuthManager({ spawnImpl, portStart: allocPort(), timeoutMs: 20000 });
      const gate = deferred();
      let refreshStarted = false;
      stubFetch(async (url) => {
        const target = String(url);
        if (target.includes('/oauth/token')) {
          refreshStarted = true;
          await gate.promise;
          return jsonResponse({ access_token: 'AT_NEW', refresh_token: 'RT_NEW', expires_in: 3600 });
        }
        if (target.includes('/v1/models')) return jsonResponse({ models: [{ slug: 'gpt-x', visibility: 'list' }] });
        if (target.includes('/v1/responses')) return completedStream('hi');
        return new Response('no', { status: 404 });
      });
      const call = callChatGPTResponses({ prompt: 'x' });
      try {
        await waitFor(() => refreshStarted);
        assert.equal((await manager.signOut()).state, 'signed_out');
        gate.resolve();
        const result = await call;
        assert.equal(result.completed, true);
        const retained = JSON.parse(await readFile(path.join(dir, 'chatpcb', 'chatgpt-credentials-oaiapp_TEST.json'), 'utf8'));
        assert.equal(retained.client_id, 'oaiapp_TEST');
        assert.equal(retained.access_token === 'AT_NEW', false);
        assert.equal(retained.refresh_token === 'RT_NEW', false);
        assert.equal(typeof retained.last_used_at, 'number');
        assert.deepEqual(Object.keys(retained).sort(), ['client_id', 'last_used_at']);
        assert.equal(JSON.stringify(retained).includes('ada@ex.com'), false);
        assertSessionCleared(retained);
        assert.equal((await manager.getAuthStatus()).state, 'signed_out');
        assert.equal(await loadCredentials(), null);
      } finally {
        gate.resolve();
        await manager.cancelAll();
      }
    });
  });

  it('drops the issued client id when refresh returns invalid_client and registers again', async () => {
    await withConfig(async (dir) => {
      await saveCredentials({
        ...sampleCreds(),
        client_id: 'oaiapp_OTHER',
        access_token: 'AT_OTHER',
        refresh_token: 'RT_OTHER',
        account: { email: 'other@ex.com' },
        last_used_at: 1
      });
      await saveCredentials(expiredCreds());
      stubFetch(async (url) => {
        const target = String(url);
        if (target.includes('/oauth/token')) {
          return new Response(JSON.stringify({ error: 'invalid_client', error_description: 'revoked-secret' }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }
        if (target.includes('/v1/models')) return jsonResponse({ models: [{ slug: 'gpt-x', visibility: 'list' }] });
        if (target.includes('/v1/responses')) return completedStream('hi');
        return new Response('no', { status: 404 });
      });
      const result = await callChatGPTResponses({ prompt: 'hi' });
      assert.equal(result.completed, true);
      assert.equal((await loadCredentials()).client_id, 'oaiapp_OTHER');
      const other = JSON.parse(await readFile(path.join(dir, 'chatpcb', 'chatgpt-credentials-oaiapp_OTHER.json'), 'utf8'));
      assert.equal(other.access_token, 'AT_OTHER');
      assert.equal(other.refresh_token, 'RT_OTHER');
      assert.equal((await listCredentialFiles(dir)).includes('chatgpt-credentials-oaiapp_TEST.json'), false);

      stubFetch(async () => new Response(JSON.stringify({ error: 'invalid_client' }), {
        status: 401,
        headers: { 'content-type': 'application/json' }
      }));
      await assert.rejects(refreshAccessToken('RT_OTHER', 'oaiapp_OTHER'), (err) => {
        assert.equal(err.code, 'invalid_client');
        assert.match(err.message, /Token refresh failed: 401 invalid_client/);
        assert.equal(err.message.includes('revoked-secret'), false);
        return true;
      });
      assert.deepEqual(await listCredentialFiles(dir), []);
      assert.equal(await loadCredentials(), null);

      const { spawnImpl } = fakeSpawn();
      const manager = createChatGPTAuthManager({ spawnImpl, portStart: allocPort(), timeoutMs: 20000 });
      try {
        const started = await manager.startAuth();
        const authUrl = new URL(started.authUrl);
        assert.equal(authUrl.searchParams.get('client_id'), 'dynamic_agent_client');
        assert.equal(authUrl.searchParams.get('agent_name_hint'), 'OH-MY-ChatPCB');
      } finally {
        await manager.cancelAll();
      }
    });
  });

  it('drops the issued client id when the authorize callback returns invalid_client and registers again', async () => {
    await withConfig(async (dir) => {
      await saveCredentials(sampleCreds());
      const { spawnImpl } = fakeSpawn();
      const manager = createChatGPTAuthManager({ spawnImpl, portStart: allocPort(), timeoutMs: 20000 });
      const tokenCalls = [];
      stubFetch(async (url) => {
        tokenCalls.push(String(url));
        return new Response('no', { status: 404 });
      });
      try {
        const started = await manager.startAuth();
        const authUrl = new URL(started.authUrl);
        assert.equal(authUrl.searchParams.get('client_id'), 'oaiapp_TEST');
        assert.equal(authUrl.searchParams.has('agent_name_hint'), false);
        const redirect = authUrl.searchParams.get('redirect_uri');
        const state = authUrl.searchParams.get('state');

        const wrongState = await httpGet(`${redirect}?error=invalid_client&state=not-the-state`);
        assert.match(wrongState.body, /state mismatch/);
        assert.equal((await loadCredentials()).client_id, 'oaiapp_TEST');
        assert.equal(tokenCalls.length, 0);

        const page = await httpGet(`${redirect}?error=invalid_client&state=${state}&code=SHOULD_NOT_EXCHANGE`);
        assert.match(page.body, /sign in again/i);
        assert.equal(/cancelled/i.test(page.body), false);
        assert.equal(tokenCalls.length, 0);
        assert.deepEqual(await listCredentialFiles(dir), []);
        assert.equal(await loadCredentials(), null);

        const again = await manager.startAuth();
        const againUrl = new URL(again.authUrl);
        assert.equal(againUrl.searchParams.get('client_id'), 'dynamic_agent_client');
        assert.equal(againUrl.searchParams.get('agent_name_hint'), 'OH-MY-ChatPCB');
      } finally {
        await manager.cancelAll();
      }
    });
  });

  it('drops the issued client id when the token endpoint returns invalid_client and registers again', async () => {
    await withConfig(async (dir) => {
      await saveCredentials(sampleCreds());
      const { spawnImpl } = fakeSpawn();
      const manager = createChatGPTAuthManager({ spawnImpl, portStart: allocPort(), timeoutMs: 20000 });
      stubFetch(async (url) => {
        if (String(url).includes('/oauth/token')) {
          return new Response(JSON.stringify({ error: 'invalid_client' }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }
        return new Response('no', { status: 404 });
      });
      try {
        const started = await manager.startAuth();
        const authUrl = new URL(started.authUrl);
        assert.equal(authUrl.searchParams.get('client_id'), 'oaiapp_TEST');
        assert.equal(authUrl.searchParams.has('agent_name_hint'), false);
        const page = await httpGet(
          `${authUrl.searchParams.get('redirect_uri')}?code=CODE&state=${authUrl.searchParams.get('state')}`
        );
        assert.match(page.body, /invalid_client/);
        assert.deepEqual(await listCredentialFiles(dir), []);
        assert.equal(await loadCredentials(), null);

        const again = await manager.startAuth();
        const againUrl = new URL(again.authUrl);
        assert.equal(againUrl.searchParams.get('client_id'), 'dynamic_agent_client');
        assert.equal(againUrl.searchParams.get('agent_name_hint'), 'OH-MY-ChatPCB');
      } finally {
        await manager.cancelAll();
      }
    });
  });

  it('times out a hanging Responses request at the configured limit', { timeout: 5000 }, async () => {
    await withConfig(async (dir) => {
      assert.equal((await resolveChatGPTSettings()).responsesTimeoutMs, 120_000);
      await mkdir(path.join(dir, 'chatpcb'), { recursive: true });
      await writeFile(path.join(dir, 'chatpcb', 'chatgpt.json'), JSON.stringify({ responsesTimeoutMs: 80 }));
      assert.equal((await resolveChatGPTSettings()).responsesTimeoutMs, 80);
      process.env.CHATPCB_CHATGPT_RESPONSES_TIMEOUT_MS = '40';
      assert.equal((await resolveChatGPTSettings()).responsesTimeoutMs, 40);
      assert.equal((await resolveChatGPTSettings({ responsesTimeoutMs: 25 })).responsesTimeoutMs, 25);

      await saveCredentials(sampleCreds());
      stubFetch((url) => {
        if (String(url).includes('/v1/models')) return jsonResponse({ models: [{ slug: 'gpt-x', visibility: 'list' }] });
        return new Promise(() => {});
      });
      const started = Date.now();
      await assert.rejects(callChatGPTResponses({ prompt: 'hi', timeoutMs: 50 }), (err) => {
        assert.equal(err.code, 'timeout');
        assert.match(err.message, /ChatGPT responses timed out after 50ms/);
        return true;
      });
      assert.ok(Date.now() - started < 4000);
      const saved = await loadCredentials();
      assert.equal(saved.access_token, 'AT');
      assert.equal(saved.refresh_token, 'RT');
    });
  });

  it('shares one in-flight token refresh across concurrent callers', async () => {
    let calls = 0;
    const gate = deferred();
    stubFetch(async () => {
      calls += 1;
      await gate.promise;
      return jsonResponse({ access_token: 'AT_NEW', refresh_token: 'RT_NEW', expires_in: 3600 });
    });
    try {
      const first = refreshAccessToken('RT', 'oaiapp_TEST');
      const second = refreshAccessToken('RT', 'oaiapp_TEST');
      const otherToken = refreshAccessToken('RT_OTHER', 'oaiapp_TEST');
      assert.equal(calls, 2);
      gate.resolve();
      const [a, b, c] = await Promise.all([first, second, otherToken]);
      assert.equal(a, b);
      assert.equal(a.access_token, 'AT_NEW');
      assert.equal(a.refresh_token, 'RT_NEW');
      assert.notEqual(c, a);
      assert.equal(calls, 2);

      await refreshAccessToken('RT', 'oaiapp_TEST');
      assert.equal(calls, 3);
    } finally {
      gate.resolve();
    }
  });

  it('shares one refresh when concurrent provider calls use the same refresh token', async () => {
    await withConfig(async (dir) => {
      await saveCredentials(expiredCreds());
      let refreshCalls = 0;
      const gate = deferred();
      stubFetch(async (url) => {
        const target = String(url);
        if (target.includes('/oauth/token')) {
          refreshCalls += 1;
          await gate.promise;
          return jsonResponse({ access_token: 'AT_NEW', refresh_token: 'RT_NEW', expires_in: 3600 });
        }
        if (target.includes('/v1/models')) return jsonResponse({ models: [{ slug: 'gpt-x', visibility: 'list' }] });
        if (target.includes('/v1/responses')) return completedStream('ok');
        return new Response('no', { status: 404 });
      });
      const first = callChatGPTResponses({ prompt: 'a' });
      try {
        await waitFor(() => refreshCalls >= 1);
        const second = callChatGPTResponses({ prompt: 'b' });
        await delay(50);
        assert.equal(refreshCalls, 1);
        gate.resolve();
        const [a, b] = await Promise.all([first, second]);
        assert.equal(a.completed, true);
        assert.equal(b.completed, true);
        assert.equal(refreshCalls, 1);
        const saved = await loadCredentials();
        assert.equal(saved.access_token, 'AT_NEW');
        assert.equal(saved.refresh_token, 'RT_NEW');
        assert.equal((await listCredentialFiles(dir)).length, 1);
      } finally {
        gate.resolve();
      }
    });
  });

  it('pins fallback OpenID endpoints to the published discovery document', () => {
    assert.deepEqual(
      {
        issuer: ISSUER,
        authorizationEndpoint: AUTH_ENDPOINT,
        tokenEndpoint: TOKEN_ENDPOINT,
        jwksUri: JWKS_ENDPOINT
      },
      {
        issuer: 'https://auth.openai.com',
        authorizationEndpoint: 'https://auth.openai.com/api/accounts/authorize',
        tokenEndpoint: 'https://auth.openai.com/api/accounts/oauth/token',
        jwksUri: 'https://auth.openai.com/.well-known/jwks.json'
      }
    );
  });

  it('uses discovered authorize, token, refresh, and JWKS endpoints', async () => {
    clearOidcDiscoveryCache();
    clearJwksCache();
    const doc = openIdDocument({
      authorization_endpoint: 'https://auth.openai.com/discovered/authorize',
      token_endpoint: 'https://auth.openai.com/discovered/oauth/token',
      jwks_uri: 'https://auth.openai.com/discovered/jwks.json'
    });
    const calls = [];
    const nonceRef = { nonce: null };
    stubFetch(async (url, init) => {
      const target = String(url);
      calls.push({
        url: target,
        method: init?.method || 'GET',
        body: init?.body ? String(init.body) : ''
      });
      if (target === OPENID_CONFIGURATION_URL) return jsonResponse(doc);
      if (target === doc.jwks_uri) return jsonResponse({ keys: [jwk] });
      if (target === doc.token_endpoint) {
        if (String(init?.body || '').includes('grant_type=refresh_token')) {
          return jsonResponse({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 });
        }
        return jsonResponse({
          access_token: 'AT',
          refresh_token: 'RT',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: PLAN_SCOPE,
          id_token: signToken(claims({
            nonce: nonceRef.nonce,
            aud: 'oaiapp_TEST',
            email: 'ada@ex.com'
          }))
        });
      }
      return new Response('no', { status: 404 });
    });

    await withConfig(async () => {
      const { spawnImpl } = fakeSpawn();
      const manager = createChatGPTAuthManager({
        clientId: 'oaiapp_TEST',
        spawnImpl,
        portStart: allocPort(),
        timeoutMs: 20000
      });
      try {
        const started = await manager.startAuth();
        assert.equal(started.authUrl.startsWith(`${doc.authorization_endpoint}?`), true);
        const authUrl = new URL(started.authUrl);
        nonceRef.nonce = authUrl.searchParams.get('nonce');
        const page = await httpGet(
          `${authUrl.searchParams.get('redirect_uri')}?code=CODE&state=${authUrl.searchParams.get('state')}`
        );
        assert.match(page.body, /Successfully signed in/);
        const refreshed = await refreshAccessToken('RT', 'oaiapp_TEST');
        assert.equal(refreshed.access_token, 'AT2');
      } finally {
        await manager.cancelAll();
      }
    });

    assert.equal(calls.filter((call) => call.url === OPENID_CONFIGURATION_URL).length, 1);
    const tokenCalls = calls.filter((call) => call.url === doc.token_endpoint);
    assert.equal(tokenCalls.length, 2);
    assert.equal(tokenCalls.every((call) => call.method === 'POST'), true);
    assert.equal(tokenCalls.some((call) => call.body.includes('grant_type=authorization_code')), true);
    assert.equal(tokenCalls.some((call) => call.body.includes('grant_type=refresh_token')), true);
    assert.equal(calls.filter((call) => call.url === doc.jwks_uri).length, 1);
    const allowed = new Set([OPENID_CONFIGURATION_URL, doc.token_endpoint, doc.jwks_uri]);
    assert.deepEqual(calls.map((call) => call.url).filter((url) => !allowed.has(url)), []);
    assert.equal(calls.some((call) => call.url.includes('/api/accounts/.well-known/jwks.json')), false);
  });

  it('accepts a discovery document that omits revocation and userinfo', async () => {
    clearOidcDiscoveryCache();
    clearJwksCache();
    const seen = [];
    const jwksUri = 'https://auth.openai.com/discovered/jwks.json';
    stubFetch(async (url) => {
      const target = String(url);
      seen.push(target);
      if (target === OPENID_CONFIGURATION_URL) {
        return jsonResponse({
          issuer: ISSUER,
          authorization_endpoint: 'https://auth.openai.com/discovered/authorize',
          token_endpoint: 'https://auth.openai.com/discovered/oauth/token',
          jwks_uri: jwksUri
        });
      }
      if (target === jwksUri) return jsonResponse({ keys: [jwk] });
      return new Response('no', { status: 404 });
    });
    const payload = await verifyIdToken(signToken(claims()), 'nonce-1', 'oaiapp_TEST');
    assert.equal(payload.sub, 'user_123');
    assert.equal(seen.includes(jwksUri), true);
    assert.equal(seen.includes(JWKS_ENDPOINT), false);
  });

  it('uses fallback endpoints when discovery fails and never calls the blocked JWKS path', { timeout: 5000 }, async () => {
    const logs = spyConsoleError();
    try {
      clearOidcDiscoveryCache();
      clearJwksCache();
      const seen = [];
      const nonceRef = { nonce: null };
      stubFetch(async (url, init) => {
        const target = String(url);
        seen.push(target);
        if (target === OPENID_CONFIGURATION_URL) {
          return new Response('jwks-body-should-not-leak', { status: 403 });
        }
        if (target === JWKS_ENDPOINT) return jsonResponse({ keys: [jwk] });
        if (target === TOKEN_ENDPOINT) {
          if (String(init?.body || '').includes('grant_type=refresh_token')) {
            return jsonResponse({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 });
          }
          return jsonResponse({
            access_token: 'AT',
            refresh_token: 'RT',
            expires_in: 3600,
            token_type: 'Bearer',
            scope: PLAN_SCOPE,
            id_token: signToken(claims({
              nonce: nonceRef.nonce,
              aud: 'oaiapp_TEST',
              email: 'ada@ex.com'
            }))
          });
        }
        return new Response('no', { status: 404 });
      });

      await withConfig(async () => {
        const { spawnImpl } = fakeSpawn();
        const manager = createChatGPTAuthManager({
          clientId: 'oaiapp_TEST',
          spawnImpl,
          portStart: allocPort(),
          timeoutMs: 20000
        });
        try {
          const started = await manager.startAuth();
          assert.equal(started.authUrl.startsWith(`${AUTH_ENDPOINT}?`), true);
          const authUrl = new URL(started.authUrl);
          nonceRef.nonce = authUrl.searchParams.get('nonce');
          const page = await httpGet(
            `${authUrl.searchParams.get('redirect_uri')}?code=CODE&state=${authUrl.searchParams.get('state')}`
          );
          assert.match(page.body, /Successfully signed in/);
          assert.equal(page.body.includes('jwks-body-should-not-leak'), false);
          const refreshed = await refreshAccessToken('RT', 'oaiapp_TEST');
          assert.equal(refreshed.access_token, 'AT2');
          await verifyIdToken(signToken(claims()), 'nonce-1', 'oaiapp_TEST');
        } finally {
          await manager.cancelAll();
        }
      });

      assert.equal(seen.filter((url) => url === OPENID_CONFIGURATION_URL).length, 1);
      assert.equal(seen.includes(JWKS_ENDPOINT), true);
      assert.equal(seen.some((url) => url.includes('/api/accounts/.well-known/jwks.json')), false);
      assert.equal(seen.filter((url) => url === TOKEN_ENDPOINT).length, 2);
      const discoveryLogs = logs.lines.filter((line) => line.includes('OpenID discovery failed'));
      assert.equal(discoveryLogs.length, 1);
      assert.match(discoveryLogs[0], /403/);
      assert.equal(discoveryLogs[0].includes('jwks-body-should-not-leak'), false);

      clearOidcDiscoveryCache();
      clearJwksCache();
      const networkSeen = [];
      stubFetch(async (url) => {
        const target = String(url);
        networkSeen.push(target);
        if (target === OPENID_CONFIGURATION_URL) {
          throw Object.assign(new Error('secret-network-detail'), { code: 'ECONNREFUSED' });
        }
        if (target === JWKS_ENDPOINT) return jsonResponse({ keys: [jwk] });
        return new Response('no', { status: 404 });
      });
      const payload = await verifyIdToken(signToken(claims()), 'nonce-1', 'oaiapp_TEST');
      assert.equal(payload.email, 'test@example.com');
      assert.equal(networkSeen.includes(JWKS_ENDPOINT), true);
      assert.equal(networkSeen.some((url) => url.includes('/api/accounts/.well-known/jwks.json')), false);
      const networkLogs = logs.lines.filter((line) => line.includes('OpenID discovery failed'));
      assert.equal(networkLogs.length, 2);
      assert.match(networkLogs[1], /ECONNREFUSED/);
      assert.equal(networkLogs[1].includes('secret-network-detail'), false);

      clearOidcDiscoveryCache();
      clearJwksCache();
      const timeoutSeen = [];
      stubFetch(async (url) => {
        const target = String(url);
        timeoutSeen.push(target);
        if (target === OPENID_CONFIGURATION_URL) return new Promise(() => {});
        if (target === JWKS_ENDPOINT) return jsonResponse({ keys: [jwk] });
        return new Response('no', { status: 404 });
      });
      const timed = await verifyIdToken(signToken(claims()), 'nonce-1', 'oaiapp_TEST', { fetchTimeoutMs: 40 });
      assert.equal(timed.sub, 'user_123');
      assert.equal(timeoutSeen.includes(JWKS_ENDPOINT), true);
      assert.equal(timeoutSeen.some((url) => url.includes('/api/accounts/.well-known/jwks.json')), false);
      const timeoutLogs = logs.lines.filter((line) => line.includes('OpenID discovery failed'));
      assert.equal(timeoutLogs.length, 3);
      assert.match(timeoutLogs[2], /timeout/);
    } finally {
      logs.restore();
    }
  });

  it('rejects a discovery document with the wrong issuer or a non-https endpoint', async () => {
    const distinct = openIdDocument({
      authorization_endpoint: 'https://auth.openai.com/discovered/authorize',
      token_endpoint: 'https://auth.openai.com/discovered/oauth/token',
      jwks_uri: 'https://auth.openai.com/discovered/jwks.json'
    });
    const rejected = [
      { doc: { ...distinct, issuer: 'https://evil.example' }, reason: /wrong issuer/ },
      { doc: { ...distinct, issuer: 'https://auth.openai.com/' }, reason: /wrong issuer/ },
      { doc: { ...distinct, jwks_uri: 'http://auth.openai.com/discovered/jwks.json' }, reason: /non-https endpoint \(jwks_uri\)/ },
      { doc: { ...distinct, authorization_endpoint: 'http://auth.openai.com/discovered/authorize' }, reason: /non-https endpoint \(authorization_endpoint\)/ },
      { doc: { ...distinct, token_endpoint: 'https://auth.openai.com.evil.example/oauth/token' }, reason: /foreign host \(token_endpoint\)/ },
      { doc: { ...distinct, jwks_uri: 'https://evil.example/jwks.json' }, reason: /foreign host \(jwks_uri\)/ },
      { doc: { ...distinct, userinfo_endpoint: 'http://auth.openai.com/api/accounts/oauth/userinfo' }, reason: /non-https endpoint \(userinfo_endpoint\)/ },
      { doc: { ...distinct, revocation_endpoint: 'https://user:pass@auth.openai.com/revoke' }, reason: /non-https endpoint \(revocation_endpoint\)/ },
      { doc: { ...distinct, jwks_uri: 'https://auth.openai.com:8443/discovered/jwks.json' }, reason: /non-https endpoint \(jwks_uri\)/ },
      { doc: { ...distinct, registration_endpoint: 'http://auth.openai.com/register' }, reason: /non-https endpoint \(registration_endpoint\)/ },
      { doc: { ...distinct, device_authorization_endpoint: 'https://evil.example/device' }, reason: /foreign host \(device_authorization_endpoint\)/ }
    ];

    const logs = spyConsoleError();
    try {
      for (const { doc, reason } of rejected) {
        clearOidcDiscoveryCache();
        clearJwksCache();
        logs.lines.length = 0;
        const seen = [];
        stubFetch(async (url) => {
          const target = String(url);
          seen.push(target);
          if (target === OPENID_CONFIGURATION_URL) return jsonResponse(doc);
          if (target === JWKS_ENDPOINT) return jsonResponse({ keys: [jwk] });
          return new Response('no', { status: 404 });
        });
        const payload = await verifyIdToken(signToken(claims()), 'nonce-1', 'oaiapp_TEST');
        assert.equal(payload.sub, 'user_123', JSON.stringify(doc));
        assert.deepEqual(
          seen.filter((url) => url !== OPENID_CONFIGURATION_URL && url !== JWKS_ENDPOINT),
          [],
          JSON.stringify(doc)
        );
        const rejectedLogs = logs.lines.filter((line) => line.includes('OpenID discovery document rejected'));
        assert.equal(rejectedLogs.length, 1, JSON.stringify(doc));
        assert.match(rejectedLogs[0], reason, JSON.stringify(doc));
        assert.equal(rejectedLogs[0].includes('evil.example'), false, rejectedLogs[0]);
        assert.equal(rejectedLogs[0].includes('user:pass'), false, rejectedLogs[0]);
        assert.equal(rejectedLogs[0].includes('8443'), false, rejectedLogs[0]);
        assert.equal(rejectedLogs[0].includes('http://'), false, rejectedLogs[0]);
      }
    } finally {
      logs.restore();
    }
  });

  it('caches a good discovery document for an hour and a rejected document for 60 seconds', async () => {
    mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const logs = spyConsoleError();
    try {
      clearOidcDiscoveryCache();
      clearJwksCache();
      let fetches = 0;
      stubFetch(async (url) => {
        const target = String(url);
        if (target === OPENID_CONFIGURATION_URL) {
          fetches += 1;
          return jsonResponse(openIdDocument());
        }
        if (target === JWKS_ENDPOINT) return jsonResponse({ keys: [jwk] });
        return new Response('no', { status: 404 });
      });
      const longLived = () => signToken(claims({ exp: Math.floor(Date.now() / 1000) + (10 * 24 * 3600) }));
      await verifyIdToken(longLived(), 'nonce-1', 'oaiapp_TEST');
      mock.timers.tick(59 * 60 * 1000);
      clearJwksCache();
      await verifyIdToken(longLived(), 'nonce-1', 'oaiapp_TEST');
      assert.equal(fetches, 1);
      mock.timers.tick(2 * 60 * 1000);
      clearJwksCache();
      await verifyIdToken(longLived(), 'nonce-1', 'oaiapp_TEST');
      assert.equal(fetches, 2);

      clearOidcDiscoveryCache();
      clearJwksCache();
      let rejectedFetches = 0;
      stubFetch(async (url) => {
        const target = String(url);
        if (target === OPENID_CONFIGURATION_URL) {
          rejectedFetches += 1;
          return jsonResponse({ ...openIdDocument(), issuer: 'https://evil.example' });
        }
        if (target === JWKS_ENDPOINT) return jsonResponse({ keys: [jwk] });
        return new Response('no', { status: 404 });
      });
      await verifyIdToken(longLived(), 'nonce-1', 'oaiapp_TEST');
      clearJwksCache();
      await verifyIdToken(longLived(), 'nonce-1', 'oaiapp_TEST');
      assert.equal(rejectedFetches, 1);
      const firstRejection = logs.lines.filter((line) => line.includes('discovery document rejected'));
      assert.equal(firstRejection.length, 1);
      assert.match(firstRejection[0], /wrong issuer/);
      assert.equal(firstRejection[0].includes('evil.example'), false);
      mock.timers.tick(59 * 1000);
      clearJwksCache();
      await verifyIdToken(longLived(), 'nonce-1', 'oaiapp_TEST');
      assert.equal(rejectedFetches, 1);
      mock.timers.tick(2 * 1000);
      clearJwksCache();
      await verifyIdToken(longLived(), 'nonce-1', 'oaiapp_TEST');
      assert.equal(rejectedFetches, 2);
      assert.equal(logs.lines.filter((line) => line.includes('discovery document rejected')).length, 1);

      clearOidcDiscoveryCache();
      clearJwksCache();
      let httpFetches = 0;
      stubFetch(async (url) => {
        const target = String(url);
        if (target === OPENID_CONFIGURATION_URL) {
          httpFetches += 1;
          return new Response('no', { status: 503 });
        }
        if (target === JWKS_ENDPOINT) return jsonResponse({ keys: [jwk] });
        return new Response('no', { status: 404 });
      });
      const beforeHttp = logs.lines.filter((line) => line.includes('OpenID discovery failed')).length;
      await verifyIdToken(longLived(), 'nonce-1', 'oaiapp_TEST');
      clearJwksCache();
      await verifyIdToken(longLived(), 'nonce-1', 'oaiapp_TEST');
      assert.equal(httpFetches, 1);
      mock.timers.tick(61 * 1000);
      clearJwksCache();
      await verifyIdToken(longLived(), 'nonce-1', 'oaiapp_TEST');
      assert.equal(httpFetches, 2);
      const httpLogs = logs.lines.filter((line) => line.includes('OpenID discovery failed'));
      assert.equal(httpLogs.length, beforeHttp + 1);
      assert.match(httpLogs.at(-1), /503/);
    } finally {
      logs.restore();
      mock.timers.reset();
    }
  });

  it('masks network, stream, and refresh failures logged by the ChatGPT provider', async () => {
    await withConfig(async () => {
      const secret = 'sk-TESTKEYDONOTUSE0123456789';
      await saveCredentials(sampleCreds());
      const errors = [];
      const warns = [];
      const originalError = console.error;
      const originalWarn = console.warn;
      console.error = (...args) => {
        errors.push(args.map((part) => String(part)).join(' '));
      };
      console.warn = (...args) => {
        warns.push(args.map((part) => String(part)).join(' '));
      };
      try {
        stubFetch(async (url) => {
          if (String(url).includes('/v1/models')) return jsonResponse({ models: [{ slug: 'gpt-x', visibility: 'list' }] });
          throw new Error(`socket hang up ${secret}`);
        });
        await assert.rejects(callChatGPTResponses({ prompt: 'hi' }), /socket hang up/);
        assert.equal(errors.some((line) => line.includes('socket hang up')), true);
        assert.equal(errors.join('\n').includes(secret), false);

        errors.length = 0;
        stubFetch(async (url) => {
          const target = String(url);
          if (target.includes('/v1/models')) return jsonResponse({ models: [{ slug: 'gpt-x', visibility: 'list' }] });
          if (target.includes('/v1/responses')) {
            return sseResponse([
              `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: `x ${secret}` })}`,
              `data: not-json ${secret}`,
              ''
            ].join('\n'));
          }
          return new Response('no', { status: 404 });
        });
        await assert.rejects(callChatGPTResponses({ prompt: 'hi' }), /malformed event data/);
        assert.equal(errors.some((line) => line.includes('malformed event data')), true);
        assert.equal(errors.join('\n').includes(secret), false);
        assert.equal(errors.join('\n').includes('not-json'), false);

        await saveCredentials(expiredCreds());
        stubFetch(async (url) => {
          const target = String(url);
          if (target.includes('/oauth/token')) throw new Error(`refresh failed ${secret}`);
          if (target.includes('/v1/models')) return jsonResponse({ models: [{ slug: 'gpt-x', visibility: 'list' }] });
          if (target.includes('/v1/responses')) return completedStream('ok');
          return new Response('no', { status: 404 });
        });
        const refreshed = await callChatGPTResponses({ prompt: 'hi' });
        assert.equal(refreshed.completed, true);
        assert.equal(warns.some((line) => line.includes('ChatGPT token refresh failed')), true);
        assert.equal(warns.join('\n').includes(secret), false);
      } finally {
        console.error = originalError;
        console.warn = originalWarn;
      }
    });
  });

  it('returns account email and name from the record or the stored id token', async () => {
    await withConfig(async () => {
      await saveCredentials({
        ...sampleCreds(),
        account: { email: 'ada@ex.com' }
      });
      const manager = createChatGPTAuthManager();
      let providerStatus = await dispatchToolCall({ name: 'provider.status', args: { provider: 'chatgpt' } });
      assert.equal(providerStatus.ok, true);
      assert.equal(providerStatus.result.status, 'signed-in');
      assert.equal(providerStatus.result.account.email, 'ada@ex.com');
      let auth = await manager.getAuthStatus();
      assert.equal(auth.state, 'signed_in');
      assert.equal(auth.account.email, 'ada@ex.com');

      await saveCredentials({
        ...sampleCreds(),
        email: '',
        account: { email: 'kept@ex.com' },
        id_token: signToken(claims({ email: 'other@ex.com', name: 'From Token' }))
      });
      auth = await manager.getAuthStatus();
      assert.equal(auth.account.email, 'kept@ex.com');
      assert.equal(auth.account.name, 'From Token');

      await saveCredentials({
        ...sampleCreds(),
        email: '',
        account: {},
        id_token: signToken(claims({ email: 'ada@ex.com', name: 'Ada Lovelace' }))
      });
      providerStatus = await dispatchToolCall({ name: 'provider.status', args: { provider: 'chatgpt' } });
      assert.equal(providerStatus.result.account.email, 'ada@ex.com');
      assert.equal(providerStatus.result.account.name, 'Ada Lovelace');
      auth = await manager.getAuthStatus();
      assert.equal(auth.account.email, 'ada@ex.com');
      assert.equal(auth.account.name, 'Ada Lovelace');
    });
  });

  it('sign-out keeps client id, host id, issuer, and timestamps, and drops tokens and personal fields', async () => {
    await withConfig(async (dir) => {
      const manager = createChatGPTAuthManager();
      await saveCredentials({
        client_id: 'oaiapp_TEST',
        ext_agent_host_id: 'host-1',
        issuer: 'https://auth.openai.com',
        subject: 'user_ada',
        access_token: 'AT',
        refresh_token: 'RT',
        id_token: signToken(claims({
          email: 'ada@ex.com',
          name: 'Ada Lovelace',
          sub: 'user_ada'
        })),
        expires_in: 3600,
        issued_at: Date.now(),
        scope: PLAN_SCOPE,
        scopes: PLAN_SCOPE.split(' '),
        token_type: 'Bearer'
      });
      const before = JSON.parse(await readFile(path.join(dir, 'chatpcb', 'chatgpt-credentials-oaiapp_TEST.json'), 'utf8'));
      assert.equal((await manager.signOut()).state, 'signed_out');
      const retained = JSON.parse(await readFile(path.join(dir, 'chatpcb', 'chatgpt-credentials-oaiapp_TEST.json'), 'utf8'));
      assert.equal(retained.client_id, 'oaiapp_TEST');
      assert.equal(retained.ext_agent_host_id, 'host-1');
      assert.equal(retained.issuer, 'https://auth.openai.com');
      assert.equal(retained.last_used_at, before.last_used_at);
      assert.deepEqual(Object.keys(retained).sort(), ['client_id', 'ext_agent_host_id', 'issuer', 'last_used_at']);
      assert.equal(Object.hasOwn(retained, 'email'), false);
      assert.equal(Object.hasOwn(retained, 'name'), false);
      assert.equal(Object.hasOwn(retained, 'subject'), false);
      assert.equal(Object.hasOwn(retained, 'account'), false);
      assert.equal(Object.hasOwn(retained, 'access_token'), false);
      assert.equal(Object.hasOwn(retained, 'refresh_token'), false);
      assert.equal(Object.hasOwn(retained, 'id_token'), false);
      assert.equal(JSON.stringify(retained).includes('ada@ex.com'), false);
      assert.equal(JSON.stringify(retained).includes('Ada Lovelace'), false);
      assert.equal(JSON.stringify(retained).includes('user_ada'), false);
      assertSessionCleared(retained);
      assert.equal(await loadCredentials(), null);
      assert.equal((await manager.getAuthStatus()).state, 'signed_out');
    });
  });

  it('reads client id from the environment and config file', async () => {
    await withConfig(async (dir) => {
      await mkdir(path.join(dir, 'chatpcb'), { recursive: true });
      await writeFile(path.join(dir, 'chatpcb', 'chatgpt.json'), JSON.stringify({ clientId: 'from-file' }));
      assert.equal((await resolveChatGPTSettings()).clientId, 'from-file');
      process.env.CHATPCB_CHATGPT_CLIENT_ID = 'from-env';
      assert.equal((await resolveChatGPTSettings()).clientId, 'from-env');
      assert.equal((await resolveChatGPTSettings({ clientId: 'from-arg' })).clientId, 'from-arg');
    });
  });
});

function restoreEnv(name) {
  if (originalEnv[name] === undefined) delete process.env[name];
  else process.env[name] = originalEnv[name];
}

function stubFetch(handler) {
  globalThis.fetch = handler;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function sseResponse(text, status = 200) {
  return new Response(text, {
    status,
    headers: { 'content-type': 'text/event-stream' }
  });
}

function completedStream(text) {
  return sseResponse([
    `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}`,
    'data: {"type":"response.completed"}',
    ''
  ].join('\n'));
}

function chatGPTFetch(seen, responses) {
  return async (url, init) => {
    const target = String(url);
    seen.push({ url: target, body: init?.body ? String(init.body) : '' });
    if (target.includes('/v1/models')) return jsonResponse({ models: [{ slug: 'gpt-x', visibility: 'list' }] });
    if (target.includes('/v1/responses')) return responses(url, init);
    return new Response('no', { status: 404 });
  };
}

function invokeChatGPT(root, id) {
  return dispatchToolCall({
    id,
    name: 'provider.invoke',
    args: { provider: 'chatgpt', prompt: 'ESP32 board', projectDir: root }
  });
}

async function withChatGPTClient(fn) {
  await withConfig(async () => {
    await saveCredentials(sampleCreds());
    const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-chatgpt-fn-'));
    const seen = [];
    try {
      await fn({ root, seen });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

function functionCallStream({ name, callId, itemId, argumentsText, text = '', outputIndex = 0 }) {
  const mid = Math.max(1, Math.ceil(argumentsText.length / 2));
  const parts = [argumentsText.slice(0, mid), argumentsText.slice(mid)].filter((part) => part.length > 0);
  const item = {
    type: 'function_call',
    id: itemId,
    call_id: callId,
    name,
    arguments: argumentsText,
    status: 'completed'
  };
  const events = [];
  if (text) events.push({ type: 'response.output_text.delta', delta: text });
  events.push({
    type: 'response.output_item.added',
    output_index: outputIndex,
    item: { ...item, arguments: '', status: 'in_progress' }
  });
  for (const delta of parts) {
    events.push({
      type: 'response.function_call_arguments.delta',
      output_index: outputIndex,
      item_id: itemId,
      delta
    });
  }
  events.push({
    type: 'response.function_call_arguments.done',
    output_index: outputIndex,
    item_id: itemId,
    arguments: argumentsText
  });
  events.push({
    type: 'response.output_item.done',
    output_index: outputIndex,
    item
  });
  events.push({
    type: 'response.completed',
    response: {
      id: 'resp_test',
      status: 'completed',
      output: [item]
    }
  });
  return sseEvents(events);
}

function completedFunctionCallStream({ name, callId, itemId, argumentsText }) {
  return sseEvents([{
    type: 'response.completed',
    response: {
      id: 'resp_test',
      status: 'completed',
      output: [{
        type: 'function_call',
        id: itemId,
        call_id: callId,
        name,
        arguments: argumentsText,
        status: 'completed'
      }]
    }
  }]);
}

function sseEvents(events) {
  const lines = [];
  for (const event of events) {
    lines.push(`event: ${event.type}`);
    lines.push(`data: ${JSON.stringify(event)}`);
    lines.push('');
  }
  return sseResponse(lines.join('\n'));
}

function signToken(payload, header = { alg: 'RS256', typ: 'JWT', kid: 'kid-1' }) {
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signer = createSign('RSA-SHA256');
  signer.update(`${headerB64}.${payloadB64}`);
  signer.end();
  const signature = header.alg === 'RS256'
    ? signer.sign(privateKey).toString('base64url')
    : Buffer.from('not-rs256').toString('base64url');
  return `${headerB64}.${payloadB64}.${signature}`;
}

function claims(overrides = {}) {
  return {
    sub: 'user_123',
    email: 'test@example.com',
    iss: 'https://auth.openai.com',
    aud: 'oaiapp_TEST',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    nonce: 'nonce-1',
    ...overrides
  };
}

const PLAN_SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';

function sampleCreds() {
  return {
    client_id: 'oaiapp_TEST',
    access_token: 'AT',
    refresh_token: 'RT',
    expires_in: 3600,
    issued_at: Date.now(),
    scope: PLAN_SCOPE,
    scopes: PLAN_SCOPE.split(' '),
    account: { email: 'ada@ex.com' }
  };
}

function expiredCreds(overrides = {}) {
  return {
    ...sampleCreds(),
    expires_in: 30,
    issued_at: Date.now() - 3_600_000,
    ...overrides
  };
}

function tokenHandler({ tokenCalls, nonceRef, aud, sub = 'user_123', email = 'ada@ex.com', scope = PLAN_SCOPE }) {
  return async (url, init) => {
    const target = String(url);
    if (target.includes('/oauth/token')) {
      tokenCalls.push(String(init?.body || ''));
      return jsonResponse({
        access_token: 'AT',
        refresh_token: 'RT',
        expires_in: 3600,
        token_type: 'Bearer',
        scope,
        id_token: signToken(claims({ nonce: nonceRef.nonce, aud, sub, email }))
      });
    }
    if (target.includes('jwks')) return jsonResponse({ keys: [jwk] });
    return new Response('no', { status: 404 });
  };
}

function fakeSpawn() {
  const calls = [];
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    const handlers = {};
    const proc = {
      on(event, fn) {
        handlers[event] = fn;
        return proc;
      },
      unref() {}
    };
    queueMicrotask(() => handlers.spawn?.());
    return proc;
  };
  return { calls, spawnImpl };
}

function allocPort() {
  portCursor += 30;
  return portCursor;
}

function redirectPort(authUrl) {
  return Number(new URL(new URL(authUrl).searchParams.get('redirect_uri')).port);
}

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

async function waitForPortFree(port, timeoutMs = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await canListen(port)) return true;
    await delay(25);
  }
  return false;
}

function spyConsoleError() {
  const lines = [];
  const original = console.error;
  console.error = (...args) => {
    lines.push(args.map((part) => String(part)).join(' '));
    original.apply(console, args);
  };
  return {
    lines,
    restore() {
      console.error = original;
    }
  };
}

function httpGet(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function graceExitScript({ authModuleUrl, portStart }) {
  return `import { startAuthFlow, useFallbackAuthEndpoints } from ${JSON.stringify(authModuleUrl)};

useFallbackAuthEndpoints();
globalThis.fetch = async () => {
  throw new Error('fetch disabled');
};

const flow = startAuthFlow({
  clientId: 'oaiapp_TEST',
  portStart: ${Number(portStart)},
  spawnImpl() {
    const handlers = {};
    const proc = {
      on(event, fn) {
        handlers[event] = fn;
        return proc;
      },
      unref() {}
    };
    queueMicrotask(() => handlers.spawn?.());
    return proc;
  }
});

try {
  await flow.promise;
  console.log('RESULT success');
  process.exitCode = 1;
} catch (error) {
  if (error && error.code === 'timeout') console.log('RESULT expired');
  else {
    console.log('RESULT ' + ((error && (error.code || error.message)) || 'error'));
    process.exitCode = 1;
  }
}
`;
}

function childClose(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let killed = false;
    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal, timedOut: killed });
    };
    const timer = setTimeout(() => {
      killed = true;
      child.kill();
    }, timeoutMs);
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', finish);
  });
}

async function withConfig(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'chatpcb-cgpt-'));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = dir;
  try {
    return await fn(dir);
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeCred(configDir, creds) {
  const safe = String(creds.client_id).replace(/[^a-zA-Z0-9_-]/g, '_');
  await writeFile(path.join(configDir, `chatgpt-credentials-${safe}.json`), JSON.stringify(creds));
}

function loadPanelAuthHref() {
  const source = readFileSyncPanel();
  const code = `${extractFunction(source, 'escapeHtml')}\n${extractFunction(source, 'chatgptAuthHref')}\nglobalThis.api = { escapeHtml, chatgptAuthHref };`;
  const sandbox = { URL };
  vm.runInNewContext(code, sandbox);
  return sandbox.api;
}

function readFileSyncPanel() {
  return readFileSync(new URL('../apps/panel/panel.js', import.meta.url), 'utf8');
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`missing ${name}`);
  let depth = 0;
  let started = false;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') {
      depth += 1;
      started = true;
    } else if (char === '}') {
      depth -= 1;
      if (started && depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unclosed ${name}`);
}

function openDaemonSocket(daemon) {
  const socket = new WebSocket(`${daemon.url.replace('http:', 'ws:')}/ws`);
  const pending = new Map();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('websocket open timed out')), 2000);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      resolve({
        call(name, args, id) {
          return new Promise((resolveCall, rejectCall) => {
            const callTimer = setTimeout(() => rejectCall(new Error(`websocket ${name} timed out`)), 5000);
            pending.set(id, (payload) => {
              clearTimeout(callTimer);
              resolveCall(payload);
            });
            socket.send(JSON.stringify(createEnvelope('tool.call', { id, name, args })));
          });
        },
        close() {
          socket.close();
        }
      });
    });
    socket.addEventListener('message', (event) => {
      const envelope = JSON.parse(event.data);
      if (envelope.type !== 'tool.result') return;
      const deliver = pending.get(envelope.payload?.id);
      if (!deliver) return;
      pending.delete(envelope.payload.id);
      deliver(envelope.payload);
    });
    socket.addEventListener('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 3000) throw new Error('timed out waiting for condition');
    await delay(5);
  }
}

function assertSessionCleared(creds) {
  assert.equal(creds.access_token, undefined);
  assert.equal(creds.refresh_token, undefined);
  assert.equal(creds.id_token, undefined);
  assert.equal(creds.token_type, undefined);
  assert.equal(creds.expires_in, undefined);
  assert.equal(creds.issued_at, undefined);
  assert.equal(creds.scope, undefined);
  assert.equal(creds.scopes, undefined);
}

async function listCredentialFiles(dir) {
  const configDir = path.join(dir, 'chatpcb');
  let names = [];
  try {
    names = await readdir(configDir);
  } catch {
    return [];
  }
  return names.filter((name) => name.startsWith('chatgpt-credentials'));
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve) => server.close(() => resolve()));
}

async function withDelayedTokenExchange(fn) {
  await withConfig(async (dir) => {
    const { spawnImpl } = fakeSpawn();
    const manager = createChatGPTAuthManager({
      clientId: 'oaiapp_TEST',
      spawnImpl,
      portStart: allocPort(),
      timeoutMs: 20000
    });
    const nonceRef = { nonce: null };
    let tokenFetchStarted = false;
    const gate = deferred();
    stubFetch(async (url) => {
      const target = String(url);
      if (target.includes('/oauth/token')) {
        tokenFetchStarted = true;
        await gate.promise;
        return jsonResponse({
          access_token: 'LATE_ACCESS_TOKEN',
          refresh_token: 'LATE_REFRESH_TOKEN',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: PLAN_SCOPE,
          id_token: signToken(claims({
            nonce: nonceRef.nonce,
            aud: 'oaiapp_TEST',
            email: 'ada@ex.com'
          }))
        });
      }
      if (target.includes('jwks')) return jsonResponse({ keys: [jwk] });
      return new Response('no', { status: 404 });
    });
    try {
      const started = await manager.startAuth();
      const authUrl = new URL(started.authUrl);
      nonceRef.nonce = authUrl.searchParams.get('nonce');
      const callbackPromise = httpGet(
        `${authUrl.searchParams.get('redirect_uri')}?code=CODE&state=${authUrl.searchParams.get('state')}`
      );
      await waitFor(() => tokenFetchStarted);
      await fn({ manager, dir, gate, started, callbackPromise });
      gate.resolve();
      await callbackPromise;
      await delay(30);
      assert.deepEqual(await listCredentialFiles(dir), []);
      assert.equal(await loadCredentials(), null);
      assert.equal((await manager.getAuthStatus()).state, 'signed_out');
    } finally {
      gate.resolve();
      await manager.cancelAll();
    }
  });
}
