/**
 * Pure helpers for the surface-layout TREE model (spec
 * docs/specs/surface-layout.md § The Model).
 *
 * The terminal route's center layout is a CANONICAL SPLIT TREE stored in the
 * `@rk_win_layout` window option: a leaf is a surface kind, a split is a
 * direction (`h` = children left→right, `v` = top→bottom) with ≥2 children,
 * and a child split never has its parent's direction (one encoding per
 * arrangement). The legacy `<shape>:<a>,<b>[,<c>]` preset strings parse into
 * their trees permanently; writers ALWAYS emit the tree form.
 *
 * Trees carry no sizes in their serialized form — divider positions are
 * per-viewer localStorage keyed by structure signature, and template trees
 * carry their default fractions on the nodes (absent = equal shares).
 *
 * Everything here mirrors the `window-view.ts` pattern: pure and DOM-free,
 * validated by guards on the parse path (no `as` casts). Ported from the
 * reference resolver in docs/wiki/surface-drop-zone-studies.html (tree core /
 * templates / geometry).
 */

import type { ViewName } from "./window-view";

/**
 * A tileable surface kind. Identical to the window-view lens registry
 * (`ViewName`) — the layout manager tiles the same surfaces the switcher
 * lists, so the two registries cannot drift. `tty` is a surface like any
 * other: `(current window, tty)`, always available.
 */
export type SurfaceKind = ViewName;

/** Split direction: `h` lays children left→right, `v` top→bottom. */
export type SplitDir = "h" | "v";

export interface LayoutLeaf {
  leaf: SurfaceKind;
}

export interface LayoutSplit {
  dir: SplitDir;
  children: LayoutNode[];
  /**
   * One fraction per child, summing to 1. Absent means equal shares. Only
   * template-built trees carry explicit sizes; the serialized grammar has
   * none, and per-viewer sizes live in localStorage keyed by signature.
   */
  sizes?: number[];
}

export type LayoutNode = LayoutLeaf | LayoutSplit;

/** An absolute pixel box. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Per-split divider fractions in PRE-ORDER: one array per split, each
 * matching that split's child count and summing to 1 (tolerance 1e-6). This
 * is the stored `rk-layout-sizes:*` value shape.
 */
export type LayoutSizes = number[][];

/** Gutter between sibling tiles, px (matches the tile grid's 6px gutters). */
export const SPLIT_GAP_PX = 6;

/** The main tile's share in the `main-*` templates. */
export const TEMPLATE_MAIN_FRACTION = 0.58;

/** Fallback geometry for callers with no measured rects (mobile, the CLI). */
export const NOMINAL_BOX: Rect = { x: 0, y: 0, w: 1600, h: 1000 };

/** Tile-count cap; the size floor that replaces it is a later change. */
export const MAX_TILES = 3;

/**
 * Input byte cap enforced BEFORE parsing: `parseTreeGrammar`'s recursion
 * depth is bounded by `raw.length / 2` (each level consumes ≥2 chars), so the
 * cap keeps a hostile or hand-written deep tree from overflowing the call
 * stack — the parse degrades to `null` (the tty fallback) instead. A
 * canonical tree over the four surface kinds is ≤ 17 chars; legacy presets
 * stay under 30.
 */
export const MAX_LAYOUT_LEN = 128;

const SURFACE_KINDS: SurfaceKind[] = ["tty", "web", "code", "gui"];

function isSurfaceKind(value: string): value is SurfaceKind {
  return (SURFACE_KINDS as string[]).includes(value);
}

export function isLeaf(node: LayoutNode): node is LayoutLeaf {
  return "leaf" in node;
}

export function isSplit(node: LayoutNode): node is LayoutSplit {
  return !isLeaf(node);
}

function leaf(kind: SurfaceKind): LayoutLeaf {
  return { leaf: kind };
}

