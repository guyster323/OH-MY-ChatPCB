import { loadCredentials, refreshAccessToken, resolveChatGPTSettings, saveCredentials, verifyTokenExpiry } from '../auth/chatgpt-auth.js';

const RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';
const MODELS_ENDPOINT = 'https://api.openai.com/v1/models';

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
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Failed to list ChatGPT models: ${response.status} ${text}`.trim());
  }

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

export async function callChatGPTResponses({ prompt, onChunk, onError, signal, model } = {}) {
  const creds = await loadCredentials();

  if (!creds || !creds.access_token) {
    throw new Error('Not signed in to ChatGPT');
  }

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
      await saveCredentials(activeCreds);
      accessToken = refreshed.access_token;
    } catch (error) {
      if (onError) onError({ code: 'refresh_failed', message: error.message });
    }
  }

  const settings = await resolveChatGPTSettings({ model });
  const selectedModel = await selectChatGPTModel(accessToken, settings.model);

  const body = {
    model: selectedModel,
    input: prompt,
    store: false,
    stream: true
  };

  const response = await fetch(RESPONSES_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok) {
    throw await httpError(response);
  }

  const text = await readResponseStream(response);
  await saveCredentials({ ...activeCreds, access_token: accessToken, last_used_at: Date.now() });
  if (typeof onChunk === 'function' && text) onChunk(text);
  return { completed: true, text, model: selectedModel };
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

async function httpError(response) {
  const errorText = await response.text().catch(() => '');
  let errorCode = 'api_error';
  let errorMessage = `ChatGPT API error: ${response.status}`;

  try {
    const errorData = JSON.parse(errorText);
    if (errorData.error) {
      errorCode = errorData.error.code || errorCode;
      errorMessage = errorData.error.message || errorMessage;
    }
  } catch {
    errorMessage = errorText || errorMessage;
  }

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

  const err = new Error(errorMessage);
  err.code = errorCode;
  return err;
}

async function readResponseStream(response) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new Error('ChatGPT response had no stream body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const state = { text: '', completed: false };

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

  return state.text;
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
  if (event.type === 'response.completed') {
    state.completed = true;
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
