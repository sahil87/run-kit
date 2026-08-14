import { describe, it, expect, afterEach } from "vitest";
import {
  addShellHost,
  canAddShellHost,
  canReorderShellHosts,
  isShell,
  listShellServers,
  reorderShellHosts,
  setShellAccent,
  setShellBadge,
  shellInfo,
  switchShellServer,
} from "./shell";

// The desktop shell injects window.runkitShell at runtime via its preload
// contextBridge — nothing type-level guarantees the shape, so these tests
// prove the structural narrowing: well-formed bridges are read, everything
// else (absent, null, primitives, wrong field types) reads as "not a shell".

afterEach(() => {
  delete window.runkitShell;
});

describe("shellInfo / isShell", () => {
  it("returns null / false in a plain browser (bridge absent)", () => {
    expect(shellInfo()).toBeNull();
    expect(isShell()).toBe(false);
  });

  it("returns the shell metadata for a well-formed bridge", () => {
    window.runkitShell = { version: "1.2.3", platform: "darwin" };
    expect(shellInfo()).toEqual({ version: "1.2.3", platform: "darwin" });
    expect(isShell()).toBe(true);
  });

  it("does not leak extra bridge members (e.g. the welcome IPC namespace)", () => {
    window.runkitShell = {
      version: "1.2.3",
      platform: "darwin",
      __welcome: { testServer: () => Promise.resolve() },
    };
    expect(shellInfo()).toEqual({ version: "1.2.3", platform: "darwin" });
  });

  it("rejects a malformed bridge with a non-string version", () => {
    window.runkitShell = { version: 123, platform: "darwin" };
    expect(shellInfo()).toBeNull();
    expect(isShell()).toBe(false);
  });

  it("rejects a bridge missing the platform field", () => {
    window.runkitShell = { version: "1.2.3" };
    expect(shellInfo()).toBeNull();
  });

  it("rejects null and primitive bridge values", () => {
    window.runkitShell = null;
    expect(isShell()).toBe(false);
    window.runkitShell = "1.2.3";
    expect(isShell()).toBe(false);
  });
});

// The servers group rides the same runtime-injected bridge: list/switch must
// read well-formed results and degrade to null/false for everything else —
// absent bridge (plain browser), a pre-servers shell, malformed entries,
// denied ({ ok: false }) results, and rejected invokes.

const serverA = { id: "a", name: "studio-mac", url: "http://a:3000", active: true };
const serverB = { id: "b", name: "lab", url: "http://b:3000", active: false };

function bridgeWith(servers: unknown): void {
  window.runkitShell = { version: "1.2.3", platform: "darwin", servers };
}

describe("listShellServers", () => {
  it("resolves the entries for a well-formed bridge and list result", async () => {
    bridgeWith({
      list: () => Promise.resolve({ ok: true, servers: [serverA, serverB] }),
      switch: () => Promise.resolve({ ok: true }),
    });
    expect(await listShellServers()).toEqual([serverA, serverB]);
  });

  it("resolves null in a plain browser (bridge absent)", async () => {
    expect(await listShellServers()).toBeNull();
  });

  it("resolves null on a shell without the servers group (older shell)", async () => {
    window.runkitShell = { version: "1.2.3", platform: "darwin" };
    expect(await listShellServers()).toBeNull();
  });

  it("resolves null when the group members are not functions", async () => {
    bridgeWith({ list: "nope", switch: () => Promise.resolve({ ok: true }) });
    expect(await listShellServers()).toBeNull();
  });

  it("resolves null on a malformed entry (non-boolean active)", async () => {
    bridgeWith({
      list: () => Promise.resolve({ ok: true, servers: [{ ...serverA, active: "yes" }] }),
      switch: () => Promise.resolve({ ok: true }),
    });
    expect(await listShellServers()).toBeNull();
  });

  it("resolves null on a denied result ({ ok: false })", async () => {
    bridgeWith({
      list: () => Promise.resolve({ ok: false, error: "Not allowed" }),
      switch: () => Promise.resolve({ ok: true }),
    });
    expect(await listShellServers()).toBeNull();
  });

  it("resolves null when the invoke rejects", async () => {
    bridgeWith({
      list: () => Promise.reject(new Error("ipc gone")),
      switch: () => Promise.resolve({ ok: true }),
    });
    expect(await listShellServers()).toBeNull();
  });
});

describe("switchShellServer", () => {
  it("resolves true on an { ok: true } result and passes the id through", async () => {
    let seen: string | null = null;
    bridgeWith({
      list: () => Promise.resolve({ ok: true, servers: [] }),
      switch: (id: string) => {
        seen = id;
        return Promise.resolve({ ok: true });
      },
    });
    expect(await switchShellServer("b")).toBe(true);
    expect(seen).toBe("b");
  });

  it("resolves false on a denied result, outside the shell, and on a rejected invoke", async () => {
    expect(await switchShellServer("a")).toBe(false);
    bridgeWith({
      list: () => Promise.resolve({ ok: true, servers: [] }),
      switch: () => Promise.resolve({ ok: false, error: "Unknown server" }),
    });
    expect(await switchShellServer("a")).toBe(false);
    bridgeWith({
      list: () => Promise.resolve({ ok: true, servers: [] }),
      switch: () => Promise.reject(new Error("ipc gone")),
    });
    expect(await switchShellServer("a")).toBe(false);
  });
});

