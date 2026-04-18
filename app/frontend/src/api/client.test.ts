import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server as mswServer } from "../../tests/msw/server";
import { resetMockSessions } from "../../tests/msw/handlers";
import {
  getHealth,
  getSessions,
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

  it("killWindow sends POST /api/sessions/:session/windows/:index/kill with server query", async () => {
    let capturedUrl = "";
    mswServer.use(
      http.post("/api/sessions/:session/windows/:index/kill", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ ok: true });
      }),
    );
    const result = await killWindow("server-B", "foo", 3);
    expect(result.ok).toBe(true);
    expect(capturedUrl).toMatch(/\/api\/sessions\/foo\/windows\/3\/kill\?server=server-B$/);
  });

  it("renameWindow sends POST /api/sessions/:session/windows/:index/rename with server query", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, string> = {};
    mswServer.use(
      http.post("/api/sessions/:session/windows/:index/rename", async ({ request }) => {
        capturedUrl = request.url;
        capturedBody = (await request.json()) as Record<string, string>;
        return HttpResponse.json({ ok: true });
      }),
    );
    const result = await renameWindow("runkit", "run-kit", 0, "renamed");
    expect(result.ok).toBe(true);
    expect(capturedUrl).toMatch(/\/api\/sessions\/run-kit\/windows\/0\/rename\?server=runkit$/);
    expect(capturedBody.name).toBe("renamed");
  });

  it("sendKeys sends POST /api/sessions/:session/windows/:index/keys with server query", async () => {
    let capturedUrl = "";
    mswServer.use(
      http.post("/api/sessions/:session/windows/:index/keys", async ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ ok: true });
      }),
    );
    const result = await sendKeys("runkit", "run-kit", 0, "echo hello");
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

  it("does not deduplicate PUT requests", async () => {
    let callCount = 0;
    mswServer.use(
      http.put("/api/settings/theme", async () => {
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
});
