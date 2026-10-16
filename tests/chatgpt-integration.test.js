import assert from 'node:assert/strict';
import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';
import vm from 'node:vm';

import { dispatchToolCall, startDaemon } from '../src/runtime/agent-daemon.js';
import {
  clearJwksCache,
  createChatGPTAuthManager,
  loadCredentials,
  openSystemBrowser,
  refreshAccessToken,
  resolveChatGPTSettings,
  saveCredentials,
  startAuthFlow,
  verifyIdToken
} from '../src/runtime/auth/chatgpt-auth.js';
import { createEnvelope } from '../src/runtime/envelope.js';
import { parseProviderMessage, validateProviderToolCall } from '../src/runtime/provider-process.js';
import { PROVIDER_ALLOWED_TOOLS } from '../src/runtime/provider-registry.js';
import { callChatGPTResponses } from '../src/runtime/providers/chatgpt-provider.js';

const originalFetch = globalThis.fetch;
const originalEnv = {
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  CHATPCB_CHATGPT_MODEL: process.env.CHATPCB_CHATGPT_MODEL,
  CHATPCB_CHATGPT_CLIENT_ID: process.env.CHATPCB_CHATGPT_CLIENT_ID
};

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
jwk.kid = 'kid-1';
jwk.alg = 'RS256';
jwk.use = 'sig';

const ALLOWED_TOOLS = [...PROVIDER_ALLOWED_TOOLS];
let portCursor = 28000;

describe('ChatGPT integration', { concurrency: 1 }, () => {
  beforeEach(() => {
    delete process.env.CHATPCB_CHATGPT_CLIENT_ID;
    clearJwksCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreEnv('XDG_CONFIG_HOME');
    restoreEnv('CHATPCB_CHATGPT_MODEL');
    restoreEnv('CHATPCB_CHATGPT_CLIENT_ID');
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
        assert.match(authUrl.searchParams.get('ext_agent_host_id'), /^urn:uuid:/);
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
        assert.match(hostId, /^urn:uuid:[0-9a-f-]{36}$/i);
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
        assert.match(hostId, /^urn:uuid:[0-9a-f-]{36}$/i);
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
        await httpGet(`${redirect}?code=CODE&state=${authUrl.searchParams.get('state')}&client_id=oaiapp_ISSUED`);
        assert.equal((await loadCredentials()).client_id, 'oaiapp_ISSUED');

        assert.equal((await manager.signOut()).state, 'signed_out');
        assert.equal(await loadCredentials(), null);
        const retained = JSON.parse(await readFile(path.join(dir, 'chatpcb', 'chatgpt-credentials-oaiapp_ISSUED.json'), 'utf8'));
        assert.equal(retained.client_id, 'oaiapp_ISSUED');
        assert.equal(retained.access_token, undefined);
        assert.equal(retained.id_token, undefined);
        assert.equal(retained.email, 'ada@ex.com');

        const returned = await manager.startAuth();
        const returnedUrl = new URL(returned.authUrl);
        assert.equal(returnedUrl.searchParams.get('client_id'), 'oaiapp_ISSUED');
        assert.equal(returnedUrl.searchParams.has('agent_name_hint'), false);
        assert.equal(returnedUrl.searchParams.has('id_token_hint'), false);
        assert.equal(returnedUrl.searchParams.get('login_hint'), 'ada@ex.com');
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
      const reopened = manager.reopenAuth({ attemptId: started.attemptId });
      assert.equal(reopened.state, 'waiting');
      assert.equal(reopened.authUrl, started.authUrl);
      assert.match(reopened.authUrl, /^https:\/\/auth\.openai\.com\/api\/accounts\/authorize\?/);
      assert.equal(reopened.authUrl.includes('auth.openai.com/api/accounts/authorize?...'), false);
      assert.equal(calls.at(-1).args.at(-1), started.authUrl);
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
      assert.ok(manager.reopenAuth({ attemptId: first.attemptId }).error);
      assert.equal(manager.reopenAuth({ attemptId: second.attemptId }).authUrl, second.authUrl);
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
        assert.match(request.input, /Allowed tool names/);
        assert.match(request.input, /schematic\.generate/);
        assert.match(request.input, /schematic\.patch/);
        assert.match(request.input, /validate\.drc/);
        assert.match(request.input, /ESP32 board/);
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
      assert.ok(manager.reopenAuth({ attemptId: started.attemptId }).error);
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
        assert.equal(manager.reopenAuth({ attemptId: started.attemptId }).authUrl, started.authUrl);

        const wrong = await httpGet(`${redirect}?error=access_denied&state=not-the-state&code=SHOULD_NOT_EXCHANGE`);
        assert.equal(wrong.status, 400);
        assert.match(wrong.body, /state mismatch/);
        assert.equal(tokenCalls.length, 0);
        assert.equal(manager.reopenAuth({ attemptId: started.attemptId }).state, 'waiting');

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
