import { beforeEach, describe, expect, it } from "vitest";
import {
  ROW_AT_ATTR,
  ROW_LINE_ATTR,
  ROW_SIDE_ATTR,
  decorateMatches,
  gutterNumbers,
  mergeContextRows,
  restoreSelection,
  rowAddress,
  rowAttributes,
  rowClass,
  rowMatchesThread,
  rowSign,
  rowText,
  saveSelection,
  undecorate,
} from "./review-rows";
import type { ReviewRow } from "./review";

const addRow: ReviewRow = {
  kind: "add",
  side: "R",
  l: 12,
  right: 12,
  at: 12,
  spans: [
    { c: "k", t: "return" },
    { t: " nil" },
  ],
};
const delRow: ReviewRow = { kind: "del", side: "L", l: 11, left: 11, at: 12, spans: [{ t: "old" }] };
const ctxRow: ReviewRow = { kind: "ctx", side: "R", l: 13, left: 12, right: 13, spans: [{ t: "}" }] };
const hunkRow: ReviewRow = { kind: "hunk", header: "@@ -10,3 +10,4 @@" };

describe("row attributes — the anchoring contract", () => {
  it("an added row carries its post-image side and line", () => {
    expect(rowAttributes(addRow)).toEqual({ [ROW_SIDE_ATTR]: "R", [ROW_LINE_ATTR]: 12 });
  });

  it("a deleted row also carries the post-image line it sat before", () => {
    expect(rowAttributes(delRow)).toEqual({
      [ROW_SIDE_ATTR]: "L",
      [ROW_LINE_ATTR]: 11,
      [ROW_AT_ATTR]: 12,
    });
  });

  it("a hunk header carries none — it is not addressable", () => {
    expect(rowAttributes(hunkRow)).toEqual({});
    expect(rowAddress(hunkRow)).toBeUndefined();
  });
});

describe("shape-agnostic row pieces", () => {
  it("renders both gutter numbers, blank where the row is absent from that side", () => {
    expect(gutterNumbers(addRow)).toEqual({ left: "", right: "12" });
    expect(gutterNumbers(delRow)).toEqual({ left: "11", right: "" });
    expect(gutterNumbers(ctxRow)).toEqual({ left: "12", right: "13" });
  });

  it("renders the unified sign and the wash class per kind", () => {
    expect(rowSign(addRow)).toBe("+");
    expect(rowSign(delRow)).toBe("-");
    expect(rowSign(ctxRow)).toBe(" ");
    expect(rowClass(addRow)).toContain("rk-review-row-add");
    expect(rowClass(delRow)).toContain("rk-review-row-del");
    expect(rowClass(hunkRow)).toContain("rk-review-row-hunk");
  });

  it("reassembles a row's text from its spans", () => {
    expect(rowText(addRow)).toBe("return nil");
    expect(rowText(hunkRow)).toBe("@@ -10,3 +10,4 @@");
  });
});

describe("rowMatchesThread", () => {
  it("matches on GitHub's (side, line) pair", () => {
    expect(rowMatchesThread(addRow, { line: 12, side: "RIGHT" })).toBe(true);
    expect(rowMatchesThread(addRow, { line: 12, side: "LEFT" })).toBe(false);
    expect(rowMatchesThread(delRow, { line: 11, side: "LEFT" })).toBe(true);
    expect(rowMatchesThread(hunkRow, { line: 12, side: "RIGHT" })).toBe(false);
  });
});

describe("mergeContextRows — expansion splices, never replaces", () => {
  const ctx = (line: number): ReviewRow => ({
    kind: "ctx",
    side: "R",
    l: line,
    left: line,
    right: line,
    spans: [{ t: `line ${line}` }],
  });
  // One file's diff: a hunk header, a deletion, an addition and a context row,
  // covering post-image lines 12 and 13.
  const diff: ReviewRow[] = [hunkRow, delRow, addRow, ctxRow];

  it("puts leading context before the hunk it precedes and keeps every diff row", () => {
    // 9..10 still leaves line 11 missing, so the header has something to say.
    const merged = mergeContextRows(diff, [ctx(9), ctx(10)]);
    expect(merged.map((row) => row.kind)).toEqual(["ctx", "ctx", "hunk", "del", "add", "ctx"]);
    expect(merged.slice(0, 2).map((row) => row.right)).toEqual([9, 10]);
  });

  it("drops the hunk header once the expansion closes its gap", () => {
    // 11 is the line immediately before the hunk's first post-image line (12),
    // so the header has nothing left to say.
    const merged = mergeContextRows(diff, [ctx(10), ctx(11)]);
    expect(merged.map((row) => row.kind)).toEqual(["ctx", "ctx", "del", "add", "ctx"]);
  });

  it("never renders a line twice, so `all lines` overlapping a hunk is safe", () => {
    const merged = mergeContextRows(diff, [ctx(11), ctx(12), ctx(13), ctx(14)]);
    const post = merged.filter((row) => row.kind !== "del").map((row) => row.right);
    expect(post).toEqual([11, 12, 13, 14]);
    // The addition and the deletion are still there, un-replaced by context.
    expect(merged.filter((row) => row.kind === "add")).toHaveLength(1);
    expect(merged.filter((row) => row.kind === "del")).toHaveLength(1);
  });

  it("an empty or fully-overlapping response leaves the rows identical", () => {
    expect(mergeContextRows(diff, [])).toBe(diff);
    expect(mergeContextRows(diff, [ctx(12), ctx(13)])).toBe(diff);
  });
});

