/**
 * 8-level braille characters filling bottom-to-top.
 * Level 0 = bottom row only, Level 7 = all dots filled.
 */
const BRAILLE_LEVELS = [
  "\u28C0", // ⣀ - level 0 (bottom row only)
  "\u28C4", // ⣄ - level 1
  "\u28E4", // ⣤ - level 2
  "\u28E6", // ⣦ - level 3
  "\u28F6", // ⣶ - level 4
  "\u28F7", // ⣷ - level 5
  "\u28FE", // ⣾ - level 6
  "\u28FF", // ⣿ - level 7 (all dots)
];

/**
 * Convert an array of values (0-100 range) into a Unicode braille sparkline string.
 * Each value maps to one braille character using 8 vertical levels.
 */
export function sparkline(samples: number[]): string {
  return samples
    .map((v) => {
      const clamped = Math.max(0, Math.min(100, v));
      // Map 0-100 to level index 0-7
      const level = Math.min(7, Math.floor((clamped / 100) * 8));
      return BRAILLE_LEVELS[level];
    })
    .join("");
}
