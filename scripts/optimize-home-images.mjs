import sharp from "sharp";
import { stat } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const targets = [
  "assets/building-visual-state-01.png",
  "images/home/property-lifecycle.png",
  "assets/sebastian-araya.jpg",
  "assets/Paulo.png",
  "assets/Cristian.png"
];

for (const rel of targets) {
  const input = path.join(root, rel);
  const output = input.replace(/\.png$/i, ".webp");
  try {
    await sharp(input)
      .webp({ quality: 82, effort: 4 })
      .toFile(output);
    const [inStat, outStat] = await Promise.all([stat(input), stat(output)]);
    console.log(
      rel,
      "->",
      path.basename(output),
      `${Math.round(inStat.size / 1024)}KB -> ${Math.round(outStat.size / 1024)}KB`
    );
  } catch (err) {
    console.error("skip", rel, err.message);
  }
}
