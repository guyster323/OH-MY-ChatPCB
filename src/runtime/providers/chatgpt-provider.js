import {
  currentSessionGeneration,
  hasChatGPTPlanScope,
  loadCredentials,
  refreshAccessToken,
  resolveChatGPTSettings,
  saveCredentialsIfCurrent,
  verifyTokenExpiry
} from '../auth/chatgpt-auth.js';
import { validateProviderToolCall } from '../provider-process.js';
import { PROVIDER_ALLOWED_TOOLS } from '../provider-registry.js';

const RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';
const MODELS_ENDPOINT = 'https://api.openai.com/v1/models';
const DEFAULT_RESPONSES_TIMEOUT_MS = 120_000;

/**
 * Pick a model slug from the signed-in account's catalog (GET /v1/models).
 *
 * Eligible models are those with visibility "list", in the server's order.
 * If none are marked list, every slug (or id) is eligible, still in server order.
 * The default is the first eligible slug. There is no built-in model name.
 *
 * Override with the `model` argument, the CHATPCB_CHATGPT_MODEL environment
 * variable, or `model` in the ChatPCB config file chatgpt.json. An override
 * must be one of the eligible slugs. Explicit argument wins, then the
 * environment variable, then the config file.
 */
export async function selectChatGPTModel(accessToken, override) {
  const response = await fetch(MODELS_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) throw await httpError(response, accessToken);

  const payload = await response.json();
  const slugs = catalogSlugs(payload);
  if (slugs.length === 0) {
    throw new Error('No ChatGPT models are available for this account');
  }

  if (override) {
    if (!slugs.includes(override)) {
      throw new Error(`Configured ChatGPT model "${override}" is not available for this account. Available models: ${slugs.join(', ')}`);
    }
    return override;
  }

  return slugs[0];
}

export async function callChatGPTResponses({
  prompt,
  onChunk,
  onError,
  signal,
  model,
  allowedTools,
  timeoutMs
} = {}) {
  const creds = await loadCredentials();

  if (!creds || !creds.access_token) {
    throw new Error('Not signed in to ChatGPT');
  }
  if (!hasChatGPTPlanScope(creds)) {
    const error = new Error('chatgpt.tokens.use.direct permission not granted');
    error.code = 'scope_not_granted';
    throw error;
  }

  const generation = currentSessionGeneration();
  const clientId = creds.client_id;
  const originalRefresh = creds.refresh_token || '';
  const tokenStatus = verifyTokenExpiry(creds);
  let activeCreds = creds;
  let accessToken = creds.access_token;

  if (tokenStatus.shouldRefresh && creds.refresh_token) {
    try {
      const refreshed = await refreshAccessToken(creds.refresh_token, creds.client_id);
      activeCreds = {
        ...creds,
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token || creds.refresh_token,
        expires_in: refreshed.expires_in,
        issued_at: Date.now()
      };
      await persistSession(activeCreds, generation, clientId, [originalRefresh, activeCreds.refresh_token || '']);
      accessToken = refreshed.access_token;
    } catch (error) {
      if (onError) onError({ code: 'refresh_failed', message: error.message });
    }
  }

  const settings = await resolveChatGPTSettings({ model, responsesTimeoutMs: timeoutMs });
  const selectedModel = await selectChatGPTModel(accessToken, settings.model);
  const allowed = normalizeAllowedTools(allowedTools);
  const responseTimeout = positiveTimeout(settings.responsesTimeoutMs) ?? DEFAULT_RESPONSES_TIMEOUT_MS;

  const body = buildResponsesRequest(selectedModel, prompt, buildChatGPTFunctionTools(allowed));

  const streamed = await withResponseTimeout(responseTimeout, signal, async (timedSignal) => {
    const response = await fetch(RESPONSES_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(body),
      signal: timedSignal
    });
    if (!response.ok) throw await httpError(response, accessToken);
    return readResponseStream(response);
  });
  const text = joinProviderText(streamed.text, renderFunctionCalls(streamed.functionCalls, allowed));
  await persistSession(
    { ...activeCreds, access_token: accessToken, last_used_at: Date.now() },
    generation,
    clientId,
    [originalRefresh, activeCreds.refresh_token || '']
  );
  if (typeof onChunk === 'function' && text) onChunk(text);
  return { completed: true, text, model: selectedModel };
}

