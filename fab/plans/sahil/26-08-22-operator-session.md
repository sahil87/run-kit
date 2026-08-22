# Operator session — physical promotion + the control-room feature surface

> Backlog detail doc — written 2026-08-22 after a discussion session on the operator
> window's cosmetic hoist and what a real operator "home" enables. Assumes the fab-kit
> companion plan (`fab-kit: fab/plans/sahil/pane-identity-keying.md`) has landed: pane
> identity keyed `%pane_id`+socket / `window_id`, session:index declared display-only,
> dispatch restart-alias hole closed, `.status.yaml` subset recorded as cross-repo
> contract. That plan is what makes relocating the operator window safe fab-side.
> Verify file/line anchors before implementing.

## Problem

The operator window (`@rk_role=operator`, server-scoped radio — `api/windows.go:474`)
is hoisted to a pinned sidebar row (`components/sidebar/index.tsx:2315`) but physically
stays at its old index in its work session. Display order and tmux traversal order
disagree: cycling windows in a 5-window session where the operator was index 3 goes
1, 2, jump-to-operator, 4, 5. The hoist is cosmetic; the fix is to make it physical.

## Design decisions (from the discussion)

- **The move is physical, and the trigger is the role-set moment** — not a detector
  loop. `@rk_role=operator` is already an explicit mutation (the radio even clears
  sibling windows), whether set from the UI or by fab-operator's startup self-mark.
  Relocation becomes part of what assigning the role means. No
  run-kit-mutates-your-tmux-behind-your-back surprise.
- **Session name: `_rk-operator`** (per tmux server; the role is a per-server radio, so
  it holds one window per server today). The `_rk-` prefix is the existing infra-session
  convention (`_rk-pin-*` board pin-sessions are already filtered); a bare `operator`
  session invites the tmux bare-target session/window collision (`-t operator` is a
  WINDOW target). All tmux targeting uses `=name:` / `$N` / `@N` forms.
- **Visibility: session hidden, window visible.** The pinned operator row stays the sole
  UI face — visible UX unchanged, topology underneath becomes honest. The session is
  filtered from the normal session list **by content, not by name**: hidden only while
  every window in it carries the operator role, so a stray or demoted window can never
  become invisible.
- **Demotion needs a destination.** Role-clear moves the window back out (cwd-basename
  conventional session; the original session may be gone). One-way auto-promote +
  explicit demote only — the role is set by intent, so only intent clears it; an agent
  process exiting does NOT auto-demote (no yo-yo).
- **Why the move is cheap here**: run-kit is windowId (`@N`) keyed end-to-end and `@N`
  survives `move-window` (relay, pinned row, URL all hold); `MoveWindow` with
  active-window preservation already exists in the tmux layer.
- **The inside/outside razor** (Constitution II/X applied to features): run-kit owns
  everything derivable and deterministic; the operator owns everything requiring
  judgment over content. Operator features must degrade to *absent* when no operator
  runs — never to blocking. Nothing in the UI request path routes through the operator.
- **The actuation loop is delivery + derive, nothing else.** run-kit's only integration
  seam is: compose a templated prompt with pre-derived facts, deliver it to the operator
  pane via the existing chat-send machinery (sanitize, named-buffer paste, novelty echo
  probe, probe-gated Enter — naive Enter injection into agent TUIs is known-flaky). The
  operator acts through its shell (`tmux rename-window`, `rk`, `fab`); results come back
  through the ordinary derive loop. No response channel, no protocol, no reply parsing.
- **Busy gate, no queue (v1).** Check `@rk_agent_state` before delivering; busy operator
  ⇒ reject with a toast. A request queue is a state store with retry semantics —
  Constitution II will rightly fight it.
- **Transcript source is the chat JSONL, never capture-pane** — agent TUIs run
  alt-screen with zero scrollback; the chat subsystem's adapter already parses the JSONL.
  Prompts hand the operator the JSONL path (or pre-extracted recent turns).

## Changes

### Phase 1 — physical promotion (fixes the navigation jump)

1. **Promote on role-set**: the role endpoint (`api/windows.go` role POST), on setting
   `operator`, ensures `_rk-operator` exists on that server (detached create) and
   `move-window`s the target window into it. Same seam handles fab-operator's self-mark
   (it rides the same option/endpoint path).
