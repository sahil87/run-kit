# Intake: Tab-switch flicker fix — persistent terminal + byte-gated confirmation

**Change**: 260910-0awz-tab-switch-persistent-terminal
**Created**: 2026-09-10

## Origin

Conversational. A `/fab-discuss` session on the balmy-beaver worktree, seeded by a
screen recording of a sidebar tab sweep on the desktop shell against `dev-ws-sahil01`:

> Check how tab changes work today on run-kit. The flickers. Evaluate the problems and
> suggest fixes.

The recording was decoded frame by frame (terminal-region luminance at 30 fps). Six
same-session switches each showed a 330–670 ms fully blank terminal with no spinner,
then a top-down progressive paint; one switch painted, blanked again for ~250 ms, and
repainted. The diagnosis produced five causes and six candidate fixes; the user then
asked whether to bundle them and accepted the recommendation to split the work:

- **Change A (this change)** — fixes 1 and 2: keep the terminal mounted across same-server
  window switches, and make the SSE-driven "switch arrived" confirmation lift the mask
  only after the incoming window's bytes have arrived.
- **Change B (later, after re-measurement)** — fixes 3–5: one-frame fresh attach (relay
  frame coalescing, held reveal), attach latency, the double-redraw diagnosis.

The plan doc `fab/plans/sahil/26-09-10-tab-switch-flicker.md` (committed on this
branch) records both changes, the measured timeline, and the verification recipe. Item 6
of the original list (memory drift) is this change's hydrate, not a separate item.

## Why

**The pain.** Every sidebar/palette/breadcrumb tab switch on the terminal route shows an
empty terminal for 300–670 ms, silently (no spinner), and the new screen then paints in
partial frames. On a WAN link (the user's normal posture: browser in one region, daemon on
a GCP VM) this is the most visible roughness in the product's core interaction.

**The cause (fix 1).** The tile grid in `app/frontend/src/app.tsx` is mounted as
`<SurfaceLayout key={`${server}:${windowParam}`} …>`. Keying on the window makes every
switch unmount and remount `SurfaceLayout` and, inside it, the tty tile's `TerminalClient`:
a new xterm instance (with a `document.fonts.load` await), a new RelayMux stream, and on
the backend (`api/terminals_ws.go` `attachStream`) a `ResolveWindowSession` subprocess, a
`select-window` subprocess, and a fresh `tmux attach-session` pty whose full-screen redraw
must then cross the WAN before anything paints. Two shipped designs assume the terminal
stays mounted and are dead on this route today:

- the **deferred reset** (`terminal-client.tsx` `pendingReset` / `consumePendingReset`,
  0d52fa37, 2026-06-10): keep the old bytes on screen until the new connection's first
  chunk, then clear + repaint in one presented frame — "no black frame on window switch";
- the **same-session ride** (`windowIdRef` + `stream.setWindowId`, connection identity =
  `(server, owning session)`, c9702b3b, 2026-07-18): a same-session window switch needs no
  reconnect — tmux moves the attached client's active window in place and redraws.

