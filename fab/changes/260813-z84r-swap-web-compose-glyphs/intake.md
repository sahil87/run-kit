# Intake: Swap Web Surface Glyph and Compose Chip Face

**Change**: 260813-z84r-swap-web-compose-glyphs
**Created**: 2026-08-13

## Origin

Promptless dispatch (`/fab-proceed` create-new path) from a synthesized user conversation. The user reviewed two rounds of visual icon-study mocks rendered in their own browser and confirmed both final glyph choices before this intake was created.

> Swap two UI glyphs — the right-rail Web surface glyph and the bottom-bar Compose chip face.
>
> 1. On the terminal route's right rail, the icons for Terminal (`>_`) and Code (`{}`) are good, but the Web icon `◫` is "strange" and needs replacing. User-confirmed replacement: `⧉` (U+29C9, two joined squares / "twin windows").
> 2. The bottom-bar "Compose text" chip face is the literal string `>_` — byte-identical to the rail's Terminal glyph, which is confusing. User-confirmed replacement (revised mid-pipeline, superseding an earlier `I` pick): the digraph `a▏` (letter `a` + U+258F thin bar cursor) — **static** when the compose strip is off, **blinking bar** when the strip is active.

## Why

1. **Problem**: Two user-reported UI glyph issues on the terminal route:
   - The Web surface icon `◫` in the right rail reads as "strange" — it does not communicate "web page/browser" the way `>_` communicates terminal and `{}` communicates code.
   - The bottom-bar Compose chip face is the literal string `>_` — byte-identical to the rail's Terminal glyph. Two different actions (toggle the compose strip vs. open the tty surface) share one glyph, which is confusing.
2. **Consequence if unfixed**: The icon vocabulary stays ambiguous — users conflate the compose toggle with the terminal surface, and the Web rail icon fails to self-describe. Small friction, but it sits on the primary terminal route where users spend most of their time.
3. **Approach**: Text swaps at the two authoritative sources (the shared `SURFACE_GLYPH` map and the compose chip JSX), plus one small presentational addition: the compose chip's `▏` bar blinks while the strip is active (terminal-cursor metaphor), static otherwise. No semantic, aria, or layout changes. Both replacement glyphs were user-selected from rendered visual studies (two rounds plus one revision), so the choice risk is already retired.

## What Changes

### 1. Web surface glyph: `◫` → `⧉` (single source: `SURFACE_GLYPH`)

`app/frontend/src/lib/surface-layout.ts` — the `SURFACE_GLYPH` map (currently lines 138–143):

```ts
export const SURFACE_GLYPH: Record<SurfaceKind, string> = {
  tty: ">_",
  web: "◫",   // → "⧉" (U+29C9)
  chat: "⌸",
  code: "{}",
};
```

Only the `web` entry changes. `tty`, `chat`, and `code` are explicitly out of scope — the user said the rail's Terminal and Code icons are great.

All consumers pick the change up from the one map entry (verified — each renders `SURFACE_GLYPH[kind]`):
- `app/frontend/src/components/right-panel.tsx:93` (right rail)
- `app/frontend/src/components/surface-layout.tsx:653` (surface tile headers)
- `app/frontend/src/components/mobile-surface-sheet.tsx:102` (mobile surface sheet tabs)

Stale-comment sweep (same commit, doc accuracy): the doc comments enumerating the glyph set must swap `◫` → `⧉`:
- `app/frontend/src/lib/surface-layout.ts:135` (map doc comment)
- `app/frontend/src/components/right-panel.tsx:35` (component doc comment)

### 2. Compose chip face: `>_` → `a▏` (static at rest, blinking bar when active)

