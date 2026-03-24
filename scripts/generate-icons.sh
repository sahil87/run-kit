#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

SVG="$REPO_ROOT/app/frontend/public/icon.svg"
OUT="$REPO_ROOT/app/frontend/public/generated-icons"

if [ ! -f "$SVG" ]; then
  echo "Error: $SVG not found" >&2
  exit 1
fi

mkdir -p "$OUT"

# Copy favicon (plain file copy, not symlink)
cp "$SVG" "$OUT/favicon.svg"

# Generate PNGs with dark background and padding
# Run from app/frontend/ so Node resolves sharp from its node_modules
cd "$REPO_ROOT/app/frontend"
export REPO_ROOT
node --input-type=module <<'SCRIPT'
import sharp from "sharp";
import { readFileSync } from "fs";
import { join } from "path";

const root = process.env.REPO_ROOT;
const svg = join(root, "app/frontend/public/icon.svg");
const out = join(root, "app/frontend/public/generated-icons");
const svgBuf = readFileSync(svg);
const bg = { r: 15, g: 17, b: 23, alpha: 1 }; // #0f1117

const variants = [
  { name: "icon-192.png",          size: 192, padding: 0.20 },
  { name: "icon-512.png",          size: 512, padding: 0.20 },
  { name: "icon-512-maskable.png", size: 512, padding: 0.40 },
];

for (const { name, size, padding } of variants) {
  const innerSize = Math.round(size * (1 - padding));
  const offset = Math.round((size - innerSize) / 2);

  const resized = await sharp(svgBuf)
    .resize(innerSize, innerSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: resized, left: offset, top: offset }])
    .png()
    .toFile(join(out, name));

  console.log(`  ${name} (${size}x${size}, ${Math.round(padding * 100)}% padding)`);
}
SCRIPT

echo "Generated icons in $OUT"
