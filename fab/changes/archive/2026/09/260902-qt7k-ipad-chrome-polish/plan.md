# Plan: iPad Chrome Polish — pane-ID leak, coarse-pointer sizing, name redundancy

**Change**: 260902-qt7k-ipad-chrome-polish
**Intake**: `intake.md`

## Requirements

### tmux chrome: Pane-border format

#### R1: Pane border drops the raw pane id
Both arms (active and inactive) of `pane-border-format` in `configs/tmux/default.conf:75` MUST drop the `(#P/#D): ` segment (`#D` expands to the raw `%N` pane id) and replace it with a conditional pane-index prefix rendered only when the window has multiple panes: `#{?#{e|>:#{window_panes},1},#P · ,}` immediately before the existing path segment. The rest of the format (worktree glyph, git branch segment, `pane_current_command` segment, active/inactive color arms) MUST be unchanged.

- **GIVEN** a single-pane window
- **WHEN** the pane border renders
- **THEN** it shows `run-kit.worktrees/quick-ravine` (path segment only) with no pane prefix and no raw `%N` id

- **GIVEN** a window with 2+ panes
- **WHEN** the pane border renders
- **THEN** pane 2's border shows `2 · run-kit.worktrees/quick-ravine`

#### R2: status-left clip resolved by evidence, not assumption
The `<vements` truncation seen in the iPad screenshot MUST be attributed to its actual source before any knob is turned. If the source is `status-left-length 30` (`configs/tmux/default.conf:59`), it SHALL be widened to 40. If the source is tmux's window-list overflow indicator, no config change SHALL be made (that is tmux working as designed).

- **GIVEN** a session whose name exceeds 30 characters
- **WHEN** the status line renders with `status-left-length 30`
- **THEN** the reproduction confirms (or refutes) status-left as the clipping knob, and `status-left-length` is 40 only in the confirmed case

### Frontend: Coarse-pointer gate

#### R3: The three sizing coarse gates switch to `any-pointer: coarse` in lockstep
These three sites — and only these — MUST change from `(pointer: coarse)` to `(any-pointer: coarse)`:
1. `app/frontend/src/globals.css:27` — `@custom-variant coarse (…)` (every Tailwind `coarse:` utility rides this)
2. `app/frontend/src/globals.css:1637` — the raw `@media (pointer: coarse)` bottom-bar-floor block
3. `app/frontend/src/hooks/use-is-mobile.ts:7` — `COARSE_QUERY`

The three MUST stay in lockstep — `evaluateIsMobile()` (narrow OR coarse) and the CSS must not disagree about what "coarse" means. `useCoarsePointer()` (`use-coarse-pointer.ts:8`) and the direct `evaluateMediaQuery("(pointer: coarse)")` calls in `terminal-client.tsx:600,692` MUST remain on the primary-pointer query (see Design Decisions). Before editing, the apply agent SHALL verify the hypothesis (iPadOS Safari reports `pointer: fine` when a trackpad/Magic Keyboard is paired while `any-pointer: coarse` stays true) against platform documentation/behavior and record the outcome; if the hypothesis fails, stop and re-derive rather than shipping the switch blind.

- **GIVEN** a touch-capable device whose primary pointer is fine (iPad with paired trackpad)
- **WHEN** the media queries evaluate
- **THEN** the `coarse:` variant, the bottom-bar-floor block, and `evaluateIsMobile()`'s coarse arm all match (touch sizing applies), because `any-pointer: coarse` is true

- **GIVEN** a fine-pointer-only desktop
- **WHEN** the media queries evaluate
- **THEN** none of the three match — fine-pointer layouts stay byte-identical

#### R4: Test suites conform to the new query
Unit tests and e2e init-script mocks that stub the literal `"(pointer: coarse)"` string to drive `useIsMobile()` or Tailwind-`coarse:`-dependent behavior MUST be updated to also (or instead) answer `"(any-pointer: coarse)"`; stubs that drive `useCoarsePointer()`/`Tip` suppression keep the primary-pointer string. Unit coverage MUST include `evaluateIsMobile()` returning true when only `(any-pointer: coarse)` matches. e2e specs relying on Playwright `hasTouch: true` need no change when Chromium's touch emulation flips `any-pointer: coarse` too — this MUST be verified, not assumed.

- **GIVEN** a matchMedia stub where only `(any-pointer: coarse)` matches
- **WHEN** `evaluateIsMobile()` runs
- **THEN** it returns true

