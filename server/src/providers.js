import { ProviderError } from './errors.js';
import { buildOutputJsonSchema, RESULT_SCHEMA_NAME } from './result.js';
import { buildSystemPrompt } from './prompt.js';

function endpointForOpenAI(baseUrl) {
  const base = baseUrl.replace(/\/+$/, '');
  return base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

function endpointForAnthropic(baseUrl) {
  const base = baseUrl.replace(/\/+$/, '');
  return base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`;
}

function parseRetryAfter(value) {
  if (!value) return null;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds)) return Math.max(1, seconds);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(1, Math.ceil((date - Date.now()) / 1000));
  return null;
}

function extractProviderMessage(bodyText) {
  try {
    const parsed = JSON.parse(bodyText);
    return String(parsed?.error?.message || parsed?.message || '').slice(0, 1000);
  } catch {
    return bodyText.slice(0, 500);
  }
}

/**
 * Read the full response inside the timeout window. The previous version
 * cleared its timer as soon as headers arrived, so a provider that sent
 * headers and then stalled could hold a solve slot indefinitely.
 */
async function fetchTextWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } catch (error) {
    if (timedOut || error?.name === 'AbortError') {
      throw new ProviderError('The AI provider timed out.', { timedOut: true });
    }
    throw new ProviderError('The AI provider could not be reached.', {
      network: true,
      cause: error
    });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  return {
    inputTokens:
      usage.prompt_tokens ?? usage.input_tokens ?? usage.inputTokens ?? null,
    outputTokens:
      usage.completion_tokens ?? usage.output_tokens ?? usage.outputTokens ?? null,
    totalTokens: usage.total_tokens ?? usage.totalTokens ?? null
  };
}

function textFromOpenAIContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        return '';
      })
      .join('');
  }
  return '';
}

async function callOpenAICompatible({
  config,
  image,
  userText,
  systemText,
  model,
  temperature,
  maxTokens
}) {
  const body = {
    model,
    messages: [
      { role: 'system', content: systemText },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: image.dataUrl, detail: 'high' }
          },
          { type: 'text', text: userText }
        ]
      }
    ],
    temperature,
    [config.tokenParam]: maxTokens,
    stream: false
  };

  if (config.responseFormat === 'json_schema') {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: RESULT_SCHEMA_NAME,
        strict: true,
        schema: buildOutputJsonSchema()
      }
    };
  } else if (config.responseFormat === 'json_object') {
    body.response_format = { type: 'json_object' };
  }

  const headers = {
    'content-type': 'application/json',
    accept: 'application/json',
    'user-agent': `NeostixSnap/${config.serverVersion}`
  };
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
  if (config.provider === 'openrouter') {
    headers['x-title'] = 'NeostixSnap';
  }

  const endpoint = endpointForOpenAI(config.baseUrl);
  let exchange = await fetchTextWithTimeout(
    endpoint,
    { method: 'POST', headers, body: JSON.stringify(body) },
    config.aiTimeoutMs
  );
  let response = exchange.response;
  let bodyText = exchange.text;

  if (response.status === 400) {
    const providerMessage = extractProviderMessage(bodyText);
    const parameterIssue = /response_format|json_schema|json_object|temperature|max_tokens|max_completion_tokens|unsupported parameter|unknown parameter/i.test(
      providerMessage
    );

    if (parameterIssue) {
      const fallbackBody = {
        ...body,
        messages: body.messages
      };
      delete fallbackBody.response_format;
      delete fallbackBody.temperature;
      delete fallbackBody[config.tokenParam];
      fallbackBody[config.tokenParam === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens'] =
        maxTokens;

      exchange = await fetchTextWithTimeout(
        endpoint,
        { method: 'POST', headers, body: JSON.stringify(fallbackBody) },
        config.aiTimeoutMs
      );
      response = exchange.response;
      bodyText = exchange.text;
    } else {
      throw new ProviderError(`The AI provider rejected the request (HTTP 400).`, {
        status: 400,
        providerCode: 'bad_request'
      });
    }
  }

  if (!response.ok) {
    const providerMessage = extractProviderMessage(bodyText);
    throw new ProviderError(`The AI provider returned HTTP ${response.status}.`, {
      status: response.status,
      providerCode: providerMessage ? providerMessage.slice(0, 300) : null,
      retryAfter: parseRetryAfter(response.headers.get('retry-after'))
    });
  }

  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch (error) {
    throw new ProviderError('The AI provider returned an invalid response.', {
      invalidOutput: true,
      cause: error
    });
  }

  const choice = payload?.choices?.[0];
  const content = textFromOpenAIContent(choice?.message?.content);
  if (!content.trim()) {
    throw new ProviderError('The AI provider returned no answer.', {
      invalidOutput: true,
      providerCode: choice?.finish_reason || choice?.message?.refusal || null
    });
  }

  return {
    text: content,
    usage: normalizeUsage(payload?.usage),
    finishReason: choice?.finish_reason ?? null
  };
}

async function callAnthropic({
  config,
  image,
  userText,
  systemText,
  model,
  temperature,
  maxTokens
}) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json',
    'x-api-key': config.apiKey,
    'anthropic-version': '2023-06-01',
    'user-agent': `NeostixSnap/${config.serverVersion}`
  };

  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    system: systemText,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: image.mime,
              data: image.base64
            }
          },
          { type: 'text', text: userText }
        ]
      }
    ]
  };

  const exchange = await fetchTextWithTimeout(
    endpointForAnthropic(config.baseUrl),
    { method: 'POST', headers, body: JSON.stringify(body) },
    config.aiTimeoutMs
  );
  const { response, text: bodyText } = exchange;

  if (!response.ok) {
    const providerMessage = extractProviderMessage(bodyText);
    throw new ProviderError(`The AI provider returned HTTP ${response.status}.`, {
      status: response.status,
      providerCode: providerMessage ? providerMessage.slice(0, 300) : null,
      retryAfter: parseRetryAfter(response.headers.get('retry-after'))
    });
  }

  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch (error) {
    throw new ProviderError('The AI provider returned an invalid response.', {
      invalidOutput: true,
      cause: error
    });
  }

  const text = Array.isArray(payload?.content)
    ? payload.content
        .filter((part) => part?.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('')
    : '';
  if (!text.trim()) {
    throw new ProviderError('The AI provider returned no answer.', {
      invalidOutput: true,
      providerCode: payload?.stop_reason || null
    });
  }

  return {
    text,
    usage: normalizeUsage(payload?.usage),
    finishReason: payload?.stop_reason ?? null
  };
}

export async function requestCompletion(options) {
  const config = options.config;
  if (config.apiStyle === 'anthropic') {
    return callAnthropic(options);
  }
  return callOpenAICompatible(options);
}

export { buildSystemPrompt };
