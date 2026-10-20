import { AppError } from './errors.js';

const DATA_URL_RE = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/i;

function normalizeMime(mime) {
  const lower = mime.toLowerCase();
  return lower === 'image/jpg' ? 'image/jpeg' : lower;
}

function magicMatches(buffer, mime) {
  if (mime === 'image/png') {
    return (
      buffer.length > 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    );
  }
  if (mime === 'image/jpeg') {
    return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mime === 'image/webp') {
    return (
      buffer.length > 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    );
  }
  return false;
}

export function parseImageDataUrl(value, maxBytes) {
  if (typeof value !== 'string' || value.length < 32) {
    throw new AppError('invalid_image', 'No valid screenshot was included.', 400);
  }
  if (value.length > Math.ceil(maxBytes * 1.5)) {
    throw new AppError('payload_too_large', 'The screenshot is too large.', 413, {
      help: 'Select a smaller area or capture at a lower browser zoom.'
    });
  }
  const match = value.match(DATA_URL_RE);
  if (!match) {
    throw new AppError(
      'invalid_image',
      'The screenshot must be a base64 PNG, JPEG, or WebP image.',
      400
    );
  }
  const mime = normalizeMime(match[1]);
  const base64 = match[2].replace(/\s+/g, '');
  let buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch {
    throw new AppError('invalid_image', 'The screenshot could not be decoded.', 400);
  }
  if (!buffer.length) {
    throw new AppError('invalid_image', 'The screenshot is empty.', 400);
  }
  if (buffer.length > maxBytes) {
    throw new AppError('payload_too_large', 'The screenshot is too large.', 413, {
      help: 'Select a smaller area or capture at a lower browser zoom.'
    });
  }
  if (!magicMatches(buffer, mime)) {
    throw new AppError('invalid_image', 'The screenshot data does not match its image type.', 400);
  }
  return {
    mime,
    base64,
    buffer,
    bytes: buffer.length,
    dataUrl: `data:${mime};base64,${base64}`
  };
}
