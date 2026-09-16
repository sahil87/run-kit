import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FLAIR_STATES } from "@/themes";

// The compositor-only flair rule, machine-checked: every rk-flair-* keyframe
// block declares only transform/opacity (an animated background-position ticks
// style recalc on the main thread at 60/s per overlay), no animation iterates
// faster than 1s (each iteration boundary of a composited animation costs one
// main-thread frame), and the reduced-motion gate hides every named overlay.

// Vitest runs with cwd at app/frontend (import.meta.url is not file: under
// vite-node, so resolve from cwd instead).
const css = readFileSync(join(process.cwd(), "src/globals.css"), "utf8");

/** The `/* ── Flair overlays` section, up to the next section rule. */
function flairSection(): string {
  const start = css.indexOf("/* ── Flair overlays");
  const end = css.indexOf("/* ──", start + 10);
  if (start < 0 || end < 0) throw new Error("flair section markers not found");
  return css.slice(start, end);
}

/** Every @keyframes block as [name, body] (brace-matched — stops nest). */
function keyframesBlocks(text: string): Array<[string, string]> {
  const blocks: Array<[string, string]> = [];
  const re = /@keyframes ([\w-]+) \{/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const bodyStart = i;
    while (depth > 0 && i < text.length) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
      i++;
    }
    blocks.push([m[1], text.slice(bodyStart, i - 1)]);
  }
  return blocks;
}

/** Properties declared inside a keyframe block's stops. */
function declaredProps(body: string): string[] {
  const props: string[] = [];
  for (const stop of body.matchAll(/\{([^{}]*)\}/g)) {
    for (const decl of stop[1].split(";")) {
      const prop = decl.split(":")[0]?.trim();
      if (prop) props.push(prop);
    }
  }
  return props;
}

/** Duration tokens (s/ms) inside `animation`/`animation-duration` declarations. */
function animationDurations(section: string): Array<{ decl: string; seconds: number }> {
  const out: Array<{ decl: string; seconds: number }> = [];
  const code = section.replace(/\/\*.*?\*\//gs, "");
  for (const m of code.matchAll(/(?:^|[;{])\s*animation(?:-duration)?:\s*([^;]+);/g)) {
    for (const t of m[1].matchAll(/(-?\d*\.?\d+)(ms|s)\b/g)) {
      const seconds = t[2] === "ms" ? Number(t[1]) / 1000 : Number(t[1]);
      out.push({ decl: m[1].trim(), seconds });
    }
  }
  return out;
}

describe("globals.css flair compositing lint", () => {
  it("every @keyframes rk-flair-* block declares only transform/opacity", () => {
    const offenders: string[] = [];
    for (const [name, body] of keyframesBlocks(css)) {
      if (!name.startsWith("rk-flair-")) continue;
      for (const prop of declaredProps(body)) {
        if (prop !== "transform" && prop !== "opacity") {
          offenders.push(`${name}: ${prop}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no @keyframes block anywhere in the file animates background-position", () => {
    const offenders = keyframesBlocks(css)
      .filter(([, body]) => /background-position/.test(body))
      .map(([name]) => name);
    expect(offenders).toEqual([]);
  });

  it("no flair pseudo-element remains in the section (every layer is a child span)", () => {
    const code = flairSection().replace(/\/\*.*?\*\//gs, "");
    expect(code.match(/::(?:before|after)/g) ?? []).toEqual([]);
  });

  it("every animation in the flair section iterates at 1s or slower", () => {
    const tooFast = animationDurations(flairSection()).filter((d) => d.seconds < 1);
    expect(tooFast).toEqual([]);
  });

  it("the reduced-motion gate hides every named flair overlay", () => {
    const rmStart = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(rmStart).toBeGreaterThan(-1);
    const rmBlock = css.slice(rmStart, css.indexOf("\n}", rmStart));
    for (const state of FLAIR_STATES) {
      if (state === "") continue;
      const rule = new RegExp(
        `\\.rk-flair-${state}[\\s\\S]*?\\{[^}]*display:\\s*none`,
      );
      expect(rmBlock, `reduced-motion rule for .rk-flair-${state}`).toMatch(rule);
    }
  });
});
