# Intake: Light Shade — Third Rung of the Color Axis

**Change**: 260822-6dlb-light-shade-color-axis
**Created**: 2026-08-23

## Origin

Promptless dispatch (`/fab-proceed`-style create-intake, `{questioning-mode} = promptless-defer`) from a synthesized design-session description. The user reviewed the "STUDY · A THIRD SHADE" section of the picker layout design study (`assets/picker-layout-studies.html` — the 3-row band mock and the row-scale legibility stacks for orange/blue/green/slate, all rendered by the real pipeline math) and DECIDED to ship the light shade, including for slate. Implementation will not start until PR #715 (`260822-wryh-label-picker-clear-all`, this tree's branch) merges — this tree is the verified base.

> Add a third color shade — `{family}-light` — across the color axis: the mirror rung of dark (OKLCH mean-L + 0.14, same chroma/hue, gamut-reduced), stored verbatim like `-dark`, accepted by the backend validators, rendered by the themes pipeline, and presented as a third shade row in the banded Label picker (light on top). Slate ships it too (three near-neutral grays = the archive ramp). The light rung's faded/desaturated character at the gamut boundary is SEEN and accepted — it fits a recessive/secondary role.

## Why

1. **Problem**: every hue family renders in exactly two shades — normal (theme mean-L) and dark (mean-L − 0.14, stored `{family}-dark`). Two rungs give families a binary sub-grouping at most; users organizing many parallel windows under one project identity run out of within-family distinctions.
2. **The job story**: with three shades a family becomes a small **ramp** — family = project identity, shade = sub-grouping (e.g. main repo → normal, worktrees → light, archive → dark). The light rung's inherent faded character (raising L at fixed chroma sheds chroma at the sRGB gamut boundary, so light shades read washed/desaturated) FITS the recessive role — this is an accepted trade, judged by the user against the study's row-scale legibility stacks, not a defect to engineer away.
3. **If we don't**: the shade axis stays asymmetric (mean and below only) and the label space for organizing worktree/archive-style groupings stays at 20 values.
4. **Why this approach**: the dark rung already proved the whole pattern — render-time lightness offset on `PickerColor` (never a parallel pseudo-family vocabulary), verbatim `-suffix` storage with zero migration, closed-set validator growth, band-row presentation. Light is the exact mirror; every seam it needs already exists and was verified in this tree (see What Changes).

## What Changes

### 1. Shade math (`app/frontend/src/themes.ts`)

`light` = OKLCH (mean-L **+ 0.14**, same chroma, same hue), gamut-reduced via the existing `oklchToHexInGamut` (chroma-stepdown ×0.92 ≤20 steps, never channel-clamp) — the exact mirror of `DARK_SHADE_L_DELTA = 0.14` at `themes.ts:425` / `colorValueToHex` (`themes.ts:646`: `lightness = shade === "dark" ? L - DARK_SHADE_L_DELTA : L`). Slate keeps its near-neutral chroma rule (`min(C_theme × 0.2, 0.025)`) in all three shades — the deliberate gray archive ramp.

**Apply-time tuning latitude (user-delegated)**: the +0.14 delta MAY be tuned (e.g. +0.10–0.12, or a mild chroma floor for the light rung) if +0.14 proves too washed at row scale — visual judgment is delegated to apply, verified against the study's row-stack rendering approach (resting 14% tint + guarded stripe, the same math the study's `#shade-rows` stacks use). Default to the symmetric +0.14 unless row-scale rendering clearly fails.

### 2. Storage — verbatim, zero migration

`{family}-light` is stored VERBATIM (no legacy numeric form — the legacy vocabulary predates the shade axis), exactly like `-dark`, through the existing write seam: `familyToLegacy` (`themes.ts:626`) already passes every non-normal-shade value through unchanged (it only maps exact family names to legacy descriptors), so **no change to the write seam is needed** — verified. Additive; pre-existing stored values stay byte-identical.

