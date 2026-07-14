import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server as mswServer } from "../../tests/msw/server";
import { resetMockSessions } from "../../tests/msw/handlers";
import {
  getHealth,
  getSessions,
  getSessionOrder,
  setSessionOrder,
  createSession,
  renameSession,
  killSession,
  createWindow,
  killWindow,
  renameWindow,
  sendKeys,
  getDirectories,
  uploadFile,
  killServer,
  setThemePreference,
  setServerColor,
  setWindowColor,
  updateWindowUrl,
  updateWindowType,
  triggerForceUpdate,
  triggerRestart,
  DAEMON_SERVER,
  isInfraServer,
  compareServers,
  compareServersRanked,
} from "./client";
import type { ServerInfo } from "./client";

beforeAll(() => mswServer.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  mswServer.resetHandlers();
  resetMockSessions();
});
afterAll(() => mswServer.close());

describe("API client", () => {
  it("getHealth fetches GET /api/health with hostname", async () => {
    const health = await getHealth();
    expect(health.status).toBe("ok");
    expect(health.hostname).toBe("test-host");
  });

  it("getSessions fetches GET /api/sessions with server query", async () => {
    let capturedUrl = "";
    mswServer.use(
      http.get("/api/sessions", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json([]);
      }),
    );
    await getSessions("server-B");
    expect(capturedUrl).toContain("?server=server-B");
  });

  it("createSession sends POST /api/sessions with name and cwd", async () => {
    let capturedUrl = "";
    mswServer.use(
      http.post("/api/sessions", async ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ ok: true }, { status: 201 });
      }),
    );
    const result = await createSession("runkit", "my-project", "~/code/my-project");
    expect(result.ok).toBe(true);
    expect(capturedUrl).toContain("?server=runkit");
  });

  it("createSession sends POST /api/sessions with name only", async () => {
    const result = await createSession("runkit", "bare");
    expect(result.ok).toBe(true);
  });

  it("createSession sends the captured server in the query string", async () => {
    let capturedUrl = "";
    mswServer.use(
      http.post("/api/sessions", async ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ ok: true }, { status: 201 });
      }),
    );
    await createSession("server-B", "foo");
    expect(capturedUrl).toMatch(/\/api\/sessions\?server=server-B$/);
  });

  it("renameSession sends POST /api/sessions/:session/rename with server query", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, string> = {};
    mswServer.use(
      http.post("/api/sessions/:session/rename", async ({ request }) => {
        capturedUrl = request.url;
        capturedBody = (await request.json()) as Record<string, string>;
        return HttpResponse.json({ ok: true });
      }),
    );
    const result = await renameSession("server-B", "foo", "bar");
    expect(result.ok).toBe(true);
    expect(capturedUrl).toMatch(/\/api\/sessions\/foo\/rename\?server=server-B$/);
    expect(capturedBody.name).toBe("bar");
  });

  it("killSession sends POST /api/sessions/:session/kill with server query", async () => {
    let capturedUrl = "";
    mswServer.use(
      http.post("/api/sessions/:session/kill", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ ok: true });
      }),
    );
    const result = await killSession("server-B", "foo");
    expect(result.ok).toBe(true);
    expect(capturedUrl).toMatch(/\/api\/sessions\/foo\/kill\?server=server-B$/);
  });

  it("createWindow sends POST /api/sessions/:session/windows with server query", async () => {
    let capturedUrl = "";
    mswServer.use(
      http.post("/api/sessions/:session/windows", async ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ ok: true }, { status: 201 });
      }),
    );
    const result = await createWindow("server-B", "foo", "editor");
    expect(result.ok).toBe(true);
    expect(capturedUrl).toMatch(/\/api\/sessions\/foo\/windows\?server=server-B$/);
  });

  it("createWindow sends cwd when provided", async () => {
    let capturedBody: Record<string, string> = {};
    mswServer.use(
      http.post("/api/sessions/:session/windows", async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, string>;
        return HttpResponse.json({ ok: true }, { status: 201 });
      }),
    );
    await createWindow("runkit", "run-kit", "new-win", "/home/user/project");
    expect(capturedBody.cwd).toBe("/home/user/project");
  });

  it("createWindow omits cwd when undefined", async () => {
    let capturedBody: Record<string, string> = {};
    mswServer.use(
      http.post("/api/sessions/:session/windows", async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, string>;
        return HttpResponse.json({ ok: true }, { status: 201 });
      }),
    );
    await createWindow("runkit", "run-kit", "new-win");
    expect(capturedBody.cwd).toBeUndefined();
  });

  it("createWindow sends name when provided", async () => {
    let capturedBody: Record<string, string> = {};
    mswServer.use(
      http.post("/api/sessions/:session/windows", async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, string>;
        return HttpResponse.json({ ok: true }, { status: 201 });
      }),
    );
    await createWindow("runkit", "run-kit", "editor");
    expect(capturedBody.name).toBe("editor");
  });

  it("createWindow omits name when absent (tmux auto-names to folder basename)", async () => {
    let capturedBody: Record<string, string> = {};
    mswServer.use(
      http.post("/api/sessions/:session/windows", async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, string>;
        return HttpResponse.json({ ok: true }, { status: 201 });
      }),
    );
    await createWindow("runkit", "run-kit", undefined, "/home/user/project");
    expect(capturedBody.name).toBeUndefined();
    expect(capturedBody.cwd).toBe("/home/user/project");
  });

  it("killWindow sends POST /api/windows/:windowId/kill with server query", async () => {
    let capturedUrl = "";
    mswServer.use(
      http.post("/api/windows/:windowId/kill", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ ok: true });
      }),
    );
    const result = await killWindow("server-B", "@3");
    expect(result.ok).toBe(true);
    expect(capturedUrl).toMatch(/\/api\/windows\/%403\/kill\?server=server-B$/);
  });

  it("renameWindow sends POST /api/windows/:windowId/rename with server query", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, string> = {};
    mswServer.use(
      http.post("/api/windows/:windowId/rename", async ({ request }) => {
        capturedUrl = request.url;
        capturedBody = (await request.json()) as Record<string, string>;
        return HttpResponse.json({ ok: true });
      }),
    );
    const result = await renameWindow("runkit", "@0", "renamed");
    expect(result.ok).toBe(true);
    expect(capturedUrl).toMatch(/\/api\/windows\/%400\/rename\?server=runkit$/);
    expect(capturedBody.name).toBe("renamed");
  });

  it("sendKeys sends POST /api/windows/:windowId/keys with server query", async () => {
    let capturedUrl = "";
    mswServer.use(
      http.post("/api/windows/:windowId/keys", async ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ ok: true });
      }),
    );
    const result = await sendKeys("runkit", "@0", "echo hello");
    expect(result.ok).toBe(true);
    expect(capturedUrl).toContain("?server=runkit");
  });

  it("getDirectories sends GET /api/directories?prefix=...", async () => {
    const dirs = await getDirectories("~/code/");
    expect(dirs).toHaveLength(2);
    expect(dirs[0]).toContain("project-a");
  });

  it("uploadFile sends POST /api/sessions/:session/upload with server query", async () => {
    let capturedUrl = "";
    mswServer.use(
      http.post("/api/sessions/:session/upload", ({ request, params }) => {
        capturedUrl = request.url;
        const sess = params.session as string;
        return HttpResponse.json({ ok: true, path: `/tmp/uploads/${sess}/file.txt` });
      }),
    );
    const file = new File(["content"], "test.txt", { type: "text/plain" });
    const result = await uploadFile("runkit", "run-kit", file, "0");
    expect(result.ok).toBe(true);
    expect(result.path).toContain("run-kit");
    expect(capturedUrl).toContain("?server=runkit");
  });

  it("killServer does NOT carry a server query string", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, string> = {};
    mswServer.use(
      http.post("/api/servers/kill", async ({ request }) => {
        capturedUrl = request.url;
        capturedBody = (await request.json()) as Record<string, string>;
        return HttpResponse.json({ ok: true });
      }),
    );
    await killServer("runkit");
    expect(capturedUrl).toMatch(/\/api\/servers\/kill$/);
    expect(capturedBody.name).toBe("runkit");
  });

  it("encodes server names with special characters", async () => {
    let capturedUrl = "";
    mswServer.use(
      http.post("/api/sessions/:session/rename", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ ok: true });
      }),
    );
    await renameSession("server with spaces", "foo", "bar");
    expect(capturedUrl).toContain("?server=server%20with%20spaces");
  });
});

