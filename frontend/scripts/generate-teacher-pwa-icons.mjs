/**
 * Generates Teacher Portal PWA icons + main SPA favicon from src/assets/educlear-pwa-source.png.
 * Run: npm run generate:teacher-pwa-icons
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const srcLogo = path.join(root, "src/assets/educlear-pwa-source.png");
const VERSION = "v2";
const PREFIX = "educlear-teacher";
const OUT_DIR = "public/teacher-pwa";

/** Dark navy from the official EduClear logo background (not flat black). */
const BG = { r: 18, g: 28, b: 46, alpha: 1 };
const MASTER = 1024;

async function buildMasterSquare(logoScale) {
  const meta = await sharp(srcLogo).metadata();
  const w = meta.width ?? 1024;
  const h = meta.height ?? 682;
  const logoMax = Math.round(MASTER * logoScale);
  const logoW = Math.round((w / Math.max(w, h)) * logoMax);
  const logoH = Math.round((h / Math.max(w, h)) * logoMax);
  const logoBuf = await sharp(srcLogo)
    .resize(logoW, logoH, { fit: "inside", background: BG })
    .toBuffer();
  const placed = await sharp(logoBuf).metadata();
  const lw = placed.width ?? logoW;
  const lh = placed.height ?? logoH;
  return sharp({
    create: { width: MASTER, height: MASTER, channels: 4, background: BG },
  })
    .composite([{ input: logoBuf, left: Math.round((MASTER - lw) / 2), top: Math.round((MASTER - lh) / 2) }])
    .png()
    .toBuffer();
}

async function writeIcon(outDir, fileName, pixelSize, masterBuf) {
  const out = path.join(root, outDir, fileName);
  await sharp(masterBuf)
    .resize(pixelSize, pixelSize, { kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(out);
  console.log("wrote", out);
}

async function main() {
  if (!fs.existsSync(srcLogo)) {
    console.error("Missing source logo:", srcLogo);
    process.exit(1);
  }

  fs.mkdirSync(path.join(root, OUT_DIR), { recursive: true });
  const standard = await buildMasterSquare(0.92);
  const maskable = await buildMasterSquare(0.7);

  await writeIcon(OUT_DIR, `${PREFIX}-icon-${VERSION}-192.png`, 192, standard);
  await writeIcon(OUT_DIR, `${PREFIX}-icon-${VERSION}-512.png`, 512, standard);
  await writeIcon(OUT_DIR, `${PREFIX}-apple-touch-${VERSION}-180.png`, 180, standard);
  await writeIcon(OUT_DIR, `${PREFIX}-icon-${VERSION}-512-maskable.png`, 512, maskable);

  const mainOut = path.join(root, "public", `educlear-main-icon-${VERSION}-192.png`);
  await sharp(standard)
    .resize(192, 192, { kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(mainOut);
  console.log("wrote", mainOut);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
