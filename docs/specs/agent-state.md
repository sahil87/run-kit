# Agent-State Convention (`@rk_pane_agent_state`)

> The cross-repo contract for generic agent-lifecycle state. run-kit is the
> writer (`rk agent setup` installs the hooks) and native reader (backend
> `internal/tmux`/`internal/sessions`); fab-kit's `fab pane send`/`pane map`
> become convention *readers* against this same option (fab-kit backlog
> `[ioku]`). This spec is the coordination point — implement against it, not
> against either repo's internals.

---

## Two-Tier Ownership

Agent status splits into two tiers with distinct owners:

- **Tier 1 — fab pipeline state** (change / stage / display-state): owned by the
  fab pipeline, read from `.status.yaml`. Stays fab's.
- **Tier 2 — generic agent-lifecycle state** (active / waiting / idle): owned by
  run-kit, carried in the `@rk_pane_agent_state` tmux pane user option, written by
  agent-harness hooks for **any** agent (Claude, codex, copilot, gemini,
  opencode, …) in **any** directory under **any** workflow.

This inverts the previous model, where run-kit consumed a Claude-only,
fab-root-coupled `_agents` pipeline via `fab pane map`. Per constitution
**Principle X — Hooks Carry Only the Underivable**, hooks push only ephemeral
in-flight lifecycle state; everything derivable (PR links, branches, worktrees)
is derived server-side.

---

## The Option

| Property | Value |
|----------|-------|
| Name | `@rk_pane_agent_state` |
| Scope | tmux **pane** user option (`set-option -p`) |
| Value | `"<state>:<epoch_seconds>[:<pid>]"` |
| States | `active` \| `waiting` \| `idle` |
| Example | `waiting:1751790000:48213` |

The epoch segment is **mandatory** — readers compute idle/waiting duration from
it. The pid segment is the **agent process's pid** and SHOULD be written by all
current writers (resolved inside the `rk agent hook` binary via the
comm-validated ancestor walk of Writer rule 5 — never raw `$PPID`, which records
the harness's ephemeral hook-wrapper shell, not the agent); it feeds the
PID-liveness reconciler (Reader rule 3). Readers MUST
tolerate its absence (legacy two-segment values). A malformed value — wrong
segment count, unknown state, non-integer epoch, or a malformed/non-positive
pid — is wholly unknown; readers never partially trust it.

### State semantics

| State | Meaning |
|-------|---------|
| `active` | A turn is in progress (the agent is working). |
| `waiting` | The agent is blocked on a **human** — a permission prompt, an elicitation/question dialog. This is the highest-urgency, most notification-worthy state. |
| `idle` | The turn is complete; the agent is at rest. |

---

## Writer Rules

Hook commands that write the option MUST:

1. **Self-locate via `$TMUX_PANE`** — the harness sets it for the pane the agent
   runs in.
2. **No-op outside tmux** — `[ -n "$TMUX_PANE" ] || exit 0` (a hook may fire when
   the agent is not inside a tmux pane).
3. **Never fail the agent** — every path exits 0 (`… 2>/dev/null || true`); a
   broken hook must never break the agent's turn.
4. **Never require the run-kit *server*, and never fail or block the agent** —
   the hook body SHOULD be the stable `rk agent hook` interface (a thin wrapper
   installed into harness config; all logic lives in the rk binary). The
   `@rk_pane_agent_state` write happens inside the binary via
   `tmux set-option -pt "$TMUX_PANE" @rk_pane_agent_state "<state>:<epoch>[:<pid>]"`;
   no run-kit **server** need be running at hook-fire time. *(The earlier form
   of this rule banned the rk **binary** too — "depend on nothing but tmux",
   written in reaction to the old `fab hook` model that died outside a fab root.
   That ban is **lifted**: the rule's real intent — hooks must never fail,
   block, or slow the agent, and must not require the run-kit server — is
   preserved, but the logic now living in the binary is what lets a hook fix
   reach running agents on `brew upgrade rk` with no settings churn and no
   session restarts. Rationale: hook logic was formerly frozen twice — once in
   `~/.claude/settings.json` at install time, once in the harness's
   session-start snapshot — so the #320 PID-liveness reconciler and the frozen
   pid-writing hook skewed between #320 and #321 and suppressed agent state
   fleet-wide. Delegating to the binary removes that freeze.)* If the binary is
   missing at fire time the hook is a silent no-op (the wrapper's trailing
   `|| true`) — acceptable, because the PID-liveness reconciler already clears
   state from dead agents and a stranded value clears when the agent/pane dies.
5. **Carry the agent pid, resolved by a comm-validated ancestor walk in the
   binary** — NOT raw `$PPID`: harnesses spawn hook commands through an
   *ephemeral* intermediate shell that exits when the hook finishes (measured
   with Claude Code — raw `$PPID` recorded that dead wrapper, so liveness
   suppressed every value). `rk agent hook` walks up from `getppid()` (bounded,
   **5 hops** — the delegation adds a wrapper layer: `claude → hook shell →
   sh -c → rk`, and `sh` may or may not exec the final command) until the
   process name equals the agent's comm (a per-agent registry literal selected
   by `--agent`, e.g. `claude`), and omits the pid segment entirely if the walk
   cannot validate an ancestor — a two-segment value that degrades to the
   reader's legacy fallback, never a wrong pid. This is what lets readers trust
   state on *wrapped launches*, where `#{pane_current_command}` reads as a shell
   while the agent runs inside it.