describe("API request deduplication", () => {
  it("deduplicates concurrent GET requests to the same endpoint", async () => {
    let callCount = 0;
    mswServer.use(
      http.get("/api/health", () => {
        callCount++;
        return HttpResponse.json({ status: "ok", hostname: "test-host" });
      }),
    );

    const [a, b] = await Promise.all([getHealth(), getHealth()]);
    expect(callCount).toBe(1);
    expect(a.status).toBe("ok");
    expect(b.status).toBe("ok");
  });

  it("does not deduplicate POST requests", async () => {
    let callCount = 0;
    mswServer.use(
      http.post("/api/sessions", async ({ request }) => {
        callCount++;
        await request.json();
        return HttpResponse.json({ ok: true }, { status: 201 });
      }),
    );

    await Promise.all([
      createSession("runkit", "proj-a"),
      createSession("runkit", "proj-b"),
    ]);
    expect(callCount).toBe(2);
  });

  it("cleans up after resolve so sequential calls make fresh requests", async () => {
    let callCount = 0;
    mswServer.use(
      http.get("/api/health", () => {
        callCount++;
        return HttpResponse.json({ status: "ok", hostname: "test-host" });
      }),
    );

    await getHealth();
    expect(callCount).toBe(1);

    await getHealth();
    expect(callCount).toBe(2);
  });

  it("cleans up after reject so subsequent calls make fresh requests", async () => {
    let callCount = 0;
    mswServer.use(
      http.get("/api/health", () => {
        callCount++;
        return HttpResponse.json({ error: "boom" }, { status: 500 });
      }),
    );

    await expect(getHealth()).rejects.toThrow();
    expect(callCount).toBe(1);

    await expect(getHealth()).rejects.toThrow();
    expect(callCount).toBe(2);
  });

  it("concurrent GET calls to different URLs are not deduplicated", async () => {
    let healthCount = 0;
    let sessionsCount = 0;
    mswServer.use(
      http.get("/api/health", () => {
        healthCount++;
        return HttpResponse.json({ status: "ok", hostname: "test-host" });
      }),
      http.get("/api/sessions", () => {
        sessionsCount++;
        return HttpResponse.json([]);
      }),
    );

    await Promise.all([getHealth(), getSessions("runkit")]);
    expect(healthCount).toBe(1);
    expect(sessionsCount).toBe(1);
  });

  it("both callers can independently read the JSON body", async () => {
    mswServer.use(
      http.get("/api/health", () => {
        return HttpResponse.json({ status: "ok", hostname: "clone-test" });
      }),
    );

    const [a, b] = await Promise.all([getHealth(), getHealth()]);
    expect(a.hostname).toBe("clone-test");
    expect(b.hostname).toBe("clone-test");
  });

  it("does not deduplicate non-GET (POST) requests", async () => {
    let callCount = 0;
    mswServer.use(
      http.post("/api/settings/theme", async () => {
        callCount++;
        return HttpResponse.json({ status: "ok" });
      }),
    );

    await Promise.all([
      setThemePreference({ theme: "dark" }),
      setThemePreference({ theme: "light" }),
    ]);
    expect(callCount).toBe(2);
  });

  it("concurrent callers both receive the same rejection on failure", async () => {
    mswServer.use(
      http.get("/api/health", () => {
        return HttpResponse.json({ error: "server down" }, { status: 500 });
      }),
    );

    const results = await Promise.allSettled([getHealth(), getHealth()]);
    expect(results[0].status).toBe("rejected");
    expect(results[1].status).toBe("rejected");
  });

  it("getSessionOrder fetches GET /api/sessions/order with server query", async () => {
    let capturedUrl = "";
    mswServer.use(
      http.get("/api/sessions/order", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ order: ["main", "dev"] });
      }),
    );
    const order = await getSessionOrder("server-B");
    expect(capturedUrl).toContain("?server=server-B");
    expect(order).toEqual(["main", "dev"]);
  });

  it("getSessionOrder defaults to empty array when order is absent", async () => {
    mswServer.use(
      http.get("/api/sessions/order", () => HttpResponse.json({})),
    );
    const order = await getSessionOrder("default");
    expect(order).toEqual([]);
  });

  it("getSessionOrder throws on non-2xx response", async () => {
    mswServer.use(
      http.get("/api/sessions/order", () =>
        HttpResponse.json({ error: "boom" }, { status: 500 }),
      ),
    );
    await expect(getSessionOrder("default")).rejects.toThrow("boom");
  });

  it("setSessionOrder sends POST /api/sessions/order with JSON body and server query", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedBody: { order?: string[] } = {};
    let capturedContentType = "";
    mswServer.use(
      http.post("/api/sessions/order", async ({ request }) => {
        capturedUrl = request.url;
        capturedMethod = request.method;
        capturedContentType = request.headers.get("content-type") ?? "";
        capturedBody = (await request.json()) as { order?: string[] };
        return HttpResponse.json({ ok: true });
      }),
    );
    await setSessionOrder("default", ["main", "dev"]);
    expect(capturedMethod).toBe("POST");
    expect(capturedUrl).toContain("?server=default");
    expect(capturedContentType).toContain("application/json");
    expect(capturedBody.order).toEqual(["main", "dev"]);
  });

  it("setSessionOrder throws on non-2xx response", async () => {
    mswServer.use(
      http.post("/api/sessions/order", () =>
        HttpResponse.json({ error: "bad" }, { status: 400 }),
      ),
    );
    await expect(setSessionOrder("default", ["main"])).rejects.toThrow("bad");
  });
});