/** Build a split; a single-child split lifts to the child (canonical form). */
function splitNode(
  dir: SplitDir,
  children: LayoutNode[],
  sizes?: number[],
): LayoutNode {
  if (children.length === 1) return children[0];
  const out: LayoutSplit = { dir, children };
  if (sizes !== undefined) out.sizes = sizes;
  return out;
}

/** The split's per-child fractions — explicit sizes when present and
 *  well-shaped, equal shares otherwise. */
export function sizesOf(split: LayoutSplit): number[] {
  const { children, sizes } = split;
  if (sizes !== undefined && sizes.length === children.length) return sizes;
  return Array(children.length).fill(1 / children.length);
}

/**
 * Attach explicit sizes to every split from a pre-order `LayoutSizes` (the
 * stored `rk-layout-sizes:*` shape): well-shaped entries land on their split;
 * missing or ill-shaped ones fall back to the split's own sizes, then equal
 * shares. Leaf nodes are shared by reference, so a leaf located BEFORE the
 * attach stays identical (===) in the result — the drop resolver tracks the
 * dragged leaf through the wrap/remove pipeline by identity.
 */
export function attachSizes(node: LayoutNode, sizes?: LayoutSizes): LayoutNode {
  let si = 0;
  const walk = (n: LayoutNode): LayoutNode => {
    if (isLeaf(n)) return n;
    const index = si;
    si++;
    const children = n.children.map(walk);
    const override = sizes?.[index];
    const sized: LayoutSplit = {
      dir: n.dir,
      children,
      sizes:
        override !== undefined &&
        override.length === n.children.length &&
        override.every((f) => Number.isFinite(f) && f > 0)
          ? [...override]
          : sizesOf(n),
    };
    return sized;
  };
  return walk(node);
}

/** The pre-order per-split fractions of a tree (the `LayoutSizes` shape). */
export function extractSizes(node: LayoutNode): LayoutSizes {
  const out: LayoutSizes = [];
  const walk = (n: LayoutNode): void => {
    if (isLeaf(n)) return;
    out.push(sizesOf(n));
    n.children.forEach(walk);
  };
  walk(node);
  return out;
}

/** The leaf kinds in reading order (depth-first, left-to-right). */
export function leaves(node: LayoutNode): SurfaceKind[] {
  if (isLeaf(node)) return [node.leaf];
  return node.children.flatMap(leaves);
}

/**
 * Stable per-leaf ids in reading order: the kind itself for a unique kind;
 * duplicate kinds (only `tty` can repeat) are `tty`, `tty#2`, … by
 * occurrence.
 */
export function leafIds(node: LayoutNode): string[] {
  const kinds = leaves(node);
  const totals = new Map<SurfaceKind, number>();
  for (const k of kinds) totals.set(k, (totals.get(k) ?? 0) + 1);
  const seen = new Map<SurfaceKind, number>();
  return kinds.map((k) => {
    if (totals.get(k) === 1) return k;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return n === 1 ? k : `${k}#${n}`;
  });
}

// ── parsing (tree grammar + permanent legacy preset grammar) ───────────────

/**
 * Canonical-form validation: ≥2 children per split, no child split with its
 * parent's direction, 1..maxLeaves leaves, no repeated non-tty kind, and any
 * explicit sizes matching their split's child count.
 */
export function isCanonicalTree(
  node: LayoutNode,
  maxLeaves: number = MAX_TILES,
): boolean {
  const kinds = leaves(node);
  if (kinds.length < 1 || kinds.length > maxLeaves) return false;
  const seen = new Set<SurfaceKind>();
  for (const k of kinds) {
    if (k === "tty") continue; // duplicate tty tiles are legal (muxed relay)
    if (seen.has(k)) return false;
    seen.add(k);
  }
  const walk = (n: LayoutNode, parentDir: SplitDir | null): boolean => {
    if (isLeaf(n)) return true;
    if (n.children.length < 2) return false;
    if (parentDir !== null && n.dir === parentDir) return false;
    if (n.sizes !== undefined && n.sizes.length !== n.children.length) return false;
    return n.children.every((c) => walk(c, n.dir));
  };
  return walk(node, null);
}

