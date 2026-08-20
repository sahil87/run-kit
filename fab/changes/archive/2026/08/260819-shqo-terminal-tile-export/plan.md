# Plan: Terminal Tile Export

**Change**: 260819-shqo-terminal-tile-export
**Intake**: `intake.md`

## Requirements

### Frontend: Export button + menu on the tty tile header

#### R1: Export button at the pre-landed anchor
A ⇩ export button SHALL be added to the tty tile header in `app/frontend/src/components/surface-layout.tsx`, replacing exactly the `{/* rk-slot: export-button */}` anchor line (left of the pane segment, after the `flex-1` spacer and the `find-button` anchor, which belongs to sibling change `260819-zqf9` and MUST NOT be touched). It renders only on tty tiles (`kind === "tty"`), styled per the header's existing verb-button vocabulary (`VERB_BUTTON_CLASS`, `Tip` wrapper, `aria-label`).

- **GIVEN** a desktop terminal route with a tty tile
- **WHEN** the tile header renders
- **THEN** a ⇩ button with an accessible label (e.g. `Export terminal output`) appears left of the Split H · Split V · Close Pane segment
- **AND** the `find-button`, `progress-chip`, `find-bar-row`, and `progress-line` anchor comments remain byte-identical in place

#### R2: Two-section export menu
Clicking the ⇩ button SHALL open a small dropdown menu (existing popup conventions: `.rk-popup-elev`, monospace, closes on outside click and Escape) with two labeled sections exactly per the approved design:

```
This view — client buffer
  Download snapshot        .html · colors kept
  Download transcript      .txt · buffer text
  Copy visible screen
──────────────────────────
Full history — server capture
  Download pane history    .txt · capture-pane -S -
```

- **GIVEN** the ⇩ button
- **WHEN** clicked
- **THEN** the menu opens with the "This view — client buffer" section (3 rows) above a divider and the "Full history — server capture" section (1 row)
- **AND** picking any row performs its action and closes the menu

#### R3: Snapshot download (.html, colors kept)
The snapshot row SHALL call `serializeAddon.serializeAsHTML({ includeGlobalBackground: true })` via the scaffold's `serializeAddonRef` seam and wrap the result in a minimal standalone HTML shell (doctype, charset, `<title>`, monospace font stack, terminal background) so the file opens self-contained in a browser. Download is client-side: Blob + temporary `<a download>` anchor, no server round-trip.

- **GIVEN** a tty tile with terminal output
- **WHEN** "Download snapshot" is picked
- **THEN** an `.html` file downloads whose body contains the serialized colored buffer inside a self-contained HTML document

#### R4: Transcript download (.txt, buffer walk)
The transcript row SHALL produce plain text by walking `terminal.buffer.active` lines via `translateToString(true)` (trailing whitespace trimmed), wrapped-line aware (a line whose successor has `isWrapped` joins without a newline). It MUST NOT use `serialize()` (escape sequences — wrong artifact for a .txt).

- **GIVEN** a tty tile whose buffer contains a soft-wrapped long line
- **WHEN** "Download transcript" is picked
- **THEN** a `.txt` file downloads with the wrapped line joined as one logical line and no ANSI escapes

#### R5: Copy visible screen
The copy row SHALL copy only the visible viewport rows (from `buffer.active.viewportY`, `terminal.rows` rows) as plain text via the shared `copyToClipboard` utility (`app/frontend/src/lib/clipboard.ts`). No new keyboard shortcut is registered (menu + palette entry points only).

- **GIVEN** a tty tile scrolled anywhere in its buffer
- **WHEN** "Copy visible screen" is picked
- **THEN** the clipboard holds exactly the visible rows' text
- **AND** no new key binding is added to the keybinding registry

#### R6: Filename convention
Downloads SHALL be named `{session}-{window}-{YYMMDD-HHmmss}.{html|txt}` from the route context (session name + window name, safe-name-sanitized; window id as fallback) and the client clock; the server-capture arm appends `-full` before `.txt` (i.e. `{session}-{window}-{YYMMDD-HHmmss}-full.txt`).

- **GIVEN** session `dev`, window `agent`, client time 2026-08-20 14:03:05
- **WHEN** any download row is picked
- **THEN** the filename is `dev-agent-260820-140305.html` / `.txt` / `-full.txt` respectively

