# Intake: Ephemeral Creation Verb + Adoption

**Change**: 260821-hbmh-ephemeral-creation-adoption
**Created**: 2026-08-21

## Origin

Backlog item `[f2b7]` root-cause direction (3b), phase 3 of the four-phase rollout agreed in a `/fab-discuss` session (2026-08-20/21). The user explicitly broadened `@rk_ephemeral` beyond agents: *"It doesn't have to be set just by agents but it can also be set by our test runners. I think it can be in use in a lot of different places. We do face a lot of cleanup problems of the test cases."*

**Depends on sibling `260821-zelc-ephemeral-option-snapshot-reap`** (the option constant, reader helper, and `rk mux reap --ephemeral` land there). This change branches off `zelc`'s branch and PRs against it (stacked). It can run in parallel with sibling `260821-l1qe-ephemeral-server-surfacing` (disjoint files, same base).

## Why

1. **Pain**: The convention only stops debris if the things that create scratch servers actually set the option. The observed leak source is precisely the creators with no marking path today: ad-hoc agent probes (`echotest`, `agyprobe`) have no sanctioned create verb at all, and test scaffolding relies purely on the `rk-test-*` name umbrella. Adoption is the real work of direction 3b — without it, debris merely slows rather than stops.
2. **Consequence if unfixed**: The `zelc` core ships but scratch servers keep being created unmarked; recovery debris and leaked-server cleanup problems continue; agents keep improvising server creation and cleanup with raw tmux (the four documented host-server-death vectors all started as improvised cleanup).
3. **Why this approach**: Make the marked path the easiest path — a one-liner create verb that marks atomically, the option set in every in-repo test-scaffolding creation site, and the convention documented in the agent-facing `rk skill` bundle so out-of-repo agents learn it.

## What Changes

### 1. `rk mux new <name> [--ephemeral]` — new CLI verb

The `rk mux` family (send/await/capture/kill/process/panes/reap/snapshot/init-conf/guard — see memory `run-kit/agent-messaging`) has **no create verb**; agents improvise with raw `tmux -L … new-session`. Add one:

