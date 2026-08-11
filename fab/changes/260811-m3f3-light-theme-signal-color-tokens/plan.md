# Plan: Light-Theme Signal Color Tokens

**Change**: 260811-m3f3-light-theme-signal-color-tokens
**Intake**: `intake.md`

## Requirements

### Frontend Theme: Signal Color Tokens

#### R1: Four signal theme tokens in `app/frontend/src/globals.css`
Four new tokens — `--color-signal-yellow`, `--color-signal-purple`, `--color-signal-blue`, `--color-signal-red` — SHALL be defined exactly like `--color-accent-green`: in the `@theme` block (~line 38), the `html[data-theme="dark"]` block (~line 52), and the `html[data-theme="light"]` block (~line 67). Values MUST be exactly:

| Token | `@theme` + dark | light |
|-------|-----------------|-------|
| `--color-signal-yellow` | `#facc15` | `#b07d02` (custom gold) |
| `--color-signal-purple` | `#c084fc` | `#9333ea` |
| `--color-signal-blue` | `#60a5fa` | `#2563eb` |
| `--color-signal-red` | `#f87171` | `#dc2626` |

Dark values are today's exact hexes so the dark theme stays pixel-identical.

- **GIVEN** the theme system already re-themes `--color-accent-green` per theme
- **WHEN** the four tokens are defined in all three blocks
- **THEN** Tailwind 4 generates the `text-signal-*` / `bg-signal-*` / `border-signal-*` utility families (with opacity modifiers via color-mix) automatically
- **AND** the dark theme renders byte-identical colors to today

#### R2: `#facc15` literals in `globals.css` → `var(--color-signal-yellow)`
Every hardcoded `#facc15` in `globals.css` SHALL be replaced with `var(--color-signal-yellow)`: the `rk-waiting-halo` keyframes (lines 269-270, two `color-mix(in srgb, #facc15 …)` stops), the `rk-waiting-seam` keyframes + static class (lines 288-292), and the `prefers-reduced-motion` static fallbacks (lines 531-532). The comment block at lines ~258-267 ("Yellow is a CONSTANT (#facc15 …) theme-independent by design") SHALL be rewritten to state the **semantic** (yellow = attention / "needs you now") is constant while the **value** is per-theme via `--color-signal-yellow`.

- **GIVEN** the waiting halo, board waiting seam, and reduced-motion fallbacks hardcode `#facc15`
- **WHEN** the literals are swapped for `var(--color-signal-yellow)`
- **THEN** all waiting-attention surfaces follow the active theme
- **AND** no `#facc15` literal remains anywhere in `globals.css`

### Frontend Components: Shared Color Vocabulary

#### R3: `pr-status-model.ts` — single edit point for the shared vocabulary
`app/frontend/src/components/pr-status-model.ts` SHALL swap raw palette classes for the new token utilities:
- `PR_STATE_COLORS` (lines 33-34): `merged: "text-purple-400"` → `text-signal-purple`; `closed: "text-red-400"` → `text-signal-red`
- `PR_CHECKS_COLORS` (lines 39-40): `fail: "text-red-400"` → `text-signal-red`; `pending: "text-yellow-400"` → `text-signal-yellow`
- `PR_REVIEW_COLORS` (lines 45-46): `changes_requested: "text-red-400"` → `text-signal-red`; `review_required: "text-yellow-400"` → `text-signal-yellow`
- `PHASE_HUE` (lines 169, 171): `building: "text-blue-400"` → `text-signal-blue`; `agent: "text-yellow-400"` → `text-signal-yellow`
- `prGlyphColor` chain (lines 247-250): `text-red-400` → `text-signal-red`, `text-yellow-400` → `text-signal-yellow`, `text-purple-400` → `text-signal-purple`
- Doc comments referencing the old class names (lines ~163-165, ~217-234) SHALL be updated to the new token names.

Sidebar rows, session tiles, the row-flyout card, and the pane panel all consume this module and MUST inherit the swap with no per-surface edits.

- **GIVEN** `pr-status-model.ts` is the single source of truth for the shared PR/phase color vocabulary
- **WHEN** its maps and `prGlyphColor` switch to `signal-*` classes
- **THEN** every consuming surface (sidebar rows, session tiles, row flyout card, pane panel) renders theme-adapted signal colors from one edit

#### R4: `waiting-badge.tsx` yellow utilities
`app/frontend/src/components/waiting-badge.tsx` SHALL swap: line 39 `bg-yellow-400/15 text-yellow-400` → `bg-signal-yellow/15 text-signal-yellow`; line 50 `hover:bg-yellow-400/25` → `hover:bg-signal-yellow/25`. The line ~12 doc comment claiming "(yellow-400, theme-independent)" SHALL be updated to the semantic-constant / value-per-theme framing, matching the globals.css comment rewrite.

