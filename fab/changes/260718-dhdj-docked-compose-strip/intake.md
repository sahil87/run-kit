# Intake: Docked Compose Strip

**Change**: 260718-dhdj-docked-compose-strip
**Created**: 2026-07-18

## Origin

Created via `/fab-proceed` promptless dispatch from a live design conversation. All major decisions below were explicitly confirmed by the user in that conversation (see Assumptions — rows marked "Discussed"). Synthesized request:

> Replace the modal Text Input (ComposeBuffer) dialog with a persistent docked compose strip — a sticky "attached" text-input mode that docks at the bottom of the terminal area, above the bottom-bar keys, replacing the current modal dialog entirely. The bottom bar's `>_` button becomes a toggle (pressed-state chip vocabulary: aria-pressed + accent styling, like the ctrl/alt modifier chips).

Decisions confirmed conversationally: (1) replace the dialog entirely — one input surface; (2) sticky, toggled via the `>_` chip + a command-palette action, persisted as a global chrome preference; (3) live target that follows the focused pane with a visible target label — a deliberate reversal of the dialog's frozen-target design (DD-6); (4) Enter submits with trailing `\r`, Shift+Enter inserts a newline; (5) the strip never steals focus, Escape blurs to the terminal; (6) uploads keep the worktree-scoped destination and re-home pending attachments on focus change; (7) the strip absorbs the dialog's 📎 upload + image previews + multi-line auto-grow; (8) one global strip, not per board pane.

## Why

**The pain point.** The current compose affordance is a modal dialog (`app/frontend/src/components/compose-buffer.tsx`): fixed-inset backdrop, `role=dialog` + `aria-modal`, focus trap, Escape-closes, Cmd+Enter sends, and it closes on every send. Composing to an agent is therefore a repeated open→type→send→closed cycle — high-friction exactly where it matters most: on mobile, where the real `<textarea>` is the only way to get autocorrect/IME (xterm.js has neither), and where users want the input surface to simply stay up. The dialog also freezes its WebSocket send target at open (`frozenWsRef`, compose-buffer.tsx:34) — correct for a transient modal, but a persistent surface with a frozen target would silently send to a stale pane.

**Consequence of not fixing.** Mobile composition stays modal-cycle-bound, and the app carries two divergent input paradigms: the chat lens already ships a docked, sticky send form (`ChatSendForm` in `app/frontend/src/components/chat-view.tsx` — auto-growing textarea, Enter submits, Shift+Enter newline) while the terminal lens keeps a one-shot modal. The proven pattern exists in-repo; the terminal lens just doesn't use it.