function persistSession(creds, generation, clientId, refreshTokens) {
  return saveCredentialsIfCurrent(creds, { generation, clientId, refreshTokens });
}

// The ChatGPT-plan Responses route rejects a string `input` with HTTP 400
// "Input must be a list", and rejects explicit system message items. Send one
// user message and nothing from the unsupported-field list (background,
// conversation, max_output_tokens, max_tool_calls, metadata, moderation,
// prompt, prompt_cache_retention, safety_identifier, temperature,
// top_logprobs, top_p, truncation, user, previous_response_id).
function buildResponsesRequest(model, prompt, tools) {
  const content = typeof prompt === 'string' ? prompt : String(prompt ?? '');
  return {
    model,
    input: [{ role: 'user', content }],
    tools,
    tool_choice: 'auto',
    store: false,
    stream: true
  };
}

function positiveTimeout(value) {
  const ms = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

function responseTimeoutError(timeoutMs) {
  const error = new Error(`ChatGPT responses timed out after ${timeoutMs}ms`);
  error.code = 'timeout';
  error.name = 'TimeoutError';
  return error;
}

function combineSignals(signals) {
  const active = signals.filter(Boolean);
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  return AbortSignal.any(active);
}

async function withResponseTimeout(timeoutMs, signal, fn) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combined = combineSignals([signal, timeoutSignal]);
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      // Referenced on purpose. An unref'd timer lets the process exit while the
      // Responses request is still pending (AbortSignal.timeout is unref'd).
      timer = setTimeout(() => reject(responseTimeoutError(timeoutMs)), timeoutMs);
      fn(combined).then(resolve, (error) => {
        if (timeoutSignal.aborted && !signal?.aborted) {
          reject(responseTimeoutError(timeoutMs));
          return;
        }
        reject(error);
      });
    });
  } finally {
    clearTimeout(timer);
  }
}

export function mapChatGPTErrorToCode(error) {
  const message = error?.message || String(error);
  const code = error?.code;

  if (code === 'not_eligible' || message.includes('NOT_ELIGIBLE')) return 'not_eligible';
  if (code === 'usage_limit' || message.includes('USAGE_LIMIT_EXCEEDED')) return 'usage_limit';
  if (code === 'route_not_supported' || message.includes('ROUTE_NOT_SUPPORTED')) return 'route_not_supported';
  if (code === 'usage_unavailable' || message.includes('USAGE_UNAVAILABLE')) return 'usage_unavailable';
  if (message.includes('Not signed in')) return 'not_signed_in';

  return 'network';
}

// Responses API function names are [A-Za-z0-9_-]+, so dotted ChatPCB tools
// such as schematic.generate are sent as schematic_generate and mapped back.
const CHATGPT_TOOL_SCHEMAS = {
  'schematic.generate': {
    description: 'Preview a KiCad schematic from a natural-language circuit request. ChatPCB executes this locally.',
    properties: {
      prompt: { type: 'string', description: 'Natural-language circuit to draft.' }
    },
    required: ['prompt']
  },
  'project.create': {
    description: 'Create an empty named project directory in the ChatPCB workspace.',
    properties: {
      projectName: { type: 'string', description: 'Display name for the new project.' }
    },
    required: ['projectName']
  },
  'schematic.patch': {
    description: 'Preview a schematic edit from a natural-language request. Do not approve or apply the edit.',
    properties: {
      prompt: { type: 'string', description: 'Requested schematic change.' }
    },
    required: ['prompt']
  },
  'project.inspect': {
    description: 'Inspect the current KiCad project and return read-only evidence.',
    properties: {},
    required: []
  },
  'validate.erc': {
    description: 'Run an electrical rules check (ERC) on the current project.',
    properties: {},
    required: []
  },
  'validate.drc': {
    description: 'Run a design rules check (DRC) on the current board.',
    properties: {},
    required: []
  },
  'simulate.spice': {
    description: 'Run a SPICE simulation of the current project.',
    properties: {},
    required: []
  }
};

