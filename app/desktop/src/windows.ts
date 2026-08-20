/**
 * Window-set store: `<userData>/windows.json` (schema version 1) — the
 * cold-start restore record for the multi-window shell. Each record carries
 * one open window's `{ active host id, current route, bounds }`; relaunch
 * (and a macOS dock-reopen) recreates a window per record.
 *
 * Deliberately electron-free — the data directory is a parameter (main.ts
 * passes `app.getPath('userData')`), which keeps this module unit-testable
 * under plain `node --test`. Byte-for-byte the `hosts.ts` discipline: no
 * electron-store, tmp-file-then-rename writes (atomic on POSIX), and a
 * missing, corrupt, or wrong-shape file recovers as an empty set (startup
 * then opens a single fallback window). hosts.json is untouched — the
 * window set is its own file, not new hosts.json schema.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface WindowBounds {
  width: number;
  height: number;
  /** Optional — a window may never have been placed at explicit coords. */
  x?: number;
  y?: number;
}

export interface WindowRecord {
  /** The window's active host entry id; null = the welcome page. */
  hostId: string | null;
  /** The window's current SPA route remainder (`pathname + search`);
   *  empty string = restore falls back to the host's `lastPath`. */
  route: string;
  bounds: WindowBounds;
}

export interface WindowSet {
  version: 1;
  /** Creation order, with the last-focused window's record LAST — restore
   *  creates in array order, so the last-created window takes focus. */
  windows: WindowRecord[];
}

const FILE_NAME = "windows.json";

export function emptyWindowSet(): WindowSet {
  return { version: 1, windows: [] };
}

/**
 * Parse one stored record. The required fields (`hostId` string-or-null,
 * `route` string, `bounds.width`/`bounds.height` numbers) must be present
 * and correctly typed — anything else rejects the record (and, via
 * parseWindowSet, the file). The optional `bounds.x`/`bounds.y` are the
 * tolerant ones (the hosts.ts optional-field precedent): absent → fine,
 * number → kept, any other type → the field is dropped but the record (and
 * file) still loads.
 */
function parseWindowRecord(value: unknown): WindowRecord | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("hostId" in value) || !("route" in value) || !("bounds" in value)) return null;
  if (value.hostId !== null && typeof value.hostId !== "string") return null;
  if (typeof value.route !== "string") return null;
  const bounds = value.bounds;
  if (typeof bounds !== "object" || bounds === null) return null;
  if (!("width" in bounds) || !("height" in bounds)) return null;
  if (typeof bounds.width !== "number" || typeof bounds.height !== "number") return null;
  const parsed: WindowRecord = {
    hostId: value.hostId,
    route: value.route,
    bounds: { width: bounds.width, height: bounds.height },
  };
  if ("x" in bounds && typeof bounds.x === "number") parsed.bounds.x = bounds.x;
  if ("y" in bounds && typeof bounds.y === "number") parsed.bounds.y = bounds.y;
  return parsed;
}

function parseWindowSet(value: unknown): WindowSet | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("version" in value) || !("windows" in value)) return null;
  if (value.version !== 1) return null;
  if (!Array.isArray(value.windows)) return null;
  const windows: WindowRecord[] = [];
  for (const raw of value.windows) {
    const record = parseWindowRecord(raw);
    if (record === null) return null;
    windows.push(record);
  }
  return { version: 1, windows };
}

/**
 * Load the set; a missing, unreadable, corrupt, or wrong-shape file is an
 * empty set (startup then opens one fallback window — the same degradation
 * posture as the hosts store's corrupt→empty).
 */
export function loadWindows(dir: string): WindowSet {
  let raw: string;
  try {
    raw = readFileSync(join(dir, FILE_NAME), "utf8");
  } catch {
    return emptyWindowSet();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyWindowSet();
  }
  return parseWindowSet(parsed) ?? emptyWindowSet();
}

/** Persist atomically: write a tmp file in the same directory, then rename over the target. */
export function saveWindows(dir: string, set: WindowSet): void {
  mkdirSync(dir, { recursive: true });
  const target = join(dir, FILE_NAME);
  const tmp = join(dir, `${FILE_NAME}.tmp-${process.pid}`);
  writeFileSync(tmp, JSON.stringify(set, null, 2) + "\n", "utf8");
  renameSync(tmp, target);
}
