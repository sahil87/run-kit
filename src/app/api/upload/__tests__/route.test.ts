import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockMkdir, mockWriteFile, mockReadFile } = vi.hoisted(() => ({
  mockMkdir: vi.fn(),
  mockWriteFile: vi.fn(),
  mockReadFile: vi.fn(),
}));

vi.mock("@/lib/tmux", () => ({
  listWindows: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: { ...actual, mkdir: mockMkdir, writeFile: mockWriteFile, readFile: mockReadFile },
    mkdir: mockMkdir,
    writeFile: mockWriteFile,
    readFile: mockReadFile,
  };
});

import { POST } from "@/app/api/upload/route";
import { listWindows } from "@/lib/tmux";
import { UPLOAD_MAX_BYTES } from "@/lib/types";

function makeFile(name: string, size: number = 100): File {
  const buffer = new Uint8Array(size);
  return new File([buffer], name, { type: "application/octet-stream" });
}

function makeRequest(fields: Record<string, string | File>): Request {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    fd.append(key, value);
  }
  return { formData: () => Promise.resolve(fd) } as unknown as Request;
}

async function postUpload(fields: Record<string, string | File>) {
  const response = await POST(makeRequest(fields));
  const data = await response.json();
  return { status: response.status, data };
}

/** Find a writeFile call targeting .gitignore (not the uploaded file). */
function gitignoreWriteCall() {
  return mockWriteFile.mock.calls.find(
    (call) => typeof call[0] === "string" && call[0].endsWith(".gitignore"),
  );
}

describe("POST /api/upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listWindows).mockResolvedValue([
      { index: 0, name: "main", worktreePath: "/home/user/project", activity: "active" },
    ]);
    mockReadFile.mockResolvedValue("");
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  it("succeeds with valid file and session", async () => {
    const { status, data } = await postUpload({
      session: "my-project",
      file: makeFile("screenshot.png"),
    });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.path).toContain(".uploads/");
    expect(data.path).toContain("screenshot.png");
    expect(mockMkdir).toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalled();
  });

  it("creates .uploads directory with recursive flag", async () => {
    await postUpload({
      session: "my-project",
      file: makeFile("test.txt"),
    });
    expect(mockMkdir).toHaveBeenCalledWith(
      "/home/user/project/.uploads",
      { recursive: true },
    );
  });

  it("writes .uploads/ to .gitignore when missing", async () => {
    mockReadFile.mockResolvedValue("node_modules/\n");
    await postUpload({
      session: "my-project",
      file: makeFile("test.txt"),
    });
    const call = gitignoreWriteCall();
    expect(call).toBeDefined();
    expect(call![1]).toContain(".uploads/");
  });

  it("does not duplicate .uploads/ in .gitignore", async () => {
    mockReadFile.mockResolvedValue("node_modules/\n.uploads/\n");
    await postUpload({
      session: "my-project",
      file: makeFile("test.txt"),
    });
    expect(gitignoreWriteCall()).toBeUndefined();
  });

  it("creates .gitignore when it does not exist", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    await postUpload({
      session: "my-project",
      file: makeFile("test.txt"),
    });
    const call = gitignoreWriteCall();
    expect(call).toBeDefined();
    expect(call![1]).toContain(".uploads/");
  });

  it("rejects missing session field with 400", async () => {
    const { status, data } = await postUpload({
      file: makeFile("test.txt"),
    });
    expect(status).toBe(400);
    expect(data.error).toContain("Missing session");
  });

  it("rejects missing file field with 400", async () => {
    const { status, data } = await postUpload({
      session: "my-project",
    });
    expect(status).toBe(400);
    expect(data.error).toContain("Missing file");
  });

  it("rejects invalid session name with 400", async () => {
    const { status, data } = await postUpload({
      session: "bad;session",
      file: makeFile("test.txt"),
    });
    expect(status).toBe(400);
    expect(data.error).toContain("forbidden characters");
  });

  it("rejects file exceeding 50MB limit", async () => {
    const { status, data } = await postUpload({
      session: "my-project",
      file: makeFile("huge.bin", UPLOAD_MAX_BYTES + 1),
    });
    expect(status).toBe(400);
    expect(data.error).toContain("50MB limit");
  });

  it("rejects invalid window index with 400", async () => {
    const { status, data } = await postUpload({
      session: "my-project",
      window: "abc",
      file: makeFile("test.txt"),
    });
    expect(status).toBe(400);
    expect(data.error).toContain("Invalid window index");
  });

  it("rejects when session has no windows", async () => {
    vi.mocked(listWindows).mockResolvedValue([]);
    const { status, data } = await postUpload({
      session: "empty-session",
      file: makeFile("test.txt"),
    });
    expect(status).toBe(400);
    expect(data.error).toContain("Session not found");
  });

  it("sanitizes filenames with path traversal", async () => {
    await postUpload({
      session: "my-project",
      file: makeFile("../../../etc/passwd"),
    });
    const fileWriteCall = mockWriteFile.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes(".uploads/"),
    );
    expect(fileWriteCall).toBeDefined();
    expect(fileWriteCall![0]).toContain("etc-passwd");
    expect(fileWriteCall![0]).not.toContain("..");
  });

  it("handles empty filename gracefully", async () => {
    await postUpload({
      session: "my-project",
      file: makeFile(""),
    });
    const fileWriteCall = mockWriteFile.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes(".uploads/"),
    );
    expect(fileWriteCall).toBeDefined();
    expect(fileWriteCall![0]).toContain("upload");
  });

  it("uses specified window index for project root", async () => {
    vi.mocked(listWindows).mockResolvedValue([
      { index: 0, name: "main", worktreePath: "/home/user/project", activity: "active" },
      { index: 1, name: "worktree", worktreePath: "/home/user/project-wt", activity: "idle" },
    ]);
    await postUpload({
      session: "my-project",
      window: "1",
      file: makeFile("test.txt"),
    });
    expect(mockMkdir).toHaveBeenCalledWith(
      "/home/user/project-wt/.uploads",
      { recursive: true },
    );
  });

  it("returns 500 when tmux throws", async () => {
    vi.mocked(listWindows).mockRejectedValue(new Error("tmux not running"));
    const { status, data } = await postUpload({
      session: "my-project",
      file: makeFile("test.txt"),
    });
    expect(status).toBe(500);
    expect(data.error).toBe("tmux not running");
  });
});
