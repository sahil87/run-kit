import { describe, expect, it } from "vitest";
import { renderViewerError } from "./error";

describe("renderViewerError", () => {
  it("renders an alert with a working link to the raw form — never a blank frame", () => {
    const root = document.createElement("div");
    renderViewerError(root, "/present/dev/abc12345/notes.md?raw=1", new Error("fetch failed: 500"));

    const alert = root.querySelector("[role='alert']");
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("could not be rendered");
    expect(alert?.textContent).toContain("fetch failed: 500");

    const link = alert?.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/present/dev/abc12345/notes.md?raw=1");
  });

  it("omits the detail block for non-Error causes and clears prior content", () => {
    const root = document.createElement("div");
    root.textContent = "stale";
    renderViewerError(root, "/x?raw=1", "mystery");

    expect(root.querySelector("pre")).toBeNull();
    expect(root.textContent).not.toContain("stale");
  });
});
