# Intake: rk mux await --any — multi-target any-of wait mode

**Change**: 260823-tqkt-mux-await-any-multi-target
**Created**: 2026-08-23

## Origin

One-shot `/fab-new` from backlog entry `[tqkt]` (2026-08-23), which carries the C1 spec from fab-kit's `fab/plans/sahil/26-08-23-operator-offload-plan.md` (read from worktree `~/code/sahil87/fab-kit.worktrees/buffed-penguin/`, § Phase C · C1 "Event wake").

> Extend rk mux await to a multi-target any-of wait mode: `rk mux await --any <pane>...`. Purpose: let the fab operator block until ANY of several monitored panes' `@rk_agent_state` fires, instead of busy-polling every tick. The backlog entry's MUST list, verbatim: (a) exclusion set / arm only against not-currently-waiting panes — a left-open Strategic prompt legitimately sits 'waiting' for up to 30 minutes; a level-triggered re-arm against an already-waiting pane would busy-loop; (b) poll-after-arm sweep: one immediate state check right after arming, to close the edge-trigger gap where a target's state already changed between the caller's last known state and the arm call; (c) the caller (fab operator) re-arms the background await after /clear, since resumed sessions lose background children; (d) kill+re-arm the await whenever the target pane set changes (enroll/remove); (e) min-inter-wake debounce against waiting↔active flap. Design consistently with the EXISTING single-target `rk mux await`'s semantics and flags (--until, --file, --after-active, --timeout, --notify) — --any composes with them, not replaces them. Update `app/backend/cmd/rk/skill/mux.md`. run-kit CLI/backend change only — fab-kit's own operator_note.go/tick-start/pane-questions work is out of scope.

Key upstream context (C1, read in full): the operator's event-wake design accepts one trade — with a blocking any-of await as the primary wake, the operator's fallback heartbeat relaxes to ~10m, so pane-death detection latency for panes *outside* the armed set worsens from ≤3m to ~10m. Panes *inside* the armed set get immediate death detection via the observer's existing `gone` path.

## Why

1. **Pain point**: the fab operator currently busy-polls — every tick it re-runs a full pane map and per-pane captures to notice that any of N monitored panes flipped state. `rk mux await` can already block on ONE pane's `@rk_agent_state`, but an operator watches a fleet; N parallel single-target awaits are unmanageable as background children (and resumed sessions lose them all, so N re-arms per `/clear`).
2. **Consequence of not fixing**: the operator's queue stays occupied by mechanical polling; tick cadence (and therefore answer latency for waiting agents) is bounded by poll frequency rather than by events. This blocks the fab-kit operator-offload plan's event-wake phase (C1), which the rest of that plan (already reviewed by four agents) assumes.
3. **Why this approach**: extending the existing observer is the minimal, consistent move — `await` already has the exact semantics wanted (state-set wake via `--until`, OR-composed `--file`, observer-bounding `--timeout`, `--after-active` race fix, `--notify` push, first-check-before-sleep). `--any` generalizes the target from one pane to a set; everything else composes. A new verb or a daemon-side subscription would duplicate the contract and violate the no-daemon-dependency property of the `rk mux` family (the verbs talk to tmux directly and work while `rk serve` is down).

## What Changes

### CLI surface — `--any` mode flag

`rk mux await` gains a bool flag `--any` that switches the positional target from exactly-one to one-or-more:

```sh
rk mux await --any %1 %5 %9 --until waiting,idle --timeout 600
rk mux await --any %1 @3 =work:editor --until idle   # full target grammar per pane
rk mux await --any %1 %5 --file /tmp/result.json     # OR-composed, unchanged
```

- Without `--any`: `ExactArgs(1)`, behavior byte-identical to today (single-word report, all existing tests hold).
- With `--any`: at least one target (`MinimumNArgs(1)`; a single target is allowed and uses the multi-target report format). Each target uses the existing grammar (`%N`, `@N`, `=session:window`; bare `session:window` rejected) and is resolved to a pane ID up front via `resolvePaneTarget`, before the wait begins. All targets live on ONE server (the inherited `-L` flag, default `$TMUX`).
- Two targets resolving to the same pane ID are a usage error (exit 2), matching `--until`'s duplicate rejection — say what you mean.

### Observer semantics — any-of sweep

`awaitObserve` (or a sibling `awaitObserveAny` sharing its helpers/seams) generalizes the loop; per tick, in order:

