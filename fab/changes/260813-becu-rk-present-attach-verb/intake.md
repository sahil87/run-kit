# Intake: `rk present` — one-verb "show this to the user" + skill page rewrite

**Change**: 260813-becu-rk-present-attach-verb
**Created**: 2026-08-14

## Origin

Dispatched promptless (`/fab-proceed` create-new dispatch, `{questioning-mode} = promptless-defer`) from a synthesized design description produced by a `/fab-discuss` design session (2026-08-13/14). The session resolved the load-bearing design decisions explicitly — serving strategy ("option 3", tmux-option-derived serving) was chosen by the user, the `rk skill` rewrite was explicitly confirmed in scope, and the `--notify` deep-link was deliberately deferred to a follow-up change. The full design is reproduced in **What Changes** below (state transfer — downstream agents have no access to the session).

> Feature: `rk present` — a one-verb "show this to the user" for agents (resolve a file/dir/port/URL target, attach it as a `web` tile on the caller's own tmux window via `@rk_url`, serve file targets through a new tmux-option-derived `/present/{windowId}/…` route), plus `--window` (standalone iframe window fallback) and `--notify` (Web Push), plus the `rk skill` / `rk skill display` page rewrite that teaches the new verb in place of the old 4-step synthetic-iframe-window recipe.

## Why

run-kit's surface-layout model shipped: iframes are now a `web` tile/lens on an existing window (capability signal `@rk_url`), not a window identity (`@rk_type` is demoted to a creation-time default-view hint). But the agent-facing recipe in `rk skill` / `rk skill display` (embedded at `app/backend/cmd/rk/skill/skill.md` and `display.md`) still teaches ONLY the old pattern: spawn a synthetic iframe window (`tmux new-window` + `@rk_type=iframe` + `@rk_url`), which creates a sidebar row with an inert shell pane — exactly the "row-less surface wearing a window costume" the specs (`docs/specs/window-views.md` § Two Species, `docs/specs/surface-layout.md` "What dies, what stays") want retired.

1. **Pain point**: agents presenting mocks/reports mid-conversation should attach content beside their own terminal, not pollute the sidebar with synthetic windows. The 4-step manual recipe (pick a port, run `python3 -m http.server`, set options) is footgun-prone — port collisions, a python dependency, orphan-process lifecycle.
2. **Consequence of not fixing**: every agent on the box keeps producing the retired window species, and the skill bundle actively teaches the anti-pattern the specs just retired.
3. **Why this approach**: the verb bakes the convention in (Constitution VII — convention over configuration); the tmux-option-derived serving design needs no spawned server, no spool copy, no registration state, and no GC (Constitution II/X native).

## What Changes

### 1. The `rk present` command (new cobra subcommand, `app/backend/cmd/rk/`)

```
rk present <target> [flags]

  <target>   ./mock.html          a file — serve it, attach to this window
             ./dist/              a directory — serve it, attach (index.html default)
             :5173                a local port already serving — attach via relative /proxy/5173/
             http://localhost:N/… same, rewritten to the relative /proxy/N/… form
             https://…            external URL — attached verbatim

  --window [name]   spawn a standalone iframe window instead of attaching to the
                    caller's own window. Name defaults from the target basename.
  --notify [msg]    send a Web Push after attaching (fail-silent like rk notify),
                    message defaulting to "presenting <basename>"
```

**Behavior**: resolve target → derive the `@rk_url` value → `tmux set-option -w @rk_url <url>` on the caller's own window (located via `$TMUX_PANE`, e.g. `tmux display-message -t "$TMUX_PANE" -p '#{window_id}'`; reuse `internal/tmux` option setters — `SetWindowOption` at `internal/tmux/tmux.go:1608` ff.) → print the resolved URL to stdout.

It **NEVER opens the tile for the viewer** — layout is per-viewer client state (`docs/specs/surface-layout.md` R7/L3); availability (the rail's web button lights via SSE option polling) plus optional `--notify` is the whole contract.

**Exit codes** follow the toolkit convention: `0` success, `1` operational failure (not in tmux, file missing, server unreachable where required), `2` usage; only the `--notify` send is fail-silent (matching `rk notify`'s documented exception).

### 2. Serving design (DECIDED by the user — "option 3", tmux-option-derived serving)

For file/directory targets there is NO spawned static server and NO spool copy. Instead:

- `rk present` sets a second window option `@rk_present_root=<absolute dir>` (the file's parent dir, or the directory itself) alongside `@rk_url=/present/<windowId>/<file>?v=<bust>`.
- A new Go route `/present/{windowId}/…` on the rk server (registered beside the existing `/proxy/{port}/*` routes in `api/router.go:716-718`; handler beside `api/proxy.go`) resolves that window's `@rk_present_root` **AT REQUEST TIME** (derive-from-tmux, Constitution II/X native — the serve root is an ephemeral fact about what the pane is presenting, lives in tmux, dies with the window; no registration state, no GC, no new disk store) and serves the requested file from under it. MIME by extension — PNG/PDF/HTML just work.
- **Security (Constitution I, critical)**: the handler serves ONLY when the option is present and absolute; it must resolve symlinks and verify the RESOLVED path stays contained under the RESOLVED root — a **containment check, not a lexical prefix ban** (the code-server tarball extraction lesson: real trees carry legitimate intra-tree symlinks; lexical prefix checks are both too weak and too strict). The tmux socket is already the trust boundary (anyone who can set window options can already run code in panes), so no new principal is introduced — but path traversal through the web server must be impossible.
- Re-running `rk present` with the same target bumps the `?v=` cache-buster in `@rk_url`, so an already-open web tile re-navigates — "re-present is the refresh verb". Live edits to served files are visible on a plain reload too (serving is from the live filesystem).

**Rejected alternatives** (from the design session — record for traceability):
- (a) wrapping `python3 -m http.server` — port-picking, python dependency, orphan-process lifecycle;
- (b) spool-copy under `$XDG_STATE_HOME/rk/present/` served by the daemon — adds GC + size-cap problems, kills live iteration, sits awkwardly against Constitution II's write-only/seed-cache carve-outs;
- (c) auto-opening the tile for the viewer — violates per-viewer layout (R7/L3).

### 3. `--window` fallback (the residual case)

Spawns a standalone iframe window (new tmux window + `@rk_type=iframe` + `@rk_url`) — `--window` is the **one remaining legitimate producer** of the `@rk_type=iframe` default-view hint. Criteria (state them in the skill page): external URLs with no owning pane; a SECOND simultaneous mock (one `@rk_url` per window, one web tile per surface kind in layout v1); content that deserves its own board-pinnable identity. Window name defaults from target basename (sanitized per tmux name validation — no colons/periods, see the existing "Open in window" handler's `port-{port}` naming precedent).

### 4. `--notify` scope decision

v1 ships plain-text notify only (`rk notify` machinery as-is — `cmd/rk/notify.go` / `internal/push`). A deep-link click-through (`rk notify --url` carrying e.g. `/$server/$window?layout=split-h:tty,web`, requiring a URL field in the push payload + service-worker click-handler change) is **DELIBERATELY DEFERRED** to a follow-up change so `rk present` doesn't block on it.

### 5. Attach semantics / edge notes

- `@rk_url` is a window-level option: on multi-pane windows, last write wins (accepted; note in docs).
- Attaching a URL must NOT steal the window's default view — the frontend's HINT_ORDER gives a `web` default hint only via `@rk_type=iframe`, so a tty-led window stays tty-led and the web tile is additive. This is **existing frontend behavior; the change should verify, not modify it** (no frontend code changes).
- `:port` / localhost-URL targets involve no serving at all — pure attach via the relative `/proxy/<port>/…` form (never compose absolute origins; the relative form is the documented convention, see `skill/display.md` § Proxy).
- SSE picks up option changes automatically — no API call needed to make the rail button appear.

### 6. The `rk skill` rewrite (IN SCOPE — user explicitly confirmed)

1. **Core bundle** (`rk skill`, `app/backend/cmd/rk/skill/skill.md`): the iframe-windows capability bullet and the 4-step Visual Display Recipe collapse to `rk present <path|url>` one-liners plus the existing gate (`command -v rk` + `$TMUX_PANE`). Recipe becomes: generate → `rk present` → optionally `--notify`.
2. **`rk skill display` topic page** (`app/backend/cmd/rk/skill/display.md`): restructured around present — target forms and what each resolves to; attach-vs-standalone criteria (the § Two Species logic stated for agents); the explicit expectation "you cannot open the tile for the user — availability appears on the rail; use `--notify` when the user may be away"; iteration (re-present = refresh); a short appendix keeping the raw manual `@rk_url` attach path for older rk versions.
3. **No version-skew machinery needed**: the skill bundle ships inside the binary, so an rk that has `present` is the same rk whose pages teach it.

### 7. Constraints

- Constitution I: all subprocess calls `exec.CommandContext` with argument slices + timeouts; validate user-provided names; the `/present/` route containment is security-critical.
- Constitution II/X: no persistent registration state; serve root derived from tmux at request time.
- Constitution IX: any new mutating endpoint would be POST — but this change should need **no new mutating API**; `/present/{windowId}/…` is a GET content route (like `/proxy/{port}/`).
- Toolkit standards (Constitution § Toolkit Standards): new CLI surface must be checked against `shll standards` (help-dump, readme-extraction, skill page conventions, ten principles incl. `--quiet`); README/docs-site updates per the readme-extraction standard if applicable.
- Tests: Go tests for target parsing, URL derivation, and the containment handler (table-driven traversal/symlink cases); the skill-page content is embedded and covered by the existing byte-stability tests in `cmd/rk/skill_test.go` (fixtures updated in the same commit).

## Affected Memory

- `run-kit/architecture`: (modify) new `rk present` CLI subcommand, the `/present/{windowId}/` GET content route, and the tmux-option-derived (request-time) serving model
- `run-kit/toolkit-standards`: (modify) new CLI surface conformance — help-dump, readme-extraction, skill topic pages, ten-principles check for `rk present`
- `run-kit/tmux-sessions`: (modify) the new `@rk_present_root` window-option convention and the `@rk_url` attach semantics (last-write-wins, re-present cache-buster) — only if hydrate finds spec-level attach-semantics notes belong here rather than architecture

## Impact

- **Go backend** (`app/backend/`): new cobra command `cmd/rk/present.go` (+ test); target-resolution logic likely in a small new `internal/present` package (parse file/dir/`:port`/localhost-URL/external-URL forms, derive `@rk_url` values); new `api/present.go` handler + route registration in `api/router.go` beside the proxy routes; reuse `internal/tmux` window-option setters (`SetWindowOption`/`SetWindowOptions`) — no new tmux primitives expected.
- **Skill bundle content**: `app/backend/cmd/rk/skill/skill.md` and `app/backend/cmd/rk/skill/display.md` (embedded in the binary); `cmd/rk/skill_test.go` fixtures.
- **Docs/README**: whatever the readme-extraction standard requires for a new user-facing subcommand.
- **No frontend changes**: HINT_ORDER / web-tile behavior is verified, not modified. No new mutating API endpoints.
- **Tests**: table-driven Go tests — target parsing, URL derivation, containment handler (traversal + symlink cases, per the code-server tarball lesson: test containment semantics, not lexical prefixes).

## Open Questions

None — the design session resolved the load-bearing decisions (serving strategy, `--notify` scope, skill-rewrite scope, security posture); residual interpretation gaps are graded in Assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Serving via tmux-option-derived `/present/{windowId}/…` route reading `@rk_present_root` at request time — no spawned static server, no spool copy, no registration state | Discussed — user explicitly chose "option 3"; Constitution II/X native | S:95 R:70 A:90 D:95 |
| 2 | Certain | `rk present` never opens the tile for the viewer; availability (rail button via SSE) + optional `--notify` is the whole contract | Discussed — per-viewer layout is spec law (surface-layout R7/L3); alternative (c) explicitly rejected | S:95 R:80 A:90 D:95 |
| 3 | Certain | `--notify` v1 is plain-text only; deep-link click-through deferred to a follow-up change | Discussed — user deliberately deferred so present doesn't block on push-payload/service-worker changes | S:95 R:90 A:90 D:95 |
| 4 | Certain | The `rk skill` core-bundle + `rk skill display` rewrite (incl. manual `@rk_url` appendix for older rk) is in scope for this change | Discussed — user explicitly confirmed | S:95 R:85 A:90 D:95 |
| 5 | Certain | `/present/` security = resolve symlinks and verify RESOLVED path contained under RESOLVED root; never a lexical prefix check; serve only when option present and absolute | Discussed + recorded project lesson (code-server tarball symlinks); Constitution I | S:90 R:60 A:90 D:90 |
| 6 | Certain | `--window` is the one remaining legitimate producer of `@rk_type=iframe`; criteria (external URL with no owning pane / second simultaneous mock / board-pinnable identity) stated in the skill page | Discussed — matches window-views § Two Species migration map | S:90 R:80 A:85 D:90 |
| 7 | Certain | Exit codes `0`/`1`/`2` per toolkit convention; only the `--notify` send is fail-silent | Documented convention in the existing skill bundle; `rk notify` is the named exception | S:85 R:90 A:95 D:90 |
| 8 | Certain | Re-present bumps the `?v=` cache-buster so an open web tile re-navigates; live filesystem serving means plain reload also sees edits | Discussed — "re-present is the refresh verb" | S:90 R:85 A:85 D:85 |
| 9 | Certain | `--window` default name derives from target basename, sanitized per existing tmux name validation (no colons/periods; `port-{port}` precedent) | Discussed with explicit precedent pointer; `internal/validate` exists | S:80 R:85 A:85 D:85 |
| 10 | Certain | No frontend modification: HINT_ORDER's additive web tile (tty-led stays tty-led) is verified, not changed | Explicit in the design: "the change should verify, not modify it" | S:90 R:85 A:85 D:90 |
| 11 | Certain | Skill content lives at `app/backend/cmd/rk/skill/{skill.md,display.md}` (embedded); byte-stability covered by existing `cmd/rk/skill_test.go`, fixtures updated in-change | Verified in repo during intake | S:85 R:90 A:95 D:95 |
| 12 | Certain | MIME resolution by file extension via Go stdlib (`mime.TypeByExtension` / `http.ServeContent`-style serving) | One obvious stdlib default; trivially reversible | S:60 R:90 A:85 D:80 |
| 13 | Confident | tmux server identity must ride the presented URL (window IDs `@N` are unique only per tmux server): keep the decided `/present/<windowId>/<file>` path shape and carry the server as a query param (e.g. `?server=<name>`, matching the frontend's existing `withServer` convention); the CLI derives its server from `$TMUX` | Gap not addressed in the design session; multi-server enumeration is core to rk serve, so the handler cannot resolve `@N` alone; front-runner follows the existing query-param convention | S:50 R:65 A:60 D:55 |
| 14 | Confident | `<windowId>` in the URL is the tmux `window_id` (`@N`), derived from the caller via `tmux display-message -t "$TMUX_PANE" -p '#{window_id}'` | Natural unique id; `internal/tmux` targets windows by `@N` throughout | S:75 R:75 A:85 D:80 |
| 15 | Confident | Directory targets default to `index.html`; no directory listing in v1; missing file under the root → 404 | "(index.html default)" stated; listing is unrequested surface with security cost | S:55 R:80 A:70 D:60 |
| 16 | Confident | Target-resolution logic lives in a small new `internal/present` package; the route handler lives beside `api/proxy.go` | Design says "likely a small internal package"; matches repo layout conventions | S:70 R:75 A:80 D:75 |
| 17 | Confident | `:port` / localhost-URL targets get a best-effort TCP reachability probe; connection refused → exit 1 | Interprets "server unreachable where required" in the exit-code contract; probe is cheap and matches the operational-failure semantics | S:45 R:85 A:55 D:50 |
| 18 | Confident | Only localhost/`127.0.0.1` absolute URLs rewrite to the relative `/proxy/<port>/…` form; any other absolute URL (http or https) attaches verbatim | Design names `https://…` external-verbatim and `http://localhost:N` rewrite; non-localhost http has no proxy port to map to | S:55 R:85 A:70 D:65 |
| 19 | Confident | `--window` composes with file/dir targets: the new window gets `@rk_type=iframe`, `@rk_url`, AND `@rk_present_root` | Serving design is orthogonal to which window carries the options; nothing in the design forbids it | S:65 R:80 A:75 D:70 |
| 20 | Confident | The `?v=` cache-buster applies to `/present/` URLs only; `:port`/URL targets re-set `@rk_url` verbatim without a buster | Buster is described inside the serving design; appending `?v=` to an arbitrary app URL could break query-sensitive apps | S:45 R:80 A:55 D:50 |

20 assumptions (12 certain, 8 confident, 0 tentative, 0 unresolved).
