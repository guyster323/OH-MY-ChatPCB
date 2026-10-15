import { loadCredentials, refreshAccessToken, saveCredentials, verifyTokenExpiry } from '../auth/chatgpt-auth.js';

const RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';

export async function callChatGPTResponses({ prompt, onChunk, signal }) {
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
      console.error('Token refresh failed:', error.message);
    }
  }

  const body = {
    model: 'auto',
    messages: [
      { role: 'user', content: prompt }
    ],
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
        throw new Error('NOT_ELIGIBLE: This account is not eligible to use ChatGPT plan sharing');
      }
      if (errorCode === 'subscription_sharing_route_not_supported') {
        throw new Error('ROUTE_NOT_SUPPORTED: This request cannot use your ChatGPT plan');
      }
    }

    if (response.status === 429 && errorCode === 'subscription_sharing_usage_limit_exceeded') {
      throw new Error('USAGE_LIMIT_EXCEEDED: You have reached your ChatGPT usage limit');
    }

    throw new Error(errorMessage);
  }

  // Stream the response
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        
        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            if (data.choices?.[0]?.delta?.content) {
              const content = data.choices[0].delta.content;
              if (onChunk) onChunk(content);
            }
          } catch {
            // Skip malformed chunks
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function mapChatGPTErrorToCode(error) {
  const message = error?.message || String(error);
  
  if (message.includes('NOT_ELIGIBLE')) return 'not_eligible';
  if (message.includes('USAGE_LIMIT_EXCEEDED')) return 'usage_limit';
  if (message.includes('ROUTE_NOT_SUPPORTED')) return 'route_not_supported';
  if (message.includes('Not signed in')) return 'not_signed_in';
  
  return 'network';
}
