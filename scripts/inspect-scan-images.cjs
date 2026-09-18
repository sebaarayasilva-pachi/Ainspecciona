const { Storage } = require('@google-cloud/storage');
const storage = new Storage();

const BUCKET = 'ainspecciona-photos-852721861524';
const ORG = 'ddb05a08-348e-4435-9b66-be453397ccbc';
const SCAN = 'be3f3470-b5ef-4743-bb81-b6138638f4a6';

function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

async function main() {
  const bucket = storage.bucket(BUCKET);
  const prefix = `scans/${ORG}/${SCAN}`;

  const [imgs] = await bucket.getFiles({ prefix: `${prefix}/recon/colmap/images/` });
  console.log(`--- imagenes en colmap/images: ${imgs.length} ---`);
  const sizes = {};
  for (const f of imgs.slice(0, 8)) {
    const [buf] = await f.download();
    const s = jpegSize(buf);
    const key = `${s.width}x${s.height}`;
    sizes[key] = (sizes[key] || 0) + 1;
    console.log(`${f.name.split('/').pop()}  ${key}  ${(buf.length / 1024).toFixed(0)} KB`);
  }

  const [all] = await bucket.getFiles({ prefix: `${prefix}/` });
  console.log('\n--- artefactos del scan ---');
  for (const f of all) {
    if (f.name.includes('/recon/colmap/images/') || f.name.includes('/frames/')) continue;
    console.log(`${f.name.replace(prefix + '/', '')}  ${(Number(f.metadata.size) / 1024 / 1024).toFixed(2)} MB  ${f.metadata.updated}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