`app/frontend/src/components/bottom-bar.tsx`:
- Chip button face (line ~447): `&gt;_` → `a▏`, with the `▏` (U+258F, left one-eighth block) wrapped in its own `<span>` so it can animate independently of the `a`. The `aria-label="Compose text"`, `aria-pressed` wiring, `Tip` tooltip, chord chip, and click handler are all unchanged.
- **Active-state blink**: while the strip is active (`composeStripEnabled` — the same condition that already drives the accent styling and `aria-pressed`), the `▏` span carries a blink animation (terminal-cursor style: `step-end` opacity toggle, ~1.1s period). When the strip is off, the bar is static. The blink is presentational only — decorative, `aria-hidden` not required since the glyph is already the visible face and the accessible name lives in `aria-label`.
- **Reduced motion**: per the project's animation vocabulary (context.md — animations are zeroed under `prefers-reduced-motion`), the blink is disabled under `prefers-reduced-motion: reduce`; the bar stays static in both states. The animation lives as an `rk-*` utility in `globals.css` following the existing pattern.
- Compose education hint (line ~468): `<span>&gt;_ compose — type here, send to the pane</span>` → `<span>a▏ compose — type here, send to the pane</span>` — the prefix swaps to match the chip face it educates toward (static there — the hint only renders while the strip is off). All hint gating (strip off, fine pointer, `lg`+, live compose target) is unchanged.

`a▏` is a two-character digraph matching the existing `>_` / `{}` digraph family: a letter plus the thin bar cursor — "text being entered". This supersedes the earlier `I` (capital-I I-beam) pick; the user revised to `a▏` before apply started.

### 3. Test updates (tests conform to the change — Constitution Test Integrity)

- `app/frontend/src/components/right-panel.test.tsx:54` — asserts the Web tile button textContent contains `◫`; update the expectation to `⧉`. Also update the adjacent glyph-enumeration comments (lines 50–51).
- `app/frontend/src/components/bottom-bar.test.tsx` — no literal `>_` face assertion exists (verified); the `HINT_TEXT` regex (`/compose — type here, send to the pane/`, line 365) excludes the prefix and still matches. Update the three stale comments referencing the `>_` chip (lines 40, 263, 358) to say `a▏`. Add coverage for the new state-dependent face: the blink class is present on the `▏` span when `composeStripEnabled` is true and absent when false.
- `app/frontend/src/components/surface-layout.test.tsx` — asserts only the `{}` code glyph (line 367); no change needed (verified: no `◫` assertion).
- Playwright: no `.spec.ts` asserts `◫` or the compose `>_` face (verified — `compose-strip.spec.ts` targets the chip solely via `getByRole("button", { name: "Compose text" })`). No spec code changes.
- `app/frontend/tests/e2e/compose-strip.spec.md` — the companion doc's prose describes the chip as "the `>_` chip" in ~8 places (lines 5, 45, 47, 68, 78, 98, 125, 154, 179, 203); update those references to "the `a▏` chip" so the companion stays accurate. (The constitution's same-commit rule binds `.spec.ts` modifications; here the `.spec.ts` is untouched but the doc's factual description of the UI changes, so updating it is correctness, not ceremony.)
- Mobile surface sheet has no dedicated test file (verified); covered via the shared map.

### Out of scope

- Any change to the tty/chat/code glyphs, the rail's semantics, or the compose strip behavior.
- `surface-layout.tsx:126`'s `>_` "switch to terminal" affordance doc reference — that IS the tty glyph, which is unchanged.
- `docs/memory/run-kit/ui-patterns.md` glyph enumerations (lines 438, 465) — updated at hydrate, not apply.

## Affected Memory

- `run-kit/ui-patterns`: (modify) The rail/tile/sheet glyph enumerations (`>_` tty, `◫` web, `⌸` chat, `{}` code) change to `⧉` for web; the bottom-bar/compose-strip entries describing the `>_` compose chip change to `a▏` (with the active-state blink noted alongside the existing animation vocabulary).

## Impact

- **Files touched (apply)**: `app/frontend/src/lib/surface-layout.ts`, `app/frontend/src/components/bottom-bar.tsx`, `app/frontend/src/globals.css` (blink utility), `app/frontend/src/components/right-panel.test.tsx`, `app/frontend/src/components/bottom-bar.test.tsx` (comments + new blink-class assertions), comment-only touches in `app/frontend/src/components/right-panel.tsx`, prose update in `app/frontend/tests/e2e/compose-strip.spec.md`.
- **Scale**: cosmetic, low-risk; two glyph swaps, one small CSS blink utility, plus test/comment/doc conformance. No API, backend, routing, aria, or layout changes.
- **Verification**: `just test-frontend` (right-panel/bottom-bar/surface-layout unit suites) is the primary gate; e2e is unaffected by design (aria-label targeting) — `just test-e2e "compose-strip"` optional smoke.

