/** Valida que el <script type="module"> del visor compile sin errores de sintaxis. */
const fs = require('fs');
const vm = require('vm');

const file = process.argv[2] || 'public/scan/viewer.html';
const html = fs.readFileSync(file, 'utf8');
const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!m) {
  console.error('no se encontro el script de modulo');
  process.exit(1);
}
const body = m[1].replace(/^\s*import\b.*$/gm, '');
try {
  vm.compileFunction(body, [], {});
  console.log('sintaxis OK');
} catch (e) {
  console.error('error de sintaxis:', e.message);
  process.exit(1);
}
