# Plan: `rk present` — one-verb "show this to the user" + skill page rewrite

**Change**: 260813-becu-rk-present-attach-verb
**Intake**: `intake.md`

## Requirements

### CLI: `rk present` target resolution

#### R1: Target forms resolve deterministically
`rk present <target>` MUST accept exactly one positional target and resolve it to one of five kinds, each deriving an `@rk_url` value:

| Kind | Recognized as | Derived `@rk_url` |
|------|---------------|-------------------|
| file | existing regular file path | `/present/<windowId>/<basename>?server=<name>&v=<bust>` (+ `@rk_present_root` = file's absolute parent dir) |
| dir | existing directory path | `/present/<windowId>/?server=<name>&v=<bust>` (+ `@rk_present_root` = the absolute dir) |
| port | `:NNNN` (colon + digits) | `/proxy/<port>/` |
| local URL | absolute `http://` URL whose host is `localhost`, `127.0.0.1`, or `[::1]` | `/proxy/<port>/<path+query>` (port = explicit, else 80) |
| external URL | any other absolute `http(s)://` URL | attached verbatim |

A path that does not exist (and does not parse as a port or URL) MUST be an operational failure (exit 1). Target parsing SHALL live in a new `internal/present` package as a pure function, unit-testable without tmux.

- **GIVEN** a file `./mock.html` exists in cwd
- **WHEN** `rk present ./mock.html` runs
- **THEN** the target resolves to kind `file` with root = absolute cwd and URL path `mock.html`

- **GIVEN** the argument `:5173`
- **WHEN** the target resolves
- **THEN** the derived URL is `/proxy/5173/` and no `@rk_present_root` is involved

- **GIVEN** the argument `http://localhost:8080/docs?x=1`
- **WHEN** the target resolves
- **THEN** the derived URL is `/proxy/8080/docs?x=1` (relative form — never an absolute origin)

- **GIVEN** the argument `https://staging.example.com/app`
- **WHEN** the target resolves
- **THEN** the URL attaches verbatim

#### R2: Port/local-URL targets get a best-effort reachability probe
For `port` and `local URL` kinds, the command MUST probe TCP reachability of `127.0.0.1:<port>` with a short timeout (~1s); connection refused/timeout MUST exit 1 with a diagnostic on stderr. File/dir/external targets are never probed.

- **GIVEN** nothing listens on port 59999
- **WHEN** `rk present :59999` runs
- **THEN** exit code is 1 and stderr names the unreachable port

### CLI: attach behavior

#### R3: Default arm attaches to the caller's own window
Without `--window`, `rk present` MUST derive the caller's pane from `$TMUX_PANE` and its window id (`@N`) and tmux server from the pane (via `tmux display-message` using socket args derived from `tmux.OriginalTMUX`, the pattern `cmd/rk/agent_hook.go` uses), then set `@rk_url` (and, for file/dir targets, `@rk_present_root`) on that window via the existing `internal/tmux` window-option primitives (`SetWindowOption`/`SetWindowOptions`). It MUST print the resolved `@rk_url` value to stdout (data contract — printed even under `--quiet`). It MUST NOT create windows, POST to any API, or attempt to open/change any viewer's tile or layout. Running outside tmux (no `$TMUX_PANE`) without `--window` MUST exit 1.

- **GIVEN** a shell inside a tmux pane on server `dev`, window `@7`
- **WHEN** `rk present ./mock.html` runs
- **THEN** window `@7` carries `@rk_present_root=<abs dir>` and `@rk_url=/present/@7/mock.html?server=dev&v=<bust>`, and stdout is that URL
- **AND** no new window exists and no HTTP call was made to the rk server

#### R4: Re-present is the refresh verb
The `?v=` cache-buster (unix-seconds value) MUST be appended only to `/present/` URLs, so re-running `rk present` on the same file/dir target writes a different `@rk_url` and an open web tile re-navigates. Port/URL targets re-set `@rk_url` verbatim with no buster.

- **GIVEN** window `@7` already carries `@rk_url=/present/@7/mock.html?server=dev&v=100`
- **WHEN** `rk present ./mock.html` runs again later
- **THEN** `@rk_url` differs only in its `v=` value

#### R5: `--window` spawns the standalone fallback
`--window[=name]` MUST create a new tmux window in the caller's session (exact-match `=session:` target) via `tmux.CreateWindowWithOptions`, atomically setting `@rk_type=iframe`, `@rk_url`, and — for file/dir targets — `@rk_present_root` (with `<windowId>` in the URL being the NEW window's id, so creation resolves the id first or uses the primitive's returned id). The window name defaults from the target basename, sanitized to pass `internal/validate` name rules (colons/periods replaced with `-`, following the `port-{port}` precedent). `--window` MUST work outside a tmux pane only when a session can be resolved; inside tmux it targets the caller's current session.

- **GIVEN** a pane in session `work` and the argument `https://staging.example.com`
- **WHEN** `rk present --window https://staging.example.com` runs
- **THEN** a new window exists in session `work` with `@rk_type=iframe` and `@rk_url=https://staging.example.com`, and its name derives from the URL host (sanitized)

#### R6: `--notify` is optional and fail-silent
`--notify[=msg]` MUST send a Web Push through the same machinery as `rk notify` (message defaulting to `presenting <basename>`), after the attach succeeds. The send is fail-silent per `rk notify`'s documented contract: any send failure exits 0 and prints nothing. v1 is plain text only — no deep-link/url field (deferred to a follow-up change).

- **GIVEN** the rk server is unreachable
- **WHEN** `rk present ./mock.html --notify` runs in a tmux pane
- **THEN** the attach succeeds, the URL prints, and the exit code is 0 despite the failed push

#### R7: Exit codes follow the toolkit convention
`0` success; `1` operational failure (not in tmux without `--window`, missing file, unreachable port, tmux command failure); `2` usage error (no target, unknown flag, both invalid). Only the `--notify` send deviates (fail-silent, R6). Diagnostics go to stderr; stdout carries only the URL.

- **GIVEN** no arguments
- **WHEN** `rk present` runs
- **THEN** exit code is 2 with usage on stderr

### API: the `/present/{windowId}/` content route

#### R8: Serving is derived from tmux at request time
The server MUST register `GET /present/{windowId}/*` (and the bare `/present/{windowId}` → trailing-slash redirect, mirroring the proxy routes) beside the proxy routes in `api/router.go`. The handler (new `api/present.go`) MUST: validate `windowId` matches `^@[0-9]+$` before any subprocess call; resolve the tmux server via the existing `serverFromRequest` helper (`?server=` query param, `default` fallback); read the window's `@rk_present_root` option from tmux AT REQUEST TIME (a new `internal/tmux` window-option getter mirroring `SetWindowOption`, `exec.CommandContext` with the 5s tmux timeout tier); and serve the requested file from under that root. No cache, no registration state, no disk store — a dead window or unset option is a 404. Responses set MIME by extension via the Go stdlib (`http.ServeContent`/`ServeFile` semantics).

- **GIVEN** window `@7` on server `dev` carries `@rk_present_root=/home/u/mocks`
- **WHEN** `GET /present/@7/mock.html?server=dev` arrives
- **THEN** `/home/u/mocks/mock.html` is served with `Content-Type: text/html`

- **GIVEN** window `@7` carries no `@rk_present_root`
- **WHEN** `GET /present/@7/mock.html` arrives
- **THEN** the response is 404

#### R9: Containment, not lexical prefixes
The handler MUST refuse to serve unless: the option value is an absolute path; the resolved (symlink-evaluated) requested file stays contained under the resolved root (checked via `filepath.Rel` on the two `EvalSymlinks` results — never a lexical prefix/`..` string ban, per the code-server tarball lesson: intra-tree symlinks are legitimate, escaping ones are not). Directory requests (`/` or a path resolving to a directory) serve `index.html` under that directory or 404 — never a directory listing. Traversal attempts (`..`, encoded variants, symlinks pointing outside the root) MUST yield 404 without touching files outside the root.

- **GIVEN** root `/home/u/mocks` containing `link.html → ./real.html`
- **WHEN** `GET /present/@7/link.html` arrives
- **THEN** it serves (intra-tree symlink allowed)

- **GIVEN** root `/home/u/mocks` containing `evil → /etc`
- **WHEN** `GET /present/@7/evil/passwd` arrives
- **THEN** the response is 404 and `/etc/passwd` is never read

- **GIVEN** any request path containing `..` segments that would escape the root
- **WHEN** the handler resolves it
- **THEN** the response is 404

### Skill bundle: teach the new verb

#### R10: Core bundle rewrite
`docs/site/skill.md` (canonical; synced to `app/backend/cmd/rk/skill/skill.md` by `scripts/sync-skill.sh`) MUST replace the iframe-windows capability bullet and the 4-step Visual Display Recipe with `rk present`: the capability line becomes a one-liner (`rk present <path|url>` — attach web content beside your own terminal), and the recipe becomes generate → `rk present` → optionally `--notify`. The existing gate (`command -v rk` + `$TMUX_PANE`), output/exit-code contracts section (extended with `rk present`'s codes), and the ≤150-line budget MUST be preserved.

- **GIVEN** the rewritten bundle
- **WHEN** `rk skill` prints it
- **THEN** it teaches `rk present` as the canonical visual-display path, stays ≤150 lines, and no longer instructs agents to create `@rk_type=iframe` windows as the primary recipe

#### R11: `display` topic page rewrite
`docs/site/skill/display.md` (canonical; synced to `app/backend/cmd/rk/skill/display.md`) MUST be restructured around `rk present`: target forms and what each resolves to; attach-vs-standalone criteria (external URL with no owning pane / second simultaneous mock / board-pinnable identity → `--window`); the explicit expectation "you cannot open the tile for the user — availability appears on the rail; use `--notify` when the user may be away"; iteration ("re-present is the refresh verb"; live filesystem serving means plain reload sees edits); and a short appendix keeping the raw manual `@rk_type`/`@rk_url` window recipe for older rk versions. ≤150-line budget preserved.

- **GIVEN** the rewritten topic page
- **WHEN** `rk skill display` prints it
- **THEN** the primary recipe is `rk present`, the standalone-window criteria are stated, and the manual appendix survives for version skew

### Toolkit standards & docs

#### R12: New CLI surface conforms to toolkit standards
The new subcommand MUST conform to the standards governing changed surfaces: `help-dump` (the command appears in the machine-readable tree; any pinned goldens/tests updated), `principles` (stdout=data/stderr=diagnostics, `--quiet` suppresses only decoration — the URL still prints, exit codes per R7), and `readme-extraction` (README/docs-site command documentation updated as that standard requires). Check each with `shll standards <name>` before finalizing.

- **GIVEN** the finished change
- **WHEN** `rk help-dump` runs
- **THEN** `present` appears with its flags, and the help-dump tests pass

### Non-Goals

- No `rk notify --url` deep-link click-through (deferred follow-up — push payload + service-worker change)
- No frontend changes: HINT_ORDER's additive web tile behavior is verified by inspection, not modified; no new mutating API endpoints
- No directory listing on `/present/` (index.html or 404)
- No multi-mock support on one window (one `@rk_url` per window; `--window` is the escape)
- No spawned static server, no spool/copy store, no GC

### Design Decisions

#### Tmux-option-derived serving
**Decision**: File/dir targets are served by a new `/present/{windowId}/` GET route that resolves the window's `@rk_present_root` option from tmux at request time; `rk present` only sets window options.
**Why**: Constitution II/X native — the serve root is an ephemeral fact about what the pane is presenting; it lives in tmux, dies with the window, needs no registration state, no GC, no new disk store; live edits are visible on reload.
**Rejected**: wrapping `python3 -m http.server` (port-picking, python dependency, orphan-process lifecycle); spool-copy under `$XDG_STATE_HOME/rk/present/` (GC + size caps, kills live iteration, strains Constitution II's carve-outs).
*Introduced by*: 260813-becu-rk-present-attach-verb

#### The verb never opens the tile
**Decision**: `rk present` sets availability only; which tile a viewer opens stays per-viewer client state.
**Why**: surface-layout spec R7/L3 — layout is per-viewer, URL+localStorage; a server-side push would recreate the `@rk_type`-mutation conflation the lens model just retired.
**Rejected**: auto-opening the tile (violates per-viewer layout); server-pushed "suggested layout" (creep).
*Introduced by*: 260813-becu-rk-present-attach-verb

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/backend/internal/present/present.go`: `Target` type + `ParseTarget(arg, cwd string) (Target, error)` covering the five kinds of R1 (file/dir/port/local-URL/external-URL, localhost-host set, default port 80, verbatim external), plus URL-derivation helpers (`PresentURL(windowID, name, server string, now func() int64)`, proxy-form composition preserving path+query). Pure functions, no tmux. <!-- R1 -->
- [x] T002 [P] Add table-driven tests `app/backend/internal/present/present_test.go`: every target form, nonexistent path → error, localhost variants (`localhost`, `127.0.0.1`, `[::1]`, explicit/default port, path+query preserved), external https verbatim, `?v=` only on `/present/` URLs. <!-- R1, R4 -->

### Phase 2: Core Implementation

- [x] T003 Add a window-option getter to `app/backend/internal/tmux/tmux.go` (beside `SetWindowOption` at ~:1608): `GetWindowOption(ctx, windowID, server, option string) (string, error)` via `show-options -w -qv`, `exec.CommandContext` + 5s timeout, with a unit test alongside existing option-primitive tests. Reuse an existing equivalent instead if one already exists (verify first). <!-- R8 -->
- [x] T004 Create `app/backend/cmd/rk/present.go`: cobra command `present <target>` — derive pane/window-id/server-name from `$TMUX_PANE` + `tmux.OriginalTMUX` (agent_hook.go's socket-args pattern; server name = socket basename, `default` for the default socket), run `ParseTarget`, probe reachability for port/local-URL kinds (R2), set `@rk_url` (+ `@rk_present_root` for file/dir) via `tmux.SetWindowOptions`, print the URL to stdout, exit codes per R7. Register in `root.go` if registration is explicit. <!-- R3, R2, R7 -->
- [x] T005 Implement the `--window[=name]` arm in `cmd/rk/present.go`: resolve the caller's session, derive/sanitize the default name from the target basename (`internal/validate` conformant, `port-{port}` precedent), create via `tmux.CreateWindowWithOptions` with `@rk_type=iframe` + `@rk_url` + (file/dir) `@rk_present_root`, using the new window's id in the `/present/` URL. <!-- R5 -->
- [x] T006 Implement `--notify[=msg]`: extract the send logic of `cmd/rk/notify.go` into a reusable helper (same file or shared location), call it after a successful attach with default message `presenting <basename>`, fail-silent (exit 0, no output on failure). <!-- R6 -->
- [x] T007 Create `app/backend/api/present.go`: `handlePresent` — `windowId` regexp gate (`^@[0-9]+$`), `serverFromRequest`, request-time `tmux.GetWindowOption` for `@rk_present_root`, absolute-root check, symlink-resolved containment (`filepath.EvalSymlinks` both sides + `filepath.Rel`), dir → `index.html`, misses/escapes/errors → 404, stdlib MIME serving. Register `/present/{windowId}` + `/present/{windowId}/*` in `api/router.go` beside the proxy routes (~:716) with the same trailing-slash redirect pattern. <!-- R8, R9 -->

### Phase 3: Integration & Edge Cases

- [x] T008 Add `app/backend/api/present_test.go`: table-driven handler tests over a temp fixture tree — plain file serves with correct MIME; dir serves `index.html`; missing file 404; unset option 404; relative root 404; `..` traversal 404; intra-tree symlink serves; escaping symlink 404 (target file outside root must remain unread); invalid windowId 400/404 without subprocess; `?server=` validation falls back to `default`. <!-- R9, R8 -->
- [x] T009 Add `app/backend/cmd/rk/present_test.go`: command-level tests with seams (no live tmux where avoidable) — flag/usage errors exit 2; missing `$TMUX_PANE` without `--window` exits 1; unreachable port exits 1; option-set composition for each target kind; `--notify` failure still exits 0; stdout carries exactly the URL. <!-- R7, R2, R3, R6 -->

### Phase 4: Polish

- [x] T010 Rewrite `docs/site/skill.md` per R10 and run `scripts/sync-skill.sh` (or `go generate ./cmd/rk`) so `app/backend/cmd/rk/skill/skill.md` matches; keep ≤150 lines; verify `TestSkillEmbedMatchesCanonical` and the line-budget test pass. <!-- R10 -->
- [x] T011 Rewrite `docs/site/skill/display.md` per R11 and sync `app/backend/cmd/rk/skill/display.md`; keep ≤150 lines; verify `TestSkillDisplayEmbedMatchesCanonical` passes. <!-- R11 -->
- [x] T012 Standards + docs conformance: run `shll standards help-dump`, `shll standards readme-extraction`, `shll standards principles`; update `rk help-dump` goldens/tests if pinned, README/docs-site command documentation as required; confirm `--quiet` still prints the URL (data). Then run the full backend gate `cd app/backend && go test ./...`. <!-- R12 -->

## Execution Order

- T001 blocks T002 (tests target the parser) and T004 (command consumes it)
- T003 blocks T004/T005 (getter/primitives used by command) and T007 (handler reads the option)
- T007 blocks T008; T004–T006 block T009
- T010–T012 are independent of each other, after core lands

## Acceptance

### Functional Completeness

- [x] A-001 R1: All five target forms resolve per the table (file, dir, `:port`, localhost http URL, external URL), with a nonexistent-path exit 1; covered by `internal/present` unit tests
- [x] A-002 R3: Default arm sets `@rk_url` (and `@rk_present_root` for file/dir) on the caller's own window and prints the URL; no window creation, no API calls, no layout mutation
- [x] A-003 R5: `--window` creates a session-local window with `@rk_type=iframe` + `@rk_url` (+ root option when applicable), name derived/sanitized from the target
- [x] A-004 R6: `--notify` sends via the shared notify machinery with the default message and is fail-silent
- [x] A-005 R8: `GET /present/{windowId}/…` serves from the request-time-derived `@rk_present_root` with stdlib MIME; unset option or dead window → 404; route registered beside the proxy routes

### Behavioral Correctness

- [x] A-006 R4: Re-presenting the same file/dir target changes only the `?v=` value; port/URL targets carry no buster
- [x] A-007 R2: Port/local-URL targets probe reachability; refusal exits 1; file/dir/external targets never probe
- [x] A-008 R7: Exit codes are 0/1/2 per the toolkit convention; stdout carries only the URL (also under `--quiet`); diagnostics on stderr

### Scenario Coverage

- [x] A-009 R1: localhost URL rewrite preserves path+query and never composes an absolute origin (test exists)
- [x] A-010 R10: `rk skill` output teaches `rk present` as the primary visual-display recipe; byte-stability + line-budget tests pass against the resynced bundle
- [x] A-011 R11: `rk skill display` output leads with `rk present`, states the attach-vs-standalone criteria and the "cannot open the tile" expectation, and keeps the older-rk manual appendix

### Edge Cases & Error Handling

- [x] A-012 R9: Containment test table covers: `..` traversal 404, escaping symlink 404 (outside file unread), intra-tree symlink 200, relative/unset root 404, dir → index.html or 404 (no listing)
- [x] A-013 R8: Invalid `windowId` (fails `^@[0-9]+$`) is rejected before any tmux subprocess runs
- [x] A-014 R3: Running without `$TMUX_PANE` and without `--window` exits 1 with a diagnostic

### Code Quality

- [x] A-015 Pattern consistency: new Go code follows surrounding conventions (cobra command shape, `internal/` package layout, chi route registration style, table-driven tests)
- [x] A-016 No unnecessary duplication: reuses `internal/tmux` option primitives, `internal/validate`, `serverFromRequest`, and the notify send path instead of reimplementing
- [x] A-017 All subprocess calls use `exec.CommandContext` with argument slices and the 5s tmux timeout tier; no shell strings (code-quality + Constitution I)
- [x] A-018 No polling, no in-memory caches, no new state stores (code-quality: derive from tmux + filesystem)

### Security

- [x] A-019 R9: Path traversal through `/present/` is impossible — verified by the symlink/traversal test table; the handler never serves without a present, absolute `@rk_present_root`

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. The retired 4-step synthetic-iframe-window recipe was prose in the skill pages and was already removed in-diff (`docs/site/skill.md`, `docs/site/skill/display.md`); no Go code, endpoint, or frontend path became unused (the frontend iframe-window creation path stays — it backs the palette's "Window: New Iframe Window" and the ports "Open in window" action).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `--window`/`--notify` optional values via cobra `NoOptDefVal` (so bare `--window` works; a value uses `--window=name` syntax), help text showing `--window[=name]` | Cobra's only mechanism for optional flag values; matches the intake's `--window [name]` shape as closely as cobra allows | S:55 R:85 A:75 D:60 |
| 2 | Confident | Server name for `?server=` = basename of the socket path in `tmux.OriginalTMUX`; `default` when it matches the default socket; matches `serverFromRequest`/`ListServers` naming | ListServers derives names from socket basenames in `/tmp/tmux-{uid}/`; agent_hook targets via the same env capture | S:70 R:80 A:80 D:75 |
| 3 | Confident | Local-URL rewrite covers `http://` scheme only with hosts `localhost`/`127.0.0.1`/`[::1]`; explicit port or default 80; `https://localhost` attaches verbatim | The plaintext proxy targets local http services; https-to-local through the proxy is an untested edge not worth v1 surface | S:55 R:85 A:70 D:65 |
| 4 | Confident | `?v=` buster value is unix seconds at invocation | Simple, monotonic enough for the refresh-verb semantics; opaque to the frontend | S:60 R:90 A:85 D:80 |
| 5 | Confident | A window-option getter (`GetWindowOption`) is added to `internal/tmux` (none exists today per grep); mirrors `SetWindowOption`'s signature and timeout | Setter exists at tmux.go:1608 with no read counterpart; handler needs a request-time read | S:70 R:85 A:80 D:80 |
| 6 | Confident | Stdout prints the relative `@rk_url` value only (no absolute origin) — including under `--quiet` | Relative form is the documented convention; stdout-is-data per toolkit principles | S:65 R:85 A:80 D:75 |
| 7 | Certain | Skill rewrite edits the canonical `docs/site/skill{,.md,/display.md}` files and resyncs the embedded copies via `scripts/sync-skill.sh`; both stay ≤150 lines | Verified embed + drift-guard mechanism in `cmd/rk/skill.go` / `skill_test.go` | S:90 R:90 A:90 D:90 |
| 8 | Certain | Bare `--window`/`--notify` use a non-empty NoOptDefVal sentinel (`\x00auto`), distinguished from explicit values by equality and from absence by `Changed()` | Cobra ignores an EMPTY NoOptDefVal (the flag then consumes the next positional arg — caught by command tests); an untypable sentinel is the working shape of assumption 1 | S:90 R:90 A:90 D:90 |
| 9 | Confident | New `tmux.CreateWindowWithOptionsID` (new-window `-P -F '#{window_id}'`) returns the fresh id; file/dir `--window` is two-step (create with `@rk_type` atomically, then set `@rk_url`+`@rk_present_root` on the returned id) | The `/present/` URL embeds the new window's id, which cannot be known when composing the creation argv; a one-poll-cycle transient of an iframe window without URL is benign | S:70 R:80 A:75 D:70 |
| 10 | Tentative | `--window` outside a tmux pane resolves the DEFAULT server's current session via bare `tmux display-message -p '#{session_name}'` (server name `default`); failure (no server running) exits 1 | R5's "only when a session can be resolved" has no other deterministic reading — without a pane there is no socket/session context; this is tmux's own most-recent-session resolution | S:40 R:75 A:45 D:45 |
| 11 | Confident | The handler reads `@rk_present_root` through a package-level seam (`getWindowOptionFn`, the update.go pattern) instead of extending the `TmuxOps` interface | One consumer, one read: the interface change would churn `prodTmuxOps` + `mockTmuxOps` for no second caller; api already uses package-level seams for exactly this case | S:60 R:75 A:65 D:60 |

11 assumptions (2 certain, 8 confident, 1 tentative).