function parseTreeGrammar(raw: string): LayoutNode | null {
  let i = 0;
  const parseNode = (): LayoutNode | null => {
    const ch = raw[i];
    if (ch === "h" || ch === "v") {
      const dir: SplitDir = ch === "h" ? "h" : "v";
      i++;
      if (raw[i] !== "(") return null;
      i++;
      const children: LayoutNode[] = [];
      for (;;) {
        const child = parseNode();
        if (child === null) return null;
        children.push(child);
        if (raw[i] === ",") {
          i++;
          continue;
        }
        break;
      }
      if (raw[i] !== ")") return null;
      i++;
      return { dir, children };
    }
    // No surface kind is a prefix of another, and a leaf must be followed by
    // a delimiter or the end of input.
    for (const kind of SURFACE_KINDS) {
      if (!raw.startsWith(kind, i)) continue;
      const next = raw[i + kind.length];
      if (next !== undefined && next !== "," && next !== ")") return null;
      i += kind.length;
      return { leaf: kind };
    }
    return null;
  };
  const node = parseNode();
  if (node === null || i !== raw.length) return null;
  return node;
}

type LegacyShape =
  | "single"
  | "split-h"
  | "split-v"
  | "row"
  | "col"
  | "main-left"
  | "main-right"
  | "main-top";

const LEGACY_ARITY: Record<LegacyShape, 1 | 2 | 3> = {
  single: 1,
  "split-h": 2,
  "split-v": 2,
  row: 3,
  col: 3,
  "main-left": 3,
  "main-right": 3,
  "main-top": 3,
};

/** The legacy preset → tree conversion table (spec § The Model). */
const LEGACY_BUILDERS: Record<LegacyShape, (k: SurfaceKind[]) => LayoutNode> = {
  single: (k) => leaf(k[0]),
  "split-h": (k) => ({ dir: "h", children: [leaf(k[0]), leaf(k[1])] }),
  "split-v": (k) => ({ dir: "v", children: [leaf(k[0]), leaf(k[1])] }),
  row: (k) => ({ dir: "h", children: [leaf(k[0]), leaf(k[1]), leaf(k[2])] }),
  col: (k) => ({ dir: "v", children: [leaf(k[0]), leaf(k[1]), leaf(k[2])] }),
  "main-left": (k) => ({
    dir: "h",
    children: [leaf(k[0]), { dir: "v", children: [leaf(k[1]), leaf(k[2])] }],
  }),
  "main-right": (k) => ({
    dir: "h",
    children: [{ dir: "v", children: [leaf(k[1]), leaf(k[2])] }, leaf(k[0])],
  }),
  "main-top": (k) => ({
    dir: "v",
    children: [leaf(k[0]), { dir: "h", children: [leaf(k[1]), leaf(k[2])] }],
  }),
};

function isLegacyShape(value: string): value is LegacyShape {
  return Object.prototype.hasOwnProperty.call(LEGACY_ARITY, value);
}

function parseLegacy(raw: string): LayoutNode | null {
  const colon = raw.indexOf(":");
  const shape = raw.slice(0, colon);
  if (!isLegacyShape(shape)) return null;
  const parts = raw.slice(colon + 1).split(",");
  if (parts.length !== LEGACY_ARITY[shape]) return null;
  const kinds: SurfaceKind[] = [];
  for (const p of parts) {
    if (!isSurfaceKind(p)) return null;
    kinds.push(p);
  }
  return LEGACY_BUILDERS[shape](kinds);
}

/**
 * Parse a stored `@rk_win_layout` value: the tree grammar, or the legacy
 * `<shape>:<a>,<b>[,<c>]` preset grammar (accepted permanently, converted
 * losslessly per the table). Returns `null` for anything malformed — unknown
 * kind, whitespace, a non-canonical tree, more than MAX_TILES leaves, or a
 * repeated non-tty kind. The input is NEVER normalised into validity.
 */
