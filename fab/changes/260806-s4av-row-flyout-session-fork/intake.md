# Intake: Row-Flyout Session Fork (Same-Worktree Conversation Fork)

**Change**: 260806-s4av-row-flyout-session-fork
**Created**: 2026-08-06

## Origin

Conversational (`/fab-discuss` session, 2026-08-06). The user shared a screenshot of the sidebar window-row flyout (the status popup with `PR — merged`, `out`/`agt`/`fab`/`pr` rows and the ⓘ button top-right) and asked:

> How tough is to implement a "fork" link next to the (i) button top right of the row popup. More important than the UI - what I am really asking about is the implementation - how would that work

An initial design proposed forking into a **new worktree**; the user explicitly rejected that:

> I don't think forking should create a new worktree. I meant a fork in the same worktree

The revised same-worktree design was presented and the user replied "agreed" and invoked `/fab-proceed`. Key mechanism facts were verified against the Claude Code docs (code.claude.com/docs/en/sessions.md) during the discussion — see What Changes § Verified Claude Code semantics.

## Why

1. **Pain point**: run-kit can spawn *fresh* agents (`rk riff`, the spawn dialog) but has no way to **branch an existing conversation**. When an agent holds valuable context, the only options are to interrupt it with a new direction or manually run `claude --resume <id> --fork-session` in a terminal — which requires finding the session UUID by hand.
2. **Consequence of not building it**: exploring an alternative direction means either derailing the live agent or losing its accumulated context; the dashboard's per-window session identity (`@rk_chat`) already knows the UUID but offers no affordance to use it.
3. **Why this approach**: the fork collapses almost entirely onto existing machinery — riff's **checkout mode** (window rooted at an existing directory, no `wt create`) plus a launcher suffix (`--resume <uuid> --fork-session`). One new endpoint, one launcher-composition seam, one flyout link. The rejected alternatives (worktree fork, transcript copying) are heavier and — for transcript copying — unsupported by Claude Code.

This is a "branch the conversation to consult/explore while the original continues" affordance — **not** a parallelize-two-workers feature (that is what the worktree-based spawn dialog is for).

## What Changes

### 1. Backend endpoint: `POST /api/windows/{windowId}/fork?server={server}`

New handler (suggest `api/fork.go`, registered in `api/router.go` beside the chat routes). Window-keyed like the chat endpoints — the client supplies ONLY a windowId + server; everything else resolves server-side (Constitution X — derivation wins; never trust a client-supplied session ref):

