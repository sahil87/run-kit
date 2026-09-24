/**
 * Row construction and decoration for the `review` surface's unified diff
 * (spec `docs/specs/pr-review.md` § R6/R7).
 *
 * Three things live here and nowhere else:
 *
 * 1. **Shape-agnostic row builders.** The hunk-header, line-number, marker and
 *    code-cell builders take the pieces of a row rather than a whole layout, so
 *    the deferred split view lands as a ROW-SHAPE variation (pair each deletion
 *    run with the addition run that follows it, pad the shorter side, render
 *    each pair as one two-half row) rather than a second renderer.
 * 2. **Non-destructive decoration.** Comment markers, selection highlights and
 *    suggestion ranges are applied with a `TreeWalker` over the mounted rows'
 *    text nodes, splitting and wrapping matches WITHOUT touching token markup.
 *    Rewriting a row's `innerHTML` would destroy the spans the backend just
 *    computed and is not permitted.
 * 3. **Coordinate-based selection restore.** A selection is saved as
 *    `{line, col}` file coordinates and restored by walking text nodes after a
 *    repaint. A background refine swapping lines under an in-progress selection
 *    is the NORMAL case, not an edge one — that selection is usually about to
 *    be quoted into a comment.
 */

import type { ReviewRow, ReviewSide, ReviewSpan } from "./review";

/** The attribute names that carry GitHub's (path, side, line) address. The
 *  path lives on the file container; `data-l` / `data-side` / `data-at` live on
 *  the row. */
export const ROW_LINE_ATTR = "data-l";
export const ROW_SIDE_ATTR = "data-side";
export const ROW_AT_ATTR = "data-at";

/** The addressing attributes for one row, as a props object a renderer spreads
 *  onto its element. A hunk header carries none — it is not addressable. */
export function rowAttributes(row: ReviewRow): Record<string, string | number> {
  if (row.kind === "hunk") return {};
  const attrs: Record<string, string | number> = {};
  if (row.side) attrs[ROW_SIDE_ATTR] = row.side;
  if (row.l) attrs[ROW_LINE_ATTR] = row.l;
  // Only a deleted row needs `at`: every other row IS a post-image line.
  if (row.kind === "del" && row.at) attrs[ROW_AT_ATTR] = row.at;
  return attrs;
}

/** The two gutter numbers a unified row shows (blank where the row is absent
 *  from that side). Shape-agnostic: split view renders the same pair, one per
 *  half. */
export function gutterNumbers(row: ReviewRow): { left: string; right: string } {
  return {
    left: row.left ? String(row.left) : "",
    right: row.right ? String(row.right) : "",
  };
}

/** The leading sign a unified row carries. */
export function rowSign(row: ReviewRow): string {
  if (row.kind === "add") return "+";
  if (row.kind === "del") return "-";
  return " ";
}

/** The row's background/left-bar class. The wash composes UNDER the token
 *  colours by construction — the stylesheet owns both, so the light-theme
 *  string-vs-add collision the highlighting study flagged cannot arise. */
export function rowClass(row: ReviewRow): string {
  switch (row.kind) {
    case "hunk":
      return "rk-review-row rk-review-row-hunk";
    case "add":
      return "rk-review-row rk-review-row-add";
    case "del":
      return "rk-review-row rk-review-row-del";
    default:
      return "rk-review-row";
  }
}

/** The plain text of a row, used for copy, selection coordinates and the
 *  composer's quote. */
export function rowText(row: ReviewRow): string {
  if (row.kind === "hunk") return row.header ?? "";
  return (row.spans ?? []).map((s) => s.t).join("");
}

/** A span's class attribute. Chroma's short names are namespaced by the
 *  container's `rk-tok` class, so `.k` cannot collide with a utility class. */
export function spanClass(span: ReviewSpan): string | undefined {
  return span.c ? span.c : undefined;
}

/** The address a comment composer opens against for a row. Returns undefined
 *  for a hunk header, which is not addressable. */
export function rowAddress(
  row: ReviewRow,
): { side: ReviewSide; line: number } | undefined {
  if (row.kind === "hunk" || !row.l) return undefined;
  // A narrowing guard rather than a cast: `side` arrives off the wire, and a
  // cast would let a malformed payload address a composer at side "X".
  if (row.side !== "L" && row.side !== "R") return undefined;
  return { side: row.side, line: row.l };
}

/** Whether a thread anchors to this row. GitHub addresses by (path, side,
 *  line); the path is the container's, so the row only has to match the pair. */
export function rowMatchesThread(
  row: ReviewRow,
  thread: { line: number; side: string },
): boolean {
  const address = rowAddress(row);
  if (!address) return false;
  const side = thread.side === "LEFT" ? "L" : "R";
  return address.line === thread.line && address.side === side;
}

