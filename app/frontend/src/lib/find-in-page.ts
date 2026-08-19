/**
 * Find-in-page engine for the web tile (260819-ie2i R6).
 *
 * A pure, DOM-light module — the `window-view.ts`/`surface-layout.ts`
 * contract — owning three pieces for `IframeWindow`'s find bar:
 *
 * 1. Match collection: a case-insensitive TreeWalker walk over the framed
 *    document's text nodes producing one DOM `Range` per occurrence
 *    (non-rendered containers — script/style/noscript/template — skipped).
 * 2. The match-state machine: active index + next/prev with wrap (`stepMatch`).
 * 3. Highlight application against the FRAME's own window: the CSS Custom
 *    Highlight API (`contentWindow.CSS.highlights`) plus one inert `<style>`
 *    element with the `::highlight()` rules placed into the frame's `<head>`
 *    (the pseudo-elements must be styled in the document that owns the
 *    ranges; a style element is inert DOM — no script is ever injected into
 *    the framed page). Where the API is unavailable the caller degrades to
 *    `window.find()` (`findWithWindow`); every frame-DOM access here carries
 *    the attach seam's try/catch posture.
 */

/** The document CustomEvent that opens the find bar: dispatched by the ⌘F
 *  chord handler and the palette action; `IframeWindow` listens while
 *  mounted (the `window-heading:rename` precedent). */
export const WEB_FIND_OPEN_EVENT = "web-find:open";

/** The two Highlight registry names: every match, and the active match. */
export const FIND_HIGHLIGHT = "rk-find";
export const FIND_ACTIVE_HIGHLIGHT = "rk-find-active";

/** The id of the `<style>` element carrying the `::highlight()` rules — one
 *  per framed document, replaced on re-apply and removed on reset. */
const HIGHLIGHT_STYLE_ID = "rk-find-highlight-style";

/** Non-rendered containers whose text never participates in find. */
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

/** Accent-green active outline + the two match backgrounds (the approved
 *  design-study palette, state 03 — raw colors: the framed document does not
 *  share the SPA's theme variables). */
const HIGHLIGHT_CSS = `
::highlight(${FIND_HIGHLIGHT}) { background-color: rgba(232, 177, 63, 0.30); }
::highlight(${FIND_ACTIVE_HIGHLIGHT}) { background-color: rgba(61, 220, 132, 0.45); outline: 1px solid #22c55e; }
`;

/**
 * Collect one `Range` per case-insensitive occurrence of `query` in `doc`'s
 * rendered text. Ranges are document order. An empty/blank query collects
 * nothing. Throws nothing: a cross-origin-adjacent failure simply yields no
 * matches.
 */
export function collectMatches(doc: Document, query: string): Range[] {
  const needle = query.trim().toLowerCase();
  if (!needle || !doc.body) return [];
  const matches: Range[] = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node = walker.nextNode();
  while (node) {
    const text = (node.textContent ?? "").toLowerCase();
    let from = 0;
    let at = text.indexOf(needle, from);
    while (at !== -1) {
      const range = doc.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      matches.push(range);
      from = at + needle.length;
      at = text.indexOf(needle, from);
    }
    node = walker.nextNode();
  }
  return matches;
}

/** The match-state machine's one transition: step from `active` by `delta`
 *  (+1 next / -1 previous) with wraparound. `count <= 0` pins at 0 (the
 *  `0/0` no-op navigation case). */
export function stepMatch(active: number, count: number, delta: 1 | -1): number {
  if (count <= 0) return 0;
  return (active + delta + count) % count;
}

/** The duck-typed slice of `HighlightRegistry` the engine uses — the TS DOM
 *  lib does not model `Window.CSS`/`Window.Highlight`, so the frame window's
 *  capabilities are detected structurally (`Reflect.get` + guards) rather
 *  than asserted. */
interface HighlightRegistryLike {
  set(name: string, highlight: object): void;
  delete(name: string): void;
}

/** The frame window's Highlight registry, or null where the Custom
 *  Highlight API is missing (older engines, jsdom). */
function highlightRegistryOf(win: Window): HighlightRegistryLike | null {
  try {
    const css: unknown = Reflect.get(win, "CSS");
    if (typeof css !== "object" || css === null) return null;
    const registry: unknown = Reflect.get(css, "highlights");
    if (typeof registry !== "object" || registry === null) return null;
    if (typeof Reflect.get(registry, "set") !== "function") return null;
    if (typeof Reflect.get(registry, "delete") !== "function") return null;
    return registry as HighlightRegistryLike;
  } catch {
    return null;
  }
}

/** The frame window's `Highlight` constructor, or null where unavailable. */
function highlightCtorOf(win: Window): ((...ranges: Range[]) => object) | null {
  try {
    const ctor: unknown = Reflect.get(win, "Highlight");
    if (typeof ctor !== "function") return null;
    return (...ranges: Range[]) => Reflect.construct(ctor, ranges) as object;
  } catch {
    return null;
  }
}

/**
 * Apply highlight styling for `matches` (active = `matches[active]`) inside
 * the framed document: registers the two Highlight objects on the FRAME
 * window's `CSS.highlights` and installs the `::highlight()` `<style>` into
 * the frame's `<head>`. Returns false (caller falls back to `window.find()`)
 * where the API is unavailable. Never throws.
 */
export function applyHighlights(
  win: Window,
  doc: Document,
  matches: Range[],
  active: number,
): boolean {
  try {
    const registry = highlightRegistryOf(win);
    const HighlightCtor = highlightCtorOf(win);
    if (!registry || !HighlightCtor) return false;
    registry.set(FIND_HIGHLIGHT, HighlightCtor(...matches));
    const activeMatch = matches[active];
    if (activeMatch) {
      registry.set(FIND_ACTIVE_HIGHLIGHT, HighlightCtor(activeMatch));
    } else {
      registry.delete(FIND_ACTIVE_HIGHLIGHT);
    }
    let style = doc.getElementById(HIGHLIGHT_STYLE_ID);
    if (!style) {
      style = doc.createElement("style");
      style.id = HIGHLIGHT_STYLE_ID;
      style.textContent = HIGHLIGHT_CSS;
      doc.head.appendChild(style);
    }
    return true;
  } catch {
    return false;
  }
}

/** Remove both Highlight registrations and the `<style>` element from the
 *  framed document. Never throws (teardown runs against documents that may
 *  already be discarded). */
export function clearHighlights(win: Window, doc: Document): void {
  try {
    const registry = highlightRegistryOf(win);
    registry?.delete(FIND_HIGHLIGHT);
    registry?.delete(FIND_ACTIVE_HIGHLIGHT);
    doc.getElementById(HIGHLIGHT_STYLE_ID)?.remove();
  } catch {
    /* noop — the document may be gone or cross-origin */
  }
}

/** Scroll a match into view (nearest block) — the framed page's own scroll. */
export function scrollToMatch(match: Range): void {
  try {
    match.startContainer.parentElement?.scrollIntoView({ block: "nearest" });
  } catch {
    /* noop — a detached range scrolls nothing */
  }
}

/** The `window.find()` fallback for engines without the Custom Highlight
 *  API: navigation only (no count). Returns whether a match was found. */
export function findWithWindow(win: Window, query: string, backwards: boolean): boolean {
  try {
    const find: unknown = Reflect.get(win, "find");
    if (typeof find !== "function") return false;
    return Reflect.apply(find, win, [query, false, backwards, true]) === true;
  } catch {
    return false;
  }
}