export function parseLayoutTree(raw: string | null | undefined): LayoutNode | null {
  if (!raw || /\s/.test(raw) || raw.length > MAX_LAYOUT_LEN) return null;
  const node = raw.includes(":") ? parseLegacy(raw) : parseTreeGrammar(raw);
  return node !== null && isCanonicalTree(node) ? node : null;
}

/** Serialize to the tree form. Writers always emit this form — there is no
 *  preset-string fallback. */
export function serializeLayoutTree(node: LayoutNode): string {
  if (isLeaf(node)) return node.leaf;
  return `${node.dir}(${node.children.map(serializeLayoutTree).join(",")})`;
}

/**
 * The structure signature: the tree's shape with leaves replaced by their
 * reading-order indices, e.g. `h(0,v(1,2))`. This is the sizes storage key
 * suffix — sizes key on structure, not on which leaves sit where.
 */
export function structureSig(node: LayoutNode): string {
  let i = 0;
  const walk = (n: LayoutNode): string => {
    if (isLeaf(n)) {
      const s = String(i);
      i++;
      return s;
    }
    return `${n.dir}(${n.children.map(walk).join(",")})`;
  };
  return walk(node);
}

// ── pure tree operations ────────────────────────────────────────────────────

/** The node at a child-index path (the root at `[]`). */
export function getAt(node: LayoutNode, path: number[]): LayoutNode {
  return path.reduce<LayoutNode>((n, i) => (isLeaf(n) ? n : n.children[i]), node);
}

function setAt(node: LayoutNode, path: number[], value: LayoutNode): LayoutNode {
  if (path.length === 0) return value;
  if (isLeaf(node)) return node;
  const [head, ...rest] = path;
  const children = node.children.slice();
  children[head] = setAt(children[head], rest, value);
  const out: LayoutSplit = { dir: node.dir, children };
  if (node.sizes !== undefined) out.sizes = node.sizes;
  return out;
}

/** The path (child indices from the root) of a leaf id, or null. */
export function pathOf(node: LayoutNode, leafId: string): number[] | null {
  const ids = leafIds(node);
  let li = 0;
  const walk = (n: LayoutNode, path: number[]): number[] | null => {
    if (isLeaf(n)) {
      const found = ids[li] === leafId ? path : null;
      li++;
      return found;
    }
    for (let i = 0; i < n.children.length; i++) {
      const found = walk(n.children[i], [...path, i]);
      if (found !== null) return found;
    }
    return null;
  };
  return walk(node, []);
}

function hasExplicitSizes(node: LayoutNode): boolean {
  return isSplit(node) && (node.sizes !== undefined || node.children.some(hasExplicitSizes));
}

/** Drop every explicit size, returning the equal-shares form. */
export function stripSizes(node: LayoutNode): LayoutNode {
  if (isLeaf(node)) return node;
  return { dir: node.dir, children: node.children.map(stripSizes) };
}

/** The study's `norm`: merge same-direction children into their parent
 *  (fractions multiply through) and lift single-child splits. */
function normSized(node: LayoutNode): LayoutNode {
  if (isLeaf(node)) return node;
  const s0 = sizesOf(node);
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  node.children.map(normSized).forEach((k, i) => {
    if (isSplit(k) && k.dir === node.dir) {
      sizesOf(k).forEach((f, j) => {
        children.push(k.children[j]);
        sizes.push(f * s0[i]);
      });
    } else {
      children.push(k);
      sizes.push(s0[i]);
    }
  });
  return splitNode(node.dir, children, sizes);
}

/**
 * Canonicalise: merge same-direction nesting and lift single-child splits.
 * Explicit sizes are carried through the arithmetic; a tree with no explicit
 * sizes stays size-less (equal shares are implicit). Canonical input is a
 * fixpoint.
 */