**Why this approach.** A docked, sticky strip that replaces (not augments) the dialog keeps one input surface (Constitution IV — Minimal Surface Area), adopts the ChatSendForm interaction convention users already know, and rides the existing relay send path (raw bytes over the focused terminal's muxed relay stream) — deliberately distinct from the chat-send path (POST `/api/windows/{id}/chat/send` with probe/lock machinery). Rejected alternatives are recorded under What Changes §9.

## What Changes

### 1. Retire the ComposeBuffer modal

`app/frontend/src/components/compose-buffer.tsx` is removed (or fully rewritten as the strip — implementer's choice; the dialog semantics go away regardless): no backdrop, no `role=dialog`/`aria-modal`, no focus trap, no Escape-closes, no close-on-send. Its features migrate into the strip (§2). Render seams to unwire:

- `app/frontend/src/components/terminal-client.tsx:1019-1036` — renders `<ComposeBuffer>` when `composeOpen`, passing `wsRef`, `initialText={composeInitialText}`, `uploadedFiles={composeFiles}`, upload/remove handlers; `onClose` refocuses xterm. Also the `opacity-50` dimming of the terminal while compose is open (terminal-client.tsx:1007) goes away.
- `app/frontend/src/components/board/board-pane.tsx:92-98,176-177` — the `composeOpenForPane = isFocused && composeOpen` gate; per-pane compose rendering is retired (the strip is global, §3).
- Drag-drop / paste upload flows in terminal-client.tsx (`uploadFiles(files).then(openComposeWithUploads)` at :192, :216, :223) retarget to the strip: they should open/populate the strip instead of the modal.

### 2. The docked compose strip (new component)

A single global strip docked at the bottom of the terminal area, immediately **above** the bottom-bar keys (the `footer` grid area, app.tsx:2668-2678; the board route's equivalent seam near board-page.tsx:956). Contents:

- **Multi-line textarea** — auto-growing, bounded like ChatSendForm's `MAX_TEXTAREA_ROWS = 6` internal-scroll pattern (chat-view.tsx). Real `<textarea>` gives mobile autocorrect/IME that xterm.js lacks. Keep the dialog's `autoComplete/autoCorrect/autoCapitalize off, spellCheck false` attributes (compose-buffer.tsx:230-233) — this is verbatim terminal input, not prose.
- **Visible live-target label** — e.g. `→ {window name}` — that updates as pane focus changes. On the terminal route the target is the route's window (unambiguous); on the board route it is the focused pane.
- **📎 upload button + compact previews** — image thumbnails/file chips in a compact popover or inline mini-strip (the dialog's 60px preview strip + expanded-preview at compose-buffer.tsx:171-226 may be simplified; compact is fine). Blob-URL lifecycle management carries over.
- **Send affordance** — Enter submits (§4); a visible Send button is optional but consistent with the dialog.

The strip is **sticky**: it persists after send and never auto-dismisses. It renders whenever the preference is on — when no terminal is focused (`focused === null`, e.g. the `/$server` tiles route), it renders disabled with a "no target" state and never sends.

### 3. Toggle affordances + persistence

- **`>_` chip becomes a toggle** (`app/frontend/src/components/bottom-bar.tsx:347-357`): add `aria-pressed={composeOpen}` and the pressed-state chip vocabulary already used by the ctrl/alt modifier chips (bottom-bar.tsx:271-282): `bg-accent/20 border-accent text-accent` when on, `text-text-secondary` when off. `preventFocusSteal` on the chip is preserved.
- **Command palette**: the existing `View: Text Input` action (id `text-input`, app.tsx:1919-1924, currently `setComposeOpen(true)`) becomes the toggle (Constitution V — Keyboard-First; palette parity is a code-review rule).
- **Persistence**: the toggle state is a **global chrome preference** persisted like `terminalFontSize` (`app/frontend/src/contexts/chrome-context.tsx` — `TERMINAL_FONT_STORAGE_KEY = "runkit-terminal-font-size"` pattern: ChromeContext value + localStorage key, e.g. `runkit-compose-strip`). Mobile users leave it on; desktop users mostly off. The current ephemeral `composeOpen`/`setComposeOpen` pair in `FocusedTerminalContext` (focused-terminal-context.tsx:39-40) is superseded by/rewired to this persisted preference; `app.tsx:2674` (`onOpenCompose={() => setComposeOpen(!composeOpen)}`) and `board-page.tsx:956` (`setComposeOpen(true)`) both become the same toggle.

### 4. Send semantics — live target, Enter submits

- **Live target (reverses DD-6).** The dialog freezes its send target at open (compose-buffer.tsx:34 `frozenWsRef`) to prevent wrong-pane sends. The sticky strip **deliberately reverses** this: it always sends to the currently-focused pane's `wsRef` from `FocusedTerminalContext` (`focused.wsRef` — a WebSocket-shaped adapter over the muxed relay stream, terminal-client.tsx:79-96). The wrong-pane-send risk is mitigated by the always-visible target label (§2) instead of by freezing. Record this reversal as an explicit Design Decision in the plan.
- **Enter submits**: sends the textarea content + trailing `\r` over the relay stream (raw bytes — same path as BottomBar keystrokes: `wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.send(...)`). **Shift+Enter** inserts a newline. This matches the ChatSendForm convention and is a deliberate behavior change from the dialog's raw-insert send (no trailing `\r`, Cmd+Enter to send). Guard Enter against IME composition (`e.isComposing`). Empty/whitespace-only Enter is a no-op (bare Enter for TUI y/n prompts stays a terminal tap).
- **After send**: textarea and attachments clear; the strip stays open and does **not** grab or return focus (§5).
- Compose rides the relay WebSocket as raw bytes — deliberately distinct from the chat-send path (POST `/api/windows/{id}/chat/send` probe/lock machinery). No backend changes on the send path.

### 5. Focus routing

- The strip **never steals focus** — not on mount, not on toggle-on, not after send. The user chooses where to type.
- **Escape in the strip blurs to the terminal** (Escape no longer closes any input surface). Interactive TUI moments (vim, fzf, y/n menus) keep working by tapping/clicking the terminal.
- The bottom bar's `preventFocusSteal` discipline is preserved on all strip-adjacent chrome.
- **Touch devices**: the ⌨ keyboard-toggle button (bottom-bar.tsx:213-229 `handleKbdClick` → `onFocusTerminal`) focuses the **strip** (not the xterm) when the compose preference is on.

### 6. Uploads — worktree destination kept, re-home on focus change

- Backend upload handler (`app/backend/api/upload.go`) is **unchanged**: writes to `{target window's worktree}/.uploads/` (gitignore auto-appended) so permission-gated agents can read the file without a read-outside-cwd prompt; window-ID form field targets the window's worktree, falling back to `windows[0]`; empty worktree is a 500.
- The strip uploads **eagerly** to the live focused target's worktree — `useFileUpload(session, windowId, server)` (`app/frontend/src/hooks/use-file-upload.ts`) already takes the window ID; the strip calls it with the *focused* target's identity from `FocusedTerminalContext` (`focused.server/session/windowId`).
- **Re-homing**: if the focused pane changes while attachments are pending, the strip re-uploads the held `File` objects (`UploadedFile.file` is already retained client-side for previews) to the new target's worktree and rewrites the path lines in the textarea — the path-line splice already exists in ComposeBuffer's `handleRemoveFile` (compose-buffer.tsx:125-151, `lines.indexOf(file.path)` → splice). Orphaned files left in the old worktree are acceptable — the current dialog already orphans server files on attachment-remove and close-without-send.
- Re-home failure (upload to the new target fails): keep the original path lines, surface a non-blocking inline error (ChatSendForm's `role="alert"` convention); do not block sending.

### 7. Terminal reflow

Toggling the strip shrinks/grows the terminal by roughly 2 rows and must trigger FitAddon refit + tmux resize — the same class of reflow as a font-size change (accepted cost; the modal never resized). Draft text and pending attachments persist across focus changes, route navigation (terminal shell ↔ board page — the strip's state lives in one global home above both shells), and toggle-off/on.

### 8. Tests

- **Unit**: `terminal-client.test.tsx` mocks ComposeBuffer and passes `composeOpen`/`setComposeOpen` props (lines 161-162, 178-179, 520-521, 936-937) — these seams change. Dialog-semantics assertions (role=dialog, aria-modal, focus trap) are replaced by strip semantics (aria-pressed toggle, target label, Enter/Shift+Enter, no focus steal). New unit coverage for the strip component and the re-homing logic.
- **e2e**: UI changes need Playwright e2e where possible (code-quality.md) — cover: toggle via chip + palette, persistence across reload, Enter-sends-with-`\r` to the focused pane, target label follows board-pane focus, Escape blurs to terminal, terminal refit on toggle. `tests/e2e/shell-rotation.spec.ts:14` notes per-pane compose STDIN routing was left untested — the strip's live-target e2e can close that gap. Every new/modified `.spec.ts` ships its sibling `.spec.md` in the same commit (Constitution — Test Companion Docs).
- Run through `just` recipes only (`just test-e2e`, `just pw`) — never Playwright directly.

### 9. Alternatives rejected (recorded for the plan's Design Decisions)

- **Neutral host upload directory** (`/tmp` or `~/.rk/uploads/`): rejected — every upload would sit outside the agent's project root, reintroducing permission friction for permission-gated agents; loses worktree locality (the reason `.uploads/` exists).
- **Defer-upload-to-send-time with placeholder tokens**: rejected — loses the real path in the textarea (users position it in prose); more machinery than the problem deserves.
- **Frozen send target (status-quo DD-6)**: rejected in favor of live target + visible target label — a persistent strip with a stale frozen target would be worse than the freeze it replaces.
- **Per-pane strips on the board route**: rejected — one global strip.

## Affected Memory

- `run-kit/ui-patterns`: (modify) ComposeBuffer modal replaced by the global docked compose strip (sticky toggle chip + palette parity + ChromeContext-persisted preference + live focused-pane target); add a one-line note distinguishing the two send paths — compose rides the relay WebSocket as raw bytes (RelayMux stream, focused terminal's wsRef), chat-send is POST `/api/windows/{id}/chat/send` with probe/lock machinery.

## Impact

- **Frontend only** — no backend changes (upload.go and the relay send path are consumed as-is).
- Touched areas: `app/frontend/src/components/compose-buffer.tsx` (retired/rewritten as the strip), `terminal-client.tsx` (compose render seam, drag/paste upload flows, refit on toggle), `board/board-pane.tsx` + `board/board-page.tsx` (per-pane compose gate removed; global strip + bottom-bar seam), `bottom-bar.tsx` (`>_` toggle chip, touch ⌨ routing), `app.tsx` (palette action, footer seam), `contexts/focused-terminal-context.tsx` (compose-open state superseded by persisted preference; strip consumes `focused`), `contexts/chrome-context.tsx` (new persisted preference), `hooks/use-file-upload.ts` (consumed; re-home orchestration is new client logic).
- Tests: `terminal-client.test.tsx` prop seams; new strip unit tests; new/updated Playwright specs + `.spec.md` companions; `board-pane`/`board-page` test touch-points.
- UX: terminal loses ~2 rows while the strip is on (refit handled); Escape and Enter semantics change relative to the dialog.

## Open Questions

- None — all major decisions were confirmed in the originating conversation; residual details are graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Replace the dialog entirely — the docked strip is the only compose surface | Discussed — user confirmed; Constitution IV Minimal Surface Area | S:95 R:70 A:90 D:95 |
| 2 | Certain | Sticky strip; `>_` chip becomes an aria-pressed accent toggle + palette toggle; state persisted as a global chrome preference (ChromeContext + localStorage, like `terminalFontSize`) | Discussed — user confirmed; mirrors the existing modifier-chip and font-size patterns | S:95 R:85 A:90 D:95 |
| 3 | Certain | Live send target following the focused pane with a visible `→ {window}` label — deliberate reversal of the frozen-target design (DD-6, compose-buffer.tsx:34) | Discussed — user explicitly confirmed the reversal and asked it be recorded as a design decision | S:95 R:60 A:85 D:90 |
| 4 | Certain | Enter sends buffer + trailing `\r`; Shift+Enter newline — replaces the dialog's raw-insert Cmd+Enter send | Discussed — user confirmed the behavior change; matches ChatSendForm convention | S:95 R:80 A:90 D:90 |
| 5 | Certain | Strip never steals focus (mount/toggle/after-send); Escape blurs to the terminal; touch ⌨ button focuses the strip when the preference is on | Discussed — user confirmed | S:90 R:80 A:85 D:85 |
| 6 | Certain | Uploads keep the worktree-scoped `.uploads/` destination, upload eagerly to the live target, and re-home pending attachments on focus change (re-upload retained `File` objects + rewrite textarea path lines); orphaned files acceptable | Discussed — user chose over neutral-host-dir and defer-to-send alternatives | S:95 R:70 A:85 D:90 |
| 7 | Certain | Strip absorbs 📎 upload + image previews (compact popover/strip acceptable) + bounded auto-grow textarea (ChatSendForm max-rows pattern) | Discussed — user confirmed | S:90 R:85 A:90 D:85 |
| 8 | Certain | One global strip docked above the bottom bar (not per board pane), targeting via FocusedTerminalContext | Discussed — user confirmed | S:95 R:70 A:90 D:95 |
| 9 | Certain | Strip toggle triggers FitAddon refit + tmux resize; the ~2-row terminal shrink is an accepted cost | Discussed — user accepted the reflow (same class as a font-size change) | S:90 R:85 A:85 D:90 |
| 10 | Certain | Send clears textarea + attachments; the strip stays open | User: strip persists after send; ChatSendForm clear-on-success convention | S:70 R:90 A:85 D:85 |
| 11 | Confident | With no focused terminal (`focused === null`, e.g. `/$server` tiles route), an enabled strip renders disabled with a "no target" state and never sends | Follows from the live-target design; obvious safe default, trivially adjusted later | S:60 R:85 A:75 D:70 |
| 12 | Confident | Draft text + pending attachments live in one global state home above both shells (terminal shell + board page), surviving route changes and toggle-off/on | Sticky + one-global-strip implies the buffer is not tied to a pane or route lifetime | S:65 R:75 A:80 D:70 |
| 13 | Confident | Empty/whitespace-only Enter is a no-op (bare Enter for TUI prompts stays a terminal interaction); Enter is guarded against IME composition | ChatSendForm convention; user kept interactive-TUI moments on the terminal itself | S:50 R:90 A:70 D:65 |
| 14 | Confident | Re-home failure keeps the original path lines and surfaces a non-blocking inline error; sending is not blocked | Not discussed; inline `role="alert"` error convention exists in ChatSendForm; low blast radius | S:40 R:80 A:60 D:45 |

14 assumptions (10 certain, 4 confident, 0 tentative, 0 unresolved).