Canonical command — the stable delegating wrapper installed by `rk agent setup`
(state and comm are fixed registry literals; nothing user-provided is
interpolated; `<abs-rk>` is the absolute rk path resolved at install time, a
stable symlink rather than a version-pinned path; the interpreter is absolute
for the same reason — hooks fire under the harness's environment, and a bare
`sh` fails on sessions whose PATH lacks /bin):

```sh
/bin/sh -c '[ -n "$TMUX_PANE" ] || exit 0; "<abs-rk>" agent hook --agent claude <state> 2>/dev/null || true'
```

The old root form `rk agent-hook <state>` is a **permanent hidden alias** of
`rk agent hook` (delegation rule 3 of
[`cli-layering.md`](cli-layering.md)): installed hook lines frozen with the
`agent-hook` literal keep working unmodified **forever** — the alias is never
deprecated, never warns, and carries the same never-fail contract — while
`rk agent setup` writes the `agent hook` family form going forward. Existing
installs are not proactively migrated; they roll over on the next setup re-run.

All logic — the comm-validated ancestor walk, the value formatting, the
`tmux set-option` write — lives in `rk agent hook`, which always exits 0 on
every path (a hook must never fail or block the agent; Claude Code reads a
non-zero hook exit as a warning and exit code 2 as blocking). The subcommand
targets the pane's own tmux server via the socket captured from `$TMUX` before
the process strips it, so it works regardless of whether the hook context
re-exports `$TMUX`.

> **Migration**: this indirection needs **one final** old-style migration —
> re-run `rk agent setup` (idempotent; it recognizes and replaces every older
> generation — the legacy inlined one-liner and the `agent-hook` root-form
> wrapper — in place) **and
> restart agent sessions** (harnesses snapshot hook config at session start, so
> the old frozen strings persist until a fresh session). **Subsequent hook
> *logic* changes need neither** — they ship in the rk binary and take effect on
> `brew upgrade rk`. Only **matcher / event-mapping** changes (which events map
> to which state) still require re-setup + session restart, because that mapping
> lives in the settings entries, not the binary.

---

## Reader Rules

1. **Absent option → unknown** — render `—` (no agent, or an agent whose harness
   has no hooks installed).
2. **Duration from epoch** — readers compute idle/waiting duration from the
   epoch suffix; they MAY apply staleness heuristics on top.
