/**
 * Swatch color audit (dev-time, read-only).
 *
 * Answers: how many *distinct, legible* row-tint swatches can we offer that
 * stay derived from the theme palette? Measures two expansion levers beyond
 * the current 6 standard ANSI hues (PICKER_ANSI_INDICES = 1..6):
 *
 *   Lever A — bright variants: ANSI indices 9..14 as single-index candidates.
 *   Lever B — two-hue blends:  50/50 blends of the 6 standard hues (15 pairs),
 *             e.g. red+yellow=orange, green+cyan=teal — still 100% palette-derived
 *             (they re-derive when the theme changes), just not a single index.
 *
 * For every theme in configs/themes.json it computes, using the REAL pipeline
 * imported from themes.ts (saturate ×1.5 → blend into bg), the rendered tint of
 * every candidate, then:
 *   - pairwise OKLab ΔE between all candidate `selected`-state tints (distinctness)
 *   - WCAG contrast of each candidate's full-saturation color vs. bg (border legibility)
 *   - WCAG contrast of theme foreground vs. each candidate's `base` tint (text on row)
 *
 * Output: a self-contained HTML report at the path printed on stdout.
 * Run: npx tsx app/frontend/scripts/audit-swatch-colors.ts [--out <file>]
 *
 * This script ships nothing and imports no test infra — it is a measurement tool.
 */

import { writeFileSync } from "node:fs";
import {
  THEMES,
  blendHex,
  saturateHex,
  PICKER_ANSI_INDICES,
  type ThemePalette,
} from "../src/themes.ts";

// ── Color math NOT in themes.ts: OKLab + WCAG ────────────────────────────────

type RGB = { r: number; g: number; b: number };

function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

/** sRGB channel (0..255) → linear-light (0..1). The gamma step people skip. */
function srgbToLinear(c8: number): number {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

type OKLab = { L: number; a: number; b: number };

/** Convert a hex sRGB color to OKLab (Björn Ottosson, 2020). */
function hexToOklab(hex: string): OKLab {
  const { r, g, b } = hexToRgb(hex);
  const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

/** Perceptual distance: Euclidean in OKLab. ~0.02 ≈ a just-noticeable difference,
 *  but OKLab L is on a 0..1 scale so we scale by 100 to get human-friendly numbers
 *  comparable in spirit to CIELAB ΔE (where ~1 ≈ JND, ~2 ≈ clearly distinct). */
function deltaEOklab(hex1: string, hex2: string): number {
  const c1 = hexToOklab(hex1), c2 = hexToOklab(hex2);
  const dL = c1.L - c2.L, da = c1.a - c2.a, db = c1.b - c2.b;
  return Math.sqrt(dL * dL + da * da + db * db) * 100;
}

/** WCAG 2.x relative luminance from linear-light sRGB. */
function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG 2.x contrast ratio (1..21). */
function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1), l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2), darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ── Contrast guardrail: auto-adjust a border color to clear a min ratio ──────
// "use 1" from the discussion: when the full-saturation border fails WCAG vs bg,
// nudge its OKLab lightness away from the background (lighten on dark themes,
// darken on light) in small steps until it clears `min` or we hit the cap.
// We preserve hue/chroma — only L moves — so the swatch keeps its identity.
// Mirrors the spirit of deriveUIColors' accentBright (lighten-on-dark) but is
// driven by a measured contrast target rather than a fixed percentage.

function oklabToHex(c: OKLab): string {
  const l_ = c.L + 0.3963377774 * c.a + 0.2158037573 * c.b;
  const m_ = c.L - 0.1055613458 * c.a - 0.0638541728 * c.b;
  const s_ = c.L - 0.0894841775 * c.a - 1.291485548 * c.b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  const lr = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const enc = (c: number) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(v * 255)));
  };
  const h = (n: number) => enc(n).toString(16).padStart(2, "0");
  return "#" + h(lr) + h(lg) + h(lb);
}