// The add invoker is ADDITIVE to the servers group (older shells expose only
// list/switch): canAddShellHost gates the UI affordance on its presence, and
// addShellHost degrades exactly like its siblings — false for plain browser,
// pre-add shells, a non-function member, denial, and rejected invokes.

describe("canAddShellHost / addShellHost", () => {
  it("resolves true on an { ok: true } ack when the group carries add", async () => {
    let called = false;
    bridgeWith({
      list: () => Promise.resolve({ ok: true, servers: [] }),
      switch: () => Promise.resolve({ ok: true }),
      add: () => {
        called = true;
        return Promise.resolve({ ok: true });
      },
    });
    expect(canAddShellHost()).toBe(true);
    expect(await addShellHost()).toBe(true);
    expect(called).toBe(true);
  });

  it("reads as unavailable in a plain browser and on a shell without add (older shell)", async () => {
    expect(canAddShellHost()).toBe(false);
    expect(await addShellHost()).toBe(false);
    bridgeWith({
      list: () => Promise.resolve({ ok: true, servers: [serverA, serverB] }),
      switch: () => Promise.resolve({ ok: true }),
    });
    expect(canAddShellHost()).toBe(false);
    expect(await addShellHost()).toBe(false);
  });

  it("reads as unavailable when add is not a function", async () => {
    bridgeWith({
      list: () => Promise.resolve({ ok: true, servers: [] }),
      switch: () => Promise.resolve({ ok: true }),
      add: "welcome?mode=add",
    });
    expect(canAddShellHost()).toBe(false);
    expect(await addShellHost()).toBe(false);
  });

  it("resolves false on a denied result and on a rejected invoke", async () => {
    bridgeWith({
      list: () => Promise.resolve({ ok: true, servers: [] }),
      switch: () => Promise.resolve({ ok: true }),
      add: () => Promise.resolve({ ok: false, error: "Not allowed" }),
    });
    expect(await addShellHost()).toBe(false);
    bridgeWith({
      list: () => Promise.resolve({ ok: true, servers: [] }),
      switch: () => Promise.resolve({ ok: true }),
      add: () => Promise.reject(new Error("ipc gone")),
    });
    expect(await addShellHost()).toBe(false);
  });
});

// The badge group is the third bridge surface: `setShellBadge` must resolve
// true only for a well-formed { ok: true } ack, and false for everything else
// — plain browser, a pre-badge shell, denial, and rejected invokes.

describe("setShellBadge", () => {
  it("resolves true on an { ok: true } ack and passes the count through", async () => {
    let seen: number | null = null;
    window.runkitShell = {
      version: "1.2.3",
      platform: "darwin",
      badge: {
        set: (count: number) => {
          seen = count;
          return Promise.resolve({ ok: true });
        },
      },
    };
    expect(await setShellBadge(3)).toBe(true);
    expect(seen).toBe(3);
  });

  it("resolves false in a plain browser (bridge absent)", async () => {
    expect(await setShellBadge(1)).toBe(false);
  });

  it("resolves false on a shell without the badge group (older shell)", async () => {
    window.runkitShell = { version: "1.2.3", platform: "darwin" };
    expect(await setShellBadge(1)).toBe(false);
  });

  it("resolves false when the group member is not a function", async () => {
    window.runkitShell = { version: "1.2.3", platform: "darwin", badge: { set: "nope" } };
    expect(await setShellBadge(1)).toBe(false);
  });

  it("resolves false on a denied result and on a rejected invoke", async () => {
    window.runkitShell = {
      version: "1.2.3",
      platform: "darwin",
      badge: { set: () => Promise.resolve({ ok: false, error: "Not allowed" }) },
    };
    expect(await setShellBadge(1)).toBe(false);
    window.runkitShell = {
      version: "1.2.3",
      platform: "darwin",
      badge: { set: () => Promise.reject(new Error("ipc gone")) },
    };
    expect(await setShellBadge(1)).toBe(false);
  });
});

// The accent group rides the same runtime-injected bridge as badge (its
// structural twin): setShellAccent must pass the hex through on a well-formed
// ack and degrade to false everywhere else.

