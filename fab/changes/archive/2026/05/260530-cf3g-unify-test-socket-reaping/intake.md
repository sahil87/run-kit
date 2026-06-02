# Intake: Unify Test Socket Reaping

**Change**: 260530-cf3g-unify-test-socket-reaping
**Created**: 2026-05-30
**Status**: Draft

## Origin

This change consolidates three `#208`-adjacent backlog items into one coherent change:

- **[p4mx]** — Unify all test tmux-socket prefixes under a single `rk-test-*` umbrella.
- **[r8kp]** — Convert the `#208` `TestMain` pre-sweep to a post-sweep.
- **[q7vn]** — Add a general-purpose manual kill mode to `rk reaper` via `--prefix`.

> The change was scoped through a `/fab-discuss` session. The user's framing: "rk reaper
> should act by default on a prefix. This prefix can be `rk-test`. Any artifact — live process,
> folders, lock files — delete it when one runs `rk reaper`. Same behaviour on
> `rk reaper --prefix abc` — just on all servers with the name `abc*`. Then, all our test cases
> should run on servers with the name pattern `rk-test*`."

The discussion mode was **conversational and empirical** — design assumptions from the backlog
were tested against the live system before being accepted:

1. The backlog assumed the manual `rk reaper` was already unconditional (no PID gate). **Reading
   the code disproved this**: today's `classifyReap` (`internal/tmux/reaper.go:55-72`) *does* probe
   liveness and special-cases `rk-e2e-*` / `_rk-ctl`. This change therefore *removes* existing
   behavior, not refines a brute-force tool.
2. An early design considered a universal PID-liveness gate on the manual reaper. A live-system
   check (12 `rk-e2e-*` servers whose embedded epoch-suffix "PID" was dead while the tmux server
   itself was alive) showed the gate's signal was ambiguous for e2e names. The user chose to
   **drop the PID gate from the manual path entirely** — manual reaper is brute-force-by-prefix.
