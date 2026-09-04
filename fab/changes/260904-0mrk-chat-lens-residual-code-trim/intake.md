# Intake: Chat Lens Residual Code Trim (Sweep Change A1)

**Change**: 260904-0mrk-chat-lens-residual-code-trim
**Created**: 2026-09-04

## Origin

One-shot `/fab-new` invocation by the operator, dispatching Change A1 of a pre-authored three-change plan:

> Chat Lens residual sweep - Change A1 (code trim). Read and follow `fab/plans/sahil/26-09-04-chat-lens-residual-sweep.md`, Change A1 section (A1.1-A1.4 plus the A1 hydrate scope) exactly. Line numbers in the plan are as of commit a8c24104 - re-verify every location against current HEAD before editing. Do NOT touch anything listed under the plan's Deliberately KEPT or False positives sections. This is a delete/comment-only change, no renames (renames are Change A2, a separate later change).

The plan (`fab/plans/sahil/26-09-04-chat-lens-residual-sweep.md`, committed at `6f9797fe`) was authored 2026-09-04 in a discussion session, from a full-repo sweep conducted at commit `a8c24104`. It defines three changes: **A1 (this change — code trim)**, A2 (renames, only after A1 merges), and B (docs sweep, parallel with A1). This intake reproduces the full A1 content below so downstream stages need no external context, but the plan file remains the canonical reference — read it at apply entry.

Key decisions from the plan, binding on this change:

- **A1 scope only**: A1.1–A1.4 plus the A1 hydrate scope. Renames (A2) and the docs lens-taxonomy sweep (B) are explicitly out of scope.
- **Delete/comment-only**: dead-code deletion, one behavior-alignment removal (A1.1), dependency removal, and stale-comment edits. No renames of any symbol, file, or package.
- **Line numbers are as of `a8c24104`** — current HEAD (`6f9797fe`) adds only two docs commits on top, but every location MUST be re-verified against HEAD before editing.
- **The Deliberately-KEPT and False-positives inventories (below) are hard exclusions.**
- **`just test` must stay green with the e2e suite unmodified** — it pins the `?view=chat` heal behavior.

## Why

