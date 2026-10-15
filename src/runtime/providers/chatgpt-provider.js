import { loadCredentials, refreshAccessToken, saveCredentials, verifyTokenExpiry } from '../auth/chatgpt-auth.js';

const RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';

export async function callChatGPTResponses({ prompt, onChunk, onError, signal }) {
  const creds = await loadCredentials();
  
  if (!creds || !creds.access_token) {
    throw new Error('Not signed in to ChatGPT');
  }

  // Check if token needs refresh
  const tokenStatus = verifyTokenExpiry(creds);
  let accessToken = creds.access_token;

  if (tokenStatus.shouldRefresh && creds.refresh_token) {
    try {
      const refreshed = await refreshAccessToken(creds.refresh_token, creds.client_id);
      const newCreds = {
        ...creds,
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token || creds.refresh_token,
        expires_in: refreshed.expires_in,
        issued_at: Date.now()
      };
      await saveCredentials(newCreds);
      accessToken = refreshed.access_token;
    } catch (error) {
      // If refresh fails, try with existing token
      if (onError) onError({ code: 'refresh_failed', message: error.message });
    }
  }

  // Get account models - for now use a default model
  // In production, should fetch from account.models endpoint
  const model = 'chatgpt-4o-latest';

  const body = {
    model,
    input: prompt, // Use 'input' not 'messages'
    store: false,
    stream: true
  };

  const response = await fetch(RESPONSES_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    
    // Parse OpenAI error format
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

    // Handle specific error codes from the docs
    if (response.status === 403) {
      if (errorCode === 'subscription_sharing_user_not_eligible') {
        const err = new Error('NOT_ELIGIBLE: This account is not eligible to use ChatGPT plan sharing');
        err.code = 'not_eligible';
        throw err;
      }
      if (errorCode === 'subscription_sharing_route_not_supported') {
        const err = new Error('ROUTE_NOT_SUPPORTED: This request cannot use your ChatGPT plan');
        err.code = 'route_not_supported';
        throw err;
      }
      if (errorCode === 'subscription_sharing_usage_unavailable') {
        const err = new Error('USAGE_UNAVAILABLE: ChatGPT usage is temporarily unavailable');
        err.code = 'usage_unavailable';
        throw err;
      }
    }

    if (response.status === 429 && errorCode === 'subscription_sharing_usage_limit_exceeded') {
      const err = new Error('USAGE_LIMIT_EXCEEDED: You have reached your ChatGPT usage limit');
      err.code = 'usage_limit';
      throw err;
    }

    const err = new Error(errorMessage);
    err.code = errorCode;
    throw err;
  }

  // Stream the response
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') {
          if (trimmed === 'data: [DONE]') completed = true;
          continue;
        }
        
        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            
            // Handle response.completed event
            if (data.type === 'response.completed') {
              completed = true;
              continue;
            }
            
            // Handle delta events with content
            if (data.type === 'response.output_text.delta' && data.delta) {
              if (onChunk) onChunk(data.delta);
            } else if (data.choices?.[0]?.delta?.content) {
              // Fallback to standard format
              const content = data.choices[0].delta.content;
              if (onChunk) onChunk(content);
            }
          } catch (parseError) {
            // Skip malformed chunks
            if (onError) onError({ code: 'parse_error', message: parseError.message });
          }
        }
      }
    }
  } catch (streamError) {
    // Handle mid-stream failures
    if (onError) onError({ code: 'stream_error', message: streamError.message });
    throw streamError;
  } finally {
    reader.releaseLock();
  }

  return { completed };
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
