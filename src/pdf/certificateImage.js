import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { starsFromScore } from '../scoring/scoringV2_2.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, '../../public/assets/Logo 2 ainspecciona.png');

function badgeBannerGradientId(badge) {
  const b = String(badge || '').toUpperCase();
  if (b === 'YELLOW') return 'yellowBanner';
  if (b === 'RED') return 'redBanner';
  return 'greenBanner';
}

/**
 * Genera el certificado como buffer JPG (1080x1080).
 * @param {{ score: number, badge: string, shortId: string, reportUrl: string, qrDataUri?: string }} opts
 * @returns {Promise<Buffer>} JPG buffer
 */
export async function generateCertificateImage({ score, badge, shortId, reportUrl, qrDataUri, scoreConfig }) {
  const stars = starsFromScore(score, scoreConfig);
  const bannerId = badgeBannerGradientId(badge);

  let logoDataUri = '';
  try {
    if (fs.existsSync(LOGO_PATH)) {
      const logoBuf = fs.readFileSync(LOGO_PATH);
      logoDataUri = `data:image/png;base64,${logoBuf.toString('base64')}`;
    }
  } catch (_) {}

  const starColors = Array.from({ length: 5 }, (_, i) => i < stars ? '#F6C343' : '#D1D5DB');

  const urlText = reportUrl
    ? reportUrl.replace(/^https?:\/\//, '')
    : `ainspecciona.com/cases/${shortId}/report`;
  const urlFontSize = urlText.length > 40 ? 16 : 20;

  const qrBlock = qrDataUri
    ? `<image href="${qrDataUri}" x="770" y="825" width="160" height="160" preserveAspectRatio="xMidYMid meet"/>`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1080" height="1080" viewBox="0 0 1080 1080">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#F5F6F8"/>
      <stop offset="1" stop-color="#ECEEF2"/>
    </linearGradient>
    <linearGradient id="greenBanner" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#1F7A4A"/>
      <stop offset="1" stop-color="#2DAA63"/>
    </linearGradient>
    <linearGradient id="yellowBanner" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#B8860B"/>
      <stop offset="1" stop-color="#D4A017"/>
    </linearGradient>
    <linearGradient id="redBanner" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#B91C1C"/>
      <stop offset="1" stop-color="#DC2626"/>
    </linearGradient>
    <path id="starPath" d="M20 0 L26 14 L41 15 L29 24 L33 39 L20 31 L7 39 L11 24 L-1 15 L14 14 Z"/>
  </defs>

  <rect width="1080" height="1080" fill="white"/>
  <rect x="70" y="70" rx="40" ry="40" width="940" height="940" fill="url(#bg)"/>

  <!-- Sello -->
  <g transform="translate(140 145)">
    <circle cx="70" cy="58" r="56" fill="#1F8B52"/>
    <circle cx="70" cy="58" r="46" fill="#F5FFF9"/>
    <path d="M54 58 L66 70 L88 46" fill="none" stroke="#1F8B52" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
  </g>

  <!-- Título -->
  <text x="300" y="170" text-anchor="start" font-family="Inter,Helvetica,Arial,sans-serif" font-size="44" font-weight="800" fill="#1C2B39" letter-spacing="-0.5">Propiedad Inspeccionada con</text>

  <!-- Logo -->
  ${logoDataUri ? `<image href="${logoDataUri}" x="300" y="195" width="420" height="100" preserveAspectRatio="xMidYMid meet"/>` : `<text x="510" y="260" text-anchor="middle" font-family="Inter,Helvetica,Arial,sans-serif" font-size="74" font-weight="900" fill="#123A63">Ainspecciona</text>`}
  <text x="510" y="310" text-anchor="middle" font-family="Inter,Helvetica,Arial,sans-serif" font-size="18" font-weight="500" fill="#123A63">Sistema de Inspección Inmobiliaria con IA</text>

  <!-- Estado general -->
  <g transform="translate(150 365)">
    <rect x="0" y="0" rx="18" ry="18" width="780" height="130" fill="url(#${bannerId})" opacity="0.12"/>
    <rect x="0" y="0" rx="18" ry="18" width="780" height="130" fill="none" stroke="url(#${bannerId})" stroke-width="2"/>
    <text x="390" y="32" text-anchor="middle" font-family="Inter,Helvetica,Arial,sans-serif" font-size="22" font-weight="400" fill="#56697A">Estado general del inmueble</text>
    <g transform="translate(195 48) scale(1.5)">
      <use href="#starPath" x="0" y="0" fill="${starColors[0]}"/>
      <use href="#starPath" x="52" y="0" fill="${starColors[1]}"/>
      <use href="#starPath" x="104" y="0" fill="${starColors[2]}"/>
      <use href="#starPath" x="156" y="0" fill="${starColors[3]}"/>
      <use href="#starPath" x="208" y="0" fill="${starColors[4]}"/>
    </g>
  </g>

  <line x1="120" y1="520" x2="960" y2="520" stroke="#C9D2DD" stroke-width="2"/>

  <!-- Áreas inspeccionadas -->
  <text x="150" y="590" font-family="Inter,Helvetica,Arial,sans-serif" font-size="38" font-weight="800" fill="#1C2B39">Áreas inspeccionadas</text>
  <g transform="translate(150 630)">
    <g>
      <circle cx="15" cy="15" r="15" fill="#E8F5E9"/><path d="M8 15 L12 19 L22 9" fill="none" stroke="#1F8B52" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="45" y="22" font-family="Inter,Helvetica,Arial,sans-serif" font-size="22" font-weight="600" fill="#223241">Muros y pintura</text>
    </g>
    <g transform="translate(0 44)">
      <circle cx="15" cy="15" r="15" fill="#E8F5E9"/><path d="M8 15 L12 19 L22 9" fill="none" stroke="#1F8B52" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="45" y="22" font-family="Inter,Helvetica,Arial,sans-serif" font-size="22" font-weight="600" fill="#223241">Pisos</text>
    </g>
    <g transform="translate(0 88)">
      <circle cx="15" cy="15" r="15" fill="#E8F5E9"/><path d="M8 15 L12 19 L22 9" fill="none" stroke="#1F8B52" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="45" y="22" font-family="Inter,Helvetica,Arial,sans-serif" font-size="22" font-weight="600" fill="#223241">Electricidad visible</text>
    </g>
    <g transform="translate(0 132)">
      <circle cx="15" cy="15" r="15" fill="#E8F5E9"/><path d="M8 15 L12 19 L22 9" fill="none" stroke="#1F8B52" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="45" y="22" font-family="Inter,Helvetica,Arial,sans-serif" font-size="22" font-weight="600" fill="#223241">Ventanas y cerramientos</text>
    </g>
    <line x1="455" y1="8" x2="455" y2="170" stroke="#D3DBE6" stroke-width="2"/>
    <g transform="translate(490 0)">
      <circle cx="15" cy="15" r="15" fill="#E8F5E9"/><path d="M8 15 L12 19 L22 9" fill="none" stroke="#1F8B52" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="45" y="22" font-family="Inter,Helvetica,Arial,sans-serif" font-size="22" font-weight="600" fill="#223241">Puertas y herrajes</text>
    </g>
    <g transform="translate(490 44)">
      <circle cx="15" cy="15" r="15" fill="#E8F5E9"/><path d="M8 15 L12 19 L22 9" fill="none" stroke="#1F8B52" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="45" y="22" font-family="Inter,Helvetica,Arial,sans-serif" font-size="22" font-weight="600" fill="#223241">Sanitarios</text>
    </g>
    <g transform="translate(490 88)">
      <circle cx="15" cy="15" r="15" fill="#E8F5E9"/><path d="M8 15 L12 19 L22 9" fill="none" stroke="#1F8B52" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="45" y="22" font-family="Inter,Helvetica,Arial,sans-serif" font-size="22" font-weight="600" fill="#223241">Mobiliario fijo</text>
    </g>
    <g transform="translate(490 132)">
      <circle cx="15" cy="15" r="15" fill="#E8F5E9"/><path d="M8 15 L12 19 L22 9" fill="none" stroke="#1F8B52" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="45" y="22" font-family="Inter,Helvetica,Arial,sans-serif" font-size="22" font-weight="600" fill="#223241">Humedad visible</text>
    </g>
  </g>

  <line x1="120" y1="805" x2="960" y2="805" stroke="#C9D2DD" stroke-width="2"/>

  <text x="150" y="840" font-family="Inter,Helvetica,Arial,sans-serif" font-size="18" font-weight="500" fill="#56697A">La inspección revisa estos elementos.</text>
  <text x="150" y="866" font-family="Inter,Helvetica,Arial,sans-serif" font-size="18" font-weight="500" fill="#56697A">El informe completo se puede descargar acá.</text>
  <text x="150" y="895" font-family="Inter,Helvetica,Arial,sans-serif" font-size="${urlFontSize}" font-weight="700" fill="#1C2B39">${escapeXml(urlText)}</text>

  <!-- QR -->
  <rect x="760" y="815" width="180" height="180" rx="10" ry="10" fill="#FFFFFF" stroke="#1C2B39" stroke-width="3"/>
  ${qrBlock}

  <!-- Logo footer -->
  ${logoDataUri ? `<image href="${logoDataUri}" x="150" y="940" width="280" height="70" preserveAspectRatio="xMidYMid meet"/>` : ''}
</svg>`;

  const jpgBuffer = await sharp(Buffer.from(svg))
    .resize(1080, 1080)
    .jpeg({ quality: 92 })
    .toBuffer();

  return jpgBuffer;
}

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
