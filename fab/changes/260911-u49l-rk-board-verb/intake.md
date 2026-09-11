# Intake: rk board verb — CLI door onto the five board routes, plus the `board` MCP policy row

**Change**: 260911-u49l-rk-board-verb
**Created**: 2026-09-11

## Origin

One-shot `/fab-new` invocation, no prior discussion in the conversation. The raw prompt:

> rk board verb — `rk board show [name] [--json]`, `rk board pin|unpin <name> <window>`, `rk board reorder <name> …` over the five existing board routes; policy row for `board`.
>
> Read fab/plans/sahil/26-09-10-rk-mcp.md in full first, then follow its § Pickup protocol exactly (D1-D13 closed, docs/specs/mcp.md is design authority on conflicts, policy table in app/backend/internal/mcp/policy.go with doctor drift-guard, never expose a verb without a policy row). Base this change on § Change breakdown → "W3b" row and § Allowlist v1's `board` row (api/router.go:858-862 has the five routes). This change needs only W1 (already merged) — no dependency on W2 or W3a. Update the plan's Status line and the W3b row when you create/merge this change.

Decisions carried in by the prompt (binding, not re-opened here):

- The plan's decision log D1–D13 is closed. In particular D2 (the CLI is the single contract; MCP proxies verbs), D3 (allowlist, default-excluded), D4 (flat tools; `board` is one of exactly two action-enum tools), D5 (opt-in `--json`, human output untouched), D6 (receipts only behind `--json`), D8 (target always explicit over MCP), D9 (argv exec).
- `docs/specs/mcp.md` is the design authority; where the plan and the spec disagree, the spec wins and the plan gets a fix-up row.
- The policy table lives in `app/backend/internal/mcp/policy.go` and is guarded by `mcp.Resolve` (the `rk doctor` `mcp` row and `TestTableShape`). The change adds its row there and flips the spec's "Structured today" column for `board`.
- This is plan row **W3b** (`rk-board-verb`, size S). It depends only on W1 (`260910-nuf6`, PR #924, merged). W2a's envelope helper, W2b, W2c and W3a are **not** prerequisites and must not be pulled in.
- The plan's Status line and W3b row are updated when this change is created (done in this change) and again at merge.

## Why

**The pain point.** Boards are the one dashboard capability that exists *only* as daemon routes. The five routes (`GET /api/boards`, `GET /api/boards/{name}`, `POST /api/boards/{name}/pin|unpin|reorder`, `app/backend/api/router.go:859-863`) are reachable from the browser (sidebar pin icon, palette, board pane header) but from nowhere else: a pane agent with a shell cannot pin its own window to a board, a script cannot list a board, and — the reason this change exists — the MCP server cannot expose boards at all, because `docs/specs/mcp.md` Principle 1 forbids a tool that calls the daemon API directly. A model in Claude Desktop that wants to "put these three agents on the `review` board" has no door.

**If we don't fix it.** The MCP allowlist v1 stays at 10 of 29 tools with a hole in the only "Steer the dashboard" intent that changes what a human sees across servers. The two "new verb families" the spec names (`operator request`, `board`) are the whole reason Principle 1 has teeth; leaving `board` unbuilt invites exactly the bypass tool the spec rules out.

**Why this approach.** The spec already fixes the shape: a new flat root family `rk board` (like `rk tab`, sharing its `@N` grammar), a thin HTTP wrapper over the daemon using the CLI's existing origin-resolution door (`resolveOrigin(ctx)` in `cmd/rk/origin.go` — the same door `notify`, `present`, and `tab wake` use), `-L` filling the routes' `server` body field, and one policy row named `board` with a `show|pin|unpin|reorder` action enum. It is deliberately **not** a tmux-direct implementation: pin/unpin/reorder have cross-server semantics (`lookupNeighbourKeys` aggregates the board across every server; the daemon broadcasts `board-changed` over SSE so open dashboards repaint) that live in `api/boards.go` and `api/router.go`, and re-implementing them in the CLI would fork the one write path. Constitution III (wrap, don't reinvent) and IV (minimal surface: one new root verb, zero new routes).

## What Changes

### 1. New `rk board` verb family (`app/backend/cmd/rk/board.go`)

A visible root command registered in `root.go` right after `tabCmd` (cli-layering.md: "~17 once `mcp` and `board` land"). Cobra shape is a real family — parent `board` with four children — so `rk board pin --help` works and Cobra validates arg counts per member:

```
rk board show [name] [--json]                      # no name: list boards; name: list its entries
rk board pin    <name> <@N|=session:window> [--json]
rk board unpin  <name> <@N|=session:window> [--json]
rk board reorder <name> <@N|=session:window> [--before @N] [--after @N] [--json]
```

Persistent flags on the **parent** `board` command (this placement is load-bearing — see § 4):

| Flag | Applies to | Meaning |
|------|-----------|---------|
| `-L, --server <name>` | pin/unpin/reorder | Fills the routes' `server` body field. Precedence is the `rk tab` rule (`resolveTabWindow` in `cmd/rk/owntab.go`): `-L` wins → the caller's own server from the captured `$TMUX` → `default`. Ignored by `show` (the GET routes aggregate across servers; there is nothing for it to select) — documented in `show --help`.|
| `--json` | all four | Opt-in machine output (D5). Human output is the default and unchanged by this change. |
| `--before <@N>`, `--after <@N>` | reorder only | Neighbour window ids, `@N` form only (the API takes window ids; no tmux resolution of `=session:window` for neighbours). Both optional; neither ⇒ append (the API's empty-neighbour sentinel); both ⇒ place between. Passing either to `show`/`pin`/`unpin` is a **usage error (exit 2)**: `--before/--after apply to reorder only`. |

**Address grammar.** `<name>` is validated CLI-side with `tmux.ValidBoardName` (`^[A-Za-z0-9_-]{1,32}$`, `internal/tmux/board.go`) — a bad name is usage (exit 2) before any request. The window positional is **required** on the three mutations (no own-tab omission — the spec writes `<@N>`) and resolves through the existing `resolveTabAddr(ctx, arg, boardServerFlag)` so both `@N` and `=session:window` work exactly as in `rk tab`; the resolved `(windowID, server)` pair is what the request body carries. A malformed address is usage (exit 2); a `=session:window` that tmux cannot resolve is operational (exit 1) — the same classes `rk tab` uses today.

**Transport.** Each verb makes exactly one HTTP call to `resolveOrigin(ctx) + <route>` with a bounded context (`boardHTTPTimeout = 10 * time.Second` — the `show <name>` join does one `ListWindows` per entry server-side, so it is given a little more room than `notify`'s 8 s). Request bodies are the routes' documented shapes (`api/boards.go`):

```json
POST /api/boards/{name}/pin      {"server":"default","windowId":"@7"}
POST /api/boards/{name}/unpin    {"server":"default","windowId":"@7"}
POST /api/boards/{name}/reorder  {"server":"default","windowId":"@7","before":"@3","after":null}
```

`before`/`after` are sent as JSON `null` when not given (the handler's `*string` contract). The `http.Client` and origin are reached through package-level seams (`boardHTTPClient`, and `resolveOrigin` already honours `RK_HOST`/`RK_PORT`) so tests drive the verbs against `httptest.NewServer` with the existing `pointConfigAt(t, srv.URL)` helper from `notify_test.go`.

**Unlike `notify`, `board` is NOT fail-silent.** A pin that did not happen must say so:

| Condition | Exit | stderr (human) / `--json` (interim bare document, see § 3) |
|-----------|------|-----------------------------------------------------------|
| Daemon unreachable / timeout | 1 | `board: run-kit daemon unreachable at http://127.0.0.1:3000 — is rk serve running?` |
| Daemon non-2xx | 1 | The body's `error` string verbatim (e.g. `window not found on server`, `neighbour window not found on board`, `invalid board name`); a body without `error` falls back to `board: <route> returned <status>`. All daemon errors are **operational** (spec § New verb families: "The daemon's 400/404/409 messages pass through as `operational` errors"). |
| Bad board name, malformed window/neighbour id, wrong arg count, `--before/--after` off `reorder`, `-L` with no address (cannot occur — address is required) | 2 | Cobra/`usageError` message; arg-count violations wrapped with `usageArgs` at the family's add site (the `tab.go` init idiom). |

**Human output (stdout data via `newSink(cmd).Dataf`, never gated by `--quiet`; diagnostics via `Notef`/stderr).**

- `show` (no name): one row per board, `name<TAB>pinCount`, tabwriter-aligned, in the daemon's order (the daemon already applies the stored display order). No boards ⇒ prints nothing, exit 0.
- `show <name>`: one row per entry in `orderKey` order: `windowId  server  session  windowIndex  windowName  panes` where `panes` is the pane count. Empty board ⇒ nothing, exit 0 (an unknown board name is indistinguishable from an empty one at the API — the GET returns `[]` — and is reported the same way).
- `pin`: `pinned @7 to work`. `unpin`: `unpinned @7 from work`. `reorder`: `reordered @7 on work → <orderKey>`. One line each; the report words `pinned`/`unpinned`/`reordered` are new (no existing report word covers these facts) and become the frozen human vocabulary for the family.

### 2. `--json` receipts (spec § Receipts, `board` row)

| Verb | `--json` stdout |
|------|-----------------|
| `show` | The `GET /api/boards` body verbatim (`[{"name":"work","pinCount":3}]`) or the `GET /api/boards/{name}` body verbatim (`[{"server","windowId","session","windowIndex","windowName","orderKey","panes"}]`). Byte-for-byte pass-through of the response body — the CLI does not re-marshal, so a future field the daemon adds arrives without a CLI release. |
| `pin` / `unpin` | `{"board":"work","window":"@7"}` — `orderKey` omitted: the pin route's `201 {"ok":true}` does not return one and the spec marks the field optional. |
| `reorder` | `{"board":"work","window":"@7","orderKey":"<newOrderKey>"}` — `orderKey` copied from the route's `newOrderKey` (vocabulary rule: the field name reuses the GET entry's `orderKey`, never a synonym). |

### 3. Envelope posture — bare document now, W2a wraps

W2a (`cli-json-read-verbs`) owns the D5 envelope helper in `cmd/rk/output.go` and the wrap of every existing `--json` verb. This change does **not** add that helper (it would collide with W2a in the one shared file and the plan says W3b needs only W1). `rk board … --json` therefore emits a **bare JSON document** on success — the exact interim form every seeded read verb uses today — and, on failure, the human stderr message with the exit code and nothing on stdout. The MCP `ResultJSON` parser already accepts this ("a bare JSON document on stdout is accepted as `result` with `ok` taken from the exit code"). When W2a lands, `board` graduates to the envelope with every other verb; per the spec the unwrapped form then retires with no compatibility flag.

### 4. The `board` policy row (`app/backend/internal/mcp/policy.go`)

One new `Row` appended to `Table`. The spec's row: `board` · `board show [name] / pin / unpin / reorder` (action enum) · no annotation · "new verb" → **yes** after this change.

```go
{
    Tool: "board", Path: "board",
    Args: []Arg{
        serverArg,                                                    // -L → the mutations' server field
        {Name: "action", Positional: 1, Type: ArgString, Required: true,
            Enum: []string{"show", "pin", "unpin", "reorder"},
            Description: "show lists boards (no name) or one board's entries (with name); pin/unpin/reorder mutate and require name and window"},
        {Name: "name", Positional: 2, Type: ArgString, Pattern: `^[A-Za-z0-9_-]{1,32}$`,
            Description: "Board name; optional for show, required for pin/unpin/reorder"},
        {Name: "window", Positional: 3, Type: ArgString, Pattern: `^@\d+$`,
            Description: "The window to pin/unpin/reorder, by window id (@N); required for the three mutations"},
        {Name: "before", Flag: "--before", Type: ArgString, Pattern: `^@\d+$`},
        {Name: "after",  Flag: "--after",  Type: ArgString, Pattern: `^@\d+$`},
        jsonLiteral,
    },
    Result:      ResultJSON,
    Annotations: Annotations{},                                     // mixed read/write tool: no hints
    Description: boardDescription,
},
```

`boardDescription` is a per-row override (Cobra's family `Long` is terminal prose): it names the four actions, which inputs each requires, that `show` without `name` lists boards, that `-L`/`server` applies to the mutations and defaults to `default` when absent, that `before`/`after` are reorder-only `@N` neighbours (neither = append), and that the result is the route body (`show`) or the `{board, window, orderKey?}` receipt.

**Why the persistent-flag placement in § 1 is load-bearing.** `mcp.Resolve` resolves the row's `Path` (`board`) to the **parent** command and asserts every `Flag` and flag-shaped `Literal` exists on it (`lookupFlag` — local or inherited flags). `BuildArgv` then emits **flags before positionals**: `rk board -L srv --before @3 --json reorder work @7`. Cobra's `Find` strips the flags to locate the `reorder` child, and the child must then parse `-L`, `--before`, `--after`, `--json` — so all four MUST be persistent on `board`. Defining `--before`/`--after` only on `reorder` would fail the drift guard at startup (the row would not resolve) and, even if it resolved, fail parsing on `pin`. The non-reorder children reject them at run time with a usage error instead. This is the pattern W2c's `tab_web` action-enum row will need too; recording it here so W2c reuses rather than rediscovers it. Positional gaps are safe: for `show` the model omits `name` (or passes it) and never `window`; `BuildArgv` appends present positionals in slot order and the verb validates the count.

**Tests that pin the row** (`internal/mcp/policy_test.go`, `schema_test.go`, `cmd/rk/mcp_e2e_test.go`):

- `TestTableShape`'s want-list grows to eleven names with `board` appended; `TestTableSendRow` locates `send` by name instead of `Table[len-1]` (or `board` is inserted before `send` — either keeps the assertions honest; the plan picks one and states it).
- `TestTableNeverTools` unchanged (`board` is not a never-tool prefix).
- A schema test asserts the generated `board` input schema has `action` required with the four-value enum, `name`/`window`/`before`/`after` optional with their patterns, `server` optional, and `readOnlyHint` absent/false.
- `mcp.Resolve(rootCmd, mcp.Table)` (already run by `rk doctor` and the E2E) is the drift guard: the new row must resolve, which is exactly what fails if a flag is not on the parent.
- The E2E's tool-name list (`mcp_e2e_test.go:105-119`) gains `board`. No E2E call of `board` — it needs a running daemon, which that harness does not start.

### 5. `rk` unit tests for the verb (`app/backend/cmd/rk/board_test.go`)

httptest-backed, `pointConfigAt` for the origin, the `tab` family's direct-RunE idiom where useful:

- `show` (no name) GETs `/api/boards`, prints `name\tpinCount` rows; `--json` passes the body through byte-for-byte.
- `show work` GETs `/api/boards/work`; empty `[]` prints nothing, exit 0.
- `pin work @7` POSTs `/api/boards/work/pin` with `{"server":"default","windowId":"@7"}` (no `$TMUX`, no `-L`), prints `pinned @7 to work`; `--json` prints `{"board":"work","window":"@7"}`; `-L rk-test` fills `server`.
- `unpin` mirrors `pin`.
- `reorder work @7 --before @3` sends `{"before":"@3","after":null}`; `--after @9` sends `{"before":null,"after":"@9"}`; neither sends both `null`; `--json` carries `orderKey` from `newOrderKey`.
- Daemon unreachable (closed listener) ⇒ exit 1 with the `unreachable at <origin>` message; `404 {"error":"window not found on server"}` ⇒ exit 1, message verbatim.
- Usage class (exit 2 via `exitCode`): `pin work` (missing window), `pin bad/name @7`, `pin work @x`, `pin work @7 --before @3`, `reorder work @7 --before =s:w`.
- Registration test (`board` on `rootCmd`, after `tab`), the `usageArgs` wrap on every child.

### 6. Docs, skill bundle, and plan bookkeeping

- **`docs/specs/mcp.md`** — Allowlist v1 table: `board` "Structured today" `new verb` → `yes`. No other spec text changes; the § New verb families paragraph already describes this exact shape. (Note for the reader: that paragraph writes `[--json]` only on `show`, while § Receipts defines receipts for `pin`/`unpin`/`reorder`, and receipts exist only behind `--json` (D6) — so `--json` is on all four; the spec is read as § Receipts governing, no spec edit needed.)
- **`docs/site/skill.md`** (source of the `rk skill` bundle; `scripts/sync-skill.sh` copies it to `app/backend/cmd/rk/skill/` and the MCP E2E asserts `instructions == docs/site/skill.md` bytes, so the sync MUST run in the same commit): one bullet in the verbs list next to the `rk tab` bullets — `rk board show [name] [--json]` · `pin|unpin <name> <@N>` · `reorder <name> <@N> [--before @N] [--after @N]` — pin windows onto the cross-server board dashboards; needs `rk serve` up (it rides the daemon, unlike `rk tab`).
- **`README.md`** root-verb table: a `rk board` row after `rk tab`.
- **`docs/site/boards.md`** § Pinning a window: a fourth entry point, "From the shell / an agent — `rk board pin <name> @N`", one sentence.
- **Toolkit standards check** (Constitution § Toolkit Standards): before landing, run `shll standards help-dump` and `shll standards principles` against the new surface — `rk help-dump` is generated from the Cobra tree (no golden to update) and P9 has one report line per verb to bound; record PASS in the `toolkit-standards` memory's new-surface list.
- **`fab/plans/sahil/26-09-10-rk-mcp.md`** — Status line: "W3b in progress (`260911-u49l`)", W3b table row State → `In progress`, Evidence → the change id; at merge both flip to Done with the PR number (the ship/hydrate stage of this change does the second edit).

### Non-goals

- No envelope helper (W2a's). No `operator request` verb (W3a). No new daemon route, no change to the five routes' bodies or status codes, no SSE changes.
- No `readOnlyHint` on `board` — a single tool that both reads and writes carries no hint (spec table: `—`). Splitting into `board_show` + `board` would breach D4's "exactly two action-enum tools" rationale in the other direction (four tools with identical schemas) and is not done.
- No tmux-direct implementation of pin/unpin/reorder in the CLI; `rk board` works only with `rk serve` up, by design (the spec's Daemon role row lists `board` among the verbs that reach the daemon).
- No `board create`/`board rm`: boards are implicit (a board exists while something is pinned to it), exactly as in the UI.

## Affected Memory

- `run-kit/mcp`: (modify) the seeded-table requirement becomes eleven rows (`board` — action enum, all-false annotations, `ResultJSON` on the interim bare document, description override); the "what the surface does not ship" scope drops `board`; a Design Decision records the parent-persistent-flag rule for action-enum rows (`Resolve` checks flags on the row's `Path`; `BuildArgv` emits flags before positionals).
- `run-kit/architecture/cli`: (modify) the CLI subcommand inventory gains the `board` family (four members, persistent `-L`/`--json`/`--before`/`--after`, the `resolveOrigin` daemon door, exit-code classes, report words `pinned`/`unpinned`/`reordered`, not fail-silent unlike `notify`); a Design Decision for "bare `--json` document until W2a's envelope".
- `run-kit/ui/boards`: (modify) § Pin Entry Points and § Backend Surface gain the CLI door — `rk board` is a fourth entry point that rides the same five routes and therefore the same `board-changed` SSE broadcast; nothing in the frontend changes.
- `run-kit/toolkit-standards`: (modify) the help-dump + P9 new-surface conformance list gains `rk board`.

## Impact

- **Code**: `app/backend/cmd/rk/board.go` (new), `board_test.go` (new), `root.go` (one `AddCommand`), `internal/mcp/policy.go` (one row + one description const), `internal/mcp/policy_test.go` / `schema_test.go` (assertions), `cmd/rk/mcp_e2e_test.go` (name list). ~300 lines of Go plus tests.
- **Docs**: `docs/specs/mcp.md` (one cell), `docs/site/skill.md` + synced `app/backend/cmd/rk/skill/skill.md`, `README.md`, `docs/site/boards.md`, `fab/plans/sahil/26-09-10-rk-mcp.md`.
- **Runtime**: no daemon change; `rk doctor`'s `mcp` row reports `11 tools; all policy rows resolve`. `rk -h` shows one more root verb. No frontend or e2e (Playwright) impact.
- **Dependencies**: none new. W1 merged is the only prerequisite.
- **Verification gates** (code-quality.md): `cd app/backend && go test ./...`, `cd app/frontend && npx tsc --noEmit` (unaffected but run), `just test`, `just build`; plus `shll standards help-dump`/`principles` on the new surface.

## Open Questions

- None blocking. The one soft choice (`show -L` accepted-and-ignored vs. rejected) is recorded as assumption 12 below and is a one-line change either way.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Shape, routes, receipts and the single action-enum policy row follow `docs/specs/mcp.md` § New verb families / § Receipts / § Allowlist v1 exactly; the plan's D1–D13 are not re-opened | Prompt names the spec as design authority and closes every decision; § Pickup protocol 1–4 | S:95 R:90 A:95 D:95 |
| 2 | Certain | `board` is a real Cobra family (parent + `show`/`pin`/`unpin`/`reorder` children) registered visibly at root after `tab`, with `usageArgs` on every child | cli-layering.md calls it "a new flat root family (like `tab`)", counts it among visible root verbs; the `tab.go` init idiom is the codebase pattern | S:85 R:80 A:90 D:85 |
| 3 | Confident | `-L/--server`, `--json`, `--before`, `--after` are **persistent flags on the parent** `board`; non-reorder children reject `--before/--after` as usage (exit 2) | `mcp.Resolve` checks flags on the row's resolved `Path` (the parent) and `BuildArgv` emits flags before positionals, so any flag the row uses must parse on every child; alternative (leaf command with an action positional) loses per-verb help and contradicts "family" | S:80 R:75 A:85 D:75 |
| 4 | Certain | `--json` emits the bare document / receipt now (interim form); W2a's envelope helper wraps it later | Plan assigns the envelope helper to W2a and says W3b needs only W1; spec's `ResultJSON` rule accepts bare documents with `ok` from the exit code; avoids a conflict in `output.go` | S:80 R:90 A:85 D:80 |
| 5 | Certain | Window positional is required on the mutations and resolves via `resolveTabAddr` (`@N` or `=session:window`; `-L` → own server → `default`); neighbours are `@N` only | Spec writes `<@N>`; sharing `tab`'s resolver costs nothing and keeps one grammar; the API needs neighbour window ids, not tmux targets | S:75 R:85 A:85 D:75 |
| 6 | Certain | Daemon errors → exit 1 with the body's `error` text verbatim; unreachable daemon → exit 1 with an `unreachable at <origin>` hint; CLI-side validation → exit 2; **not** fail-silent | Spec § New verb families pass-through rule for `operator request`, applied to its sibling; toolkit exit-code convention 0/1/2; a silent failed pin would be a lie | S:80 R:90 A:85 D:85 |
| 7 | Certain | `pin`/`unpin` receipts omit `orderKey`; `reorder` copies `newOrderKey` into `orderKey` | The pin route returns only `{"ok":true}`; spec marks `orderKey` optional and the vocabulary rule forbids a second name | S:75 R:90 A:85 D:85 |
| 8 | Confident | Human report words are `pinned @N to <board>` / `unpinned @N from <board>` / `reordered @N on <board> → <key>`; `show` uses tabwriter rows; empty ⇒ nothing, exit 0 | No existing report word covers these facts; `tab show`/`tab web ls` set the empty-is-a-state convention; `--quiet` never gates data lines (P9) | S:60 R:90 A:80 D:70 |
| 9 | Certain | HTTP timeout 10 s (`boardHTTPTimeout`), one request per invocation, `http.Client` via a package seam for tests, origin via `resolveOrigin` and `pointConfigAt` | `notify`'s 8 s precedent; `show <name>` does per-entry `ListWindows` server-side; Constitution § Process Execution bounded contexts | S:65 R:95 A:85 D:80 |
| 10 | Certain | `board` row carries all-false annotations (no `readOnlyHint`) and a description override; `TestTableShape` grows to eleven, `send` located by name; E2E name list gains `board` but does not call it | Spec allowlist shows `—` for `board`; mixed read/write tool; the E2E harness runs no daemon | S:80 R:90 A:85 D:85 |
| 11 | Certain | Docs touched: spec "Structured today" cell, `docs/site/skill.md` (+ `scripts/sync-skill.sh`), README verb table, `docs/site/boards.md` entry point, plan Status + W3b row; `shll standards help-dump`/`principles` run before landing | Pickup protocol 2 and 5; the E2E pins `instructions == docs/site/skill.md` bytes so the sync is mandatory; Constitution § Toolkit Standards | S:80 R:95 A:85 D:85 |
| 12 | Confident | `show` accepts `-L` and ignores it (documented) instead of rejecting it as usage | One MCP tool exposes `server` for every action; a model passing it with `show` should not be punished; the GET routes have no server filter to honour. Reversible in one line | S:45 R:95 A:60 D:45 |

12 assumptions (9 certain, 3 confident, 0 tentative, 0 unresolved).