#### R7: Terminal instance seam (`terminalRef`)
`terminal-client.tsx` SHALL gain one optional `terminalRef?: React.MutableRefObject<Terminal | null>` prop following the scaffold seams' exact lifecycle (filled at init beside `searchAddonRef`/`serializeAddonRef`, nulled on cleanup) — the buffer-walk rows (R4, R5) need `terminal.buffer` access, which no existing seam exposes (SerializeAddon's public API has no buffer accessor). The scaffold's import/registration block, `package.json`, and the pre-landed seams are NOT otherwise modified.

- **GIVEN** a mounted `TerminalClient` with a `terminalRef` supplied
- **WHEN** init completes / the component unmounts
- **THEN** the ref holds the live `Terminal` / is nulled, mirroring the `searchAddonRef` seam contract

### Frontend: Pure export helpers module

#### R8: `lib/terminal-export.ts` pure module
The serialize/buffer-walk/filename logic SHALL live in a new module `app/frontend/src/lib/terminal-export.ts` with colocated `terminal-export.test.ts` (the `window-view.ts` module contract): `buildExportFilename(session, window, date, ext, fullSuffix?)`, `transcriptFromBuffer(buffer)` and `visibleScreenText(buffer, rows)` (taking a minimal structural buffer shape so tests need no real xterm), `wrapHtmlSnapshot(inner, title)`, and a small DOM download trigger `downloadTextFile(filename, mime, content)` (Blob + temporary anchor — the `clipboard.ts` precedent for a lib module with a DOM edge).

- **GIVEN** the module
- **WHEN** unit tests run in jsdom
- **THEN** filename formatting (zero-padding, sanitization, `-full` suffix), wrapped-line joining, trailing-trim, viewport slicing, and HTML shell wrapping are each proven without a real Terminal

### Frontend: Palette actions

#### R9: Four palette actions via one CustomEvent seam
Four terminal-route palette actions SHALL be registered — `Terminal: Download snapshot (HTML)`, `Terminal: Download transcript`, `Terminal: Copy visible screen`, `Terminal: Download full history` — scoped like existing terminal actions (available when a tty tile is in the resolved layout). They reach the mounted tile through one document CustomEvent (`terminal-export` with `detail.action`, constant exported from `lib/terminal-export.ts`) that the export cluster in `SurfaceLayout` listens for — the `WEB_FIND_OPEN_EVENT` precedent (one terminal route mount, so the receiver is unambiguous). No `shortcut` hints (no bindings exist).

- **GIVEN** the command palette on a terminal route with a tty tile
- **WHEN** `Terminal: Download transcript` is executed
- **THEN** the same transcript download as the menu row fires
- **AND** on non-terminal routes / tty-less layouts the four actions are absent

### Backend: Window history endpoint

#### R10: `GET /api/windows/{windowId}/history`
A read endpoint SHALL be added following the chat-backfill shape — window-scoped with the `?server=` param (`parseWindowID` + `serverFromRequest`), registered in `app/backend/api/router.go` beside the chat routes. NOTE: the intake's literal path (`/api/servers/{server}/windows/...`) does not exist anywhere in the API surface; the window-scoped `?server=` form is the actual "chat-backfill shape" the intake invokes and is what this change implements. Handler in a new `app/backend/api/history.go`: it returns `text/plain; charset=utf-8` from `tmux capture-pane -p -S - -t {windowId}` — targeting the WINDOW id targets its active pane (the `KillActivePane` precedent), the same pane the relay attaches to. `-J` is NOT passed; no `?escapes=` variant. No caching, pure derive-at-request-time.

- **GIVEN** a live window `@5` on server `rk`
- **WHEN** `GET /api/windows/%405/history?server=rk`
- **THEN** 200 with `Content-Type: text/plain; charset=utf-8` and the pane's full scrollback as body
- **GIVEN** an invalid window id
- **WHEN** the endpoint is hit
- **THEN** 400 `Invalid window ID`
- **GIVEN** a dead/unreachable tmux server
- **WHEN** the endpoint is hit
- **THEN** 500 with the tmux error

