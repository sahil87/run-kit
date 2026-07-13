# Intake: Chat Session Identity (`@rk_chat` pane-option convention)

**Change**: 260713-nh86-chat-session-identity
**Created**: 2026-07-13

## Origin

> /fab-new chat-session-identity — see fab/plans/sahil/agent-chat-view.md Change 1: chat-session-identity. Reference the plan explicitly in the intake.

One-shot invocation against a pre-authored plan: **`fab/plans/sahil/agent-chat-view.md`** (authored 2026-07-13 in a `/fab-discuss` session). This change is **Change 1 — `chat-session-identity`**, the keystone of the HTML-agent-chat-view stack — changes 2–4 (`chat-read-backend`, `chat-read-frontend`, `chat-send`) all depend on it. Per the plan's pickup protocol:

- The plan's **Decision log** entries are treated as **Certain** in SRAD scoring (rows 1–2 below).
- The plan's per-change "decisions to resolve at intake" (session-ref format, stamping events, clearing trigger, disk validation) are resolved as graded assumptions below (rows 3–7).
- The plan's **architecture facts were re-verified today** (2026-07-13, same day the plan was authored) against code.claude.com docs: all hook events receive stdin JSON carrying `session_id`, `transcript_path`, `cwd`, `hook_event_name`; the `SessionStart` hook event exists with `source ∈ {startup, resume, clear, compact}`; `SessionEnd` exists; transcript filenames ARE the session UUID (`~/.claude/projects/<cwd-slug>/<session-id>.jsonl`); and — load-bearing for the stamping decision — **session IDs rotate on `/clear` and `/compact`** (the old transcript stays on disk; the pane's *live* session gets a new UUID).

## Why

**The pane→session mapping is the ambiguity the whole chat stack rests on.** Claude Code sessions are disk-owned, not process-owned: any process can read/resume a transcript by ID, but *multiple transcripts share a cwd*, so "which session is live in this pane" is underivable from disk, tmux, or git alone. The hook input JSON is the only source that ties a running agent process to its current session id — which is exactly the class of fact Constitution X reserves for hooks ("hooks carry only the underivable"). Without this change, the chat-read backend (Change 2) has no key to read by and the frontend toggle (Change 3) has nothing to gate on.

**Consequence of not doing it (or doing it without clearing rules)**: plan risk #4 — a dead agent leaving a stale `@rk_chat` produces a dead `[tty|chat]` toggle in the UI. The plan makes reconciliation part of THIS change's acceptance, not an afterthought, precisely because the `@rk_agent_state` history (the guppi lesson, the #320↔#321 skew) showed stale lifecycle options are the failure mode of this pattern.