// ── context expansion: splice, never replace ───────────────────────────────

/**
 * The post-image line a row occupies for ORDERING purposes. A hunk header has
 * none of its own; a deletion is ordered by `at`, the post-image line it sat
 * before, so it stays attached to the line it precedes.
 */
function orderLine(row: ReviewRow): number | undefined {
  if (row.kind === "hunk") return undefined;
  const line = row.kind === "del" ? row.at : row.right;
  return line && line > 0 ? line : undefined;
}

/**
 * The post-image line a row RENDERS, i.e. the line whose content it shows. A
 * deletion renders a PRE-image line, so it claims nothing on the post-image
 * side and expansion may still bring in the line it sat before.
 */
function renderedLine(row: ReviewRow): number | undefined {
  if (row.kind === "hunk" || row.kind === "del") return undefined;
  return row.right && row.right > 0 ? row.right : undefined;
}

/**
 * Splice a context-expansion response INTO a file's diff rows.
 *
 * The expansion endpoint answers with only the lines that were asked for, so
 * treating its response as the file's new body would throw the unified diff
 * away — the hunk headers, the add/del rows and their washes (spec § R6/R7: an
 * expander splices between line N and line N+1; it is not a second view of the
 * file). Lines the diff already renders are dropped from the incoming set, so
 * `↕ All N lines` overlapping every hunk it spans cannot double a line.
 *
 * A hunk header whose gap the expansion just closed is removed: it exists to
 * say "lines are missing here", and once they are not, it is noise.
 */
export function mergeContextRows(rows: ReviewRow[], incoming: ReviewRow[]): ReviewRow[] {
  const shown = new Set<number>();
  for (const row of rows) {
    const line = renderedLine(row);
    if (line !== undefined) shown.add(line);
  }
  const pending = incoming
    .filter((row): row is ReviewRow & { right: number } => {
      const line = renderedLine(row);
      return row.kind === "ctx" && line !== undefined && !shown.has(line);
    })
    .sort((a, b) => a.right - b.right);
  if (pending.length === 0) return rows;

  // A hunk header takes the order line of the first addressable row after it,
  // so context belonging before that line lands before the header.
  const anchors: (number | undefined)[] = new Array(rows.length).fill(undefined);
  let carry: number | undefined;
  for (let i = rows.length - 1; i >= 0; i--) {
    carry = orderLine(rows[i]) ?? carry;
    anchors[i] = carry;
  }

  const out: ReviewRow[] = [];
  let next = 0;
  for (let i = 0; i < rows.length; i++) {
    const anchor = anchors[i];
    if (anchor !== undefined) {
      while (next < pending.length && pending[next].right < anchor) out.push(pending[next++]);
    }
    if (rows[i].kind === "hunk" && anchor !== undefined && out.length > 0) {
      const previous = renderedLine(out[out.length - 1]);
      if (previous === anchor - 1) continue;
    }
    out.push(rows[i]);
  }
  while (next < pending.length) out.push(pending[next++]);
  return out;
}

// ── selection: save as {line, col}, restore by walking text nodes ───────────

/**
 * A selection saved in FILE coordinates so it survives a repaint that replaces
 * every node it referenced.
 *
 * The SIDE is part of the coordinate, not decoration: a unified hunk routinely
 * carries an `L` deletion and an `R` addition bearing the same line number, so
 * a line-only coordinate would restore onto whichever of the two happens to
 * come first in document order.
 */
export interface ReviewCoordinate {
  side: ReviewSide;
  line: number;
  col: number;
}

export interface ReviewSelection {
  anchor: ReviewCoordinate;
  focus: ReviewCoordinate;
}

/** The row element a node sits in, or null. */
function rowElementOf(node: Node | null): HTMLElement | null {
  let current: Node | null = node;
  while (current) {
    if (current instanceof HTMLElement && current.hasAttribute(ROW_LINE_ATTR)) return current;
    current = current.parentNode;
  }
  return null;
}

/** The column offset of (node, offset) within its row's text. */
function columnWithinRow(row: HTMLElement, node: Node, offset: number): number {
  const walker = row.ownerDocument.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  let column = 0;
  let text: Node | null;
  while ((text = walker.nextNode())) {
    if (text === node) return column + offset;
    column += text.textContent?.length ?? 0;
  }
  return column;
}

/**
 * Save the live selection as file coordinates, or null when there is none
 * inside `container`. Both ends must land on addressable rows; a selection that
 * starts in the chrome is not restorable and is not saved.
 */
