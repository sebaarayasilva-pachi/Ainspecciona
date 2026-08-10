import crypto from 'node:crypto';

const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;

function maxImageBytes() {
  return Number(process.env.PROPERTYCHECK_MAX_IMAGE_BYTES || DEFAULT_MAX_BYTES);
}

/**
 * @param {{ url?: string, base64?: string, mimeType?: string, sha256?: string }} image
 * @param {import('pino').Logger | Console} [log]
 * @returns {Promise<{ buffer: Buffer, mimeType: string, sha256: string }>}
 */
export async function fetchFeedbackImageBuffer(image, log) {
  const maxBytes = maxImageBytes();
  let buffer;
  let mimeType = String(image?.mimeType || '').split(';')[0].trim() || 'image/jpeg';

  if (image?.base64) {
    const raw = String(image.base64).replace(/^data:[^;]+;base64,/, '').trim();
    buffer = Buffer.from(raw, 'base64');
    if (!buffer.length) {
      const err = new Error('IMAGE_BASE64_EMPTY');
      err.code = 'IMAGE_UNREADABLE';
      throw err;
    }
  } else if (image?.url) {
    const url = String(image.url).trim();
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) {
      log?.warn?.({ status: res.status, url: url.slice(0, 120) }, 'aintelligence-feedback-image-fetch-failed');
      const err = new Error(`IMAGE_FETCH_${res.status}`);
      err.code = 'IMAGE_UNREADABLE';
      throw err;
    }
    mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || mimeType;
    buffer = Buffer.from(await res.arrayBuffer());
  } else {
    const err = new Error('IMAGE_REQUIRED');
    err.code = 'VALIDATION';
    err.field = 'image';
    throw err;
  }

  if (buffer.length > maxBytes) {
    const err = new Error('IMAGE_TOO_LARGE');
    err.code = 'PAYLOAD_TOO_LARGE';
    throw err;
  }

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const expectedSha = String(image?.sha256 || '').trim().toLowerCase();
  if (expectedSha && expectedSha !== sha256) {
    const err = new Error('IMAGE_SHA256_MISMATCH');
    err.code = 'VALIDATION';
    err.field = 'image.sha256';
    throw err;
  }

  return { buffer, mimeType, sha256 };
}

export function mimeToExt(mimeType) {
  const m = String(mimeType || '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  return 'jpg';
}