**Why this approach**: mirror the proven `@rk_agent_state` machinery end to end — same pane-option scope, same never-fail hook contract, same `rk agent-hook` binary indirection (logic ships on `brew upgrade rk`, not frozen in settings), same read-time reconciliation, same zero-extra-subprocess read (rides the existing `list-panes` call). Strategically (per `docs/wiki/competitive-landscape.md` and the plan's framing): chat stays a **view over the pane** — the agent's parent process remains the tmux pane, never the rk server (Constitution VI); rk owns a provider-tagged convention so Codex/Gemini adapters are additive backend work.

## What Changes

### 1. Spec amendment — `@rk_chat` convention in `docs/specs/agent-state.md`

New section defining the cross-repo convention, mirroring the `@rk_agent_state` structure:

| Property | Value |
|----------|-------|
| Name | `@rk_chat` |
| Scope | tmux **pane** user option (`set-option -p`) |
| Value | `<provider>:<session-ref>` |
| Example | `claude:6f0d9e2a-1c3b-4f7e-9a2d-8b5c4e1f0a37` |

- **`<provider>`**: lowercase token (`[a-z][a-z0-9_-]*`) = the `rk agent-setup` registry agent name (v1: `claude`; `codex`/`gemini` are additive per plan changes 5–6). The backend routes on this prefix; the frontend gates on presence.
- **`<session-ref>`**: provider-defined opaque reference. For `claude` it is the **session UUID** (not the transcript path — see Assumption 3). Parse splits on the **first** colon (providers never contain colons; refs might in principle).
- **Writer rules**: identical never-fail contract to `@rk_agent_state` (self-locate via `$TMUX_PANE`, no-op outside tmux, every path exits 0, no rk server required, logic in the binary).
- **Reader rules**: absent → no chat (render nothing); malformed value (missing colon, empty/invalid provider, empty ref) → wholly unknown, never partially trusted; reconciliation per §4.
- **Lifecycle**: pane options die with the pane — no GC, no state file.

### 2. Writer — `rk agent-hook` reads stdin JSON and stamps `@rk_chat` (`app/backend/cmd/rk/agent_hook.go`)

**Verified current state**: `agent_hook.go` never reads stdin (no `io`/`encoding/json` import) — the hook payload is entirely ignored today; state comes from the positional arg, pid from the process tree. The `@rk_chat` session-ref exists *only* in that stdin JSON, so this change adds the stdin seam (the "read hook JSON on stdin" follow-up that `260707-qfps` explicitly deferred, scoped here to session identity only — state derivation stays in the settings matchers).

- `runAgentHook` gains a stdin parse step: bounded read (`io.LimitReader`, ~1 MiB), **single-object `json.Decoder`** (returns after one complete object — no dependence on stdin EOF, which the docs don't guarantee), **skipped when stdin is a TTY** (`os.ModeCharDevice` guard, so a manual terminal invocation can't block). Extracted fields: `session_id` (and `hook_event_name`/`source` if the plan needs them). Every failure mode is silent: absent/malformed/oversized JSON ⇒ no chat stamp, and the agent-state write still proceeds. The never-fail/always-exit-0 contract (`TestAgentHookCmdNeverErrorsOnMalformedInvocation`) is unchanged.
- **On every fire that yields a `session_id`**, stamp `@rk_chat = <agent>:<session_id>` on `$TMUX_PANE` alongside the state write — same `tmux.OriginalTMUX`-derived `-S <socket>` targeting via `tmuxSocketArgs`, same `exec.CommandContext` + 5s timeout (Constitution I). Whether the two `set-option` writes share one tmux invocation (`;`-separated) or issue two calls is a plan-level efficiency detail.
- **Why every fire, not SessionStart alone**: session ids rotate on `/clear` and `/compact` (verified today), so a one-time stamp goes stale mid-pane-lifetime. Every-fire refresh also means **already-running sessions get `@rk_chat` on `brew upgrade rk` with zero settings churn and zero restarts** — the installed wrappers already pipe stdin through to the binary (the `260707-qfps` indirection dividend).
<!-- assumed: stdin session_id on registered events is always the pane's root session — subagent (Task-tool) PreToolUse fires are unverified and could carry a sidechain id; verify at apply, and if sidechain ids appear restrict stamping to UserPromptSubmit/SessionStart/Stop -->
- New **stamp-only invocation mode**: a distinguished positional token (working name `stamp`, alongside `active|waiting|idle`) that writes `@rk_chat` but **not** `@rk_agent_state` — used by the SessionStart registry row (§3). Unknown tokens remain silent no-ops.

### 3. Installer — SessionStart registry row (`app/backend/cmd/rk/agent_setup.go`)

The Claude row of `agentRegistry` gains one entry:

| Event | Matcher | Writes |
|-------|---------|--------|
| `SessionStart` | — | `@rk_chat` stamp only (token `stamp`; **no** agent-state write) |

- Installed command keeps the exact established wrapper shape: `sh -c '[ -n "$TMUX_PANE" ] || exit 0; "<abs-rk>" agent-hook --agent claude stamp 2>/dev/null || true'`. The `isRkEntry` marker (`" agent-hook "`) already matches it — idempotent re-run replacement and `--uninstall` need no marker changes.
- `SessionStart` fires on `startup`, `resume`, `clear`, and `compact` (verified) — so the option appears **within seconds of session start** (the plan's acceptance bar, before any prompt is submitted) and re-stamps immediately on every session-id rotation.
- **SessionStart writes no agent-state** because `source=compact` fires **mid-turn** — writing `idle` there would clobber a live `active` state. Stamp-only is correct for all four sources.
- **No SessionEnd registration**: writer-side clearing is rejected — reader-side reconciliation must exist anyway for crash/kill paths, so a SessionEnd clear adds a settings entry without removing any reader logic (see Assumption 6).
- **Migration**: the every-fire stamping (§2) is binary-only and reaches running agents on upgrade; the SessionStart row is an event-mapping change and follows the established rule — one `rk agent-setup` re-run + session restarts. Document both in the spec's migration note.

### 4. Reader — parse + reconcile (`app/backend/internal/tmux`)

- `paneFormat` (tmux.go:673) gains an 8th field `#{@rk_chat}`; the `parsePanes` skip-guard moves `< 7` → `< 8`. Zero extra subprocess — rides the existing per-session `list-panes` call.
- New constant `tmux.ChatOption = "@rk_chat"` beside `AgentStateOption` — one source of truth per binary (the A-021 pattern); `cmd/rk/agent_hook.go` aliases it rather than re-declaring the string.
- Pure `parseChatRef(raw) (provider, ref string)`: trim; split on the **first** colon; validate provider shape (`[a-z][a-z0-9_-]*`, non-empty) and ref (non-empty, no whitespace/control chars); any violation ⇒ `("", "")` — wholly unknown, mirroring `parseAgentState` tolerance. Unknown-but-well-formed providers are **not** rejected (presence-gating is provider-agnostic; adapters are additive).
- `PaneInfo` gains `ChatProvider string` (`json:"chatProvider,omitempty"`) and `ChatSessionRef string` (`json:"chatSessionRef,omitempty"`) — parsed/validated once in Go so no consumer re-splits the raw value.
- **Reconciliation** (in `parsePanes`, colocated with the existing agent-state reconciler — a dead agent must not leave a live-looking chat ref, plan risk #4). `@rk_chat` carries no pid segment (the two-segment schema is plan-fixed), so liveness is judged from the **same pane's `@rk_agent_state`**, written by the same binary on the same fires:
  - Agent-state parsed with a pid (3-segment): chat is trusted iff that pid is alive (the existing `agentProcessAlive` check) — a dead pid zeroes both agent-state **and** chat fields.
  - Otherwise (no agent-state yet, or legacy 2-segment): the shell-command fallback — `isShellCommand(pane_current_command)` ⇒ zero the chat fields. A shell/htop pane therefore never surfaces chat (acceptance).
  - Known false-negative mirror: a *wrapped* launch (`pane_current_command` = `bash` with claude inside) whose SessionStart stamped chat but which has no pid-bearing agent-state yet suppresses chat until the first state write lands a pid — same accepted class as the agent-state legacy fallback, and it self-heals at the first prompt.
- **No disk validation**: the reconciler does **not** stat `~/.claude/projects/**/<ref>.jsonl` (per-pane-per-poll filesystem I/O guarding a pathological case; a live agent's transcript exists by construction, and Change 2's read endpoint surfaces a missing transcript naturally as a read error).

### 5. Surfacing — window rollup + API/SSE (`app/backend/internal/sessions`)

- `WindowInfo` gains the same two fields (`chatProvider`/`chatSessionRef`), filled in `FetchSessions` beside the `rollupAgentState` call by a pure `rollupChat(panes)` helper: the **active pane's** reconciled chat if set, else the first pane carrying one (deterministic; the common case is one agent pane per window; Change 3 can revisit the multi-pane rule without a backend contract break since per-pane truth also ships).
- Both `GET /api/sessions` and the SSE `event: sessions` payload carry the new fields automatically — same `ProjectSession` marshal (`api/sessions.go:18`, `api/sse.go:915`), per-window rollup **and** per-pane entries (`WindowInfo.Panes` is already serialized). No new endpoint, no new SSE event type, `attachPRStatus` untouched.

### 6. Plan tracking table

Fill this change's folder name into row 1 of the tracking table in `fab/plans/sahil/agent-chat-view.md` in the same PR (pickup protocol step 5); mark Done when the PR merges.

## Affected Memory

- `run-kit/agent-state`: (modify) add the `@rk_chat` convention — value schema, stdin-JSON seam in `rk agent-hook`, stamp-only mode, SessionStart registry row, chat reconciliation rules, migration note
- `run-kit/architecture`: (modify) `GET /api/sessions` + SSE `event: sessions` payload gains per-pane and per-window `chatProvider`/`chatSessionRef`

## Impact

**Backend + spec only — no frontend work** (Change 3 owns the UI). Touched areas:

- `app/backend/internal/tmux/tmux.go` (+ `tmux_test.go`): paneFormat 8th field, `ChatOption` const, `parseChatRef`, `PaneInfo` fields, reconciliation in `parsePanes`
- `app/backend/internal/sessions/sessions.go` (+ `sessions_test.go`): `WindowInfo` fields, `rollupChat`
- `app/backend/cmd/rk/agent_hook.go` (+ `agent_hook_test.go`): stdin JSON parse (bounded, TTY-guarded), chat stamp write, `stamp` token
- `app/backend/cmd/rk/agent_setup.go` (+ `agent_setup_test.go`): SessionStart registry row
- `docs/specs/agent-state.md`: convention amendment
- `fab/plans/sahil/agent-chat-view.md`: tracking-table row
- API/SSE layer: payload shape changes ride the existing structs; existing JSON-shape tests extended

**Acceptance (from the plan)**: a pane running `claude` carries `@rk_chat` within seconds of session start; a shell/htop pane never does; the field arrives over SSE; Go unit tests (fake process tree / `agentProcessAlive` stub / in-memory settings fixtures, mirroring the existing test patterns); spec updated.

## Open Questions

- Subagent-context hook fires (PreToolUse during Task-tool churn): the docs don't state whether the stdin `session_id` is always the pane's root session or can be a sidechain's. Verify empirically at apply; if sidechain ids appear, restrict stamping to `UserPromptSubmit`/`SessionStart`/`Stop` (Assumption 10 — worst case is a transiently wrong ref that the next main-session fire corrects).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `@rk_chat` pane user option, value `<provider>:<session-ref>`, rk owns the convention; frontend gates on presence, backend routes on prefix | Plan Decision log — binding per pickup protocol | S:90 R:70 A:95 D:90 |
| 2 | Certain | Scope is backend + hooks + spec only; chat stays a view over the pane (no SDK hosting in Go, no SessionStore/DB) | Plan Decision log + anti-decision + Constitution II/VI | S:95 R:80 A:95 D:95 |
| 3 | Confident | Session-ref = **session UUID only**, not the transcript path (and not both) | UUID is the official identity for the supported SDK read APIs; the path is derivable from the UUID (transcript filename IS the UUID — glob `~/.claude/projects/*/<uuid>.jsonl`), so Constitution X says carry only the UUID; colon-free value keeps parsing trivial | S:70 R:55 A:80 D:65 |
| 4 | Confident | Stamp on **every hook fire** (binary reads stdin JSON) **plus** a new SessionStart registry row | Session ids rotate on /clear + /compact (verified) so a one-time stamp goes stale; every-fire ships binary-only to running agents on upgrade; SessionStart alone satisfies "within seconds of session start" before any prompt | S:65 R:60 A:75 D:60 |
| 5 | Confident | SessionStart is **stamp-only** — never writes `@rk_agent_state` | `source=compact` fires mid-turn; an idle write there would clobber a live active state | S:60 R:75 A:85 D:80 |
| 6 | Confident | Clearing = **reader-side reconciliation only**; no writer-side clear, no SessionEnd registration | Reader reconciliation is mandatory anyway (crash/kill paths); SessionEnd adds a settings entry without removing reader logic; mirrors agent-state's no-GC lifecycle | S:65 R:70 A:75 D:55 |
| 7 | Confident | Reconciler does **not** validate the referenced session exists on disk | Per-pane-per-poll stat for a pathological case; live agent ⇒ transcript exists by construction; Change 2's read path surfaces missing transcripts naturally | S:70 R:85 A:80 D:70 |
| 8 | Confident | API shape: per-pane `chatProvider`/`chatSessionRef` (split, pre-parsed) + window-level rollup (active pane first, else first set) | Additive JSON, consumers not built yet (cheap to revise in Change 3); pre-split fields spare every consumer a re-parse; per-pane truth preserved alongside the rollup, mirroring agent-state | S:55 R:85 A:70 D:55 |
| 9 | Confident | Provider prefix = the registry `--agent` name (`claude`); reader validates token shape but tolerates unknown providers | Registry literal already threads through the wrapper; presence-gating is provider-agnostic and adapters (codex/gemini) are additive | S:60 R:80 A:85 D:75 |
| 10 | Tentative | Stdin `session_id` on the registered events is always the pane's root session (subagent fires don't stamp sidechain ids) | Docs are silent on subagent hook payloads; low blast radius (next main fire re-stamps) and empirically verifiable at apply — restrict stamping events if wrong | S:35 R:65 A:40 D:40 |
| 11 | Confident | Stdin read is bounded (LimitReader), single-object `json.Decoder`, TTY-guarded, all-silent failure — never blocks, never fails the agent | Docs don't guarantee stdin EOF semantics; one-object Decode needs no EOF; TTY guard covers manual invocation; preserves the tested never-fail contract | S:55 R:80 A:80 D:70 |

11 assumptions (2 certain, 8 confident, 1 tentative, 0 unresolved).