export function normalise(node: LayoutNode): LayoutNode {
  const out = normSized(node);
  return hasExplicitSizes(node) ? out : stripSizes(out);
}

function removeAt(node: LayoutNode, path: number[]): LayoutNode | null {
  if (path.length === 0) return null; // this node is the removed leaf
  if (isLeaf(node)) return node;
  const [head, ...rest] = path;
  const s0 = sizesOf(node);
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((c, i) => {
    const r = i === head ? removeAt(c, rest) : c;
    if (r !== null) {
      children.push(r);
      sizes.push(s0[i]);
    }
  });
  if (children.length === 0) return null;
  const sum = sizes.reduce((a, b) => a + b, 0);
  return splitNode(node.dir, children, sizes.map((f) => f / sum));
}

/**
 * Remove the leaf at `path`; its siblings absorb its share in proportion to
 * their sizes. The result is canonical (single-child splits lift). Returns
 * `null` when nothing remains. The path-addressed half of `removeLeaf` — the
 * drop resolver holds the dragged leaf's identity across an insertion, where
 * its derived id is ambiguous.
 */
export function removeNodeAt(node: LayoutNode, path: number[]): LayoutNode | null {
  const out = removeAt(node, path);
  if (out === null) return null;
  const normed = normSized(out);
  return hasExplicitSizes(node) ? normed : stripSizes(normed);
}

/**
 * Remove a leaf; its siblings absorb its share in proportion to their sizes.
 * The result is canonical (single-child splits lift). Returns `null` when the
 * leaf is absent or nothing remains.
 */
export function removeLeaf(node: LayoutNode, leafId: string): LayoutNode | null {
  const path = pathOf(node, leafId);
  if (path === null) return null;
  return removeNodeAt(node, path);
}

/** The side of a target leaf an insertion (or drop) lands on. */
export type DropSide = "left" | "right" | "top" | "bottom";

const SIDE_DIR: Record<DropSide, SplitDir> = {
  left: "h",
  right: "h",
  top: "v",
  bottom: "v",
};

const SIDE_FIRST: Record<DropSide, boolean> = {
  left: true,
  top: true,
  right: false,
  bottom: false,
};

/**
 * Insert `newLeaf` beside the leaf at `targetPath`: wrap the target in a
 * split on the side's axis (the wrap takes the target's share; with explicit
 * sizes the pair splits it 50/50), then normalise — a same-direction wrap
 * merges into the parent split. This is the study's `dropEdge` generalised
 * to a pure insert.
 */
export function insertBeside(
  node: LayoutNode,
  targetPath: number[],
  side: DropSide,
  newLeaf: LayoutLeaf,
): LayoutNode {
  const keepSizes = hasExplicitSizes(node);
  const target = getAt(node, targetPath);
  const children = SIDE_FIRST[side] ? [newLeaf, target] : [target, newLeaf];
  const wrap = splitNode(SIDE_DIR[side], children, keepSizes ? [0.5, 0.5] : undefined);
  const out = normSized(setAt(node, targetPath, wrap));
  return keepSizes ? out : stripSizes(out);
}

/**
 * Exchange two leaves by id; sizes stay with their positions. An involution,
 * and a no-op when either id is absent.
 */
export function swapLeaves(node: LayoutNode, a: string, b: string): LayoutNode {
  if (a === b) return node;
  const ids = leafIds(node);
  const kinds = leaves(node);
  const kindById = new Map<string, SurfaceKind>();
  ids.forEach((id, i) => kindById.set(id, kinds[i]));
  const ka = kindById.get(a);
  const kb = kindById.get(b);
  if (ka === undefined || kb === undefined) return node;
  let li = 0;
  const walk = (n: LayoutNode): LayoutNode => {
    if (isLeaf(n)) {
      const id = ids[li];
      li++;
      return id === a ? { leaf: kb } : id === b ? { leaf: ka } : n;
    }
    const out: LayoutSplit = { dir: n.dir, children: n.children.map(walk) };
    if (n.sizes !== undefined) out.sizes = n.sizes;
    return out;
  };
  return walk(node);
}

