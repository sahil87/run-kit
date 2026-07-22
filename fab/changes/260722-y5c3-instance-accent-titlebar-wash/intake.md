# Intake: Instance-Accent PWA Titlebar Wash (Mock Parity)

**Change**: 260722-y5c3-instance-accent-titlebar-wash
**Created**: 2026-07-22

## Origin

Promptless dispatch (create-intake subagent, `{questioning-mode} = promptless-defer`) from a feature description synthesized from a design conversation held today, in which the user reviewed the original design mock ("Per-Instance Accent — Option 6") on screen against the shipped behavior of PR #435 (`260721-1etw-instance-accent-host-color`) and explicitly confirmed the mock's composition. Decisions below are captured verbatim from that conversation — not re-derived.

> Instance-accent PWA titlebar: dim the theme-color meta to a dark wash (mock parity), revealing the 2px stripe. The merged change 260721-1etw writes the FULL contrast-guarded accent hex (`stripeHex`) into `<meta name="theme-color">`, so Chrome paints an installed PWA window's entire titlebar in the fully saturated hue — a loud color band. The mock instead tinted the titlebar with a subtle DARK BLEND of the accent into the theme background and relied on the already-implemented 2px full-brightness accent stripe at the top of the web content to provide the vivid accent line sitting directly below the titlebar. Today that stripe is invisible because it abuts a titlebar painted the identical hex. Wanted: subtle tinted titlebar + visible bright 2px line below it.

## Why

1. **Pain point**: The shipped change writes the contrast-guarded full-hue accent (`stripeHex`) into the theme-color meta — via `setAccentThemeColor(hexes.stripeHex)` in the `InstanceAccentProvider` effect (`app/frontend/src/contexts/instance-accent-context.tsx:74-82`) and the `hex` field of the `runkit-instance-color` localStorage echo consumed verbatim by the `index.html` pre-paint script. Chrome therefore paints the entire installed-PWA titlebar in the fully saturated hue: a loud color band that dominates the window chrome. Worse, the 2px accent stripe rendered in `AppLayout` (`app/frontend/src/app.tsx:209-212`) is **invisible** — it abuts a titlebar painted the identical hex, so the deliberate accent line reads as part of the titlebar.
2. **Consequence of not fixing**: Every accent-colored instance has an aggressively colored titlebar (the opposite of the subtle instance-identity channel the mock designed), and the stripe surface shipped in 1etw does no visible work. The composition diverges from the reviewed and approved design.
3. **Why this approach**: The design mock's composition — a titlebar tinted with a subtle dark blend of the accent into the theme background (the mock's cyan instance used titlebar background `#142329` ≈ a 10-15% blend of the accent into `#0f1117`; **reference values only, not to be hardcoded**), with the full-brightness 2px stripe sitting directly below it as the vivid accent line. The user explicitly confirmed this composition today. It reuses the exact `blendHex` machinery the 6.5% top-bar wash already uses — one new named ratio constant, one new derived hex, no new color scheme. **Alternative rejected (implicitly, by confirming the mock)**: keeping the saturated titlebar and instead removing/relocating the stripe — the mock's whole point is the tinted-titlebar + bright-line pairing.

## What Changes

### 1. `deriveAccentHexes` gains a third derived hex — the meta/titlebar hex

`deriveAccentHexes(value, theme)` in `app/frontend/src/instance-accent.ts` (currently returns `{ stripeHex, washHex } | null`, lines 72-83) gains a third field computed as a blend of the accent into the active theme's background:

```ts
/** Ratio of the accent blended into the theme background for the PWA titlebar
 *  (theme-color meta) tint — mock parity ≈ 12%; a taste constant, trivially tunable. */
export const INSTANCE_TITLEBAR_RATIO = 0.12; // ~0.12–0.15 band granted

// inside deriveAccentHexes:
return {
  stripeHex: adjustBorderForContrast(src, bg, theme.category === "dark", BORDER_MIN_CONTRAST),
  washHex: blendHex(src, bg, INSTANCE_WASH_RATIO),
  titlebarHex: blendHex(src, bg, INSTANCE_TITLEBAR_RATIO),
};
```

