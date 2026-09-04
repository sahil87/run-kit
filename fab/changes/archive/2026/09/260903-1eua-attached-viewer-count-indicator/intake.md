# Intake: Attached Viewer Count Indicator

**Change**: 260903-1eua-attached-viewer-count-indicator
**Created**: 2026-09-03

## Origin

Conversational — companion change to `260903-xj0w-hidden-page-stream-release`, from the same `/fab-discuss` diagnosis session (2026-09-03). While debugging "tmux constantly resizes on tab switch", the culprit — a second run-kit view attached to the same session from a background desktop-shell window — was **invisible**: finding it required server-side `tmux list-clients` forensics plus tailscale per-peer traffic diffing. The user agreed a viewer-count surface would have made it a five-second diagnosis:

> Make viewers visible: derive the attached-client count/sizes from list-clients at request time … so a second viewer is a visible fact instead of a ghost.

Live data from the session (shape of what the feature must render):

```
/dev/pts/5  144×91  attached          ← the user's active view
/dev/pts/8  116×37  attached          ← the phantom (background desktop-shell view)
/dev/pts/11 80x–    control-mode,ignore-size  ← rk daemon's tmuxctl subscription (must be excluded)
```

## Why

1. **Problem**: run-kit makes every terminal view a full tmux attach client, and tmux window sizing is arbitration across all sized clients of a session. A forgotten background viewer (second desktop-shell window, backgrounded tab, another device) degrades the visible view — windows snap to the smaller client's grid — with **zero UI trace** that a second viewer exists.
2. **Consequence if unfixed**: Even with the hidden-page stream release (`260903-xj0w`) shipped, genuinely *visible* concurrent viewers (two monitors, a teammate, a phone actively open) still co-size windows. When that surprises the user, run-kit today offers no way to see who's attached short of SSHing to the box and running `tmux list-clients`.
3. **Why this approach**: The count and sizes are fully derivable at request time from `tmux list-clients` — a pure Constitution §II derivation (no new pushed state, no cache, no hook; Constitution §X: derivation wins). Surfacing it is cheap and turns an invisible failure class into a glanceable fact.

## What Changes

### 1. Backend derivation: per-session viewer list from `list-clients`

Add a `list-clients` wrapper in `internal/tmux/` (per code-quality rules: all tmux interaction goes through `internal/tmux/`; `exec.CommandContext` with timeout):

```
tmux -L {server} list-clients -F '#{client_tty} #{client_width}x#{client_height} #{session_name} #{client_flags}'
```

Parse into per-session viewer entries `{width, height}`. **Exclude** clients whose flags contain `control-mode` or `ignore-size` — the rk daemon's tmuxctl subscription attaches this way on every server and never participates in window sizing (verified live). Fold the result into the existing per-session payload produced by `internal/sessions.FetchSessions` (a `viewers: [{width, height}]` field or equivalent), so it rides the existing state-socket snapshot with **no new endpoint and no client poll** (anti-pattern: polling from the client; the SSE/state stream is the transport).

Sizing/perf note: `list-clients` is one tmux round-trip per server per snapshot — same cost class as the existing enumeration calls in the fetch path.

### 2. Frontend: viewer badge on the session, detail on demand

- **Signal**: a compact viewer-count indicator on the session header row in the sidebar (the session is the correct scope — clients attach to sessions, and all windows of a session share the arbitration). **Rendered only when ≥ 2 sized viewers** — the 1-viewer case is the norm and must not add chrome (minimal-surface, Constitution §IV).
- **Detail**: hovering / the existing flyout idiom for that row reveals the viewer list with grids (`144×91`, `116×37`) so a clamping client is identifiable at a glance — the size *is* the diagnostic payload, not just the count.
- Display-only, no actions (there is nothing safe to actuate — detaching self-heals). Because it is passive information, no command-palette action is required (Constitution §V governs *actions*); if a palette surface is trivially available via existing patterns, a read-only entry MAY be added but is not required.
- Follow the status-signals vocabulary in `docs/memory/run-kit/ui/status-signals.md` / `docs/specs/status-pyramid.md` for placement/treatment — this is an informational channel, not an attention overlay.

### 3. Explicitly out of scope

- No mutation endpoints (no "kick viewer" action — rk streams self-heal re-attach, so it would be a lie).
- No per-window viewer attribution (tmux clients attach to sessions; per-window "who is looking" is not derivable and hooks must not push it — Constitution §X).
- No persistence, no settings.

## Affected Memory

- `run-kit/tmux-sessions`: (modify) session enumeration — the list-clients derivation, the control-mode/ignore-size exclusion rule
- `run-kit/api-and-sockets`: (modify) state-socket session payload — the `viewers` field
- `run-kit/ui/sidebar`: (modify) session-header viewer badge + detail flyout
- `run-kit/ui/status-signals`: (modify) only if the treatment adds to the signal vocabulary; otherwise untouched

## Impact

- `app/backend/internal/tmux/` — `ListClients` wrapper + parser (+ colocated `_test.go`)
- `app/backend/internal/sessions/` — fold viewers into the per-session model (+ tests)
- `app/backend/api/` — payload plumbing where the session snapshot is rendered for the state socket (+ handler test updates)
- `app/frontend/src/components/sidebar/` — session header badge + flyout detail (+ colocated `.test.tsx`)
- `app/frontend/src/api/client.ts` types — session shape gains `viewers`
- e2e: extend an existing sidebar/real-tmux spec — attach a second client to the test socket and assert the badge appears with both grids (Playwright, per Test Intent Comments rule)

## Open Questions

- None blocking. Placement/treatment is a graded assumption below (reversible UI decision).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Derive at request time from `tmux list-clients`; no pushed state, no cache, no new endpoint | Discussed and agreed; Constitution §II/§X make this the only admissible shape | S:90 R:90 A:95 D:95 |
| 2 | Certain | Exclude `control-mode` / `ignore-size` flagged clients from the count | Verified live — the daemon's tmuxctl subscription attaches control-mode on every server and never affects sizing | S:90 R:90 A:95 D:90 |
| 3 | Confident | Ride the existing state-socket session snapshot (`viewers` per session) rather than a new endpoint | The sidebar already renders from this stream; polling is a named anti-pattern | S:80 R:80 A:90 D:85 |
| 4 | Tentative | Placement: sidebar session-header badge, shown only when ≥ 2 sized viewers, sizes in the row's flyout/tooltip detail <!-- assumed: sidebar session header + ≥2 gating — session is the arbitration scope and the 1-viewer norm must stay chrome-free; exact treatment defers to the status-signals vocabulary at plan time --> | Multiple valid surfaces (top bar, server card); easily moved; UI conventions documented in memory | S:60 R:85 A:65 D:50 |
| 5 | Confident | Show each viewer's grid (`WxH`) in the detail surface | The size is the diagnostic payload — it identifies the clamping client; count alone would not have shortened the live debugging session | S:75 R:85 A:85 D:80 |
| 6 | Confident | Display-only — no kick/detach action | Detach self-heals within seconds (verified live), so an action would misrepresent; keeps the change read-path only | S:80 R:85 A:85 D:85 |

6 assumptions (2 certain, 3 confident, 1 tentative, 0 unresolved).
