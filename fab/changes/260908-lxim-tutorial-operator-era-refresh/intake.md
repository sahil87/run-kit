# Intake: Tutorial Operator-Era Refresh

**Change**: 260908-lxim-tutorial-operator-era-refresh
**Created**: 2026-09-08

## Origin

Promptless dispatch (`/fab-proceed` create-new, `{questioning-mode} = promptless-defer`) from a user conversation that walked the tutorial against the current product and confirmed each decision below. The synthesized description:

> Refresh the run-kit guided tutorial — the driver skill `app/backend/cmd/rk/skill/tutorial.md` and its companion page `app/frontend/public/tutorial/tutorial.html` — which predates the operator-console work (PRs #839/#866/#870), plus fix the pager placement and compress the wording. User-confirmed decisions: (1) pager moves to a slim fixed strip at the TOP of the page; (2) Chapter 3 is rewritten around the ⌘J quake console + top-bar omnibox; (3) the operator-less fallback becomes starting the operator via `rk operator`; (4) the operator is framed as the spine — Chapter 5's lasting habit is the pair "⌘J to ask, ⌘K to find", plus one mobile tongue line; (5) every mock's `Tab: <name>` heading becomes `Terminal: <name>` *(superseded in review — live chrome is deliberately `Tab:`, so mocks keep it and the stale `fab/project/context.md` claim was corrected instead; see plan R2)*; (6) a compression pass sheds ~30–40% of words from the greeting and chapter beats without losing any user action or signal, and HTML legend items become single-line.

All decisions were user-confirmed in conversation; no interactive questions were possible in this dispatch mode.

## Why

1. **The tutorial teaches a superseded interaction.** Chapter 3's flagship move — "click into the operator's pinned row and ask" — predates the operator console (changes 260904-qa85 through 260908-aumn; PRs #839/#866/#870). The product's flagship is now **⌘J** (⇧Ctrl+J on Win/Linux): the quake drawer that slides under the top bar on any route, with the top-bar omnibox ("Ask ◉…") as the input. A first-run tour that skips the product's best move undersells it and trains the slow path.
2. **The pager is hard to find.** `tutorial.html` renders inside a web tile beside a terminal, so the `position:fixed` bottom pager (`.pager`, ~line 109) sits at an edge the user rarely sees — the tile is short and interior scroll hides the bottom strip. Chapter navigation is the page's one interactive element; it must be visible without hunting.
3. **The fallback contradicts the product's own posture.** "No operator — I'll hire directly this time" routes around the operator instead of standing it up, while the dashboard's own empty state says `no operator on this server — run rk operator`. The tutorial should do what the product tells users to do.
4. **The copy is too long.** The user wants "less words, more info" — a short but impactful tour. The audience posture (first-time user, assume PM, teach through their actions, degrade never error) is right and stays; the word count per beat is not.

If unfixed: every new user's first ten minutes teach a stale mental model of the operator, and the tour reads as slower and wordier than the product it sells.

## What Changes

Two primary files — the skill topic (canonical `docs/site/skill/tutorial.md`, embedded copy `app/backend/cmd/rk/skill/tutorial.md`, kept byte-identical via `scripts/sync-skill.sh`) and the companion page `app/frontend/public/tutorial/tutorial.html` — plus the drift-guard tests in `app/backend/cmd/rk/skill_test.go` must stay green (they should need no edits; see Impact).

### 1. Pager moves to the top (tutorial.html)

- `.pager` changes from `position:fixed; left:0; right:0; bottom:0; border-top:1px solid var(--border)` to a slim fixed strip at the TOP: `top:0` with `border-bottom` replacing `border-top` (same `z-index:50`, background `#07080c`, same padding scale).
- The body padding swaps its bottom clearance for top clearance: current `body{padding:22px 22px 76px}` becomes top-padded by the equivalent ~76px (e.g. `padding:76px 22px 22px`) so the strip never overlaps the chapter `h1`.
- Controls unchanged: `‹ Back`, `Chapter N of 5`, progress dots, `Next ›` — same IDs (`pg-back`, `pg-label`, `pg-dots`, `pg-next`), same JS. The `window.scrollTo(0,0)` on chapter show remains correct (the pager is now at the scroll origin).

### 2. Chapter 3 rewritten around the operator console (both files)

The flagship interaction is **⌘J** (⇧Ctrl+J on Win/Linux): the quake drawer slides down under the top bar on ANY route; the top-bar omnibox ("Ask ◉…") is the one input; the drawer is output-only and shows the operator's live reply. Facts grounded in `docs/memory/run-kit/ui/operator-console.md` (the ⌘J two-state machine, the omnibox, the one-input rule, availability hint) — every claim in the rewrite must trace to that file or `app/backend/cmd/rk/operator.go`.

- **Skill md (ch3 beat)**: teach — press ⌘J anywhere; the console drops down; type the hire request into the omnibox ("Ask ◉…" in the top bar); Enter sends; watch the operator's reply right in the drawer; ⌘J (or Esc) tucks it away. The worker's brief (the one-question + present + notify script) is unchanged. The "click into the operator's pinned row" teaching is replaced; the pinned row may get at most a passing mention as where the operator lives, not as the taught path.
- **HTML ch3 mock**: replace the navigated-to operator window view (`Tab: operator` heading + full-tile operator terminal) with the quake drawer + omnibox over the current route: top bar shows heading `Terminal: tutorial` alongside the omnibox box containing the typed hire request; below the bar a drawer overlay (glass over the dimmed page) shows the operator's reply ("Hiring… opened window tour-worker · started the agent · briefed it"); the sidebar keeps the pinned `operator` row and the new busy `tour-worker` row. Callouts/legend re-anchor to: the ⌘J chord, the omnibox, the drawer reply, the two-busy-rows payoff.
- **Skill md ch3 preflight probe** (Preflight step 3): the existing `tmux list-windows -a -F '#{window_id} #{@rk_win_role}' | grep -w operator` already matches rk's primary convention (`@rk_win_role=operator`); extend the format with `#{window_name}` so the exact-name `operator` fallback that `findOperatorWindowID` (operator.go) honors is also detected: `tmux list-windows -a -F '#{window_id} #{@rk_win_role} #{window_name}' | grep -w operator || true`.

### 3. Operator-less fallback = start the operator (skill md)

Replace the "no operator — normally you'd ask the operator; I'll hire directly this time" fallback (`rk tab new --name tour-worker` + manual agent start) with starting the operator:

- Run `rk operator` — a per-tmux-server singleton window named `operator` (role-marked `@rk_win_role=operator`, pinned in the sidebar), which boots the operator agent and types `/fab-operator` into it. The tutorial agent runs inside tmux already (the gate guarantees `$TMUX_PANE`), satisfying precondition one.
- Degrade with ONE line if fab is absent: `rk operator` hard-fails (exit 1) without fab on PATH — say so in one sentence ("the operator needs the fab toolkit; I'll hire directly this time") and fall back to the current direct-hire path. This matches the product's own empty-state hint (`no operator on this server — run rk operator`) and operator.go's documented preconditions.
- After the operator boots, the taught path resumes: ⌘J, ask in the omnibox.

### 4. Operator as the spine; Chapter 5 habit pair (both files)

- Frame across the tour (greeting + ch3 + ch5) that everything can be driven by the operator; keep it light — one clause each, not a new section.
- Chapter 5's lasting habit becomes the PAIR: **⌘J to ask, ⌘K to find** (⇧Ctrl+J / ⇧Ctrl+K on Win/Linux). The skill md's ch5 closer and the recap line change accordingly (recap currently says "the operator hires; ⌘K finds everything" — becomes the ⌘J/⌘K pair phrasing).
- HTML ch5: add a ⌘J row/keycap to the palette mock area (e.g. a sibling row/keycap beside the existing `⌘K / Ctrl+Shift+K` kbd hint — "⌘J ask the operator · ⌘K find any action").
- One mobile line (skill md ch5, optionally a short ch5 legend line): on phones the **tongue** — the pull tab under the top bar — takes you to the operator (mobile has no drawer; the tab navigates to the operator's own window per the mobile-navigation design).

### 5. Mock accuracy: `Tab:` → `Terminal:` (tutorial.html) — SUPERSEDED

> **Superseded during review (plan R2 rework, cycle 1)**: the live heading prefix is deliberately the static `Tab:` (`WINDOW_PREFIX` in top-bar.tsx, change 260714-uco1); this section's premise came from a stale `fab/project/context.md` claim. The shipped change keeps `Tab:` in every mock and corrects context.md instead.

Original (not implemented): the real top-bar chrome heading is `Terminal: <window>` (`PageType: name` — fab/project/context.md § top bar). Fix all four occurrences of `<span class="prefix">Tab:</span>` (ch1 "tutorial", ch2 "tutorial", ch3 "operator" — superseded by the ch3 rewrite anyway, ch4 "tour-worker") to `Terminal:`.

### 6. Compression pass (both files)

- Skill md: greeting and chapter beats shed roughly 30–40% of words. Hard floor: no user action, signal name (waiting halo, ⚠ badge, "present it to me", next/skip/stop), degradation line, or chapter-hash `rk present` call may be lost. The pacing/failure-posture rules and the audience posture paragraph stay (may tighten, not change meaning).
- tutorial.html: legend items become single-line each; `.sub` lines and `.try` boxes tighten similarly.
- The five `rk present "$RK/tutorial/tutorial.html#chN"` invocations, the `#ch1..#ch5` section ids, the `hashchange` listener (load-bearing: an iframe src change differing only by hash does not reload — its comment stays), and the `rk tab layout split-h:tty,web` literal are all preserved verbatim.

## Affected Memory

None — this is a content-level rewrite of the tutorial topic and its companion page. The memory rows that describe tutorial MECHANICS are all preserved by this change and need no edit: `run-kit/architecture` (§ CLI Subcommands `tutorial`/`skill` rows — test names, embed/sync contract, single-page + hash guard), `run-kit/toolkit-standards` (skill line budget, help-dump), and `run-kit/ui/lenses-and-layout` (the `/tutorial/tutorial.html#chN` hash-addressed web-tab note). No spec-level behavior changes.

## Impact

- `docs/site/skill/tutorial.md` — the canonical source; edit here first (constitution § Toolkit Standards binds docs/site/ changes to the shll `skill` standard — the 150-line budget is its enforced form).
- `app/backend/cmd/rk/skill/tutorial.md` — the committed embed copy; regenerate with `scripts/sync-skill.sh` (byte-identical or `TestSkillTopicsMatchCanonical` fails).
- `app/frontend/public/tutorial/tutorial.html` — pager CSS/placement, ch3 mock rebuild, ch5 keycap addition, `Tab:`→`Terminal:`, legend compression. (Already tracked — the git-pr untracked-`public/` guard only bites NEW files.)
- `app/backend/cmd/rk/skill_test.go` — expected NO edit; the guards constrain the content instead: `TestTutorialPagesMatchTopic` (topic must reference `tutorial/tutorial.html#ch1..#ch5` and no other tutorial page may ship), `TestSkillTopicsMatchCanonical` (embed = canonical), `TestSkillTopicsWithinLineBudget` (≤150 lines; currently 89, compression only helps), `TestTutorialLayoutValuesParse` (every `rk tab layout <literal>` in the topic must parse — keep `split-h:tty,web`).
- Verification scope: `cd app/backend && go test ./cmd/rk/ -run 'TestSkillTopics|TestTutorial'` plus a browser (or `rk present`) sanity pass of the page at each `#chN` hash. No frontend src, no e2e specs touch the tutorial page.

## Open Questions

None — promptless dispatch; would-be questions are recorded as Unresolved rows in Assumptions (there are none: every scope decision was user-confirmed in the source conversation).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Pager becomes a fixed TOP strip; body's 76px bottom padding swaps to equivalent top padding; controls/IDs/JS unchanged | Discussed — user chose top placement explicitly over bottom | S:95 R:90 A:95 D:95 |
| 2 | Certain | Chapter 3 teaches ⌘J + omnibox as the flagship; ch3 mock shows the quake drawer + omnibox over the current route, not a navigated-to operator view | Discussed — user-confirmed; grounded in ui/operator-console.md (⌘J machine, one-input rule) | S:95 R:85 A:90 D:90 |
| 3 | Certain | Operator-less fallback becomes `rk operator`, with a one-line direct-hire degrade only when fab is absent | Discussed — user-confirmed; verified against operator.go preconditions (tmux + fab hard, exit 1) and the product's empty-state hint | S:95 R:90 A:95 D:90 |
| 4 | Certain | Chapter 5 habit is the pair "⌘J to ask, ⌘K to find"; ch5 mock gains a ⌘J row/keycap; one mobile tongue line | Discussed — user-confirmed | S:90 R:90 A:90 D:90 |
| 5 | Certain | All four mock headings `Tab:` → `Terminal:` | Discussed — user-confirmed; context.md claim later found stale: superseded in review (mocks keep `Tab:`, context.md corrected — plan R2) | S:95 R:95 A:100 D:100 |
| 6 | Certain | Compression: −30–40% words on greeting + beats, single-line legend items; no user action, signal, degradation, or hash contract lost | Discussed — user set the target band and the "less words, more info" bar | S:85 R:85 A:80 D:80 |
| 7 | Confident | Ch3 preflight probe gains `#{window_name}` in the list-windows format so the exact-name fallback operator.go honors is also detected | Description said "verify against operator.go"; verified — role match already correct, name fallback missing; one-token, easily reversed | S:70 R:85 A:85 D:75 |
| 8 | Certain | Edit flow: canonical docs/site/skill/tutorial.md first, sync to embed via scripts/sync-skill.sh; five `#chN` references, ≤150 lines, and the `split-h:tty,web` layout literal preserved; skill_test.go untouched | Determined by the drift-guard tests read during intake (TestSkillTopicsMatchCanonical, TestTutorialPagesMatchTopic, TestSkillTopicsWithinLineBudget, TestTutorialLayoutValuesParse) | S:85 R:90 A:100 D:95 |
| 9 | Confident | change_type = `chore` | Same class as predecessor 260904-00zd-tutorial-polish-chapter-merge (explicit `chore`); docs-flavored content work, no feature surface | S:75 R:95 A:85 D:80 |
| 10 | Confident | Ch3 mock depicts the drawer over the tutorial window's route (`Terminal: tutorial`) with the pinned operator row still visible in the sidebar | Design detail below the asking threshold; "over the current route" was the user's phrase and the tutorial window is the tour's current route | S:75 R:90 A:85 D:80 |
| 11 | Confident | The greeting's notifications-bell ask survives compression verbatim in intent | Chapter 4's push beat depends on it; compression floor rule covers it | S:80 R:90 A:90 D:85 |

11 assumptions (7 certain, 4 confident, 0 tentative, 0 unresolved).
