import crypto from 'node:crypto';

export function readBearerToken(headerValue) {
  if (typeof headerValue !== 'string') return '';
  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

/**
 * Constant-time comparison. Both values are hashed first so different-length
 * tokens do not leak length through timingSafeEqual.
 */
export function tokenMatches(expected, provided) {
  if (!expected) return true;
  if (!provided) return false;
  const expectedDigest = crypto.createHash('sha256').update(String(expected)).digest();
  const providedDigest = crypto.createHash('sha256').update(String(provided)).digest();
  return crypto.timingSafeEqual(expectedDigest, providedDigest);
}
