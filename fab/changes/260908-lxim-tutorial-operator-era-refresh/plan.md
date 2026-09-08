# Plan: Tutorial Operator-Era Refresh

**Change**: 260908-lxim-tutorial-operator-era-refresh
**Intake**: `intake.md`

## Requirements

### Tutorial Page: Navigation & Chrome Accuracy

#### R1: Pager renders as a fixed top strip
The `.pager` in `app/frontend/public/tutorial/tutorial.html` MUST be a slim fixed strip at the TOP of the viewport (`top:0`, `border-bottom` replacing `border-top`; same `z-index:50`, background, and padding scale), with the body's bottom clearance (`padding:22px 22px 76px`) swapped for equivalent top clearance so the strip never overlaps the chapter `h1`. Controls, element IDs (`pg-back`, `pg-label`, `pg-dots`, `pg-next`), and the pager JS MUST be unchanged.

- **GIVEN** the page open at any `#chN` hash in a short web tile
- **WHEN** it renders
- **THEN** ‹ Back / Chapter N of 5 / dots / Next › are visible at the top without scrolling
- **AND** the chapter heading is not overlapped

#### R2: Mock headings match live chrome (`Tab:`)
Every mock top-bar heading prefix MUST match the product's real chrome, which is deliberately the static `Tab:` (`WINDOW_PREFIX = "Tab:"` in `app/frontend/src/components/top-bar.tsx`, change 260714-uco1 — the heading names the window substrate, not the lens). The mocks KEEP their `Tab:` prefixes; no `Terminal:` prefix may ship. The stale `Terminal: <window>` claim in `fab/project/context.md` (§ top bar bullet) MUST be corrected to `Tab: <window>` so future changes don't repeat the error.
<!-- rework: cycle 1 — original R2 mandated Tab:→Terminal: based on stale context.md prose; reviewer verified live chrome is deliberately Tab: -->

- **GIVEN** any chapter mock with a top-bar heading
- **WHEN** inspected
- **THEN** the prefix span reads `Tab:` and no `Terminal:` heading prefix remains in tutorial.html
- **AND** `fab/project/context.md` describes the terminal heading as `Tab: <window>`

### Tutorial Content: Operator Console Era

#### R3: Chapter 3 teaches ⌘J + omnibox as the flagship
The skill topic's Chapter 3 MUST teach the operator console as the hire path: press **⌘J** (⇧Ctrl+J on Win/Linux) on any route → the quake drawer slides down under the top bar → type the hire request into the top-bar omnibox ("Ask ◉…") → Enter sends → the operator's reply appears live in the drawer → ⌘J or Esc tucks it away. The "click into the operator's pinned row" teaching is replaced (the pinned row MAY get a passing where-it-lives mention). The worker's brief (one question first, then present + notify) is unchanged. Every console claim MUST trace to `docs/memory/run-kit/ui/operator-console.md` or `app/backend/cmd/rk/operator.go`.

- **GIVEN** a user at Chapter 3 with an operator present
- **WHEN** the chapter runs
- **THEN** the user hires the worker via ⌘J + omnibox, never by navigating into the operator window

#### R4: Operator-less fallback starts the operator
When Preflight finds no operator, Chapter 3 MUST run `rk operator` (per-server singleton window, role-marked `@rk_win_role=operator`, pinned in the sidebar; boots the agent and types `/fab-operator`), then resume the ⌘J path. If fab is absent (`rk operator` exits 1), degrade in ONE line and fall back to the direct-hire path (`rk tab new` + start the agent). The Preflight probe MUST detect exactly what operator.go's singleton probe honors — role `@rk_win_role == operator` OR window name `== operator`, both EXACT matches (no substring/word matching, so `operator-old` never false-positives): `tmux list-windows -a -f '#{||:#{==:#{@rk_win_role},operator},#{==:#{window_name},operator}}' -F '#{window_id} #{window_name}' || true`.
<!-- rework: cycle 2 — the widened grep -w probe false-matched names like operator-old; replaced with tmux's own exact-match filter -->

- **GIVEN** a server with no operator window and fab on PATH
- **WHEN** Chapter 3 reaches the hire beat
- **THEN** the tutorial agent runs `rk operator`, the pinned row appears, and the user hires via ⌘J
- **AND GIVEN** fab absent, **THEN** one degrade line and the direct-hire fallback

