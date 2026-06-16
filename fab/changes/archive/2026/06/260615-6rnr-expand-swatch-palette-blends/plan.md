# Plan: Expand Swatch Palette with Two-Hue Blends + Contrast Guardrail

**Change**: 260615-6rnr-expand-swatch-palette-blends
**Intake**: `intake.md`

## Requirements

This change has TWO independently-reviewable requirement groups (A and B) that
share `themes.ts` but are logically separable so a review failure localizes. A
is the 6→10 palette expansion; B is the WCAG contrast guardrail. Each could ship
without the other.

### A — Palette Expansion (6 → 10 with two-hue blends)

#### R1: Color value is a string descriptor (single index OR blend)
A swatch color value SHALL be represented as a STRING: `"4"` for a single ANSI
index, `"a+b"` (two ANSI indices joined by `+`) for a 50/50 blend. The frontend
SHALL provide `parseColorValue` / `formatColorValue` helpers in `themes.ts` that
round-trip between the string and a `{ a: number, b?: number }` descriptor.

- **GIVEN** a stored color value `"1+3"`
- **WHEN** `parseColorValue("1+3")` is called
- **THEN** it returns a descriptor identifying ANSI indices 1 and 3 as a blend
- **AND** `formatColorValue` of that descriptor returns `"1+3"` exactly
- **AND** `parseColorValue("4")` returns the single-index descriptor for index 4

