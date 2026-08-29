import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server as mswServer } from "../../tests/msw/server";
import { resetMockSessions } from "../../tests/msw/handlers";
import {
  getHealth,
  getOpenApps,
  openInApp,
  getSessions,
  setSessionOrder,
  createSession,
  renameSession,
  killSession,
  createWindow,
  killWindow,
  renameWindow,
  sendChatMessage,
  pasteToWindow,
  fetchWindowHistory,
  getDirectories,
  uploadFile,
  killServer,
  setServerProtected,
  getThemePreference,
  setThemePreference,
  getServerColor,
  setServerColor,
  getAllServerColors,
  getAllServerFlairs,
  setServerFlair,
  getInstanceColor,
  getSSHHost,
  setSSHHost,
  getInstanceName,
  setInstanceName,
  getSettingsEntries,
  postSettings,
  setWindowColor,
  setWindowRole,
  setWindowFlair,
  setSessionFlair,
  addWebTab,
  removeWebTab,
  selectWebTab,
  triggerUpdate,
  triggerForceUpdate,
  triggerRestart,
  refreshStatus,
  checkForUpdates,
  getRecoveryOffers,
  restoreRecoveryServer,
  dismissRecoveryServer,
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

  it("getHealth surfaces the optional sshHost field when present", async () => {
    mswServer.use(
      http.get("/api/health", () =>
        HttpResponse.json({ status: "ok", hostname: "test-host", sshHost: "devbox" }),
      ),
    );
    const health = await getHealth();
    expect(health.sshHost).toBe("devbox");
  });

  it("getOpenApps returns the registry array", async () => {
    mswServer.use(
      http.get("/api/open-apps", () =>
        HttpResponse.json([{ id: "vscode", label: "VS Code", kind: "editor" }]),
      ),
    );
    const apps = await getOpenApps();
    expect(apps).toEqual([{ id: "vscode", label: "VS Code", kind: "editor" }]);
  });

  it("getOpenApps is fail-silent: non-200 resolves to []", async () => {
    mswServer.use(
      http.get("/api/open-apps", () =>
        HttpResponse.json({ error: "boom" }, { status: 500 }),
      ),
    );
    await expect(getOpenApps()).resolves.toEqual([]);
  });

  it("getOpenApps is fail-silent: non-array body resolves to []", async () => {
    mswServer.use(
      http.get("/api/open-apps", () => HttpResponse.json({ nope: true })),
    );
    await expect(getOpenApps()).resolves.toEqual([]);
  });

  it("openInApp POSTs path+app to /api/open with the server query", async () => {
    let capturedUrl = "";
    let capturedBody: unknown = null;
    mswServer.use(
      http.post("/api/open", async ({ request }) => {
        capturedUrl = request.url;
        capturedBody = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    const res = await openInApp("runkit", "/Users/x/code/proj", "vscode");
    expect(res.ok).toBe(true);
    expect(capturedUrl).toContain("?server=runkit");
    expect(capturedBody).toEqual({ path: "/Users/x/code/proj", app: "vscode" });
  });

  it("openInApp throws the server's error message on failure", async () => {
    mswServer.use(
      http.post("/api/open", () =>
        HttpResponse.json({ error: "unknown app" }, { status: 400 }),
      ),
    );
    await expect(openInApp("runkit", "/x", "nope")).rejects.toThrow("unknown app");
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

  it("sendChatMessage POSTs /api/windows/:windowId/chat/send with {text} and server query", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedBody: { text?: string } = {};
    mswServer.use(
      http.post("/api/windows/:windowId/chat/send", async ({ request }) => {
        capturedUrl = request.url;
        capturedMethod = request.method;
        capturedBody = (await request.json()) as { text?: string };
        return HttpResponse.json({ ok: true });
      }),
    );
    const result = await sendChatMessage("runkit", "@0", "hello agent");
    expect(result.ok).toBe(true);
    expect(capturedMethod).toBe("POST");
    expect(capturedUrl).toMatch(/\/api\/windows\/%400\/chat\/send\?server=runkit$/);
    expect(capturedBody.text).toBe("hello agent");
    // Default submit ⇒ the body carries NO `submit` key — the additive wire
    // contract keeps the default shape exactly `{ text }` (260719-mxvw).
    expect("submit" in capturedBody).toBe(false);
  });

  it("sendChatMessage serializes submit:false into the body (insert-without-submit)", async () => {
    let capturedBody: { text?: string; submit?: boolean } = {};
    mswServer.use(
      http.post("/api/windows/:windowId/chat/send", async ({ request }) => {
        capturedBody = (await request.json()) as { text?: string; submit?: boolean };
        return HttpResponse.json({ ok: true });
      }),
    );
    const result = await sendChatMessage("runkit", "@0", "stage me", false);
    expect(result.ok).toBe(true);
    expect(capturedBody).toEqual({ text: "stage me", submit: false });
  });

  it("sendChatMessage throws the server's structured error on a non-ok response (409 probe failure)", async () => {
    const probeError =
      "agent input not ready — message pasted but not echoed; Enter withheld. " +
      "The text remains in the agent's input — check the terminal view before retrying, as a resend would duplicate it.";
    mswServer.use(
      http.post("/api/windows/:windowId/chat/send", () =>
        HttpResponse.json({ error: probeError }, { status: 409 }),
      ),
    );
    await expect(sendChatMessage("runkit", "@0", "hi")).rejects.toThrow(
      probeError,
    );
  });

  it("pasteToWindow POSTs /api/windows/:windowId/paste with {text} and server query", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedBody: { text?: string; submit?: boolean } = {};
    mswServer.use(
      http.post("/api/windows/:windowId/paste", async ({ request }) => {
        capturedUrl = request.url;
        capturedMethod = request.method;
        capturedBody = (await request.json()) as { text?: string; submit?: boolean };
        return HttpResponse.json({ ok: true });
      }),
    );
    const result = await pasteToWindow("runkit", "@0", "one\ntwo");
    expect(result.ok).toBe(true);
    expect(capturedMethod).toBe("POST");
    expect(capturedUrl).toMatch(/\/api\/windows\/%400\/paste\?server=runkit$/);
    expect(capturedBody.text).toBe("one\ntwo");
    // Default submit ⇒ no `submit` key — same additive shape as chat send.
    expect("submit" in capturedBody).toBe(false);
  });

  it("pasteToWindow serializes submit:false into the body (paste without Enter)", async () => {
    let capturedBody: { text?: string; submit?: boolean } = {};
    mswServer.use(
      http.post("/api/windows/:windowId/paste", async ({ request }) => {
        capturedBody = (await request.json()) as { text?: string; submit?: boolean };
        return HttpResponse.json({ ok: true });
      }),
    );
    const result = await pasteToWindow("runkit", "@0", "one\ntwo", false);
    expect(result.ok).toBe(true);
    expect(capturedBody).toEqual({ text: "one\ntwo", submit: false });
  });

  it("pasteToWindow throws the server's structured error on a non-ok response (409 probe failure)", async () => {
    const probeError = "agent input not ready — message pasted but not echoed; Enter withheld.";
    mswServer.use(
      http.post("/api/windows/:windowId/paste", () =>
        HttpResponse.json({ error: probeError }, { status: 409 }),
      ),
    );
    await expect(pasteToWindow("runkit", "@0", "a\nb")).rejects.toThrow(probeError);
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
    let capturedBody: Record<string, unknown> = {};
    mswServer.use(
      http.post("/api/servers/kill", async ({ request }) => {
        capturedUrl = request.url;
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true });
      }),
    );
    await killServer("runkit");
    expect(capturedUrl).toMatch(/\/api\/servers\/kill$/);
    expect(capturedBody.name).toBe("runkit");
    expect(capturedBody.force).toBe(false);
  });

  it("killServer carries force for a protected-target force kill", async () => {
    let capturedBody: Record<string, unknown> = {};
    mswServer.use(
      http.post("/api/servers/kill", async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true });
      }),
    );
    await killServer("rk-daemon", true);
    expect(capturedBody.name).toBe("rk-daemon");
    expect(capturedBody.force).toBe(true);
  });

  it("setServerProtected posts name + protected to the protect endpoint", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};
    mswServer.use(
      http.post("/api/servers/protect", async ({ request }) => {
        capturedUrl = request.url;
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true });
      }),
    );
    await setServerProtected("vault", true);
    expect(capturedUrl).toMatch(/\/api\/servers\/protect$/);
    expect(capturedBody).toEqual({ name: "vault", protected: true });

    await setServerProtected("vault", false);
    expect(capturedBody).toEqual({ name: "vault", protected: false });
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