- **GIVEN** the waiting badge hardcodes `yellow-400` utilities
- **WHEN** they become `signal-yellow` utilities
- **THEN** the badge meets the ≥3:1 light-theme contrast bar while staying pixel-identical on dark

#### R5: `chat-view.tsx` warning banner + error text
`app/frontend/src/components/chat-view.tsx` SHALL swap: warning banner (line 122) `border-yellow-400/50 bg-yellow-400/10 … text-yellow-300` → `border-signal-yellow/50 bg-signal-yellow/10 … text-signal-yellow` (the `yellow-300` body text collapses into the single yellow token — the explicit single-token decision); banner label (line 126) `text-yellow-400/80` → `text-signal-yellow/80`; error text `text-red-400` (lines 107, 264, 433, 451, 471) → `text-signal-red`. The `border-red-500/50` / `bg-red-500/10` washes (lines 107, 264, 417, 451) SHALL stay as raw classes — only the `text-red-400` foregrounds change in those class lists.

- **GIVEN** the chat warning banner uses `yellow-400` border/bg utilities and `yellow-300` body text
- **WHEN** the banner collapses to the single `signal-yellow` token and error foregrounds move to `signal-red`
- **THEN** the worst light-theme contrast offender (1.3:1 body text) rises to ≥3:1 and the red story splits deliberately: foregrounds themed, washes raw

#### R6: `status-dot.tsx` failed-dot center
`app/frontend/src/components/status-dot.tsx` line 106 `bg-red-400` SHALL become `bg-signal-red`.

- **GIVEN** the failed-dot red center is a foreground signal
- **WHEN** it moves to `bg-signal-red`
- **THEN** the failed state is legible on light backgrounds (≥3:1)

#### R7: Error-text and kill-affordance sweep
Every remaining `text-red-400` / `hover:text-red-400` SHALL become `text-signal-red` / `hover:text-signal-red` in: `app/frontend/src/components/create-session-dialog.tsx` (lines 312, 321), `spawn-agent-dialog.tsx` (line 284), `settings-dialog.tsx` (line 174), `sidebar/status-panel.tsx` (line 475), `app.tsx` (line 3499), and the `hover:text-red-400` kill affordances in `sidebar/index.tsx` (line 2412), `sidebar/session-row.tsx` (line 264), `sidebar/window-row.tsx` (line 620). The sweep completeness check MUST be NUL-safe (`grep -a` or equivalent) — `session-tiles/session-tiles.tsx` contains a deliberate NUL byte that makes plain `grep` silently skip it.

- **GIVEN** eight files carry raw `text-red-400` error/kill foregrounds
- **WHEN** they all move to `signal-red`
- **THEN** a NUL-safe repo-wide sweep finds zero remaining `text-red-400` / `hover:text-red-400` signal-class usages

### Tests

#### R8: Test coverage for the token swap
Existing tests asserting the old class strings SHALL be updated to the new token classes: `pr-status-model.test.ts`, `status-dot.test.tsx`, `session-tiles/session-tiles.test.tsx`, `sidebar/window-row.test.tsx`, `sidebar/status-panel.test.tsx`, `sidebar/registers.test.ts`, `sidebar/row-flyout-card.test.tsx`, `sidebar/index.test.tsx`. One new unit test SHALL assert (a) the four `--color-signal-*` tokens are defined in all three globals.css theme blocks with dark values equal to the legacy hexes (the pixel-identical guarantee), and (b) the `pr-status-model.ts` color maps (`PR_STATE_COLORS`, `PR_CHECKS_COLORS`, `PR_REVIEW_COLORS`, `PHASE_HUE`, `prGlyphColor`) reference `signal-*` classes rather than raw palette classes. No new e2e SHALL be added; existing e2e (e.g. `agent-next-waiting.spec.ts` reduced-motion assertions) MUST stay green.

- **GIVEN** existing tests pin the old raw palette class strings
- **WHEN** expectations are updated and the token/vocabulary unit test is added
- **THEN** `cd app/frontend && npx tsc --noEmit` and `just test-frontend` pass, and the dark pixel-identical guarantee is locked in by a test

### Non-Goals

- Row label colors and the selection ring — already OKLCH theme-adapted with a contrast guard in `themes.ts`
- `text-text-secondary` surfaces — 4.8:1 on light, fine
- `--color-accent-green` — already themed; 3.3:1 as text is borderline but is a possible follow-up, not this change
- Terminal pane content — ANSI colors come from user-selected terminal themes, not app CSS
- `border-red-500/50` / `bg-red-500/10` washes in chat-view.tsx and the dialogs — kept as raw classes (decided at apply; washes at 10-50% opacity are not contrast-critical)

