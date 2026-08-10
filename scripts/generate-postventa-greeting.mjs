/**
 * Genera la grabación de saludo (pre-roll) del agente postventa con la voz Maya.
 * Se reproduce al iniciar la conversación para tapar el warm-up entrecortado del
 * pipeline del widget mientras éste se conecta por detrás.
 *
 * Uso:
 *   node scripts/generate-postventa-greeting.mjs
 *   node scripts/generate-postventa-greeting.mjs "Texto alternativo del saludo"
 */
import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const VOICE_ID = 'nbcvT3C2tyOd2OsRAtUf'; // Maya - LatAm es
const MODEL_ID = 'eleven_multilingual_v2'; // máxima calidad (no importa la latencia: es offline)
const OUT_PATH = path.join(process.cwd(), 'public', 'assets', 'postventa-greeting.mp3');

const DEFAULT_TEXT =
  'Hola, te saluda la asistente de postventa de Ainspecciona. ' +
  'Para ayudarte con tu solicitud, cuéntame tu nombre y la dirección de tu propiedad.';

function fail(msg) {
  console.error(`[greeting] ${msg}`);
  process.exit(1);
}

async function main() {
  const key = String(process.env.ELEVENLABS_API_KEY || '').trim();
  if (!key) fail('Falta ELEVENLABS_API_KEY en .env');

  const text = (process.argv[2] || DEFAULT_TEXT).trim();
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(VOICE_ID)}?output_format=mp3_44100_128`;

  console.log('[greeting] Generando saludo…');
  console.log(`  voz:    Maya [${VOICE_ID}]`);
  console.log(`  modelo: ${MODEL_ID}`);
  console.log(`  texto:  ${text}`);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true }
    })
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    fail(`ElevenLabs ${res.status}: ${detail}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(OUT_PATH, buf);
  console.log(`\n[greeting] OK — guardado en ${OUT_PATH} (${Math.round(buf.length / 1024)} KB).`);
}

main().catch((e) => fail(e?.message || String(e)));
