# Intake: Expand Swatch Palette with Two-Hue Blends + Contrast Guardrail

**Change**: 260615-6rnr-expand-swatch-palette-blends
**Created**: 2026-06-15

## Origin

This change emerged from a `/fab-discuss` session exploring "how to calculate the distance between colors" for two stated reasons: (1) **validate contrast** of sidebar swatch colors, and (2) **provide better and more options** for the color popups on the left panel (the sidebar `SwatchPopover`).

The discussion established the standard tools (WCAG contrast ratio for legibility; OKLab ΔE for perceptual distinctness) and — critically — produced **empirical data** rather than guesses. A dev-time audit script (`app/frontend/scripts/audit-swatch-colors.ts`) was written to measure, across **all 70 shipped themes**, the OKLab ΔE distinctness and WCAG contrast of candidate swatch expansions, using the **real** tint pipeline imported from `themes.ts` (`computeRowTints`, `blendHex`, `saturateHex`). The audit is the design evidence backing every decision below; it is read-only, runs via `npx tsx` (like `import-theme.ts`), and ships nothing at runtime.

Interaction mode: conversational. Key decisions reached with the user during discussion:

- **Brights (ANSI 9–14) are REJECTED** — the audit confirmed they collapse onto their normal siblings (1–6) at low blend ratios, staying perceptually distinct on only ~34–46% of themes. This empirically validates the existing `themes.ts` comment (the predecessor's by-eye judgment was correct). Do NOT add them.
- **Two-hue blends are the win** — blending two ANSI palette colors 50/50 yields colors ANSI lacks (orange, purple, etc.) that stay fully theme-derived (auto-re-derive on theme switch).
- **Blend set LOCKED at 4**, chosen for *mutual* separation (the audit revealed blends crowd each other, not just the originals): orange `1+3`, purple `1+4`, slate `3+4`, olive `1+2`. Palette grows **6 → 10**. Distinct on 83–96% of themes against the full 10-color palette.
- **Rejected blends**: rosy `1+6` (collides with purple `1+4`), teal `4+6` (sits between blue `4` and cyan `6`, squeezing all three).
- **Contrast guardrail confirmed** ("use 1"): auto-adjust low-contrast borders by nudging OKLab lightness. Fires on 25/70 themes in the audit preview.
- **Scope as two independently-reviewable requirements that ship together** (user pushback-accepted): palette expansion (A) and contrast guardrail (B) are logically separable so a review failure in one does not drag the other.

A per-theme visual preview of the locked palette (raw vs. contrast-adjusted borders) was rendered and reviewed by the user via an `rk` iframe window before locking these decisions.

## Why

**Problem.** The sidebar color picker (`SwatchPopover`) offers only **6 colors** (ANSI indices 1–6: red, green, yellow, blue, magenta, cyan). Users assigning colors to servers, sessions, and windows run out of distinct options quickly — there is no orange, purple, olive, or slate, and the palette is too small to give many concurrently-colored rows visually distinct identities. Separately, on some themes the full-saturation left border that window rows draw (an 8px stripe) is too low-contrast against the theme background to be clearly visible.

**Consequence if unfixed.** Users cannot meaningfully color-code more than ~6 things; colors repeat and lose their wayfinding value (the keyboard-first, glanceable-sidebar premise of the product weakens). Low-contrast borders on certain themes make the color assignment invisible — the feature silently fails to communicate on those themes.

**Why this approach over alternatives.**
- *Why blends, not brights:* the audit proved brights collapse onto existing colors on the majority of themes (data, not opinion). Blends of two ANSI hues produce genuinely new, well-separated colors while remaining 100% palette-derived — so they auto-theme exactly like the existing 6, preserving the theme system's core property (themes.md: a swatch defined relative to the palette re-derives on theme switch with no migration).
- *Why not fixed hexes / a free hex picker:* a fixed hex would not follow the palette — it would look wrong on most themes and break the auto-theming guarantee. The user explicitly chose "stay ANSI-tied."
- *Why WCAG for contrast, OKLab for distinctness:* these are the correct, separate standards — contrast is a luminance-ratio legibility question (WCAG), distinctness is a perceptual-distance question (OKLab ΔE). Conflating them gives wrong answers (two colors can be very distinct yet fail contrast, or vice versa).
- *Why OKLab over CIEDE2000:* OKLab is far simpler (~30 lines of pure arithmetic, no trig/lookup tables — fits the project's readability-over-cleverness and dependency-light frontend) and behaves better than CIELAB in the desaturated/blended region where the tints live.
- *Note on tmux:* the row color is stored in tmux options but **tmux never renders it** (`configs/tmux/default.conf` contains zero `@color` references — verified). Coloring happens entirely in the React sidebar. So a richer stored representation (`"1+3"`) imposes no constraint on tmux; this is a pure frontend + backend-storage concern.

## What Changes

This change has **two independently-reviewable requirements** (A and B) that ship together. The audit script already exists and is referenced as design evidence; it is NOT re-created here.

### Requirement A — Palette expansion (6 → 10)

**A1. Add 4 two-hue blend swatches.** The picker gains orange (`1+3`), purple (`1+4`), slate (`3+4`), olive (`1+2`). Each blends two ANSI palette colors 50/50 via the existing `blendHex(palette.ansi[a], palette.ansi[b], 0.5)`. These are **descriptors over the palette**, not fixed hexes — they auto-re-derive on theme switch.

**A2. A swatch color value must represent a single index OR a blend.** Today a color is a single ANSI index. The chosen wire representation is a **string**: `"4"` for a single index, `"1+3"` for a blend (two indices joined by `+`). String is the natural format for tmux options (already strings) and parses unambiguously. The frontend gains a small parse/format helper (e.g. `parseColorValue("1+3") -> {a:1,b:3}` / `formatColorValue`).

**A3. Three storage paths must accept the new representation:**
- *Window color* — tmux `@color` option, already a string. Path: `app/frontend/src/api/client.ts` `setWindowColor` + backend `/options` contract. Lowest risk (string in, string out).
- *Session color* — tmux option, already a string. Path: `setSessionColor` + backend handler. Low risk.
- *Server color* — **stored as an INTEGER in `settings.yaml`** (`app/backend`), surfaced via `getAllServerColors`/`setServerColor` in `client.ts`. This is the **type-change risk**: an `int` field cannot hold `"1+3"`. The backend server-color storage MUST change to a string (or a string-or-int union with a parse layer). This is the one part touching `app/backend/` — Go tests + constitution exec/validation rules apply. Per constitution **No Database**, the value continues to live in `~/.rk/settings.yaml`; per **Uniform HTTP Verb**, the mutating endpoint stays `POST`.

**A4. `computeRowTints` accepts blend descriptors.** `app/frontend/src/themes.ts` `computeRowTints` currently iterates `PICKER_ANSI_INDICES` (integers) + `UNCOLORED_SELECTED_ANSI`. It must accept blend descriptors so the 4 new swatches get `base`/`hover`/`selected` tints computed via the same `saturate(×1.5) → blend(0.14/0.22/0.32)` pipeline. The blend's source color is `blendHex(ansi[a], ansi[b], 0.5)` *before* the saturate+blend tint steps. `PICKER_ANSI_INDICES` (today `[1,2,3,4,5,6]`) is superseded/augmented by a richer picker definition listing the 6 single indices + 4 blend pairs, in a stable display order (current 6 first, then orange, purple, slate, olive).

**A5. `SwatchPopover` grid + keyboard nav.** `app/frontend/src/components/swatch-popover.tsx` renders a 3-col grid and hardcodes `totalItems = PICKER_ANSI_INDICES.length + 1` (6 + clear). With 10 colors + clear = **11 items**, the grid reflows and the arrow-key navigation math (row/column wrap, total-item count, the index of the Clear button) must update to the new count. Keyboard reachability is a constitution **Keyboard-First** requirement — every swatch including the new blends MUST be arrow-key navigable and Enter/Space selectable.

**A6. Rendering sites consume the new descriptor.** `server-panel.tsx`, `session-row.tsx`, `window-row.tsx` read the stored color and look up the tint from the `rowTints` map. They must key on the new descriptor (string) rather than a bare integer. The full-saturation border color for a blend is `blendHex(ansi[a], ansi[b], 0.5)`.

### Requirement B — Contrast guardrail (independently reviewable / revertible)

**B1. Auto-adjust low-contrast borders.** When a swatch's full-saturation border color fails **WCAG 3.0** contrast against the theme background, nudge its **OKLab lightness** (lighten on dark themes, darken on light) in small steps until it clears 3.0 or hits a cap (~24 steps in the audit reference). **Preserve hue and chroma — only L moves** — so the swatch keeps its identity. The reference implementation lives in the audit script (`adjustBorderForContrast`).

**B2. New color-math helpers in `themes.ts`.** None of these exist there today; the audit script has reference implementations to port:
- `hexToOklab` / `oklabToHex` (forward + inverse OKLab, Björn Ottosson 2020 coefficients) — pure arithmetic, ~30 lines.
- `relativeLuminance` (WCAG 2.x, from linear-light sRGB — requires an sRGB→linear step) and `contrastRatio` (1..21).
- `adjustBorderForContrast(border, bg, isDark, min)`.

**B3. This is a visual change to the EXISTING 6 colors too.** The guardrail affects the current swatches on the **25/70 themes** where it fires — an intentional legibility improvement, but reviewers/users should know an existing color's border may shift on some themes (e.g. a low-contrast red border on a particular theme gets lightened). The 8px window-row left border is the primary beneficiary (it must stay visible). This is why B is scoped separately: it can be reviewed and, if undesired on aesthetic grounds, reverted independently of the palette expansion.

**B4. Independence.** A and B share `themes.ts` but are logically separable: A could ship without B (10 colors, no contrast nudge) and B without A (6 colors, nudged borders). Plan tasks SHOULD keep them in distinct requirements/phases so a review failure localizes.

### Out of scope / non-goals

- ANSI bright variants 9–14 (rejected by audit data — see Why).
- Fixed-hex swatches or a free hex picker (breaks auto-theming; user chose ANSI-tied).
- Any change to tmux config or tmux rendering (tmux never renders these colors).
- More than 4 blends (the 5th-color option was offered and declined; locked at 4).
- Changing the existing tint blend ratios (0.14/0.22/0.32) or the ×1.5 saturation.

## Affected Memory

- `run-kit/ui-patterns`: (modify) The sidebar/swatch/theme-derivation file documents the color picker, `computeRowTints`, and `PICKER_ANSI_INDICES`. Update for the 6→10 palette (blend descriptors), the new color value representation (`"1+3"`), the OKLab/WCAG helper additions, and the contrast guardrail behavior.
- `run-kit/architecture`: (modify) Only if the backend server-color storage contract changes (integer → string in `settings.yaml`) — document the new color value representation on the storage/API side.

## Impact

**Frontend (`app/frontend/src/`):**
- `themes.ts` — new picker definition (6 indices + 4 blend pairs), `computeRowTints` accepts blends, new helpers (`hexToOklab`, `oklabToHex`, `relativeLuminance`, `contrastRatio`, `adjustBorderForContrast`), color value parse/format helpers.
- `components/swatch-popover.tsx` — grid reflow + keyboard-nav math for 11 items.
- `components/sidebar/server-panel.tsx`, `session-row.tsx`, `window-row.tsx` — consume string descriptor; blend border color.
- `api/client.ts` — `setWindowColor`, `setSessionColor`, `setServerColor`, `getAllServerColors` accept/return the string representation.
- Unit tests (Vitest): `themes.test.ts` (OKLab/WCAG/blend tint math + contrast adjust), swatch-popover nav, parse/format round-trip.

**Backend (`app/backend/`):**
- Server-color storage in `settings.yaml`: integer → string (or union + parse). Handlers for session/window `/options` color and `/api/settings/server-color`. All mutations stay `POST` (Uniform HTTP Verb); CORS allowlist unchanged. `exec.CommandContext` + validation rules apply to any tmux option writes.
- Go tests (`*_test.go`) for the storage representation change.

**E2E (Playwright):** if any spec asserts swatch behavior or color counts, update it AND its `.spec.md` companion in the same commit (constitution). New swatches SHOULD get e2e coverage where practical.

**Audit script:** `app/frontend/scripts/audit-swatch-colors.ts` already exists (design evidence). It is a dev-time tool, not shipped — no runtime dependency. It MAY be kept as the regression/evidence artifact for this change.

## Open Questions

*(Both prior open questions resolved with the user during intake — see Assumptions rows 9 and 10.)*

- Server-color storage migration: **RESOLVED** — tolerant read (backend accepts `int` or `string`, always writes `string`); no separate migration step, existing settings keep working.
- Blend swatch labels: **RESOLVED** — new blends stay **unlabeled** color squares, consistent with the current 6.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Reject ANSI brights 9–14; add 4 two-hue blends (orange 1+3, purple 1+4, slate 3+4, olive 1+2); palette 6→10 | Decided with user from audit data across 70 themes (brights distinct on 34–46%, blends 83–96%); set locked after visual preview | S:98 R:75 A:95 D:95 |
| 2 | Certain | Color value wire format = string: `"4"` single index, `"1+3"` blend | tmux options are already strings; integer cannot hold a blend; string parses unambiguously and is the minimal representation | S:90 R:65 A:90 D:88 |
| 3 | Certain | Blends stay palette-derived (blendHex of two ansi indices), NOT fixed hexes | User chose "stay ANSI-tied"; preserves theme-system auto-derivation (themes.md); fixed hex would break on most themes | S:95 R:80 A:95 D:95 |
| 4 | Certain | Contrast guardrail = nudge OKLab lightness until border⬌bg ≥ WCAG 3.0, preserve hue/chroma, cap ~24 steps | User confirmed ("use 1"); reference impl exists in audit script; affects existing 6 on 25/70 themes (intentional legibility fix) | S:90 R:80 A:88 D:85 |
| 5 | Certain | Use OKLab (ΔE + L-nudge) and WCAG (ratio) as the two distinct standards; add helpers to themes.ts | Discussed and agreed; correct separation of legibility vs distinctness; OKLab simpler than CIEDE2000 and fits frontend | S:92 R:78 A:95 D:90 |
| 6 | Confident | Scope as two independently-reviewable requirements (A palette, B guardrail) shipping together | User accepted this pushback; they share themes.ts but are logically separable so a review failure localizes | S:85 R:85 A:80 D:80 |
| 7 | Confident | Server-color backend storage changes integer→string in settings.yaml (the one backend touch) | Exploration found server color stored as int via setServerColor; a blend string cannot fit; No-Database + POST constraints preserved | S:80 R:55 A:85 D:78 |
| 8 | Confident | swatch-popover grid reflows to 11 items (10 colors + clear); keyboard-nav math updates accordingly | Keyboard-First constitution requirement; current code hardcodes PICKER_ANSI_INDICES.length+1; mechanical but required | S:82 R:80 A:85 D:80 |
| 9 | Certain | Server-color migration = tolerant read (accept int or string, always write string); no separate migration step | Confirmed with user during intake; preserves existing settings.yaml values with no migration code path | S:95 R:75 A:90 D:95 |
| 10 | Certain | New blend swatches remain unlabeled (consistent with current 6), no fixed color names in UI | Confirmed with user during intake; matches the current 6 unlabeled swatches, keeps the compact grid | S:95 R:90 A:90 D:95 |

10 assumptions (7 certain, 3 confident, 0 tentative, 0 unresolved).