/** Return a border color that clears `min` contrast vs bg, nudging L if needed.
 *  isDark ⇒ push lighter; light theme ⇒ push darker. Caps at 24 steps. */
function adjustBorderForContrast(border: string, bg: string, isDark: boolean, min: number): string {
  if (contrastRatio(border, bg) >= min) return border;
  const lab = hexToOklab(border);
  const step = isDark ? 0.03 : -0.03;
  let L = lab.L;
  for (let i = 0; i < 24; i++) {
    L = Math.max(0, Math.min(1, L + step));
    const candidate = oklabToHex({ L, a: lab.a, b: lab.b });
    if (contrastRatio(candidate, bg) >= min) return candidate;
    if (L <= 0 || L >= 1) break;
  }
  return oklabToHex({ L, a: lab.a, b: lab.b }); // best effort at the cap
}

// ── Candidate definition ─────────────────────────────────────────────────────

const ANSI_NAMES = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow",
  "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
];

type CandidateKind = "current" | "bright" | "blend";

type Candidate = {
  key: string;        // stable id, also the proposed stored representation
  label: string;      // human label for the report
  kind: CandidateKind;
  /** Resolve the full-saturation source color for a given theme palette. */
  source: (p: ThemePalette) => string;
};

const BRIGHT_INDICES = [9, 10, 11, 12, 13, 14];

/** All unordered pairs of the 6 standard hues → 15 two-hue blends. */
function buildBlendPairs(): Array<[number, number]> {
  const std = [...PICKER_ANSI_INDICES];
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < std.length; i++) {
    for (let j = i + 1; j < std.length; j++) pairs.push([std[i], std[j]]);
  }
  return pairs;
}

/** The preview set: current 6 standard hues + the top-scoring two-hue blends
 *  (by the distinctness audit). Brights are excluded — the audit showed them
 *  collapsing onto 1–6 on 54–66% of themes. Ordered current-first, then blends
 *  ranked by avg distinctness so the eye sees the strongest additions first. */
// Chosen for mutual separation, not just distance-from-the-original-6. The
// full sweep showed the blends crowd *each other*: rosy(1+6)≈purple(1+4), and
// teal(4+6) sits between blue(4) and cyan(6) squeezing all three. This set keeps
// the four best-separated additions; toggle members and re-run to compare by eye.
const PREVIEW_BLENDS: Array<[number, number]> = [
  [1, 3], // orange  (red·yellow)  — strongest, fills the warm gap ANSI lacks
  [1, 4], // purple  (red·blue)    — distinct cool-magenta
  [3, 4], // slate   (yellow·blue) — desaturated blue-green, far from all hues
  [1, 2], // olive   (red·green)   — warm amber-brown
];

function buildPreviewCandidates(): Candidate[] {
  const out: Candidate[] = [];
  for (const idx of PICKER_ANSI_INDICES) {
    out.push({ key: `${idx}`, label: `${idx} ${ANSI_NAMES[idx]}`, kind: "current", source: (p) => p.ansi[idx] });
  }
  for (const [a, b] of PREVIEW_BLENDS) {
    out.push({
      key: `${a}+${b}`,
      label: `${a}+${b} ${ANSI_NAMES[a]}·${ANSI_NAMES[b]}`,
      kind: "blend",
      source: (p) => blendHex(p.ansi[a], p.ansi[b], 0.5),
    });
  }
  return out;
}

function buildCandidates(): Candidate[] {
  const out: Candidate[] = [];

  // Lever 0 (baseline): the current 6 standard hues.
  for (const idx of PICKER_ANSI_INDICES) {
    out.push({
      key: `${idx}`,
      label: `${idx} ${ANSI_NAMES[idx]}`,
      kind: "current",
      source: (p) => p.ansi[idx],
    });
  }

  // Lever A: bright variants 9..14.
  for (const idx of BRIGHT_INDICES) {
    out.push({
      key: `${idx}`,
      label: `${idx} ${ANSI_NAMES[idx]}`,
      kind: "bright",
      source: (p) => p.ansi[idx],
    });
  }

  // Lever B: 50/50 two-hue blends of standard hues (orange, teal, etc.).
  for (const [a, b] of buildBlendPairs()) {
    out.push({
      key: `${a}+${b}`,
      label: `${a}+${b} ${ANSI_NAMES[a]}·${ANSI_NAMES[b]}`,
      kind: "blend",
      source: (p) => blendHex(p.ansi[a], p.ansi[b], 0.5),
    });
  }

  return out;
}