## Open Questions

None — both glyph choices were user-confirmed from rendered visual studies, and all touch points were verified against the current source.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Web glyph is `⧉` U+29C9, changed only at the `SURFACE_GLYPH.web` entry (surface-layout.ts:140); rail/tiles/sheet inherit | Discussed — user picked `⧉` from round-1 studies over `://`, `⊕`, `◍`, `▣`, `⊞`, `▤`, `⌂`; single-source map verified in code | S:95 R:90 A:95 D:95 |
| 2 | Certain | Compose chip face is the digraph `a▏` (bottom-bar.tsx:447), static when the strip is off, blinking `▏` when active; aria-label/aria-pressed unchanged | Discussed — user revised from an earlier `I` pick to `a▏` and explicitly specified "static variant when not active, animated variant when active"; round-1 set (`⌨︎`, `✎`, `↵`, `¶`, …) rejected wholesale, round-2 alternatives (`⌶`, `‸`, `⁁`, `▏`, `█`, `⍞`…) passed over | S:95 R:90 A:95 D:90 |
| 3 | Certain | Compose education hint prefix swaps `>_` → `a▏` (bottom-bar.tsx:468), static (hint renders only while the strip is off); rest of copy and gating unchanged | Explicit in the synthesized decisions — hint must match the chip face it educates toward | S:90 R:90 A:90 D:90 |
| 4 | Certain | Tests conform to the new glyphs: right-panel.test.tsx:54 expectation `◫`→`⧉`; no other literal assertions exist (bottom-bar HINT_TEXT regex excludes the prefix; no e2e asserts either glyph) | Constitution Test Integrity; every test touch point verified by grep against current source | S:90 R:95 A:95 D:95 |
| 5 | Confident | Update compose-strip.spec.md's `>_`-chip prose to `a▏` | The companion doc factually describes the chip face; leaving it stale contradicts its purpose. (At apply, `compose-strip.spec.ts` was additionally found to carry `>_` in a test name/comments and renamed in sync — recorded in plan.md Assumptions row 4) | S:70 R:90 A:85 D:75 |
| 6 | Confident | Stale code comments enumerating the old glyphs (surface-layout.ts:135, right-panel.tsx:35, right-panel.test.tsx:50–51, bottom-bar.test.tsx:40/263/358) are updated in the same commit | Comment accuracy is standard hygiene; zero behavioral risk | S:65 R:95 A:90 D:85 |
| 7 | Confident | Change type is `fix` — remediation of two user-reported UI problems (strange icon, confusing duplicate), no new capability | Taxonomy judgment; gate threshold is flat 3.0 so type does not affect gating; pinned explicitly so refresh cannot flip it | S:60 R:90 A:75 D:65 |
| 8 | Confident | No new e2e coverage; verification is the existing unit suites (`just test-frontend`) plus the updated right-panel assertion and new blink-class unit assertions | code-quality.md says UI changes SHOULD include e2e "where possible" — a glyph swap plus a CSS class toggle is below the threshold where an e2e earns its cost; existing aria-based e2e already exercises the chip | S:60 R:85 A:80 D:70 |
| 9 | Confident | Blink implementation: `step-end` opacity animation (~1.1s, terminal-cursor style) as an `rk-*` utility in `globals.css`, applied to the `▏` span only while `composeStripEnabled`; zeroed under `prefers-reduced-motion` | User specified static-vs-animated by state; period/easing/utility placement derived from the project's existing animation vocabulary (context.md: `rk-*` utilities, reduced-motion zeroing) — conventional fill, easily adjusted | S:70 R:90 A:90 D:80 |

9 assumptions (4 certain, 5 confident, 0 tentative, 0 unresolved).