### Design Decisions

#### Single yellow token (no two-tone split)
**Decision**: The `yellow-300` chat warning body text collapses into the single `--color-signal-yellow` token; one gold (`#b07d02`) serves both glyph and text surfaces.
**Why**: Single-token simplicity; the user explicitly accepted the sub-4.5:1 text trade-off after rejecting `yellow-700` #a16207 as reading brown.
**Rejected**: Two-tone split (brighter gold for glyphs, darker shade for text-only surfaces) — set aside for simplicity.
*Introduced by*: 260811-m3f3-light-theme-signal-color-tokens

#### Keep red-500 washes raw
**Decision**: `border-red-500/50` / `bg-red-500/10` border/background washes stay as raw Tailwind classes; only `text-red-400` foregrounds move to `signal-red`.
**Why**: Washes at 10-50% opacity are not contrast-critical the way foreground signals are; this is the intake's noted default for its one deferred sub-decision, taken by apply per the dispatch directive.
**Rejected**: Moving washes to `signal-red` derivatives (`border-signal-red/50`, `bg-signal-red/10`) — would unify the red story but is the user's aesthetic call, deferred.
*Introduced by*: 260811-m3f3-light-theme-signal-color-tokens

## Tasks

### Phase 1: Setup

- [x] T001 Add the four `--color-signal-*` tokens to `app/frontend/src/globals.css` in the `@theme` block, the `html[data-theme="dark"]` block, and the `html[data-theme="light"]` block with the exact hex values from R1 <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 Swap all `#facc15` literals in `app/frontend/src/globals.css` (rk-waiting-halo keyframes, rk-waiting-seam keyframes + static class, prefers-reduced-motion fallbacks) for `var(--color-signal-yellow)` and rewrite the lines ~258-267 comment to the semantic-constant / value-per-theme framing <!-- R2 -->
- [x] T003 Swap the color maps, `PHASE_HUE`, `prGlyphColor`, and doc comments in `app/frontend/src/components/pr-status-model.ts` to the `signal-*` classes per R3 <!-- R3 -->
- [x] T004 [P] Swap waiting-badge yellows in `app/frontend/src/components/waiting-badge.tsx` (`bg-signal-yellow/15 text-signal-yellow`, `hover:bg-signal-yellow/25`) and update its doc comment <!-- R4 -->
- [x] T005 [P] Swap the failed-dot center in `app/frontend/src/components/status-dot.tsx` line 106 `bg-red-400` → `bg-signal-red` <!-- R6 -->
- [x] T006 Swap `app/frontend/src/components/chat-view.tsx` warning banner + label to `signal-yellow` (yellow-300 collapses into the single token) and the five `text-red-400` error foregrounds to `text-signal-red`, keeping `red-500` washes raw <!-- R5 -->
- [x] T007 [P] Sweep `text-red-400` / `hover:text-red-400` → `signal-red` in `create-session-dialog.tsx`, `spawn-agent-dialog.tsx`, `settings-dialog.tsx`, `sidebar/status-panel.tsx`, `app.tsx`, `sidebar/index.tsx`, `sidebar/session-row.tsx`, `sidebar/window-row.tsx`; verify completeness with a NUL-safe grep <!-- R7 -->

### Phase 3: Integration & Edge Cases