// ── Replicate the real tint pipeline (themes.ts computeRowTints, per candidate) ─
// computeRowTints only iterates PICKER_ANSI_INDICES + 8, so we replicate its exact
// steps here for arbitrary candidate source colors. Steps mirror themes.ts:233-238.

const SATURATE_FACTOR = 1.5;
const BASE_RATIO = 0.14;
const SELECTED_RATIO = 0.32;

function tintFor(sourceHex: string, bg: string) {
  const fg = saturateHex(sourceHex, SATURATE_FACTOR);
  return {
    base: blendHex(fg, bg, BASE_RATIO),
    selected: blendHex(fg, bg, SELECTED_RATIO),
    /** full-saturation source = the window-row left border color */
    border: sourceHex,
  };
}

// ── Per-theme analysis ───────────────────────────────────────────────────────

const DEDISTINCT = { collapsed: 1.0, risky: 2.0 }; // ΔE thresholds
const BORDER_MIN_CONTRAST = 3.0;  // WCAG AA for UI components / large graphics
const TEXT_MIN_CONTRAST = 4.5;    // WCAG AA for normal text on the row tint

type CandidateResult = {
  cand: Candidate;
  selectedTint: string;
  baseTint: string;
  borderColor: string;          // raw full-saturation border
  borderContrast: number;       // raw border vs bg
  borderAdjusted: string;       // border after contrast auto-adjust ("use 1")
  borderAdjustedContrast: number;
  textContrast: number;         // theme fg vs base tint
  nearestKey: string | null;    // nearest OTHER candidate by ΔE
  nearestDelta: number;         // ΔE to that nearest candidate
};

type ThemeResult = {
  id: string;
  name: string;
  category: string;
  bg: string;
  fg: string;
  candidates: CandidateResult[];
};

function analyzeTheme(theme: (typeof THEMES)[number], candidates: Candidate[]): ThemeResult {
  const bg = theme.palette.background;
  const fg = theme.palette.foreground;

  const isDark = theme.category === "dark";
  const rows = candidates.map((cand) => {
    const src = cand.source(theme.palette);
    const t = tintFor(src, bg);
    const adjusted = adjustBorderForContrast(t.border, bg, isDark, BORDER_MIN_CONTRAST);
    return {
      cand,
      selectedTint: t.selected,
      baseTint: t.base,
      borderColor: t.border,
      borderContrast: contrastRatio(t.border, bg),
      borderAdjusted: adjusted,
      borderAdjustedContrast: contrastRatio(adjusted, bg),
      textContrast: contrastRatio(fg, t.base),
    };
  });

  // nearest-neighbor ΔE on the selected-state tint (best-case distinctness)
  const candResults: CandidateResult[] = rows.map((r, i) => {
    let nearestKey: string | null = null;
    let nearestDelta = Infinity;
    for (let j = 0; j < rows.length; j++) {
      if (j === i) continue;
      const d = deltaEOklab(r.selectedTint, rows[j].selectedTint);
      if (d < nearestDelta) { nearestDelta = d; nearestKey = rows[j].cand.key; }
    }
    return { ...r, nearestKey, nearestDelta };
  });

  return {
    id: theme.id,
    name: theme.name,
    category: theme.category,
    bg, fg,
    candidates: candResults,
  };
}

// ── HTML report ──────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function deltaClass(d: number): string {
  if (d < DEDISTINCT.collapsed) return "bad";
  if (d < DEDISTINCT.risky) return "warn";
  return "ok";
}
function contrastClass(c: number, min: number): string {
  if (c < min) return "bad";
  if (c < min * 1.3) return "warn";
  return "ok";
}