// --- Verb migration + unified /options contract (this change) ---

describe("POST verb migration + /options contract", () => {
  it("setWindowColor POSTs /options with @color as a single-index string", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedBody: { options?: Record<string, string | null> } = {};
    mswServer.use(
      http.post("/api/windows/:windowId/options", async ({ request }) => {
        capturedUrl = request.url;
        capturedMethod = request.method;
        capturedBody = (await request.json()) as typeof capturedBody;
        return HttpResponse.json({ ok: true });
      }),
    );
    await setWindowColor("default", "@2", "5");
    expect(capturedMethod).toBe("POST");
    expect(capturedUrl).toMatch(/\/api\/windows\/%402\/options\?server=default$/);
    expect(capturedBody.options).toEqual({ "@color": "5" });
  });

  it("setWindowColor POSTs /options with @color as a blend string", async () => {
    let capturedBody: { options?: Record<string, string | null> } = {};
    mswServer.use(
      http.post("/api/windows/:windowId/options", async ({ request }) => {
        capturedBody = (await request.json()) as typeof capturedBody;
        return HttpResponse.json({ ok: true });
      }),
    );
    await setWindowColor("default", "@2", "1+3");
    expect(capturedBody.options).toEqual({ "@color": "1+3" });
  });

  it("setWindowColor sends @color: null to clear", async () => {
    let capturedBody: { options?: Record<string, string | null> } = {};
    mswServer.use(
      http.post("/api/windows/:windowId/options", async ({ request }) => {
        capturedBody = (await request.json()) as typeof capturedBody;
        return HttpResponse.json({ ok: true });
      }),
    );
    await setWindowColor("default", "@2", null);
    expect(capturedBody.options).toEqual({ "@color": null });
  });

  it("updateWindowUrl POSTs /options with @rk_url", async () => {
    let capturedBody: { options?: Record<string, string | null> } = {};
    mswServer.use(
      http.post("/api/windows/:windowId/options", async ({ request }) => {
        capturedBody = (await request.json()) as typeof capturedBody;
        return HttpResponse.json({ ok: true });
      }),
    );
    await updateWindowUrl("default", "@2", "https://x");
    expect(capturedBody.options).toEqual({ "@rk_url": "https://x" });
  });

  it("updateWindowType POSTs /options with @rk_type; empty string maps to null (unset)", async () => {
    const bodies: Array<{ options?: Record<string, string | null> }> = [];
    mswServer.use(
      http.post("/api/windows/:windowId/options", async ({ request }) => {
        bodies.push((await request.json()) as { options?: Record<string, string | null> });
        return HttpResponse.json({ ok: true });
      }),
    );
    await updateWindowType("default", "@2", "iframe");
    await updateWindowType("default", "@2", "");
    expect(bodies[0].options).toEqual({ "@rk_type": "iframe" });
    expect(bodies[1].options).toEqual({ "@rk_type": null });
  });

  it("setThemePreference issues POST (not PUT)", async () => {
    let capturedMethod = "";
    mswServer.use(
      http.post("/api/settings/theme", async ({ request }) => {
        capturedMethod = request.method;
        return HttpResponse.json({ status: "ok" });
      }),
    );
    await setThemePreference({ theme: "dark" });
    expect(capturedMethod).toBe("POST");
  });

  it("setServerColor issues POST (not PUT) with a string color value", async () => {
    let capturedMethod = "";
    let capturedBody: { server?: string; color?: string | null } = {};
    mswServer.use(
      http.post("/api/settings/server-color", async ({ request }) => {
        capturedMethod = request.method;
        capturedBody = (await request.json()) as typeof capturedBody;
        return HttpResponse.json({ status: "ok" });
      }),
    );
    await setServerColor("default", "7");
    expect(capturedMethod).toBe("POST");
    expect(capturedBody).toEqual({ server: "default", color: "7" });
  });

  it("setServerColor sends a blend color value", async () => {
    let capturedBody: { server?: string; color?: string | null } = {};
    mswServer.use(
      http.post("/api/settings/server-color", async ({ request }) => {
        capturedBody = (await request.json()) as typeof capturedBody;
        return HttpResponse.json({ status: "ok" });
      }),
    );
    await setServerColor("default", "1+3");
    expect(capturedBody).toEqual({ server: "default", color: "1+3" });
  });
});

