/**
 * Dock/taskbar badge pure logic — count-label formatting, the Windows overlay
 * accessibility description, and the canvas-free count-glyph renderer that
 * produces the overlay-icon PNG bytes.
 *
 * Deliberately electron-free (the `hosts.ts` / `local-daemon.ts` /
 * `update-check.ts` precedent) so the sibling `badge.test.ts` covers it under
 * plain `node --test`. The impure glue — the `badge:set` IPC handler,
 * `app.setBadgeCount`, `nativeImage.createFromBuffer` + `setOverlayIcon` —
 * lives in `main.ts`.
 *
 * Why a hand-rolled PNG: `nativeImage.createFromDataURL` accepts only
 * PNG/JPEG (not SVG), the main process has no canvas, and the package's
 * three-dep pin forbids an image library. A 32×32 RGBA raster (red disc,
 * white 5×7-bit-font glyphs at 2× scale) plus a minimal PNG encoder
 * (`node:zlib` deflate + CRC32) keeps the whole renderer pure and testable.
 */
import { deflateSync } from "node:zlib";

/** Overlay icon raster size (Windows renders overlays at 16–32px). */
export const BADGE_SIZE = 32;

/** Windows badge red (the taskbar-overlay convention). */
const DISC = { r: 0xe8, g: 0x11, b: 0x23 };
const GLYPH = { r: 0xff, g: 0xff, b: 0xff };

/**
 * Badge label: empty at 0 (clear), the digit for 1–9, `9+` above — two glyphs
 * maximum so the label stays legible at overlay size.
 */
export function badgeLabel(count: number): string {
  if (!Number.isInteger(count) || count <= 0) return "";
  return count <= 9 ? String(count) : "9+";
}

/** Windows overlay accessibility description. */
export function overlayDescription(count: number): string {
  return `${count} agent${count === 1 ? "" : "s"} waiting`;
}

// ── 5×7 bit font (digits + '+') ──────────────────────────────────────────────
// Each glyph is 7 rows of 5 bits, MSB = leftmost pixel.

const FONT: Record<string, number[]> = {
  "0": [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  "1": [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  "2": [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  "3": [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110],
  "4": [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  "5": [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  "6": [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  "7": [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  "8": [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  "9": [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  "+": [0b00000, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000],
};

const FONT_W = 5;
const FONT_H = 7;
const SCALE = 2;
const CHAR_GAP = 2; // px between scaled glyphs

// ── Raster ───────────────────────────────────────────────────────────────────

/** RGBA raster of the badge disc + count label. Exported for tests. */
export function badgeRaster(count: number): Uint8Array {
  const size = BADGE_SIZE;
  const px = new Uint8Array(size * size * 4);
  const c = (size - 1) / 2;
  const r = size / 2;

  // Anti-aliased filled disc.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.sqrt((x - c) ** 2 + (y - c) ** 2);
      const coverage = Math.max(0, Math.min(1, r - dist + 0.5));
      if (coverage === 0) continue;
      const i = (y * size + x) * 4;
      px[i] = DISC.r;
      px[i + 1] = DISC.g;
      px[i + 2] = DISC.b;
      px[i + 3] = Math.round(coverage * 255);
    }
  }

  // Centered label glyphs.
  const label = badgeLabel(count);
  const glyphW = FONT_W * SCALE;
  const glyphH = FONT_H * SCALE;
  const totalW = label.length * glyphW + Math.max(0, label.length - 1) * CHAR_GAP;
  let originX = Math.round((size - totalW) / 2);
  const originY = Math.round((size - glyphH) / 2);
  for (const ch of label) {
    const rows = FONT[ch];
    if (rows) {
      for (let gy = 0; gy < FONT_H; gy++) {
        for (let gx = 0; gx < FONT_W; gx++) {
          if (((rows[gy] >> (FONT_W - 1 - gx)) & 1) === 0) continue;
          for (let sy = 0; sy < SCALE; sy++) {
            for (let sx = 0; sx < SCALE; sx++) {
              const x = originX + gx * SCALE + sx;
              const y = originY + gy * SCALE + sy;
              if (x < 0 || x >= size || y < 0 || y >= size) continue;
              const i = (y * size + x) * 4;
              px[i] = GLYPH.r;
              px[i + 1] = GLYPH.g;
              px[i + 2] = GLYPH.b;
              px[i + 3] = 255;
            }
          }
        }
      }
    }
    originX += glyphW + CHAR_GAP;
  }
  return px;
}

// ── Minimal PNG encoder ──────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Encode an RGBA raster as an 8-bit truecolor-with-alpha PNG. */
function encodePng(px: Uint8Array, size: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // width
  ihdr.writeUInt32BE(size, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // compression 0, filter 0, interlace 0 (already zeroed)

  // Raw scanlines, each prefixed with filter byte 0 (None).
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw.set(px.subarray(y * size * 4, (y + 1) * size * 4), rowStart + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/**
 * The Windows overlay-icon PNG for a waiting-agent count: a red disc with the
 * white count label (`9+` above 9). Main wraps the bytes via
 * `nativeImage.createFromBuffer` — callers pass count > 0 (0 clears the
 * overlay with `null` instead of an image).
 */
export function badgePng(count: number): Buffer {
  return encodePng(badgeRaster(count), BADGE_SIZE);
}
