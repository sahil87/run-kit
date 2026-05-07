import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server as mswServer } from "../../tests/msw/server";
import {
  listBoards,
  getBoard,
  pinWindow,
  unpinWindow,
  reorderPin,
} from "./boards";

beforeAll(() => mswServer.listen({ onUnhandledRequest: "error" }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe("boards API client", () => {
  it("listBoards GETs /api/boards and parses summaries", async () => {
    mswServer.use(
      http.get("/api/boards", () =>
        HttpResponse.json([
          { name: "deploy", pinCount: 1 },
          { name: "main", pinCount: 3 },
        ]),
      ),
    );
    const boards = await listBoards();
    expect(boards).toHaveLength(2);
    expect(boards[0].name).toBe("deploy");
    expect(boards[1].pinCount).toBe(3);
  });

  it("getBoard GETs /api/boards/{name} and parses entries", async () => {
    let capturedPath = "";
    mswServer.use(
      http.get("/api/boards/main", ({ request }) => {
        capturedPath = new URL(request.url).pathname;
        return HttpResponse.json([
          {
            server: "default",
            windowId: "@1234",
            session: "dev",
            windowIndex: 2,
            windowName: "agent",
            orderKey: "a",
          },
        ]);
      }),
    );
    const entries = await getBoard("main");
    expect(capturedPath).toBe("/api/boards/main");
    expect(entries).toHaveLength(1);
    expect(entries[0].windowId).toBe("@1234");
  });

  it("getBoard URL-encodes the name", async () => {
    let capturedPath = "";
    mswServer.use(
      http.get("/api/boards/:name", ({ request }) => {
        capturedPath = new URL(request.url).pathname;
        return HttpResponse.json([]);
      }),
    );
    await getBoard("foo bar");
    expect(capturedPath).toBe("/api/boards/foo%20bar");
  });

  it("pinWindow sends server in body, not query", async () => {
    let capturedBody: unknown = null;
    let capturedUrl = "";
    mswServer.use(
      http.post("/api/boards/main/pin", async ({ request }) => {
        capturedBody = await request.json();
        capturedUrl = request.url;
        return HttpResponse.json({ ok: true }, { status: 201 });
      }),
    );
    const result = await pinWindow("default", "@1234", "main");
    expect(result.ok).toBe(true);
    expect(capturedUrl).not.toContain("?server=");
    expect(capturedBody).toEqual({ server: "default", windowId: "@1234" });
  });

  it("unpinWindow POSTs to /api/boards/{name}/unpin", async () => {
    let captured: unknown = null;
    mswServer.use(
      http.post("/api/boards/main/unpin", async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    await unpinWindow("default", "@1234", "main");
    expect(captured).toEqual({ server: "default", windowId: "@1234" });
  });

  it("reorderPin sends before/after as empty string for null", async () => {
    let captured: unknown = null;
    mswServer.use(
      http.post("/api/boards/main/reorder", async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json({ ok: true, newOrderKey: "bm" });
      }),
    );
    const r = await reorderPin("default", "@1234", "main", null, "@5678");
    expect(r.newOrderKey).toBe("bm");
    expect(captured).toEqual({ server: "default", windowId: "@1234", before: "", after: "@5678" });
  });

  it("pinWindow throws on 4xx with backend error message", async () => {
    mswServer.use(
      http.post("/api/boards/main/pin", () =>
        HttpResponse.json({ error: "invalid window id" }, { status: 400 }),
      ),
    );
    await expect(pinWindow("default", "not-a-window", "main")).rejects.toThrow(
      /invalid window id/,
    );
  });

  it("pinWindow throws on 404 (window not found)", async () => {
    mswServer.use(
      http.post("/api/boards/main/pin", () =>
        HttpResponse.json({ error: "window not found on server" }, { status: 404 }),
      ),
    );
    await expect(pinWindow("default", "@9999", "main")).rejects.toThrow(/window not found/);
  });

  it("getBoard throws on 400 invalid name", async () => {
    mswServer.use(
      http.get("/api/boards/:name", () =>
        HttpResponse.json({ error: "invalid board name" }, { status: 400 }),
      ),
    );
    await expect(getBoard("foo,bar")).rejects.toThrow(/invalid board name/);
  });
});
