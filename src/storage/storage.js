import fs from 'node:fs';
import crypto from 'node:crypto';
import { join } from 'path';
import { Storage } from '@google-cloud/storage';

function isHttpUrl(s) {
  return typeof s === 'string' && (s.startsWith('http://') || s.startsWith('https://'));
}

function publicUrlFromGcs(bucket, object) {
  // Public bucket/object URL
  const encoded = object
    .split('/')
    .map((p) => encodeURIComponent(p))
    .join('/');
  return `https://storage.googleapis.com/${bucket}/${encoded}`;
}

export function createStorage() {
  const driver = String(process.env.STORAGE_DRIVER || 'local').toLowerCase(); // local | gcs
  const uploadDir = process.env.UPLOAD_DIR || null;
  const gcsBucket = process.env.GCS_BUCKET || null;

  if (driver === 'gcs') {
    if (!gcsBucket) {
      throw new Error('STORAGE_DRIVER=gcs requiere GCS_BUCKET');
    }

    const storage = new Storage();
    const bucket = storage.bucket(gcsBucket);

    return {
      driver: 'gcs',
      async saveImageBuffer({ buffer, contentType, ext, caseId }) {
        const id = crypto.randomUUID();
        const safeExt = String(ext || '').replace('.', '');
        const object = `cases/${caseId}/${id}.${safeExt}`;

        await bucket.file(object).save(buffer, {
          contentType,
          resumable: false,
          metadata: {
            cacheControl: 'public, max-age=31536000'
          }
        });

        const publicUrl = publicUrlFromGcs(gcsBucket, object);
        // Para el MVP guardamos directamente la URL pública (simple para front/back)
        const filePath = publicUrl;
        return { id, filePath, publicUrl, storedFileName: `${id}.${safeExt}` };
      },
      async readBuffer(filePath) {
        if (isHttpUrl(filePath)) {
          const res = await fetch(filePath);
          if (!res.ok) throw new Error(`HTTP_FETCH_FAILED ${res.status}`);
          const ab = await res.arrayBuffer();
          return Buffer.from(ab);
        }
        throw new Error('FILEPATH_NOT_HTTP_URL');
      },
      publicUrl(filePath) {
        if (!filePath) return null;
        if (isHttpUrl(filePath)) return filePath;
        // If someone stored a relative path accidentally, return it as /path
        return String(filePath).startsWith('/') ? filePath : `/${filePath}`;
      }
    };
  }

  // local
  const dir = uploadDir || join(process.cwd(), 'uploads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  return {
    driver: 'local',
    async saveImageBuffer({ buffer, contentType, ext }) {
      const id = crypto.randomUUID();
      const safeExt = String(ext || '').replace('.', '');
      const storedFileName = `${id}.${safeExt}`;
      const absPath = join(dir, storedFileName);
      await fs.promises.writeFile(absPath, buffer);
      const filePath = `uploads/${storedFileName}`;
      return { id, filePath, publicUrl: `/${filePath}`, storedFileName };
    },
    async readBuffer(filePath) {
      if (!filePath) throw new Error('NO_FILE_PATH');
      if (isHttpUrl(filePath)) {
        const res = await fetch(filePath);
        if (!res.ok) throw new Error(`HTTP_FETCH_FAILED ${res.status}`);
        const ab = await res.arrayBuffer();
        return Buffer.from(ab);
      }
      // support /uploads/x or uploads/x
      const p = String(filePath).replace(/^[/\\]+/, '');
      const absPath = join(process.cwd(), p);
      return await fs.promises.readFile(absPath);
    },
    publicUrl(filePath) {
      if (!filePath) return null;
      if (isHttpUrl(filePath)) return filePath;
      return String(filePath).startsWith('/') ? filePath : `/${filePath}`;
    }
  };
}

