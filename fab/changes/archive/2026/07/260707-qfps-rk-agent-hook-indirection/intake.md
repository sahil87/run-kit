# Intake: rk agent-hook Indirection

**Change**: 260707-qfps-rk-agent-hook-indirection
**Created**: 2026-07-07

## Origin

Conversational — grew out of a live diagnosis session (2026-07-07). The user's pane showed no
`agt` register in the PANE panel despite a running Claude session with hooks installed. Root
cause: the hooks in `~/.claude/settings.json` were the pre-#321 generation (raw `$PPID`), every
value they wrote carried a dead wrapper-shell pid, and the #320 PID-liveness reconciler in the
deployed server suppressed all of them. The fix (#321, comm-validated ancestor walk) had shipped
in the binary but reached nothing — it lives in the *installed hook string*, which only updates on
`rk agent-setup` re-run plus a restart of every agent session.

> Shouldn't the hooks be of a different form — i.e. something like "rk hook <something>"?
> Something that keeps updating as rk updates? Instead of shell scripts directly within
> claude/settings.json?

Agreed direction from the discussion: install a **stable interface** into harness settings (a thin
`rk agent-hook …` invocation) and keep the logic in the rk binary, so hook behavior tracks
`brew upgrade rk` with no settings churn and no session restarts. Amend spec Writer rule 4
accordingly. User approved drafting after seeing the recommendation, including the
`rk agent-hook` (vs `rk hook`) naming lean.

## Why

**Problem.** Hook logic is currently frozen twice: once in `~/.claude/settings.json` at
`rk agent-setup` time, and again in the harness's session-start snapshot (Claude Code snapshots
hook config when a session starts). A hook bug fix shipped in the rk binary reaches *zero* running
agents until the operator re-runs `rk agent-setup` AND restarts every agent session. This is not
hypothetical — it happened between #320 and #321: the reconciler (server-side, updates with the
binary) and the pid-writing hook (settings-side, frozen) skewed, and agent state was silently
suppressed on every pane of the machine.

**Consequence if unfixed.** Every future evolution of hook logic — new harness rows in the
registry (codex, copilot, gemini, opencode), smarter pid resolution, value-schema additions —
repeats this fleet-wide manual migration. run-kit's whole premise is many long-lived agent
sessions; "restart everything to pick up a hook fix" scales exactly wrong.

**Approach over alternatives.** Replace the hook *body* with a stable one-liner that delegates to
the binary: `sh -c '[ -n "$TMUX_PANE" ] || exit 0; "<abs-rk>" agent-hook --agent claude active 2>/dev/null || true'`.
The settings entry becomes an interface that never needs to change; the logic (ancestor walk, comm
registry, value formatting) lives in Go where it is testable and updates with the binary.
Alternatives considered and rejected in discussion:

- **Keep raw one-liners + add drift detection** (a doctor check / UI surfacing of hook-generation
  skew): mitigates discovery, not the migration itself — every logic change still needs re-setup +
  fleet restart.
- **Dual-path hook** (binary if present, pure-tmux fallback inline): contradicts the reason for the
  change (the fallback string is exactly the frozen logic being removed) and doubles the surface.
  If the binary is gone, silence is acceptable — the PID-liveness reconciler already clears state
  from dead agents, and a stranded value clears when the agent/pane dies.

The historical context matters: Writer rule 4 ("depend on nothing but tmux") was written in
reaction to the old `fab hook` model, which died outside a fab root. The rule's real intent —
hooks must never fail, block, or slow the agent, and must not require the run-kit *server* — is
preserved; the ban on the rk *binary* is what this change lifts.

## What Changes

### 1. New `rk agent-hook` subcommand (`app/backend/cmd/rk/agent_hook.go`)

`rk agent-hook --agent <name> <state>` — `<state>` ∈ `active | waiting | idle` (validated against
the existing `tmux.AgentState*` constants; `--agent` selects the comm literal from the per-agent
registry, v1: `claude`).