The per-window key arrived on 2026-07-15 with Chat Send (#355), so the ride shipped three
days later onto a route that already remounted, and was carried unchanged into Right Panel
(#552) and Surface Layout (#569). `docs/memory/run-kit/ui/terminal.md` still documents the
ride as the live same-session path.

**The cause (fix 2).** `confirmSwitchArrived()` (in `lib/window-transition.ts`, called from
the SSE URL-writeback effect in `app.tsx` when the snapshot reports the target window
active) settles the gate as `"first-write"` and tears down the mask. SSE confirms as soon
as `select-window` lands — before any byte has reached the terminal — so with an empty
fresh terminal the slide animates into a blank surface and the ≥300 ms blank never shows
the "in transit" spinner the design promises. That logic was written for the mounted case
where the redraw had already painted.

**If left alone.** The blank stays, the mask machinery stays unreachable in practice, and
Change B would be tuning the fresh-attach path for a case that should not be hot at all.

**Why this shape.** Fix 1 changes an invariant several `surface-layout.tsx` sub-systems
lean on ("a window switch remounts this component"), so it gets the whole review budget;
fix 2 is only correct once fix 1 makes the terminal persist, and it is what keeps a slow
switch honest if anything in fix 1 is slow. Fixes 3–5 target the fresh-attach path, which
fix 1 makes cold — measuring them before fix 1 lands would tune a disappearing path.

## What Changes

### A1. Same-server window switches keep the tile grid and the tty tile mounted

**`app/frontend/src/app.tsx` — the grid key.** Change the `SurfaceLayout` mount from
`key={`${server}:${windowParam}`}` to `key={server}`. A same-server switch now re-renders
the existing grid with a new `windowId` prop; a server change still remounts (cross-server
navigation is a different route subtree anyway). The `windowParam ? <SurfaceLayout …> : …`
render gate is unchanged. Update the mount comment: the grid is keyed by server; per-window
state resets by effect.

**`app/frontend/src/components/surface-layout.tsx` — per-window resets by effect.** Every
piece of transient state whose comment says the per-window reset "comes free from the
parent's `${server}:${windowId}` key" gets an explicit reset when `windowId` (or `server`)
changes. One `useEffect` keyed on `[server, windowId]`, guarded so it is a no-op on first
mount (a `prevWindowRef` compare), resets:

| State | Reset to |
|---|---|
| `everOpened` (hide-never-unmount set) | `[...new Set(layout.order)]` for the new window |
| `zoomedIndex` + `zoomedKindRef` | re-derived from `readStoredZoom(server, windowId)` against `layout.order` (the same derivation as the `useState` initializer) |
| `focusedSlot` | `0`; `lastReportedKindRef.current = null` so the slot-A kind re-reports through `onFocusedKindChange` |
| `webPageTitle` | `null` |
| `ttyProgress` + `ttyProgressRef` | `IDLE_PROGRESS`; cancel a pending `ttyProgressRafRef` |
| find state (`findOpen`, `findQuery`, `findResults`, `findRan`) | closed/cleared, and `searchAddon?.clearDecorations()` — the addon instance persists with the terminal, so decorations from the old window's query must be dropped explicitly. Do NOT call `focusRef.current?.()` here (that is the user-close path) |
| `ratios` | already reset by the existing `[server, windowId, layout.shape]` effect — keep |
| web-tab override | already dropped by the existing cleanup effect on `[server, sessionName, windowId]` (it runs on dep change, not only on unmount) — keep; reword its comment |

`focusKey`, `tileMeta`, `aria-label`s and every other prop-derived value need nothing.

**Non-tty tiles keep their per-window remount.** The web, code, and gui tiles carry
state assumptions of their own (code mount generation for the first-boot rescue, the
web tile's per-url iframes, the gui tile's RFB session) and switching windows changes
their content identity (code root, web family, the same host desktop but a new window
context). Add `windowId` to the React key of the non-tty tile wrappers only:
`key={kind === "tty" ? `${kind}${suffix}` : `${kind}${suffix}:${windowId}`}` (or the
equivalent at the `renderContent`/tile-wrapper seam). The tty tile's key stays
window-independent — that is the whole point.

**`app/frontend/src/components/terminal-client.tsx` — the ride, plus a deferred buffer
clear.** No change to connection identity: the stream-open effect's deps stay
`[terminalReady, server, wsRef, connectionEpoch]`; the same-session ride
(`windowIdRef`, `stream.setWindowId`) and the identity watcher (cross-session /
loss-of-identity → `connectionEpoch` bump → fresh stream → deferred `reset()`) already
implement what this change needs. Add one thing: on a same-session `windowId` change while
a stream is live, arm a **deferred buffer clear** consumed at the first inbound chunk after
the switch — `terminal.clear()` (xterm: drop the buffer, keep the cursor row as the new
first line), executed immediately before that chunk is written on both the immediate and
the coalesced path (mirror `consumePendingReset`'s placement in `handleInbound` /
`flushToTerminal`). Rationale: tmux's in-place redraw repaints the screen rows only, so
without the clear the previous window's screen lines would sit in xterm's scrollback and
`Find in terminal` / the ⇩ export would read mixed content. It MUST be `clear()`, not
`reset()`: `reset()` also resets terminal modes (mouse reporting, bracketed paste, focus
events) that tmux believes it already set on this still-attached client and will not
re-send — a fresh attach re-sends them, an in-place switch does not. A stream re-open
(`onOpened` arming `pendingReset`) supersedes a pending clear (drop the flag there). The
clear is armed on the `windowId` effect that already calls `stream.setWindowId`, only when
`streamRef.current` is non-null and the served session is resolved (an unresolved
connection reconnects instead — the watcher's existing rule).

Accepted trade-off (recorded as an assumption): if the OUTGOING window is still streaming
when the switch fires, its next chunk consumes the clear before tmux's redraw arrives — one
frame of the old window's fresh lines at the top of a cleared buffer, then the redraw. No
frame is ever blank, which is the invariant this change buys.

### A2. SSE confirmation lifts the mask only after the incoming window's bytes

**`app/frontend/src/lib/window-transition.ts`.** Track whether a byte has been counted for
the current switch: a module flag `bytesCounted` cleared wherever a new switch mints its
epoch (`beginWindowSwitchGate`, `armGraceMask`) and set at every point a byte is accepted
as the incoming window's — the `acceptingNotify` release in `notifyFirstWrite`, the
`liftAccepting` lift in `notifyFirstWrite`, and the in-flight receipt counted at
`openForNotify()` / `openForLift()` (`inFlightNotifyEpoch === epoch`).

Split the confirmation entry point by caller intent:

- `confirmSwitchArrived()` — the SSE URL-writeback call — becomes **byte-gated**: when
  `bytesCounted` is true it behaves exactly as today (settle a pending gate `"first-write"`,
  tear down the mask); when false it does nothing to the gate or the mask, leaving the
  gate's 300 ms timeout to arm the spinner and the later first write to lift it as the
  designed late-arrival cut. Expose the flag through a pure query
  (`hasCountedIncomingBytes()`) for tests.
- `forceSwitchArrived()` (new) — the unconditional form for the 5 s confirmation-timer
  rescue path in `app.tsx` (`bouncePendingSwitch`'s "SSE already reports the target
  ACTIVE" branch): after the confirmation window has elapsed with the target active, a
  mask with no lift path must never stay up. The `abandonSwitchFeedback()` failure/bounce
  teardown stays unconditional.

**`app/frontend/src/app.tsx`.** The writeback effect keeps calling `confirmSwitchArrived()`
(now byte-gated); the confirmation-timer rescue calls `forceSwitchArrived()`. Update the
two comment blocks that explain SSE confirmation as the authoritative arrival signal: it is
authoritative for *intent* (the URL/heading may stand) but paint feedback stays byte-driven.

### Tests

- `lib/window-transition.test.ts`: SSE confirm before any counted byte → gate still
  pending, its timeout arms the mask; a later counted byte lifts it. SSE confirm after a
  counted byte → gate settles `"first-write"`, no mask. `forceSwitchArrived()` tears down
  regardless. Byte counting via each of the three accept paths.
- `components/terminal-client.test.tsx` (the "connection identity" block): a `windowId`
  prop change on a resolved same-session connection opens no new stream and calls
  `setWindowId`; the deferred clear runs once, immediately before the first chunk after the
  change, on both the immediate and the coalesced write path; a stream re-open supersedes
  it; `reset()` is not called on a ride.
- `components/surface-layout.test.tsx`: a `windowId` prop change resets zoom (from the new
  window's stored key), focused slot (re-reported), hidden-tile set, find state, web page
  title, and tty progress; the tty tile's DOM node survives the change; a non-tty tile's
  does not.
- `app.test.tsx` (or the closest existing app-level test): the `SurfaceLayout` key is
  server-only — a window param change does not remount it.
- e2e `tests/e2e/window-switch-transition.spec.ts` (and/or a new same-session switch spec
  on the tmux rig): across a sidebar same-session switch the `.xterm` element handle is
  the same DOM node before and after, the new window's content paints within ~1 s, and
  the terminal surface is never empty (poll the xterm buffer or the surface's text at
  short intervals during the switch; with `reducedMotion: reduce` the instant path runs).
  Existing surface-layout and lens e2e suites must pass unchanged — per-window zoom,
  ratio, and hidden-tile state still reset on a switch.

### Out of scope (Change B)

Relay frame coalescing, the held one-frame reveal on a fresh stream, resolving the window's
session from the control-mode snapshot, dropping the duplicate `select-window`, and the
double-redraw diagnosis. Also out of scope: boards (`board-pane.tsx`) and the operator
console, whose `TerminalClient` mounts are not on the window-switch path.

## Affected Memory

- `run-kit/ui/terminal`: (modify) § Terminal Relay / § Write Batching (Adaptive Flush + Deferred Reset) / § Window-Switch Slide Transition / § Confirmation-gated motion — the ride and the deferred reset are the live same-session path again; add the deferred buffer clear (`clear()` not `reset()`, why); SSE confirmation is byte-gated (`confirmSwitchArrived` vs `forceSwitchArrived`); Design Decisions entry for why the grid key is server-only and what the 2026-07-15 → 2026-09-10 remount cost
- `run-kit/ui/lenses-and-layout`: (modify) § Tile renderer — `SurfaceLayout` is keyed by server; per-window state (zoom, focused slot, hidden-tile set, find, page title, progress, ratios) resets by a `windowId` effect; non-tty tiles carry `windowId` in their key; the "remounts per window" sentences and the "comes free from the key" rationale are rewritten
- `run-kit/ui/routes-and-shell`: (modify) only if it restates the per-window remount (check § terminal route / app shell mount notes); otherwise untouched

## Impact

- **Frontend**: `app/frontend/src/app.tsx` (grid key, two confirmation call sites,
  comments), `components/surface-layout.tsx` (per-window reset effect, non-tty tile keys,
  comment rewrites), `components/terminal-client.tsx` (deferred buffer clear on ride),
  `lib/window-transition.ts` (+ test), plus the unit tests named above and one e2e spec.
- **Backend**: none.
- **Behavioral**: same-session switches no longer reconnect (one `open` op per session per
  tab instead of per switch — also fewer `attach` clients churned on the tmux server);
  cross-session switches and deep links still reconnect through `connectionEpoch` with the
  existing deferred reset. The spinner mask becomes reachable on slow switches.
- **Risk**: the ride path (`setWindowId` + in-place redraw) has unit coverage but has never
  run on the terminal route in production — it was keyed away three days before it shipped.
  The e2e same-session switch spec is the guard.
- **Verification recipe** (plan doc § Verification recipe): re-record the same tab sweep
  and run the luminance timeline; a same-session switch is fixed when it produces no
  `BLANK` row.

## Open Questions

None — the user chose the split and the fixes in conversation; the remaining choices are
graded below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope is fixes 1 + 2 only; fixes 3–5 wait for a re-measurement (Change B) | Discussed — user asked whether to bundle, accepted the split, and asked for Change A now | S:95 R:90 A:95 D:95 |
| 2 | Certain | The blank is caused by the per-window `SurfaceLayout` key remounting `TerminalClient`; the deferred reset and the ride are dead on this route | Verified in code and git history (0d52fa37 unkeyed, key from #355 on 2026-07-15, ride c9702b3b 2026-07-18) and in the recording's luminance timeline | S:95 R:85 A:95 D:95 |
| 3 | Confident | Key the grid by `server` and reset per-window state by effect, rather than hoisting `TerminalClient` above the key | Fewer moving parts; the ratios reset already follows this pattern; the hoist is the recorded fallback if the grid's per-window state proves too entangled | S:80 R:70 A:80 D:70 |
| 4 | Confident | Non-tty tiles (web, code, gui) keep a per-window remount by carrying `windowId` in their React key | Their content identity changes with the window and each has mount-once bookkeeping (code first-boot rescue, per-url iframes, RFB session); limiting the persistence change to the tty tile keeps the review surface small | S:75 R:80 A:80 D:75 |
| 5 | Confident | On a same-session ride, arm a deferred `terminal.clear()` consumed at the first inbound chunk; never `reset()` | `clear()` drops the old window's rows from scrollback (find/export correctness) without touching terminal modes tmux will not re-send to a still-attached client; deferring to the first chunk keeps the no-blank-frame invariant | S:75 R:80 A:80 D:70 |
| 6 | Confident | Accept one possible frame of the outgoing window's fresh lines when it is streaming at switch time | The alternative (filtering the clear by the POST's resolution) risks a late clear wiping already-painted incoming content; a busy outgoing window is the uncommon case and no frame is blank either way | S:70 R:80 A:75 D:65 |
| 7 | Confident | SSE confirmation is byte-gated in the writeback effect; the 5 s confirmation-timer rescue uses an unconditional `forceSwitchArrived()`; `abandonSwitchFeedback()` stays unconditional | A stuck input-blocking mask is the worst outcome the design forbids, so the long-timeout rescue must always clear; the writeback path is the one that fires before bytes | S:80 R:85 A:85 D:75 |
| 8 | Certain | Keep the existing e2e reduced-motion posture; add the same-DOM-node + never-empty assertion to the window-switch e2e on the tmux rig | Matches the project's Playwright conventions (`just pw`, `_tmux.ts` helpers) and the constitution's Test Intent Comments rule | S:85 R:90 A:90 D:90 |

8 assumptions (3 certain, 5 confident, 0 tentative, 0 unresolved).
