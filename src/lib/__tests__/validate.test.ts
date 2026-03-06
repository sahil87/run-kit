import { describe, it, expect, vi } from "vitest";
import { validateName, validatePath, expandTilde, sanitizeFilename } from "@/lib/validate";

describe("validateName", () => {
  it("returns null for a valid name", () => {
    expect(validateName("my-session", "Session name")).toBeNull();
  });

  it("returns null for alphanumeric names with hyphens and underscores", () => {
    expect(validateName("test_session-123", "Name")).toBeNull();
  });

  it("rejects empty string", () => {
    expect(validateName("", "Session name")).toContain("cannot be empty");
  });

  it("rejects whitespace-only string", () => {
    expect(validateName("   ", "Session name")).toContain("cannot be empty");
  });

  it("rejects names with forbidden characters", () => {
    const forbidden = [";", "&", "|", "`", "$", "(", ")", "{", "}", "<", ">", "!", "#", "*", "?"];
    for (const char of forbidden) {
      expect(validateName(`my${char}session`, "Name")).toContain("forbidden characters");
    }
  });

  it("rejects names exceeding max length", () => {
    const longName = "a".repeat(129);
    expect(validateName(longName, "Name")).toContain("maximum length");
  });

  it("accepts names at exactly max length", () => {
    const maxName = "a".repeat(128);
    expect(validateName(maxName, "Name")).toBeNull();
  });

  it("rejects names containing colons", () => {
    expect(validateName("my:session", "Name")).toContain("colons or periods");
  });

  it("rejects names containing periods", () => {
    expect(validateName("my.session", "Name")).toContain("colons or periods");
  });

  it("includes the label in error messages", () => {
    expect(validateName("", "Window name")).toContain("Window name");
  });
});

describe("validatePath", () => {
  it("returns null for a valid path", () => {
    expect(validatePath("/home/user/project", "Path")).toBeNull();
  });

  it("rejects empty string", () => {
    expect(validatePath("", "Path")).toContain("cannot be empty");
  });

  it("rejects paths with null bytes", () => {
    expect(validatePath("/home/\0evil", "Path")).toContain("invalid characters");
  });

  it("rejects paths with newlines", () => {
    expect(validatePath("/home/\nevil", "Path")).toContain("invalid characters");
  });

  it("rejects paths exceeding max length", () => {
    const longPath = "/" + "a".repeat(1024);
    expect(validatePath(longPath, "Path")).toContain("maximum length");
  });
});

describe("expandTilde", () => {
  // Use the actual homedir for assertions since expandTilde calls os.homedir() internally
  const home = require("node:os").homedir();

  it("expands ~ alone to home directory", () => {
    const result = expandTilde("~");
    expect(result.path).toBe(home);
    expect(result.error).toBeNull();
  });

  it("expands ~/path to home + path", () => {
    const result = expandTilde("~/code/project");
    expect(result.path).toBe(`${home}/code/project`);
    expect(result.error).toBeNull();
  });

  it("resolves bare relative paths under home", () => {
    const result = expandTilde("code/project");
    expect(result.path).toBe(`${home}/code/project`);
    expect(result.error).toBeNull();
  });

  it("accepts absolute paths under home", () => {
    const result = expandTilde(`${home}/code/project`);
    expect(result.path).toBe(`${home}/code/project`);
    expect(result.error).toBeNull();
  });

  it("rejects .. traversal that escapes home", () => {
    const result = expandTilde("~/../../etc");
    expect(result.path).toBeNull();
    expect(result.error).toContain("under home directory");
  });

  it("rejects absolute path outside home", () => {
    const result = expandTilde("/etc/passwd");
    expect(result.path).toBeNull();
    expect(result.error).toContain("under home directory");
  });

  it("rejects ~username syntax", () => {
    const result = expandTilde("~root");
    expect(result.path).toBeNull();
    expect(result.error).toContain("~user expansion is not supported");
  });

  it("rejects ~otheruser/path syntax", () => {
    const result = expandTilde("~otheruser/secret");
    expect(result.path).toBeNull();
    expect(result.error).toContain("~user expansion is not supported");
  });

  it("allows home directory itself", () => {
    const result = expandTilde(home);
    expect(result.path).toBe(home);
    expect(result.error).toBeNull();
  });

  it("collapses .. segments within home", () => {
    const result = expandTilde("~/code/../code/project");
    expect(result.path).toBe(`${home}/code/project`);
    expect(result.error).toBeNull();
  });
});

describe("sanitizeFilename", () => {
  it("returns simple filenames unchanged", () => {
    expect(sanitizeFilename("screenshot.png")).toBe("screenshot.png");
  });

  it("replaces forward slashes with dashes", () => {
    expect(sanitizeFilename("path/to/file.txt")).toBe("path-to-file.txt");
  });

  it("replaces backslashes with dashes", () => {
    expect(sanitizeFilename("path\\to\\file.txt")).toBe("path-to-file.txt");
  });

  it("strips null bytes", () => {
    expect(sanitizeFilename("file\0name.txt")).toBe("filename.txt");
  });

  it("strips leading dots", () => {
    expect(sanitizeFilename(".hidden")).toBe("hidden");
    expect(sanitizeFilename("...triple")).toBe("triple");
  });

  it("sanitizes path traversal attempt", () => {
    expect(sanitizeFilename("../../../etc/passwd")).toBe("etc-passwd");
  });

  it("sanitizes backslash traversal attempt", () => {
    expect(sanitizeFilename("..\\..\\..\\etc\\passwd")).toBe("etc-passwd");
  });

  it("collapses multiple dashes", () => {
    expect(sanitizeFilename("a---b")).toBe("a-b");
  });

  it("strips leading and trailing dashes", () => {
    expect(sanitizeFilename("-file-")).toBe("file");
  });

  it("returns 'upload' for empty string", () => {
    expect(sanitizeFilename("")).toBe("upload");
  });

  it("returns 'upload' for dots-only input", () => {
    expect(sanitizeFilename("...")).toBe("upload");
  });

  it("returns 'upload' for slashes-only input", () => {
    expect(sanitizeFilename("///")).toBe("upload");
  });

  it("preserves file extensions", () => {
    expect(sanitizeFilename("my-document.pdf")).toBe("my-document.pdf");
  });

  it("handles spaces in filenames", () => {
    expect(sanitizeFilename("my file name.png")).toBe("my file name.png");
  });
});
