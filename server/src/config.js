import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_VERSION = '1.0.0';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PROVIDER_PRESETS = Object.freeze({
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    apiStyle: 'openai'
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'google/gemini-2.5-flash',
    apiStyle: 'openai'
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5',
    apiStyle: 'anthropic'
  },
  ollama: {
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: '',
    apiStyle: 'openai'
  },
  'openai-compatible': {
    baseUrl: '',
    model: '',
    apiStyle: 'openai'
  }
});

function unquote(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      const inner = value.slice(1, -1);
      if (first === '"') {
        return inner
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
      }
      return inner;
    }
  }
  const comment = value.search(/\s#/);
  return (comment === -1 ? value : value.slice(0, comment)).trim();
}

/**
 * Minimal .env reader so the server has zero npm dependencies.
 * Existing process environment variables always win.
 */
export function loadEnvFile(filePath = path.join(SERVER_DIR, '.env')) {
  if (!fs.existsSync(filePath)) return false;
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return false;
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals < 1) continue;
    const key = line.slice(0, equals).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    process.env[key] = unquote(line.slice(equals + 1).trim());
  }
  return true;
}

function intValue(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function boolValue(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function normalizeBaseUrl(value) {
  if (!value || typeof value !== 'string') return '';
  return value.trim().replace(/\/+$/, '');
}

export function isLoopbackHost(host) {
  return new Set(['127.0.0.1', 'localhost', '::1', '[::1]']).has(String(host).toLowerCase());
}

export function readConfig(env = process.env) {
  const provider = String(env.AI_PROVIDER || 'openai').trim().toLowerCase();
  const preset = PROVIDER_PRESETS[provider];
  if (!preset) {
    throw new Error(
      `Unsupported AI_PROVIDER "${provider}". Use one of: ${Object.keys(PROVIDER_PRESETS).join(', ')}.`
    );
  }

  const baseUrl = normalizeBaseUrl(env.AI_BASE_URL || preset.baseUrl);
  const model = String(env.AI_MODEL || preset.model || '').trim();
  const apiKey = String(env.AI_API_KEY || '').trim();
  const extensionToken = String(env.EXTENSION_TOKEN || '').trim();
  const host = String(env.HOST || '127.0.0.1').trim();
  const port = intValue(env.PORT, 8787, { min: 1, max: 65535 });
  const aiTimeoutMs = intValue(env.AI_TIMEOUT_MS, 60000, { min: 5000, max: 180000 });
  const requestTimeoutMs = intValue(env.REQUEST_TIMEOUT_MS, 90000, {
    min: 10000,
    max: 240000
  });
  const maxImageBytes = intValue(env.MAX_IMAGE_BYTES, 6 * 1024 * 1024, {
    min: 100 * 1024,
    max: 20 * 1024 * 1024
  });
  const bodyLimitBytes = intValue(env.BODY_LIMIT_BYTES, Math.ceil(maxImageBytes * 1.45) + 65536, {
    min: 128 * 1024,
    max: 32 * 1024 * 1024
  });
  const allowedOrigins = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const formatSetting = String(env.AI_RESPONSE_FORMAT || 'auto').trim().toLowerCase();
  const responseFormat =
    formatSetting === 'auto'
      ? provider === 'openai'
        ? 'json_schema'
        : provider === 'openrouter'
          ? 'json_object'
          : 'none'
      : formatSetting;

  const tokenParam =
    String(env.AI_TOKEN_PARAM || '').trim() ||
    (provider === 'openai' ? 'max_completion_tokens' : 'max_tokens');

  const problems = [];
  if (!baseUrl) problems.push('AI_BASE_URL is empty and this provider has no default.');
  if (!model) problems.push('AI_MODEL is empty. Set a multimodal (vision) model.');
  if (['openai', 'openrouter', 'anthropic'].includes(provider) && !apiKey) {
    problems.push('AI_API_KEY is required for this provider.');
  }

  return Object.freeze({
    provider,
    apiStyle: preset.apiStyle,
    baseUrl,
    model,
    apiKey,
    extensionToken,
    host,
    port,
    allowedOrigins,
    trustProxy: boolValue(env.TRUST_PROXY, false),
    allowInsecureBind: boolValue(env.ALLOW_INSECURE_BIND, false),
    aiTimeoutMs,
    requestTimeoutMs,
    maxImageBytes,
    bodyLimitBytes,
    maxOutputTokens: intValue(env.AI_MAX_OUTPUT_TOKENS, 2500, { min: 256, max: 16000 }),
    temperature: Math.min(1, Math.max(0, Number(env.AI_TEMPERATURE) || 0.2)),
    responseFormat: ['json_schema', 'json_object', 'none'].includes(responseFormat)
      ? responseFormat
      : 'none',
    tokenParam: ['max_tokens', 'max_completion_tokens'].includes(tokenParam)
      ? tokenParam
      : 'max_tokens',
    maxConcurrent: intValue(env.MAX_CONCURRENT_AI, 3, { min: 1, max: 20 }),
    maxQueue: intValue(env.MAX_QUEUE, 8, { min: 0, max: 100 }),
    rateLimitWindowMs: intValue(env.RATE_LIMIT_WINDOW_MS, 60000, {
      min: 1000,
      max: 3600000
    }),
    rateLimitMax: intValue(env.RATE_LIMIT_MAX, 20, { min: 1, max: 10000 }),
    healthRateLimitMax: intValue(env.HEALTH_RATE_LIMIT_MAX, 120, { min: 1, max: 10000 }),
    allowClientModel: boolValue(env.ALLOW_CLIENT_MODEL, false),
    ready: problems.length === 0,
    problems,
    serverVersion: SERVER_VERSION
  });
}

export function assertSafeBinding(config) {
  if (isLoopbackHost(config.host)) return;
  if (config.extensionToken || config.allowInsecureBind) return;
  throw new Error(
    [
      'Refusing to bind the AI proxy to a non-loopback address without EXTENSION_TOKEN.',
      'Set a long EXTENSION_TOKEN and the same value in NeostixSnap settings, or set',
      'ALLOW_INSECURE_BIND=true only for a short-lived local test.'
    ].join(' ')
  );
}

export { PROVIDER_PRESETS };
