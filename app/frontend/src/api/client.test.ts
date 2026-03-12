import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { server } from "../../tests/msw/server";
import { resetMockSessions } from "../../tests/msw/handlers";
import {
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