export function saveSelection(container: HTMLElement): ReviewSelection | null {
  const selection = container.ownerDocument.defaultView?.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const anchorRow = rowElementOf(selection.anchorNode);
  const focusRow = rowElementOf(selection.focusNode);
  if (!anchorRow || !focusRow) return null;
  if (!container.contains(anchorRow) || !container.contains(focusRow)) return null;
  const anchor = coordinateOf(anchorRow, selection.anchorNode, selection.anchorOffset);
  const focus = coordinateOf(focusRow, selection.focusNode, selection.focusOffset);
  if (!anchor || !focus) return null;
  return { anchor, focus };
}

/** The (side, line, col) coordinate of a point inside a row, or null when the
 *  row does not carry a complete address. */
function coordinateOf(
  row: HTMLElement,
  node: Node | null,
  offset: number,
): ReviewCoordinate | null {
  const line = Number(row.getAttribute(ROW_LINE_ATTR));
  const side = row.getAttribute(ROW_SIDE_ATTR);
  if (!Number.isFinite(line) || (side !== "L" && side !== "R") || !node) return null;
  return { side, line, col: columnWithinRow(row, node, offset) };
}

/** Resolve a `{line, col}` coordinate back to a (node, offset) pair inside the
 *  repainted DOM. */
function resolveCoordinate(
  container: HTMLElement,
  at: ReviewCoordinate,
): { node: Node; offset: number } | null {
  const { line, col } = at;
  const row = container.querySelector<HTMLElement>(
    `[${ROW_SIDE_ATTR}="${at.side}"][${ROW_LINE_ATTR}="${line}"]`,
  );
  if (!row) return null;
  const walker = row.ownerDocument.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  let consumed = 0;
  let last: Node | null = null;
  let text: Node | null;
  while ((text = walker.nextNode())) {
    const length = text.textContent?.length ?? 0;
    if (consumed + length >= col) return { node: text, offset: col - consumed };
    consumed += length;
    last = text;
  }
  if (last) return { node: last, offset: last.textContent?.length ?? 0 };
  return { node: row, offset: 0 };
}

/**
 * Restore a saved selection after a repaint. Returns whether it landed — a
 * coordinate whose row is no longer rendered (a collapsed file, a narrowed
 * expansion) simply does not restore, which is better than restoring it onto
 * the wrong line.
 */
export function restoreSelection(
  container: HTMLElement,
  saved: ReviewSelection | null,
): boolean {
  if (!saved) return false;
  const view = container.ownerDocument.defaultView;
  const selection = view?.getSelection();
  if (!selection) return false;
  const anchor = resolveCoordinate(container, saved.anchor);
  const focus = resolveCoordinate(container, saved.focus);
  if (!anchor || !focus) return false;
  const range = container.ownerDocument.createRange();
  range.setStart(anchor.node, Math.min(anchor.offset, anchor.node.textContent?.length ?? 0));
  range.setEnd(focus.node, Math.min(focus.offset, focus.node.textContent?.length ?? 0));
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

// ── decoration: TreeWalker over text nodes, never innerHTML ────────────────

/**
 * Wrap every occurrence of `needle` inside `root`'s TEXT NODES in a
 * `<mark class="…">`, splitting nodes as needed.
 *
 * This is the non-destructive decoration contract: the backend's token
 * `<span>`s are left exactly as they are, because only text nodes are touched.
 * A decorator that assigned `innerHTML` would throw away the tokens the
 * highlighter just computed — and would also reintroduce an HTML-injection
 * surface on reviewer-authored text.
 *
 * Returns the number of matches wrapped.
 */
export function decorateMatches(
  root: HTMLElement,
  needle: string,
  className: string,
): number {
  if (needle === "") return 0;
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.nodeValue && node.nodeValue.includes(needle)) targets.push(node as Text);
  }
  let wrapped = 0;
  for (const text of targets) {
    let current: Text | null = text;
    while (current) {
      const value = current.nodeValue ?? "";
      const at = value.indexOf(needle);
      if (at < 0) break;
      // splitText leaves `current` holding the prefix and returns the rest.
      const rest = current.splitText(at);
      const tail = rest.splitText(needle.length);
      const mark = doc.createElement("mark");
      mark.className = className;
      rest.parentNode?.replaceChild(mark, rest);
      mark.appendChild(rest);
      wrapped++;
      current = tail;
    }
  }
  return wrapped;
}

/** Remove every decoration this module added, unwrapping the marks back into
 *  plain text nodes. Token markup is untouched because it was never wrapped. */
export function undecorate(root: HTMLElement, className: string): void {
  for (const mark of Array.from(root.querySelectorAll(`mark.${className}`))) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }
}