describe("maintenance actions (force update + restart)", () => {
  it("triggerForceUpdate POSTs /api/update with {force:true}", async () => {
    let capturedMethod = "";
    let capturedBody: { force?: boolean } = {};
    mswServer.use(
      http.post("/api/update", async ({ request }) => {
        capturedMethod = request.method;
        capturedBody = (await request.json()) as typeof capturedBody;
        return HttpResponse.json({ status: "updating" }, { status: 202 });
      }),
    );
    await triggerForceUpdate();
    expect(capturedMethod).toBe("POST");
    expect(capturedBody).toEqual({ force: true });
  });

  it("triggerForceUpdate rejects on a non-2xx (e.g. 409 not-brew)", async () => {
    mswServer.use(
      http.post("/api/update", () =>
        HttpResponse.json({ error: "not brew" }, { status: 409 }),
      ),
    );
    await expect(triggerForceUpdate()).rejects.toThrow();
  });

  it("triggerRestart POSTs /api/restart with an empty body", async () => {
    let capturedMethod = "";
    let capturedBody: Record<string, unknown> = {};
    mswServer.use(
      http.post("/api/restart", async ({ request }) => {
        capturedMethod = request.method;
        capturedBody = (await request.json()) as typeof capturedBody;
        return HttpResponse.json({ status: "restarting" }, { status: 202 });
      }),
    );
    await triggerRestart();
    expect(capturedMethod).toBe("POST");
    expect(capturedBody).toEqual({});
  });

  it("triggerRestart rejects on a non-2xx (e.g. 409 on a dev build)", async () => {
    mswServer.use(
      http.post("/api/restart", () =>
        HttpResponse.json({ error: "dev" }, { status: 409 }),
      ),
    );
    await expect(triggerRestart()).rejects.toThrow();
  });
});