3. **Reconciler** — clears stranded state from dead agents, in two forms:
   - **PID liveness (primary — pid-carrying values)**: the state is trusted iff
     the agent process is alive (`kill(pid, 0)`; `ESRCH` = dead → treat as no
     agent; `EPERM` counts as alive). The pane's command name is IRRELEVANT for
     these values — a wrapped launch (`#{pane_current_command}` = `bash` while
     the agent runs inside a non-exec'ing wrapper) reports correctly, and a
     killed/crashed agent clears precisely.
   - **Shell-command fallback (legacy two-segment values only)**: a pane whose
     `#{pane_current_command}` is a plain shell (`bash` \| `zsh` \| `fish` \|
     `sh` \| `dash`) is treated as having **no agent**, regardless of a leftover
     option value (the guppi lesson). Known false negative: wrapped launches —
     which is why the pid form is preferred.
   An Esc-interrupted agent (alive, at rest) is corrected by the hooks
   themselves (`Notification: idle_prompt` rewrites to `idle` after ~60s) — the
   reconciler's job is only the dead-process case.
4. **Window rollup** — a window with multiple panes rolls up to a single state
   with precedence `waiting > active > idle` (a split window with one waiting
   pane is a waiting window). A per-pane truth is preserved for future pane/board
   surfaces.

---

## Lifecycle

Pane options die with the pane — there is **no GC, no state file, no cross-pane
ambiguity**. An option lives on exactly one pane of exactly one tmux server.
Killing the pane (or the server) removes it.

---

## Naming / Deprecation window

The canonical names are `@rk_pane_agent_state` and `@rk_pane_agent_session`.
The retired unscoped `@rk_agent_state` is dual-read for one release window,
and the agent-session key dual-reads its retired previous name `@rk_pane_chat`
the same way; the retired unscoped `@rk_chat` is **closed out** for the
agent-session key — no longer written, no longer read, its CopyOnly migration
row kept (ordered before the `@rk_pane_chat` row) so stale values chain forward
(`@rk_chat` → `@rk_pane_chat` → `@rk_pane_agent_session`) in a single sweep
pass (tmux format expansion resolves `#{@foo}` by walking pane → window →
session → global, so scope is encoded in the name — see
`fab/project/context.md` § Conventions).

During the window:

- **`rk agent hook` writes BOTH names** (one `;`-chained tmux invocation per
  fire) — installed rk binaries of any vintage, and fab-kit (which reads only
  the retired name until its new-then-old read ships), keep working.
- **Readers prefer the new name and fall back to the retired one** — the
  `list-panes` `paneFormat` carries both fields (new wins), `PaneFactsCtx`
  requests both, and `IsEphemeralServer`/`IsProtectedServer` dual-read their
  server-scoped pair the same way.
- **The migration sweep copies forward, never back** — `MigrateLegacyOptions`
  copies the retired pane names onto the new ones (CopyOnly rows: the retired
  pane name is never unset at pane scope; wrong-scope strays are purged) and
  migrates the server keys (`@rk_ephemeral`/`@rk_protected`) fully.
- **`rk doctor` gains an `agent hooks` row** classifying installed hook
  generations — gen-1/gen-2 entries (which write only the retired names) FAIL
  with a re-run-`rk agent setup` hint.

Removal of everything below is a follow-up change, **no sooner than one release
after the fab-kit dual-read change ships** and the operator's fleet shows
`rk doctor` `agent hooks` OK everywhere for about a week of updates:

1. The `Legacy*Option` constants (`internal/tmux/tmux.go`).
2. Old-name fallback reads: the server predicates' second `show-option`;
   `paneFormat`'s legacy fields and the new-wins preference in `parsePanes`;
   `PaneFactsCtx`'s legacy field.
3. The dual-write second `set-option` in `rk agent hook`.
4. The CopyOnly semantics on the two pane migration rows (they become
   unset-only for one further release, then are deleted).
5. `rkHookMarker` (the gen-1 hook recogniser).
6. The doctor `agent hooks` row's gen-1/gen-2 classification (the row itself
   stays; its FAIL branches for generations < 3 can go once nothing reports
   them).

