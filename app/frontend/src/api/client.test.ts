import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../tests/msw/server";
import { resetMockSessions } from "../../tests/msw/handlers";
import {
  getHealth,
  getSessions,
  createSession,
  killSession,
  createWindow,
  killWindow,
  renameWindow,
  sendKeys,
  getDirectories,
  uploadFile,
} from "./client";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  resetMockSessions();
});
afterAll(() => server.close());

describe("API client", () => {
  it("getHealth fetches GET /api/health with hostname", async () => {
    const health = await getHealth();
    expect(health.status).toBe("ok");
    expect(health.hostname).toBe("test-host");
  });

  it("getSessions fetches GET /api/sessions", async () => {
    const sessions = await getSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions[0].name).toBe("run-kit");
  });

  it("createSession sends POST /api/sessions with name and cwd", async () => {
    const result = await createSession("my-project", "~/code/my-project");
    expect(result.ok).toBe(true);
  });

  it("createSession sends POST /api/sessions with name only", async () => {
    const result = await createSession("bare");
    expect(result.ok).toBe(true);
  });

  it("killSession sends POST /api/sessions/:session/kill", async () => {
    const result = await killSession("run-kit");
    expect(result.ok).toBe(true);
  });

  it("createWindow sends POST /api/sessions/:session/windows", async () => {
    const result = await createWindow("run-kit", "new-win");
    expect(result.ok).toBe(true);
  });

  it("killWindow sends POST /api/sessions/:session/windows/:index/kill", async () => {
    const result = await killWindow("run-kit", 0);
    expect(result.ok).toBe(true);
  });

  it("renameWindow sends POST /api/sessions/:session/windows/:index/rename", async () => {
    const result = await renameWindow("run-kit", 0, "renamed");
    expect(result.ok).toBe(true);
  });

  it("sendKeys sends POST /api/sessions/:session/windows/:index/keys", async () => {
    const result = await sendKeys("run-kit", 0, "echo hello");
    expect(result.ok).toBe(true);
  });

  it("getDirectories sends GET /api/directories?prefix=...", async () => {
    const dirs = await getDirectories("~/code/");
    expect(dirs).toHaveLength(2);
    expect(dirs[0]).toContain("project-a");
  });

  it("uploadFile sends POST /api/sessions/:session/upload", async () => {
    const file = new File(["content"], "test.txt", { type: "text/plain" });
    const result = await uploadFile("run-kit", file, "0");
    expect(result.ok).toBe(true);
    expect(result.path).toContain("run-kit");
  });
});

describe("API request deduplication", () => {
  it("deduplicates concurrent GET requests to the same endpoint", async () => {
    let callCount = 0;
    server.use(
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
    server.use(
      http.post("/api/sessions", async ({ request }) => {
        callCount++;
        await request.json();
        return HttpResponse.json({ ok: true }, { status: 201 });
      }),
    );

    await Promise.all([
      createSession("proj-a"),
      createSession("proj-b"),
    ]);
    expect(callCount).toBe(2);
  });

  it("cleans up after resolve so sequential calls make fresh requests", async () => {
    let callCount = 0;
    server.use(
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
    server.use(
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
    server.use(
      http.get("/api/health", () => {
        healthCount++;
        return HttpResponse.json({ status: "ok", hostname: "test-host" });
      }),
      http.get("/api/sessions", () => {
        sessionsCount++;
        return HttpResponse.json([]);
      }),
    );

    await Promise.all([getHealth(), getSessions()]);
    expect(healthCount).toBe(1);
    expect(sessionsCount).toBe(1);
  });
});
