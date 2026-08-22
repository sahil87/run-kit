# Intake: Arrow-Key Tab & Session Navigation + Hosts H Rebind

**Change**: 260822-ju2p-arrow-tab-session-navigation
**Created**: 2026-08-22

## Origin

Synthesized from a design discussion with the user and dispatched promptless via the `/fab-proceed` Create-Intake Procedure (`{questioning-mode} = promptless-defer`). All user-decided points below are **FINAL** — they were settled interactively before dispatch, including the alternatives-rejected record.

> **Feature: arrow-key tab/session navigation + hosts-menu H rebind.** Rework the high-frequency tab-navigation chords in the declarative keybinding registry (`app/frontend/src/lib/keybindings.ts`, handlers in `app/frontend/src/app.tsx`) around arrow keys, make tab cycling span sessions, add a session-jump variant, and move the hosts-menu chord onto the freed H keycap.

**Alternatives rejected during the discussion (user-decided):**
- **⇧⌘[/⇧⌘]** (Safari/iTerm2/VS Code tab-switch convention) — splits awkwardly from ⌘[/⌘] history back/forward on the same keycaps and has no natural session-jump extension; the user explicitly prefers arrows.
- **Keeping H/L** — replaced; the per-device override layer covers users who want them back.
- **Landing session jumps on the first sidebar window** — rejected in favor of the tmux-active window.

## Why

1. **Pain point**: tab navigation (`window-prev`/`window-next`) is the highest-frequency chord pair in the app, but H/L are arbitrary vim-ish letters that don't match the sidebar's spatial mental model — sessions as groups, windows as rows, stacked **vertically**. Worse, the cycle is imprisoned in the current session: reaching a window in another session requires the palette or the mouse. And `host-menu-open` sits on M while its `mapLabel` is `"hosts"` — a mnemonic mismatch (`⇧⌘M, 3` reads worse than `⇧⌘H, 3` — "Hosts, third one").
2. **Consequence of not doing it**: the primary keyboard navigation path stays session-bound (violating the spirit of Constitution V keyboard-first — multi-session workflows are the norm for agent orchestration), and the H keycap stays spent on a binding that arrows serve better, blocking the mnemonic hosts-menu placement.
3. **Why this approach**: arrows match the sidebar's vertical stacking (fine-grained window step = vertical; coarse session hop gets the remaining axis per platform); no registry binding currently occupies any Arrow code (verified against `DEFAULT_BINDINGS`), and arrows carry no browser/system reservations on the tiers used. The mac tier split (⌘ = tab level, ⇧⌘ = level above) rides the codebase's established N/T/W convention (⌘T/⇧⌘T, ⌘W/⇧⌘W). Mnemonic story: **"arrows walk the sidebar; on mac, hold Shift to leap a session."**

## What Changes

### 1. Rebind `window-prev`/`window-next` from H/L to ↑/↓

Current rows (`app/frontend/src/lib/keybindings.ts:232-233`):

```ts
{ actionId: "window-prev", code: "KeyH", tier: "shifted", scope: "global", kind: "builtin", label: "Previous tab", mapLabel: "prev tab" },
{ actionId: "window-next", code: "KeyL", tier: "shifted", scope: "global", kind: "builtin", label: "Next tab", mapLabel: "next tab" },
```

New encoding: `code: "ArrowUp"` / `"ArrowDown"`, tier stays `shifted` (⇧Ctrl+↑/↓ on Win/Linux), plus **`macTier: "cmd"`** → ⌘↑/⌘↓ on macOS in **BOTH** hosts. ⌘↑/⌘↓ is only the mac browser's scroll-to-top/bottom — `preventDefault`-interceptable, the ⌘D/⌘[ accelerator class, **not** reserved like N/T/W — so **no `macShellOnly`** and no `browser`-owner claim row. Palette labels `Tab: Previous`/`Tab: Next` stay. (`mapLabel` handling is the plan's call — the panel's tier-map grids are letter/digit keycap grids; arrows may follow the `Comma`/`Backquote` no-cell precedent.)

### 2. Semantic change — tab cycling spans sessions

Today `windowCycleActions` (`app/frontend/src/app.tsx:3493`) is a modulo loop over the **CURRENT session's** windows only (`currentSession?.windows`). New behavior: **flatten ALL sessions' windows in sidebar order** (the `sessions` array from `useMergedSessions` is that order), find the current window by `windowParam`, move one row, wrap at the ends. Crossing a session boundary lands on the adjacent session's edge window — last window of the previous session going up, first window of the next session going down. Navigation goes through the existing rich `navigateToWindow` path (tmux align + transition + writeback suppression), exactly as today. Palette ids stay `window-prev`/`window-next` so `withShortcutHints` and `fromPalette` wiring is untouched; the stale "current session's sidebar order" comments at app.tsx:3485-3492 and ~:3563-3565 update with the semantics.

### 3. New actions `session-prev`/`session-next`

