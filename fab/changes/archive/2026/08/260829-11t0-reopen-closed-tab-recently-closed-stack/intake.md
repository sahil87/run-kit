# Intake: Reopen closed tab — ⇧⌘T rebinding + recently-closed window stack

**Change**: 260829-11t0-reopen-closed-tab-recently-closed-stack
**Created**: 2026-08-29

## Origin

Conversational — synthesized from a user discussion (dispatched promptless via `/fab-proceed`; no questions were asked at intake, every would-be question is a deferred row in `## Assumptions` (Rationale `Deferred — promptless dispatch`, rows 1–3)).

> On the mac desktop shell, ⇧⌘T currently maps to `create-session` (`macCode: "KeyT"` on the shifted tier). Rebind ⇧⌘T on mac to a new `reopen-window` action ("Reopen closed tab"), matching the universal browser/VS Code/iTerm2 convention. `create-session` becomes palette-only on mac (drop its `macCode` refinement; in a mac browser ⇧⌘T is browser-reserved anyway). Win/Linux is unchanged: ⇧Ctrl+N = create-session, ⇧Ctrl+T = create-window. Decide (deferred if needed) whether `reopen-window` gets a Win/Linux chord — none is obviously free on the shifted tier; palette-only there is acceptable.
>
> A tmux window kill is process death, so "reopen" restores the *shell*, not the process: a new window in the same session, same name, same cwd, same position where feasible, with the captured `@rk_win_*` options re-stamped (layout, indexed web tabs, code root, note). Label/description must say so — "Reopen closed tab (fresh shell)".
>
> At `kill-window` time (the existing confirm flow), push a record onto a per-server "recently closed" stack (~10 entries): session, window name, index, pane cwd(s), the `@rk_win_*` option set, and any `@rk_pane_chat` agent identity. Preference: reuse/extend the `internal/snapshot` store history if it makes reload-survival cheap; otherwise a client-side stack is acceptable — record the tradeoff.
>
> Reopen: `new-window -t <session> -n <name> -c <cwd>` (exact-match `=name:` targets) + re-stamp captured options + navigate to the new window. Pops the stack (LIFO).
>
> If the killed pane carried an agent identity (`@rk_pane_chat`), reopen should offer to relaunch the agent with `--resume` using the existing `rk riff` `ResumeSessionRef` fork-launcher seam. In scope ("yes, that would be good"). How the offer surfaces (auto vs prompt) is deferable.
>
> Palette: `Tab: Reopen closed` entry with id `reopen-window` (so the chord hint renders), absent when the stack is empty — the existing "gate the chord for free" pattern.

Key decisions from the conversation: (1) ⇧⌘T moves from `create-session` to `reopen-window` on mac; (2) reopen is honestly labelled as a fresh shell, never a process resurrection; (3) the record is captured at the kill seam, not reconstructed after the fact; (4) agent relaunch via `ResumeSessionRef` is in scope; (5) Win/Linux bindings are untouched.

## Why

**The pain point.** Closing a tmux window in run-kit is one ⌘W (mac) / ⇧Ctrl+W away, behind a confirm dialog — but the confirm cannot protect against the *right* answer being wrong a moment later ("I needed that worktree window's web tabs and code root"). Today the only recovery is manual: create a new tab, `cd` back, re-add each web tab, re-point the code surface, re-set the note. The whole-server snapshot restore (`internal/snapshot`, the Host Overview RECOVERY zone) does not help — it restores a *dead server*, never one window inside a live one, and its cadence is debounced so the latest snapshot may predate the window anyway.

