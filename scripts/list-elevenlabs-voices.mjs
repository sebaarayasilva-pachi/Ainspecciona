/**
 * Lista las voces disponibles en la cuenta de ElevenLabs (nombre + voice_id + etiquetas).
 * Uso: node scripts/list-elevenlabs-voices.mjs
 */
import 'dotenv/config';

const VOICES_API = 'https://api.elevenlabs.io/v2/voices?page_size=100';

async function main() {
  const key = String(process.env.ELEVENLABS_API_KEY || '').trim();
  if (!key) {
    console.error('[voices] Falta ELEVENLABS_API_KEY en .env');
    process.exit(1);
  }
  const res = await fetch(VOICES_API, { headers: { 'xi-api-key': key } });
  const raw = await res.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = { raw }; }
  if (!res.ok) {
    console.error(`[voices] ${res.status}: ${raw}`);
    process.exit(1);
  }
  const voices = data?.voices || [];
  console.log(`[voices] ${voices.length} voces en la cuenta:\n`);
  for (const v of voices) {
    const labels = v.labels || {};
    const tags = [labels.gender, labels.accent, labels.language, labels.descriptive, labels.use_case]
      .filter(Boolean)
      .join(', ');
    console.log(`  • ${v.name}`);
    console.log(`      voice_id: ${v.voice_id}`);
    console.log(`      etiquetas: ${tags || '(sin etiquetas)'}`);
  }
}

main().catch((e) => {
  console.error('[voices]', e?.message || String(e));
  process.exit(1);
});
