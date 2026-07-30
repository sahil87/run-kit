/**
 * node:test suite for the server-list store (run via `pnpm run test` after
 * compile — Node's built-in runner keeps app/desktop at exactly three
 * devDependencies). Compiled output is excluded from packaging via the
 * electron-builder `files` pattern.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addServer,
  findServerByOrigin,
  loadServers,
  normalizeOrigin,
  removeServer,
  renameServer,
  resolveActiveServer,
  saveServers,
  setActiveServer,
  setServerLastPath,
} from "./servers";

function tmpDataDir(): string {
  return mkdtempSync(join(tmpdir(), "rk-desktop-servers-"));
}

test("normalizeOrigin strips path/query and lowercases scheme+host", () => {
  const result = normalizeOrigin("HTTP://Host:3000/some/path?x=1");
  assert.deepEqual(result, { ok: true, origin: "http://host:3000" });
});

test("normalizeOrigin accepts https and preserves explicit ports", () => {
  const result = normalizeOrigin("https://100.101.2.3:8443");
  assert.deepEqual(result, { ok: true, origin: "https://100.101.2.3:8443" });
});

test("normalizeOrigin rejects non-http(s) schemes", () => {
  const result = normalizeOrigin("ftp://host");
  assert.equal(result.ok, false);
});

test("normalizeOrigin rejects garbage input", () => {
  const result = normalizeOrigin("not a url");
  assert.equal(result.ok, false);
});

test("loadServers returns an empty list for a missing file", () => {
  const dir = tmpDataDir();
  assert.deepEqual(loadServers(dir), { version: 1, activeId: null, servers: [] });
});

test("loadServers returns an empty list for corrupt JSON", () => {
  const dir = tmpDataDir();
  writeFileSync(join(dir, "servers.json"), "{ not json !!", "utf8");
  assert.deepEqual(loadServers(dir), { version: 1, activeId: null, servers: [] });
});

test("loadServers returns an empty list for wrong-shape JSON", () => {
  const dir = tmpDataDir();
  writeFileSync(join(dir, "servers.json"), JSON.stringify({ version: 2, servers: "nope" }), "utf8");
  assert.deepEqual(loadServers(dir), { version: 1, activeId: null, servers: [] });
});

test("addServer normalizes, persists, sets active, and round-trips through load", () => {
  const dir = tmpDataDir();
  const result = addServer(dir, "studio-mac", "http://100.101.2.3:3000/dashboard");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.server.url, "http://100.101.2.3:3000");
  assert.equal(result.list.activeId, result.server.id);

  const loaded = loadServers(dir);
  assert.deepEqual(loaded, result.list);
});

test("addServer with an invalid URL persists nothing", () => {
  const dir = tmpDataDir();
  const result = addServer(dir, "bad", "ftp://host");
  assert.equal(result.ok, false);
  assert.deepEqual(loadServers(dir), { version: 1, activeId: null, servers: [] });
});

test("addServer falls back to the origin as display name when name is blank", () => {
  const dir = tmpDataDir();
  const result = addServer(dir, "   ", "http://localhost:3000");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.server.name, "http://localhost:3000");
});

test("saveServers writes atomically and leaves no tmp files behind", () => {
  const dir = tmpDataDir();
  saveServers(dir, { version: 1, activeId: null, servers: [] });
  assert.deepEqual(readdirSync(dir), ["servers.json"]);
  const raw: unknown = JSON.parse(readFileSync(join(dir, "servers.json"), "utf8"));
  assert.deepEqual(raw, { version: 1, activeId: null, servers: [] });
});

test("removeServer of the active entry activates the first remaining", () => {
  const dir = tmpDataDir();
  const a = addServer(dir, "a", "http://a:1");
  const b = addServer(dir, "b", "http://b:2");
  assert.equal(a.ok && b.ok, true);
  if (!a.ok || !b.ok) return;

  const next = removeServer(dir, b.server.id); // b was active (added last)
  assert.equal(next.activeId, a.server.id);
  assert.equal(next.servers.length, 1);
});

test("removeServer of the last entry empties the list (welcome route)", () => {
  const dir = tmpDataDir();
  const a = addServer(dir, "a", "http://a:1");
  assert.equal(a.ok, true);
  if (!a.ok) return;

  const next = removeServer(dir, a.server.id);
  assert.deepEqual(next, { version: 1, activeId: null, servers: [] });
});

test("setActiveServer switches active; unknown ids are a no-op", () => {
  const dir = tmpDataDir();
  const a = addServer(dir, "a", "http://a:1");
  const b = addServer(dir, "b", "http://b:2");
  assert.equal(a.ok && b.ok, true);
  if (!a.ok || !b.ok) return;

  assert.equal(setActiveServer(dir, a.server.id).activeId, a.server.id);
  assert.equal(setActiveServer(dir, "nope").activeId, a.server.id);
});

test("loadServers keeps a pre-lastPath file unchanged (no field added, no entry dropped)", () => {
  const dir = tmpDataDir();
  const stored = {
    version: 1,
    activeId: "s1",
    servers: [{ id: "s1", name: "one", url: "http://one:1" }],
  };
  writeFileSync(join(dir, "servers.json"), JSON.stringify(stored), "utf8");
  assert.deepEqual(loadServers(dir), stored);
});

test("loadServers keeps a string lastPath", () => {
  const dir = tmpDataDir();
  const stored = {
    version: 1,
    activeId: "s1",
    servers: [{ id: "s1", name: "one", url: "http://one:1", lastPath: "/board/main" }],
  };
  writeFileSync(join(dir, "servers.json"), JSON.stringify(stored), "utf8");
  assert.deepEqual(loadServers(dir), stored);
});

test("loadServers drops a wrong-typed lastPath but keeps the entry and the list", () => {
  const dir = tmpDataDir();
  const stored = {
    version: 1,
    activeId: "s1",
    servers: [
      { id: "s1", name: "one", url: "http://one:1", lastPath: 42 },
      { id: "s2", name: "two", url: "http://two:2", lastPath: "/w" },
    ],
  };
  writeFileSync(join(dir, "servers.json"), JSON.stringify(stored), "utf8");
  assert.deepEqual(loadServers(dir), {
    version: 1,
    activeId: "s1",
    servers: [
      { id: "s1", name: "one", url: "http://one:1" },
      { id: "s2", name: "two", url: "http://two:2", lastPath: "/w" },
    ],
  });
});

test("setServerLastPath sets, overwrites, and round-trips through load", () => {
  const dir = tmpDataDir();
  const a = addServer(dir, "a", "http://a:1");
  assert.equal(a.ok, true);
  if (!a.ok) return;

  setServerLastPath(dir, a.server.id, "/s1/w1");
  const next = setServerLastPath(dir, a.server.id, "/board/b?x=1");
  assert.equal(next.servers[0].lastPath, "/board/b?x=1");
  assert.deepEqual(loadServers(dir), next);
  assert.deepEqual(loadServers(dir).servers[0], {
    id: a.server.id,
    name: "a",
    url: "http://a:1",
    lastPath: "/board/b?x=1",
  });
});

test("setServerLastPath with an unknown id writes nothing", () => {
  const dir = tmpDataDir();
  const a = addServer(dir, "a", "http://a:1");
  assert.equal(a.ok, true);
  if (!a.ok) return;

  const before = readFileSync(join(dir, "servers.json"), "utf8");
  const result = setServerLastPath(dir, "nope", "/x");
  assert.deepEqual(result, a.list);
  assert.equal(readFileSync(join(dir, "servers.json"), "utf8"), before);
});

test("setServerLastPath with an unchanged value writes nothing", () => {
  const dir = tmpDataDir();
  const a = addServer(dir, "a", "http://a:1");
  assert.equal(a.ok, true);
  if (!a.ok) return;

  const first = setServerLastPath(dir, a.server.id, "/w");
  const before = readFileSync(join(dir, "servers.json"), "utf8");
  const again = setServerLastPath(dir, a.server.id, "/w");
  assert.deepEqual(again, first);
  assert.equal(readFileSync(join(dir, "servers.json"), "utf8"), before);
});

test("renameServer trims the name and changes nothing else", () => {
  const dir = tmpDataDir();
  const a = addServer(dir, "old", "http://a:1");
  assert.equal(a.ok, true);
  if (!a.ok) return;
  setServerLastPath(dir, a.server.id, "/w");

  const next = renameServer(dir, a.server.id, "  new  ");
  assert.deepEqual(next.servers[0], {
    id: a.server.id,
    name: "new",
    url: "http://a:1",
    lastPath: "/w",
  });
  assert.equal(next.activeId, a.server.id);
  assert.deepEqual(loadServers(dir), next);
});

test("renameServer falls back to the origin when the name is blank", () => {
  const dir = tmpDataDir();
  const a = addServer(dir, "old", "http://a:1");
  assert.equal(a.ok, true);
  if (!a.ok) return;

  const next = renameServer(dir, a.server.id, "   ");
  assert.equal(next.servers[0].name, "http://a:1");
});

test("renameServer with an unknown id writes nothing", () => {
  const dir = tmpDataDir();
  const a = addServer(dir, "a", "http://a:1");
  assert.equal(a.ok, true);
  if (!a.ok) return;

  const before = readFileSync(join(dir, "servers.json"), "utf8");
  const result = renameServer(dir, "nope", "new");
  assert.deepEqual(result, a.list);
  assert.equal(readFileSync(join(dir, "servers.json"), "utf8"), before);
});

test("findServerByOrigin prefers the active entry among same-origin duplicates", () => {
  const first = { id: "s1", name: "one", url: "http://a:1" };
  const second = { id: "s2", name: "two", url: "http://a:1" };
  assert.equal(
    findServerByOrigin({ version: 1, activeId: "s2", servers: [first, second] }, "http://a:1"),
    second,
  );
});

test("findServerByOrigin falls back to the first match when the active entry has another origin", () => {
  const first = { id: "s1", name: "one", url: "http://a:1" };
  const second = { id: "s2", name: "two", url: "http://a:1" };
  const other = { id: "s3", name: "three", url: "http://b:2" };
  assert.equal(
    findServerByOrigin(
      { version: 1, activeId: "s3", servers: [first, second, other] },
      "http://a:1",
    ),
    first,
  );
});

test("findServerByOrigin returns null when no entry matches the origin", () => {
  const one = { id: "s1", name: "one", url: "http://a:1" };
  assert.equal(
    findServerByOrigin({ version: 1, activeId: "s1", servers: [one] }, "http://b:2"),
    null,
  );
});

test("resolveActiveServer: active entry, dangling-id fallback to first, null when empty", () => {
  const one = { id: "s1", name: "one", url: "http://one:1" };
  const two = { id: "s2", name: "two", url: "http://two:2" };
  assert.equal(
    resolveActiveServer({ version: 1, activeId: "s2", servers: [one, two] }),
    two,
  );
  assert.equal(
    resolveActiveServer({ version: 1, activeId: "gone", servers: [one, two] }),
    one,
  );
  assert.equal(resolveActiveServer({ version: 1, activeId: null, servers: [] }), null);
});