function candCell(r: CandidateResult): string {
  // swatch = how the selected row actually looks (tint), with fg text on it,
  // and a left border in the full-saturation color (mirrors window-row).
  const dCls = deltaClass(r.nearestDelta);
  const bCls = contrastClass(r.borderContrast, BORDER_MIN_CONTRAST);
  const tCls = contrastClass(r.textContrast, TEXT_MIN_CONTRAST);
  return `
    <td class="cand kind-${r.cand.kind}">
      <div class="swatch" style="background:${r.selectedTint};border-left:6px solid ${r.borderColor}">
        <span class="swlabel">${esc(r.cand.label)}</span>
      </div>
      <div class="metrics">
        <span class="m ${dCls}" title="OKLab ΔE to nearest other swatch (${esc(r.nearestKey ?? "—")})">ΔE ${r.nearestDelta.toFixed(1)}</span>
        <span class="m ${bCls}" title="WCAG contrast: border vs bg (min ${BORDER_MIN_CONTRAST})">▮ ${r.borderContrast.toFixed(1)}</span>
        <span class="m ${tCls}" title="WCAG contrast: text vs base tint (min ${TEXT_MIN_CONTRAST})">T ${r.textContrast.toFixed(1)}</span>
      </div>
    </td>`;
}

function themeSection(tr: ThemeResult): string {
  const byKind = (k: CandidateKind) => tr.candidates.filter((c) => c.cand.kind === k);
  const group = (title: string, k: CandidateKind) => `
    <div class="group">
      <h3>${title}</h3>
      <table><tr>${byKind(k).map(candCell).join("")}</tr></table>
    </div>`;
  return `
  <section class="theme ${tr.category}">
    <header>
      <span class="dot" style="background:${tr.bg};border:1px solid ${tr.fg}"></span>
      <h2>${esc(tr.name)}</h2>
      <code>${esc(tr.category)} · bg ${tr.bg} · fg ${tr.fg}</code>
    </header>
    ${group("Current (1–6)", "current")}
    ${group("Lever A — brights (9–14)", "bright")}
    ${group("Lever B — two-hue blends", "blend")}
  </section>`;
}

/** Cross-theme summary: for each candidate, the WORST (min) ΔE and contrast across
 *  all themes — i.e. "is this swatch safe everywhere?" A universal palette can only
 *  use candidates whose worst-case still clears the thresholds. */
function crossThemeSummary(results: ThemeResult[], candidates: Candidate[]): string {
  const rows = candidates.map((cand) => {
    let minDelta = Infinity, minBorder = Infinity, minText = Infinity;
    let worstDeltaTheme = "";
    for (const tr of results) {
      const cr = tr.candidates.find((c) => c.cand.key === cand.key)!;
      if (cr.nearestDelta < minDelta) { minDelta = cr.nearestDelta; worstDeltaTheme = tr.name; }
      minBorder = Math.min(minBorder, cr.borderContrast);
      minText = Math.min(minText, cr.textContrast);
    }
    return { cand, minDelta, minBorder, minText, worstDeltaTheme };
  });
  rows.sort((a, b) => b.minDelta - a.minDelta); // safest first

  const tr = (r: (typeof rows)[number]) => `
    <tr class="kind-${r.cand.kind}">
      <td>${esc(r.cand.label)}</td>
      <td class="num ${deltaClass(r.minDelta)}">${r.minDelta.toFixed(1)}</td>
      <td class="num">${esc(r.worstDeltaTheme)}</td>
      <td class="num ${contrastClass(r.minBorder, BORDER_MIN_CONTRAST)}">${r.minBorder.toFixed(1)}</td>
      <td class="num ${contrastClass(r.minText, TEXT_MIN_CONTRAST)}">${r.minText.toFixed(1)}</td>
    </tr>`;

  return `
  <section class="summary">
    <h2>Cross-theme worst case <small>(can this swatch be in a universal palette?)</small></h2>
    <p>For each candidate, the minimum across all ${results.length} themes. A swatch is
       <b>universally safe</b> only if its worst-case ΔE ≥ ${DEDISTINCT.risky},
       border contrast ≥ ${BORDER_MIN_CONTRAST}, text contrast ≥ ${TEXT_MIN_CONTRAST}.</p>
    <table class="summary-table">
      <thead><tr>
        <th>candidate</th><th>min ΔE</th><th>worst in</th>
        <th>min border⬌bg</th><th>min text⬌tint</th>
      </tr></thead>
      <tbody>${rows.map(tr).join("")}</tbody>
    </table>
  </section>`;
}

