# Intake: Terminal Tile Export

**Change**: 260819-shqo-terminal-tile-export
**Created**: 2026-08-19

## Origin

Conversational — a `/fab-discuss` session audited the unused @xterm addon catalog against run-kit's terminal tile and produced an approved design study (`terminal-tile-addons-design-study.html`, presented via `rk present`; state 02 covers this change). The user picked three "strong fit" addons for execution; this is the first (no dependencies, ships first per the agreed order: export → find → progress).

> Create the terminal-tile export intake: a ⇩ download button on the tty tile header — addon-serialize for colored HTML snapshots / plain-text transcripts / copy of the client buffer, plus a server-side full-history download via `tmux capture-pane -S -`

Key decisions from the discussion:

- The user chose the **tile header** ("the header or the title bar of the terminal itself") as the placement for all new addon affordances.
- The design study's state 02 (export menu) was reviewed and iterated by the user; its two-section menu split is the approved shape.
- The two-section split is load-bearing and was derived from a verified constraint: the xterm client buffer holds only **what streamed since attach** — tmux owns scrollback, so a truly complete transcript can only come from the server (`capture-pane -S -`). The menu must be honest about which artifact the user is getting.

## Why

1. **Pain point**: agent runs produce valuable terminal output (fab pipeline runs, test output, review transcripts) with no way to save or share it. Users resort to screenshots or manual `tmux capture-pane` invocations on the host — neither preserves colors nor works from the web/mobile dashboard.
2. **Consequence if unfixed**: run-kit's core artifact — the agent session — remains unshareable and unarchivable from the product itself. The dashboard can show a run but not hand it to you.
3. **Why this approach**: `@xterm/addon-serialize` (0.14.0, same release train as the xterm 6.0.0 already shipped) produces colored, self-contained output from the existing client buffer with zero backend involvement; the server-capture arm reuses the derive-from-tmux model (Constitution II — state read from tmux at request time) for the full-history case. Both halves are additive; no existing behavior changes.

## What Changes

### 1. Export button + menu on the tty tile header

A ⇩ button in the tty tile header in `surface-layout.tsx`, placed **left of the pane segment** (Split H · Split V · Close Pane), mirroring the web tile's ⌕/↗ placement from the sibling chrome study (`260819-v6y4`). Clicking opens a small dropdown menu (existing popup/menu conventions, `.rk-popup-elev`) with two labeled sections:

```
This view — client buffer
  Download snapshot        .html · colors kept
  Download transcript      .txt · buffer text
  Copy visible screen
──────────────────────────
Full history — server capture
  Download pane history    .txt · capture-pane -S -
```

- **Download snapshot (.html)** — `serializeAddon.serializeAsHTML({ includeGlobalBackground: true })`; wrap in a minimal standalone HTML shell (monospace font stack, terminal background) so the file opens self-contained in a browser.
- **Download transcript (.txt)** — plain text of the client buffer: walk `terminal.buffer.active` lines via `translateToString(true)` (trimmed trailing whitespace, wrapped-line aware). Not `serialize()` — that emits escape sequences, wrong artifact for a .txt.
- **Copy visible screen** — the visible rows only, plain text, via the existing clipboard utility (`ui/dialogs-and-state` documents it). Menu + palette entry point only; no new keyboard shortcut (⌘⇧C-class chords are near tmux/xterm copy conventions and the claimed-key set should not grow for a menu action).
- Downloads are client-side: Blob + temporary `<a download>` anchor, no server round-trip for the two client-buffer rows.
- Filename convention: `{session}-{window}-{YYMMDD-HHmmss}.{html|txt}` from the route params + client clock.

### 2. Server-side full-history endpoint

A read endpoint following the chat-backfill shape (window-scoped, `?server=` param like the rest of the API surface):

- `GET /api/servers/{server}/windows/{windowId}/history` → `text/plain` body from `tmux capture-pane -p -S - -t {pane}` targeting the window's **active pane** (the same pane the relay attaches to), `-J` NOT passed (preserve line structure as tmux renders it); a `?escapes=1` variant is **out of scope** (plain text only for now).
- Implementation per Constitution I: `exec.CommandContext` with the standard tmux timeout, argv slice, window target validated through the existing window-addressing helpers (`@N` ids / `=name:` exact targets per `run-kit/tmux-sessions` conventions). Constitution IX: it is a read → `GET`.
- The frontend menu row fetches it and triggers the same Blob-download path with a `-full.txt` filename suffix.
- No caching, no state: pure derive-at-request-time (Constitution II).