describe("setShellAccent", () => {
  it("resolves true on an { ok: true } ack and passes the hex through", async () => {
    let seen: string | null = null;
    window.runkitShell = {
      version: "1.2.3",
      platform: "darwin",
      accent: {
        set: (hex: string) => {
          seen = hex;
          return Promise.resolve({ ok: true });
        },
      },
    };
    expect(await setShellAccent("#8b7ff0")).toBe(true);
    expect(seen).toBe("#8b7ff0");
  });

  it("resolves false in a plain browser and on a shell without the accent group", async () => {
    expect(await setShellAccent("#8b7ff0")).toBe(false);
    window.runkitShell = { version: "1.2.3", platform: "darwin" };
    expect(await setShellAccent("#8b7ff0")).toBe(false);
  });

  it("resolves false when the group member is not a function", async () => {
    window.runkitShell = { version: "1.2.3", platform: "darwin", accent: { set: "nope" } };
    expect(await setShellAccent("#8b7ff0")).toBe(false);
  });

  it("resolves false on a denied result and on a rejected invoke", async () => {
    window.runkitShell = {
      version: "1.2.3",
      platform: "darwin",
      accent: { set: () => Promise.resolve({ ok: false, error: "Not allowed" }) },
    };
    expect(await setShellAccent("#8b7ff0")).toBe(false);
    window.runkitShell = {
      version: "1.2.3",
      platform: "darwin",
      accent: { set: () => Promise.reject(new Error("ipc gone")) },
    };
    expect(await setShellAccent("#8b7ff0")).toBe(false);
  });
});

// accentColor / waiting are ADDITIVE optionals on the servers:list entries
// (cross-version shells omit them): absence always parses; a wrong-typed
// present field rejects the list.

describe("listShellServers optional fields", () => {
  it("parses a newer shell's accentColor/waiting and an older shell's 4-field entries", async () => {
    bridgeWith({
      list: () =>
        Promise.resolve({
          ok: true,
          servers: [
            { ...serverA, accentColor: "#8b7ff0", waiting: 3 },
            serverB, // older-shell shape: both optionals absent
          ],
        }),
      switch: () => Promise.resolve({ ok: true }),
    });
    expect(await listShellServers()).toEqual([
      { ...serverA, accentColor: "#8b7ff0", waiting: 3 },
      serverB,
    ]);
  });

  it("resolves null when a present optional is wrong-typed", async () => {
    bridgeWith({
      list: () =>
        Promise.resolve({ ok: true, servers: [{ ...serverA, accentColor: 42 }] }),
      switch: () => Promise.resolve({ ok: true }),
    });
    expect(await listShellServers()).toBeNull();
    bridgeWith({
      list: () =>
        Promise.resolve({ ok: true, servers: [{ ...serverA, waiting: "3" }] }),
      switch: () => Promise.resolve({ ok: true }),
    });
    expect(await listShellServers()).toBeNull();
  });
});

// The reorder invoker is ADDITIVE to the servers group (older shells expose
// only list/switch/add): canReorderShellHosts gates the strip's reorder
// affordances on its presence, and reorderShellHosts degrades exactly like
// its siblings — false for plain browser, pre-reorder shells, a non-function
// member, denial, and rejected invokes.

describe("canReorderShellHosts / reorderShellHosts", () => {
  it("resolves true on an { ok: true } ack when the group carries reorder", async () => {
    let seen: { id: string; toIndex: number } | null = null;
    bridgeWith({
      list: () => Promise.resolve({ ok: true, servers: [] }),
      switch: () => Promise.resolve({ ok: true }),
      reorder: (id: string, toIndex: number) => {
        seen = { id, toIndex };
        return Promise.resolve({ ok: true });
      },
    });
    expect(canReorderShellHosts()).toBe(true);
    expect(await reorderShellHosts("b", 0)).toBe(true);
    expect(seen).toEqual({ id: "b", toIndex: 0 });
  });

  it("reads as unavailable in a plain browser and on a shell without reorder (older shell)", async () => {
    expect(canReorderShellHosts()).toBe(false);
    expect(await reorderShellHosts("a", 0)).toBe(false);
    bridgeWith({
      list: () => Promise.resolve({ ok: true, servers: [serverA, serverB] }),
      switch: () => Promise.resolve({ ok: true }),
    });
    expect(canReorderShellHosts()).toBe(false);
    expect(await reorderShellHosts("a", 0)).toBe(false);
  });

  it("reads as unavailable when reorder is not a function", async () => {
    bridgeWith({
      list: () => Promise.resolve({ ok: true, servers: [] }),
      switch: () => Promise.resolve({ ok: true }),
      reorder: "servers:reorder",
    });
    expect(canReorderShellHosts()).toBe(false);
    expect(await reorderShellHosts("a", 0)).toBe(false);
  });

  it("resolves false on a denied result and on a rejected invoke", async () => {
    bridgeWith({
      list: () => Promise.resolve({ ok: true, servers: [] }),
      switch: () => Promise.resolve({ ok: true }),
      reorder: () => Promise.resolve({ ok: false, error: "Not allowed" }),
    });
    expect(await reorderShellHosts("a", 0)).toBe(false);
    bridgeWith({
      list: () => Promise.resolve({ ok: true, servers: [] }),
      switch: () => Promise.resolve({ ok: true }),
      reorder: () => Promise.reject(new Error("ipc gone")),
    });
    expect(await reorderShellHosts("a", 0)).toBe(false);
  });
});
