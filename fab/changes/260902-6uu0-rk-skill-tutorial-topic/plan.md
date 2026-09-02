# Plan: rk skill tutorial — the guided tour as a shipped topic page

**Change**: 260902-6uu0-rk-skill-tutorial-topic
**Intake**: `intake.md`

## Requirements

### CLI: the `tutorial` topic page

#### R1: `rk skill tutorial` serves the canonical page under the toolkit skill contract
`rk skill tutorial` MUST print `docs/site/skill/tutorial.md` byte-identical to stdout with empty stderr and exit 0, via the same sync + `//go:embed` + drift-guard mechanism as `display`/`code`/`mux`. The page MUST be ≤150 lines (`skillLineBudget`) and static-only. The unknown-topic error MUST name `tutorial` among the valid topics, and bare `rk skill` MUST NOT inline it.

- **GIVEN** the built binary
- **WHEN** `rk skill tutorial` runs
- **THEN** stdout equals `docs/site/skill/tutorial.md` byte-for-byte, stderr is empty, exit 0
- **AND** `rk skill bogus` exits 2 with `unknown topic "bogus" (valid: code, display, mux, tutorial)` on stderr and empty stdout

#### R2: The page carries the tour's load-bearing contracts
The topic page SHALL open like the sibling pages (`# run-kit skill: tutorial`, one intro sentence naming it a static topic page, gate first) and SHALL carry, from the prototype `.claude/skills/rk-tutorial/SKILL.md`: the **pacing contract** (one chapter per reply, end the turn with the "say **next**" prompt, `skip`/`stop`/`done`, 2–4 sentences + action + "where to look"), the **repaint-latency note** (CLI option writes reach the UI on the safety poll — allow up to ~12s, one mutation per beat; UI-originated changes repaint instantly), the **failure posture** (degrade, never error), **Preflight** (gate, `rk skill` read, stale-run recovery from `/tmp/rk-tutorial/original-state.json`, state capture via `rk tab show --json` + `rk tab web ls --json`, companion base `RK="$(rk url)"`, greet + end turn), **Chapters 1–8** (orientation · sidebar signals UI-first with the CLI closing beat · `rk present` + "present it to me" + role-flip · layouts one-mutation-per-beat, never `single:tty` mid-tour · code lens with `rk code hosts` gate · web-tab strip incl. the ↗ Open-in-browser hatch and `rm` tidy-up · ⌘K as the complete action registry incl. Settings/Shortcuts chords · operator asks), and the **Finale** (`rk notify` fail-silent, Cleanup restoring captured values / unsetting the rest / removing tutorial web tabs / restoring the layout / `rm -rf /tmp/rk-tutorial`, recap cheat sheet, `rk skill` pointers). Each chapter presents its companion as `rk present "$RK/tutorial/ch<N>-<slug>.html"`.

- **GIVEN** an agent in a run-kit pane reads `rk skill tutorial`
- **WHEN** it follows the page
- **THEN** it can run the full tour without consulting the prototype, and every command in the page is a real `rk`/`tmux` invocation that exists in this binary

### Frontend static assets: companion pages

#### R3: Companion pages ship in the binary as static files, no new route
The eight companion pages MUST live at `app/frontend/public/tutorial/ch1-orientation.html … ch8-operator.html`, self-contained (inline CSS, no external requests), and be served at `/tutorial/<file>.html` by the existing SPA regular-file branch (`api/spa.go`) — no Go handler, no route addition (Constitution IV). Every UI affordance a page or the topic page names (marker-well press/drag pad, flyout card contents, palette entry names, the ↗ Open-in-browser button, Settings and Shortcuts chords, the operator row) MUST be verified against `app/frontend/src`; text or mock is corrected where the UI differs.

- **GIVEN** a production build (`scripts/build.sh` copies `app/frontend/dist` → `app/backend/build/frontend`)
- **WHEN** a browser requests `/tutorial/ch1-orientation.html`
- **THEN** the page is served as a regular file (not the SPA fallback), and no new chi route exists

### CLI + API: same-origin `present` targets

#### R4: A URL on the run-kit server's own origin attaches as a site-relative path
`present.ParseTarget` SHALL accept an optional set of same-origin values; an `http(s)://` target whose scheme+host (origin) matches one of them SHALL resolve to a new kind (`KindSiteRelative`) whose slot URL is the request path + query (leading `/`, no origin) — checked **before** the localhost → `/proxy/` rewrite. The kind needs no root and no probe. `rk present` and `rk tab web add` SHALL pass `resolveOrigin(ctx)`; the `POST /api/windows/{id}/web/add` handler SHALL pass the request's own origin. A non-matching localhost URL still proxies; https and remote hosts still attach verbatim. `docs/site/skill/display.md` gains one target-form line for it.

