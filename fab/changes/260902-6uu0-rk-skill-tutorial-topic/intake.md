# Intake: rk skill tutorial — the guided tour as a shipped topic page

**Change**: 260902-6uu0-rk-skill-tutorial-topic
**Created**: 2026-09-02

## Origin

Backlog item, one-shot invocation via `/fab-new 6uu0`:

> [6uu0] 2026-09-02: rk skill tutorial: interactive onboarding tour as a shipped skill topic page — prototype validated in rk-tutorial worktree (.claude/skills/rk-tutorial); permanent home = docs/site/skill/tutorial.md served by rk skill tutorial, so any agent in a run-kit pane can run the guided tour

Context from this session: the prototype `/rk-tutorial` Claude skill was run end-to-end live in this worktree (session `runKit`, window `rk-tutorial`, pane `%185`) before this intake. The run surfaced two things now encoded here:

1. **The prototype has since been iterated** (the on-disk `.claude/skills/rk-tutorial/SKILL.md` is 166 lines, 8 chapters + a finale, and ships eight **companion HTML pages** in `.claude/skills/rk-tutorial/pages/ch1-orientation.html … ch8-operator.html`, ~40–50 lines each — run-kit mocks with numbered callouts that the tour presents beside the agent's terminal). The 7-chapter version that ran in this session is superseded; **the current on-disk prototype is the content source of truth** for this change.
2. **CLI option writes repaint on the ~12s safety poll**, not instantly (Chapter 4's layout sequence swallowed intermediate states). That is tracked separately as backlog `[0ccm]`; the tour must pace itself around the latency regardless (the prototype already does — "one mutation per beat", "give it a few seconds").

Also riding along: a 5-line **Sidebar signals** block was added to the core bundle (`docs/site/skill.md` + its synced embed copy) during prototyping — the `@rk_win_color/marker/note/flair` options, which the tour's Chapter 2 relies on and which the core bundle previously did not document. It sits uncommitted in this worktree and belongs to this change.

## Why

**The pain point.** run-kit's mental model — *tmux is the store, the dashboard is a renderer of tmux state* — is not obvious from the UI alone, and the surfaces that make run-kit worth using (sidebar signals, `rk present`, shared layouts, the web-tab strip, the code lens, ⌘K, the operator) are spread across docs a new user never reads. The prototype proved that an **agent-run, live, one-chapter-per-turn tour** teaches the model in ~10 minutes: the user watches their own dashboard react to each command, asks questions between chapters, and leaves with a cheat sheet. Right now that tour exists only as an untracked `.claude/skills/` file in one worktree, on one machine.

**The consequence of not shipping it.** Every new run-kit user (and every agent asked "how does this thing work?") re-derives the model from scratch, and the prototype rots in a worktree that will be deleted.

**Why a `rk skill` topic page.** `rk skill <topic>` is exactly the delivery mechanism the toolkit standard (`shll standards skill`) built for depth an agent pulls deliberately: embedded in the binary, version-locked to the flags it describes, byte-identical to `docs/site/skill/<topic>.md`, offline, present wherever `rk` is. A tutorial is an agent-executed script, so an agent skill page is its natural home — any agent in any run-kit pane can run `rk skill tutorial` and follow it, with no per-machine skill placement (the `shll setup agent` bootstrap skill already teaches agents the `rk skill` two-step). The alternatives — a Claude-only `.claude/skills` file (harness-specific, needs placement, drifts from the binary), a docs page (nobody runs docs), a frontend "tour" overlay (a new UI surface, Constitution IV) — are all worse fits.

## What Changes

### 1. New topic page `docs/site/skill/tutorial.md` (canonical) + embed

The tour script, rewritten from the prototype into the topic-page genre and **≤150 lines** (the `skillLineBudget` test enforces this; the prototype is 166 lines, so ~10–15% compression is required — mostly by collapsing the per-chapter companion-page instructions into one pattern line and tightening narration bullets).

Structure mirrors the existing topic pages (`# run-kit skill: tutorial`, an intro sentence naming it a static topic page, gate first), then the tour body, preserving the prototype's load-bearing contracts verbatim in meaning:

- **Pacing contract**: exactly one chapter per reply, end the turn with the "say **next**" prompt; **skip** / **stop** / **done** handling; 2–4 sentences + the action + one "where to look" sentence; **repaint latency note** (CLI option writes reach the UI on the safety poll — allow up to ~12s, never stack mutations in one beat; UI-originated changes repaint instantly).
- **Failure posture**: every chapter degrades, never errors (code-server down, no push subscription, a companion page fails to present → one line, show what it would do, move on).
- **Preflight**: gate (`command -v rk && [ -n "$TMUX_PANE" ]`, else STOP with the "run me inside a run-kit-managed pane" instruction); read `rk skill`; **stale-run recovery** (if `/tmp/rk-tutorial/original-state.json` exists, restore from it first); capture starting state (`rk tab show --json`, `rk tab web ls --json`); resolve the companion-page base (see §2); greet + ask the user to view this window in the dashboard; end turn.
- **Chapters 1–8 + Finale**, as in the current prototype: (1) Where am I — hierarchy + status-bar zoom, `tmux display-message … '#{pane_id} · #S · #W'`, `rk url`; (2) Sidebar signals **UI-first** — the user presses the marker well (3×3 pad, press→drag→release; tap on touch), opens the flyout card (color, note), tries the palette (`marker`/`color`/`note`), then the agent closes with `tmux set-option -w @rk_win_flair nyan` + a `@rk_win_note "$(date +%s):…"`; (3) Show, don't tell — `rk present` a generated `/tmp/rk-tutorial/welcome.html`, edit + re-present (re-present is the refresh verb), the **"present it to me"** phrase, role-flip hands-on; (4) Layouts — `rk tab layout` read, `main-left:web,tty`, `--promote tty`, `split-h:tty,web`, **one mutation per beat with a "tell me when you see it" turn end**, never `single:tty` mid-tour; (5) Code lens — `--add code`, `rk tab code set "$(git rev-parse --show-toplevel)"`, `rk code hosts` gate, `rk code exec vscode.open …README.md`, `--rm code`; (6) Web-tab strip — `rk tab web ls` (the companions are the demo), `select`, the **↗ Open in browser** escape hatch, `rm` tidy-up with dense renumbering; (7) ⌘K — palette as the complete action registry (Constitution V), `marker`/`layout`/`web` lookups, Settings (⌘, in the desktop app; ⌘K→`settings` in mac browsers; ⇧Ctrl+, on Win/Linux) and the Shortcuts tab (⌘/); (8) Operator — the pinned operator row, plain-language asks ("Start a claude session on <repo>", "Start a kimi session", "Start a claude session, but with codex workers"), day-2 pointer if no operator row; **Finale** — `rk notify … --title run-kit` (fail-silent by contract), **Cleanup** (restore captured values, unset the ones that didn't exist, remove tutorial web tabs keeping originals, restore the layout, `rm -rf /tmp/rk-tutorial`), the recap cheat sheet, and the `rk skill` / topic pointers.
- **Every UI claim the page or a companion makes must be true of the shipped frontend** (marker-well press/drag pad, flyout card contents, palette entry names, the ↗ button, Settings/Shortcuts chords, the operator row placement). Apply verifies each against `app/frontend/src` and corrects the text or the mock — never ships a claim it could not locate.

Wiring, one row per file, exactly as `code`/`mux` were added:

```sh
# scripts/sync-skill.sh — add a row
sync "docs/site/skill/tutorial.md" "$DEST_DIR/tutorial.md"
```

```go
// app/backend/cmd/rk/skill.go
//go:embed skill/tutorial.md
var skillTutorialTopic []byte
// skillTopics: "tutorial": skillTutorialTopic,
```

`app/backend/cmd/rk/skill/tutorial.md` is the committed embed copy. `skill_test.go`: add the `tutorial` rows to the embed-matches-canonical table and the line-budget table; update `TestSkillUnknownTopicFailsFast`'s expected list to `code, display, mux, tutorial`; add the byte-identical topic-print case for `tutorial`.

### 2. Companion pages ship in the binary, served by the existing SPA static handler

The eight companion pages move from the prototype's `pages/` into **`app/frontend/public/tutorial/ch1-orientation.html … ch8-operator.html`** (kept self-contained: inline CSS, no external requests, dark monospace to match the dashboard). Vite copies `public/` into the dist root and `build/embed.go` embeds the dist, so the pages are served at **`/tutorial/<file>.html`** by the SPA handler's regular-file branch (`api/spa.go` — the same path `manifest.json` and `sw.js` take). **No new route** (Constitution IV) and no Go handler.

The topic page presents them by same-origin URL through the existing verb, with the base resolved once in Preflight:

```sh
RK="$(rk url)"                                   # e.g. http://127.0.0.1:3000
rk present "$RK/tutorial/ch1-orientation.html"   # per chapter: ch2-signals … ch8-operator
```

**Required `rk present` refinement (the one code change beyond wiring):** a URL on the run-kit server's **own origin** must attach as its **site-relative path** (`/tutorial/ch1-orientation.html`), not as `/proxy/3000/tutorial/…` (a self-proxy) and not verbatim. Today `internal/present.ParseTarget` classifies `http://localhost:3000/x` as `KindLocalURL` → `/proxy/3000/x`, and `http://0.0.0.0:3000/x` (what `rk url` prints under a `0.0.0.0` bind — this box) as `KindExternalURL` → attached verbatim, which a remote viewer's browser cannot reach. Rule: `ParseTarget` (or the CLI layer that already knows the origin via `resolveOrigin()`) compares the URL's origin against the server origin `rk url` resolves; on a match the target's URL is the request path + query (leading `/`), using the relative form the frontend already resolves against its own origin (as `/present/…` and `/proxy/…` do). Precedence: same-origin check **before** the localhost→proxy rewrite. `rk tab web add` shares the parser, so it gains the same form. Unit-tested in `internal/present/present_test.go` (localhost + non-localhost bind, path+query preserved, non-matching localhost URL still proxies, https still verbatim) and pinned in `docs/site/skill/display.md`'s target-form list (one line; budget check).

### 3. Core bundle + docs surface

- `docs/site/skill.md` (+ synced `cmd/rk/skill/skill.md`): keep the already-staged **Sidebar signals** block; add one **topic-index** line — *"guided first-run tour (the user asks for a tutorial / tour / onboarding of run-kit) → `rk skill tutorial`"* — so an agent discovers the tour from the core and the standard's "core lists every shipped topic" rule holds. Core stays ≤150 lines (currently 108).
- `README.md` command-reference `run-kit skill` row: name the topic set (`display`, `mux`, `code`, `tutorial`) instead of only `display`.
- A **drift guard** between the topic page and the pages: a test that every `tutorial/ch*.html` reference in `docs/site/skill/tutorial.md` exists under `app/frontend/public/tutorial/` and vice-versa (Go test in `cmd/rk` reading both via the `../../../../` relative root, next to the embed drift guards).

### 4. Prototype retirement

`.claude/skills/rk-tutorial/` is untracked (`.claude/` is not tracked in this repo) and is **not** shipped; once the topic page + pages land it is deleted from the worktree. Discovery for agents is the core-bundle topic index + the `shll-toolkit` bootstrap skill's existing `rk skill` two-step; a follow-up in the shll repo may add "tutorial/tour" trigger words to that skill's description (out of scope here).

## Affected Memory

- `run-kit/toolkit-standards`: (modify) the `skill` standard's conformance posture gains the fourth topic (`tutorial`), its budget/drift-guard rows, and the same-origin `present` form as a documented target.
- `run-kit/architecture`: (modify) CLI Subcommands `skill` row (topics: display/code/mux/**tutorial**), `present` row (same-origin → relative-path rule), repository structure (`skill/tutorial.md` embed copy, `app/frontend/public/tutorial/`), `sync-skill.sh` row.
- `run-kit/api-and-sockets`: (modify) note that the SPA static handler serves the shipped `/tutorial/*.html` companion pages (regular-file branch, no new route).
- `run-kit/ui/…` (the lenses/surface-layout or web-tab file): (modify) `@rk_win_web_<n>` accepts site-relative paths beyond `/present/`/`/proxy/` — the tutorial pages are the first such consumer.

## Impact

- **Go**: `cmd/rk/skill.go`, `skill_test.go`, `skill/tutorial.md` (new embed copy), `skill/skill.md` (sync), `internal/present/present.go` + `present_test.go` (same-origin rule), possibly `cmd/rk/present.go` if the origin is injected at the CLI layer.
- **Frontend static**: `app/frontend/public/tutorial/*.html` (8 new files, ~30 KB total; no TS/React changes expected).
- **Scripts/docs**: `scripts/sync-skill.sh`, `docs/site/skill/tutorial.md` (new), `docs/site/skill.md`, `docs/site/skill/display.md` (one target-form line), `README.md`.
- **Tests**: Go unit tests only (skill drift guards + budget + unknown-topic list; present parser table; page↔topic drift guard). No e2e needed — the tour is agent-executed prose; the pages are static files.
- **Constitution**: IV (no new route — static files via the existing SPA handler), VIII (sync logic stays in `scripts/`), Toolkit Standards (`skill` standard: ≤150 lines, static-only, byte-identical, core topic index, unknown-topic error; `readme-extraction` for the README row).
- **Not in scope**: `[0ccm]` (waking the SSE derive tick on CLI mutations — the tour paces around the latency instead), shll-repo trigger-word updates, any frontend UI change.

## Open Questions

- None blocking. The plan should confirm `app/frontend/public/` is copied into the embedded dist by the production build path used in CI (`just build`) — it is Vite's default, and `manifest.json`/`sw.js` already rely on it.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Ship as `rk skill tutorial` with canonical `docs/site/skill/tutorial.md`, wired exactly like `display`/`code`/`mux` (sync row, `//go:embed`, `skillTopics` entry, drift-guard + budget tests) | Named by the backlog item; the mechanism and its test pattern already exist three times over | S:95 R:85 A:95 D:95 |
| 2 | Certain | Content source of truth is the **current on-disk prototype** (8 chapters + finale, companion pages), not the 7-chapter version that ran in this session | The prototype was iterated after this session's run; the newer file is the user's latest intent | S:85 R:80 A:90 D:90 |
| 3 | Confident | Compress the tour into a **single** ≤150-line topic page rather than splitting into two topics | The standard's sprawl guard says a handful of topics, each a briefing; the prototype is 166 lines, and its per-chapter page-present boilerplate collapses to one pattern line | S:70 R:85 A:80 D:70 |
| 4 | Confident | Companion pages ship as **static files in `app/frontend/public/tutorial/`**, served by the existing SPA regular-file branch — no new route, no Go handler | Constitution IV; `manifest.json`/`sw.js` are the exact precedent; alternatives (embed + new route, `rk skill --pages` extraction, shll.ai-hosted external URLs, agent-generated pages) each add surface, network, or budget cost | S:55 R:65 A:75 D:60 |
| 5 | Confident | Reach the pages via `rk present "$(rk url)/tutorial/…"` and teach `present`/`tab web add` a **same-origin → site-relative** rule (checked before the localhost→proxy rewrite) | Today a same-origin URL either self-proxies (`localhost`) or attaches verbatim (`0.0.0.0` bind — this box), breaking remote viewers; the frontend already resolves relative forms; small parser change with a unit-test table | S:60 R:70 A:75 D:65 |
| 6 | Certain | The staged 5-line **Sidebar signals** core-bundle block rides this change | It was written for Chapter 2 during prototyping, sits uncommitted in this worktree, and the core has budget room (108/150) | S:75 R:90 A:85 D:85 |
| 7 | Confident | Add a **page↔topic drift-guard test** (every `tutorial/ch*.html` referenced by the topic page exists, and no orphan pages) | Mirrors the embed drift guards' spirit; cheap; prevents a renamed page silently breaking a chapter | S:60 R:90 A:85 D:75 |
| 8 | Confident | Apply **verifies every UI claim** in the tour and the mocks against the shipped frontend and corrects text/mocks rather than shipping unverified affordances | The prototype's UI-first chapters (marker pad, flyout card, ↗ button, Settings chords, operator row) were written from memory of the UI; a tour that points at something that isn't there fails its one job | S:65 R:85 A:80 D:80 |
| 9 | Certain | Inferred `change_type` is corrected to `feat` if the `docs/` path in the description trips the `docs` keyword | The change adds Go embed wiring, a parser rule, static assets and tests — not documentation-only | S:80 R:95 A:95 D:95 |
| 10 | Certain | The prototype `.claude/skills/rk-tutorial/` is deleted after landing, not committed | `.claude/` is untracked in this repo; the shipped topic page replaces it; discovery is the core-bundle topic index | S:70 R:95 A:85 D:80 |

10 assumptions (5 certain, 5 confident, 0 tentative, 0 unresolved).
