# Intake: Generic Agent-State Tier

**Change**: 260705-dmex-generic-agent-state-tier
**Created**: 2026-07-06

## Origin

> Generic agent-state tier: rk agent-setup installs global agent-harness hooks that write the @rk_agent_state tmux pane-option convention (active|waiting|idle:epoch); run-kit reads it natively via paneFormat and derives PR links from pane branch instead of consuming fab's agent_state/pr_url — per the two-tier ownership split decided in the 2026-07-05/06 discussion (constitution Principle X)

Conversational mode — this intake is the outcome of a two-day `/fab-discuss` session (2026-07-05/06) that:

1. Researched how ten competing tools detect agent busy/waiting/idle state (Claude Squad, Webmux, guppi, Agent of Empires, amux, agentdock, Codeman, Happy, Omnara, Vibe Kanban), reading their actual sources.
2. Audited the current mechanism: run-kit joins `agent_state` (active|idle) from `fab pane map --json`, which reads `.fab-runtime.yaml` `_agents` entries written by Claude-only, project-coupled `fab hook stop|user-prompt|session-start` hooks.
3. Decided a two-tier ownership split: tier 1 = fab pipeline state (change/stage — stays fab's); tier 2 = generic agent lifecycle state for ANY agent, written to tmux pane user options by harness hooks, owned by run-kit.
4. Amended the constitution with **Principle X — Hooks Carry Only the Underivable** (v1.4.0): hooks push only ephemeral in-flight state (lifecycle, pending question); everything derivable (PR links, branches, worktrees) is derived server-side.
5. Filed the fab-kit counterpart as fab-kit backlog `[ioku]` + `fab/plans/sahil/agent-state-divestment.md` (fab deletes its `_agents` production pipeline and becomes a convention *reader*). This run-kit change is the **writer + native-reader** side and must land conceptually first — fab's readers need the convention to exist.

## Why

1. **The most notification-worthy state is invisible today.** The current model is two-state: `active` ("UserPromptSubmit fired, no Stop since") or `idle` (Stop fired). An agent blocked mid-turn on a permission prompt or `AskUserQuestion` menu has NOT fired Stop, so it reports `active` — indistinguishable from genuinely working. tmux output-recency (Layer 0, `#{window_activity}` 10s threshold) also reads "active" because Claude keeps rendering its spinner below the prompt. Both layers misreport exactly the state where a human is the blocker. Competitive research showed every serious tool models this as a **three-state** problem (`active` / `waiting` / `idle`), with `waiting` sourced from the harness's Notification/PermissionRequest hook events.
2. **Non-Claude agents show nothing.** The `_agents` pipeline is Claude-only (fab hooks are registered in Claude settings) and project-coupled (`fab hook` dies outside a fab root — `resolve.FabRoot()` walks up for `fab/`). A codex/copilot/gemini agent, or Claude in a non-fab repo, shows `—` forever. run-kit is "agent-agnostic by construction" — its agent-state layer should be too.
3. **Ownership inversion.** run-kit must show agent status fully with or without fab-kit; fab-kit must function fully with or without tmux. Agent lifecycle state is tmux-context interface data — run-kit's domain, not the AI-lifecycle manager's. Today run-kit shells a `fab pane map` subprocess (5s TTL cache) to learn something tmux itself can carry per-pane.
4. **PR links are derivable, not pushable** (Principle X). run-kit currently consumes `pr_url`/`pr_number` from the pane-map join (fab's `.status.yaml` `prs:` list) — so PR visibility exists only for fab-change-bound panes. Deriving branch→PR server-side covers any pane with a branch, in any repo, under any workflow.

If we don't do this: the phone-first "which of my N agents needs me" story stays broken for the highest-urgency state, stays Claude-only, and the fab-kit divestment (backlog [ioku]) stays blocked on a convention that doesn't exist.

## What Changes

### 1. Convention spec — `docs/specs/agent-state.md` (new)

The cross-repo contract (fab-kit's readers will reference it). Contents:

- **Option**: `@rk_agent_state`, a tmux **pane user option** (`set-option -p`), value `"<state>:<epoch_seconds>"`, `state ∈ active | waiting | idle`. Example: `waiting:1751790000`.
- **State semantics**: `active` = turn in progress; `waiting` = blocked on a human (permission prompt, elicitation/question dialog); `idle` = turn complete, at rest.
- **Writer rules**: hook commands self-locate via `$TMUX_PANE`; no-op outside tmux (`[ -n "$TMUX_PANE" ] || exit 0`); never fail the agent (`|| true` / exit 0 on every path); write via plain `tmux set-option -pt "$TMUX_PANE"` — no rk binary or server dependency at hook-fire time.
- **Reader rules**: option absent → unknown (render `—`); epoch suffix is mandatory — readers compute idle/waiting duration from it and MAY apply staleness heuristics; a pane whose `#{pane_current_command}` is a plain shell (`bash|zsh|fish|sh|dash`) is treated as having no agent regardless of a leftover option value (the guppi reconciler lesson — an Esc-interrupted or killed agent can strand a stale `active`).
- **Lifecycle**: pane options die with the pane — no GC, no state file, no cross-pane ambiguity (an option lives on exactly one pane of exactly one server).
- **Per-agent event mapping registry** (which harness events map to which state — see §2).

### 2. `rk agent-setup` — new CLI subcommand (explicit opt-in installer)

Modeled on guppi's `agent-setup` (explicit command) rather than agentdock's silent sync — the user chose "explicit feels honest". Behavior:

- Registers hook commands in **user-global** agent config so any session of that agent, in any directory, under any workflow, reports state. v1 target: **Claude Code** (`~/.claude/settings.json`, JSON-merge preserving existing hooks). The installer is structured as a per-agent registry (name → config path + format + event mapping) so codex/copilot/gemini/opencode are additive follow-ups.
- Claude Code event mapping (all matchers per the competitive research + Claude docs):
  | Event | Matcher | Writes |
  |---|---|---|
  | `UserPromptSubmit` | — | `active:<now>` |
  | `PreToolUse` | — | `active:<now>` (heartbeat refresh; also covers subagent tool churn) |
  | `Notification` | `permission_prompt\|elicitation_dialog\|agent_needs_input` | `waiting:<now>` |
  | `Notification` | `idle_prompt` | `idle:<now>` (backstop — Stop does not fire on every turn-end path, e.g. Esc-interrupt) |
  | `Stop` | — | `idle:<now>` |
- Hook command is a self-contained one-liner (no rk dependency): `sh -c '[ -n "$TMUX_PANE" ] || exit 0; tmux set-option -pt "$TMUX_PANE" @rk_agent_state "<state>:$(date +%s)" 2>/dev/null || true'`.
- Idempotent: re-running updates rk-owned entries in place, never duplicates, never touches non-rk hooks. Shows the settings diff and asks for confirmation before writing (it mutates user-global config). Provide `rk agent-setup --uninstall` to remove exactly the rk-owned entries.
- Constitution §I applies to the installer itself (file writes via Go, no shell string construction with user input); the hook command string is a fixed literal per state — nothing user-provided is interpolated.

### 3. Backend native read — `internal/tmux` + `internal/sessions`

- Add `#{@rk_agent_state}` to `paneFormat` in `internal/tmux/tmux.go` (the `list-panes` format string) — zero additional subprocesses; parsed in `parsePanes`.
- New `PaneInfo` fields: `AgentState string` (`active|waiting|idle`, empty = unknown) and `AgentStateEpoch int64` (0 = unknown), with the shell-command reconciler applied at parse/enrichment time (pane command is a shell → both zeroed).
- `WindowInfo.AgentState` / `AgentIdleDuration` keep their JSON field names (`agentState`, `agentIdleDuration`) but change source: window-level rollup over the window's panes with precedence `waiting > active > idle` (a split window with one waiting pane is a waiting window). `AgentIdleDuration` is computed rk-side from the epoch (same `2m`/`1h` style as today's fab-formatted string) for `idle` **and** `waiting` states.
- `agentState` gains the `waiting` value — frontend `types.ts` comment updated; existing consumers (sidebar duration text at `window-row.tsx:393`, pane-panel caption at `status-panel.tsx:68`) continue to work unchanged and display `waiting <dur>` via the same code path. **No new UI surfaces** (Non-Goal).

### 4. PR-from-branch derivation — `internal/prstatus`

- Extend the existing collector: for every pane with a resolved `GitBranch` (the `resolveGitBranches` enrichment already computes this), resolve branch → open PR via `gh pr list --head <branch> --json number,url,state,isDraft,...` in the pane's repo context, using the collector's existing polling/caching discipline (results cached per (repo, branch); same refresh cadence and `gh`-absent graceful degradation as today).
- `PrURL`/`PrNumber` on `WindowInfo` are now populated from this derivation instead of the pane-map join. The downstream PR-status join (state/checks/review) keys off the derived PR exactly as it keys off fab's today. Net behavior change: PR status appears for **any** pane on a branch with an open PR, not only fab-change-bound windows.
- Edge rules: multiple open PRs for one branch → most recently updated; no open PR → fields absent (same as today's no-PR case).

### 5. Pane-map join slimming — `internal/sessions/sessions.go`

- `paneMapEntry` drops `agent_state`, `agent_idle_duration`, `pr_url`, `pr_number` — the join consumes only `change`, `stage`, `display_state` (the fab tier proper).
- `dedupEntries` priority simplifies to `Change > first-seen` (the AgentState arm is dead).
- Clean swap, no dual-source fallback: until `rk agent-setup` has been run on a machine, agent columns read unknown (`—`). Accepted — single-operator deployment; rollout is "deploy rk, run `rk agent-setup` once per machine".

## Affected Memory

- `run-kit/agent-state`: (new) The convention (option name, value schema, states, writer/reader rules, reconciler), the `rk agent-setup` registry, and the two-tier ownership model
- `run-kit/architecture`: (modify) paneFormat/PaneInfo/WindowInfo sourcing, prstatus branch→PR derivation, pane-map join slimming
- `run-kit/tmux-sessions`: (modify) `@rk_agent_state` row in the user-options table (pane scope — a new scope class alongside window/server/session options)
- `run-kit/ui-patterns`: (modify) status-panel/window-row three-state note (`waiting` value flows through existing text surfaces; StatusDot explicitly unchanged)

## Impact

- **Backend**: `internal/tmux/tmux.go` (paneFormat, parsePanes, PaneInfo/WindowInfo), `internal/sessions/sessions.go` (join slimming, rollup, reconciler), `internal/prstatus/` (branch→PR), new `cmd/rk/agent_setup.go` (+ registry). All subprocess calls via `exec.CommandContext` with timeouts (§I).
- **Frontend**: `src/types.ts` (`waiting` value documented); no component changes required — existing `agentState` consumers work as-is.
- **Docs**: new `docs/specs/agent-state.md` + specs index row.
- **Cross-repo**: unblocks fab-kit backlog `[ioku]` (fab pane send/map become convention readers). fab-kit continues writing `.fab-runtime.yaml` until its own change lands — harmless coexistence (different sinks; run-kit simply stops reading the old one).
- **Tests**: Go tests for parsePanes new field, rollup precedence, reconciler, epoch→duration formatting, agent-setup settings merge/idempotency/uninstall, prstatus branch resolution (gh mocked). No e2e required (no UI change); `just test-backend` + `npx tsc --noEmit` gates.

## Open Questions

*(none — the two-day discussion resolved the design; residual choices are graded below)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Explicit `rk agent-setup` opt-in command (not silent sync); name as stated | Discussed — user: "the model of explicit agent-setup feels honest"; name used consistently throughout | S:90 R:85 A:90 D:90 |
| 2 | Certain | Three states (active / waiting / idle) written to `@rk_agent_state` pane user option | Discussed and confirmed repeatedly; user's own invocation text specifies the three states with `:epoch` | S:90 R:80 A:90 D:85 |
| 3 | Confident | Value schema `"<state>:<epoch_seconds>"` — single option, colon-separated, epoch mandatory | Draft schema quoted in user's invocation; single-option form is the simplest thing that carries staleness; fab-kit doc marks it "coordinate before implementing" — this change IS the coordination point | S:75 R:70 A:80 D:70 |
| 4 | Confident | v1 scope: state option only — no `@rk_agent_kind`, no pending-question-text option | Open item from discussion never escalated; additive later (hooks and readers extend independently); UI that would consume them is deferred anyway | S:45 R:85 A:65 D:60 |
| 5 | Confident | v1 installer targets Claude Code only, with a per-agent registry structure for codex/copilot/gemini/opencode follow-ups | Claude is the operator's fleet today; other agents are additive rows in the registry (AoE precedent); avoids speculative config-format work | S:55 R:85 A:70 D:65 |
| 6 | Confident | Single change bundling agent-state tier + PR-from-branch derivation | User's invocation bundles both; both are "rk derives its own signals instead of consuming fab pane map"; plan phases keep them separable if needed | S:65 R:60 A:65 D:60 |
| 7 | Confident | Clean source swap — no dual-source fallback to pane-map agent_state during migration | Single-operator deployment; fallback code contradicts minimal-surface §IV and would linger; rollout = run agent-setup once | S:50 R:70 A:70 D:60 |
| 8 | Confident | Shell-command reconciler: pane whose current command is a shell reads as no-agent regardless of leftover option | guppi's proven auto-clear lesson; rk already reads `#{pane_current_command}`; prevents the stuck-`active` Esc-interrupt failure mode surfaced in research (AoE #1913) | S:60 R:80 A:80 D:75 |
| 9 | Confident | Window-level `agentState` = rollup over panes with `waiting > active > idle` precedence; per-pane fields added alongside | Existing UI is window-keyed; waiting is the attention state so it must win the rollup; per-pane truth preserved for future board/pane surfaces | S:55 R:75 A:75 D:70 |
| 10 | Confident | Branch→PR via `gh pr list --head` inside the existing prstatus collector cadence; most-recently-updated PR wins on multi-PR branches | Collector, caching, and gh-degradation patterns already exist; multi-PR-per-branch is rare and any deterministic rule is acceptable | S:60 R:75 A:80 D:70 |
| 11 | Certain | UI surfacing redesign (StatusDot integration, push rules, attention rollups) is OUT of scope | User: "how we show it ... is a discussion we still need to have (later)"; this change only keeps existing surfaces working with the richer value | S:85 R:90 A:85 D:85 |

11 assumptions (3 certain, 8 confident, 0 tentative, 0 unresolved).