- **GIVEN** the full frontend unit suite and the affected e2e specs after the switch
- **WHEN** they run
- **THEN** they pass with no stub answering a query string no production code asks anymore

### Non-Goals

- The coarse compose placeholder `→ {name}…` — the deliberate sole compose-target indicator on touch (260814-ink6, `compose-strip.tsx:333-350`); do NOT genericize it.
- The top-bar heading `Tab: <name>` (canonical site) and the branch segment `⎇ …` (a different fact).
- Switching `useCoarsePointer()` or its ~10 consumers (bottom-bar existence, compose card mode, Tip/identity-tip suppression, find-bar, chat-view, iframe-window, row-flyout, host-overview) to `any-pointer` — see Design Decisions.
- Token value changes — `TOP_BAR_BUTTON*` sizes are already correct; only the gate changes.
- Web status bar pane display — already renders `pane 1/2 %5` with a raw-id copy affordance.

### Design Decisions

#### Sizing follows any-pointer; capability policies stay on the primary pointer
**Decision**: Only the three sizing/layout coarse gates (Tailwind `coarse:` variant, `COARSE_QUERY` in `useIsMobile`, the bottom-bar-floor media block) switch to `any-pointer: coarse`. `useCoarsePointer()` and `terminal-client.tsx`'s direct touch checks keep `(pointer: coarse)`.
**Why**: Touch-target sizing should apply whenever the device CAN be touched (any-pointer), but hover-capability policies (tooltip suppression, autofocus skip) key on what the primary pointer IS — an iPad with a paired trackpad genuinely hovers, so Tips should show there. This extends the existing "Two pointer policies stay unmerged" decision (visual-design.md): the two hooks answer different questions.
**Rejected**: Switching every `(pointer: coarse)` site wholesale — would suppress tooltips and hide hover affordances on trackpad-paired iPads and touchscreen laptops where hover works; a combined `coarse OR (any-coarse AND narrow)` rule — more moving parts for the same iPad outcome, and the small coarse deltas make the touchscreen-laptop upsizing acceptable.
*Introduced by*: 260902-qt7k-ipad-chrome-polish

#### Conditional pane-index prefix instead of always-on
**Decision**: The pane border shows `#P · ` only when `window_panes > 1`, via `#{?#{e|>:#{window_panes},1},#P · ,}`.
**Why**: The single-pane window is the dominant case; a constant `1 · ` prefix is noise that duplicates nothing useful. The raw pane id stays reachable where it belongs — the web status bar's copy affordance and `tmux display-message -p '#{pane_id}'`.
**Rejected**: Keeping `#P` unconditionally (noise in the common case); keeping `#D` anywhere in the border (the leak this change removes).
*Introduced by*: 260902-qt7k-ipad-chrome-polish

## Tasks

### Phase 1: Investigation

