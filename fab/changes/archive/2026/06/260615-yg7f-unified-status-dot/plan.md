# Plan: Unified Status Dot

**Change**: 260615-yg7f-unified-status-dot
**Intake**: `intake.md`

## Requirements

### StatusDot: Precedence Helper

#### R1: `statusDotState` precedence
A `statusDotState(win)` helper SHALL live in `pr-status-line.tsx` (colocated with `prDotState`/`PR_DOT_COLOR`/`isFailish`) and return a discriminated union `StatusDotState = { kind: "pr"; pr: PrDotState } | { kind: "activity"; active: boolean }`. PR status MUST win when the window is change-bound AND has a PR (`win.fabChange && win.prNumber`); otherwise it MUST fall back to terminal activity.

- **GIVEN** a window with `fabChange` set and `prNumber` set
- **WHEN** `statusDotState(win)` is called
- **THEN** it returns `{ kind: "pr", pr: prDotState(win) }`
- **AND GIVEN** a window missing either `fabChange` or `prNumber`
- **WHEN** `statusDotState(win)` is called
- **THEN** it returns `{ kind: "activity", active: win.activity === "active" }`

### StatusDot: Component

#### R2: Unified `StatusDot` component
A new presentational component `StatusDot` SHALL live in `app/frontend/src/components/status-dot.tsx`, taking `{ win: WindowInfo }` and rendering the dot derived from `statusDotState(win)`. It MUST reuse the existing PR color/label vocabulary (`PR_DOT_COLOR`, `PR_DOT_LABEL`) — no new color tokens, no new hex.

- **GIVEN** `statusDotState(win)` returns a `pr` kind with a live state (merged/fail/pending/healthy)
- **WHEN** `StatusDot` renders
- **THEN** it renders a solid `●` glyph in that state's `PR_DOT_COLOR` token, carrying `PR_DOT_LABEL[state]` as both `aria-label` and `title`
- **AND GIVEN** the `pr` state is `neutral`
- **THEN** it renders a dim hollow ring (`text-text-secondary`, 1.5px border, transparent fill) with the `PR_DOT_LABEL.neutral` label

