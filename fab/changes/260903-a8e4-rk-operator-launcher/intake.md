# Intake: rk operator — own the operator-launcher mechanics in run-kit

**Change**: 260903-a8e4-rk-operator-launcher
**Created**: 2026-09-03

## Origin

Promptless dispatch (`/fab-proceed`-style create-intake, `{questioning-mode} = promptless-defer`) of a **complete, user-approved design** synthesized from a live conversation. The design's decisions are encoded below as Certain/Confident assumptions citing that discussion — they are settled, not open for re-litigation.

> **rk operator — own the operator-launcher mechanics in run-kit** (phase 1 of phasing out the bare `fab operator` launcher verb; fab-kit's `fab operator` SUBCOMMAND family — tick-start/autopilot/enroll/state/note/watch/branch-map — stays in fab-kit, it is pipeline choreography and explicitly out of scope).
>
> Context: fab-kit's `fab operator` (fab-kit repo, cmd/fab/operator.go runOperator) opens a per-tmux-server singleton window named `operator` running the operator-role-resolved agent with `/fab-operator` as the launcher's POSITIONAL argument. Two problems: (a) positional kickoff is claude-only (latent break if `agent.profiles.operator` points at kimi/codex — the exact bug rk tutorial hit, PR #801→#806); (b) window mechanics are substrate (rk's layer per docs/specs/cli-layering.md) and the operator window's identity convention (`@rk_win_role=operator`, consumed by run-kit's operator-actuation seam) is rk's — today fab creates the window and the role marker is stamped separately. Owning the launcher in rk closes that gap and rides the just-built primitives (PR #806): `inject.DeliverWhenReady`, `riff.ResolveLauncher`, `riff.SkillPaneCommand`, and the delivery pattern in cmd/rk/tutorial.go.

Gap analysis (no existing mechanism covers this):

- `rk role operator` (`app/backend/cmd/rk/role.go`) stamps `@rk_win_role` on an **existing** window from inside it (radio-clear + option write + physical move into the per-server operator session). It creates and launches nothing.
- `rk tutorial` (`app/backend/cmd/rk/tutorial.go`) is the select-or-create + bare-launcher + typed-kickoff pattern this command mirrors, but it is **session-scoped** and tutorial-specific.
- `rk riff` is the worktree/collision/layout spawn engine — the wrong shape for select-or-create on the current server (tutorial.go records the same judgment).

## Why

1. **The operator launcher duplicates substrate mechanics rk now owns as primitives**, and carries a latent claude-only positional kickoff: fab-kit's `runOperator` passes `/fab-operator` as the launcher's positional argument, which only claude's CLI accepts (kimi parses a positional as a subcommand and exits) — the exact bug `rk tutorial` hit and fixed in PR #801→#806. If `agent.profiles.operator` ever points at kimi/codex, `fab operator` breaks. Left unfixed, the operator launcher stays a provider-fragile duplicate of mechanics rk already implements correctly.
2. **The operator window's identity convention is rk's, so its creator should be rk.** `@rk_win_role=operator` is run-kit's convention (consumed by the operator-actuation seam, the sidebar pin, the `_rk-operator` home session). Today fab creates the window and the role marker is stamped separately (the `/fab-operator` skill's fail-silent `rk role operator` self-mark) — a create-then-mark gap where a window can exist unmarked. Owning creation in rk makes create-and-mark atomic.
3. **This is the agreed phase 1 of "own the mechanics in rk."** fab-kit's bare `fab operator` will later delegate to `rk operator` (capability-probed, fail-open) per docs/specs/cli-layering.md delegation rules; that fab-kit follow-up is already filed in fab-kit's backlog and is out of scope here.

## What Changes

### 1. New top-level command: `rk operator`

New files `app/backend/cmd/rk/operator.go` + `app/backend/cmd/rk/operator_test.go`, registered in `app/backend/cmd/rk/root.go` (the `rootCmd.AddCommand(tutorialCmd)` pattern at root.go:74).

Flags:

- `--workers <provider>` — sets `FAB_AGENT_WORKERS` for the launched agent, mirroring fab operator's flag (see § 6).

Structure mirrors `tutorial.go`: package-level `operator*Fn` seams for tmux/riff/inject calls, a testable `runOperator(cmd)` core, `riff.ExitCodeError` discipline in the RunE wrapper (message bare to stderr, carried exit code).

### 2. Hard preconditions — exit 1 (operational), no tmux subprocess before they pass

- **(a) Inside tmux**: `tmux.OriginalTMUX` non-empty (the riff/tutorial `checkPreconditions` pattern — tutorial.go:142).
- **(b) fab on PATH**: `exec.LookPath("fab")` succeeds. **USER EXPLICITLY DECIDED hard-refuse**: an operator without fab-kit is meaningless (the `/fab-operator` kickoff skill would not exist). The error message names **fab-kit** as the required companion tool. There is **no degrade to a default launcher for missing fab** — unlike tutorial's fail-open posture.

Both failures exit 1 (`riff.ExitPrecondition`).

### 3. Server-wide singleton probe

The operator is **per-tmux-server** (unlike tutorial's session scope). Enumerate ALL sessions' windows on the current server: `tmux list-windows -a` run with the restored-`$TMUX` child env (the `tutorialChildEnv` pattern — `internal/tmux`'s init() strips `$TMUX`; re-append the captured `tmux.OriginalTMUX`).

Probe priority:

1. **Role option**: a window whose `@rk_win_role` option equals `operator` — rk's identity convention; reuse the exact option name (`tmux.RoleOption`) and reading used by `cmd/rk/role.go`. Format string carries the option, e.g. `#{window_id}\t#{@rk_win_role}\t#{window_name}`.
2. **Name fallback**: exact window name `operator` (fab operator's legacy convention). Exact-match the name as the **last tab-separated field** (the `findTutorialWindowID` cut-on-first-tab rule, extended for the extra column) — no prefix/substring matches.

On hit: `select-window -t <@N id>` plus best-effort `switch-client` (the window may live in another session — fab operator.go precedent; switch-client failure is ignored), report `Switched to existing operator tab.`, exit 0.

### 4. Create path — atomic create-and-mark

- `tmux new-window -P -F '#{pane_id}'` capturing the pane id, window named `operator`, on the CURRENT server (restored-`$TMUX` env).
- cwd: git repo root else process cwd — fab operator.go's gitRepoRoot-else-Getwd precedent; `config.FindGitRoot(cwd)` is the rk-side helper (returns `""` when no `.git` found → fall back to `os.Getwd()`).
- Immediately **stamp `@rk_win_role=operator` on the created window** — reuse rk role's write path/helpers rather than duplicating the option write: `tmux.ClearWindowRoleExcept` (server-scoped radio), the `tmux.RoleOption` set, and the physical `tmux.MoveWindowIntoOperatorSession` promotion, i.e. the same sequence `runRole` applies (role.go:134-156). This is what closes the create-then-mark gap.

### 5. Launcher resolution

`riff.ResolveLauncher(ctx, root, "operator")` → `fab agent operator --print`. fab owns the profile answer; **rk never parses fab config** (constitution §III — wrap, don't reinvent). fab is guaranteed present by precondition (b); if resolution still fails (non-zero, timeout, malformed output), the seam's silent `riff.DefaultLauncher` fallback is the **accepted residual** — it matches fab operator's own degrade-to-builtin posture.

### 6. Composition — bare launcher + workers env

`riff.SkillPaneCommand(launcher, "")` — bare launcher (empty prompt: the kickoff is typed after boot, never positional), `${SHELL:-/bin/sh} -i -c` wrap, `; exec "${SHELL:-/bin/sh}"` fallback tail.

When `--workers` is set, prefix the **agent command only** (inside the shell string, scoped to the agent command — fab-kit's `withWorkersEnv` semantics) with `FAB_AGENT_WORKERS=<value>`, e.g. layer 1 becomes `FAB_AGENT_WORKERS=kimi <launcher>` before the interactive wrap.

**SECURITY (constitution §I)**: the value enters the deliberately-unescaped shell string, so it MUST be validated against a strict charset first: `^[A-Za-z0-9_-]+$`. Anything else is a **usage error (exit 2)**. Only when the flag is set — no empty prefix; unset `--workers` produces byte-identical bare composition.

### 7. Typed kickoff — provider-agnostic from day one

Deliver `/fab-operator` via `inject.DeliverWhenReady` (internal/inject/ready.go), never a positional argument:

- Per-invocation engine: `inject.NewEngine(muxBufferNameFn())` — the `rk-send-<pid>` buffer (mux_send.go:135).
- Tmux adapter: the shared CLI inject adapter from cmd/rk (`awaitReadyTmux{}`, mux_await.go).
- State reader: `tmux.PaneAgentState` via the bounded `boundedPaneAgentState` reader (mux_await.go:290).
- The tutorial delivery shape (tutorial.go `deliverTutorialKickoff` / `tutorialDeliverFn` seam): boot-readiness wait, named-buffer bracketed paste, echo probe, probe-gated Enter.

On any delivery failure: stderr paste-it-yourself note carrying `/fab-operator`, **exit 0** (the tutorial degrade pattern — window and agent exist either way).

### 8. Tests (`app/backend/cmd/rk/operator_test.go`)

Seam-stubbed, no live tmux; the suite must pass under `env -u TMUX -u TMUX_PANE go test ./cmd/rk/`. Coverage:

- Both preconditions (tmux + fab-on-PATH), including **zero tmux subprocesses before they pass**.
- Singleton probe priority: role-option hit beats name hit; name fallback works; no prefix/substring matches.
- Workers-env validation + composition: valid value prefixes the agent command only; invalid value exits 2; unset flag = byte-identical bare composition.
- Launcher tier plumbing: `ResolveLauncher` called with tier `"operator"`.
- Delivery wiring + the degrade note on delivery failure.

### 9. Docs

- README `## Command reference` row for `run-kit operator` (README.md:294 table).
- Command Long help covering preconditions (tmux + fab-kit), server-wide singleton semantics, and `--workers`.
- Toolkit-standards check for the new surface (help-dump + Principle 9 new-surface conformance, per constitution § Toolkit Standards — run `shll standards` and check the governing entries).

### 10. Stacking — record prominently

**This change branches from the CURRENT consolidated branch `260903-7ajq-typed-kickoff-fix` (PR #806)** — it depends on `inject.DeliverWhenReady`, which exists only there. **Ship's PR base must be `260903-7ajq-typed-kickoff-fix`, NOT `main`; merge order: #806 first.**

### Non-Goals

- fab-kit changes — the bare `fab operator` → `rk operator` delegation is a fab-kit follow-up, already filed in fab-kit's backlog.
- The `fab operator` SUBCOMMAND family (tick-start/autopilot/enroll/state/note/watch/branch-map) — pipeline choreography, stays in fab-kit.
- run-kit's daemon operator-actuation seam — untouched.
- The `_rk-operator` home-session convention — untouched (the create path *uses* the existing promotion helper; it changes nothing about the convention).

## Affected Memory

- `run-kit/architecture`: (modify) CLI subcommand inventory gains `rk operator`; design decision — operator launcher mechanics owned by rk, typed kickoff over positional.
- `run-kit/tmux-sessions`: (modify) `@rk_win_role` writer set grows (rk operator's atomic create-and-mark joins rk role and the window-options POST handler).
- `run-kit/operator-actuation`: (modify) the operator window's creation story — created and role-marked by `rk operator`, closing the create-then-mark gap.
- `run-kit/rk-riff`: (modify) `ResolveLauncher`/`SkillPaneCommand` consumer list gains `rk operator`.
- `run-kit/toolkit-standards`: (modify) help-dump + Principle 9 new-surface conformance list gains the `operator` command.

## Impact

- **Backend CLI only**: new `app/backend/cmd/rk/operator.go` + `operator_test.go`; one-line registration in `app/backend/cmd/rk/root.go`. Possible small helper exposure in `internal/tmux` if the role write-path helpers need a cmd/rk-callable seam (they are already exported: `ClearWindowRoleExcept`, `MoveWindowIntoOperatorSession`, `RoleOption`).
- **No frontend, no API routes, no daemon changes.**
- **Docs**: README command-reference row.
- **Tests**: Go only — `go test ./cmd/rk/` (run under `env -u TMUX -u TMUX_PANE`; ambient `TMUX_PANE` from a dev shell produces false local greens — PR #793 lesson).
- **Branch/PR topology**: stacked on `260903-7ajq-typed-kickoff-fix` (PR #806); PR base is that branch, not main.

## Open Questions

- None — the design is complete and user-approved; no decision landed Unresolved (no deferred questions).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | New top-level `rk operator` command with `--workers <provider>` flag, in cmd/rk/operator.go + test, registered in root.go | User-approved design item 1, verbatim | S:95 R:85 A:95 D:95 |
| 2 | Certain | Hard precondition: fab on PATH (`exec.LookPath("fab")`), hard-refuse exit 1 naming fab-kit; NO degrade to a default launcher | USER EXPLICITLY DECIDED hard-refuse in the discussion — an operator without fab-kit is meaningless | S:95 R:80 A:95 D:95 |
| 3 | Certain | Hard precondition: inside tmux via `tmux.OriginalTMUX` non-empty, exit 1; no tmux subprocess before preconditions pass | Design item 2(a); exact riff/tutorial checkPreconditions pattern verified at tutorial.go:142 | S:95 R:85 A:95 D:95 |
| 4 | Certain | Server-wide singleton: `list-windows -a` on the current server; probe priority `@rk_win_role=operator` (tmux.RoleOption) first, exact window name `operator` (last tab-separated field) as fallback; on hit select-window + best-effort switch-client, `Switched to existing operator tab.`, exit 0 | Design item 3, verbatim, incl. the exact message and the fab operator.go switch-client precedent | S:95 R:80 A:90 D:90 |
| 5 | Certain | Typed kickoff `/fab-operator` via `inject.DeliverWhenReady` (engine `inject.NewEngine("rk-send-"+pid)`, shared CLI inject adapter, `tmux.PaneAgentState` reader); never positional; delivery failure degrades to a stderr paste-it-yourself note, exit 0 | Design item 7, verbatim; the provider-agnostic fix is the change's core motivation (PR #801→#806) | S:95 R:80 A:95 D:95 |
| 6 | Certain | `--workers` value validated against `^[A-Za-z0-9_-]+$` before entering the unescaped shell string; invalid = usage error exit 2; valid value prefixes `FAB_AGENT_WORKERS=<value>` on the agent command only; unset = byte-identical bare composition | Design item 6, verbatim; constitution §I security requirement | S:95 R:85 A:95 D:95 |
| 7 | Certain | Launcher via `riff.ResolveLauncher(ctx, root, "operator")`; on resolution failure the seam's silent `riff.DefaultLauncher` fallback is the accepted residual | Design item 5, verbatim — matches fab operator's degrade-to-builtin posture; rk never parses fab config (constitution §III) | S:90 R:75 A:90 D:85 |
| 8 | Certain | Stacking: branch + ship PR base = `260903-7ajq-typed-kickoff-fix` (PR #806), NOT main; merge #806 first | Design item 10; `inject.DeliverWhenReady` exists only on that branch (verified: current worktree branch is 260903-7ajq-typed-kickoff-fix) | S:95 R:70 A:90 D:90 |
| 9 | Certain | Non-goals: no fab-kit changes, no `fab operator` subcommand family, operator-actuation seam and `_rk-operator` convention untouched | Design item 11, verbatim | S:95 R:90 A:95 D:95 |
| 10 | Certain | Tests are seam-stubbed (no live tmux), green under `env -u TMUX -u TMUX_PANE go test ./cmd/rk/`, covering the design item 8 matrix | Design item 8, verbatim; cmd/rk ambient-tmux lesson (PR #793) | S:90 R:90 A:95 D:90 |
| 11 | Confident | The create-path stamp routes through the FULL rk role write-path sequence — `ClearWindowRoleExcept` radio clear, `tmux.RoleOption` option write, `MoveWindowIntoOperatorSession` promotion (role.go:134-156) — not a bare set-option | Design says "reuse rk role's write path/helper rather than duplicating the option write"; that path includes the radio clear and the physical promotion, and reusing it reproduces exactly the end state today's `rk role operator` self-mark produces | S:75 R:70 A:85 D:70 |
| 12 | Confident | Exit-code discipline: `riff.ExitCodeError` with `ExitPrecondition`=1, usage=2 (cobra/validation), `ExitSubprocess`=3 — the tutorial/riff wrapper pattern | Design fixes 1 (preconditions) and 2 (usage) explicitly; 3 for subprocess failures follows the established cmd/rk pattern (riff.go:65-69) | S:70 R:85 A:90 D:85 |
| 13 | Confident | cwd = `config.FindGitRoot(os.Getwd())`, falling back to `os.Getwd()` when it returns `""` | Design item 4 names both the fab precedent and `config.FindGitRoot`; verified the helper returns "" when no .git is found | S:80 R:85 A:90 D:85 |
| 14 | Confident | Create-path success message mirrors tutorial's form (e.g. `Opened operator tab (window "operator").`); design fixes only the switch-path message verbatim | Only the existing-window message was specified; mirroring tutorial.go:188 is the one obvious default, trivially reversible | S:55 R:90 A:85 D:75 |
| 15 | Confident | Delivery readiness deadline mirrors `tutorialDeliverDeadline` (25s var, test-shrinkable), context budget deadline+cmdTimeout | Not specified in the design; direct reuse of the pattern the design says to ride (tutorial.go:62, 213) | S:55 R:90 A:85 D:80 |
| 16 | Confident | Affected memory adds `run-kit/toolkit-standards` (modify) beyond the four listed in the design | Dispatch said to verify against docs/memory/run-kit/index.md; the domain map assigns new-surface help-dump/Principle 9 conformance to toolkit-standards.md, and design item 9 requires that check | S:65 R:90 A:85 D:80 |

16 assumptions (10 certain, 6 confident, 0 tentative, 0 unresolved).
