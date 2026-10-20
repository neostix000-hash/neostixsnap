export class AppError extends Error {
  constructor(code, message, status = 400, options = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.retryAfter = options.retryAfter ?? null;
    this.help = options.help ?? null;
    this.cause = options.cause;
    this.expose = options.expose ?? true;
  }
}

export class ProviderError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = options.status ?? 0;
    this.providerCode = options.providerCode ?? null;
    this.retryAfter = options.retryAfter ?? null;
    this.timedOut = options.timedOut ?? false;
    this.network = options.network ?? false;
    this.invalidOutput = options.invalidOutput ?? false;
    this.cause = options.cause;
  }
}

export function publicError(error) {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.expose ? error.message : 'The request could not be completed.',
      ...(error.help ? { help: error.help } : {}),
      ...(error.retryAfter ? { retryAfter: error.retryAfter } : {})
    };
  }
  return { code: 'internal_error', message: 'Something went wrong on the server.' };
}
