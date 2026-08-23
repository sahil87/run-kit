---
type: memory
description: "The operator actuation seam — a templated work item ABOUT a subject window is handed to the server's operator window: closed template registry (fix-tab-name), facts pre-derived from ONE FetchSessions pass, busy-gate reject (no queue), in-process delivery via the chat-send injection engine through the shared `deliverOperatorRequest` core. Two callers: POST /api/windows/{windowId}/operator-request and the SSE-tick auto-name tracker (fires fix-tab-name on busy→idle, rate-limited, busy-skip)."
---
# Operator Actuation

**Domain**: run-kit

## Overview

The operator actuation seam lets run-kit hand the server's operator window (the
`@rk_role=operator` window — [tmux-sessions](/run-kit/tmux-sessions.md) § Operator
Session, [ui/sidebar](/run-kit/ui/sidebar.md) § Operator Pinned Row) a templated
work item ABOUT another window. The loop is **delivery + derive, nothing else**:
the backend composes a prompt from facts it derives itself (Constitution X),
delivers it through the existing chat-send injection machinery
([chat](/run-kit/chat.md) § Send Path), and the operator acts through its own
shell (e.g. `tmux rename-window`); the outcome surfaces on the normal derive
tick. There is NO queue, NO persisted mailbox, NO retry semantics (Constitution
II), and NO response channel or reply parsing — the operator is not an RPC
service. The seam has TWO callers over ONE shared delivery core
(`deliverOperatorRequest` — fact derivation, the busy gate, operator pane
resolution, injection): the user-initiated HTTP handler, and the
system-initiated **auto-name tracker** (`api/auto_name.go`), which rides the
SSE per-server tick beside the waiting-push tracker and fires the
`fix-tab-name` request when a subject window transitions busy→idle — run-kit
owns the derivable trigger, the operator owns the rename judgment. Everything
lives in `app/backend/api/operator.go` (handler + registry + delivery core)
and `app/backend/api/auto_name.go` (tracker), the route registered in
`api/router.go` beside the chat routes. Nothing in any existing UI request
path routes through the operator — operator features degrade to **absent**
when no operator runs, never to blocking (the inside/outside razor).

## Requirements

### Requirement: Endpoint contract + closed template registry
The backend SHALL expose `POST /api/windows/{windowId}/operator-request?server={server}`
(mutation ⇒ POST, Constitution IX), implemented as `handleOperatorRequest`
(`api/operator.go`). `{windowId}` is the **subject** window — the window the
request is about. The JSON body is `{"template": "<id>"}` and carries NOTHING
else: no client-supplied text can ever reach the rendered prompt (Constitution
I). The handler MUST validate `{windowId}` via `parseWindowID` (400 on
malformed), reject an undecodable body (400), and check the template id against
the closed in-code registry `operatorTemplates` (`map[string]operatorTemplate`
— each entry a declared `requiresChatRef` fact requirement plus a PURE
`render func(operatorFacts) string`, plain string composition, no
`text/template`) — an unknown id is a 400 naming it (the `/options`
key-allowlist posture).

#### Scenario: Invalid input is rejected before any session fetch
- **GIVEN** a request with a malformed `{windowId}`, an undecodable body, OR a
  template id not in the registry
- **WHEN** the handler runs
- **THEN** it returns `400` with a `writeError` JSON body and performs no
  session fetch and no tmux call.

### Requirement: Single-FetchSessions resolution of subject + operator
The handler SHALL resolve everything server-side from ONE
`s.sessions.FetchSessions(ctx, server)` call: the subject window by `WindowID`
and the operator window as the window with `Role == "operator"` (the
server-scoped radio). A `FetchSessions` error maps to `500` (an infrastructure
fault, mirroring the chat endpoints); an absent subject maps to `404`; no
operator window on the server maps to `404` with `"no operator on this
server"` — the UI hides the action in that state (degrade to absent), so the
error is the race backstop. The handler MUST NOT call `resolveWindowChat`
(which would issue a second `FetchSessions`); pane resolution reuses
`sessions.ResolveChatPane` on the already-fetched windows. Subject and operator
are then handed ALREADY RESOLVED to the shared delivery core
(`deliverOperatorRequest`), which performs no fetch of its own — the auto-name
caller passes windows straight from the tick's sessions snapshot.