#### R5: Chapter 3 mock shows the quake console over the current route
The ch3 HTML mock MUST depict the drawer + omnibox over the tutorial window's own route: top bar heading `Tab: tutorial` beside an omnibox containing the typed hire request; a glass drawer below the bar showing the operator's reply ("Hiring… opened window tour-worker · started the agent · briefed it"); the sidebar keeping the pinned `operator` row and the new busy `tour-worker` row. Callouts/legend re-anchor to: the ⌘J chord, the omnibox, the drawer reply, the two-busy-rows payoff.

- **GIVEN** the page at `#ch3`
- **WHEN** it renders
- **THEN** the mock shows the drawer over `Tab: tutorial`, not a navigated-to operator window view

#### R6: Operator as the spine; ⌘J/⌘K habit pair; mobile tongue
The greeting, ch3, and ch5 MUST each carry (one clause, not a section) that everything can be driven by the operator. Chapter 5's lasting habit MUST be the pair **⌘J to ask, ⌘K to find** (⇧Ctrl+J / ⇧Ctrl+K on Win/Linux) — recap phrasing updated accordingly. The ch5 HTML mock MUST gain a ⌘J keycap/row beside the existing ⌘K hint. One mobile line (skill md ch5): on phones the **tongue** — the pull tab under the top bar — takes you to the operator.

- **GIVEN** a user finishing Chapter 5
- **WHEN** the recap lands
- **THEN** it names the ⌘J/⌘K pair and the mobile tongue in the user's words

### Tutorial Content: Compression & Contracts

#### R7: Compression pass with a preservation floor
Both files MUST shed words — the skill md's greeting and chapter beats by roughly 30–40%, HTML legend items to single lines, `.sub`/`.try` copy tightened — while preserving verbatim-in-intent: every user action, signal name (waiting halo, ⚠ badge, "present it to me", next/skip/stop), degradation line, the notifications-bell ask, the audience-posture paragraph, the five `rk present "$RK/tutorial/tutorial.html#chN"` calls, the `#ch1..#ch5` section ids, the `hashchange` listener and its load-bearing comment, and the `rk tab layout split-h:tty,web` literal.

- **GIVEN** the rewritten topic and page
- **WHEN** compared against the current versions
- **THEN** the word count is materially lower and no floor item is missing

#### R8: Canonical/embed parity and drift guards stay green
Edits land in canonical `docs/site/skill/tutorial.md` first and are synced to `app/backend/cmd/rk/skill/tutorial.md` via `scripts/sync-skill.sh` (byte-identical). `skill_test.go` is NOT edited; `TestSkillTopicsMatchCanonical`, `TestTutorialPagesMatchTopic`, `TestSkillTopicsWithinLineBudget` (≤150 lines), and `TestTutorialLayoutValuesParse` MUST pass.

- **GIVEN** the completed edits
- **WHEN** `go test ./cmd/rk/ -run 'TestSkillTopics|TestTutorial'` runs in app/backend
- **THEN** all four guards pass with no test-file changes

### Non-Goals

- No frontend src, e2e spec, or backend behavior changes — content-level rewrite only
- No new tutorial pages (the single-page + hash contract stays)
- No memory or spec edits (Affected Memory: none)

## Tasks

### Phase 2: Core Implementation

- [x] T001 Rewrite `docs/site/skill/tutorial.md`: ch3 → ⌘J + omnibox flagship with `rk operator` fallback and the exact-match preflight probe (revised R4); operator-as-spine clauses (greeting/ch3/ch5); ch5 ⌘J/⌘K habit pair + mobile tongue line + recap rewrite; 30–40% compression with the R7 preservation floor <!-- R3, R4, R6, R7 --> <!-- rework: cycle 1 — compression missed; cycle 2 — preflight probe swaps to the exact-match tmux filter -->
- [x] T002 Run `scripts/sync-skill.sh` to regenerate the byte-identical embed `app/backend/cmd/rk/skill/tutorial.md` <!-- R8 --> <!-- rework: cycle 2 — re-sync after T001 probe fix -->
- [x] T003 [P] Edit `app/frontend/public/tutorial/tutorial.html` chrome: `.pager` to fixed top strip + body padding swap (+ `scroll-margin-top:76px` on `.chapter` so the initial fragment scroll clears the strip); heading prefixes STAY `Tab:` per revised R2 (revert the shipped `Terminal:` swap); legend items single-line, `.sub`/`.try` tightened <!-- R1, R2, R7 --> <!-- rework: cycle 1 — R2 inverted; revert Terminal: back to Tab: -->
- [x] T004 [P] Rebuild `app/frontend/public/tutorial/tutorial.html` ch3 mock as quake drawer + omnibox over `Tab: tutorial` (callouts/legend re-anchored); add ch5 ⌘J keycap beside the ⌘K hint + tongue legend line <!-- R5, R6 --> <!-- rework: cycle 1 — heading prefix reverts to Tab: -->
- [x] T006 Correct the stale `Terminal: <window>` heading claim in `fab/project/context.md` (§ top bar) to `Tab: <window>` <!-- R2 --> <!-- rework: cycle 1 — added; the stale doc caused the original R2 error -->