// ── Per-theme palette PREVIEW (default) ──────────────────────────────────────
// Renders each theme as a mini sidebar: a stack of rows tinted with the preview
// palette (current 6 + top blends), exactly as the real sidebar paints them —
// selected-state tint background, full-saturation left border, fg text. Shown
// twice side by side: RAW borders and contrast-AUTO-ADJUSTED borders, so the
// guardrail's effect is visible by eye before it touches computeRowTints.

function previewRow(r: CandidateResult, fg: string, useAdjusted: boolean): string {
  const border = useAdjusted ? r.borderAdjusted : r.borderColor;
  const ratio = useAdjusted ? r.borderAdjustedContrast : r.borderContrast;
  const wasNudged = useAdjusted && r.borderAdjusted !== r.borderColor;
  const dCls = deltaClass(r.nearestDelta);
  const cCls = contrastClass(ratio, BORDER_MIN_CONTRAST);
  return `
    <div class="prow kind-${r.cand.kind}" style="background:${r.selectedTint};border-left:8px solid ${border};color:${fg}">
      <span class="plabel">${esc(r.cand.label)}</span>
      <span class="pmeta">
        <span class="m ${dCls}" title="ΔE to nearest swatch (${esc(r.nearestKey ?? "—")})">ΔE${r.nearestDelta.toFixed(1)}</span>
        <span class="m ${cCls}" title="border⬌bg contrast">▮${ratio.toFixed(1)}${wasNudged ? "↑" : ""}</span>
      </span>
    </div>`;
}

function previewTheme(tr: ThemeResult): string {
  const col = (useAdjusted: boolean, title: string) => `
    <div class="pcol">
      <div class="pcol-h">${title}</div>
      <div class="sidebar" style="background:${tr.bg}">
        ${tr.candidates.map((c) => previewRow(c, tr.fg, useAdjusted)).join("")}
      </div>
    </div>`;
  const anyNudged = tr.candidates.some((c) => c.borderAdjusted !== c.borderColor);
  return `
  <section class="ptheme ${tr.category}">
    <header>
      <span class="dot" style="background:${tr.bg};border:1px solid ${tr.fg}"></span>
      <h2>${esc(tr.name)}</h2>
      <code>${esc(tr.category)} · bg ${tr.bg}</code>
      ${anyNudged ? `<span class="badge">contrast-nudged ↑</span>` : ``}
    </header>
    <div class="pcols">
      ${col(false, "raw border")}
      ${col(true, "contrast auto-adjusted (use 1)")}
    </div>
  </section>`;
}