// ── templates (generators, not the model) ───────────────────────────────────

export type TemplateName =
  | "row"
  | "col"
  | "main-left"
  | "main-right"
  | "main-top"
  | "main-bottom";

/** Registry order — drives `templateOf` matching, `templatesFor`, the ▦ chip
 *  popover, and the cycle chord. */
export const TEMPLATE_NAMES: TemplateName[] = [
  "row",
  "col",
  "main-left",
  "main-right",
  "main-top",
  "main-bottom",
];

/** Human labels for the templates — the ▦ chip rows, the overflow menu's
 *  `Layout: …` rows, and the palette's template jumps. */
export const TEMPLATE_LABEL: Record<TemplateName, string> = {
  row: "Row",
  col: "Column",
  "main-left": "Main Left",
  "main-right": "Main Right",
  "main-top": "Main Top",
  "main-bottom": "Main Bottom",
};

/**
 * The template registry (the study's `TEMPLATES`): each builds a tree for
 * any N from a slot order; slot 0 is the template's main tile. Template trees
 * carry their default sizes on the nodes (main fraction 0.58).
 */
export const TEMPLATES: Record<TemplateName, (slots: SurfaceKind[]) => LayoutNode> = {
  row: (slots) => splitNode("h", slots.map(leaf)),
  col: (slots) => splitNode("v", slots.map(leaf)),
  "main-left": (slots) =>
    slots.length < 3
      ? splitNode("h", slots.map(leaf))
      : splitNode(
          "h",
          [leaf(slots[0]), splitNode("v", slots.slice(1).map(leaf))],
          [TEMPLATE_MAIN_FRACTION, 1 - TEMPLATE_MAIN_FRACTION],
        ),
  "main-right": (slots) =>
    slots.length < 3
      ? splitNode("h", slots.map(leaf))
      : splitNode(
          "h",
          [splitNode("v", slots.slice(1).map(leaf)), leaf(slots[0])],
          [1 - TEMPLATE_MAIN_FRACTION, TEMPLATE_MAIN_FRACTION],
        ),
  "main-top": (slots) =>
    slots.length < 3
      ? splitNode("v", slots.map(leaf))
      : splitNode(
          "v",
          [leaf(slots[0]), splitNode("h", slots.slice(1).map(leaf))],
          [TEMPLATE_MAIN_FRACTION, 1 - TEMPLATE_MAIN_FRACTION],
        ),
  "main-bottom": (slots) =>
    slots.length < 3
      ? splitNode("v", slots.map(leaf))
      : splitNode(
          "v",
          [splitNode("h", slots.slice(1).map(leaf)), leaf(slots[0])],
          [1 - TEMPLATE_MAIN_FRACTION, TEMPLATE_MAIN_FRACTION],
        ),
};

/** Distinct stand-in kinds for structure comparisons and slot mapping (there
 *  are exactly four kinds, and template matching runs at N ≤ 4). */
const INDEX_KINDS: SurfaceKind[] = ["tty", "web", "code", "gui"];

export interface TemplateMatch {
  name: TemplateName | "single" | "custom";
  /** The tree's leaves in the matched template's slot order — slot 0 first
   *  (the main tile). Reading order for `single` and `custom`. */
  slots: SurfaceKind[];
}

/**
 * Which template a tree is (structure match, kinds ignored) and its leaves in
 * that template's slot order: the first template in registry order whose
 * structure matches, `single` at one leaf, `custom` otherwise.
 */
