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
} from "./client";

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
