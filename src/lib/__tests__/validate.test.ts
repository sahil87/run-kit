import { describe, it, expect } from "vitest";
import { validateName, validatePath } from "@/lib/validate";

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