### 3. Backend validators (`app/backend/internal/validate/validate.go` + tests)

VERIFIED mechanism: `-dark` is validated via an **enumerated closed set**, not a suffix parse — `colorFamilyNames` (validate.go:66–74) is a map built from the 10 family names plus `f+"-dark"` per family; `ValidateColorValue` (line 85) and `NormalizeColorValue` (line 132) check membership on the trimmed value (family names canonicalize to trimmed verbatim, case-sensitive). Mirror it: add `f+"-light"` in the same loop → the map grows 20 → 30 entries. That single map feeds ValidateColorValue AND NormalizeColorValue, so the `@color` window-options allowlist path (`api` → `validateWindowOption`), the session/server color handlers, and the tolerant-read paths (`internal/settings` server_colors/instance_color, tmux option readers) all accept `-light` with no further backend changes.

**Tests that currently assert `blue-light` REJECTS and must flip**: `validate_test.go:477` (invalid-values list) and `validate_test.go:565` (`"blue-light": {"", false}` normalize case) — plus new accept/normalize cases for the `-light` vocabulary.

### 4. Backend icon tint (`app/backend/internal/icontint/icontint.go` + test) — VERIFICATION FINDING, scope addition

The description's "verify nothing pattern-matches shade suffixes outside themes.ts" sweep found ONE more backend consumer: `icontint.familyHexByValue` (icontint.go:37–46) is a **frozen table** mapping every canonical color value (legacy descriptors, family names, AND `{family}-dark`) to its default-dark hex — `colorValueToHex(value, DEFAULT_DARK_THEME.palette)` frozen at the default-dark stats (L≈0.7059, C≈0.1470). Without `-light` entries, an instance-accent value of `orange-light` would resolve to NO tint (the table is the resolver). Add the 10 `{family}-light` entries computed by the same formula at mean-L + 0.14 (or the tuned delta — the frozen hexes must match whatever delta apply lands on), and flip `icontint_test.go:52`, which currently lists `"blue-light"` among the no-family values.

### 5. Frontend shade machinery (`app/frontend/src/themes.ts` + `themes.test.ts`)

All verified against the tree:

- `Shade` type (`themes.ts:417`) gains `"light"`: `"light" | "normal" | "dark"`.
- A `SHADE_LIGHT_SUFFIX = "-light"` beside `SHADE_DARK_SUFFIX` (line 420); a light L-delta constant mirroring `DARK_SHADE_L_DELTA` (line 425).
- `shadedName` (line 428) emits `{family}-light` for the light shade.
- `PICKER_COLOR_VALUES` (line 439) — VERIFIED construction: `HUE_FAMILIES.flatMap((f) => [f.name, f.name + SHADE_DARK_SUFFIX])`, i.e. family-major PAIRED order. Extend to **family-triplet order** `[f.name + SHADE_LIGHT_SUFFIX, f.name, f.name + SHADE_DARK_SUFFIX]` (light, normal, dark per family) → 20 → **30** values. Triplet order per family keeps the picker's column-flow rendering one family per column (see §6).
- `resolveShaded` (line 576 — the single parser behind `parseColorValue`/`resolveFamily`) gains the `-light` suffix branch mirroring the `-dark` branch at line 581; legacy descriptors keep resolving as `normal`.
- `colorValueToHex` (line 640): `lightness = dark ? L − Δ : light ? L + Δ : L` (with the light delta constant).
- `computeRowTints` (line 682) and `computeRowBorders` (line 735): add the light entry per family inside the existing per-family loops, keyed under the single `{family}-light` stored form (no legacy alias — same as dark). Map cardinality 31 → **41** entries (10×2 normal keys + 10 dark + 10 light + sentinel).
- **Contrast guard — VERIFIED, requirement resolves to "already satisfied + prove it"**: the description asked for a "downward twin" of a raise-only guard at threshold 2.2. That guard is the STUDY PAGE's own simplified in-page JS (`guard()` in picker-layout-studies.html:1129 — raises L only, 2.2). The REAL pipeline guard `adjustBorderForContrast` (`themes.ts:285`, threshold `BORDER_MIN_CONTRAST = 3.0`, 0.03 steps, 24-step cap) is **already bidirectional**: `isDark ⇒ push lighter; light theme ⇒ push darker` (`const step = isDark ? CONTRAST_ADJUST_STEP : -CONTRAST_ADJUST_STEP`). Light shades on light terminal themes are therefore already clamped downward by the existing mechanics via `computeRowBorders(palette, category)`. **No new guard mechanics.** The work item is TESTS: unit coverage proving a light shade's guarded border clears 3.0 on light themes (downward nudge) and on dark themes (where light shades have headroom), across the built-in light themes.
- `themes.test.ts` updates: the PAIRED-order assertion (lines 245–256, 20 values) becomes the triplet-order 30-value assertion; the shade-axis describe (line 331) gains light round-trip/resolveFamily/familyToLegacy-passthrough/L+Δ-rendering cases mirroring the dark ones; **`themes.test.ts:355` currently asserts `"blue-light"` parses to null — flips to a positive case** (keep `bluish-light`-style near-misses rejected).

