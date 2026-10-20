import { AppError, ProviderError } from './errors.js';
import { buildRepairText, buildSystemPrompt, buildUserText } from './prompt.js';
import { requestCompletion } from './providers.js';
import { normalizeResult, parseModelJson } from './result.js';

function mapProviderError(error) {
  if (error instanceof AppError) return error;
  if (!(error instanceof ProviderError)) {
    return new AppError('internal_error', 'The solver failed unexpectedly.', 500, {
      expose: false,
      cause: error
    });
  }
  if (error.timedOut) {
    return new AppError(
      'ai_timeout',
      'The AI took too long to answer. Try again, or select a smaller area.',
      504,
      { cause: error }
    );
  }
  if (error.network) {
    return new AppError(
      'ai_unreachable',
      'The backend could not reach the AI provider. Check the server network and configuration.',
      502,
      { cause: error }
    );
  }
  if (error.status === 401 || error.status === 403) {
    return new AppError(
      'ai_auth_error',
      'The AI provider rejected the server API key. Check AI_API_KEY on the server.',
      502,
      { cause: error }
    );
  }
  if (error.status === 429) {
    return new AppError(
      'ai_rate_limited',
      'The AI provider is rate-limiting requests. Wait a moment and regenerate.',
      503,
      { retryAfter: error.retryAfter || 15, cause: error }
    );
  }
  if (error.status === 400 || error.status === 413 || error.status === 422) {
    return new AppError(
      'ai_rejected',
      'The AI provider rejected the screenshot or model configuration. Try a smaller, clearer capture.',
      502,
      { cause: error }
    );
  }
  if (error.invalidOutput) {
    return new AppError(
      'ai_invalid_output',
      'The AI returned an unreadable response. Press Regenerate to try again.',
      502,
      { cause: error }
    );
  }
  return new AppError(
    'ai_unavailable',
    'The AI provider is unavailable right now. Try again shortly.',
    502,
    { cause: error }
  );
}

export async function solveWithAI({
  image,
  language = 'auto',
  regenerate = false,
  model = '',
  config,
  provider = requestCompletion
}) {
  if (!config.ready) {
    throw new AppError(
      'server_misconfigured',
      'The backend is running but AI is not configured yet.',
      503,
      { help: 'Set AI_PROVIDER, AI_MODEL, and AI_API_KEY in the server environment.' }
    );
  }

  const startedAt = Date.now();
  const systemText = buildSystemPrompt();
  const userText = buildUserText({ language, regenerate });
  const selectedModel = model || config.model;
  const temperature = Math.min(
    0.7,
    Math.max(0, config.temperature + (regenerate ? 0.12 : 0))
  );
  let completion;
  let repaired = false;

  try {
    completion = await provider({
      config,
      image,
      systemText,
      userText,
      model: selectedModel,
      temperature,
      maxTokens: config.maxOutputTokens
    });
  } catch (error) {
    throw mapProviderError(error);
  }

  let result;
  try {
    result = normalizeResult(parseModelJson(completion.text));
  } catch (firstError) {
    if (!(firstError instanceof AppError) || firstError.code !== 'ai_invalid_output') {
      throw mapProviderError(firstError);
    }

    try {
      const repair = await provider({
        config,
        image,
        systemText,
        userText: buildRepairText({
          previousOutput: completion.text,
          reason: firstError.message
        }),
        model: selectedModel,
        temperature: 0.1,
        maxTokens: config.maxOutputTokens
      });
      result = normalizeResult(parseModelJson(repair.text));
      completion = repair;
      repaired = true;
    } catch (repairError) {
      throw mapProviderError(
        repairError instanceof AppError
          ? repairError
          : repairError instanceof ProviderError
            ? repairError
            : repairError
      );
    }
  }

  return {
    result,
    meta: {
      provider: config.provider,
      model: selectedModel,
      durationMs: Date.now() - startedAt,
      repaired,
      imageBytes: image.bytes,
      usage: completion.usage ?? null,
      finishReason: completion.finishReason ?? null
    }
  };
}