1. Validate `{windowId}` via `parseWindowID` (`400` on malformed) and `server` via the established server-name validation.
2. Resolve the window server-side (`FetchSessions` + window lookup by stable `WindowID`, exactly like `resolveWindowChat` in `api/chat.go`):
   - Reconciled chat identity via the existing active-pane-first rollup (`sessions.ResolveChatPane`): `@rk_chat = claude:<session-uuid>`. `404` when the window has no reconciled chat or the provider is not `claude`. `500` on a `FetchSessions` fault (transient tmux fault ≠ "no chat", mirroring chat's error split).
   - Source directory: the window's active pane cwd → repo root via `config.FindGitRoot` (the same derivation `POST /api/riff`'s `deriveRepoRoot` uses). `400` when the cwd is not inside a git repo (mirrors riff's non-repo-cwd 400).
3. The session UUID MUST pass a strict UUID-shape check (the same rule as `internal/chat`'s `uuidRe`: `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`) **before** it reaches any argv/shell composition (Constitution I). A non-UUID reconciled ref → `404`-class error (a property of the pane's `@rk_chat`, not a server fault — same posture as chat's `ErrInvalidRef` mapping).
4. Call the riff engine (below) and return the same result shape as `POST /api/riff`: `{server, session, window, windowId}` so the client can navigate to `/$server/$window`. Error mapping mirrors `riffStatusForError`: `ExitValidation → 400`, everything else → `500`.

The endpoint is a mutation ⇒ `POST` (Constitution IX). Testable via the existing mock `RiffEngine` + `mockTmuxOps` pattern (`api/riff_test.go` precedent — the mock records engine inputs).

### 2. Riff engine: resume-fork input on the existing checkout path

Extend `internal/riff` `Options`/`EffectiveSpec` with a resume input (suggest `ResumeSessionRef string`; empty = today's behavior, byte-identical):

- **Spawn shape**: `riff.Spawn` with `Where: "checkout"` — the existing path that skips `wt create` entirely and roots the new tmux window at the passed directory (here: the source window's repo root, i.e. the same worktree). Session = the source window's tmux session. Count fixed at 1. One skill pane.
- **Launcher composition**: the pane's launcher becomes `<fab-resolved launcher> --resume <uuid> --fork-session`. This rides the same documented launcher-exception seam as task injection (`buildSkillShellString`'s launcher half — the launcher string is the one deliberately-unescaped element; the flags are appended to it, not to the escaped positional arg). The uuid is already validated at the API layer; the engine MAY defensively re-check UUID shape at the seam where it enters the launcher string (defense-in-depth, mirroring how `Spawn` re-normalizes `Where`).
- **Launcher tier**: default tier (`ResolveLauncher(ctx, repoRoot, "")`), matching the CLI riff path. No tier plumbing for v1.
- **Window naming**: base name `<sourceWindowName>-fork`, uniquified by the existing `resolveWindowName` collision suffixing (`-2`, `-3`, …). This requires the endpoint to pass a window-name base into the engine (checkout mode currently derives `riff-<basename>` from the path — a small seam extension, e.g. an optional `WindowNameBase` on `Options`, blank = today's derivation).
- The CLI (`rk riff`) sets none of the new inputs — byte-identical behavior, matching how `Where`/`WorktreeName`/`Tier` were added (`260714-q9cg` precedent).

### 3. Frontend: fork link in the row flyout

- `app/frontend/src/components/sidebar/row-flyout-card.tsx`: a fork glyph/link next to the existing ⓘ button in the flyout header, **gated on the window's `chatProvider === "claude"`** (the same `WindowInfo` gate fields the chat lens uses — no new data plumbing; the fields already ride `/api/sessions` + SSE).
- Tooltip copy should convey the same-directory semantics (e.g. "Fork conversation — new window, same directory") so the fork-vs-spawn distinction stays legible.
- `app/frontend/src/api/client.ts`: `forkWindow(server, windowId)` POSTing to the new endpoint via the established `withServer` + `throwOnError` shape.
- On success: navigate to the returned `/$server/$window` (the same navigation the spawn dialog performs with the riff result).
- The forked window then behaves like any other agent window with zero extra wiring: the forked Claude re-stamps its own pane's `@rk_chat` at SessionStart via the existing agent-setup hooks, so the new row gets its own chat identity, status dot, and chat lens automatically.

### Verified Claude Code semantics (grounding for the mechanism)

Verified against code.claude.com/docs/en/sessions.md during the discussion:

- **Session-ID lookup is scoped to the current project directory AND its git worktrees** — a session created elsewhere reports `No conversation found with session ID`. Same-directory fork therefore trivially resolves (and this is why the same-worktree design needs no lookup gymnastics).
- **`claude --resume <id> --fork-session` creates a NEW session ID**; the original transcript is not appended to; history is copied up to the fork point. Works interactively and headless.
- **Cross-directory resume is unsupported**; copying `.jsonl` transcripts into `~/.claude/projects/<encoded-cwd>/` is undocumented and the encoding is lossy/non-injective (known collision bug, closed as not-planned) — rejected as a mechanism.
- Permission grants don't carry across a fork — moot under run-kit's default `--dangerously-skip-permissions` launcher.
- The fork point is the last written transcript line (forking a mid-turn agent forks its committed history) — accepted.

### Accepted caveat: shared working tree

Both agents share one working tree. The fork's conversation history references files the original agent may keep mutating, and two *working* agents would stomp each other's edits and git state. This is inherent to the user's explicit same-worktree choice, accepted as-is for v1 (no warning dialog, no lock). The tooltip copy carries the "same directory" signal; nothing else guards it.

## Affected Memory

- `run-kit/rk-riff`: (modify) new `ResumeSessionRef` (+ optional `WindowNameBase`) engine inputs, the launcher-suffix composition seam, and the fork endpoint as a third web-UI consumer of the engine
- `run-kit/ui-patterns`: (modify) row-flyout fork affordance (placement, `chatProvider` gate, navigation behavior)
- `run-kit/architecture`: (modify) new `POST /api/windows/{windowId}/fork` endpoint in the API-layer surface

## Impact

- `app/backend/api/` — new fork handler + route registration (`router.go`), handler tests against the mock `RiffEngine` (400/404/500/200 matrix, engine-input recording)
- `app/backend/internal/riff/` — `Options`/`EffectiveSpec` fields, launcher composition (pure helper + table tests), window-name-base seam; CLI path byte-identical
- `app/backend/internal/sessions/` — possibly a small extension to expose the resolved chat pane/window lookup for the fork handler (or reuse `resolveWindowChat`'s pattern in `api/`)
- `app/frontend/src/components/sidebar/row-flyout-card.tsx` — fork link + gate (+ component test)
- `app/frontend/src/api/client.ts` — `forkWindow` client fn
- No new routes, no schema/DB, no tmux-config changes. E2e: a flyout-link presence/gating spec is cheap; a full fork e2e would need a live claude session and is NOT expected (mirrors riff's no-integration-test posture — pure helpers are the unit surface)

## Open Questions

- None — the design was fully resolved in the originating discussion.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fork stays in the SAME worktree via riff checkout mode (`Where:"checkout"`, no `wt create`) | User explicitly rejected worktree fork and agreed to this design; engine path already exists | S:95 R:85 A:95 D:95 |
| 2 | Certain | Conversation-fork mechanism is `--resume <uuid> --fork-session` appended to the fab-resolved launcher | Verified against Claude Code docs: fork creates a new session ID, original transcript untouched, lookup scoped to project dir (same dir ⇒ trivially resolvable) | S:90 R:80 A:90 D:90 |
| 3 | Certain | Fork spawns a NEW tmux window, never a split pane in the source window | Two chat-carrying panes in one window would fight over the active-pane-first `@rk_chat` rollup, breaking the chat lens/status dot for both; discussed and agreed | S:90 R:80 A:95 D:90 |
| 4 | Certain | The session UUID is validated against strict UUID shape before reaching any argv/shell composition | Constitution I; the identical `uuidRe` rule already guards the chat adapter's filesystem access | S:85 R:85 A:95 D:90 |
| 5 | Confident | Endpoint shape: `POST /api/windows/{windowId}/fork?server=…`, all inputs resolved server-side, riff-style `{server, session, window, windowId}` result | Mirrors the chat endpoints' window-keyed never-trust-client-refs contract and riff's result/navigation shape; discussed without objection | S:75 R:70 A:85 D:80 |
| 6 | Confident | Flyout link gated on `chatProvider === "claude"` | Same gate as the chat lens; fields already on `WindowInfo`; proposed and included in the agreed design | S:75 R:80 A:80 D:80 |
| 7 | Confident | Window name base `<sourceWindowName>-fork` with existing collision suffixing | Naming convention choice — highly reversible, follows riff's `riff-<basename>` precedent | S:55 R:90 A:70 D:60 |
| 8 | Confident | Fork link placement: glyph next to ⓘ in the flyout header, tooltip conveying same-directory semantics | UI detail from the user's own sketch ("next to the (i) button"); exact glyph/copy is a reversible polish decision | S:60 R:90 A:65 D:55 |
| 9 | Confident | Forked launcher resolves the DEFAULT fab tier (no tier plumbing in v1) | Matches the CLI riff path's empty-tier behavior; tier selection was never raised in discussion and is additive later | S:50 R:85 A:75 D:70 |

9 assumptions (4 certain, 5 confident, 0 tentative, 0 unresolved).