**Why ⇧⌘T specifically.** ⇧⌘T is "Reopen closed tab" in every mac browser, VS Code, and iTerm2 — a reflex chord. run-kit currently spends it on `create-session` on mac hosts (`app/frontend/src/lib/keybindings.ts` row `{ actionId: "create-session", code: "KeyN", tier: "shifted", macCode: "KeyT", … }`), so the reflex fires the *wrong* action: a brand-new session group. In a mac browser the chord is already browser-reserved (`claimedKeys` pushes `{ code: "KeyT", tier: "shifted", label: "reopen tab", owner: "browser" }` outside the shell), so `create-session` is palette-only there today — the shell is the only host where the chord is live, and it is live on the wrong verb. Moving it also makes the mac N/T/W map read as one consistent tab-model story: ⌘T new tab · ⇧⌘T reopen tab · ⌘W close tab · ⇧⌘W close app window · ⌘N new app window.

**Why capture at kill time.** Everything reopen needs — the window's `@rk_win_*` option set, pane cwds, the `@rk_pane_chat` identity — lives *only* on the window and dies with it. There is no after-the-fact derivation (Constitution II derives live state; a killed window has no live state), so the record must be taken in the kill handler *before* `tmux.KillWindow` runs. This is the same posture as `handleServerKill` calling the snapshotter's `NoteAuditedKill` just before `tmux.KillServer` (`api/tmuxctl_bridge.go`).

**Why not do nothing.** Users keep the reflex; every accidental close stays a multi-minute rebuild; the mac ⇧⌘T keeps creating stray sessions. The UI State spec's whole point (every addressable thing is a tmux option) is what makes a faithful reopen *cheap* — the option set is already enumerated and round-tripped by `internal/snapshot`'s capture format (`layoutWindowFormat`) and `windowOptionOps(win)`.

## What Changes

### 1. Keybinding registry — `app/frontend/src/lib/keybindings.ts`

**New row** (global scope, shifted tier, mac refinement only):

```ts
// ⇧⌘T reopen closed tab — the universal browser/VS Code/iTerm2 reflex. Mac
// only via `macCode`: the base is KEYLESS (the app-window pair precedent) —
// no Win/Linux chord is free on the shifted tier (T is create-window, N is
// create-session), so it stays palette-only there. In a mac BROWSER the
// shifted KeyT is browser-owned ("reopen tab" claim) and resolves reserved —
// palette-only, exactly like create-window's ⌘T.
{ actionId: "reopen-window", code: "", tier: "shifted", macCode: "KeyT", scope: "global", kind: "builtin", label: "Reopen closed tab", description: "fresh shell — same session, name, folder, layout and web tabs", mapLabel: "reopen tab" },
```

**Modified row** — `create-session` swaps its `macCode: "KeyT"` for a mac-KEYLESS refinement (`macCode: ""`), so it is fully palette-only on mac in both hosts while Win/Linux keeps ⇧Ctrl+N: <!-- clarified: user chose fully palette-only on mac over leaving ⇧⌘N live in the mac shell -->

```ts
{ actionId: "create-session", code: "KeyN", tier: "shifted", macCode: "", scope: "global", kind: "builtin", label: "New session", description: "a new group of tabs", mapLabel: "new session" },
```

This needs a one-line `defaultComboFor` tweak: the mac branch must test `macCode !== undefined` (not truthiness) so an empty `macCode` yields the unbound combo instead of falling back to the base `KeyN`. The `reopen-window` row itself uses the untouched keyless-base shape (`code: ""` + `macCode`) that `new-app-window`/`close-app-window` already use.

Effect per host:

| Host | `create-session` | `reopen-window` | `create-window` |
|------|------------------|-----------------|-----------------|
| mac shell | unbound (mac-keyless refinement) → palette-only | **⇧⌘T** | ⌘T |
| mac browser | reserved (⇧⌘N = incognito claim) → palette-only | reserved (⇧⌘T = "reopen tab" claim, already in `claimedKeys`) → palette-only | reserved → palette-only |
| Win/Linux | ⇧Ctrl+N (unchanged) | unbound (keyless base) → palette-only | ⇧Ctrl+T (unchanged) |