describe("web tab verb wrappers", () => {
  it("addWebTab POSTs {target} to /api/windows/:windowId/web with server query", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedBody: { target?: string } = {};
    mswServer.use(
      http.post("/api/windows/:windowId/web", async ({ request }) => {
        capturedUrl = request.url;
        capturedMethod = request.method;
        capturedBody = (await request.json()) as { target?: string };
        return HttpResponse.json(
          { index: 3, existed: false, url: "/proxy/3003/" },
          { status: 201 },
        );
      }),
    );
    const result = await addWebTab("s", "@5", "/proxy/3003/");
    expect(capturedMethod).toBe("POST");
    expect(capturedUrl).toMatch(/\/api\/windows\/%405\/web\?server=s$/);
    expect(capturedBody).toEqual({ target: "/proxy/3003/" });
    expect(result).toEqual({ index: 3, existed: false, url: "/proxy/3003/" });
  });

  it("removeWebTab POSTs /api/windows/:windowId/web/:n/remove with server query", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    mswServer.use(
      http.post("/api/windows/:windowId/web/:n/remove", ({ request }) => {
        capturedUrl = request.url;
        capturedMethod = request.method;
        return HttpResponse.json({ ok: true });
      }),
    );
    const result = await removeWebTab("s", "@5", 2);
    expect(result.ok).toBe(true);
    expect(capturedMethod).toBe("POST");
    expect(capturedUrl).toMatch(/\/api\/windows\/%405\/web\/2\/remove\?server=s$/);
  });

  it("selectWebTab POSTs /api/windows/:windowId/web/:n/select with server query", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    mswServer.use(
      http.post("/api/windows/:windowId/web/:n/select", ({ request }) => {
        capturedUrl = request.url;
        capturedMethod = request.method;
        return HttpResponse.json({ ok: true });
      }),
    );
    const result = await selectWebTab("s", "@5", 3);
    expect(result.ok).toBe(true);
    expect(capturedMethod).toBe("POST");
    expect(capturedUrl).toMatch(/\/api\/windows\/%405\/web\/3\/select\?server=s$/);
  });

  it("a 409 rejects with the server's error text verbatim (family cap)", async () => {
    mswServer.use(
      http.post("/api/windows/:windowId/web", () =>
        HttpResponse.json({ error: "web tabs full (8)" }, { status: 409 }),
      ),
    );
    await expect(addWebTab("s", "@5", "/proxy/3009/")).rejects.toThrow(
      "web tabs full (8)",
    );
  });
});

