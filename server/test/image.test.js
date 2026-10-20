import assert from 'node:assert/strict';
import test from 'node:test';
import { parseImageDataUrl } from '../src/image.js';

const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('accepts a valid PNG data URL', () => {
  const image = parseImageDataUrl(PNG_1X1, 1024 * 1024);
  assert.equal(image.mime, 'image/png');
  assert.ok(image.bytes > 10);
  assert.equal(image.dataUrl, PNG_1X1);
});

test('rejects unsupported data URL formats', () => {
  assert.throws(
    () => parseImageDataUrl('data:image/svg+xml;base64,PHN2Zy8+', 1024),
    /base64 PNG, JPEG, or WebP/
  );
});

test('rejects a MIME type that does not match the bytes', () => {
  const fakeJpeg = PNG_1X1.replace('image/png', 'image/jpeg');
  assert.throws(() => parseImageDataUrl(fakeJpeg, 1024 * 1024), /does not match/);
});

test('enforces the byte limit', () => {
  assert.throws(
    () => parseImageDataUrl(PNG_1X1, 10),
    (error) => error.code === 'payload_too_large'
  );
});