describe("infra-server identification", () => {
  const si = (name: string): ServerInfo => ({ name, sessionCount: 0 });

  it("DAEMON_SERVER is the daemon socket name", () => {
    expect(DAEMON_SERVER).toBe("rk-daemon");
  });

  it("isInfraServer matches the exact daemon socket", () => {
    expect(isInfraServer("rk-daemon")).toBe(true);
  });

  it("isInfraServer matches any rk-test- prefixed name", () => {
    expect(isInfraServer("rk-test-e2e")).toBe(true);
    expect(isInfraServer("rk-test-e2e-web-123-456")).toBe(true);
    expect(isInfraServer("rk-test-")).toBe(true);
  });

  it("isInfraServer rejects near-misses", () => {
    expect(isInfraServer("rk-daemon2")).toBe(false);
    expect(isInfraServer("my-rk-daemon")).toBe(false);
    expect(isInfraServer("rktest")).toBe(false);
    expect(isInfraServer("rk-tes")).toBe(false);
    expect(isInfraServer("default")).toBe(false);
    expect(isInfraServer("work")).toBe(false);
  });

  it("compareServers sorts regular servers before infra servers", () => {
    const sorted = [si("rk-daemon"), si("work"), si("default")]
      .sort(compareServers)
      .map((s) => s.name);
    expect(sorted).toEqual(["default", "work", "rk-daemon"]);
  });

  it("compareServers sorts alphabetically within the infra class (byte order)", () => {
    const sorted = [si("rk-test-b"), si("rk-daemon"), si("rk-test-a")]
      .sort(compareServers)
      .map((s) => s.name);
    // "rk-daemon" < "rk-test-a" < "rk-test-b" in byte order.
    expect(sorted).toEqual(["rk-daemon", "rk-test-a", "rk-test-b"]);
  });

  it("compareServers keeps an all-regular list byte-alphabetical (unchanged from backend order)", () => {
    const sorted = [si("charlie"), si("alpha"), si("bravo")]
      .sort(compareServers)
      .map((s) => s.name);
    expect(sorted).toEqual(["alpha", "bravo", "charlie"]);
  });

  it("compareServers interleaves regular and infra correctly from an already-alphabetical input", () => {
    // Mirrors the backend's alphabetical /api/servers response.
    const sorted = [
      si("alpha"),
      si("rk-daemon"),
      si("rk-test-e2e"),
      si("zeta"),
    ]
      .sort(compareServers)
      .map((s) => s.name);
    expect(sorted).toEqual(["alpha", "zeta", "rk-daemon", "rk-test-e2e"]);
  });
});

