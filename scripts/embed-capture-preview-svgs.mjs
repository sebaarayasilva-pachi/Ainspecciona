/**
 * Incrusta los PNG de badges del preview del 2º correo como data URLs para que se vean en file:// o vista previa del editor.
 * Ejecutar desde ainspecta_web: node scripts/embed-capture-preview-svgs.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');

function toDataUriPng(filePath) {
  const buf = fs.readFileSync(filePath);
  return 'data:image/png;base64,' + buf.toString('base64');
}

const play = toDataUriPng(path.join(publicDir, 'icons/logo-google-play.png'));
const apple = toDataUriPng(path.join(publicDir, 'icons/logo-app-store.png'));

const htmlPath = path.join(publicDir, 'email-preview-capture-ejecutivo.html');
let html = fs.readFileSync(htmlPath, 'utf8');

html = html.replace(
  /<img src="icons\/logo-google-play\.png"/,
  `<img src="${play}"`
);
html = html.replace(
  /<img src="icons\/logo-app-store\.png"/,
  `<img src="${apple}"`
);

if (!html.includes('data:image/png;base64')) {
  console.error('Replace failed');
  process.exit(1);
}

fs.writeFileSync(htmlPath, html);
console.log('OK: PNG data URIs embedded in email-preview-capture-ejecutivo.html', {
  playLen: play.length,
  appleLen: apple.length
});