---

## Per-Agent Event-Mapping Registry

`rk agent setup` installs hook commands into an agent's **user-global** config so
any session of that agent reports state. It is structured as a per-agent registry
(agent name → config path + config format + event→state mapping); v1 ships
Claude Code, with codex / copilot / gemini / opencode as additive follow-ups.

### Claude Code (`~/.claude/settings.json`)

| Event | Matcher | Writes |
|-------|---------|--------|
| `UserPromptSubmit` | — | `active:<now>` |
| `PreToolUse` | — | `active:<now>` (heartbeat refresh; also covers subagent tool churn) |
| `Notification` | `permission_prompt\|elicitation_dialog\|agent_needs_input` | `waiting:<now>` |
| `Notification` | `idle_prompt` | `idle:<now>` (backstop — `Stop` does not fire on every turn-end path, e.g. Esc-interrupt) |
| `Stop` | — | `idle:<now>` |
| `SessionStart` | — | `@rk_pane_agent_session` stamp **plus** `@rk_pane_agent_state idle:<now>[:<pid>]` — the boot-ready signal (see § Boot-ready) — via token `stamp`; the idle write is withheld for `source=compact` |

> The `SessionStart` row's idle write is gated on the hook payload's `source`
> because SessionStart fires on `startup`, `resume`, `clear`, and `compact`, and
> `source=compact` fires **mid-turn** — an `idle` write there would clobber a
> live `active`. The stamp lands within seconds of session start (before any
> prompt) and re-stamps on every session-id rotation.

The hooks merge into the Claude settings shape
`hooks → <Event> → [ { matcher?, hooks: [ { type: "command", command } ] } ]`.
`rk agent setup` is idempotent (re-run replaces the rk-owned entries in place,
never duplicates, never touches non-rk hooks), shows the settings diff and asks
for confirmation before writing, and supports `--uninstall` to remove exactly
the rk-owned entries. rk-owned entries are identified by **any of three**
markers in the command string — the legacy
`@rk_agent_state` option-name marker (the old inlined one-liner — retired name, see § Naming / Deprecation window), the
second-generation ` agent-hook ` invocation substring, **or** the third-generation
` agent hook ` family form the installer writes today — matching
all three is what lets a re-run on the new binary migrate old-generation entries in
place and lets `--uninstall` remove every generation.

---

## Boot-ready

"Safe to type into a freshly spawned agent" is a derived readiness signal, not
a new state: a pane is **boot-ready** when its reconciled
`@rk_pane_agent_state` is present (any of `idle`/`waiting`/`active` — presence
means the agent's hooks fired, so its TUI finished booting) OR, for hook-less
agents, when the pane's captured screen is non-blank and byte-identical across
two consecutive polls (~600ms apart, bounded by a ~25s deadline — the
capture-settle fallback).

The `SessionStart` registry row is what makes state-present true at boot: it
stamps `idle` (semantically true of a freshly started/resumed session) in
addition to the session stamp, which also **clears a stale `waiting`/`active`
left in the pane by a previous agent**. The idle write ships in the `rk agent
hook` binary, so it reaches running fleets on upgrade with no settings churn;
it is withheld only for `source=compact` (mid-turn — see the registry table).

The primitive lives in `internal/inject` (`AwaitReady` / `DeliverWhenReady` —
the spawn-then-deliver composite), exposed on the CLI as `rk mux await --ready`
(report: `ready %N (state)` / `ready %N (settled)`). For hook-less agents the
documented composition is:

```sh
rk mux await --ready %5 && rk mux send --force %5 '<prompt>'
```

(`send` stays gated on agent state, which a hook-less pane never has; `--force`
is the documented pairing.) Caveat: a settled first-run dialog can false-fire
the settle signal — the delivery engine's echo probe catches it (ProbeFailure →
the caller degrades), so readiness is a heuristic, not a proof.