Change `260904-39bp-remove-chat-lens` (PR #817, commit `a8c24104`) removed the Chat Lens: the `?view=chat` frontend (chat-view, use-chat-subscription, chat-stream, ChatSendForm, the `chat` surface kind, `Chat:` heading prefix, `chat-toggle` keybinding), the backend `GET /api/windows/{id}/chat` backfill + state-socket `kind:"chat"` subscription (api/chat.go, api/chat_ws.go), and merged the chat-send handler into `POST /api/windows/{id}/send` (with `target:"agent"`).

A full-repo residual sweep found three classes of leftovers this change trims:

1. **A live divergence** (A1.1): `internal/layoutspec` still accepts the removed `chat` surface kind, so `rk tab layout set/--add` can write a stored layout the frontend parse-rejects and silently heals to `single:tty`. This is a real, user-reachable inconsistency — the CLI accepts input the UI cannot render.
2. **Dead weight** (A1.2, A1.3): ~700 of ~850 lines in `internal/chat` have zero production consumers (the whole JSONL parser/backfill/tail machinery), and two frontend dependencies (`react-markdown`, `remark-gfm`) have zero imports. Dead code invites drift, misleads readers and reviewers, and inflates builds.
3. **Stale comments** (A1.4): eleven comment sites point at deleted code (`api/chat.go`, ChatSendForm, the chat subscription), actively misleading the next reader.

If not fixed: the layoutspec divergence keeps producing self-healing-but-confusing stored layouts; the dead package half misleads anyone touching transcript resolution; the stale comments erode trust in comments generally. Doing the trim now, as a separate delete-only change before the A2 renames, keeps each PR reviewable against one question — here: *is everything deleted actually consumer-free, and does every stored-layout path still heal?*

Alternative rejected (in the plan): folding trim + renames into one change — rejected because they touch the same files with different review questions; A2 depends on A1's shrunken surface.

## What Changes

> All line numbers below are **as of `a8c24104`**. Re-verify every location against current HEAD before editing (HEAD adds two docs-only commits, so code lines should be unchanged — but verify, don't assume).

### A1.1 — `internal/layoutspec` drops the removed `chat` surface kind

`layoutspec.go:42` has `"chat": true` in `surfaceKinds` while the frontend `ViewName` is `"tty" | "web" | "code"` (`window-view.ts:24`) — so `rk tab layout set/--add` can write a layout the frontend parse-rejects and heals to `single:tty`. **Remove `chat` from `surfaceKinds`.**

Safe: every Go caller heals a parse failure to `Default()` (`tab_web.go:213`, `tab_layout.go:120`). Update alongside:

- `layoutspec_test.go` — `chat` appears in *valid* fixtures (L15, L18, L96, L125, L175, L268); these must move to a surviving surface or become invalid-input cases.
- `cmd/rk/tab_test.go:262/291` — `--add chat` / `--promote chat` currently fail for full/absent reasons; after removal they fail as unknown-surface (different error message) — update the assertions.
- `cmd/rk/tab_test.go:384` — uses `main-left:tty,code,chat` as a *valid* stored layout; needs a new third surface (`web` is the natural survivor: `main-left:tty,code,web`) or a heal expectation.
- `internal/tabaddr/tabaddr.go:24` — surface-list comment includes `"chat"`; drop it from the enumeration.

### A1.2 — delete `internal/chat` dead code (~700 of ~850 lines)

Outside its own tests, the package is consumed **only** for `chat.TranscriptPath` and the error sentinels `ErrInvalidRef` / `ErrTranscriptNotFound` / `ErrNoAdapter` (consumers: operator actuation, fork, closed-resume, auto-name). Zero production references to: `Adapter.Backfill` / `Adapter.TailFrom`, `Conversation`, `Update`, `Event`, `Pending`, `Role`, and the whole JSONL parser (`parser`, `consume`, `parseLine`, `decodeContent`, `appendBlockEvent`, `pending`, `closeToolUse`, `tailFromLoop`, `primeTo`, `readFromOffset`, `deriveQuestion`, `flattenToolResult`, …).

- **Delete**: all of `schema.go`.
- **Shrink `adapter.go`** to the provider registry + `TranscriptLocator`.
- **Shrink `claude.go`** to the UUID guard + transcript glob + `TranscriptPath`.
- **Delete the dead halves** of `claude_test.go` / `schema_test.go`.
- **Keep** `testdata/claude_session.jsonl` (see Deliberately KEPT — still read by `api/chat_fixture_test.go`).

Before each deletion, verify consumer-freedom with a repo-wide grep for the symbol; the package must still compile and its surviving tests pass.

### A1.3 — remove dead frontend dependencies

`react-markdown` and `remark-gfm` in `app/frontend/package.json` — zero imports anywhere in `src/` (they served only the deleted ChatView renderer). Verify zero imports with a grep first, then `pnpm remove react-markdown remark-gfm` (run in `app/frontend/`).

### A1.4 — fix stale comments pointing at deleted code

| Location | Stale reference | Fix direction |
|---|---|---|
| `internal/inject/inject.go:2` (also ~L24, L176) | "chat-send HTTP handler (api/chat.go)" | now `api/send.go` |
| `api/fork.go:28` | "the chat endpoints (api/chat.go), whose contract this mirrors" | point at the surviving send endpoint |
| `internal/chat/adapter.go:11–45` | doc header describes the removed backfill endpoint + `kind:"chat"` subscription | largely deleted by A1.2; rewrite the surviving header around transcript location |
| `internal/chat/claude.go:105` | "state-socket chat subscription can compose GET(offset)→TailFrom" | delete with A1.2 or rewrite |
| `compose-strip.tsx:166, 664` | "mirrors ChatSendForm" / "the SAME helper ChatSendForm uses" | ChatSendForm is gone |
| `readline-keys.ts:3` | "shared with … the chat send form" | compose strip is now the sole consumer |
| `use-coarse-pointer.ts:5` | names "the chat send" as a consumer | drop the dead consumer |
| `right-panel.ts:27` | "`tty` … and `chat` are surfaces like any other" | drop `chat` from the example |
| `app.tsx:1408, 2015, 2020` | "(web iframe or chat)" | mechanism real, example dead; say web/code |
| `tip.tsx:94` | "the compose/chat Enter" | drop the chat half |
| `types.ts:181` | "the SOLE gate for every chat affordance" | affordances are now fork/operator actions |

Comment edits update the stale reference only — no narration added, per `fab/project/code-quality.md` (comments state constraints, never provenance).

### Hard exclusions — Deliberately KEPT (do not "clean up")

- `@rk_pane_chat` pane option + `ChatProvider`/`ChatSessionRef` fields (Go, JSON wire, snapshot closed-ring), `sessions.ResolveChatPane`/`rollupChat`, the agent-hook chat stamp. Here "chat" = *the agent's conversation session*, still accurate. The option is a cross-repo contract with fab-kit (`docs/specs/agent-state.md`) and mid-migration from legacy `@rk_chat` (dual-read/dual-write live). **Out of scope.**
- `internal/chat/testdata/claude_session.jsonl` — still read by `api/chat_fixture_test.go` for operator/send/auto-name tests.
- Regression pins asserting the removal: `router-url.test.ts:48` (`?view=chat` heal), `surface-layout.test.ts` chat-layout heal tests, `use-shell-notifications.test.tsx:66` (stale deep link), `window-heading.spec.ts` retired-prefix assertions. These must keep passing unmodified.

### Hard exclusions — False positives (not chat residuals)

- `chatter` / `outputSink.chatter` everywhere — the Principle 9 stderr channel.
- `chat.disableAIFeatures` in `internal/daemon/codeserver.go` — a code-server settings key.
- `"chatty"` fixture name in `waiting_push_test.go`.

### Explicitly out of scope (later changes in the same plan)

- **A2 (renames)**: `internal/chat` → `internal/transcript`, chat-send → agent-send cluster, `ComposeSurface: "chat"` → `"broadcast"`. Depends on A1 merging first.
- **B (docs lens-taxonomy sweep)**: `docs/specs/window-views.md` and the rest of the docs inventory. Runs parallel to A1 in another worktree; A1's hydrate touches only the two memory files listed below, which B deliberately avoids.

## Affected Memory

- `run-kit/chat.md`: (modify) Remove the now-deleted normative sections — L35–54 (event schema), L56–71 (turn counter), L73–91 (Pending), the `Backfill`/`TailFrom` halves of L93–133, L158–184 (parser), L186–212 (offset tail), and DDs L590–633 that describe them. The live remainder: Claude adapter UUID/traversal guard (L135–156), `TranscriptLocator` + registry, and the entire Send Path (L214–588, already accurate). (Line numbers as of `a8c24104` — re-verify.)
- `run-kit/architecture.md`: (modify) L144 — the `internal/chat` row recites the dead type surface as live and uses retired `@rk_chat`; rewrite as a transcript-locator row. L152 — layoutspec row: restore the "port of surface-layout.ts" claim to true (A1.1 makes it true again) and drop `chat` from the surface list.

## Impact

- **Go backend**: `internal/layoutspec/` (layoutspec.go + layoutspec_test.go), `cmd/rk/tab_test.go`, `internal/tabaddr/tabaddr.go` (comment), `internal/chat/` (schema.go deleted; adapter.go, claude.go, claude_test.go, schema_test.go shrunk), `internal/inject/inject.go` (comments), `api/fork.go` (comment).
- **Frontend**: `app/frontend/package.json` + lockfile (two deps removed); comment-only edits in `compose-strip.tsx`, `readline-keys.ts`, `use-coarse-pointer.ts`, `right-panel.ts`, `app.tsx`, `tip.tsx`, `types.ts`.
- **Behavior change surface**: exactly one — `rk tab layout set/--add/--promote` rejects `chat` as an unknown surface instead of accepting-then-healing. Everything else is dead-code/comment/dependency removal with no runtime effect.
- **Memory**: two files under `docs/memory/run-kit/` (hydrate stage).
- **Verification gates** (per `fab/project/code-quality.md`): `cd app/backend && go test ./...`, `cd app/frontend && npx tsc --noEmit`, `just test`, `just build`. The e2e suite pins the `?view=chat` heal behavior and must pass unmodified.
- **Review question** (from the plan): *is everything deleted actually consumer-free, and does every stored-layout path still heal?*

## Open Questions

- None — the plan is exhaustive and the operator's dispatch instruction resolves scope, ordering, and exclusions.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope is exactly plan sections A1.1–A1.4 plus the A1 hydrate scope; A2 renames and Change B docs sweep excluded | Operator's dispatch instruction states this explicitly | S:95 R:90 A:95 D:95 |
| 2 | Certain | Deliberately-KEPT items (`@rk_pane_chat` cluster, `testdata/claude_session.jsonl`, regression pins) and false positives (`chatter`, `chat.disableAIFeatures`, `"chatty"`) are untouched | Explicit hard exclusion in both the plan and the dispatch instruction; `@rk_pane_chat` is a cross-repo contract | S:95 R:80 A:95 D:95 |
| 3 | Certain | Every plan line number is re-verified against current HEAD before editing | Explicit instruction; HEAD adds only two docs commits over the sweep commit `a8c24104` | S:95 R:95 A:95 D:95 |
| 4 | Confident | `internal/chat` deletion boundary: keep `TranscriptPath`, the three error sentinels, provider registry + `TranscriptLocator`, UUID guard + transcript glob; delete everything else, verifying consumer-freedom per symbol via repo-wide grep before deleting | Plan enumerates the surviving surface and its four consumers; compile + tests confirm | S:85 R:75 A:90 D:85 |
| 5 | Confident | `tab_test.go:384` valid-layout fixture switches `main-left:tty,code,chat` → `main-left:tty,code,web` (rather than a heal expectation) | Plan offers both options; `web` is a surviving surface kind, preserving the test's intent (a valid 3-surface stored layout) with minimal churn | S:70 R:90 A:80 D:65 |
| 6 | Confident | `tab_test.go:262/291` assertions update to expect the unknown-surface error for `--add chat` / `--promote chat` | Plan states the failure mode changes message; asserting the new message preserves coverage | S:80 R:90 A:85 D:80 |
| 7 | Confident | `layoutspec_test.go` chat-bearing *valid* fixtures move to surviving surfaces (or become invalid-input cases where the fixture's point was the chat kind itself) | Plan flags the six lines; the test's Proves-intent decides per fixture at apply | S:70 R:90 A:80 D:70 |
| 8 | Confident | Frontend dep removal is `pnpm remove react-markdown remark-gfm` in `app/frontend/`, after a grep confirms zero `src/` imports | Plan asserts zero imports; grep re-verifies at HEAD; pnpm is the project's package manager | S:90 R:90 A:90 D:90 |
| 9 | Confident | Change type is `refactor` (dead-code trim + comment fixes; the single behavior alignment removes an already-unrenderable input) | No new capability; matches the refactor keyword class | S:75 R:85 A:80 D:80 |

9 assumptions (3 certain, 6 confident, 0 tentative, 0 unresolved).
