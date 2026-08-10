import { prepareAndValidatePostventaPhoto } from './preparePhoto.js';

const VIDEO_MIMES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/3gpp',
  'video/3gp'
]);

const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

/**
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {{ slotCode?: string, mediaType?: string }} context
 */
export async function preparePostventaMedia(buffer, mimeType, context = {}) {
  const mime = String(mimeType || '').toLowerCase();
  const wantsVideo = context.mediaType === 'video';
  const isVideoMime = VIDEO_MIMES.has(mime) || mime.startsWith('video/');

  if (wantsVideo && !isVideoMime) {
    return {
      ok: false,
      problem: {
        code: 'VIDEO_REQUIRED',
        message: 'Este paso requiere un video (MP4 o MOV), no una foto.'
      }
    };
  }

  if (!wantsVideo && isVideoMime) {
    return {
      ok: false,
      problem: {
        code: 'PHOTO_REQUIRED',
        message: 'Este paso requiere una foto, no un video.'
      }
    };
  }

  if (VIDEO_MIMES.has(mime) || wantsVideo) {
    if (!VIDEO_MIMES.has(mime) && !mime.startsWith('video/')) {
      return {
        ok: false,
        problem: {
          code: 'INVALID_VIDEO',
          message: 'Sube un video MP4 o MOV (máx. 25 MB).'
        }
      };
    }
    if (buffer.length > MAX_VIDEO_BYTES) {
      return {
        ok: false,
        problem: {
          code: 'VIDEO_TOO_LARGE',
          message: 'El video es muy pesado. Graba uno más corto (máx. 25 MB).'
        }
      };
    }
    const outMime = mime === 'video/3gp' ? 'video/3gpp' : mime;
    return { ok: true, buffer, mimeType: outMime, isVideo: true };
  }

  const result = await prepareAndValidatePostventaPhoto(buffer, mimeType, context);
  if (!result.qualityResult.ok) {
    return { ok: false, problem: result.qualityResult.problem };
  }
  return {
    ok: true,
    buffer: result.buffer,
    mimeType: result.mimeType,
    isVideo: false
  };
}

export function extFromPostventaMime(mime) {
  const map = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'video/3gpp': '3gp',
    'video/3gp': '3gp'
  };
  return map[String(mime || '').toLowerCase()] || null;
}
