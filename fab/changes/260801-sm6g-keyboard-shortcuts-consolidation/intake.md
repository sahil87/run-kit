# Intake: Keyboard Shortcuts Consolidation

**Change**: 260801-sm6g-keyboard-shortcuts-consolidation
**Created**: 2026-08-01

## Origin

Promptless dispatch (`/fab-proceed` create-intake, `{questioning-mode} = promptless-defer`) from a synthesized `/fab-discuss` conversation. The conversation resolved essentially all design decisions; this intake captures them faithfully. No questions were asked at intake time — any residual ambiguity is recorded as a deferred Unresolved row in `## Assumptions`.

> **Umbrella**: Keyboard-shortcuts consolidation across the run-kit frontend — five UI requirements (R1–R5) — plus one Electron desktop-shell bug fix (R6) the user explicitly asked to include in the same change. R6 is a clearly-separated requirement: it touches `app/desktop`, a different package from the frontend work.

An approved working HTML design mock for the merged shortcuts overlay (R4) is checked into this change folder as **`design-mock.html`** (the 260730-g40a precedent — copied from the discuss session's scratchpad).

## Why

1. **Discoverability and reach**: run-kit is keyboard-first by constitution (Principle V), yet several core actions have no chord — the compose strip is mouse/palette-only (R1), the Open control's "re-run last target" behavior has no keyboard path at all (R5), and the shortcuts help itself has no visible affordance outside the palette (R3).
2. **Two competing shortcut surfaces**: the legacy `KeyboardShortcuts` dialog ("tmux Keybindings", `app/frontend/src/components/keyboard-shortcuts.tsx`) and the newer `ShortcutsOverlay` coexist. The legacy dialog's hardcoded App section is already stale — it lists four fixed chords and ignores the shifted-tier registry and user rebinds. The user's core query — "what's the key for X?" — currently requires knowing which of two dialogs to open. Folding tmux content into the overlay and deleting the legacy dialog (R4) leaves one canonical, registry-driven surface.
3. **Focus friction**: the compose strip currently never steals focus on any transition (documented decision from 260718-dhdj). In practice every open is followed by a manual click into the textarea; the conversation deliberately reversed the decision for the open transition only (R2).
4. **Silent desktop bug** (R6): in the Electron shell, editor deeplinks (`vscode://…`) set via `window.location.href` are swallowed — `will-navigate` → `guardNavigation` calls `preventDefault()` and the external fallback only forwards http(s). Users clicking "Open in VS Code" in the shell get nothing, with no error. Left unfixed, the Open feature is silently broken for all deeplink editors in the desktop app.

If we don't do this: the shortcut surface keeps bifurcating (new bindings land only in the overlay while the legacy dialog drifts staler), keyboard-first erodes, and the desktop deeplink bug keeps shipping.

## What Changes

### R1 — Compose-strip toggle chord (⇧⌘E / Shift+Ctrl+E)

New builtin binding in `DEFAULT_BINDINGS` (`app/frontend/src/lib/keybindings.ts`):

- `actionId: "compose-toggle"` (or consistent with existing naming), `tier: "shifted"`, `code: "KeyE"`, `scope: "global"` — the strip mounts on both the terminal shell footer (`app.tsx`) and the board twin (`board-page.tsx`).
- `ignoreInputs: true` (existing field, `keybindings.ts:87`) so the chord also closes the strip while typing inside its textarea — the dispatcher otherwise suppresses chords in real inputs (`use-keybinding-dispatch.ts:51`).
- Handler: the existing `toggleComposeStrip()` from chrome-context — identical to the `>_` bottom-bar chip and the `View: Text Input` palette entry.
- **Letter rationale (decided in conversation)**: C claimed (Shift+Ctrl+C terminal-copy convention on win/linux per `claimedKeys`), T taken (`create-window`), I claimed (devtools win/linux). **E is free on both platforms**, mnemonic "enter/edit text". Verified: no `KeyE` in `DEFAULT_BINDINGS` today.
- `mapLabel` suggestion: `compose`.
- Wire the handler in **both** `app.tsx` and `board-page.tsx` keybinding dispatch maps. The palette entry gets the chord hint automatically via the effective-map decoration.

### R2 — Compose strip focuses its textarea on open (every open path)

Deliberately **reverses** the documented "the strip NEVER steals focus (mount / toggle / after-send)" decision from 260718-dhdj — but **only for the open transition**:

- After-send behavior unchanged (never grabs focus); Escape still blurs to terminal; route remounts must NOT steal focus.
- **Implementation seam (decided)**: every open path funnels through `toggleComposeStrip` in `app/frontend/src/contexts/chrome-context.tsx` (the `>_` chip, palette entry, new ⇧⌘E chord, the strip-open-on-drag-drop in `terminal-client.tsx:191`, board twin). Set a module-level `focusOnOpen` flag — natural home: `app/frontend/src/lib/compose-strip-events.ts`, next to the existing `registerComposeStripFocuser`/`focusComposeStrip` registry — when transitioning off→on. ComposeStrip's mount effect consumes-and-clears the flag and focuses its textarea, respecting the disabled/no-target state (the registered focuser already declines when disabled).
- Terminal↔board route remounts with the strip already enabled never set the flag → no focus steal.
- Update the ComposeStrip docstring's focus contract accordingly.
- Mobile: opening summons the IME — accepted/desired (matches the ⌨ chip behavior).

### R3 — Keyboard-shortcuts icon in the sidebar footer

- New keyboard-outline SVG icon (rounded rect + key dots) in `app/frontend/src/components/sidebar/icons.tsx`, same stroke style as `HelpIcon`/`GearIcon`.
- Placement: sidebar footer action cluster in `app/frontend/src/components/sidebar/index.tsx` (~line 1443), between Help (?) and Theme — order becomes **Help · Keyboard · Theme · Gear**.
- Tip label "Keyboard shortcuts" with the effective overlay chord in the Tip `kbd` slot.
- Action: opens/toggles the ShortcutsOverlay. **Wiring (decided in conversation)**: the sidebar is mounted from both AppShell (`app.tsx`) and the board route (`board-page.tsx` — which does NOT render AppShell; it has its own overlay mount), so prefer a document CustomEvent seam (the existing `palette:open` precedent in `bottom-bar.tsx`) — e.g. dispatch `shortcuts-overlay:open`, listened wherever `showShortcutsOverlay` state lives in both mounts — unless a cleaner existing prop path presents itself during apply.
- **Accepted trade (explicitly discussed)**: the affordance hides with the sidebar/drawer; the palette entry remains the always-available route.

### R4 — Merged shortcuts view: fold tmux keybindings into ShortcutsOverlay; delete the legacy dialog

Delete the legacy `KeyboardShortcuts` dialog (`app/frontend/src/components/keyboard-shortcuts.tsx`, "tmux Keybindings") — its hardcoded App section is stale (fixed four chords; ignores the shifted-tier registry and user rebinds). Fold its tmux content into `ShortcutsOverlay` (`app/frontend/src/components/shortcuts-overlay.tsx`); delete the legacy component + its mount + its palette entry in `app.tsx` (repoint or remove the palette action that opened it; check `board-page.tsx` too per the board-twin duplication pattern).

New **TMUX section** in the overlay, per the approved design mock (`design-mock.html` in this change folder):

- **Read-only locked rows** (🔒 + non-interactive combos — the existing shell-owned-row idiom). tmux keys are pressed inside the pane; run-kit only documents them.
- **Data**: existing `getKeybindings(server)` client API (curated whitelist ~8 commands, `app/backend/api/keybindings.go`), fetched while the overlay is open for the current server. Root table under a "Direct" subhead; prefix table under "Prefix — Ctrl+S, then key" with sequence rendering (`Ctrl` `S` then `\`). Real bindings from `configs/tmux/default.conf`: F2/F3/F4 new/prev/next window, Shift+F3/F4 prev/next pane, Shift+F7 copy mode; prefix `\` split vertical, `-` split horizontal.
- Section header names the source server; no current server → one-line empty state "No tmux server running".
- **NO TABS (decided)**: one scroll, one filter spanning app + custom + tmux (the core query "what's the key for X?" must be answerable from either system; the tmux set is small). Instead: a **sticky jump-nav chip row** under the header (key map · global · terminal · board · custom · tmux) — plain scroll anchors normally; while the filter is active each chip shows a live per-section match count and dims when empty.
- **Tier map becomes foldable** ("collapse map") to reclaim vertical space, and auto-hides while a filter is active. Map stays app-tiers-only (tmux prefix chords don't fit the combo model).
- **SHELL-owned locked rows demote** from a top-level section to a subgroup inside GLOBAL (avoids three flavors of locked top-level sections).
- **E2E**: check `app/frontend/tests/e2e` for Playwright specs asserting on the legacy dialog's title/structure ("tmux Keybindings") before deleting; update specs AND their sibling `.spec.md` companions (constitution: Test Companion Docs). Known relevant spec: `shortcut-registry.spec.ts` asserts on the `shortcuts-overlay` testid and the "Help: Keyboard Shortcuts" palette entry.

### R5 — "Open in last-used app" action + chord (⇧⌘O)

The Open split-button's primary segment already re-runs the last-used target (localStorage `runkit-open-last-used`; `open-button.tsx` / `lib/open-in-app.ts` — `LAST_USED_OPEN_TARGET_KEY`, `readLastUsedOpenTarget`, `resolveLastUsedTarget` all exist). There is no keyboard path except per-target palette entries, and `lib/palette-open.ts` documents why no static chord exists (targets are data-driven). An `open-last-used` action names the **behavior**, not an app, sidestepping that objection:

- New builtin binding: `actionId: "open-last-used"`, `tier: "shifted"`, `code: "KeyO"` (free + unclaimed), `scope: "terminal"` (the Open control is Terminal-route only), `label: "Open in last-used app"`.
- Handler in `app.tsx`: `resolveLastUsedTarget(targets, readLastUsedOpenTarget())` → the shared `useRunOpenTarget().runTarget`; when nothing stored / stale → toast "No last-used app yet — pick one from Open ▾ or the palette" (a chord can't reasonably pop the mouse menu).
- Also add a palette action `Open: Last used (<label>)` with a dynamic suffix naming what it would launch, keeping palette↔button parity.
- Update the `palette-open.ts` "no keyboard chord" registration comment to reflect the new dynamic action (code-review rule: new shortcuts documented in palette registration).

### R6 — BUG FIX (separate package, `app/desktop`): editor deeplinks silently dropped in the Electron shell

**Root cause (verified in code)**: deeplink targets run `window.location.href = "vscode://vscode-remote/ssh-remote+<host><path>"` (`useRunOpenTarget`). In the shell, `main.ts` (~line 846) `will-navigate` → `guardNavigation`: `isAllowedNavigation` false → `preventDefault()`, and the external fallback only forwards http(s) — `vscode://` is silently dropped. Same all-external policy in `window-open.ts` `windowOpenAction` for `window.open`. Host-kind targets (POST `/api/open`) are unaffected.

**Fix (decided)**: a FIXED allowlist of editor deeplink schemes — `vscode:`, `cursor:`, `windsurf:` — exactly mirroring `DEEPLINK_APPS` in `app/frontend/src/lib/open-in-app.ts`, routed to `shell.openExternal` in BOTH `guardNavigation` (`main.ts`) and the window-open policy (`app/desktop/src/window-open.ts`, the electron-free unit-testable module — put the allowlist + decision fn there).

- MUST remain an allowlist, never a scheme pass-through (`window-open.ts` documents arbitrary-scheme `openExternal` as an injection vector).
- Document the cross-file coupling at BOTH sites (a comment next to `DEEPLINK_APPS` and next to the allowlist).
- **Accepted trade**: a future editor added to the SPA needs a shell release.
- Extend the existing `node --test` coverage for the policy module.

### Cross-cutting constraints (from project docs & conversation)

- **Constitution IV**: the overlay stays a dialog, no new routes. **Constitution V**: every new action palette-reachable.
- **Board-route twin**: `board-page.tsx` re-implements shell chrome — every wiring change (R1 handler, R3 event listener, R4 overlay props/legacy-dialog removal) must be applied/checked on BOTH `app.tsx` and `board-page.tsx`.
- **Verification gates** (code-quality.md): `cd app/backend && go test ./...` (likely unaffected), `cd app/frontend && npx tsc --noEmit`, `just test`, `just build`. Desktop package: compile + `node --test` per its own scripts.
- **Tests for new/changed behavior**: Vitest for the new bindings/dispatch, compose focus-on-open, overlay tmux section + filter counts; `node --test` for the desktop window-open policy; update e2e specs + `.spec.md` companions where chrome assertions change (Playwright specs are known to assert on chrome details like dialog titles).

## Affected Memory

- `run-kit/ui-patterns`: (modify) keybinding registry gains `compose-toggle` (⇧⌘E, ignoreInputs) and `open-last-used` (⇧⌘O, terminal scope); ShortcutsOverlay becomes the single merged shortcuts surface (tmux section, jump-nav chips, foldable tier map, SHELL rows demoted into GLOBAL); legacy KeyboardShortcuts dialog removed; sidebar footer gains the Keyboard icon (Help · Keyboard · Theme · Gear); compose-strip focus contract revised (focus-on-open, never on remount/after-send)
- `run-kit/desktop-shell`: (modify) navigation/window-open policy gains a fixed editor-deeplink scheme allowlist (`vscode:`, `cursor:`, `windsurf:`) routed to `shell.openExternal`, mirroring the SPA's `DEEPLINK_APPS`

## Impact

- `app/frontend/src/lib/keybindings.ts` — two new builtin bindings (R1, R5)
- `app/frontend/src/contexts/chrome-context.tsx`, `app/frontend/src/lib/compose-strip-events.ts`, ComposeStrip component, `terminal-client.tsx` — focus-on-open flag (R2)
- `app/frontend/src/components/sidebar/icons.tsx`, `app/frontend/src/components/sidebar/index.tsx` — new icon + footer button (R3)
- `app/frontend/src/components/shortcuts-overlay.tsx` — tmux section, jump-nav chips, foldable map, SHELL demotion (R4)
- `app/frontend/src/components/keyboard-shortcuts.tsx` — DELETED (R4)
- `app/frontend/src/app.tsx` AND `app/frontend/src/components/board-page.tsx` — dispatch maps, palette entries, overlay wiring, legacy-dialog mount removal (R1/R3/R4/R5; board-twin rule)
- `app/frontend/src/lib/palette-open.ts`, `app/frontend/src/lib/open-in-app.ts`, `open-button.tsx` — open-last-used action (R5); `DEEPLINK_APPS` coupling comment (R6)
- `app/desktop/src/main.ts`, `app/desktop/src/window-open.ts` (+ its node --test suite) — deeplink allowlist (R6)
- `app/frontend/tests/e2e/shortcut-registry.spec.ts` (+ `.spec.md`) and any other specs asserting legacy-dialog chrome — updated (R4)
- Backend read-only dependency: `app/backend/api/keybindings.go` `getKeybindings(server)` (existing API, no changes expected)

## Open Questions

- None asked (promptless dispatch). Residual ambiguities are graded in `## Assumptions`; none reached Unresolved severity — the conversation pre-resolved all consequential decisions.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | R1 chord is ⇧⌘E / Shift+Ctrl+E on `KeyE`, shifted tier, global scope, `ignoreInputs: true`, handled by existing `toggleComposeStrip()` | Discussed — letter-by-letter elimination (C/T/I claimed or taken) recorded in conversation; `KeyE` verified free in `DEFAULT_BINDINGS`; `ignoreInputs` field exists | S:90 R:85 A:90 D:90 |
| 2 | Certain | R1 `actionId` is `compose-toggle` with `mapLabel: "compose"` unless existing naming conventions in `DEFAULT_BINDINGS` dictate otherwise | Discussed — named as suggestion ("or consistent with existing naming"); apply follows registry conventions | S:75 R:90 A:85 D:80 |
| 3 | Certain | R2 reverses 260718-dhdj focus contract for the open transition ONLY — after-send never focuses, Escape blurs, route remounts never steal focus; seam is a module-level `focusOnOpen` flag in `compose-strip-events.ts` set by `toggleComposeStrip` off→on, consumed-and-cleared by ComposeStrip's mount effect | Discussed — explicit reversal decision with the seam, flag home, and remount guard all specified in conversation | S:90 R:80 A:90 D:90 |
| 4 | Certain | R2 mobile IME summon on open is accepted/desired | Discussed — matches the ⌨ chip behavior | S:90 R:90 A:90 D:95 |
| 5 | Confident | R3 wiring uses a document CustomEvent (`shortcuts-overlay:open`, `palette:open` precedent) listened in both `app.tsx` and `board-page.tsx` overlay mounts | Discussed — preferred seam named, with an explicit escape hatch ("unless a cleaner existing prop path presents itself"); apply decides-and-records | S:80 R:85 A:75 D:70 |
| 6 | Certain | R3 affordance hiding with the sidebar/drawer is an accepted trade; palette remains the always-available route | Discussed — trade explicitly accepted in conversation | S:90 R:90 A:90 D:90 |
| 7 | Certain | R4 has NO TABS — one scroll, one filter spanning app + custom + tmux, sticky jump-nav chip row with live per-section match counts; tier map foldable and auto-hidden during filter; SHELL rows demoted into GLOBAL; per approved `design-mock.html` | Discussed — explicit "decided" markers in conversation; approved working mock copied into change folder | S:90 R:75 A:85 D:90 |
| 8 | Certain | R4 tmux data comes from existing `getKeybindings(server)` (api/keybindings.go), rendered as read-only locked rows; empty state "No tmux server running" | Discussed — API named, row idiom named, empty-state copy given verbatim | S:90 R:85 A:90 D:90 |
| 9 | Confident | R4 legacy dialog's palette entry is removed (not repointed) — the overlay already has its own "Help: Keyboard Shortcuts" palette entry; a second entry to the same surface adds noise | Conversation said "repoint or remove"; removal is the cleaner default given the overlay's existing entry; easily reversed | S:65 R:90 A:75 D:60 |
| 10 | Certain | R5 chord is ⇧⌘O on `KeyO`, shifted tier, terminal scope, `actionId: "open-last-used"`; empty/stale state shows toast "No last-used app yet — pick one from Open ▾ or the palette"; palette gains dynamic `Open: Last used (<label>)` action | Discussed — all values given verbatim; helpers (`resolveLastUsedTarget`, `readLastUsedOpenTarget`) verified present | S:90 R:85 A:90 D:90 |
| 11 | Certain | R6 fix is a FIXED scheme allowlist (`vscode:`, `cursor:`, `windsurf:`) mirroring `DEEPLINK_APPS`, applied in BOTH `guardNavigation` (main.ts) and `window-open.ts` policy, with the allowlist + decision fn in the electron-free `window-open.ts`; never a pass-through; coupling documented at both sites | Discussed — root cause verified in code during conversation; security constraint (injection vector) explicit | S:90 R:80 A:90 D:90 |
| 12 | Certain | R6 ships in this same change despite touching a different package (`app/desktop`), flagged as a clearly-separated requirement | Discussed — user explicitly asked to include it | S:95 R:85 A:95 D:95 |
| 13 | Certain | Change type is `feat` — predominantly five UI features; the single desktop bug fix (R6) rides along as a separated requirement | Dispatcher guidance + change composition; `fix` would misrepresent 5 of 6 requirements | S:80 R:90 A:85 D:80 |
| 14 | Certain | Test surface: Vitest for bindings/dispatch/focus-on-open/overlay filter counts; node --test for desktop policy; e2e spec + `.spec.md` updates where chrome assertions change (`shortcut-registry.spec.ts` identified) | code-quality.md mandates tests for changed behavior; constitution mandates spec companions; exact test-case inventory is apply's call | S:75 R:90 A:85 D:80 |

14 assumptions (12 certain, 2 confident, 0 tentative, 0 unresolved).
