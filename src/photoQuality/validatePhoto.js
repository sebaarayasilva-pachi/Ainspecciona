/**
 * Validación de calidad de fotos al capturar.
 * Límites mínimos: no se aceptan fotos borrosas, oscuras, sobreexpuestas o con poco detalle.
 * El usuario debe repetir la captura hasta cumplir los requisitos.
 */
import sharp from 'sharp';

export const PHOTO_QUALITY_THRESHOLDS = {
  // Borrosidad: varianza Laplaciana (más bajo = más borroso). Ajustado para superficies lisas.
  blurMinVariance: 22,
  blurMinVarianceSmoothSurface: 9,
  blurHardFloor: 4,
  blurHardFloorSmoothSurface: 1.5,

  // Resolución mínima en píxeles
  minWidth: 640,
  minHeight: 480,

  // Iluminación: luminancia media (0-255). Muy oscuro < 18, muy claro > 230
  brightnessMin: 18,
  brightnessMax: 230,

  // Contraste/detalle: se mantiene para debug, no bloquea capturas por falsos positivos.
  minStdDev: 10
};

function isSmoothCaptureContext(context = {}) {
  const slotCode = String(context.slotCode || '').toUpperCase();
  const slotTitle = String(context.slotTitle || '').toUpperCase();
  return slotCode.endsWith('_CEILING')
    || slotTitle.includes(' CIELO')
    || slotTitle.includes('TECHO')
    || slotTitle.includes('CERAMIC');
}

async function laplacianVarianceFromBuffer(buffer) {
  const { data, info } = await sharp(buffer)
    .rotate()
    .greyscale()
    .resize({ width: 512, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  if (!w || !h || w < 5 || h < 5) return { variance: 0, width: w, height: h };

  const step = 2;
  let count = 0;
  let mean = 0;
  let m2 = 0;

  for (let y = 1; y < h - 1; y += step) {
    for (let x = 1; x < w - 1; x += step) {
      const idx = y * w + x;
      const c = data[idx];
      const up = data[idx - w];
      const dn = data[idx + w];
      const lf = data[idx - 1];
      const rt = data[idx + 1];
      const lap = -4 * c + up + dn + lf + rt;

      count++;
      const delta = lap - mean;
      mean += delta / count;
      const delta2 = lap - mean;
      m2 += delta * delta2;
    }
  }

  const variance = count > 1 ? m2 / (count - 1) : 0;
  return { variance, width: w, height: h };
}

async function getImageStats(buffer) {
  const meta = await sharp(buffer).metadata().catch(() => ({}));
  const stats = await sharp(buffer).stats().catch(() => null);
  const width = meta.width || 0;
  const height = meta.height || 0;
  const ch = stats?.channels || [];
  // Use luminance instead of only the first channel to avoid false "dark" results.
  const mean = ch.length >= 3
    ? (0.299 * (ch[0]?.mean ?? 0)) + (0.587 * (ch[1]?.mean ?? 0)) + (0.114 * (ch[2]?.mean ?? 0))
    : (ch[0]?.mean ?? 0);
  const stdev = ch.length >= 3
    ? (0.299 * (ch[0]?.stdev ?? 0)) + (0.587 * (ch[1]?.stdev ?? 0)) + (0.114 * (ch[2]?.stdev ?? 0))
    : (ch[0]?.stdev ?? 0);
  return { width, height, mean, stdev };
}

/**
 * Valida la calidad de la imagen. Retorna { ok: true } o { ok: false, problem: {...} }.
 * Los problemas hacen que la foto sea rechazada y el usuario deba repetir la captura.
 */
export async function validatePhotoQuality(buffer, thresholds = PHOTO_QUALITY_THRESHOLDS, context = {}) {
  const t = thresholds;

  // 1) Tamaño mínimo
  const meta = await sharp(buffer).metadata().catch(() => ({}));
  const width = meta.width || 0;
  const height = meta.height || 0;
  if (width < t.minWidth || height < t.minHeight) {
    return {
      ok: false,
      problem: {
        code: 'PHOTO_TOO_SMALL',
        severity: 'medium',
        confidence: 0.95,
        message: `La imagen es demasiado pequeña. Se requiere mínimo ${t.minWidth}x${t.minHeight} píxeles. Haz una foto más cerca o en mayor resolución.`,
        debug: { width, height, min: { width: t.minWidth, height: t.minHeight } }
      }
    };
  }

  // 2) Borrosidad
  const stats = await getImageStats(buffer);
  const smoothByContext = isSmoothCaptureContext(context);
  const smoothByTexture = stats.stdev < t.minStdDev;
  const blurThreshold = (smoothByContext || smoothByTexture)
    ? t.blurMinVarianceSmoothSurface
    : t.blurMinVariance;
  const blur = await laplacianVarianceFromBuffer(buffer);
  if (blur.variance < blurThreshold) {
    const hardFloor = smoothByContext ? t.blurHardFloorSmoothSurface : t.blurHardFloor;
    const canPassSmoothSurface = (smoothByContext || smoothByTexture)
      && blur.variance >= hardFloor
      && stats.mean >= t.brightnessMin
      && stats.mean <= t.brightnessMax;
    if (!canPassSmoothSurface) {
    return {
      ok: false,
      problem: {
        code: 'PHOTO_TOO_BLURRY',
        severity: 'high',
        confidence: 0.9,
        message: 'La foto está borrosa. Acércate, enfoca bien y vuelve a capturar. Mantén el teléfono estable.',
        debug: {
          laplacianVariance: Number(blur.variance.toFixed(2)),
          threshold: blurThreshold,
          thresholdBase: t.blurMinVariance,
          thresholdSmooth: t.blurMinVarianceSmoothSurface,
          smoothByContext,
          smoothByTexture,
          blurHardFloor: t.blurHardFloor,
          blurHardFloorSmoothSurface: t.blurHardFloorSmoothSurface,
          resized: { width: blur.width, height: blur.height }
        }
      }
    };
    }
  }

  // 3) Iluminación y detalle
  if (stats.mean < t.brightnessMin) {
    return {
      ok: false,
      problem: {
        code: 'PHOTO_TOO_DARK',
        severity: 'medium',
        confidence: 0.9,
        message: 'La imagen está muy oscura. Enciende luces o usa flash. Asegura buena iluminación.',
        debug: { mean: Number(stats.mean.toFixed(2)), threshold: t.brightnessMin }
      }
    };
  }
  if (stats.mean > t.brightnessMax) {
    return {
      ok: false,
      problem: {
        code: 'PHOTO_TOO_BRIGHT',
        severity: 'medium',
        confidence: 0.85,
        message: 'La imagen está sobreexpuesta o muy clara. Evita luz directa fuerte y vuelve a capturar.',
        debug: { mean: Number(stats.mean.toFixed(2)), threshold: t.brightnessMax }
      }
    };
  }
  // No bloquear por bajo detalle: muchas fotos válidas de baños/tinas/cerámicas son lisas.

  return {
    ok: true,
    problem: {
      code: 'OK',
      severity: 'low',
      confidence: 0.9,
      message: 'Imagen válida.'
    },
    debug: {
      blur: blur.variance,
      brightness: stats.mean,
      contrast: stats.stdev,
      size: { width, height }
    }
  };
}
