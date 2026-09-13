# Intake: rk tab new — Role-Aware Default Session Resolution

**Change**: 260913-xga4-tab-new-default-session-resolution
**Created**: 2026-09-13

## Origin

Backlog item `[xga4]` (2026-09-13), invoked one-shot via `/fab-new xga4`. Raw backlog text:

> rk tab new: resolve a default --session when the caller sits in an _rk-* session (operator spawns) so fab can stop choosing. CONTEXT: fab's operator (fab-kit src/kit/skills/fab-operator.md §6 step 2, PR sahil87/fab-kit#675) picks the target session itself because tmux's ambient default is the operator's own _rk-operator session; that policy has been reworked 4× (z597 → cx52 → 4a8m → iyb4) and cx52 already named run-kit as the right long-term home. GOAL: when --session is omitted AND the caller's own session has a non-user role (_rk-operator / _rk-ctl / _rk-pin-* / reserved — reuse the role derivation behind `rk mux sessions`), pick the landing session deterministically instead of the ambient one: (1) exactly one role:user session → it; (2) else the user session whose start path equals the main-worktree root of --cwd (resolve via `git -C <cwd> rev-parse --path-format=absolute --git-common-dir` → parent of .git; NOTE worktrees live in a SIBLING dir <repo>.worktrees/<name>, so a cwd prefix match does NOT work); (3) else the user session with the highest attached count, then `rk mux sessions` row order; (4) zero user sessions → error 'nowhere to spawn' (non-zero exit, no window created). A caller inside a role:user session keeps today's ambient default. Report the chosen session and the deciding rung in the --json result (the existing "session" field already says where it landed; add e.g. "session_rung"). ACCEPTANCE: unit tests per rung incl. the worktree-sibling case and the zero-candidate error; `rk tab new --help` documents the rule; docs/specs + memory for tab new updated. FOLLOW-THROUGH (fab-kit, separate change after this ships): drop §6 step 2 and the `--session =<session>` pin behind the existing capable-HexoKit gate, keep only the §8 user-override phrase mapping to an explicit --session.

No prior conversation preceded the invocation; the backlog entry is the full design record. The one deliberate refinement made at intake (rung 2 compares main-worktree roots on BOTH sides rather than requiring the session path to equal the root literally) is recorded in Assumptions row 6 and called out in the `/fab-new` output for veto.