1. **File signal first** — unchanged, a single global `--file` path; fires as report `file` (a fired signal wins over a same-tick pane death).
2. **State sweep** — read each target pane's reconciled `@rk_agent_state` in listed order. The first pane whose state is in `--until` (subject to `--after-active`, below) wins: report `<state> %N`, exit 0.
3. **Gone** — the first target that died mid-wait wins the tick if no signal fired: report `gone %N`, exit 1 (same exit contract as single-target). The caller then re-arms with the dead pane removed per MUST (d); panes in the armed set therefore get *immediate* death detection, better than the ~10m heartbeat C1 accepted.
4. **Timeout** — unchanged: one whole-invocation observer bound (`--timeout`, default 300s, 0 = indefinite); expiry reports `running`, exit 0.
5. Sleep `awaitPollTick` (~2s), repeat. The first sweep runs BEFORE any sleep — this existing property IS the MUST (b) poll-after-arm guarantee (see mapping below).

Per-pane details:

- **`--after-active` is tracked per pane**: each target must individually be observed `active` before ITS `--until` state counts. One pane's activity never unlocks another's.
- **Unobservable fail-fast**: on the first sweep, any target with no `@rk_agent_state` when no `--file` was given errors immediately (exit 1), naming the offending pane — the multi-target extension of today's "nothing observable to wait on" rule. A silently-never-firing member is worse than a refused arm.
- **Read errors** (non-gone substrate failures) propagate as operational errors, unchanged.

### Report format under `--any`

stdout stays ONE line; the first token stays the report word (so first-token parsers keep working), and the firing pane is appended when one exists:

| Wake | Report | Exit |
|------|--------|------|
| state reached on a pane | `waiting %5` / `idle %2` / `active %9` | 0 |
| `--file` appeared | `file` | 0 |
| `--timeout` expired | `running` | 0 |
| a target died (no same-tick signal) | `gone %5` | 1 |

Single-target (no `--any`) output is unchanged (bare report word). `--notify` composes: fires on every wake as today, default message `agent %N is <state>` when a pane fired, and the existing target-less phrasing for `file`/`running`.

### MUST list (a)–(e) — where each lands

The backlog's five MUSTs are requirements on the *whole mechanism* (rk + fab operator). This change owns the rk half and the documentation of the caller protocol; (c)/(d) are explicitly caller-side in the backlog text, and the fab-kit skill changes are out of scope here.

| MUST | Home | This change delivers |
|------|------|----------------------|
| (a) exclusion set — arm only against not-currently-waiting panes | **caller protocol** (the operator picks the target list) | rk does NOT filter already-waiting targets at arm — an already-fired `--until` state returns immediately by design (that immediacy is what (b) relies on). Skill docs state the caller obligation explicitly. |
| (b) poll-after-arm sweep | **rk guarantee** | Already structural: the first sweep runs before any sleep, so a state that changed between the caller's last read and the arm fires immediately. Documented as a named guarantee in the skill docs; regression-tested for the multi-target path. |
| (c) re-arm after `/clear` | **caller protocol** | Documented in skill docs (one line: awaits are foreground children of the caller; resumed sessions must re-arm). |
| (d) kill + re-arm on target-set change | **caller protocol** | Documented in skill docs; the `gone %N` wake plus duplicate-target rejection make stale sets self-announcing. |
| (e) min-inter-wake debounce vs waiting↔active flap | **caller protocol** | No rk-side `--settle`/`--debounce` flag in v1 — a single invocation wakes once, so inter-wake spacing is inherently the re-armer's property. Skill docs direct the caller to wait a minimum interval before re-arming. |

### Skill docs — `app/backend/cmd/rk/skill/mux.md`

The `rk mux await` section gains:

- `--any` usage examples and the multi-target report table above;
- a short **fleet-wake protocol** note carrying the caller obligations: exclude already-waiting panes at arm (a), first-check-before-sleep closes the arm gap (b), re-arm after resume/`/clear` (c), kill+re-arm on set changes (d), debounce re-arms against flap (e);
- Gotchas additions: `gone %N` names the dead pane and exits 1 under `--any`; an uninstrumented member fails the whole arm; all targets share one `-L` server.

### Tests — `mux_await_test.go`

Extend the existing seam-driven suite (the `awaitDeps` fake pattern; the scripted fake grows a per-pane state script):

- any-of wake on second pane while first stays active; report `<state> %N`;
- already-fired member returns before any sleep (the (b) guarantee, multi-target);
- per-pane `--after-active` isolation;
- `gone %N` exit 1 on member death; same-tick file signal still wins;
- unobservable member fails fast naming the pane;
- duplicate resolved targets exit 2; bad grammar per member exit 2;
- `--timeout` → `running`; `--notify` default message carries the firing pane;
- single-target path unchanged (existing tests untouched, plus an explicit no-`--any` output-format guard).

### Non-goals

