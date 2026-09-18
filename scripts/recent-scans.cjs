/**
 * Lista los escaneos con package.zip mas recientes en GCS y resume la calidad de captura
 * que reporta su manifest, para decidir si vale la pena reconstruirlos.
 *
 *   node scripts/recent-scans.cjs [cantidad]
 */
const { Storage } = require('@google-cloud/storage');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BUCKET = process.env.GCS_BUCKET || 'ainspecciona-photos-852721861524';
const LIMIT = Number(process.argv[2] || 5);

const storage = new Storage();

async function readManifest(file) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scanpkg-'));
  const zipPath = path.join(tmp, 'package.zip');
  await file.download({ destination: zipPath });
  execSync(`tar -xf "${zipPath}" -C "${tmp}"`);
  const manifestPath = fs
    .readdirSync(tmp, { recursive: true })
    .map((p) => path.join(tmp, p))
    .find((p) => p.toLowerCase().endsWith('manifest.json'));
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

async function main() {
  const bucket = storage.bucket(BUCKET);
  const [files] = await bucket.getFiles({ prefix: 'scans/' });

  const packages = files
    .filter((f) => f.name.endsWith('/package.zip'))
    .sort((a, b) => new Date(b.metadata.updated) - new Date(a.metadata.updated))
    .slice(0, LIMIT);

  for (const f of packages) {
    const [, orgId, scanId] = f.name.split('/');
    console.log('='.repeat(70));
    console.log(`subido:  ${f.metadata.updated}   ${(Number(f.metadata.size) / 1024 / 1024).toFixed(2)} MB`);
    console.log(`org:     ${orgId}`);
    console.log(`scan:    ${scanId}`);

    try {
      const m = await readManifest(f);
      const c = m.capture || {};
      const q = m.quality || {};
      const i = m.frames?.[0]?.intrinsics || {};
      console.log(`device:  ${m.device?.manufacturer} ${m.device?.model}`);
      console.log(`captura: ${c.duration}s, ${Number(c.distanceTravelledMeters || 0).toFixed(2)} m, ` +
                  `${c.acceptedFrames}/${c.totalFrames} frames, cobertura ${(Number(c.estimatedCoverage || 0) * 100).toFixed(0)}%`);
      console.log(`calidad: overall ${Number(q.overall || 0).toFixed(2)}, luz ${Number(q.lighting || 0).toFixed(2)}, ` +
                  `tracking ${Number(q.tracking || 0).toFixed(2)}`);
      console.log(`imagen:  ${i.width}x${i.height}`);

      const problemas = [];
      if (Number(c.distanceTravelledMeters || 0) < 8) problemas.push('recorrido corto (<8 m)');
      if (Number(c.estimatedCoverage || 0) < 0.4) problemas.push('cobertura baja (<40%)');
      if (Number(q.lighting || 0) < 0.4) problemas.push('poca luz (<0.4)');
      if (Number(c.acceptedFrames || 0) < 100) problemas.push('pocos frames (<100)');
      if (Number(i.width || 0) * Number(i.height || 0) < 1_000_000) problemas.push('resolucion <1 MP');

      console.log(problemas.length ? `AVISO:   ${problemas.join('; ')}` : 'OK:      apto para reconstruccion');
      console.log(`\ncomando: python -B -m modal run scan-recon/modal_app.py::process_scan_bg \\\n` +
                  `  --scan-id ${scanId} --org-id ${orgId} \\\n` +
                  `  --pkg-path gs://${BUCKET}/${f.name} --bucket-name ${BUCKET}`);
    } catch (e) {
      console.log(`no se pudo leer el manifest: ${e.message}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
