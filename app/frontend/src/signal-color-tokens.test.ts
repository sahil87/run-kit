import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PR_STATE_COLORS,
  PR_CHECKS_COLORS,
  PR_REVIEW_COLORS,
  PHASE_HUE,
  prGlyphColor,
} from "./components/pr-status-model";
import { makeWindow } from "@/test-utils/fixtures";

// 260811-m3f3: the four signal hues are theme tokens (`--color-signal-*`),
// defined exactly like `--color-accent-green` — in the `@theme` defaults plus
// both `html[data-theme]` blocks. Dark values MUST equal the legacy Tailwind
// -400 hexes (dark stays pixel-identical); light values are the darker,
// ≥3:1-contrast set. This test pins both the token definitions and the
// `pr-status-model.ts` vocabulary (the single edit point every surface
// inherits from).

// Vitest runs with cwd = app/frontend (the just recipe cds there); jsdom
// rewrites import.meta.url, so anchor the read to the process cwd.
const css = readFileSync(resolve(process.cwd(), "src/globals.css"), "utf8");

/** Extract the `{ ... }` body of the block starting at `header`. */
function blockBody(header: string): string {
  const start = css.indexOf(header);
  expect(start, `block ${header} exists`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  expect(open, `block ${header} has an opening brace`).toBeGreaterThan(start);
  const close = css.indexOf("\n}", open);
  expect(close, `block ${header} has a closing brace`).toBeGreaterThan(open);
  return css.slice(open, close);
}

const SIGNAL_TOKENS = ["yellow", "purple", "blue", "red"] as const;

const DARK_HEX: Record<(typeof SIGNAL_TOKENS)[number], string> = {
  yellow: "#facc15", // legacy yellow-400 — dark pixel-identical
  purple: "#c084fc", // legacy purple-400
  blue: "#60a5fa", // legacy blue-400
  red: "#f87171", // legacy red-400
};

const LIGHT_HEX: Record<(typeof SIGNAL_TOKENS)[number], string> = {
  yellow: "#b07d02", // custom gold — ≥3:1 on all three light backgrounds
  purple: "#9333ea", // purple-600
  blue: "#2563eb", // blue-600
  red: "#dc2626", // red-600
};

describe("globals.css signal color tokens", () => {
  it("defines all four tokens in the @theme block with the legacy (dark) hexes", () => {
    const body = blockBody("@theme");
    for (const name of SIGNAL_TOKENS) {
      expect(body).toContain(`--color-signal-${name}: ${DARK_HEX[name]};`);
    }
  });

  it("defines all four tokens in the dark theme block with the legacy hexes (pixel-identical)", () => {
    const body = blockBody('html[data-theme="dark"]');
    for (const name of SIGNAL_TOKENS) {
      expect(body).toContain(`--color-signal-${name}: ${DARK_HEX[name]};`);
    }
  });

  it("defines all four tokens in the light theme block with the darker light-theme hexes", () => {
    const body = blockBody('html[data-theme="light"]');
    for (const name of SIGNAL_TOKENS) {
      expect(body).toContain(`--color-signal-${name}: ${LIGHT_HEX[name]};`);
    }
  });

  it("has no hardcoded #facc15 outside the token definitions (waiting surfaces use the var)", () => {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const withoutTokenDefs = withoutComments.replaceAll("--color-signal-yellow: #facc15;", "");
    expect(withoutTokenDefs).not.toContain("#facc15");
  });
});

describe("pr-status-model signal vocabulary", () => {
  const RAW_SIGNAL_CLASS = /(yellow|purple|blue|red)-(300|400)/;

  it("color maps reference signal-* tokens, not raw palette classes", () => {
    for (const map of [PR_STATE_COLORS, PR_CHECKS_COLORS, PR_REVIEW_COLORS, PHASE_HUE]) {
      for (const value of Object.values(map)) {
        expect(value).not.toMatch(RAW_SIGNAL_CLASS);
      }
    }
    expect(PHASE_HUE.building).toBe("text-signal-blue");
    expect(PHASE_HUE.agent).toBe("text-signal-yellow");
    expect(PR_STATE_COLORS.merged).toBe("text-signal-purple");
    expect(PR_STATE_COLORS.closed).toBe("text-signal-red");
    expect(PR_CHECKS_COLORS.fail).toBe("text-signal-red");
    expect(PR_CHECKS_COLORS.pending).toBe("text-signal-yellow");
    expect(PR_REVIEW_COLORS.changes_requested).toBe("text-signal-red");
    expect(PR_REVIEW_COLORS.review_required).toBe("text-signal-yellow");
  });

  it("prGlyphColor returns signal-* classes for fail / pending / merged", () => {
    expect(prGlyphColor(makeWindow({ prNumber: 7, prState: "open", prChecks: "fail" }))).toBe(
      "text-signal-red",
    );
    expect(prGlyphColor(makeWindow({ prNumber: 7, prState: "open", prChecks: "pending" }))).toBe(
      "text-signal-yellow",
    );
    expect(prGlyphColor(makeWindow({ prNumber: 7, prState: "merged" }))).toBe("text-signal-purple");
  });
});
