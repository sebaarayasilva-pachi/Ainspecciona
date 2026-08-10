import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(__dirname, "../public/assets");

const CLOCK_MIDPOINTS = [1, 3.5, 6, 8.5, 10.5];

async function findArrowSeeds(data, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const seeds = [];

  for (const clock of CLOCK_MIDPOINTS) {
    const base = ((clock * 30 - 90) * Math.PI) / 180;
    let best = null;

    for (let R = 300; R <= 390; R++) {
      for (let da = -0.15; da <= 0.15; da += 0.01) {
        const x = Math.round(cx + Math.cos(base + da) * R);
        const y = Math.round(cy + Math.sin(base + da) * R);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;

        const i = (y * w + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const spread = Math.max(r, g, b) - Math.min(r, g, b);
        const br = r + g + b;

        if (br > 600 && spread < 80) {
          const score = br + (80 - spread);
          if (!best || score > best.score) best = { x, y, score, clock };
        }
      }
    }

    if (best) seeds.push(best);
  }

  return seeds;
}

function eraseArrows(data, w, h, seeds, transparent) {
  let removed = 0;

  for (const s of seeds) {
    for (let y = s.y - 34; y <= s.y + 34; y++) {
      for (let x = s.x - 34; x <= s.x + 34; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        if ((x - s.x) ** 2 + (y - s.y) ** 2 > 34 * 34) continue;

        const i = (y * w + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const spread = Math.max(r, g, b) - Math.min(r, g, b);
        const br = r + g + b;

        if (br < 380 || spread > 100) continue;

        if (transparent) data[i + 3] = 0;
        else {
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
        }
        removed++;
      }
    }
  }

  return removed;
}

async function loadRgba(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: Buffer.from(data), w: info.width, h: info.height };
}

async function savePng(file, data, w, h) {
  await sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(file);
}

const edificioPath = path.join(assetsDir, "edificio.png");
const heroPath = path.join(assetsDir, "edificio-hero.png");

const { data, w, h } = await loadRgba(edificioPath);
const seeds = await findArrowSeeds(data, w, h);
console.log("seeds:", seeds.map((s) => `${s.clock}@${s.x},${s.y}`).join(" | "));

const removed = eraseArrows(data, w, h, seeds, false);
await savePng(edificioPath, data, w, h);
console.log("edificio.png removed", removed);

const hero = await loadRgba(edificioPath);
for (let i = 0; i < hero.data.length; i += 4) {
  if (hero.data[i] <= 12 && hero.data[i + 1] <= 12 && hero.data[i + 2] <= 12) hero.data[i + 3] = 0;
}
await savePng(heroPath, hero.data, hero.w, hero.h);
console.log("edificio-hero.png updated");
