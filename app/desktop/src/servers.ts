/**
 * Server-list store: `<userData>/servers.json` (schema version 1).
 *
 * Deliberately electron-free — the data directory is a parameter (main.ts
 * passes `app.getPath('userData')`), which keeps this module unit-testable
 * under plain `node --test`. No electron-store: the file is small, writes are
 * tmp-file-then-rename (atomic on POSIX), and a corrupt or missing file
 * recovers as an empty list (startup then routes to the welcome page).
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ServerEntry {
  id: string;
  name: string;
  url: string;
  /** Last-visited SPA route remainder (`pathname + search`), when known. */
  lastPath?: string;
}

export interface ServerList {
  version: 1;
  activeId: string | null;
  servers: ServerEntry[];
}

export type NormalizeResult =
  | { ok: true; origin: string }
  | { ok: false; error: string };

export type AddResult =
  | { ok: true; list: ServerList; server: ServerEntry }
  | { ok: false; error: string };

const FILE_NAME = "servers.json";

export function emptyList(): ServerList {
  return { version: 1, activeId: null, servers: [] };
}

/**
 * Normalize user input to a bare origin (`http://host:port`). Only http/https
 * are accepted — anything else (ftp:, file:, garbage) is a validation error
 * and is never persisted.
 */
export function normalizeOrigin(input: string): NormalizeResult {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, error: "Not a valid URL — include the scheme, e.g. http://host:3000" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: `Unsupported scheme "${url.protocol}" — only http and https work` };
  }
  return { ok: true, origin: url.origin };
}

/**
 * Parse one stored entry. The required fields (id/name/url) must be strings —
 * anything else rejects the entry (and, via parseServerList, the file). The
 * optional `lastPath` is tolerant: absent → fine, string → kept, any other
 * type → the field is dropped but the entry (and file) still loads.
 */
function parseServerEntry(value: unknown): ServerEntry | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("id" in value) || !("name" in value) || !("url" in value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.url !== "string"
  ) {
    return null;
  }
  const entry: ServerEntry = { id: value.id, name: value.name, url: value.url };
  if ("lastPath" in value && typeof value.lastPath === "string") {
    entry.lastPath = value.lastPath;
  }
  return entry;
}

function parseServerList(value: unknown): ServerList | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("version" in value) || !("activeId" in value) || !("servers" in value)) return null;
  if (value.version !== 1) return null;
  if (value.activeId !== null && typeof value.activeId !== "string") return null;
  if (!Array.isArray(value.servers)) return null;
  const servers: ServerEntry[] = [];
  for (const raw of value.servers) {
    const entry = parseServerEntry(raw);
    if (entry === null) return null;
    servers.push(entry);
  }
  return { version: 1, activeId: value.activeId, servers };
}

/** Load the list; a missing, unreadable, corrupt, or wrong-shape file is an empty list. */
export function loadServers(dir: string): ServerList {
  let raw: string;
  try {
    raw = readFileSync(join(dir, FILE_NAME), "utf8");
  } catch {
    return emptyList();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyList();
  }
  return parseServerList(parsed) ?? emptyList();
}

/** Persist atomically: write a tmp file in the same directory, then rename over the target. */
export function saveServers(dir: string, list: ServerList): void {
  mkdirSync(dir, { recursive: true });
  const target = join(dir, FILE_NAME);
  const tmp = join(dir, `${FILE_NAME}.tmp-${process.pid}`);
  writeFileSync(tmp, JSON.stringify(list, null, 2) + "\n", "utf8");
  renameSync(tmp, target);
}

/** Validate + normalize, append, set active, persist. Nothing is written on a validation error. */
export function addServer(dir: string, name: string, urlInput: string): AddResult {
  const normalized = normalizeOrigin(urlInput);
  if (!normalized.ok) return normalized;
  const list = loadServers(dir);
  const server: ServerEntry = {
    id: randomUUID(),
    name: name.trim() || normalized.origin,
    url: normalized.origin,
  };
  const next: ServerList = {
    version: 1,
    activeId: server.id,
    servers: [...list.servers, server],
  };
  saveServers(dir, next);
  return { ok: true, list: next, server };
}

/** Remove by id; when the active server is removed, the first remaining becomes active. */
export function removeServer(dir: string, id: string): ServerList {
  const list = loadServers(dir);
  const servers = list.servers.filter((s) => s.id !== id);
  const activeId =
    list.activeId === id ? (servers.length > 0 ? servers[0].id : null) : list.activeId;
  const next: ServerList = { version: 1, activeId, servers };
  saveServers(dir, next);
  return next;
}

export function setActiveServer(dir: string, id: string): ServerList {
  const list = loadServers(dir);
  if (!list.servers.some((s) => s.id === id)) return list;
  const next: ServerList = { ...list, activeId: id };
  saveServers(dir, next);
  return next;
}

/**
 * Record the last-visited SPA path for a server. Unknown id or an unchanged
 * value is a no-op (nothing written) — capture runs on every switch/add/
 * rename/close, so the fast path avoids rewriting an identical file.
 */
export function setServerLastPath(dir: string, id: string, lastPath: string): ServerList {
  const list = loadServers(dir);
  const entry = list.servers.find((s) => s.id === id);
  if (!entry || entry.lastPath === lastPath) return list;
  const next: ServerList = {
    ...list,
    servers: list.servers.map((s) => (s.id === id ? { ...s, lastPath } : s)),
  };
  saveServers(dir, next);
  return next;
}

/**
 * Rename a server by id (trimmed; empty falls back to the origin — mirroring
 * `addServer`). Only `name` changes; `id`, `url`, and `lastPath` are untouched
 * so per-server state (keyed on `id`) survives. Unknown id is a no-op.
 */
export function renameServer(dir: string, id: string, name: string): ServerList {
  const list = loadServers(dir);
  if (!list.servers.some((s) => s.id === id)) return list;
  const next: ServerList = {
    ...list,
    servers: list.servers.map((s) => (s.id === id ? { ...s, name: name.trim() || s.url } : s)),
  };
  saveServers(dir, next);
  return next;
}

/**
 * Resolve the server to load at startup / after a mutation: the active entry,
 * falling back to the first server when `activeId` dangles, `null` when the
 * list is empty (welcome page).
 */
export function resolveActiveServer(list: ServerList): ServerEntry | null {
  if (list.servers.length === 0) return null;
  return list.servers.find((s) => s.id === list.activeId) ?? list.servers[0];
}

/**
 * Resolve which entry owns a displayed origin (last-path capture). Several
 * entries can share one origin (`addServer` never dedupes) — the active entry
 * wins among the matches, else the first match; `null` when nothing matches.
 */
export function findServerByOrigin(list: ServerList, origin: string): ServerEntry | null {
  const matches = list.servers.filter((s) => s.url === origin);
  return matches.find((s) => s.id === list.activeId) ?? matches[0] ?? null;
}