export function templateOf(node: LayoutNode): TemplateMatch {
  const realLeaves = leaves(node);
  const n = realLeaves.length;
  if (n === 1) return { name: "single", slots: realLeaves };
  if (n > INDEX_KINDS.length) return { name: "custom", slots: realLeaves };
  const sig = structureSig(node);
  const indexSlots = INDEX_KINDS.slice(0, n);
  for (const name of TEMPLATE_NAMES) {
    const built = TEMPLATES[name](indexSlots);
    if (structureSig(built) !== sig) continue;
    const slots: SurfaceKind[] = [];
    leaves(built).forEach((kind, j) => {
      slots[INDEX_KINDS.indexOf(kind)] = realLeaves[j];
    });
    return { name, slots };
  }
  return { name: "custom", slots: realLeaves };
}

/** The tree's leaves in template slot order — slot A is the template's main
 *  tile; reading order for a custom tree. */
export function slotOrder(node: LayoutNode): SurfaceKind[] {
  return templateOf(node).slots;
}

/** The structurally distinct templates at N, in registry order. */
export function templatesFor(n: number): TemplateName[] {
  if (n < 2 || n > INDEX_KINDS.length) return [];
  const indexSlots = INDEX_KINDS.slice(0, n);
  const seen = new Set<string>();
  const out: TemplateName[] = [];
  for (const name of TEMPLATE_NAMES) {
    const sig = structureSig(TEMPLATES[name](indexSlots));
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(name);
  }
  return out;
}

/** The matched template's default per-split fractions (pre-order), or
 *  `undefined` for `single`/`custom` — the render-time fallback when no
 *  viewer sizes are stored. */
export function templateSizes(node: LayoutNode): LayoutSizes | undefined {
  const match = templateOf(node);
  if (match.name === "single" || match.name === "custom") return undefined;
  const built = TEMPLATES[match.name](INDEX_KINDS.slice(0, leaves(node).length));
  const out: LayoutSizes = [];
  const walk = (n: LayoutNode): void => {
    if (isLeaf(n)) return;
    out.push(sizesOf(n));
    n.children.forEach(walk);
  };
  walk(built);
  return out;
}

// ── geometry ────────────────────────────────────────────────────────────────

/** Per-split fractions for layout: the override array when it is well-shaped
 *  (read-side validation happens at storage), else the split's own sizes,
 *  else equal shares. */
function splitFractions(split: LayoutSplit, override?: number[]): number[] {
  if (
    override !== undefined &&
    override.length === split.children.length &&
    override.every((f) => Number.isFinite(f) && f > 0)
  ) {
    return override;
  }
  return sizesOf(split);
}

/**
 * Compute each leaf's absolute rect inside `box`, keyed by leaf id. `sizes`
 * is the pre-order per-split fraction override (stored viewer sizes or the
 * template default); splits with no valid override fall back to their own
 * sizes, then to equal shares.
 */
export function layoutRects(
  node: LayoutNode,
  box: Rect,
  sizes?: LayoutSizes,
  gap: number = SPLIT_GAP_PX,
): Map<string, Rect> {
  const ids = leafIds(node);
  const out = new Map<string, Rect>();
  let li = 0;
  let si = 0;
  const walk = (n: LayoutNode, b: Rect): void => {
    if (isLeaf(n)) {
      out.set(ids[li], b);
      li++;
      return;
    }
    const fractions = splitFractions(n, sizes?.[si]);
    si++;
    const horiz = n.dir === "h";
    const count = n.children.length;
    const avail = (horiz ? b.w : b.h) - gap * (count - 1);
    let at = horiz ? b.x : b.y;
    n.children.forEach((k, i) => {
      const len = avail * fractions[i];
      walk(
        k,
        horiz ? { x: at, y: b.y, w: len, h: b.h } : { x: b.x, y: at, w: b.w, h: len },
      );
      at += len + gap;
    });
  };
  walk(node, box);
  return out;
}

/** One divider between an adjacent sibling pair of a split, positioned in
 *  the gutter. `boundary` is the index of the child AFTER the divider. */