function normalizeAllowedTools(allowedTools) {
  const source = allowedTools == null ? PROVIDER_ALLOWED_TOOLS : allowedTools;
  return [...source];
}

function buildChatGPTFunctionTools(allowedToolNames) {
  const seen = new Set();
  return allowedToolNames.map((name) => {
    const apiName = toApiToolName(name);
    if (seen.has(apiName)) {
      throw new Error(`ChatGPT function name collision for ${name}`);
    }
    seen.add(apiName);
    const spec = CHATGPT_TOOL_SCHEMAS[name];
    if (!spec) {
      throw new Error(`No ChatGPT function schema for allowed tool: ${name}`);
    }
    return {
      type: 'function',
      name: apiName,
      description: spec.description,
      parameters: {
        type: 'object',
        properties: { ...spec.properties },
        required: [...spec.required],
        additionalProperties: false
      },
      strict: spec.strict !== false
    };
  });
}

function toApiToolName(name) {
  return String(name).replaceAll('.', '_');
}

function fromApiToolName(apiName, allowedToolNames) {
  for (const name of allowedToolNames) {
    if (name === apiName || toApiToolName(name) === apiName) return name;
  }
  return typeof apiName === 'string' ? apiName : String(apiName ?? '');
}

function joinProviderText(text, toolText) {
  if (!toolText) return text;
  if (!text) return toolText;
  return `${text}\n${toolText}`;
}

function renderFunctionCalls(functionCalls, allowedToolNames) {
  return functionCalls.map((call) => {
    const apiName = call.name || 'unknown';
    const payload = {
      id: call.callId || call.itemId,
      name: fromApiToolName(apiName, allowedToolNames),
      args: parseToolArguments(call.arguments, apiName)
    };
    validateProviderToolCall(payload, allowedToolNames);
    return JSON.stringify({ type: 'tool.call', payload });
  }).join('\n');
}

function parseToolArguments(raw, apiName) {
  if (typeof raw !== 'string') {
    throw invalidToolArguments(apiName, 'arguments must be a JSON string');
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw invalidToolArguments(apiName, error.message);
  }
}

function invalidToolArguments(apiName, detail) {
  const err = new Error(`Invalid JSON arguments for ChatGPT tool call "${apiName}": ${detail}`);
  err.code = 'invalid_tool_arguments';
  return err;
}

function noteOutputItem(state, event) {
  const item = event?.item;
  if (!item || item.type !== 'function_call') return;
  const call = bindFunctionCall(state, [item.id, outputKey(event.output_index)]);
  assignCallIdentity(call, item);
  if (event.type === 'response.output_item.done') setFinalArguments(call, item.arguments);
}

function noteArgumentDelta(state, event) {
  if (typeof event?.delta !== 'string' || event.delta.length === 0) return;
  const call = bindFunctionCall(state, [event.item_id, outputKey(event.output_index)]);
  if (call.argumentsFinal) return;
  call.arguments += event.delta;
}

function noteArgumentsDone(state, event) {
  const call = bindFunctionCall(state, [event.item_id, outputKey(event.output_index)]);
  if (typeof event?.name === 'string' && event.name) call.name = event.name;
  setFinalArguments(call, event?.arguments);
}

function noteCompletedOutput(state, event) {
  const output = event?.response?.output;
  if (!Array.isArray(output)) return;
  output.forEach((item, index) => {
    if (!item || item.type !== 'function_call') return;
    const call = bindFunctionCall(state, [item.id, outputKey(index)]);
    assignCallIdentity(call, item);
    setFinalArguments(call, item.arguments);
  });
}