Conflict-free invariant: `reopen-window` on mac is `shifted:KeyT`, `create-window` is `cmd:KeyT` — tier-disjoint on one code, the same shape the split pair uses (`findConflicts` stays clean, the existing `keybindings.test.ts` invariant test covers it). No claimed-keys data changes: the mac-browser shifted `KeyT` "reopen tab" claim already exists and now names the action it actually shadows.

**Header comment** of `DEFAULT_BINDINGS` (the "macOS demotions" paragraph and the N/T/W convention comment) is rewritten to describe the new map: ⌘T new tab · ⇧⌘T reopen tab · ⌘W close tab, with `create-session` no longer listed among the `macCode` exceptions.

**Unit tests** (`keybindings.test.ts`): `:1629 "mac shell: create-session rides ⇧⌘T (macCode)…"` flips to assert `reopen-window` rides ⇧⌘T and `create-session` resolves unbound (`""`) on mac; a new `defaultComboFor` case covers the empty-`macCode` refinement; `:1674` (mac browser) asserts both resolve `disabledReason: "reserved"`; the Win/Linux default map (`:62`) gains `"reopen-window": ""` (unbound) alongside the other keyless bases; the palette-id ↔ binding-id table (`:723`) gains `"reopen-window": ["reopen-window"]`.

### 2. Palette entry + dispatcher — `app/frontend/src/app.tsx`

Beside the existing `{ id: "kill-window", label: "Tab: Kill", onSelect: dialogs.openKillConfirm }` (≈`:2719`), add a **stack-gated** entry:

```ts
...(recentlyClosed.length > 0
  ? [{
      id: "reopen-window",
      label: "Tab: Reopen closed",
      description: `${top.name} — fresh shell in ${top.session}`,
      onSelect: () => void reopenClosedWindow(server),
    }]
  : []),
```

Gating on `length > 0` is the existing "gate the chord for free" pattern: the dispatcher's handler map (`≈:3924`) gains `"reopen-window": fromPalette("reopen-window")`, and `fromPalette` yields no handler when the entry is absent, so ⇧⌘T on an empty stack falls through untouched (no toast, no `preventDefault`). `withShortcutHints` then renders the ⇧⌘T hint on the entry automatically because the actionId doubles as the palette id.

The entry is per-**server** (the stack is per-server); it is offered on every route where the palette mounts for that server (window and server routes), not only on the killed window's session.

### 3. Recording at the kill seam — backend

**Where.** `api/windows.go` `handleWindowKill` (`POST /api/windows/{windowId}/kill`) — the single route every UI kill path already goes through: the confirm dialog (`hooks/use-dialog-state.ts` `executeKillWindow` → `api/client.ts` `killWindow`), the sidebar kill controls, and bulk close (`app.tsx` `executeBulkClose`). Before `s.tmux.KillWindow(...)`:

1. Resolve the window's capture record from tmux using the **existing snapshot capture reads** (`tmux.ListLayoutWindows` + `tmux.ListLayoutPanes` filtered to this `windowID`, or a new single-window variant of the same `layoutWindowFormat` so a kill does not walk every window on the server). The record reuses `snapshot.Window` verbatim (`Index`, `ID`, `Name`, `Layout`, `Color`, `RkLayout`, `WebTabs`, `WebRoots`, `WebActive`, `CodeRoot`, `Marker`, `Flair`, `Role`, `Note`, `Panes[] {Cwd, Command, Active}`) plus the fields the snapshot struct does not carry:

```go
// ClosedWindow is one entry on a server's recently-closed stack — a
// per-window recovery backup taken at the kill seam, never derivable after.
type ClosedWindow struct {
    ID        string          `json:"id"`        // opaque record id (unix-nanos or uuid)
    ClosedAt  time.Time       `json:"closedAt"`
    Server    string          `json:"server"`
    Session   string          `json:"session"`   // owning (non-pin) session at kill time
    Window    snapshot.Window `json:"window"`    // the full @rk_win_* + panes capture
    // Agent identity, from sessions.ResolveChatPane(panes): active-pane-first rollup.
    ChatProvider string `json:"chatProvider,omitempty"` // "claude" | ...
    ChatRef      string `json:"chatRef,omitempty"`      // Claude session uuid (@rk_pane_chat's ref half)
}
```