#### Scenario: No operator on the server
- **GIVEN** a server whose sessions contain no window with `Role == "operator"`
- **WHEN** the handler resolves
- **THEN** it returns `404` `"no operator on this server"` and performs no
  injection.

### Requirement: Server-side fact pre-derivation
The delivery core SHALL derive the template facts (`operatorFacts`) server-side —
all derivable (Constitution X): the subject's `windowId` (`@N`), current `Name`,
`WorktreePath`, `FabChange`/`FabStage` (rendered only when `FabChange` is
non-empty), and — for a template declaring `requiresChatRef` — the transcript
JSONL absolute path resolved from the subject's reconciled
`ChatProvider`/`ChatSessionRef` via `chat.TranscriptPath` (the exported
`TranscriptLocator` seam — [chat](/run-kit/chat.md) § Adapter interface +
provider registry). A subject with no reconciled chat session is a 404-class
error (`"no chat session for this window"`); an unresolvable transcript
(`ErrInvalidRef`/`ErrTranscriptNotFound`) maps through `writeChatReadError`,
the same 404-class vocabulary as the chat read endpoints; `ErrNoAdapter` is a
404 naming the provider.

#### Scenario: Subject without a resolvable transcript
- **GIVEN** a subject window whose reconciled chat ref is empty or whose
  transcript cannot be located
- **WHEN** facts are derived
- **THEN** the response is a 404-class `writeError` and no injection occurs.
- **AND GIVEN** a resolvable ref, **THEN** the rendered prompt contains the
  windowId, name, absolute JSONL path, and worktree path.

### Requirement: Busy gate on the operator's agent state — reject, never queue
The delivery core SHALL read the operator window's rolled-up `AgentState`
(already on the same `FetchSessions` result) BEFORE delivering. `active` or
`waiting` ⇒
`409` with a structured message naming the state (`"operator is busy (<state>)
— request not delivered; try again when it is idle"`). `idle` or empty/unknown
⇒ proceed — the novelty echo probe remains the final fail-closed guard, exactly
as for chat-send. This is deliberately UNLIKE chat-send's allow+probe busy
policy ([chat](/run-kit/chat.md) § Design Decisions → Allow + probe busy
policy): a request is work handed over, not a steer a human typed. There SHALL
be NO queue, NO retry, and NO state written anywhere (Constitution II).
Failures the HTTP handler maps to a status+body (this 409 included) surface
from the core as a typed `operatorReject{status,msg}` sentinel the handler maps
back byte-identically; transcript-resolution and injection errors return RAW so
the handler's `errors.Is`/`errors.As` mappings (`writeChatReadError`
vocabulary, `inject.ProbeFailure` → 409) hold unchanged. The auto-name caller
logs whatever comes back at debug and drops it.

#### Scenario: Busy operator rejects without touching tmux
- **GIVEN** an operator window whose rollup state is `active` (or `waiting`)
- **WHEN** a request arrives
- **THEN** the response is `409` naming the state and no injection subprocess
  runs.
- **AND GIVEN** state `idle` or empty, **THEN** delivery proceeds.