- `rk mux new <name>`: create a detached tmux server on socket `<name>` (`new-session -d`), session name defaulting to `<name>`. Validate `<name>` via `internal/validate` before any subprocess (Constitution I). Reuse the existing server/session-creation helper in `internal/tmux` if one fits (check what the create-server API flow uses; do not duplicate — code-quality anti-pattern).
- `--ephemeral`: set `@rk_ephemeral 1` (constant from `zelc`) on the new server **before the command returns** — either chained in the same tmux invocation or as an immediate follow-up set; the point is no observable window in which a `--ephemeral` server exists unmarked longer than necessary (the snapshotter's retire-on-mark from `zelc` covers stragglers regardless).
- Grammar: `new` is an operator-style member (the socket name is its argument); follow the family's flag conventions in `cmd/rk/mux*.go` (see memory `run-kit/agent-messaging` for the `-L`-rejection split between pane-scoped and operator members).
- Output: print the server name; idempotence/collision: creating over an existing live socket should fail clearly, not attach (exact wording per existing mux error style).

### 2. In-repo setter sites (belt-and-braces alongside the `rk-test-*` umbrella)

Setting the option where test servers are born makes the semantic uniform and future-proofs against consumers that prefer the option over the name prefix:

- **`scripts/test-e2e.sh`**: after the primary server creation (`tmux -L "$E2E_TMUX_SERVER" new-session -d -s e2e-init -x 80 -y 24`, line 41), add `tmux -L "$E2E_TMUX_SERVER" set-option -s @rk_ephemeral 1`.
- **Go test scaffolding**: every Go test tmux server follows the unified `rk-test-<role>-<pid>-<ns>` naming via a centralized creation path (per the comment at internal/tmux/tmux.go:2150-2154) — locate that helper and set the option at creation.
- **Playwright e2e helpers**: specs spin up `rk-test-e2e-<role>-<pid>-<epoch>` secondaries (tmux.go:2266 comment; e.g. server-panel-grid, multi-server specs). Set the option in the shared helper that creates them.

These sites are already excluded by name everywhere that matters today — the option adds no behavior change for them; it standardizes the semantic. Keep this mechanical and small.

### 3. Documentation / adoption channel

- **`rk skill` bundle** (the agent-facing usage bundle served by `rk skill`; locate its source in this repo — governed by the shll `skill` standard, see memory `run-kit/toolkit-standards`): document the convention — *scratch tmux servers are created with `rk mux new <name> --ephemeral` and bulk-cleaned with `rk mux reap --ephemeral`; never bare `tmux kill-server`*. Cross-reference the tmux guard shim guidance.
- **`rk agent setup` guidance**: if the agent-setup flow installs or points at usage docs, thread the same two-liner there.
- README / help text: per the help-dump and readme-extraction standards, regenerate whatever those standards require for the new verb.

### 4. Toolkit standards

New CLI surface (`rk mux new`) ⇒ Constitution "Toolkit Standards": check `shll standards` (help-dump, readme-extraction, skill, Principle 9 — the new-surface check explicitly covers the growing `mux` family) before finalizing.

### 5. Tests

- `cmd/rk` / `internal/tmux`: verb creation + `--ephemeral` marking (assert the option reads back `1` via the `zelc` reader), name validation rejection, collision behavior. Test servers themselves use the `rk-test-*` umbrella so they're reap-safe.
- `scripts/test-e2e.sh` change is exercised by any `just test-e2e` run (no dedicated test needed).
- All via `just test-backend` / `just test-e2e`.

## Affected Memory

- `run-kit/agent-messaging`: (modify) `rk mux` family grows a `new` member; grammar/flag table
- `run-kit/tmux-sessions`: (modify) test-socket section — creation sites now also set `@rk_ephemeral`
- `run-kit/toolkit-standards`: (modify) new-surface check covers `mux new`

## Impact

`cmd/rk` (new verb), `internal/tmux` (creation helper reuse/extension), `scripts/test-e2e.sh`, the Go/Playwright test-scaffolding helpers, `rk skill` bundle source + standards-mandated docs. No API/frontend changes.

**Stacking**: branches off `260821-zelc`'s branch, PR base = `zelc`'s branch (retarget to `main` after `zelc` merges). Parallel with `260821-l1qe` (disjoint files). Independent of `260821-f2b7`.

## Open Questions

*(none — all decisions resolved in the discussion session)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | New verb lives under `rk mux` as `rk mux new <name> [--ephemeral]` | Discussed; `mux` owns the tmux substrate per the CLI-layering split; family has every verb except create | S:80 R:80 A:90 D:85 |
| 2 | Confident | Session name defaults to the server/socket name; detached create; collision with a live socket errors | Matches tmux defaults and the family's explicitness; watch the known session==window target-collision pitfall when naming | S:65 R:80 A:75 D:70 |
| 3 | Confident | In-repo test-scaffolding sites set the option even though `rk-test-*` names already exclude them | User explicitly wanted test runners covered; belt-and-braces standardizes the semantic at near-zero cost | S:80 R:85 A:80 D:75 |
| 4 | Confident | Adoption docs go in the `rk skill` bundle + agent-setup guidance (not CLAUDE.md or fab-kit) | The skill bundle is the established agent-facing channel, governed by the shll `skill` standard | S:70 R:85 A:75 D:70 |
| 5 | Tentative | `rk mux new` takes no extra shape flags (no `-x/-y`, no command argument) in this change — bare detached shell only | Keeps the verb minimal (Constitution IV spirit); riff/API flows own richer spawn shaping; extend later if a real need appears | S:55 R:85 A:65 D:45 |

5 assumptions (1 certain, 3 confident, 1 tentative, 0 unresolved).
