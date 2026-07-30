import { describe, it, expect, afterEach } from "vitest";
import { isShell, listShellServers, shellInfo, switchShellServer } from "./shell";

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