export interface DividerLine {
  /** Child-index path of the split this divider belongs to. */
  splitPath: number[];
  boundary: number;
  /** The split's direction — an `h` split's divider is a vertical line. */
  dir: SplitDir;
  /** The gutter rect (SPLIT_GAP_PX thick on the split axis). */
  rect: Rect;
}

/** A point where one divider's end meets a perpendicular divider — dragging
 *  it moves both dividers' fraction pairs. */
export interface DividerIntersection {
  x: number;
  y: number;
  /** Indices into the `dividers` array, ascending. */
  dividers: [number, number];
}

export interface DividerGeometry {
  dividers: DividerLine[];
  intersections: DividerIntersection[];
}

/**
 * Derive the divider lines (one per adjacent sibling pair of every split) and
 * the intersection zones (every point where a divider's end meets a
 * perpendicular divider) for a laid-out tree.
 */
export function layoutDividers(
  node: LayoutNode,
  box: Rect,
  sizes?: LayoutSizes,
  gap: number = SPLIT_GAP_PX,
): DividerGeometry {
  const dividers: DividerLine[] = [];
  let si = 0;
  const walk = (n: LayoutNode, b: Rect, path: number[]): void => {
    if (isLeaf(n)) return;
    const fractions = splitFractions(n, sizes?.[si]);
    si++;
    const horiz = n.dir === "h";
    const count = n.children.length;
    const avail = (horiz ? b.w : b.h) - gap * (count - 1);
    let at = horiz ? b.x : b.y;
    n.children.forEach((k, i) => {
      const len = avail * fractions[i];
      if (i > 0) {
        dividers.push({
          splitPath: path,
          boundary: i,
          dir: n.dir,
          rect: horiz
            ? { x: at - gap, y: b.y, w: gap, h: b.h }
            : { x: b.x, y: at - gap, w: b.w, h: gap },
        });
      }
      walk(
        k,
        horiz ? { x: at, y: b.y, w: len, h: b.h } : { x: b.x, y: at, w: b.w, h: len },
        [...path, i],
      );
      at += len + gap;
    });
  };
  walk(node, box, []);

  // Center lines: an `h` split's divider is vertical (fixed x, y span), a
  // `v` split's divider is horizontal. An intersection exists where an
  // endpoint of one center line lies within `gap` of a perpendicular
  // divider's center line and inside its span.
  interface CenterLine {
    index: number;
    vertical: boolean;
    fixed: number;
    from: number;
    to: number;
  }
  const lines: CenterLine[] = dividers.map((d, index) =>
    d.dir === "h"
      ? {
          index,
          vertical: true,
          fixed: d.rect.x + d.rect.w / 2,
          from: d.rect.y,
          to: d.rect.y + d.rect.h,
        }
      : {
          index,
          vertical: false,
          fixed: d.rect.y + d.rect.h / 2,
          from: d.rect.x,
          to: d.rect.x + d.rect.w,
        },
  );
  const intersections: DividerIntersection[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const endpoints: { x: number; y: number }[] = line.vertical
      ? [
          { x: line.fixed, y: line.from },
          { x: line.fixed, y: line.to },
        ]
      : [
          { x: line.from, y: line.fixed },
          { x: line.to, y: line.fixed },
        ];
    for (const p of endpoints) {
      for (const other of lines) {
        if (other.vertical === line.vertical) continue;
        const near = line.vertical
          ? Math.abs(p.y - other.fixed) <= gap
          : Math.abs(p.x - other.fixed) <= gap;
        const along = line.vertical ? p.x : p.y;
        const within = along >= other.from - 0.5 && along <= other.to + 0.5;
        if (!near || !within) continue;
        const a = Math.min(line.index, other.index);
        const bIndex = Math.max(line.index, other.index);
        const key = `${a}:${bIndex}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const vertical = line.vertical ? line : other;
        const horizontal = line.vertical ? other : line;
        intersections.push({ x: vertical.fixed, y: horizontal.fixed, dividers: [a, bIndex] });
      }
    }
  }
  return { dividers, intersections };
}
