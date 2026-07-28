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

function isServerEntry(value: unknown): value is ServerEntry {
  if (typeof value !== "object" || value === null) return false;
  if (!("id" in value) || !("name" in value) || !("url" in value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.url === "string"
  );
}

function isServerList(value: unknown): value is ServerList {
  if (typeof value !== "object" || value === null) return false;
  if (!("version" in value) || !("activeId" in value) || !("servers" in value)) return false;
  if (value.version !== 1) return false;
  if (value.activeId !== null && typeof value.activeId !== "string") return false;
  return Array.isArray(value.servers) && value.servers.every(isServerEntry);
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
  return isServerList(parsed) ? parsed : emptyList();
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
 * Resolve the server to load at startup / after a mutation: the active entry,
 * falling back to the first server when `activeId` dangles, `null` when the
 * list is empty (welcome page).
 */
export function resolveActiveServer(list: ServerList): ServerEntry | null {
  if (list.servers.length === 0) return null;
  return list.servers.find((s) => s.id === list.activeId) ?? list.servers[0];
}