function renderPreviewHtml(results: ThemeResult[], candidates: Candidate[]): string {
  const nBlend = candidates.filter((c) => c.kind === "blend").length;
  return `<!doctype html><html><head><meta charset="utf-8">
<title>Swatch palette preview</title>
<style>
  :root { color-scheme: dark; }
  body { font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; background:#0d0d10; color:#d8d8de; margin:0; padding:24px; }
  h1 { font-size:18px; } h2 { font-size:14px; margin:0; }
  .legend { background:#15151a; border:1px solid #2a2a33; border-radius:8px; padding:12px 16px; margin:14px 0 24px; max-width:900px; }
  .legend code { background:#222; padding:1px 5px; border-radius:3px; }
  .pill { display:inline-block; padding:1px 7px; border-radius:10px; font-size:11px; }
  .pill.ok{background:#16361f;color:#7ee29a} .pill.warn{background:#3a3216;color:#e8cf72} .pill.bad{background:#3a1a1a;color:#f08a8a}
  .ptheme { border:1px solid #23232b; border-radius:10px; padding:12px 16px 16px; margin-bottom:16px; background:#101015; }
  .ptheme header { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
  .ptheme header code { opacity:.5; font-size:11px; }
  .badge { font-size:10px; background:#3a3216; color:#e8cf72; padding:1px 7px; border-radius:10px; }
  .dot { width:16px; height:16px; border-radius:4px; display:inline-block; }
  .pcols { display:flex; gap:24px; flex-wrap:wrap; }
  .pcol-h { font-size:10px; text-transform:uppercase; letter-spacing:.05em; opacity:.5; margin-bottom:5px; }
  .sidebar { width:320px; border-radius:8px; padding:5px; display:flex; flex-direction:column; gap:3px; }
  .prow { height:30px; border-radius:5px; display:flex; align-items:center; justify-content:space-between; padding:0 9px; box-sizing:border-box; }
  .plabel { font-size:12px; }
  .kind-blend .plabel { font-style:italic; }
  .pmeta { display:flex; gap:5px; }
  .m { font-size:9.5px; padding:0 5px; border-radius:4px; background:rgba(0,0,0,.35); line-height:16px; }
  .m.ok{color:#9ff0b5} .m.warn{color:#f0d98a} .m.bad{color:#f5a0a0}
</style></head><body>
<h1>Swatch palette preview — current 6 + ${nBlend} blends, across ${results.length} themes</h1>
<div class="legend">
  Each block is one theme rendered as a mini sidebar. Left column = <b>raw</b> full-saturation borders;
  right column = borders after the <b>contrast auto-adjust</b> guardrail (nudge L until border⬌bg ≥ ${BORDER_MIN_CONTRAST}).
  Per row: <span class="m ok">ΔE</span> OKLab distance to the nearest other swatch
  (<code>&lt;${DEDISTINCT.collapsed}</code> collapsed / <code>&lt;${DEDISTINCT.risky}</code> risky / else distinct);
  <span class="m ok">▮</span> border contrast (<code>↑</code> = was nudged).
  <i>Blends are italic.</i> Judge by eye: are the blend rows clearly distinct from the 6, and does the nudge fix low-contrast borders without spoiling the color?
</div>
${results.map(previewTheme).join("\n")}
</body></html>`;
}