#### R3: Monochrome activity fallback
When `statusDotState(win)` returns the `activity` kind, `StatusDot` MUST render monochrome fill-vs-ring with NO green: `active` → gray (`text-text-secondary`) filled dot; `idle` → gray hollow ring (1.5px border, transparent fill). The `aria-label`/`title` MUST be `"active"` / `"idle"` (matching today's `aria-label={win.activity}`). All color is reserved for PR meaning.

- **GIVEN** a non-PR window with `activity === "active"`
- **WHEN** `StatusDot` renders
- **THEN** it renders a gray filled dot labelled `"active"` (no green token)
- **AND GIVEN** `activity === "idle"`
- **THEN** it renders a gray hollow ring labelled `"idle"`

#### R4: Preserve fab-failed red tint on activity branch only
A window whose `fabDisplayState === "failed"` MUST show its activity-fallback dot in `text-red-400` (preserving today's `window-row.tsx:252` behavior). This override MUST apply ONLY to the activity branch — PR-branch dots already carry their own `PR_DOT_COLOR`.

- **GIVEN** a non-PR window with `fabDisplayState === "failed"` and `activity === "idle"`
- **WHEN** `StatusDot` renders
- **THEN** the dot uses `text-red-400` (a hollow red ring), not `text-text-secondary`
- **AND GIVEN** a PR window (any `prDotState`) that also has `fabDisplayState === "failed"`
- **THEN** the dot keeps its `PR_DOT_COLOR` token (the red override does not apply)

### StatusDot: Surface Integration

#### R5: Sidebar `window-row.tsx` — one leading `StatusDot`
The sidebar window row MUST collapse its two dots into ONE leading `<StatusDot win={win} />`: the left activity dot (`window-row.tsx:251-258`) is REPLACED by `<StatusDot win={win} />`, and the separate right-side PR dot block (`window-row.tsx:290-306`) is REMOVED. The result is a single dot in the leading position; PR-if-present-else-activity.

- **GIVEN** a change-bound window with a PR rendered in the sidebar
- **WHEN** the row renders
- **THEN** exactly one dot appears, in the leading position, showing PR status (e.g. purple for merged)
- **AND GIVEN** a non-PR window
- **THEN** exactly one leading dot appears showing monochrome activity, and no separate right-side PR dot exists

#### R6: Dashboard `dashboard.tsx` — use `StatusDot`, drop the activity word
The dashboard window card MUST replace its inline green/gray activity dot (`dashboard.tsx:129-136`) with `<StatusDot win={win} />`, and MUST drop the activity word (`{win.activity}` text at `dashboard.tsx:137-140`) while KEEPING the idle duration text. The dot's `title`/`aria-label` carries the removed "active"/"idle" word.

- **GIVEN** an expanded dashboard window card for an idle window with a duration
- **WHEN** the card renders
- **THEN** a `StatusDot` appears, the literal "active"/"idle" word is no longer rendered in the card's activity span, and the idle duration text remains
- **AND** the dot is byte-identical in appearance to the sidebar's for the same window

#### R7: Pane panel `status-panel.tsx` — `StatusDot` in `headerRight`
The pane panel MUST render `<StatusDot win={win} />` in the `WindowPanel` `headerRight` (`status-panel.tsx:116-120`), immediately before `{win.name}`. The existing `pr`/`run` detail rows MUST be left untouched (no new body row, no row-count change).

- **GIVEN** a window selected in the pane panel
- **WHEN** the panel header renders
- **THEN** a `StatusDot` appears immediately before the window name in `headerRight`
- **AND** the `pr` and `run` detail rows are unchanged

### Non-Goals

- No backend, API, SSE, or tmux changes — all fields are already on `WindowInfo` and flow via SSE.
- No new color tokens or hex values — reuse #268's shared PR vocabulary.
- No command-palette/keyboard action (the dot is a display affordance).

### Design Decisions

1. **Single `StatusDot` component with one precedence rule, reused on all three surfaces** — *Why*: one source of truth for "what does this window's dot look like"; the dashboard↔sidebar color match falls out for free. *Rejected*: straight swap (keeps two dots/code paths, doesn't fix dashboard); PR-dot-only (loses activity on non-PR windows).
2. **Activity fallback is shape-only monochrome (no green)** — *Why*: reserves all color exclusively for PR meaning so green/purple/red/yellow are unambiguous.
3. **Pane-panel dot goes in `headerRight`, not a body row** — *Why*: the header is the panel's at-a-glance slot and survives collapse; a body row would restate the existing `pr`/`run` rows.

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add `StatusDotState` type + `statusDotState(win)` helper to `app/frontend/src/components/pr-status-line.tsx`, colocated with `prDotState`/`PR_DOT_COLOR`/`isFailish`, exported. <!-- R1 -->
- [x] T002 Create `app/frontend/src/components/status-dot.tsx`: the `StatusDot` component rendering PR states (solid ● in `PR_DOT_COLOR` / hollow `neutral` ring) and the monochrome activity fallback (active=filled, idle=hollow ring), with the `fabDisplayState === "failed"` red override on the activity branch only, and per-state `aria-label`+`title`. <!-- R2 R3 R4 -->

### Phase 3: Integration

- [x] T003 Sidebar `app/frontend/src/components/sidebar/window-row.tsx`: replace the left activity dot (lines ~251-258) with `<StatusDot win={win} />` and remove the right-side PR dot block (lines ~290-306); add the import, drop now-unused `prDotState`/`PR_DOT_COLOR`/`PR_DOT_LABEL` imports if they become unused. <!-- R5 -->
- [x] T004 Dashboard `app/frontend/src/components/dashboard.tsx`: replace the inline activity dot (lines ~129-136) with `<StatusDot win={win} />`, drop the `{win.activity}` word (lines ~137-140), keep the idle duration text; add the import. <!-- R6 -->
- [x] T005 Pane panel `app/frontend/src/components/sidebar/status-panel.tsx`: add `<StatusDot win={win} />` to `WindowPanel` `headerRight` immediately before `{win.name}` (wrap in a flex row with `gap-1.5 items-center`); add the import. <!-- R7 -->

### Phase 4: Tests

- [x] T006 Create `app/frontend/src/components/status-dot.test.tsx`: unit-test `statusDotState` precedence (PR-present → pr kind, else activity kind) and `StatusDot` rendering for all 5 PR states, activity active/idle, the fab-failed red activity tint (and that it does NOT apply on a PR branch), and the a11y label per state. <!-- R1 R2 R3 R4 -->
- [x] T007 Conform `app/frontend/src/components/sidebar/window-row.test.tsx` to the single-dot structure: the existing PR-dot `triage signals` cases still pass (StatusDot renders them); ensure the activity-dot-red test still targets the single leading dot; remove/adjust any assertion incompatible with the collapsed single-dot layout. <!-- R5 -->
- [x] T008 Conform `app/frontend/src/components/dashboard.test.tsx`: update the "shows activity dot and label on window cards" test to assert the `StatusDot` aria-label (active/idle) instead of the removed in-card activity word, keeping the idle-duration assertion. <!-- R6 -->
- [x] T009 Verify `app/frontend/src/components/pr-status-line.test.tsx` still passes (existing `prDotState`/`PrStatusLine` exports unchanged); add a `statusDotState` precedence case if it fits there, else rely on status-dot.test.tsx. <!-- R1 -->

## Execution Order

- T001 blocks T002 (component imports the helper) and T003/T006.
- T002 blocks T003, T004, T005 (surfaces import the component) and T006.
- T003-T005 are independent of each other once T002 lands.
- T006-T009 follow their respective implementation tasks.

## Acceptance

### Functional Completeness

- [ ] A-001 R1: `statusDotState(win)` returns the `pr` kind iff `fabChange && prNumber`, else the `activity` kind, and is exported from `pr-status-line.tsx`.
- [ ] A-002 R2: `StatusDot` exists in `status-dot.tsx`, renders all 5 PR states reusing `PR_DOT_COLOR`/`PR_DOT_LABEL` (solid ● for live states, hollow ring for neutral), with `aria-label`+`title`.
- [ ] A-003 R3: The activity fallback renders monochrome (gray filled for active, gray hollow ring for idle) with `aria-label`/`title` of "active"/"idle"; no green token on the activity branch.
- [ ] A-004 R4: A fab-failed non-PR window renders the activity dot in `text-red-400`; a fab-failed PR window keeps its `PR_DOT_COLOR`.
- [ ] A-005 R5: The sidebar window row renders exactly one leading `StatusDot` and no separate right-side PR dot block.
- [ ] A-006 R6: The dashboard card renders `StatusDot`, no longer renders the literal activity word in the card's activity span, and keeps the idle duration text.
- [ ] A-007 R7: The pane panel renders `StatusDot` in `headerRight` before `win.name`; the `pr`/`run` detail rows are unchanged.

### Behavioral Correctness

- [ ] A-008 R5: A change-bound-with-PR window's sidebar dot shows PR status (e.g. purple for merged) in the leading position; a non-PR window shows monochrome activity in the same leading position.

### Scenario Coverage

- [ ] A-009 R2: `status-dot.test.tsx` exercises all 5 PR states + activity active/idle + fab-failed red tint + a11y labels and passes via `just test-frontend`.
- [ ] A-010 R5: `window-row.test.tsx` conforms to the single-dot structure and passes.
- [ ] A-011 R6: `dashboard.test.tsx` conforms (asserts the dot's aria-label rather than the removed word) and passes.

### Code Quality

- [ ] A-012 Pattern consistency: `StatusDot` follows the existing dot-rendering technique (border+transparent-fill ring vs. ● glyph) and import/structure conventions of surrounding components.
- [ ] A-013 No unnecessary duplication: the PR-dot rendering and color/label vocabulary are reused (not reimplemented); `prDotState`/`PR_DOT_COLOR`/`PR_DOT_LABEL` are imported, not copied.
- [ ] A-014 Type narrowing over assertions: the `StatusDotState` discriminated union is consumed via `kind` narrowing (no `as` casts).
- [ ] A-015 No new color hex/tokens: only existing tokens (`text-purple-400`, `text-red-400`, `text-yellow-400`, `text-accent-green`, `text-text-secondary`) are used.
- [ ] A-016 Type check + unit tests green: `cd app/frontend && npx tsc --noEmit` passes and `just test-frontend` (scoped to the changed components) passes.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)

## Deletion Candidates

Code this change made redundant or unused (verified against the working tree):

- `window-row.tsx` inline right-side PR-dot IIFE block (former `window-row.tsx:290-306`) — REMOVED in apply. Superseded by the single leading `<StatusDot win={win} />`. Confirmed gone in `git diff HEAD`.
- `window-row.tsx` inline activity dot `<span>` (former `window-row.tsx:251-258`) — REMOVED in apply. Replaced by `<StatusDot win={win} />`.
- `window-row.tsx` imports of `prDotState`, `PR_DOT_COLOR`, `PR_DOT_LABEL` (former line 10) — REMOVED in apply (the diff shows `-import { prDotState, PR_DOT_COLOR, PR_DOT_LABEL }` replaced by `+import { StatusDot }`). No dead/unused import remains in `window-row.tsx`.
- `dashboard.tsx` inline green/gray activity-dot `<span>` + the `{win.activity}` activity word (former `dashboard.tsx:129-140`) — REMOVED in apply. Replaced by `<StatusDot win={win} />` + bare `{duration}` span. This also retired the only remaining `bg-accent-green` activity usage on the dashboard card (the lone surface that rendered activity in green).

No now-dead EXPORTS: `prDotState`, `PR_DOT_COLOR`, `PR_DOT_LABEL` all remain live — consumed by `status-dot.tsx` (`PR_DOT_COLOR`/`PR_DOT_LABEL`) and by `statusDotState` + `pr-status-line.test.tsx` (`prDotState`). The new `statusDotState`/`StatusDotState`/`StatusDot` symbols all have call sites (3 surfaces). Verified via repo-wide grep — zero orphaned exports introduced.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `StatusDot` is a function component taking `{ win: WindowInfo }` returning a single `<span>` element (matching the existing dot markup, no wrapper div) | Intake §2 gives the exact rendering rules and the call sites pass `<StatusDot win={win} />`; the existing dots are bare `<span>`s | S:95 R:85 A:90 D:95 |
| 2 | Certain | Reuse `prDotState`/`PR_DOT_COLOR`/`PR_DOT_LABEL` and the `w-1.5 h-1.5 rounded-full` / `text-xs` glyph classes verbatim from the current `window-row.tsx` PR dot block | Intake §2 says "render exactly as the current sidebar PR dot does today"; constitution forbids magic colors and duplicating utilities | S:95 R:90 A:95 D:95 |
| 3 | Confident | The fab-failed red override on the activity branch reuses the `win.fabDisplayState === "failed" ? "text-red-400" : "text-text-secondary"` ternary from `window-row.tsx:252` | Intake assumption #6 (Confident); preserves existing behavior exactly | S:85 R:85 A:90 D:85 |
| 4 | Confident | Conform `dashboard.test.tsx`'s "shows activity dot and label" test to assert the StatusDot aria-label ("active"/"idle") instead of the in-card activity word, since the word is dropped per R6 | Constitution Test Integrity: tests conform to spec; the removed word would otherwise still pass only via the session-summary line, which is a weaker assertion | S:80 R:90 A:85 D:80 |
| 5 | Confident | The pane-panel `headerRight` wraps `StatusDot` + name in a `flex items-center gap-1.5` span (per intake's exact JSX), keeping the existing `truncate text-text-secondary font-mono` on the name | Intake §5 supplies the exact JSX block | S:90 R:90 A:90 D:90 |

5 assumptions (2 certain, 3 confident, 0 tentative).