- **GIVEN** `rk url` prints `http://0.0.0.0:3000`
- **WHEN** `rk present http://0.0.0.0:3000/tutorial/ch1-orientation.html` runs
- **THEN** the slot value is `/tutorial/ch1-orientation.html` and stdout prints it
- **GIVEN** `rk url` prints `http://127.0.0.1:3000`
- **WHEN** `rk present http://127.0.0.1:5173/app?x=1` runs
- **THEN** the slot value is `/proxy/5173/app?x=1` (origin mismatch → the existing localhost rewrite)

### Docs surface

#### R5: Core bundle, README, and sync script list the new topic
`docs/site/skill.md` SHALL keep the staged Sidebar-signals block and add one topic-index line for `tutorial` (trigger words: tutorial / tour / onboarding); the embed copy `cmd/rk/skill/skill.md` stays byte-identical; core stays ≤150 lines. `scripts/sync-skill.sh` gains the `tutorial` row. `README.md`'s `run-kit skill` row names the topic set (`display`, `mux`, `code`, `tutorial`).

- **GIVEN** the repo at HEAD
- **WHEN** `go test ./cmd/rk/` runs
- **THEN** every embed matches its canonical file and every page is within budget

#### R6: Topic page and companion pages cannot drift apart
A Go test in `cmd/rk` SHALL assert that every `tutorial/ch*.html` referenced in `docs/site/skill/tutorial.md` exists under `app/frontend/public/tutorial/`, and that every file there is referenced by the page.

- **GIVEN** a page is renamed or removed on one side
- **WHEN** `go test ./cmd/rk/` runs
- **THEN** the drift-guard test fails naming the mismatched file

### Non-Goals
- Waking the SSE derive tick on CLI mutations (backlog `[0ccm]`) — the tour paces around the latency
- Adding "tutorial/tour" trigger words to the `shll-toolkit` bootstrap skill (shll repo)
- Any frontend TS/React change or e2e spec — the pages are static files; the tour is agent-executed prose

### Design Decisions

#### Companion pages are static files under the SPA, not a route or an extraction verb
**Decision**: Ship the pages in `app/frontend/public/tutorial/` and let the SPA regular-file branch serve them at `/tutorial/…`.
**Why**: Constitution IV (fixed route set); `manifest.json`/`sw.js` already ride exactly this path; the pages are version-locked to the binary like the topic page.
**Rejected**: a Go handler + embed (a new route for static bytes); `rk skill tutorial --pages <dir>` extraction (a second output mode on a stdout-is-data command); shll.ai-hosted external URLs (network + version skew); agent-generated pages (eight HTML files cannot fit a 150-line page).
*Introduced by*: 260902-6uu0-rk-skill-tutorial-topic

#### Same-origin URLs attach site-relative
**Decision**: A `present`/`web add` URL whose origin equals the server's own resolves to its path+query, checked before the localhost→proxy rewrite.
**Why**: `rk url` is the only origin an agent can derive; today it either self-proxies (`localhost`) or attaches verbatim (`0.0.0.0`), which a remote viewer cannot reach. The frontend already resolves relative slot values against its own origin.
**Rejected**: a bare `/path` target form (collides with absolute filesystem paths and degrades the missing-file error); a `--relative` flag (surface for one caller).
*Introduced by*: 260902-6uu0-rk-skill-tutorial-topic

## Tasks

### Phase 1: Setup

