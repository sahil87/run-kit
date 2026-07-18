# Plan: Skill Display Topic Page, `rk url`, Retire `rk context`

**Change**: 260718-icxz-skill-display-topic-url-retire-context
**Intake**: `intake.md`

## Requirements

### CLI: `rk skill display` topic subcommand

#### R1: `rk skill display` prints the display topic page byte-identical
`rk skill display` SHALL print the canonical `docs/site/skill/display.md` as raw markdown to stdout, byte-identical to that file, with empty stderr and exit 0 — the same invocation contract as the core `rk skill` bundle. No rendering, no pager, no added framing.

- **GIVEN** run-kit is installed and `docs/site/skill/display.md` is embedded
- **WHEN** an agent runs `rk skill display`
- **THEN** stdout equals the embedded display topic bytes exactly
- **AND** stderr is empty and the process exits 0

#### R2: An unknown topic fails fast
`rk skill <topic>` with an unrecognized topic SHALL fail fast: a non-zero exit code, an error on stderr naming the valid topics, and empty stdout. It MUST NOT print an empty document to stdout and MUST NOT exit 0.

- **GIVEN** run-kit is installed
- **WHEN** an agent runs `rk skill bogus`
- **THEN** stdout is empty, stderr carries an error naming the valid topic(s) (e.g. `unknown topic "bogus" (valid: display)`), and the exit code is non-zero (usage-class, per the toolkit exit-code convention)

#### R3: Bare `rk skill` is unchanged and never inlines topic pages
`rk skill` with no argument SHALL continue to print only the core bundle (`docs/site/skill.md`) byte-identical, exit 0, empty stderr — it MUST NOT inline any topic page.

- **GIVEN** a display topic page now exists
- **WHEN** an agent runs bare `rk skill`
- **THEN** stdout equals the core bundle bytes exactly, with no topic-page content appended

### Docs: display topic page content