---

## Agent Session Identity (`@rk_pane_agent_session`)

A second pane user option, written by the **same** `rk agent hook` binary on the
same hook fires, ties a pane to the **live** agent session running in it.
It is the key every transcript-coupled feature resolves a pane by: operator
actuation (transcript reads), fork and closed-session resume, auto-naming, and
agent-targeted send (`POST /api/windows/{id}/send` with `target:"agent"`) all
start from this option — without it none of them has a session to address (the
pane stays the agent's parent process — Constitution VI).

**Why a hook (not derivation).** Claude Code sessions are disk-owned: every
session persists to `~/.claude/projects/<cwd-slug>/<session-id>.jsonl`, and any
process in the cwd can resume by id. But *multiple transcripts share a cwd*, so
"which session is live in this pane" is underivable from disk, tmux, or git — it
exists only in the hook input JSON, which is exactly the class of fact
**Principle X** reserves for hooks.

### The Option

| Property | Value |
|----------|-------|
| Name | `@rk_pane_agent_session` (const `tmux.AgentSessionOption`) |
| Scope | tmux **pane** user option (`set-option -p`) |
| Value | `"<provider>:<session-ref>"` |
| Example | `claude:6f0d9e2a-1c3b-4f7e-9a2d-8b5c4e1f0a37` |

- **`<provider>`** — a lowercase token (`[a-z][a-z0-9_-]*`) equal to the
  `rk agent setup` registry agent name (v1: `claude`; `codex`/`gemini` are
  additive). The backend **routes** on this prefix; the frontend **gates** on
  presence. The value is split on the **first** colon (providers never contain a
  colon; a ref might in principle, so everything after the first colon is the ref
  verbatim).
- **`<session-ref>`** — a provider-defined opaque reference. For `claude` it is
  the **session UUID** (not the transcript path — the path is derivable from the
  UUID by glob, so Principle X says carry only the UUID). The option name is
  declared **once** in `internal/tmux` (`AgentSessionOption`); `cmd/rk/agent_hook.go`
  aliases it (one source of truth per binary, A-021).

### Writer Rules

Identical never-fail contract to `@rk_pane_agent_state` (self-locate via `$TMUX_PANE`,
no-op outside tmux, every path exits 0, no rk **server** required, all logic in
the `rk agent hook` binary, `-S <socket>` targeting via `tmux.OriginalTMUX`).
Beyond that:

1. **Read the hook stdin JSON** — `rk agent hook` reads its stdin (the payload
   every hook event receives): a **TTY-guarded** (`os.ModeCharDevice` — a manual
   terminal invocation never blocks), **bounded** (`io.LimitReader`, ~1 MiB),
   **single-object** (`json.Decoder.Decode` — returns after one object, no
   dependence on stdin EOF) parse that extracts `session_id`. Every failure mode
   (absent/malformed/oversized/no stdin) is silent: no session stamp, and the
   `@rk_pane_agent_state` write still proceeds.
2. **Stamp on every fire that yields a `session_id`** — on each `active`/
   `waiting`/`idle` fire the binary writes `@rk_pane_agent_state` **and** (if the
   stdin carried a valid `session_id`) `@rk_pane_agent_session = <agent>:<session_id>`,
   dual-written with the retired previous name `@rk_pane_chat` for the deprecation
   window (`@rk_chat` is no longer written). Every-
   fire (not `SessionStart`-only) is required because **session ids rotate on
   `/clear` and `/compact`**, so a one-time stamp goes stale; it also stamps
   already-running agents on `brew upgrade rk` with zero settings churn.
3. **Stamp mode (token `stamp`)** — a distinguished positional token used by the
   `SessionStart` registry row: it writes `@rk_pane_agent_session` on every fire that yields
   a `session_id`, and — when the parsed payload's `source` is NOT `compact`
   (the mid-turn source) — additionally writes `@rk_pane_agent_state
   idle:<epoch>[:<pid>]` under the Writer Rules above (comm-validated pid walk,
   pid omitted when the walk fails). An unparseable payload withholds both the
   idle write (fail-safe) and the session stamp (no `session_id` can be decoded).
   Unknown tokens are silent no-ops.
4. **Validated before write** — the `session_id` is checked (non-empty, no
   whitespace/control chars) with the same rule the reader applies to a ref, so a
   value the reader would reject is never written.

### Reader Rules

1. **Absent → no agent session** — render nothing (no agent, or an agent whose
   harness has no session stamp yet).
2. **Malformed → wholly unknown** — a value missing the colon, with an empty or
   invalid provider, or with an empty/whitespace/control ref parses to `("","")`;
   it is never partially trusted. A **well-formed but unregistered** provider
   (e.g. `codex:…`) is **not** rejected — presence-gating is provider-agnostic and
   adapters are additive. `PaneInfo` carries the pre-split `AgentProvider` /
   `AgentSessionRef` (parsed once in Go via `parseAgentSessionRef`), so no consumer
   re-splits the raw value.
3. **Reconciliation** — a dead agent must not leave a live-looking session ref. The
   reader reconciles `@rk_pane_agent_session` in `parsePanes`, colocated with the agent-state
   reconciler, using the **same pane's `@rk_pane_agent_state`** for liveness (the session option
   carries no pid of its own):
   - agent-state carried a pid (3-segment): the session identity is trusted iff that pid is alive
     (the existing `agentProcessAlive` check) — a dead pid zeroes **both** the
     agent-state **and** the agent-session fields.
   - otherwise (no agent-state yet, or a legacy 2-segment value): the
     shell-command fallback — a plain-shell/htop pane never surfaces a session identity.
   Accepted false negative (mirrors the agent-state legacy fallback): a *wrapped*
   launch that `SessionStart` stamped but which has no pid-bearing agent-state yet
   suppresses the identity until the first state write lands a pid — it self-heals at the
   first prompt.
