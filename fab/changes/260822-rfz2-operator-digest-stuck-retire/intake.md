# Intake: Operator Digest, Stuck Triage & Retire

**Change**: 260822-rfz2-operator-digest-stuck-retire
**Created**: 2026-08-22

## Origin

> Implement Phase 3 (control-room features) of `fab/plans/sahil/operator-session.md`, items 10, 11 and 13, riding the Phase 2 operator-request seam (PR #709, merged): **(10) brief me / standup digest** — one action that summarizes every tab (state, waiting-on-what, suggested next action, waiting-on-me first) into the operator window; **(11) what's stuck** — operator inspects waiting tabs' pending question text, answers routine ones, escalates the rest via `rk notify`; **(13) retire a tab** — summarize-and-close writes a close-out note (fab change or idea) then kills the window.

One-shot `/fab-new` invocation covering plan items 9–15, split into four changes along structural seams (user-authorized split). This change groups the three **closed-template, no-client-text** judgment actions — the ones that extend the registry without changing the seam's trust posture. Siblings: `260822-q675-operator-auto-name-idle` (item 9), `260822-wyn3-operator-compose-spawn-search` (items 12/14, the client-text lane), `260822-ga8z-sort-tabs-status-date` (item 15, mechanical).

## Why

Phase 2 proved the actuation loop with exactly one consumer (`fix-tab-name`). The control-room value is in the registry growing: today the user must visit each tab to know its state, must notice waiting tabs themselves (the waiting-push notification tells them *that*, not *what for*), and must hand-write close-out notes before killing a finished tab. These three actions are the judgment work an operator agent is for — reading transcripts and summarizing, triaging permission prompts, writing retirement notes — and none of them need anything beyond a rendered prompt plus the operator's own shell (`rk mux send`, `rk notify`, `idea`, `tmux kill-window`). If we don't build them, the seam stays a one-trick novelty. Why this grouping: all three keep the seam's strongest security property intact — the body carries ONLY a closed-set template id, no client text can ever reach the rendered prompt (Constitution I) — so they ship together without touching that posture; the two items that need user text are deliberately a separate change.

## What Changes

### Backend: server-scoped operator requests (the seam's one structural extension)

The Phase 2 endpoint is subject-window-scoped: `POST /api/windows/{windowId}/operator-request`. Items 10 and 11 have no single subject — their subject is *the whole server*. Extend the registry entry shape with a declared scope (`window` | `server`) and add a server-scoped route, e.g. `POST /api/operator-request?server={server}` (Constitution IX: mutation ⇒ POST; body stays `{"template": "<id>"}` and nothing else). The handler shape mirrors `handleOperatorRequest` (`app/backend/api/operator.go`): ONE `FetchSessions` pass resolves the operator (Role == "operator"), applies the same busy gate (`active`/`waiting` ⇒ 409, idle/empty proceeds), and delivers via `s.injectChatMessage` to `sessions.ResolveChatPane(operator.Panes)` — all semantics documented in `run-kit/operator-actuation.md` apply unchanged (no queue, no response channel, no SSE wake).

Server-scoped fact derivation (`operatorServerFacts`, all derivable — Constitution X): a per-window fact table over every window on the server EXCLUDING the operator window itself, each row carrying windowId (`@N`), name, session name, rolled-up `AgentState` + duration, `FabChange`/`FabStage` when present, PR status rollup when present, and — for chat-carrying windows — the transcript JSONL absolute path via `chat.TranscriptPath` (a window whose transcript fails to resolve is included WITHOUT a path, never an error: one broken ref must not kill a whole-server digest; note the omission in the rendered row).

### Template `brief-me` (server-scoped)

Renders a standup-digest prompt: for each listed window, read the transcript tail (the JSONL path — never capture-pane; agent TUIs run alt-screen with zero scrollback) and produce a one-line-per-tab digest — current state, what it's waiting on (if waiting), and a suggested next action — ordered **waiting-on-me first**, then active, then idle. The operator writes the digest as its own reply in its own window (the user reads it by switching to the operator tab — there is no response channel). Bounds: read-only; take no actions on other windows; do not rename, kill, or send keys anywhere.

### Template `whats-stuck` (server-scoped)

Renders a triage prompt over ONLY the `waiting` windows in the fact table (rendered server-side — the template filters at render time; zero waiting windows ⇒ the endpoint returns a 409-class structured error "nothing is waiting" rather than delivering a no-op prompt — exact status is plan-stage). For each waiting tab: read the transcript tail to find the pending question. **Routine** prompts (trust/permission dialogs, yes/no confirmations with an obvious safe answer — the judgment fab-operator autopilot already exercises) may be answered directly via `rk mux send <pane> "<answer>"` (the prompt names the exact verb). Everything else is **escalated, never answered**: `rk notify --title "<window>: stuck" "<the pending question>"` (exact flag surface per `rk notify --help` at apply time). Bounds: never answer credential/login prompts, destructive confirmations, or anything ambiguous — escalate those.

### Template `retire-tab` (window-scoped, `requiresChatRef: true`)

Rides the EXISTING window-scoped endpoint — one new registry entry. Renders: read the subject's transcript, write a close-out note capturing what was done/decided/left open — via `idea "<note>"` (backlog) or, when the window carries a fab change (`FabChange` fact non-empty), noting against that change — operator's judgment which fits; then `tmux kill-window -t {windowId}`. This is the seam's first DESTRUCTIVE template; the plan's guardrail is explicit: "No destructive batch actions (retire, kill) without per-action confirmation" — the confirmation lives in the frontend (below), and the template itself instructs the operator to kill exactly the named `@N` window and nothing else.

### Frontend

- **Palette** (`Cmd+K`, Constitution V): `Operator: Brief me` and `Operator: What's stuck` — rendered only when the server has an operator window (`role === "operator"` in the sessions payload); absent otherwise, never disabled (the Phase 2 gating pattern). `Tab: Retire (ask operator)` follows `fix-tab-name`'s exact gating triple: operator exists + subject has `chatSessionRef` + subject is not the operator (reuse/extend the pure `canRequestFixTabName`-style rule in `row-flyout-card.tsx`).
- **Row flyout**: a `Retire…` action row beside the existing `FixTabNameActionRow`.
- **Confirmation**: retire is confirm-gated per action — a small confirm dialog ("Ask the operator to summarize and close this tab? The window will be killed.") using the existing dialog patterns; brief-me and what's-stuck are non-destructive and fire directly.
- **Client**: `api/client.ts` gains the server-scoped call (e.g. `sendServerOperatorRequest(server, template)`) alongside the existing `sendOperatorRequest(server, windowId, template)`; both `withServer` + `throwOnError` so structured 409/404 messages surface in failure toasts. Success toasts name where the result lands ("Sent to operator — digest will appear in the operator tab").

### Tests

- Go: registry/scope validation (server-scoped template on the window route and vice versa ⇒ 400), server-facts derivation (operator excluded, broken transcript ref degrades to path-omitted row), zero-waiting whats-stuck rejection, busy gate on the new route, rendered-prompt content assertions per template (mirroring the existing `operator_test.go` fix-tab-name assertions).
- Frontend: unit tests for palette gating + retire confirm flow; Playwright e2e with companion `.spec.md` (constitution) for the palette entries and the retire confirm→toast path, mocking `**/api/operator-request*` and the window route **with trailing `*`** (withServer appends `?server=` — a no-star mock silently falls through to live tmux).

## Affected Memory

- `run-kit/operator-actuation`: (modify) server-scoped request shape, the three new registry entries with their bounds, the destructive-template confirmation rule
- `run-kit/ui/keyboard-and-palette`: (modify) the three palette actions and their gating
- `run-kit/ui/status-signals`: (modify) the retire flyout row beside fix-tab-name

## Impact

- `app/backend/api/operator.go` (+ router registration for the server-scoped route), `operator_test.go`
- `app/frontend/src/api/client.ts`, `row-flyout-card.tsx`, command-palette registration, a confirm dialog, toasts
- `internal/chat` untouched (TranscriptPath reused); injection engine untouched
- Depends on nothing in the sibling changes; the auto-name change (q675) plans to extract an internal delivery core from `handleOperatorRequest` — whichever lands second rebases over a small refactor in the same file

## Open Questions

- Does `whats-stuck`'s "answer routine ones" bound need to be tighter for v1 (escalate-everything, answer nothing) until the operator's judgment is trusted? (Current decision: keep the plan's answer-routine posture with the hard never-answer list — see Assumptions #4.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | All three items are closed registry templates — the body never carries client text; delivery/busy-gate/no-queue semantics unchanged from Phase 2 | The plan says items ride the seam; the seam's contract is documented memory | S:90 R:85 A:95 D:90 |
| 2 | Confident | Server-scoped requests get a sibling route `POST /api/operator-request?server=` with registry-declared scope, mirroring the window handler | The two items have no subject window; smallest extension preserving the endpoint vocabulary; route naming trivially adjustable at plan/review | S:70 R:80 A:80 D:65 |
| 3 | Confident | Broken transcript refs in server-scoped facts degrade to a path-omitted row; zero-waiting `whats-stuck` rejects instead of delivering | A whole-server digest must not fail on one bad ref; delivering a no-op prompt wastes the operator | S:60 R:85 A:80 D:70 |
| 4 | Confident | `whats-stuck` keeps the plan's answer-routine-escalate-rest posture, with a hard never-answer list (credentials, destructive confirms, ambiguity) in the template | Plan is explicit ("answers routine ones... escalates the rest via rk notify"); the never-answer list mirrors the pane-gate escalation rules | S:80 R:75 A:75 D:70 |
| 5 | Certain | Retire is per-action confirm-gated in the frontend before the request is sent | Plan guardrail verbatim: no destructive actions without per-action confirmation | S:90 R:90 A:95 D:95 |
| 6 | Certain | Digest/answers surface in the operator's own window only; success toasts say so; no navigation, no response channel | The seam has no response channel by design (memory DD); plan says "into the operator window" | S:80 R:85 A:85 D:80 |
| 7 | Confident | Close-out note verb: `idea` for changeless windows, note-against-the-fab-change when `FabChange` is present, operator's judgment which | Plan says "fab change or idea" without choosing; delegating the choice to the operator fits the razor but the fab-change-note mechanics are underspecified | S:45 R:70 A:55 D:45 |

7 assumptions (3 certain, 4 confident, 0 tentative, 0 unresolved).
