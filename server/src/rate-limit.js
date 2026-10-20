import { AppError } from './errors.js';

export class FixedWindowRateLimiter {
  constructor({ max, windowMs, now = Date.now } = {}) {
    if (!Number.isInteger(max) || max < 1) throw new Error('max must be a positive integer');
    if (!Number.isInteger(windowMs) || windowMs < 1) throw new Error('windowMs must be a positive integer');
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
    this.buckets = new Map();
    this.lastSweep = now();
  }

  sweep(now = this.now()) {
    if (now - this.lastSweep < this.windowMs) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
    this.lastSweep = now;
  }

  consume(key) {
    const now = this.now();
    this.sweep(now);
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    const allowed = bucket.count <= this.max;
    return {
      allowed,
      remaining: Math.max(0, this.max - bucket.count),
      retryAfterMs: allowed ? 0 : Math.max(1, bucket.resetAt - now),
      resetAt: bucket.resetAt
    };
  }
}

export class Semaphore {
  constructor({ limit, maxQueue = 10 } = {}) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('limit must be a positive integer');
    this.limit = limit;
    this.maxQueue = maxQueue;
    this.active = 0;
    this.queue = [];
  }

  acquire() {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    if (this.queue.length >= this.maxQueue) {
      return Promise.reject(
        new AppError(
          'busy',
          'The AI solver is busy right now. Please try again in a few seconds.',
          503,
          { retryAfter: 5 }
        )
      );
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
    });
  }

  release() {
    const next = this.queue.shift();
    if (next) {
      next.resolve();
      return;
    }
    if (this.active > 0) this.active -= 1;
  }
}
