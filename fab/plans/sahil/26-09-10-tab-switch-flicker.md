# Tab-switch flicker — persistent terminal, honest mask, one-frame attach

> Plan doc — written 2026-09-10 from the balmy-beaver `/fab-discuss` thread,
> after frame-by-frame review of a tab-sweep screen recording on the desktop
> shell against `dev-ws-sahil01`. Two changes, run in order, with a
> re-measurement between them. Authority for the mechanics being repaired:
> `docs/memory/run-kit/ui/terminal.md` § Terminal Write Batching (Adaptive
> Flush + Deferred Reset), § Window-Switch Slide Transition, and § Confirmation-
> gated motion.

**Goal**: a same-session tab switch never shows an empty terminal. The old
screen stays until the new one is ready, the slide animates real content, and
whenever the switch is slow the spinner mask shows instead of a silent blank.
Fresh attaches (cross-session, deep link, reconnect) reveal in one frame.

**Problem (2026-09-10)**: every switch blanks the terminal for 300–670 ms with
no spinner, then paints the new screen top-down over ~150 ms; one switch in
seven paints, blanks again for ~250 ms, and repaints. Measured from the
recording (terminal-region luminance at 30 fps):

| Switch at | Blank span |
|---|---|
| 1.17 s | 667 ms |
| 2.80 s | 600 ms |
| 4.30 s | 333 ms |
| 6.27 s | 400 ms |
| 8.30 s | 167 ms · content · blank 267 ms |
| 10.17 s | 433 ms |

**Status (2026-09-10)**: Change A in progress. Change B waits on the
re-measurement after A ships.

---

## Diagnosis

Ordered by cause. Items 1 and 2 are Change A; 3–5 are Change B.

1. **The terminal remounts on every window switch.** The tile grid in
   `app/frontend/src/app.tsx` (the `<SurfaceLayout key={`${server}:${windowParam}`}>`
   mount) is keyed by server *and* window, so a switch unmounts
   `TerminalClient`: a new xterm (font-load await), a new mux stream, and on
   the backend (`api/terminals_ws.go` `attachStream`) a session resolve, a
   `select-window`, and a fresh `tmux attach-session` pty whose full redraw
   then crosses the WAN. Two shipped designs assume the terminal stays
   mounted and are dead on this route: the deferred reset (0d52fa37,
   2026-06-10 — keep the old bytes until the new redraw, clear + repaint in
   one frame) and the same-session ride (`stream.setWindowId`, c9702b3b,
   2026-07-18). The key arrived on 2026-07-15 with Chat Send (#355) and was
   carried into Right Panel (#552) and Surface Layout (#569). The terminal
   memory still documents the ride as live behaviour.
2. **No spinner during the blank.** SSE reports the target active as soon as
   `select-window` lands; `confirmSwitchArrived()` (app.tsx, the writeback
   effect + the confirmation-timer rescue) then settles the gate
   `"first-write"` and tears down the mask before any byte has reached the
   new terminal. The slide plays into an empty surface and the ≥300 ms blank
   has no "in transit" signal. Written for the mounted case, where the redraw
   had already painted.
3. **Top-down progressive paint.** `pumpPTY` forwards each 4 KB pty read
   (`streamFrameSize`) as its own WebSocket frame; the client flushes per
   animation frame; xterm parses in time slices. On a WAN link a redraw lands
   over 100–150 ms as partial screens.
4. **Double repaint on some switches.** A post-attach resize (the `onOpened`
   fit + resize, or the ResizeObserver after the tile layout settles) with a
   size that differs from the open op makes tmux clear and redraw. Suspect to
   verify: each stream is its own tmux client on the same session, so two
   viewers at different sizes can resize the window for everyone.
5. **`select-window` runs twice per switch** — the frontend POST and the
   backend attach.

## Change A — persistent terminal + byte-gated confirmation (fixes 1, 2)

One fab change. Fix 2 is only correct once fix 1 makes the terminal persist,
and fix 1 changes an invariant several components lean on, so it gets the
whole review budget.

### A1. Same-server switches keep the tty tile mounted

- Move the window half of the key off the tile grid. Preferred shape: key the
  grid by `server` only and reset per-window bookkeeping with effects on
  `windowId` — the ratios already do (`setRatios(initialRatios(...))` on
  `[server, windowId, layout.shape]`). Alternative if the grid's per-window
  state proves too entangled: hoist the primary tty `TerminalClient` above the
  keyed boundary and pass it down.
- Audit every "a window switch remounts this component" assumption in
  `surface-layout.tsx` and convert each to a `windowId`-keyed reset: the
  hide-never-unmount set, zoom (`readStoredZoom`/`writeStoredZoom`), the
  focused slot + focus memory key, the web-override clear (currently an
  unmount cleanup), the code tile's mount generation, the search addon's query
  state, the per-window compose/scroll-lock state.
- `TerminalClient` already handles the ride: `windowIdRef` + `setWindowId`
  keep the stream's re-open target fresh, and connection identity is
  `(server, owning session)` — a cross-session switch still bumps
  `connectionEpoch` and reconnects through the deferred reset. Verify the
  session watcher fires on a cross-session switch when the component is no
  longer remounted.
- The `aria-label` / test registry keyed on `windowId` re-key in place
  (already effect-driven).

### A2. SSE confirmation lifts the mask only after bytes

- In `lib/window-transition.ts`, track "bytes received since this switch
  began" (set by `notifyFirstWrite` once `openForNotify`/`openForLift` has
  opened, cleared per switch epoch).
- `confirmSwitchArrived()` settles the gate `"first-write"` and tears down
  the mask **only when that flag is set**. Otherwise it leaves the gate to its
  300 ms timeout (mask arms) and the later first write lifts the mask as the
  designed late-arrival cut.
- Keep `abandonSwitchFeedback()` unconditional (failure paths must always
  clear).

### Acceptance

- Same-session switch: the xterm instance and the mux stream id survive the
  switch (unit: TerminalClient connection-identity block; e2e: assert one
  `open` op across a sidebar switch via the state-socket mock / tmux rig).
- No frame of the terminal surface is empty on a same-session switch with a
  responsive tmux (e2e: capture the surface immediately after the click and
  at +100 ms; both non-blank).
- With a stalled first write, the spinner mask is visible at +350 ms even
  though SSE has confirmed (unit on the transition module: SSE confirm before
  bytes ⇒ mask still arms on timeout; SSE confirm after bytes ⇒ mask lifts).
- Cross-session switch still reconnects and repaints without a black frame
  (existing deferred-reset tests).
- Existing `window-switch-transition.spec.ts` and the surface-layout suites
  pass unchanged; per-window zoom/ratio/hidden-tile state still resets on a
  switch (e2e in the layout suites).

### Hydrate

- `docs/memory/run-kit/ui/terminal.md`: the ride and deferred reset are the
  live same-session path again; record the 2026-07-15 → 2026-09-10 gap as a
  design decision (why the grid key is server-only).
- `docs/memory/run-kit/ui/lenses-and-layout.md`: the grid is keyed by server;
  per-window state resets by effect, not by remount.

## Re-measure before Change B

Record the same tab sweep on the desktop shell against a WAN-distant daemon
and run the luminance timeline (recipe below). Expect same-session switches
to show no blank span. What remains is the fresh-attach path only.

## Change B — one-frame fresh attach (fixes 3, 5; 4 after diagnosis)

Only if the re-measurement still shows blank or progressive frames on
cross-session switches, deep links, or reconnects.

- **B1. Relay frame coalescing** (`api/terminals_ws.go`): merge a stream's
  queued data frames before a write, and/or read the pty with a larger buffer,
  so a redraw arrives in a few messages instead of dozens. Keep the fair
  scheduler's short-frame-first rule intact (an echo must never queue behind
  bulk).
