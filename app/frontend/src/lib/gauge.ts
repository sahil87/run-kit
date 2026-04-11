const FILLED = "\u2588"; // █
const EMPTY = "\u2591";  // ░

const GAUGE_WIDTH = 10; // total character width of the gauge bar

/**
 * Build a filled/empty block gauge string from a ratio (0-1).
 * @param width — number of characters (defaults to GAUGE_WIDTH)
 */
export function gaugeBar(ratio: number, width: number = GAUGE_WIDTH): string {
  const w = Math.max(1, Math.round(width));
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * w);
  return FILLED.repeat(filled) + EMPTY.repeat(w - filled);
}

/**
 * Return a Tailwind color class based on memory usage percentage.
 *  - < 70%: green
 *  - 70-90%: yellow
 *  - > 90%: red
 */
export function gaugeColor(percent: number): string {
  if (percent > 90) return "text-red-500";
  if (percent >= 70) return "text-yellow-500";
  return "text-green-500";
}

/**
 * Format bytes into a compact human-readable string (e.g., "3.1G", "512M").
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0";
  const GB = 1024 * 1024 * 1024;
  const MB = 1024 * 1024;
  if (bytes >= GB) {
    const val = bytes / GB;
    if (val >= 10 || val === Math.floor(val)) return `${Math.round(val)}G`;
    return `${val.toFixed(1)}G`;
  }
  if (bytes >= MB) {
    const val = bytes / MB;
    if (val >= 10 || val === Math.floor(val)) return `${Math.round(val)}M`;
    return `${val.toFixed(1)}M`;
  }
  return `${Math.round(bytes / 1024)}K`;
}

/**
 * Format a memory used/total pair as a compact string (e.g., "3.1/8G").
 */
export function formatMemory(used: number, total: number): string {
  return `${formatBytes(used)}/${formatBytes(total)}`;
}
