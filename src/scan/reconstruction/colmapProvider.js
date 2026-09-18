import { gcsObjectKey, reconObjectKeys } from './colmapPoses.js';

async function metadataAccessToken() {
  const res = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' } }
  );
  if (!res.ok) throw new Error(`METADATA_TOKEN ${res.status}`);
  const data = await res.json();
  if (!data?.access_token) throw new Error('METADATA_TOKEN_EMPTY');
  return data.access_token;
}

function readJsonBuffer(buf) {
  if (!buf?.length) return null;
  try {
    return JSON.parse(Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf));
  } catch {
    return null;
  }
}

/**
 * Lanza el Cloud Run Job COLMAP y lee status/result desde GCS.
 */
export class ColmapReconstructionProvider {
  constructor({ storage = null, log = console, fetchImpl = fetch } = {}) {
    this.storage = storage;
    this.log = log;
    this.fetchImpl = fetchImpl;
    this.job = process.env.SCAN_RECON_JOB || 'ainspecciona-scan-recon';
    this.region = process.env.SCAN_RECON_REGION || 'southamerica-west1';
    this.project = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'ainspecciona';
    this.bucket = process.env.GCS_BUCKET || '';
  }

  keys(scan) {
    return reconObjectKeys(scan.orgId, scan.id);
  }

  enabled() {
    return Boolean(this.job && this.storage?.readBuffer && this.bucket);
  }

  async submit(scan) {
    if (!this.enabled() || !scan?.id) return null;
    const keys = this.keys(scan);
    const packagePath = gcsObjectKey(scan.packagePath, this.bucket) || keys.packageZip;
    if (this.storage.saveBuffer) {
      await this.storage.saveBuffer({
        buffer: Buffer.from(JSON.stringify({ status: 'QUEUED', progress: 5, step: 'submit' })),
        contentType: 'application/json',
        storageKey: keys.status
      });
    }
    const token = await metadataAccessToken();
    const url = `https://run.googleapis.com/v2/projects/${this.project}/locations/${this.region}/jobs/${this.job}:run`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        overrides: {
          containerOverrides: [
            {
              env: [
                { name: 'SCAN_ID', value: String(scan.id) },
                { name: 'ORG_ID', value: String(scan.orgId) },
                { name: 'PACKAGE_PATH', value: packagePath },
                { name: 'GCS_BUCKET', value: this.bucket }
              ]
            }
          ]
        }
      })
    });
    const text = await res.text();
    if (!res.ok) {
      this.log.warn?.({ status: res.status, text: text.slice(0, 400) }, 'scan-recon-run-failed');
      throw new Error(`JOB_RUN_FAILED ${res.status}`);
    }
    let name = '';
    try {
      name = JSON.parse(text)?.name || '';
    } catch {
      name = '';
    }
    return name || `job-${scan.id}`;
  }

  async readJson(key) {
    if (!this.storage?.readBuffer || !key) return null;
    try {
      return readJsonBuffer(await this.storage.readBuffer(key));
    } catch {
      return null;
    }
  }

  async getStatus(scan) {
    const keys = this.keys(scan);
    const status = await this.readJson(keys.status);
    if (status) return status;
    const result = await this.readJson(keys.result);
    if (result?.status) return result;
    return { status: 'PROCESSING', progress: scan.processingProgress || 15 };
  }

  async getResult(scan) {
    const keys = this.keys(scan);
    const result = await this.readJson(keys.result);
    if (result) return result;
    const status = await this.readJson(keys.status);
    return status || { status: 'PROCESSING', progress: 15 };
  }
}
