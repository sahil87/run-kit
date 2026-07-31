/**
 * node:test suite for the badge pure logic (run via `pnpm run test` after
 * compile — the `hosts.test.ts` convention).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { inflateSync } from "node:zlib";
import { BADGE_SIZE, badgeLabel, badgePng, badgeRaster, overlayDescription } from "./badge";

// ── badgeLabel ───────────────────────────────────────────────────────────────

test("badgeLabel: 0 and negatives are empty (clear)", () => {
  assert.equal(badgeLabel(0), "");
  assert.equal(badgeLabel(-3), "");
});

test("badgeLabel: 1–9 render the digit", () => {
  assert.equal(badgeLabel(1), "1");
  assert.equal(badgeLabel(9), "9");
});

test("badgeLabel: above 9 caps at 9+", () => {
  assert.equal(badgeLabel(10), "9+");
  assert.equal(badgeLabel(137), "9+");
});

test("badgeLabel: non-integers are empty", () => {
  assert.equal(badgeLabel(2.5), "");
  assert.equal(badgeLabel(Number.NaN), "");
});

// ── overlayDescription ───────────────────────────────────────────────────────

test("overlayDescription pluralizes", () => {
  assert.equal(overlayDescription(1), "1 agent waiting");
  assert.equal(overlayDescription(12), "12 agents waiting");
});

// ── badgePng ─────────────────────────────────────────────────────────────────

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("badgePng emits a structurally valid PNG (signature, IHDR dims, IEND)", () => {
  const png = badgePng(3);
  assert.deepEqual(png.subarray(0, 8), PNG_SIGNATURE);
  // First chunk is IHDR at offset 8: length(4) type(4) data(13).
  assert.equal(png.readUInt32BE(8), 13);
  assert.equal(png.subarray(12, 16).toString("ascii"), "IHDR");
  assert.equal(png.readUInt32BE(16), BADGE_SIZE); // width
  assert.equal(png.readUInt32BE(20), BADGE_SIZE); // height
  assert.equal(png[24], 8); // bit depth
  assert.equal(png[25], 6); // color type RGBA
  assert.equal(png.subarray(png.length - 8, png.length - 4).toString("ascii"), "IEND");
});

test("badgePng scanlines round-trip through inflate to the raster", () => {
  const png = badgePng(7);
  // IDAT follows IHDR (offset 8 + 12 + 13 = 33): length(4) type(4).
  assert.equal(png.subarray(37, 41).toString("ascii"), "IDAT");
  const idatLen = png.readUInt32BE(33);
  const raw = inflateSync(png.subarray(41, 41 + idatLen));
  assert.equal(raw.length, BADGE_SIZE * (1 + BADGE_SIZE * 4));
  // Reassemble pixels (strip per-row filter bytes) and compare to the raster.
  const raster = badgeRaster(7);
  for (let y = 0; y < BADGE_SIZE; y++) {
    const row = raw.subarray(y * (1 + BADGE_SIZE * 4) + 1, (y + 1) * (1 + BADGE_SIZE * 4));
    assert.deepEqual(new Uint8Array(row), raster.subarray(y * BADGE_SIZE * 4, (y + 1) * BADGE_SIZE * 4));
  }
});

test("different counts render different glyphs", () => {
  assert.notDeepEqual(badgePng(1), badgePng(2));
  assert.notDeepEqual(badgePng(9), badgePng(10));
});

test("raster corners are transparent, center is opaque disc/glyph", () => {
  const px = badgeRaster(5);
  assert.equal(px[3], 0); // top-left alpha
  const centerIdx = ((BADGE_SIZE / 2) * BADGE_SIZE + BADGE_SIZE / 2) * 4;
  assert.equal(px[centerIdx + 3], 255);
});
