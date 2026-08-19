import { describe, it, expect } from "vitest";
import {
  applyHighlights,
  clearHighlights,
  collectMatches,
  findWithWindow,
  stepMatch,
} from "./find-in-page";

function docWith(html: string): Document {
  const doc = document.implementation.createHTMLDocument("find-test");
  doc.body.innerHTML = html;
  return doc;
}

/** The text each range covers — the walker's observable result. */
function texts(matches: Range[]): string[] {
  return matches.map((r) => r.toString());
}

describe("collectMatches — the TreeWalker match collection (260819-ie2i R6)", () => {
  it("finds every case-insensitive occurrence across text nodes, in document order", () => {
    const doc = docWith("<p>Version one</p><p>the VERSION floor</p><div>version</div>");
    const matches = collectMatches(doc, "version");
    expect(texts(matches)).toEqual(["Version", "VERSION", "version"]);
    expect(matches[0].startContainer.textContent).toBe("Version one");
  });

  it("finds multiple occurrences inside ONE text node", () => {
    const doc = docWith("<p>version, version, version</p>");
    const matches = collectMatches(doc, "version");
    expect(matches).toHaveLength(3);
    expect(matches[1].startOffset).toBe(9);
  });

  it("skips non-rendered containers (script/style/noscript/template)", () => {
    const doc = docWith(
      '<p>version</p><script>var version = 1;</script><style>.version{}</style><noscript>version</noscript>',
    );
    expect(texts(collectMatches(doc, "version"))).toEqual(["version"]);
  });

  it("an empty or blank query collects nothing, and a bodyless doc is safe", () => {
    const doc = docWith("<p>version</p>");
    expect(collectMatches(doc, "")).toEqual([]);
    expect(collectMatches(doc, "   ")).toEqual([]);
    const empty = document.implementation.createHTMLDocument("empty");
    empty.body.remove();
    expect(collectMatches(empty, "version")).toEqual([]);
  });
});

describe("stepMatch — the match-state machine (wrap + no-op)", () => {
  it("advances and retreats with wraparound", () => {
    expect(stepMatch(0, 17, 1)).toBe(1);
    expect(stepMatch(2, 17, 1)).toBe(3);
    expect(stepMatch(16, 17, 1)).toBe(0);
    expect(stepMatch(0, 17, -1)).toBe(16);
    expect(stepMatch(3, 17, -1)).toBe(2);
  });

  it("zero matches pin the active index at 0 (navigation is a no-op)", () => {
    expect(stepMatch(0, 0, 1)).toBe(0);
    expect(stepMatch(0, 0, -1)).toBe(0);
  });
});

describe("highlight application — guarded against API-less frames (A-015)", () => {
  it("returns false without the Custom Highlight API (jsdom) and throws nothing", () => {
    const win = document.defaultView!;
    const doc = docWith("<p>version</p>");
    const matches = collectMatches(doc, "version");
    expect(applyHighlights(win, doc, matches, 0)).toBe(false);
    // The failed apply leaves no style element behind.
    expect(doc.getElementById("rk-find-highlight-style")).toBeNull();
  });

  it("registers highlights + one style element when the API exists, and teardown removes both", () => {
    const doc = docWith("<p>version and version</p>");
    const matches = collectMatches(doc, "version");
    const registered = new Map<string, unknown>();
    class FakeHighlight {
      ranges: Range[];
      constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    }
    const fakeWin = {
      CSS: { highlights: registered },
      Highlight: FakeHighlight,
    } as unknown as Window;

    expect(applyHighlights(fakeWin, doc, matches, 1)).toBe(true);
    expect(registered.has("rk-find")).toBe(true);
    expect(registered.has("rk-find-active")).toBe(true);
    // No <script> was added — styling is one inert <style> element (R6).
    expect(doc.getElementsByTagName("script")).toHaveLength(0);
    const style = doc.getElementById("rk-find-highlight-style");
    expect(style?.tagName).toBe("STYLE");
    expect(style?.textContent).toContain("::highlight(rk-find)");

    // A re-apply reuses the same style element (no accumulation).
    applyHighlights(fakeWin, doc, matches, 0);
    expect(doc.querySelectorAll("#rk-find-highlight-style")).toHaveLength(1);

    clearHighlights(fakeWin, doc);
    expect(registered.has("rk-find")).toBe(false);
    expect(registered.has("rk-find-active")).toBe(false);
    expect(doc.getElementById("rk-find-highlight-style")).toBeNull();
  });

  it("clearHighlights on an API-less window is a silent no-op", () => {
    const win = document.defaultView!;
    const doc = docWith("<p>version</p>");
    expect(() => clearHighlights(win, doc)).not.toThrow();
  });

  it("findWithWindow degrades to false where window.find is missing (jsdom)", () => {
    const win = document.defaultView!;
    expect(findWithWindow(win, "version", false)).toBe(false);
  });
});
