/**
 * Sigue las transiciones de recon/status.json y recon/result.json de un escaneo en GCS.
 * Sirve para verificar que el scan solo pase a READY cuando la malla esta lista.
 *
 *   node scripts/watch-scan-status.cjs <orgId> <scanId> [segundos]
 */
const { Storage } = require('@google-cloud/storage');

const BUCKET = process.env.GCS_BUCKET || 'ainspecciona-photos-852721861524';
const [orgId, scanId, secs] = process.argv.slice(2);
const deadline = Date.now() + (Number(secs) || 900) * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readJson(bucket, name) {
  try {
    const [buf] = await bucket.file(name).download();
    return JSON.parse(buf);
  } catch {
    return null;
  }
}

async function main() {
  const bucket = new Storage().bucket(BUCKET);
  const prefix = `scans/${orgId}/${scanId}/recon`;
  let last = '';

  while (Date.now() < deadline) {
    const st = await readJson(bucket, `${prefix}/status.json`);
    const rs = await readJson(bucket, `${prefix}/result.json`);
    const line =
      `status.json: ${st?.status} ${st?.progress}% ${st?.step || ''}` +
      `   |   result.json: ${rs?.status} kind=${rs?.kind} faces=${rs?.faceCount}`;
    if (line !== last) {
      console.log(new Date().toISOString().slice(11, 19), line);
      last = line;
    }
    if (st?.status === 'READY' || st?.status === 'FAILED') return;
    await sleep(4000);
  }
  console.log('tiempo agotado');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
