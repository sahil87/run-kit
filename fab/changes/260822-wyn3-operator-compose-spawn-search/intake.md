# Intake: Operator Compose — Spawn Routing & Semantic Search

**Change**: 260822-wyn3-operator-compose-spawn-search
**Created**: 2026-08-22

## Origin

> Implement Phase 3 (control-room features) of `fab/plans/sahil/operator-session.md`, items 12 and 14, riding the Phase 2 operator-request seam (PR #709, merged): **(12) spawn routing** — a compose box on the operator row where a typed task goes to the operator, which picks worktree/preset and spawns via `rk riff`; **(14) semantic search across tabs** — "where did we discuss X" over the JSONL corpus.

One-shot `/fab-new` invocation covering plan items 9–15, split into four changes along structural seams (user-authorized split). This change is the **client-text lane**: both items require a user-typed string (a task description, a search query) to reach the operator — the one thing the Phase 2 seam deliberately forbids for its closed templates. Grouping them isolates that trust-posture extension in a single reviewable change. Siblings: `260822-q675-operator-auto-name-idle` (item 9), `260822-rfz2-operator-digest-stuck-retire` (items 10/11/13, closed templates), `260822-ga8z-sort-tabs-status-date` (item 15, mechanical).

## Why

Item 12: the direct spawn dialog already exists (backlog [sbk1], shipped — `POST /api/riff`, palette "Agent: Spawn"), but it makes the USER pick everything (session/worktree/preset). The control-room version inverts that: describe the task, let the operator pick where it runs and how — judgment routing. That's frequently what you want when firing off a task from your phone: you know *what*, the operator knows *where*. Item 14: "where did we discuss X" is unanswerable today without manually opening tabs — capture-pane is viewport-only for alt-screen panes, so only the JSONL corpus holds the history, and *semantic* search over it (as opposed to the plan's item 16, mechanical grep) is operator judgment by definition. Both die without a sanctioned way to hand the operator a user-typed string; building that lane once, with explicit bounds, is better than two ad-hoc holes in the closed-registry posture.

## What Changes

### Backend: the `acceptsText` template lane

Registry entries (`operatorTemplates`, `app/backend/api/operator.go`) gain a declared `acceptsText bool`. The request body gains an optional `"text"` field: `{"template": "<id>", "text": "<user string>"}`. Rules, enforced in the handler before any fetch:

- `text` on a template that doesn't declare `acceptsText` ⇒ 400 (the closed posture is the default; Phase 2 templates are unchanged).
- An `acceptsText` template with empty/whitespace-only `text` ⇒ 400 (these templates are meaningless without it).
- Length cap on `text` (suggested 4 KiB) ⇒ 400 over cap; the string is passed to the render func as an opaque value and placed in the prompt inside a clearly delimited block (e.g. fenced), never interpolated into command examples.

Security framing (Constitution I): the injection engine already carries arbitrary user text — chat-send's entire job — with handler-boundary sanitize, named-buffer paste, novelty echo probe, probe-gated Enter. This lane adds no new subprocess pattern; it reuses `s.injectChatMessage` verbatim. What changes is only the *seam's* posture: from "no client text ever" to "client text only on templates that declare it, capped, delimited". The rendered prompt frames the text as data ("the user's task description follows"), and the operator — an agent reading a prompt — applies its own judgment; the same trust model as chat-send, which already lets the user type anything at the operator directly.

Both new templates are **server-scoped** (no subject window) and ride the server-scoped request shape introduced by sibling change rfz2 (`POST /api/operator-request?server=`). Sequencing: if this change lands first, it introduces that route itself and rfz2 rebases; the route + scope mechanics are identical either way (ONE FetchSessions, busy gate 409, ResolveChatPane delivery, no queue — all per `run-kit/operator-actuation.md`).

### Template `spawn-task` (server-scoped, `acceptsText`)

Facts: the fact table of existing windows (windowId, name, session, worktree, agentState, fab change/stage) so the operator can route intelligently (reuse a checkout? avoid a busy worktree?). Prompt: the user's task text (delimited), then instruct — pick an appropriate worktree/preset and spawn via `rk riff` (name the CLI: `rk riff --list-presets` to see presets; `rk riff [--preset <p>] "<task>"` shape per `rk riff --help` at apply time; full semantics in `docs/memory/run-kit/rk-riff.md`). Bounds: spawn exactly one agent; do not modify existing windows; if the task is ambiguous about which repo/project, ask nothing — pick the current server's dominant project and note the choice in the spawned window's name.

### Template `find-discussion` (server-scoped, `acceptsText`)

