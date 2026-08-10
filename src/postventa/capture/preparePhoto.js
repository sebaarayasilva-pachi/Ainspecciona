import sharp from 'sharp';
import {
  PHOTO_QUALITY_THRESHOLDS,
  validatePhotoQuality
} from '../../photoQuality/validatePhoto.js';

/** Umbrales más permisivos: muros, baños y manchas suelen fallar blur en inspecciones STI. */
export const POSTVENTA_PHOTO_QUALITY_THRESHOLDS = {
  ...PHOTO_QUALITY_THRESHOLDS,
  minWidth: 480,
  minHeight: 360,
  blurMinVariance: 0,
  blurMinVarianceSmoothSurface: 0,
  blurHardFloor: 0,
  blurHardFloorSmoothSurface: 0
};

/**
 * Normaliza imagen subida (HEIC/HEIF → JPEG) y valida calidad postventa.
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {{ slotCode?: string, slotTitle?: string, instructions?: string }} context
 */
export async function prepareAndValidatePostventaPhoto(buffer, mimeType, context = {}) {
  let workBuffer = buffer;
  let outMime = String(mimeType || '').toLowerCase() || 'image/jpeg';

  if (outMime === 'image/heic' || outMime === 'image/heif') {
    workBuffer = await sharp(workBuffer).rotate().jpeg({ quality: 88 }).toBuffer();
    outMime = 'image/jpeg';
  }

  const meta = await sharp(workBuffer).metadata().catch(() => ({}));
  const w = meta.width || 0;
  const h = meta.height || 0;
  if (w > 2400 || h > 2400) {
    workBuffer = await sharp(workBuffer)
      .rotate()
      .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer();
    outMime = 'image/jpeg';
  }

  const qualityResult = await validatePhotoQuality(
    workBuffer,
    POSTVENTA_PHOTO_QUALITY_THRESHOLDS,
    context
  );

  return { buffer: workBuffer, mimeType: outMime, qualityResult };
}
