import { describe, it, expect, afterEach } from "vitest";
import {
  addShellHost,
  addShellHostDirect,
  canAddShellHost,
  canAddShellHostDirect,
  canCloseShellWindow,
  canConfirmedRemoveShellHost,
  canNewShellWindow,
  canRemoveShellHost,
  canRenameShellHost,
  canSetShellHostUrl,
  canReorderShellHosts,
  closeShellWindow,
  isShell,
  listShellServers,
  confirmedRemoveShellHost,
  newShellWindow,
  removeShellHost,
  renameShellHost,
  setShellHostUrl,
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

type BridgeCase = {
  name: string;
  available?: () => boolean;
  invoke: () => Promise<unknown>;
  install: (member: unknown) => void;
  installOlder: () => void;
  args: unknown[];
  structured?: boolean;
};

const baseServersBridge = {
  list: () => Promise.resolve({ ok: true, servers: [] }),
  switch: () => Promise.resolve({ ok: true }),
};

const bridgeCases: BridgeCase[] = [
  {
    name: "switch",
    invoke: () => switchShellServer("b"),
    install: (member) => bridgeWith({ ...baseServersBridge, switch: member }),
    installOlder: () => { window.runkitShell = { version: "1.2.3", platform: "darwin" }; },
    args: ["b"],
  },
  {
    name: "add",
    available: canAddShellHost,
    invoke: () => addShellHost(),
    install: (member) => bridgeWith({ ...baseServersBridge, add: member }),
    installOlder: () => bridgeWith(baseServersBridge),
    args: [],
  },
  {
    name: "addDirect",
    available: canAddShellHostDirect,
    invoke: () => addShellHostDirect("lab", "http://b:3000"),
    install: (member) => bridgeWith({ ...baseServersBridge, addDirect: member }),
    installOlder: () => bridgeWith(baseServersBridge),
    args: ["lab", "http://b:3000"],
    structured: true,
  },
  {
    name: "badge",
    invoke: () => setShellBadge(3),
    install: (member) => {
      window.runkitShell = { version: "1.2.3", platform: "darwin", badge: { set: member } };
    },
    installOlder: () => { window.runkitShell = { version: "1.2.3", platform: "darwin" }; },
    args: [3],
  },
  {
    name: "accent",
    invoke: () => setShellAccent("#8b7ff0"),
    install: (member) => {
      window.runkitShell = { version: "1.2.3", platform: "darwin", accent: { set: member } };
    },
    installOlder: () => { window.runkitShell = { version: "1.2.3", platform: "darwin" }; },
    args: ["#8b7ff0"],
  },
  {
    name: "newWindow",
    available: canNewShellWindow,
    invoke: () => newShellWindow(),
    install: (member) => {
      window.runkitShell = { version: "1.2.3", platform: "darwin", windows: { newWindow: member } };
    },
    installOlder: () => { window.runkitShell = { version: "1.2.3", platform: "darwin" }; },
    args: [],
  },
  {
    name: "closeWindow",
    available: canCloseShellWindow,
    invoke: () => closeShellWindow(),
    install: (member) => {
      window.runkitShell = {
        version: "1.2.3",
        platform: "darwin",
        windows: { newWindow: () => Promise.resolve({ ok: true }), close: member },
      };
    },
    installOlder: () => {
      window.runkitShell = {
        version: "1.2.3",
        platform: "darwin",
        windows: { newWindow: () => Promise.resolve({ ok: true }) },
      };
    },
    args: [],
  },
  {
    name: "reorder",
    available: canReorderShellHosts,
    invoke: () => reorderShellHosts("b", 0),
    install: (member) => bridgeWith({ ...baseServersBridge, reorder: member }),
    installOlder: () => bridgeWith(baseServersBridge),
    args: ["b", 0],
  },
  {
    name: "remove",
    available: canRemoveShellHost,
    invoke: () => removeShellHost("b"),
    install: (member) => bridgeWith({ ...baseServersBridge, remove: member }),
    installOlder: () => bridgeWith(baseServersBridge),
    args: ["b"],
  },
  {
    name: "removeConfirmed",
    available: canConfirmedRemoveShellHost,
    invoke: () => confirmedRemoveShellHost("b"),
    install: (member) => bridgeWith({ ...baseServersBridge, removeConfirmed: member }),
    installOlder: () => bridgeWith(baseServersBridge),
    args: ["b"],
  },
  {
    name: "setHostUrl",
    available: canSetShellHostUrl,
    invoke: () => setShellHostUrl("b", "http://x:4100"),
    install: (member) => bridgeWith({ ...baseServersBridge, setUrl: member }),
    installOlder: () => bridgeWith(baseServersBridge),
    args: ["b", "http://x:4100"],
  },
  {
    name: "rename",
    available: canRenameShellHost,
    invoke: () => renameShellHost("b", "lab-2"),
    install: (member) => bridgeWith({ ...baseServersBridge, rename: member }),
    installOlder: () => bridgeWith(baseServersBridge),
    args: ["b", "lab-2"],
  },
];

function expectBridgeResult(result: unknown, structured = false, success = false): void {
  if (structured) {
    expect(result).toMatchObject({ ok: success });
  } else {
    expect(result).toBe(success);
  }
}

describe("optional shell bridge invokers", () => {
  it.each(bridgeCases)("$name accepts a valid acknowledgement and forwards arguments", async (bridge) => {
    let seen: unknown[] | null = null;
    bridge.install((...args: unknown[]) => {
      seen = args;
      return Promise.resolve({ ok: true });
    });
    expect(bridge.available?.() ?? true).toBe(true);
    expectBridgeResult(await bridge.invoke(), bridge.structured, true);
    expect(seen).toEqual(bridge.args);
  });

  it.each(bridgeCases)("$name is unavailable in a browser and an older shell", async (bridge) => {
    expect(bridge.available?.() ?? false).toBe(false);
    expectBridgeResult(await bridge.invoke(), bridge.structured);
    bridge.installOlder();
    expect(bridge.available?.() ?? false).toBe(false);
    expectBridgeResult(await bridge.invoke(), bridge.structured);
  });

  it.each(bridgeCases)("$name rejects a non-function bridge member", async (bridge) => {
    bridge.install("not-a-function");
    expect(bridge.available?.() ?? false).toBe(false);
    expectBridgeResult(await bridge.invoke(), bridge.structured);
  });

  it.each(bridgeCases)("$name resolves failure for denied and rejected invocations", async (bridge) => {
    bridge.install(() => Promise.resolve({ ok: false, error: "Not allowed" }));
    expectBridgeResult(await bridge.invoke(), bridge.structured);
    bridge.install(() => Promise.reject(new Error("ipc gone")));
    expectBridgeResult(await bridge.invoke(), bridge.structured);
  });

  it("removeConfirmed remains independent from remove", async () => {
    bridgeWith({ ...baseServersBridge, remove: () => Promise.resolve({ ok: true }) });
    expect(canConfirmedRemoveShellHost()).toBe(false);
    expect(await confirmedRemoveShellHost("a")).toBe(false);
  });

  it("addDirect carries a main-side error and supplies a generic fallback", async () => {
    bridgeWith({
      ...baseServersBridge,
      addDirect: () => Promise.resolve({ ok: false, error: "No response from host" }),
    });
    expect(await addShellHostDirect("", "http://b:3000")).toEqual({
      ok: false,
      error: "No response from host",
    });

    bridgeWith({ ...baseServersBridge, addDirect: () => Promise.resolve({ ok: false }) });
    const result = await addShellHostDirect("", "http://b:3000");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toBe("");
  });

  it("addDirect rejects malformed acknowledgements without throwing", async () => {
    bridgeWith({ ...baseServersBridge, addDirect: () => Promise.resolve("added") });
    expect((await addShellHostDirect("", "http://b:3000")).ok).toBe(false);
  });
});

describe("listShellServers optional fields", () => {
  it("parses newer optional fields and older entries", async () => {
    bridgeWith({
      ...baseServersBridge,
      list: () =>
        Promise.resolve({
          ok: true,
          servers: [
            { ...serverA, accentColor: "#8b7ff0", waiting: 3 },
            serverB,
          ],
        }),
    });
    expect(await listShellServers()).toEqual([
      { ...serverA, accentColor: "#8b7ff0", waiting: 3 },
      serverB,
    ]);
  });

  it("rejects wrong-typed optional fields", async () => {
    for (const entry of [
      { ...serverA, accentColor: 42 },
      { ...serverA, waiting: "3" },
    ]) {
      bridgeWith({
        ...baseServersBridge,
        list: () => Promise.resolve({ ok: true, servers: [entry] }),
      });
      expect(await listShellServers()).toBeNull();
    }
  });
});
