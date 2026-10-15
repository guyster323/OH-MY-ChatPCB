import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, afterEach } from 'node:test';
import vm from 'node:vm';

import { dispatchToolCall, startDaemon } from '../src/runtime/agent-daemon.js';
import {
  createChatGPTAuthManager,
  loadCredentials,
  openSystemBrowser,
  resolveChatGPTSettings,
  saveCredentials,
  startAuthFlow,
  verifyIdToken
} from '../src/runtime/auth/chatgpt-auth.js';
import { createEnvelope } from '../src/runtime/envelope.js';
import { parseProviderMessage, validateProviderToolCall } from '../src/runtime/provider-process.js';
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

const ALLOWED_TOOLS = ['schematic.generate', 'project.create', 'schematic.patch', 'project.inspect', 'validate.erc', 'validate.drc', 'simulate.spice'];
let portCursor = 28000;

describe('ChatGPT integration', { concurrency: 1 }, () => {
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

  it('uses the configured client id and ignores client_id on the callback', async () => {
    await withConfig(async () => {
      const { spawnImpl } = fakeSpawn();
      const manager = createChatGPTAuthManager({
        clientId: 'oaiapp_TEST',
        spawnImpl,
        portStart: allocPort(),
        timeoutMs: 20000
      });
      let nonce = null;
      const tokenCalls = [];
      stubFetch(async (url, init) => {
        const target = String(url);
        if (target.includes('/oauth/token')) {
          tokenCalls.push(String(init.body));
          return jsonResponse({
            access_token: 'AT',
            refresh_token: 'RT',
            expires_in: 3600,
            token_type: 'Bearer',
            scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
            id_token: signToken(claims({ nonce, aud: 'oaiapp_TEST', email: 'ada@ex.com' }))
          });
        }
        if (target.includes('jwks')) return jsonResponse({ keys: [jwk] });
        return new Response('no', { status: 404 });
      });

      try {
        const started = await manager.startAuth();
        const authUrl = new URL(started.authUrl);
        nonce = authUrl.searchParams.get('nonce');
        const state = authUrl.searchParams.get('state');
        assert.equal(authUrl.searchParams.get('client_id'), 'oaiapp_TEST');
        assert.equal(authUrl.searchParams.get('client_id') === 'dynamic_agent_client', false);
        assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
        assert.match(authUrl.searchParams.get('scope'), /chatgpt\.tokens\.use\.direct/);
        assert.match(started.authUrl, /^https:\/\/auth\.openai\.com\//);

        const redirect = authUrl.searchParams.get('redirect_uri');
        const page = await httpGet(`${redirect}?code=CODE&state=${state}&client_id=oaiapp_ATTACKER`);
        assert.equal(page.status, 200);
        assert.match(page.body, /Successfully signed in/);
        assert.equal(tokenCalls.length, 1);
        const body = new URLSearchParams(tokenCalls[0]);
        assert.equal(body.get('client_id'), 'oaiapp_TEST');
        assert.equal(body.get('resource'), 'https://api.openai.com/v1');
        assert.equal(body.get('client_id') === 'oaiapp_ATTACKER', false);

        const saved = await loadCredentials();
        assert.equal(saved.client_id, 'oaiapp_TEST');
        assert.equal(saved.account.email, 'ada@ex.com');
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

function sampleCreds() {
  return {
    client_id: 'oaiapp_TEST',
    access_token: 'AT',
    refresh_token: 'RT',
    expires_in: 3600,
    issued_at: Date.now(),
    account: { email: 'ada@ex.com' }
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