### Requirement: Delivery through the shared injection engine, in-process
The delivery core SHALL deliver the rendered prompt in-process via
`s.injectChatMessage(ctx, server, operatorPaneID, prompt, true)` — the same
`api`-package seam chat-send uses, NOT an HTTP self-call — where
`operatorPaneID` is `sessions.ResolveChatPane(operator.Panes)` over the
OPERATOR window's panes (active-pane-first rollup; injection targets the pane,
never the window, never the subject's pane). An operator window with no
reconciled chat pane ⇒ `404` (`"operator window has no chat session"` — an
operator that isn't a live agent can't receive requests). The engine's existing
semantics apply unchanged: handler-boundary sanitize, per-(server,paneID)
whole-sequence lock, ONE shared deadline (`chatSendTotalBudget`, applied
INSIDE the core so both callers get identical injection bounding) threading all
subprocesses, and the novelty echo probe; a probe failure surfaces as the same
structured `409` chat-send returns (`inject.ProbeFailure` — text pasted, Enter
withheld, recoverable). Success is `200 {"ok":true}`. The handler MUST NOT wake
the SSE hub: rk mutated no tmux state, and the operator's later actuation (e.g.
`rename-window`) surfaces via the normal derive tick.

#### Scenario: Delivery targets the operator's resolved pane
- **GIVEN** an idle operator whose resolved chat pane is `%7`
- **WHEN** delivery runs
- **THEN** every injection subprocess targets `%7`, the sequence is baseline →
  set-buffer → paste → probe → Enter, and the response is `200 {"ok":true}`.
- **AND GIVEN** the probe fails, **THEN** no Enter is sent and the response is
  the structured `409`.

### Requirement: The `fix-tab-name` template
The registry's `fix-tab-name` entry SHALL declare `requiresChatRef: true` and
render a self-contained prompt (the operator needs no rk-specific knowledge)
that names the subject by `@N` (an id that survives moves and is
collision-proof vs name targets), hands the operator the transcript path to
read (the chat JSONL, never capture-pane — agent TUIs run alt-screen with zero
scrollback), gives the worktree and — only when `FabChange` is non-empty — the
fab change + stage context, names the exact actuation command
(`tmux rename-window -t {windowId} "<new-name>"`, 2-4 words, kebab-case
preferred), instructs the operator to DO NOTHING when the current name already
accurately describes the work (the no-op judgment belongs to the operator, not
to run-kit — the inside/outside razor), and explicitly bounds the operator's
action ("Do not reply to this message or take any other action").

#### Scenario: Rendered prompt carries the derived facts
- **GIVEN** the derived facts for window `@5` named `zsh` with a resolvable
  transcript
- **WHEN** the template renders
- **THEN** the prompt names `@5`, the current name, the absolute JSONL path,
  the worktree, the exact `tmux rename-window -t @5` command, the
  already-accurate⇒do-nothing clause, and the do-not-reply bound; with an empty
  `FabChange` no fab clause appears.

### Requirement: Auto-name on idle — the system-initiated caller
The backend SHALL run an in-memory `autoNameTracker` (`api/auto_name.go`) on
the SSE per-server tick — advanced synchronously right after the waiting-push
block, a structural sibling of `waitingPushTracker` (own mutex, clock seam,
injected `deliver` closure, post-loop `retain`) — that observes every window's
rolled-up `AgentState` and detects the per-window transition **busy → idle**
(busy = `active` or `waiting`; idle = exactly `idle`; empty/unknown is neither
— a window with no agent hooks never triggers, and a first-ever observation or
a `""`→`idle` tick is not a transition). A candidate SHALL be dropped unless
ALL hold, derived from the same tick's snapshot with NO second `FetchSessions`:
the server HAS an operator window (`Role == "operator"`), the subject is NOT
the operator window, and the subject carries a non-empty `ChatSessionRef`. Rate
limits: a 15-minute per-window cooldown (`autoNameCooldown`), a 60-second
per-server min-gap (`autoNameMinGap` — the operator's `AgentState` lags a
delivery by a hook round-trip, so back-to-back transitions must not
double-deliver), and at most ONE delivery per server per tick (excess
candidates dropped UNSTAMPED, so their next transition may fire). Both limits
stamp at DECISION time on every attempt — including one the delivery core later
skips on a busy operator — so a busy operator never converts deferred
transitions into a later burst; ineligible transitions are consumed unstamped.
Delivery runs in a DETACHED `context.Background()` goroutine through the shared
core (the tick never blocks on injection, mirroring `notifyWaiting`); errors —
the routine busy-skip included — are logged at debug and dropped. State is
process-memory only (a daemon restart forgets cooldowns, Constitution II) and
reaped on the post-loop retain seam, scoped to successfully-polled-or-dead
servers exactly like `waitingPushTracker.retain`. The feature is strictly
OPT-IN: the `auto_name` key in the settings store (`internal/settings`,
`~/.config/run-kit/config.yaml` — tolerant `ParseBool` read, default off, serialized
only when true), seeded as `Server.autoNameEnabled` from `settings.Load()` at
construction, so a toggle applies on the next daemon restart; when disabled,
`initSSEHub` nils the hub's tracker, the feature-absent state both tick sites
(advance, retain) already check. There is deliberately NO `RK_AUTO_NAME` env
var — env is deployment bootstrap, not a settings channel (see
`fab/plans/sahil/26-08-22-config-consolidation.md`, which also owns making the
key apply live). When enabled, the trigger still requires an operator window
on the server — no operator ⇒ nothing fires, nothing logs at error level
(degrade to absent).