Jump to the **adjacent session in sidebar order** (wraparound), landing on that session's **tmux-active window** (`isActiveWindow` — user-decided; NOT first-in-sidebar-order).

- **macOS**: ⇧⌘↑/⇧⌘↓ — the same arrow codes on the **shifted** tier, tier-disjoint from the cmd-tier window pair on the same codes (the mac split-pair ⌘D/⇧⌘D precedent — tier-disjoint on one code, `findConflicts` stays clean).
- **Win/Linux**: ⇧Ctrl+←/→ — the shifted tier is already spent by the window pair on ↑/↓ there, so sessions take the **horizontal axis** (vertical = fine-grained window step, horizontal = coarse session hop). This mac/Win-Linux asymmetry is forced: plain Ctrl belongs to the pane on Win/Linux (Ctrl+arrows = readline word movement), so both pairs must live on the shifted tier there, and two actions cannot share ⇧Ctrl+↑/↓.
- **Registry encoding**: base `code: "ArrowLeft"`/`"ArrowRight"`, tier `shifted`, `macCode: "ArrowUp"`/`"ArrowDown"` with **NO `macTier`** (stays shifted) — the `create-session` `macCode`-stays-shifted precedent.
- **New palette entries** (e.g. `Session: Previous`/`Session: Next`; exact labels are the plan's call), ids = actionIds so chord hints attach and the chord handlers resolve through `fromPalette` — the `window-prev`/`window-next` pattern, likely a sibling memo beside `windowCycleActions` in app.tsx.

### 4. Move `host-menu-open` from KeyM to KeyH

Current row (`keybindings.ts:243`): shifted `KeyM`, no mac refinement, `mapLabel: "hosts"`. Change **only** `code: "KeyM"` → `"KeyH"` (⇧⌘H/⇧Ctrl+H) — same shape as today: shifted tier on every platform, no mac refinement, component-local handler in `shell-titlebar-strip.tsx` (which reads the binding via `byAction.get("host-menu-open")`, so it follows automatically), `mapLabel: "hosts"` finally matching its keycap — H for Hosts; `⇧⌘H, 3` reads as "Hosts, third one". The cmd-tier ⌘H macOS Hide claim (`MAC_SHELL_CMD_CLAIMS` / mac-browser system claim) is tier-disjoint and does not interfere; no Win/Linux shifted claim collides (only R/I/C/V are claimed there). The direct ⌥⌘1–9 / Alt+1–9 shell accelerators are untouched.

### 5. Sequencing constraint (load-bearing)

The H→arrows rebind and the M→H move **MUST land in this same change** — `window-prev` and `host-menu-open` are both `scope: "global"`, so both defaults on shifted-H would trip the `findConflicts` conflict-free-defaults invariant test (a test-enforced invariant over the shipped defaults in every host).

### 6. Freed keys

- **Shifted L is deliberately left unbound** on every platform (free real estate for the future); the cmd-tier ⌘L stays `web-address`.
- **Shifted M is freed** by the move; no new occupant.
- The `DEFAULT_BINDINGS`-adjacent reservation comments (⇧⌘P, ⇧⌘digit) are untouched.

### Terminal seam — no change expected

The seam's existing refusal rules already bubble both tiers out from under xterm focus with no `attachCustomKeyEventHandler` change: rule 1 (refuse any enabled shifted-tier match, every platform) covers the session pair everywhere plus the window pair and hosts chord on Win/Linux; rule 2 (mac cmd-tier with `metaKey`) covers ⌘↑/⌘↓ under terminal focus on mac, loss-free. Known accepted cost on Win/Linux: shifted-tier refusal means Ctrl+Shift+↑/↓/←/→ CSI sequences stop reaching the pane while the tiles own those chords — the same trade every shifted-tier binding already makes.

## Affected Memory

- `run-kit/ui/keyboard-and-palette`: (modify) default-binding table rows (H/L → arrows, M → H, two new session rows), per-platform tier rationale ("H/L/A stay shifted" pair-split paragraph is obsolete), the mac-demotion bullet list, freed-keys/claims notes, `macCode`-stays-shifted precedent list, palette action registry additions, cross-session cycle semantics
- `run-kit/ui/top-bar`: (modify) Desktop-Shell Titlebar Strip section's ⇧⌘M/⇧Ctrl+M hosts-menu chord references become ⇧⌘H/⇧Ctrl+H
- `run-kit/desktop-shell`: (modify) Keyboard-Tier Menu Seam section may reference the hosts-menu chord — verify at hydrate and update any ⇧⌘M mention

## Impact

- `app/frontend/src/lib/keybindings.ts` — three edited rows + two new rows in `DEFAULT_BINDINGS`; comments
- `app/frontend/src/lib/keybindings.test.ts` — conflict-free-defaults invariant across hosts, `defaultComboFor` resolution for the new `macCode`/`macTier` shapes, seam-refusal coverage
- `app/frontend/src/app.tsx` — `windowCycleActions` becomes the cross-session flatten; new session-jump palette actions + `fromPalette` handler entries (`session-prev`/`session-next` in `keybindingHandlers`)
- `app/frontend/src/components/shell-titlebar-strip.tsx` — no code change expected (binding read by actionId); comment mentions of ⇧⌘M update
- `app/frontend/src/components/settings-shortcuts-panel.tsx` — keycap-map cells: `KeyH` gains `hosts`, `KeyM`/`KeyL` shifted cells free up; arrow-key cell treatment is the plan's call
- Frontend unit tests (Vitest) for the new cycle/jump logic; Playwright e2e where chord behavior is user-visible (with `.spec.md` companions per constitution); any existing e2e asserting ⇧⌘H/⇧Ctrl+H or ⇧⌘M chords needs a sweep
- No backend, API, or route changes; no Electron menu/accelerator changes

## Open Questions

- None — all decision points were settled in the design discussion or explicitly delegated to the plan (palette label wording, arrow keycap-cell treatment, no-active-window fallback).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `window-prev`/`window-next` rebind KeyH/KeyL → ArrowUp/ArrowDown: base tier `shifted`, `macTier: "cmd"` (⌘↑/⌘↓ in both mac hosts), no `macShellOnly`; palette labels stay `Tab: Previous`/`Tab: Next` | Discussed — user decision 1, FINAL | S:95 R:85 A:95 D:95 |
| 2 | Certain | Tab cycling flattens ALL sessions' windows in sidebar order, moves one row, wraps at the ends; boundary crossing lands on the adjacent session's edge window; via `navigateToWindow` | Discussed — user decision 2, FINAL | S:95 R:80 A:90 D:95 |
| 3 | Certain | New `session-prev`/`session-next`: base `ArrowLeft`/`ArrowRight` on `shifted`, `macCode: "ArrowUp"`/`"ArrowDown"` with no `macTier` → ⇧⌘↑/⇧⌘↓ mac, ⇧Ctrl+←/→ Win/Linux (axis split forced by pane-owned plain Ctrl) | Discussed — user decision 3, FINAL; `create-session` macCode-stays-shifted precedent | S:95 R:85 A:90 D:95 |
| 4 | Certain | Session jump lands on the target session's tmux-active window (`isActiveWindow`), not first-in-sidebar-order | Discussed — user decision 3, FINAL; first-in-sidebar explicitly rejected | S:95 R:85 A:90 D:95 |
| 5 | Certain | `host-menu-open` moves KeyM → KeyH, shifted everywhere, no mac refinement, handler stays component-local in shell-titlebar-strip.tsx, `mapLabel: "hosts"` | Discussed — user decision 4, FINAL; ⌘H Hide claim is tier-disjoint, no Win/Linux shifted collision | S:95 R:90 A:95 D:95 |
| 6 | Certain | The H→arrows rebind and M→H move land in this ONE change | Discussed — user decision 5, FINAL; both actions are `scope: "global"`, so split changes would trip the `findConflicts` invariant test | S:95 R:90 A:95 D:100 |
| 7 | Certain | Shifted L and shifted M are left unbound after the move; ⌘L `web-address` and the ⌥⌘1–9/Alt+1–9 direct accelerators untouched | Discussed — user decision 6, FINAL | S:95 R:95 A:95 D:95 |
| 8 | Certain | mac-browser ⌘↑/⌘↓ interception is attempt-class (scroll-to-top/bottom is page-interceptable, the ⌘D/⌘[ class): no claim row, no `macShellOnly`, degrades to palette if a browser refuses | Discussed — user rationale in decision 1 | S:85 R:80 A:85 D:85 |
| 9 | Confident | `session-prev`/`session-next` ride `scope: "global"`, mirroring `window-prev`/`window-next`; handler presence gates applicability (no handler off window routes → chord falls through) | Not stated explicitly; the window pair's exact shape, and scope is descriptive (drives panel grouping/conflict scoping only) | S:70 R:85 A:80 D:75 |
| 10 | Confident | Exact palette labels (suggested `Session: Previous`/`Session: Next`) and arrow keycap-cell/`mapLabel` treatment (suggest the `Comma`/`Backquote` no-cell precedent) are the plan's call | User explicitly delegated labels to the plan | S:70 R:85 A:75 D:70 |
| 11 | Confident | No `attachCustomKeyEventHandler` change: seam rules 1 (shifted everywhere) and 2 (mac cmd-tier metaKey) already bubble both tiers; accepted cost = shifted-arrow CSI sequences no longer reach the pane on Win/Linux | User rationale; verified against the seam's documented refusal rules — plan re-verifies in code | S:75 R:75 A:80 D:75 |
| 12 | Confident | When the target session has no `isActiveWindow` flag (stale SSE edge), fall back to its first window in sidebar order rather than skipping the session | Unstated edge case; graceful-degradation default, plan may refine | S:60 R:85 A:75 D:70 |

12 assumptions (8 certain, 4 confident, 0 tentative, 0 unresolved).