2. Push onto the per-server stack, **capped at 10** (oldest dropped). A capture failure (window already gone, tmux read error) is `slog.Debug` and the kill proceeds — recording must never block or fail a kill.
3. Kill as today. The response grows: `{"ok": true, "closed": {ClosedWindow}}` so the client can seed its mirror without a round trip.

**Stack home.** Extend `internal/snapshot` with a per-window store alongside the server snapshots, under the same `$XDG_STATE_HOME/run-kit/snapshots` root (Constitution II recovery-backup carve-out — an artifact about the past, read only by a user-facing recovery reader, driving user-initiated restore; exactly the category the server snapshots already occupy):

```
{server}.json                     — latest server snapshot (existing)
{server}/{unix-ts}.json           — server history (existing)
{server}.died-{ts}.json           — tombstones (existing)
{server}.closed/{unix-nanos}.json — recently-closed windows, last 10 (NEW)
```

Writes go through `fsatomic.WriteFile` (the shared store primitive); prune oldest-first past 10 on write; pop deletes the file. `.closed` cannot collide with a server name (validated `[A-Za-z0-9_-]`, no dots — the `.died-` grammar argument). This gives reload-survival and daemon-restart survival for free and keeps the api package's `internal/snapshot` coupling inside the existing recovery-reader boundary (§ Snapshot read boundary lists `api/recovery.go` as the sole consumer — that memory rule is amended to name the closed-window reader too). The tradeoff vs. a client-side stack is recorded in Assumptions #6.

**What is NOT recorded.** Windows killed outside the API — `tmux kill-window` from a shell, `rk mux kill`, the pane's process exiting, session/server kills — never hit this seam and are not on the stack (non-goal; the whole-server path remains the RECOVERY zone). Scrollback, environment, and running processes are never captured (the snapshot capture-set rule).

### 4. Reopen — backend

**Routes** (Constitution IX: GET reads, POST mutates; `?server=` addressing like the sibling window routes):

```
GET  /api/windows/closed?server=<name>                 → {"closed": [ClosedWindow…]}  newest-first
POST /api/windows/closed/{id}/reopen?server=<name>     → riff-shaped {"server","session","window","windowId"}
     body (optional): {"resume": true}                  — relaunch the agent (§ 5)
POST /api/windows/closed/{id}/dismiss?server=<name>    → {"ok": true}                 (drop without reopening)
```