Behavior (all failure paths silent, **always exit 0** — Claude Code treats hook exit code 2 as
blocking and other non-zero exits as warnings; the binary must never produce either):

1. Read `$TMUX_PANE` from the environment; if unset, exit 0 immediately (defense in depth — the
   shell wrapper also guards this).
2. Resolve the agent pid via the comm-validated ancestor walk, now in Go: walk up from
   `os.Getppid()` comparing each ancestor's comm against the registry literal for `--agent`
   (via `ps -o comm= -p` / `ps -o ppid= -p` through `exec.CommandContext` with timeout — portable
   across linux/darwin). Bound raised from 3 to **5 hops**: the delegation adds a wrapper layer
   (`claude → hook shell → sh -c → rk`, and `sh` may or may not exec the final command). On
   validation failure, omit the pid segment entirely (two-segment value → legacy reconciler
   fallback), never write a wrong pid.
3. Write the option: `tmux set-option -pt "$TMUX_PANE" @rk_agent_state "<state>:<epoch>[:<pid>]"`
   via `exec.CommandContext` with timeout (Constitution I). The **value schema is unchanged** —
   readers (`parseAgentState`, the reconciler, fab-kit's future readers) are untouched.

No run-kit server involvement — the subcommand talks only to tmux, preserving the surviving half
of Writer rule 4.

### 2. Installer emits the stable interface (`app/backend/cmd/rk/agent_setup.go`)

`agentStateHookCommand(state)` becomes:

```sh
sh -c '[ -n "$TMUX_PANE" ] || exit 0; "<abs-rk-path>" agent-hook --agent claude <state> 2>/dev/null || true'
```

- The `$TMUX_PANE` guard stays in the wrapper as a cheap short-circuit (no binary spawn outside
  tmux); `|| true` preserves the never-fail contract even if the binary is missing or moved.
- `<abs-rk-path>` is resolved **at install time**: prefer `exec.LookPath("rk")` — on a Homebrew
  machine this yields the stable symlink (`/home/linuxbrew/.linuxbrew/bin/rk`), NOT the
  version-pinned Cellar path — falling back to `os.Executable()` **without** resolving symlinks
  (resolution would pin the Cellar version and re-freeze the hook). The path is embedded quoted.
- Event→state mapping (which events install which state, including the two `Notification`
  matchers) **stays in the settings entries** for v1 — the mapping churns far less than the logic,
  and matcher changes require a settings write regardless. Reading the harness's hook JSON on
  stdin to derive state in-binary is an additive follow-up that would not change the installed
  command shape.

### 3. Marker migration for idempotent re-install (`mergeHooks`/`isRkEntry`)

rk-owned entries are currently identified by the `@rk_agent_state` marker in the command string —
which the new command **no longer contains**. `isRkEntry` is extended to recognize an entry as
rk-owned when the command contains **either** the legacy marker (`@rk_agent_state`) **or** the new
form (the ` agent-hook ` invocation substring). This makes `rk agent-setup` on the new binary
strip the old-generation one-liners and replace them in place — the existing
strip-then-append merge needs no structural change, only the broadened predicate. `--uninstall`
removes both generations for the same reason.

### 4. Spec amendment (`docs/specs/agent-state.md`)

- **Writer rule 4** rewritten: hooks MUST never fail or block the agent and MUST NOT require the
  run-kit *server* at hook-fire time; the hook body SHOULD be the stable
  `rk agent-hook` interface with logic in the binary (the tmux-only ban is lifted; rationale
  recorded — the frozen-logic incident and the fab-hook history).
- **Writer rule 5** updated: the ancestor walk is implemented in the binary (bound 5), not in the
  installed shell string; the canonical command block shows the new stable one-liner.
- **Migration note** updated: this change needs one final old-style migration (re-run
  `rk agent-setup`, restart sessions — the snapshot still pins the old strings); subsequent logic
  changes need neither. Matcher/event-mapping changes still need re-setup + restart (they live in
  settings).

### 5. README

Update the `rk agent-setup` setup-steps section (#317) to reflect the new hook form and the
one-time re-migration for existing installs.

## Affected Memory

- `run-kit/agent-state`: (modify) hook installer now emits the stable `rk agent-hook` interface;
  new subcommand documented (walk-in-Go, exit-0 contract, install-time path resolution, marker
  migration); Writer-rule-4 amendment and its design decisions recorded.

## Impact

- `app/backend/cmd/rk/agent_hook.go` (new) + tests — state validation, ancestor walk, exit-0
  paths, value formatting, TMUX_PANE guard.
- `app/backend/cmd/rk/agent_setup.go` + tests — new command string, install-time path resolution,
  `isRkEntry` two-generation predicate, merge/unmerge fixtures updated.
- `app/backend/cmd/rk/root.go` — subcommand registration.
- `docs/specs/agent-state.md` — Writer rules 4/5, canonical command, migration note.
- `README.md` — setup steps.
- **Not touched**: value schema, `internal/tmux` parsing/reconciler, `internal/sessions` rollup,
  frontend, server API — readers are deliberately unaffected.

## Open Questions

- None — the design was resolved in the originating discussion; remaining judgment calls are
  recorded as graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Subcommand named `rk agent-hook` (grouping with `rk agent-setup`) over the user-floated `rk hook` | Discussed — user proceeded to intake after seeing the naming lean; trivially renameable before ship | S:70 R:90 A:65 D:55 |
| 2 | Confident | Args are state literals + `--agent` flag; event→state mapping stays in settings matchers; stdin-JSON parsing deferred as additive follow-up | Mapping churns far less than logic; stdin parsing wouldn't change the installed command shape, so deferring loses nothing | S:60 R:85 A:70 D:60 |
| 3 | Certain | `@rk_agent_state` value schema `<state>:<epoch>[:<pid>]` unchanged; all readers untouched | Cross-repo contract (fab-kit backlog ioku); nothing in this change needs a schema change | S:90 R:95 A:95 D:95 |
| 4 | Confident | Install-time absolute path via `exec.LookPath("rk")` (stable symlink), fallback `os.Executable()` without symlink resolution; never the versioned Cellar path | Discussed — hook env PATH is untrustworthy; symlink resolution would version-pin and re-freeze the hook | S:75 R:80 A:70 D:65 |
| 5 | Confident | No pure-tmux fallback path when the binary is missing — silent no-op (trailing `or true` guard) | Discussed explicitly — a fallback string IS the frozen logic being removed; PID-liveness reconciler covers stranded values | S:80 R:75 A:75 D:70 |
| 6 | Certain | `rk agent-hook` always exits 0, all errors silent | Spec Writer rule 3 already mandates never-fail; Claude Code treats exit 2 as blocking — non-negotiable | S:85 R:90 A:95 D:90 |
| 7 | Confident | `isRkEntry` recognizes both legacy (`@rk_agent_state`) and new (`agent-hook`) command forms so re-install/uninstall migrates old entries in place | Derived requirement — without it, re-setup would duplicate rather than replace; existing strip-then-append merge otherwise unchanged | S:65 R:85 A:85 D:75 |
| 8 | Confident | Ancestor-walk bound raised 3→5 hops; comm literal selected by `--agent` from the per-agent registry | Delegation adds a wrapper layer whose exec behavior varies by shell; extra hops are cheap and bounded | S:55 R:85 A:75 D:65 |
| 9 | Certain | Spec Writer rule 4 amended to "never fail/block; no run-kit server" — the tmux-only dependency ban is lifted for the rk binary | The core of the user-approved change; spec is in-repo and the amendment was the explicit ask | S:85 R:80 A:90 D:90 |
| 10 | Certain | `$TMUX_PANE` guard kept in the shell wrapper AND re-checked in-binary | Wrapper check avoids a binary spawn outside tmux; in-binary check keeps the binary safe standalone — strictly additive | S:60 R:95 A:90 D:80 |

10 assumptions (4 certain, 6 confident, 0 tentative, 0 unresolved).
