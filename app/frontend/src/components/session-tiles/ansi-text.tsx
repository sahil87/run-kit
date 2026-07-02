import { useMemo } from "react";
import Anser from "anser";
import { useTheme } from "@/contexts/theme-context";
import type { ThemePalette } from "@/themes";

/**
 * Renders a tmux `capture-pane -e` snapshot (raw ANSI text) as colored,
 * attribute-styled React spans — the tile-grid pane preview. Colors are mapped
 * to the ACTIVE THEME's 16-color ANSI palette (`palette.ansi`), the same source
 * xterm.js uses for the live terminal, so a preview matches its window's live
 * colors and follows theme switches. 256-color and truecolor SGR codes (which
 * Claude Code emits) fall back to computed literal colors.
 *
 * Rendered as structured spans (never `dangerouslySetInnerHTML`): the pane text
 * is untrusted, and anser's class mode gives us tokens we style ourselves, so no
 * capture byte is ever interpreted as markup.
 */

// anser's basic color class → palette.ansi index (0-7 normal, 8-15 bright).
const ANSI_CLASS_INDEX: Record<string, number> = {
  "ansi-black": 0,
  "ansi-red": 1,
  "ansi-green": 2,
  "ansi-yellow": 3,
  "ansi-blue": 4,
  "ansi-magenta": 5,
  "ansi-cyan": 6,
  "ansi-white": 7,
  "ansi-bright-black": 8,
  "ansi-bright-red": 9,
  "ansi-bright-green": 10,
  "ansi-bright-yellow": 11,
  "ansi-bright-blue": 12,
  "ansi-bright-magenta": 13,
  "ansi-bright-cyan": 14,
  "ansi-bright-white": 15,
};

// The 6×6×6 color cube steps used by xterm-256 indices 16–231.
const CUBE_STEPS = [0, 95, 135, 175, 215, 255];

function toHex(n: number): string {
  return n.toString(16).padStart(2, "0");
}

/** Convert an xterm-256 palette index to a hex color. Indices 0–15 fold back
 *  to the theme palette (so themed panes stay themed); 16–231 are the 6×6×6
 *  cube; 232–255 are the 24-step grayscale ramp. Exported for unit tests. */
export function palette256(n: number, palette: ThemePalette): string {
  if (n < 16) return palette.ansi[n];
  if (n < 232) {
    const i = n - 16;
    const r = CUBE_STEPS[Math.floor(i / 36) % 6];
    const g = CUBE_STEPS[Math.floor(i / 6) % 6];
    const b = CUBE_STEPS[i % 6];
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }
  const v = 8 + (n - 232) * 10;
  return `#${toHex(v)}${toHex(v)}${toHex(v)}`;
}

/** Map one anser color field (a class string) + its truecolor sidecar to a CSS
 *  color, or undefined when the token carries no color. Exported for unit tests. */
export function classToColor(
  cls: string | null,
  truecolor: string | null,
  palette: ThemePalette,
): string | undefined {
  if (!cls) return undefined;
  if (cls === "ansi-truecolor") {
    // anser reports truecolor as "r, g, b"; guard against a malformed value.
    return truecolor ? `rgb(${truecolor})` : undefined;
  }
  const basic = ANSI_CLASS_INDEX[cls];
  if (basic !== undefined) return palette.ansi[basic];
  const m = /^ansi-palette-(\d+)$/.exec(cls);
  if (m) {
    const n = Number(m[1]);
    if (n >= 0 && n <= 255) return palette256(n, palette);
  }
  return undefined;
}

export function AnsiText({ text }: { text: string }) {
  const { theme } = useTheme();
  const palette = theme.palette;

  const spans = useMemo(() => {
    // use_classes: emit color CLASSES (ansi-red, ansi-palette-208, …) that we
    // map to the theme palette, instead of anser's own hardcoded hex colors.
    // remove_empty: drop the zero-width tokens anser emits around resets.
    const tokens = Anser.ansiToJson(text, {
      use_classes: true,
      remove_empty: true,
    });
    return tokens.map((t, i) => {
      const reverse = t.decorations?.includes("reverse") || t.decoration === "reverse";
      let fg = classToColor(t.fg, t.fg_truecolor ?? null, palette);
      let bg = classToColor(t.bg, t.bg_truecolor ?? null, palette);
      // Inverse video: swap fg/bg, defaulting to the pane's own fg/bg when a
      // side is unset (matching how a terminal renders SGR 7).
      if (reverse) {
        const f = fg ?? palette.foreground;
        const b = bg ?? palette.background;
        fg = b;
        bg = f;
      }
      const decos = t.decorations ?? [];
      const style: React.CSSProperties = {};
      if (fg) style.color = fg;
      if (bg) style.backgroundColor = bg;
      if (decos.includes("bold")) style.fontWeight = 700;
      if (decos.includes("dim")) style.opacity = 0.6;
      if (decos.includes("italic")) style.fontStyle = "italic";
      const lines: string[] = [];
      if (decos.includes("underline")) lines.push("underline");
      if (decos.includes("strikethrough")) lines.push("line-through");
      if (lines.length) style.textDecoration = lines.join(" ");
      return (
        <span key={i} style={style}>
          {t.content}
        </span>
      );
    });
  }, [text, palette]);

  return <>{spans}</>;
}
