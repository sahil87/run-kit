# Plan: Row-Flyout Session Fork (Same-Worktree Conversation Fork)

**Change**: 260806-s4av-row-flyout-session-fork
**Intake**: `intake.md`

## Requirements

### Backend: Fork endpoint (`POST /api/windows/{windowId}/fork`)

#### R1: Window-keyed fork endpoint with server-side resolution
The backend SHALL expose `POST /api/windows/{windowId}/fork?server={server}` (`api/fork.go`, registered in `api/router.go` beside the chat routes). The client SHALL supply ONLY a `windowId` path segment and a `server` query param — no body is read and no session/uuid/directory reference is ever accepted from the client (Constitution X: derivation wins). The handler SHALL validate `{windowId}` via `parseWindowID` and resolve the server via `serverFromRequest`.

- **GIVEN** a request to `POST /api/windows/@7/fork?server=work`
- **WHEN** the window carries a reconciled `claude:<uuid>` chat and its active-pane cwd is inside a git repo
- **THEN** the handler calls the riff engine and returns `200 {"server","session","window","windowId"}`
- **AND** no field of the engine `Options` originates from the request body

- **GIVEN** a malformed window id (`POST /api/windows/notawindow/fork`)
- **WHEN** the handler runs `parseWindowID`
- **THEN** it responds `400` and never calls the engine