- No changes to `rk mux send --await` (stays single-target; its grace-watch composition is untouched).
- No daemon/SSE-based subscription; the observer stays a direct-tmux poll loop (no-daemon-dependency property of the mux family).
- No rk-side debounce/exclusion flags (caller protocol, above).
- No fab-kit changes (operator skill §2/§4 wiring, `operator_note.go`, tick-start, pane-questions — separate fab-kit changes per the C1 spec).

## Affected Memory

- `run-kit/agent-messaging`: (modify) the `rk mux await` observer requirement gains the `--any` mode — multi-target grammar, sweep order, `<state> %N` report shape, gone/unobservable multi-target rules, and the (a)–(e) rk-vs-caller split as a design decision.

## Impact

- `app/backend/cmd/rk/mux_await.go` — flag, args validation, multi-target resolution, observer generalization (`awaitParams` gains the pane set or a sibling loop; `awaitDeps` seams unchanged in shape).
- `app/backend/cmd/rk/mux_await_test.go` — new multi-target cases per the test list; existing cases unchanged.
- `app/backend/cmd/rk/skill/mux.md` — await section + Gotchas.
- Per-pane state reads reuse `muxReadPaneState`/`tmux.PaneAgentState` (N bounded 5s reads per ~2s tick; fleet sizes are ~10, fine). A batched `list-panes` enumeration is a plan-stage optimization option, not a requirement.
- CLI surface change ⇒ constitution Toolkit Standards check (help-dump et al. via `shll standards`) applies at review.
- Consumer: fab-kit's operator skill (separate repo/changes) will build its event-wake loop on this contract.

## Open Questions

None — the backlog entry plus the C1 spec section resolve intent, semantics, and scope; remaining choices are graded below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `--any` is a bool mode flag; targets stay positional (`rk mux await --any %1 %5`), `ExactArgs(1)` without it | Backlog names the surface verbatim (`--any <pane>...`); cobra-idiomatic | S:85 R:80 A:85 D:85 |
| 2 | Confident | Multi-target report keeps the report word as the FIRST token and appends the firing pane (`waiting %5`; `file`/`running` bare; `gone %5`) | Caller needs pane identity; first-token compatibility preserves the one-word parse habit; only the new mode changes shape | S:55 R:80 A:75 D:65 |
| 3 | Confident | MUST (a) exclusion is caller protocol — rk does not filter already-waiting targets at arm | Backlog phrases (a) as an arming discipline; (c)/(d) are explicitly caller-side; rk-side at-arm baselining would reopen the (b) edge-trigger gap it exists to close | S:75 R:65 A:75 D:70 |
| 4 | Confident | MUST (b) is satisfied by the existing first-check-before-sleep semantics, documented as a named guarantee — no new flag | The single-target observer already checks before any sleep; the spec's "poll-after-arm sweep" is exactly that check applied to the set | S:70 R:75 A:80 D:75 |
| 5 | Confident | MUST (e) debounce is caller-side; no `--settle`/`--debounce` flag in v1 | One invocation wakes once, so inter-wake spacing is a property of the re-armer; an rk-side arm-delay would suppress legitimate wakes | S:55 R:70 A:60 D:55 |
| 6 | Confident | First dead target wakes the whole await (`gone %N`, exit 1); no drop-and-continue | Consistent with single-target `gone`; pane death is wake-worthy for the operator (beats the ~10m heartbeat C1 accepted); caller re-arms minus the dead pane per (d) | S:55 R:75 A:70 D:60 |
| 7 | Confident | Any uninstrumented target with no `--file` fails the whole arm on the first sweep, naming the pane | Extends today's fail-fast rule; a silently-never-firing member is an unobservable hole in the fleet wake | S:60 R:80 A:80 D:70 |
| 8 | Confident | `--after-active` is tracked per pane (each target individually needs an `active` sighting) | The race the flag fixes is per-pane; cross-pane unlock would readmit the stale-state race per member | S:55 R:80 A:80 D:75 |
| 9 | Certain | `--file`, `--timeout`, `--notify` compose unchanged as invocation-global signals/bounds | Spec mandates composition with existing flags; all three are already target-independent (file path, observer bound, push-on-wake) | S:70 R:90 A:90 D:85 |
| 10 | Confident | Per-tick state reads reuse `muxReadPaneState` per pane (N bounded reads); batched enumeration deferred as a plan-stage option | Reuses the reconciled read + gone mapping and the test seams; N≈10 at 2s cadence is cheap; internal detail, freely changeable | S:45 R:90 A:70 D:55 |
| 11 | Certain | Duplicate targets (post-resolution, same pane ID) are a usage error (exit 2) | Matches `--until`'s duplicate rejection and the family's say-what-you-mean posture | S:50 R:90 A:85 D:80 |

11 assumptions (3 certain, 8 confident, 0 tentative, 0 unresolved).