describe("recovery offers client", () => {
  const offer = {
    server: "kit",
    takenAt: "2026-08-20T06:00:00Z",
    sessionCount: 2,
    windowCount: 3,
    sessions: [
      {
        name: "dev",
        color: "4",
        windows: [
          { index: 0, name: "shell", paneCount: 1, commands: ["zsh"], resumable: false },
          { index: 1, name: "agent", paneCount: 2, commands: ["zsh", "claude -c"], resumable: true },
        ],
      },
    ],
  };

  it("getRecoveryOffers fetches GET /api/recovery and returns the offers list", async () => {
    mswServer.use(
      http.get("/api/recovery", () => HttpResponse.json({ offers: [offer] })),
    );
    const offers = await getRecoveryOffers();
    expect(offers).toEqual([offer]);
  });

  it("getRecoveryOffers resolves [] when the offers key is absent", async () => {
    mswServer.use(http.get("/api/recovery", () => HttpResponse.json({})));
    await expect(getRecoveryOffers()).resolves.toEqual([]);
  });

  it("getRecoveryOffers throws the server's error message on failure", async () => {
    mswServer.use(
      http.get("/api/recovery", () =>
        HttpResponse.json({ error: "snapshot store unavailable" }, { status: 500 }),
      ),
    );
    await expect(getRecoveryOffers()).rejects.toThrow("snapshot store unavailable");
  });

  it("restoreRecoveryServer POSTs {server} in the body with no query string", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, string> = {};
    mswServer.use(
      http.post("/api/recovery/restore", async ({ request }) => {
        capturedUrl = request.url;
        capturedBody = (await request.json()) as Record<string, string>;
        return HttpResponse.json({ sessionsCreated: 2 });
      }),
    );
    const report = await restoreRecoveryServer("kit");
    expect(capturedUrl).toMatch(/\/api\/recovery\/restore$/);
    expect(capturedBody).toEqual({ server: "kit" });
    expect(report).toEqual({ sessionsCreated: 2 });
  });

  it("restoreRecoveryServer throws the engine's refusal message on failure", async () => {
    mswServer.use(
      http.post("/api/recovery/restore", () =>
        HttpResponse.json({ error: "server already alive" }, { status: 409 }),
      ),
    );
    await expect(restoreRecoveryServer("kit")).rejects.toThrow("server already alive");
  });

  it("dismissRecoveryServer POSTs {server} in the body and returns ok", async () => {
    let capturedBody: Record<string, string> = {};
    mswServer.use(
      http.post("/api/recovery/dismiss", async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, string>;
        return HttpResponse.json({ ok: true });
      }),
    );
    await expect(dismissRecoveryServer("kit")).resolves.toEqual({ ok: true });
    expect(capturedBody).toEqual({ server: "kit" });
  });

  it("dismissRecoveryServer throws the server's error message on failure", async () => {
    mswServer.use(
      http.post("/api/recovery/dismiss", () =>
        HttpResponse.json({ error: "nope" }, { status: 500 }),
      ),
    );
    await expect(dismissRecoveryServer("kit")).rejects.toThrow("nope");
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
      http.post("/api/settings", async () => {
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
  it("setWindowColor POSTs /options with @rk_win_color as a single-index string", async () => {
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
    expect(capturedBody.options).toEqual({ "@rk_win_color": "5" });
  });

  it("setWindowColor POSTs /options with @rk_win_color as a blend string", async () => {
    let capturedBody: { options?: Record<string, string | null> } = {};
    mswServer.use(
      http.post("/api/windows/:windowId/options", async ({ request }) => {
        capturedBody = (await request.json()) as typeof capturedBody;
        return HttpResponse.json({ ok: true });
      }),
    );
    await setWindowColor("default", "@2", "1+3");
    expect(capturedBody.options).toEqual({ "@rk_win_color": "1+3" });
  });

  it("setWindowColor sends @rk_win_color: null to clear", async () => {
    let capturedBody: { options?: Record<string, string | null> } = {};
    mswServer.use(
      http.post("/api/windows/:windowId/options", async ({ request }) => {
        capturedBody = (await request.json()) as typeof capturedBody;
        return HttpResponse.json({ ok: true });
      }),
    );
    await setWindowColor("default", "@2", null);
    expect(capturedBody.options).toEqual({ "@rk_win_color": null });
  });

  it("setWindowRole POSTs /options with @rk_win_role; null and empty string both clear", async () => {
    const bodies: Array<{ options?: Record<string, string | null> }> = [];
    mswServer.use(
      http.post("/api/windows/:windowId/options", async ({ request }) => {
        bodies.push((await request.json()) as { options?: Record<string, string | null> });
        return HttpResponse.json({ ok: true });
      }),
    );
    await setWindowRole("default", "@2", "operator");
    await setWindowRole("default", "@2", null);
    await setWindowRole("default", "@2", "");
    expect(bodies[0].options).toEqual({ "@rk_win_role": "operator" });
    expect(bodies[1].options).toEqual({ "@rk_win_role": "" });
    expect(bodies[2].options).toEqual({ "@rk_win_role": "" });
  });

  it("setWindowFlair POSTs /options with @rk_win_flair; null and empty string both clear", async () => {
    const bodies: Array<{ options?: Record<string, string | null> }> = [];
    mswServer.use(
      http.post("/api/windows/:windowId/options", async ({ request }) => {
        bodies.push((await request.json()) as { options?: Record<string, string | null> });
        return HttpResponse.json({ ok: true });
      }),
    );
    await setWindowFlair("s", "@1", "nyan");
    await setWindowFlair("s", "@1", null);
    await setWindowFlair("s", "@1", "");
    expect(bodies[0].options).toEqual({ "@rk_win_flair": "nyan" });
    expect(bodies[1].options).toEqual({ "@rk_win_flair": "" });
    expect(bodies[2].options).toEqual({ "@rk_win_flair": "" });
  });

  it("setSessionFlair POSTs /api/sessions/{session}/flair with {flair}; null clears", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    const bodies: Array<{ flair?: string | null }> = [];
    mswServer.use(
      http.post("/api/sessions/:session/flair", async ({ request }) => {
        capturedUrl = request.url;
        capturedMethod = request.method;
        bodies.push((await request.json()) as { flair?: string | null });
        return HttpResponse.json({ ok: true });
      }),
    );
    await setSessionFlair("default", "alpha", "naruto");
    await setSessionFlair("default", "alpha", null);
    expect(capturedMethod).toBe("POST");
    expect(capturedUrl).toMatch(/\/api\/sessions\/alpha\/flair\?server=default$/);
    expect(bodies).toEqual([{ flair: "naruto" }, { flair: null }]);
  });

  it("setThemePreference issues POST (not PUT) with the changed keys as a patch", async () => {
    let capturedMethod = "";
    let capturedBody: Record<string, unknown> = {};
    mswServer.use(
      http.post("/api/settings", async ({ request }) => {
        capturedMethod = request.method;
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ status: "ok" });
      }),
    );
    await setThemePreference({ theme: "dark" });
    expect(capturedMethod).toBe("POST");
    expect(capturedBody).toEqual({ theme: "dark" });
  });

  it("setServerColor posts a one-entry server_colors patch (null clears)", async () => {
    const bodies: unknown[] = [];
    mswServer.use(
      http.post("/api/settings", async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ status: "ok" });
      }),
    );
    await setServerColor("default", "7");
    await setServerColor("default", "1+3");
    await setServerColor("default", null);
    expect(bodies).toEqual([
      { server_colors: { default: "7" } },
      { server_colors: { default: "1+3" } },
      { server_colors: { default: null } },
    ]);
  });

  it("getAllServerFlairs reads the server_flairs entry from GET /api/settings", async () => {
    mswServer.use(
      http.get("/api/settings", () =>
        HttpResponse.json({
          settings: [settingsEntry("server_flairs", "map", { default: "nyan", dev: "cube" })],
        }),
      ),
    );
    await expect(getAllServerFlairs()).resolves.toEqual({ default: "nyan", dev: "cube" });
  });

  it("setServerFlair posts a one-entry server_flairs patch; null clears", async () => {
    const bodies: unknown[] = [];
    mswServer.use(
      http.post("/api/settings", async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ status: "ok" });
      }),
    );
    await setServerFlair("default", "cube");
    await setServerFlair("default", null);
    expect(bodies).toEqual([
      { server_flairs: { default: "cube" } },
      { server_flairs: { default: null } },
    ]);
  });

  it("setServerFlair rejects on a non-2xx (e.g. 400 unknown token)", async () => {
    mswServer.use(
      http.post("/api/settings", () =>
        HttpResponse.json({ error: "Flair must be one of: ..." }, { status: 400 }),
      ),
    );
    await expect(setServerFlair("default", "sparkle")).rejects.toThrow();
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

describe("update trigger watch-target parse (260812-z1ya)", () => {
  const WATCH = { server: "rk-daemon", session: "rk-jobs", window: "update", window_id: "@5" };

  it("triggerUpdate resolves the status + watch target from a 202", async () => {
    mswServer.use(
      http.post("/api/update", () =>
        HttpResponse.json({ status: "updating", watch: WATCH }, { status: 202 }),
      ),
    );
    const result = await triggerUpdate();
    expect(result).toEqual({ status: "updating", watch: WATCH });
  });

  it("a 200 already-running is a RESOLVED result carrying the existing window", async () => {
    mswServer.use(
      http.post("/api/update", () =>
        HttpResponse.json({ status: "already-running", watch: WATCH }, { status: 200 }),
      ),
    );
    const result = await triggerUpdate();
    expect(result.status).toBe("already-running");
    expect(result.watch).toEqual(WATCH);
  });

  it("an old-daemon body ({status} only) resolves with watch undefined", async () => {
    mswServer.use(
      http.post("/api/update", () => HttpResponse.json({ status: "updating" }, { status: 202 })),
    );
    const result = await triggerUpdate();
    expect(result).toEqual({ status: "updating", watch: undefined });
  });

  it("a malformed watch key resolves with watch undefined", async () => {
    mswServer.use(
      http.post("/api/update", () =>
        HttpResponse.json({ status: "updating", watch: { server: "rk-daemon" } }, { status: 202 }),
      ),
    );
    const result = await triggerUpdate();
    expect(result.status).toBe("updating");
    expect(result.watch).toBeUndefined();
  });

  it("triggerRestart parses the same shape", async () => {
    const restartWatch = { ...WATCH, window: "restart", window_id: "@9" };
    mswServer.use(
      http.post("/api/restart", () =>
        HttpResponse.json({ status: "restarting", watch: restartWatch }, { status: 202 }),
      ),
    );
    const result = await triggerRestart();
    expect(result).toEqual({ status: "restarting", watch: restartWatch });
  });

  it("triggerForceUpdate parses the same shape", async () => {
    mswServer.use(
      http.post("/api/update", () =>
        HttpResponse.json({ status: "updating", watch: WATCH }, { status: 202 }),
      ),
    );
    const result = await triggerForceUpdate();
    expect(result).toEqual({ status: "updating", watch: WATCH });
  });
});

describe("checkForUpdates source wiring (260720-wb3n)", () => {
  function withCheckResponse(body: Record<string, unknown>) {
    let capturedBody: Record<string, unknown> = {};
    mswServer.use(
      http.post("/api/updates/check", async ({ request }) => {
        capturedBody = (await request.json()) as typeof capturedBody;
        return HttpResponse.json(body);
      }),
    );
    return () => capturedBody;
  }

  const githubRow = {
    tool: "run-kit",
    current: "3.8.0",
    latest: "3.9.1",
    updateAvailable: true,
    notable: false,
  };

  it("default check POSTs an empty body and parses the echoed source", async () => {
    const body = withCheckResponse({ tools: [], key: "", source: "released" });
    const result = await checkForUpdates();
    expect(body()).toEqual({});
    expect(result).toEqual({ tools: [], key: "", source: "released" });
  });

  it('checkForUpdates("github") POSTs {"source":"github"} and parses the echoed source', async () => {
    const body = withCheckResponse({ tools: [githubRow], key: "", source: "github" });
    const result = await checkForUpdates("github");
    expect(body()).toEqual({ source: "github" });
    expect(result.source).toBe("github");
    expect(result.tools).toEqual([githubRow]);
  });

  it("defaults source to an empty string when an old daemon omits it", async () => {
    withCheckResponse({ tools: [], key: "" });
    const result = await checkForUpdates();
    expect(result.source).toBe("");
  });
});

describe("refreshStatus tri-state body (260715-nwla)", () => {
  function withStatusBody(body: { status: string }) {
    mswServer.use(
      http.post("/api/status/refresh", () => HttpResponse.json(body, { status: 202 })),
    );
  }

  it("returns {status:started} for a started 202 body", async () => {
    withStatusBody({ status: "started" });
    expect(await refreshStatus()).toEqual({ status: "started" });
  });

  it("returns {status:coalesced} for a coalesced 202 body", async () => {
    withStatusBody({ status: "coalesced" });
    expect(await refreshStatus()).toEqual({ status: "coalesced" });
  });

  it("returns {status:throttled} for a throttled 202 body", async () => {
    withStatusBody({ status: "throttled" });
    expect(await refreshStatus()).toEqual({ status: "throttled" });
  });

  it("defaults a legacy {status:refreshing} body to started (spin-until-event)", async () => {
    withStatusBody({ status: "refreshing" });
    expect(await refreshStatus()).toEqual({ status: "started" });
  });

  it("defaults an empty/unparseable body to started", async () => {
    mswServer.use(
      http.post("/api/status/refresh", () => new HttpResponse(null, { status: 202 })),
    );
    expect(await refreshStatus()).toEqual({ status: "started" });
  });

  it("rejects on a non-2xx", async () => {
    mswServer.use(
      http.post("/api/status/refresh", () =>
        HttpResponse.json({ error: "boom" }, { status: 500 }),
      ),
    );
    await expect(refreshStatus()).rejects.toThrow();
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

  it("sinks ephemeral servers among unranked regulars (byte order within each group)", () => {
    const input = [
      { name: "alpha", sessionCount: 0, rank: null, ephemeral: true },
      sr("beta"),
      { name: "zeta", sessionCount: 0, rank: null, ephemeral: true },
      sr("rk-daemon"),
    ];
    const sorted = input.sort(compareServersRanked).map((s) => s.name);
    expect(sorted).toEqual(["beta", "alpha", "zeta", "rk-daemon"]);
  });

  it("rank wins over the ephemeral key", () => {
    const input = [
      sr("plain", 1),
      { name: "scratch", sessionCount: 0, rank: 0, ephemeral: true },
    ];
    const sorted = input.sort(compareServersRanked).map((s) => s.name);
    expect(sorted).toEqual(["scratch", "plain"]);
  });

  it("ignores ephemeral on infra servers (intra-infra order stays byte-alphabetical)", () => {
    const input = [
      { name: "rk-test-b", sessionCount: 0, rank: null, ephemeral: true },
      sr("work"),
      sr("rk-daemon"),
    ];
    const sorted = input.sort(compareServersRanked).map((s) => s.name);
    expect(sorted).toEqual(["work", "rk-daemon", "rk-test-b"]);
  });
});

// settingsEntry builds one GET /api/settings payload row for the msw stubs —
// only the fields the client reads (key, value) need to be meaningful.
function settingsEntry(key: string, kind: string, value: unknown) {
  return { key, kind, default: "", description: "", category: "", ui: true, live: true, value };
}

describe("settings client (registry-driven GET/POST /api/settings)", () => {
  it("getHealth surfaces the optional instanceName field when present", async () => {
    mswServer.use(
      http.get("/api/health", () =>
        HttpResponse.json({ status: "ok", hostname: "test-host", instanceName: "my-box" }),
      ),
    );
    const health = await getHealth();
    expect(health.instanceName).toBe("my-box");
    expect(health.hostname).toBe("test-host");
  });

  it("getSSHHost resolves the stored setting from the ssh_host entry", async () => {
    mswServer.use(
      http.get("/api/settings", () =>
        HttpResponse.json({ settings: [settingsEntry("ssh_host", "string", "devbox")] }),
      ),
    );
    await expect(getSSHHost()).resolves.toBe("devbox");
  });

  it("getSSHHost resolves null when unset", async () => {
    mswServer.use(
      http.get("/api/settings", () =>
        HttpResponse.json({ settings: [settingsEntry("ssh_host", "string", null)] }),
      ),
    );
    await expect(getSSHHost()).resolves.toBeNull();
  });

  it("setSSHHost POSTs the key as a patch; null clears; 400 rejects with message", async () => {
    const bodies: unknown[] = [];
    mswServer.use(
      http.post("/api/settings", async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ status: "ok" });
      }),
    );
    await setSSHHost("devbox");
    await setSSHHost(null);
    expect(bodies).toEqual([{ ssh_host: "devbox" }, { ssh_host: null }]);

    mswServer.use(
      http.post("/api/settings", () =>
        HttpResponse.json({ error: "SSH host cannot contain whitespace or control characters" }, { status: 400 }),
      ),
    );
    await expect(setSSHHost("dev box")).rejects.toThrow(
      "SSH host cannot contain whitespace or control characters",
    );
  });

  it("getInstanceName resolves the stored setting (null when unset)", async () => {
    mswServer.use(
      http.get("/api/settings", () =>
        HttpResponse.json({ settings: [settingsEntry("instance_name", "string", "my-box")] }),
      ),
    );
    await expect(getInstanceName()).resolves.toBe("my-box");

    mswServer.use(
      http.get("/api/settings", () =>
        HttpResponse.json({ settings: [settingsEntry("instance_name", "string", null)] }),
      ),
    );
    await expect(getInstanceName()).resolves.toBeNull();
  });

  it("setInstanceName POSTs the key as a patch; null clears; 400 rejects with message", async () => {
    const bodies: unknown[] = [];
    mswServer.use(
      http.post("/api/settings", async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ status: "ok" });
      }),
    );
    await setInstanceName("my-box");
    await setInstanceName(null);
    expect(bodies).toEqual([{ instance_name: "my-box" }, { instance_name: null }]);

    mswServer.use(
      http.post("/api/settings", () =>
        HttpResponse.json({ error: "Instance name cannot contain control characters" }, { status: 400 }),
      ),
    );
    await expect(setInstanceName("bad")).rejects.toThrow(
      "Instance name cannot contain control characters",
    );
  });

  it("concurrent getters collapse into one deduplicated GET /api/settings", async () => {
    let getCount = 0;
    mswServer.use(
      http.get("/api/settings", () => {
        getCount++;
        return HttpResponse.json({
          settings: [
            settingsEntry("theme", "enum", "system"),
            settingsEntry("theme_dark", "string", "default-dark"),
            settingsEntry("theme_light", "string", "default-light"),
            settingsEntry("instance_color", "color", "4"),
            settingsEntry("ssh_host", "string", "devbox"),
            settingsEntry("instance_name", "string", "my-box"),
            settingsEntry("server_colors", "map", { dev: "7" }),
            settingsEntry("server_flairs", "map", { dev: "nyan" }),
          ],
        });
      }),
    );
    const [theme, sshHost, name, color, colors, flairs, serverColor] = await Promise.all([
      getThemePreference(),
      getSSHHost(),
      getInstanceName(),
      getInstanceColor(),
      getAllServerColors(),
      getAllServerFlairs(),
      getServerColor("dev"),
    ]);
    expect(getCount).toBe(1);
    expect(theme).toEqual({ theme: "system", themeDark: "default-dark", themeLight: "default-light" });
    expect(sshHost).toBe("devbox");
    expect(name).toBe("my-box");
    expect(color).toBe("4");
    expect(colors).toEqual({ dev: "7" });
    expect(flairs).toEqual({ dev: "nyan" });
    expect(serverColor).toBe("7");
  });

  it("getServerColor resolves null for a server with no entry", async () => {
    mswServer.use(
      http.get("/api/settings", () =>
        HttpResponse.json({ settings: [settingsEntry("server_colors", "map", { dev: "7" })] }),
      ),
    );
    await expect(getServerColor("prod")).resolves.toBeNull();
  });

  it("getSettingsEntries returns the raw registry rows, enum options included", async () => {
    mswServer.use(
      http.get("/api/settings", () =>
        HttpResponse.json({
          settings: [
            {
              key: "log_level",
              kind: "enum",
              default: "info",
              description: "Daemon log verbosity",
              category: "advanced",
              ui: true,
              live: false,
              options: ["info", "debug"],
              value: "debug",
            },
            settingsEntry("ssh_host", "string", null),
          ],
        }),
      ),
    );
    const entries = await getSettingsEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      key: "log_level",
      kind: "enum",
      live: false,
      options: ["info", "debug"],
      value: "debug",
    });
    // Non-enum rows carry no options key at all (omitempty on the wire).
    expect(entries[1]).not.toHaveProperty("options");
  });

  it("postSettings POSTs a partial-merge patch; a 400 rejects with the server message", async () => {
    const bodies: unknown[] = [];
    mswServer.use(
      http.post("/api/settings", async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ status: "ok" });
      }),
    );
    await postSettings({ auto_name: true, ssh_host: null });
    expect(bodies).toEqual([{ auto_name: true, ssh_host: null }]);

    mswServer.use(
      http.post("/api/settings", () =>
        HttpResponse.json({ error: "unknown settings key: nope" }, { status: 400 }),
      ),
    );
    await expect(postSettings({ nope: 1 })).rejects.toThrow("unknown settings key: nope");
  });
});

describe("fetchWindowHistory (260819-shqo terminal export)", () => {
  it("GETs /api/windows/{id}/history with the server query and returns the text body", async () => {
    let capturedUrl = "";
    mswServer.use(
      http.get("/api/windows/:windowId/history", ({ request }) => {
        capturedUrl = request.url;
        return new HttpResponse("line one\nline two\n", {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }),
    );
    const body = await fetchWindowHistory("rk", "@5");
    expect(capturedUrl).toContain("/api/windows/%405/history");
    expect(capturedUrl).toContain("server=rk");
    expect(body).toBe("line one\nline two\n");
  });

  it("throws the server's error message on failure", async () => {
    mswServer.use(
      http.get("/api/windows/:windowId/history", () =>
        HttpResponse.json({ error: "no server running" }, { status: 500 }),
      ),
    );
    await expect(fetchWindowHistory("rk", "@5")).rejects.toThrow("no server running");
  });
});
