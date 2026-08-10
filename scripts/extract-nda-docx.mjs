/**
 * Extrae texto de un .docx (OOXML) a HTML simple para preview.
 * Uso: node scripts/extract-nda-docx.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const docxPath = path.join(root, 'public', 'assets', 'Acuerdo de Confidencialidad Ainspecciona.docx');
const outPath = path.join(root, 'public', 'toctoc', 'nda-preview.html');

async function extractWithAdmZip() {
  let AdmZip;
  try {
    AdmZip = require('adm-zip');
  } catch {
    return null;
  }
  const zip = new AdmZip(docxPath);
  const entry = zip.getEntry('word/document.xml');
  if (!entry) throw new Error('document.xml not found');
  return entry.getData().toString('utf8');
}

async function extractWithUnzip() {
  const { execFileSync } = await import('node:child_process');
  const tmp = path.join(root, 'tmp-nda-xml');
  fs.mkdirSync(tmp, { recursive: true });
  try {
    execFileSync('tar', ['-xf', docxPath, '-C', tmp, 'word/document.xml'], { stdio: 'pipe' });
  } catch {
    // Windows: try Expand-Archive via powershell after copy as zip
    const zipCopy = path.join(tmp, 'nda.zip');
    fs.copyFileSync(docxPath, zipCopy);
    execFileSync(
      'powershell',
      ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipCopy}' -DestinationPath '${tmp}' -Force`],
      { stdio: 'pipe' }
    );
  }
  const xmlPath = path.join(tmp, 'word', 'document.xml');
  return fs.readFileSync(xmlPath, 'utf8');
}

function xmlToParagraphs(xml) {
  const paras = [];
  const re = /<w:p[\s\S]*?<\/w:p>/g;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[0];
    const texts = [];
    const tRe = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
    let tm;
    while ((tm = tRe.exec(block))) {
      texts.push(
        tm[1]
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
      );
    }
    const line = texts.join('').trim();
    if (line) paras.push(line);
  }
  return paras;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const xml = (await extractWithAdmZip()) || (await extractWithUnzip());
const paras = xmlToParagraphs(xml);
const body = paras.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');

const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Acuerdo de Confidencialidad · Ainspecciona</title>
  <style>
    body {
      margin: 0;
      padding: 24px 20px 40px;
      font-family: "Source Sans 3", "Segoe UI", sans-serif;
      font-size: 14px;
      line-height: 1.55;
      color: #1a222c;
      background: #fff;
    }
    h1 { font-size: 18px; margin: 0 0 16px; }
    p { margin: 0 0 12px; }
    .meta { color: #64748b; font-size: 12px; margin-bottom: 20px; }
  </style>
</head>
<body>
  <h1>Acuerdo de Confidencialidad — Ainspecciona</h1>
  <p class="meta">Vista previa del documento. Versión partner TOC TOC.</p>
  ${body}
</body>
</html>
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html, 'utf8');
console.log('Wrote', outPath, 'paragraphs:', paras.length);