- [x] T001 [P] Add `KindSiteRelative` to `app/backend/internal/present/present.go`: `ParseTargetWithOrigins(arg, cwd string, origins []string)` (existing `ParseTarget` becomes the nil-origins wrapper), origin compare on scheme+host before the localhost rewrite, `URL()` returns `PathQuery` (leading `/`), `Name` = first path segment or `site`, `NeedsRoot`/`NeedsProbe` false, `String()` = `site-relative`; extend `present_test.go` with a table covering `0.0.0.0`/`127.0.0.1`/`localhost` origins, path+query preservation, a mismatched localhost URL still proxying, https verbatim, and root/probe flags <!-- R4 -->
- [x] T002 [P] Copy the eight companion pages from `.claude/skills/rk-tutorial/pages/` to `app/frontend/public/tutorial/` (same file names); then verify every UI claim in them against `app/frontend/src` (marker pad press/drag/tap in `dialogs-and-state`-covered components, flyout card contents, palette entry labels for marker/color/note/layout/web/settings, the web tile's ↗ Open-in-browser button, Settings ⌘, / ⇧Ctrl+, and Shortcuts ⌘/ chords in the keybindings, the operator row placement) and correct text/mocks to match <!-- R3 --> <!-- rework: review found ch2/ch7/ch8 mocks diverge from the shipped UI (row text, single marker cell, flyout title/note register; `Tab: Marker` label + locked tmux bindings; operator row is an ordinary WindowRow with no gear badge) -->

### Phase 2: Core Implementation

- [x] T003 Wire the origin into the callers: `cmd/rk/present.go` `runPresent` and `cmd/rk/tab_web.go` web-add pass `[]string{resolveOrigin(ctx)}`; `api/windows_web.go` passes the request origin (`scheme://r.Host`, scheme from TLS/`X-Forwarded-Proto` if already derived elsewhere, else `http`); add one target-form line to `docs/site/skill/display.md` (`rk present "$(rk url)/path"  # same-origin → attached as /path`) and keep it ≤150 lines <!-- R4 --> <!-- rework: `rk present --help` must list the same-origin `$(rk url)/path` -> `/path` form and its stdout note -->
- [x] T004 Write `docs/site/skill/tutorial.md` (≤150 lines) from the prototype `.claude/skills/rk-tutorial/SKILL.md` per R2 — sibling-page header, gate, pacing + latency + failure posture, Preflight with `RK="$(rk url)"`, Chapters 1–8, Finale with Cleanup + recap; every chapter's companion line is `rk present "$RK/tutorial/ch<N>-<slug>.html"`; every command is checked against the current CLI (`rk tab --help`, `rk code --help`) <!-- R2 --> <!-- rework: Cleanup must restore every captured `@rk_win_*` key incl. `@rk_win_code_root` and `@rk_win_web_active`, and unset keys absent from the capture -->
- [x] T005 Wire the topic: `scripts/sync-skill.sh` row; `cmd/rk/skill.go` `//go:embed skill/tutorial.md` + `skillTopics["tutorial"]`; run the sync (creates `cmd/rk/skill/tutorial.md`); `skill_test.go` — add `tutorial` to `TestSkillTopicsPrintByteIdentical`, `TestSkillTopicsMatchCanonical`, `TestSkillTopicsWithinLineBudget`, and change the unknown-topic expectation to `code, display, mux, tutorial` <!-- R1 -->

### Phase 3: Integration & Edge Cases

- [x] T009 Add `TestTutorialLayoutValuesParse` in `app/backend/cmd/rk/skill_test.go`: extract every `rk tab layout <value>` literal (regex `rk tab layout ([a-z-]+:[a-z,]+)`) from the canonical `docs/site/skill/tutorial.md` and assert each parses via `layoutspec.Parse`; any `--promote/--add/--rm <surface>` arguments must satisfy `layoutspec.IsSurface` <!-- R2 --> <!-- revise-plan: cycle 3 — Chapter 4 shipped `main-left:web,tty`, rejected by the fixed 3-slot arity -->
- [x] T010 Correct the two tour-accuracy defects: (a) Chapter 4 in `docs/site/skill/tutorial.md` and the `ch4-layouts.html` mocks use only shapes valid for the surfaces present — `split-v:web,tty` (stacked) → `rk tab layout --promote tty` → `split-h:tty,web`; main-* mocks show three tiles or are dropped; (b) `ch1-orientation.html` and Chapter 1 narration describe the shipped StatusBar (`app/frontend/src/components/status-bar.tsx:470-475`, `app.tsx:4405-4408` — it carries the tmux SERVER name and pane/register identity, not a native window list or the server URL) or are relabelled as a conceptual illustration with no on-screen claim <!-- R3 --> <!-- revise-plan: cycle 3 — ch1 status-bar claims and ch4 arity -->
- [x] T006 Add `TestTutorialPagesMatchTopic` in `cmd/rk/skill_test.go`: regex `tutorial/ch\d-[a-z-]+\.html` over the canonical `docs/site/skill/tutorial.md` vs `os.ReadDir("../../../../app/frontend/public/tutorial")` — both directions, naming the mismatched file <!-- R6 -->
- [x] T007 Core bundle + docs: add the `tutorial` topic-index line to `docs/site/skill.md` (keep the staged Sidebar-signals block), re-run `scripts/sync-skill.sh`, update the `run-kit skill` row in `README.md` to name all four topics <!-- R5 -->

### Phase 4: Polish

- [x] T008 Delete the prototype `.claude/skills/rk-tutorial/` directory; run `cd app/backend && go test ./cmd/rk/ ./internal/present/ ./api/` and `just test-backend`; sweep the diff for provenance comments (`grep -nE 'R[0-9]+|T00[0-9]|6uu0' <changed src/test files>` — none allowed in code or tests) <!-- R1 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `rk skill tutorial` prints `docs/site/skill/tutorial.md` byte-identical, stderr empty, exit 0 (`TestSkillTopicsPrintByteIdentical` + `TestSkillTopicsMatchCanonical` rows)
- [x] A-002 R1: `docs/site/skill/tutorial.md` and the embed copy are ≤150 lines (`TestSkillTopicsWithinLineBudget` row)
- [x] A-003 R2: The page carries pacing contract, repaint-latency note, failure posture, Preflight (gate, stale-run recovery, state capture, `RK="$(rk url)"`), Chapters 1–8, Finale with Cleanup + recap
- [x] A-004 R3: `app/frontend/public/tutorial/` holds exactly the eight `ch1-orientation … ch8-operator` pages, each self-contained (no external `src`/`href` fetches)
- [x] A-005 R4: `ParseTargetWithOrigins` maps a same-origin URL to `KindSiteRelative` with slot URL = path+query; `ParseTarget` is unchanged for existing inputs
- [x] A-006 R5: `docs/site/skill.md` topic index lists `tutorial`; `scripts/sync-skill.sh` has the row; README `run-kit skill` row names all four topics
- [x] A-007 R6: `TestTutorialPagesMatchTopic` exists and passes both directions

### Behavioral Correctness

- [x] A-008 R1: `rk skill bogus` stderr names `code, display, mux, tutorial`; exit 2; stdout empty
- [x] A-009 R4: With origin `http://0.0.0.0:3000`, `http://0.0.0.0:3000/tutorial/ch1-orientation.html` → `/tutorial/ch1-orientation.html`; `http://127.0.0.1:5173/app?x=1` under a `:3000` origin → `/proxy/5173/app?x=1`; `https://…` still verbatim
- [x] A-010 R4: `rk present`, `rk tab web add`, and `POST /api/windows/{id}/web/add` all honour the same-origin rule (CLI via `resolveOrigin`, API via the request origin)

### Scenario Coverage

- [x] A-011 R3: A production build serves `/tutorial/ch1-orientation.html` as a regular file (verified by building or by asserting the file lands in `app/frontend/dist/tutorial/` after `pnpm build`)
- [x] A-012 R2: Every `rk`/`tmux` command in the page exists in this binary with the flags used (spot-check `rk tab layout --promote`, `rk tab web select/rm`, `rk tab code set`, `rk code exec`, `rk notify --title`, `rk tab show --json`, `rk tab web ls --json`)

### Edge Cases & Error Handling

- [x] A-013 R3: Every UI affordance named by the topic page or a companion page was located in `app/frontend/src` (or the claim was corrected); no unverified affordance ships
- [x] A-014 R2: Cleanup restores captured `@rk_win_*` values and layout, unsets only what did not exist, and keeps pre-existing web tabs — Reverified: Cleanup now removes only non-original web tabs, restores every captured `@rk_win_*` value (including layout, code root, and active web slot), unsets only keys absent from the capture, and compares the final state to the capture.

### Command Validity

- [x] A-020 R2: Every `rk tab layout` literal in the topic page parses via `layoutspec.Parse` and every surface argument passes `layoutspec.IsSurface` (`TestTutorialLayoutValuesParse`)
- [x] A-021 R3: `ch1-orientation.html` and `ch4-layouts.html` make no claim about on-screen chrome or layout shapes that the shipped frontend/layoutspec contradicts

### Code Quality

- [x] A-015 Pattern consistency: new Go code follows the present package's pure-function style and the skill wiring mirrors the existing per-topic pattern exactly
- [x] A-016 No unnecessary duplication: origin comparison reuses `net/url` parsing already in `ParseTarget`; no second parser
- [x] A-017 Tests included: new behaviour (`KindSiteRelative`, topic wiring, drift guard) is covered by Go tests alongside the code
- [x] A-018 Comment discipline: no comments narrate the next line, cite R#/T#/change IDs, or address the reviewer — in source or tests
- [x] A-019 Magic strings: the topic name and the `tutorial/` public path appear once each as named constants where reused

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None found after full diff review — the new parser kind, three caller integrations, topic wiring, drift guards, and static assets all have live call sites or direct contract coverage.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Origin injection is an options-style second constructor (`ParseTargetWithOrigins`) keeping `ParseTarget` source-compatible | Three callers plus tests already use `ParseTarget`; a wrapper avoids touching unrelated tests | S:60 R:90 A:85 D:75 |
| 2 | Confident | The API handler derives its origin from the request (`r.Host` + scheme) rather than `resolveOrigin` | The handler already serves that origin; `resolveOrigin` is a CLI-side tmux read | S:55 R:85 A:75 D:70 |
| 3 | Confident | `KindSiteRelative.Name` is the first path segment (`tutorial`) | Window-name derivation only needs a sanitizable label; matches `port-N`/hostname precedent | S:50 R:95 A:85 D:80 |
| 4 | Confident | Drift guard lives in `cmd/rk/skill_test.go` reading the canonical page, not the embed | The canonical file is the authored source; the embed is already pinned to it | S:60 R:95 A:85 D:80 |

4 assumptions (0 certain, 4 confident, 0 tentative).