2. **Demote on role-clear**: move the window out to its cwd-basename conventional
   session (create if missing), then apply the existing radio-clear semantics.
3. **Hide the session**: filter `_rk-operator` from session enumeration for the normal
   sidebar list while (and only while) all its windows carry the operator role. Reuse
   the pin-session filtering seam.
4. **Sidebar**: the pinned operator row logic (`sidebar/index.tsx:2315`) keeps working —
   it keys on `role === "operator"` + windowId, not on session. Verify the roving row
   order and arrow-nav still reach it; drop any now-dead "filter it out of its home
   group" special-casing once the home group no longer contains it.
5. **Edge cases**: `exit-empty` interaction (an extra long-lived session is benign, but
   confirm the ephemeral-churn reaper never sweeps `_rk-operator`); snapshot/restore
   (layout snapshots must capture and restore the session + role option); dispatch pane
   workers spawned beside the operator now live in `_rk-operator` — acceptable, their
   cwd is the worktree (fab-side keying is safe per the assumed fab-kit plan).
6. **Tests**: backend role-endpoint move/demote/collision tests; e2e — cycling a
   work session skips the promoted operator; pinned row still navigates; demoted window
   reappears in a visible session.

### Phase 2 — the actuation seam (one reusable primitive)

7. **`POST` operator-request endpoint**: given a template id + windowId, run-kit
   pre-derives the facts (windowId, window name, JSONL path, worktree, change/stage),
   renders the prompt, gates on `@rk_agent_state` (busy ⇒ 409-style reject, toast in
   UI), and delivers via the chat-send machinery to the server's operator pane.
   No new state; no queue.
8. **First consumer — "Fix tab name"**: per-window action (window row menu + palette)
   that asks the operator to read the tab's recent JSONL turns and `tmux rename-window`
   it to something accurate. Result arrives via the normal derive tick.

### Phase 3 — control-room features (each is just a prompt template or a rk verb)

Operator-side (judgment — ride the Phase 2 seam):

9. **Auto-name on idle**: on a window's busy→idle transition (already tracked), enqueue
   a rename request for that window. Rate-limited; skip if the operator is busy.
10. **Brief me / standup digest**: one action — summarize every tab (state, waiting on
    what, suggested next action; waiting-on-me first) into the operator window.
11. **What's stuck?**: operator inspects waiting tabs' pending question text (hook-pushed
    per Principle X), answers routine ones (trust dialogs — fab-operator autopilot's
    existing role), escalates the rest via `rk notify`. This is the agent-state
    ownership split's deferred "UI surfacing" arriving.
12. **Spawn routing**: compose box on the operator row (the `?view=chat` lens is nearly
    free) — typed task goes to the operator, which picks worktree/preset and spawns via
    `rk riff`.
13. **Retire a tab**: "summarize and close" — operator writes a close-out note (fab
    change or `idea`), then kills the window.
14. **Semantic search across tabs**: "where did we discuss X" over the JSONL corpus.

run-kit-side (mechanical — explicitly NOT routed through the operator):

15. **Sort tabs by status/date**: deterministic `move-window` batch ordered by the
    status pyramid (PR > fab > agent > tmux) or window creation time. A UI verb, not a
    standing auto-sort (respects the derived-order + drag-override sidebar model).
16. **Literal search across tabs**: grep over the JSONL corpus (capture-pane is
    viewport-only for alt-screen panes) surfaced in the palette.
17. **Conflict watch**: derive two-tabs-on-same-branch/worktree and badge it — detection
    is mechanical; only an optional "is this actually a problem" escalation would touch
    the operator.

## Non-goals / guardrails

- No detector loop that moves windows on its own; promotion rides role-set only.
- No operator dependency in any UI request path (sort, filter, search-literal, status).
- No request queue, no persisted operator mailbox (Constitution II).
- No destructive batch actions (retire, kill) without per-action confirmation.
- Multi-window operator sessions, cross-server consolidation, and making the operator
  session user-visitable as a session group: out of scope until the single-window shape
  proves out.

## Sequencing

Phase 1 stands alone and pays for itself (the navigation bug). Phase 2 is the smallest
useful slice of the feature surface and should ship with exactly one consumer (#8).
Phase 3 items are independent of each other; #9 (auto-name on idle) is the highest-value
next slice. #15–17 need neither Phase 1 nor 2 and can ship anytime.
