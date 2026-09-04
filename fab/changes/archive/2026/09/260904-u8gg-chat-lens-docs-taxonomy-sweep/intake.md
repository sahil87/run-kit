# Intake: Chat Lens Docs Lens-Taxonomy Sweep (Change B)

**Change**: 260904-u8gg-chat-lens-docs-taxonomy-sweep
**Created**: 2026-09-04

## Origin

One-shot dispatch via `/fab-new` (operator-driven, per the residual-sweep plan's sequencing section):

> Chat Lens residual sweep - Change B (docs lens-taxonomy sweep). Read and follow fab/plans/sahil/26-09-04-chat-lens-residual-sweep.md, Change B section (B.1-B.3) exactly. Docs-only - touch no file that Change A1 or A2 touch in code, and no memory file A1 rewrites. Re-verify every referenced location against current HEAD before editing.

The authoritative design is `fab/plans/sahil/26-09-04-chat-lens-residual-sweep.md` § Change B (authored 2026-09-04 from a full-repo sweep at `a8c24104`). This intake was generated after **re-verifying every B.1–B.3 referenced location against current HEAD (`6f9797fe`)** — all line numbers and claims hold unchanged (the only commits since the sweep are the plan itself and a backlog triage).

## Why

Change `260904-39bp-remove-chat-lens` (PR #817, commit `a8c24104`) removed the Chat Lens: the `?view=chat` frontend, the `chat` surface kind, the backend chat backfill endpoint + state-socket `kind:"chat"` subscription, and merged chat-send into `POST /api/windows/{id}/send` (`target:"agent"`).

The docs did not follow. `docs/specs/window-views.md` still presents the chat lens as one of its three founding features and as a committed `[target]`; `docs/specs/index.md` advertises it twice in one line; `docs/specs/agent-state.md` justifies `@rk_pane_chat` by the removed chat-view stack; and ten memory/spec one-liners reference chat routes, the chat send form, the `View: Chat` palette row, or a "later chat-read endpoint" that will never exist.

Consequence of not fixing: docs/memory are the authoritative grounding for every future agent and reviewer (FKF posture — memory is "the authoritative source of truth for system behavior"). Stale claims cause agents to plan against dead surfaces (e.g., re-adding a `chat` surface kind, gating features on `chatProvider`, or citing the removed backfill endpoint as a contract).

Why this approach: a scoped docs-only sweep, parallel with code-trim Change A1 (disjoint files), keeps the taxonomy correction independent of the code deletions and mergeable first — the plan's sequencing prefers B merging before A2 so A2's hydrate doesn't collide.

## What Changes

Docs-only. Three tiers, exactly per plan § Change B. All line numbers verified at `6f9797fe`.

### B.1 — `docs/specs/window-views.md` (the worst file) + `docs/specs/index.md:38`

The chat lens is one of the three founding features this spec unifies. **Add a removal note up top** (chat lens removed in PR #817 / `260904-39bp-remove-chat-lens`), then fix each location so nothing presents chat as present or planned:

| Location (verified) | Current state | Fix |
|---|---|---|
| L7–8 purpose statement | names "the agent chat view" + links its plan as a unified feature | reframe: chat view was removed (PR #817); keep the historical link only if framed as history |
| L34 problem-table row | `chat (planned)` row with `@rk_pane_chat` / `?view=chat` cells | remove or mark removed — no longer planned |
| L65 view-registry row | `chat` row presented as committed `[target]` with plan link | remove the row or convert to an explicitly-removed annotation |
| L119 R4 example | `[tty\|chat]`-style switcher example | swap to a live pair (e.g. `[tty\|web]`) |
| L127 R4 palette rows | `View: Chat` in the palette-parity enumeration | drop chat from the enumeration |
| L139 R4 | "whichever change ships first (`web-view-lens` or chat change …)" | rewrite — the chat change will never ship |
| L150 R6 connection-dot | "chat → chat stream" mapping | drop — the chat stream is gone |
| L164 Two Species lead | "chat, desktop, and `web` …" pane-coupled projection example | drop chat from the example set |
| L185 boards-pin aside | "pin the same window twice, tty and chat side by side" | swap to a live surface pair |
| L196 migration-map row | chat row claiming "change 1 in progress" | mark removed (PR #817), not in progress |
| **L133 — KEEP** | headings "formerly read `Terminal:`/`Web:`/`Chat:`/`Desktop:`" | explicitly historical; correct as-is |

`docs/specs/index.md:38` — the Window Views one-liner advertises chat twice ("parallel-view model (tty/web/chat/desktop)" and "migration map for iframe / desktop (PR #71) / chat"); rewrite to the live lens set.

### B.2 — one-paragraph fixes

- `docs/specs/agent-state.md:295–303` (§ Chat Session Identity) — the section's thesis justifies `@rk_pane_chat` as "the keystone of the HTML-agent-chat-view stack … the chat-read backend has no key to read a transcript by, and the frontend toggle nothing to gate on, without it." Swap the justification to the **live consumers**: operator actuation, fork/resume, closed-resume, auto-name, and agent-targeted send. The option itself is untouched (cross-repo contract with fab-kit — plan § Deliberately KEPT).
- The same "the (later) chat-read endpoint surfaces a missing transcript naturally as a read error" clause appears **three times**: `docs/specs/agent-state.md:390–391`, `docs/memory/run-kit/agent-state.md:618`, and `docs/memory/run-kit/agent-state.md:1028` (a Design Decision body). Rewrite each — the transcript-read consumers that survive (operator transcript read, fork, closed-resume, auto-name) surface the missing-transcript error now; there is no "later" endpoint.

### B.3 — one-liners

| File:line (verified) | Fix |
|---|---|
| `docs/specs/ui-state.md:69` | drop `chat` from the surface-kind enumeration (`tty · web · code · chat · desktop · agents`) |
| `docs/specs/surface-layout.md:164` | drop the "chat gets no button" parenthetical |
| `docs/memory/run-kit/operator-actuation.md:48, 63` | "registered in `api/router.go` beside the chat routes" — no chat routes remain; re-anchor the registration description |
| `docs/memory/run-kit/operator-actuation.md:204` | "mirroring the chat endpoints" (plural) — the surviving mirror is the send endpoint; fix the reference |
| `docs/memory/run-kit/ui/boards.md:247` | drop `View: Chat` from the palette row AND the `chatProvider` gate claim — verified `availableViews` gates on `hasCode` only (`window-view.ts:100`) |
| `docs/memory/run-kit/ui/compose-and-bottom-bar.md:60` | "`lib/readline-keys.ts` — shared with the chat send form" — compose strip is now the sole consumer |
| `docs/memory/run-kit/ui/visual-design.md:466` | "the chat form's autofocus skip" — consumer gone; keep the tooltip-suppression half |
| `docs/memory/run-kit/ui/visual-design.md:527` | "(waiting badge, chat warning body)" — the chat warning body example is dead; the waiting badge survives |
| `docs/memory/run-kit/api-and-sockets.md:27` | optional (included): retired `@rk_chat` → `@rk_pane_chat` (pre-existing drift; the line says "from the `@rk_chat` pane option") |
| `docs/memory/run-kit/ui/lenses-and-layout.md:91` | optional (included): add the clause that `?view=chat` is a *dropped* legacy value, not translated (the line already documents the drop mechanics; make the retirement explicit) |

**Verified clean, nothing needed** (plan's own sweep): `agent-messaging.md` (until A2), `tmux-sessions.md`, `desktop-shell.md`, `layout-snapshots.md`, `keyboard-and-palette.md`, `status-signals.md`, `code-bridge.md`, `findings/socket-pool-accounting.md`, README, docs/site, docs/ao, docs/wiki, `_shared/removed-domains.md`.

### Hard exclusions (collision guards with A1/A2)

- **No code files** — zero edits under `app/`, `internal/`, `scripts/`, `cmd/`.
- **No memory file A1's hydrate rewrites**: `docs/memory/run-kit/chat.md`, `docs/memory/run-kit/architecture.md` — untouched here even where they mention chat.
- **No A2-deferred docs**: `docs/memory/run-kit/agent-messaging.md`, `docs/specs/api.md` (the `/paste`-block rewrite is A2 hydrate scope), and the A2 DD-heading renames in `ui/compose-and-bottom-bar.md:215` / `ui/sidebar.md:670`.
- **Deliberately KEPT** (plan § Deliberately KEPT): `@rk_pane_chat` option + `ChatProvider`/`ChatSessionRef` fields, `ResolveChatPane`/`rollupChat`, agent-hook chat stamp — here "chat" = the agent's conversation session, still accurate. Docs describing these stay chat-named.
- **False positives**: `chatter`/`outputSink.chatter`, `chat.disableAIFeatures`, `"chatty"` fixture — not chat-lens residuals.

## Affected Memory

The memory edits below ARE the change (docs-only change — apply performs them; hydrate verifies rather than authors):

- `run-kit/operator-actuation`: (modify) B.3 — fix "beside the chat routes" (L48, L63) and "mirroring the chat endpoints" (L204)
- `run-kit/agent-state`: (modify) B.2 — rewrite the "later chat-read endpoint" clause at L618 and L1028
- `run-kit/ui/boards`: (modify) B.3 — drop `View: Chat` palette row + `chatProvider` gate claim (L247)
- `run-kit/ui/compose-and-bottom-bar`: (modify) B.3 — readline-keys sole-consumer fix (L60); NOT the L215 DD heading (A2 scope)
- `run-kit/ui/visual-design`: (modify) B.3 — autofocus-skip consumer (L466) and chat-warning-body example (L527)
- `run-kit/api-and-sockets`: (modify) B.3 optional — `@rk_chat` → `@rk_pane_chat` (L27)
- `run-kit/ui/lenses-and-layout`: (modify) B.3 optional — explicit dropped-legacy-value clause (L91)

Explicitly NOT affected: `run-kit/chat`, `run-kit/architecture` (A1 hydrate scope), `run-kit/agent-messaging` (A2 scope).

## Impact

- **Scope**: `docs/specs/` (window-views.md, index.md, agent-state.md, ui-state.md, surface-layout.md) + the seven memory files above. ~12 files, all markdown.
- **Code**: none. `source_paths` untouched; `true_impact_exclude` covers `docs/` — this is a pure docs change.
- **Tests/build**: no test or build behavior changes; standard gates (`just test`, `just build`) must remain green trivially.
- **Parallelism**: designed to run parallel with Change A1 (disjoint files) and merge before A2.
- **Review question** (from the plan): *does any doc still present the chat lens, chat surface, or chat endpoints as present/planned?* — the review should grep-sweep docs for chat-lens framing after apply.

## Open Questions

- None. The plan is prescriptive per location, every referenced location re-verified at HEAD, and the two "optional" items are resolved by the dispatch instruction to follow B.1–B.3 exactly (see Assumptions #3).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope is exactly plan § Change B (B.1–B.3); all referenced locations re-verified at HEAD `6f9797fe` and hold verbatim | Dispatch instruction says "follow … exactly"; verification confirmed zero drift since `a8c24104` | S:95 R:90 A:95 D:95 |
| 2 | Certain | Hard exclusions honored: no code files, no `chat.md`/`architecture.md` (A1 hydrate), no `agent-messaging.md`/`api.md`/DD-heading renames (A2), all KEPT items untouched | Dispatch instruction + plan's explicit collision guards and KEPT/false-positive inventories | S:95 R:85 A:95 D:95 |
| 3 | Confident | The two B.3 rows the plan marks "optional" (api-and-sockets.md:27, lenses-and-layout.md:91) are INCLUDED | "Follow B.1–B.3 exactly" covers the whole table; both fixes verified accurate and low-risk; excluding them would leave known drift | S:70 R:85 A:80 D:70 |
| 4 | Confident | window-views.md treatment: add a removal note up top, then rewrite/remove the enumerated rows so chat reads as removed history — the spec file itself survives (taxonomy spec for the live lenses), L133 kept as-is | Plan prescribes "add a removal note up top; then:" per-location fixes and explicitly keeps L133; deleting the whole spec was never proposed | S:75 R:80 A:80 D:70 |
| 5 | Confident | agent-state B.2 rewrite names the live consumers verbatim from the plan: operator actuation, fork/resume, closed-resume, auto-name, agent-targeted send | Plan supplies the consumer list; matches the surviving `internal/chat` consumers inventoried in A1.2 | S:80 R:85 A:80 D:80 |
| 6 | Certain | change_type is `docs` | Docs-only change; keyword inference from the description ("docs … sweep") and the actual file set both say docs | S:90 R:95 A:95 D:95 |

6 assumptions (3 certain, 3 confident, 0 tentative, 0 unresolved).