Facts: per-window transcript JSONL paths for every chat-carrying window (the corpus; broken refs degrade to omitted rows, per rfz2's rule). Prompt: the user's query (delimited); search the corpus semantically — read tails, grep for related terms, follow context — and answer in the operator's own window naming the matching window(s) by name and `@N` with a one-line why-it-matches each. Bounds: read-only; no actions on other windows.

### Frontend: the compose affordance

The plan says "compose box on the operator row (the `?view=chat` lens is nearly free)". Two entry points, one input surface:

- **Palette** (primary, Constitution V): `Operator: Spawn task…` and `Operator: Find discussion…` — each opens a small single-field input dialog (existing create-session/rename dialog patterns; Enter submits, Escape cancels). Rendered only when the server has an operator window; absent otherwise.
- **Operator pinned row**: a compose icon on the pinned operator row (`components/sidebar/index.tsx` operator row) opening the same dialog pre-focused — the row is the "box"; a permanently-expanded inline input in the sidebar fights the row layout and the roving-focus model, so the icon-opens-dialog shape is the v1. The dialog for the row entry point offers the template choice (spawn vs find) as two submit affordances or a segmented control — exact shape is plan-stage.

Client: `api/client.ts` server-scoped operator-request call gains the optional `text` param; `withServer` + `throwOnError`; failure toasts surface the structured 409/404 (busy operator, no operator); success toasts name the outcome ("Sent to operator — it will spawn the agent" / "…answer appears in the operator tab").

### Tests

- Go: acceptsText enforcement matrix (text on closed template 400, missing text 400, over-cap 400, delimitation present in rendered prompt), busy gate, both templates' rendered-content assertions.
- Frontend: dialog unit tests (submit/cancel/empty-guard), palette gating; Playwright e2e with companion `.spec.md`, mocking `**/api/operator-request*` **with trailing `*`** (withServer appends `?server=`), covering palette→dialog→toast for both verbs.

## Affected Memory

- `run-kit/operator-actuation`: (modify) the `acceptsText` lane — its rules, cap, delimitation, and the two templates with their bounds
- `run-kit/ui/sidebar`: (modify) the operator pinned row's compose affordance
- `run-kit/ui/keyboard-and-palette`: (modify) the two palette actions + dialog

## Impact

- `app/backend/api/operator.go` + `operator_test.go` (+ router if this lands before rfz2)
- `app/frontend/src/api/client.ts`, sidebar operator row, a compose dialog component, palette registration
- `internal/riff` untouched (the operator uses the `rk riff` CLI through its own shell — no new backend spawn path); `internal/chat` untouched
- File-level overlap with siblings q675 and rfz2 in `operator.go` — independent, but later-landing changes rebase over small refactors

## Open Questions

- Is the operator-row compose icon worth it in v1, or is palette-only enough until the row affordance is designed properly? (Current decision: ship both, icon-opens-dialog — see Assumptions #4.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Client text enters via a declared `acceptsText` template lane on the existing body (`text` field), capped and delimited — not via raw chat-send | Plan requires typed input; the lane keeps the closed default and makes the extension auditable; chat-send-direct was rejected because the templates add facts + bounds the raw message lacks | S:70 R:75 A:80 D:70 |
| 2 | Certain | Delivery reuses the injection engine unchanged; no new subprocess pattern; busy gate + no-queue semantics unchanged | Constitution I/II + the seam memory's documented contract; chat-send already carries arbitrary user text through this exact path | S:85 R:85 A:95 D:90 |
| 3 | Certain | Operator spawns via its own shell (`rk riff` CLI); run-kit adds no backend spawn path | The plan says "spawns via rk riff"; the direct-spawn endpoint ([sbk1]) already covers the no-judgment path; the razor keeps judgment out of run-kit | S:80 R:80 A:85 D:80 |
| 4 | Confident | Row affordance = compose icon opening the shared input dialog (not a permanently-inline input); palette entries are the primary entry | "Compose box on the operator row" is the plan's phrase; an always-open inline input fights sidebar row layout + roving focus; the dialog reuses proven patterns — but the plan's `?view=chat` aside suggests other readings | S:50 R:80 A:60 D:40 |
| 5 | Certain | Both templates are server-scoped; `find-discussion` answers in the operator window; `spawn-task` results surface as the new window appearing via SSE | No single subject window exists for either; the seam has no response channel by design | S:75 R:80 A:85 D:80 |
| 6 | Confident | 4 KiB text cap; empty text on an acceptsText template is a 400 | A bound must exist; the value is a tunable constant | S:55 R:90 A:80 D:75 |

6 assumptions (3 certain, 3 confident, 0 tentative, 0 unresolved).