### 3. Addon registration

`@xterm/addon-serialize@^0.14.0` added to `app/frontend/package.json`; the addon is loaded in `TerminalClient` alongside the existing fit/web-links/webgl/clipboard/unicode-graphemes addons (static import — the board-route dynamic-import hang class is why terminal addons are imported statically). Loaded unconditionally: it is passive (no render cost) until an export is invoked.

### 4. Palette actions

Per the palette-registration review rule, all rows register as palette actions: `Terminal: Download snapshot (HTML)`, `Terminal: Download transcript`, `Terminal: Copy visible screen`, `Terminal: Download full history`. Scoped to terminal-route/tty-tile availability like existing terminal actions.

### Non-goals

- No find bar, no progress line (sibling changes from the same design study).
- No image support in snapshots (addon-image was evaluated and dropped — raw sixel is dead on the relay chain per the 2026-08-19 spike).
- No export from board pane cards or the chat lens; tty tile only.
- No `?escapes=1` / colored full-history variant — plain text only for the server arm.

## Affected Memory

- `run-kit/ui/lenses-and-layout`: (modify) tty tile header gains the ⇩ export menu (chrome anatomy section)
- `run-kit/ui/terminal`: (modify) xterm addons list gains addon-serialize; export/download mechanics
- `run-kit/ui/keyboard-and-palette`: (modify) four new palette actions
- `run-kit/architecture`: (modify) REST API list gains the window history GET endpoint

## Impact

- **Frontend**: `app/frontend/src/components/surface-layout.tsx` (header button + menu), `app/frontend/src/components/terminal.tsx`-adjacent `TerminalClient` module (addon registration + serialize/buffer-walk helpers), palette action registry, `app/frontend/package.json`.
- **Backend**: one new handler file in `api/` (history GET), router registration in `api/router.go`, reusing `internal/tmux` capture helpers if present (else a small addition there).
- **Tests**: Go handler test (validation, dead-server error path); Vitest unit test for the buffer-walk transcript helper and filename builder; one e2e proving the menu opens and the snapshot download fires (Playwright download event) with sibling `.spec.md` per constitution.

## Open Questions

- None.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | ⇩ export button lives on the tty tile header, left of the pane segment; menu has the two-section "This view / Full history" split | Discussed — user placed addons on the tile header and reviewed the design study's state 02 showing exactly this anatomy | S:90 R:85 A:95 D:90 |
| 2 | Certain | Client arm uses @xterm/addon-serialize (HTML keeps colors); full-history arm is server-side `capture-pane -S -` | Discussed and spike-grounded — the client buffer only holds post-attach output, so the split is a verified constraint, not a preference | S:90 R:80 A:95 D:90 |
| 3 | Certain | History endpoint is a GET; subprocess via exec.CommandContext with validated targets | Constitution IX (reads are GET) and I (no shell strings) answer this deterministically | S:85 R:90 A:100 D:95 |
| 4 | Confident | Endpoint shape `GET /api/servers/{server}/windows/{windowId}/history` returning text/plain from the window's active pane | Mirrors the chat backfill's window-scoped read; active pane matches what the relay shows | S:60 R:80 A:80 D:75 |
| 5 | Confident | Transcript (.txt) via buffer-line `translateToString` walk, not `serialize()` | serialize() emits escape sequences — wrong artifact for .txt; buffer walk is the standard xterm approach | S:55 R:85 A:85 D:80 |
| 6 | Confident | Filenames `{session}-{window}-{YYMMDD-HHmmss}` + `.html` / `.txt` extension, `-full` suffix for the server arm | Unstated detail; any reasonable convention works and is trivially changed | S:50 R:95 A:75 D:70 |
| 7 | Confident | No new keyboard shortcut for copy/export — menu + palette only | Claimed-key set is deliberately small (keyboard-and-palette tier system); ⌘⇧C-class chords collide with terminal copy conventions | S:55 R:90 A:80 D:75 |
| 8 | Confident | addon-serialize imported statically and registered unconditionally in TerminalClient | Static-import rule from the board-route dynamic-import hang; the addon is passive until invoked | S:60 R:90 A:85 D:80 |

8 assumptions (3 certain, 5 confident, 0 tentative, 0 unresolved).
