const { Storage } = require('@google-cloud/storage');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const storage = new Storage();
const BUCKET = 'ainspecciona-photos-852721861524';
const ORG = 'ddb05a08-348e-4435-9b66-be453397ccbc';
const SCAN = 'be3f3470-b5ef-4743-bb81-b6138638f4a6';

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scanpkg-'));
  const zipPath = path.join(tmp, 'package.zip');
  await storage.bucket(BUCKET).file(`scans/${ORG}/${SCAN}/package.zip`).download({ destination: zipPath });

  execSync(`tar -xf "${zipPath}" -C "${tmp}"`);

  const manifestPath = fs
    .readdirSync(tmp, { recursive: true })
    .map((p) => path.join(tmp, p))
    .find((p) => p.toLowerCase().endsWith('manifest.json'));

  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  console.log('--- claves de nivel superior ---');
  for (const [k, v] of Object.entries(m)) {
    if (k === 'frames') { console.log(`frames: Array(${v.length})`); continue; }
    console.log(`${k}: ${JSON.stringify(v)}`);
  }

  console.log('\n--- primer frame ---');
  console.log(JSON.stringify(m.frames[0], null, 2));

  console.log('\n--- intrinsics distintos entre frames ---');
  const uniq = new Set(m.frames.map((f) => JSON.stringify(f.intrinsics)));
  for (const u of uniq) console.log(u);

  console.log(`\n--- total frames en manifest: ${m.frames.length} ---`);
  console.log(`temp dir: ${tmp}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
