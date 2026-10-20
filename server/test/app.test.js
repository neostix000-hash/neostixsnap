import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createRequestHandler } from '../src/app.js';
import { readConfig } from '../src/config.js';

const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const silentLogger = { info() {}, error() {} };

function makeConfig(overrides = {}) {
  return Object.freeze({
    ...readConfig({
      AI_PROVIDER: 'openai',
      AI_API_KEY: 'test-key',
      AI_MODEL: 'gpt-4.1-mini',
      EXTENSION_TOKEN: 'test-token'
    }),
    ...overrides
  });
}

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await callback(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('health reports configuration without secrets', async () => {
  const config = makeConfig();
  const handler = createRequestHandler({ config, logger: silentLogger });
  await withServer(handler, async (base) => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.ready, true);
    assert.equal(body.provider, 'openai');
    assert.equal(body.authRequired, true);
    const text = JSON.stringify(body);
    assert.equal(text.includes('test-key'), false);
    assert.equal(text.includes('test-token'), false);
  });
});

test('solve requires the configured access token', async () => {
  const config = makeConfig();
  const handler = createRequestHandler({ config, logger: silentLogger });
  await withServer(handler, async (base) => {
    const response = await fetch(`${base}/api/solve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: PNG_1X1, language: 'auto' })
    });
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.error.code, 'unauthorized');
  });
});

test('solve validates the image after authenticating', async () => {
  const config = makeConfig();
  const handler = createRequestHandler({ config, logger: silentLogger });
  await withServer(handler, async (base) => {
    const response = await fetch(`${base}/api/solve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-token'
      },
      body: JSON.stringify({ image: 'data:image/png;base64,AAAA', language: 'auto' })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'invalid_image');
  });
});

test('solve returns the injected solver result', async () => {
  const config = makeConfig();
  let received = null;
  const fakeSolve = async (input) => {
    received = input;
    return {
      result: { status: 'answered', answer: '4', steps: ['2 + 2 = 4'] },
      meta: { provider: 'fake', model: 'fake-vision', durationMs: 1 }
    };
  };
  const handler = createRequestHandler({ config, solve: fakeSolve, logger: silentLogger });
  await withServer(handler, async (base) => {
    const response = await fetch(`${base}/api/solve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-token'
      },
      body: JSON.stringify({ image: PNG_1X1, language: 'cs', regenerate: true })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.result.answer, '4');
    assert.equal(received.language, 'cs');
    assert.equal(received.regenerate, true);
    assert.equal(received.image.mime, 'image/png');
    assert.ok(body.requestId);
  });
});

test('rate limiting returns 429 with Retry-After', async () => {
  const config = makeConfig({ rateLimitMax: 1 });
  const fakeSolve = async () => ({
    result: { status: 'answered', answer: 'ok' },
    meta: {}
  });
  const handler = createRequestHandler({ config, solve: fakeSolve, logger: silentLogger });
  await withServer(handler, async (base) => {
    const request = () =>
      fetch(`${base}/api/solve`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-token'
        },
        body: JSON.stringify({ image: PNG_1X1, language: 'auto' })
      });
    assert.equal((await request()).status, 200);
    const limited = await request();
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) >= 1);
    assert.equal((await limited.json()).error.code, 'rate_limited');
  });
});

test('model overrides are rejected unless enabled', async () => {
  const config = makeConfig();
  const handler = createRequestHandler({ config, logger: silentLogger });
  await withServer(handler, async (base) => {
    const response = await fetch(`${base}/api/solve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-token'
      },
      body: JSON.stringify({ image: PNG_1X1, language: 'auto', model: 'other-model' })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'client_model_not_allowed');
  });
});

test('requests from unlisted web origins are blocked', async () => {
  const config = makeConfig({
    allowedOrigins: ['chrome-extension://abcdefghijklmnopabcdefghijklmnop']
  });
  const handler = createRequestHandler({ config, logger: silentLogger });
  await withServer(handler, async (base) => {
    const response = await fetch(`${base}/health`, {
      headers: { origin: 'https://evil.example' }
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'origin_not_allowed');
  });
});