#### Scenario: Transition detection and eligibility
- **GIVEN** a window whose previous tick state was `active` (or `waiting`)
- **WHEN** the current tick derives its rollup as `idle`
- **THEN** the tracker emits a candidate for that window; `idle`→`idle`,
  `""`→`idle`, and first-observation ticks emit nothing.
- **AND GIVEN** a transition on a chatless window, on the operator window
  itself, or on an operator-less server, **THEN** no delivery is attempted and
  the transition is consumed unstamped.

#### Scenario: Rate limits bound a flapping window
- **GIVEN** a window that fired an auto-request 5 minutes ago
- **WHEN** it transitions busy→idle again
- **THEN** no delivery is attempted (cooldown).
- **AND GIVEN** two eligible windows transitioning in the same tick, **THEN**
  exactly one is emitted and the other is dropped unstamped.
- **AND GIVEN** an operator busy at delivery time, **THEN** the core skips (no
  injection, no queue, no retry) and the window's cooldown stays stamped.

### Requirement: Frontend availability — degrade to ABSENT, never disabled
The "Fix tab name" affordance — the flyout's `FixTabNameActionRow`
([ui/status-signals](/run-kit/ui/status-signals.md) § Row-hover register flyout
card) and the palette's `Tab: Fix name (ask operator)` entry
([ui/keyboard-and-palette](/run-kit/ui/keyboard-and-palette.md) § Command
Palette Actions) — SHALL render only when (a) the server has an operator window
(`role === "operator"` present in the sessions payload), (b) the subject window
carries a non-empty `chatSessionRef` (the template needs its JSONL transcript),
and (c) the subject is not itself the operator window (the pure
`canRequestFixTabName(win, hasOperator)` rule in `row-flyout-card.tsx`). All
three facts already ride the sessions payload; an unavailable action is
OMITTED, never disabled. The client call is
`sendOperatorRequest(server, windowId, template)` (`api/client.ts` — the
`withServer` + `throwOnError` shape, so the structured 409/404 messages surface
as the thrown Error's message), fired once per click cycle behind the row's
in-flight guard; success toasts `"Sent to operator — tab will rename shortly"`,
failure toasts the server's message. No spinner beyond the guard — the rename
arrives via the normal SSE derive tick.

#### Scenario: Gating and single-flight
- **GIVEN** a window row on a server with an operator and a chat-carrying
  subject
- **WHEN** the flyout opens and "Fix tab name" is clicked
- **THEN** exactly one `sendOperatorRequest` fires (re-clicks during flight are
  no-ops) and a success toast appears.
- **AND GIVEN** no operator on the server, OR a subject without
  `chatSessionRef`, OR the operator's own row, **THEN** the row and the palette
  entry are absent (not disabled).

## Design Decisions

### Delivery + derive only — no queue, no response channel
**Decision**: the actuation loop composes a templated prompt with pre-derived
facts and delivers it via the chat-send injection machinery; results come back
through the ordinary derive loop. There is no response channel, no protocol, no
reply parsing, no queue, no persisted mailbox, no retry.
**Why**: a request queue or operator mailbox is persistent state with retry
semantics (Constitution II rejects it); a response channel would turn the
operator into an RPC service and require reply parsing. The operator acts
through its shell and the result arrives through the derive loop rk already
runs — run-kit owns the derivable and deterministic; the operator owns judgment
over content (Constitution II/X).
**Rejected**: a request queue/mailbox (Constitution II); a response channel or
reply protocol (RPC-ifies the operator); naive `send-keys` Enter injection
(known-flaky into agent TUIs — the chat-send machinery already solved
delivery).
*Introduced by*: 260822-fih1-operator-request-fix-tab-name

### In-process reuse of the chat-send injection path
**Decision**: the handler calls `s.injectChatMessage` +
`sessions.ResolveChatPane` directly (same `api` package) after its own single
`FetchSessions` pass.
**Why**: an HTTP self-call would re-enter the router for no isolation gain;
calling `resolveWindowChat` would issue a second `FetchSessions` per request.
One fetch serves subject lookup, operator lookup, fact derivation, AND the busy
gate.
**Rejected**: HTTP self-call (needless hop, loses the request context);
`resolveWindowChat` reuse (double fetch — the helper is window-scoped, this
handler is two-window).
*Introduced by*: 260822-fih1-operator-request-fix-tab-name

### Busy = `active` OR `waiting`; unknown proceeds
**Decision**: reject on `active`/`waiting`; deliver on `idle` or empty state.
**Why**: `waiting` means a human-blocking dialog is up — pasting into it is the
exact blind-typing hazard the probe exists for; empty state must pass or an
operator whose hooks haven't fired is permanently unreachable (the probe still
fail-closes delivery).
**Rejected**: idle-only (strands hookless operators); active-only-busy (types
into permission dialogs).
*Introduced by*: 260822-fih1-operator-request-fix-tab-name

