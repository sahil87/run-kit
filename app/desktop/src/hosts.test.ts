/**
 * node:test suite for the host-list store (run via `pnpm run test` after
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
  addHost,
  findHostByOrigin,
  hostInfos,
  loadHosts,
  moveHost,
  normalizeOrigin,
  removeHost,
  resolveActiveHost,
  saveHosts,
  setActiveHost,
  setHostAccentColor,
  setHostLastPath,
} from "./hosts";

function tmpDataDir(): string {
  return mkdtempSync(join(tmpdir(), "rk-desktop-hosts-"));
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

test("loadHosts returns an empty list for a missing file", () => {
  const dir = tmpDataDir();
  assert.deepEqual(loadHosts(dir), { version: 1, activeId: null, hosts: [] });
});

test("loadHosts returns an empty list for corrupt JSON", () => {
  const dir = tmpDataDir();
  writeFileSync(join(dir, "hosts.json"), "{ not json !!", "utf8");
  assert.deepEqual(loadHosts(dir), { version: 1, activeId: null, hosts: [] });
});

test("loadHosts returns an empty list for wrong-shape JSON", () => {
  const dir = tmpDataDir();
  writeFileSync(join(dir, "hosts.json"), JSON.stringify({ version: 2, hosts: "nope" }), "utf8");
  assert.deepEqual(loadHosts(dir), { version: 1, activeId: null, hosts: [] });
});

test("loadHosts never reads the pre-rename servers.json (no migration, no fallback)", () => {
  const dir = tmpDataDir();
  const legacy = {
    version: 1,
    activeId: "s1",
    servers: [{ id: "s1", name: "one", url: "http://one:1" }],
  };
  writeFileSync(join(dir, "servers.json"), JSON.stringify(legacy), "utf8");
  const before = readFileSync(join(dir, "servers.json"), "utf8");
  assert.deepEqual(loadHosts(dir), { version: 1, activeId: null, hosts: [] });
  // The old file is left on disk untouched — never read, never deleted.
  assert.equal(readFileSync(join(dir, "servers.json"), "utf8"), before);
});

test("addHost normalizes, persists, sets active, and round-trips through load", () => {
  const dir = tmpDataDir();
  const result = addHost(dir, "studio-mac", "http://100.101.2.3:3000/dashboard");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.host.url, "http://100.101.2.3:3000");
  assert.equal(result.list.activeId, result.host.id);

  const loaded = loadHosts(dir);
  assert.deepEqual(loaded, result.list);
});

test("addHost with an invalid URL persists nothing", () => {
  const dir = tmpDataDir();
  const result = addHost(dir, "bad", "ftp://host");
  assert.equal(result.ok, false);
  assert.deepEqual(loadHosts(dir), { version: 1, activeId: null, hosts: [] });
});

test("addHost falls back to the origin as display name when name is blank", () => {
  const dir = tmpDataDir();
  const result = addHost(dir, "   ", "http://localhost:3000");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.host.name, "http://localhost:3000");
});

test("saveHosts writes atomically to hosts.json and leaves no tmp files behind", () => {
  const dir = tmpDataDir();
  saveHosts(dir, { version: 1, activeId: null, hosts: [] });
  assert.deepEqual(readdirSync(dir), ["hosts.json"]);
  const raw: unknown = JSON.parse(readFileSync(join(dir, "hosts.json"), "utf8"));
  assert.deepEqual(raw, { version: 1, activeId: null, hosts: [] });
});

test("removeHost of the active entry activates the first remaining", () => {
  const dir = tmpDataDir();
  const a = addHost(dir, "a", "http://a:1");
  const b = addHost(dir, "b", "http://b:2");
  assert.equal(a.ok && b.ok, true);
  if (!a.ok || !b.ok) return;

  const next = removeHost(dir, b.host.id); // b was active (added last)
  assert.equal(next.activeId, a.host.id);
  assert.equal(next.hosts.length, 1);
});

test("removeHost of the last entry empties the list (welcome route)", () => {
  const dir = tmpDataDir();
  const a = addHost(dir, "a", "http://a:1");
  assert.equal(a.ok, true);
  if (!a.ok) return;

  const next = removeHost(dir, a.host.id);
  assert.deepEqual(next, { version: 1, activeId: null, hosts: [] });
});

test("setActiveHost switches active; unknown ids are a no-op", () => {
  const dir = tmpDataDir();
  const a = addHost(dir, "a", "http://a:1");
  const b = addHost(dir, "b", "http://b:2");
  assert.equal(a.ok && b.ok, true);
  if (!a.ok || !b.ok) return;

  assert.equal(setActiveHost(dir, a.host.id).activeId, a.host.id);
  assert.equal(setActiveHost(dir, "nope").activeId, a.host.id);
});

test("loadHosts keeps a pre-lastPath file unchanged (no field added, no entry dropped)", () => {
  const dir = tmpDataDir();
  const stored = {
    version: 1,
    activeId: "h1",
    hosts: [{ id: "h1", name: "one", url: "http://one:1" }],
  };
  writeFileSync(join(dir, "hosts.json"), JSON.stringify(stored), "utf8");
  assert.deepEqual(loadHosts(dir), stored);
});

test("loadHosts keeps a string lastPath", () => {
  const dir = tmpDataDir();
  const stored = {
    version: 1,
    activeId: "h1",
    hosts: [{ id: "h1", name: "one", url: "http://one:1", lastPath: "/board/main" }],
  };
  writeFileSync(join(dir, "hosts.json"), JSON.stringify(stored), "utf8");
  assert.deepEqual(loadHosts(dir), stored);
});

test("loadHosts drops a wrong-typed lastPath but keeps the entry and the list", () => {
  const dir = tmpDataDir();
  const stored = {
    version: 1,
    activeId: "h1",
    hosts: [
      { id: "h1", name: "one", url: "http://one:1", lastPath: 42 },
      { id: "h2", name: "two", url: "http://two:2", lastPath: "/w" },
    ],
  };
  writeFileSync(join(dir, "hosts.json"), JSON.stringify(stored), "utf8");
  assert.deepEqual(loadHosts(dir), {
    version: 1,
    activeId: "h1",
    hosts: [
      { id: "h1", name: "one", url: "http://one:1" },
      { id: "h2", name: "two", url: "http://two:2", lastPath: "/w" },
    ],
  });
});

test("setHostLastPath sets, overwrites, and round-trips through load", () => {
  const dir = tmpDataDir();
  const a = addHost(dir, "a", "http://a:1");
  assert.equal(a.ok, true);
  if (!a.ok) return;

  setHostLastPath(dir, a.host.id, "/s1/w1");
  const next = setHostLastPath(dir, a.host.id, "/board/b?x=1");
  assert.equal(next.hosts[0].lastPath, "/board/b?x=1");
  assert.deepEqual(loadHosts(dir), next);
  assert.deepEqual(loadHosts(dir).hosts[0], {
    id: a.host.id,
    name: "a",
    url: "http://a:1",
    lastPath: "/board/b?x=1",
  });
});

test("setHostLastPath with an unknown id writes nothing", () => {
  const dir = tmpDataDir();
  const a = addHost(dir, "a", "http://a:1");
  assert.equal(a.ok, true);
  if (!a.ok) return;

  const before = readFileSync(join(dir, "hosts.json"), "utf8");
  const result = setHostLastPath(dir, "nope", "/x");
  assert.deepEqual(result, a.list);
  assert.equal(readFileSync(join(dir, "hosts.json"), "utf8"), before);
});

test("setHostLastPath with an unchanged value writes nothing", () => {
  const dir = tmpDataDir();
  const a = addHost(dir, "a", "http://a:1");
  assert.equal(a.ok, true);
  if (!a.ok) return;

  const first = setHostLastPath(dir, a.host.id, "/w");
  const before = readFileSync(join(dir, "hosts.json"), "utf8");
  const again = setHostLastPath(dir, a.host.id, "/w");
  assert.deepEqual(again, first);
  assert.equal(readFileSync(join(dir, "hosts.json"), "utf8"), before);
});

test("findHostByOrigin prefers the active entry among same-origin duplicates", () => {
  const first = { id: "h1", name: "one", url: "http://a:1" };
  const second = { id: "h2", name: "two", url: "http://a:1" };
  assert.equal(
    findHostByOrigin({ version: 1, activeId: "h2", hosts: [first, second] }, "http://a:1"),
    second,
  );
});

test("findHostByOrigin falls back to the first match when the active entry has another origin", () => {
  const first = { id: "h1", name: "one", url: "http://a:1" };
  const second = { id: "h2", name: "two", url: "http://a:1" };
  const other = { id: "h3", name: "three", url: "http://b:2" };
  assert.equal(
    findHostByOrigin(
      { version: 1, activeId: "h3", hosts: [first, second, other] },
      "http://a:1",
    ),
    first,
  );
});

test("findHostByOrigin returns null when no entry matches the origin", () => {
  const one = { id: "h1", name: "one", url: "http://a:1" };
  assert.equal(
    findHostByOrigin({ version: 1, activeId: "h1", hosts: [one] }, "http://b:2"),
    null,
  );
});

test("resolveActiveHost: active entry, dangling-id fallback to first, null when empty", () => {
  const one = { id: "h1", name: "one", url: "http://one:1" };
  const two = { id: "h2", name: "two", url: "http://two:2" };
  assert.equal(
    resolveActiveHost({ version: 1, activeId: "h2", hosts: [one, two] }),
    two,
  );
  assert.equal(
    resolveActiveHost({ version: 1, activeId: "gone", hosts: [one, two] }),
    one,
  );
  assert.equal(resolveActiveHost({ version: 1, activeId: null, hosts: [] }), null);
});

test("hostInfos flags the active entry", () => {
  const one = { id: "h1", name: "one", url: "http://one:1" };
  const two = { id: "h2", name: "two", url: "http://two:2" };
  assert.deepEqual(hostInfos({ version: 1, activeId: "h2", hosts: [one, two] }), [
    { id: "h1", name: "one", url: "http://one:1", active: false },
    { id: "h2", name: "two", url: "http://two:2", active: true },
  ]);
});

test("hostInfos marks the first host active when activeId dangles", () => {
  const one = { id: "h1", name: "one", url: "http://one:1" };
  const two = { id: "h2", name: "two", url: "http://two:2" };
  const infos = hostInfos({ version: 1, activeId: "gone", hosts: [one, two] });
  assert.deepEqual(
    infos.map((h) => h.active),
    [true, false],
  );
});

test("hostInfos of an empty list is empty", () => {
  assert.deepEqual(hostInfos({ version: 1, activeId: null, hosts: [] }), []);
});

test("addHost persists a remote name and round-trips it through load", () => {
  const dir = tmpDataDir();
  const result = addHost(dir, "buildbox", "http://127.0.0.1:3100", "buildbox");
  assert.equal(result.ok, true);
  const loaded = loadHosts(dir);
  assert.equal(loaded.hosts.length, 1);
  assert.equal(loaded.hosts[0].remote, "buildbox");
  assert.equal(loaded.hosts[0].url, "http://127.0.0.1:3100");
});

test("addHost without a remote (or with a blank one) persists no remote field", () => {
  const dir = tmpDataDir();
  addHost(dir, "plain", "http://host:3000");
  addHost(dir, "blank", "http://host:3001", "  ");
  const raw = JSON.parse(readFileSync(join(dir, "hosts.json"), "utf8")) as {
    hosts: Record<string, unknown>[];
  };
  for (const entry of raw.hosts) {
    assert.equal("remote" in entry, false);
  }
});

test("loadHosts keeps a string remote", () => {
  const dir = tmpDataDir();
  const stored = {
    version: 1,
    activeId: "a",
    hosts: [{ id: "a", name: "buildbox", url: "http://127.0.0.1:3100", remote: "buildbox" }],
  };
  writeFileSync(join(dir, "hosts.json"), JSON.stringify(stored), "utf8");
  const loaded = loadHosts(dir);
  assert.equal(loaded.hosts[0].remote, "buildbox");
});

test("loadHosts drops a wrong-typed remote but keeps the entry and the list", () => {
  const dir = tmpDataDir();
  const stored = {
    version: 1,
    activeId: "a",
    hosts: [
      { id: "a", name: "bad", url: "http://h:1", remote: 42 },
      { id: "b", name: "good", url: "http://h:2", remote: "vm2" },
    ],
  };
  writeFileSync(join(dir, "hosts.json"), JSON.stringify(stored), "utf8");
  const loaded = loadHosts(dir);
  assert.equal(loaded.hosts.length, 2);
  assert.equal("remote" in loaded.hosts[0], false);
  assert.equal(loaded.hosts[1].remote, "vm2");
});

test("loadHosts keeps a pre-remote file unchanged (schema still version 1)", () => {
  const dir = tmpDataDir();
  const stored = {
    version: 1,
    activeId: "a",
    hosts: [{ id: "a", name: "old", url: "http://h:1" }],
  };
  writeFileSync(join(dir, "hosts.json"), JSON.stringify(stored), "utf8");
  const loaded = loadHosts(dir);
  assert.equal(loaded.version, 1);
  assert.equal(loaded.hosts.length, 1);
  assert.equal("remote" in loaded.hosts[0], false);
});

test("loadHosts keeps a string accentColor and drops a wrong-typed one (schema still version 1)", () => {
  const dir = tmpDataDir();
  const stored = {
    version: 1,
    activeId: "a",
    hosts: [
      { id: "a", name: "bad", url: "http://h:1", accentColor: 42 },
      { id: "b", name: "good", url: "http://h:2", accentColor: "#8b7ff0" },
      { id: "c", name: "plain", url: "http://h:3" },
    ],
  };
  writeFileSync(join(dir, "hosts.json"), JSON.stringify(stored), "utf8");
  const loaded = loadHosts(dir);
  assert.equal(loaded.version, 1);
  assert.equal(loaded.hosts.length, 3);
  assert.equal("accentColor" in loaded.hosts[0], false);
  assert.equal(loaded.hosts[1].accentColor, "#8b7ff0");
  assert.equal("accentColor" in loaded.hosts[2], false);
});

test("setHostAccentColor sets, overwrites, and round-trips through load", () => {
  const dir = tmpDataDir();
  const a = addHost(dir, "a", "http://a:1");
  const b = addHost(dir, "b", "http://b:2");
  assert.equal(a.ok && b.ok, true);
  if (!a.ok || !b.ok) return;

  setHostAccentColor(dir, a.host.id, "#8b7ff0");
  const next = setHostAccentColor(dir, a.host.id, "#4a4468");
  assert.equal(next.hosts[0].accentColor, "#4a4468");
  // Only the target entry is patched.
  assert.equal("accentColor" in next.hosts[1], false);
  assert.deepEqual(loadHosts(dir), next);
});

test("setHostAccentColor with an unknown id writes nothing", () => {
  const dir = tmpDataDir();
  const a = addHost(dir, "a", "http://a:1");
  assert.equal(a.ok, true);
  if (!a.ok) return;

  const before = readFileSync(join(dir, "hosts.json"), "utf8");
  const result = setHostAccentColor(dir, "nope", "#8b7ff0");
  assert.deepEqual(result, a.list);
  assert.equal(readFileSync(join(dir, "hosts.json"), "utf8"), before);
});

test("setHostAccentColor with an unchanged value writes nothing", () => {
  const dir = tmpDataDir();
  const a = addHost(dir, "a", "http://a:1");
  assert.equal(a.ok, true);
  if (!a.ok) return;

  const first = setHostAccentColor(dir, a.host.id, "#8b7ff0");
  const before = readFileSync(join(dir, "hosts.json"), "utf8");
  const again = setHostAccentColor(dir, a.host.id, "#8b7ff0");
  assert.deepEqual(again, first);
  assert.equal(readFileSync(join(dir, "hosts.json"), "utf8"), before);
});

test("moveHost reorders by id and leaves activeId untouched", () => {
  const dir = tmpDataDir();
  const a = addHost(dir, "a", "http://a:1");
  assert.equal(a.ok, true);
  if (!a.ok) return;
  const b = addHost(dir, "b", "http://b:2");
  const c = addHost(dir, "c", "http://c:3");
  assert.equal(b.ok && c.ok, true);
  if (!b.ok || !c.ok) return;

  const next = moveHost(dir, c.host.id, 0);
  assert.deepEqual(
    next.hosts.map((h) => h.id),
    [c.host.id, a.host.id, b.host.id],
  );
  assert.equal(next.activeId, c.host.id); // c was active (added last)
  assert.deepEqual(loadHosts(dir), next);
});

test("moveHost clamps an out-of-range target index", () => {
  const dir = tmpDataDir();
  const a = addHost(dir, "a", "http://a:1");
  const b = addHost(dir, "b", "http://b:2");
  const c = addHost(dir, "c", "http://c:3");
  assert.equal(a.ok && b.ok && c.ok, true);
  if (!a.ok || !b.ok || !c.ok) return;

  const next = moveHost(dir, a.host.id, 5);
  assert.deepEqual(
    next.hosts.map((h) => h.id),
    [b.host.id, c.host.id, a.host.id],
  );
});

test("moveHost with an unknown id or a same-index move writes nothing", () => {
  const dir = tmpDataDir();
  const a = addHost(dir, "a", "http://a:1");
  const b = addHost(dir, "b", "http://b:2");
  assert.equal(a.ok && b.ok, true);
  if (!a.ok || !b.ok) return;

  const before = readFileSync(join(dir, "hosts.json"), "utf8");
  assert.deepEqual(moveHost(dir, "nope", 0).hosts, b.list.hosts);
  assert.equal(readFileSync(join(dir, "hosts.json"), "utf8"), before);
  assert.deepEqual(moveHost(dir, a.host.id, 0).hosts, b.list.hosts);
  assert.equal(readFileSync(join(dir, "hosts.json"), "utf8"), before);
});

test("hostInfos carries accentColor when the entry has one (and never fills waiting)", () => {
  const colored = { id: "h1", name: "one", url: "http://one:1", accentColor: "#8b7ff0" };
  const plain = { id: "h2", name: "two", url: "http://two:2" };
  const infos = hostInfos({ version: 1, activeId: "h1", hosts: [colored, plain] });
  assert.deepEqual(infos, [
    { id: "h1", name: "one", url: "http://one:1", active: true, accentColor: "#8b7ff0" },
    { id: "h2", name: "two", url: "http://two:2", active: false },
  ]);
  for (const info of infos) assert.equal("waiting" in info, false);
});
