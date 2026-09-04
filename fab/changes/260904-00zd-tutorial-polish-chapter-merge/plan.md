# Plan: Tutorial polish — naming consistency, single sewn companion page, Act→Chapter terminology

**Change**: 260904-00zd-tutorial-polish-chapter-merge
**Intake**: `intake.md`

## Requirements

### Tutorial Companion: Single sewn page

#### R1: One hash-routed companion page replaces the five per-act pages
`app/frontend/public/tutorial/tutorial.html` MUST be a single, static, self-contained page (dark, monospace — the existing pages' visual language) containing five chapter sections routed by URL hash (`#ch1`…`#ch5`), with only the active chapter visible. It MUST carry a bottom navigation bar — `‹ Back · Chapter N of 5 · Next ›` plus a five-dot chapter indicator — where Back is inert on ch1 and Next is inert on ch5 (no wrap). The page JS MUST honor both the initial `location.hash` on load and later `hashchange` events (an iframe `src` change differing only by hash may not reload the document), MUST default to `#ch1` on a missing or unknown hash, and MUST update `document.title` to the active chapter's `Chapter N · …` wording. The five old `chN-*.html` files MUST be deleted (no redirect stubs). The shared ~80% of the five pages' CSS MUST be deduplicated into one style block; each chapter keeps its current content (h1, mock app frame, legend, "try it" box) as amended by R2/R3.

- **GIVEN** the merged page is loaded with no hash (or an unknown hash like `#ch9`)
- **WHEN** it renders
- **THEN** chapter 1 is shown, the nav reads `Chapter 1 of 5` with Back inert, and `document.title` is chapter 1's wording

- **GIVEN** the page is already loaded in an iframe showing `#ch2`
- **WHEN** the iframe `src` is re-set to the same URL with `#ch3` (the skill's `rk present` reuse path)
- **THEN** the `hashchange` handler switches the visible section to chapter 3 without requiring a document reload

#### R2: Mock content teaches the real product vocabulary
Within the merged page's chapter sections, the mock UI MUST match the shipped product: (a) every `tour-guide` window reference becomes `tutorial` (top-bar headings, sidebar rows, terminal tile headers, ch5 phone roster; legend prose adjusts, e.g. "the tutorial agent") — the real window is hard-named `tutorial` (`tutorialWindowName`, `app/backend/cmd/rk/tutorial.go`); (b) waiting signals use the real pair — a waiting **window row** shows only the halo'd yellow status dot (mimicking `rk-waiting-halo`; no text pill — the `?` pill in ch1 and `needs you` pills in ch4's sidebar and ch5's phone roster are dropped) and the **session row** above a waiting window gains a `1 ⚠` signal-yellow rollup badge (mimicking `waiting-badge.tsx`'s `{count}⚠`), with legends teaching both (dot halo = this window needs you; `N ⚠` on the session row = how many windows under it are waiting); (c) the ch5 palette hint becomes `⌘K / Ctrl+Shift+K` (the real Win/Linux chord, `command-palette-alt` in `keybindings.ts`); (d) ch2's mock web-tab strip shows a single `tutorial` tab (the one-tab reality) instead of "tour pages…"; (e) the ch3 mock operator transcript includes naming the window (`call it tour-worker`) to match R3's ask.

- **GIVEN** the merged page's five sections
- **WHEN** grepping the repo for `tour-guide`
- **THEN** there are zero matches anywhere

- **GIVEN** the ch1 and ch4 sections' mock sidebars
- **WHEN** a row is in the waiting state
- **THEN** the window row shows a yellow halo dot with no text pill, and the session row shows a `1 ⚠` yellow badge

### Tutorial Skill Text: Chapter terminology and one-tab presents

#### R3: Skill text presents the single page and says Chapter
Both synced copies of the tutorial topic (`app/backend/cmd/rk/skill/tutorial.md` and `docs/site/skill/tutorial.md`) MUST be edited identically and remain byte-identical: the five `rk present "$RK/tutorial/chN-….html"` invocations become `rk present "$RK/tutorial/tutorial.html#chN"`; every "Act" reference becomes "Chapter" (section headings `## Act N — …`, the greeting's "five acts in about ten minutes" and "in Act 4", the Preflight's "before Act 2"/"before Act 3", the ch1 body's "Act 4 triggers it for real", pacing prose "one act per reply" / "`skip` advances one act"); and the Chapter 3 operator-path suggested ask gains the window name ("…in a new window — call it tour-worker — …"). The topic MUST stay within the 150-line budget. Plural "tour pages" phrasing, if present, is swept.

- **GIVEN** the two topic files after the edit
- **WHEN** compared with `cmp`
- **THEN** they are byte-identical, contain five `tutorial.html#chN` present invocations, no `ch\d-[a-z-]+\.html` references, and no standalone "Act N" wording

#### R4: `rk tutorial` help text says chapter
`app/backend/cmd/rk/tutorial.go`'s `Long:` help text MUST say "chapter by chapter" instead of "act by act". No other behavior of the command changes.

- **GIVEN** `rk tutorial --help`
- **WHEN** rendered
- **THEN** the description reads "walks you through run-kit chapter by chapter"

### Test Guards

#### R5: `TestTutorialPagesMatchTopic` guards the single-page shape
`app/backend/cmd/rk/skill_test.go`'s `TestTutorialPagesMatchTopic` MUST be reworked to the merged shape: the canonical topic references `tutorial/tutorial.html` with each of the five `#ch1`…`#ch5` hashes; the referenced file exists under `app/frontend/public/tutorial/`; and no unreferenced `*.html` file lingers in that directory (the bidirectional spirit of the old guard). The byte-identity guard between the embedded and canonical topic copies is unchanged and MUST keep passing.

- **GIVEN** the reshaped test and the merged page
- **WHEN** `go test ./cmd/rk/` runs in `app/backend`
- **THEN** all skill/tutorial guards pass; deleting `tutorial.html` or referencing a sixth hash-less page would fail the guard

#### R6: No stale references remain
A repo-wide sweep MUST confirm zero remaining references to the five deleted `chN-*.html` filenames and to `tour-guide` — including `app/frontend/tests/e2e/` (spec.ts) — with the explicit exception of the fictional backend fixture URL `ch1-orientation.html` (out of scope, never a real page). Tutorial-surface "Act N" wording is gone.

- **GIVEN** the completed change
- **WHEN** grepping the repo for `ch1-your-agent|ch2-present-it|ch3-second-agent|ch4-attention|ch5-everywhere|tour-guide`
- **THEN** the only hits are in `fab/changes/` artifacts and git history, not in source, docs, or tests

### Non-Goals

- No renaming of the real `tutorial` window; no `rk tutorial` behavior change beyond the one help-text line.
- No API, route, or settings changes; no frontend `src/` changes.
- Backend fixture URLs `/tutorial/ch1-orientation.html` (present_test.go, validate_test.go, windows tests) stay untouched — fictional paths testing URL plumbing.

### Design Decisions

#### Single hash-routed companion page
**Decision**: Merge the five per-act companion pages into one `tutorial.html` with `#ch1`–`#ch5` hash routing, a bottom Back/Next pager, and JS handling both initial hash and `hashchange`; the skill presents the same URL with a different hash per chapter.
**Why**: One web tab is reused for the whole tour (the "asking again is the refresh" teaching moment), a hurried user can flip through all chapters, ~80% duplicated CSS collapses into one block, and Cleanup has fewer tabs to restore. The `hashchange` path is load-bearing because an iframe `src` change differing only by hash may not reload the document.
**Rejected**: Five separate pages with prev/next links — keeps the tab churn and CSS duplication; renaming the real window to `tour-guide` — `tutorial` is the established singleton-probe name and the human-typable command name.
*Introduced by*: 260904-00zd-tutorial-polish-chapter-merge

## Tasks

### Phase 2: Core Implementation

- [x] T001 Author `app/frontend/public/tutorial/tutorial.html`: five chapter sections ported from the existing pages with all mock-content corrections applied in the same pass (tour-guide→tutorial, waiting-signal pair, Ctrl+Shift+K, single `tutorial` web tab in ch2, `call it tour-worker` in ch3's transcript, `Chapter N ·` h1s), one deduplicated style block, hash routing (`#ch1`–`#ch5`, default ch1, load + `hashchange`), bottom `‹ Back · Chapter N of 5 · Next ›` nav with dots (no wrap), JS-set `document.title`; then delete `ch1-your-agent.html`, `ch2-present-it.html`, `ch3-second-agent.html`, `ch4-attention.html`, `ch5-everywhere.html` <!-- R1 R2 -->
- [x] T002 [P] Update the tutorial topic in `app/backend/cmd/rk/skill/tutorial.md` AND `docs/site/skill/tutorial.md` (byte-identical): five presents → `tutorial.html#chN`, Act→Chapter sweep (headings, greeting, cross-references, pacing prose), operator ask gains "call it tour-worker" <!-- R3 -->
- [x] T003 [P] Update `app/backend/cmd/rk/tutorial.go` `Long:` help text: "act by act" → "chapter by chapter" <!-- R4 -->
- [x] T004 Rework `TestTutorialPagesMatchTopic` in `app/backend/cmd/rk/skill_test.go` to the single-page + five-hash guard (topic references `tutorial/tutorial.html#chN` for N=1..5, file exists, no orphan `*.html` under `app/frontend/public/tutorial/`) <!-- R5 -->

### Phase 3: Integration & Edge Cases

- [x] T005 Repo-wide stale-reference sweep (`chN-*` filenames, `tour-guide`, tutorial-surface "Act N") including `app/frontend/tests/e2e/`; verify topic ≤150 lines and copies byte-identical; run `cd app/backend && go test ./cmd/rk/` <!-- R6 -->

## Execution Order

- T001 blocks T004 (the guard asserts against the merged page) and T005.
- T002/T003 are independent of T001 and each other.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `app/frontend/public/tutorial/tutorial.html` exists with five hash-addressable chapter sections, only the active one visible; the five old `chN-*.html` files are deleted
- [x] A-002 R1: Bottom nav renders `‹ Back · Chapter N of 5 · Next ›` with a five-dot indicator; Back inert on ch1, Next inert on ch5; missing/unknown hash falls back to ch1; `document.title` tracks the active chapter's `Chapter N · …` wording
- [x] A-003 R2: Zero `tour-guide` matches repo-wide; the mock window name is `tutorial` in every heading, row, and tile the old pages named `tour-guide`
- [x] A-004 R2: Waiting mocks show the real pair — halo'd yellow dot only on window rows (no `?`/`needs you` pills anywhere) and a `1 ⚠` signal-yellow badge on the session row above a waiting window; legends teach both signals
- [x] A-005 R2: The ch5 section's palette hint reads `⌘K / Ctrl+Shift+K`; the ch2 section's web-tab strip shows a single `tutorial` tab
- [x] A-006 R3: Both topic copies are byte-identical, contain five `rk present "$RK/tutorial/tutorial.html#chN"` invocations (N=1..5), say Chapter (no standalone "Act N" wording), and the Chapter 3 operator ask names the window `tour-worker`
- [x] A-007 R4: `tutorial.go` `Long:` says "chapter by chapter"; no "act by act" remains

### Behavioral Correctness

- [x] A-008 R1: The page JS reads `location.hash` on load AND listens for `hashchange`, so re-presenting the same URL with a different hash switches chapters without a document reload

### Removal Verification

- [x] A-009 R6: No references to the five deleted filenames or `tour-guide` remain in source, docs, or tests (e2e included); the fictional `ch1-orientation.html` fixture URLs are the only sanctioned `/tutorial/ch*` strings left

### Scenario Coverage

- [x] A-010 R5: `go test ./cmd/rk/` passes in `app/backend` — byte-identity guard, line-budget guard, and the reshaped `TestTutorialPagesMatchTopic` all green

### Edge Cases & Error Handling

- [x] A-011 R1: An unknown hash (e.g. `#ch9`) renders chapter 1 without JS errors; nav ends do not wrap

### Code Quality

- [x] A-012 Pattern consistency: The merged page keeps the existing pages' visual language and CSS variable vocabulary; Go and test edits follow surrounding style
- [x] A-013 No unnecessary duplication: The five pages' shared CSS is deduplicated into one style block; no copy-pasted per-chapter style rules that could be shared
- [x] A-014 No comment narration: No comments citing change IDs or narrating edits in any touched file (code-quality.md anti-pattern)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Ship-time gotcha (from intake): `public/` is outside `source_paths`, so the new `tutorial.html` needs an explicit `git add` during ship.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Nav implemented as plain anchors/buttons that set `location.hash` (no framework); sections toggled via the `hidden` attribute or a class, active state derived solely from the hash | Static self-contained page; hash is the single source of truth so present-reuse, nav clicks, and manual hash edits all take the same path | S:70 R:90 A:90 D:80 |
| 2 | Confident | Each chapter section keeps its original mock-frame width (900/940px) and callout positions; the merge does not re-layout the mocks beyond the content corrections | Minimizes visual regression risk in a file with hand-tuned absolute callout coordinates | S:65 R:85 A:85 D:80 |
| 3 | Confident | The reshaped guard asserts all five `#chN` hashes appear in the topic (N=1..5 exactly) and reuses the existing `tutorialPublicPath` constant and read-dir orphan check structure | Keeps the bidirectional spirit with minimal test-shape churn; skill_test.go patterns preserved | S:75 R:85 A:85 D:80 |
| 4 | Confident | "Act" sweep covers prose forms ("one act per reply", "skip advances one act", "act by act") in addition to the numbered headings | The intake names the numbered references explicitly; pacing prose uses the same word and leaving it would keep the mixed vocabulary the change exists to remove | S:70 R:90 A:85 D:85 |

4 assumptions (0 certain, 4 confident, 0 tentative).