function renderHtml(results: ThemeResult[], candidates: Candidate[]): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<title>Swatch color audit</title>
<style>
  :root { color-scheme: dark; }
  body { font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
         background:#0d0d10; color:#d8d8de; margin:0; padding:24px; }
  h1 { font-size:18px; } h2 { font-size:15px; margin:0; }
  h3 { font-size:12px; opacity:.7; font-weight:600; margin:12px 0 6px; text-transform:uppercase; letter-spacing:.04em; }
  .legend { background:#15151a; border:1px solid #2a2a33; border-radius:8px; padding:12px 16px; margin:16px 0 28px; }
  .legend code { background:#222; padding:1px 5px; border-radius:3px; }
  .pill { display:inline-block; padding:1px 7px; border-radius:10px; font-size:11px; margin-right:6px; }
  .pill.ok{background:#16361f;color:#7ee29a} .pill.warn{background:#3a3216;color:#e8cf72} .pill.bad{background:#3a1a1a;color:#f08a8a}
  section.theme { border:1px solid #23232b; border-radius:10px; padding:14px 18px; margin-bottom:18px; background:#121217; }
  section.theme header { display:flex; align-items:center; gap:10px; margin-bottom:6px; }
  section.theme header code { opacity:.55; font-size:11px; }
  .dot { width:16px; height:16px; border-radius:4px; display:inline-block; }
  .group table { border-collapse:separate; border-spacing:8px 0; }
  td.cand { vertical-align:top; }
  .swatch { width:150px; height:40px; border-radius:6px; display:flex; align-items:center; padding:0 8px; box-sizing:border-box; overflow:hidden; }
  .swlabel { font-size:11px; white-space:nowrap; text-overflow:ellipsis; overflow:hidden; }
  .metrics { display:flex; gap:5px; margin-top:4px; }
  .m { font-size:10px; padding:1px 5px; border-radius:4px; background:#1c1c22; }
  .m.ok{color:#7ee29a} .m.warn{color:#e8cf72} .m.bad{color:#f08a8a; background:#2a1414}
  .kind-blend .swlabel { font-style:italic; }
  .summary { border:1px solid #2a3a4a; border-radius:10px; padding:14px 18px; margin-bottom:24px; background:#0f1620; }
  .summary small{opacity:.5;font-weight:400}
  .summary-table { border-collapse:collapse; width:100%; margin-top:10px; }
  .summary-table th, .summary-table td { text-align:left; padding:4px 10px; border-bottom:1px solid #1d2530; }
  .summary-table td.num { text-align:right; font-variant-numeric:tabular-nums; }
  td.ok{color:#7ee29a} td.warn{color:#e8cf72} td.bad{color:#f08a8a}
  tr.kind-blend td:first-child{font-style:italic}
</style></head><body>
<h1>Swatch color audit — ${results.length} themes × ${candidates.length} candidates</h1>
<div class="legend">
  Each swatch shows the <b>selected-state row tint</b> (background) with a <b>full-saturation left border</b>
  (mirrors the window-row 8px border) and theme foreground text on it — exactly how it renders in the sidebar.
  Metrics per swatch:
  <span class="pill ok">ΔE n.n</span> OKLab perceptual distance to the <i>nearest other</i> swatch
    (<code>&lt;${DEDISTINCT.collapsed}</code> collapsed, <code>&lt;${DEDISTINCT.risky}</code> risky, else distinct).
  <span class="pill ok">▮ n.n</span> WCAG contrast of the border vs bg (min ${BORDER_MIN_CONTRAST}).
  <span class="pill ok">T n.n</span> WCAG contrast of text vs the base tint (min ${TEXT_MIN_CONTRAST}).
  Green = good, yellow = borderline, red = fails.
</div>
${crossThemeSummary(results, candidates)}
${results.map(themeSection).join("\n")}
</body></html>`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const outArg = process.argv.indexOf("--out");
  const outPath = outArg >= 0 ? process.argv[outArg + 1] : "/tmp/swatch-audit/index.html";

  // Default = per-theme palette preview (curated current 6 + top blends).
  // --full = the exhaustive 27-candidate report (all brights + all 15 blends).
  const full = process.argv.includes("--full");
  const candidates = full ? buildCandidates() : buildPreviewCandidates();
  const results = THEMES.map((t) => analyzeTheme(t, candidates));
  const html = full ? renderHtml(results, candidates) : renderPreviewHtml(results, candidates);

  writeFileSync(outPath, html, "utf8");
  // stdout contract: the report path, nothing else of consequence.
  process.stdout.write(outPath + "\n");

  // also a terse console summary so a CLI-only run is still useful
  const additions = candidates.filter((c) => c.kind !== "current");
  const total = additions.length;
  let avgDistinct90 = 0; // additions distinct (ΔE≥risky) on ≥90% of themes
  for (const cand of additions) {
    const deltas = results.map((r) => r.candidates.find((c) => c.cand.key === cand.key)!.nearestDelta);
    const pctDistinct = deltas.filter((d) => d >= DEDISTINCT.risky).length / results.length;
    if (pctDistinct >= 0.9) avgDistinct90++;
  }
  const nudgedThemes = results.filter((r) =>
    r.candidates.some((c) => c.borderAdjusted !== c.borderColor)).length;
  process.stderr.write(
    `mode=${full ? "full" : "preview"} themes=${results.length} additions=${total}\n` +
    `additions distinct on ≥90% of themes: ${avgDistinct90}/${total}\n` +
    `themes needing a contrast nudge: ${nudgedThemes}/${results.length}\n`,
  );
}

main();