- The constant is defined next to the existing `INSTANCE_WASH_RATIO = 0.065` (`instance-accent.ts:31`), same doc-comment style.
- The exact ratio is an acknowledged taste constant within the granted ~0.12–0.15 band (mock ≈ 12%), trivially tunable.
- Theme-aware by construction: the blend derives from `theme.palette.background` via the existing `blendHex` (`themes.ts:101`), so light themes get a light-background blend. No hardcoded hexes (constitution/code-quality conformance — same rule 1etw followed).

### 2. The blended titlebar hex — NOT `stripeHex` — becomes the meta content and the echo `hex`

In `InstanceAccentProvider` (`app/frontend/src/contexts/instance-accent-context.tsx`), the bridge effect (lines 74-82) switches both writes from `hexes.stripeHex` to the new titlebar hex:

- (a) `setAccentThemeColor(hexes.titlebarHex)` — the single theme-color meta writer in `instance-accent.ts` now receives the wash-blend hex, so Chrome retints the installed-PWA titlebar to the subtle dark blend.
- (b) `writeInstanceColorEcho({ value: resolved, hex: hexes.titlebarHex })` — the echo's `hex` field carries the titlebar blend, so the `index.html` blocking pre-paint script (which applies the echoed hex **verbatim**, per the existing "Echo carries the precomputed meta hex" design decision in `fab/changes/260721-1etw-instance-accent-host-color/plan.md`) tints the titlebar with the wash on cold start **with no change to `index.html` itself**.

Doc comments referencing "stripeHex … and the theme-color meta content" (e.g., `instance-accent.ts:67-71`, `instance-accent-context.tsx:27-29`) update to reflect the split: stripe/hostname surfaces keep `stripeHex`; the meta surface takes `titlebarHex`.

