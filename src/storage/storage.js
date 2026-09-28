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
      async saveImageBuffer({ buffer, contentType, ext, caseId, tenantId, storageKey }) {
        const id = crypto.randomUUID();
        const safeExt = String(ext || '').replace('.', '');
        const object = storageKey
          ? String(storageKey)
          : tenantId
            ? `tenants/${tenantId}/logo.${safeExt}`
            : `cases/${caseId}/${id}.${safeExt}`;

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
          const match = filePath.match(new RegExp(`https://storage\\.googleapis\\.com/${gcsBucket.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(.+)`));
          if (match) {
            const object = decodeURIComponent(match[1].replace(/\/+/g, '/'));
            const [buf] = await bucket.file(object).download();
            return buf;
          }
          const res = await fetch(filePath);
          if (!res.ok) throw new Error(`HTTP_FETCH_FAILED ${res.status}`);
          const ab = await res.arrayBuffer();
          return Buffer.from(ab);
        }
        const key = String(filePath || '').replace(/^[/\\]+/, '');
        if (!key) throw new Error('NO_FILE_PATH');
        const [buf] = await bucket.file(key).download();
        return buf;
      },
      publicUrl(filePath) {
        if (!filePath) return null;
        if (isHttpUrl(filePath)) return filePath;
        return publicUrlFromGcs(gcsBucket, filePath);
      },
      /**
       * URL firmada v4 para que la app suba un zip directo a GCS (evita el límite de body de Cloud Run).
       */
      async createSignedUploadUrl({ object, contentType = 'application/zip', expiresSeconds = 1800 }) {
        const key = String(object || '').replace(/^[/\\]+/, '');
        if (!key || key.includes('..')) throw new Error('INVALID_OBJECT');
        const [url] = await bucket.file(key).getSignedUrl({
          version: 'v4',
          action: 'write',
          expires: Date.now() + Math.max(60, Number(expiresSeconds) || 1800) * 1000,
          contentType
        });
        return {
          uploadUrl: url,
          method: 'PUT',
          headers: { 'Content-Type': contentType },
          objectPath: key,
          publicUrl: publicUrlFromGcs(gcsBucket, key)
        };
      },
      async createSignedReadUrl({ object, expiresSeconds = 3600 }) {
        const key = String(object || '').replace(/^[/\\]+/, '');
        if (!key || key.includes('..')) throw new Error('INVALID_OBJECT');
        const [url] = await bucket.file(key).getSignedUrl({
          version: 'v4',
          action: 'read',
          expires: Date.now() + Math.max(60, Number(expiresSeconds) || 3600) * 1000
        });
        return url;
      },
      async saveBuffer({ buffer, contentType, storageKey }) {
        const key = String(storageKey || '').replace(/^[/\\]+/, '');
        if (!key) throw new Error('STORAGE_KEY_REQUIRED');
        await bucket.file(key).save(buffer, {
          contentType: contentType || 'application/octet-stream',
          resumable: false
        });
        return { filePath: publicUrlFromGcs(gcsBucket, key), publicUrl: publicUrlFromGcs(gcsBucket, key), objectPath: key };
      },
      async deleteFile(filePath) {
        if (!filePath) return false;
        if (isHttpUrl(filePath)) {
          const match = filePath.match(
            new RegExp(`https://storage\\.googleapis\\.com/${gcsBucket.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(.+)`)
          );
          if (match) {
            const object = decodeURIComponent(match[1].replace(/\/+/g, '/'));
            await bucket.file(object).delete({ ignoreNotFound: true });
            return true;
          }
          return false;
        }
        const object = String(filePath).replace(/^[/\\]+/, '');
        if (object.startsWith('cases/') || object.startsWith('postventa/') || object.startsWith('tenants/')) {
          await bucket.file(object).delete({ ignoreNotFound: true });
          return true;
        }
        return false;
      }
    };
  }

  // local
  const dir = uploadDir || join(process.cwd(), 'uploads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  return {
    driver: 'local',
    async saveImageBuffer({ buffer, contentType, ext, caseId, tenantId, storageKey }) {
      const id = crypto.randomUUID();
      const safeExt = String(ext || '').replace('.', '');
      const storedFileName = storageKey
        ? String(storageKey).replace(/\//g, '-')
        : tenantId
          ? `tenants-${tenantId}-logo.${safeExt}`
          : `${id}.${safeExt}`;
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
    },
    async createSignedUploadUrl({ object, contentType = 'application/zip' }) {
      const key = String(object || '').replace(/^[/\\]+/, '');
      return {
        uploadUrl: null,
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        objectPath: key,
        publicUrl: `/uploads/${String(key).replace(/\//g, '-')}`,
        localFallback: true
      };
    },
    async createSignedReadUrl({ object }) {
      const key = String(object || '').replace(/^[/\\]+/, '');
      return `/uploads/${String(key).replace(/\//g, '-')}`;
    },
    async saveBuffer({ buffer, contentType, storageKey }) {
      const key = String(storageKey || '').replace(/^[/\\]+/, '');
      if (!key) throw new Error('STORAGE_KEY_REQUIRED');
      const storedFileName = key.replace(/\//g, '-');
      const absPath = join(dir, storedFileName);
      await fs.promises.writeFile(absPath, buffer);
      const filePath = `uploads/${storedFileName}`;
      return { filePath, publicUrl: `/${filePath}`, objectPath: key };
    },
    async deleteFile(filePath) {
      if (!filePath || isHttpUrl(filePath)) return false;
      const p = String(filePath).replace(/^[/\\]+/, '');
      const absPath = join(process.cwd(), p);
      try {
        await fs.promises.unlink(absPath);
        return true;
      } catch (err) {
        if (err && err.code === 'ENOENT') return false;
        throw err;
      }
    }
  };
}