### 6. Picker (`app/frontend/src/components/swatch-popover.tsx` + `swatch-popover.test.tsx`)

Verified structure and the exact deltas:

- **Band → 3 shade rows** (light on top, normal, dark — the rows ARE the lightness axis), still family-column column-flow inside the horizontal scroll strip. Today: `COLOR_ROW_NORMAL`/`COLOR_ROW_DARK` (lines 74–75) split `PICKER_COLOR_VALUES` by even/odd index; with triplet order these become index-mod-3 slices (`i % 3 === 0/1/2` → light/normal/dark rows). The strip's grid (line 529) `grid-rows-[18px_18px]` → `grid-rows-[18px_18px_18px]` — the one-time **+21px** panel height (18px cell + 3px gap; cell geometry constants at line 63).
- **Keyboard grid** (line 232): rows become `[− ✕] · [color −] · light row · normal row · dark row · …` — every row below the color band shifts down by one. Initial-focus mapping (lines 258–264: normal → row 2, dark → row 3, uncolored → header −) gains the light row and re-indexes (light 2, normal 3, dark 4).
- **Count tests grow by 10**: `swatch-popover.test.tsx:71` "color-only variant: 20 swatches …" → 30; line 200 paired-order/`toHaveLength(20)` → triplet-order/30; line 406 "full variant: … = 45 options" → 55; line 429 "2-shade-row column-flow strip" → 3-shade-row; keyboard tests referencing concrete rows/columns (e.g. line 706 "magenta — normal row, family column 9", the ArrowRight-20 walk at line 724) re-index.
- **Untouched**: the band's scroll model, header −, panel − clear-all (PR #715's mechanics), marker/flair bands, dismissal model, composite preview mechanics (light-selected previews work through the tint/border maps automatically).

### 7. Rows / sidebar — no component changes (VERIFIED)

`window-row`/`session-row`/`server-panel` look up the RAW stored value in the `computeRowTints`/`computeRowBorders` maps threaded from `sidebar/index.tsx`; nothing outside themes.ts pattern-matches shade suffixes in the frontend (the only other frontend `-dark` hits are theme IDs like `default-dark` in theme-context.tsx — unrelated). Backend: `settings.go`'s `-dark` hit is the `default-dark` theme ID; the ONLY substantive extra consumer is icontint (§4).

### 8. Slate ships the light rung

Like every family — three near-neutral grays = the archive ramp. Deliberate user call after seeing the study's slate stack. No slate special-casing anywhere (its chroma rule already applies per-family, not per-shade).

### 9. Docs + memory