#### R2: Picker offers 10 colors — 6 single hues + 4 locked blends
The picker definition SHALL list the 6 single indices (`1,2,3,4,5,6`) first, then
4 blends in stable display order: orange `1+3`, purple `1+4`, slate `3+4`, olive
`1+2`. Each blend's source color SHALL be `blendHex(palette.ansi[a],
palette.ansi[b], 0.5)`, computed BEFORE the saturate(×1.5)→blend tint pipeline, so
blends stay theme-derived (re-derive on theme switch) and are NEVER fixed hexes.
Brights (ANSI 9–14) SHALL NOT be added.

- **GIVEN** a theme palette
- **WHEN** the picker is rendered
- **THEN** exactly 10 swatches appear (6 single + 4 blend), single-first then the
  4 blends in the order orange, purple, slate, olive
- **AND** the blend swatches are unlabeled color squares, consistent with the 6

#### R3: `computeRowTints` accepts blend descriptors
`computeRowTints(palette)` SHALL return a `Map<string, RowTint>` keyed by the
string color value (`"4"`, `"1+3"`, and the uncolored-selected sentinel), with
`base`/`hover`/`selected` tints for each of the 10 picker entries computed via the
existing `saturate(×1.5) → blend(0.14/0.22/0.32)` pipeline. The existing tint
ratios and saturation factor SHALL NOT change.

- **GIVEN** the default dark theme
- **WHEN** `computeRowTints` is called
- **THEN** the returned Map contains an entry for every picker color value plus the
  uncolored-selected sentinel
- **AND** the tint for `"1"` matches the previous integer-keyed `1` tint (no
  regression for the existing 6)

#### R4: Three storage paths accept the string representation
Window color (tmux `@color`), session color (`run-kit.yaml` `session_color`), and
server color (`~/.rk/settings.yaml` `server_colors`) SHALL accept the string
representation. Server color is the type-change risk: its current INTEGER storage
SHALL change to a tolerant read (accept int OR string on read, ALWAYS write string)
with no separate migration step. Per Constitution §II (No Database) values stay in
their existing files; per §IX (Uniform HTTP Verb) every mutation stays `POST`; per
§I (Security First) any tmux option write uses `exec.CommandContext` + validated
input, never shell strings.

- **GIVEN** an existing `~/.rk/settings.yaml` with `server_colors:` integer values
- **WHEN** the settings are loaded
- **THEN** the integer values still parse (back-compat, no migration code)
- **AND** **WHEN** a server color `"1+3"` is set and saved
- **THEN** the value is written as a string and reads back as `"1+3"`
- **AND** the window-color and session-color validators accept both `"4"` (0–15)
  and `"1+3"` (each component 0–15) and reject malformed values (e.g. `"99"`,
  `"1+"`, `"x"`, `"1+2+3"`) with `400`

#### R5: Rendering sites consume the string descriptor
`server-panel.tsx`, `session-row.tsx`, and `window-row.tsx` SHALL read the stored
color as a string and look up its tint from the `rowTints` map by that string. The
full-saturation left border for a blend SHALL be `blendHex(ansi[a], ansi[b], 0.5)`;
for a single index it stays `ansi[idx]`. The wire JSON for window color, session
color, and server color SHALL be a string (frontend `color?: string`).

- **GIVEN** a window with stored color `"1+3"`
- **WHEN** the sidebar renders the row
- **THEN** the row background uses the blend's computed tint and the left border
  uses the blend's full-saturation hex
- **AND** a window with stored color `"4"` renders identically to its pre-change
  single-index appearance

#### R6: Every swatch is keyboard-navigable (11-item grid)
`SwatchPopover` SHALL reflow to 11 items (10 colors + Clear) and update arrow-key
navigation math from `PICKER_ANSI_INDICES.length + 1` to the new 11-item count.
Per Constitution §V (Keyboard-First) every swatch — including the 4 new blends —
SHALL be arrow-key reachable and Enter/Space selectable.

- **GIVEN** the open popover with focus on the first swatch
- **WHEN** the user presses ArrowRight repeatedly
- **THEN** focus advances through all 10 color swatches and lands on Clear without
  skipping any blend
- **AND** pressing Enter/Space on a focused blend selects that blend's string value

### B — Contrast Guardrail (independently reviewable / revertible)

#### R7: OKLab + WCAG color-math helpers in `themes.ts`
`themes.ts` SHALL gain pure-arithmetic helpers ported from the existing audit
script (`app/frontend/scripts/audit-swatch-colors.ts`), WITHOUT re-deriving the
math: `hexToOklab` / `oklabToHex` (Björn Ottosson 2020 coefficients),
`relativeLuminance` (WCAG 2.x, sRGB→linear) and `contrastRatio` (1..21).

- **GIVEN** a hex color
- **WHEN** `oklabToHex(hexToOklab(hex))` is computed
- **THEN** the result round-trips to within a 1–2 per-channel rounding tolerance
- **AND** `contrastRatio("#000000", "#ffffff")` ≈ 21 and `contrastRatio(x, x)` === 1

#### R8: Auto-adjust low-contrast borders by nudging OKLab lightness
`adjustBorderForContrast(border, bg, isDark, min)` SHALL, when the border fails
`min` (WCAG 3.0) contrast against `bg`, nudge ONLY the OKLab L (lighten on dark
themes, darken on light) in small steps until it clears `min` or hits a ~24-step
cap, preserving hue and chroma. A border already clearing `min` SHALL be returned
unchanged. The window-row 8px left border SHALL pass through this guardrail so it
stays visible; this MAY visibly shift the existing 6 colors' borders on the
themes where it fires (an intentional legibility fix).

- **GIVEN** a border color that fails 3.0 contrast against a dark background
- **WHEN** `adjustBorderForContrast(border, bg, true, 3.0)` is called
- **THEN** the returned color clears 3.0 (or is the best-effort cap result) and its
  OKLab a/b (hue/chroma) are preserved within rounding tolerance
- **AND** a border that already clears 3.0 is returned byte-identical

## Tasks

### Phase 1: A — Color value representation + tint pipeline (frontend foundation)

- [x] T001 Add `parseColorValue` / `formatColorValue` + a `PickerColor` descriptor type and a `PICKER_COLORS` definition (6 single indices + 4 blends in order orange `1+3`, purple `1+4`, slate `3+4`, olive `1+2`) to `app/frontend/src/themes.ts`; keep `PICKER_ANSI_INDICES` exported for back-compat. <!-- R1 R2 -->
- [x] T002 Rework `computeRowTints` in `app/frontend/src/themes.ts` to return `Map<string, RowTint>` keyed by string color value, resolving each picker entry's source color (single = `ansi[idx]`, blend = `blendHex(ansi[a], ansi[b], 0.5)`) before the existing saturate(×1.5)→blend pipeline; keep the uncolored-selected sentinel; do NOT change the 0.14/0.22/0.32 ratios or ×1.5. <!-- R3 -->

### Phase 2: B — Color-math helpers + contrast guardrail (frontend, independent of Phase 1)

- [x] T003 [P] Port `hexToOklab`, `oklabToHex`, `relativeLuminance`, `contrastRatio` into `app/frontend/src/themes.ts` from the audit script verbatim (no re-derivation). <!-- R7 -->
- [x] T004 Add `adjustBorderForContrast(border, bg, isDark, min)` to `app/frontend/src/themes.ts` ported from the audit script (preserve hue/chroma, nudge L, 24-step cap, BORDER_MIN_CONTRAST const 3.0). <!-- R8 -->

### Phase 3: A — Frontend wiring (picker, rendering sites, API client)

- [x] T005 Update `app/frontend/src/components/swatch-popover.tsx` to render all 10 colors from `PICKER_COLORS`, key tints by string value, accept/emit string `selectedColor`/`onSelect`, and fix nav math for 11 items (total-item count, Clear index, Down/Up jumps). <!-- R2 R6 -->
- [x] T006 Update `app/frontend/src/types.ts` (`color`/`sessionColor` → `string`) and the three rendering sites `window-row.tsx`, `session-row.tsx`, `server-panel.tsx` to read string color, look up tints by string, and compute the blend border via `blendHex` (wiring the contrast guardrail R8 on the window-row 8px border). <!-- R5 R8 -->
- [x] T007 Update `app/frontend/src/api/client.ts` color functions (`setWindowColor`, `setSessionColor`, `setServerColor`, `getServerColor`, `getAllServerColors`) and `app.tsx`/`sidebar/index.tsx` color-change handlers to accept/return string color values. <!-- R1 R4 R5 -->

### Phase 4: A — Backend storage + validation

- [x] T008 Change `app/backend/internal/settings/settings.go` `ServerColors` to `map[string]string` with tolerant parse (accept int or string token, validate, always serialize as string); update `GetServerColor`/`SetServerColor` signatures to string. <!-- R4 -->
- [x] T009 Update `app/backend/api/settings.go` `handleGetServerColor`/`handleSetServerColor` to accept/return string color and validate via a shared `validateColorValue` helper (single 0–15 OR `a+b` with each 0–15). <!-- R4 -->
- [x] T010 Change `WindowInfo.Color` and `SessionInfo.Color` to `*string` in `app/backend/internal/tmux/tmux.go` (parse `@color`/`@session_color` as the raw string token, validate shape, drop on malformed) and `SetSessionColor` to take a string; update `app/backend/internal/config/runkit_yaml.go` `Read/WriteSessionColor` + `parseSessionColor` to string (tolerant read). <!-- R4 R5 -->
- [x] T011 Update `app/backend/api/windows.go` `validateWindowOption` `@color` rule and `app/backend/api/sessions.go` `handleSessionColor` to accept the string descriptor (single 0–15 OR blend `a+b`), rejecting malformed with 400; keep mutations POST and use `exec.CommandContext` (no shell strings). <!-- R4 -->

### Phase 5: Tests

- [x] T012 [P] Extend `app/frontend/src/themes.test.ts`: parse/format round-trip (R1), `computeRowTints` string keys for all 10 entries + no-regression for the 6 (R3), OKLab round-trip + `contrastRatio` bounds (R7), `adjustBorderForContrast` clears min / preserves hue-chroma / passes already-compliant through (R8). <!-- R1 R3 R7 R8 -->
- [x] T013 [P] Update `app/frontend/src/components/swatch-popover.test.tsx` for 10 colors + 11-item keyboard nav reaching every blend (R6), and `app/frontend/src/api/client.test.ts` for string color round-trip on the color functions (R1 R4). <!-- R4 R6 -->
- [x] T014 [P] Add/extend Go tests: `app/backend/internal/settings/settings_test.go` (tolerant int-or-string read, always-write-string), `app/backend/api/settings_test.go` (string server-color + validation 400s), and color-validation tests in `app/backend/api/windows_test.go` / `sessions_test.go`. <!-- R4 -->
- [x] T015 [P] **N/A**: no existing `*.spec.ts` asserts swatch behavior or color counts (the only "swatch" mention is the server-tile grid layout), so no `.spec.md` companion update is forced; new color e2e is impractical without live-tmux color-persistence fixtures. Behavior is covered by Vitest (swatch-popover nav, parse/format, tints) + Go tests. <!-- R2 R6 -->

## Execution Order

- Phase 1 (T001→T002) blocks the frontend consumers in Phase 3.
- Phase 2 (T003→T004) is independent of Phase 1 (group B); T004 depends on T003.
- Phase 3 depends on Phases 1 and 2 (T006 wires R8 from T004).
- Phase 4 (backend) is independent of the frontend phases and can run alongside; T009/T011 reuse the shared validator introduced in T008/T009.
- Phase 5 tests follow their respective implementation tasks.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `parseColorValue`/`formatColorValue` round-trip single indices and blends; unit-tested.
- [x] A-002 R2: Picker exposes exactly 10 colors (6 single + 4 blends orange/purple/slate/olive in order), blends unlabeled, brights absent.
- [x] A-003 R3: `computeRowTints` returns a string-keyed Map covering all 10 entries + sentinel via the unchanged tint pipeline.
- [x] A-004 R4: Window/session/server color storage all accept the string representation; server color reads int-or-string and always writes string with no migration step.
- [x] A-005 R5: All three rendering sites consume the string descriptor and render blend tint + blend border correctly; single-index colors unchanged.
- [x] A-006 R6: Popover reflows to 11 items and every swatch (incl. blends) is arrow-key reachable + Enter/Space selectable.
- [x] A-007 R7: `hexToOklab`/`oklabToHex`/`relativeLuminance`/`contrastRatio` exist in `themes.ts`, ported (not re-derived), and unit-tested for round-trip + bounds.
- [x] A-008 R8: `adjustBorderForContrast` nudges only L to clear WCAG 3.0, preserves hue/chroma, caps at 24 steps, and passes already-compliant borders through; wired on the window-row border.

### Behavioral Correctness

- [x] A-009 R4: An existing integer `server_colors` settings file still loads correctly after the type change (back-compat verified by a Go test).
- [x] A-010 R5: A pre-change single-index color (`"4"`) renders byte-identically to before (no visual regression for the existing 6).

### Edge Cases & Error Handling

- [x] A-011 R4: Malformed color values (`"99"`, `"1+"`, `"x"`, `"1+2+3"`, out-of-range component) are rejected with 400 across window/session/server color endpoints; valid `"1+3"` accepted.
- [x] A-012 R8: A border already clearing 3.0 contrast is returned unchanged (no spurious nudge).

### Code Quality

- [x] A-013 Pattern consistency: New code follows surrounding naming/structure — Go `exec.CommandContext` + arg slices, frontend type-narrowing over `as` casts, named constants over magic numbers.
- [x] A-014 No unnecessary duplication: OKLab/WCAG/adjust math is ported from the audit script (single conceptual source); the color-validation rule is shared between window/session/server handlers rather than triplicated.

### Security

- [x] A-015 R4: All color mutations stay `POST` (Constitution §IX); tmux option writes use `exec.CommandContext` with validated, range-checked, allowlisted input (Constitution §I) — no shell strings, color value validated before any subprocess.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- The audit script `app/frontend/scripts/audit-swatch-colors.ts` is the design
  evidence and reference implementation; it is dev-time only (ships nothing) and
  MUST NOT be modified by this change.

## Deletion Candidates

- `app/backend/internal/config/runkit_yaml.go:31 ReadSessionColor` — zero non-test call sites; session color is read from the tmux `@session_color` option (`sessions.go:548` via `tmux.SessionInfo.Color`), not `run-kit.yaml`. Still `*int`; T010's clause to migrate it to string was not done because the function is already dead for the color path.
- `app/backend/internal/config/runkit_yaml.go:68 WriteSessionColor` — zero non-test call sites; the color-set path now goes through `tmux.SetSessionColor`/`UnsetSessionColor` (see `api/sessions.go handleSessionColor`), so this `*int` writer is unreferenced.
- `app/backend/internal/config/runkit_yaml.go:44 parseSessionColor` / `:82 setSessionColorInContent` / `:114 removeSessionColorKey` — internal helpers reachable only through the dead `Read/WriteSessionColor` above; orphaned with them.
- `app/backend/internal/config/runkit_yaml_test.go` (TestReadSessionColor*/TestWriteSessionColor*) — exercise only the dead functions above; would be removed alongside them.
- NOTE: `FindGitRoot` in the same file is NOT a deletion candidate — it has live callers elsewhere (`internal/sessions`, `ProjectRoot`).
- NOTE: all four are PRE-EXISTING dead code (the `@session_color` migration predates this change at HEAD); this change did not newly orphan them, but the int→string type divergence it introduces makes their staleness conspicuous.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Color wire format = string ("4" / "1+3"); add `parseColorValue`/`formatColorValue` to themes.ts | Intake assumption #2 (Certain) fixes this verbatim; tmux options are already strings | S:90 R:65 A:90 D:88 |
| 2 | Certain | 4 locked blends orange 1+3 / purple 1+4 / slate 3+4 / olive 1+2, single-first display order, unlabeled | Intake assumptions #1 and #10 lock the set, order, and labeling from audit data + visual preview | S:98 R:75 A:95 D:95 |
| 3 | Certain | Port OKLab/WCAG/adjustBorderForContrast verbatim from the audit script; do not re-derive or modify the script | Intake KEY constraint + the script is the reference impl; constitution readability-over-cleverness favors reuse | S:95 R:85 A:95 D:95 |
| 4 | Certain | Server-color storage = tolerant read (int OR string), always write string, no migration step | Intake assumption #9 (Certain) confirms this with the user during intake | S:95 R:75 A:90 D:95 |
| 5 | Confident | `computeRowTints` returns `Map<string, RowTint>` keyed by the string color value (was `Map<number, RowTint>`) | A blend has no integer key; string keying is the minimal change that supports both, and all 5 consumers already do a single `.get(color)` lookup | S:80 R:70 A:85 D:82 |
| 6 | Confident | Window & session color JSON contracts also become strings (`WindowInfo.Color`/`SessionInfo.Color` → `*string`, frontend `color?: string`) | A6/A5 say rendering sites "key on the new descriptor (string)"; a blend can't round-trip through `@color`/session as an int, so all three wire types move to string — wider than the intake's "lowest risk" framing for window/session but required for blend support on those paths | S:78 R:55 A:82 D:75 |
| 7 | Confident | Single shared `validateColorValue` (single 0–15 OR `a+b` each 0–15) reused across window/session/server backend handlers | Avoids triplicating the rule (anti-pattern: duplication); the three handlers had three near-identical 0–15 checks already | S:82 R:78 A:85 D:80 |
| 8 | Confident | swatch-popover reflows to 11 items (10 + Clear) with updated nav math | Intake assumption #8 (Confident) + Constitution §V Keyboard-First; mechanical but required | S:82 R:80 A:85 D:80 |

8 assumptions (4 certain, 4 confident, 0 tentative).