### Phase 3: Verification

- [x] T005 Run `cd app/backend && go test ./cmd/rk/ -run 'TestSkillTopics|TestTutorial'`; sanity-check the page renders each `#chN` with the top pager (open the file or `rk present`) <!-- R8 --> <!-- rework: cycle 1 — re-verify after rework edits -->

## Execution Order

- T001 blocks T002 (sync copies the canonical)
- T003/T004 are independent of T001/T002 (different files); T005 runs last

## Acceptance

### Functional Completeness

- [x] A-001 R1: The pager is a fixed top strip (top:0, border-bottom) with body top clearance; IDs and JS unchanged
- [x] A-002 R3: Chapter 3's taught hire path is ⌘J + omnibox; no beat instructs navigating into the operator window
- [x] A-003 R4: The operator-less path runs `rk operator` with the one-line fab-absent degrade; the preflight probe exact-matches role OR window name `operator` (never `operator-old`-class names)
- [x] A-004 R5: The ch3 mock renders the drawer + omnibox over `Tab: tutorial` with pinned operator + busy tour-worker rows
- [x] A-005 R6: Ch5 carries the ⌘J/⌘K habit pair (md + mock keycap), the mobile tongue line, and the updated recap

### Behavioral Correctness

- [x] A-006 R2: All mock headings read `Tab:` (no `Terminal:` prefix in tutorial.html) and `fab/project/context.md` describes the heading as `Tab: <window>`
- [x] A-007 R7: Every R7 floor item is present verbatim-in-intent in the rewritten files; the canonical's greeting-through-Chapter-5 region sheds roughly 30–40% of its 914-word baseline

### Scenario Coverage

- [x] A-008 R8: `go test ./cmd/rk/ -run 'TestSkillTopics|TestTutorial'` passes with skill_test.go untouched
- [x] A-009 R1: Manual render check at each `#chN` hash shows the top pager and unobstructed heading

### Code Quality

- [x] A-010 Pattern consistency: HTML/CSS edits follow the page's existing var-token + class idioms; md edits keep the topic's voice and structure
- [x] A-011 No unnecessary duplication: the ch3 mock reuses existing classes (`.app`, `.topbar`, `.tty`, callout/legend) rather than introducing parallel ones

## Notes

- Check items as you review: `- [x]`
- change_type is `chore` — review's parsimony pass and deletion-candidate prompt are skipped by rule
- A-007 measurement convention: the greeting→ch5 region carries ~70 structural words that cannot compress (five chapter headings + five verbatim `rk present` fences, all R7 floor items); "roughly 30–40%" is judged on the region including them (baseline 914), with the prose-only cut as the tiebreaker when the region lands within a point or two of 30%

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Top clearance implemented as `body{padding:76px 22px 22px}` (pager measured ~44px + margin), adjusted only if the strip renders taller | Intake fixed ~76px equivalence; exact value is a render detail, trivially reversible | S:80 R:95 A:90 D:85 |
| 2 | Confident | Ch3 mock's drawer drawn with a new small `.console` class cluster (glass panel + omnibox box) since no existing mock class depicts an overlay drawer; reuses tokens/idioms | Existing classes cover tiles/palettes, not a drawer; one scoped cluster is the minimal addition | S:75 R:90 A:85 D:80 |
| 3 | Confident | Ch5 ⌘J keycap lands in the existing palette mock's footer row as a second kbd hint line | Intake said "sibling row/keycap beside the existing ⌘K kbd hint" | S:80 R:95 A:90 D:85 |
| 4 | Confident | Correcting context.md's stale `Terminal: <window>` heading claim is in scope (one bullet edit) despite the intake's two-file framing | The stale doc caused the cycle-1 must-fix; leaving it invites the same error in every future change | S:70 R:95 A:90 D:85 |

4 assumptions (0 certain, 4 confident, 0 tentative).
