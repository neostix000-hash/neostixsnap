import crypto from 'node:crypto';
import { readBearerToken, tokenMatches } from './auth.js';
import { AppError, publicError } from './errors.js';
import { parseImageDataUrl } from './image.js';
import { FixedWindowRateLimiter, Semaphore } from './rate-limit.js';
import { solveWithAI } from './solve.js';
import { LANGUAGE_LABELS } from './prompt.js';

const ALLOWED_LANGUAGES = new Set(Object.keys(LANGUAGE_LABELS));
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;
const EXTENSION_ORIGIN_RE = /^chrome-extension:\/\/[a-p]{32}$/;

function resolveCorsOrigin(req, config) {
  const origin = req.headers.origin;
  if (!origin) return null;
  if (config.allowedOrigins.includes('*') || config.allowedOrigins.includes(origin)) {
    return origin;
  }
  if (config.allowedOrigins.length === 0 && EXTENSION_ORIGIN_RE.test(origin)) {
    return origin;
  }
  return false;
}

function clientIp(req, config) {
  if (config.trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      return forwarded.split(',')[0].trim();
    }
  }
  return req.socket.remoteAddress || 'unknown';
}

function baseHeaders(corsOrigin) {
  return {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...(corsOrigin
      ? {
          'access-control-allow-origin': corsOrigin,
          vary: 'Origin',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers':
            'authorization, content-type, x-neostix-client, x-neostix-version',
          'access-control-max-age': '600'
        }
      : {})
  };
}

function sendJson(res, status, body, corsOrigin, extraHeaders = {}) {
  if (res.headersSent || res.writableEnded) return;
  const headers = {
    ...baseHeaders(corsOrigin),
    'content-type': 'application/json; charset=utf-8',
    ...extraHeaders
  };
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

async function readJsonBody(req, limitBytes) {
  const contentType = String(req.headers['content-type'] || '');
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new AppError('unsupported_media_type', 'Send the request as application/json.', 415);
  }
  const contentLength = Number.parseInt(req.headers['content-length'] || '', 10);
  if (Number.isFinite(contentLength) && contentLength > limitBytes) {
    throw new AppError('payload_too_large', 'The request is too large.', 413);
  }

  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) {
      throw new AppError('payload_too_large', 'The request is too large.', 413);
    }
    chunks.push(chunk);
  }
  if (!size) {
    throw new AppError('invalid_json', 'The request body is empty.', 400);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError('invalid_json', 'The request body is not valid JSON.', 400);
  }
}

export function createRequestHandler({
  config,
  solve = solveWithAI,
  logger = console,
  now = Date.now
}) {
  const solveLimiter = new FixedWindowRateLimiter({
    max: config.rateLimitMax,
    windowMs: config.rateLimitWindowMs,
    now
  });
  const healthLimiter = new FixedWindowRateLimiter({
    max: config.healthRateLimitMax,
    windowMs: config.rateLimitWindowMs,
    now
  });
  const semaphore = new Semaphore({
    limit: config.maxConcurrent,
    maxQueue: config.maxQueue
  });

  return async function handler(req, res) {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    const corsOrigin = resolveCorsOrigin(req, config);
    let status = 500;
    let code = null;

    const logRequest = () => {
      if (!logger?.info) return;
      logger.info(
        `[${new Date().toISOString()}] ${requestId.slice(0, 8)} ${req.method} ${req.url} ${status} ${Date.now() - startedAt}ms${code ? ` ${code}` : ''}`
      );
    };

    try {
      if (corsOrigin === false) {
        throw new AppError('origin_not_allowed', 'This origin is not allowed to use the backend.', 403);
      }

      if (req.method === 'OPTIONS') {
        if (!corsOrigin) {
          throw new AppError('origin_required', 'CORS preflight requires an Origin header.', 400);
        }
        status = 204;
        res.writeHead(204, baseHeaders(corsOrigin));
        res.end();
        return;
      }

      const url = new URL(req.url || '/', 'http://localhost');
      const path = url.pathname.replace(/\/+$/, '') || '/';

      if (path === '/health' && req.method === 'GET') {
        const limit = healthLimiter.consume(clientIp(req, config));
        if (!limit.allowed) {
          throw new AppError('rate_limited', 'Too many requests.', 429, {
            retryAfter: Math.ceil(limit.retryAfterMs / 1000)
          });
        }
        status = 200;
        sendJson(
          res,
          200,
          {
            ok: true,
            service: 'neostixsnap',
            version: config.serverVersion,
            provider: config.provider,
            model: config.model,
            ready: config.ready,
            authRequired: Boolean(config.extensionToken),
            problems: config.ready ? [] : config.problems,
            timestamp: new Date().toISOString()
          },
          corsOrigin
        );
        return;
      }

      if (path === '/api/solve' && req.method === 'POST') {
        const limit = solveLimiter.consume(clientIp(req, config));
        if (!limit.allowed) {
          throw new AppError('rate_limited', 'Too many solve requests. Please wait a moment.', 429, {
            retryAfter: Math.ceil(limit.retryAfterMs / 1000)
          });
        }

        if (config.extensionToken) {
          const provided = readBearerToken(req.headers.authorization);
          if (!tokenMatches(config.extensionToken, provided)) {
            throw new AppError(
              'unauthorized',
              'The extension access token is missing or invalid.',
              401
            );
          }
        }

        const body = await readJsonBody(req, config.bodyLimitBytes);
        const language = body.language === undefined ? 'auto' : String(body.language);
        if (!ALLOWED_LANGUAGES.has(language)) {
          throw new AppError('invalid_language', 'Unsupported answer language.', 400);
        }

        let model = '';
        if (body.model !== undefined && body.model !== null && String(body.model).trim() !== '') {
          if (!config.allowClientModel) {
            throw new AppError(
              'client_model_not_allowed',
              'Model overrides are disabled on this backend.',
              400,
              { help: 'Leave the model field blank, or set ALLOW_CLIENT_MODEL=true on the server.' }
            );
          }
          model = String(body.model).trim();
          if (!MODEL_RE.test(model)) {
            throw new AppError('invalid_model', 'The model name is invalid.', 400);
          }
        }

        const image = parseImageDataUrl(body.image, config.maxImageBytes);
        const regenerate = body.regenerate === true;

        await semaphore.acquire();
        try {
          if (res.destroyed) return;
          const solved = await solve({
            image,
            language,
            regenerate,
            model,
            config
          });
          status = 200;
          sendJson(
            res,
            200,
            {
              requestId,
              result: solved.result,
              meta: {
                ...solved.meta,
                requestId
              }
            },
            corsOrigin
          );
        } finally {
          semaphore.release();
        }
        return;
      }

      if (path === '/api/solve') {
        throw new AppError('method_not_allowed', 'Use POST for this endpoint.', 405);
      }
      throw new AppError('not_found', 'Not found.', 404);
    } catch (error) {
      const safe = publicError(error);
      status = error instanceof AppError ? error.status : 500;
      code = safe.code;
      const headers = {};
      if (error instanceof AppError && error.retryAfter) {
        headers['retry-after'] = String(error.retryAfter);
        safe.retryAfter = error.retryAfter;
      }
      if (!(error instanceof AppError) && logger?.error) {
        logger.error(`[${requestId}] Unhandled server error:`, error?.stack || error);
      }
      if (error?.code === 'payload_too_large') headers.connection = 'close';
      sendJson(res, status, { requestId, error: safe }, corsOrigin, headers);
    } finally {
      logRequest();
    }
  };
}