Transient note: an echo written by the pre-change build still carries the full-hue hex; a cold start on the new build paints the old hex for the pre-fetch frame and self-corrects when the runtime resolution rewrites both meta and echo — the same accepted-transient class as the existing cross-mode-load note (1etw plan assumption #2). No migration needed.

### 3. Unchanged — the other surfaces and the resolution chain

- `stripeHex` (contrast-guarded full hue) stays as-is for the 2px top-bar stripe (`app.tsx:209-212`) and the HOST-panel hostname tint (`components/sidebar/host-panel.tsx`).
- `washHex` (6.5% blend, `INSTANCE_WASH_RATIO`) stays as-is for the top-bar background wash. Only the theme-color meta surface changes.
- With no accent resolved, the meta content remains the theme background (current single-writer behavior: `setAccentThemeColor(null)` → `lastBackground`) — unchanged.
- The no-default resolution chain (explicit setting → echo seed → none; hostname-hash fallback deliberately removed in commit 9864b2c) is NOT touched.
- `index.html` is NOT touched (see §2b).

### 4. Tests to update

- `app/frontend/src/instance-accent.test.ts` — `deriveAccentHexes` now returns a distinct meta/titlebar hex (extend the shape/derivation assertions at lines 53-76: titlebar hex is a valid `#rrggbb`, differs from both `stripeHex` and `washHex`, recomputes per palette); echo round-trip semantics carry the wash hex.
- `app/frontend/src/contexts/instance-accent-context.test.tsx` — the meta-content assertion currently expecting `stripeHex` (line 87-88: `expect(meta?.getAttribute("content")).toBe(screen.getByTestId("stripe").textContent)`) flips to assert the meta carries the titlebar hex and explicitly does NOT equal the stripe hex.
- No Playwright e2e touches the theme-color meta or instance-accent surfaces (verified: `grep -rn "theme-color|instance-color|instance-accent|stripeHex" app/frontend/tests/` → no matches), so unit-test coverage suffices; the existing e2e suite runs as the regression gate.

## Affected Memory

- `run-kit/ui-patterns`: (modify) instance-accent surfaces — the theme-color bridge's meta-hex derivation description (§ Theme-derived hexes, § PWA titlebar bridge, and the theme-color synchronization notes) changes from "stripeHex is … the theme-color meta content" to the three-hex split (stripe/wash/titlebar) with the new `INSTANCE_TITLEBAR_RATIO`
- `run-kit/architecture`: likely unaffected — no API change, no new endpoint, no backend impact (verify at hydrate; the architecture entry covers the settings field and endpoint pair, both untouched)

## Impact

- **Frontend-only (TS/React)**: `app/frontend/src/instance-accent.ts` (new constant + third derived hex + comment updates), `app/frontend/src/contexts/instance-accent-context.tsx` (two-line write switch + comment updates), `app/frontend/src/instance-accent.test.ts`, `app/frontend/src/contexts/instance-accent-context.test.tsx`.
- **No backend/Go impact, no API change, no new routes** (constitution Principles II/IV/IX untouched). No `index.html` change. No settings/storage change — the stored descriptor and endpoint pair are untouched; only the derived presentation hex on one surface changes.
- **Risk**: very low — a presentation-hex swap on one surface, fully covered by existing unit-test files; trivially reversible (one constant, two write sites).
- **Out of scope (explicit)**: dynamic `manifest.json` / tinted dock icons / Badging API (separate follow-up change `260722-eo8e-accent-dock-icon` already in flight in another worktree); reintroducing any default accent color; changing the stripe or wash surfaces.

## Open Questions

- None — the design conversation resolved all blocking decisions; remaining latitude is recorded as graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Titlebar/meta hex = `blendHex(src, theme.palette.background, INSTANCE_TITLEBAR_RATIO)` as a third `deriveAccentHexes` field, replacing `stripeHex` in exactly two writes: the `setAccentThemeColor` meta content and the echo's `hex` field | Discussed — decisions 1-2 captured verbatim; mechanism verified against instance-accent.ts:72-83 and instance-accent-context.tsx:74-82 | S:95 R:85 A:90 D:95 |
| 2 | Confident | Exact ratio value 0.12 (mock ≈ 12%) within the granted ~0.12–0.15 band, as named constant `INSTANCE_TITLEBAR_RATIO` beside `INSTANCE_WASH_RATIO` | Taste constant with explicit user latitude ("acknowledged taste constant, trivially tunable"); one-line reversal; mirrors 1etw's wash-ratio latitude precedent | S:70 R:95 A:60 D:65 |
| 3 | Certain | `stripeHex` (stripe + HOST hostname tint) and `washHex` (top-bar wash) unchanged; no-accent meta stays theme background; resolution chain (explicit → echo → none) untouched | Decisions 3 and 5, explicit in conversation; verified current behavior in code | S:95 R:90 A:95 D:95 |
| 4 | Certain | `index.html` unchanged — the pre-paint script applies the echoed `hex` verbatim, so swapping the echoed value retints cold start for free | Decision 2b, explicit; rests on 1etw plan's "Echo carries the precomputed meta hex" design decision, verified at index.html:29-34 | S:90 R:90 A:90 D:90 |
| 5 | Confident | Third derived-hex field named `titlebarHex` (conversation fixed the constant name pattern via "e.g. `INSTANCE_TITLEBAR_RATIO`" but not the field name) | Naming-only latitude; consistent with the constant and the existing stripe/wash naming; trivially renameable | S:55 R:95 A:85 D:70 |
| 6 | Certain | Tests: update `instance-accent.test.ts` (three-hex shape, titlebar ≠ stripe/wash, per-palette recompute) and `instance-accent-context.test.tsx` (meta = titlebar hex, ≠ stripe hex); no new e2e | Decision 6, explicit; verified no e2e asserts theme-color/accent chrome (memory: e2e-assertions-on-ui-chrome grep done); code-quality test mandate | S:85 R:90 A:90 D:85 |
| 7 | Certain | Old-build echo carrying the full-hue hex is an accepted self-correcting cold-start transient — no echo migration/versioning | Same accepted-transient class 1etw already documents for cross-mode loads (plan assumption #2); runtime rewrites echo+meta on every load by design | S:75 R:90 A:90 D:85 |
| 8 | Certain | Out of scope: dynamic manifest / dock icons / Badging API (follow-up 260722-eo8e in flight elsewhere), no default accent reintroduction, no stripe/wash surface changes | Explicit in conversation | S:95 R:90 A:95 D:95 |
| 9 | Certain | Memory: `run-kit/ui-patterns` (modify) for the meta-hex derivation; `run-kit/architecture` untouched (no API change) | Affected-memory guidance explicit in the dispatch; ui-patterns §§ verified to describe the stripeHex-as-meta behavior being changed | S:85 R:90 A:90 D:85 |

9 assumptions (7 certain, 2 confident, 0 tentative, 0 unresolved).