- `docs/specs/themes.md`: the shade-axis content (owned-palette section ~line 94 and the banded-picker paragraph — "The color band is a 2-shade-row × 10-family column-flow horizontal scroll strip", lines 174–176) goes 2 shades → 3; document the light rung's faded character as an accepted trade and that the existing bidirectional guard covers light-on-light (no "downward twin" was needed — record the verified reality, correcting the study's open-flag).
- Memory at hydrate: `run-kit/ui/visual-design.md` — the shade-axis sections are explicit and dense ("Two-shade axis (normal + dark), 20 picker values", the 31-entry map counts at §§ tints/borders, the write-seam and storage-vocabulary paragraphs, § Banded Label picker) — all go three-shade/30-value/41-entry.
- `run-kit/architecture.md` — the closed-set line (architecture.md:118, § internal/validate item (3)) currently cites **`"blue-light"` as a rejecting out-of-vocabulary example** — flips to accepted vocabulary; the color-storage line (architecture.md:93, "one of three forms") gains the fourth form; the `@color` allowlist row (line 196) description likewise. (This region was flagged stale before — the marker/flair vocabularies it lists also predate the 8-marker/12-flair sets; hydrate should at minimum correct the lines this change touches.)
- The study page is already on main (`docs/wiki/picker-layout-studies.html`, shipped with #715) — **no wiki sync unless the page changes**.

### 10. Tests / e2e

- Unit: new-vocabulary coverage end to end — parse/format (themes.test.ts), store passthrough (familyToLegacy), validate/normalize (validate_test.go), icontint resolution (icontint_test.go), tint/border map keys, guard-on-light-theme cases (§5).
- Picker: band + keyboard + count updates (§6).
- e2e `app/frontend/tests/e2e/window-marker-gutter.spec.ts` — VERIFIED: it asserts no swatch counts or band geometry, but its color-persistence test (line 202, "normal shade through the legacy seam, dark shade verbatim") is the natural home for a light-shade leg (`Color orange-light` pick → `@color` persists `orange-light` verbatim); its picks use `exact: true` because of paired-name substring collisions — a light row adds `Color orange-light`, which the EXISTING `"Color orange"` exact-match already tolerates. If the spec is touched, update the sibling `window-marker-gutter.spec.md` in the same commit (constitution: Test Companion Docs).

## Affected Memory

- `run-kit/ui/visual-design`: (modify) shade axis 2 → 3 (light rung: +Δ mirror, faded-character trade, triplet-order 30 picker values, 41-entry tint/border maps, verbatim `-light` storage), banded-picker color band 3 shade rows / +21px, guard coverage note (bidirectional guard already covers light-on-light)
- `run-kit/architecture`: (modify) validate closed-set line (item (3): `-light` variants accepted; `"blue-light"` reject-example removed), color storage forms line (§ tmux `@color` — fourth form), `@color` allowlist row description; icontint library row if the table description enumerates shades

## Impact

- `app/frontend/src/themes.ts` + `themes.test.ts` — shade machinery core (§5)
- `app/frontend/src/components/swatch-popover.tsx` + `swatch-popover.test.tsx` — 3-row band, keyboard grid, counts (§6)
- `app/backend/internal/validate/validate.go` + `validate_test.go` — closed set 20 → 30 family-name entries (§3)
- `app/backend/internal/icontint/icontint.go` + `icontint_test.go` — 10 frozen `-light` hexes (§4)
- `app/frontend/tests/e2e/window-marker-gutter.spec.ts` + `.spec.md` — optional light-shade e2e leg (§10)
- `docs/specs/themes.md` — shade-axis section (§9)
- No API surface changes (the `@color`/session/server color endpoints and the options allowlist are untouched — only the shared validator's vocabulary grows). No migration. Rows/sidebar/server tiles unchanged (§7).
- Base: branch `260822-wryh-label-picker-clear-all` (PR #715) — implementation starts after #715 merges.

## Open Questions

- None (promptless dispatch — would-be questions would be recorded as deferred Unresolved rows, but none survived verification). The two VERIFY items the description embedded resolved against the tree (guard shape — already bidirectional at 3.0; `-dark` validation — enumerated closed set, mirrored), and the one open judgment (light-delta visual tuning) was explicitly delegated to apply by the user (row 9).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Light shade = OKLCH mean-L + 0.14, same chroma/hue, gamut-reduced via `oklchToHexInGamut` — exact mirror of `DARK_SHADE_L_DELTA` | User decision after reviewing the study; mechanism verified at themes.ts:425/646 | S:95 R:85 A:95 D:95 |
| 2 | Certain | `{family}-light` stored verbatim through the existing write seam; `familyToLegacy` needs NO change (verified passthrough of non-family-name values) | Verified themes.ts:626 — only exact family names map to legacy; everything else passes through | S:90 R:90 A:95 D:95 |
| 3 | Certain | Backend accepts `-light` by extending the enumerated `colorFamilyNames` map (validate.go:66–74) — suffix-parse ruled out; `blue-light` reject-assertions flip in validate_test.go:477/565 | Verified: `-dark` is an enumerated closed set, not a suffix parse; mirror it | S:90 R:90 A:95 D:95 |
| 4 | Certain | `icontint.familyHexByValue` gains 10 frozen `{family}-light` hexes (default-dark stats at +Δ) + icontint_test.go:52 flip | Verification finding — the one shade-vocabulary consumer outside themes.ts/validate.go; description's item 6 sweep mandated catching exactly this | S:70 R:80 A:90 D:85 |
| 5 | Certain | No new contrast-guard mechanics: `adjustBorderForContrast` (threshold 3.0) is already bidirectional (light themes push L DOWN); the "raise-only 2.2 guard" was the study page's own JS. Work item = tests proving light-on-light clears 3.0 | Verified themes.ts:285–297 (`step = isDark ? +0.03 : -0.03`); study HTML:1129 confirmed as the source of the raise-only claim | S:85 R:85 A:95 D:90 |
| 6 | Certain | `PICKER_COLOR_VALUES` moves from paired to family-TRIPLET order (light, normal, dark per family), 20 → 30; band rows slice by `i % 3`; keyboard rows re-index (+1 below the color band); +21px panel | Description specifies triplet order explicitly; verified current flatMap construction and grid rows; column-flow keeps one family per column only with triplet order | S:85 R:70 A:90 D:85 |
| 7 | Certain | Slate ships the light rung with no special-casing (three near-neutral grays = archive ramp) | Explicit user call after seeing the study's slate stack | S:85 R:80 A:90 D:90 |
| 8 | Certain | Rows/sidebar/server tiles need zero component changes — they read raw-value-keyed tint/border maps; sweep found no other suffix pattern-matching (theme-ID `-dark` hits are unrelated) | Verified consumers + repo-wide `-light`/`-dark` sweep | S:75 R:85 A:90 D:85 |
| 9 | Confident | Apply MAY tune the light delta (+0.10–0.12 or a mild chroma floor) if +0.14 is too washed at row scale, judged against the study's row-stack rendering; default is the symmetric +0.14; icontint's frozen hexes must match the landed delta | User explicitly delegated visual judgment to apply; bounded and easily revised, but the judgment itself is aesthetic | S:60 R:70 A:35 D:40 |
| 10 | Confident | e2e scope: extend window-marker-gutter's color-persistence test with a light-shade verbatim leg + same-commit `.spec.md`; no count/geometry e2e exists to update (verified) | Verified the spec asserts by option name, not counts; constitution requires the companion doc | S:70 R:80 A:85 D:80 |
| 11 | Confident | Hydrate corrects only the `docs/specs/themes.md` prose this change touches (shade-axis section + a guard-coverage note recording that the bidirectional guard already covers light-on-light); the study wiki page's own open-flag prose stays untouched (no wiki sync — the page ships unchanged) | Spec is the living document, the study page is a historical design record; smallest consistent edit | S:40 R:75 A:55 D:45 |

11 assumptions (8 certain, 3 confident, 0 tentative, 0 unresolved).
