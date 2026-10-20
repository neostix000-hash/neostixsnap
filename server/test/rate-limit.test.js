import assert from 'node:assert/strict';
import test from 'node:test';
import { FixedWindowRateLimiter, Semaphore } from '../src/rate-limit.js';

test('fixed-window limiter rejects requests over the limit and recovers', () => {
  let now = 1_000;
  const limiter = new FixedWindowRateLimiter({ max: 2, windowMs: 1000, now: () => now });
  assert.equal(limiter.consume('ip').allowed, true);
  assert.equal(limiter.consume('ip').allowed, true);
  const rejected = limiter.consume('ip');
  assert.equal(rejected.allowed, false);
  assert.ok(rejected.retryAfterMs > 0);
  now += 1000;
  assert.equal(limiter.consume('ip').allowed, true);
});

test('semaphore queues work and rejects when the queue is full', async () => {
  const semaphore = new Semaphore({ limit: 1, maxQueue: 1 });
  await semaphore.acquire();
  const queued = semaphore.acquire();
  await assert.rejects(() => semaphore.acquire(), /busy/);
  semaphore.release();
  await queued;
  semaphore.release();
  assert.equal(semaphore.active, 0);
});