4. **No disk validation** — the reconciler does **not** stat the referenced
   `…/<ref>.jsonl`. A live agent's transcript exists by construction; the
   transcript-reading consumers (operator actuation, fork, closed-resume,
   auto-name) surface a missing transcript naturally as a read error.
5. **Rides the existing read** — `#{@rk_pane_agent_session}` and `#{@rk_pane_chat}` ride the
   `list-panes` `paneFormat` (dual-read window, new field wins; the closed-out
   `@rk_chat` generation is no longer carried); they cost **zero extra subprocess**. The window
   rollup (active pane's session if set, else the first pane carrying one) plus the
   per-pane truth both ride the existing `GET /api/sessions` and SSE
   `event: sessions` payloads (no new endpoint, no new event type).

### Lifecycle

Pane options die with the pane — **no GC, no state file**. An option lives on
exactly one pane of exactly one tmux server; killing the pane (or the server)
removes it. Reader-side reconciliation is the only clearing path — there is
deliberately **no** writer-side clear and **no `SessionEnd` registration**:
reader reconciliation is mandatory anyway (crash/kill paths), so a `SessionEnd`
clear would add a settings entry without removing any reader logic.

### Migration

Two independent migration seams, mirroring the `@rk_pane_agent_state` split:

- **Every-fire stamping** is **binary-only** — it ships in `rk agent hook` and
  reaches already-running agents on `brew upgrade rk` with **no settings churn and
  no session restarts** (the `260707-qfps` indirection dividend; the installed
  wrappers already pipe stdin through to the binary).
- **The `SessionStart` registry row** is an event-mapping change and follows the
  established rule: **one `rk agent setup` re-run + session restarts** (harnesses
  snapshot hook config at session start). Until then, running agents still get
  `@rk_pane_agent_session` from the every-fire stamping on their existing `active`/`waiting`/
  `idle` hooks — the `SessionStart` row only advances *when* the first stamp lands
  (within seconds of start, before any prompt).