function bindFunctionCall(state, keys) {
  const normalized = [];
  for (const key of keys) {
    if (key === undefined || key === null || key === '') continue;
    const text = String(key);
    if (!normalized.includes(text)) normalized.push(text);
  }
  if (normalized.length === 0) normalized.push(`anon:${state.order.length}`);

  let call = null;
  for (const key of normalized) {
    const existing = state.calls.get(key);
    if (existing) {
      call = existing;
      break;
    }
  }
  if (!call) {
    call = {
      itemId: '',
      callId: '',
      name: '',
      arguments: '',
      argumentsFinal: false
    };
    state.order.push(call);
  }
  for (const key of normalized) {
    const existing = state.calls.get(key);
    if (!existing || existing === call) state.calls.set(key, call);
  }
  return call;
}

function assignCallIdentity(call, item) {
  if (typeof item.name === 'string' && item.name) call.name = item.name;
  if (typeof item.call_id === 'string' && item.call_id) call.callId = item.call_id;
  if (typeof item.id === 'string' && item.id) call.itemId = item.id;
}

function outputKey(outputIndex) {
  return typeof outputIndex === 'number' ? `output:${outputIndex}` : null;
}

function setFinalArguments(call, argumentsText) {
  if (typeof argumentsText !== 'string') return;
  if (argumentsText.length === 0 && call.arguments.length > 0) return;
  call.arguments = argumentsText;
  call.argumentsFinal = true;
}

function catalogSlugs(payload) {
  const raw = Array.isArray(payload?.models)
    ? payload.models
    : Array.isArray(payload?.data)
      ? payload.data
      : [];
  const entries = raw.map((item) => ({
    slug: typeof item?.slug === 'string' && item.slug ? item.slug : (typeof item?.id === 'string' ? item.id : ''),
    visibility: item?.visibility
  })).filter((item) => item.slug.length > 0);
  const listed = entries.filter((item) => item.visibility === 'list');
  return (listed.length > 0 ? listed : entries).map((item) => item.slug);
}

const API_ERROR_LIMIT = 500;

async function httpError(response, accessToken) {
  const errorText = await response.text().catch(() => '');
  const parsed = parseApiError(errorText);
  const errorCode = parsed.code || 'api_error';

  if (response.status === 403 && errorCode === 'subscription_sharing_user_not_eligible') {
    const err = new Error('NOT_ELIGIBLE: This account is not eligible to use ChatGPT plan sharing');
    err.code = 'not_eligible';
    return err;
  }
  if (response.status === 403 && errorCode === 'subscription_sharing_route_not_supported') {
    const err = new Error('ROUTE_NOT_SUPPORTED: This request cannot use your ChatGPT plan');
    err.code = 'route_not_supported';
    return err;
  }
  if (response.status === 403 && errorCode === 'subscription_sharing_usage_unavailable') {
    const err = new Error('USAGE_UNAVAILABLE: ChatGPT usage is temporarily unavailable');
    err.code = 'usage_unavailable';
    return err;
  }
  if (response.status === 429 && errorCode === 'subscription_sharing_usage_limit_exceeded') {
    const err = new Error('USAGE_LIMIT_EXCEEDED: You have reached your ChatGPT usage limit');
    err.code = 'usage_limit';
    return err;
  }

  const err = new Error(formatApiError(response.status, parsed.detail, accessToken));
  err.code = maskSecrets(errorCode, accessToken);
  return err;
}

function parseApiError(errorText) {
  const text = String(errorText || '').trim();
  if (!text) return { code: '', detail: '' };
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object') return { code: '', detail: text };
    const error = data.error;
    const code = stringField(error?.code)
      || (typeof error === 'string' ? stringField(error) : '')
      || stringField(data.code);
    const detail = stringField(data.detail)
      || stringField(error?.message)
      || (typeof error === 'string' ? stringField(error) : '')
      || stringField(data.message)
      || code;
    return { code, detail: detail || '' };
  } catch {
    return { code: '', detail: text };
  }
}