- [x] T001 [P] Audit the coarse-gate hypothesis and the full `(pointer: coarse)` consumer set: confirm iPadOS reports `pointer: fine` with a paired trackpad while `any-pointer: coarse` holds (platform documentation / WebKit behavior); enumerate every `(pointer: coarse)` site in `app/frontend/src` and classify each as sizing (switches) vs capability (stays); confirm Playwright Chromium `hasTouch: true` flips `(any-pointer: coarse)` as well as `(pointer: coarse)`. Record outcomes in this plan's Notes. <!-- R3 -->
- [x] T002 [P] Determine the `<vements` truncation source: reproduce with a >30-char session name on a scratch tmux server using `configs/tmux/default.conf` (`status-left-length 30` at line 59 truncates `#S`; tmux's window-list overflow marker `<` is a different mechanism). Record which knob (if any) applies. <!-- R2 -->

### Phase 2: Core Implementation

- [x] T003 Edit both arms of `pane-border-format` in `configs/tmux/default.conf:75`: replace `  (#P/#D): ` with `  #{?#{e|>:#{window_panes},1},#P · ,}` before the path segment in the active AND inactive arms; leave every other segment untouched. Verify the format renders correctly on a scratch tmux server (single-pane and split-pane windows). <!-- R1 -->
- [x] T004 If (and only if) T002 confirmed status-left as the clip: widen `status-left-length` from 30 to 40 in `configs/tmux/default.conf:59`. Otherwise record the window-list-scroll finding and change nothing. <!-- R2 -->
- [x] T005 Switch the three coarse gates to `any-pointer: coarse` in lockstep: `@custom-variant coarse` at `app/frontend/src/globals.css:27`, the raw `@media (pointer: coarse)` bottom-bar-floor block at `globals.css:1637`, and `COARSE_QUERY` at `app/frontend/src/hooks/use-is-mobile.ts:7`. Do NOT touch `use-coarse-pointer.ts` or `terminal-client.tsx`. <!-- R3 -->

### Phase 3: Integration & Edge Cases

- [x] T006 Update unit-test matchMedia stubs whose stubbed `"(pointer: coarse)"` answer feeds `useIsMobile()`/`evaluateIsMobile()` paths (candidates: `sidebar/index.test.tsx`, `sidebar/window-row.test.tsx`, `sidebar/session-row.test.tsx`, `host-overview-page.test.tsx`, `bottom-bar.test.tsx`, `compose-strip.test.tsx`, `sidebar/index.core.test.tsx`, `row-flyout-card.test.tsx`) — each stub answers the query string(s) the code it exercises now asks; stubs feeding `useCoarsePointer()`/Tip suppression keep `"(pointer: coarse)"`. <!-- R4 -->
- [x] T007 Add unit coverage in `app/frontend/src/hooks/` tests: `evaluateIsMobile()` returns true when only `(any-pointer: coarse)` matches and false when neither narrow nor any-coarse matches; `useIsMobile()` subscribes to the any-pointer query. <!-- R4 -->
- [x] T008 Sweep `app/frontend/tests/e2e/` init-script matchMedia mocks: update any mock of `"(pointer: coarse)"` whose consumer is `useIsMobile()` or CSS `coarse:` (known candidate: `pane-register-panel.spec.ts`) to answer `"(any-pointer: coarse)"`; leave `useCoarsePointer()`-consumer mocks (`tooltips.spec.ts`, `row-flyout.spec.ts`, `mobile-touch-scroll.spec.ts`) alone; confirm `hasTouch`-based specs need no change per T001's Playwright finding. <!-- R4 -->
- [x] T009 Run the gates: `just test-backend` (also exercises `_ensure-tmux-conf` staging of the edited conf; no golden tests assert the conf body — verified), `just test-frontend`, `cd app/frontend && npx tsc --noEmit`, then the affected e2e specs via `just test-e2e "<spec>"` (at minimum `bottom-bar-chip-size`, `bottom-bar-safe-floor`, `pane-register-panel`, `tooltips`). <!-- R1, R3, R4 -->

## Execution Order

- T001 gates T005 (hypothesis verified before the switch) and informs T008.
- T002 gates T004.
- T003/T004 (tmux conf) are independent of T005–T008 (frontend).
- T009 runs last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: Neither arm of `pane-border-format` contains `#D`; both carry the `#{?#{e|>:#{window_panes},1},#P · ,}` prefix before the path segment; all other segments byte-identical to before.
- [x] A-002 R2: The truncation source is recorded in the plan Notes with reproduction evidence; `status-left-length` is 40 iff status-left was the confirmed source, else unchanged at 30.
- [x] A-003 R3: `globals.css:27`, the bottom-bar-floor media block, and `COARSE_QUERY` all read `any-pointer: coarse`; no other production site changed its query.

### Behavioral Correctness

- [x] A-004 R3: `use-coarse-pointer.ts` and `terminal-client.tsx` still use `(pointer: coarse)` — the capability/sizing policy split is intact and recorded.
- [x] A-005 R1: A scratch-server render shows no pane prefix on a single-pane window and `N · ` on a multi-pane window.

### Scenario Coverage

- [x] A-006 R4: A unit test proves `evaluateIsMobile()` is true under an any-pointer-coarse-only stub.
- [x] A-007 R4: Frontend unit suite and the T009 e2e set pass; no test stub answers a query string production code no longer asks (for the paths it exercises).

### Edge Cases & Error Handling

- [x] A-008 R3: Fine-pointer-only environments match none of the three switched gates (desktop layout byte-identical); touchscreen laptops now match (accepted, documented tradeoff).

### Code Quality

- [x] A-009 Pattern consistency: Edits follow surrounding style (tmux conf comment conventions, hook JSDoc style, existing test-stub idioms).
- [x] A-010 No unnecessary duplication: No new hooks/utilities introduced; existing `useMediaQuery` substrate reused.
- [x] A-011 Comment discipline: No comment narrates history or cites change IDs/PR numbers (code-quality.md anti-pattern; provenance lives in git/memory).

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- `app/backend/build/tmux.conf` is gitignored and staged by `just _ensure-tmux-conf` — the canonical source is the only file to edit.

### T001 outcome — coarse-gate hypothesis CONFIRMED

- **iPadOS hypothesis**: Confirmed by specification + observed behavior. Media Queries L4 defines `pointer` as the PRIMARY pointing mechanism only, `any-pointer` as ANY available mechanism (MDN `@media/pointer`, `@media/any-pointer`). On iPadOS, pairing a trackpad/Magic Keyboard makes the primary pointer fine, so `(pointer: coarse)` stops matching while `(any-pointer: coarse)` stays true (the touchscreen is still present). The user's screenshot is itself the empirical proof: the iPad rendered the 28px fine-pointer sizes (the `coarse:` variant did not apply) even though the device is touch-capable.
- **Consumer classification** (every `(pointer: coarse)` site in `app/frontend/src`): SIZING (switch to `any-pointer: coarse`): `globals.css:27` (`@custom-variant coarse`), `globals.css:1637` (bottom-bar-floor block), `hooks/use-is-mobile.ts:7` (`COARSE_QUERY`). CAPABILITY (stay on primary pointer): `hooks/use-coarse-pointer.ts:8`, `components/terminal-client.tsx:600` and `:692`. Comment-only mentions (no query string, remain accurate): `tip.tsx:41`, `sidebar/identity-tip.tsx:30`, `bottom-bar.tsx:357`.
- **Playwright `hasTouch: true`**: Verified empirically (Chromium probe, this worktree, 2026-09-03): default context → `pointer:coarse=false, pointer:fine=true, any-pointer:coarse=false`; `hasTouch: true` → `pointer:coarse=true, any-pointer:coarse=true` (fine arms false). So `hasTouch`-based e2e specs flip BOTH queries and need no change.

### T002 outcome — `<vements` is the window-list overflow indicator; status-left-length NOT the knob

Reproduced on a scratch tmux 3.7c server (isolated `TMUX_TMPDIR`) running `configs/tmux/default.conf`, 60-col client:

- Session name > 30 chars, window list fits: status-left renders ` qt7k-improvements-investigati` — exactly `status-left-length 30` chars, **truncated from the right with NO `<` marker** (keeps the beginning of `#S`).
- Same session, 8 long-named windows, current window last: status line renders ` qt7k-improvements-investigati<:improvements-window-> 00:29` — the `<` is tmux's window-list **left-overflow marker**, and the first partially-visible window entry is **clipped mid-name from its left edge** (`7:improvements-window-7` → `<:improvements-window-`).

`<vements` in the iPad screenshot is this second mechanism: `<` + the tail of a window name ending in `…vements` clipped by the overflow marker. That is tmux working as designed → **no config change (T004 widens nothing; `status-left-length` stays 30)**.

## Deletion Candidates

- None — this change replaces query strings and format segments in place; no existing symbol, file, or branch became unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | iPadOS Safari reports `pointer: fine` with a paired trackpad/Magic Keyboard while `any-pointer: coarse` stays true | Documented WebKit/iPadOS behavior; T001 re-verifies before the switch rather than shipping blind | S:65 R:75 A:70 D:70 |
| 2 | Confident | `useCoarsePointer()` and terminal-client touch checks stay on the primary-pointer query | Extends the existing "Two pointer policies stay unmerged" memory decision; hover genuinely works when the primary pointer is fine <!-- assumed: capability policies keep pointer: coarse — revisit if iPad users report missing bottom bar with trackpad paired --> | S:60 R:80 A:75 D:65 |
| 3 | Tentative | `status-left-length` 30 → 40 only after T002 confirms status-left as the clipping knob | Carried from intake — the screenshot cannot distinguish the truncation source <!-- assumed: widen status-left-length only after confirming it is the clipping knob --> | S:45 R:90 A:55 D:50 |
| 4 | Certain | No backend golden test asserts the embedded conf body | Verified in this worktree: `build/tmux.conf` is gitignored; grep over `*_test.go` finds no pane-border/status-left content assertions | S:85 R:90 A:95 D:90 |

4 assumptions (1 certain, 2 confident, 1 tentative).