- **B2. One-frame reveal on a fresh stream** (`terminal-client.tsx`): while
  `pendingReset` is armed, hold the paint until a ~40 ms quiet gap or a
  150 ms cap, then reset + write once; or keep the surface covered until
  xterm's write callback for the initial redraw fires. Not applied to the ride
  path (tmux repaints in place there).
- **B3. Attach latency**: resolve window → session from the control-mode
  snapshot instead of a subprocess; drop one of the two `select-window`s.
- **B4. Double redraw** — diagnose first: log the open-op size vs the
  `onOpened` fit size; check `window-size` / per-client sizing with two
  viewers attached. Fix is either "open at the final size, skip the no-op
  resize" or a tmux option, not both.

## Verification recipe

```bash
# frames → per-frame luminance of the terminal region → blank spans
ffmpeg -i rec.mov -vf "fps=30,crop=3000:1650:700:300,scale=40:22" \
  -f rawvideo -pix_fmt gray - > lum.raw
python3 - lum.raw <<'EOF'
import sys; d=open(sys.argv[1],'rb').read(); n=40*22
f=[sum(d[i:i+n])/n for i in range(0,len(d)-n+1,n)]; thr=min(f)+3
s=None; a=0
for i,v in enumerate(f+[None]):
    k=None if v is None else ('BLANK' if v<thr else 'content')
    if k!=s:
        if s: print(f"{s:8s} {a/30:6.2f}s → {i/30:6.2f}s ({(i-a)/30*1000:4.0f} ms)")
        s,a=k,i
EOF
```

Crop numbers are for a 3736×2132 recording of the desktop shell with the
sidebar open; adjust to the terminal region of the recording in hand. A
switch counts as flicker-free when it produces no `BLANK` row.