- [x] T008 Update existing test expectations to the new token classes in `pr-status-model.test.ts`, `status-dot.test.tsx`, `session-tiles/session-tiles.test.tsx`, `sidebar/window-row.test.tsx`, `sidebar/status-panel.test.tsx`, `sidebar/registers.test.ts`, `sidebar/row-flyout-card.test.tsx`, `sidebar/index.test.tsx` <!-- R8 -->
- [x] T009 Add the signal-token unit test (globals.css tokens in all three blocks with dark == legacy hexes; pr-status-model maps reference `signal-*` classes) <!-- R8 -->
- [x] T010 Run verification gates: `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, then `just test` and `just build` per code-quality.md <!-- R8 -->

## Execution Order

- T001 blocks nothing at compile time (Tailwind generates utilities from `@theme`), but run it first so every later swap resolves against existing tokens
- T003–T007 are independent file edits once T001 lands; T008 must follow all of them (it pins the new class strings); T009–T010 close the phase

## Acceptance

### Functional Completeness

- [x] A-001 R1: All four `--color-signal-*` tokens are defined in the `@theme`, `html[data-theme="dark"]`, and `html[data-theme="light"]` blocks of `globals.css` with exactly the R1 hex values
- [x] A-002 R2: No `#facc15` literal remains in `globals.css`; waiting-halo keyframes, waiting-seam keyframes + static class, and both reduced-motion fallbacks reference `var(--color-signal-yellow)`; the comment block reads semantic-constant / value-per-theme
- [x] A-003 R3: `pr-status-model.ts` maps and `prGlyphColor` contain only `signal-*` / `text-accent-green` / `text-text-secondary` classes — no raw `*-400` palette classes (line 164's `text-purple-400` mention is a historical doc-comment note that the class is GONE from the dot, not a usage)
- [x] A-004 R4: `waiting-badge.tsx` uses `bg-signal-yellow/15 text-signal-yellow` and `hover:bg-signal-yellow/25`; doc comment updated
- [x] A-005 R5: `chat-view.tsx` banner uses `border-signal-yellow/50 bg-signal-yellow/10 text-signal-yellow`, label `text-signal-yellow/80`, error foregrounds `text-signal-red`; `border-red-500/50` / `bg-red-500/10` washes unchanged; no `yellow-300`/`yellow-400` classes remain
- [x] A-006 R6: `status-dot.tsx` failed-dot center uses `bg-signal-red`
- [x] A-007 R7: A NUL-safe sweep finds zero `text-red-400` / `hover:text-red-400` usages under `app/frontend/src/` (session-tiles.tsx verified with `grep -a` — 270 NUL-byte lines, zero signal-class hits)
- [x] A-008 R8: The new token/vocabulary unit test exists and passes (`src/signal-color-tokens.test.ts`, 6 tests); all updated existing tests pass (129 files / 2480 tests via `just test-frontend`)

### Behavioral Correctness

- [x] A-009 R1: Dark-theme token values equal the legacy hexes exactly (`#facc15`/`#c084fc`/`#60a5fa`/`#f87171`) — dark is pixel-identical; light theme uses `#b07d02`/`#9333ea`/`#2563eb`/`#dc2626` (verified in globals.css and pinned by `signal-color-tokens.test.ts`)
- [x] A-010 R5: The chat warning body text renders in the single `signal-yellow` token (no two-tone split)

### Scenario Coverage

- [x] A-011 R8: `cd app/frontend && npx tsc --noEmit` ✓, `just test-frontend` ✓ (129 files / 2480 tests), `just test-e2e` ✓ (225 passed; the one row-flyout fork-nav failure is the known main-branch timing flake — passes 8/8 on isolated re-run), `vite build` ✓ (`just build`'s Go packaging leg fails on a missing untracked VERSION file — pre-existing on main, not attributable to this change)

### Edge Cases & Error Handling

- [x] A-012 R2: The `prefers-reduced-motion` static fallbacks (`.rk-waiting-halo` box-shadow, `.rk-waiting-seam` border-color) also follow the theme token — reduced-motion light-theme users are not left on the washed-out literal
- [x] A-013 R7: The completeness sweep is NUL-safe — `session-tiles/session-tiles.tsx` (deliberate NUL byte) is verified with `grep -a`, not silently skipped

### Code Quality

- [x] A-014 Pattern consistency: New token definitions mirror the existing `--color-accent-green` three-block pattern exactly
- [x] A-015 No unnecessary duplication: One token per hue, one edit point (`pr-status-model.ts`) for the shared vocabulary — no per-surface color forks
- [x] A-016 Tests cover changed behavior: class-string expectations updated in place and the new unit test pins both the token definitions and the vocabulary maps

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Known pre-existing flake: "Maximum update depth exceeded" console errors in some e2e specs are a main-branch bug, not caused by this change

## Deletion Candidates

- None — this change swaps fixed Tailwind `-400` class strings and `#facc15` literals for theme-token references without making any existing symbol, function, or block redundant (the retired classes are Tailwind built-ins, not project code; `pr-status-model.ts` remains the single vocabulary source).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Keep the `red-500` border/background washes (`border-red-500/50`, `bg-red-500/10`) as raw classes; only `text-red-400` foregrounds change in those class lists | Intake's one Unresolved row (#9) resolved at apply per the dispatch directive — the intake's noted default (washes are not contrast-critical foregrounds); recorded here and in Design Decisions | S:85 R:85 A:85 D:85 |
| 2 | Certain | New unit test lives at `app/frontend/src/signal-color-tokens.test.ts` (colocated `.test.ts` per code-quality.md), reading `globals.css` from disk and importing the `pr-status-model` maps | code-quality.md mandates colocated `.test.ts` files; one test file covers both assertion shapes named in the intake | S:80 R:90 A:90 D:85 |
| 3 | Confident | No new e2e for the color swap; existing e2e (`agent-next-waiting.spec.ts` reduced-motion assertions — class-based selectors, no hex checks) must simply stay green | Intake assumption 8 (Discussed); verified the e2e suite asserts `rk-waiting-halo` classes, never hexes or palette classes | S:75 R:85 A:85 D:80 |

3 assumptions (2 certain, 1 confident, 0 tentative).