**Follow-through (out of scope here, tracked for the archive note)**: once this ships, a separate fab-kit change drops `fab-operator.md` §6 step 2 (the operator's own session-picking) and the `--session =<session>` pin behind the existing capable-HexoKit gate, keeping only the §8 user-override phrase that maps to an explicit `--session`.

## Why

**The pain.** `rk tab new` (and `rk present --window`, which shares the resolver) defaults the landing session to the caller's own tmux session when `--session` is omitted. That is the right default for a human in a project session. It is the wrong default for fab's operator: the operator window lives in the infrastructure session `_rk-operator` (moved there by the `@rk_win_role=operator` promote flow, `docs/memory/run-kit/tmux-sessions.md` § Operator Session), so every spawn it issues without `--session` lands the new agent window beside the operator in `_rk-operator`. That breaks the one-operator hidden-home invariant (a mixed population flips the session visible), and it is why fab-operator §6 step 2 exists: fab enumerates `rk mux sessions --json`, filters `role: user`, weighs pane cwds against the target repo, consults a §8 setting, and asks the user on ties. That policy has been rewritten four times (z597 → cx52 → 4a8m → iyb4); cx52 already concluded the decision belongs in run-kit, because rk owns the substrate facts (session roles, attached counts, start paths) and fab is only re-deriving them through a JSON round trip.

**The consequence of not fixing it.** Every orchestrator that spawns from an `_rk-*` session (the fab operator today; any future `_rk-ctl`/pin/reserved-session caller) must carry its own session-selection policy, and each one can drift from the others. The fab side stays a 20-line skill passage that keeps getting reworked, and a caller that forgets the pin silently pollutes `_rk-operator`.

**Why this approach.** The role taxonomy (`tmux.SessionRole`, `internal/tmux/session_facts.go`) and the candidate facts (`tmux.ListSessionFacts` — name, role, attached, windows, path) already exist and are already what `rk mux sessions` prints for exactly this use ("the spawn-candidate set an orchestrator wants"). Moving the pick into `resolveTabNewSession` reuses them in-process with no new state (Constitution II: roles derive from names at request time), keeps the human default byte-identical (a `role: user` caller is untouched), and makes the choice deterministic and reportable (`session_rung`) so fab can drop its own policy and simply read where the window landed. The cwd → main-worktree-root rung is what makes the common operator case land correctly: operator spawns run in a linked worktree under the sibling directory `<repo>.worktrees/<name>`, so no prefix match against a session started at `<repo>` can work — only git's common dir ties the two together.

## What Changes

### 1. Role-aware default in `resolveTabNewSession` (`app/backend/cmd/rk/tab_new.go`)

Today's resolver, in order: explicit `--session =S` wins; else, inside tmux (`$TMUX_PANE` set), the caller's own session via `display-message -pt $TMUX_PANE '#{session_name}'`; else the target server's current session. The change inserts a role gate on the inside-tmux branch:

```
--session =S given                      → S                       rung: explicit
$TMUX_PANE unset (outside tmux)         → server's current session rung: server      (unchanged)
$TMUX_PANE set, caller session role user → caller's own session    rung: caller      (unchanged)
$TMUX_PANE set, caller session role ≠ user (operator/control/pin/reserved):
    candidates = tmux.ListSessionFacts(ctx, server) filtered to Role == SessionRoleUser,
                 in enumeration order (the `rk mux sessions` row order, group copies folded)
    (1) len(candidates) == 1                          → that session     rung: sole-user
    (2) else the first candidate whose main-worktree root equals cwd's main-worktree root
                                                      → that session     rung: cwd-root
    (3) else the candidate with the highest Attached; ties → earliest row
                                                      → that session     rung: most-attached
    (4) else (zero candidates)                        → error, no window created
```

- The caller's session role is `tmux.SessionRole(<caller session name>)` — the same derivation `rk mux sessions` uses. Nothing is stamped; the name decides.
- `server` is the already-resolved target server (`-L/--server` if given, else the caller's server from `$TMUX`, else `default`). Candidates are enumerated on THAT server. With `-L` naming a foreign server the caller's session name is still read from the caller's own socket (existing behavior) and only its role is used as the gate.
- `cwd` for rung 2 is the value `runTabNew` already resolved before session resolution: `--cwd` if given, else the process cwd. `resolveTabNewSession` gains a `cwd string` parameter (or the picker is called with it) so `rk present --window` passes its own cwd the same way.
- Rung 3 with several equal `Attached` values (including all zero) picks the earliest row — deterministic, matching the backlog's "then `rk mux sessions` row order".
- An enumeration failure (`ListSessionFacts` error) is an operational error: `resolve target session: list sessions: <err>`.

**Pure picker for testability**: extract the rung walk into a pure function in `tab_new.go`, e.g.

```go
// pickLandingSession applies the role-aware default rule over user-role
// candidates in enumeration order. mainRoot is the main-worktree root of the
// new window's cwd ("" when cwd is not inside a git repository); rootOf
// resolves a candidate's start path the same way. Returns errNowhereToSpawn
// when candidates is empty.
func pickLandingSession(candidates []tmux.SessionFacts, mainRoot string, rootOf func(path string) string) (session, rung string, err error)
```

Unit tests drive this function per rung with hand-built `SessionFacts` slices and a stubbed `rootOf`; integration tests (below) drive the whole resolver through the real tmux test server.

### 2. Main-worktree root resolution (`app/backend/internal/gitinfo`)

Add a small exported helper beside the existing git helpers in `internal/gitinfo/gitinfo.go` (the package already shells out to `git rev-parse` via `exec.CommandContext`; `config.FindGitRoot` is a `.git`-walk and cannot see through a linked worktree's `.git` file to the main checkout, so it is not reused for this):

```go
// MainWorktreeRoot returns the main checkout's root for any path inside a git
// repository — for a linked worktree (`<repo>.worktrees/<name>`, whose .git is
// a file) that is the main checkout, not the worktree. Resolved as
//   git -C <dir> rev-parse --path-format=absolute --git-common-dir
// → parent of the common dir when its base is `.git`, else the common dir
// itself (bare repository). "" when dir is not inside a repository, git is
// absent, or the call fails/times out — callers treat "" as "no match".
func MainWorktreeRoot(ctx context.Context, dir string) string
```

- Subprocess via `exec.CommandContext` with a short timeout (5 s, the tmux-helper class — Constitution § Process Execution); argument slice, never a shell string (Constitution I).
- Both sides of the rung-2 comparison go through it: `MainWorktreeRoot(cwd) == MainWorktreeRoot(candidate.Path)`, with `""` never matching. `filepath.Clean` is applied to both results; symlinks are NOT resolved (git prints the path it was given canonicalized by its own rules; both sides come from the same git, so they agree).
- Worktree-sibling case this MUST satisfy: cwd `/home/u/code/run-kit.worktrees/feat-x` and a user session with `Path == "/home/u/code/run-kit"` match (common dir `/home/u/code/run-kit/.git`). Prefix matching would fail here; the test pins this with a real temporary repo plus `git worktree add` (skipped when `git` is unavailable, the `withTabTestServer` skip idiom).

### 3. Error: `nowhere to spawn` (rung 4)

Zero user-role candidates while the caller's session is infrastructure is an operational error (exit 1) raised BEFORE any `new-window`:

```
Error: resolve target session: nowhere to spawn — the caller's session "_rk-operator" is run-kit infrastructure and server "default" has no user session; pass --session =S to name one
```

- Exact wording may be tightened at apply, but the message MUST contain the phrase `nowhere to spawn`, the caller's session name, the server name, and the `--session =S` remedy.
- Under `--json`, the central failure writer emits `{"ok":false,"error":{"code":"operational","message":…}}` (the `execute()` seam — no verb code needed; `tab new`'s verdict-bearing `result`-on-failure form applies only to `ready: gone`, which cannot occur before creation).

### 4. `--json` result gains `session_rung`

`tabNewBirthJSON` grows one always-present key, placed after `session` so the key order reads as a pair:

```json
{"ok":true,"result":{"session":"work","session_rung":"cwd-root","window_id":"@7","pane_id":"%12"}}
```

- `session_rung` is ALWAYS present (never `omitempty`) so the key set is stable across every path (toolkit Principle 2 schema rule; `ready` stays the one omitempty key because it is flag-gated). Closed token set: `explicit` · `caller` · `server` · `sole-user` · `cwd-root` · `most-attached`. Declared as named constants beside the struct — no magic strings.
- `session` stays tmux's own report of where the window landed (unchanged semantics); `session_rung` says WHY that session was chosen.
- Human (non-`--json`) output stays `@N` on stdout. When the role-aware branch decided (rungs `sole-user`/`cwd-root`/`most-attached`), one diagnostic line rides stderr through the sink's note channel (suppressed by `--quiet`), e.g. `session: work (cwd-root)` — data-vs-chatter per toolkit Principle 9, so scripts parsing `@N` are unaffected.
- The MCP `new_window` tool (`internal/mcp/policy.go` row `Tool: "new_window", Path: "tab new"`) needs no schema change — its args are the unchanged flags; the returned document simply carries the extra key. Note that the MCP executor strips `TMUX`, so MCP-driven spawns have no caller session and always take the `server` rung (unchanged behavior for that door).

### 5. `rk present --window` inherits the rule

`present.go` calls `resolveTabNewSession(ctx, "")` for `presentViaNewWindow`; it receives the same role gate and rungs (passing its own cwd for rung 2). Its output contract is unchanged (it does not print `session_rung`); a `nowhere to spawn` error surfaces the same way. No separate opt-out.

### 6. Help text (`rk tab new --help`)

- `--session` flag help becomes (one line, wrapped by cobra): `Session to create the window in, in the =S exact form (default: the caller's current session; when the caller sits in a run-kit infrastructure session (_rk-*), the sole user session, else the user session rooted at --cwd's main worktree, else the most-attached user session; outside tmux the server's current session)`.
- `Long` gains a short paragraph after the existing `--session` sentence stating the four rungs, the `nowhere to spawn` error, and the `session_rung` key; the `--json` sentence lists `{"session","session_rung","window_id","pane_id"}`. The `Use` line is unchanged (no new flag).
- The command tree is unchanged, so the help-dump standard's platform-stability check is unaffected; the P9 check (stdout = `@N` only) still holds because the rung note is stderr.

### 7. Tests

**Unit (pure picker, no tmux)** — `cmd/rk/tab_test.go` (or a new `tab_new_test.go` beside it):
- rung 1: one user candidate among infra rows → it, `sole-user`.
- rung 2: two user candidates, cwd inside a linked worktree whose main root equals the second candidate's path → second, `cwd-root` (stubbed `rootOf`); also the negative: a session whose path is a PREFIX of cwd but a different repo does not match.
- rung 3: no root match; attached counts 0/2/2 → the first `2`, `most-attached`; all-zero → the first row.
- rung 4: zero user candidates → error containing `nowhere to spawn`, empty session.
- caller role user → picker not consulted (`caller` rung); explicit `--session` → `explicit` (resolver-level, via the existing seams).

**Integration (real tmux via `withTabTestServer`)**:
- create an `_rk-operator` session on the test server, point `$TMUX_PANE` at a pane inside it, run `rk tab new --json` with `--cwd` set to a temp git worktree whose main checkout path equals a second user session's start path → window lands in that user session, `session_rung == "cwd-root"`, `session` reports it.
- same setup with the ONLY user session being `boot` → `sole-user`.
- kill every user session (server kept alive by the infra session) → exit 1, error text contains `nowhere to spawn`, `list-windows` shows no new window.
- the existing `TestTabNewPrintsIDAndWritesLayoutAtCreation` continues to assert the caller-session default for a user caller (byte-identical human path); `TestTabNewJSONEnvelope` is extended to assert `session_rung == "caller"`.

**`internal/gitinfo`**: `MainWorktreeRoot` tests — main checkout → itself; linked worktree (`git worktree add ../x.worktrees/y`) → main root; non-repo temp dir → `""`; both skipped when `git` is absent.

Run via `just test-backend` (never bare `go test`).

### 8. Documentation

- `docs/specs/ui-state.md` § `rk tab` — the `rk tab new` block gains the default-session rule (four rungs, infra-caller gate, `nowhere to spawn`) and `session_rung` in the `--json` comment.
- `docs/specs/mcp.md` Spawn row (`tab new` document shape) — add `"session_rung"` to the documented `result` object.
- Memory updates per § Affected Memory.

### Non-goals

- No change for a caller whose own session is `role: user` — today's ambient default is preserved exactly.
- No change outside tmux (`$TMUX_PANE` unset, incl. the MCP executor door): the server's current session remains the default.
- No new flag, no config key, no stamped tmux option, no persisted preference (Constitution II/VII).
- `rk riff --session` keeps its own default (it only borrows the `-L`-without-`$TMUX` "server's current session" rule); not touched.
- The fab-kit follow-through (dropping §6 step 2) is a separate change in the fab-kit repo after this ships.

## Affected Memory

- `run-kit/architecture/cli`: (modify) the `tab` row's **`new`** member — replace the "default is the caller's current session, else the server's current session" clause with the role-gated rung ladder, the `nowhere to spawn` error, the always-present `session_rung` key and its token set, the stderr rung note, and `rk present --window` inheriting via the shared resolver; add a Design Decision entry (role-aware default lives in rk, not in the orchestrator).
- `run-kit/tmux-sessions`: (modify) § Session Role Taxonomy — `rk tab new`'s default-session resolver joins `rk mux sessions` as the second in-process consumer of `tmux.SessionRole`/`ListSessionFacts` (the fact surface now decides the landing session, not just reports candidates); § Operator Session — note that operator-issued spawns no longer land in `_rk-operator` by default, protecting the hidden-home invariant.
- `run-kit/architecture/backend-packages`: (modify) `internal/gitinfo` row — `MainWorktreeRoot` (common-dir resolution through linked worktrees; the sibling `<repo>.worktrees/` convention is why a prefix match cannot work).
- `run-kit/mcp`: (modify) the `new_window` bullet — the returned document carries `session_rung`; MCP spawns take the `server` rung because the executor strips `TMUX`.
- `run-kit/toolkit-standards`: (modify) the `tab new` help/P9 lines — `session_rung` in the `--json` object, the rung note on stderr, `nowhere to spawn` in the exit-1 list.
- `run-kit/agent-messaging`: (modify) the `rk mux sessions` requirement's consumer note — the same facts drive `rk tab new`'s default in-process (one sentence).

## Impact

- **Code**: `app/backend/cmd/rk/tab_new.go` (resolver, picker, JSON struct, help text, rung constants), `app/backend/cmd/rk/present.go` (pass cwd to the shared resolver), `app/backend/internal/gitinfo/gitinfo.go` (+ `_test.go`) for `MainWorktreeRoot`, `app/backend/cmd/rk/tab_test.go` (+ new tests). `internal/tmux/session_facts.go` and `internal/mcp/policy.go` are consumed unchanged.
- **Behavior contract**: additive JSON key on `rk tab new --json`; new error class (exit 1) reachable only from an infra-session caller with zero user sessions; `rk present --window` behavior changes for infra-session callers only.
- **Cross-repo**: fab-kit's operator can drop its session policy after this ships (follow-through above); until then its explicit `--session =S` pin keeps working (`explicit` rung).
- **Docs**: `docs/specs/ui-state.md`, `docs/specs/mcp.md`, six memory files.
- **Tests**: `just test-backend`; the tmux-backed tests skip without `tmux`, the worktree tests skip without `git`.

## Open Questions

- None blocking. The rung-2 two-sided root comparison (Assumptions row 6) is a deliberate widening of the backlog's literal "session path equals main root" — veto via `/fab-clarify` if the literal equality is preferred.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The rule fires only when `$TMUX_PANE` is set AND the caller's own session classifies as a non-user role via `tmux.SessionRole`; a `role: user` caller keeps today's ambient default byte-for-byte | Backlog states both halves explicitly; `SessionRole` already exists and is the derivation `rk mux sessions` uses | S:95 R:90 A:95 D:95 |
| 2 | Confident | Outside tmux (`$TMUX_PANE` unset — including the MCP executor, which strips `TMUX`) the default stays the target server's current session | Backlog is silent on this path; scope discipline says leave it; MCP spawns are not the operator problem being solved | S:60 R:85 A:80 D:70 |
| 3 | Certain | Rung order and semantics: sole user → cwd main-root match → highest attached then enumeration order → `nowhere to spawn` error with no window created | Verbatim from the backlog | S:95 R:90 A:95 D:95 |
| 4 | Certain | Candidates come from `tmux.ListSessionFacts` on the TARGET server (the `-L` value or the caller's server), filtered to `SessionRoleUser`, in its enumeration order with group copies folded — the exact `rk mux sessions` row set | Backlog says "reuse the role derivation behind `rk mux sessions`" and "`rk mux sessions` row order"; the function is already exported | S:90 R:90 A:95 D:90 |
| 5 | Certain | Main-worktree root resolves via `git -C <dir> rev-parse --path-format=absolute --git-common-dir` → parent of the common dir when its base is `.git`, else the dir itself (bare repo); any failure or non-repo → `""` (never matches) — implemented as `gitinfo.MainWorktreeRoot` with `exec.CommandContext` + 5 s timeout | Backlog names the command; `internal/gitinfo` already owns `git rev-parse` subprocess helpers; `config.FindGitRoot` cannot see through a worktree's `.git` file | S:90 R:85 A:90 D:85 |
| 6 | Confident | Rung 2 compares `MainWorktreeRoot(cwd)` with `MainWorktreeRoot(candidate.Path)` (two-sided), not `candidate.Path == MainWorktreeRoot(cwd)` | Strict superset of the backlog's equality (a session rooted at the main checkout matches either way) that also matches a user session started in a subdirectory or in another worktree of the same repo; cost is one short git call per user session (few); easily reverted to literal equality via `/fab-clarify` | S:55 R:85 A:70 D:50 |
| 7 | Confident | `session_rung` is always present in `--json` with the closed token set `explicit` / `caller` / `server` / `sole-user` / `cwd-root` / `most-attached`, emitted after `session`; on the human path a `session: <name> (<rung>)` note rides stderr only when a role-aware rung decided | Backlog asks for the field and suggests the name; stable key set follows the toolkit P2 rule already applied to this struct; stderr-only note keeps P9's stdout datum intact; token names are the one naming choice open to bikeshedding | S:70 R:90 A:80 D:55 |
| 8 | Certain | Path comparison uses `filepath.Clean` on both git results, no symlink resolution | Both sides come from the same git invocation style, so they canonicalize identically; `EvalSymlinks` would add failure modes for no observed case | S:70 R:95 A:85 D:85 |
| 9 | Confident | `rk present --window` inherits the rule through the shared `resolveTabNewSession` (passing its own cwd) rather than keeping the old behavior | It already shares the resolver by design ("the presentViaNewWindow rule"); an operator running `rk present` has the same `_rk-operator` pollution problem | S:60 R:80 A:85 D:75 |
| 10 | Certain | Ties on attached count (including all-zero) resolve to the earliest enumeration row | Backlog: "then `rk mux sessions` row order" | S:90 R:95 A:95 D:95 |
| 11 | Certain | Error class is operational (exit 1), raised before `new-window`; `--json` failures ride the central `ok:false` writer with no verb-local envelope code | Toolkit exit-code convention already applied across `rk tab`; the central writer exists for exactly this | S:85 R:90 A:95 D:95 |
| 12 | Certain | Tests: pure-picker unit tests per rung plus tmux-backed integration tests via `withTabTestServer` with an `_rk-operator` caller session and a real `git worktree add` fixture for the sibling case; run through `just test-backend` | Backlog acceptance names per-rung tests incl. worktree-sibling and zero-candidate; code-quality.md requires tests; the harness already exists | S:90 R:95 A:95 D:95 |
| 13 | Confident | MCP `new_window` policy row and tool description are unchanged; only `docs/specs/mcp.md`'s document-shape row and memory `mcp.md` mention the new key | Flags are unchanged, so the introspected schema is unchanged; the envelope wraps the verb's document verbatim | S:70 R:90 A:85 D:85 |
| 14 | Certain | `rk riff --session`'s default is untouched | It only borrows the outside-tmux "server's current session" rule, which this change does not alter | S:80 R:95 A:90 D:95 |

14 assumptions (10 certain, 4 confident, 0 tentative, 0 unresolved).
