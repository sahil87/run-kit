import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/tmux", () => ({
  createSession: vi.fn(),
  createWindow: vi.fn(),
  killSession: vi.fn(),
  killWindow: vi.fn(),
  sendKeys: vi.fn(),
}));

// Mock fetchSessions (used by GET, not under test but needed for import)
vi.mock("@/lib/sessions", () => ({
  fetchSessions: vi.fn(),
}));

import { POST } from "@/app/api/sessions/route";
import {
  createSession,
  createWindow,
  killSession,
  killWindow,
  sendKeys,
} from "@/lib/tmux";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function postJson(body: unknown) {
  const response = await POST(makeRequest(body));
  const data = await response.json();
  return { status: response.status, data };
}

describe("POST /api/sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createSession", () => {
    it("succeeds with valid name", async () => {
      const { status, data } = await postJson({
        action: "createSession",
        name: "my-session",
      });
      expect(status).toBe(200);
      expect(data).toEqual({ ok: true });
      expect(createSession).toHaveBeenCalledWith("my-session");
    });

    it("rejects empty name with 400", async () => {
      const { status, data } = await postJson({
        action: "createSession",
        name: "",
      });
      expect(status).toBe(400);
      expect(data.error).toContain("cannot be empty");
    });

    it("rejects forbidden characters with 400", async () => {
      const { status, data } = await postJson({
        action: "createSession",
        name: "bad;name",
      });
      expect(status).toBe(400);
      expect(data.error).toContain("forbidden characters");
    });
  });

  describe("createWindow", () => {
    it("succeeds with valid params", async () => {
      const { status, data } = await postJson({
        action: "createWindow",
        session: "s",
        name: "w",
        cwd: "/tmp",
      });
      expect(status).toBe(200);
      expect(data).toEqual({ ok: true });
      expect(createWindow).toHaveBeenCalledWith("s", "w", "/tmp");
    });

    it("rejects empty fields with 400", async () => {
      const { status, data } = await postJson({
        action: "createWindow",
        session: "",
        name: "",
        cwd: "",
      });
      expect(status).toBe(400);
      expect(data.error).toContain("cannot be empty");
    });
  });

  describe("killSession", () => {
    it("succeeds with valid session name", async () => {
      const { status, data } = await postJson({
        action: "killSession",
        session: "my-session",
      });
      expect(status).toBe(200);
      expect(data).toEqual({ ok: true });
      expect(killSession).toHaveBeenCalledWith("my-session");
    });
  });

  describe("killWindow", () => {
    it("succeeds with valid session and index", async () => {
      const { status, data } = await postJson({
        action: "killWindow",
        session: "s",
        index: 2,
      });
      expect(status).toBe(200);
      expect(data).toEqual({ ok: true });
      expect(killWindow).toHaveBeenCalledWith("s", 2);
    });

    it("rejects non-integer index with 400", async () => {
      const { status, data } = await postJson({
        action: "killWindow",
        session: "s",
        index: 1.5,
      });
      expect(status).toBe(400);
      expect(data.error).toContain("Invalid window index");
    });

    it("rejects negative index with 400", async () => {
      const { status, data } = await postJson({
        action: "killWindow",
        session: "s",
        index: -1,
      });
      expect(status).toBe(400);
      expect(data.error).toContain("Invalid window index");
    });
  });

  describe("sendKeys", () => {
    it("succeeds with valid params", async () => {
      const { status, data } = await postJson({
        action: "sendKeys",
        session: "s",
        window: 0,
        keys: "ls",
      });
      expect(status).toBe(200);
      expect(data).toEqual({ ok: true });
      expect(sendKeys).toHaveBeenCalledWith("s", 0, "ls");
    });

    it("rejects empty keys with 400", async () => {
      const { status, data } = await postJson({
        action: "sendKeys",
        session: "s",
        window: 0,
        keys: "",
      });
      expect(status).toBe(400);
      expect(data.error).toContain("cannot be empty");
    });
  });

  describe("error handling", () => {
    it("returns 400 for unknown action", async () => {
      const { status, data } = await postJson({
        action: "unknownAction",
      });
      expect(status).toBe(400);
      expect(data.error).toContain("Unknown action");
    });

    it("returns 400 for missing action field", async () => {
      const { status, data } = await postJson({
        noAction: true,
      });
      expect(status).toBe(400);
      expect(data.error).toContain("Missing or invalid action");
    });

    it("returns 500 when tmux function throws", async () => {
      vi.mocked(createSession).mockRejectedValueOnce(
        new Error("tmux server not running"),
      );
      const { status, data } = await postJson({
        action: "createSession",
        name: "valid",
      });
      expect(status).toBe(500);
      expect(data.error).toBe("tmux server not running");
    });
  });
});
