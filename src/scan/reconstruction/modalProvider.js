// import fetch from 'node-fetch'; // Usar fetch nativo de Node 18+
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
 * Lanza el pipeline de reconstrucción (COLMAP + Gaussian Splatting) en Modal.
 */
export class ModalReconstructionProvider {
  constructor({ webhookUrl, storage = null, log = console } = {}) {
    this.webhookUrl = webhookUrl;
    this.storage = storage;
    this.log = log;
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
      // Ignorar el error si es un 404 (el archivo aún no existe)
      if (err.message && !err.message.includes('404')) {
        this.log.error(`ModalReconstructionProvider: error reading ${key}:`, err.message);
      }
      return null;
    }
  }

  async submit(scanJob) {
    if (!this.webhookUrl) {
      this.log.error('ModalReconstructionProvider: No webhook URL configured.');
      throw new Error('MODAL_WEBHOOK_URL_MISSING');
    }

    const { id: scanId, orgId, packagePath } = scanJob;
    const bucketName = process.env.GCS_BUCKET || 'ainspecciona-photos-852721861524';

    try {
      this.log.info(`ModalReconstructionProvider: Submitting scan ${scanId} to Modal Webhook...`);
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scan_id: scanId,
          org_id: orgId,
          pkg_path: packagePath,
          bucket_name: bucketName
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.log.error(`ModalReconstructionProvider: Webhook failed with status ${response.status}: ${errorText}`);
        throw new Error(`MODAL_WEBHOOK_FAILED: ${response.status}`);
      }

      const result = await response.json();
      this.log.info(`ModalReconstructionProvider: Webhook response:`, result);

      if (!result.ok) {
         throw new Error(`MODAL_WEBHOOK_RETURNED_ERROR: ${result.error}`);
      }

      return { provider: 'modal', submittedAt: new Date().toISOString() };
    } catch (error) {
      this.log.error(`ModalReconstructionProvider: Error submitting to webhook:`, error);
      throw error;
    }
  }

  async getStatus(scan) {
    const keys = this.keys(scan);
    
    // Si ya tenemos el result.json con SPLAT_PLY, entonces ya terminó todo
    const result = await this.readJson(keys.result);
    this.log.info('ModalReconstructionProvider: read result.json', result?.status, result?.modelType);
    if (result?.status === 'READY' && (result?.modelType === 'SPLAT_PLY' || result?.modelType === 'SPLAT' || result?.modelType === 'GAUSSIAN_SPLAT')) {
      return result;
    }

    const splatStatus = await this.readJson(`${keys.prefix}/recon/splat_status.json`);
    this.log.info('ModalReconstructionProvider: read splat_status.json', splatStatus);
    if (splatStatus) {
      if (splatStatus.step === 'done') {
         splatStatus.status = 'READY';
      } else {
         splatStatus.status = 'PROCESSING'; // Para que maybeFinalizeScan lo entienda
      }
      return splatStatus;
    }
    
    // Si no, leemos el status normal de colmap
    const status = await this.readJson(keys.status);
    if (status) return status;
    
    if (result?.status) return result;
    
    return { status: 'PROCESSING', progress: scan.processingProgress || 15 };
  }

  async getResult(scan) {
    const keys = this.keys(scan);
    
    // Si splat_status.json dice que terminó, forzamos el result para que apunte al .ply
    const splatStatus = await this.readJson(`${keys.prefix}/recon/splat_status.json`);
    if (splatStatus && splatStatus.step === 'done' && splatStatus.modelKey) {
       const result = await this.readJson(keys.result) || {};
       return {
         ...result,
         status: 'READY',
         modelType: 'SPLAT',
         modelKey: splatStatus.modelKey
       };
    }

    const result = await this.readJson(keys.result);
    if (result) return result;
    
    const status = await this.readJson(keys.status);
    return status || { status: 'PROCESSING', progress: 15 };
  }
}
