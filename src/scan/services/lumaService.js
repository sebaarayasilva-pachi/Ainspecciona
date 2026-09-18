import fetch from 'node-fetch';
import { Storage } from '@google-cloud/storage';
import archiver from 'archiver';
import fs from 'fs';
import path from 'path';

const LUMA_API_KEY = process.env.LUMA_API_KEY;
const LUMA_API_URL = 'https://csm.lumalabs.ai/api/v2';

/**
 * Servicio para integrar Luma AI (Gaussian Splatting)
 * Documentación: https://lumalabs.ai/luma-api
 */
export class LumaService {
  constructor(bucketName) {
    this.storage = new Storage();
    this.bucket = this.storage.bucket(bucketName);
  }

  // 1. Crear una captura en Luma
  async createCapture(title) {
    const response = await fetch(`${LUMA_API_URL}/capture`, {
      method: 'POST',
      headers: {
        'Authorization': `luma-api-key=${LUMA_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title })
    });
    
    if (!response.ok) throw new Error(`Luma API Error: ${response.statusText}`);
    return await response.json();
  }

  // 2. Subir las fotos al signed URL que nos da Luma
  async uploadImagesToLuma(uploadUrl, imagesZipBuffer) {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/zip'
      },
      body: imagesZipBuffer
    });
    
    if (!response.ok) throw new Error(`Error subiendo a Luma: ${response.statusText}`);
  }

  // 3. Disparar el procesamiento
  async triggerProcessing(slug) {
    const response = await fetch(`${LUMA_API_URL}/capture/${slug}`, {
      method: 'POST',
      headers: {
        'Authorization': `luma-api-key=${LUMA_API_KEY}`
      }
    });
    if (!response.ok) throw new Error(`Error iniciando proceso en Luma: ${response.statusText}`);
  }

  // 4. Consultar el estado
  async checkStatus(slug) {
    const response = await fetch(`${LUMA_API_URL}/capture/${slug}`, {
      method: 'GET',
      headers: {
        'Authorization': `luma-api-key=${LUMA_API_KEY}`
      }
    });
    if (!response.ok) throw new Error(`Error consultando estado en Luma: ${response.statusText}`);
    return await response.json();
  }
}