3. The remaining live-vs-leaked safety question (which the e2e exclusion historically solved) is
   answered by a **documented operating contract** ("do not run `rk reaper` while tests are
   running") rather than code, plus keeping the *automatic* sweep scoped to dead-PID owners so
   concurrent `go test ./...` packages cannot kill each other.

## Why

**Problem.** "Is this a test artifact?" is currently not one check — it is a six-prefix / two-rule
split:

- `IsGoTestServerName` (`internal/tmux/tmux.go:1152-1179`) matches **5 reap-anytime Go-test
  prefixes**: `rk-test-`, `rk-relay-test-`, `rk-verify-`, `rk-tmuxctl-test`, `rk-daemon-test`.
  (`rk-verify-` is dead — listed in the allowlist but no test actually names a socket with it.)
- `rk-e2e-*` (Playwright) is a **separate never-reap exclusion** because an e2e run can be LIVE
  mid-test, and Playwright servers carry an epoch suffix (`Date.now().slice(-6)`), not a PID, so
  the PID-based sweep cannot reason about them.

All of the accidental complexity — the `.lock`-inherits-base-server logic in `classifyReap`, the
"`IsGoTestServerName` excludes e2e" comments, and the reaper's exclusion dance — exists *only*
because e2e is a test artifact that lives outside the test-naming convention.

**Consequence of not fixing.** Every new test helper that names a socket must remember which of six
prefixes to use; every consumer that asks "is this a test socket?" must replicate the multi-prefix
allowlist; and the e2e exclusion remains a permanent special case that future cleanup logic has to
route around. Leaked e2e residue accumulates (observed: ~30 `rk-e2e-*` sockets + `.lock` files on
the dev box) because no automatic path is responsible for it.

**Why this approach.** Collapsing every test socket to `rk-test-<role>-<pid>-<ns>` makes "is this a
test artifact?" exactly one `HasPrefix(name, "rk-test-")` check, used uniformly by all three
consumers (reaper, `/api/servers`, tmuxctl supervisor). Embedding a real PID in *every* test socket
(including e2e) means the automatic sweep can reason about all of them with one parse rule. The
manual reaper becomes a dumb-but-honest brute-force-by-prefix tool — the operator who invokes it
asserts nothing live needs the matched sockets.

**Rejected alternative — universal PID gate on the manual reaper.** Considered and dropped. The
manual reaper is an operator escape hatch invoked deliberately; a PID gate adds machinery without
adding safety the operating contract does not already provide, and the e2e epoch-suffix case showed
the embedded-number-is-PID assumption is not universally reliable for a *kill* decision. The PID
gate is retained *only* on the automatic sweep, where the embedded value is genuinely
`os.Getpid()` of the live test binary.

## What Changes

### 1. Unified test-socket naming (`rk-test-<role>-<pid>-<ns>`) — [p4mx]

Every test socket name collapses to one umbrella with a role segment, a real PID, and a namespace
(uniqueness) segment:

| Today | Becomes |
|-------|---------|
| `rk-test-<pid>-<ns>` (session/board/sweep tests) | `rk-test-unit-<pid>-<ns>` |
| `rk-relay-test-<pid>-<ns>` (`api/relay_test.go`) | `rk-test-relay-<pid>-<ns>` |
| `rk-tmuxctl-test` (fixed, `integration_test.go`) | `rk-test-tmuxctl-<pid>-<ns>` |
| `rk-daemon-test` (fixed, `daemon_test.go`) | `rk-test-daemon-<pid>-<ns>` |
| `rk-e2e` / `rk-e2e-multi-<epoch>` / `rk-e2e-coupling-<epoch>` | `rk-test-e2e-<pid>-<ns>` / `rk-test-e2e-multi-<pid>-<ns>` / `rk-test-e2e-coupling-<pid>-<ns>` |
| `rk-verify-` (dead — no socket actually named this) | removed from allowlist, no replacement |

Go naming sites to change (all currently `fmt.Sprintf("rk-test-%d-%d", os.Getpid(), time.Now().UnixNano())`
or fixed consts):

- `internal/tmux/tmux_test.go:967` `withSessionOrderTmux` → `rk-test-unit-…`
- `internal/tmux/tmux_test.go:1115` `withGroupedSessionTmux` → `rk-test-unit-…`
- `internal/tmux/board_test.go:261` `withBoardTmux` (delegates to `withSessionOrderTmux`)
- `api/relay_test.go:28` `withRelayTmux` → `rk-test-relay-…`
- `cmd/rk/serve_sweep_test.go:76` → `rk-test-unit-…`
- `internal/tmuxctl/integration_test.go:25` const `rk-tmuxctl-test` → PID-stamped `rk-test-tmuxctl-…`
- `internal/daemon/daemon_test.go:12` const `rk-daemon-test` → PID-stamped `rk-test-daemon-…`

The fixed-name sockets (`rk-tmuxctl-test`, `rk-daemon-test`) gain a PID + namespace so the
automatic sweep can parse them — today they are unparseable by `parseTestSocketPID` and rely on
per-test cleanup only.

**Recommended helper.** Introduce one shared naming helper so the six sites stop hand-rolling the
format string (current anti-pattern: duplicated `fmt.Sprintf`). Sketch:

```go
// testSocketName builds a unified test socket name: rk-test-<role>-<pid>-<ns>.
func testSocketName(role string) string {
    return fmt.Sprintf("rk-test-%s-%d-%d", role, os.Getpid(), time.Now().UnixNano())
}
```

### 2. PID embedded in e2e (TypeScript) socket names — [p4mx]

Playwright servers currently use `Date.now().toString().slice(-6)` (an epoch suffix, not a PID),
which is exactly why `parseTestSocketPID` skips them today. To make the automatic sweep able to
reason about e2e sockets uniformly, e2e names embed the Playwright **process PID**:

- `scripts/test-e2e.sh`: `E2E_TMUX_SERVER="rk-test-e2e"` (was `rk-e2e`); the dedicated server
  becomes `rk-test-e2e-$$-<ns>` (shell PID) or stays a fixed primary `rk-test-e2e` — see Open
  Questions on whether the *primary* harness server needs a PID.
- `app/frontend/tests/e2e/global-teardown.ts`: prefix default `rk-test-e2e` (was `rk-e2e`); the
  prefix-glob teardown logic is unchanged in shape.
- `boards-multi-server.spec.ts:7`, `sidebar-server-coupling.spec.ts:7`: name secondary servers
  `rk-test-e2e-multi-${process.pid}-${suffix}` / `rk-test-e2e-coupling-${process.pid}-${suffix}`
  (was `rk-e2e-multi-${Date.now().slice(-6)}`).

The PID parse rule (`parseTestSocketPID`) parses the PID as the **second-to-last hyphen-delimited
field** of the name — i.e. the field immediately before the final `<ns>`. <!-- clarified: parse from the right; PID = second-to-last field, so roles may contain hyphens (e2e-multi, e2e-coupling) with no fixed-index dependency; <ns> MUST be a single hyphen-free token -->
This is robust to multi-token roles (`e2e-multi`, `e2e-coupling`) because it does not depend on the
role being a single segment. The only constraint: `<ns>` (the uniqueness/namespace suffix) MUST be
a single hyphen-free token, so the PID is unambiguously the second-from-right field. Implementation:
`strings.Split(name, "-")`, take element `len-2`, `strconv.Atoi` it; `ok=false` if it does not parse
or there are too few fields. Names without `rk-test-` prefix → `ok=false` as today.

### 3. One `HasPrefix("rk-test-")` check replaces `IsGoTestServerName` — [p4mx]

Delete `IsGoTestServerName` (`internal/tmux/tmux.go:1152-1179`) and its 5-prefix allowlist.
Its **three** consumers diverge — two adopt the single-prefix check, one drops filtering entirely:

- `internal/tmux/reaper.go` (`classifyReap`, `needsProbe`) — the manual reaper's classification is
  being rewritten to brute-force-by-prefix anyway (see #5); it uses `HasPrefix(name, prefix)` with
  the operator-supplied (or default `rk-test`) prefix.
- `api/servers.go:20-37` — **the hide is DELETED entirely.** `/api/servers` stops filtering and
  returns *every* tmux server, including leaked `rk-test-*` orphans. <!-- clarified: user chose to delete the hide entirely, not just exempt e2e — "surface everything"; the reaper becomes the sole mechanism keeping the list clean -->
  This reverses the original intent (the handler comment at `servers.go:24-27` justifies hiding
  Go-test sockets because the frontend opens an SSE stream per server and would "churn over
  dozens of orphans after every dev/test session"). The accepted consequence: after a crashed test
  run the dev UI lists every orphan socket and opens an SSE stream against each until the operator
  runs `rk reaper`. This is consistent with making the reaper the single cleanup tool, and with the
  user's "surface errors, tests etc." framing — the UI shows the mess so the operator sees exactly
  what the reaper will reap.
- `internal/tmuxctl/supervisor.go:37` (`isTmuxSocketCandidate`) — adopts
  `HasPrefix(name, "rk-test-")`. This filter **must stay** regardless of the `/api/servers`
  decision: it prevents `resolveBootstrap`'s `tmux new-session -s _rk-ctl` from *resurrecting*
  every orphan test socket on bootstrap (a correctness guard, not UI noise reduction). A small
  exported helper (e.g. `IsTestServerName`) keeps the `"rk-test-"` literal in one place for this
  consumer and the reaper's default.

### 4. Automatic sweep: pre-sweep → post-sweep, scoped — [r8kp]

Convert the `TestMain` **pre-sweep** to a **post-sweep** in both packages that have it:

- `internal/tmux/main_test.go:23-26` — `sweepDeadTestSockets(); os.Exit(m.Run())`
- `api/main_test.go:28-30` — identical

New shape (each run reaps its OWN dead-PID residue at exit):

```go
func TestMain(m *testing.M) {
    code := m.Run()
    sweepDeadTestSockets()
    os.Exit(code)
}
```

`sweepDeadTestSockets` keeps its current PID-gated discipline (`parseTestSocketPID` +
`testPIDAlive` via `syscall.Kill(pid, 0)`) — it stays **scoped to dead-PID owners**, never a
blanket `rk-test-*` wipe, so concurrent `go test ./...` packages (which run as separate processes)
cannot kill each other's live sockets. The pre-sweep is **dropped entirely** — the only automatic
cleanup of un-catchable SIGKILL/panic/OOM residue is now the manual `rk reaper` run by hand. Per-
test `t.Cleanup(kill-server)` continues to handle the normal path.

A new test MUST prove live-PID sparing still holds for the post-sweep: simulate a concurrent live
test socket (live PID) alongside a dead-PID orphan, run the sweep, assert the live one survives and
the dead one is reaped.

### 5. Manual `rk reaper`: brute-force-by-prefix — [q7vn]

Rewrite the manual reaper to be brute-force-by-prefix with **no liveness probe**:

- **Bare `rk reaper`** ≡ `rk reaper --prefix rk-test` — matches every `rk-test*` socket, `.lock`,
  and live server. No `parseTestSocketPID`, no `testPIDAlive`, no e2e exclusion, no `.lock`
  inheritance.
- **`rk reaper --prefix <p>`** — identical behavior on `<p>*` instead of `rk-test*`.
- **Dry-run is the default for BOTH bare and `--prefix`.** <!-- clarified: user chose dry-run everywhere, reversing the earlier "act by default" framing; --yes/--force required to actually reap, even on the bare rk-test path -->
  Invoking `rk reaper` (or `rk reaper --prefix <p>`) with no action flag **prints the match list
  and classified actions (kill vs remove) and touches nothing.** The operator must pass `--yes`
  (or `--force`) to actually reap: `tmux kill-server` for live servers, `os.Remove` for sockets and
  `.lock` files. This means everyday test cleanup is two invocations — preview, then `--yes` — and
  composes with the deleted `/api/servers` hide (#3): the UI shows the orphan pile, the dry-run
  shows what will be reaped, then the operator confirms.
- **Flag changes**: the existing `--dry-run` flag (`reaper.go:11`) is effectively the new default;
  add `--yes` / `--force` as the action gate. (Whether `--dry-run` is retained as a redundant
  explicit form or removed in favor of "default is dry-run" is a minor implementation detail for
  spec.)
- **Removed**: the liveness probe in `classifyReap`, the `rk-e2e-*` skip, the
  `.lock`-inherits-base-server logic.
- **Retained as unconditional skips** even under `--prefix`: `_rk-ctl` (control anchor) and the live
  production `rk-daemon` server. A bare `rk-test` reap never matches these, but a broad or mistyped
  `--prefix` could, and the dry-run default alone is not sufficient protection for the production
  daemon. <!-- clarified: keep _rk-ctl + rk-daemon hard-skip even in --prefix mode; dry-run protects against surprise but a confirmed --yes on a bad prefix should still never take down production -->
- **Dangerous-prefix guard**: empty prefix or one ≤ 3 chars (e.g. `rk-`) is refused unless `--force`
  — such a prefix matches nearly everything (`runkit`, `runWork`, production) and is almost always a
  typo.

This is a **behavior change** from today's PID-probing, e2e-excluding reaper. The safety that the
e2e exclusion previously provided is replaced by (a) the dry-run-default preview, (b) the
unconditional `_rk-ctl`/`rk-daemon` skips, (c) the dangerous-prefix guard, and (d) the operating
contract in #6.

### 6. Operating contract (documentation) — [design]

Because the manual reaper no longer protects live runs by name or PID, document the contract: **do
not run `rk reaper` (bare or `--prefix`) while tests are running.** This lives in the reaper command
`Long` help text and the run-kit memory (`tmux-sessions` or a reaper note). The automatic sweep's
PID-scoping is what protects concurrent `go test` packages; the manual tool relies on the human.

## Affected Memory

- `run-kit/tmux-sessions`: (modify) Document the unified `rk-test-<role>-<pid>-<ns>` naming
  convention (PID = second-to-last field), the post-sweep timing, the manual-reaper
  brute-force-by-prefix + dry-run-default behavior + operating contract, AND the fact that
  `/api/servers` now lists every tmux server (the hide was deleted) — so leaked test orphans appear
  in the dev UI until reaped. The current memory describes session enumeration and edge cases; the
  test-socket naming convention, the no-hide `/api/servers` behavior, and reaper semantics belong here.

## Impact

**Backend (Go) — `app/backend/`:**
- `internal/tmux/tmux.go` — delete `IsGoTestServerName` + 5-prefix allowlist; add `IsTestServerName` (single-prefix) helper.
- `internal/tmux/reaper.go` — rewrite `classifyReap` / `ReapTestServers` to brute-force-by-prefix; remove probe, e2e skip, `.lock` inheritance; add `--prefix` flag plumbing.
- `cmd/rk/reaper.go` — add `--prefix` flag; update `Long` help (operating contract); possibly dangerous-prefix guard.
- `internal/tmux/main_test.go`, `api/main_test.go` — pre→post sweep; PID parse accepts role segment.
- `api/servers.go:20-37` — **delete** the test-socket hide filter entirely (no helper swap); `/api/servers` returns all servers.
- `internal/tmuxctl/supervisor.go:37` — `IsGoTestServerName` → `IsTestServerName`.
- Test naming sites (7): `tmux_test.go`, `board_test.go`, `relay_test.go`, `serve_sweep_test.go`, `integration_test.go`, `daemon_test.go` — adopt unified naming via shared helper.
- Test data/assertions: `servers_test.go` (the hidden/shown fixture list — now asserts ALL servers returned, including `rk-test-*` orphans; the hide-assertion is inverted), `reaper_test.go` (the `.lock`-inheritance + e2e-skip cases — deleted; new cases assert brute-force match + dry-run-default + `_rk-ctl`/`rk-daemon` skip + dangerous-prefix refusal), `socketsweep_test.go` (both packages).

**Frontend / test infra:**
- `scripts/test-e2e.sh` — `E2E_TMUX_SERVER` rename + PID embedding.
- `app/frontend/tests/e2e/global-teardown.ts` — prefix default rename.
- `app/frontend/tests/e2e/boards-multi-server.spec.ts`, `sidebar-server-coupling.spec.ts` — secondary-server naming with `process.pid`.
- Companion `.spec.md` files for any modified `.spec.ts` (constitution: Test Companion Docs).

**Constitution / API:**
- Security First: all kill/teardown stays `exec.CommandContext` with timeout — no shell strings (current `KillServer` already complies; new `--prefix` reap path must too).
- Uniform HTTP Verb / Minimal Surface: no new routes; `rk reaper --prefix` is a CLI flag, not an endpoint. Justified as the operator manual-cleanup escape hatch.

**Closes backlog items:** p4mx, r8kp, q7vn (mark done in `fab/backlog.md` at archive).

## Open Questions

All intake-stage open questions were resolved during `/fab-clarify` (see `## Clarifications`). The
following are deferred to **spec** as implementation-level details, not blocking decisions:

- **Primary e2e harness server PID.** The Playwright *primary* server (`rk-test-e2e`) is created
  once by the shell script and torn down by trap/glob. It likely stays a fixed `rk-test-e2e` name
  (relying on the trap, and caught by the manual reaper's `rk-test` brute-force) since a fixed-name
  primary cannot be PID-swept and does not need to be — only the per-spec *secondary* servers
  (`rk-test-e2e-multi-<pid>-<ns>`) carry a PID. Confirm in spec.
- **`--dry-run` flag retention.** With dry-run now the default, whether to keep `--dry-run` as a
  redundant explicit form or drop it in favor of "default is preview, `--yes` acts" is a minor CLI
  surface decision for spec.

## Clarifications

### Session 2026-05-30

| # | Question | Resolution |
|---|----------|------------|
| 10 | PID parse rule when a role contains a hyphen (`e2e-multi`) | PID is the **second-to-last** hyphen field; parse from the right. `<ns>` must be a single hyphen-free token. Robust to any role shape. |
| 11 | `/api/servers` would hide `rk-test-e2e-*` under the unified rule — keep e2e visible, or? | **Delete the hide entirely** — `/api/servers` lists every server including orphans. "Surface errors, tests etc." The reaper is the sole cleanup mechanism. Accepted cost: per-orphan SSE churn in the dev UI until reaped. |
| 12 | `--prefix` default action (act vs dry-run) + dangerous-prefix + `_rk-ctl`/production skip | **Dry-run everywhere** — both bare `rk reaper` and `--prefix` default to preview; `--yes`/`--force` to act (reverses earlier "act by default"). `_rk-ctl` + live `rk-daemon` hard-skipped even under `--prefix`. Empty/≤3-char prefix refused unless `--force`. |

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Unify all test sockets under `rk-test-<role>-<pid>-<ns>`; collapse the 5-prefix allowlist + e2e exclusion into one `HasPrefix("rk-test-")` | Core of p4mx; explicitly chosen by user ("all our test cases should run on servers with the name pattern rk-test*") | S:95 R:60 A:90 D:90 |
| 2 | Certain | Manual `rk reaper` = brute-force-by-prefix, no PID/liveness probe; bare ≡ `--prefix rk-test`; kills live servers + removes sockets + `.lock`. **Dry-run is the default for both bare and `--prefix`; `--yes`/`--force` required to act.** | User's "delete any artifact" framing; then chose dry-run-everywhere in clarify (reversing earlier "act by default") | S:95 R:50 A:85 D:85 |
| 3 | Certain | Automatic sweep stays PID-scoped (dead-PID owners only), NOT a blanket wipe, so concurrent `go test ./...` packages don't kill each other | User agreed to point 3 (scoped automatic path) explicitly; grounded in real code (`parseTestSocketPID`+`testPIDAlive`) | S:90 R:55 A:90 D:85 |
| 4 | Certain | Convert `TestMain` pre-sweep → post-sweep in `internal/tmux` and `api`; drop the pre-sweep entirely; manual reaper is the only auto-cleanup for SIGKILL residue | r8kp core; user agreed "the only cleanup of SIGKILL will be rk reaper by hand" | S:90 R:60 A:85 D:85 |
| 5 | Certain | Embed real PID in e2e (Playwright) socket names (`rk-test-e2e-<pid>-…`) using `process.pid`, replacing the `Date.now()` epoch suffix | User selected "Embed real PID" in scoping; required for uniform `parseTestSocketPID` | S:90 R:55 A:85 D:80 |
| 6 | Certain | Delete `IsGoTestServerName`. tmuxctl supervisor + reaper adopt the single `HasPrefix("rk-test-")` check; **`/api/servers` DELETES its hide filter entirely and lists every server** (orphans included) | User chose "delete the hide entirely" in clarify; supervisor filter retained as a resurrection guard; grounded in the 3 call sites | S:95 R:45 A:90 D:90 |
| 7 | Confident | Document an operating contract ("don't run `rk reaper` while tests run") in reaper help + memory, since the manual path no longer protects live runs | Follows directly from dropping the PID gate (assumption 2); user agreed to point 2 (the contract) | S:80 R:75 A:80 D:75 |
| 8 | Confident | Introduce a single shared `testSocketName(role)` helper to replace the 6 duplicated `fmt.Sprintf` naming sites | Code-quality anti-pattern (duplication) flagged in code map; standard refactor hygiene | S:75 R:85 A:85 D:80 |
| 9 | Confident | Add a post-sweep test proving live-PID sparing holds under a simulated concurrent live socket | r8kp explicitly requires evaluating the concurrent interaction; project requires tests for changed behavior | S:80 R:80 A:85 D:80 |
| 10 | Certain | `parseTestSocketPID` parses the PID as the **second-to-last hyphen field** (`rk-test-...-<pid>-<ns>`); roles may contain hyphens; `<ns>` MUST be a single hyphen-free token | Clarified — user chose "PID is second-to-last field"; robust to multi-token roles (e2e-multi) | S:95 R:55 A:60 D:50 |
| 11 | Certain | `/api/servers` hide is **deleted entirely** — all tmux servers listed, including leaked `rk-test-*` orphans; reaper is the sole list-cleaning mechanism; accepted cost is per-orphan SSE churn until reaped | Clarified — user chose "delete the hide entirely / surface everything" | S:95 R:45 A:55 D:45 |
| 12 | Certain | `--prefix` (and bare) default to **dry-run**; `--yes`/`--force` to act; `_rk-ctl` + live `rk-daemon` unconditionally skipped even under `--prefix`; empty/≤3-char prefix refused unless `--force` | Clarified — user chose "dry-run everywhere"; production/control hard-skips + dangerous-prefix guard added | S:95 R:60 A:55 D:50 |

12 assumptions (9 certain, 3 confident, 0 tentative, 0 unresolved).
