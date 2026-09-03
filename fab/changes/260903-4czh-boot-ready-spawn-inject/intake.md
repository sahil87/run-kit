# Intake: Boot-ready signal + spawn-and-inject composite

**Change**: 260903-4czh-boot-ready-spawn-inject
**Created**: 2026-09-03

## Origin

Conversational — direct follow-on from the `rk tutorial` kickoff failure (PR #801 → fix PR #806) and the primitives-organization review the user requested ("Starting agents in worktrees, starting worker agents in panes, sending them commands — are these not primitives already built into run-kit? What are the gaps?"). The review found: the verified-delivery primitive exists and is good (`internal/inject.Engine`, shared by chat, operator actuation, `rk mux send`), but **boot readiness is a missing primitive** — everyone who spawns an agent answers "when can I type?" independently (fab dispatch ready's screen classification, tutorial's hand-rolled settle poll, riff's claude-only positional-arg dodge), and **spawn-then-deliver exists nowhere as a composite**. The user approved executing items 1–2 of the recommendation:

> 1. Add boot-ready to the agent-state lifecycle — a session-start stamp from the existing hook registry, with capture-stabilization as the fallback for hook-less agents — exposed as `rk mux await --ready` and as an inject gate mode. This single primitive retires the tutorial settle poll, riff's positional-only constraint, and most of `fab dispatch ready`.
> 2. Build the composite substrate verb (internal spawn → await ready → inject), then migrate: tutorial's hand-rolled loop, riff task injection (fixes the latent non-claude bug), operator launcher.

The fab-kit operator launcher and `fab dispatch ready/deliver` delegation are **out of scope** (different repo — items 3 in the recommendation; a fab-kit follow-up consumes the new `rk mux await --ready` + `rk mux send` surface per cli-layering delegation rule 4).

**Stacking**: this change builds directly on PR #806 (`260903-7ajq-typed-kickoff-fix`, open draft) — it rewrites `deliverTutorialKickoff`, which exists only there. The branch is created off that fix branch; **merge order: #806 first**.

## Why

1. **Pain point**: three independent boot-readiness heuristics and (until #806's loop is migrated) a sixth delivery implementation exist because no primitive answers "is this freshly spawned agent ready for typed input?". The canonical delivery engine (`internal/inject.Engine`) gates on `@rk_pane_agent_state` — which a freshly spawned pane does not have until hooks fire — so spawners cannot use it and hand-roll instead.
2. **Consequence if unfixed**: the reinvention continues (this week produced implementations five and six), and riff's web-UI/CLI task injection stays **latently broken for every non-claude tier**: a task rides the launcher as a positional argument, and e.g. `kimi --auto '<task>'` exits with `unknown command` — exactly the bug that shipped in #801.
3. **Why this approach**: the agent-state lifecycle already has the right vehicle — the `rk agent setup` registry's existing `SessionStart` row (today it stamps `@rk_pane_chat` only). Stamping `idle` there makes "state present" the boot-ready signal for registry agents with **no schema change** (idle = "at rest", which a freshly booted agent is). Registry coverage is Claude-only in v1, so a **bounded capture-stabilization fallback** covers hook-less agents (kimi, codex, …). Centralizing readiness + delivery in `internal/inject` gives every spawner the same verified path and fixes the delivery-quality gap (the hand-rolled tutorial loop lacks bracketed paste, occurrence-counted echo probing, and per-pane locking).

## What Changes

### 1. Boot stamp: `SessionStart` also writes `idle` agent state (`cmd/rk/agent_hook*.go`, `cmd/rk/agent_setup.go`)

The claude registry row `{event: "SessionStart", state: agentHookStampToken}` (today: writes `@rk_pane_chat` only) gains a second action inside the `rk agent hook` binary: after the chat stamp, write `@rk_pane_agent_state idle:<epoch>[:<pid>]` under the existing Writer Rules (self-locate via `$TMUX_PANE`, never fail, comm-validated ancestor walk for the pid, omit pid segment when the walk fails). No settings-file churn: the hook line already installed for SessionStart delegates to the binary, so the new write reaches running fleets on `brew upgrade` (the spec's stated rationale for binary delegation).

Semantics check (spec `docs/specs/agent-state.md`): `idle` = "turn complete, at rest" — true of a freshly started/resumed session; `SessionStart` fires on startup/resume/rotation, and stamping `idle` there also **clears stale `waiting`/`active` values** from a previous agent in the same pane (a correctness improvement, not just a boot signal). No new state value, no schema change, no reader changes.

### 2. Readiness primitive: `inject.AwaitReady` (`internal/inject/ready.go`, new)

```go
// Readiness reports how a pane was judged ready.
type Readiness int // ReadyByState | ReadyBySettle

func AwaitReady(ctx context.Context, t Tmux, server, paneID string, opts ReadyOpts) (Readiness, error)
```

Polls two signals, first hit wins:

- **State-present** (preferred): `opts.State(ctx, paneID, server)` — an injected reader func (the callers wire `tmux.PaneAgentState`; inject must not grow a tmux/state dependency) returns a valid reconciled state (`idle`/`waiting`/`active` — presence means hooks fired, so the TUI is up).
- **Capture-stabilization** (fallback for hook-less agents): the pane text is non-blank and unchanged across two consecutive polls — lifted from #806's `deliverTutorialKickoff`, now living in ONE place. Documented caveat: a settled first-run dialog can false-fire; the subsequent injection's echo probe catches it (ProbeFailure → the caller degrades).

Pacing via `ReadyOpts` (deadline, poll interval — defaults 25s/600ms, the #806 values), each capture/state call bounded by the caller's per-call context discipline. On deadline: a typed error (`ErrNotReady`) carrying the last capture snippet.

**Composite**: `DeliverWhenReady(ctx, t, server, paneID, text string, submit bool, e *Engine, opts ReadyOpts) (Readiness, error)` = `AwaitReady` then `e.Send(...)`. This is the substrate verb spawners call.

### 3. CLI surface: `rk mux await --ready` (`cmd/rk/mux_await.go`)

New condition flag, mutually exclusive with `--until`/`--file`/`--after-active`: wait until the target pane is boot-ready per §2 (state-present OR settle), report which (`ready %5 (state)` / `ready %5 (settled)`), honor the existing `--timeout`/`--notify` machinery. This is the surface fab-kit's dispatch will delegate to (cli-layering rule 4) — composition for external callers: `rk mux await --ready %5 && rk mux send --force %5 '<prompt>'` (plain `send` stays gated on state, which a hook-less agent never has; `--force` is the documented pairing — a Design Decision, not a new send mode).

### 4. Migrate `rk tutorial` (`cmd/rk/tutorial.go`, `tutorial_test.go`)

`deliverTutorialKickoff`'s hand-rolled loop (settle poll + raw `send-keys -l` + naive echo check + Enter retry) is **deleted**; the launch path calls `inject.DeliverWhenReady` with a per-invocation engine (`rk-send-<pid>` buffer, the `rk mux send` pattern) and the `cliInjectTmux`-style adapter, state reader = `tmux.PaneAgentState`. Behavior contract unchanged: bare launcher, kickoff typed and verified, degrade to the stderr paste-note with exit 0 on any delivery failure. `paneEchoesKickoff`/`stripToAlnum` and the settle logic leave tutorial.go (superseded by the engine's Needle/occurrence probing and §2's settle). Tests move to scripted seams over the inject path (or engine-level fakes), still passing under `env -u TMUX -u TMUX_PANE`.

### 5. Migrate riff task injection (`internal/riff/*.go`, `api/riff.go` untouched if possible)

Today a non-empty task always rides `buildSkillShellString` as the launcher's positional argument — claude-only. New rule at the composition seam:

- `launcherCommandName(launcher) == "claude"` → **unchanged**: positional argument (instant, race-free, zero regression for the dominant path).
- Any other launcher + non-empty task → the skill pane composes **bare**, and after the window spawns, the task is delivered via `inject.DeliverWhenReady` targeting the captured pane-0 id (`spawnRiffReturningName` already captures it internally; it needs returning/plumbing).
  - **CLI path** (`riff.Run`, incl. fan-out): delivery runs synchronously per window inside the existing per-window flow/goroutines; a delivery failure prints a stderr warning naming the window and the task text (the tutorial degrade pattern) and does NOT fail the spawn (window + agent exist).
  - **Daemon path** (`riff.Spawn`, POST /api/riff and the fork route): the HTTP response must not block ~25s on boot — delivery runs in a **background goroutine** (best-effort; failure logged server-side). Response shape unchanged. The fork path (`ResumeSessionRef`) is claude-gated already and keeps the positional/flags path untouched.

This closes the latent non-claude task bug recorded in project memory (`positional-prompt-claude-only`) at its root. The `--skill '/name'` bare-skill panes and `--cmd` panes are untouched (no prompt to deliver).

### 6. Docs and hygiene

- `fab/project/code-quality.md` anti-pattern list: add `internal/inject` to the check-first utilities line (the discoverability fix — three agents missed the engine this week).
- Memory (hydrate): `run-kit/agent-state.md` (SessionStart dual write, boot-ready semantics), `run-kit/rk-riff.md` (claude-gated positional + typed fallback; retire the "never send-keys" framing), `run-kit/architecture.md` (tutorial row now engine-backed; `rk mux await --ready`), `run-kit/agent-messaging.md` (await `--ready` condition).
- Spec touch: `docs/specs/agent-state.md` — a short "Boot-ready" subsection documenting the SessionStart idle stamp and the readiness definition (state-present, settle fallback). `docs/specs/cli-layering.md` § fab pane table: no edit needed (already names rk canonical twins) — verify only.

## Affected Memory

- `run-kit/agent-state`: (modify) SessionStart stamps idle (boot signal + stale-state clear); readiness definition.
- `run-kit/agent-messaging`: (modify) `rk mux await --ready` condition, report words, the `await --ready && send --force` composition for hook-less agents.
- `run-kit/rk-riff`: (modify) task injection is claude-gated positional with typed-delivery fallback for other launchers; pane-0 id plumbing.
- `run-kit/architecture`: (modify) tutorial row → engine-backed delivery; inject gains AwaitReady/DeliverWhenReady.

## Impact

- `app/backend/cmd/rk/`: `agent_hook*.go`, `agent_setup.go` (registry row), `mux_await.go` (+tests), `tutorial.go` (+tests, net deletion).
- `app/backend/internal/inject/`: `ready.go` + tests (new); no changes to `Engine.Send`.
- `app/backend/internal/riff/`: composition seam, pane-id plumbing, CLI/daemon delivery paths (+tests).
- `fab/project/code-quality.md`, `docs/specs/agent-state.md`.
- No frontend, no HTTP API shape changes, no new tmux options, no new states in the agent-state schema.
- **Base branch**: `260903-7ajq-typed-kickoff-fix` (PR #806) — merge #806 first.

## Open Questions

- None. The design was settled in the conversation; residual choices are graded below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Boot-ready = "reconciled agent state present" for registry agents; stamped by the existing SessionStart hook row writing `idle` (no new state value, no schema change) | Discussed and user-approved; `idle` semantics ("at rest") fit a fresh session; binary delegation means zero settings churn | S:85 R:80 A:90 D:85 |
| 2 | Certain | Capture-stabilization is the fallback for hook-less agents (registry is Claude-only v1; the fast tier's kimi has no hooks) | Verified in `agentRegistry` (v1: Claude Code only); without a fallback, `--ready` would dead-wait on kimi — the tier the tutorial defaults to | S:80 R:80 A:90 D:85 |
| 3 | Certain | Readiness + composite live in `internal/inject` with the state reader injected as a func | Keeps inject dependency-free of the state layer; inject is already the canonical delivery home shared by chat/actuation/mux-send | S:75 R:85 A:90 D:85 |
| 4 | Confident | riff keeps positional injection for claude launchers; typed delivery only for non-claude + task | Zero regression on the dominant instant-submit path; `launcherCommandName` gating has the `resumeForkLauncher` precedent | S:70 R:80 A:85 D:75 |
| 5 | Confident | Daemon-path riff delivery is a background goroutine (response unchanged, failure logged); CLI-path delivery is synchronous with a stderr degrade note | An HTTP response blocking ~25s on agent boot is unacceptable; fire-and-forget matches the "window exists either way" degrade posture | S:60 R:75 A:80 D:70 |
| 6 | Confident | `rk mux send` gains no new gate mode; hook-less composition is documented as `await --ready && send --force` | Minimal CLI surface; `--force` already exists with exactly this meaning; Go callers use the composite directly | S:55 R:85 A:80 D:70 |
| 7 | Confident | `await --ready` reports which signal fired (`(state)` / `(settled)`) and is mutually exclusive with `--until`/`--file`/`--after-active` | Report words are the await family's existing contract shape; mixing conditions has no coherent semantics | S:55 R:85 A:80 D:75 |
| 8 | Confident | Branch stacks on PR #806's branch; merge order #806 → this | This change deletes code that exists only in #806; rebasing onto main would re-conflict | S:70 R:70 A:90 D:80 |

8 assumptions (3 certain, 5 confident, 0 tentative, 0 unresolved).