#### R4: `docs/site/skill/display.md` absorbs `rk context`'s static content
A new canonical file `docs/site/skill/display.md` SHALL exist, be ≤150 lines, and be static-only (no timestamps, environment lookups, or session state). It SHALL cover: Terminal Windows (`tmux new-window -n <name>`), Iframe Windows (`@rk_type iframe` + `@rk_url <url>`, including changing an existing window's URL), Proxy (`/proxy/{port}/...`), the Visual Display Recipe (the canonical 4-step flow with fail-silent discipline intact), and the Conventions block (`@rk_type`/`@rk_url` option schema, Window Lifecycle, SSE Reactivity). Live values SHALL be referenced symbolically only — relative `/proxy/<port>/...` paths and "get the server URL from `rk url`" — never a literal host:port. The old `rk context` **CLI Commands** section SHALL NOT be carried over.

- **GIVEN** the merged skill standard's topic-page rules
- **WHEN** `docs/site/skill/display.md` is authored
- **THEN** it is ≤150 lines, static-only, and contains the Terminal Windows / Iframe Windows / Proxy / Visual Display Recipe sections and the Conventions block, with no CLI Commands section and no literal server URL

### CLI: `rk url` subcommand

#### R5: `rk url` prints the config-derived server URL
`rk url` SHALL print the run-kit server URL derived from `config.Load()` (RK_HOST/RK_PORT env vars with `127.0.0.1:3000` defaults, port-validated) to stdout, newline-terminated, exit 0, empty stderr. The derivation SHALL be byte-equal to the old `context.go` `serverURL()` (`http://<host>:<port>`). It MUST NOT read a `.env` file and MUST NOT probe the port owner or perform any liveness check.

- **GIVEN** RK_HOST and RK_PORT are unset
- **WHEN** an agent runs `rk url`
- **THEN** stdout is `http://127.0.0.1:3000\n`, stderr is empty, exit 0
- **AND GIVEN** RK_HOST=10.0.0.1 and RK_PORT=8080, **THEN** stdout is `http://10.0.0.1:8080\n`

#### R6: `rk url` help states it is a config-derived heuristic
The `rk url` help/Long text SHALL state plainly that the URL is a config-derived heuristic (what the server *would* bind given this environment), not a liveness probe.

- **GIVEN** an agent inspects `rk url --help`
- **WHEN** it reads the Long description
- **THEN** the text describes the value as config-derived, not a proof the server is running

### CLI: retire `rk context`

#### R7: `rk context` is removed outright
`rk context` SHALL be removed entirely: `app/backend/cmd/rk/context.go` and `app/backend/cmd/rk/context_test.go` deleted, and its cobra registration removed from `root.go`. There SHALL be no deprecation stub or alias.

- **GIVEN** the binary is built at HEAD
- **WHEN** an agent runs `rk context`
- **THEN** it is treated as an unknown command (usage-class exit 2, cobra's native unknown-command stderr) — the subcommand no longer exists
- **AND** no `contextCmd`, `runContext`, `serverURL`, or `tmuxQuery` symbol remains in the package

### Embed & sync mechanism

#### R8: Topic pages embed via the existing sync + drift-guard pattern
`scripts/sync-skill.sh` SHALL be extended to copy `docs/site/skill/display.md` → `app/backend/cmd/rk/skill/display.md`. `skill.go` SHALL `//go:embed` the copied topic file. A byte-equality drift-guard test (like `TestSkillEmbedMatchesCanonical`) SHALL assert the embedded topic bytes equal the canonical `docs/site/skill/display.md`, and a line-budget test SHALL pin the topic page ≤150 lines.

- **GIVEN** someone edits `docs/site/skill/display.md` without re-running the sync script
- **WHEN** `go test ./...` runs
- **THEN** the topic drift-guard test fails, naming `scripts/sync-skill.sh` as the fix
- **AND GIVEN** the topic page exceeds 150 lines, the topic line-budget test fails

### Docs: core bundle updates

#### R9: Core bundle gains the topic index and "Where am I" block, drops `rk context`
`docs/site/skill.md` SHALL: (a) add a topic-index line naming what the display topic covers and the command that serves it (`rk skill display`); (b) add a ~6-line "Where am I" derivation block teaching the `$TMUX_PANE` / `tmux display-message` / `tmux show-option @rk_type` / `rk url` recipe; (c) replace ALL `rk context` references — the capabilities line, the composition-pattern paragraph, the `rk context ... | grep 'Server URL'` extraction recipe (→ `rk url`), the gotcha, and the static/dynamic framing — with `rk url` and the derivation block; (d) stay ≤150 lines total. Its embedded mirror (`app/backend/cmd/rk/skill/skill.md`) SHALL be re-synced so the drift guard passes.

- **GIVEN** the core bundle
- **WHEN** it is updated
- **THEN** it contains no `rk context` / `run-kit context` reference, contains a topic-index line for `rk skill display`, contains the "Where am I" derivation block, uses `rk url` for server-URL discovery, and is ≤150 lines
- **AND** `docs/site/skill.md` and `app/backend/cmd/rk/skill/skill.md` are byte-identical

#### R10: README and `skill.go` doc-comment references to `rk context` are updated
`README.md`'s command-reference rows SHALL replace the `run-kit context` row (and the "static complement to `run-kit context`" phrasing in the `run-kit skill` row) with the new surface (`run-kit url`, and the `run-kit skill` row no longer referencing `context`). The stale doc-comment in `skill.go` ("that stays exclusive to `rk context`") and the Long text pointing at `run-kit context` SHALL be updated to reflect the retired command.

- **GIVEN** `rk context` no longer exists
- **WHEN** README.md and skill.go are inspected
- **THEN** neither references `run-kit context` / `rk context`; the README documents `run-kit url`; `skill.go`'s comment and Long text point at `rk url` / the derivation recipe instead

### Non-Goals

- Port-owner / liveness verification for `rk url` (the `daemon_portowner.go` machinery) — deferred; `rk url` existing is what keeps that door open.
- `.env` file reading in `rk url` — the derivation is env-var + defaults only, byte-equal to today's `context.go`.
- fab-kit `_cli-external.md` § rk update — sibling change in the fab-kit repo, out of scope here.
- Softening the skill standard's Precedent prose — handled in the user's in-flight standard PR.

### Design Decisions

1. **Topic dispatch via `rk skill <topic>` args, not a nested subcommand tree**: `skillCmd` gains a validator that accepts 0 or 1 positional arg; 0 → core bundle, 1 → topic lookup in a small `map[string]bundle` (or switch), unknown → fail-fast usage error. — *Why*: the standard's invocation contract is `<tool> skill <topic>`; a single command with a positional arg keeps registration minimal and matches the standard's shape. — *Rejected*: registering `display` as a child cobra command of `skill` (heavier, and `bare skill` + unknown-topic fail-fast semantics are cleaner to express in one RunE).
2. **`rk url` uses `config.Load()` directly, mirroring `notify.go`**: the URL is `fmt.Sprintf("http://%s:%d", cfg.Host, cfg.Port)` — byte-equal to the deleted `serverURL()`. — *Why*: reuses the existing config utility (no duplication), byte-equal to prior behavior. — *Rejected*: a shared helper extracted from context.go (context.go is being deleted; the one-liner is trivial).
3. **Unknown-topic error is usage-class (exit 2)**: it flows through cobra's `RunE` return as an `*exitCodeError{code: exitUsage}` via the existing `usageError()` helper. — *Why*: an unknown topic is a usage error, consistent with the toolkit exit-code convention (§ Toolkit Standards / Principle 4) already implemented in `exit_code.go`. — *Rejected*: a plain error (would exit 1, operational — miscategorizes a usage mistake).

## Tasks

### Phase 1: Docs — canonical content

- [x] T001 Create `docs/site/skill/display.md` (≤150 lines, static-only): Terminal Windows, Iframe Windows (incl. changing an existing window's URL), Proxy (`/proxy/{port}/...`), Visual Display Recipe (canonical 4-step flow, fail-silent), and Conventions (`@rk_type`/`@rk_url` schema, Window Lifecycle, SSE Reactivity). Symbolic live values only; "get the server URL from `rk url`"; no CLI Commands section; no literal host:port. <!-- R4 -->

### Phase 2: Backend — embed, sync, drift guard

- [x] T002 Extend `scripts/sync-skill.sh` to also copy `docs/site/skill/display.md` → `app/backend/cmd/rk/skill/display.md` (keep the existing core copy). <!-- R8 -->
- [x] T003 Run `scripts/sync-skill.sh` to produce the committed embed copy `app/backend/cmd/rk/skill/display.md`. <!-- R8 -->

### Phase 3: Backend — new subcommands & retire context

- [x] T004 Add `//go:embed skill/display.md` + `displayTopic []byte` to `app/backend/cmd/rk/skill.go`; extend `skillCmd` to accept 0-or-1 positional arg (`cobra.MaximumNArgs(1)`), dispatch bare→core bundle / `display`→topic / unknown→`usageError(fmt.Errorf("unknown topic %q (valid: display)", topic))` on stderr with empty stdout; update the stale doc-comment ("that stays exclusive to `rk context`") and the Long text (`run-kit context` pointer → `rk url` / derivation recipe). <!-- R1 R2 R3 R8 R10 -->
- [x] T005 Create `app/backend/cmd/rk/url.go`: `urlCmd` printing `http://<host>:<port>\n` from `config.Load()` to stdout, `cobra.NoArgs`, `SilenceUsage: true`, Long text stating it is a config-derived heuristic not a liveness probe; register it in `root.go` (`rootCmd.AddCommand(urlCmd)`). <!-- R5 R6 -->
- [x] T006 Delete `app/backend/cmd/rk/context.go` and `app/backend/cmd/rk/context_test.go`; remove `rootCmd.AddCommand(contextCmd)` from `root.go`. <!-- R7 -->

### Phase 4: Backend — tests

- [x] T007 [P] Create `app/backend/cmd/rk/url_test.go`: assert `rk url` prints `http://127.0.0.1:3000\n` with defaults and `http://10.0.0.1:8080\n` under RK_HOST/RK_PORT, empty stderr, nil error; assert registration on `rootCmd`. <!-- R5 -->
- [x] T008 [P] Extend `app/backend/cmd/rk/skill_test.go`: add `TestSkillDisplayPrintsTopicByteIdentical` (stdout == embedded topic, empty stderr, exit 0), `TestSkillDisplayEmbedMatchesCanonical` (topic embed == `docs/site/skill/display.md`), `TestSkillDisplayWithinLineBudget` (≤150), `TestSkillUnknownTopicFailsFast` (empty stdout, non-nil usage-class error, stderr names valid topics), and `TestSkillBareStillPrintsCoreBundle` (bare arg → core bundle only). <!-- R1 R2 R3 R8 -->

### Phase 5: Docs — core bundle & README

- [x] T009 Edit `docs/site/skill.md`: add the `rk skill display` topic-index line; add the ~6-line "Where am I" derivation block; replace ALL `rk context` references (capabilities line, composition paragraph, `grep 'Server URL'` extraction recipe → `rk url`, gotcha, static/dynamic framing); keep ≤150 lines. Then re-run `scripts/sync-skill.sh` to refresh `app/backend/cmd/rk/skill/skill.md`. <!-- R9 -->
- [x] T010 Edit `README.md` command-reference table: replace the `run-kit context` row with a `run-kit url` row; update the `run-kit skill` row to drop "static complement to `run-kit context`" phrasing. <!-- R10 -->

## Execution Order

- T001 → T002 → T003 (canonical file must exist before the sync script copies it; the embed copy must exist before Go compiles/embeds it in T004).
- T004, T005, T006 depend on T003 (T004 embeds the topic copy). T005 and T006 are independent of T004 but all touch `root.go` — apply them sequentially to avoid edit collisions.
- T007, T008 [P] run after their targets exist (T005 for T007; T003+T004 for T008).
- T009 depends on T005 (references `rk url`) and must re-sync the core embed after editing. T010 is independent docs work.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `rk skill display` prints `docs/site/skill/display.md` byte-identical to stdout, empty stderr, exit 0 (proven by `TestSkillDisplayPrintsTopicByteIdentical`).
- [x] A-002 R2: `rk skill bogus` exits non-zero (usage-class) with an error on stderr naming the valid topics and empty stdout (proven by `TestSkillUnknownTopicFailsFast`).
- [x] A-003 R3: bare `rk skill` still prints only the core bundle, byte-identical, exit 0 (proven by `TestSkillBareStillPrintsCoreBundle`).
- [x] A-004 R4: `docs/site/skill/display.md` exists, is ≤150 lines, static-only, and carries Terminal Windows / Iframe Windows / Proxy / Visual Display Recipe / Conventions with no CLI Commands section and no literal host:port.
- [x] A-005 R5: `rk url` prints the config-derived URL newline-terminated (`http://127.0.0.1:3000` default; env-overridden), empty stderr, exit 0 (proven by `url_test.go`).
- [x] A-006 R6: `rk url --help` Long text describes the value as config-derived, not a liveness probe.
- [x] A-007 R7: `context.go` + `context_test.go` are deleted, `contextCmd` registration is gone, and no `contextCmd`/`runContext`/`serverURL`/`tmuxQuery` symbol remains.
- [x] A-008 R8: `scripts/sync-skill.sh` syncs the topic file, `skill.go` embeds it, and the topic drift-guard + line-budget tests pass and fail correctly on drift/over-budget.
- [x] A-009 R9: `docs/site/skill.md` has no `rk context` reference, carries the topic-index line and "Where am I" block, uses `rk url`, is ≤150 lines, and is byte-identical to its embedded mirror.
- [x] A-010 R10: `README.md` and `skill.go` no longer reference `run-kit context`; README documents `run-kit url`; skill.go's comment/Long point at `rk url` / the derivation recipe.

### Behavioral Correctness

- [x] A-011 R5: `rk url`'s derivation is byte-equal to the deleted `context.go` `serverURL()` (`http://%s:%d` from `config.Load()`), verified against the same RK_HOST/RK_PORT inputs.
- [x] A-012 R2: the unknown-topic error is usage-class (exit 2 via `usageError`), not operational (1).

### Removal Verification

- [x] A-013 R7: `rk context` is an unknown command post-change (no stub/alias); a repo-wide grep finds no live `contextCmd`/`runContext`/`serverURL`/`tmuxQuery` references.

### Scenario Coverage

- [x] A-014 R1: the `rk skill display` byte-identity is exercised by a test driving the cobra command.
- [x] A-015 R2: the unknown-topic fail-fast path is exercised by a test asserting empty stdout + non-nil usage error.

### Edge Cases & Error Handling

- [x] A-016 R2: `rk skill` with an empty-string or multi-arg invocation is rejected by the arg validator (`MaximumNArgs(1)`) — two-arg invocation is a usage error; the single-unknown-topic case is handled by the topic dispatch.

### Code Quality

- [x] A-017 Pattern consistency: `url.go` and the `skill.go` topic dispatch follow the surrounding cobra-command idioms (`config.Load()`, `cmd.OutOrStdout()`, `SilenceUsage`, `usageError`), matching `notify.go` / `skill.go` conventions.
- [x] A-018 No unnecessary duplication: `rk url` reuses `internal/config.Load()` rather than reimplementing env parsing; the topic embed reuses the existing sync + drift-guard pattern rather than a parallel mechanism.
- [x] A-019 Subprocess safety: no new subprocess calls are introduced (`rk url` is pure config; the deleted `tmuxQuery` was the only `exec` in context.go) — Constitution I / Process Execution remain satisfied.
- [x] A-020 Tests included: new/changed CLI behavior (`rk url`, `rk skill display`, unknown-topic, retired `rk context`) is covered by Go tests per code-quality.md.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `docs/site/skill.md:35-61` (Iframe windows / Proxy / Visual Display Recipe capability bullets) — now duplicated near-verbatim, in depth, by the new `docs/site/skill/display.md` topic page; the core copies could collapse to the existing one-line `rk skill display` topic pointer, freeing ~25 core-budget lines and removing the intra-bundle static-content drift risk (nothing pins the two copies to each other — each drift guard only pins embed↔canonical).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Topic named `display`, canonical `docs/site/skill/display.md`, embedded copy `app/backend/cmd/rk/skill/display.md` | Intake §1 + merged standard fix the name and path shape; user proposed the name | S:90 R:85 A:90 D:90 |
| 2 | Certain | `rk context` deleted outright — no stub/alias; `context.go` + `context_test.go` removed, registration dropped | Intake §3 verbatim ("completely get rid of"); version-locked embed makes removal atomic | S:95 R:70 A:90 D:90 |
| 3 | Certain | Topic dispatch via `cobra.MaximumNArgs(1)` on `skillCmd` with an in-`RunE` topic switch, not a nested child command | Standard's invocation contract is `<tool> skill <topic>`; single-command dispatch keeps bare/unknown/topic semantics in one place | S:80 R:85 A:85 D:80 |
| 4 | Certain | Unknown-topic error is usage-class (exit 2) via the existing `usageError()` helper | Toolkit exit-code convention already implemented in `exit_code.go`; an unknown topic is a usage mistake | S:85 R:90 A:95 D:90 |
| 5 | Certain | `rk url` reuses `config.Load()` and formats `http://%s:%d`, byte-equal to the deleted `serverURL()` | Intake §2 fixes the derivation; `notify.go` uses the identical pattern | S:90 R:90 A:95 D:90 |
| 6 | Confident | The display topic page keeps the Visual Display Recipe's fail-silent 4-step wording and the relative `/proxy/<port>/<filename>` example (no `{server_url}`), mirroring the retired context.go text | Intake §1 lists these sections; preserving the tested relative-path discipline avoids a regression the old context_test guarded | S:75 R:85 A:80 D:75 |
| 7 | Confident | README `run-kit context` row is replaced with a `run-kit url` row (not merely deleted); the `run-kit skill` row drops the "complement to context" phrasing | Intake §4 says update README references; keeping a row for the new command preserves the reference table's completeness | S:70 R:90 A:80 D:75 |
| 8 | Confident | The "Where am I" derivation block uses the exact 5-line recipe from intake §4 (echo $TMUX_PANE / display-message #S / #W / show-option @rk_type / rk url) verbatim in the core bundle | Intake §4 provides the block verbatim; placing it in core (not the topic) is a graded intake assumption (#7 Confident) accepted here | S:85 R:85 A:85 D:80 |

8 assumptions (5 certain, 3 confident, 0 tentative).