**Reopen engine** (a new `snapshot.ReopenWindow(ctx, server, rec ClosedWindow, ops)` beside `Restore`, reusing the restore engine's per-window helpers rather than a second implementation):

1. **Session check** — the record's `Session` must still exist on the server (`ListSessions` / exact `=name:` target). If it is gone → `409` `"session <name> no longer exists"` and the record is dropped <!-- assumed: drop-with-toast over recreating the session; a reopen that silently creates a session is a bigger action than the user asked for -->.
2. **Create** — `tmux.CreateWindowAtIndex(session, rec.Window.Index, rec.Window.Name, firstPaneCwd(rec.Window), server)` (exact `=session:index` target, `new-window -d -P -F '#{window_id}'`). If the index is now occupied (tmux errors), fall back to `tmux.CreateWindowWithOptionsID(session, name, cwd, server, nil)` (`new-window -a` after the current window) — the restore engine's documented "append + MoveWindow fallback". A cwd that no longer exists degrades to `$HOME` exactly as `restoreCwd` does.
3. **Re-stamp** — `tmux.SetWindowOptions(ctx, newID, server, snapshot.windowOptionOps(rec.Window))` — the existing helper already emits the full `@rk_win_*` set (color, layout, indexed `@rk_win_web_<n>` + `_root`, `web_active`, `code_root`, marker, flair, role, note). Export it (`WindowOptionOps`) rather than duplicating. `/present/<oldWindowId>/` URLs are restored verbatim (snapshot parity — no `@N` remap).
4. **Panes** — recreate the additional panes at their cwds and `SelectLayout(newID, rec.Window.Layout)` via the restore engine's pane path <!-- assumed: multi-pane windows reopen with their pane split + layout, since the restore engine already does this per window; single-pane is the common case either way -->.
5. **Pop** — delete the record (LIFO by `closedAt`; the `{id}` in the route pins which one, so the palette can later offer more than the top without a contract change).
6. **Select + respond** — `select-window` the new window (the client also navigates to `/$server/$windowId`, the fork endpoint's pattern), respond with the riff-shaped `{server, session, window, windowId}`.

Timeout posture: the handler runs synchronously under a dedicated context (each inner tmux call `TmuxTimeout`-bounded), the `POST /api/recovery/restore` precedent — user-initiated and rare, so the 5s guidance is a documented exception in the handler comment.

### 5. Agent relaunch (`resume: true`)

When `rec.ChatProvider == "claude"` and `rec.ChatRef` matches `forkSessionUUIDRe`, the reopen route MAY relaunch the agent instead of leaving a bare shell:

- Route through the existing engine: `s.riff.Spawn(ctx, riff.Options{ Server, Session: rec.Session, Where: "checkout", RepoRoot: firstPaneCwd(rec.Window), ResumeSessionRef: rec.ChatRef, WindowNameBase: rec.Window.Name })` — byte-for-byte the `handleWindowFork` wiring (`api/fork.go:196-207`), then re-stamp options onto the returned `WindowID` (step 3 above) since riff's spawn does not know the `@rk_win_*` set.
- Preconditions mirror fork's gates: the cwd must be inside a git repo (`FindGitRoot`, else `400` naming the dir — `forkNonRepoMsg`), the resolved launcher must be a claude invocation (the engine's `ValidationErr` otherwise). When either fails, the client falls back to the plain reopen and toasts why.
- **Relaunch mode — `ResumeSessionRef` verbatim** (Assumptions #2, clarified): the reopen path composes `--resume <uuid> --fork-session` exactly as `handleWindowFork` does (`resumeForkLauncher`); no new `riff.Options` knob and no second launcher-composition branch. <!-- clarified: user chose the zero-seam-change fork seam over a plain --resume knob -->
- **Offer surface — post-reopen toast action** (Assumptions #1, clarified): ⇧⌘T and the `Tab: Reopen closed` palette entry ALWAYS perform the plain reopen immediately. When the popped record carries `chatProvider`/`chatRef`, the success toast carries a "Resume agent" action; pressing it calls the reopen route with `resume: true` against the just-created window (the record is retained until the toast dismisses so the id stays resolvable), which spawns the agent pane into that window via the riff seam above. Toast dismissal (timeout or explicit) drops the record. No paired palette entries, no confirm dialog. <!-- clarified: user chose toast action over paired palette entries / confirm dialog -->

The client learns whether the offer applies from the record itself (`chatProvider`/`chatRef` present) — no extra probe.

### 6. Frontend plumbing

- `api/client.ts`: `listClosedWindows(server)`, `reopenClosedWindow(server, id, { resume? })`, `dismissClosedWindow(server, id)`; `killWindow` return type widens to `{ ok: boolean; closed?: ClosedWindow }`.
- A small per-server mirror of the stack (Zustand slice beside `store/window-store.ts` or a `useRecentlyClosed(server)` hook): seeded by `GET /api/windows/closed` on server mount, pushed from the kill response (`use-dialog-state.ts` `executeKillWindow` → `onSuccess`, and `executeBulkClose`), popped on reopen/dismiss. It exists only to gate the palette entry and render its description; the server record is authoritative.
- Reopen handler: `POST … /reopen` → navigate to `/$server/$windowId` (the fork flow's navigation) → toast `Reopened "<name>" (fresh shell)`; on `409 session gone` toast and drop the mirror entry.
- Shortcuts panel (`components/settings-shortcuts-panel.tsx`): no code change — the row and its `mapLabel: "reopen tab"` render from registry data (`states.set(b.code, { …label: b.mapLabel ?? b.label })`); the mac map's T keycap now reads `new tab` (⌘) / `reopen tab` (⇧⌘).

### 7. Tests

- **Go**: `snapshot` store tests for the `.closed/` ring (cap 10, prune order, pop, atomic write), `ReopenWindow` engine tests over the fake `restoreOps` (index hit, occupied-index fallback, dead cwd → `$HOME`, session-gone refusal, option re-stamp set equality with `windowOptionOps`), `api` handler tests for kill-records-then-kills (record present in response; capture failure still kills), the three new routes, and the resume gate (non-repo 400, non-claude provider 404-class).
- **Vitest**: `keybindings.test.ts` per § 1; palette-gating test (entry absent on empty stack, present with hint after a kill).
- **Playwright** (`app/frontend/tests/e2e/shortcut-registry.spec.ts`): the mac-browser test at `:674` ("⌘N and ⇧⌘N stay inert…") keeps its assertion but its intent comment (`:687 "N refines on every mac host (⇧⌘T canonical)"`) is rewritten; add a mac-shell-spoofed test proving ⇧⌘T dispatches `reopen-window` (POST to `/api/windows/closed/*/reopen`) when the mocked stack is non-empty and falls through when empty; add a Win/Linux test proving ⇧Ctrl+T still creates a window and ⇧Ctrl+N still creates a session (no regression). Every new `test()` carries the Proves/Steps JSDoc block (constitution Test Intent Comments). Also sweep `session-name-prompt.spec.ts:8` and `row-flyout.spec.ts` for chord copy mentioning ⇧⌘T (the removal-sweep rule — spec.ts + any prose).

### Non-goals

- No Win/Linux default chord for `reopen-window` unless Assumptions #3 resolves otherwise.
- No recording of kills that bypass `POST /api/windows/{id}/kill`.
- No process resurrection: the pane's former command is reported (`Pane.Command`, informational) never relaunched — except the explicit, opt-in agent `--resume` path.
- No change to the `@rk_win_*` option inventory (UI State spec untouched); no new `RK_*` env var or settings key (the cap of 10 is a named constant, not a setting).

## Affected Memory

- `run-kit/ui/keyboard-and-palette`: (modify) bindings table (N row loses its mac ⇧⌘T column entry, new `reopen-window` row), the `macCode` exception list in § The default binding set, claimed-keys prose (the browser "reopen tab" claim now shadows the action it names), shortcuts-panel mapLabel note, palette action registry (`Tab: Reopen closed`, stack-gated), a Design Decision entry for the ⇧⌘T move + honest "fresh shell" labelling
- `run-kit/layout-snapshots`: (modify) store layout gains the `{server}.closed/` ring; § Snapshot read boundary names the closed-window reader beside `api/recovery.go`; exported `WindowOptionOps`; the `ReopenWindow` engine beside `Restore`
- `run-kit/api-and-sockets`: (modify) the three `/api/windows/closed…` routes and the widened kill response
- `run-kit/rk-riff`: (modify) only if Assumptions #2 resolves to a plain-resume knob (`ResumeMode`) on `riff.Options`
- `run-kit/ui/dialogs-and-state`: (modify) the recently-closed mirror store/hook and the kill-flow `onSuccess` push
- `run-kit/tmux-sessions`: (no change expected) — `=name:` exact targets and `CreateWindowAtIndex` are reused, not extended

Spec note: `docs/specs/ui-state.md` is **not** touched (the option set is re-stamped, not changed). `docs/specs/api.md` gains the three routes if the human maintainer wants the target surface current.

## Impact

- `app/frontend/src/lib/keybindings.ts` (+ `keybindings.test.ts`) — registry rows, header comment
- `app/frontend/src/app.tsx` — palette entry, dispatcher handler, reopen action/navigation
- `app/frontend/src/api/client.ts` — three new calls, widened `killWindow` result
- `app/frontend/src/hooks/use-dialog-state.ts`, `store/window-store.ts` (or a sibling slice) — record push on kill success, mirror stack
- `app/frontend/tests/e2e/shortcut-registry.spec.ts` (+ prose sweep of `session-name-prompt.spec.ts`, `row-flyout.spec.ts`)
- `app/backend/api/windows.go` — `handleWindowKill` capture-before-kill, widened response
- `app/backend/api/router.go` — three routes; `app/backend/api/closed_windows.go` (new) — handlers, resume gate mirroring `fork.go`
- `app/backend/internal/snapshot/` — `ClosedWindow` type, `.closed/` store ring, `ReopenWindow` engine, `WindowOptionOps` export, tests
- `app/backend/internal/tmux/layout.go` — possibly a single-window variant of the `layoutWindowFormat` read
- `app/backend/internal/riff/riff.go` — only if a `ResumeMode` knob is adopted
- `docs/memory/run-kit/ui/keyboard-and-palette.md`, `docs/memory/run-kit/layout-snapshots.md`, `docs/memory/run-kit/api-and-sockets.md`, `docs/memory/run-kit/ui/dialogs-and-state.md`

Scale: medium — one registry edit, three routes, one bounded disk ring, one engine function largely composed of existing helpers. Risk concentrates in the kill handler (must never regress the kill itself) and in respecting the Constitution II read boundary.

## Open Questions

- ~~Win/Linux chord for `reopen-window`~~ — resolved: palette-only (Clarifications 2026-08-29).
- ~~Agent relaunch fork vs. plain resume~~ — resolved: `ResumeSessionRef` verbatim.
- ~~How the resume offer surfaces~~ — resolved: post-reopen toast action.
- ~~`create-session` fully palette-only on mac?~~ — resolved: yes, mac-keyless refinement + `defaultComboFor` tweak.
- When the owning session is gone at reopen time: refuse-and-drop (default) or recreate the session?

## Clarifications

### Session 2026-08-29

| # | Action | Detail |
|---|--------|--------|
| 1 | Changed | "Toast action after plain reopen — ⇧⌘T always reopens the fresh shell; toast offers Resume agent" |
| 2 | Changed | "Reuse ResumeSessionRef verbatim (--resume <uuid> --fork-session), zero seam change" |
| 3 | Changed | "Palette-only on Win/Linux — keyless base, no shifted key spent" |
| 4 | Changed | "create-session fully palette-only on mac — mac-keyless refinement + defaultComboFor tweak; ⇧⌘N not live in the mac shell" |

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Agent-relaunch offer surfaces as a **post-reopen toast action**: ⇧⌘T / the palette entry always reopens the fresh shell immediately; when the record carries an agent identity a toast offers a "Resume agent" action (no paired palette entries, no confirm dialog) | Clarified — user changed to toast action after plain reopen; A/D re-scored for the resolved decision (the deferred placeholders described the open question) | S:95 R:55 A:80 D:85 |
| 2 | Confident | Agent relaunch reuses `ResumeSessionRef` verbatim (`--resume <uuid> --fork-session`) — zero launcher-composition seam change; no new `riff.Options` knob | Clarified — user changed to reuse ResumeSessionRef verbatim; A/D re-scored for the resolved decision (the deferred placeholders described the open question) | S:95 R:40 A:85 D:90 |
| 3 | Confident | `reopen-window` is palette-only on Win/Linux (keyless base; no shifted-tier key spent) | Clarified — user changed to palette-only on Win/Linux | S:95 R:70 A:30 D:15 |
| 4 | Confident | `create-session` becomes **fully palette-only on mac** (both hosts): mac-keyless refinement plus the one-line `defaultComboFor` tweak (`macCode !== undefined`) so ⇧⌘N is NOT live in the mac shell; Win/Linux ⇧Ctrl+N unchanged | Clarified — user changed to fully palette-only on mac | S:95 R:80 A:55 D:35 |
| 5 | Confident | Multi-pane windows reopen with their pane cwds + tmux layout re-applied (restore-engine pane path), not a single pane | The engine already does this per window; single pane is the common case so the difference rarely shows | S:40 R:75 A:60 D:45 |
| 6 | Confident | Stack lives server-side under `internal/snapshot` as a `{server}.closed/` ring (10 entries, `fsatomic`), not a client-side Zustand-only stack | User preference when cheap; the client cannot capture `@rk_win_web_<n>_root` (omitted from `ListWindows`) so a client stack would lose state; disk ring fits the Constitution II recovery-backup carve-out and survives reload. Tradeoff: one more api-side `internal/snapshot` consumer (read-boundary rule amended) | S:65 R:45 A:70 D:60 |
| 7 | Confident | Record captured in `handleWindowKill` before `tmux.KillWindow`; capture failure is `slog.Debug` and never blocks the kill | Only seam where the option set still exists; mirrors `NoteAuditedKill` before `KillServer` | S:80 R:70 A:85 D:85 |
| 8 | Confident | Session gone at reopen → `409`, toast, drop the record (no session recreation) | Reopen is a one-window action; recreating a session is a larger side effect the user did not ask for. Cheap to change | S:50 R:80 A:65 D:60 |
| 9 | Confident | Position: try `CreateWindowAtIndex` at the stored index; occupied → append after current (`-a`), no renumber of neighbours | "Same position where feasible" from the conversation; the restore engine's documented fallback | S:70 R:80 A:80 D:70 |
| 10 | Confident | Reopen `select-window`s + client navigates to `/$server/$windowId`; LIFO pop by record id | Stated in the conversation; the fork endpoint's navigation pattern | S:80 R:85 A:85 D:85 |
| 11 | Confident | New routes are `GET /api/windows/closed`, `POST /api/windows/closed/{id}/reopen`, `POST /api/windows/closed/{id}/dismiss` with `?server=` | Constitution IX (GET read / POST mutate) and the sibling window-route addressing | S:60 R:75 A:90 D:80 |
| 12 | Certain | `reopen-window` is a keyless-base row with `macCode: "KeyT"` on the shifted tier; `defaultComboFor` unchanged | The `new-app-window`/`close-app-window` precedent is exactly this shape | S:85 R:90 A:95 D:90 |
| 13 | Certain | Palette entry `Tab: Reopen closed`, id `reopen-window`, absent when the stack is empty; hint via `withShortcutHints` | Stated verbatim; the existing gate-for-free pattern | S:90 R:90 A:95 D:95 |
| 14 | Certain | Labels say "fresh shell" — no process resurrection except the opt-in agent resume | Stated verbatim in the conversation | S:95 R:95 A:95 D:95 |
| 15 | Certain | Win/Linux N/T/W defaults untouched; no claimed-keys data change (browser "reopen tab" claim on shifted KeyT already exists) | Stated verbatim; verified in `claimedKeys` | S:90 R:90 A:95 D:95 |
| 16 | Certain | Kills bypassing `POST /api/windows/{id}/kill` are not recorded (non-goal) | Follows from capture-at-seam; whole-server recovery stays with the RECOVERY zone | S:75 R:90 A:95 D:90 |
| 17 | Certain | Re-stamp uses the exported `snapshot.windowOptionOps` + `tmux.SetWindowOptions`; no second option-name list | Existing helper already emits the full `@rk_win_*` set; anti-duplication rule | S:80 R:90 A:95 D:95 |
| 18 | Certain | Cap of 10 is a named constant, not a settings key or env var | Constitution IV/VII; matches the snapshot history/tombstone depth | S:70 R:95 A:95 D:95 |

18 assumptions (7 certain, 11 confident, 0 tentative, 0 unresolved) — rows 1–4 were resolved by the user in the 2026-08-29 clarification session; no open decisions remain.
