import { describe, it, expect } from "vitest";
import { codeRootFor, codeRootSeed } from "./code-folder-latch";
import type { Layout } from "./surface-layout";

const codeOpen: Layout = { shape: "split-h", order: ["tty", "code"] };
const codeClosed: Layout = { shape: "single", order: ["tty"] };

describe("codeRootFor", () => {
  it("prefers the shared codeRoot over the derived gitRoot", () => {
    expect(codeRootFor({ codeRoot: "/latched", gitRoot: "/repo" })).toBe("/latched");
  });

  it("falls back to gitRoot while the option is unset (pre-seed)", () => {
    expect(codeRootFor({ gitRoot: "/repo" })).toBe("/repo");
    expect(codeRootFor({ codeRoot: "", gitRoot: "/repo" })).toBe("/repo");
  });

  it("is empty when neither root exists", () => {
    expect(codeRootFor({})).toBe("");
    expect(codeRootFor({ codeRoot: "", gitRoot: "" })).toBe("");
    expect(codeRootFor(null)).toBe("");
    expect(codeRootFor(undefined)).toBe("");
  });
});

describe("codeRootSeed", () => {
  it("seeds gitRoot when the code tile is open, the option is empty, and gitRoot is non-empty", () => {
    expect(codeRootSeed({ gitRoot: "/repo" }, codeOpen)).toBe("/repo");
  });

  it("is null when the code tile is not open", () => {
    expect(codeRootSeed({ gitRoot: "/repo" }, codeClosed)).toBeNull();
  });

  it("is null when codeRoot is already set — the editor's navigation owns the root", () => {
    expect(codeRootSeed({ codeRoot: "/latched", gitRoot: "/repo" }, codeOpen)).toBeNull();
  });

  it("is null when gitRoot is empty — an empty derivation seeds nothing", () => {
    expect(codeRootSeed({}, codeOpen)).toBeNull();
    expect(codeRootSeed({ gitRoot: "" }, codeOpen)).toBeNull();
    expect(codeRootSeed(null, codeOpen)).toBeNull();
  });
});