### Optional `TranscriptLocator` capability, not an Adapter interface change
**Decision**: the transcript path is exposed as an optional interface the
claude adapter implements, reached via `Lookup` + type-assert behind the
package-level `chat.TranscriptPath`.
**Why**: the core `Adapter` interface stays provider-neutral (a future
protocol-based provider may have no on-disk transcript); the guard-bearing
`locateTranscript` stays the single path-resolution site.
**Rejected**: widening the `Adapter` interface (forces a meaningless method on
non-file providers); exporting `locateTranscript` bare (loses provider
routing).
*Introduced by*: 260822-fih1-operator-request-fix-tab-name

### Mirror waitingPushTracker rather than a new observer framework
**Decision**: the auto-name tracker is a sibling of `waitingPushTracker` — own
file, own mutex, clock + delivery func seams for tests, advanced synchronously
in the per-server tick, fan-out detached.
**Why**: the seam already exists, is Constitution-II-vetted ("no durable store
beyond the hub's episode map"), and its test pattern (pure decision function)
is proven.
**Rejected**: a generic transition-observer registry (speculative abstraction
for a second consumer); a separate polling goroutine (duplicate FetchSessions
cost, drift from the hub's snapshot).
*Introduced by*: 260822-q675-operator-auto-name-idle

### Delivery seam is an injected closure, not a hub→Server reference
**Decision**: the tracker holds a `deliver func(...)` seam (as
`waitingPushTracker` holds `notify`); the Server wires a closure over the
shared delivery core post-construction in `initSSEHub` (the `newSSEHub`
constructor can't see the Server — test hubs run with `deliver == nil`,
tracking still advancing, fan-out skipped).
**Why**: keeps the tracker pure/unit-testable and avoids a hub→Server cycle;
identical to the waiting-push `notify` seam.
**Rejected**: calling `s.injectChatMessage` directly from the tracker (couples
tracker tests to the injection engine).
*Introduced by*: 260822-q675-operator-auto-name-idle
