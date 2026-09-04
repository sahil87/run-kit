# Intake: Tutorial polish — naming consistency, single sewn companion page, Act→Chapter terminology

**Change**: 260904-00zd-tutorial-polish-chapter-merge
**Created**: 2026-09-04

## Origin

Promptless dispatch (`/fab-proceed` create-new path, `{questioning-mode} = promptless-defer`) from a synthesized description produced by a discussion session that reviewed the run-kit guided tutorial end to end. All six fixes below were explicitly decided by the user in that discussion; this intake transfers those decisions verbatim.

> Change: tutorial polish — naming consistency, single sewn companion page, Act→Chapter terminology. Six agreed fixes: (1) rename `tour-guide` → `tutorial` in all mocks; (2) fix waiting-signal vocabulary in mocks to match the real product; (3) fix the ch5 palette shortcut to Ctrl+Shift+K on Win/Linux; (4) merge the five companion pages into a single `tutorial.html` with hash routing and a bottom chapter nav; (5) Act → Chapter terminology everywhere; (6) pin the worker window name `tour-worker` in the skill's operator ask.

**Surface inventory (verified against this worktree):**

- Skill text: `app/backend/cmd/rk/skill/tutorial.md` (go:embed via `app/backend/cmd/rk/skill.go`), canonical copy `docs/site/skill/tutorial.md` — confirmed byte-identical (`cmp` clean). Drift guard exists in `app/backend/cmd/rk/skill_test.go` (embedded-vs-canonical comparison, plus `TestTutorialPagesMatchTopic` — see What Changes § Test guard).
- Command: `app/backend/cmd/rk/tutorial.go` — `tutorialWindowName = "tutorial"` (the singleton-probe window name, exact match), help text `Long:` says "walks you through run-kit act by act".
- Mock companion pages: `app/frontend/public/tutorial/ch1-your-agent.html`, `ch2-present-it.html`, `ch3-second-agent.html`, `ch4-attention.html`, `ch5-everywhere.html` (113/120/116/112/86 lines), presented one per act via `rk present "$RK/tutorial/chN-….html"` in the skill text.
- Real waiting-signal behavior: window row = yellow halo on the status dot only (`app/frontend/src/components/status-dot.tsx`, `rk-waiting-halo`), no text pill; session-row/server rollup = `{count}⚠` badge (`app/frontend/src/components/waiting-badge.tsx`).
- Real Win/Linux palette chord: **Ctrl+Shift+K** (`app/frontend/src/lib/keybindings.ts`, `command-palette-alt` shifted-tier alias on `KeyK`; plain Ctrl+K is deliberately left to the pane's kill-line). The skill text already says `⇧Ctrl+K on Win/Linux` correctly.

## Why

1. **The mocks teach the wrong product.** The tutorial's whole job is to imprint real vocabulary, and today it imprints three falsehoods: (a) the mock sidebar/tiles show a window named `tour-guide` while the real window `rk tutorial` creates is hard-named `tutorial` — the user's first live comparison between mock and dashboard fails; (b) the mocks show waiting-state text pills (`?` on a window row in ch1, `needs you` in ch4's sidebar and ch5's phone roster) that do not exist in the product — the real signals are the halo'd yellow dot on the window row and the `{count}⚠` rollup badge on the session row, and the badge the tutorial legend teaches must be the real one; (c) ch5 shows `⌘K / Ctrl+K` while the real Win/Linux chord is Ctrl+Shift+K — a user who tries the mock's chord gets the shell's kill-line instead of the palette.
2. **Five separate pages waste the one-tab teaching moment and duplicate ~80% of their CSS.** Each act's `rk present` opens a new web tab; a hurried user cannot flip between chapters; the Cleanup narrative has more tabs to restore. One sewn page with hash routing reuses a single tab, lets the user page through `‹ Back · Chapter N of 5 · Next ›`, and dedupes the shared style block.
3. **Terminology drift.** Files are named `ch` (chapter) while every heading and cross-reference says "Act" — the audience is PMs/first-run users, and "Chapter" matches the file naming and reads plainer. Plus `<title>` vs `<h1>` drift inside two pages (ch2, ch5).
4. If left unfixed, every future tutorial edit propagates the wrong vocabulary further, and the mock↔product mismatch lands on exactly the audience least equipped to see past it (first-run users).

## What Changes

### 1. Rename `tour-guide` → `tutorial` in all mocks

The real window is named `tutorial` (`tutorialWindowName`, tutorial.go — exact-match singleton probe; renaming the real window was rejected in discussion). The mocks show `tour-guide` in ~9 places, all verified to be mock-page-only (repo-wide grep hits only the five ch*.html files):

- ch1: top-bar heading (line ~65), sidebar row (line ~75), terminal tile header (line ~88)
- ch2: heading (line ~70), tile header (line ~76)
- ch3: sidebar row (line ~73), legend item 4 ("the tour guide")
- ch4: sidebar row (line ~75)
- ch5: phone roster row (line ~55)

All become `tutorial` (legend prose adjusts naturally, e.g. "the tutorial agent").

### 2. Waiting-signal vocabulary in mocks

Match the real product exactly:

- **Window rows** that are waiting keep only the halo'd yellow status dot (mimic `rk-waiting-halo` — a yellow dot with a soft yellow glow/ring). Drop the `?` pill (ch1) and `needs you` pills (ch4 sidebar, ch5 phone roster).
- **Session rows** where a window is waiting gain a `1 ⚠` rollup badge in signal yellow (mimic `waiting-badge.tsx`'s `{count}⚠` rendering).
- **Legend text** in the affected chapters updates to teach the real pair: dot halo = this window needs you; `N ⚠` on the session row = how many windows under it are waiting.

### 3. ch5 palette shortcut

`⌘K / Ctrl+K` → `⌘K / Ctrl+Shift+K` (mock copy only; the skill text is already correct with `⇧Ctrl+K on Win/Linux` — keep the two surfaces' wording consistent in meaning, exact glyph form per surface is fine).

### 4. Merge five pages into one `app/frontend/public/tutorial/tutorial.html`

- Five `<section>` chapters, hash-routed `#ch1`…`#ch5`; only the active chapter section is visible.
- JS handles **both** the initial `location.hash` on load **and** `hashchange` events — an iframe `src` change differing only by hash may not reload the document, so the hashchange path is load-bearing for the skill's five `rk present` invocations against one tab.
- No/unknown hash defaults to `#ch1`.
- Bottom navigation bar: `‹ Back · Chapter N of 5 · Next ›` plus a five-dot chapter indicator; Back is inert/hidden on ch1 and Next on ch5 (no wrap).
- Dedupe the ~80%-shared CSS into one style block; keep each chapter's current content (as amended by fixes 1–3, 5) intact: h1, mock app frame, legend, "try it" box.
- Static, self-contained (no external assets), dark, monospace — the existing pages' visual language.
- One document `<title>`; JS updates `document.title` to the active chapter's `Chapter N · …` wording on chapter change.
- **Delete** the five old `chN-*.html` files (no redirect stubs).
- Skill text: the five `rk present "$RK/tutorial/chN-….html"` invocations become `rk present "$RK/tutorial/tutorial.html#chN"` — the whole tour reuses ONE web tab.
- ch2's mock web-tab strip showing "tour pages…" becomes a single `tutorial` tab to match the one-tab reality.
- Cleanup section: verified the current restore narrative is already page-agnostic (capture-compare over `rk tab web ls --json` + `@rk_win_*` keys) — no structural rewrite needed; sweep any plural "tour pages" phrasing if present while editing.

### 5. Act → Chapter terminology everywhere

- Skill text (BOTH synced copies — edit one, sync the other, keep byte-identical): section headings `## Act N — …` → `## Chapter N — …`; the greeting's "five acts in about ten minutes" → "five chapters…"; the greeting's "in Act 4" and the Preflight's "before Act 2"/"before Act 3" cross-references; the ch1 body's "Act 4 triggers it for real".
- Page `<h1>`s and `<title>`s: "Act N ·"/"Act N —" → "Chapter N ·"/"Chapter N —" (carried into the merged page's section h1s and the JS-set document title).
- `app/backend/cmd/rk/tutorial.go` `Long:` help text (~line 69): "walks you through run-kit act by act" → "…chapter by chapter".
- Title/h1 drift fixes while touching them: ch2 title "Present it to me" vs h1 "Make it show you things" — titles should match h1 wording; ch5 title regains "— and what's next" to match its h1.

### 6. Pin the worker window name in the operator ask

The mocks hardcode `tour-worker` and the fallback path runs `rk tab new --name tour-worker`, but the Chapter 3 operator-path suggested ask never names the window. Add "call it tour-worker" (or equivalent) to the suggested operator ask in the skill text AND to the ch3 mock's operator terminal transcript, so a real run's sidebar matches the mock. (`tour-worker` refs verified: skill text both copies + ch3/ch4/ch5 mocks — all stay `tour-worker`; only the ask gains the name.)

### Test guard updates (required by fix 4)

`app/backend/cmd/rk/skill_test.go` carries two relevant guards:

- **Byte-identity guard** (embedded `skill/tutorial.md` vs `docs/site/skill/tutorial.md` at `canonicalPath`) — unchanged; the change must keep the two copies byte-identical.
- **`TestTutorialPagesMatchTopic`** (line ~129): `pagePattern = tutorialPublicPath + (ch\d-[a-z-]+\.html)` — a bidirectional guard that every `tutorial/ch*.html` reference in the topic exists under `app/frontend/public/tutorial/` and no companion page is orphaned. This regex matches nothing once the pages merge. Rework it to guard the new shape: the topic references `tutorial/tutorial.html` with each of the five `#ch1`…`#ch5` hashes, the file exists, and (keep the spirit) no unreferenced `*.html` lingers in `public/tutorial/`.

### Explicitly out of scope

- Backend test fixture URLs `/tutorial/ch1-orientation.html` (in `app/backend/cmd/rk/present_test.go`, `internal/present/present_test.go`, `internal/validate/validate_test.go`, `api/windows_test.go`, `api/windows_web_test.go`) — fictional fixture paths that never matched a real page (`ch1-orientation.html` does not exist); leave untouched.
- No renaming of the real `tutorial` window, no `rk tutorial` behavior change beyond the help-text wording, no API/routes/settings changes.

## Affected Memory

- `run-kit/toolkit-standards`: (modify) The skill-topic section describing the bidirectional page↔companion guard (`TestTutorialPagesMatchTopic` requiring every `tutorial/ch*.html` reference to exist, ~lines 789–794) — update to the single-page + hash-reference guard shape; the `rk tutorial` verb rows are otherwise unaffected.
- `run-kit/ui/lenses-and-layout`: (modify) The web-surface note naming `/tutorial/ch*.html` companion pages as the first shipped site-relative web-tab consumer — becomes `/tutorial/tutorial.html#chN` (single page, hash-addressed).

(`run-kit/architecture` and `run-kit/rk-riff` describe the `rk tutorial` command mechanics, which do not change — no edit expected.)

## Impact

- `app/frontend/public/tutorial/` — 5 files deleted, 1 new `tutorial.html` (static asset; note `git-pr`'s untracked guard omits `public/` from source_paths — the new file must be `git add`ed explicitly during ship).
- `app/backend/cmd/rk/skill/tutorial.md` + `docs/site/skill/tutorial.md` — synced edit (present invocations, Act→Chapter, operator ask), byte-identical after.
- `app/backend/cmd/rk/tutorial.go` — one help-text line.
- `app/backend/cmd/rk/skill_test.go` — `TestTutorialPagesMatchTopic` reshape.
- Tests: `cd app/backend && go test ./cmd/rk/` at minimum (tutorial + skill tests). No frontend src changes → no unit-test impact; e2e sweep verified clean today (`grep -r "tutorial\|tour-guide" app/frontend/tests/e2e/` — zero hits) but the removal sweep MUST re-check e2e (spec.ts) for `chN-*.html` / `tour-guide` references before ship (a src-only sweep broke CI before).
- Change type: `chore`-flavored UI+docs polish; no API surface, no routes, no settings.

**Alternatives rejected (from discussion):** keeping five separate pages with prev/next links (loses one-tab reuse and CSS dedup); renaming the real window to `tour-guide` (`tutorial` is the established singleton probe name and human-typable command name); keeping "Act" (file prefix already says `ch`; PM audience).

## Open Questions

- None — all six fixes were decided in the discussion; no decision required a user prompt under promptless-defer.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Rename `tour-guide` → `tutorial` in all ~9 mock spots; real window name stays `tutorial` | Discussed — user decided; `tutorialWindowName = "tutorial"` verified in tutorial.go; repo grep confirms `tour-guide` exists only in the 5 mock pages | S:95 R:90 A:95 D:95 |
| 2 | Certain | Waiting mocks: halo'd yellow dot only on window rows, `1 ⚠` rollup on session rows, drop `?`/`needs you` pills, legend teaches the real pair | Discussed with verified product behavior (status-dot.tsx `rk-waiting-halo`, waiting-badge.tsx `{count}⚠`) | S:90 R:85 A:90 D:90 |
| 3 | Certain | ch5 mock chord → `⌘K / Ctrl+Shift+K` | Verified: keybindings.ts `command-palette-alt` shifted-tier KeyK is the Win/Linux palette chord; skill text already correct | S:95 R:95 A:95 D:95 |
| 4 | Certain | Merge into single `tutorial.html` with `#ch1`–`#ch5` hash routing, bottom `‹ Back · Chapter N of 5 · Next ›` nav + dot indicator, load+hashchange handling, delete the 5 old files, skill presents `tutorial.html#chN` | Discussed — user decided; alternative (five pages with prev/next links) explicitly rejected | S:90 R:70 A:85 D:90 |
| 5 | Certain | Act → Chapter sweep: skill text (both synced copies), page h1/titles, tutorial.go help text; fix ch2/ch5 title-vs-h1 drift | Discussed — "keeping Act" rejected; drift fixes named with exact wording | S:95 R:90 A:95 D:95 |
| 6 | Certain | Add "call it tour-worker" to the Chapter 3 operator ask (skill text) and ch3 mock operator transcript | Discussed — user decided; `tour-worker` refs verified in skill text + ch3/ch4/ch5 mocks | S:90 R:90 A:90 D:90 |
| 7 | Confident | Rework `TestTutorialPagesMatchTopic` (skill_test.go `pagePattern` regex `tutorial/(ch\d-[a-z-]+\.html)`) to guard the single page: topic references `tutorial.html` with all five hashes, file exists, no orphan `*.html` in public/tutorial/ | Guard located and mechanism understood; exact new assertion shape is inferred (description said "find and respect it") | S:75 R:80 A:80 D:70 |
| 8 | Confident | Leave backend test fixture URLs `/tutorial/ch1-orientation.html` untouched | Verified fictional: `ch1-orientation.html` never existed as a real page; fixtures test URL plumbing, not tutorial content | S:70 R:85 A:85 D:75 |
| 9 | Confident | Nav ends don't wrap (Back inert on ch1, Next inert on ch5); missing/unknown hash defaults to `#ch1` | Not explicitly discussed; standard pager default, trivially reversible in one static file | S:55 R:90 A:80 D:70 |
| 10 | Confident | JS sets `document.title` to the active chapter's `Chapter N · …` wording on chapter change (one physical `<title>` in the merged page) | Not explicitly discussed; preserves per-chapter titles in the one-tab model and keeps the title=h1 rule from fix 5 | S:50 R:90 A:75 D:65 |
| 11 | Confident | Cleanup section needs no structural rewrite — current restore narrative is page-agnostic (capture-compare); only sweep any plural "tour pages" phrasing | Verified: Cleanup restores from web-tab/`@rk_win_*` captures, never names page count | S:60 R:90 A:85 D:75 |
| 12 | Confident | Change type `chore` | Description says "likely chore/fix-flavored UI+docs polish"; no API surface, routes, or settings; polish/consistency dominates over bug-fix framing | S:65 R:95 A:80 D:70 |

12 assumptions (6 certain, 6 confident, 0 tentative, 0 unresolved).
