# Intake: Export Honesty + Scrollback

**Change**: 260820-4le0-export-honesty-scrollback
**Created**: 2026-08-20

## Origin

Conversational — direct follow-up to the shipped `260819-shqo-terminal-tile-export` (PR #678, merged). The user field-tested the export menu and reported:

> download pane history isn't working. I tried download pane history (ie full history from server) vs download transcript (ie download history from client). The one from client was larger. server history didn't contain full transcript.

Live diagnosis (2026-08-20, this box) established the root cause: **agent TUI panes run on tmux's alternate screen** (`alternate_on 1`, `history_size 0`). The alt screen has no scrollback, so `capture-pane -S -` extends into an EMPTY normal-screen history and returns only ~pane-height lines (48 observed; `-a` is identical — alt has no history to access). When the TUI exits the alt screen is discarded, so the transcript never exists server-side at any point. The endpoint is mechanically sound — verified on a normal-screen pane: history 43 + height 48 → exactly 91 lines captured. The shqo intake's load-bearing premise ("tmux owns scrollback, only the server can produce the complete transcript") is **inverted** for agent panes: the client xterm buffer is the only terminal transcript that exists, and it is currently capped at xterm's DEFAULT `scrollback: 1000` (no explicit option is set in `terminal-client.tsx`).

User decisions (explicit): fix = **(1) raise the client scrollback + (2) make the server-capture menu row honest for alt-screen panes**, together in one change. A third option (pointing "full history" for agent windows at the chat JSONL transcript) was explicitly declined — out of scope. Sizing was checked against real sessions: the largest recent agent session (~42.8k JSONL events, ~3.1M content chars) renders to roughly **19k–31k terminal lines** (at 160/100 cols); typical heavy sessions land under ~15k.

## Why

1. **Pain point**: the export menu's "Full history — server capture" row silently delivers a near-empty artifact (stale pre-TUI normal screen + viewport) for exactly the panes users export — agent runs. Meanwhile the honest artifact, the client transcript, is capped at 1000 lines, often less than one heavy agent session.
2. **Consequence if unfixed**: the menu lies. Users download "full history" and get 48 lines; the transcript row silently truncates a 20k-line session to its last 1000 lines. The feature's core promise (hand me the run) fails on its primary use case.
3. **Why this approach**: the server cannot produce data tmux never stored — no backend change can recover an alt-screen transcript. So (1) grow the client buffer to hold a realistic full session (bounded by browser memory, device-split like the terminal font size), and (2) surface the alt-screen state so the menu tells the truth instead of failing silently. Both are additive and small.

## What Changes

### 1. Client scrollback raised (device-split, board panes exempt)

`terminal-client.tsx` gains an explicit `scrollback` on the xterm `Terminal` constructor via a new optional prop `scrollback?: number`; the **default** when the prop is absent is device-split by the existing `isMobileViewport()` rule (the terminal-font-size precedent): **25,000 lines on desktop, 10,000 on mobile**. Constants exported (e.g. `SCROLLBACK_DESKTOP = 25_000`, `SCROLLBACK_MOBILE = 10_000`) so tests and memory can reference them.

- Sizing rationale (measured): heavy agent sessions render ~19k–31k lines; 25k covers all but the most extreme desktop sessions. Memory bound: xterm allocates buffer lines lazily, worst case ≈ 1–2.5KB/line at wide cols → ~25–60MB per FILLED desktop terminal, acceptable for the single terminal-route tile; 10k on mobile bounds iOS memory.
- **Board pane cards pass `scrollback={1000}` explicitly** (`board/board-pane.tsx`) — boards mount MANY live TerminalClients and are preview surfaces (the full view is one click away); the xterm default they effectively had is kept, now explicit.
- Duplicate tty tiles on the terminal route share the default — they are full views of one window.

### 2. Alt-screen state surfaced end-to-end; the server row goes honest

- **Backend**: the pane enumeration format list (`internal/tmux/tmux.go` ~line 949, the `#{pane_id}`/`#{pane_active}`… list consumed by `FetchSessions`) gains `#{alternate_on}`; `PaneInfo` gains the parsed bool; `WindowInfo` (and its JSON/SSE payload in `internal/sessions`) gains **`altScreen`** — the ACTIVE pane's `alternate_on` (the same active-pane rule the history capture targets). Derive-at-request-time, no state (Constitution II).
- **Frontend menu**: when the current window's `altScreen` is true, the export menu's "Download pane history" row renders **disabled** (`disabled` + `aria-disabled`, dimmed per the existing disabled-row vocabulary) with the hint line `agent TUI on alternate screen — tmux holds no scrollback` in place of its `.txt · capture-pane -S -` subtitle. The section header stays (the split's honesty is the point). No click, no fetch.
- **Palette**: the `Terminal: Download full history` action is **absent** while `altScreen` is true (palette actions are gated, not disabled — the existing availability idiom).
- The three client-buffer rows are unaffected. When `altScreen` is false the row behaves exactly as shipped.
- The `WindowInfo` prop already flows to `SurfaceLayout` (`statusWindow`/`win`); the row reads the new field from there — no new prop plumbing beyond the field itself.

### Non-goals

- No chat-JSONL "full transcript" arm (user explicitly declined — option 3).
- No backend change to the history endpoint itself (it is correct for normal-screen panes; a client that never calls it for alt-screen panes needs no new error shape).
- No tmux.conf changes (`history-limit` is already 100000 in the embed; irrelevant to alt-screen panes). The separate "does rk update refresh ~/.rk/tmux.conf" gap is a distinct follow-up change, not this one.
- No user-facing scrollback preference/setting — constants only until someone asks.

## Affected Memory

- `run-kit/ui/terminal`: (modify) § Terminal Export — the alt-screen constraint and the honest-row gate; the new `scrollback` device-split constants beside the font-size convention
- `run-kit/ui/lenses-and-layout`: (modify) Tile chrome — the export menu's disabled history row state
- `run-kit/ui/keyboard-and-palette`: (modify) the `Terminal: Download full history` action's altScreen gate
- `run-kit/architecture`: (modify) SSE/WindowInfo payload gains `altScreen`

## Impact

- **Backend**: `internal/tmux/tmux.go` (pane format list + PaneInfo parse), `internal/sessions/sessions.go` (WindowInfo field + active-pane derivation), their tests.
- **Frontend**: `components/terminal-client.tsx` (scrollback option + prop + constants), `components/board/board-pane.tsx` (explicit 1000), `components/surface-layout.tsx` (disabled history row + hint), `app.tsx` (palette gate), `src/api/client.ts` types if WindowInfo is mirrored there.
- **Tests**: Go pane-parse/WindowInfo tests; Vitest for the scrollback default split + prop override, the disabled row, the palette gate; the existing `terminal-export` e2e stays green (its rig pane is normal-screen).

## Open Questions

- None.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Root cause is alt-screen panes (`alternate_on 1`, `history_size 0`) — no server-side fix can recover the transcript | Measured live on this box; endpoint verified correct on normal-screen panes (43+48→91 lines) | S:95 R:90 A:95 D:95 |
| 2 | Certain | Fix scope is exactly options 1+2; chat-JSONL arm excluded | User stated "1. yes 2 yes 3 no" verbatim | S:95 R:85 A:95 D:95 |
| 3 | Confident | Scrollback 25,000 desktop / 10,000 mobile via `isMobileViewport()`, constants exported | Measured sessions render 19k–31k lines; 25k covers heavy desktop runs at ~25–60MB filled worst case; mobile split mirrors the font-size precedent; trivially retuned | S:70 R:90 A:80 D:70 |
| 4 | Confident | Board panes pinned to `scrollback={1000}` via explicit prop | Boards mount many live terminals (preview surfaces); N×25k buffers is the one real memory hazard | S:55 R:90 A:85 D:80 |
| 5 | Confident | Honesty = menu row disabled + hint, palette action absent, gated on a new SSE `altScreen` field (active pane's `alternate_on`) | Menu-time signal beats a click-time error; active-pane rule matches what the capture targets; SSE field is a cheap format-list addition | S:60 R:80 A:85 D:75 |
| 6 | Confident | Field name `altScreen` on WindowInfo (window-level, active-pane-derived), not per-pane in the payload | The consumer (menu row/palette) is window-scoped like the capture itself; per-pane surfacing has no consumer | S:50 R:85 A:80 D:75 |

6 assumptions (2 certain, 4 confident, 0 tentative, 0 unresolved).
