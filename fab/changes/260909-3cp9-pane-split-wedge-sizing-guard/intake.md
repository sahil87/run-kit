# Intake: Pane-split tmux wedge — multi-viewer sizing guard (`window-size smallest`)

**Change**: 260909-3cp9-pane-split-wedge-sizing-guard
**Created**: 2026-09-09

## Origin

> User: "Pane-open UI unresponsiveness regression: opening a new tmux pane next to a running
> agent pane makes the UI unresponsive for roughly 30 seconds. This was reportedly fixed recently
> but the fix did not actually resolve it -- reproduce by opening a tmux pane adjacent to a running
> Claude session and observing the freeze. Investigate what prior fix targeted this (check recent
> change history / memory for pane-open perf or unresponsiveness work) and why it did not hold;
> find the actual root cause and fix it, adding a regression test if the codebase has a way to
> cover this."

One-shot `/fab-new`, but the root cause was reproduced and isolated live in this session before
the change was opened. Findings (all on scratch tmux servers under `/tmp/tmux-<uid>/`, daemon
control-mode client attached, managed conf loaded; probe = concurrent `tmux display -p ok`):

- **The prior fix** is `260908-s9fw-cache-pane-border-git-info` (PR #879, merged, shipped in
  run-kit 3.19.31+; the running daemon is 3.19.34 and every live managed server already carries
  the fork-free `pane-border-format`). It replaced the `#()` git shell jobs in the pane border with
  daemon-stamped `@rk_pane_git_*` options. Its root-cause claim ("the resize renegotiation re-fires
  those jobs in a burst that wedges the server") is **wrong**: the jobs were bystanders that showed
  up in the strace because they run during the same redraws. With zero `#()` in the format the
  wedge reproduces identically (~21 s stalls, repeating, 40–64 s total).
- **The wedge is a CPU spin inside the tmux server**, not a fork storm and not a run-kit daemon
  or frontend stall: `/proc/<tmux-pid>/stat` shows state `R` at 100 % of one core for the whole
  stall; a `tmux -vv` server log of one stall is 5–12 GB of a single `tty_draw_line` call walking
  cells `0 … 124,610,958+` ("cell N empty 1, bg 8").
- **Exact defect** (tmux 3.7c `screen-redraw.c`, `screen_redraw_draw_pane_status`, lines 707–717):
  the "Left not visible" / "Right not visible" branches compute the draw width as
  `width = size - l` / `width = size - x` in `u_int`, where `size` is the pane-status text width
  and `l`/`x` its horizontal offset relative to the client's viewport. When the status text is
  shorter than that offset the subtraction underflows to ~4 billion and `tty_draw_line` walks it
  (~21 s of CPU per draw at ~200 M cells/s). The branch is reached whenever a client's viewport is
  **narrower than the window** (or horizontally offset) and a pane's status line **straddles the
  viewport edge**. Upstream master has since rewritten the redraw path
  (`redraw_draw_status_span` clamps `n = sx - px`), so the defect is fixed in master but present in
  every released tmux up to and including 3.7c (the toolkit's installed version).
- **Trigger in run-kit terms**: two size-participating clients of different widths viewing the
  same window (an agent's ssh/native terminal plus a browser relay tile, or a desktop tile plus a
  phone tile). Under today's `window-size latest`, the window follows whichever client acted last,
  so the narrower client is clipped whenever the wider one is "latest". A split then puts a right
  pane whose status text starts inside the narrow viewport and runs off its edge → underflow.
  Confirmed matrix:

  | Pane content | Two clients (200×50, 120×40) | Border status | Split | Wedge |
  |---|---|---|---|---|
  | claude | no activity (narrow client latest) | on | yes | no |
  | claude | alternating focus events (window flaps 200↔120) | on | yes | **yes, 3× ~21 s** |
  | claude | alternating | on | no | no |
  | claude | alternating | **off** | yes | no (the original A/B) |
  | vim | alternating | on (trivial `#P` format) | yes | **yes** (format content irrelevant) |
  | claude | none, `window-size largest` | on | yes | **yes** (no flapping needed — any clipped viewer) |
  | `sleep` | 200-col client made latest, 105-col client clipped | on | yes | **yes, >40 s** (deterministic, no TUI needed) |
  | `sleep` | same, `window-size smallest` + `aggressive-resize on` | on | yes | **no** (0.00 s) |

- **Why the s9fw fix "held" in its own A/B**: `pane-border-status off` removes the status draw
  entirely, so both the jobs and the underflow vanish together; the A/B could not distinguish them.
- **Practical reach is wider than "split"**: with `latest`, a narrower viewer that merely *opens*
  a window a wider client is viewing is clipped (verified: B switching to window 1 leaves it at
  200 cols), so opening any existing multi-pane window on a phone/narrow tile can wedge too.

## Why

**Problem.** Any run-kit user who watches an agent window from two differently sized clients and
splits it (or opens a multi-pane window on the narrower client) freezes the entire tmux server —
every client, the daemon's control-mode subscription, the SSE feed and the web dashboard — for
~21 s per redraw, repeating while the geometry persists (40–64 s observed). It presents as run-kit
being dead. This is a Constitution VI-class availability failure on the substrate every feature
shares, and it survived a shipped fix that documented the wrong cause.

**Consequence if unfixed.** The wedge recurs on ordinary actions (split, open on phone), the
memory currently records a false root cause (so the next investigator will start from the wrong
place again), and users cannot trust the dashboard during multi-viewer work — the primary
run-kit use case.

**Why this approach.** run-kit cannot patch the user's tmux and no released tmux carries the
upstream fix. The defect is unreachable by construction when **no size-participating client is
ever narrower than the window it views**: that is exactly the `window-size smallest` contract. Paired
with `aggressive-resize on` the constraint is scoped to clients whose *current* window is the one
being sized (verified: a 105-col client viewing window 2 in a grouped pin-style session leaves
window 1 at 200 cols; switching it to window 1 shrinks window 1 to 105 and switching back restores
200; without `aggressive-resize on` the same client shrinks every window in the group — which is
why the pairing is mandatory). Alternatives rejected: turning `pane-border-status` off (loses the
per-pane identity the multi-pane and Board views rely on, and orphans the s9fw stamping
infrastructure); daemon- or hook-driven per-window toggling of the border (the first redraw after a
geometry change already wedges before any reactor runs — tmux hooks have no client-loop format to
compute "is any viewer narrower", and `run-shell` is asynchronous); padding or shortening the
status text (the underflow depends on the pane's x-offset, which the format cannot control);
`window-size largest`/`manual` (largest guarantees clipping for every narrower viewer; manual
freezes everyone). The `docs/memory/run-kit/ui/terminal.md` hidden-page decision rejected sizing
policy as a cure for *forgotten background clients*; that reasoning stands (hidden-page stream
release stays, and matters more under `smallest`), but it did not weigh a server-wedging defect.

## What Changes

### 1. Managed tmux conf adopts the multi-viewer sizing guard

`configs/tmux/default.conf` gains a new section (embedded into the binary at build, re-hashed into
`~/.config/run-kit/tmux.conf`, reloaded on live managed servers by the daemon-start RefreshSweep /
pre-attach reload, and applied at birth to rk-created servers):

```tmux
# --- Multi-viewer sizing ---
# A window is never wider than the narrowest client currently viewing it. This is a
# correctness guard, not a preference: every released tmux through 3.7c underflows the
# pane-border-status draw width (screen-redraw.c, screen_redraw_draw_pane_status) when a
# viewer is narrower than the window and a pane status line straddles its edge, spinning
# the whole server ~21s per redraw. `smallest` makes that geometry unreachable;
# aggressive-resize scopes the constraint to clients whose CURRENT window is the one
# being sized (grouped _rk-pin-* viewers of other windows do not shrink this one).
set -g window-size smallest
setw -g aggressive-resize on
```

Observable behavior change (documented in memory): with two viewers on one window the window is
sized to the narrower viewer for as long as both view it (the wider one sees the `·`-filled
margin), instead of flapping to whichever viewer acted last and clipping the other. Windows a
viewer is not currently showing are unaffected. Single-viewer behavior is unchanged.

### 2. Regression coverage

- **Conf assertion** (fast unit test beside `TestDefaultConfigPaneBorderNoShellJobs` in
  `app/backend/internal/tmux/managedconf_test.go`): the embedded conf contains
  `set -g window-size smallest` and `setw -g aggressive-resize on`.
- **Wedge integration test** (new, `app/backend/internal/tmux/pane_status_wedge_test.go`, real
  tmux, skipped when `tmux` or a pty is unavailable): start a scratch server via
  `testSocketName("wedge")` with the embedded conf written to a temp file
  (`new-session -d -s s -x 200 -y 50 sleep 1000`); attach two `tmux attach -t s` clients through
  `creack/pty` (`pty.StartWithSize`, 200×50 then 105×40, each drained by a goroutine); write the
  focus-in sequence `\x1b[I` to the wide client so it is the most recent client; run
  `split-window -h -t s:1 sleep 1000` and then `display -p ok`, each under a 5 s context; assert
  both return in < 2 s and that `show -gv window-size` is `smallest` and `show -gwv
  aggressive-resize` is `on` on the live server. On the pre-change conf this geometry wedges the
  server for >40 s (verified), so the test fails closed on regression; it stays valid on a future
  tmux that carries the upstream fix. Cleanup kills the clients and the server (`t.Cleanup`),
  matching the package's socket hygiene.

### 3. Documentation and comment corrections

- `docs/memory/run-kit/configuration.md`: correct the s9fw design decision's causal claim (the
  `#()` removal is retained as draw-time hygiene, but it was not the wedge) and add the new
  decision (root cause, geometric guard, why `aggressive-resize` is paired, rejected paths).
- `docs/memory/run-kit/ui/terminal.md`: annotate the hidden-page decision — sizing policy is now
  `smallest`, for a different reason; hidden-page release remains required (a hidden narrow client
  would otherwise pin a window small).
- `docs/memory/run-kit/tmux-sessions.md` § Attached-Client Enumeration: the arbitration sentence
  ("across ALL sized clients of a session") becomes "the narrowest sized client whose current
  window is the one being sized".
- `app/frontend/src/lib/relay-mux.ts` (~line 99) and `relay-mux.test.ts` (~line 473): the
  comments cite `window-size latest`; update the wording (no behavior change).
- `fab/changes/260909-3cp9-pane-split-wedge-sizing-guard/upstream-tmux-report.md`: a
  ready-to-file upstream report (reproduction with two clients + geometry, the 3.7c source lines,
  the master clamp that already fixes it) so the user can request a backport into the next tmux
  release. The pipeline does not file it.

### 4. Explicitly not changed

- No daemon, API, SSE, relay, or frontend logic. The daemon's `@rk_pane_git_*` stamping and the
  fork-free border stay as shipped.
- No tmux version floor change and no `rk doctor` row: the policy is applied unconditionally as
  a design choice, so no version gate is needed; once a fixed tmux ships the guard is still
  harmless and still the documented sizing contract.

## Affected Memory

- `run-kit/configuration.md`: (modify) — correct the s9fw design decision's root-cause claim; add
  the multi-viewer sizing guard decision (defect, geometry, `smallest` + `aggressive-resize on`,
  rejected alternatives, upstream status).
- `run-kit/ui/terminal.md`: (modify) — annotate the hidden-page stream-release decision's
  "Rejected: window-size smallest" with the new policy and why the release still stands.
- `run-kit/tmux-sessions.md`: (modify) — update the viewer-derivation sentence about window-size
  arbitration to the new per-current-window smallest rule.

## Impact

- **Code**: `configs/tmux/default.conf` (+2 option lines, +comment); `app/backend/build/tmux.conf`
  is regenerated by `just _ensure-tmux-conf` / `scripts/dev.sh` (not committed).
- **Tests**: `app/backend/internal/tmux/managedconf_test.go` (+1 conf assertion);
  `app/backend/internal/tmux/pane_status_wedge_test.go` (new integration test; uses the existing
  `creack/pty` dependency and `testSocketName`).
- **Frontend**: comment-only edits in `relay-mux.ts` / `relay-mux.test.ts`.
- **Docs**: three memory files; one change-folder artifact (`upstream-tmux-report.md`).
- **Runtime rollout**: the managed conf hash changes; live managed servers pick the options up on
  the next daemon start (RefreshSweep) or pre-attach reload; user overrides in
  `~/.config/run-kit/tmux.d/` still win (sourced last).
- **Risk**: multi-viewer sizing semantics change for all users (see § Open Questions). Reverting
  is a two-line conf change.

## Open Questions

- Is the `smallest` trade-off acceptable for phone co-viewing (a phone tile viewing a window pins
  it to phone width for a desktop co-viewer of that same window, until the phone navigates away),
  versus today's flap-and-clip behavior which is what reaches the wedge?
- Once a tmux release carries the upstream redraw fix, should the managed conf keep `smallest`
  as the sizing contract or revert to `latest` behind a version check? (Recommendation: keep.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Root cause is the tmux ≤3.7c `screen_redraw_draw_pane_status` unsigned width underflow, reached only when a viewer is narrower than the window and a pane status straddles its edge; the s9fw `#()` jobs were bystanders | Reproduced deterministically with a plain `sleep` pane and fixed geometry; `-vv` log shows one `tty_draw_line` walking >124 M cells; source lines identified; `pane-border-status off` and `window-size smallest` both eliminate it | S:95 R:90 A:95 D:95 |
| 2 | Confident | Mitigate in the managed conf with `window-size smallest` + `aggressive-resize on` rather than disabling the border or waiting for upstream | Only complete guard available to run-kit (geometry becomes unreachable); scoping verified with grouped sessions; the UX trade-off is a product judgment surfaced in Open Questions and reversible in two lines | S:55 R:85 A:60 D:55 |
| 3 | Certain | Keep the s9fw fork-free border and daemon stamping; correct only the recorded root cause | Draw-time forks remain undesirable hygiene; the stamping is working and the border now depends on it | S:70 R:90 A:90 D:85 |
| 4 | Certain | Regression test = real-tmux integration test in `internal/tmux` with two pty clients under fixed geometry (200-wide latest, 105-wide clipped, split), asserting <2 s probes and the live policy options | Geometry reproduces without any TUI; the package already spawns real tmux servers and `creack/pty` is a dependency; fails closed on the pre-change conf | S:80 R:85 A:85 D:80 |
| 5 | Confident | Apply the policy unconditionally (no tmux version gate, no doctor row) | Every released tmux is affected; a gate adds conf complexity for no current benefit; the policy is defensible as the sizing contract even on a fixed tmux | S:50 R:85 A:65 D:50 |
| 6 | Certain | No daemon/relay/frontend logic changes; the hidden-page stream-release decision stands | The fix is purely in tmux geometry; hidden-page release is complementary (prevents a hidden narrow client pinning a window under `smallest`) | S:70 R:85 A:85 D:80 |
| 7 | Confident | Draft an upstream tmux report as a change-folder artifact; do not file it from the pipeline | Filing is an outward-facing action for the user; the draft captures the reproduction while it is fresh | S:40 R:95 A:80 D:60 |

7 assumptions (4 certain, 3 confident, 0 tentative, 0 unresolved).