#### R2: Chat-identity resolution and its error split
The handler SHALL resolve the window server-side from a single `FetchSessions` call, locating the window by its stable `WindowID` and reading the reconciled chat identity via `sessions.ResolveChatPane` (the active-pane-first rollup, exactly like `resolveWindowChat` in `api/chat.go`). A `FetchSessions` fault SHALL be `500` (a transient tmux fault is not "no chat" — mirroring chat's split); a window that is absent, carries no reconciled chat, or whose provider is not `claude` SHALL be `404`.

- **GIVEN** `FetchSessions` returns an error
- **WHEN** the fork handler resolves the window
- **THEN** it responds `500` and the engine is not called

- **GIVEN** the window carries no reconciled chat (a plain shell pane)
- **WHEN** the fork handler resolves the window
- **THEN** it responds `404` and the engine is not called

- **GIVEN** the window's reconciled provider is `codex`
- **WHEN** the fork handler resolves the window
- **THEN** it responds `404` (v1 forks Claude sessions only) and the engine is not called

#### R3: Strict UUID gate before any argv composition
The resolved session ref MUST pass the strict UUID-shape check `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` (the same rule as `internal/chat`'s `uuidRe`) **before** it reaches any argv/shell composition (Constitution I). A non-UUID reconciled ref SHALL be `404`-class (a property of the pane's `@rk_chat`, not a server fault — the same posture as chat's `ErrInvalidRef` mapping).

- **GIVEN** the window's reconciled `@rk_chat` is `claude:../../etc/passwd`
- **WHEN** the fork handler validates the ref
- **THEN** it responds `404` and the engine is never called (no subprocess, nothing created)

#### R4: Source directory is the pane's EXACT cwd; git-root walk is a gate only
The handler SHALL pass the resolved window's pane cwd (active pane, else first pane with a non-empty cwd, else the window's `WorktreePath`) **itself** as the engine's window root — NOT the walked-up git root. Claude keys its transcript store by the exact cwd and its resume lookup covers the project directory and its git worktrees but NOT parent directories (verified empirically 2026-08-06: a session started in `<repo>/app/backend` resumes from `<repo>/app/backend` and fails with "Execution error" from `<repo>`), so rooting the fork anywhere but the source pane's own directory breaks the resume for any agent working in a repo subdirectory. `config.FindGitRoot` SHALL be used ONLY as the validity gate: a pane cwd that is not inside a git repo SHALL be `400`, naming the offending directory (mirroring riff's non-repo-cwd 400).

- **GIVEN** the resolved window's active pane cwd is `/tmp/scratch` (not a git repo)
- **WHEN** the fork handler derives the source directory
- **THEN** it responds `400` naming that directory and the engine is not called

- **GIVEN** the resolved window's active pane cwd is `<repo>/app/backend`
- **WHEN** the fork handler derives the source directory
- **THEN** the engine receives `RepoRoot == <repo>/app/backend` (the pane cwd itself, so the forked claude opens where the source agent runs and the resume resolves)

#### R5: Engine invocation, result shape, and error mapping
On a resolved window the handler SHALL call the riff engine with `Where: "checkout"`, the source window's tmux session, the derived repo root, the resolved uuid as the resume ref, and a window-name base of `<sourceWindowName>-fork`. It SHALL return riff's result shape `{server, session, window, windowId}` and map engine errors exactly as `riffStatusForError` does: `ExitValidation → 400`, everything else → `500`. An unwired engine (`s.riff == nil`) SHALL be `500`. The endpoint is a mutation ⇒ `POST` (Constitution IX).

- **GIVEN** a resolvable window in session `dev` named `feature-work` with uuid `U` and pane cwd `D`
- **WHEN** the fork succeeds
- **THEN** the engine received `{Where:"checkout", Session:"dev", ResumeSessionRef:U, WindowNameBase:"feature-work-fork", RepoRoot:D}` (D = the pane cwd per R4)
- **AND** the response body is the engine result's `{server, session, window, windowId}`

- **GIVEN** the engine returns an `ExitCodeError{Code: ExitSubprocess}`
- **WHEN** the handler maps it
- **THEN** it responds `500`

### Backend: Riff engine resume-fork inputs

#### R6: `ResumeSessionRef` input, claude-launcher gate, and launcher-suffix composition
`internal/riff` `Options` SHALL carry a `ResumeSessionRef string` input (empty = today's behavior, byte-identical). The field lives on `Options` ONLY — not `EffectiveSpec` — matching the `Tier` precedent for launcher-seam-consumed inputs (`Spawn` folds it into the launcher before the spec is built; a spec copy would be write-only provenance). When non-empty, the pane's launcher SHALL become `<fab-resolved launcher> --resume <uuid> --fork-session` — flags appended to the **launcher** half of `buildSkillShellString` (the documented deliberately-unescaped element), never to the escaped positional arg. Because `--resume`/`--fork-session` are Claude-only flags and `ResolveLauncher` returns a provider-opaque string, the suffix SHALL be **gated on the resolved launcher actually being a claude invocation** (basename of the launcher's first command word == `claude`): a non-empty ref with a non-claude launcher SHALL fail the spawn with `riff.ValidationErr` (→ `400` via the existing mapping), never silently spawn an unforked agent or hand claude flags to another binary. The composition SHALL live in a pure helper that defensively re-checks UUID shape at the seam (defense-in-depth, mirroring how `Spawn` re-normalizes `Where`); a ref failing that check SHALL leave the launcher unchanged.

- **GIVEN** launcher `claude --dangerously-skip-permissions` and ref `5d80479e-8f25-46cd-a0d4-e51435508a37`
- **WHEN** the resume suffix is composed
- **THEN** the result is `claude --dangerously-skip-permissions --resume 5d80479e-8f25-46cd-a0d4-e51435508a37 --fork-session`

- **GIVEN** an empty ref
- **WHEN** the resume suffix is composed
- **THEN** the launcher is returned unchanged (today's byte-identical path)

- **GIVEN** a non-UUID ref (`foo; rm -rf /`)
- **WHEN** the resume suffix is composed
- **THEN** the launcher is returned unchanged — the ref never enters the launcher string

- **GIVEN** a non-empty ref and a resolved launcher whose first command word is `codex` (a mixed-provider repo's default tier)
- **WHEN** `Spawn` runs
- **THEN** it returns `riff.ValidationErr` naming the launcher (no window created, no claude flags handed to a non-claude binary), and the handler maps it to `400`

#### R7: `WindowNameBase` seam
`Options`/`EffectiveSpec` SHALL carry an optional `WindowNameBase string`; blank preserves today's `riff-<basename>` derivation. When non-empty it replaces that base, and the existing `resolveWindowName` collision suffixing (`-2`, `-3`, …) SHALL apply unchanged.

- **GIVEN** `WindowNameBase: "feature-work-fork"` and an existing window of that name
- **WHEN** the window name is resolved
- **THEN** the created window is named `feature-work-fork-2`

- **GIVEN** a blank `WindowNameBase`
- **WHEN** the window name is resolved
- **THEN** the base is `riff-<path-basename>` (unchanged)

#### R8: CLI path stays byte-identical
`rk riff` (the CLI frontend) SHALL set neither new input, so its behavior is byte-identical (matching how `Where`/`WorktreeName`/`Tier` were added — `260714-q9cg` precedent). The engine SHALL resolve the forked launcher at the **default** tier (`ResolveLauncher(ctx, repoRoot, "")`), with no tier plumbing in v1.

- **GIVEN** a `rk riff` invocation
- **WHEN** the engine runs
- **THEN** `ResumeSessionRef` and `WindowNameBase` are empty and the spawned launcher/window name are unchanged from before this change

### Frontend: Fork affordance in the row flyout

#### R9: `forkWindow` API client function
`app/frontend/src/api/client.ts` SHALL export `forkWindow(server, windowId)` POSTing to `/api/windows/{windowId}/fork` via the established `withServer` + `throwOnError` shape, returning the riff result type. It SHALL reuse the existing `RiffSpawnResult` type rather than declaring a duplicate shape.

- **GIVEN** `forkWindow("work", "@7")`
- **WHEN** the backend responds 200
- **THEN** the promise resolves with `{server, session, window, windowId}`

- **GIVEN** the backend responds 404
- **WHEN** `forkWindow` runs
- **THEN** it throws an Error carrying the server's structured message

#### R10: Fork link in the flyout header, gated on `chatProvider === "claude"`
`row-flyout-card.tsx` SHALL render a fork glyph button next to the existing ⓘ docs link in the flyout header, **only** when `win.chatProvider === "claude"`. Its tooltip/aria copy SHALL convey the same-directory semantics so the fork-vs-spawn distinction stays legible. The click SHALL `stopPropagation` (never select the underlying row) and, on success, navigate to the returned window. The fork affordance SHALL be wired through an optional callback so a consumer that passes none (e.g. the board-route sidebar) simply renders no fork button — the optional-prop idiom `onSpawnAgent`/`onColorChange` already use.

- **GIVEN** a window whose `chatProvider` is `claude`
- **WHEN** the flyout card opens
- **THEN** the fork button renders beside the docs link with same-directory tooltip copy

- **GIVEN** a plain shell window (no `chatProvider`) or a `codex` window
- **WHEN** the flyout card opens
- **THEN** no fork button renders

- **GIVEN** a claude window and no fork handler supplied by the consumer
- **WHEN** the flyout card opens
- **THEN** no fork button renders (and nothing throws)

#### R11: Navigation on success, in-flight guard, and error surfacing
On a successful fork the app SHALL navigate to the returned window using the same navigation the spawn dialog performs with a riff result (same-server → `navigateToWindow`, cross-server → the 2-segment `/$server/$window` route), and SHALL skip navigation when the returned `windowId` is empty (best-effort resolve) rather than routing to a junk URL. While a fork POST is in flight the fork button SHALL be disabled (the spawn dialog's `disabled={busy}` idiom), so repeated clicks cannot fire multiple mutating POSTs and create multiple fork windows. A failed fork SHALL surface the error to the user rather than failing silently, and SHALL clear the busy state so the button is usable again.

- **GIVEN** a fork POST in flight
- **WHEN** the fork button is clicked again
- **THEN** no second POST fires (the button is disabled until the first settles)

- **GIVEN** a fork returning `windowId: "@9"` on the current server
- **WHEN** the fork resolves
- **THEN** the app navigates to that window

- **GIVEN** a fork returning `windowId: ""`
- **WHEN** the fork resolves
- **THEN** no navigation occurs (the SSE stream surfaces the row instead)

### Non-Goals

- **No new worktree** — the fork is explicitly same-worktree (`Where: "checkout"`); `wt create` is never invoked.
- **No split-pane fork** — the fork always creates a new tmux window (two chat panes in one window would fight the active-pane-first `@rk_chat` rollup).
- **No transcript copying** — cross-directory resume is unsupported by Claude Code and the `~/.claude/projects/<encoded-cwd>/` encoding is lossy; rejected as a mechanism.
- **No shared-worktree guard** — no warning dialog and no lock. Both agents share one working tree; this is inherent to the user's explicit same-worktree choice and accepted for v1. The tooltip copy carries the "same directory" signal.
- **No tier selection** for the forked launcher (default tier only in v1).
- **No fork e2e against a live claude session** — a full fork needs a real Claude session; per riff's no-integration-test posture the pure helpers plus a flyout-gating e2e are the test surface.

### Design Decisions

#### Fork resolves from one `FetchSessions`, not `resolveWindowChat` + `deriveRepoRoot`
**Decision**: the fork handler performs a single `FetchSessions` and, from the located window, reads BOTH the reconciled chat identity (via `sessions.ResolveChatPane`) and the pane cwd for the repo-root walk — plus the owning session name.
**Why**: the endpoint is window-keyed, and the enclosing session name is itself a derived value the handler needs for the engine's `Session`. `deriveRepoRoot` takes a *session* and re-reads via `ListWindows`, so composing the two helpers would mean two tmux reads and would derive the cwd from the session's *active* window rather than the *requested* window — the wrong pane for a fork of a background window.
**Rejected**: calling `resolveWindowChat` then `deriveRepoRoot(session)` — two reads, and the cwd could come from a different window than the one being forked.
*Introduced by*: 260806-s4av-row-flyout-session-fork

#### The fork roots at the pane's exact cwd, never the walked-up git root
**Decision**: the fork handler passes the source pane's cwd itself as the engine window root; `config.FindGitRoot` is only the not-a-repo `400` gate.
**Why**: verified empirically 2026-08-06 — claude keys its transcript store by the EXACT cwd (`~/.claude/projects/<encoded-cwd>/`), and `claude --resume <uuid> --fork-session` for a session started in `<repo>/app/backend` fails ("Execution error") from `<repo>` while succeeding from the pane's own directory; the resume lookup covers the project dir and its git worktrees, not parent directories. Rooting at the git root silently breaks the fork for every agent working in a subdirectory.
**Rejected**: walking the pane cwd up via `config.FindGitRoot` and rooting there (the original R4 — matches `deriveRepoRoot`'s repo-level semantics but the wrong contract for a cwd-keyed resume).
*Introduced by*: 260806-s4av-row-flyout-session-fork (review cycle 1)

#### The resume suffix is gated on a claude launcher
**Decision**: a non-empty `ResumeSessionRef` with a resolved launcher whose command word is not `claude` is a `ValidationErr` (→ `400`), not a silent plain spawn and not a blind flag append.
**Why**: `--resume`/`--fork-session` are Claude-only flags and `ResolveLauncher` returns a provider-opaque string from the repo's default tier — in a mixed-provider repo the source window's provider gate (claude) says nothing about the destination launcher. Failing loudly beats spawning a codex/gemini binary with flags it rejects, or silently dropping the fork semantics.
**Rejected**: resolving the fork's launcher from the source provider (no such per-provider launcher seam exists in v1 — tier plumbing is a non-goal); silently appending (hands claude flags to another binary); silently skipping the suffix (spawns an unforked agent that looks like a fork).
*Introduced by*: 260806-s4av-row-flyout-session-fork (review cycle 1)

#### The resume flags ride the launcher half of the shell string
**Decision**: `--resume <uuid> --fork-session` is appended to the launcher string that `buildSkillShellString` treats as deliberately unescaped, not to the escaped positional argument.
**Why**: the launcher is the documented Constitution §I exception (it carries shell expansion like `$(basename "$(pwd)")`), and flags must reach `claude` as flags, not as a quoted positional. The uuid is validated twice (API layer + a defensive re-check at the composition seam) so nothing shell-significant can enter that unescaped element.
**Rejected**: passing the flags as part of the escaped skill/task positional (they would arrive as one quoted argument and be ignored by the launcher).
*Introduced by*: 260806-s4av-row-flyout-session-fork

## Tasks

### Phase 1: Engine inputs (backend, no HTTP surface)

- [x] T001 Add `ResumeSessionRef string` + `WindowNameBase string` to `riff.Options` in `app/backend/internal/riff/riff.go`, consumed by `Spawn` (empty = today's behavior); `ResumeSessionRef` lives on `Options` ONLY (drop the write-only `EffectiveSpec.ResumeSessionRef` — the `Tier` precedent for launcher-seam-consumed inputs); document each field in the struct comments beside the existing `Where`/`WorktreeName` fields <!-- R6 R7 --> <!-- rework: review cycle 1 — EffectiveSpec copy was write-only provenance; R6 amended to Options-only -->
- [x] T002 Add the pure launcher-composition helper (`resumeForkLauncher(launcher, ref string) string`) plus the engine-local `uuidRe`-shaped defensive check in `app/backend/internal/riff/shell.go`, wire it at the `Spawn` launcher-resolution seam, and gate the suffix on the resolved launcher being a claude invocation (basename of first command word == `claude`): non-empty ref + non-claude launcher → `riff.ValidationErr` naming the launcher <!-- R6 --> <!-- rework: review cycle 1 — Claude-only flags were appended to a provider-opaque launcher; R6 amended with the gate -->
- [x] T003 Apply `WindowNameBase` in `spawnRiffReturningName` (`app/backend/internal/riff/riff.go`) — non-empty replaces the `riff-<basename>` base before `resolveWindowName`, blank keeps today's derivation <!-- R7 -->
- [x] T004 Extend engine table tests in `app/backend/internal/riff/riff_test.go`: `TestResumeForkLauncher` (valid uuid appends both flags; empty ref unchanged; non-uuid ref unchanged), the claude-launcher gate cases (claude launcher appends; codex/gemini launcher + non-empty ref → `ValidationErr`; non-claude launcher + empty ref spawns normally), and the `WindowNameBase` coverage (base override + collision suffixing + blank fallback) <!-- R6 R7 R8 --> <!-- rework: review cycle 1 — add the gate cases -->

### Phase 2: Fork endpoint (backend)

- [x] T005 Amend `app/backend/api/fork.go` `handleWindowFork`: pass the pane cwd ITSELF as the engine `RepoRoot` (the fork must open in the source agent's exact directory — claude's transcript store is cwd-keyed); keep `config.FindGitRoot` ONLY as the non-repo `400` gate. Everything else unchanged: `parseWindowID` + `serverFromRequest`, the single `FetchSessions` resolve, the `claude`-provider gate, the strict UUID gate, the `s.riff == nil` guard, the engine call with `Where:"checkout"` / `ResumeSessionRef` / `WindowNameBase`, riff-shaped 200, `riffStatusForError` mapping <!-- R1 R2 R3 R4 R5 --> <!-- rework: review cycle 1 — A-004 NOT MET: walked-up root breaks resume for subdirectory cwds (empirically verified); R4 amended -->
- [x] T006 Register `POST /api/windows/{windowId}/fork` in `app/backend/api/router.go` beside the chat routes <!-- R1 -->
- [x] T007 Amend `app/backend/api/fork_test.go`: INVERT `TestForkRepoRootWalksUpFromPaneCwd` — a subdirectory pane cwd must reach the engine verbatim as `RepoRoot` (the old assertion locked the A-004 bug in); keep the full status matrix (200 with engine inputs recorded, 400 malformed windowId / non-repo cwd, 404 absent / no chat / non-claude / non-uuid, 500 fetch fault / unwired engine / subprocess error — each asserting the engine was NOT called on error paths) <!-- R1 R2 R3 R4 R5 --> <!-- rework: review cycle 1 — the suite actively asserted the buggy relocation as correct -->

### Phase 3: Frontend fork affordance

- [x] T008 [P] Add `forkWindow(server, windowId)` to `app/frontend/src/api/client.ts` (POST via `withServer` + `throwOnError`, returning `RiffSpawnResult`) <!-- R9 -->
- [x] T009 Amend the fork button in `app/frontend/src/components/sidebar/row-flyout-card.tsx`: add the in-flight `disabled={busy}` guard (the spawn dialog's idiom) so repeated clicks cannot fire multiple POSTs; drop the unused `export` on `FORKABLE_CHAT_PROVIDER` (keep the named constant); keep the `ForkIcon` inline SVG beside `InfoIcon`, the `chatProvider === "claude"` + optional-`onFork` double gate, `stopPropagation`, same-directory tooltip/aria copy <!-- R10 R11 --> <!-- rework: review cycle 1 — no in-flight guard; N clicks created N forks -->
- [x] T010 Amend the fork handler threading (`app/frontend/src/app.tsx` → `Sidebar` → `WindowRow` → `useRowFlyout`): carry the busy state through to the button, clear it on settle (success or error), keep the navigate-on-success rule + empty-`windowId` skip + error surfacing; remove the stray double blank line at the `handleForkWindow` insertion <!-- R9 R10 R11 --> <!-- rework: review cycle 1 — busy guard + collateral cleanup -->
- [x] T011 Extend `app/frontend/src/components/sidebar/row-flyout-card.test.tsx`: keep the four gate states + click-invokes-handler cases; add the busy case — while the handler's promise is pending the button is disabled and a second click does not re-invoke <!-- R10 R11 --> <!-- rework: review cycle 1 — cover the in-flight guard -->

### Phase 4: E2E + verification

- [x] T012 Extend the fork e2e in `app/frontend/tests/e2e/row-flyout.spec.ts`: keep the gating test; add a navigation case with a NON-empty mocked `windowId` asserting the resulting `/$server/$window` URL (the old mock's `windowId:""` deliberately skipped navigation, leaving R11 uncovered at every level); update the sibling `row-flyout.spec.md` per the constitution's Test Companion Docs rule <!-- R10 R11 --> <!-- rework: review cycle 1 — navigation contract had zero coverage -->
- [x] T014 Fix the collateral typo in `app/backend/internal/riff/shell.go` — `escapeSingleQuotes`'s doc comment's escape sequence was mangled into a literal U+201D right double quote; restore the correct `'\''` sequence <!-- R6 --> <!-- rework: review cycle 1 — nice-to-have collateral from this change's edits -->
- [x] T013 Re-run the verification gates: `cd app/backend && go test ./...`, `cd app/frontend && npx tsc --noEmit`, the frontend unit suite via `just`, and `just test-e2e "row-flyout"` <!-- R1 R6 R9 R10 --> <!-- rework: review cycle 1 — re-verify after rework -->

## Execution Order

- Phase 1 (T001–T004) blocks Phase 2 (T005 calls the new engine inputs).
- T005 blocks T006 and T007.
- T008 blocks T010; T009 blocks T010 and T011.
- T012 depends on T009/T010 (the link must exist to assert on).
- T013 is last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `POST /api/windows/{windowId}/fork?server=` exists, is registered beside the chat routes, reads no request body, and returns the riff result shape on success.
- [x] A-002 R2: The handler resolves chat identity server-side via `FetchSessions` + `sessions.ResolveChatPane`, with a 500/404 split between a fetch fault and a genuine no-chat.
- [x] A-003 R3: The resolved uuid passes a strict UUID-shape check before any argv composition; a non-UUID ref is 404 with no engine call.
- [x] A-004 R4: The engine receives the resolved window's pane cwd ITSELF as `RepoRoot` (a repo-subdirectory cwd reaches the engine verbatim, so the forked claude opens where the source agent runs and the resume resolves); `config.FindGitRoot` is used only as the gate — a non-repo cwd is a 400 naming the directory.
- [x] A-005 R5: The engine receives `Where:"checkout"`, the source session, the resolved uuid, and `<sourceWindowName>-fork`; engine errors map ExitValidation→400 / else→500.
- [x] A-006 R6: `Options` (and Options ONLY — no `EffectiveSpec` copy, per the `Tier` precedent) carries `ResumeSessionRef`, and the launcher becomes `<launcher> --resume <uuid> --fork-session` when it is set and the launcher is a claude invocation.
- [x] A-007 R7: `WindowNameBase` overrides the `riff-<basename>` base and the existing collision suffixing still applies.
- [x] A-008 R9: `forkWindow(server, windowId)` exists in `client.ts` using `withServer` + `throwOnError`.
- [x] A-009 R10: The flyout header renders a fork affordance beside the ⓘ link, gated on `chatProvider === "claude"` plus a supplied handler.
- [x] A-010 R11: A successful fork navigates to the returned window (same-server and cross-server), and an empty `windowId` skips navigation.

### Behavioral Correctness

- [x] A-011 R8: `rk riff` behavior is byte-identical — the CLI sets neither new input, and the engine's empty-`ResumeSessionRef`/empty-`WindowNameBase` paths reproduce the pre-change launcher and window name.
- [x] A-012 R6: The resume flags are appended to the launcher half of the shell string (the unescaped element), not to the escaped positional argument.
- [x] A-013 R5: The forked window is a NEW tmux window in the source session (never a split pane in the source window) rooted at the SAME directory as the source pane's cwd — including when that cwd is a repo subdirectory — with no `wt create` invocation.

### Scenario Coverage

- [x] A-014 R6: `TestResumeForkLauncher` covers valid-uuid / empty-ref / non-uuid-ref in a table test.
- [x] A-015 R7: The window-name coverage exercises a non-empty `WindowNameBase` with and without a collision, plus the blank fallback.
- [x] A-016 R1: `api/fork_test.go` exercises the full status matrix (200/400/404/500) against the mock engine, asserting no engine call on every error path.
- [x] A-017 R10: `row-flyout-card.test.tsx` covers the gate in all four states (claude+handler, no provider, non-claude provider, no handler) and the click behavior.
- [x] A-018 R10: The e2e (`row-flyout.spec.ts` + updated `.spec.md`) proves the fork link appears for a claude-chat row and not for a plain shell row.

### Edge Cases & Error Handling

- [x] A-019 R2: A `codex`-provider window returns 404 (v1 forks Claude only), distinct from the no-chat 404 message.
- [x] A-020 R5: An unwired riff engine returns 500 ("Riff engine not configured"), matching the riff handler's nil-safe house pattern.
- [x] A-021 R11: A rejected fork surfaces the error message to the user instead of failing silently.
- [x] A-022 R3: The defensive engine-seam UUID re-check means a non-UUID ref that somehow bypassed the API layer still cannot enter the launcher string.
- [x] A-033 R6: A non-empty resume ref with a non-claude resolved launcher fails the spawn with `ValidationErr` (mapped to 400) — no window created, no claude flags handed to another binary, no silent unforked spawn.
- [x] A-034 R11: The fork button is disabled while a fork POST is in flight; a second click during flight fires no second POST, and the busy state clears on settle (success and error).
- [x] A-035 R11: The e2e covers the navigation contract with a non-empty mocked `windowId` asserting the resulting `/$server/$window` URL (in addition to the gating case).

### Code Quality

- [x] A-023 Pattern consistency: New code follows naming and structural patterns of surrounding code (`api/riff.go` + `api/chat.go` handler idiom, `internal/riff` pure-helper test seams, the flyout's inline-SVG icon idiom).
- [x] A-024 No unnecessary duplication: `riffStatusForError`, `sessions.ResolveChatPane`, `config.FindGitRoot`, `resolveWindowName`, `RiffSpawnResult`, `withServer`/`throwOnError` are reused rather than reimplemented.
- [x] A-025 Uniform HTTP verb (Constitution IX): the fork endpoint is `POST`; no new verb shapes.
- [x] A-026 No new routes or pages (Constitution IV): the frontend adds no route — the fork navigates to the existing `/$server/$window`.
- [x] A-027 Derived state (Constitution II/X): every fork input except `windowId`/`server` is derived from tmux + the filesystem at request time; nothing is cached and nothing is pushed by an agent.
- [x] A-028 Type narrowing over assertions (frontend): the `chatProvider` gate uses an equality guard, not an `as` cast.
- [x] A-029 New behavior is covered by tests: engine helpers (table tests), handler (status matrix), component (gate + click), e2e (gating).

### Security

- [x] A-030 R3: The uuid is shape-validated at the API layer BEFORE the engine call and re-validated at the launcher-composition seam — no user-controlled substring can reach the launcher string (Constitution I).
- [x] A-031 R1: All subprocess execution remains argv-slice `exec.CommandContext` with timeouts inside the engine; the fork handler constructs no shell string and adds no subprocess of its own.
- [x] A-032 R4: Nothing is created on any 4xx path — every validation gate short-circuits before the engine call (the riff handler's 400-before-subprocess discipline).

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. Both candidates raised in review cycle 1 are resolved in the tree: `riff.EffectiveSpec.ResumeSessionRef` no longer exists (`ResumeSessionRef` is on `Options` only — `internal/riff/riff.go:191`, with the deliberate absence documented at `riff.go:139`), and `FORKABLE_CHAT_PROVIDER` is now an unexported module constant (`row-flyout-card.tsx:210`). The one thing this change *removed* is duplication it would otherwise have created: the spawn dialog's inline `onSpawned` navigation block collapsed into the shared `navigateToSpawnedWindow` (`app.tsx:1494`), and `deriveRepoRoot`'s pane-cwd picking became the shared `windowCwd` (`api/riff.go:88`) rather than being re-implemented in the fork handler.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The fork handler resolves session name, chat identity, pane cwd and window name from ONE `FetchSessions` walk rather than composing `resolveWindowChat` + `deriveRepoRoot(session)` | The endpoint is window-keyed and needs the enclosing session name; `deriveRepoRoot` is session-keyed and would derive the cwd from the session's ACTIVE window, not the requested one — wrong pane for forking a background window. Recorded as a Design Decision. | S:85 R:80 A:95 D:85 |
| 2 | Certain | Engine seam names are `ResumeSessionRef` and `WindowNameBase` on both `Options` and `EffectiveSpec` | Named verbatim in the intake's What-Changes §2 as the suggested seams; matches the `Where`/`WorktreeName`/`Tier` precedent of paired Options/EffectiveSpec fields. | S:95 R:85 A:95 D:90 |
| 3 | Certain | The launcher-composition helper is pure (`resumeForkLauncher(launcher, ref) string`) with an engine-local defensive UUID check, table-tested | Mirrors the established pure-helper test-seam pattern (`parseFabAgentOutput`, `buildWtCreateArgs`, `parsePaneID`) the intake and rk-riff memory both name as the unit surface. | S:85 R:90 A:95 D:90 |
| 4 | Confident | The fork affordance is wired through an OPTIONAL `onFork` callback on `useRowFlyout`'s options, so a consumer passing none renders no button | The flyout hook currently takes only `(win, {suppressed})` and has no server/navigation access; the optional-prop idiom (`onSpawnAgent`, `onColorChange`) is the codebase's established way to gate an affordance per call site, and it keeps the board-route sidebar unchanged. | S:65 R:85 A:85 D:75 |
| 5 | Confident | `forkWindow` reuses the existing `RiffSpawnResult` type rather than declaring a second identical shape | The intake specifies the endpoint returns riff's result shape verbatim; a duplicate type would be the "duplicating existing utilities" anti-pattern from code-quality.md. | S:80 R:90 A:90 D:85 |
| 6 | Confident | Fork errors are surfaced to the user via the app's existing error-surfacing path for a failed sidebar mutation, not a new dialog | The intake specifies no error UI; adding a bespoke modal would exceed Constitution IV's minimal-surface rule. Reversible polish. | S:55 R:90 A:70 D:65 |
| 7 | Confident | The fork glyph is a hand-built inline SVG (a git-fork/branch shape) sized to match `InfoIcon` (12px), not a Nerd Font glyph | `row-flyout-card.tsx`'s own `InfoIcon` comment states the codebase convention explicitly (inline SVG so it renders without a patched terminal font and themes via `currentColor`). Exact glyph is reversible polish (intake assumption 8). | S:60 R:95 A:85 D:70 |
| 8 | Confident | The e2e addition extends the existing `row-flyout.spec.ts` (adding a `chatProvider: "claude"` window to its mocked state) rather than creating a new spec file | The gating assertion is one more property of the same card the spec already covers; a new file would duplicate the whole mocked-state harness. Its `.spec.md` is updated in the same commit per the constitution. | S:70 R:90 A:85 D:80 |
| 9 | Confident | A non-`claude` reconciled provider returns 404 with a message distinguishing it from "no chat at all" | The intake specifies `404` when "the provider is not `claude`"; a distinct message is the same courtesy `riffNonRepoMsg` extends for its two no-cwd cases. | S:75 R:90 A:85 D:80 |
| 10 | Confident | A non-empty resume ref with a non-claude launcher fails loudly (`ValidationErr` → 400) rather than silently spawning unforked or blindly appending claude flags | Review cycle 1 decision: the two silent alternatives both misrepresent the result to the user; failing maps onto the existing ExitValidation→400 contract (same class as unknown preset — config-determined, client-visible). | S:70 R:85 A:85 D:75 |

10 assumptions (3 certain, 7 confident, 0 tentative).