describe("rank-aware server ordering (compareServersRanked)", () => {
  const sr = (name: string, rank?: number | null): ServerInfo => ({
    name,
    sessionCount: 0,
    rank: rank ?? null,
  });

  it("sorts regular servers by rank ascending", () => {
    const sorted = [sr("b", 1), sr("a", 0), sr("c", 2)]
      .sort(compareServersRanked)
      .map((s) => s.name);
    expect(sorted).toEqual(["a", "b", "c"]);
  });

  it("sorts unranked regular servers after ranked ones (byte-alphabetical among themselves)", () => {
    const sorted = [sr("zebra"), sr("alpha"), sr("mid", 0)]
      .sort(compareServersRanked)
      .map((s) => s.name);
    // "mid" (rank 0) leads; the two unranked follow in byte order.
    expect(sorted).toEqual(["mid", "alpha", "zebra"]);
  });

  it("mixes ranked and unranked correctly", () => {
    // b:1, a:null, a2:0, rk-daemon:null(infra) → a2, b, a, rk-daemon
    const sorted = [sr("b", 1), sr("a"), sr("a2", 0), sr("rk-daemon")]
      .sort(compareServersRanked)
      .map((s) => s.name);
    expect(sorted).toEqual(["a2", "b", "a", "rk-daemon"]);
  });

  it("keeps infra servers pinned last and ignores their rank", () => {
    // Even if an infra server somehow carries a low rank, it stays in the
    // infra class (last), and intra-infra order is byte-alphabetical.
    const sorted = [sr("rk-test-b", 0), sr("work", 5), sr("rk-daemon", 1)]
      .sort(compareServersRanked)
      .map((s) => s.name);
    expect(sorted).toEqual(["work", "rk-daemon", "rk-test-b"]);
  });

  it("keeps an all-regular-unranked list byte-alphabetical (unchanged from compareServers)", () => {
    const input = [sr("charlie"), sr("alpha"), sr("bravo")];
    const ranked = [...input].sort(compareServersRanked).map((s) => s.name);
    const plain = [...input].sort(compareServers).map((s) => s.name);
    expect(ranked).toEqual(["alpha", "bravo", "charlie"]);
    expect(ranked).toEqual(plain);
  });
});