function stringField(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function formatApiError(status, detail, accessToken) {
  const safe = maskSecrets(detail, accessToken).trim();
  const message = safe ? `ChatGPT API error: ${status} ${safe}` : `ChatGPT API error: ${status}`;
  return clip(message, API_ERROR_LIMIT);
}

function clip(text, limit) {
  const value = String(text ?? '');
  return value.length <= limit ? value : value.slice(0, limit);
}

function maskSecrets(text, accessToken) {
  let masked = String(text ?? '');
  // Skip very short values so a stand-in like "AT" cannot rewrite ordinary words.
  if (typeof accessToken === 'string' && accessToken.length >= 8) {
    masked = masked.split(accessToken).join('[REDACTED]');
  }
  masked = masked.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{4,}/gi, 'Bearer [REDACTED]');
  masked = masked.replace(/\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){0,2}/g, '[REDACTED]');
  return masked;
}

async function readResponseStream(response) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new Error('ChatGPT response had no stream body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const state = { text: '', completed: false, calls: new Map(), order: [] };

  try {
    while (!state.completed) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = consumeSseBuffer(buffer, state);
    }
    buffer += decoder.decode();
    if (buffer.trim()) consumeSseBuffer(`${buffer}\n`, state);
  } finally {
    reader.releaseLock();
  }

  if (!state.completed) {
    const err = new Error('ChatGPT stream ended without response.completed');
    err.code = 'stream_incomplete';
    throw err;
  }

  return { text: state.text, functionCalls: state.order };
}

function consumeSseBuffer(buffer, state) {
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? '';
  for (const line of lines) interpretSseLine(line, state);
  return rest;
}

function interpretSseLine(line, state) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return;
  const data = trimmed.slice(5).trim();
  if (!data || data === '[DONE]') return;

  let event;
  try {
    event = JSON.parse(data);
  } catch {
    throw new Error('ChatGPT stream sent malformed event data');
  }

  if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
    state.text += event.delta;
    return;
  }
  if (event.type === 'response.output_item.added' || event.type === 'response.output_item.done') {
    noteOutputItem(state, event);
    return;
  }
  if (event.type === 'response.function_call_arguments.delta') {
    noteArgumentDelta(state, event);
    return;
  }
  if (event.type === 'response.function_call_arguments.done') {
    noteArgumentsDone(state, event);
    return;
  }
  if (event.type === 'response.completed') {
    state.completed = true;
    noteCompletedOutput(state, event);
    return;
  }
  if (event.type === 'response.failed' || event.type === 'error') {
    throw failureFromResponseEvent(event);
  }
  if (event.type === 'response.incomplete') {
    const reason = event.response?.incomplete_details?.reason;
    const err = new Error(reason ? `ChatGPT response incomplete: ${reason}` : 'ChatGPT response incomplete');
    err.code = 'response_incomplete';
    throw err;
  }
}

function failureFromResponseEvent(event) {
  const error = event?.response?.error || event?.error || {};
  const code = error.code || event?.code || event?.type || 'response_failed';
  const message = typeof error.message === 'string' ? error.message : '';
  const blob = `${code} ${message}`;

  if (/usage_limit/i.test(blob)) {
    const err = new Error(`USAGE_LIMIT_EXCEEDED: ${message || 'You have reached your ChatGPT usage limit'} (${code})`);
    err.code = 'usage_limit';
    return err;
  }
  if (/usage_unavailable/i.test(blob)) {
    const err = new Error(`USAGE_UNAVAILABLE: ${message || 'ChatGPT usage is temporarily unavailable'} (${code})`);
    err.code = 'usage_unavailable';
    return err;
  }

  const err = new Error(message ? `ChatGPT response failed: ${code}: ${message}` : `ChatGPT response failed: ${code}`);
  err.code = typeof code === 'string' ? code : 'response_failed';
  return err;
}
