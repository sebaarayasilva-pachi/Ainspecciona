import { reconObjectKeys } from './colmapPoses.js';

function readJsonBuffer(buf) {
  if (!buf?.length) return null;
  try {
    return JSON.parse(Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf));
  } catch {
    return null;
  }
}

/**
 * Lanza el pipeline de reconstrucción en Luma AI (Video-to-3D API).
 */
export class LumaReconstructionProvider {
  constructor({ storage = null, log = console } = {}) {
    this.storage = storage;
    this.log = log;
    this.apiKey = process.env.LUMA_API_KEY;
  }

  keys(scan) {
    return reconObjectKeys(scan.orgId, scan.id);
  }

  async readJson(key) {
    if (!this.storage?.readBuffer || !key) return null;
    try {
      const buf = await this.storage.readBuffer(key);
      return readJsonBuffer(buf);
    } catch (err) {
      return null;
    }
  }

  async writeJson(key, data) {
    if (!this.storage?.saveBuffer || !key) return;
    try {
      await this.storage.saveBuffer({
        buffer: Buffer.from(JSON.stringify(data)),
        contentType: 'application/json',
        storageKey: key
      });
    } catch (err) {
      this.log.error(`LumaReconstructionProvider: error writing ${key}:`, err);
    }
  }

  async submit(scanJob) {
    if (!this.apiKey) {
      this.log.error('LumaReconstructionProvider: No LUMA_API_KEY configured.');
      throw new Error('LUMA_API_KEY_MISSING');
    }

    const { id: scanId, packagePath } = scanJob;
    const keys = this.keys(scanJob);

    try {
      this.log.info(`LumaReconstructionProvider: Submitting scan ${scanId} to Luma AI...`);
      
      // 1. Leer el ZIP de GCS
      const zipBuf = await this.storage.readBuffer(packagePath);
      if (!zipBuf) throw new Error('PACKAGE_NOT_FOUND');

      // 2. Construir FormData
      const formData = new FormData();
      formData.append('title', `Scan ${scanId}`);
      formData.append('type', 'scene');
      
      const blob = new Blob([zipBuf], { type: 'application/zip' });
      formData.append('file', blob, 'capture.zip');

      // 3. Llamar a la API de Luma
      const response = await fetch('https://api.lumalabs.ai/v1/captures', {
        method: 'POST',
        headers: {
          'Authorization': `luma-api-key ${this.apiKey}`
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.log.error(`LumaReconstructionProvider: API failed with status ${response.status}: ${errorText}`);
        throw new Error(`LUMA_API_FAILED: ${response.status}`);
      }

      const result = await response.json();
      const slug = result.slug || result.id || result.capture_id;
      this.log.info(`LumaReconstructionProvider: Luma job created:`, slug);

      // 4. Guardar el slug de Luma en GCS para poder consultarlo luego
      await this.writeJson(`${keys.prefix}/luma_job.json`, {
        slug: slug,
        status: 'PROCESSING',
        progress: 0,
        submittedAt: new Date().toISOString()
      });

      return { provider: 'luma', slug: slug, submittedAt: new Date().toISOString() };
    } catch (error) {
      this.log.error(`LumaReconstructionProvider: Error submitting to Luma:`, error);
      throw error;
    }
  }

  async getStatus(scan) {
    const keys = this.keys(scan);
    
    // Si ya tenemos el result.json, entonces ya terminó todo
    const result = await this.readJson(keys.result);
    if (result?.status === 'READY' || result?.status === 'FAILED') {
      return result;
    }

    // Leemos el estado guardado de Luma
    const lumaJob = await this.readJson(`${keys.prefix}/luma_job.json`);
    if (!lumaJob || !lumaJob.slug) {
      return { status: 'PROCESSING', progress: 15 };
    }

    // Consultar a Luma el progreso actual
    if (this.apiKey) {
      try {
        const response = await fetch(`https://api.lumalabs.ai/v1/captures/${lumaJob.slug}`, {
          headers: { 'Authorization': `luma-api-key ${this.apiKey}` }
        });
        
        if (response.ok) {
          const lumaData = await response.json();
          this.log.info(`Luma status for ${lumaJob.slug}:`, lumaData.status);
          
          if (lumaData.status === 'finished' || lumaData.status === 'completed') {
            // ¡Terminó! Descargamos el modelo
            const artifacts = lumaData.artifacts || [];
            // Buscamos el GLB de alta calidad o el splat
            const meshArtifact = artifacts.find(a => a.type === 'textured_mesh_glb') 
                              || artifacts.find(a => a.type === 'textured_mesh_medpoly_glb')
                              || artifacts.find(a => a.type === 'textured_mesh_lowpoly_glb');
                              
            if (meshArtifact && meshArtifact.url) {
              this.log.info(`Downloading Luma mesh from ${meshArtifact.url}`);
              const meshRes = await fetch(meshArtifact.url);
              const meshBuffer = Buffer.from(await meshRes.arrayBuffer());
              
              const modelKey = `${keys.prefix}/model_luma.glb`;
              await this.storage.saveBuffer({
                buffer: meshBuffer,
                contentType: 'model/gltf-binary',
                storageKey: modelKey
              });

              // Escribimos result.json
              const resultJson = {
                status: 'READY',
                progress: 100,
                modelType: 'GLB',
                modelKey: modelKey,
                kind: 'luma_ai'
              };
              await this.writeJson(keys.result, resultJson);
              return resultJson;
            } else {
              // Terminó pero no hay malla
              const resultJson = { status: 'FAILED', error: 'Luma finished but no GLB artifact found' };
              await this.writeJson(keys.result, resultJson);
              return resultJson;
            }
          } else if (lumaData.status === 'failed' || lumaData.status === 'error') {
            const resultJson = { status: 'FAILED', error: 'Luma AI processing failed' };
            await this.writeJson(keys.result, resultJson);
            return resultJson;
          } else {
            // Sigue procesando
            lumaJob.progress = Math.min(90, (lumaJob.progress || 15) + 5); // Fake progress
            await this.writeJson(`${keys.prefix}/luma_job.json`, lumaJob);
            return { status: 'PROCESSING', progress: lumaJob.progress };
          }
        }
      } catch (err) {
        this.log.warn(`LumaReconstructionProvider: error polling status for ${lumaJob.slug}:`, err.message);
      }
    }
    
    return { status: 'PROCESSING', progress: lumaJob.progress || 15 };
  }

  async getResult(scan) {
    const keys = this.keys(scan);
    const result = await this.readJson(keys.result);
    if (result) return result;
    
    return { status: 'PROCESSING', progress: 15 };
  }
}