/** Build a container of rows shaped exactly like the renderer's output: each
 *  row carries the addressing attributes and holds token `<span>`s. Rows
 *  default to the post-image side. */
function mountRows(
  container: HTMLElement,
  lines: [number, string][],
  side: "L" | "R" = "R",
): void {
  container.innerHTML = "";
  for (const [line, text] of lines) {
    const row = document.createElement("div");
    row.setAttribute(ROW_SIDE_ATTR, side);
    row.setAttribute(ROW_LINE_ATTR, String(line));
    const keyword = document.createElement("span");
    keyword.className = "k";
    keyword.textContent = text.slice(0, 6);
    const rest = document.createElement("span");
    rest.textContent = text.slice(6);
    row.append(keyword, rest);
    container.appendChild(row);
  }
}

describe("decoration preserves token markup", () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mountRows(container, [[12, "return nilValue"]]);
  });

  it("wraps matches in text nodes, leaving the token spans intact", () => {
    const before = container.querySelectorAll("span.k").length;
    const wrapped = decorateMatches(container, "nil", "rk-review-mark");
    expect(wrapped).toBe(1);
    expect(container.querySelectorAll("mark.rk-review-mark")).toHaveLength(1);
    // The token span survived — a decorator that rewrote innerHTML would have
    // destroyed the colours the backend just computed.
    expect(container.querySelectorAll("span.k")).toHaveLength(before);
    expect(container.textContent).toBe("return nilValue");
  });

  it("wraps every occurrence and unwraps cleanly", () => {
    mountRows(container, [[12, "returnaXbXc"]]);
    expect(decorateMatches(container, "X", "rk-review-mark")).toBe(2);
    undecorate(container, "rk-review-mark");
    expect(container.querySelectorAll("mark.rk-review-mark")).toHaveLength(0);
    expect(container.textContent).toBe("returnaXbXc");
    expect(container.querySelectorAll("span.k")).toHaveLength(1);
  });

  it("an empty needle decorates nothing", () => {
    expect(decorateMatches(container, "", "rk-review-mark")).toBe(0);
  });
});

describe("selection survives a repaint", () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mountRows(container, [
      [12, "return nilValue"],
      [13, "expect ok"],
    ]);
  });

  function select(
    fromLine: number,
    fromCol: number,
    toLine: number,
    toCol: number,
    side: "L" | "R" = "R",
  ): void {
    const range = document.createRange();
    const resolve = (line: number, col: number) => {
      const row = container.querySelector(
        `[${ROW_SIDE_ATTR}="${side}"][${ROW_LINE_ATTR}="${line}"]`,
      )!;
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      let consumed = 0;
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const length = node.textContent?.length ?? 0;
        if (consumed + length >= col) return { node, offset: col - consumed };
        consumed += length;
      }
      throw new Error("column out of range");
    };
    const start = resolve(fromLine, fromCol);
    const end = resolve(toLine, toCol);
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  it("saves file coordinates and restores them after the rows are replaced", () => {
    select(12, 7, 12, 10);
    const saved = saveSelection(container);
    expect(saved).toEqual({
      anchor: { side: "R", line: 12, col: 7 },
      focus: { side: "R", line: 12, col: 10 },
    });

    // The refine swap: every node the selection referenced is gone.
    mountRows(container, [
      [12, "return nilValue"],
      [13, "expect ok"],
    ]);
    expect(restoreSelection(container, saved)).toBe(true);
    expect(window.getSelection()!.toString()).toBe("nil");
  });

  it("saves nothing for a collapsed selection or one outside the rows", () => {
    window.getSelection()!.removeAllRanges();
    expect(saveSelection(container)).toBeNull();
    expect(restoreSelection(container, null)).toBe(false);
  });

  it("does not restore onto a row that is no longer rendered", () => {
    select(13, 0, 13, 6);
    const saved = saveSelection(container);
    mountRows(container, [[12, "return nilValue"]]);
    expect(restoreSelection(container, saved)).toBe(false);
  });

  it("restores onto the saved SIDE when both sides carry the same line", () => {
    // A unified hunk routinely holds an `L` deletion and an `R` addition at the
    // same line number; a line-only coordinate would take whichever came first.
    container.innerHTML = "";
    const left = document.createElement("div");
    document.body.appendChild(container);
    container.appendChild(left);
    mountRows(left, [[12, "return oldOne"]], "L");
    const right = document.createElement("div");
    container.appendChild(right);
    mountRows(right, [[12, "return newTwo"]], "R");

    const row = container.querySelector(`[${ROW_SIDE_ATTR}="R"][${ROW_LINE_ATTR}="12"]`)!;
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    walker.nextNode();
    const tail = walker.nextNode()!;
    const range = document.createRange();
    range.setStart(tail, 1);
    range.setEnd(tail, 7);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const saved = saveSelection(container);
    expect(saved?.anchor.side).toBe("R");
    expect(restoreSelection(container, saved)).toBe(true);
    expect(window.getSelection()!.toString()).toBe("newTwo");
  });
});
