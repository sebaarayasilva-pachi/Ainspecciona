/**
 * Descarga el model.glb de un escaneo y reporta si contiene una malla o una nube de puntos.
 *
 *   node scripts/inspect-glb.cjs <orgId> <scanId>
 */
const { Storage } = require('@google-cloud/storage');

const BUCKET = process.env.GCS_BUCKET || 'ainspecciona-photos-852721861524';
const [orgId, scanId] = process.argv.slice(2);

const MODES = { 0: 'POINTS', 1: 'LINES', 4: 'TRIANGLES' };

async function main() {
  const bucket = new Storage().bucket(BUCKET);
  const prefix = `scans/${orgId}/${scanId}`;

  for (const name of [`${prefix}/model.glb`, `${prefix}/recon/result.json`]) {
    const [meta] = await bucket.file(name).getMetadata();
    console.log(`${name.replace(prefix + '/', '')}  ${(Number(meta.size) / 1024 / 1024).toFixed(2)} MB  ${meta.updated}`);
  }

  const [result] = await bucket.file(`${prefix}/recon/result.json`).download();
  const r = JSON.parse(result);
  console.log(`\nresult.json -> modelType=${r.modelType} kind=${r.kind} pointCount=${r.pointCount} faceCount=${r.faceCount}`);
  console.log(`result.json -> modelKey=${r.modelKey}`);

  const [glb] = await bucket.file(`${prefix}/model.glb`).download();
  const jsonLen = glb.readUInt32LE(12);
  const gltf = JSON.parse(glb.slice(20, 20 + jsonLen).toString('utf8'));

  console.log('\n--- contenido del GLB ---');
  console.log(`generador: ${gltf.asset?.generator || '(sin dato)'}`);
  console.log(`materiales: ${gltf.materials?.length || 0}   texturas: ${gltf.textures?.length || 0}   imagenes: ${gltf.images?.length || 0}`);

  for (const mesh of gltf.meshes || []) {
    for (const p of mesh.primitives) {
      const mode = p.mode === undefined ? 4 : p.mode;
      const posCount = gltf.accessors[p.attributes.POSITION].count;
      const idxCount = p.indices !== undefined ? gltf.accessors[p.indices].count : 0;
      console.log(
        `primitiva: mode=${MODES[mode] || mode}  vertices=${posCount}  ` +
        `indices=${idxCount}${idxCount ? ` (${idxCount / 3} caras)` : ''}  ` +
        `atributos=[${Object.keys(p.attributes).join(', ')}]`
      );
    }
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