#### R11: Capture helper + TmuxOps seam
A `CaptureWindowHistoryCtx(ctx, target, server string) (string, error)` helper SHALL be added to `app/backend/internal/tmux/tmux.go` beside the existing capture helpers, running `capture-pane -t {target} -p -S -` via `tmuxExecRawServer` (Constitution I: `exec.CommandContext`, argv slice, standard tmux timeout at the route via the handler's context). A matching `CaptureWindowHistory` method is added to the `TmuxOps` interface + `prodTmuxOps` (and every test stub implementing the interface).

- **GIVEN** the handler's request context
- **WHEN** the capture runs
- **THEN** the subprocess is bounded by that context and the argv contains the literal `-S -` (full history), no `-e`, no `-J`

#### R12: Frontend history row
The menu's "Download pane history" row (and its palette twin) SHALL fetch the endpoint via a new API-client function `fetchWindowHistory(server, windowId): Promise<string>` in `app/frontend/src/api/client.ts` (existing `?server=` conventions) and hand the body to the same Blob-download path with the `-full.txt` filename (R6).

- **GIVEN** the menu open on window `@5`
- **WHEN** "Download pane history" is picked
- **THEN** one GET to `/api/windows/{id}/history?server=...` fires and a `...-full.txt` file downloads with the response body

### Non-Goals

- No find bar, no progress line (sibling changes `260819-zqf9`, `260819-1vxq` own the adjacent anchors — do not touch them).
- No image support in snapshots; no `?escapes=1` colored full-history variant.
- No export from board pane cards or the chat lens; tty tile only.
- No new keyboard shortcut for any export action.
- No mobile tile-header affordance (the header only renders on desktop; the palette covers mobile).

### Design Decisions

#### Endpoint path follows the real API surface
**Decision**: `GET /api/windows/{windowId}/history?server=` — not the intake's literal `GET /api/servers/{server}/windows/{windowId}/history`.
**Why**: The intake simultaneously prescribes "the chat-backfill shape (window-scoped, `?server=` param)" and a `/api/servers/...` path that exists nowhere in `router.go`; the entire window API is `/api/windows/{windowId}/...` + `?server=`. The shape reference is the intent; the literal path is a slip.
**Rejected**: Introducing the first-ever `/api/servers/{server}/windows/...` route shape — a new URL convention for one endpoint, inconsistent with every sibling route.
*Introduced by*: 260819-shqo-terminal-tile-export

#### `terminalRef` seam added to terminal-client.tsx
**Decision**: Add one optional `terminalRef` prop (same fill/null lifecycle as the scaffold's addon refs) despite the intake's "do not edit terminal-client.tsx" note.
**Why**: The intake's own transcript/copy mechanism (`terminal.buffer.active` walk) requires Terminal access, and no existing seam exposes it — SerializeAddon's public API is `serialize`/`serializeAsHTML` only. The do-not-edit note's purpose is parallel-merge safety; no sibling change edits `terminal-client.tsx`, so a small additive prop is conflict-free and honors the note's intent while the import/registration block stays untouched.
**Rejected**: Casting into the addon's private `_terminal` (violates code-quality type-narrowing; private API); deriving plain text by stripping escapes from `serialize()` output (the intake explicitly rejects serialize() for .txt, and stripping loses wrapped-line semantics); the DEV-only `window.__rkTerminals` registry (not a production seam).
*Introduced by*: 260819-shqo-terminal-tile-export

#### Palette → tile via one CustomEvent
**Decision**: Palette actions dispatch a single `terminal-export` document CustomEvent carrying `detail.action`; the SurfaceLayout export cluster listens.
**Why**: The established palette→mounted-component seam (`WEB_FIND_OPEN_EVENT`, `window-heading:rename`, `theme-selector:open`); avoids lifting the addon/terminal refs and window metadata up to `app.tsx`.
**Rejected**: Creating the refs in `app.tsx` and invoking helpers directly from palette callbacks — spreads the export wiring across two files and diverges from the seam precedent.
*Introduced by*: 260819-shqo-terminal-tile-export

#### Window-target capture for the active pane
**Decision**: Pass the window id itself as the `capture-pane -t` target.
**Why**: tmux resolves a window target to its active pane — the codebase already relies on this (`KillActivePane`); it is exactly "the same pane the relay attaches to" and avoids a pane-enumeration round-trip.
**Rejected**: `FetchSessions` + pane scan (an extra full-derive for data tmux resolves natively).
*Introduced by*: 260819-shqo-terminal-tile-export

## Tasks

### Phase 1: Setup

- [x] T001 [P] Create `app/frontend/src/lib/terminal-export.ts` — `EXPORT_EVENT` constant + `ExportAction` union, `buildExportFilename`, `transcriptFromBuffer`, `visibleScreenText`, `wrapHtmlSnapshot`, `downloadTextFile` — with colocated `terminal-export.test.ts` covering filename zero-padding/sanitization/`-full` suffix, wrapped-line joining, trailing trim, viewport slicing, HTML shell <!-- R8, R6, R4, R5 -->
- [x] T002 [P] Add `CaptureWindowHistoryCtx` to `app/backend/internal/tmux/tmux.go` (argv: `capture-pane -t {target} -p -S -`, via `tmuxExecRawServer`, caller-bounded ctx) <!-- R11 -->

### Phase 2: Core Implementation

- [x] T003 Add `CaptureWindowHistory` to the `TmuxOps` interface + `prodTmuxOps` in `app/backend/api/router.go`, update every test stub implementing `TmuxOps`; new `app/backend/api/history.go` with `handleWindowHistory` (parseWindowID → 400; capture error → 500; else 200 text/plain); register `r.Get("/api/windows/{windowId}/history", s.handleWindowHistory)` beside the chat routes <!-- R10, R11 -->
- [x] T004 Go handler test `app/backend/api/history_test.go`: invalid-id 400, capture-error 500 (dead-server path), success 200 with text/plain content type and exact body passthrough <!-- R10 -->
- [x] T005 [P] Add optional `terminalRef` prop to `app/frontend/src/components/terminal-client.tsx` (fill at init beside the scaffold seams, null on cleanup, add to the seam effect's dep list); extend the existing seam unit test in `terminal-client.test.tsx` <!-- R7 -->
- [x] T006 [P] Add `fetchWindowHistory(server, windowId)` to `app/frontend/src/api/client.ts` (GET + `?server=`, text body, non-OK → thrown error) <!-- R12 -->

### Phase 3: Integration & Edge Cases

- [x] T007 In `app/frontend/src/components/surface-layout.tsx`: create `serializeAddonRef` + `ttyTerminalRef`, pass both to the PRIMARY tty `TerminalClient` only (the `wsRef`/`focusRef` primary-tty rule); replace ONLY the `{/* rk-slot: export-button */}` line with the ⇩ button + two-section menu (rows call the T001 helpers / `copyToClipboard` / T006 fetch with filename from `sessionName` + window name via the safe-name convention, windowId fallback); menu closes on outside click/Escape; history-row fetch failure surfaces via the existing toast/error convention, no crash <!-- R1, R2, R3, R4, R5, R6, R12 -->
- [x] T008 Add the `terminal-export` CustomEvent listener to the export cluster (dispatchable while a tty tile is mounted) and register the four `Terminal: …` palette actions in `app/frontend/src/app.tsx`, gated on the resolved layout containing `tty` <!-- R9 -->

### Phase 4: Polish

- [x] T009 e2e `app/frontend/tests/e2e/terminal-export.spec.ts` + sibling `.spec.md` (constitution Test Companion Docs): real-tmux port-3020 rig — menu opens from the ⇩ button, "Download snapshot" fires a Playwright `download` event with an `.html` filename matching the convention; palette carries the four `Terminal:` entries on the terminal route <!-- R1, R2, R3, R6, R9 -->
- [x] T010 Run gates: `cd app/backend && go test ./...`; `cd app/frontend && npx tsc --noEmit`; targeted `pnpm vitest run` for terminal-export/terminal-client/client tests; `just test-e2e "terminal-export"` (run `just setup` first — this worktree has no node_modules) <!-- R10, R8 -->

## Execution Order

- T003 depends on T002; T004 on T003.
- T007 depends on T001, T005, T006; T008 on T007.
- T009 after T007/T008. T010 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: ⇩ export button renders on tty tile headers at the former `export-button` anchor position, left of the pane segment; the four sibling anchors are untouched
- [x] A-002 R2: The menu shows the exact two-section anatomy (3 client rows / divider / 1 server row) and closes on pick, outside click, and Escape
- [x] A-003 R3: Snapshot row downloads a self-contained `.html` wrapping `serializeAsHTML({ includeGlobalBackground: true })` output
- [x] A-004 R4: Transcript row downloads plain text from a `translateToString(true)` buffer walk — wrapped-line aware, no escape sequences
- [x] A-005 R5: Copy row copies exactly the visible viewport rows via `copyToClipboard`; no new keybinding registered
- [x] A-006 R7: `terminalRef` fills at init and nulls on cleanup, mirroring the scaffold seam contract
- [x] A-007 R9: All four `Terminal: …` palette actions exist, fire the same behaviors, and are absent on tty-less layouts/routes
- [x] A-008 R10: `GET /api/windows/{windowId}/history?server=` is registered and returns the full-history capture as `text/plain; charset=utf-8`
- [x] A-009 R12: The history menu row fetches via `fetchWindowHistory` and downloads with the `-full.txt` suffix

### Behavioral Correctness

- [x] A-010 R6: Filenames follow `{session}-{window}-{YYMMDD-HHmmss}.{ext}` with zero-padded clock fields and safe-name sanitization
- [x] A-011 R11: The capture argv is exactly `capture-pane -t {windowId} -p -S -` (no `-e`, no `-J`), context-bounded

### Scenario Coverage

- [x] A-012 R4: Unit test proves a soft-wrapped line joins without a newline and trailing whitespace is trimmed
- [x] A-013 R10: Handler test covers 400 (invalid id), 500 (capture failure), 200 (body + content type)
- [x] A-014 R3: e2e proves menu open → snapshot Playwright download event with a convention-matching filename, with sibling `.spec.md` updated in the same commit

### Edge Cases & Error Handling

- [x] A-015 R12: A failed history fetch (dead server) surfaces user-visible feedback and does not crash the tile
- [x] A-016 R5: Copy/export rows behave sanely when the terminal ref is not yet filled (rows no-op or disable; no throw)

### Code Quality

- [x] A-017 Pattern consistency: button/menu follow the header verb vocabulary and popup conventions; Go handler mirrors sibling handlers (`writeError`/`writeJSON`, `parseWindowID`, `serverFromRequest`)
- [x] A-018 No unnecessary duplication: reuses `copyToClipboard`, `tmuxExecRawServer`, existing `?server=` client conventions; no second capture-args builder where composition works
- [x] A-019 Type narrowing over assertions: no new `as` casts in the export path (structural buffer types in the pure module)
- [x] A-020 No inline tmux command construction outside `internal/tmux/`; subprocess via `exec.CommandContext` argv only

### Security

- [x] A-021 R10: Window target passes `decodeWindowID` validation before reaching any subprocess; the endpoint is a GET with no mutation

## Notes

- Sibling parallel changes `260819-zqf9` (find) and `260819-1vxq` (progress) own the other four `rk-slot:` anchors — this change edits ONLY the `export-button` anchor line in the header cluster.
- This worktree has no `node_modules` — run `just setup` before any frontend test.
- e2e: always `just test-e2e "<spec>"` / `just pw` (port 3020 isolation), never direct playwright.

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. (The consumed `{/* rk-slot: export-button */}` anchor line was the planned integration mechanism, not discovered redundancy; the remaining four anchors belong to the sibling changes.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Endpoint path is `/api/windows/{windowId}/history?server=`, not the intake's literal `/api/servers/...` form | The intake names "the chat-backfill shape" as the governing convention and that shape is window-scoped + `?server=`; no `/api/servers/{server}/windows/...` route exists anywhere | S:70 R:85 A:95 D:85 |
| 2 | Confident | Add an optional `terminalRef` seam prop to terminal-client.tsx despite the intake's do-not-edit note | The intake's own buffer-walk mechanism requires Terminal access no existing seam exposes; the note guards parallel-merge safety and no sibling edits the file; alternatives are private-API casts | S:60 R:80 A:85 D:75 |
| 3 | Confident | Palette actions reach the tile via one `terminal-export` CustomEvent | The `WEB_FIND_OPEN_EVENT`/`window-heading:rename` precedent for palette→mounted-component dispatch | S:55 R:90 A:85 D:80 |
| 4 | Confident | Window name (safe-name-sanitized, windowId fallback) in filenames rather than the raw `@N` route param | Intake says "from the route params"; the route param is `@N`, which is a poor filename token — the window's display name matches user intent; trivially changed | S:50 R:90 A:75 D:70 |
| 5 | Confident | Capture targets the window id directly (`-t @N` → active pane) | `KillActivePane` precedent; tmux window targets resolve to the active pane natively | S:65 R:85 A:90 D:85 |
| 6 | Confident | Export button renders on desktop tty tile headers only; mobile relies on the palette | The tile header block is `!mobile` by existing structure; intake placed the affordance on the header | S:60 R:85 A:85 D:80 |

6 assumptions (1 certain, 5 confident, 0 tentative).
