import { describe, expect, it } from "vitest";
import { documentTitle, rawDocumentUrl, resolveViewerFormat } from "./format";

describe("resolveViewerFormat", () => {
  it("keys on the URL path extension when no backend verdict is present, case-insensitively", () => {
    expect(resolveViewerFormat("/present/dev/3f9a2c8e1b77/sketch.excalidraw", null)).toBe("excalidraw");
    expect(resolveViewerFormat("/present/dev/3f9a2c8e1b77/sketch.EXCALIDRAW", null)).toBe("excalidraw");
    expect(resolveViewerFormat("/present/dev/3f9a2c8e1b77/notes.md", null)).toBe("markdown");
    expect(resolveViewerFormat("/present/@7/spec.markdown", null)).toBe("markdown");
  });

  it("lets the backend's resolved-format verdict override a disagreeing URL extension (symlink aliases)", () => {
    expect(resolveViewerFormat("/present/dev/3f9a2c8e1b77/alias.txt", "excalidraw")).toBe("excalidraw");
    expect(resolveViewerFormat("/present/dev/3f9a2c8e1b77/alias.excalidraw", "markdown")).toBe("markdown");
    expect(resolveViewerFormat("/present/dev/3f9a2c8e1b77/notes.md", "markdown")).toBe("markdown");
  });

  it("ignores unrecognized verdicts rather than trusting them", () => {
    expect(resolveViewerFormat("/present/dev/3f9a2c8e1b77/sketch.excalidraw", "bogus")).toBe("excalidraw");
  });
});

describe("rawDocumentUrl", () => {
  it("sets raw=1 on a paramless URL", () => {
    expect(rawDocumentUrl("/present/dev/3f9a2c8e1b77/notes.md", "")).toBe(
      "/present/dev/3f9a2c8e1b77/notes.md?raw=1",
    );
  });

  it("preserves every existing param — the legacy arm's server identity and the v cache-buster", () => {
    const url = rawDocumentUrl("/present/@7/notes.md", "?server=dev&v=3");
    expect(url).toContain("server=dev");
    expect(url).toContain("v=3");
    expect(url).toContain("raw=1");
    expect(url.startsWith("/present/@7/notes.md?")).toBe(true);
  });

  it("overrides an existing raw value rather than duplicating the param", () => {
    const url = rawDocumentUrl("/present/dev/3f9a2c8e1b77/notes.md", "?raw=0");
    expect(url).toBe("/present/dev/3f9a2c8e1b77/notes.md?raw=1");
  });
});

describe("documentTitle", () => {
  it("is the document basename, percent-decoded", () => {
    expect(documentTitle("/present/dev/3f9a2c8e1b77/docs/Design%20Notes.md")).toBe(
      "Design Notes.md",
    );
  });

  it("degrades to a generic title for a pathless URL", () => {
    expect(documentTitle("/")).toBe("Viewer");
  });
});
